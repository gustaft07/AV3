import type { EstadoFisico, MetodoPrevisao, Prisma, PrismaClient } from '@prisma/client';
import { mean } from 'simple-statistics';
import { arredondar, r2DaReta, regressaoOLS } from '../stats/estatistica';
import { suavizacaoHolt } from '../stats/holt';
import { filtroOrg, type AnaliseContexto, type ResultadoCalculo, type ServicoAnalise } from '../analytics.types';

export const DIA = 86_400_000;
/** Nota numérica do estado físico: é a "saúde" do equipamento que a regressão acompanha ao longo da idade. */
export const SCORE: Record<EstadoFisico, number> = {
  novo: 5, seminovo: 4, usado_bom: 3, usado_regular: 2, usado_ruim: 1, sucata: 0,
};

export interface Observacao { idade: number; score: number }
export interface LinhaPrevisao {
  tipo: string;
  metodo: MetodoPrevisao;
  limiar: number;
  amostras: number;
  inclinacao: number;
  intercepto: number;
  r2: number;
  vidaRestanteDias: number | null;
  inservivelPrevistoEm: Date | null;
  recomendada: boolean;
}

/** Série de médias por faixas de 30 dias de idade, com lacunas preenchidas por interpolação linear. */
export function serieDeFaixas(obs: Observacao[]): { valores: number[]; ultimaFaixa: number } {
  const mapa = new Map<number, number[]>();
  for (const o of obs) {
    const k = Math.floor(o.idade / 30);
    (mapa.get(k) ?? mapa.set(k, []).get(k)!).push(o.score);
  }
  const ks = [...mapa.keys()].sort((a, b) => a - b);
  const medias = new Map<number, number>(ks.map((k): [number, number] => [k, mean(mapa.get(k)!)]));
  const valores: number[] = [];
  const ini = ks[0], fim = ks[ks.length - 1];
  for (let k = ini; k <= fim; k++) {
    if (medias.has(k)) { valores.push(medias.get(k)!); continue; }
    let a = k - 1; while (!medias.has(a)) a--;
    let b = k + 1; while (!medias.has(b)) b++;
    valores.push(medias.get(a)! + ((medias.get(b)! - medias.get(a)!) * (k - a)) / (b - a));
  }
  return { valores, ultimaFaixa: fim };
}

/** Observações (idade em dias, nota) de um equipamento: estado inicial, cada transição e o estado atual. */
export function observacoesDoEquipamento(
  e: { estadoFisico: EstadoFisico; criadoEm: Date; historicoEstado: Array<{ de: EstadoFisico; para: EstadoFisico; em: Date }> },
  agora: Date,
): Observacao[] {
  const obs: Observacao[] = [{ idade: 0, score: SCORE[e.historicoEstado[0]?.de ?? e.estadoFisico] }];
  for (const h of e.historicoEstado) {
    obs.push({ idade: Math.max(0, (h.em.getTime() - e.criadoEm.getTime()) / DIA), score: SCORE[h.para] });
  }
  if (e.estadoFisico !== 'sucata') obs.push({ idade: (agora.getTime() - e.criadoEm.getTime()) / DIA, score: SCORE[e.estadoFisico] });
  return obs;
}

/**
 * Vida útil remanescente: idade em que a reta (nota = inclinacao*idade + intercepto) cruza o limiar,
 * menos a idade média atual dos equipamentos ainda em uso. Sem tendência de queda (inclinação >= 0)
 * ou com horizonte acima de 100 anos, não há previsão confiável (null).
 */
export function projetar(
  inclinacao: number, intercepto: number, limiar: number, idadeMedia: number | null, agora: Date,
): { vidaRestanteDias: number | null; inservivelPrevistoEm: Date | null } {
  if (inclinacao >= 0 || idadeMedia === null) return { vidaRestanteDias: null, inservivelPrevistoEm: null };
  const restante = Math.max(0, (limiar - intercepto) / inclinacao - idadeMedia);
  if (!Number.isFinite(restante) || restante >= 36_500) return { vidaRestanteDias: null, inservivelPrevistoEm: null };
  return { vidaRestanteDias: arredondar(restante, 1), inservivelPrevistoEm: new Date(agora.getTime() + restante * DIA) };
}

export class VidaUtilService implements ServicoAnalise<LinhaPrevisao> {
  readonly tipo = 'vida_util' as const;
  constructor(private prisma: PrismaClient) {}

