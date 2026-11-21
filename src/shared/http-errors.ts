import { AppError } from './errors';

/**
 * Erro HTTP com código de negócio estável (usado principalmente pela API pública).
 * Estende o AppError da AV2: o error-handler global já responde com `statusCode` e `message`;
 * a API pública usa também `code` e `details` (ver shared/public-error.ts).
 */
export class HttpError extends AppError {
  constructor(
    statusCode: number,
    message: string,
    public readonly code: string = 'ERRO',
    public readonly details?: unknown,
  ) {
    super(message, statusCode);
  }
}

export const naoEncontrado = (msg = 'Recurso não encontrado') => new HttpError(404, msg, 'NAO_ENCONTRADO');
