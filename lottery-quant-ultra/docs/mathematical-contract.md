# Contrato matemático (implementado)

Resumo do que o código garante hoje. Referências entre parênteses apontam ao contrato.

## Tipos e exatidão (§6)

- Contagens combinatórias em `bigint` (`binomial`).
- Probabilidades como `Fraction` inteira normalizada (sinal no numerador, `den>0`, gcd reduzido).
- Serialização JSON de frações por **strings** inteiras + `approx` decimal auxiliar
  (nunca usado para contabilidade).
- Dinheiro: o contrato exige centavos inteiros; o módulo financeiro (§15) ainda não foi iniciado.

## Modalidades (§7.1)

| Modalidade | N | k | d | M = C(N,d) |
|---|---:|---:|---:|---:|
| Lotofácil | 25 | 15 | 15 | 3.268.760 |
| Mega-Sena | 60 | 6 | 6 | 50.063.860 |

## Binomial (§7.2)

`C(n,r)=0` se `r<0` ou `r>n`. Caso contrário recorrência multiplicativa com divisão
inteira exata; `n<0` é rejeitado.

## Acertos de uma aposta (§7.3)

`P(X=r) = C(k,r)·C(N−k,d−r) / C(N,d)`, domínio `max(0,k+d−N) ≤ r ≤ min(k,d)`.
Soma exata = 1. `hyperAtLeast` fornece `P(X≥t)`, distinto de `P(X=r)`.

## Carteiras (§7.4)

`E[Y_t] = m·P(X≥t)` (`expectedBetsAtLeast`). **Não** é `P(Y_t≥1)`: as apostas
compartilham o mesmo sorteio; não se aplica independência. Duplicações preservam custo
mas não ampliam cenários distintos cobertos.

## Geração uniforme (§8)

- `boundedUniform` por rejeição, sem viés de módulo; `L=1` tratado à parte.
- Rank colex `rank(B)=Σ C(b_j−1, j)`; `unrankColex` inverte por busca gulosa.
- `SplitMix64` determinístico e versionado para experimentos; fonte do sistema é injetada
  por camada superior (math-core não acessa entropia do SO).
- `sampleDistinctRanks` (Floyd) para carteiras distintas = referência aleatória sem reposição.

## Cobertura e otimização (§9)

- `coverageCount` conta cenários com max-overlap ≥ t (pesos uniformes).
- `maxCoverageExact`: branch-and-bound com limite superior admissível
  `pop(atual) + restantes·maiorGanhoMarginal`. Prova de otimalidade **dentro do escopo
  dado** (candidatos e cenários enumerados) — não certifica universos amostrados.
- `greedyCoverage`: seleção por cardinalidade com log de ganho marginal; subótimo relatado.

## Fechamentos (§10)

Para `|S| = k+2`, apostas `B_j = S\F_j`, sorteio `D = S\E`:
`|B_j ∩ D| = (k−2) + |F_j ∩ E|`. Garantir `k−1` acertos ⇔ todo par `E` intersecta algum
par omitido `F_j`.

- Lotofácil: `|S|=17`, 8 pares (16 dezenas) + 1 fora, 8 apostas → garante 14 sob a condição
  “as 15 sorteadas ∈ S”. Distribuição condicional: 128×14 + 8×15 (136 cenários).
- Mega-Sena: `|S|=8`, 4 pares, 4 apostas → garante 5 sob “as 6 sorteadas ∈ S”.
  Distribuição: 24×5 + 4×6 (28 cenários).

O verificador enumera **todo** o escopo condicional (sem amostragem) e preserva
contraexemplos. O certificado só recebe `VERIFIED_CONDITIONAL` com escopo completo e zero
contraexemplos. O hash identifica o arquivo — não demonstra o teorema. **Escolher S não
aumenta a probabilidade de S conter o sorteio** sob o modelo uniforme.
