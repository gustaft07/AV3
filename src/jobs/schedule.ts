import type { Queue } from 'bullmq';
import { env } from '../config/env';
import { OPCOES_ANALISES } from '../infra/filas';

/**
 * Agendamento via jobs recorrentes do BullMQ (job schedulers), no mesmo worker/Redis das filas.
 * Vantagem sobre node-cron: o agendamento vive no Redis, então com várias instâncias do worker
 * cada execução ocorre UMA vez (sem disparo duplicado) e falhas têm retry/histórico como qualquer job.
 * upsertJobScheduler é idempotente: reiniciar o worker não duplica agendamentos.
 */
const AGENDAMENTOS = [
  { id: 'analise-eficiencia', pattern: '0 2 * * *', name: 'agendada', data: { tipo: 'eficiencia_operacional' } },
  { id: 'analise-rentabilidade', pattern: '15 2 * * *', name: 'agendada', data: { tipo: 'rentabilidade' } },
  { id: 'analise-vida-util', pattern: '30 2 * * *', name: 'agendada', data: { tipo: 'vida_util' } },
  { id: 'avaliar-previsoes', pattern: '0 3 * * *', name: 'avaliar-previsoes', data: {} },
  { id: 'expurgo-relatorios', pattern: '0 4 * * *', name: 'expurgar-relatorios', data: {} },
] as const;

export async function registrarAgendamentos(fila: Queue) {
  for (const a of AGENDAMENTOS) {
    await fila.upsertJobScheduler(
      a.id,
      { pattern: a.pattern, tz: env.TZ_AGENDAMENTO },
      { name: a.name, data: a.data, opts: OPCOES_ANALISES },
    );
  }
}
