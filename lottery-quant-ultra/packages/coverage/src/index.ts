import { comboToMask, popcount, enumerateCombos } from '@lqu/math-core';

/**
 * @lqu/coverage — cobertura de carteiras e otimização exata para instâncias
 * pequenas (§9). A garantia clássica do guloso refere-se ao universo candidato
 * e à função efetivamente usada; NÃO se transfere a restrições adicionais,
 * custos heterogêneos ou objetivo avaliado só por amostra (§9.2).
 */

export interface CoverageInstance {
  N: number;
  k: number;
  d: number;
  t: number;
  /** candidatos (apostas) como k-subconjuntos de [1,N]. */
  candidateMasks: bigint[];
  /** cenários (sorteios) como d-subconjuntos de [1,N]; pesos uniformes (§9.1). */
  scenarioMasks: bigint[];
}

/**
 * Instância com d=k onde candidatos e cenários são TODOS os k-subconjuntos.
 * É a forma das fixtures abstratas de §21.1 (apenas N,k,t,m dados).
 */
export function buildUniformInstance(N: number, k: number, t: number): CoverageInstance {
  const masks: bigint[] = [];
  for (const c of enumerateCombos(N, k)) masks.push(comboToMask(c));
  return { N, k, d: k, t, candidateMasks: masks, scenarioMasks: masks };
}

/** Máscara (sobre índices de cenários) dos cenários cobertos por um candidato a >= t. */
export function coveredMask(candMask: bigint, scenarioMasks: bigint[], t: number): bigint {
  let bits = 0n;
  for (let i = 0; i < scenarioMasks.length; i++) {
    if (popcount(candMask & scenarioMasks[i]!) >= t) bits |= 1n << BigInt(i);
  }
  return bits;
}

/** Nº de cenários cobertos (>= t acertos) por ao menos uma aposta da carteira. */
export function coverageCount(
  portfolioMasks: bigint[],
  scenarioMasks: bigint[],
  t: number,
): number {
  let covered = 0n;
  for (const b of portfolioMasks) covered |= coveredMask(b, scenarioMasks, t);
  return popcount(covered);
}

export interface MaxCoverageResult {
  /** melhor nº de cenários cobertos. */
  best: number;
  total: number;
  /** índices dos candidatos selecionados. */
  selection: number[];
  method: 'EXACT_OPTIMIZATION';
  /** nós visitados na busca (observabilidade). */
  nodes: number;
}

/**
 * Cobertura máxima EXATA por branch-and-bound (§9.3, objetivo
 * MAX_WEIGHTED_COVERAGE com pesos uniformes). Projetado para instâncias
 * pequenas das fixtures. Devolve prova de otimalidade dentro do escopo
 * (candidatos e cenários dados) — NÃO certifica universos amostrados.
 */
export function maxCoverageExact(inst: CoverageInstance, m: number): MaxCoverageResult {
  const total = inst.scenarioMasks.length;
  const covMasks = inst.candidateMasks.map((c) => coveredMask(c, inst.scenarioMasks, inst.t));
  // ordena candidatos por cobertura individual desc — melhora a poda
  const order = covMasks
    .map((mask, idx) => ({ idx, pop: popcount(mask) }))
    .sort((a, b) => b.pop - a.pop)
    .map((o) => o.idx);
  const sorted = order.map((i) => covMasks[i]!);

  let best = -1;
  let bestSel: number[] = [];
  let nodes = 0;

  // limite superior admissível: cobertura atual + (restantes)*maior ganho marginal possível
  function upperBound(currentOR: bigint, startIdx: number, remaining: number): number {
    const curPop = popcount(currentOR);
    if (remaining === 0) return curPop;
    let maxMarginal = 0;
    for (let i = startIdx; i < sorted.length; i++) {
      const g = popcount(sorted[i]! & ~currentOR);
      if (g > maxMarginal) maxMarginal = g;
    }
    return curPop + remaining * maxMarginal;
  }

  function dfs(startIdx: number, chosen: number[], currentOR: bigint): void {
    nodes++;
    if (chosen.length === m) {
      const pop = popcount(currentOR);
      if (pop > best) {
        best = pop;
        bestSel = chosen.slice();
      }
      return;
    }
    if (upperBound(currentOR, startIdx, m - chosen.length) <= best) return; // poda
    // não há candidatos suficientes para completar m
    if (sorted.length - startIdx < m - chosen.length) return;
    for (let i = startIdx; i < sorted.length; i++) {
      // poda: se mesmo pegando o melhor restante não supera, para
      if (upperBound(currentOR, i, m - chosen.length) <= best) break;
      chosen.push(i);
      dfs(i + 1, chosen, currentOR | sorted[i]!);
      chosen.pop();
    }
  }

  dfs(0, [], 0n);

  return {
    best,
    total,
    selection: bestSel.map((i) => order[i]!).sort((a, b) => a - b),
    method: 'EXACT_OPTIMIZATION',
    nodes,
  };
}

export interface GreedyStep {
  chosenIndex: number;
  marginalGain: number;
  cumulativeCovered: number;
}

/**
 * Seleção gulosa por cardinalidade (§9.2). Registra ganho marginal por passo.
 * Ausência de melhoria NÃO implica ótimo global. Desempate: menor índice.
 */
export function greedyCoverage(
  inst: CoverageInstance,
  m: number,
): { selection: number[]; covered: number; steps: GreedyStep[] } {
  const covMasks = inst.candidateMasks.map((c) => coveredMask(c, inst.scenarioMasks, inst.t));
  let currentOR = 0n;
  const selection: number[] = [];
  const steps: GreedyStep[] = [];
  const used = new Set<number>();
  for (let s = 0; s < m; s++) {
    let bestIdx = -1;
    let bestGain = -1;
    for (let i = 0; i < covMasks.length; i++) {
      if (used.has(i)) continue;
      const gain = popcount(covMasks[i]! & ~currentOR);
      if (gain > bestGain) {
        bestGain = gain;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    used.add(bestIdx);
    selection.push(bestIdx);
    currentOR |= covMasks[bestIdx]!;
    steps.push({
      chosenIndex: bestIdx,
      marginalGain: bestGain,
      cumulativeCovered: popcount(currentOR),
    });
  }
  return { selection, covered: popcount(currentOR), steps };
}
