'use strict';
/* Motor de tarifas — mesma lógica do front-end, no servidor (fonte da verdade). */

function calcCharge(mins, t) {
  if (mins <= t.graceMin) return 0;
  let price = t.firstPrice;
  const extra = mins - t.firstMin;
  if (extra > 0) price += Math.ceil(extra / t.addMin) * t.addPrice;
  const days = Math.max(1, Math.ceil(mins / 1440));      // teto de diária por período de 24h
  price = Math.min(price, t.dailyMax * days);
  return Math.round(Math.max(price, t.minPrice || 0) * 100) / 100;
}

/* Aplica benefício de convênio sobre o valor bruto. */
function applyPartner(gross, mins, partner, tariff) {
  if (!partner) return 0;
  if (partner.type === 'free') return gross;
  if (partner.type === 'discount') return Math.min(gross, partner.value);
  if (partner.type === 'percent') return Math.round(gross * partner.value) / 100;
  if (partner.type === 'freehours') {
    const reduced = calcCharge(Math.max(0, mins - partner.value * 60), tariff);
    return Math.round((gross - reduced) * 100) / 100;
  }
  return 0;
}

module.exports = { calcCharge, applyPartner };
