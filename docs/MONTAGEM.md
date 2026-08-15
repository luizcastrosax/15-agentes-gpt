# 🅿️ ParkFlow — Guia de Montagem (protótipo → estacionamento real)

Passo a passo, em linguagem simples, para sair da demonstração e montar o
sistema autônomo de verdade: **cliente aperta o botão → imprime o ticket →
estaciona → paga o PIX → a cancela abre sozinha na saída.**

> A demonstração online (Vercel) serve para mostrar/validar. Para operar de
> verdade, o **backend roda num computador dentro do estacionamento**, ligado
> ao botão, à impressora, ao leitor e à cancela.

---

## 1. Visão geral do que acontece

```
        ENTRADA                                   SAÍDA
   ┌──────────────┐                        ┌────────────────────┐
   │ Cliente      │                        │ Cliente insere/    │
   │ aperta botão │                        │ escaneia o ticket  │
   └──────┬───────┘                        │ (ou câmera lê placa)│
          │                                └─────────┬──────────┘
          ▼                                          ▼
   Backend cria a entrada                   Backend calcula o valor
          │                                          │
   ┌──────┴───────┐                          mostra QR do PIX no totem
   │ imprime ticket│                                 │
   │ + abre cancela│                          Cliente paga o PIX
   └──────────────┘                                 │
                                            Banco chama o WEBHOOK
                                                     │
                                            Backend abre a cancela ✅
```

Tudo isso já está pronto no código (`server/`). Você só liga os equipamentos.

---

## 2. Lista de compras

| Item | Para que serve | Faixa de preço |
|---|---|---|
| **Mini PC ou Raspberry Pi 4** | roda o backend (o "cérebro") | R$ 300–600 |
| **Placa de relé** (USB, ou de rede tipo Shelly/USR) | aciona a cancela | R$ 50–150 |
| **Impressora térmica ESC/POS** (USB ou rede) | imprime o ticket com QR | R$ 250–500 |
| **Botão físico** (arcade/industrial) | cliente chama o ticket na entrada | R$ 30–80 |
| **Leitor de QR Code** (USB, funciona como teclado) | lê o ticket na saída | R$ 100–250 |
| **Cancela automática** com controladora | a barreira em si | R$ 1.500–4.000 |
| **Câmera LPR** *(opcional, Fase 2)* | lê a placa e dispensa o ticket | R$ 200–500 |
| **Roteador/internet** | webhook do PIX chega ao backend | — |

Além disso: **conta PJ com API PIX** (Mercado Pago, Banco Inter, PagBank, Gerencianet…).

---

## 3. Instalar o backend no mini PC / Raspberry

1. Instale o **Node.js 22.5+**.
2. Copie a pasta `server/` para o computador.
3. Configure:
   ```bash
   cd server
   cp .env.example .env      # edite o .env com seus equipamentos
   npm start                 # sobe em http://localhost:4000
   ```
4. Deixe rodando sempre (use `pm2` ou um serviço do sistema para reiniciar sozinho).

Sem `.env`, tudo funciona em **modo simulado** — bom para testar antes de plugar o hardware.

---

## 4. Ligar a CANCELA

A controladora da cancela abre com um **pulso de contato seco** (fecha um contato
por meia-cadastro, como um botão). Você liga a placa de relé nesse contato.

**Opção A — Raspberry Pi (GPIO):**
```bash
npm install onoff
```
No `.env`:
```
GATE_DRIVER=gpio
GATE_GPIO_ENTRADA=17
GATE_GPIO_SAIDA=27
```
Ligue o relé nos pinos 17 (entrada) e 27 (saída) e a saída do relé no borne
"abrir" da controladora.

**Opção B — relé de rede (Shelly/USR/Tasmota):**
```
GATE_DRIVER=http
GATE_HTTP_ENTRADA=http://192.168.0.50/relay/0?turn=on
GATE_HTTP_SAIDA=http://192.168.0.51/relay/0?turn=on
```

> No código, isso aciona a função `abrirCancela()` (arquivo `server/hardware/gate.js`).
> Para a cancela **descer sozinha**, use o laço indutivo/sensor que já acompanha a controladora.

---

## 5. Ligar a IMPRESSORA

```bash
npm install node-thermal-printer
```
No `.env`:
```
PRINTER_DRIVER=escpos
PRINTER_TYPE=epson                 # ou star
PRINTER_INTERFACE=tcp://192.168.0.100   # rede; ou printer:auto (USB); ou /dev/usb/lp0
```
Pronto: a cada entrada, o backend imprime o ticket com número, hora, setor e **QR Code**
(arquivo `server/hardware/printer.js`).

---

## 6. O BOTÃO e o LEITOR de QR

- **Botão de entrada:** ligue-o a uma entrada do Raspberry (GPIO) ou use um botão
  USB. Ao apertar, dispare `POST /api/entrada` (o backend imprime + abre a cancela).
- **Leitor de QR na saída:** a maioria funciona como teclado — ao escanear, ele
  "digita" o número do ticket. O totem de saída consulta `GET /api/consulta` e mostra o PIX.

---

## 7. PIX real (o webhook)

1. Crie a integração no seu banco/PSP (ex.: **Mercado Pago**) e pegue o **Access Token de produção**.
2. No `.env`:
   ```
   PIX_PROVIDER=mercadopago
   MP_ACCESS_TOKEN=APP_USR-xxxxxxxx
   ```
3. No painel do Mercado Pago, aponte o **webhook** para:
   `https://SEU-ENDERECO/api/webhook/pix`
   (exponha o backend com um domínio/DNS ou um túnel como Cloudflare Tunnel).

Fluxo real: cliente paga → Mercado Pago chama seu webhook → backend confirma e
**abre a cancela** (arquivos `server/pix-provider.js` e `server/server.js`).

---

## 8. Ordem recomendada de implantação

1. **Fase 0 — validar:** rode tudo em modo simulado e teste os fluxos no painel.
2. **Fase 1 — pagamento real:** ligue só o `PIX_PROVIDER` (sem hardware) e já cobre de verdade.
3. **Fase 2 — cancela + impressora:** ligue o relé e a impressora.
4. **Fase 3 — automação total:** botão de entrada + leitor de saída (sem funcionário).
5. **Fase 4 — placa (LPR):** câmera lê a placa e dispensa o ticket.

Cada fase funciona sozinha — dá para crescer aos poucos, diluindo o investimento.

---

## 9. Onde cada peça está no código

| Equipamento | Arquivo | Função |
|---|---|---|
| Cancela (relé) | `server/hardware/gate.js` | `open('entrada'\|'saida')` |
| Impressora | `server/hardware/printer.js` | `printTicket(...)` |
| PIX real | `server/pix-provider.js` | `createCharge` / `handleWebhook` |
| Regras de negócio | `server/server.js` | endpoints `/api/*` |

Nenhuma dessas peças quebra o sistema se não estiver instalada — o backend
detecta e cai no modo simulado, registrando tudo no log.
