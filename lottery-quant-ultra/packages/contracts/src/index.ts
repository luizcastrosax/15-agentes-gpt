/**
 * @lqu/contracts — tipos e enumerações compartilhadas.
 *
 * Regras de exatidão (§6 do contrato):
 *  - Contagens combinatórias: bigint.
 *  - Probabilidades exatas: fração inteira normalizada.
 *  - Dinheiro: centavos inteiros (bigint). Nunca ponto flutuante para contabilidade.
 *  - JSON: inteiros exatos e dinheiro como strings; aproximação decimal em campo auxiliar.
 *
 * Este pacote NÃO contém lógica de negócio nem dependências externas.
 */

/** Método de cálculo declarado em qualquer resultado numérico (§6). */
export type CalculationMethod =
  | 'EXACT_COMBINATORIAL'
  | 'EXHAUSTIVE_ENUMERATION'
  | 'MONTE_CARLO'
  | 'IMPORTANCE_SAMPLING'
  | 'ANALYTICAL_BOUND'
  | 'HEURISTIC_SEARCH'
  | 'EXACT_OPTIMIZATION';

/** Situação de prova associada a uma garantia/otimização (§6). */
export type ProofStatus =
  | 'NOT_APPLICABLE'
  | 'NOT_PROVEN'
  | 'PARTIALLY_VERIFIED'
  | 'VERIFIED_CONDITIONAL'
  | 'PROVEN_OPTIMAL';

/** Fração exata serializada como par de strings inteiras (§6). */
export interface ExactFractionJSON {
  numerator: string;
  denominator: string;
  /** Aproximação decimal auxiliar — NUNCA usar para contabilidade. */
  approx?: number;
}

/** Valor aproximado com método e precisão identificados (§6). */
export interface ApproxValueJSON {
  value: number;
  method: CalculationMethod;
  /** casas decimais significativas estimadas, quando aplicável. */
  precision?: number;
}

export type GameId = 'LOTOFACIL' | 'MEGASENA';

/**
 * Parâmetros canônicos de uma modalidade (§7.1).
 *  N = universo, k = tamanho da aposta simples, d = quantidade sorteada.
 *  M = C(N, d) = número de resultados possíveis.
 * Preço NÃO é fixado aqui: vem do ruleset oficial versionado (§7.1, §12).
 */
export interface GameFormat {
  id: GameId;
  name: string;
  N: number;
  k: number;
  d: number;
}

export const GAME_FORMATS: Readonly<Record<GameId, GameFormat>> = Object.freeze({
  LOTOFACIL: { id: 'LOTOFACIL', name: 'Lotofácil', N: 25, k: 15, d: 15 },
  MEGASENA: { id: 'MEGASENA', name: 'Mega-Sena', N: 60, k: 6, d: 6 },
});

/** M = C(N,d) esperado por modalidade (fixtures §21.1). Verificado em teste. */
export const EXPECTED_M: Readonly<Record<GameId, string>> = Object.freeze({
  LOTOFACIL: '3268760',
  MEGASENA: '50063860',
});
