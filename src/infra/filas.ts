import { Queue, type JobsOptions } from 'bullmq';
import { redisOpcoes } from './redis';

export const FILA_RELATORIOS = 'relatorios';
export const FILA_ANALISES = 'analises';
export const FILA_DLQ = 'relatorios-dlq';

/**
 * POLÍTICA DE RETRY (relatórios): 5 tentativas, backoff exponencial a partir de 5 s
 * (esperas de 5 s, 10 s, 20 s e 40 s). Esgotadas as tentativas, o job permanece em "failed" por 7 dias,
 * a tarefa vira "falhou" e uma cópia vai para a fila morta (DLQ) para inspeção.
 */
export const OPCOES_RELATORIO: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 604_800 },
};

export const OPCOES_ANALISES: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: 100,
  removeOnFail: 200,
};

const filas = new Map<string, Queue>();

function obter(nome: string, opcoes?: JobsOptions): Queue {
  let fila = filas.get(nome);
  if (!fila) {
    fila = new Queue(nome, { connection: redisOpcoes('queue'), defaultJobOptions: opcoes });
    filas.set(nome, fila);
  }
  return fila;
}

export const getFilaRelatorios = () => obter(FILA_RELATORIOS, OPCOES_RELATORIO);
export const getFilaAnalises = () => obter(FILA_ANALISES, OPCOES_ANALISES);
export const getFilaDlq = () => obter(FILA_DLQ);

export async function fecharFilas() {
  await Promise.all([...filas.values()].map((f) => f.close()));
  filas.clear();
}
