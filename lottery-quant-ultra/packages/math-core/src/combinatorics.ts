import { binomial } from './binomial.js';

/**
 * Sistema combinatório colex (§8).
 *
 * Para dezenas 1 <= b_1 < b_2 < ... < b_k <= N, o rank colex é:
 *   rank(B) = Σ_{j=1..k} C(b_j - 1, j)
 * produzindo valores 0 .. C(N,k)-1 em ordem colexicográfica.
 *
 * unrank inverte por busca gulosa no sistema combinatório.
 * A bijeção é verificada exaustivamente em universos pequenos (§21.2).
 */

/** Valida que `combo` é estritamente crescente, único e dentro de [1, N]. */
export function assertValidCombo(combo: readonly number[], N: number): void {
  for (let i = 0; i < combo.length; i++) {
    const v = combo[i]!;
    if (!Number.isInteger(v) || v < 1 || v > N) {
      throw new RangeError(`combo fora de [1,${N}]: ${v}`);
    }
    if (i > 0 && v <= combo[i - 1]!) {
      throw new RangeError('combo deve ser estritamente crescente e sem repetição');
    }
  }
}

/** rank colex de uma combinação ordenada crescente. */
export function rankColex(combo: readonly number[]): bigint {
  let r = 0n;
  for (let j = 0; j < combo.length; j++) {
    r += binomial(BigInt(combo[j]! - 1), BigInt(j + 1));
  }
  return r;
}

/**
 * unrank colex: devolve a combinação de tamanho k em [1,N] cujo rank é `rank`.
 * Estratégia gulosa da posição mais alta (j=k) para a mais baixa (j=1):
 * para cada j, acha o maior v com C(v, j) <= r, define b_j = v+1 e subtrai C(v,j).
 */
export function unrankColex(rank: bigint, k: number, N: number): number[] {
  const total = binomial(BigInt(N), BigInt(k));
  if (rank < 0n || rank >= total) {
    throw new RangeError(`rank ${rank} fora de [0, ${total})`);
  }
  const combo = new Array<number>(k);
  let r = rank;
  for (let j = k; j >= 1; j--) {
    // maior v tal que C(v, j) <= r ; v cresce no máximo até N-1 (b_j <= N)
    let v = j - 1; // mínimo possível: C(j-1, j) = 0
    while (binomial(BigInt(v + 1), BigInt(j)) <= r) v++;
    combo[j - 1] = v + 1;
    r -= binomial(BigInt(v), BigInt(j));
  }
  return combo;
}

/** Gera todas as combinações de tamanho k em [1,N] (uso em universos pequenos). */
export function* enumerateCombos(N: number, k: number): Generator<number[]> {
  const combo = Array.from({ length: k }, (_, i) => i + 1);
  if (k === 0) {
    yield [];
    return;
  }
  if (k > N) return;
  for (;;) {
    yield combo.slice();
    // avança para a próxima combinação em ordem lexicográfica
    let i = k - 1;
    while (i >= 0 && combo[i] === N - (k - 1 - i)) i--;
    if (i < 0) break;
    combo[i]!++;
    for (let j = i + 1; j < k; j++) combo[j] = combo[j - 1]! + 1;
  }
}

/** Máscara de bits (bigint) de uma combinação: bit (v-1) ligado para cada dezena v. */
export function comboToMask(combo: readonly number[]): bigint {
  let m = 0n;
  for (const v of combo) m |= 1n << BigInt(v - 1);
  return m;
}

/** popcount de um bigint não-negativo. */
export function popcount(x: bigint): number {
  let c = 0;
  while (x > 0n) {
    x &= x - 1n;
    c++;
  }
  return c;
}
