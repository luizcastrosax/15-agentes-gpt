import type { ClosurePortfolio } from './closures.js';

/**
 * Cobertura INCONDICIONAL de uma carteira (§21.1, fixtures opcionais).
 * Enumera TODOS os C(N,d) sorteios e tabula o melhor nº de acertos.
 * NÃO confundir com a condição de fechamento (§10): aqui o universo é completo.
 *
 * Implementação rápida com máscaras de 32 bits (válida para N <= 31).
 */
function popcount32(x: number): number {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >> 24;
}

export interface UnconditionalCoverage {
  N: number;
  d: number;
  minHits: number;
  totalDraws: number;
  coveredAtLeastMinHits: number;
  /** melhor nº de acertos -> quantidade de sorteios (apenas >= minHits). */
  distribution: Record<number, number>;
}

/**
 * Conta, sobre todos os C(N,d) sorteios, quantos têm max-overlap >= minHits.
 * Enumeração exaustiva. Para N=25,d=15 são ~3,27M sorteios (rápido);
 * para N=60,d=6 são ~50M (use com cautela).
 */
export function unconditionalCoverage(
  portfolio: ClosurePortfolio,
  minHits: number,
  N: number,
): UnconditionalCoverage {
  const d = portfolio.d;
  const betMasks = portfolio.bets.map((b) => {
    let m = 0;
    for (const v of b) m |= 1 << (v - 1);
    return m;
  });
  const distribution: Record<number, number> = {};
  let covered = 0;
  let totalDraws = 0;

  // enumeração de combinações de d dezenas em [1,N] com máscara incremental
  const combo = Array.from({ length: d }, (_, i) => i + 1);
  for (;;) {
    totalDraws++;
    let dMask = 0;
    for (const v of combo) dMask |= 1 << (v - 1);
    let best = 0;
    for (const b of betMasks) {
      const h = popcount32(b & dMask);
      if (h > best) best = h;
    }
    if (best >= minHits) {
      covered++;
      distribution[best] = (distribution[best] ?? 0) + 1;
    }
    let i = d - 1;
    while (i >= 0 && combo[i] === N - (d - 1 - i)) i--;
    if (i < 0) break;
    combo[i]!++;
    for (let j = i + 1; j < d; j++) combo[j] = combo[j - 1]! + 1;
  }

  return { N, d, minHits, totalDraws, coveredAtLeastMinHits: covered, distribution };
}
