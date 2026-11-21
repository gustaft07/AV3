import { PrismaClient } from '@prisma/client';
import { Worker } from 'bullmq';
import { env } from './config/env';
import { FILA_ANALISES, FILA_RELATORIOS, fecharFilas, getFilaAnalises } from './infra/filas';
import { redisOpcoes } from './infra/redis';
import { criarProcessadorAnalises } from './jobs/analises.processor';
import { registrarAgendamentos } from './jobs/schedule';
import { AnalyticsOrchestrator } from './modules/analytics/analytics.orchestrator';
import { aoFalharDefinitivamente, criarProcessadorRelatorio } from './modules/reports/report.processor';

/** Processo separado da API: `npm run worker`. Pode haver N instâncias em paralelo. */
async function main() {
  const prisma = new PrismaClient();
  const orq = new AnalyticsOrchestrator(prisma);

  const wRelatorios = new Worker(FILA_RELATORIOS, criarProcessadorRelatorio(prisma, orq), {
    connection: redisOpcoes('worker'),
    concurrency: env.WORKER_CONCURRENCY,
  });
  const wAnalises = new Worker(FILA_ANALISES, criarProcessadorAnalises(prisma, orq), {
    connection: redisOpcoes('worker'),
    concurrency: 1,
  });

  wRelatorios.on('failed', (job, err) => {
    if (!job) return;
    const definitivo = job.attemptsMade >= (job.opts.attempts ?? 1) || err.name === 'UnrecoverableError';
    console.error(`[relatorios] job ${job.id} falhou (tentativa ${job.attemptsMade}): ${err.message}`);
    if (definitivo) void aoFalharDefinitivamente(prisma, job, err).catch((e) => console.error(e));
  });
  wAnalises.on('failed', (job, err) => console.error(`[analises] job ${job?.name} falhou: ${err.message}`));
  wRelatorios.on('error', (e) => console.error('[relatorios] erro do worker:', e.message));
  wAnalises.on('error', (e) => console.error('[analises] erro do worker:', e.message));

  if (env.SCHEDULER_ENABLED) await registrarAgendamentos(getFilaAnalises());
  console.log(`Worker no ar (concorrência ${env.WORKER_CONCURRENCY}; agendamentos ${env.SCHEDULER_ENABLED ? 'ligados' : 'desligados'})`);

  const encerrar = async (sinal: string) => {
    console.log(`${sinal} recebido, finalizando jobs em andamento...`);
    const trava = setTimeout(() => process.exit(1), 15_000);
    trava.unref();
    await Promise.all([wRelatorios.close(), wAnalises.close()]);
    await fecharFilas();
    await prisma.$disconnect();
    process.exit(0);
  };
  // No Windows SIGINT (Ctrl+C) funciona; SIGTERM tem suporte limitado. Mantemos ambos, como no server.ts.
  process.on('SIGINT', () => void encerrar('SIGINT'));
  process.on('SIGTERM', () => void encerrar('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
