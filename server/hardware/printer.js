'use strict';
/* ═══════════════════════════════════════════════════════════════
   IMPRESSORA de ticket (térmica ESC/POS)
   ───────────────────────────────────────────────────────────────
   Imprime o ticket de entrada com número, data/hora, setor e QR Code.
   Funciona com qualquer impressora térmica ESC/POS (USB ou rede).

   Configuração (.env):
     PRINTER_DRIVER=escpos|mock       (padrão: mock — só monta o texto)
     PRINTER_TYPE=epson|star          (perfil ESC/POS)
     PRINTER_INTERFACE=tcp://192.168.0.100   (rede)
                     ou printer:auto           (USB via node-thermal-printer)
                     ou /dev/usb/lp0           (USB direto)

   Dependência (só em produção): npm i node-thermal-printer
═══════════════════════════════════════════════════════════════ */

const DRIVER = process.env.PRINTER_DRIVER || 'mock';

/**
 * Imprime o ticket de entrada.
 * @param {{ticket:string, plate?:string, sector:string, entryTs:number, qr:string, nome?:string}} t
 * @returns {Promise<{ok:boolean, driver:string, preview:string, error?:string}>}
 */
async function printTicket(t) {
  const preview = buildPreview(t); // representação em texto (útil pra log/mock)
  if (DRIVER !== 'escpos') return { ok: true, driver: 'mock', preview };

  try {
    const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
    const printer = new ThermalPrinter({
      type: PrinterTypes[(process.env.PRINTER_TYPE || 'EPSON').toUpperCase()] || PrinterTypes.EPSON,
      interface: process.env.PRINTER_INTERFACE || 'printer:auto',
    });
    const d = new Date(t.entryTs);
    const pad = n => String(n).padStart(2, '0');
    printer.alignCenter();
    printer.bold(true); printer.setTextSize(1, 1); printer.println(t.nome || 'PARKFLOW'); printer.bold(false);
    printer.setTextNormal(); printer.println('Ticket de Entrada'); printer.drawLine();
    printer.setTextSize(2, 2); printer.println(t.ticket); printer.setTextNormal();
    if (t.plate) { printer.println('Placa: ' + t.plate); }
    printer.alignLeft();
    printer.println(`Data:    ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`);
    printer.println(`Entrada: ${pad(d.getHours())}:${pad(d.getMinutes())}`);
    printer.println(`Setor:   ${t.sector}`);
    printer.drawLine();
    printer.alignCenter();
    printer.printQR(t.qr, { cellSize: 6 });        // QR real p/ pagar/consultar
    printer.println('Guarde este ticket');
    printer.println('apresente na saida');
    printer.cut();
    await printer.execute();
    return { ok: true, driver: 'escpos', preview };
  } catch (e) {
    return { ok: false, driver: DRIVER, preview, error: e.message };
  }
}

function buildPreview(t) {
  const d = new Date(t.entryTs);
  const pad = n => String(n).padStart(2, '0');
  return [
    '        PARKFLOW',
    '     Ticket de Entrada',
    '------------------------',
    '        ' + t.ticket,
    t.plate ? '     Placa: ' + t.plate : null,
    `Data:    ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    `Entrada: ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    `Setor:   ${t.sector}`,
    '------------------------',
    '   [QR] ' + t.qr,
    ' Guarde este ticket',
  ].filter(Boolean).join('\n');
}

module.exports = { printTicket, DRIVER };
