# Decision Gates

## Semântica dos status

| Status | Significado | Efeito |
|---|---|---|
| `PASS` | Condição satisfeita com dado direto ou derivado | prossegue |
| `CONDITIONAL` | Satisfeita, mas com proxy, amostra baixa ou margem apertada | prossegue; conta para `max_conditional_gates` |
| `FAIL` | Condição violada | em gate crítico: `NO_TRADE` imediato |
| `NOT_AVAILABLE` | Não foi possível avaliar | traduzido por `config.gates.treat_not_available_as` (padrão: `FAIL`) |

`FAIL` e `NOT_AVAILABLE` são deliberadamente distintos. "O regime é proibido"
e "não sei qual é o regime" exigem investigações diferentes, ainda que ambos
bloqueiem. A telemetria preserva a distinção.

## Regra transversal: proxy nunca passa

Qualquer gate cujo insumo seja `SourceKind.PROXY` tem seu `PASS` rebaixado
automaticamente para `CONDITIONAL` (`gates._demote_if_proxy`). Não há exceção
e não há configuração que desligue isso.

**Consequência prática no MVP:** quatro gates são estruturalmente
`CONDITIONAL` — G3 (pools são proxy de liquidez em repouso), G4 (aceitação
medida por fechamento é proxy de tempo aceito), G5 (fluxo derivado de OHLCV) e
G6 (custo estimado sem bid/ask). Por isso `max_conditional_gates` é 5 na
configuração padrão. Reduzir esse número conforme fontes reais substituem os
proxies é a métrica de progresso do sistema.

## Criticidade

Todos os gates são críticos por padrão. `config.gates.non_critical_gates`
permite tolerância explícita, mas **G0, G7, G8 e G9 não podem ser marcados
como não-críticos** — o carregador de configuração recusa.

---

## G0 — DATA

**Pergunta:** os dados são utilizáveis neste instante?

Verifica, por timeframe requerido: número mínimo de barras confirmadas,
obsolescência (`as_of − último close` contra `max_staleness_multiple × duração
do TF`), buracos na grade, duplicatas e desordem. Verifica também o frescor do
feed e a presença de cotação.

| Situação | Status |
|---|---|
| Tudo saudável | `PASS` |
| Buracos na grade (feriado, pausa, gap de vendor) | `CONDITIONAL` |
| Timeframe ausente ou sem barras | `NOT_AVAILABLE` |
| Barras insuficientes, série obsoleta, duplicata, desordem | `FAIL` |
| Feed obsoleto ou com carimbo no futuro | `FAIL` |
| Heartbeat do feed ausente | `CONDITIONAL` (frescor desconhecido) |

Carimbo de feed no futuro é tratado como `UNUSABLE` porque só existem duas
causas — relógio dessincronizado ou vazamento de dado futuro — e ambas
invalidam a decisão.

## G1 — MACRO

**Pergunta:** estamos em janela de blackout por evento macroeconômico?

| Situação | Status |
|---|---|
| Calendário disponível, fora de blackout | `PASS` |
| Calendário disponível, dentro de blackout | `FAIL` |
| Calendário indisponível e `require_calendar=true` | `NOT_AVAILABLE` → `FAIL` |
| Calendário indisponível e `require_calendar=false` | `CONDITIONAL` |

A distinção central: `macro_events is None` significa **calendário
indisponível**; `macro_events == []` significa **calendário disponível e sem
eventos**. Tratar os dois como iguais seria converter ausência de dado em
"nenhum evento", exatamente o erro que o sistema proíbe.

## G2 — REGIME

**Pergunta:** o regime e a janela de sessão permitem operar?

| Situação | Status |
|---|---|
| Regime permitido, volatilidade classificada, janela operável | `PASS` |
| Volatilidade `UNKNOWN` (histórico curto) | `CONDITIONAL` |
| Regime `UNKNOWN` | `NOT_AVAILABLE` |
| Fora da janela operável, ou mercado fechado | `FAIL` |
| Regime fora de `allowed_regimes` | `FAIL` |
| Volatilidade `EXTREME` | `FAIL` |

## G3 — LIQUIDITY

**Pergunta:** há um sweep de liquidez confirmado e ainda válido?

| Situação | Status |
|---|---|
| Sweep confirmado como `REJECTED`, dentro da validade | `CONDITIONAL` (pools são proxy) |
| Nenhum pool construído | `NOT_AVAILABLE` |
| Nenhum sweep ativo | `FAIL` |
| Sweep ativo com desfecho `ACCEPTED_THROUGH` | `FAIL` |

Um sweep `PENDING` **nunca** chega ao gate: ele não tem `confirmed_at` e por
isso é invisível às consultas as-of.

## G4 — INTERACTION

**Pergunta:** houve rejeição no nível varrido, com confirmação estrutural?

