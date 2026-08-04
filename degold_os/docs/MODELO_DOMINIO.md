# Modelo de domínio, enums, contratos e máquinas de estado

## 1. Enums

Definidos em `domain/enums.py`. Os valores são strings estáveis e fazem parte
do contrato serializado: renomear um exige bump de `RULESET_VERSION`.

| Enum | Valores |
|---|---|
| `GateStatus` | `PASS`, `CONDITIONAL`, `FAIL`, `NOT_AVAILABLE` |
| `GateId` | `G0_DATA` … `G9_EDGE_MATURITY` |
| `Decision` | `NO_TRADE`, `OBSERVE`, `SHADOW_INTENT`, `LIVE_ORDER`¹ |
| `ExecutionMode` | `READ_ONLY`, `SHADOW`, `LIVE`¹ |
| `EdgeMaturityStage` | `RESEARCH` … `LIVE_FULL` (ordenado) |
| `Timeframe` | `H4`, `M15`, `M5`, `M2`, `M1` |
| `SessionPhase` | `ASIA`, `LONDON`, `PRE_NY`, `NY_OPEN`, `NY_MIDDAY`, `NY_CLOSE`, `OUT_OF_SCOPE`, `MARKET_CLOSED`, `UNKNOWN` |
| `MarketRegime` | `TREND_UP`, `TREND_DOWN`, `BALANCE`, `EXPANSION`, `UNKNOWN` |
| `VolatilityRegime` | `COMPRESSED`, `NORMAL`, `ELEVATED`, `EXTREME`, `UNKNOWN` |
| `TrendDirection` | `UP`, `DOWN`, `SIDEWAYS`, `UNKNOWN` |
| `Side` | `LONG`, `SHORT` |
| `StructureEvent` | `BOS_UP`, `BOS_DOWN`, `CHOCH_UP`, `CHOCH_DOWN`, `NONE` |
| `LiquidityPoolKind` | `PREV_DAY_HIGH/LOW`, `SESSION_HIGH/LOW`, `EQUAL_HIGHS/LOWS`, `SWING_HIGH/LOW` |
| `SweepOutcome` | `PENDING`, `REJECTED`, `ACCEPTED_THROUGH`, `NO_INTERACTION` |
| `AcceptanceVerdict` | `REJECTION`, `ACCEPTANCE`, `INDECISION`, `NOT_AVAILABLE` |
| `FlowVerdict` | `SUPPORTIVE`, `NEUTRAL`, `OPPOSED`, `NOT_AVAILABLE` |
| `DataQualityStatus` | `OK`, `DEGRADED`, `UNUSABLE`, `NOT_AVAILABLE` |
| `SourceKind` | `DIRECT`, `DERIVED`, `PROXY`, `SYNTHETIC` |
| `Confidence` | `LOW`, `MEDIUM`, `HIGH`, `UNKNOWN` |
| `PositionState` | `FLAT`, `PENDING_ENTRY`, `OPEN`, `SCALING_OUT`, `PENDING_EXIT`, `BLOCKED` |
| `OrderType` / `TimeInForce` | `MARKET`/`LIMIT`/`STOP`/`STOP_LIMIT` — `DAY`/`GTC`/`IOC` |
| `RiskBreach` | limites diários, nº de trades, perdas consecutivas, risco por trade, estado desconhecido/obsoleto |

¹ Presentes no enum como alvo futuro; recusados em runtime nesta versão.

**Nenhum enum tem valor que signifique "ausência por omissão".** Onde a
ausência é possível, ela é `UNKNOWN`/`NOT_AVAILABLE` explícito ou `None`.

## 2. Primitivas temporais

### `EventTiming`

Quatro carimbos, obrigatórios em todo evento:

- `detected_at` — quando o sistema percebeu o fato.
- `confirmed_at` — quando o fato deixou de ser provisório (`None` = pendente).
- `available_at` — a partir de quando o fato pode ser **usado**. Inclui a
  latência de ingestão. **É o único carimbo consultado pelas queries as-of.**
