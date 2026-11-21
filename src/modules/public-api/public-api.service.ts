import type { PrismaClient, StatusEquipamento } from '@prisma/client';
import { Papel } from '../../domain/Papel';
import type { Ator } from '../../shared/ator';
import { naoEncontrado } from '../../shared/http-errors';
import { calcularPaginacao, respostaPaginada, type Paginacao } from '../../shared/pagination';
import type { ApiKeyPrincipal } from '../auth/api-keys/api-key.service';
import { LoteService, type NovoEquipamento } from '../lote/lote.service';
import { PublicApiRepository } from './public-api.repository';

type Equip = {
  codigoBarrasInterno: string; posicao: number; tipo: string; marca: string | null; modelo: string | null;
  estadoFisico: string; status: string;
};

const equipamentoDto = (e: Equip) => ({
  codigoBarras: e.codigoBarrasInterno, posicao: e.posicao, tipo: e.tipo, marca: e.marca, modelo: e.modelo,
  estadoFisico: e.estadoFisico, status: e.status,
});

const loteDto = (
  l: { codigoLote: string; notaFiscal: string; transportadora: string; dataEntrada: Date; status: string },
  total: number, equipamentos?: Equip[],
) => ({
  codigoLote: l.codigoLote, notaFiscal: l.notaFiscal, transportadora: l.transportadora,
  dataEntrada: l.dataEntrada, status: l.status, totalEquipamentos: total,
  ...(equipamentos ? { equipamentos: equipamentos.map(equipamentoDto) } : {}),
});

export interface NovoLotePublico {
  codigoLote: string;
  notaFiscal: string;
  transportadora: string;
  dataEntrada?: string;
  equipamentos?: NovoEquipamento[];
}

export class PublicApiService {
  private lotes: LoteService;

  constructor(private repo: PublicApiRepository, prisma: PrismaClient) {
    this.lotes = new LoteService(prisma);
  }

  async listarLotes(p: ApiKeyPrincipal, pag: Paginacao, status?: StatusEquipamento) {
    const { data, total } = await this.repo.listarLotes(p.organizacaoId, calcularPaginacao(pag).skip, pag.limit, status);
    return respostaPaginada(data.map((l) => loteDto(l, l._count.equipamentos)), total, pag);
  }

  async buscarLote(p: ApiKeyPrincipal, codigoLote: string) {
    const lote = await this.repo.buscarLote(p.organizacaoId, codigoLote);
    if (!lote) throw naoEncontrado('Lote não encontrado');
    return loteDto(lote, lote.equipamentos.length, lote.equipamentos);
  }

  /**
   * Reaproveita o LoteService da AV2: valem TODAS as regras de lá (organização ativa e com contrato,
   * data de entrada não futura e com até 90 dias, código de barras = id, posição sequencial,
   * movimentação de cadastro com statusPara = recebido). O ator registrado é "api:<prefixo da chave>".
   */
  async criarLote(p: ApiKeyPrincipal, corpo: NovoLotePublico) {
    const org = await this.repo.organizacao(p.organizacaoId);
    if (!org) throw naoEncontrado('Organização da chave não encontrada');
    const ator: Ator = { usuarioId: p.id, login: `api:${p.prefixo}`, papel: Papel.OPERADOR_CADASTRO };
    const lote = await this.lotes.criar({ ...corpo, organizacaoCodigo: org.codigo }, ator);
    return loteDto(lote!, lote!.equipamentos.length, lote!.equipamentos);
  }

  async rastrear(p: ApiKeyPrincipal, codigoBarras: string) {
    const e = await this.repo.buscarRastreabilidade(p.organizacaoId, codigoBarras);
    if (!e) throw naoEncontrado('Equipamento não encontrado');
    return {
      ...equipamentoDto(e),
      lote: { codigoLote: e.lote.codigoLote, dataEntrada: e.lote.dataEntrada },
      historicoEstado: e.historicoEstado.map((h) => ({ de: h.de, para: h.para, justificativa: h.justificativa, em: h.em })),
      // O login interno de quem operou (ator) não é exposto a parceiros.
      movimentacoes: e.movimentacoes.map((m) => ({
        tipo: m.tipo, statusDe: m.statusDe, statusPara: m.statusPara, observacao: m.observacao, em: m.criadoEm,
      })),
    };
  }
}