| Situação | Status |
|---|---|
| Rejeição + estrutura alinhada ao lado | `CONDITIONAL` (aceitação é proxy) |
| Rejeição sem sinal estrutural | `CONDITIONAL` |
| Rejeição com direção estrutural ainda não alinhada | `CONDITIONAL` |
| Aceitação além do nível | `FAIL` — o setup de reversão está invalidado |
| Indecisão | `FAIL` |
| Estrutura contrária ao lado | `FAIL` |
| Sem sweep ou barras insuficientes | `NOT_AVAILABLE` |

## G5 — FLOW

**Pergunta:** o fluxo confirma o lado?

| Situação | Status |
|---|---|
| Proxy favorável e participação acima do mínimo | `CONDITIONAL` |
| Proxy neutro | `CONDITIONAL` |
| Proxy contrário | `FAIL` |
| `allow_proxy=false` (sem fonte real de fluxo) | `NOT_AVAILABLE` |

`PASS` neste gate é inalcançável enquanto o insumo for proxy. Ele só se torna
possível com trades tick a tick identificando o agressor, ou com book.

## G6 — EXECUTION

**Pergunta:** existe plano executável com R:R líquido aceitável?

| Situação | Status |
|---|---|
| Plano válido, `rr_net ≥ min_rr_net`, custo medido | `PASS` |
| Idem, mas custo estimado (sem bid/ask) | `CONDITIONAL` |
| `rr_net < min_rr_net` | `FAIL` |
| Nenhum plano construível (stop fora dos limites, dimensionamento zero) | `FAIL` |
| `rr_net` incalculável | `NOT_AVAILABLE` |

O gate avalia **`rr_net`**, nunca `rr`. Um R:R bruto sem custo é uma promessa,
não uma medida.

## G7 — RISK

**Pergunta:** o plano cabe no orçamento de risco?

| Situação | Status |
|---|---|
| Aprovado, sem violações | `PASS` |
| Estado de conta ou de ledger desconhecido/obsoleto | `NOT_AVAILABLE` → `FAIL` |
| Limite diário, nº de trades, perdas consecutivas, risco por trade | `FAIL` |

Conta desconhecida **não é conta zerada** e ledger vazio **não é zero trades**.
Ambos bloqueiam quando `block_on_unknown_state=true` (padrão).

## G8 — POSITION

**Pergunta:** o estado de posição permite nova entrada?

| Situação | Status |
|---|---|
| `FLAT`, sem ordens pendentes, snapshot fresco | `PASS` |
| Snapshot ausente ou obsoleto | `NOT_AVAILABLE` → `FAIL` |
| Posição aberta, ordens pendentes, ou qualquer estado ≠ `FLAT` | `FAIL` |

## G9 — EDGE MATURITY

**Pergunta:** o setup provou maturidade suficiente para emitir intenção?

| Situação | Status |
|---|---|
| Estágio ≥ `SHADOW_MODE`, OOS e walk-forward concluídos, evidência anexada | `PASS` |
| Idem, sem referência de evidência | `CONDITIONAL` |
| Estágio abaixo do mínimo | `FAIL` |
| OOS ou walk-forward não concluídos | `FAIL` |

A escada é `RESEARCH → BACKTEST_IN_SAMPLE → BACKTEST_OUT_OF_SAMPLE →
WALK_FORWARD_VALIDATED → SHADOW_MODE → LIVE_PILOT → LIVE_FULL`.

Três travas estruturais:

1. O estágio vem de **configuração**, nunca de inferência sobre resultados
   recentes — inferir maturidade de performance recente é overfitting
   operacional.
2. Promover exige aprovação humana identificada e referência de evidência
   (`MaturityLadder.promote`). Nenhum componente adaptativo promove sozinho.
3. Promover acima de `SHADOW_MODE` é **recusado nesta versão**: não existe
   caminho de execução real para sustentar o estágio.

Na configuração padrão o estágio é `RESEARCH`. Portanto, com o repositório
como entregue, **toda decisão termina em `NO_TRADE` bloqueado em G9** — e é
assim que deve ser até que os planos de backtest e shadow mode sejam
executados.

## Agregação

```
se qualquer gate crítico tem status efetivo FAIL      → NO_TRADE
se algum gate de G0..G9 não foi avaliado               → NO_TRADE
se nº de CONDITIONAL > max_conditional_gates           → NO_TRADE
se não há plano                                        → NO_TRADE
se ExecutionMode == READ_ONLY                          → OBSERVE
se G9 aprovado e ExecutionMode == SHADOW               → SHADOW_INTENT
```

`LIVE_ORDER` não é alcançável: o construtor de `DecisionRecord` recusa esse
valor, e `ExecutionMode.LIVE` aborta o orquestrador antes de qualquer
avaliação.
