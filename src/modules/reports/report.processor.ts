import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { UnrecoverableError, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { stringify } from 'csv-stringify/sync';
import { env } from '../../config/env';
import { getFilaDlq } from '../../infra/filas';
import type { AnalyticsOrchestrator } from '../analytics/analytics.orchestrator';
import { ReportRepository } from './report.repository';
import { enviarWebhook } from './report.webhook';

export interface JobRelatorio { tarefaId: string }

/** Resolve um caminho relativo dentro de STORAGE_DIR, impedindo escapar da pasta (path traversal). */
export function caminhoSeguro(relativo: string): string {
  const abs = path.resolve(env.STORAGE_DIR, relativo);
  if (!abs.startsWith(env.STORAGE_DIR + path.sep)) throw new Error('Caminho de arquivo inválido');
  return abs;
}

export function criarProcessadorRelatorio(prisma: PrismaClient, orq: AnalyticsOrchestrator) {
  const repo = new ReportRepository(prisma);

  return async (job: Job<JobRelatorio>) => {
    const tarefa = await repo.buscar(job.data.tarefaId);
    if (!tarefa) throw new UnrecoverableError('Tarefa inexistente'); // retry não adianta
    if (tarefa.status === 'concluida') return { reaproveitada: true }; // idempotência

    await repo.marcarProcessando(tarefa.id, job.attemptsMade + 1);

    // Cada tentativa gera uma execução própria: o histórico mostra inclusive as que falharam.
    const execucaoId = await orq.iniciar(
      tarefa.tipo, 'api', tarefa.organizacaoId, (tarefa.parametros as Record<string, unknown> | null) ?? {},
    );
    await orq.executar(execucaoId);
    const { execucao, linhas } = await orq.resultados(execucaoId);

    let conteudo: string;
    if (tarefa.formato === 'csv') {
      // BOM + ";" para o Excel (Windows, localidade pt-BR) abrir as colunas corretamente
      conteudo = '\uFEFF' + stringify(linhas, { header: true, delimiter: ';' });
    } else {
      conteudo = JSON.stringify({
        tarefaId: tarefa.id, tipo: tarefa.tipo, geradoEm: new Date().toISOString(), execucaoId,
        avisos: execucao.avisos ?? [], total: linhas.length, dados: linhas,
      }, null, 2);
    }

    const relativo = path.join('reports', `${tarefa.id}.${tarefa.formato}`);
    const abs = caminhoSeguro(relativo);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, conteudo, 'utf8');

    const expiraEm = new Date(Date.now() + env.RELATORIO_TTL_DIAS * 86_400_000);
    const final = await repo.concluir(tarefa.id, relativo.split(path.sep).join('/'), expiraEm);

    if (final.apiKey?.webhookUrl) {
      await enviarWebhook(final.apiKey.webhookUrl, final.apiKey.webhookSegredo, {
        evento: 'relatorio.concluido', tarefaId: final.id, status: 'concluida',
        resultadoUrl: `${env.PUBLIC_BASE_URL}/api/v1/public/tarefas/${final.id}/resultado`,
      });
    }
    return { execucaoId, linhas: linhas.length };
  };
}

/** Chamado quando as tentativas se esgotam (ou o erro é irrecuperável): falha na tabela + DLQ + webhook. */
export async function aoFalharDefinitivamente(prisma: PrismaClient, job: Job<JobRelatorio>, err: Error) {
  const tarefaId = job.data?.tarefaId;
  if (!tarefaId) return;
  const repo = new ReportRepository(prisma);
  const t = await repo.marcarFalha(tarefaId, err.message, job.attemptsMade).catch(() => null);
  await getFilaDlq().add('falha-definitiva', {
    tarefaId, erro: err.message, tentativas: job.attemptsMade, falhouEm: new Date().toISOString(),
  });
  if (t?.apiKey?.webhookUrl) {
    await enviarWebhook(t.apiKey.webhookUrl, t.apiKey.webhookSegredo, {
      evento: 'relatorio.falhou', tarefaId, status: 'falhou', erro: 'Falha ao gerar o relatório',
    });
  }
}

/** Remove os arquivos vencidos (job agendado diariamente). */
export async function expurgarRelatoriosExpirados(prisma: PrismaClient) {
  const repo = new ReportRepository(prisma);
  const vencidos = await repo.expirados(new Date());
  let removidos = 0;
  for (const v of vencidos) {
    try {
      await unlink(caminhoSeguro(v.arquivo!));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') continue;
    }
    await repo.limparArquivo(v.id);
    removidos++;
  }
  return { removidos };
}
