import type { OrigemExecucao, Prisma, PrismaClient, TipoAnalise } from '@prisma/client';
import { HttpError } from '../../shared/http-errors';
import { VERSAO_MODELO, type ServicoAnalise } from './analytics.types';
import { EficienciaService } from './services/eficiencia.service';
import { RentabilidadeService } from './services/rentabilidade.service';
import { VidaUtilService } from './services/vida-util.service';

/**
 * Coordena o ciclo de uma análise (iniciar -> calcular -> persistir -> concluir/falhar).
 * É chamado pela API, pelos jobs agendados e pelo worker de relatórios: os serviços não sabem de onde vieram.
 */
export class AnalyticsOrchestrator {
  private servicos: Record<TipoAnalise, ServicoAnalise<any>>;

  constructor(private prisma: PrismaClient) {
    this.servicos = {
      eficiencia_operacional: new EficienciaService(prisma),
      rentabilidade: new RentabilidadeService(prisma),
      vida_util: new VidaUtilService(prisma),
    };
  }

  async iniciar(
    tipo: TipoAnalise, origem: OrigemExecucao, organizacaoId: string | null, parametros: Record<string, unknown> = {},
  ): Promise<string> {
    const e = await this.prisma.analiseExecucao.create({
      data: { tipo, origem, organizacaoId, parametros: parametros as Prisma.InputJsonObject, versaoModelo: VERSAO_MODELO },
    });
    return e.id;
  }

  async executar(execucaoId: string): Promise<void> {
    const exec = await this.prisma.analiseExecucao.findUnique({ where: { id: execucaoId } });
    if (!exec) throw new HttpError(404, 'Execução não encontrada', 'NAO_ENCONTRADO');
    if (exec.status === 'concluida') return; // idempotente: um retry não regrava resultados
    const servico = this.servicos[exec.tipo];

    try {
      const { linhas, avisos } = await servico.calcular({
        organizacaoId: exec.organizacaoId,
        parametros: (exec.parametros as Record<string, unknown> | null) ?? {},
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.resultadoEficiencia.deleteMany({ where: { execucaoId } }); // limpa restos de tentativa anterior
        await tx.resultadoRentabilidade.deleteMany({ where: { execucaoId } });
        await tx.previsaoVidaUtil.deleteMany({ where: { execucaoId } });
        await servico.salvar(tx, execucaoId, linhas);
        await tx.analiseExecucao.update({
          where: { id: execucaoId },
          data: {
            status: 'concluida', concluidaEm: new Date(), erro: null,
            avisos: avisos.length ? (avisos as Prisma.InputJsonArray) : undefined,
          },
        });
      });
    } catch (err) {
      await this.prisma.analiseExecucao.update({
        where: { id: execucaoId },
        data: { status: 'falhou', concluidaEm: new Date(), erro: String((err as Error).message).slice(0, 900) },
      });
      throw err;
    }
  }

  async resultados(execucaoId: string) {
    const execucao = await this.prisma.analiseExecucao.findUnique({ where: { id: execucaoId } });
    if (!execucao) throw new HttpError(404, 'Execução não encontrada', 'NAO_ENCONTRADO');
    const linhas = await this.servicos[execucao.tipo].buscar(execucaoId);
    return { execucao, linhas };
  }
}
