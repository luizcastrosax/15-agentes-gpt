import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rankColex,
  unrankColex,
  enumerateCombos,
  comboToMask,
  popcount,
} from '../src/combinatorics.js';
import { binomialN } from '../src/binomial.js';

test('§21.2 rank/unrank são inversos e bijetivos em universos pequenos', () => {
  const universes: Array<[number, number]> = [
    [5, 2],
    [6, 3],
    [7, 3],
    [8, 4],
    [9, 4],
    [10, 5],
  ];
  for (const [N, k] of universes) {
    const total = Number(binomialN(N, k));
    const seen = new Set<string>();
    let expectedRank = 0;
    for (const combo of enumerateCombos(N, k)) {
      // rank determinístico e inverso exato
      const r = rankColex(combo);
      const back = unrankColex(r, k, N);
      assert.deepEqual(back, combo, `unrank(rank(${combo})) != combo em N=${N},k=${k}`);
      // bijeção: cada rank aparece uma única vez e dentro de [0,total)
      assert.ok(r >= 0n && r < BigInt(total), `rank fora de faixa: ${r}`);
      assert.ok(!seen.has(r.toString()), `rank duplicado: ${r}`);
      seen.add(r.toString());
      expectedRank++;
    }
    assert.equal(seen.size, total, `nem todos os ranks cobertos em N=${N},k=${k}`);
  }
});

test('ordem colex: enumeração lexicográfica produz ranks 0..M-1 em ordem crescente de colex', () => {
  // Checa que o conjunto de ranks é exatamente {0..M-1}
  const N = 7,
    k = 3;
  const total = Number(binomialN(N, k));
  const ranks = [...enumerateCombos(N, k)].map((c) => Number(rankColex(c))).sort((a, b) => a - b);
  assert.deepEqual(ranks, Array.from({ length: total }, (_, i) => i));
});

test('comboToMask / popcount', () => {
  assert.equal(popcount(comboToMask([1, 2, 3])), 3);
  assert.equal(comboToMask([1]), 1n);
  assert.equal(comboToMask([1, 2]), 0b11n);
  assert.equal(popcount(0n), 0);
  assert.equal(popcount((1n << 64n) - 1n), 64);
});

test('unrank fora de faixa lança', () => {
  assert.throws(() => unrankColex(binomialN(7, 3), 3, 7), RangeError);
});
