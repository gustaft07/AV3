/**
 * Suavização exponencial dupla de Holt (nível + tendência), implementação própria (sem dependência).
 * Exige pelo menos 3 pontos, igualmente espaçados.
 */
export function suavizacaoHolt(serie: number[], alfa = 0.5, beta = 0.3): { nivel: number; tendencia: number } {
  if (serie.length < 3) throw new Error('Holt exige ao menos 3 pontos');
  let nivel = serie[0];
  let tendencia = serie[1] - serie[0];
  for (let t = 1; t < serie.length; t++) {
    const anterior = nivel;
    nivel = alfa * serie[t] + (1 - alfa) * (anterior + tendencia);
    tendencia = beta * (nivel - anterior) + (1 - beta) * tendencia;
  }
  return { nivel, tendencia };
}
