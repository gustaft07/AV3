import { UnrecoverableError, type Job } from 'bullmq';
import type { PrismaClient, TipoAnalise } from '@prisma/client';
import { AvaliacaoService, type ParametrosAvaliacao } from '../modules/analytics/avaliacao.service';
import type { AnalyticsOrchestrator } from '../modules/analytics/analytics.orchestrator';
import { expurgarRelatoriosExpirados } from '../modules/reports/report.processor';

/** Worker da fila "analises": execuções disparadas pela API e os jobs recorrentes (agendamento). */
export function criarProcessadorAnalises(prisma: PrismaClient, orq: AnalyticsOrchestrator) {
  const avaliacao = new AvaliacaoService(prisma);

  return async (job: Job) => {
    switch (job.name) {
      case 'executar-analise': // disparo manual: a execução já foi criada pela API
        await orq.executar(job.data.execucaoId as string);
        return { execucaoId: job.data.execucaoId };

      case 'agendada': { // recorrente: visão global da base
        const execucaoId = await orq.iniciar(job.data.tipo as TipoAnalise, 'agendada', null);
        await orq.executar(execucaoId);
        return { execucaoId };
      }
      case 'avaliar-previsoes':
        return avaliacao.avaliar((job.data?.parametros ?? {}) as ParametrosAvaliacao);

      case 'expurgar-relatorios':
        return expurgarRelatoriosExpirados(prisma);

      default:
        throw new UnrecoverableError(`Job desconhecido: ${job.name}`);
    }
  };
}
