import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import type { FastifyPluginAsync } from 'fastify';
import type { FormatoRelatorio, TipoAnalise } from '@prisma/client';
import { exigirEscopo } from '../../plugins/api-key-auth';
import { HttpError } from '../../shared/http-errors';
import { TIPOS_ANALISE, respostasErro, securityApiKey } from '../../shared/public-schemas';
import { ReportRepository } from './report.repository';
import { caminhoSeguro } from './report.processor';
import { ReportService } from './report.service';

const tarefaSchema = {
  type: 'object',
  properties: {
    tarefaId: { type: 'string', format: 'uuid' },
    tipo: { type: 'string', enum: TIPOS_ANALISE },
    formato: { type: 'string', enum: ['csv', 'json'] },
    status: { type: 'string', enum: ['aguardando', 'processando', 'concluida', 'falhou'] },
    tentativas: { type: 'integer' },
    criadoEm: { type: 'string', format: 'date-time' },
    concluidaEm: { type: 'string', format: 'date-time', nullable: true },
    expiraEm: { type: 'string', format: 'date-time', nullable: true },
    erro: { type: 'string', nullable: true },
    statusUrl: { type: 'string', examples: ['/api/v1/public/tarefas/3f6c...'] },
    resultadoUrl: { type: 'string', description: 'Presente apenas quando status = concluida' },
  },
};

const routes: FastifyPluginAsync = async (app) => {
  const repo = new ReportRepository(app.prisma);
  const service = new ReportService(repo);
  const escopo = exigirEscopo('relatorios_read');

  app.post<{ Body: { tipo: TipoAnalise; formato?: FormatoRelatorio; parametros?: { limiar?: number; minAmostras?: number } } }>(
    '/relatorios', {
      onRequest: [escopo],
      schema: {
        tags: ['Relatórios'], security: securityApiKey,
        summary: 'Solicita um relatório analítico (processamento assíncrono)',
        description:
          'Escopo: `relatorios_read`. Responde **202** na hora com o `tarefaId`; o relatório é gerado em segundo plano.\n\n' +
          '1. `POST /relatorios` → `tarefaId`\n2. `GET /tarefas/{id}` (polling) até `status = concluida` — ou receba o webhook\n3. `GET /tarefas/{id}/resultado` → arquivo CSV/JSON\n\n' +
          '```bash\ncurl -X POST -H "X-API-Key: gc_live_..." -H "Content-Type: application/json" \\\n  -d \'{"tipo":"vida_util","formato":"csv"}\' https://host/api/v1/public/relatorios\n```',
        body: {
          type: 'object', required: ['tipo'], additionalProperties: false,
          properties: {
            tipo: { type: 'string', enum: TIPOS_ANALISE, description: 'Categoria de análise' },
            formato: { type: 'string', enum: ['csv', 'json'], default: 'json' },
            parametros: {
              type: 'object', additionalProperties: false,
              description: 'Ajustes opcionais do modelo',
              properties: {
                limiar: { type: 'number', minimum: 0, maximum: 5, description: 'Nota abaixo da qual o equipamento é inservível (vida_util)' },
                minAmostras: { type: 'integer', minimum: 2, description: 'Amostras mínimas por grupo' },
              },
            },
          },
        },
        response: { 202: { description: 'Tarefa aceita', ...tarefaSchema }, ...respostasErro(400, 401, 403, 429, 503) },
      },
    }, async (req, reply) => {
      const dto = await service.solicitar(req.apiKey!, req.body);
      return reply.code(202).header('location', dto.statusUrl).send(dto);
    });

  app.get<{ Params: { id: string } }>('/tarefas/:id', {
    onRequest: [escopo],
    schema: {
      tags: ['Relatórios'], security: securityApiKey,
      summary: 'Consulta o status da tarefa (polling)',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      response: { 200: { description: 'Estado atual da tarefa', ...tarefaSchema }, ...respostasErro(401, 403, 404, 429) },
    },
  }, async (req) => service.dto(await service.consultar(req.apiKey!, req.params.id)));

  app.get<{ Params: { id: string } }>('/tarefas/:id/resultado', {
    onRequest: [escopo],
    schema: {
      tags: ['Relatórios'], security: securityApiKey,
      summary: 'Baixa o relatório pronto (CSV ou JSON)',
      description: 'Retorna **409** enquanto a tarefa não estiver concluída e **410** depois que o arquivo expirar.',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      response: { ...respostasErro(401, 403, 404, 409, 410, 429) },
    },
  }, async (req, reply) => {
    const t = await service.consultar(req.apiKey!, req.params.id);
    if (t.status !== 'concluida') {
      throw new HttpError(409, `Relatório ainda não disponível (status: ${t.status})`, 'RESULTADO_INDISPONIVEL');
    }
    if (!t.arquivo || (t.expiraEm && t.expiraEm < new Date())) {
      throw new HttpError(410, 'O arquivo deste relatório expirou; solicite novamente', 'RESULTADO_EXPIRADO');
    }
    const abs = caminhoSeguro(t.arquivo);
    try { await access(abs); } catch { throw new HttpError(410, 'O arquivo deste relatório não está mais disponível', 'RESULTADO_EXPIRADO'); }
    const mime = t.formato === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8';
    return reply
      .header('content-type', mime)
      .header('content-disposition', `attachment; filename="relatorio-${t.tipo}-${t.id}.${t.formato}"`)
      .send(createReadStream(abs));
  });
};

export default routes;
