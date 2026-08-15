# 🧠 Modelo "tudo online" (sem ticket/impressora) — problemas e soluções

Ideia: QR na cancela → cliente coloca a placa. 1ª vez cadastra (placa, nome, telefone,
modelo) e recebe o comprovante no WhatsApp; nas próximas, a cancela reconhece a placa.
Na saída, lê o QR, paga o PIX e a cancela abre. **Sem impressora, sem papel.**

Ótimo modelo. Abaixo, os riscos reais e como o sistema já os trata.

## 1. 🚨 "Digitou a placa e a cancela abriu" → abre pra qualquer um?
**Risco:** alguém em casa acessa o link e abre a cancela remotamente; ou digita uma
placa qualquer só pra abrir.
**Solução no sistema:**
- O QR da cancela carrega um **token secreto** (`GATE_TOKEN`) — só quem escaneia o QR
  físico consegue mandar o comando. Link de casa não tem o token válido.
- **Sensor de presença (laço indutivo)** na cancela: o backend só abre se há um carro
  detectado (`GATE_REQUIRE_PRESENCE`). É o único item físico além do relé, barato e essencial.
- **Limite de tentativas** por placa/IP (anti-abuso).

## 2. 🅿️ Entrada automática pela placa (2ª vez) — fraude de vaga
**Risco:** alguém que sabe uma placa cadastrada abre a cancela e ocupa vaga.
**Solução:** entrada **não cobra**, então o dano é pequeno; ainda assim o token do QR +
presença limitam. A placa é confirmada visualmente pelo cliente antes de abrir.

## 3. 🚗 Na saída, a cancela abre pro carro certo?
**Risco:** cliente paga pelo celular longe da cancela; ao abrir "porque alguém pagou",
poderia liberar o carro errado (o próximo da fila).
**Solução:** o pagamento é vinculado ao **veículo**, e a abertura da saída exige o
cliente **escanear o QR da cancela de saída** ali na hora (token + presença). Assim só
abre para quem pagou **e** está na cancela.

## 4. 🏃 Sair sem pagar / "colar" no carro da frente (tailgating)
**Risco físico:** carro passa junto com o de frente.
**Solução:** a cancela só abre com pagamento; tailgating é risco físico mitigado por
sensor/tempo de fechamento da cancela (config da controladora). O sistema registra tudo.

## 5. 📵 Cliente sem celular / sem internet / não sabe usar
**Risco:** "tudo online" exclui quem não tem smartphone.
**Solução:** botão **"Preciso de ajuda"** no totem que aciona o operador (WhatsApp/telefone),
e o painel do operador permite **entrada/saída manual**. Sempre há plano B.

## 6. 💬 Enviar o comprovante no WhatsApp
**Realidade:** enviar mensagem **ativa** exige a **API oficial do WhatsApp (Cloud API)**
com template aprovado e opt-in — tem custo e burocracia.
**Solução em 2 níveis:**
- **Simples (já pronto):** o app mostra o comprovante e um botão **"Abrir no WhatsApp"**
  (link `wa.me`) — o cliente salva a conversa com 1 toque, sem custo.
- **Avançado (opcional):** ligar a Cloud API (`WA_PROVIDER=cloud`) para o envio automático.

## 7. 🔒 LGPD — nome, telefone, placa e modelo são dados pessoais
**Solução:** no cadastro há **consentimento explícito** (checkbox + data), os dados ficam
no seu banco, e há política de privacidade. Coletamos só o necessário.

## 8. ⚡ Pagou e a cancela não abriu (rede/relé falhou)
**Solução:** o comando de abrir é **idempotente** e com **retentativa**; o pagamento
nunca se perde (fica registrado); e há botão de **reenviar abertura / chamar suporte**.

## 9. ⏱️ Pagou e demorou a sair (vaga presa)
**Solução:** janela de saída após o pagamento (ex.: 15 min). Passou disso sem sair, é
preciso reconfirmar — evita vaga travada e cobrança indevida.

---

### Resumo do que precisa fisicamente (bem menos que antes)
- ✅ Interligar com a **cancela** (relé) — já pronto no código.
- ✅ **Sensor de presença** (laço indutivo) — barato, essencial pra segurança.
- ✅ Gerar os **QR Codes** das cancelas (entrada/saída) — o sistema gera.
- ❌ Impressora, botão, papel — **eliminados.** 🎉
