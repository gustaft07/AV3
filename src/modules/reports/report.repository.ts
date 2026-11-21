import type { FormatoRelatorio, Prisma, PrismaClient, TipoAnalise } from '@prisma/client';

export class ReportRepository {
  constructor(private prisma: PrismaClient) {}

  contarPendentes(organizacaoId: string) {
    return this.prisma.tarefaRelatorio.count({
      where: { organizacaoId, status: { in: ['aguardando', 'processando'] } },
    });
  }

  criar(d: { apiKeyId: string; organizacaoId: string; tipo: TipoAnalise; formato: FormatoRelatorio; parametros: Prisma.InputJsonObject }) {
    return this.prisma.tarefaRelatorio.create({ data: d });
  }

  buscar(id: string) {
    return this.prisma.tarefaRelatorio.findUnique({ where: { id }, include: { apiKey: true } });
  }

  marcarProcessando(id: string, tentativas: number) {
    return this.prisma.tarefaRelatorio.update({ where: { id }, data: { status: 'processando', tentativas, erro: null } });
  }

  concluir(id: string, arquivo: string, expiraEm: Date) {
    return this.prisma.tarefaRelatorio.update({
      where: { id }, data: { status: 'concluida', arquivo, concluidaEm: new Date(), expiraEm, erro: null },
      include: { apiKey: true },
    });
  }

  marcarFalha(id: string, erro: string, tentativas: number) {
    return this.prisma.tarefaRelatorio.update({
      where: { id }, data: { status: 'falhou', erro: erro.slice(0, 900), tentativas, concluidaEm: new Date() },
      include: { apiKey: true },
    });
  }

  expirados(agora: Date) {
    return this.prisma.tarefaRelatorio.findMany({
      where: { expiraEm: { lt: agora }, arquivo: { not: null } }, select: { id: true, arquivo: true },
    });
  }

  limparArquivo(id: string) {
    return this.prisma.tarefaRelatorio.update({ where: { id }, data: { arquivo: null } });
  }
}
