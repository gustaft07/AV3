import Fastify from 'fastify';
import { fecharFilas } from './infra/filas';
import prismaPlugin from './plugins/prisma';
import jwtPlugin from './plugins/jwt';
import errorHandler from './plugins/error-handler';
import apiInterna from './routes/internal';
import apiPublica from './routes/public';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(errorHandler);

  // DELETE/PATCH sem corpo (inativar, reativar, excluir) costumam chegar com "content-type: application/json"
  // vindo de clientes e scripts de teste; o Fastify responderia 400 (corpo vazio). Descartamos o header nesse caso.
  app.addHook('onRequest', async (req) => {
    const tamanho = req.headers['content-length'];
    const semCorpo = tamanho === '0' || (tamanho === undefined && !req.headers['transfer-encoding']);
    if (req.headers['content-type'] && semCorpo) delete req.headers['content-type'];
  });

  await app.register(prismaPlugin);
  await app.register(jwtPlugin);
  app.addHook('onClose', async () => { await fecharFilas(); });

  app.get('/health', { schema: { hide: true } }, async () => ({ status: 'ok' }));

  // Dois contextos isolados, cada um com sua documentação OpenAPI:
  await app.register(apiInterna); // /api/v1/internal e /api/v1/admin   (docs em /docs)
  await app.register(apiPublica); // /api/v1/public                      (docs em /api/v1/public/docs)

  return app;
}
