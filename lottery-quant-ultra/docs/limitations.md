# Limitações e integrações pendentes

Esta entrega é o **incremento 1 (Entrega A — núcleo)**. O projeto NÃO está concluído.
Abaixo, o que ainda não existe e o passo exato para implementar.

## Científicas (permanentes, por contrato §27)

- **Não há vantagem preditiva demonstrada** sobre sorteios justos. Frequência, atraso,
  soma, paridade e correlação são descrições históricas, não sinal futuro.
- Cobertura/fechamento são combinatória, não previsão. Melhor cobertura ≠ lucro ≠ alta
  chance absoluta do prêmio principal.
- A garantia de fechamento é **condicional** ao evento “sorteio ⊂ S”, cuja probabilidade
  é pequena e **não** aumenta por escolher S.

## Técnicas (pendentes neste incremento)

| Pendência | O que falta | Passo exato |
|---|---|---|
| Dados oficiais (§12) | Provider CAIXA, raw+hash, snapshots, rulesets, relatório de completude | Confirmar endpoints atuais da CAIXA; preservar resposta crua com URL/instante/status/hash/parser_version; validar domínio, unicidade, lacunas; versionar ruleset com preço/faixas/rateio. A rede deste ambiente pode bloquear a CAIXA (checar `$HTTPS_PROXY/__agentproxy/status`). |
| Persistência (§16) | Postgres/Neon + Drizzle, tabelas e restrições | Provisionar Neon; migrações expand/contract; `unique(portfolio_version_id, combination_rank)`, idempotência. |
| Acesso privado (§5) | Clerk por convite | Configurar Clerk; dono derivado da identidade do servidor em todos os endpoints. |
| APIs /api/v1 (§17) | Route Handlers tipados, erros estruturados, idempotency-key | App Router; validação runtime; 202 para jobs. |
| Async/jobs (§18) | Fila, outbox, leases, fencing token, reconciliação | Fila substituível; job+outbox na mesma transação; at-least-once idempotente. |
| Monte Carlo (§11) | Estimadores + intervalos (Wilson/exato), zero-sucesso | Comparar carteiras nos mesmos sorteios; `1-α^(1/R)` quando 0 sucessos. |
| Solver MIP (§9.3) | Adaptador externo | Status/incumbent/bound/gap; inviável ≠ não encontrado; sem “ótimo” em timeout. |
| Laboratório (§13) | Descritivos, aleatoriedade, Bayes, múltiplos testes | Holm/BH declarados; nulos corretos; exploratório ≠ confirmatório. |
| Backtest/walk-forward/torneio (§14) | Avaliação cronológica | Ordem cronológica; teste externo independente; registrar todas as tentativas. |
| Prêmios/EV (§15) | Centavos, fixos vs rateio, contrafactual | `E[L]=Σ P(X=r)V_r − C`; rateio variável separado de contrafactual. |
| Deploy Vercel (§23) | Projeto Vercel, env, migrações, promoção | Ver `docs/deployment.md`. Integração GitHub/Vercel **não** presumida. |

## Do ambiente de desenvolvimento

- A API oficial da CAIXA pode estar **bloqueada pela política de rede** deste ambiente
  (403 no proxy). Mesmo quando acessível no servidor, é bloqueada no navegador por CORS —
  qualquer consulta ao vivo no cliente exige um proxy/back-end próprio.
