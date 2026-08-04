# Plano de Backtest

> **Status: não executado.** Nenhum backtest foi rodado neste repositório.
> Não há dados de mercado reais aqui, e nenhum número de performance é
> apresentado em lugar nenhum. Este documento é o protocolo a seguir — e o
> Gate G9 permanece em `RESEARCH` até que ele seja cumprido e a evidência
> registrada.

## 1. Objetivo

Responder a uma pergunta, e apenas a ela:

> O setup `mnq_sweep_rejection_v1` tem expectativa positiva fora da amostra,
> depois de custos, em condições reproduzíveis?

Não é objetivo desta fase otimizar parâmetros. Otimizar antes de estabelecer
que existe sinal é a forma mais rápida de produzir uma curva bonita e sem
valor.

## 2. Dados necessários (você precisa fornecer)

| Item | Requisito | Por quê |
|---|---|---|
| Barras M1 do MNQ | ≥ 24 meses, com volume | Base para M2/M5/M15 por `resample` |
| Barras H4 | Mesmo período | Regime; não deriva bem de M1 em janela curta |
| Calendário macro | Com `published_at` por evento | Sem isso, o backtest usa o calendário de hoje para decidir no passado |
| Cotação bid/ask (opcional) | Amostragem no instante de decisão | Sem isso, o custo é proxy e G6 fica `CONDITIONAL` |
| Regra de rolagem de contrato | Documentada | Série contínua mal construída é fonte de viés não tratada aqui |

Formato: CSV por timeframe (`M1.csv`, `M5.csv`, …) com cabeçalho
`open_time,open,high,low,close,volume`, `open_time` em ISO-8601 com fuso.
Volume vazio = ausente (não zero).

## 3. Particionamento

| Partição | Período | Uso |
|---|---|---|
| **In-sample (IS)** | primeiros ~50% | Formulação e sanidade das regras |
| **Out-of-sample (OOS)** | ~30% seguintes | Validação. **Uma única passagem.** |
| **Reserva (holdout)** | ~20% finais | Intocado até a decisão de shadow mode |

Regra inegociável: cada passagem no OOS consome um grau de liberdade. Se o
OOS for consultado mais de uma vez para ajustar regras, ele virou in-sample e
deve ser reclassificado como tal no relatório.

## 4. Walk-forward

Janelas deslizantes, âncora móvel:

```
treino 6 meses → teste 1 mês → desloca 1 mês → repete
```

Para cada janela registre: parâmetros, nº de trades, expectativa, drawdown.
O critério não é "a média é positiva", e sim **estabilidade**: uma estratégia
que ganha em 3 janelas e perde em 9 não tem edge, tem sorte concentrada.

## 5. Protocolo de execução

1. **Instantes de decisão** = fechamento de cada barra M1 dentro das janelas
   Pré-NY e NY Open (`ReplaySource.decision_times`). Decidir no fechamento é o
   que torna o backtest replicável em produção: em produção, é aí que o dado
   chega.
2. **Contexto** montado por `ReplaySource.snapshot_at(T)`, que trunca tudo
   com `available_at > T`.
3. **Mesma configuração** de produção, exceto `execution_mode` e `maturity`.
   Divergência de config invalida a comparação — o `config_hash` de cada
   decisão registra isso.
4. **Simulação de preenchimento** (não implementada; ver §8) com regras
   explícitas de fila, gap e stop.
5. **Telemetria completa** em JSONL, inclusive `NO_TRADE`.

## 6. Premissas de custo (declarar sempre)

| Item | Valor padrão | Natureza |
|---|---|---|
| Spread | `assumed_spread_ticks = 1.0` | **Premissa** quando não há bid/ask |
| Slippage | `assumed_slippage_ticks = 1.0` por perna | **Premissa**, não medição |
| Comissão | **não modelada** | Precisa ser adicionada antes de qualquer conclusão |
| Financiamento/rolagem | não aplicável ao intraday | — |

Rode uma análise de sensibilidade: dobre spread e slippage. Um edge que
desaparece com 2× custo não sobrevive a um dia ruim de liquidez.

## 7. Métricas do relatório

**Obrigatórias**

- Nº de trades (OOS separado de IS)
- Expectativa por trade, em R e em USD, **líquida de custos**
- Taxa de acerto e razão ganho médio / perda média
- Drawdown máximo em R, e duração
- Distribuição de MAE/MFE
- Distribuição de `blocked_at` (por que o sistema não operou)
- Latência de avaliação (p50/p99)

**Proibidas no relatório**

- Curva de capital sem custos
- Resultado in-sample apresentado como validação
- Qualquer métrica agregada com menos de 100 trades OOS sem intervalo de
  confiança explícito
- Sharpe anualizado a partir de amostra intradiária curta

## 8. O que falta implementar antes de rodar

O repositório entrega o motor de **decisão**, não o de **simulação de
resultado**. Falta:

1. **Simulador de preenchimento.** Regras necessárias: entrada STOP acionada
   por negociação além do preço (não por toque), gap de abertura, ordem de
   avaliação entre stop e alvo dentro da mesma barra (a resolução M1 é
   ambígua — use M1 para gatilho e assuma o pior caso, ou dados de tick).
2. **Contabilidade de trade.** Ciclo entrada → saída, PnL, MAE/MFE.
3. **Ledger de risco simulado.** O `SessionRiskLedger` precisa ser alimentado
   pelo simulador para que G7 se comporte como em produção.
4. **Relatório reprodutível.** Script que consome o JSONL e emite as métricas
   acima com `config_hash` e `ruleset_version` no cabeçalho.

Tudo isso deve viver fora do núcleo de decisão, consumindo `DecisionRecord` —
para que o código que decide continue sendo o mesmo em backtest e em produção.

## 9. Critérios de promoção

Para `BACKTEST_OUT_OF_SAMPLE`:

- ≥ 100 trades OOS
- Expectativa líquida positiva no OOS
- Drawdown máximo dentro do limite de risco declarado
- Sensibilidade a 2× custo documentada

Para `WALK_FORWARD_VALIDATED`:

- ≥ 8 janelas de walk-forward
- Maioria das janelas com expectativa positiva
- Sem degradação monotônica ao longo do tempo
- Parâmetros estáveis entre janelas (variação grande = overfitting)

A promoção é feita por `MaturityLadder.promote`, que exige aprovação humana
identificada e `evidence_ref` apontando para o relatório. Nenhum componente
automático promove.

## 10. Limitações do protocolo

- Sem dados de tick, a ordem intrabarra entre stop e alvo é **indeterminada**.
  Assuma o pior caso e diga que assumiu.
- Sem book, a suposição de preenchimento em ordens STOP é otimista por
  natureza.
- A construção da série contínua de futuros (rolagem) introduz viés que este
  plano não corrige; documente a regra usada.
- Nenhuma conclusão deste backtest se transfere automaticamente para outro
  instrumento, outra sessão ou outro regime de volatilidade.
