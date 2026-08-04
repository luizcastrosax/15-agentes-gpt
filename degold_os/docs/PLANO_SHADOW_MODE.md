# Plano de Shadow Mode

> **Status: não iniciado.** O Gate G9 está em `RESEARCH`; o shadow mode só
> começa depois que o [plano de backtest](PLANO_BACKTEST.md) for cumprido e a
> evidência registrada.

## 1. O que é shadow mode aqui

O sistema roda **em paralelo ao mercado real, em tempo real**, com dados de
produção, produzindo `SHADOW_INTENT` — intenções completas e carimbadas que
**nunca** viram ordem. O `ShadowBrokerAdapter` registra cada intenção; nenhum
adapter desta versão é capaz de submeter ordem a uma corretora.

Shadow mode responde a perguntas que backtest nenhum responde:

1. Os dados chegam quando o backtest assumiu que chegam? (`ingestion_latency`
   real vs. configurada)
2. A frequência de setups em tempo real bate com a do backtest?
3. O sistema fica de pé por sessões inteiras sem intervenção?
4. As decisões são reprodutíveis a partir do `DecisionRecord` gravado?

## 2. Pré-requisitos de entrada

Todos obrigatórios; qualquer um faltando mantém G9 em `FAIL`.

| # | Requisito | Verificação |
|---|---|---|
| 1 | Backtest OOS concluído com critérios do §9 do plano de backtest | `evidence_ref` no relatório |
| 2 | Walk-forward concluído e estável | idem |
| 3 | `MaturityLadder` promovida degrau a degrau até `SHADOW_MODE`, com aprovação humana | histórico da escada |
| 4 | Feed de dados de produção com heartbeat | G0 depende disso |
| 5 | Calendário macro com `published_at` | senão G1 bloqueia tudo |
| 6 | Estado de conta e posição disponíveis e frescos | senão G7/G8 bloqueiam tudo |
| 7 | Telemetria persistente em disco durável | é o único registro do experimento |
| 8 | `execution_mode = SHADOW` e `stage = SHADOW_MODE` na configuração | `validate-config` |

Os requisitos 4–6 merecem ênfase: sem eles o sistema roda, mas produz apenas
`NO_TRADE`, e um shadow mode que nunca gera intenção não mede nada.

## 3. Duração e amostra

| Critério | Mínimo |
|---|---|
| Duração | 20 sessões de pregão |
| Intenções geradas | 30 |
| Sessões sem incidente operacional | 15 consecutivas |

Se ao fim de 20 sessões houver menos de 30 intenções, **estenda o período** em
vez de afrouxar os gates. Afrouxar gate para gerar amostra é inverter a ordem
da evidência.

## 4. O que medir

### Operacional (é isto que o shadow mode existe para medir)

| Métrica | Fonte | Alvo |
|---|---|---|
| Uptime por sessão | telemetria contínua | ≥ 99% da janela |
| `eval_ms` p99 | `DecisionRecord.eval_ms` | dentro do orçamento declarado |
| Latência real de ingestão | `available_at` observado − `close_time` | ≤ `ingestion_latency_ms` configurado |
| Taxa de `G0 FAIL` | `blocked_at` | < 1% das avaliações |
| Distribuição de `blocked_at` | métricas agregadas | comparável ao backtest |
| Reprodutibilidade | reexecutar decisões a partir do JSONL | 100% idênticas |

### Comparação com backtest

| Métrica | Comparação |
|---|---|
| Intenções por sessão | shadow vs. backtest no mesmo regime |
| Distribuição de `rr_net` planejado | shadow vs. backtest |
| Distribuição de stop em ticks | shadow vs. backtest |
| Perfil de `blocked_at` | shadow vs. backtest |

Divergência material aqui significa que o backtest não representa a realidade
— e o problema é do backtest, não do mercado.

### Resultado hipotético

Pode-se calcular o resultado que as intenções teriam tido, com o simulador de
preenchimento do plano de backtest. **Esse número é hipotético e precisa ser
rotulado como tal em todo relatório.** Ele não é PnL: nada foi executado, e
não há efeito de mercado, fila ou rejeição.

## 5. Operação diária

1. **Antes da sessão:** `validate-config`; conferir `config_hash` contra o
   esperado; confirmar frescor do calendário macro; confirmar feed vivo.
2. **Durante:** monitorar `blocked_at` e `eval_ms`; nenhuma alteração de
   configuração com o sistema rodando — mudar config no meio da sessão
   invalida a comparabilidade das decisões daquele dia.
3. **Depois:** arquivar o JSONL do dia; rodar as métricas agregadas; registrar
   incidentes com carimbo de tempo.

Qualquer alteração de regra ou limiar **reinicia a contagem de sessões** e
exige bump de `ruleset_version`. Sem isso, o experimento mistura duas
populações.

## 6. Critérios de saída

### Sucesso → candidato a `LIVE_PILOT`

Todos:

- Critérios operacionais do §4 atingidos
- Perfil de decisão compatível com o backtest
- Resultado hipotético consistente com a expectativa OOS (mesmo sinal,
  magnitude na mesma ordem)
- Nenhum incidente de causalidade (decisão irreprodutível, dado futuro, etc.)

> **Importante:** atender a estes critérios **não** habilita operação real
> nesta versão. `MaturityLadder.promote` recusa qualquer estágio acima de
> `SHADOW_MODE`, porque não existe caminho de execução real implementado.
> Ir além exige: adapter de corretora, reconciliação de posição, gestão de
> ordens, kill switch e um plano de contingência — nada disso está aqui.

### Falha → volta para `RESEARCH`

Qualquer um basta:

- Frequência de setups desviando materialmente do backtest
- Latência real acima da assumida (o backtest está errado)
- Taxa de `G0 FAIL` acima de 1%
- Qualquer decisão não reproduzível a partir do registro
- Qualquer violação de causalidade detectada

`MaturityLadder.demote` não exige aprovação: em segurança, retroceder deve ser
sempre mais fácil que avançar.

## 7. Riscos do próprio shadow mode

| Risco | Mitigação |
|---|---|
| Ficar em shadow indefinidamente sem decisão | Prazo e critérios fixados **antes** de começar |
| Ajustar gates para "gerar sinais" | Qualquer ajuste reinicia a contagem e bumpa `ruleset_version` |
| Confundir resultado hipotético com PnL | Rótulo obrigatório em todo relatório |
| Amostra pequena lida como conclusiva | Intervalo de confiança obrigatório; 30 intenções é o mínimo para observar, não para concluir |
| Sobrevivência por sorte de regime | Registrar o regime dominante do período; um shadow inteiro em `BALANCE` não valida `TREND` |

## 8. O que este plano não cobre

- Operação real, gestão de ordens vivas e reconciliação com corretora.
- Kill switch e procedimento de emergência.
- Persistência de estado entre reinícios (o feature store atual é in-memory).
- Múltiplos instrumentos ou múltiplas estratégias simultâneas.
