import type { Prisma, TipoAnalise } from '@prisma/client';

export const VERSAO_MODELO = '1.0.0';

export interface AnaliseContexto {
  /** null = visão global (toda a base); preenchido = recorte de uma organização/parceiro. */
  organizacaoId: string | null;
  parametros: Record<string, unknown>;
}

export interface ResultadoCalculo<T> {
  linhas: T[];
  avisos: string[];
}

/** Contrato de cada serviço de análise: independentes entre si e sem conhecer HTTP ou filas. */
export interface ServicoAnalise<T> {
  readonly tipo: TipoAnalise;
  calcular(ctx: AnaliseContexto): Promise<ResultadoCalculo<T>>;
  salvar(tx: Prisma.TransactionClient, execucaoId: string, linhas: T[]): Promise<void>;
  /** Linhas planas (prontas para JSON/CSV) de uma execução já gravada. */
  buscar(execucaoId: string): Promise<Array<Record<string, unknown>>>;
}

export const filtroOrg = (organizacaoId: string | null) => (organizacaoId ? { organizacaoId } : {});
