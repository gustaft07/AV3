import type { EstadoFisico, Prisma, PrismaClient } from '@prisma/client';
import { arredondar, resumir } from '../stats/estatistica';
import { filtroOrg, type AnaliseContexto, type ResultadoCalculo, type ServicoAnalise } from '../analytics.types';

export interface LinhaRentabilidade {
  tipo: string;
  marca: string;
  modelo: string;
  estadoFisico: EstadoFisico | null; // null = consolidado (todos os estados)
  amostras: number;
  valorMedio: number;
  desvio: number;
  valorTotal: number;
}

export const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * Valor de referência com fallback do mais específico para o mais genérico:
 * (tipo, marca, modelo, estado) -> (tipo, marca, estado) -> (tipo, estado).
 */
export function buscarValor(
  refs: Map<string, number>, tipo: string, marca: string, modelo: string, estado: EstadoFisico,
): number | undefined {
  return refs.get(`${tipo}|${marca}|${modelo}|${estado}`)
    ?? refs.get(`${tipo}|${marca}||${estado}`)
    ?? refs.get(`${tipo}|||${estado}`);
}

export interface EquipRentab { tipo: string; marca: string | null; modelo: string | null; estadoFisico: EstadoFisico }

/** Agregação pura: valor por equipamento (com fallback de referência) -> detalhe por estado + consolidado. */
export function agregarRentabilidade(equips: EquipRentab[], refs: Map<string, number>) {
  const semReferencia = new Set<string>();
  const detalhe = new Map<string, { base: { tipo: string; marca: string; modelo: string }; estado: EstadoFisico; valores: number[] }>();
  const consolidado = new Map<string, { base: { tipo: string; marca: string; modelo: string }; valores: number[] }>();

  for (const e of equips) {
    const valor = buscarValor(refs, norm(e.tipo), norm(e.marca), norm(e.modelo), e.estadoFisico);
    if (valor === undefined) { semReferencia.add(`${norm(e.tipo)}/${e.estadoFisico}`); continue; }
    const base = { tipo: e.tipo, marca: e.marca?.trim() ?? '', modelo: e.modelo?.trim() ?? '' };
    const kg = `${norm(base.tipo)}|${norm(base.marca)}|${norm(base.modelo)}`;
    const kd = `${kg}|${e.estadoFisico}`;
    (detalhe.get(kd) ?? detalhe.set(kd, { base, estado: e.estadoFisico, valores: [] }).get(kd)!).valores.push(valor);
    (consolidado.get(kg) ?? consolidado.set(kg, { base, valores: [] }).get(kg)!).valores.push(valor);
  }

  const montar = (base: { tipo: string; marca: string; modelo: string }, estado: EstadoFisico | null, valores: number[]): LinhaRentabilidade => {
    const r = resumir(valores);
    return {
      ...base, estadoFisico: estado, amostras: r.amostras,
      valorMedio: arredondar(r.media), desvio: arredondar(r.desvio),
      valorTotal: arredondar(valores.reduce((s, v) => s + v, 0)),
    };
  };
  const linhas = [
    ...[...detalhe.values()].map((d) => montar(d.base, d.estado, d.valores)),
    ...[...consolidado.values()].map((c) => montar(c.base, null, c.valores)),
  ];
  return { linhas, semReferencia: [...semReferencia].sort() };
}

export class RentabilidadeService implements ServicoAnalise<LinhaRentabilidade> {
  readonly tipo = 'rentabilidade' as const;
  constructor(private prisma: PrismaClient) {}

  async calcular(ctx: AnaliseContexto): Promise<ResultadoCalculo<LinhaRentabilidade>> {
    const [equips, tabela] = await Promise.all([
      this.prisma.equipamento.findMany({
        where: { lote: { ativo: true, ...filtroOrg(ctx.organizacaoId) } },
        select: { tipo: true, marca: true, modelo: true, estadoFisico: true },
      }),
      this.prisma.valorReferenciaRecuperacao.findMany(),
    ]);
    const refs = new Map<string, number>(
      tabela.map((r): [string, number] => [`${norm(r.tipo)}|${norm(r.marca)}|${norm(r.modelo)}|${r.estadoFisico}`, Number(r.valor)]),
    );

    const { linhas, semReferencia } = agregarRentabilidade(equips, refs);
    const avisos: string[] = [];
    if (semReferencia.length) avisos.push(`Sem valor de referência (excluídos do cálculo): ${semReferencia.join(', ')}.`);
    return { linhas, avisos };
  }

  async salvar(tx: Prisma.TransactionClient, execucaoId: string, linhas: LinhaRentabilidade[]) {
    if (linhas.length) await tx.resultadoRentabilidade.createMany({ data: linhas.map((l) => ({ execucaoId, ...l })) });
  }

  async buscar(execucaoId: string) {
    const rows = await this.prisma.resultadoRentabilidade.findMany({
      where: { execucaoId },
      orderBy: [{ valorMedio: 'desc' }],
      select: { tipo: true, marca: true, modelo: true, estadoFisico: true, amostras: true, valorMedio: true, desvio: true, valorTotal: true },
    });
    return rows.map((r) => ({
      ...r,
      estadoFisico: r.estadoFisico ?? 'todos',
      valorMedio: Number(r.valorMedio), desvio: Number(r.desvio), valorTotal: Number(r.valorTotal),
    }));
  }
}
