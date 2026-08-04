# Arquitetura

## 1. Princípio organizador

O sistema é uma **função pura de decisão** cercada por adaptadores.

```
                 ┌─────────────────────────────────────────┐
   dados  ──────▶│  EvaluationContext (imutável, as_of=T)   │
   conta  ──────▶│                                          │
   macro  ──────▶└──────────────────┬──────────────────────┘
                                    │
                        ┌───────────▼────────────┐
                        │ Decision Orchestrator  │
                        │  engines + gates       │
                        └───────────┬────────────┘
                                    │
                        ┌───────────▼────────────┐
                        │    DecisionRecord      │──▶ telemetria (JSONL)
                        │  (imutável, versionado)│──▶ broker shadow (registro)
                        └────────────────────────┘
```

Nenhum engine faz I/O, lê relógio do sistema ou usa aleatoriedade. Tudo o que
o sistema sabe em `T` está dentro do `EvaluationContext`. Três consequências
diretas:

1. **Reprodutibilidade.** Mesmo contexto ⇒ mesma decisão, byte a byte
   (verificado em `test_decision_record_is_versioned_and_reproducible`).
2. **Backtest e produção compartilham o mesmo código de decisão.** O que muda
   é apenas quem monta o contexto.
3. **Look-ahead fica confinado a uma superfície auditável** — a construção do
   contexto —, que é exatamente onde os testes de causalidade atacam.

## 2. Camadas e dependências

As setas indicam "depende de". Não há ciclos, e o domínio não depende de nada.

```
cli ──▶ orchestration ──▶ engines ──▶ features ──▶ domain
 │            │              │                       ▲
 │            ├──▶ contracts ┴───────────────────────┤
 │            └──▶ telemetry ────────────────────────┤
 └──▶ adapters ──▶ configuration ────────────────────┘
```

| Camada | Responsabilidade | Pode fazer I/O? |
|---|---|---|
| `domain` | Tipos, invariantes, carimbos causais | Não |
| `contracts` | `Protocol`s dos engines e das portas | Não |
| `features` | Indicadores causais e feature store | Não |
| `engines` | Regras de negócio (1–11) | Não |
| `orchestration` | Gates, máquinas de estado, orquestrador (12) | Não |
| `telemetry` | Sinks e métricas (14) | Sim (escrita) |
| `adapters` | Broker (15), dados de mercado, calendário | Sim (leitura/escrita) |
| `configuration` | Carga e validação de configuração | Sim (leitura) |
| `cli` | Composição e entrada de processo | Sim |

## 3. Os 15 módulos

| # | Módulo | Arquivo | Gate | Saída |
|---|---|---|---|---|
| 1 | Data Quality Engine | `engines/data_quality.py` | G0 | `DataQualityReport` |
| 2 | Session Engine | `engines/session.py` | (insumo de G2) | `SessionState` |
| 3 | Macro Engine | `engines/macro.py` | G1 | `MacroAssessment` |
| 4 | Market Regime Engine | `engines/regime.py` | G2 | `RegimeAssessment` |
| 5 | Structure Engine | `engines/structure.py` | (insumo de G4) | `StructureAssessment` |
| 6 | Liquidity Engine | `engines/liquidity.py` | G3 | `LiquidityAssessment` |
| 7 | Acceptance Engine | `engines/acceptance.py` | G4 | `AcceptanceAssessment` |
| 8 | Flow Engine | `engines/flow.py` | G5 | `FlowAssessment` |
| 9 | Execution Engine | `engines/execution.py` | G6 | `TradePlan` |
| 10 | Risk Engine | `engines/risk.py` | G7 | `RiskAssessment` |
| 11 | Position State Router | `engines/position_router.py` | G8 | `PositionAssessment` |
| 12 | Decision Orchestrator | `orchestration/orchestrator.py` | todos | `DecisionRecord` |
| 13 | Feature Store | `features/store.py` | — | consulta as-of |
| 14 | Telemetry | `telemetry/` | — | JSONL + métricas |
| 15 | Broker Adapter | `adapters/broker_shadow.py` | — | `ReadOnly` / `Shadow` |

