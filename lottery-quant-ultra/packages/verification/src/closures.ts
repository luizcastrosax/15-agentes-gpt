import { comboToMask, popcount, binomialN } from '@lqu/math-core';

/**
 * Construções de fechamento conhecidas (§10) e verificador conditional separado.
 *
 * Prova estrutural (§10.3): para |S| = k+2, bets B_j = S\F_j e sorteio D = S\E
 * (pares F_j e E), |B_j ∩ D| = k-2 + |F_j ∩ E|. Garantir k-1 equivale a todo
 * par E intersectar algum F_j. As construções abaixo satisfazem isso.
 *
 * IMPORTANTE (§10.4): escolher S NÃO aumenta a probabilidade de S conter o
 * sorteio sob o modelo uniforme. A garantia é CONDICIONAL ao evento declarado.
 */

export interface ClosurePortfolio {
  game: 'LOTOFACIL' | 'MEGASENA';
  /** conjunto selecionado S (k+2 dezenas). */
  selection: number[];
  /** pares omitidos (um por aposta). */
  pairs: Array<[number, number]>;
  /** dezena fora dos pares, quando |S| é ímpar (Lotofácil). */
  leftover: number | null;
  /** apostas resultantes (cada uma com k dezenas). */
  bets: number[][];
  k: number;
  d: number;
  /** condição sob a qual a garantia vale. */
  condition: string;
  /** acertos garantidos sob a condição. */
  guaranteedHits: number;
}

function canonicalPairs(selection: number[]): {
  pairs: Array<[number, number]>;
  leftover: number | null;
} {
  const s = [...selection].sort((a, b) => a - b);
  const pairs: Array<[number, number]> = [];
  const nPairs = Math.floor(s.length / 2);
  for (let i = 0; i < nPairs; i++) pairs.push([s[2 * i]!, s[2 * i + 1]!]);
  const leftover = s.length % 2 === 1 ? s[s.length - 1]! : null;
  return { pairs, leftover };
}

function assertSelection(selection: number[], size: number, N: number): void {
  const uniq = new Set(selection);
  if (selection.length !== size || uniq.size !== size) {
    throw new RangeError(`S deve ter ${size} dezenas distintas`);
  }
  for (const v of selection) {
    if (!Number.isInteger(v) || v < 1 || v > N) throw new RangeError(`dezena fora de [1,${N}]: ${v}`);
  }
}

/**
 * Lotofácil: S com 17 dezenas, 8 pares disjuntos em 16 delas, 1 fora.
 * Cada aposta é S menos um par (15 dezenas). 8 apostas.
 */
export function buildLotofacilClosure(selection: number[]): ClosurePortfolio {
  assertSelection(selection, 17, 25);
  const { pairs, leftover } = canonicalPairs(selection);
  const S = [...selection].sort((a, b) => a - b);
  const bets = pairs.map((p) => S.filter((v) => v !== p[0] && v !== p[1]));
  return {
    game: 'LOTOFACIL',
    selection: S,
    pairs,
    leftover,
    bets,
    k: 15,
    d: 15,
    condition: 'Todas as 15 dezenas sorteadas pertencem ao conjunto S (17 dezenas).',
    guaranteedHits: 14,
  };
}

/**
 * Mega-Sena: S com 8 dezenas, 4 pares disjuntos. Cada aposta é S menos um par
 * (6 dezenas). 4 apostas.
 */
export function buildMegaSenaClosure(selection: number[]): ClosurePortfolio {
  assertSelection(selection, 8, 60);
  const { pairs, leftover } = canonicalPairs(selection);
  const S = [...selection].sort((a, b) => a - b);
  const bets = pairs.map((p) => S.filter((v) => v !== p[0] && v !== p[1]));
  return {
    game: 'MEGASENA',
    selection: S,
    pairs,
    leftover,
    bets,
    k: 6,
    d: 6,
    condition: 'Todas as 6 dezenas sorteadas pertencem ao conjunto S (8 dezenas).',
    guaranteedHits: 5,
  };
}

/** Enumera os cenários condicionais: sorteios D ⊂ S com |D| = d. */
export function enumerateConditionalScenarios(selection: number[], d: number): number[][] {
  const S = [...selection].sort((a, b) => a - b);
  const out: number[][] = [];
  const combo = Array.from({ length: d }, (_, i) => i);
  if (d > S.length) return out;
  for (;;) {
    out.push(combo.map((i) => S[i]!));
    let i = d - 1;
    while (i >= 0 && combo[i] === S.length - (d - i)) i--;
    if (i < 0) break;
    combo[i]!++;
    for (let j = i + 1; j < d; j++) combo[j] = combo[j - 1]! + 1;
  }
  return out;
}

export interface ConditionalVerification {
  scope: 'CONDITIONAL_COMPLETE';
  targetHits: number;
  expectedScenarios: number;
  verifiedScenarios: number;
  /** distribuição: melhor nº de acertos -> quantidade de cenários. */
  distribution: Record<number, number>;
  counterexampleCount: number;
  /** primeiro contraexemplo reproduzível (sorteio que falha o alvo), se houver. */
  counterexample: number[] | null;
}

/**
 * Verificador CONDICIONAL independente (§10.4). Enumera TODO o escopo de
 * cenários condicionais e confere a garantia. Sem amostragem.
 */
export function verifyConditional(portfolio: ClosurePortfolio): ConditionalVerification {
  const betMasks = portfolio.bets.map(comboToMask);
  const scenarios = enumerateConditionalScenarios(portfolio.selection, portfolio.d);
  const expected = Number(
    binomialN(portfolio.selection.length, portfolio.d),
  );
  const distribution: Record<number, number> = {};
  let counterexampleCount = 0;
  let counterexample: number[] | null = null;
  for (const D of scenarios) {
    const dMask = comboToMask(D);
    let bestHits = 0;
    for (const b of betMasks) {
      const h = popcount(b & dMask);
      if (h > bestHits) bestHits = h;
    }
    distribution[bestHits] = (distribution[bestHits] ?? 0) + 1;
    if (bestHits < portfolio.guaranteedHits) {
      counterexampleCount++;
      if (!counterexample) counterexample = D;
    }
  }
  return {
    scope: 'CONDITIONAL_COMPLETE',
    targetHits: portfolio.guaranteedHits,
    expectedScenarios: expected,
    verifiedScenarios: scenarios.length,
    distribution,
    counterexampleCount,
    counterexample,
  };
}
