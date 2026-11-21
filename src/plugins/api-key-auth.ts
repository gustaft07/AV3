import type { EscopoApi } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiKeyRepository } from '../modules/auth/api-keys/api-key.repository';
import { ApiKeyService, type ApiKeyPrincipal } from '../modules/auth/api-keys/api-key.service';
import { HttpError } from '../shared/http-errors';

declare module 'fastify' {
  interface FastifyRequest {
    apiKey: ApiKeyPrincipal | null;
  }
}

/**
 * Registra, no contexto encapsulado da API pública, o hook que autentica TODA requisição pela chave
 * (cabeçalho X-API-Key). Deve ser chamado ANTES do rate-limit, que usa req.apiKey para identificar o cliente.
 */
export function registrarAutenticacaoApiKey(app: FastifyInstance) {
  const service = new ApiKeyService(new ApiKeyRepository(app.prisma));
  app.decorateRequest('apiKey', null);
  app.addHook('onRequest', async (req) => {
    const h = req.headers['x-api-key'];
    req.apiKey = await service.autenticar(Array.isArray(h) ? h[0] : h);
  });
}

/** Autorização por escopo: a chave precisa ter pelo menos um dos escopos informados. */
export function exigirEscopo(...escopos: EscopoApi[]) {
  return async (req: FastifyRequest): Promise<void> => {
    if (!req.apiKey) throw new HttpError(401, 'API Key ausente', 'API_KEY_AUSENTE');
    if (!escopos.some((e) => req.apiKey!.escopos.has(e))) {
      throw new HttpError(403, `Escopo necessário: ${escopos.join(' ou ')}`, 'ESCOPO_INSUFICIENTE');
    }
  };
}
