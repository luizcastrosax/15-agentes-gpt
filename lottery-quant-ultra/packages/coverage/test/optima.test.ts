import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUniformInstance, maxCoverageExact, greedyCoverage, coverageCount } from '../src/index.js';

/**
 * §21.1 — ótimos conhecidos de cobertura (d=k, cenários = todos os k-subconjuntos).
 * Verificados por branch-and-bound EXATO (enumeração implícita independente).
 */
const CASES: Array<{ N: number; k: number; t: number; m: number; opt: number; total: number }> = [
  { N: 6, k: 3, t: 2, m: 2, opt: 20, total: 20 },
  { N: 7, k: 3, t: 2, m: 2, opt: 26, total: 35 },
  { N: 7, k: 3, t: 2, m: 3, opt: 32, total: 35 },
  { N: 7, k: 3, t: 2, m: 4, opt: 35, total: 35 },
  { N: 8, k: 3, t: 2, m: 4, opt: 50, total: 56 },
  { N: 9, k: 3, t: 2, m: 4, opt: 65, total: 84 },
];

for (const c of CASES) {
  test(`§21.1 ótimo N=${c.N},k=${c.k},t=${c.t},m=${c.m} => ${c.opt}/${c.total}`, () => {
    const inst = buildUniformInstance(c.N, c.k, c.t);
    const res = maxCoverageExact(inst, c.m);
    assert.equal(res.total, c.total, 'total de cenários');
    assert.equal(res.best, c.opt, 'cobertura ótima');
    assert.equal(res.selection.length, c.m, 'tamanho da seleção');
    // a seleção reportada realmente cobre `best` cenários
    const sel = res.selection.map((i) => inst.candidateMasks[i]!);
    assert.equal(coverageCount(sel, inst.scenarioMasks, c.t), c.opt, 'recontagem da seleção');
  });
}

test('guloso nunca supera o ótimo e reporta sua diferença honestamente', () => {
  for (const c of CASES) {
    const inst = buildUniformInstance(c.N, c.k, c.t);
    const g = greedyCoverage(inst, c.m);
    assert.ok(g.covered <= c.opt, `guloso (${g.covered}) > ótimo (${c.opt})`);
    // soma dos ganhos marginais == cobertura acumulada final
    const sumGains = g.steps.reduce((a, s) => a + s.marginalGain, 0);
    assert.equal(sumGains, g.covered);
  }
});

test('§21.2 duplicar aposta aumenta custo mas não a união coberta', () => {
  const inst = buildUniformInstance(7, 3, 2);
  const one = [inst.candidateMasks[0]!];
  const dup = [inst.candidateMasks[0]!, inst.candidateMasks[0]!];
  assert.equal(
    coverageCount(one, inst.scenarioMasks, 2),
    coverageCount(dup, inst.scenarioMasks, 2),
    'duplicação não deve ampliar cobertura',
  );
});
