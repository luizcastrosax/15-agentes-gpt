import { createHash } from 'node:crypto';
import type { ProofStatus } from '@lqu/contracts';
import type { ClosurePortfolio, ConditionalVerification } from './closures.js';

export const VERIFIER_VERSION = 'conditional-verifier-v1';

/** Serialização canônica da carteira (apostas ordenadas) para hash estável (§6). */
export function canonicalPortfolioString(portfolio: ClosurePortfolio): string {
  const bets = portfolio.bets
    .map((b) => [...b].sort((a, c) => a - c).join(','))
    .sort();
  return JSON.stringify({ game: portfolio.game, k: portfolio.k, d: portfolio.d, bets });
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export interface Certificate {
  certificateId: string;
  portfolioHash: string;
  condition: string;
  scope: 'CONDITIONAL_COMPLETE';
  targetHits: number;
  expectedScenarios: number;
  verifiedScenarios: number;
  counterexampleCount: number;
  distribution: Record<number, number>;
  verifierVersion: string;
  verificationMethod: 'EXHAUSTIVE_ENUMERATION';
  proofStatus: ProofStatus;
  completedAt: string;
  checksum: string;
}

/**
 * Emite certificado a partir de uma verificação (§10.4).
 * VERIFIED_CONDITIONAL exige: escopo completo (verificado == esperado),
 * nenhum contraexemplo e integridade confirmada. Caso contrário NOT_PROVEN.
 * O hash assegura identidade do arquivo — NÃO demonstra o teorema.
 */
export function issueCertificate(
  portfolio: ClosurePortfolio,
  verification: ConditionalVerification,
  now: Date = new Date(),
): Certificate {
  const portfolioHash = sha256Hex(canonicalPortfolioString(portfolio));
  const complete = verification.verifiedScenarios === verification.expectedScenarios;
  const clean = verification.counterexampleCount === 0;
  const proofStatus: ProofStatus = complete && clean ? 'VERIFIED_CONDITIONAL' : 'NOT_PROVEN';

  const body = {
    portfolioHash,
    condition: portfolio.condition,
    scope: verification.scope,
    targetHits: verification.targetHits,
    expectedScenarios: verification.expectedScenarios,
    verifiedScenarios: verification.verifiedScenarios,
    counterexampleCount: verification.counterexampleCount,
    distribution: verification.distribution,
    verifierVersion: VERIFIER_VERSION,
    verificationMethod: 'EXHAUSTIVE_ENUMERATION' as const,
    proofStatus,
    completedAt: now.toISOString(),
  };
  const checksum = sha256Hex(JSON.stringify(body));
  return {
    certificateId: `cert_${checksum.slice(0, 16)}`,
    ...body,
    checksum,
  };
}
