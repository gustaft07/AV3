import 'dotenv/config';
import path from 'node:path';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

function num(name: string, padrao: number): number {
  const v = process.env[name];
  const n = v === undefined || v === '' ? padrao : Number(v);
  if (!Number.isFinite(n)) throw new Error(`A variável ${name} deve ser numérica`);
  return n;
}

const PORT = num('PORT', 3000);

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  JWT_SECRET: required('JWT_SECRET'),
  PORT,
  // --- AV3 ---
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  // path.resolve + path.join em todo o código: funciona igual no Windows e no Linux
  STORAGE_DIR: path.resolve(process.env.STORAGE_DIR || './storage'),
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`,
  WORKER_CONCURRENCY: num('WORKER_CONCURRENCY', 2),
  RELATORIO_TTL_DIAS: num('RELATORIO_TTL_DIAS', 7),
  MAX_TAREFAS_PENDENTES_POR_ORG: num('MAX_TAREFAS_PENDENTES_POR_ORG', 5),
  RATE_LIMIT_PADRAO_POR_MIN: num('RATE_LIMIT_PADRAO_POR_MIN', 60),
  SCHEDULER_ENABLED: process.env.SCHEDULER_ENABLED !== 'false',
  TZ_AGENDAMENTO: process.env.TZ_AGENDAMENTO || 'America/Sao_Paulo',
};
