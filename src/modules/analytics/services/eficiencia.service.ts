import type { DimensaoEficiencia, Prisma, PrismaClient, StatusEquipamento } from '@prisma/client';
import { arredondar, resumir } from '../stats/estatistica';
import { filtroOrg, type AnaliseContexto, type ResultadoCalculo, type ServicoAnalise } from '../analytics.types';

const HORA = 3_600_000;

export interface MovimentoStatus {
  equipamentoId: string;
  loteId: string;
  statusPara: StatusEquipamento;
  ator: string;
  em: Date;
}
export interface LoteEntrada {
  id: string;
  dataEntrada: Date;
  totalEquipamentos: number;
}
export interface LinhaEficiencia {
  dimensao: DimensaoEficiencia;
  chave: string;
  amostras: number;
  mediaHoras: number;
  medianaHoras: number;
  desvioHoras: number;
  p90Horas: number;
  gargalo: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const chaveMes = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
const chaveTrimestre = (d: Date) => `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;

function agrupar<T>(itens: T[], chave: (i: T) => string): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const i of itens) {
    const k = chave(i);
    (mapa.get(k) ?? mapa.set(k, []).get(k)!).push(i);
  }
  return mapa;
}

function linha(dimensao: DimensaoEficiencia, chave: string, horas: number[], gargalo = false): LinhaEficiencia {
  const r = resumir(horas);
  return {
    dimensao, chave, amostras: r.amostras, gargalo,
    mediaHoras: arredondar(r.media), medianaHoras: arredondar(r.mediana),
    desvioHoras: arredondar(r.desvio), p90Horas: arredondar(r.p90),
  };
}

/**
 * Cálculo puro (sem banco), fácil de testar.
 *  - geral/mes/trimestre: tempo do LOTE, da entrada até a conclusão da triagem (último equipamento em triagem_completa);
 *  - operador: tempo de triagem por EQUIPAMENTO (triagem -> triagem_completa), atribuído a quem concluiu;
 *  - etapa: tempo de permanência em cada status; a etapa mais lenta (média) é marcada como gargalo.
 */
export function calcularEficiencia(
  movs: MovimentoStatus[], lotes: LoteEntrada[], minAmostrasGargalo = 3,
): LinhaEficiencia[] {
  const ordenados = [...movs].sort((a, b) => a.em.getTime() - b.em.getTime());
  const porEquip = agrupar(ordenados, (m) => m.equipamentoId);

  const permanencia = new Map<string, number[]>();
  const triagemPorOperador = new Map<string, number[]>();
  const conclusaoPorLote = new Map<string, Map<string, Date>>();

  for (const [equipId, lista] of porEquip) {
    for (let i = 0; i < lista.length - 1; i++) {
      const horas = (lista[i + 1].em.getTime() - lista[i].em.getTime()) / HORA;
      (permanencia.get(lista[i].statusPara) ?? permanencia.set(lista[i].statusPara, []).get(lista[i].statusPara)!).push(horas);
    }
    const ini = lista.find((m) => m.statusPara === 'triagem');
    const fim = lista.find((m) => m.statusPara === 'triagem_completa');
    if (!fim) continue;
    const doLote = conclusaoPorLote.get(fim.loteId) ?? conclusaoPorLote.set(fim.loteId, new Map()).get(fim.loteId)!;
    doLote.set(equipId, fim.em);
    if (ini && fim.em >= ini.em) {
      const horas = (fim.em.getTime() - ini.em.getTime()) / HORA;
      (triagemPorOperador.get(fim.ator) ?? triagemPorOperador.set(fim.ator, []).get(fim.ator)!).push(horas);
    }
  }

  const temposLote: Array<{ horas: number; conclusao: Date }> = [];
  for (const l of lotes) {
    const concl = conclusaoPorLote.get(l.id);
    if (!concl || l.totalEquipamentos === 0 || concl.size < l.totalEquipamentos) continue; // triagem incompleta
    const conclusao = new Date(Math.max(...[...concl.values()].map((d) => d.getTime())));
    const horas = (conclusao.getTime() - l.dataEntrada.getTime()) / HORA;
    if (horas >= 0) temposLote.push({ horas, conclusao });
  }

  const linhas: LinhaEficiencia[] = [];
  if (temposLote.length) {
    linhas.push(linha('geral', 'geral', temposLote.map((t) => t.horas)));
    for (const [k, v] of agrupar(temposLote, (t) => chaveMes(t.conclusao))) linhas.push(linha('mes', k, v.map((t) => t.horas)));
    for (const [k, v] of agrupar(temposLote, (t) => chaveTrimestre(t.conclusao))) linhas.push(linha('trimestre', k, v.map((t) => t.horas)));
  }
  for (const [op, horas] of triagemPorOperador) linhas.push(linha('operador', op, horas));

  const etapas = [...permanencia].map(([status, horas]) => linha('etapa', status, horas));
  const candidatas = etapas.filter((e) => e.amostras >= minAmostrasGargalo);
  const gargalo = (candidatas.length ? candidatas : etapas).reduce<LinhaEficiencia | null>(
    (pior, e) => (!pior || e.mediaHoras > pior.mediaHoras ? e : pior), null,
  );
  if (gargalo) gargalo.gargalo = true;
  return [...linhas, ...etapas];
}

export class EficienciaService implements ServicoAnalise<LinhaEficiencia> {
  readonly tipo = 'eficiencia_operacional' as const;
  constructor(private prisma: PrismaClient) {}

  async calcular(ctx: AnaliseContexto): Promise<ResultadoCalculo<LinhaEficiencia>> {
    const loteWhere = { ativo: true, ...filtroOrg(ctx.organizacaoId) };
    const [movs, lotes] = await Promise.all([
      this.prisma.movimentacao.findMany({
        where: { statusPara: { not: null }, equipamento: { lote: loteWhere } },
        select: {
          equipamentoId: true, statusPara: true, ator: true, criadoEm: true,
          equipamento: { select: { loteId: true } },
        },
      }),
      this.prisma.lote.findMany({
        where: loteWhere,
        select: { id: true, dataEntrada: true, _count: { select: { equipamentos: true } } },
      }),
    ]);

    const avisos: string[] = [];
    if (!movs.length) {
      avisos.push('Nenhuma movimentação com statusDe/statusPara encontrada: registros anteriores à AV3 não têm transição estruturada.');
    }
    const linhas = calcularEficiencia(
      movs.map((m) => ({
        equipamentoId: m.equipamentoId, loteId: m.equipamento.loteId,
        statusPara: m.statusPara!, ator: m.ator, em: m.criadoEm,
      })),
      lotes.map((l) => ({ id: l.id, dataEntrada: l.dataEntrada, totalEquipamentos: l._count.equipamentos })),
      Number(ctx.parametros.minAmostras ?? 3),
    );
    if (movs.length && !linhas.some((l) => l.dimensao === 'geral')) {
      avisos.push('Nenhum lote com triagem concluída: tempo médio de processamento indisponível.');
    }
    return { linhas, avisos };
  }

  async salvar(tx: Prisma.TransactionClient, execucaoId: string, linhas: LinhaEficiencia[]) {
    if (linhas.length) await tx.resultadoEficiencia.createMany({ data: linhas.map((l) => ({ execucaoId, ...l })) });
  }

  buscar(execucaoId: string) {
    return this.prisma.resultadoEficiencia.findMany({
      where: { execucaoId },
      orderBy: [{ dimensao: 'asc' }, { chave: 'asc' }],
      select: {
        dimensao: true, chave: true, amostras: true, mediaHoras: true, medianaHoras: true,
        desvioHoras: true, p90Horas: true, gargalo: true,
      },
    });
  }
}
