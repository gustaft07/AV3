import type { EscopoApi } from '@prisma/client';
import { env } from '../../../config/env';
import { HttpError } from '../../../shared/http-errors';
import { extrairPrefixo, gerarChave, gerarSegredoWebhook, hashChave, hashesIguais } from './api-key.crypto';
import { ApiKeyRepository } from './api-key.repository';

export interface ApiKeyPrincipal {
  id: string;
  nome: string;
  prefixo: string;
  organizacaoId: string;
  escopos: Set<EscopoApi>;
  limiteReqPorMinuto: number;
  webhookUrl: string | null;
  webhookSegredo: string | null;
}

export interface CriarApiKeyInput {
  nome: string;
  organizacaoId: string;
  escopos: EscopoApi[];
  limiteReqPorMinuto?: number;
  expiraEm?: string;
  webhookUrl?: string;
}

type Registro = NonNullable<Awaited<ReturnType<ApiKeyRepository['buscarPorId']>>>;

/** Nunca devolve hashChave nem webhookSegredo. */
function publico(r: Registro) {
  return {
    id: r.id,
    nome: r.nome,
    prefixo: r.prefixo,
    organizacaoId: r.organizacaoId,
    escopos: r.escopos.map((e) => e.escopo),
    limiteReqPorMinuto: r.limiteReqPorMinuto,
    ativa: r.ativa,
    criadoEm: r.criadoEm,
    expiraEm: r.expiraEm,
    revogadaEm: r.revogadaEm,
    ultimoUsoEm: r.ultimoUsoEm,
    webhookUrl: r.webhookUrl,
  };
}

const invalida = () => new HttpError(401, 'API Key inválida', 'API_KEY_INVALIDA');

export class ApiKeyService {
  private ultimoRegistroDeUso = new Map<string, number>();

  constructor(private repo: ApiKeyRepository) {}

  /** Gera a chave. O valor completo só é devolvido nesta resposta; depois só existe o hash. */
  async criar(input: CriarApiKeyInput) {
    if (!(await this.repo.organizacaoAtiva(input.organizacaoId))) {
      throw new HttpError(404, 'Organização não encontrada ou inativa', 'NAO_ENCONTRADO');
    }
    if (input.webhookUrl) this.validarWebhook(input.webhookUrl);

    const { chave, prefixo, hash } = gerarChave();
    const webhookSegredo = input.webhookUrl ? gerarSegredoWebhook() : null;
    const registro = await this.repo.criar({
      nome: input.nome,
      organizacaoId: input.organizacaoId,
      prefixo,
      hashChave: hash,
      escopos: [...new Set(input.escopos)],
      limiteReqPorMinuto: input.limiteReqPorMinuto ?? env.RATE_LIMIT_PADRAO_POR_MIN,
      expiraEm: input.expiraEm ? new Date(input.expiraEm) : null,
      webhookUrl: input.webhookUrl ?? null,
      webhookSegredo,
    });
    return { ...publico(registro), chave, ...(webhookSegredo ? { webhookSegredo } : {}) };
  }

  async listar(organizacaoId?: string) {
    return (await this.repo.listar(organizacaoId)).map(publico);
  }

  async revogar(id: string) {
    const atual = await this.repo.buscarPorId(id);
    if (!atual) throw new HttpError(404, 'API Key não encontrada', 'NAO_ENCONTRADO');
    if (atual.ativa) await this.repo.revogar(id);
  }

  /** Revoga a chave atual e emite outra com os mesmos escopos e limites. */
  async rotacionar(id: string) {
    const atual = await this.repo.buscarPorId(id);
    if (!atual || !atual.ativa) {
      throw new HttpError(404, 'API Key não encontrada ou já revogada', 'NAO_ENCONTRADO');
    }
    await this.repo.revogar(id);
    return this.criar({
      nome: atual.nome,
      organizacaoId: atual.organizacaoId,
      escopos: atual.escopos.map((e) => e.escopo),
      limiteReqPorMinuto: atual.limiteReqPorMinuto,
      expiraEm: atual.expiraEm?.toISOString(),
      webhookUrl: atual.webhookUrl ?? undefined,
    });
  }

  /** Valida a chave recebida no cabeçalho X-API-Key e devolve o "principal" da requisição. */
  async autenticar(chaveBruta: string | undefined): Promise<ApiKeyPrincipal> {
    if (!chaveBruta) throw new HttpError(401, 'Informe a API Key no cabeçalho X-API-Key', 'API_KEY_AUSENTE');

    const prefixo = extrairPrefixo(chaveBruta);
    if (!prefixo) throw invalida();
    const reg = await this.repo.buscarPorPrefixo(prefixo);
    if (!reg || !hashesIguais(reg.hashChave, hashChave(chaveBruta))) throw invalida();

    if (!reg.ativa || reg.revogadaEm) throw new HttpError(401, 'API Key revogada', 'API_KEY_REVOGADA');
    if (reg.expiraEm && reg.expiraEm.getTime() < Date.now()) {
      throw new HttpError(401, 'API Key expirada', 'API_KEY_EXPIRADA');
    }
    if (!reg.organizacao.ativo) throw new HttpError(403, 'Organização inativa', 'ORGANIZACAO_INATIVA');

    // Atualiza "último uso" no máximo 1x por minuto por chave, sem atrasar a resposta.
    const agora = Date.now();
    if (agora - (this.ultimoRegistroDeUso.get(reg.id) ?? 0) > 60_000) {
      this.ultimoRegistroDeUso.set(reg.id, agora);
      void this.repo.registrarUso(reg.id).catch(() => undefined);
    }

    return {
      id: reg.id,
      nome: reg.nome,
      prefixo: reg.prefixo,
      organizacaoId: reg.organizacaoId,
      escopos: new Set(reg.escopos.map((e) => e.escopo)),
      limiteReqPorMinuto: reg.limiteReqPorMinuto,
      webhookUrl: reg.webhookUrl,
      webhookSegredo: reg.webhookSegredo,
    };
  }

  private validarWebhook(url: string) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new HttpError(400, 'webhookUrl inválida', 'REQUISICAO_INVALIDA');
    }
    if (u.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
      throw new HttpError(400, 'Em produção o webhook deve usar https', 'REQUISICAO_INVALIDA');
    }
  }
}
