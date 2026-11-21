import { Prisma } from '@prisma/client';
import { ErroValidacao } from '../core/validation';
import { AppError } from './errors';
import { HttpError } from './http-errors';

export interface ErroPublico {
  status: number;
  codigo: string;
  mensagem: string;
  detalhes?: unknown;
}

const CODIGOS: Record<number, string> = {
  401: 'NAO_AUTENTICADO', 403: 'PROIBIDO', 404: 'NAO_ENCONTRADO', 409: 'CONFLITO',
};

/** Converte qualquer erro (domínio da AV1, AppError, Prisma, Ajv, rate-limit) no envelope estável da API pública. */
export function traduzirErro(err: any): ErroPublico {
  if (err instanceof HttpError) return { status: err.statusCode, codigo: err.code, mensagem: err.message, detalhes: err.details };
  if (err instanceof ErroValidacao) return { status: 422, codigo: 'REGRA_DE_NEGOCIO', mensagem: err.message };
  if (err instanceof AppError) return { status: err.statusCode, codigo: CODIGOS[err.statusCode] ?? 'ERRO', mensagem: err.message };
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return { status: 409, codigo: 'CONFLITO', mensagem: 'Já existe um registro com o mesmo valor único' };
    if (err.code === 'P2025') return { status: 404, codigo: 'NAO_ENCONTRADO', mensagem: 'Registro não encontrado' };
    if (err.code === 'P2003') return { status: 409, codigo: 'CONFLITO', mensagem: 'Operação viola um vínculo com outro registro' };
  }
  if (err?.validation) return { status: 400, codigo: 'REQUISICAO_INVALIDA', mensagem: 'Requisição inválida', detalhes: err.validation };
  if (err?.statusCode >= 400 && err.statusCode < 500) {
    return { status: err.statusCode, codigo: err.statusCode === 429 ? 'LIMITE_EXCEDIDO' : 'ERRO', mensagem: err.message };
  }
  return { status: 500, codigo: 'ERRO_INTERNO', mensagem: 'Erro interno do servidor' };
}
