import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyPluginAsync } from 'fastify';
import apiKeyRoutes from '../modules/auth/api-keys/api-key.routes';
import authRoutes from '../modules/auth/auth.routes';
import { analyticsAdminRoutes, analyticsInternalRoutes } from '../modules/analytics/analytics.routes';
import equipamentoRoutes from '../modules/equipamento/equipamento.routes';
import loteRoutes from '../modules/lote/lote.routes';
import movimentacaoRoutes from '../modules/movimentacao/movimentacao.routes';
import organizacaoRoutes from '../modules/organizacao/organizacao.routes';
import relatoriosRoutes from '../modules/relatorios/relatorios.routes';
import usuarioRoutes from '../modules/usuario/usuario.routes';

export const PREFIXO_INTERNO = '/api/v1/internal';
export const PREFIXO_ADMIN = '/api/v1/admin';

/** Rotas consumidas pelo front-end (JWT) e pela gestão. Documentação em /docs (separada da pública). */
const apiInterna: FastifyPluginAsync = async (app) => {
  // A documentação precisa ser registrada ANTES das rotas para que elas sejam capturadas.
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'greencode API (interna e administrativa)',
        description: 'Uso do front-end e da equipe de gestão (AV2 + análises da AV3). A API de parceiros está em /api/v1/public/docs.',
        version: '3.0.0',
      },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      tags: [
        { name: 'Auth' }, { name: 'Usuários' }, { name: 'Organizações' }, { name: 'Lotes' },
        { name: 'Equipamentos' }, { name: 'Movimentações' }, { name: 'Relatórios' },
        { name: 'Análises' }, { name: 'API Keys' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // /api/v1/internal — front-end autenticado por JWT
  await app.register(async (internal) => {
    await internal.register(authRoutes);
    await internal.register(organizacaoRoutes);
    await internal.register(loteRoutes);
    await internal.register(equipamentoRoutes);
    await internal.register(movimentacaoRoutes);
    await internal.register(relatoriosRoutes);
    await internal.register(analyticsInternalRoutes);
  }, { prefix: PREFIXO_INTERNO });

  // /api/v1/admin — gestão de acessos e da camada analítica (usuários, chaves de API, disparo de análises)
  await app.register(async (admin) => {
    await admin.register(usuarioRoutes);
    await admin.register(apiKeyRoutes);
    await admin.register(analyticsAdminRoutes);
  }, { prefix: PREFIXO_ADMIN });
};

export default apiInterna;
