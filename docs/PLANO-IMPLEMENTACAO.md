# 🚀 ParkFlow — Plano de Implementação Real

Do protótipo para o estacionamento funcionando de verdade, em fases que
**se pagam sozinhas** — cada uma já traz retorno antes de investir na próxima.

Legenda: 🧑‍💻 = eu faço (software) · 🧑 = você faz (conta/compra/físico) · ✅ = pronto quando…

---

## FASE 1 — Cobrança PIX real (SEM equipamento) 💰
> Objetivo: já receber pagamento de verdade na sua conta, ainda com operador conferindo.

| Passo | Quem |
|---|---|
| Criar conta **Mercado Pago** (ou banco PJ com API PIX) | 🧑 |
| Gerar o **Access Token de produção** | 🧑 |
| Hospedar o backend num lugar acessível (nuvem para testar, ou mini PC + túnel) | 🧑‍💻 (te guio) |
| Configurar `.env` (PIX_KEY = seu CPF, MP_ACCESS_TOKEN, PIX_WEBHOOK_URL) | 🧑‍💻 |
| Apontar o **webhook** do Mercado Pago para o backend | 🧑‍💻 |
| Testar: cobrança → pagamento real → confirmação automática | 🧑‍💻 |

✅ **Pronto quando:** um pagamento PIX real cai na sua conta e o sistema confirma sozinho.
💵 **Custo:** ~R$ 0 (só a taxa do PIX por transação, se houver). Sem hardware.

---

## FASE 2 — Cancela automática 🚧
| Passo | Quem |
|---|---|
| Comprar **placa de relé** (USB ou de rede Shelly/USR) | 🧑 |
| Ligar o relé na controladora da cancela | 🧑 (ou técnico) |
| Ativar `GATE_DRIVER` no `.env` | 🧑‍💻 |
| Testar: pagamento confirmado → cancela abre sozinha | 🧑‍💻 |

✅ **Pronto quando:** paga o PIX e a cancela sobe sem ninguém apertar nada.
💵 **Custo:** relé R$ 50–150 (a cancela em si você já tem/compra à parte).

---

## FASE 3 — Totem: botão + impressora 🖨️
| Passo | Quem |
|---|---|
| Comprar **impressora térmica ESC/POS** + **botão** + **leitor de QR** | 🧑 |
| Instalar o **mini PC/Raspberry** no local rodando o backend | 🧑 (te guio) |
| Ativar `PRINTER_DRIVER` no `.env` | 🧑‍💻 |
| Ligar o botão de entrada e o leitor de saída | 🧑 (ou técnico) |

✅ **Pronto quando:** cliente aperta botão → sai ticket → paga → escaneia → cancela abre. **Sem funcionário.**
💵 **Custo:** impressora R$ 250–500 · botão/leitor R$ 130–330 · mini PC R$ 300–600.

---

## FASE 4 — Placa (LPR) e fiscal 📷
| Passo | Quem |
|---|---|
| Câmera **LPR** lê a placa (dispensa o ticket) | 🧑 + 🧑‍💻 |
| Emissão de **cupom fiscal (NFC-e)**, se o seu regime exigir | 🧑 (contador) + 🧑‍💻 |

✅ **Pronto quando:** entra e sai só pela placa, com nota fiscal.

---

## 🎯 COMECE AQUI — Fase 1, passo 1

**Criar/entrar na sua conta Mercado Pago e gerar o token de produção.**

1. Acesse **mercadopago.com.br** → entre ou crie a conta (pode ser pessoa física no começo).
2. Vá em **"Seu negócio" → "Configurações" → "Gestão e administração" → "Credenciais"**.
3. Copie o **Access Token de PRODUÇÃO** (começa com `APP_USR-...`).

> ⚠️ **Nunca cole o token aqui no chat nem no GitHub.** Ele é como a senha da sua
> maquininha — vai **só** no arquivo `.env` privado do servidor. Me avise quando
> tiver o token em mãos que eu te guio onde colar, sem você me mostrar ele.

---

## Onde o sistema vai rodar?

- **Para testar já (recomendado):** um servidor de nuvem barato/grátis (Render, Railway,
  Fly.io). Sobe em minutos, tem endereço público para o webhook, sem hardware.
- **Em produção no local:** mini PC/Raspberry no estacionamento + túnel (Cloudflare Tunnel)
  para o webhook chegar. Ideal quando entrar o hardware (cancela/impressora).

Dá para começar na nuvem (Fase 1) e migrar para o mini PC quando chegar a Fase 3.
