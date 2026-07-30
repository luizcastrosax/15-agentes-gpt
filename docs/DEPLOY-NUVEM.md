# ☁️ Subir o backend na nuvem (Render) — Fase 1

Objetivo: colocar o backend do ParkFlow no ar com **endereço público**, para
receber o webhook do PIX e cobrar de verdade. **Sem hardware, ~5 minutos.**

Já deixei o arquivo `render.yaml` pronto — o Render lê ele e cria tudo sozinho.

---

## Passo a passo

1. Acesse **render.com** e crie a conta (pode entrar com o GitHub).
2. Clique em **New +** → **Blueprint**.
3. Conecte o repositório **`luizcastrosax/15-agentes-gpt`** e selecione a branch
   **`claude/parking-automation-system-3ddjwo`** (ou a `main`, se já tiver feito o merge do PR).
4. O Render mostra o serviço **parkflow** detectado pelo `render.yaml`. Clique em **Apply**.
5. Aguarde o deploy (1–2 min). No fim, você recebe um endereço tipo:
   **`https://parkflow.onrender.com`**

Teste abrindo `https://parkflow.onrender.com/api/health` → deve responder `{"ok":true}`.
E `https://parkflow.onrender.com/cliente` abre o app do cliente rodando no backend real.

---

## Configurar suas chaves (variáveis de ambiente)

No painel do serviço → **Environment** → adicione:

| Variável | Valor |
|---|---|
| `PIX_KEY` | seu CPF (05254501499) |
| `PIX_NAME` | seu nome / razão social |
| `PIX_PROVIDER` | `mock` por enquanto → `mercadopago` quando tiver o token |
| `MP_ACCESS_TOKEN` | *(cole quando tiver — começa com `APP_USR-`)* |
| `PIX_WEBHOOK_URL` | `https://parkflow.onrender.com/api/webhook/pix` |

> 🔒 Marque `MP_ACCESS_TOKEN` como **secret**. Nunca me mande esse token no chat.

Salve → o Render reinicia sozinho com as novas configs.

---

## Ligar o webhook do Mercado Pago

1. No painel do Mercado Pago → **Suas integrações** → sua aplicação → **Webhooks**.
2. Aponte para: `https://parkflow.onrender.com/api/webhook/pix`
3. Selecione o evento **Pagamentos (payment)**.

Pronto: cliente paga → Mercado Pago avisa seu backend → o sistema confirma e libera. ✅

---

## Avisos importantes (plano grátis)

- O plano **free** do Render **hiberna** após ~15 min sem acesso e **acorda** na próxima
  chamada (pode atrasar o 1º pedido alguns segundos). Para produção 24h, use um plano pago
  (a partir de ~US$ 7/mês) ou o mini PC no local (Fase 3).
- O banco SQLite no plano free fica em **disco temporário** — ótimo para testar, mas os
  dados **reiniciam** a cada novo deploy. Para dados permanentes: plano com **disco** no
  Render, ou migrar para PostgreSQL (te ajudo quando chegar a hora).

---

## Alternativa: rodar no mini PC do estacionamento (Fase 3)

1. Instale Node 22.5+ no mini PC/Raspberry.
2. `cd server && cp .env.example .env` (preencha suas chaves) e `npm start`.
3. Para o webhook chegar da internet até o mini PC, use um **Cloudflare Tunnel**
   (grátis): `cloudflared tunnel --url http://localhost:4000` → ele te dá uma URL
   pública que você usa no `PIX_WEBHOOK_URL` e no webhook do Mercado Pago.
