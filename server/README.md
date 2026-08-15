# ParkFlow · Backend (Node.js + SQLite)

Backend real do ParkFlow — API REST, fluxo de pagamento **PIX com webhook** e
banco de dados **SQLite nativo** (`node:sqlite`). **Zero dependências externas**:
não precisa de `npm install`.

## Requisitos
- Node.js **≥ 22.5** (usa o módulo experimental `node:sqlite`).

## Como rodar
```bash
cd server
npm start
# ou:  node --experimental-sqlite --no-warnings server.js
```
O servidor sobe em `http://localhost:4000` e serve:

| Rota          | O que é                                                        |
|---------------|---------------------------------------------------------------|
| `/`           | Página inicial com atalhos                                     |
| `/cliente`    | **App do cliente** (mobile) — pagar pelo celular              |
| `/operador`   | **Painel do operador** (totem, pátio, caixa, relatórios)     |
| `/api/*`      | API REST                                                       |

O banco `parkflow.db` é criado e populado com dados de demonstração na 1ª execução.
Para zerar: `npm run reset`.

## Arquitetura
```
server/
├── server.js    # HTTP + roteador REST + serve os apps estáticos
├── db.js        # SQLite: schema, seed e acesso a dados
├── tariff.js    # Motor de tarifas (fonte da verdade do cálculo)
├── pix.js       # Gerador de BR Code PIX (EMV) com CRC16-CCITT
└── package.json
```

## Fluxo de pagamento PIX
1. Cliente consulta o veículo (`GET /api/consulta`).
2. Cria a cobrança (`POST /api/cobranca`) → servidor calcula o valor, grava a
   transação (`pending`) e gera o **payload PIX copia-e-cola** válido (formato EMV).
3. Em produção, o **banco/PSP chama seu webhook** (`POST /api/webhook/pix`) ao
   confirmar. No protótipo, isso é simulado automaticamente em 2–5s (`autoPix`).
4. Ao confirmar: transação vira `paid`, o veículo é baixado (`pago`) e é
   registrado o evento **"cancela liberada"** (em produção, comando à controladora física).
5. O app do cliente faz *polling* de `GET /api/cobranca/:txid` e mostra o sucesso.

## Endpoints principais
| Método | Rota | Descrição |
|--------|------|-----------|
| GET  | `/api/health` | Status da API |
| GET/PUT | `/api/config` | Configuração e tarifas |
| POST | `/api/entrada` | Registra entrada (detecta mensalista pela placa) |
| GET  | `/api/consulta?plate=&ticket=&partner=` | Consulta + valor calculado |
| POST | `/api/cobranca` | Cria cobrança PIX (ou libera se isento) |
| GET  | `/api/cobranca/:txid` | Status da cobrança (polling) |
| POST | `/api/webhook/pix` | Webhook de confirmação (chamado pelo banco) |
| POST | `/api/cobranca/:txid/simular` | Confirma manualmente (demo) |
| GET  | `/api/patio` | Ocupação e veículos no pátio |
| GET  | `/api/relatorios` | Faturamento, formas de pagamento, série diária |
| GET  | `/api/eventos` | Feed de eventos ao vivo |
| GET  | `/api/mensalistas` · `/api/convenios` | Cadastros |

## Caminho para produção
- Trocar a simulação do webhook pela **API PIX real** do seu banco/PSP
  (ex.: Mercado Pago, Gerencianet, Banco Inter, PagBank).
- No lugar do `logEvent('gate', …)`, enviar o comando real à **controladora da cancela**
  (relé/serial/HTTP do equipamento).
- Câmera **LPR/OCR** publicando a placa lida nos endpoints de entrada/saída.
- SQLite atende bem 1 unidade; para multi-filial, migrar para PostgreSQL (schema equivalente).