- `invalidated_at` — quando o fato deixou de valer.

Invariantes verificadas no construtor:
`detected_at ≤ confirmed_at ≤ available_at ≤ invalidated_at`.

`confirm()` e `invalidate()` retornam **novos** objetos; chamá-las duas vezes
levanta `CausalityViolation` (histórico confirmado não se reescreve).

### `AsOf`

Wrapper de `datetime` que existe para que o cursor temporal da avaliação não
seja confundido com nenhum outro `datetime` nas assinaturas — a origem mais
comum de look-ahead acidental.

`datetime` naive é recusado em todo o sistema: fuso ambíguo é look-ahead
silencioso.

## 3. Medida com proveniência

```python
Measurement(value, unit, source, proxy_for=None, method="", sample_size=None)
MissingMeasurement(reason, unit="", expected_source="")
```

- `source=PROXY` **exige** `proxy_for` (nome da grandeza substituída), sob
  pena de `ContractViolation`.
- `source≠PROXY` não pode declarar `proxy_for`.
- Ausência é `MissingMeasurement` com motivo — nunca `0.0`, nunca `Measurement`
  com valor default.

Nenhum engine devolve `float` cru. Isso transforma "proxy deve ser
identificado" de convenção em invariante de tipo.

## 4. Mercado

| Tipo | Papel | Invariantes principais |
|---|---|---|
| `Instrument` | Contrato negociado | `tick_size > 0`, `point_value > 0`; conversões ponto↔dinheiro |
| `Bar` | Barra OHLCV | duração bate com o timeframe; OHLC coerente; não pode ser confirmada antes do próprio `close_time`; `volume=None` = ausente |
| `BarSeries` | Série de um timeframe | append-only; recusa duplicata e desordem; `closed_as_of` é o único acessor causal |
| `QuoteSnapshot` | Topo de livro | todos os campos opcionais; `spread=None` quando falta bid/ask |
| `MarketSnapshot` | Todo o dado visível em `as_of` | carrega frescor do feed |

`BarSeries.forming_at()` existe apenas para telemetria — nenhuma feature pode
consumi-lo, e há teste garantindo que a barra em formação não aparece em
`closed_as_of`.

## 5. Eventos

Todos imutáveis, com `EventTiming` e id determinístico (mesma entrada ⇒ mesmo
id, o que torna a auditoria comparável entre execuções).

- **`MacroEvent`** — entrada de calendário. `available_at` = publicação da
  entrada, não a data do evento.
- **`SwingPoint`** — pivô confirmado por `lookback` barras **posteriores**
  fechadas. `confirmed_at` é o close da última barra da direita, não a do pivô.
- **`LiquidityPool`** — nível de provável acumulação de stops. Sempre
  `PROXY` com `proxy_for="resting_stop_liquidity"`: o sistema não observa
  ordens em repouso, infere a partir de preço.
- **`SweepEvent`** — ciclo `PENDING → REJECTED | ACCEPTED_THROUGH`. A
  confirmação **cria um novo evento** com `supersedes` apontando para o
  pendente; o pendente não é mutado.
- **`StructureSignal`** — BOS/CHoCH confirmado por **fechamento**. Penetração
  por pavio é sweep, não estrutura.

## 6. Saídas dos engines (schemas internos)

`domain/assessments.py`. Todas imutáveis, todas com `to_dict()` e `notes`, e
todas com campos `Optional` onde a ausência é possível.

`DataQualityReport`, `SessionState`, `MacroAssessment`, `RegimeAssessment`,
`StructureAssessment`, `LiquidityAssessment`, `AcceptanceAssessment`,
`FlowAssessment`, `TradePlan`, `RiskAssessment`, `PositionAssessment`,
`MaturityAssessment`.

Duas travas notáveis:

- `TradePlan` recusa geometria incoerente no construtor
  (`stop < entry < target` para LONG; inverso para SHORT).
