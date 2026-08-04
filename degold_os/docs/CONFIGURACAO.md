# Configuração

Arquivo padrão: `config/degold.mnq.json`. JSON ou YAML (YAML exige `pyyaml`).

Princípios:

- **Sem defaults silenciosos em parâmetros de risco.** Chave ausente aborta o
  boot com `ConfigurationError`. Não existe "configuração parcial".
- Toda a configuração é congelada e hasheada: `config_hash` entra em cada
  `DecisionRecord`. Mudar qualquer valor muda a identidade de auditoria das
  decisões.
- Validações cruzadas entre seções rodam no carregamento (`_cross_validate`).

## `runtime`

| Chave | Descrição |
|---|---|
| `execution_mode` | `READ_ONLY` ou `SHADOW`. `LIVE` é recusado nesta versão. |
| `code_version`, `ruleset_version` | Gravados em cada decisão. Bump de `ruleset_version` sempre que a semântica de um gate, enum ou limiar mudar. |
| `ingestion_latency_ms` | Latência assumida entre o close da barra e sua disponibilidade. Soma em `available_at`. **É premissa, não medição.** |

## `instrument` / `instrument_ref`

Inline ou referência a `config/instruments/*.json`. Campos: `symbol`,
`tick_size`, `point_value` (USD por 1.0 ponto), `currency`, `exchange`.

> ⚠️ Os valores de MNQ no repositório (`tick_size=0.25`, `point_value=2.0`)
> são **configuração**, não fato verificado pelo sistema. Confirme na
> especificação vigente do contrato antes de qualquer uso com dinheiro.

## `session`

| Chave | Descrição |
|---|---|
| `timezone` | Fuso do mercado (`America/New_York`). Janelas em hora local resolvem horário de verão. |
| `trading_weekdays` | 0=segunda … 6=domingo. |
| `windows[]` | `{name, start, end, tradable}`. `name` deve mapear para um valor de `SessionPhase`. `end` é exclusivo; janelas que cruzam a meia-noite são suportadas. |

Padrão do MVP: `PRE_NY` (07:00–09:30) e `NY_OPEN` (09:30–11:00) tradáveis;
demais janelas apenas classificadas.

> **Limitação:** não há calendário de feriados nem meias-sessões. Substituir
> `trading_weekdays` por um calendário CME real é pré-requisito para live.

## `data_quality`

| Chave | Descrição |
|---|---|
| `required_timeframes` | Sem qualquer um deles, nenhuma decisão é possível. |
| `min_bars` | Mínimo de barras confirmadas por timeframe. Abaixo disso ⇒ `UNUSABLE`. |
| `max_staleness_multiple` | Múltiplo da duração do TF acima do qual a série é obsoleta. |
| `max_feed_staleness_seconds` | Idade máxima da última mensagem do feed. |

## `macro`

| Chave | Descrição |
|---|---|
| `require_calendar` | `true` ⇒ calendário ausente vira `NOT_AVAILABLE` e bloqueia. |
| `blackout_before_seconds` / `blackout_after_seconds` | Janela de blackout em torno do evento. |
| `blocking_impacts` | Classificações que bloqueiam (`["HIGH"]` no padrão). Vocabulário da sua fonte. |

## `regime`

| Chave | Descrição |
|---|---|
| `htf` / `mtf` | Timeframes de direção e de volatilidade (`H4` / `M15`). |
| `atr_period`, `atr_percentile_lookback` | Parâmetros do ATR e da janela de percentil. |
| `ema_fast`, `ema_slow` | EMAs de direção no HTF. |
| `vol_percentile_bounds` | Três cortes crescentes em (0,1): `COMPRESSED` / `NORMAL` / `ELEVATED` / `EXTREME`. |
| `allowed_regimes` | Regimes em que o setup pode operar. |

## `structure`

| Chave | Descrição |
|---|---|
| `timeframe` | TF de estrutura (`M2`). |
| `swing_lookback` | Barras de cada lado para confirmar um pivô. Aumentar ⇒ pivôs mais confiáveis e mais tardios. |
| `min_break_ticks` | Rompimento mínimo, em ticks, avaliado **por fechamento**. |

## `liquidity`

| Chave | Descrição |
|---|---|
| `detection_timeframe` / `pool_timeframe` | TF de detecção de sweep (`M5`) e de construção de pools (`M15`). |
| `swing_lookback` | Pivôs usados para `EQUAL_HIGHS`/`EQUAL_LOWS`. |
| `equal_level_tolerance_ticks` | Tolerância de agrupamento de níveis iguais. |
| `min_penetration_ticks` / `max_penetration_ticks` | Faixa que caracteriza sweep. Abaixo: ruído. Acima: rompimento genuíno, não varredura. |
| `confirmation_bars` | Barras que precisam fechar após a penetração. ≥ 1 sempre. |
| `sweep_validity_bars` | Por quantas barras o sweep confirmado permanece "ativo". |
| `max_pools_per_side` | Pools mantidos por lado, escolhidos por proximidade ao preço corrente. |

