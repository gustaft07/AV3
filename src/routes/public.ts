import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import { env } from '../config/env';
import { criarClienteRedis } from '../infra/redis';
import publicApiRoutes from '../modules/public-api/public-api.routes';
import reportRoutes from '../modules/reports/report.routes';
import { registrarAutenticacaoApiKey } from '../plugins/api-key-auth';
import { HttpError } from '../shared/http-errors';
import { traduzirErro } from '../shared/public-error';

export const PREFIXO_PUBLICO = '/api/v1/public';

/**
 * API pública (v1), totalmente encapsulada: documentação própria, autenticação por API Key,
 * rate limit por cliente e formato de erro estável. Nada daqui vaza para as rotas internas/admin.
 */
const apiPublica: FastifyPluginAsync = async (app) => {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'greencode API Pública',
        version: '1.0.0',
        description:
          'Integração de parceiros com o greencode: rastreabilidade, lotes e relatórios analíticos.\n\n' +
          '**Autenticação:** envie sua chave no cabeçalho `X-API-Key`. Cada chave tem escopos e limite de requisições por minuto ' +
          '(cabeçalhos `X-RateLimit-*`; ao exceder, `429` com `Retry-After`).\n\n' +
          '**Versionamento:** a versão faz parte da URL (`/api/v1/public`). Mudanças incompatíveis só chegam em `/v2`, ' +
          'com a v1 mantida em depreciação gradual.\n\n' +
          '**Erros:** sempre `{ "erro": { "codigo", "mensagem", "detalhes" }, "requestId" }`.',
      },
      servers: [{ url: '/' }],
      components: { securitySchemes: { apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } },
      tags: [
        { name: 'Lotes', description: 'Consulta e registro de lotes (escopos lotes_read / lotes_write)' },
        { name: 'Rastreabilidade', description: 'Histórico de equipamentos (escopo rastreabilidade_read)' },
        { name: 'Relatórios', description: 'Relatórios analíticos assíncronos (escopo relatorios_read)' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: `${PREFIXO_PUBLICO}/docs` });

  await app.register(async (api) => {
    // Formato de erro único da API pública: { erro: { codigo, mensagem, detalhes }, requestId }
    api.setErrorHandler((err, req, reply) => {
      const e = traduzirErro(err);
      if (e.status >= 500) req.log.error(err);
      return reply.code(e.status).send({
        erro: { codigo: e.codigo, mensagem: e.mensagem, detalhes: e.detalhes }, requestId: req.id,
      });
    });

    // ORDEM IMPORTA: primeiro a autenticação (define req.apiKey), depois o rate limit (usa req.apiKey).
    registrarAutenticacaoApiKey(api);

    const redis = criarClienteRedis('cache');
    redis.on('error', () => undefined); // Redis fora: skipOnError libera a requisição (fail-open) em vez de derrubar a API
    api.addHook('onClose', async () => { redis.disconnect(); });

    await api.register(rateLimit, {
      global: true,
      max: (req) => req.apiKey?.limiteReqPorMinuto ?? env.RATE_LIMIT_PADRAO_POR_MIN,
      timeWindow: '1 minute',
      keyGenerator: (req) => req.apiKey?.id ?? req.ip, // limite POR CLIENTE (chave), não por IP
      redis, // contadores compartilhados entre instâncias da API
      nameSpace: 'gc:rl:',
      skipOnError: true,
      errorResponseBuilder: (_req, ctx) =>
        new HttpError(429, `Limite de requisições excedido. Tente novamente em ${ctx.after}.`, 'LIMITE_EXCEDIDO'),
    });

    await api.register(publicApiRoutes);
    await api.register(reportRoutes);
  }, { prefix: PREFIXO_PUBLICO });
};

export default apiPublica;
