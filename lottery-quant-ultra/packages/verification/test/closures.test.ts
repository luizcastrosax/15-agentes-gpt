import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLotofacilClosure,
  buildMegaSenaClosure,
  verifyConditional,
  issueCertificate,
  unconditionalCoverage,
} from '../src/index.js';

test('§10.1 / §21.1 — fechamento Lotofácil: 136 cenários = 128×14 + 8×15', () => {
  const S = Array.from({ length: 17 }, (_, i) => i + 1); // dezenas 1..17
  const portfolio = buildLotofacilClosure(S);
  assert.equal(portfolio.bets.length, 8, '8 apostas');
  for (const b of portfolio.bets) assert.equal(b.length, 15, 'cada aposta 15 dezenas');

  const v = verifyConditional(portfolio);
  assert.equal(v.expectedScenarios, 136);
  assert.equal(v.verifiedScenarios, 136);
  assert.equal(v.counterexampleCount, 0, 'garantia 14 deve valer em todos');
  assert.equal(v.distribution[14], 128);
  assert.equal(v.distribution[15], 8);
  assert.equal(v.distribution[13] ?? 0, 0);
});

test('§10.2 / §21.1 — fechamento Mega-Sena: 28 cenários = 24×5 + 4×6', () => {
  const S = Array.from({ length: 8 }, (_, i) => i + 1);
  const portfolio = buildMegaSenaClosure(S);
  assert.equal(portfolio.bets.length, 4);
  for (const b of portfolio.bets) assert.equal(b.length, 6);

  const v = verifyConditional(portfolio);
  assert.equal(v.expectedScenarios, 28);
  assert.equal(v.verifiedScenarios, 28);
  assert.equal(v.counterexampleCount, 0);
  assert.equal(v.distribution[5], 24);
  assert.equal(v.distribution[6], 4);
});

test('certificado: VERIFIED_CONDITIONAL quando escopo completo e sem contraexemplo', () => {
  const portfolio = buildLotofacilClosure(Array.from({ length: 17 }, (_, i) => i + 1));
  const v = verifyConditional(portfolio);
  const cert = issueCertificate(portfolio, v, new Date('2026-01-01T00:00:00Z'));
  assert.equal(cert.proofStatus, 'VERIFIED_CONDITIONAL');
  assert.equal(cert.counterexampleCount, 0);
  assert.equal(cert.verificationMethod, 'EXHAUSTIVE_ENUMERATION');
  assert.match(cert.checksum, /^[0-9a-f]{64}$/);
  assert.match(cert.portfolioHash, /^[0-9a-f]{64}$/);
  // determinismo do hash: mesma carteira (reordenada) => mesmo portfolioHash
  const shuffled = Array.from({ length: 17 }, (_, i) => 17 - i);
  const p2 = buildLotofacilClosure(shuffled);
  const c2 = issueCertificate(p2, verifyConditional(p2), new Date('2026-01-01T00:00:00Z'));
  assert.equal(cert.portfolioHash, c2.portfolioHash);
});

test('a condição aparece junto da garantia (§10.4)', () => {
  const portfolio = buildLotofacilClosure(Array.from({ length: 17 }, (_, i) => i + 1));
  assert.match(portfolio.condition, /pertencem ao conjunto S/);
  assert.equal(portfolio.guaranteedHits, 14);
});

test('funciona com S arbitrário (não só 1..17)', () => {
  const S = [2, 3, 5, 7, 11, 13, 17, 19, 23, 1, 4, 6, 8, 9, 10, 12, 25];
  const portfolio = buildLotofacilClosure(S);
  const v = verifyConditional(portfolio);
  assert.equal(v.distribution[14], 128);
  assert.equal(v.distribution[15], 8);
  assert.equal(v.counterexampleCount, 0);
});

test('seleção inválida é rejeitada', () => {
  assert.throws(() => buildLotofacilClosure([1, 2, 3]), RangeError);
  assert.throws(() => buildMegaSenaClosure([1, 2, 3, 4, 5, 6, 7, 61]), RangeError);
});

// Fixture opcional (lenta): cobertura INCONDICIONAL >=14 da Lotofácil.
// §21.1: 1096/3268760 (1088 de melhor 14 e 8 de melhor 15).
test(
  '§21.1 (opcional) cobertura incondicional LF >=14 = 1096 (1088×14 + 8×15)',
  { skip: process.env.LQU_RUN_SLOW ? false : 'defina LQU_RUN_SLOW=1 para rodar' },
  () => {
    const portfolio = buildLotofacilClosure(Array.from({ length: 17 }, (_, i) => i + 1));
    const u = unconditionalCoverage(portfolio, 14, 25);
    assert.equal(u.totalDraws, 3268760);
    assert.equal(u.coveredAtLeastMinHits, 1096);
    assert.equal(u.distribution[14], 1088);
    assert.equal(u.distribution[15], 8);
  },
);
