import type { PrismaClient, StatusEquipamento } from '@prisma/client';

/** Toda consulta é filtrada pela organização dona da chave: um parceiro nunca enxerga dados de outro. */
export class PublicApiRepository {
  constructor(private prisma: PrismaClient) {}

  organizacao(id: string) {
    return this.prisma.organizacao.findUnique({ where: { id }, select: { id: true, codigo: true } });
  }

  async listarLotes(organizacaoId: string, skip: number, take: number, status?: StatusEquipamento) {
    const where = { organizacaoId, ativo: true, ...(status ? { status } : {}) };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.lote.findMany({
        where, orderBy: { dataEntrada: 'desc' }, skip, take,
        include: { _count: { select: { equipamentos: true } } },
      }),
      this.prisma.lote.count({ where }),
    ]);
    return { data, total };
  }

  buscarLote(organizacaoId: string, codigoLote: string) {
    return this.prisma.lote.findFirst({
      where: { codigoLote, organizacaoId, ativo: true },
      include: { equipamentos: { orderBy: { posicao: 'asc' } } },
    });
  }

  buscarRastreabilidade(organizacaoId: string, codigoBarrasInterno: string) {
    return this.prisma.equipamento.findFirst({
      where: { codigoBarrasInterno, lote: { organizacaoId, ativo: true } },
      include: {
        lote: { select: { codigoLote: true, dataEntrada: true } },
        historicoEstado: { orderBy: { em: 'asc' } },
        movimentacoes: { orderBy: { criadoEm: 'asc' } },
      },
    });
  }
}