  async calcular(ctx: AnaliseContexto): Promise<ResultadoCalculo<LinhaPrevisao>> {
    const limiar = Number(ctx.parametros.limiar ?? 0.5);
    const minAmostras = Number(ctx.parametros.minAmostras ?? 10);
    const agora = new Date();

    const equips = await this.prisma.equipamento.findMany({
      where: { lote: { ativo: true, ...filtroOrg(ctx.organizacaoId) } },
      select: {
        tipo: true, estadoFisico: true, criadoEm: true,
        historicoEstado: { select: { de: true, para: true, em: true }, orderBy: { em: 'asc' } },
      },
    });

    // Observações por tipo (a nota e a idade são calculadas por observacoesDoEquipamento)
    const porTipo = new Map<string, { obs: Observacao[]; idadesAtivas: number[] }>();
    for (const e of equips) {
      const k = e.tipo.trim().toLowerCase();
      const g = porTipo.get(k) ?? porTipo.set(k, { obs: [], idadesAtivas: [] }).get(k)!;
      g.obs.push(...observacoesDoEquipamento(e, agora));
      if (e.estadoFisico !== 'sucata') g.idadesAtivas.push((agora.getTime() - e.criadoEm.getTime()) / DIA);
    }

    const preferidos = await this.metodoPreferidoPorTipo();
    const linhas: LinhaPrevisao[] = [];
    const avisos: string[] = [];

    for (const [tipo, g] of porTipo) {
      const idadesDistintas = new Set(g.obs.map((o) => Math.round(o.idade))).size;
      if (g.obs.length < minAmostras || idadesDistintas < 2) {
        avisos.push(`Tipo "${tipo}" ignorado: amostras insuficientes (${g.obs.length}; mínimo ${minAmostras}).`);
        continue;
      }
      const idadeMedia = g.idadesAtivas.length ? mean(g.idadesAtivas) : null;
      const montar = (metodo: MetodoPrevisao, inclinacao: number, intercepto: number, r2: number): LinhaPrevisao => ({
        tipo, metodo, limiar, amostras: g.obs.length, inclinacao, intercepto, r2: arredondar(r2, 4),
        ...projetar(inclinacao, intercepto, limiar, idadeMedia, agora),
        recomendada: false,
      });

      const pontos = g.obs.map((o): [number, number] => [o.idade, o.score]);
      const ols = regressaoOLS(pontos);
      const candidatas = [montar('ols', ols.inclinacao, ols.intercepto, ols.r2)];

      const serie = serieDeFaixas(g.obs);
      if (serie.valores.length >= 3) {
        const h = suavizacaoHolt(serie.valores);
        const inclinacao = h.tendencia / 30; // nota/dia
        const intercepto = h.nivel - inclinacao * ((serie.ultimaFaixa + 0.5) * 30);
        candidatas.push(montar('holt', inclinacao, intercepto, r2DaReta(pontos, inclinacao, intercepto)));
      }

      // Refinamento: o método com menor erro histórico (avaliações anteriores) vira a recomendação.
      const escolhido = candidatas.some((c) => c.metodo === preferidos.get(tipo)) ? preferidos.get(tipo) : 'ols';
      for (const c of candidatas) c.recomendada = c.metodo === escolhido;
      linhas.push(...candidatas);
    }
    if (!linhas.length && !avisos.length) avisos.push('Sem equipamentos para analisar.');
    return { linhas, avisos };
  }

  /** Média do erro (MAE) por tipo e método nas últimas avaliações; devolve o método de menor erro. */
  private async metodoPreferidoPorTipo(): Promise<Map<string, MetodoPrevisao>> {
    const avals = await this.prisma.avaliacaoPrevisao.findMany({
      orderBy: { avaliadaEm: 'desc' }, take: 500,
      select: { maeScore: true, previsao: { select: { tipo: true, metodo: true } } },
    });
    const acc = new Map<string, Map<MetodoPrevisao, number[]>>();
    for (const a of avals) {
      const porMetodo = acc.get(a.previsao.tipo) ?? acc.set(a.previsao.tipo, new Map()).get(a.previsao.tipo)!;
      (porMetodo.get(a.previsao.metodo) ?? porMetodo.set(a.previsao.metodo, []).get(a.previsao.metodo)!).push(a.maeScore);
    }
    const resultado = new Map<string, MetodoPrevisao>();
    for (const [tipo, porMetodo] of acc) {
      let melhor: MetodoPrevisao | null = null; let menor = Infinity;
      for (const [m, maes] of porMetodo) { const media = mean(maes); if (media < menor) { menor = media; melhor = m; } }
      if (melhor) resultado.set(tipo, melhor);
    }
    return resultado;
  }

  async salvar(tx: Prisma.TransactionClient, execucaoId: string, linhas: LinhaPrevisao[]) {
    if (linhas.length) await tx.previsaoVidaUtil.createMany({ data: linhas.map((l) => ({ execucaoId, ...l })) });
  }

  async buscar(execucaoId: string) {
    const rows = await this.prisma.previsaoVidaUtil.findMany({
      where: { execucaoId },
      orderBy: [{ tipo: 'asc' }, { metodo: 'asc' }],
      select: {
        tipo: true, metodo: true, limiar: true, amostras: true, inclinacao: true, intercepto: true,
        r2: true, vidaRestanteDias: true, inservivelPrevistoEm: true, recomendada: true,
      },
    });
    return rows.map((r) => ({ ...r, inservivelPrevistoEm: r.inservivelPrevistoEm?.toISOString() ?? null }));
  }
}
