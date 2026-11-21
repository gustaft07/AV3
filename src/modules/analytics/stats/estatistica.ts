import {
  linearRegression, linearRegressionLine, mean, median, quantile, rSquared, standardDeviation,
} from 'simple-statistics';

export const arredondar = (n: number, casas = 2) => Math.round(n * 10 ** casas) / 10 ** casas;

export interface Resumo {
  amostras: number;
  media: number;
  mediana: number;
  desvio: number;
  p90: number;
}

/** Estatística descritiva (simple-statistics). Exige ao menos 1 valor. */
export function resumir(valores: number[]): Resumo {
  return {
    amostras: valores.length,
    media: mean(valores),
    mediana: median(valores),
    desvio: valores.length > 1 ? standardDeviation(valores) : 0,
    p90: quantile(valores, 0.9),
  };
}

export interface Reta {
  inclinacao: number;
  intercepto: number;
  r2: number;
}

/** Regressão linear simples por mínimos quadrados ordinários (OLS). */
export function regressaoOLS(pontos: Array<[number, number]>): Reta {
  const reg = linearRegression(pontos);
  const r2 = rSquared(pontos, linearRegressionLine(reg));
  return { inclinacao: reg.m, intercepto: reg.b, r2: Number.isFinite(r2) ? r2 : 0 };
}

/** R² de uma reta qualquer (usada para o modelo de Holt convertido em reta). */
export function r2DaReta(pontos: Array<[number, number]>, inclinacao: number, intercepto: number): number {
  const ys = pontos.map(([, y]) => y);
  const media = mean(ys);
  const total = ys.reduce((s, y) => s + (y - media) ** 2, 0);
  const residuo = pontos.reduce((s, [x, y]) => s + (y - (inclinacao * x + intercepto)) ** 2, 0);
  return total === 0 ? 0 : Math.max(0, 1 - residuo / total);
}
