'use strict';
/* ═══════════════════════════════════════════════════════════════
   PIX real — provedor de pagamento
   ───────────────────────────────────────────────────────────────
   Cria a cobrança PIX de verdade e confirma via webhook do banco/PSP.
   Vem com um adaptador para o Mercado Pago (API REST, sem SDK). Para
   Banco Inter, PagBank, Gerencianet etc., a estrutura é a mesma —
   troca-se só o endpoint e o parser.

   Configuração (.env):
     PIX_PROVIDER=mercadopago|mock     (padrão: mock — usa o BR Code local)
     MP_ACCESS_TOKEN=APP_USR-xxxxxxxx  (token de produção do Mercado Pago)
     PIX_WEBHOOK_SECRET=...            (para validar a assinatura, opcional)

   Fluxo:
     1) createCharge()  → cria a cobrança, devolve o "copia e cola" e o id.
     2) o cliente paga.
     3) o Mercado Pago chama seu webhook (POST /api/webhook/pix).
     4) handleWebhook() consulta o pagamento e diz se foi aprovado.
═══════════════════════════════════════════════════════════════ */

const PROVIDER = process.env.PIX_PROVIDER || 'mock';
const MP_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const MP_BASE = 'https://api.mercadopago.com';

/**
 * Cria uma cobrança PIX.
 * @param {{amount:number, description:string, txid:string, payerEmail?:string}} o
 * @returns {Promise<{providerId:string|null, pixPayload:string|null, provider:string, raw?:any, error?:string}>}
 *          Se provider==='mock', retorna pixPayload=null e quem chama usa o BR Code local.
 */
async function createCharge(o) {
  if (PROVIDER !== 'mercadopago' || !MP_TOKEN) return { providerId: null, pixPayload: null, provider: 'mock' };
  try {
    const res = await fetch(`${MP_BASE}/v1/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MP_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': o.txid,           // evita cobrança duplicada
      },
      body: JSON.stringify({
        transaction_amount: Number(o.amount.toFixed(2)),
        description: o.description || 'Estacionamento',
        payment_method_id: 'pix',
        external_reference: o.txid,
        ...(process.env.PIX_WEBHOOK_URL ? { notification_url: process.env.PIX_WEBHOOK_URL } : {}),
        payer: { email: o.payerEmail || 'cliente@parkflow.com.br' },
      }),
    });
    const data = await res.json();
    if (!res.ok) return { providerId: null, pixPayload: null, provider: 'mercadopago', error: JSON.stringify(data) };
    const tx = (data.point_of_interaction || {}).transaction_data || {};
    return {
      providerId: String(data.id),
      pixPayload: tx.qr_code || null,          // "copia e cola" oficial
      qrBase64: tx.qr_code_base64 || null,     // imagem do QR (PNG base64)
      provider: 'mercadopago',
      raw: data,
    };
  } catch (e) {
    return { providerId: null, pixPayload: null, provider: 'mercadopago', error: e.message };
  }
}

/**
 * Processa a notificação (webhook) do provedor e diz se o pagamento foi aprovado.
 * O Mercado Pago envia o aviso ora no corpo JSON ({type,data:{id}}), ora na
 * query string (?topic=payment&id=123) — quem chama já normaliza para {type,id}.
 * @param {{type?:string, id?:string}} n  notificação normalizada
 * @returns {Promise<{paid:boolean, providerId?:string, externalRef?:string, provider:string, error?:string}>}
 */
async function handleWebhook(n) {
  if (PROVIDER !== 'mercadopago' || !MP_TOKEN) {
    // modo mock: o próprio backend simula a confirmação (ver server.js)
    return { paid: false, provider: 'mock' };
  }
  try {
    const type = n && n.type;
    const id = n && n.id;
    if (type !== 'payment' || !id) return { paid: false, provider: 'mercadopago' };
    const res = await fetch(`${MP_BASE}/v1/payments/${id}`, { headers: { 'Authorization': `Bearer ${MP_TOKEN}` } });
    const pay = await res.json();
    if (!res.ok) return { paid: false, provider: 'mercadopago', error: JSON.stringify(pay) };
    return {
      paid: pay.status === 'approved',
      providerId: String(pay.id),
      externalRef: pay.external_reference,   // = nosso txid
      provider: 'mercadopago',
    };
  } catch (e) {
    return { paid: false, provider: 'mercadopago', error: e.message };
  }
}

module.exports = { createCharge, handleWebhook, PROVIDER };
