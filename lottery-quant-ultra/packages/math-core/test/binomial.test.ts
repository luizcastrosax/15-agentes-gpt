import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binomial, binomialN } from '../src/binomial.js';

test('§21.1 referências exatas de binomial', () => {
  assert.equal(binomialN(25, 15), 3268760n); // C(25,15)
  assert.equal(binomialN(60, 6), 50063860n); // C(60,6)
});

test('domínio: r<0 ou r>n => 0', () => {
  assert.equal(binomial(5n, -1n), 0n);
  assert.equal(binomial(5n, 6n), 0n);
  assert.equal(binomial(0n, 0n), 1n);
  assert.equal(binomial(10n, 0n), 1n);
  assert.equal(binomial(10n, 10n), 1n);
});

test('simetria C(n,r)=C(n,n-r)', () => {
  for (let n = 0; n <= 40; n++) {
    for (let r = 0; r <= n; r++) {
      assert.equal(binomialN(n, r), binomialN(n, n - r));
    }
  }
});

test('recorrência de Pascal C(n,r)=C(n-1,r-1)+C(n-1,r)', () => {
  for (let n = 1; n <= 40; n++) {
    for (let r = 0; r <= n; r++) {
      assert.equal(binomialN(n, r), binomialN(n - 1, r - 1) + binomialN(n - 1, r));
    }
  }
});

test('n negativo lança', () => {
  assert.throws(() => binomial(-1n, 0n), RangeError);
});
