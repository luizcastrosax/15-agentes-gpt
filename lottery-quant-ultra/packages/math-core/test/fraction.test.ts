import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fraction } from '../src/fraction.js';

test('normalização: sinal no numerador, denominador positivo, gcd reduzido', () => {
  const f = new Fraction(2n, -4n);
  assert.equal(f.num, -1n);
  assert.equal(f.den, 2n);
});

test('aritmética exata', () => {
  const a = new Fraction(1n, 3n);
  const b = new Fraction(1n, 6n);
  assert.ok(a.add(b).equals(new Fraction(1n, 2n)));
  assert.ok(a.sub(b).equals(new Fraction(1n, 6n)));
  assert.ok(a.mul(b).equals(new Fraction(1n, 18n)));
  assert.ok(a.div(b).equals(new Fraction(2n, 1n)));
});

test('§21.2 serialização sem perda: JSON usa strings inteiras', () => {
  const f = new Fraction(1n, 50063860n);
  const j = f.toJSON();
  assert.equal(j.numerator, '1');
  assert.equal(j.denominator, '50063860');
  assert.ok(typeof j.approx === 'number');
});

test('comparação exata cmp', () => {
  assert.equal(new Fraction(1n, 3n).cmp(new Fraction(1n, 2n)), -1);
  assert.equal(new Fraction(1n, 2n).cmp(new Fraction(1n, 2n)), 0);
  assert.equal(new Fraction(2n, 3n).cmp(new Fraction(1n, 2n)), 1);
});

test('denominador zero e divisão por zero lançam', () => {
  assert.throws(() => new Fraction(1n, 0n), RangeError);
  assert.throws(() => new Fraction(1n, 2n).div(Fraction.ZERO), RangeError);
});
