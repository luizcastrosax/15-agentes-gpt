# Matriz de requisitos

Formato: requisito → módulo → teste → situação → evidência.
Situações: **não iniciado · em desenvolvimento · implementado · testado · integrado**.

## Entrega A — núcleo (este incremento)

| Requisito (contrato) | Módulo | Teste | Situação | Evidência |
|---|---|---|---|---|
| §7.2 Coeficiente binomial exato (bigint) | `math-core/binomial` | `binomial.test.ts` | testado | C(25,15)=3268760; C(60,6)=50063860; Pascal; simetria |
| §6 Fração exata normalizada + JSON por strings | `math-core/fraction` | `fraction.test.ts` | testado | normalização, aritmética, serialização sem perda |
| §7.3 Hipergeométrica P(X=r); soma=1; impossíveis=0 | `math-core/hypergeometric` | `hypergeometric.test.ts` | testado | soma exata 1 (LF/Mega e arbitrários); domínio |
| §7.3 P(X>=t) distinto de P(X=r) | `math-core/hypergeometric` | `hypergeometric.test.ts` | testado | cauda == atLeast |
| §7.4 E[Y_t]=m·P(X>=t) (sem independência) | `math-core/hypergeometric` | (função) | implementado | `expectedBetsAtLeast` documentado |
| §8 Rank/unrank colex bijetivos | `math-core/combinatorics` | `combinatorics.test.ts` | testado | bijeção exaustiva N<=10 |
| §8 Inteiro uniforme por rejeição (sem viés de módulo) | `math-core/rng` | `rng.test.ts` | testado | faixa + distribuição em L=6 |
| §8 Gerador determinístico versionado | `math-core/rng` | `rng.test.ts` | testado | SplitMix64 determinístico por semente |
| §8 Amostragem sem reposição (Floyd) | `math-core/sampling` | `rng.test.ts` | testado | m ranks distintos em [0,M) |
| §9.1/§9.3 Cobertura F_t e cobertura máxima exata | `coverage` | `optima.test.ts` | testado | ótimos §21.1 (N=6..9) por B&B |
| §9.2 Guloso com ganho marginal; subótimo honesto | `coverage` | `optima.test.ts` | testado | guloso <= ótimo; soma de ganhos |
| §21.2 Duplicar aposta: +custo, mesma união | `coverage` | `optima.test.ts` | testado | cobertura igual com cópia |
| §10.1 Fechamento Lotofácil 17→8; 128×14 + 8×15 | `verification/closures` | `closures.test.ts` | testado | distribuição exata (136) |
| §10.2 Fechamento Mega 8→4; 24×5 + 4×6 | `verification/closures` | `closures.test.ts` | testado | distribuição exata (28) |
| §10.4 Certificado; VERIFIED_CONDITIONAL só completo+limpo | `verification/certificate` | `closures.test.ts` | testado | status, checksum sha256, hash estável |
| §21.1 (opcional) Cobertura incondicional LF >=14 = 1096 | `verification/unconditional` | `closures.test.ts` (slow) | testado | 1088×14 + 8×15 (executado com `test:slow`) |

## Módulos posteriores — situação explícita

| Requisito | Módulo previsto | Situação | Caminho para implementar |
|---|---|---|---|
| §5/§17 App Next.js, APIs /api/v1 | `apps/web` | **não iniciado** | App Router + Route Handlers; schemas runtime |
| §12 Provider oficial CAIXA, raw, snapshots, rulesets | `packages/providers`, `packages/data` | **não iniciado** | confirmar endpoints, preservar raw+hash, validar completude |
| §11 Monte Carlo + intervalos (Wilson/exato) | `packages/engines` | **não iniciado** | estimadores pareados; zero-sucesso 1-α^(1/R) |
| §9.3 Adaptador de solver (MIP) | `packages/engines` | **não iniciado** | status/gap/bound; inviável ≠ não encontrado |
| §13 Laboratório descritivo/Bayes/múltiplos testes | `apps/web` + `engines` | **não iniciado** | Holm/BH declarados; nulos corretos |
| §14 Backtest/walk-forward/torneio | `packages/engines` | **não iniciado** | ordem cronológica; teste externo |
| §15 Prêmios/rateio/valor esperado (centavos) | `packages/engines` | **não iniciado** | fixos vs rateio; contrafactual separado |
| §16/§18 Modelo de dados, jobs assíncronos, outbox, leases | `apps/web`, `workers` | **não iniciado** | idempotência at-least-once; fencing token |
| §23/§24 Deploy Vercel, recuperação, custos | infra | **não iniciado** | ver `docs/deployment.md` (roteiro) |
