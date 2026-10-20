# Relatório de validação

Ambiente de execução: Node **v22.22.0**, npm **10.9.4**, Linux x64. Data: 2026-10-20.

Comandos executados:

```
npm install
npm run typecheck        # tsc --noEmit — sem erros
npm test                 # 38 passam, 1 pulado (fixture lenta gated)
npm run test:slow        # 39 passam (inclui cobertura incondicional exaustiva)
```

## Resumo

| Pacote | Testes | Passaram | Observação |
|---|---:|---:|---|
| `math-core` | 24 | 24 | binomial, fração, hipergeométrica, colex, RNG |
| `coverage` | 8 | 8 | ótimos §21.1 por branch-and-bound exato |
| `verification` | 7 | 6 + 1 lento | distribuições §10; fixture incondicional sob `test:slow` |
| **Total** | **39** | **39** | 1 pulado por padrão (executado em `test:slow`) |

## Referências exatas conferidas (§21.1)

- `C(25,15) = 3.268.760`, `C(60,6) = 50.063.860`.
- Hipergeométrica: soma da distribuição **exatamente 1** (LF, Mega e casos arbitrários);
  casos fora do domínio = 0. Mega 6/6 = `1/50.063.860`.
- Rank/unrank colex: bijeção verificada exaustivamente para N≤10 (todos os ranks 0..M-1,
  sem duplicatas, inverso exato).
- Cobertura máxima exata (d=k, cenários = todos os k-subconjuntos):

  | N,k,t,m | ótimo / total | resultado |
  |---|---|---|
  | 6,3,2,2 | 20/20 | ✔ |
  | 7,3,2,2 | 26/35 | ✔ |
  | 7,3,2,3 | 32/35 | ✔ |
  | 7,3,2,4 | 35/35 | ✔ |
  | 8,3,2,4 | 50/56 | ✔ |
  | 9,3,2,4 | 65/84 | ✔ |

- Fechamento Lotofácil (S=17, 8 apostas), 136 cenários condicionais: **128 com melhor 14 + 8 com melhor 15**, zero contraexemplos.
- Fechamento Mega-Sena (S=8, 4 apostas), 28 cenários condicionais: **24 com melhor 5 + 4 com melhor 6**, zero contraexemplos.
- Cobertura **incondicional** da carteira de fechamento LF, ≥14 acertos sobre os
  3.268.760 sorteios: **1.096 = 1.088 (melhor 14) + 8 (melhor 15)** — executado em `test:slow`.

## Propriedades (§21.2) conferidas

- Soma hipergeométrica = 1; impossíveis = 0.
- Rank/unrank inversos e bijetivos.
- Duplicar aposta aumenta custo mas **não** a união coberta.
- Serialização sem perda (JSON com strings inteiras); hash de carteira canônico e estável
  (independe da ordem das dezenas/apostas).
- Certificado `VERIFIED_CONDITIONAL` apenas com escopo completo e zero contraexemplos;
  caso contrário `NOT_PROVEN`.

## Limitações desta validação

- Cobre a **Entrega A (núcleo)**. Não há ainda provider oficial, persistência, jobs,
  laboratório nem deploy verificado — ver `docs/limitations.md`.
- As fixtures de ótimo testam ótimos **conhecidos**; não exigem que heurísticas os
  encontrem. O guloso reporta sua diferença honestamente.
