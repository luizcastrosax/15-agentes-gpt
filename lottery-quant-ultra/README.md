# LOTTERY QUANT ULTRA

Núcleo matemático verificável para **Lotofácil** e **Mega-Sena**, conforme o contrato técnico v1.0.

> **Conclusão científica obrigatória (§27):** não existe vantagem preditiva demonstrada
> sobre sorteios justos. Este software **não prevê** resultados, não promete ganho e não
> trata melhoria de cobertura como lucro. Ele organiza, gera, confere e avalia carteiras
> dentro de um orçamento, e permite pesquisa honesta — distinguindo descrição histórica
> de previsão.

## Situação desta entrega (incremento 1 — Entrega A, núcleo)

| Módulo | Situação | Evidência |
|---|---|---|
| `@lqu/contracts` — tipos, enums, formatos de jogo | **implementado** | typecheck |
| `@lqu/math-core` — binomial, frações exatas, hipergeométrica, rank/unrank colex, RNG | **testado** | 24 testes |
| `@lqu/coverage` — cobertura + otimização exata (B&B) de instâncias pequenas | **testado** | 8 testes (ótimos §21.1) |
| `@lqu/verification` — fechamentos conhecidos + verificador condicional + certificado | **testado** | 7 testes (distribuições §10) |
| `apps/web`, `@lqu/data`, `@lqu/providers`, `@lqu/engines`, async/jobs, laboratório | **não iniciado** | ver `docs/limitations.md` |

Nenhum módulo some do escopo: os posteriores estão marcados como **não iniciados** com o
caminho exato para implementá-los em `docs/requirements-matrix.md` e `docs/limitations.md`.

## Requisitos

- Node.js >= 22 (ambiente de desenvolvimento usou **v22.22.0**; o contrato propõe 24.x —
  ver `docs/decisions.md`).
- npm (workspaces).

## Instalação e execução

```bash
cd lottery-quant-ultra
npm install
npm run typecheck   # tsc --noEmit em todos os pacotes
npm test            # testes rápidos (gate das fixtures lentas)
npm run test:slow   # inclui cobertura incondicional exaustiva (§21.1 opcional)
```

Os testes do núcleo **não exigem segredos, banco, rede nem chave de IA** (§3.10, §26).
Toda a aleatoriedade é injetada; experimentos usam `SplitMix64` com semente e versão.

## O que já dá para calcular (com exatidão)

- Coeficientes binomiais e `C(25,15)=3.268.760`, `C(60,6)=50.063.860`.
- Probabilidade exata de *exatamente* r acertos de uma aposta (hipergeométrica), com soma = 1.
- Rank/unrank colex bijetivo (geração uniforme reprodutível, amostragem sem reposição de Floyd).
- Cobertura máxima **exata** (branch-and-bound) para instâncias pequenas — bate os ótimos
  conhecidos de §21.1.
- Fechamentos conhecidos (Lotofácil 17→8 apostas; Mega 8→4 apostas) com **verificador
  condicional independente** e **certificado** (`VERIFIED_CONDITIONAL` só com escopo
  completo e zero contraexemplos).

Veja `docs/validation-report.md` para os números executados.

## Estrutura

```
packages/contracts      tipos, enums, formatos de jogo
packages/math-core      núcleo matemático puro (sem rede/DB/env)
packages/coverage       cobertura e otimização exata pequena
packages/verification   fechamentos + verificador + certificado
packages/engines        (não iniciado)
packages/data           (não iniciado)
packages/providers      (não iniciado — provider CAIXA, §12)
docs/                    contrato, matriz de requisitos, limitações, decisões
```
