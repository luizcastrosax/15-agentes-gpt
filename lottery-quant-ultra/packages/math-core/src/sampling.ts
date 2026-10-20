import type { RNG } from './rng.js';
import { boundedUniform } from './rng.js';
import { unrankColex } from './combinatorics.js';

/**
 * Amostragem de m ranks DISTINTOS em [0, M) pelo algoritmo de Floyd (§8).
 * Uma escolha uniforme entre carteiras com m combinações distintas é uma
 * referência aleatória válida. NÃO confundir com sorteio independente com
 * reposição (política de duplicações diferente).
 */
export function sampleDistinctRanks(rng: RNG, M: bigint, m: number): bigint[] {
  if (m < 0) throw new RangeError('m deve ser >= 0');
  if (BigInt(m) > M) throw new RangeError(`m=${m} excede M=${M}`);
  const chosen = new Set<string>();
  const out: bigint[] = [];
  for (let i = M - BigInt(m); i < M; i++) {
    const t = boundedUniform(rng, i + 1n); // [0, i]
    const key = t.toString();
    if (chosen.has(key)) {
      chosen.add(i.toString());
      out.push(i);
    } else {
      chosen.add(key);
      out.push(t);
    }
  }
  return out;
}

/**
 * Carteira uniforme de m apostas DISTINTAS de tamanho k em [1,N].
 * Referência aleatória sem reposição (§8, §14).
 */
export function sampleDistinctPortfolio(
  rng: RNG,
  N: number,
  k: number,
  m: number,
  M: bigint,
): number[][] {
  const ranks = sampleDistinctRanks(rng, M, m);
  return ranks.map((r) => unrankColex(r, k, N));
}
