import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedUniform, SplitMix64, type RNG } from '../src/rng.js';
import { sampleDistinctRanks } from '../src/sampling.js';

test('boundedUniform respeita o intervalo [0,L) e trata L=1', () => {
  const rng = new SplitMix64(42n);
  assert.equal(boundedUniform(rng, 1n), 0n);
  for (let i = 0; i < 5000; i++) {
    const L = BigInt(2 + (i % 97));
    const x = boundedUniform(rng, L);
    assert.ok(x >= 0n && x < L, `x=${x} fora de [0,${L})`);
  }
});

test('boundedUniform sem viés de módulo: todos os valores aparecem em L pequeno', () => {
  const rng = new SplitMix64(7n);
  const L = 6n;
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 60000; i++) counts[Number(boundedUniform(rng, L))]++;
  // cada face ~10000; tolerância larga apenas para detectar viés grosseiro
  for (const c of counts) assert.ok(c > 9000 && c < 11000, `contagem suspeita: ${counts}`);
});

test('SplitMix64 é determinístico por semente e versão', () => {
  const a = new SplitMix64(123n);
  const b = new SplitMix64(123n);
  const seqA = Array.from({ length: 10 }, () => a.nextUint32());
  const seqB = Array.from({ length: 10 }, () => b.nextUint32());
  assert.deepEqual(seqA, seqB);
  assert.equal(a.version, 'splitmix64-v1');
  const c = new SplitMix64(124n);
  const seqC = Array.from({ length: 10 }, () => c.nextUint32());
  assert.notDeepEqual(seqA, seqC);
});

test('sampleDistinctRanks produz m ranks distintos em [0,M)', () => {
  const rng = new SplitMix64(99n);
  const M = 84n;
  const ranks = sampleDistinctRanks(rng, M, 10);
  assert.equal(ranks.length, 10);
  assert.equal(new Set(ranks.map(String)).size, 10);
  for (const r of ranks) assert.ok(r >= 0n && r < M);
});

test('nextUint32 está em [0, 2^32)', () => {
  const rng: RNG = new SplitMix64(1n);
  for (let i = 0; i < 1000; i++) {
    const x = rng.nextUint32();
    assert.ok(Number.isInteger(x) && x >= 0 && x < 2 ** 32);
  }
});
