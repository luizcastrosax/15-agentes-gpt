import { binomial } from './binomial.js';
import { Fraction } from './fraction.js';

/**
 * Distribuição de acertos de UMA aposta (§7.3).
 *   X = |B ∩ D|,  P(X=r) = C(k,r) C(N-k, d-r) / C(N,d)
 * Domínio: max(0, k+d-N) <= r <= min(k, d). Fora disso, 0.
 *
 * Observação crítica (§7.3): isto é P(X = r) EXATAMENTE, não "pelo menos r".
 */
export function hyperExact(N: number, k: number, d: number, r: number): Fraction {
  if (N < 0 || k < 0 || d < 0 || k > N || d > N) {
    throw new RangeError(`hyperExact: parâmetros inválidos N=${N} k=${k} d=${d}`);
  }
  const lo = Math.max(0, k + d - N);
  const hi = Math.min(k, d);
  if (r < lo || r > hi) return Fraction.ZERO;
  const numer = binomial(BigInt(k), BigInt(r)) * binomial(BigInt(N - k), BigInt(d - r));
  const denom = binomial(BigInt(N), BigInt(d));
  return new Fraction(numer, denom);
}

/** Suporte [lo, hi] da distribuição hipergeométrica. */
export function hyperSupport(N: number, k: number, d: number): { lo: number; hi: number } {
  return { lo: Math.max(0, k + d - N), hi: Math.min(k, d) };
}

/** Distribuição completa r -> P(X=r) sobre todo o suporte. */
export function hyperDistribution(N: number, k: number, d: number): Map<number, Fraction> {
  const { lo, hi } = hyperSupport(N, k, d);
  const out = new Map<number, Fraction>();
  for (let r = lo; r <= hi; r++) out.set(r, hyperExact(N, k, d, r));
  return out;
}

/** Soma exata da distribuição (deve ser exatamente 1 — verificado em teste). */
export function hyperSum(N: number, k: number, d: number): Fraction {
  let s = Fraction.ZERO;
  for (const p of hyperDistribution(N, k, d).values()) s = s.add(p);
  return s;
}

/**
 * P(X >= t) para uma aposta (§7.3). NÃO é cobertura de carteira.
 */
export function hyperAtLeast(N: number, k: number, d: number, t: number): Fraction {
  const { hi } = hyperSupport(N, k, d);
  let s = Fraction.ZERO;
  for (let r = Math.max(t, 0); r <= hi; r++) s = s.add(hyperExact(N, k, d, r));
  return s;
}

/**
 * Número esperado de apostas com >= t acertos em uma carteira de m apostas (§7.4):
 *   E[Y_t] = m · P(X >= t).
 * ATENÇÃO: isto NÃO é P(Y_t >= 1). As apostas compartilham o mesmo sorteio;
 * não há independência entre elas.
 */
export function expectedBetsAtLeast(
  N: number,
  k: number,
  d: number,
  t: number,
  m: number,
): Fraction {
  return hyperAtLeast(N, k, d, t).mul(Fraction.fromBigint(BigInt(m)));
}
