# Causalidade e no-repaint

## 1. A regra

> Uma decisão tomada em `T` só pode usar fatos com
> `available_at ≤ T` e `(invalidated_at is None or invalidated_at > T)`.

Tudo neste documento é consequência dessa regra.

## 2. Por que quatro carimbos, e não um

Um único `timestamp` colapsa quatro perguntas distintas:

| Pergunta | Carimbo |
|---|---|
| Quando o sistema percebeu? | `detected_at` |
| Quando deixou de ser provisório? | `confirmed_at` |
| A partir de quando pode ser **usado**? | `available_at` |
| Quando deixou de valer? | `invalidated_at` |

O erro clássico de backtest é usar o `open_time` da barra como carimbo de
disponibilidade. Uma barra M5 que abre 13:30 só é conhecida às 13:35 — usar
seu fechamento para decidir às 13:31 é ler o futuro. Aqui, `Bar.close_time` e
`Bar.timing.available_at` (= `close_time` + latência de ingestão) são campos
distintos, e apenas o segundo governa a visibilidade.

## 3. Onde a causalidade é imposta

### Camada 1 — tipo

`EventTiming` recusa, no construtor, qualquer ordenação impossível de
carimbos. `datetime` naive é recusado em todo o sistema, porque fuso ambíguo é
look-ahead silencioso.

### Camada 2 — acesso

`BarSeries.closed_as_of(T)` é o **único** acessor permitido a features e
engines. Ele filtra por `timing.confirmed_visible_at(T)`, o que exclui:

- barras ainda em formação (sem `confirmed_at`);
- barras fechadas mas ainda não ingeridas (`available_at > T`);
- barras invalidadas.

`BarSeries.forming_at()` existe apenas para telemetria e é explicitamente
proibido em features.

### Camada 3 — construção do contexto

`ReplaySource.snapshot_at(T)` constrói o `MarketSnapshot` contendo **apenas**
barras já disponíveis em `T`. Isso é redundante em relação à camada 2 — e a
redundância é intencional: defesa em profundidade, com as duas camadas
verificadas independentemente pelos testes.

### Camada 4 — confirmação estrutural

Regras que dependem de eventos futuros para confirmar carregam essa espera no
próprio carimbo:

| Evento | Confirmação | `confirmed_at` |
|---|---|---|
| Swing point | `lookback` barras posteriores fechadas | close da última barra da direita |
| Sweep | `confirmation_bars` fechadas após a penetração | close da barra de confirmação |
| BOS/CHoCH | fechamento além do pivô | close da barra que rompeu |

É por isso que `SwingPoint.confirmed_at` **não** é o close da barra do pivô:
usá-lo seria o repaint clássico de pivôs.

### Camada 5 — feature store

`InMemoryFeatureStore.get(name, T)` devolve o registro mais recente com
`available_at ≤ T`, ou `None`. `put` recusa `available_at < as_of` e recusa
regravar o mesmo `(name, as_of)` com valor diferente. Regravar valor idêntico
é idempotente, para permitir reprocessamento.

## 4. No-repaint

Histórico confirmado nunca é reescrito. Três mecanismos:

1. **Objetos imutáveis.** `confirm()` e `invalidate()` retornam novos objetos.
   Chamá-los duas vezes é `CausalityViolation`.
2. **Novo evento com `supersedes`.** Um `SweepEvent` `PENDING` não vira
   `REJECTED`: nasce um novo evento que referencia o antigo.
3. **Séries e máquinas de estado append-only.** `BarSeries.append` recusa
   duplicata e desordem; `StateMachine.to` recusa transição ilegal e transição
   com timestamp retroativo.

## 5. Como isso é testado

`tests/causality/` (26 testes). A estratégia central: comparar a decisão em
`T` sobre dois conjuntos de dados que diferem **apenas** no futuro de `T`.

O prolongamento usado é adversarial — logo após a decisão o preço dispara para
cima, o que invalidaria o setup de reversão se o sistema o enxergasse.

| Teste | O que prova |
|---|---|
| `test_decision_is_identical_with_and_without_future_data` | O `DecisionRecord` inteiro é idêntico |
| `test_inputs_digest_is_identical_...` | Até o digest das entradas é idêntico |
| `test_each_engine_is_blind_to_the_future` | Regime, Structure, Liquidity e Acceptance, isoladamente |
| `test_snapshot_never_exposes_bars_after_as_of` | Nenhuma barra com `available_at > as_of` entra no snapshot |
| `test_forming_bar_is_never_used_by_features` | Decisão no meio de uma barra usa só a anterior |
| `test_atr_is_stable_when_future_bars_are_appended` | Indicadores não mudam retroativamente |
| `test_swing_points_do_not_repaint` | Pivôs idênticos com e sem futuro |
| `test_pivots_confirmed_earlier_remain_pivots_later` | Pivô de `T` continua pivô em `T+k`, mesmo preço |
| `test_macro_event_published_after_as_of_is_invisible` | Revisão de calendário não vaza para o passado |
| `test_confirmed_sweep_never_changes` | Desfecho, id e carimbos estáveis em `T+0…T+20min` |
| `test_confirmed_structure_signals_are_stable_over_time` | Sinais estruturais não mudam |
| `test_pending_sweep_is_promoted_by_creating_a_new_event` | Confirmação cria evento novo com `supersedes` |
| `test_bar_series_refuses_to_rewrite_history` | Reescrita levanta exceção |
| `test_feature_store_refuses_conflicting_rewrite` | Idem, na store |
| `test_feature_store_hides_features_not_yet_available` | Consulta as-of correta |
| `test_as_of_is_the_only_temporal_input` | Duas avaliações do mesmo contexto são idênticas |

## 6. Armadilhas conhecidas (e o que o sistema faz)

| Armadilha | Tratamento |
|---|---|
| Barra parcial tratada como fechada | `resample` descarta bucket incompleto; `Bar` valida duração |
| Pivô que "aparece" retroativamente | `swing_lookback` barras posteriores obrigatórias |
| Rompimento por pavio no meio da barra | Estrutura só por fechamento |
| Calendário macro baixado hoje usado no passado | `published_at` obrigatório; filtro por `available_at` |
| Latência de ingestão ignorada | `ingestion_latency_ms` soma em `available_at` |
| Fuso ambíguo / horário de verão | `zoneinfo`, janelas em hora local, naive recusado |
| Sobrescrita de feature em reprocessamento | Store append-only com detecção de conflito |
| Estado de conta "assumido" | `None` = desconhecido ⇒ bloqueia |

## 7. Limitações honestas

- **A garantia cobre o código, não os dados.** Se o arquivo CSV que você
  fornecer já contiver preços revisados a posteriori (comum em dados
  gratuitos), nenhum mecanismo aqui detecta isso. Barras revisadas pelo vendor
  precisam chegar como novos eventos com `invalidated_at` no registro antigo —
  o modelo suporta, mas os adaptadores atuais não implementam.
- **Latência é premissa, não medição.** `ingestion_latency_ms` é um número
  configurado. Em produção, deve ser medido e monitorado.
- **Não há detecção de survivorship bias nem de reconstrução de contrato.**
  Para futuros com rolagem, a construção da série contínua é uma fonte de
  viés que este sistema não aborda.
