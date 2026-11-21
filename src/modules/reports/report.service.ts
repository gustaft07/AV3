import type { FormatoRelatorio, Prisma, TipoAnalise } from '@prisma/client';
import { env } from '../../config/env';
import { getFilaRelatorios } from '../../infra/filas';
import { HttpError, naoEncontrado } from '../../shared/http-errors';
import type { ApiKeyPrincipal } from '../auth/api-keys/api-key.service';
import { ReportRepository } from './report.repository';

export interface SolicitarRelatorio {
  tipo: TipoAnalise;
  formato?: FormatoRelatorio;
  parametros?: { limiar?: number; minAmostras?: number };
}

export class ReportService {
  constructor(private repo: ReportRepository) {}

  /** Publica a tarefa na fila e devolve na hora o identificador (padrão 202 Accepted). */
  async solicitar(p: ApiKeyPrincipal, s: SolicitarRelatorio) {
    if ((await this.repo.contarPendentes(p.organizacaoId)) >= env.MAX_TAREFAS_PENDENTES_POR_ORG) {
      throw new HttpError(429, 'Muitas tarefas pendentes; aguarde a conclusão das anteriores', 'LIMITE_TAREFAS_PENDENTES');
    }
    const tarefa = await this.repo.criar({
      apiKeyId: p.id, organizacaoId: p.organizacaoId, tipo: s.tipo, formato: s.formato ?? 'json',
      parametros: (s.parametros ?? {}) as Prisma.InputJsonObject,
    });
    try {
      await getFilaRelatorios().add('gerar-relatorio', { tarefaId: tarefa.id }, { jobId: tarefa.id });
    } catch {
      await this.repo.marcarFalha(tarefa.id, 'Fila indisponível no momento da solicitação', 0);
      throw new HttpError(503, 'Fila de processamento indisponível; tente novamente', 'FILA_INDISPONIVEL');
    }
    return this.dto(tarefa);
  }

  /** Só enxerga tarefas da própria organização (outra organização = 404, sem confirmar a existência). */
  async consultar(p: ApiKeyPrincipal, id: string) {
    const t = await this.repo.buscar(id);
    if (!t || t.organizacaoId !== p.organizacaoId) throw naoEncontrado('Tarefa não encontrada');
    return t;
  }

  dto(t: { id: string; tipo: string; formato: string; status: string; tentativas: number; criadoEm: Date; concluidaEm: Date | null; expiraEm: Date | null; erro: string | null }) {
    return {
      tarefaId: t.id, tipo: t.tipo, formato: t.formato, status: t.status, tentativas: t.tentativas,
      criadoEm: t.criadoEm, concluidaEm: t.concluidaEm, expiraEm: t.expiraEm, erro: t.erro,
      statusUrl: `/api/v1/public/tarefas/${t.id}`,
      ...(t.status === 'concluida' ? { resultadoUrl: `/api/v1/public/tarefas/${t.id}/resultado` } : {}),
    };
  }
}
