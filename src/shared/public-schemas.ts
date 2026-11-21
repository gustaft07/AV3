// Schemas reutilizados na documentação OpenAPI da API pública.
// Obs.: usamos "examples" (e não "example") porque o Ajv do Fastify roda em modo estrito.

export const ESTADOS_FISICOS = ['novo', 'seminovo', 'usado_bom', 'usado_regular', 'usado_ruim', 'sucata'];
export const STATUS_EQUIPAMENTO = [
  'recebido', 'triagem', 'triagem_completa', 'desmonte', 'reciclagem', 'descarte_seguro', 'revenda',
];
export const TIPOS_ANALISE = ['eficiencia_operacional', 'rentabilidade', 'vida_util'];
export const ESCOPOS_API = ['rastreabilidade_read', 'lotes_read', 'lotes_write', 'relatorios_read'];

export const securityApiKey = [{ apiKeyAuth: [] }];

const DESCRICAO_ERROS: Record<number, string> = {
  400: 'REQUISICAO_INVALIDA — parâmetros ou corpo fora do contrato.',
  401: 'API_KEY_AUSENTE | API_KEY_INVALIDA | API_KEY_REVOGADA | API_KEY_EXPIRADA.',
  403: 'ESCOPO_INSUFICIENTE | ORGANIZACAO_INATIVA — a chave não pode executar esta operação.',
  404: 'NAO_ENCONTRADO — recurso inexistente ou pertencente a outra organização.',
  409: 'CONFLITO | RESULTADO_INDISPONIVEL — conflito com o estado atual do recurso.',
  410: 'RESULTADO_EXPIRADO — o arquivo do relatório já foi removido.',
  422: 'REGRA_DE_NEGOCIO — violação de regra do domínio (ex.: organização sem contrato, data de entrada fora do prazo).',
  429: 'LIMITE_EXCEDIDO | LIMITE_TAREFAS_PENDENTES — respeite o cabeçalho Retry-After.',
  503: 'FILA_INDISPONIVEL — tente novamente em instantes.',
};

const erroSchema = {
  type: 'object',
  properties: {
    erro: {
      type: 'object',
      properties: {
        codigo: { type: 'string', examples: ['API_KEY_INVALIDA'] },
        mensagem: { type: 'string', examples: ['API Key inválida'] },
        detalhes: {},
      },
    },
    requestId: { type: 'string', examples: ['req-1a2b'] },
  },
};

export const respostasErro = (...codigos: number[]) =>
  Object.fromEntries(codigos.map((c) => [c, { description: DESCRICAO_ERROS[c], ...erroSchema }]));

export const equipamentoSchema = {
  type: 'object',
  properties: {
    codigoBarras: { type: 'string', description: 'Código de barras interno (UUID)' },
    posicao: { type: 'integer', examples: [1] },
    tipo: { type: 'string', examples: ['notebook'] },
    marca: { type: 'string', nullable: true, examples: ['Dell'] },
    modelo: { type: 'string', nullable: true, examples: ['Latitude 5420'] },
    estadoFisico: { type: 'string', enum: ESTADOS_FISICOS },
    status: { type: 'string', enum: STATUS_EQUIPAMENTO },
  },
};

export const loteSchema = {
  type: 'object',
  properties: {
    codigoLote: { type: 'string', examples: ['LOTE-2026-0001'] },
    notaFiscal: { type: 'string', examples: ['NF-12345'] },
    transportadora: { type: 'string', examples: ['Transportes Verde'] },
    dataEntrada: { type: 'string', format: 'date-time' },
    status: { type: 'string', enum: STATUS_EQUIPAMENTO },
    totalEquipamentos: { type: 'integer', examples: [12] },
    equipamentos: { type: 'array', items: equipamentoSchema },
  },
};
