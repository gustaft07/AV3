import type { StatusEquipamento } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { exigirEscopo } from '../../plugins/api-key-auth';
import { paginacaoQuery } from '../../shared/pagination';
import {
  ESTADOS_FISICOS, STATUS_EQUIPAMENTO, equipamentoSchema, loteSchema, respostasErro, securityApiKey,
} from '../../shared/public-schemas';
import { PublicApiRepository } from './public-api.repository';
import { PublicApiService, type NovoLotePublico } from './public-api.service';

const routes: FastifyPluginAsync = async (app) => {
  const service = new PublicApiService(new PublicApiRepository(app.prisma), app.prisma);

  app.get<{ Querystring: { page: number; limit: number; status?: StatusEquipamento } }>('/lotes', {
    onRequest: [exigirEscopo('lotes_read', 'lotes_write')],
    schema: {
      tags: ['Lotes'], security: securityApiKey,
      summary: 'Lista os lotes da sua organização (paginado)',
      description: 'Escopo: `lotes_read` ou `lotes_write`. Resposta paginada: `{ data, total, page, limit, totalPages }`.\n\n```bash\ncurl -H "X-API-Key: gc_live_..." "https://host/api/v1/public/lotes?page=1&limit=20"\n```',
      querystring: {
        type: 'object',
        properties: {
          ...paginacaoQuery, // page (começa em 1) e limit (máx. 100), como no restante da API
          status: { type: 'string', enum: STATUS_EQUIPAMENTO, description: 'Filtra pelo status do lote' },
        },
      },
      response: {
        200: {
          description: 'Página de lotes',
          type: 'object',
          properties: {
            data: { type: 'array', items: loteSchema },
            total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' }, totalPages: { type: 'integer' },
          },
        },
        ...respostasErro(400, 401, 403, 429),
      },
    },
  }, async (req) => service.listarLotes(req.apiKey!, req.query, req.query.status));

  app.get<{ Params: { codigoLote: string } }>('/lotes/:codigoLote', {
    onRequest: [exigirEscopo('lotes_read', 'lotes_write')],
    schema: {
      tags: ['Lotes'], security: securityApiKey,
      summary: 'Detalha um lote e seus equipamentos',
      params: { type: 'object', properties: { codigoLote: { type: 'string', description: 'Código do lote', examples: ['LOTE-2026-0001'] } } },
      response: { 200: { description: 'Lote com equipamentos', ...loteSchema }, ...respostasErro(401, 403, 404, 429) },
    },
  }, async (req) => service.buscarLote(req.apiKey!, req.params.codigoLote));

  app.post<{ Body: NovoLotePublico }>('/lotes', {
    onRequest: [exigirEscopo('lotes_write')],
    schema: {
      tags: ['Lotes'], security: securityApiKey,
      summary: 'Registra um novo lote (com seus equipamentos) na sua organização',
      description: 'Escopo: `lotes_write`. Valem as regras de negócio do greencode: organização ativa **com contrato**, `dataEntrada` não futura e com até 90 dias (violação → **422**). Os equipamentos entram com status `recebido`; código de barras e posição são gerados pelo sistema.\n\n```json\n{\n  "codigoLote": "LOTE-2026-0001",\n  "notaFiscal": "NF-12345",\n  "transportadora": "Transportes Verde",\n  "dataEntrada": "2026-11-10T09:00:00Z",\n  "equipamentos": [{ "tipo": "notebook", "estadoFisico": "usado_bom", "marca": "Dell", "modelo": "Latitude 5420" }]\n}\n```',
      body: {
        type: 'object', required: ['codigoLote', 'notaFiscal', 'transportadora'], additionalProperties: false,
        properties: {
          codigoLote: { type: 'string', minLength: 3, maxLength: 60, description: 'Identificador único do lote', examples: ['LOTE-2026-0001'] },
          notaFiscal: { type: 'string', minLength: 1, maxLength: 60, examples: ['NF-12345'] },
          transportadora: { type: 'string', minLength: 1, maxLength: 120, examples: ['Transportes Verde'] },
          dataEntrada: { type: 'string', format: 'date-time', description: 'ISO 8601; opcional (padrão: agora)', examples: ['2026-11-10T09:00:00Z'] },
          equipamentos: {
            type: 'array', maxItems: 500,
            items: {
              type: 'object', required: ['tipo', 'estadoFisico'], additionalProperties: false,
              properties: {
                tipo: { type: 'string', minLength: 1, maxLength: 60, examples: ['notebook'] },
                estadoFisico: { type: 'string', enum: ESTADOS_FISICOS },
                marca: { type: 'string', maxLength: 100, examples: ['Dell'] },
                modelo: { type: 'string', maxLength: 100, examples: ['Latitude 5420'] },
              },
            },
          },
        },
      },
      response: { 201: { description: 'Lote criado', ...loteSchema }, ...respostasErro(400, 401, 403, 409, 422, 429) },
    },
  }, async (req, reply) => reply.code(201).send(await service.criarLote(req.apiKey!, req.body)));

  app.get<{ Params: { codigoBarras: string } }>('/rastreabilidade/:codigoBarras', {
    onRequest: [exigirEscopo('rastreabilidade_read')],
    schema: {
      tags: ['Rastreabilidade'], security: securityApiKey,
      summary: 'Histórico completo de um equipamento (estados e movimentações)',
      description: 'Escopo: `rastreabilidade_read`.',
      params: { type: 'object', properties: { codigoBarras: { type: 'string', description: 'Código de barras interno do equipamento' } } },
      response: {
        200: {
          description: 'Equipamento com histórico',
          type: 'object',
          properties: {
            ...equipamentoSchema.properties,
            lote: { type: 'object', properties: { codigoLote: { type: 'string' }, dataEntrada: { type: 'string', format: 'date-time' } } },
            historicoEstado: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  de: { type: 'string', enum: ESTADOS_FISICOS }, para: { type: 'string', enum: ESTADOS_FISICOS },
                  justificativa: { type: 'string', nullable: true }, em: { type: 'string', format: 'date-time' },
                },
              },
            },
            movimentacoes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  tipo: { type: 'string', examples: ['alteracao_status'] },
                  statusDe: { type: 'string', nullable: true }, statusPara: { type: 'string', nullable: true },
                  observacao: { type: 'string', nullable: true }, em: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        ...respostasErro(401, 403, 404, 429),
      },
    },
  }, async (req) => service.rastrear(req.apiKey!, req.params.codigoBarras));
};

export default routes;
