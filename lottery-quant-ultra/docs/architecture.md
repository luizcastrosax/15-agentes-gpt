# Arquitetura

Monólito modular TypeScript (§5). Pacotes com dependências unidirecionais:

```
contracts  ──►  (nenhuma)
math-core  ──►  contracts
coverage   ──►  contracts, math-core
verification ─► contracts, math-core
engines    ──►  (não iniciado) math-core, coverage, verification, data
data       ──►  (não iniciado) contracts
providers  ──►  (não iniciado) contracts, data
apps/web   ──►  (não iniciado) todos acima
```

Princípios aplicados neste incremento:

- **`math-core` puro**: sem React/Next/DB/rede/auth/env; RNG injetado (§5).
- **Exatidão primeiro** (§6): bigint para contagens, fração inteira para probabilidades,
  strings em JSON; aproximação só em campo auxiliar.
- **Verificação separada da construção** (§10): o verificador não confia no construtor;
  enumera o escopo e preserva contraexemplos.
- **Escopo explícito**: otimização/garantia declaram o universo em que valem; amostra não
  certifica população.

Planejado (não iniciado): Next.js App Router + Route Handlers, Postgres/Neon + Drizzle,
Clerk, Vercel Blob, fila substituível e workers com outbox/leases/fencing (§16–§18, §23).
Ver `docs/requirements-matrix.md` e `docs/limitations.md`.
