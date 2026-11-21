import type { EscopoApi, PrismaClient } from '@prisma/client';

export interface NovaApiKey {
  nome: string;
  organizacaoId: string;
  prefixo: string;
  hashChave: string;
  escopos: EscopoApi[];
  limiteReqPorMinuto: number;
  expiraEm: Date | null;
  webhookUrl: string | null;
  webhookSegredo: string | null;
}

export class ApiKeyRepository {
  constructor(private prisma: PrismaClient) {}

  organizacaoAtiva(id: string) {
    return this.prisma.organizacao.findFirst({ where: { id, ativo: true }, select: { id: true } });
  }

  criar(d: NovaApiKey) {
    const { escopos, ...resto } = d;
    return this.prisma.apiKey.create({
      data: { ...resto, escopos: { create: escopos.map((escopo) => ({ escopo })) } },
      include: { escopos: true },
    });
  }

  buscarPorPrefixo(prefixo: string) {
    return this.prisma.apiKey.findUnique({
      where: { prefixo },
      include: { escopos: true, organizacao: { select: { ativo: true } } },
    });
  }

  buscarPorId(id: string) {
    return this.prisma.apiKey.findUnique({ where: { id }, include: { escopos: true } });
  }

  listar(organizacaoId?: string) {
    return this.prisma.apiKey.findMany({
      where: organizacaoId ? { organizacaoId } : {},
      include: { escopos: true },
      orderBy: { criadoEm: 'desc' },
    });
  }

  revogar(id: string) {
    return this.prisma.apiKey.update({ where: { id }, data: { ativa: false, revogadaEm: new Date() } });
  }

  registrarUso(id: string) {
    return this.prisma.apiKey.updateMany({ where: { id }, data: { ultimoUsoEm: new Date() } });
  }
}
