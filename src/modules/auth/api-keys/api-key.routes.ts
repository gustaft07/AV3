import type { FastifyPluginAsync } from 'fastify';
import { authorize } from '../../../shared/authorize';
import { PERMISSOES } from '../../../shared/permissoes';
import { ESCOPOS_API } from '../../../shared/public-schemas';
import { seguranca } from '../../../shared/schemas';
import { ApiKeyRepository } from './api-key.repository';
import { ApiKeyService, type CriarApiKeyInput } from './api-key.service';

/** Rotas administrativas (JWT + papel admin) para gerar e gerenciar chaves de parceiros. */
const routes: FastifyPluginAsync = async (app) => {
  const service = new ApiKeyService(new ApiKeyRepository(app.prisma));
  const guarda = [app.authenticate, authorize(PERMISSOES.gerirApiKeys)];

  app.post<{ Body: CriarApiKeyInput }>('/api-keys', {
    onRequest: guarda,
    schema: {
      tags: ['API Keys'],
      summary: 'Gera uma API Key para um parceiro (o valor completo só aparece nesta resposta)',
      security: seguranca,
      body: {
        type: 'object',
        required: ['nome', 'organizacaoId', 'escopos'],
        additionalProperties: false,
        properties: {
          nome: { type: 'string', minLength: 3, maxLength: 120 },
          organizacaoId: { type: 'string', format: 'uuid' },
          escopos: { type: 'array', minItems: 1, items: { type: 'string', enum: ESCOPOS_API } },
          limiteReqPorMinuto: { type: 'integer', minimum: 1, maximum: 10_000 },
          expiraEm: { type: 'string', format: 'date-time' },
          webhookUrl: { type: 'string', format: 'uri', maxLength: 500 },
        },
      },
    },
  }, async (req, reply) => reply.code(201).send(await service.criar(req.body)));

  app.get<{ Querystring: { organizacaoId?: string } }>('/api-keys', {
    onRequest: guarda,
    schema: {
      tags: ['API Keys'],
      summary: 'Lista as chaves (sem o segredo)',
      security: seguranca,
      querystring: { type: 'object', properties: { organizacaoId: { type: 'string', format: 'uuid' } } },
    },
  }, async (req) => service.listar(req.query.organizacaoId));

  app.delete<{ Params: { id: string } }>('/api-keys/:id', {
    onRequest: guarda,
    schema: {
      tags: ['API Keys'],
      summary: 'Revoga uma chave imediatamente',
      security: seguranca,
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, async (req, reply) => {
    await service.revogar(req.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api-keys/:id/rotacionar', {
    onRequest: guarda,
    schema: {
      tags: ['API Keys'],
      summary: 'Revoga a chave e emite uma nova com os mesmos escopos e limites',
      security: seguranca,
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, async (req, reply) => reply.code(201).send(await service.rotacionar(req.params.id)));
};

export default routes;
