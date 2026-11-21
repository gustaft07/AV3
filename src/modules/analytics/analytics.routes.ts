import type { FastifyPluginAsync } from 'fastify';
import { getFilaAnalises } from '../../infra/filas';
import { authorize } from '../../shared/authorize';
import { PERMISSOES } from '../../shared/permissoes';
import { HttpError } from '../../shared/http-errors';
import { ESTADOS_FISICOS, TIPOS_ANALISE } from '../../shared/public-schemas';
import { seguranca } from '../../shared/schemas';
import { AnalyticsOrchestrator } from './analytics.orchestrator';
import type { EstadoFisico, TipoAnalise } from '@prisma/client';

const tipoParam = {
  type: 'object',
  required: ['tipo'],
  properties: { tipo: { type: 'string', enum: TIPOS_ANALISE } },
};

/** Consulta de resultados e histórico: admin, gestor de almoxarifado e auditor (prefixo /api/v1/internal). */
export const analyticsInternalRoutes: FastifyPluginAsync = async (app) => {
  const orq = new AnalyticsOrchestrator(app.prisma);
  const leitura = [app.authenticate, authorize(PERMISSOES.lerAnalises)];

  app.get<{ Querystring: { tipo?: TipoAnalise; limite?: number } }>('/analises/execucoes', {
    onRequest: leitura,
    schema: {
      tags: ['Análises'], summary: 'Histórico de execuções das análises', security: seguranca,
      querystring: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: TIPOS_ANALISE },
          limite: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
  }, async (req) => app.prisma.analiseExecucao.findMany({
    where: req.query.tipo ? { tipo: req.query.tipo } : {},
    orderBy: { iniciadaEm: 'desc' }, take: req.query.limite ?? 20,
  }));

  app.get<{ Params: { id: string } }>('/analises/execucoes/:id', {
    onRequest: leitura,
    schema: {
      tags: ['Análises'], summary: 'Uma execução com seus resultados', security: seguranca,
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, async (req) => orq.resultados(req.params.id));

  app.get<{ Params: { tipo: TipoAnalise }; Querystring: { organizacaoId?: string } }>('/analises/:tipo/ultima', {
    onRequest: leitura,
    schema: {
      tags: ['Análises'], summary: 'Resultado da última execução concluída do tipo', security: seguranca,
      params: tipoParam,
      querystring: { type: 'object', properties: { organizacaoId: { type: 'string', format: 'uuid' } } },
    },
  }, async (req) => {
    const exec = await app.prisma.analiseExecucao.findFirst({
      where: { tipo: req.params.tipo, status: 'concluida', organizacaoId: req.query.organizacaoId ?? null },
      orderBy: { iniciadaEm: 'desc' },
    });
    if (!exec) throw new HttpError(404, 'Nenhuma execução concluída para este tipo', 'NAO_ENCONTRADO');
    return orq.resultados(exec.id);
  });

  app.get<{ Querystring: { tipo?: string; limite?: number } }>('/analises/previsoes/avaliacoes', {
    onRequest: leitura,
    schema: {
      tags: ['Análises'], summary: 'Previsões de vida útil já comparadas com o realizado (erro MAE e viés)',
      security: seguranca,
      querystring: {
        type: 'object',
        properties: { tipo: { type: 'string' }, limite: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
      },
    },
  }, async (req) => {
    const rows = await app.prisma.avaliacaoPrevisao.findMany({
      where: req.query.tipo ? { previsao: { tipo: req.query.tipo.toLowerCase() } } : {},
      orderBy: { avaliadaEm: 'desc' }, take: req.query.limite ?? 50,
      include: { previsao: { select: { tipo: true, metodo: true, vidaRestanteDias: true, inservivelPrevistoEm: true, execucaoId: true } } },
    });
    return rows;
  });
};

/** Disparo manual, avaliação e tabela de valores de referência (prefixo /api/v1/admin). */
export const analyticsAdminRoutes: FastifyPluginAsync = async (app) => {
  const orq = new AnalyticsOrchestrator(app.prisma);
  const gestao = [app.authenticate, authorize(PERMISSOES.gerirAnalises)];
  const leituraAdmin = [app.authenticate, authorize(PERMISSOES.lerAnalises)];

  app.post<{ Params: { tipo: TipoAnalise }; Body: { organizacaoId?: string; parametros?: Record<string, unknown> } }>(
    '/analises/:tipo/executar', {
      onRequest: gestao,
      schema: {
        tags: ['Análises'], security: seguranca,
        summary: 'Dispara uma análise em segundo plano (202 + execucaoId)',
        params: tipoParam,
        body: {
          type: 'object', additionalProperties: false,
          properties: {
            organizacaoId: { type: 'string', format: 'uuid', description: 'Omita para a visão global' },
            parametros: {
              type: 'object', additionalProperties: false,
              properties: {
                limiar: { type: 'number', minimum: 0, maximum: 5 },
                minAmostras: { type: 'integer', minimum: 2 },
              },
            },
          },
        },
      },
    }, async (req, reply) => {
      const execucaoId = await orq.iniciar(req.params.tipo, 'manual', req.body?.organizacaoId ?? null, req.body?.parametros ?? {});
      await getFilaAnalises().add('executar-analise', { execucaoId });
      return reply.code(202).send({ execucaoId, status: 'processando' });
    });

  app.post<{ Body: { diasMinimos?: number; minAmostras?: number } }>('/analises/avaliar-previsoes', {
    onRequest: gestao,
    schema: {
      tags: ['Análises'], security: seguranca,
      summary: 'Compara previsões antigas com o realizado (roda também diariamente, de forma agendada)',
      body: {
        type: 'object', additionalProperties: false,
        properties: { diasMinimos: { type: 'integer', minimum: 0 }, minAmostras: { type: 'integer', minimum: 1 } },
      },
    },
  }, async (req, reply) => {
    const job = await getFilaAnalises().add('avaliar-previsoes', { parametros: req.body ?? {} });
    return reply.code(202).send({ jobId: job.id });
  });

  app.put<{ Body: { tipo: string; marca?: string; modelo?: string; estadoFisico: string; valor: number } }>(
    '/valores-recuperacao', {
      onRequest: [app.authenticate, authorize(PERMISSOES.gerirValoresReferencia)],
      schema: {
        tags: ['Análises'], security: seguranca,
        summary: 'Cria/atualiza o valor de referência de recuperação (tipo, marca, modelo, estado físico)',
        body: {
          type: 'object', required: ['tipo', 'estadoFisico', 'valor'], additionalProperties: false,
          properties: {
            tipo: { type: 'string', minLength: 1 }, marca: { type: 'string' }, modelo: { type: 'string' },
            estadoFisico: { type: 'string', enum: ESTADOS_FISICOS }, valor: { type: 'number', minimum: 0 },
          },
        },
      },
    }, async (req) => {
      const tipo = req.body.tipo.trim().toLowerCase();
      const marca = (req.body.marca ?? '').trim().toLowerCase();
      const modelo = (req.body.modelo ?? '').trim().toLowerCase();
      const estadoFisico = req.body.estadoFisico as EstadoFisico;
      return app.prisma.valorReferenciaRecuperacao.upsert({
        where: { tipo_marca_modelo_estadoFisico: { tipo, marca, modelo, estadoFisico } },
        create: { tipo, marca, modelo, estadoFisico, valor: req.body.valor },
        update: { valor: req.body.valor },
      });
    });

  app.get('/valores-recuperacao', {
    onRequest: leituraAdmin,
    schema: { tags: ['Análises'], summary: 'Lista a tabela de valores de referência', security: seguranca },
  }, async () => app.prisma.valorReferenciaRecuperacao.findMany({ orderBy: [{ tipo: 'asc' }, { marca: 'asc' }, { modelo: 'asc' }] }));
};
