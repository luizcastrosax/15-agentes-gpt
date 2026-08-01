'use strict';
/* ═══════════════════════════════════════════════════════════════
   WhatsApp — comprovante para o cliente
   ───────────────────────────────────────────────────────────────
   Dois níveis:
     • mock  (padrão): não envia nada ativamente; devolve um link wa.me
       que o cliente toca para abrir a conversa já com o comprovante.
       Custo zero, sem burocracia.
     • cloud: envia a mensagem pela API oficial do WhatsApp (Cloud API).
       Exige app aprovado no Meta e template. Configure por .env:
         WA_PROVIDER=cloud
         WA_TOKEN=EAAG...            (token da Cloud API)
         WA_PHONE_ID=123456789       (id do número remetente)
         WA_BUSINESS_NUMBER=5511...  (seu número, p/ o link wa.me)
═══════════════════════════════════════════════════════════════ */

const PROVIDER = process.env.WA_PROVIDER || 'mock';
const onlyDigits = s => (s || '').replace(/\D/g, '');

/** Monta o texto do comprovante de entrada. */
function ticketText({ ticket, plate, entryTs, sector, estab }) {
  const d = new Date(entryTs); const p = n => String(n).padStart(2, '0');
  return [
    `🅿️ *${estab || 'ParkFlow'}* — comprovante de entrada`,
    ``,
    `Ticket: ${ticket}`,
    plate ? `Placa: ${plate}` : null,
    `Entrada: ${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`,
    sector ? `Setor: ${sector}` : null,
    ``,
    `Guarde esta mensagem. Na saída, informe a placa para pagar. Boa estadia! 🚗`,
  ].filter(Boolean).join('\n');
}

/** Link wa.me que abre o WhatsApp do cliente já com o texto. */
function waLink(phone, text) {
  const to = onlyDigits(phone);
  const base = to ? `https://wa.me/${to.length <= 11 ? '55' + to : to}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(text)}`;
}

/**
 * Envia (ou prepara) o comprovante.
 * @returns {Promise<{sent:boolean, provider:string, link:string, error?:string}>}
 */
async function sendTicket(reg, ticketInfo) {
  const text = ticketText(ticketInfo);
  const link = waLink(reg && reg.phone, text);
  if (PROVIDER !== 'cloud' || !process.env.WA_TOKEN) return { sent: false, provider: 'mock', link };
  try {
    const to = onlyDigits(reg.phone); const num = to.length <= 11 ? '55' + to : to;
    const res = await fetch(`https://graph.facebook.com/v20.0/${process.env.WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: num, type: 'text', text: { body: text } }),
    });
    const data = await res.json();
    if (!res.ok) return { sent: false, provider: 'cloud', link, error: JSON.stringify(data) };
    return { sent: true, provider: 'cloud', link };
  } catch (e) {
    return { sent: false, provider: 'cloud', link, error: e.message };
  }
}

module.exports = { sendTicket, waLink, ticketText, PROVIDER };
