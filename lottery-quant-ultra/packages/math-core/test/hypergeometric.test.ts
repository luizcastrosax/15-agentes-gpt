import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fraction } from '../src/fraction.js';
import {
  hyperExact,
  hyperSum,
  hyperDistribution,
  hyperAtLeast,
  hyperSupport,
} from '../src/hypergeometric.js';
import { GAME_FORMATS } from '@lqu/contracts';

test('§21.2 soma hipergeométrica exatamente 1 (Lotofácil e Mega)', () => {
  for (const g of Object.values(GAME_FORMATS)) {
    assert.ok(hyperSum(g.N, g.k, g.d).isOne(), `soma != 1 em ${g.id}`);
  }
});

test('soma 1 em vários parâmetros arbitrários', () => {
  const cases: Array<[number, number, number]> = [
    [25, 15, 15],
    [60, 6, 6],
    [10, 4, 5],
    [7, 3, 3],
    [49, 6, 6],
    [20, 1, 10],
  ];
  for (const [N, k, d] of cases) {
    assert.ok(hyperSum(N, k, d).isOne(), `soma != 1 em N=${N} k=${k} d=${d}`);
  }
});

test('casos impossíveis retornam zero', () => {
  // r acima de min(k,d)
  assert.ok(hyperExact(25, 15, 15, 16).isZero());
  // r abaixo de max(0, k+d-N): N=25,k=15,d=15 => lo = 5
  const { lo } = hyperSupport(25, 15, 15);
  assert.equal(lo, 5);
  assert.ok(hyperExact(25, 15, 15, 4).isZero());
  assert.ok(!hyperExact(25, 15, 15, 5).isZero());
});

test('P(X>=t) coincide com soma da cauda da distribuição', () => {
  const N = 25,
    k = 15,
    d = 15;
  const dist = hyperDistribution(N, k, d);
  for (let t = 0; t <= 15; t++) {
    let tail = Fraction.ZERO;
    for (const [r, p] of dist) if (r >= t) tail = tail.add(p);
    assert.ok(hyperAtLeast(N, k, d, t).equals(tail), `cauda difere em t=${t}`);
  }
});

test('valor conhecido: Mega-Sena acerto máximo 6/6 = 1/50063860', () => {
  const p = hyperExact(60, 6, 6, 6);
  assert.equal(p.num, 1n);
  assert.equal(p.den, 50063860n);
});
