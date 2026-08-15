'use strict';
/* ═══════════════════════════════════════════════════════════════
   Controle da CANCELA (relé de contato seco)
   ───────────────────────────────────────────────────────────────
   A controladora da cancela abre ao receber um "pulso de contato
   seco" (fecha o contato por ~0,5s, como apertar um botão). Este
   módulo dá esse pulso. Suporta 3 formas de ligar o relé:

     1) GPIO   — Raspberry Pi (biblioteca "onoff")     → GATE_DRIVER=gpio
     2) HTTP   — relé de rede (Shelly, USR-IO, Tasmota) → GATE_DRIVER=http
     3) mock   — só registra no log (sem hardware)      → GATE_DRIVER=mock (padrão)

   Configuração por variáveis de ambiente (.env):
     GATE_DRIVER=gpio|http|mock
     GATE_GPIO_ENTRADA=17     (pino BCM do relé de entrada)
     GATE_GPIO_SAIDA=27       (pino BCM do relé de saída)
     GATE_HTTP_ENTRADA=http://192.168.0.50/relay/0?turn=on
     GATE_HTTP_SAIDA=http://192.168.0.51/relay/0?turn=on
     GATE_PULSE_MS=600
═══════════════════════════════════════════════════════════════ */

const DRIVER = process.env.GATE_DRIVER || 'mock';
const PULSE_MS = parseInt(process.env.GATE_PULSE_MS || '600', 10);

let gpio = null;
if (DRIVER === 'gpio') {
  try {
    const { Gpio } = require('onoff'); // npm i onoff  (somente no Raspberry Pi)
    gpio = {
      entrada: new Gpio(parseInt(process.env.GATE_GPIO_ENTRADA || '17', 10), 'out'),
      saida:   new Gpio(parseInt(process.env.GATE_GPIO_SAIDA   || '27', 10), 'out'),
    };
  } catch (e) {
    console.warn('[gate] driver gpio indisponível (' + e.message + '), caindo para mock.');
  }
}

async function pulseGpio(which) {
  const pin = gpio[which];
  pin.writeSync(1);
  await new Promise(r => setTimeout(r, PULSE_MS));
  pin.writeSync(0);
}

async function pulseHttp(which) {
  const url = which === 'entrada' ? process.env.GATE_HTTP_ENTRADA : process.env.GATE_HTTP_SAIDA;
  if (!url) throw new Error('URL do relé (' + which + ') não configurada');
  // "liga" o relé; muitos módulos já voltam sozinhos, senão desligamos após o pulso
  await fetch(url).catch(e => { throw new Error('falha HTTP no relé: ' + e.message); });
  const off = url.replace('turn=on', 'turn=off');
  if (off !== url) { await new Promise(r => setTimeout(r, PULSE_MS)); await fetch(off).catch(() => {}); }
}

/**
 * Abre a cancela.
 * @param {'entrada'|'saida'} lane  qual cancela acionar
 * @returns {Promise<{ok:boolean, driver:string, error?:string}>}
 */
async function open(lane = 'saida') {
  try {
    if (DRIVER === 'gpio' && gpio) { await pulseGpio(lane); return { ok: true, driver: 'gpio' }; }
    if (DRIVER === 'http') { await pulseHttp(lane); return { ok: true, driver: 'http' }; }
    return { ok: true, driver: 'mock' }; // sem hardware: apenas confirma
  } catch (e) {
    return { ok: false, driver: DRIVER, error: e.message };
  }
}

module.exports = { open, DRIVER };