O registry de maturidade (`engines/maturity.py`) alimenta o G9 e é
deliberadamente **configuração**, não inferência em runtime — ver
[`GATES.md`](GATES.md#g9--edge-maturity).

## 4. Fluxo de uma avaliação

```
 1. SessionEngine.classify           → fase de sessão
 2. DataQualityEngine.assess         → G0   ─┐
 3. MacroEngine.assess               → G1    │  qualquer FAIL crítico
 4. RegimeEngine.assess              → G2    │  interrompe aqui e o
 5. LiquidityEngine.assess           → G3    │  registro guarda
 6. StructureEngine + Acceptance     → G4    │  short_circuited_at
 7. FlowEngine.assess(side)          → G5    │
 8. RiskEngine.risk_budget           →       │
    ExecutionEngine.build_plan       → G6    │
 9. RiskEngine.assess(plan)          → G7    │
10. PositionStateRouter.assess       → G8    │
11. EdgeMaturityRegistry.assess      → G9   ─┘
12. Agregação → Decision → DecisionRecord → telemetria (+ shadow broker)
```

O curto-circuito é intencional: além de barato, ele torna o diagnóstico
trivial — `blocked_at` na telemetria diz exatamente onde o sistema para, e com
que frequência.

### Ordem de dimensionamento

O plano é construído **depois** do orçamento de risco, e o G7 revalida o plano
já dimensionado. Sem essa ordem, o Execution Engine precisaria conhecer o
estado da conta — acoplamento que quebraria a separação entre geometria e
risco.

## 5. Decisões de projeto e seus porquês

**Por que `Protocol` em vez de classes-base?**
Trocar uma implementação (por exemplo, um Flow Engine com tick data real) não
deve exigir herdar de nada nem tocar no orquestrador. `EngineBundle` é um
dataclass: substituir um engine é substituir um campo.

**Por que `Measurement` em vez de `float`?**
Porque `float` não carrega proveniência. Com `float`, a regra "proxy deve ser
identificado" depende de disciplina humana; com `Measurement`, ela é imposta
pelo construtor.

**Por que `EventTiming` obrigatório em todo evento?**
Porque a alternativa — um único `timestamp` — colapsa quatro conceitos
distintos (detecção, confirmação, disponibilidade, invalidação) e torna o
look-ahead indetectável.

**Por que `BarSeries` não é uma lista?**
Porque uma lista permite `bars[5] = nova_barra`. A classe impõe append-only e
ordenação estrita, e recusa duplicata — as três formas comuns de reescrever
histórico.

**Por que curto-circuito e não avaliar tudo?**
Um sistema que avalia todos os gates mesmo após um FAIL crítico convida a
lógica "mas os outros nove passaram". Não passaram: a avaliação parou.

## 6. Extensão

Para substituir um engine baseline:

```python
class MeuFlowEngine:                    # nenhum import necessário
    def assess(self, ctx, side): ...    # devolve FlowAssessment

bundle = dataclasses.replace(EngineBundle.baseline(), flow=MeuFlowEngine())
orch = DecisionOrchestrator(engines=bundle)
```

A nova implementação deve passar pelos mesmos testes de causalidade. Se ela
consumir dados reais de fluxo, `uses_proxy=False` passa a ser legítimo — e o
G5 poderá retornar `PASS`, reduzindo a contagem de gates `CONDITIONAL`.

## 7. O que a arquitetura deliberadamente **não** faz

- Não gerencia posição aberta (trailing, parcial, breakeven). O MVP só decide
  entrada; `PositionLifecycle` tem os estados, mas não há engine que os dirija.
- Não faz reconciliação com corretora. Sem execução real, não há o que
  reconciliar — e a ausência é declarada em `PositionAssessment.state_known`.
- Não persiste estado entre execuções. Feature store e telemetria são
  in-memory/arquivo; um shadow mode contínuo exige persistência real.
