import type { PrismaClient } from '@prisma/client';
import { mean } from 'simple-statistics';
import { arredondar } from './stats/estatistica';
import { DIA, SCORE } from './services/vida-util.service';

export interface ParametrosAvaliacao {
  diasMinimos?: number; // espera mínima após a previsão antes de avaliá-la (padrão 30)
  minAmostras?: number; // observações futuras necessárias (padrão 5)
}

/**
 * Compara previsões passadas com o que de fato aconteceu depois: para cada previsão ainda não avaliada,
 * confronta a nota prevista (reta guardada) com as notas observadas em transições posteriores à previsão.
 * O erro médio absoluto (MAE) alimenta a escolha do método "recomendado" nas próximas execuções.
 */
export class AvaliacaoService {
  constructor(private prisma: PrismaClient) {}

  async avaliar(params: ParametrosAvaliacao = {}) {
    const diasMinimos = params.diasMinimos ?? 30;
    const minAmostras = params.minAmostras ?? 5;
    const limite = new Date(Date.now() - diasMinimos * DIA);

    const pendentes = await this.prisma.previsaoVidaUtil.findMany({
      where: { avaliacao: { is: null }, execucao: { status: 'concluida', iniciadaEm: { lte: limite } } },
      include: { execucao: { select: { iniciadaEm: true, organizacaoId: true } } },
      take: 200,
    });

    let avaliadas = 0;
    for (const p of pendentes) {
      const futuras = await this.prisma.historicoEstado.findMany({
        where: {
          em: { gt: p.execucao.iniciadaEm },
          equipamento: {
            lote: { ativo: true, ...(p.execucao.organizacaoId ? { organizacaoId: p.execucao.organizacaoId } : {}) },
            tipo: { equals: p.tipo },
          },
        },
        select: { para: true, em: true, equipamento: { select: { criadoEm: true } } },
      });
      if (futuras.length < minAmostras) continue;

      const erros = futuras.map((f) => {
        const idade = (f.em.getTime() - f.equipamento.criadoEm.getTime()) / DIA;
        return p.inclinacao * idade + p.intercepto - SCORE[f.para]; // previsto - real
      });
      await this.prisma.avaliacaoPrevisao.create({
        data: {
          previsaoId: p.id,
          amostrasFuturas: futuras.length,
          maeScore: arredondar(mean(erros.map(Math.abs)), 4),
          viesScore: arredondar(mean(erros), 4),
        },
      });
      avaliadas++;
    }
    return { pendentes: pendentes.length, avaliadas };
  }
}
