# Limitações

Leia antes de qualquer uso. Este documento lista o que o sistema **não** faz,
não sabe e não provou. Está deliberadamente em primeiro plano: um sistema de
trading que esconde limitações é mais perigoso do que um que não existe.

## 1. A limitação principal

**Este repositório entrega arquitetura e disciplina causal, não edge
comprovado.**

- Nenhum backtest foi executado.
- Nenhum dado real de mercado acompanha o código.
- Nenhum número de performance é apresentado em lugar nenhum.
- O estágio de maturidade é `RESEARCH`, e o Gate G9 barra 100% das decisões
  na configuração entregue. Isso é o comportamento correto, não um defeito.

As séries em `tests/fixtures.py` são **construídas à mão** para exercitar
caminhos de código. Elas não representam comportamento do MNQ e não sustentam
nenhuma conclusão.

## 2. Dados que o sistema não possui

| Dado | Consequência | Onde aparece |
|---|---|---|
| **Trades tick a tick com agressor** | Não existe delta. O Flow Engine usa proxies de OHLCV e G5 nunca retorna `PASS`. | `engines/flow.py` |
| **Profundidade de livro** | "Força" de um pool de liquidez não é mensurável; `touch_count` é o único proxy. | `engines/liquidity.py` |
| **Volume por preço / TPO** | Aceitação é medida por fechamento de barra — proxy grosseiro de tempo aceito. | `engines/acceptance.py` |
| **Calendário macro** | Não há calendário embutido. Sem arquivo fornecido, G1 bloqueia tudo. | `adapters/macro_calendar.py` |
| **Calendário de pregão (feriados, meias-sessões)** | O Session Engine conhece apenas dias da semana; pausas viram "gap" em G0. | `engines/session.py`, `engines/data_quality.py` |
| **Cotação bid/ask** | Custo de transação é premissa marcada como `PROXY`; G6 fica `CONDITIONAL`. | `engines/execution.py` |
| **Estado real de conta e posição** | Precisa ser injetado. Ausente ⇒ G7/G8 bloqueiam (correto, mas o sistema não opera). | `contracts/context.py` |

**Nenhuma dessas ausências é preenchida com valor plausível.** Todas viram
`MissingMeasurement` com motivo, ou `NOT_AVAILABLE`.

## 3. Execução

- **Não existe execução real.** Não há adapter de corretora, gestão de ordens
  vivas, reconciliação de posição, kill switch ou tratamento de rejeição.
- `ExecutionMode.LIVE` aborta o boot. `Decision.LIVE_ORDER` é recusado pelo
  construtor do `DecisionRecord`. Adapter com `supports_live=True` é recusado
  pelo orquestrador.
- O MVP decide **apenas entrada**. Não há gestão de posição aberta: trailing,
  parcial, breakeven, reversão. `PositionLifecycle` tem os estados, mas
  nenhum engine os dirige.

## 4. Qualidade dos modelos baseline

Cada engine baseline é **correto em relação ao contrato e deliberadamente
simples**. Nenhum é validado estatisticamente.

| Engine | Limitação concreta |
|---|---|
| Regime | EMA + percentil de ATR é aproximação grosseira. Candidatos melhores: variance ratio, Hurst, HMM. |
| Structure | BOS/CHoCH por pivô fractal simples. Não trata estrutura aninhada nem múltiplos horizontes. |
| Liquidity | Pools inferidos de preço. `EQUAL_HIGHS/LOWS` por clusterização unidimensional ingênua. |
| Acceptance | Fechamento de barra como proxy de tempo aceito. |
| Flow | Proxies de participação e deslocamento. Correlação ruidosa com fluxo real. |
| Execution | Geometria fixa (stop no extremo do sweep, alvo em R fixo). Sem alvo adaptativo a estrutura ou volatilidade. |
| Risk | Dimensionamento linear por percentual de equity. Sem correlação entre instrumentos, sem risco de portfólio. |
| Data Quality | Gap de feriado é indistinguível de gap de vendor (marcado `DEGRADED`, não `UNUSABLE`). |

## 5. Escopo do backtest

- Sem dados de tick, a ordem intrabarra entre stop e alvo é **indeterminada**.
- Não há simulador de preenchimento neste repositório (ver §8 do plano de
  backtest). O que existe é o motor de decisão.
- Construção de série contínua de futuros (rolagem) introduz viés não tratado.
- Comissão não é modelada em lugar nenhum.

## 6. Infraestrutura

- **Sem persistência.** Feature store é in-memory; nada sobrevive a reinício.
  Shadow mode contínuo exige persistência real.
- **Um instrumento por processo.** Não há coordenação de risco entre
  instrumentos ou estratégias.
- **Sem alerting.** A telemetria entrega os dados; o alerting não está
  implementado.
- **Latência de ingestão é premissa configurada, não medida.** Em produção
  precisa ser medida e monitorada.

## 7. Causalidade: o que a garantia cobre e o que não cobre

**Cobre:** o código nunca lê um fato antes de `available_at`, nunca reescreve
histórico confirmado e é reprodutível a partir do contexto. Verificado por 26
testes em `tests/causality/`.

**Não cobre:** a qualidade dos dados que você fornecer. Se o CSV já contiver
preços revisados a posteriori — comum em fontes gratuitas —, nenhum mecanismo
aqui detecta. O modelo suporta revisão de barra (novo evento com
`invalidated_at` no antigo), mas os adaptadores atuais não a implementam.

## 8. Valores que você precisa verificar

`config/instruments/mnq.json` traz `tick_size = 0.25` e `point_value = 2.0`
como **configuração**, não como fato verificado pelo sistema. Confirme na
especificação vigente do contrato antes de qualquer uso com dinheiro. Um
`point_value` errado propaga para todo o dimensionamento de risco.

O mesmo vale para as janelas de sessão: os horários em `config/degold.mnq.json`
refletem a definição de Pré-NY e NY Open adotada no MVP, não um horário
oficial de bolsa.

## 9. O que fazer antes de considerar dinheiro real

Em ordem, sem pular etapas:

1. Fornecer dados reais e executar o [plano de backtest](PLANO_BACKTEST.md).
2. Substituir o Flow Engine por uma implementação com dados reais de fluxo, ou
   aceitar operar com G5 permanentemente `CONDITIONAL`.
3. Integrar calendário macro e calendário de pregão reais.
4. Implementar simulador de preenchimento e contabilidade de trade.
5. Executar o [plano de shadow mode](PLANO_SHADOW_MODE.md) por completo.
6. Implementar execução: adapter, gestão de ordens, reconciliação, kill
   switch, contingência — **nada disso existe hoje**.
7. Revisão independente de risco antes de qualquer capital.

## 10. Aviso

Este software não é recomendação de investimento. Operar futuros envolve risco
de perda superior ao capital aplicado. O sistema descrito aqui não foi
validado com dados reais e, na configuração entregue, não produz nenhuma
ordem — nem simulada com efeito externo.