- `MaturityAssessment` recusa `historical_confidence` quando `oos_completed`
  ou `walk_forward_completed` são falsos. **A regra "confiança histórica só
  existe após OOS e walk-forward" é um erro de tipo, não uma diretriz.**

### Score ≠ taxa de acerto

Dois campos, deliberadamente separados e nunca comparáveis:

- `Confidence` (`LOW`/`MEDIUM`/`HIGH`/`UNKNOWN`) — qualidade **estrutural** do
  sinal no instante. Não é probabilidade de nada.
- `MaturityAssessment.historical_confidence` — estatística **fora da amostra**,
  em `[0,1]`, que só pode existir depois de OOS e walk-forward.

## 7. Decisão

`GateResult` — veredito de um gate. Status ≠ `PASS` exige ao menos uma razão
legível: bloqueio sem razão não é auditável.

`DecisionRecord` — registro imutável e versionado com `code_version`,
`ruleset_version`, `config_hash` e `inputs_digest`. Duas execuções com esses
quatro valores iguais produzem a mesma decisão. `explain()` imprime uma linha
por gate.

Travas do construtor: `LIVE_ORDER` é recusado; `SHADOW_INTENT` exige plano;
`NO_TRADE` não pode carregar plano.

## 8. Contratos (`Protocol`s)

`contracts/engines.py` declara as interfaces dos onze engines;
`contracts/ports.py` declara `BrokerAdapter`, `TelemetrySink` e `FeatureStore`.

Contrato comum a todos os engines:

1. Função pura de `EvaluationContext` → assessment.
2. Sem I/O, sem relógio do sistema, sem aleatoriedade.
3. Nunca levantam exceção por condição de mercado; ausência vira campo `None`
   ou veredito `NOT_AVAILABLE`.
4. Idempotentes.

`BrokerAdapter.supports_live` é a chave de segurança: o orquestrador recusa
qualquer adapter que a declare como `True`.

## 9. Máquinas de estado

`orchestration/state_machines.py`. Cada ciclo de vida é uma tabela de
transições declarada; transições ilegais e retroativas levantam
`ContractViolation`, e todo histórico é append-only.

### Sweep

```
IDLE ──▶ DETECTED ──┬──▶ CONFIRMED_REJECTED ──▶ EXPIRED
                    ├──▶ CONFIRMED_ACCEPTED ──▶ EXPIRED
                    └──▶ EXPIRED
```

Confirmado só pode expirar: nunca volta a pendente, nunca troca de desfecho.

### Setup

```
IDLE ──▶ ARMED ──┬──▶ TRIGGERED ──┬──▶ INVALIDATED (terminal)
                 │                └──▶ EXPIRED     (terminal)
                 ├──▶ INVALIDATED
                 └──▶ EXPIRED
```

### Posição

```
FLAT ──▶ PENDING_ENTRY ──▶ OPEN ──┬──▶ SCALING_OUT ──▶ PENDING_EXIT ──▶ FLAT
                                  └──▶ PENDING_EXIT ──▶ FLAT
qualquer estado ──▶ BLOCKED ──▶ FLAT (só após reconciliação)
```

`FLAT → OPEN` direto é ilegal. `BLOCKED` é absorvente até reconciliação
explícita.

### Escada de maturidade

`MaturityLadder.promote` exige: aprovação humana identificada, referência de
evidência, avanço de exatamente um degrau, OOS + walk-forward para
`SHADOW_MODE`, e **recusa qualquer estágio acima de `SHADOW_MODE` nesta
versão**. `demote` é sempre permitido e não exige aprovação — segurança tem
precedência sobre processo.

## 10. Erros

`DeGoldError` é a base. `CausalityViolation` indica bug de implementação (uso
de informação futura, reescrita de histórico) e **não** é capturada como
condição de mercado. `DataQualityError`, `ConfigurationError`,
`ContractViolation`, `ExecutionModeViolation`, `MaturityViolation` e
`NotAvailableError` cobrem o restante.

No orquestrador, qualquer exceção vira `NO_TRADE` com a razão e o traceback
registrados como evidência — fail-closed, nunca decisão parcial.
