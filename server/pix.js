'use strict';
/* Gerador de payload PIX "Copia e Cola" no formato EMV (BR Code) com CRC16-CCITT.
   O formato é o mesmo dos bancos reais; a chave aqui é de exemplo (protótipo). */

function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (id, val) => id + String(val.length).padStart(2, '0') + val;

/* Monta um BR Code dinâmico-estático de valor fixo. */
function buildPixPayload({ key, name, city, amount, txid }) {
  const mai = tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', key);
  let payload =
    tlv('00', '01') +                              // Payload Format Indicator
    tlv('26', mai) +                               // Merchant Account Information (PIX)
    tlv('52', '0000') +                            // Merchant Category Code
    tlv('53', '986') +                             // Moeda (BRL)
    tlv('54', amount.toFixed(2)) +                 // Valor
    tlv('58', 'BR') +                              // País
    tlv('59', (name || 'PARKFLOW').slice(0, 25)) + // Nome do recebedor
    tlv('60', (city || 'SAO PAULO').slice(0, 15)) +// Cidade
    tlv('62', tlv('05', (txid || '***').slice(0, 25))); // txid
  payload += '6304';                               // CRC placeholder (id + tamanho)
  return payload + crc16(payload);
}

module.exports = { buildPixPayload, crc16 };