## `acceptance`

| Chave | Descrição |
|---|---|
| `timeframe` | TF de aceitação (`M1`). |
| `evaluation_bars` | Barras avaliadas após a confirmação do sweep. |
| `max_time_beyond_ratio` | Fração máxima de fechamentos além do nível para caracterizar `REJECTION`. |
| `min_rejection_wick_ratio` | Pavio de rejeição mínimo, como fração do range da barra. |

## `flow`

| Chave | Descrição |
|---|---|
| `timeframe`, `lookback_bars` | Base do proxy de participação. |
| `min_volume_ratio` | Participação mínima para `SUPPORTIVE`. |
| `allow_proxy` | `false` ⇒ G5 devolve `NOT_AVAILABLE` (postura correta para quem não aceita decidir com substituto). |

## `execution`

| Chave | Descrição |
|---|---|
| `entry_timeframe` | TF da barra de referência da entrada (`M1`). |
| `entry_offset_ticks` | Deslocamento da entrada STOP a partir do extremo da barra. |
| `stop_buffer_ticks` | Folga do stop além do extremo do sweep. |
| `min_stop_ticks` / `max_stop_ticks` | Sanidade da geometria. Fora da faixa ⇒ sem plano ⇒ G6 `FAIL`. |
| `target_r_multiple` | Alvo em múltiplos de risco. |
| `min_rr_net` | R:R **líquido de custo** mínimo. É este valor que o G6 avalia. |
| `assumed_slippage_ticks` | Slippage por perna. **Premissa, não medição.** |
| `assumed_spread_ticks` | Spread usado quando não há bid/ask. Marcado como `PROXY`. Nunca se assume spread zero. |
| `validity_bars` | Validade da ordem de entrada. |

## `risk`

| Chave | Descrição |
|---|---|
| `max_risk_pct_per_trade` | Percentual do equity por trade. Aceito apenas em (0, 5]. |
| `daily_loss_limit_pct` | Limite de perda diária. |
| `max_trades_per_session` | Nº máximo de trades por sessão. |
| `max_consecutive_losses` | Perdas consecutivas antes de bloquear. |
| `max_contracts` | Teto absoluto de contratos. |
| `block_on_unknown_state` | `true` (padrão) ⇒ conta ou ledger desconhecido bloqueia. Colocar `false` contraria a política fail-closed e gera aviso explícito no registro. |

## `gates`

| Chave | Descrição |
|---|---|
| `treat_not_available_as` | Tradução de `NOT_AVAILABLE`. `PASS` é recusado pelo carregador. |
| `non_critical_gates` | Gates cujo `FAIL` não interrompe. G0, G7, G8 e G9 não podem entrar aqui. |
| `max_conditional_gates` | Máximo de `CONDITIONAL` tolerados. Padrão 5, porque o MVP produz 4 por construção (proxies em G3, G4, G5 e G6). |

## `maturity`

| Chave | Descrição |
|---|---|
| `setup_id` | Identificador do setup. |
| `stage` | Estágio atual. Padrão `RESEARCH`. |
| `oos_completed`, `walk_forward_completed` | Marcadores de validação. |
| `sample_size` | Nº de trades da validação. |
| `historical_confidence` | Só pode ser não-nulo com OOS **e** walk-forward concluídos — o carregador recusa o contrário. |
| `evidence_ref` | Caminho do relatório que sustenta o estágio. Ausente ⇒ G9 `CONDITIONAL`. |
| `min_stage_for_shadow` | Estágio mínimo para emitir `SHADOW_INTENT`. |

## `telemetry`

| Chave | Descrição |
|---|---|
| `enabled` | Liga/desliga a emissão. |
| `sink` | `stdout`, `jsonl` ou `null`. |
| `path` | Arquivo JSONL (obrigatório quando `sink=jsonl`). |
| `log_all_decisions` | `true` registra também os `NO_TRADE` — recomendado: a distribuição de bloqueios é o principal diagnóstico do sistema. |

## Validações cruzadas

No carregamento:

1. Todo timeframe usado por qualquer engine deve constar em
   `data_quality.required_timeframes`.
2. Todo timeframe requerido deve ter entrada em `min_bars`.
3. `historical_confidence` exige OOS + walk-forward.
4. `treat_not_available_as` não pode ser `PASS`.
5. Gates críticos não podem ser declarados não-críticos.
6. Geometria de execução e limites de risco dentro de faixas sãs.
