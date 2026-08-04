# Telemetria

## 1. Princípio

A telemetria **não é um canal paralelo de verdade**. Ela é a serialização do
mesmo `DecisionRecord` que o orquestrador produziu. Não existe informação na
telemetria que não esteja no registro, e vice-versa.

Formato: JSONL (uma linha por evento), append-only — coerente com a regra de
que histórico confirmado não se reescreve.

## 2. Envelope

```json
{
  "schema_version": "1.0.0",
  "event_type": "decision",
  "emitted_at": "2026-06-02T13:43:00.310000+00:00",
  "payload": { "...": "DecisionRecord.to_dict()" }
}
```

Schema em `schemas/telemetry_event.schema.json`; o payload de decisão segue
`schemas/decision_record.schema.json`. Ambos verificados por teste
(`tests/unit/test_schemas.py`).

## 3. Sinks

| Sink | Uso |
|---|---|
| `NullTelemetrySink` | Default seguro (testes, execuções descartáveis) |
| `StdoutTelemetrySink` | Desenvolvimento e pipes |
| `JsonlTelemetrySink` | Arquivo append-only; abre e fecha a cada escrita |

O `JsonlTelemetrySink` sacrifica throughput por durabilidade: em um sistema
que pode ser morto a qualquer momento, perder o buffer significa perder a
auditoria da última decisão — que é exatamente a que interessa.

## 4. Campos de auditoria em cada decisão

| Campo | Para que serve |
|---|---|
| `decision_id` | Chave estável (derivada de `as_of` + instrumento + digest) |
| `as_of` | Instante da decisão |
| `execution_mode`, `session_phase` | Contexto operacional |
| `decision` | `NO_TRADE` / `OBSERVE` / `SHADOW_INTENT` |
| `gates.results[]` | Status, razões, evidência e marca de proxy por gate |
| `gates.short_circuited_at` | Onde o pipeline parou |
| `trade_plan` | Plano completo, quando houver |
| `assessments` | Saída serializada de cada engine |
| `code_version`, `ruleset_version`, `config_hash`, `inputs_digest` | Reprodutibilidade |
| `eval_ms` | Latência da avaliação |
| `warnings` | Avisos não bloqueantes |

Reprodutibilidade: dois registros com os mesmos quatro campos de versão e o
mesmo `inputs_digest` **devem** ter a mesma decisão. Divergência é bug, e é
detectável só com a telemetria.

## 5. Métricas de processo

`telemetry/metrics.py` agrega registros:

```python
from degold_os.telemetry.metrics import aggregate
m = aggregate(records)
m.to_dict()
```

```json
{
  "total": 296,
  "by_decision": { "NO_TRADE": 296 },
  "blocked_at": { "G0_DATA": 41, "G1_MACRO": 255 },
  "gate_status": { "G0_DATA": { "PASS": 255, "FAIL": 41 } },
  "proxy_decisions": 0,
  "latency_ms_avg": 0.9,
  "latency_ms_max": 6.1
}
```

> Estas são métricas de **processo**, não de performance financeira. Elas
> respondem "o sistema está funcionando e por onde ele barra?", nunca "o
> sistema é lucrativo?". Métricas de resultado só existem após backtest OOS e
> walk-forward, e vivem em relatórios separados.

## 6. Como ler `blocked_at`

É o diagnóstico mais útil do sistema.

| Padrão | Leitura provável |
|---|---|
| Concentrado em `G0_DATA` | Problema de dados: histórico curto, gaps, feed |
| Concentrado em `G1_MACRO` | Calendário ausente ou blackouts largos demais |
| Concentrado em `G2_REGIME` | Fora de janela, ou `allowed_regimes` restritivo |
| Concentrado em `G3_LIQUIDITY` | Setup raro — esperado; verifique a faixa de penetração |
| Concentrado em `G4_INTERACTION` | Sweeps ocorrem mas viram aceitação — reveja o setup |
| Concentrado em `G6_EXECUTION` | Geometria/R:R incompatíveis com a volatilidade corrente |
| Concentrado em `G7_RISK` | Estado de conta desconhecido, ou limites atingidos |
| Concentrado em `G9_EDGE_MATURITY` | **Esperado nesta versão**: o setup está em `RESEARCH` |
| Em `AGGREGATION` | Todos os gates avaliados, mas `CONDITIONAL` acima do limite |

## 7. Alarmes sugeridos (não implementados)

O repositório entrega os dados, não o alerting. Candidatos naturais:

- `eval_ms` p99 acima do orçamento de latência.
- Queda abrupta na taxa de `PASS` em G0 (degradação de feed).
- `proxy_decisions / total` subindo (perda de fontes diretas).
- Zero decisões em uma janela de sessão inteira (processo parado).
- Divergência entre `config_hash` observado e o esperado em produção.

## 8. O que **não** é emitido

- Nenhum dado que não esteja no `DecisionRecord`.
- Nenhuma ordem, recibo de corretora ou identificador de conta — não há
  execução real.
- Nenhuma métrica de PnL: sem execução, não existe PnL a reportar.
