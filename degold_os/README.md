# DeGold OS Bot — núcleo de decisão

Sistema institucional de **análise e decisão** de mercado: modular, causal,
auditável, no-repaint e fail-closed.

> **Esta versão não opera.** Não existe caminho de código que envie uma ordem
> real. `ExecutionMode.LIVE` é recusado no boot, nenhum broker adapter declara
> `supports_live=True`, e o orquestrador rejeita qualquer adapter que o
> declare. A decisão máxima possível é `SHADOW_INTENT` — uma intenção
> registrada, sem efeito externo — e apenas depois que o Gate G9 atesta o
> estágio `SHADOW_MODE`.

## Pipeline

```
REGIME → LIQUIDITY → ACCEPTANCE → FLOW → EXECUTION
```

instrumentado por dez Decision Gates:

```
G0 DATA → G1 MACRO → G2 REGIME → G3 LIQUIDITY → G4 INTERACTION
       → G5 FLOW → G6 EXECUTION → G7 RISK → G8 POSITION → G9 EDGE MATURITY
```

Cada gate devolve `PASS` | `CONDITIONAL` | `FAIL` | `NOT_AVAILABLE`.
`FAIL` em gate crítico produz `NO_TRADE` imediato. `NOT_AVAILABLE` é traduzido
pela política declarada em `config.gates.treat_not_available_as` — que, na
configuração padrão, é `FAIL`.

## MVP entregue

| Item | Valor |
|---|---|
| Ativo | MNQ (Micro E-mini Nasdaq-100) |
| Sessões | Pré-NY (07:00–09:30 ET) e NY Open (09:30–11:00 ET) |
| Timeframes | H4, M15, M5, M2, M1 |
| Setup | Sweep de liquidez → rejeição/aceitação → confirmação estrutural → fluxo → Risk Gate |
| Modo | `READ_ONLY` (padrão) / `SHADOW` |
| Estágio de maturidade | `RESEARCH` — portanto **G9 barra tudo** até que backtest OOS e walk-forward sejam concluídos |

## Estrutura

```
degold_os/
├── config/
│   ├── degold.mnq.json          # configuração do MVP
│   └── instruments/mnq.json     # especificação do contrato
├── docs/                        # arquitetura, gates, causalidade, planos
├── schemas/                     # JSON Schema dos contratos externos
├── src/degold_os/
│   ├── domain/                  # tipos puros: enums, timing, eventos, decisão
│   ├── contracts/               # Protocols dos engines e das portas
│   ├── engines/                 # implementações baseline (1..11)
│   ├── orchestration/           # gates, máquinas de estado, orquestrador (12)
│   ├── features/                # feature store (13) e indicadores causais
│   ├── telemetry/               # sinks e métricas (14)
│   ├── adapters/                # broker shadow (15), dados, calendário
│   ├── configuration/           # modelos e carregador de configuração
│   └── cli/                     # CLI (validate-config, replay, explain)
└── tests/
    ├── unit/                    # contratos e engines
    ├── causality/               # look-ahead e repaint
    └── integration/             # pipeline completo e CLI
```

## Uso

```bash
cd degold_os
python -m pytest tests -q                    # 192 testes

# valida a configuração e imprime o config_hash
PYTHONPATH=src python -m degold_os.cli.main validate-config

# roda decisões sobre CSVs de barras (um arquivo por timeframe: M1.csv, M5.csv, ...)
PYTHONPATH=src python -m degold_os.cli.main replay \
    --data-dir ./meus_dados --decision-timeframe M1 --macro ./calendario.json

# explica a decisão em um instante, gate a gate
PYTHONPATH=src python -m degold_os.cli.main explain \
    --data-dir ./meus_dados --at 2026-06-02T13:43:00+00:00
```

Não existe comando `live`. Isso é intencional e verificado por teste
(`test_parser_has_no_live_command`).

## Princípios que o código impõe (não apenas documenta)

| Princípio | Onde é imposto |
|---|---|
| Ausência de dado nunca equivale a zero | `MissingMeasurement`, `Optional` em todo campo numérico, `macro_events=None` ≠ `()` |
| Proxy deve ser identificado como proxy | `Measurement` recusa `PROXY` sem `proxy_for`; `_demote_if_proxy` impede `PASS` com proxy |
| Nenhuma feature usa informação futura | `BarSeries.closed_as_of`, `EventTiming.visible_at`, `ReplaySource.snapshot_at` |
| Quatro carimbos em todo evento | `EventTiming` (obrigatório em `Bar`, `LiquidityPool`, `SweepEvent`, `StructureSignal`, `MacroEvent`) |
| Histórico confirmado não é reescrito | `BarSeries.append`, `EventTiming.confirm/invalidate`, `InMemoryFeatureStore.put`, máquinas de estado |
| Score ≠ taxa de acerto | `Confidence` (estrutural) é um tipo distinto de `MaturityAssessment.historical_confidence` |
| Historical Confidence só após OOS + walk-forward | `MaturityAssessment.__post_init__` levanta `ContractViolation` |
| IA adaptativa não aumenta risco nem promove sozinha | `MaturityLadder.promote` exige `approved_by` humano e evidência |
| Falha de API ou dado bloqueia entradas | G0 fail-closed; exceções viram `NO_TRADE` com evidência |
| Toda decisão é explicável e versionada | `DecisionRecord` com `code_version`, `ruleset_version`, `config_hash`, `inputs_digest`, `explain()` |

## Documentação

- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — módulos, dependências, fluxo
- [`docs/GATES.md`](docs/GATES.md) — semântica de cada gate
- [`docs/MODELO_DOMINIO.md`](docs/MODELO_DOMINIO.md) — modelos, enums, contratos, máquinas de estado
- [`docs/CAUSALIDADE.md`](docs/CAUSALIDADE.md) — como o no-repaint é garantido e testado
- [`docs/CONFIGURACAO.md`](docs/CONFIGURACAO.md) — todos os parâmetros
- [`docs/TELEMETRIA.md`](docs/TELEMETRIA.md) — eventos e métricas
- [`docs/PLANO_BACKTEST.md`](docs/PLANO_BACKTEST.md) — protocolo de validação
- [`docs/PLANO_SHADOW_MODE.md`](docs/PLANO_SHADOW_MODE.md) — critérios de entrada, operação e saída
- [`docs/LIMITACOES.md`](docs/LIMITACOES.md) — **leia antes de qualquer uso**

## Limitações (resumo)

O detalhamento está em [`docs/LIMITACOES.md`](docs/LIMITACOES.md). Em uma
frase: **este repositório entrega arquitetura e disciplina causal, não edge
comprovado.** Nenhum backtest foi executado; nenhum dado real de mercado
acompanha o código; o Flow Engine trabalha com proxies porque não há tick data
com agressor; e o Macro Engine não tem calendário embutido.

## Requisitos

Python 3.11+. Nenhuma dependência de runtime. `pytest` para testes; `pyyaml`
opcional (apenas se a configuração for escrita em YAML).
