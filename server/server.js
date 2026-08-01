'use strict';
/* ═══════════════════════════════════════════════════════════════
   ParkFlow · Backend (Node.js + SQLite, sem dependências externas)
   REST API + fluxo PIX com webhook + serve os apps (cliente/operador).
   Rode com: node --experimental-sqlite server.js   (npm start)
═══════════════════════════════════════════════════════════════ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const D = require('./db');
const { calcCharge, applyPartner } = require('./tariff');
const { buildPixPayload } = require('./pix');
const gate = require('./hardware/gate');          // cancela (relé)
const printer = require('./hardware/printer');     // impressora ESC/POS (opcional)
const pixProvider = require('./pix-provider');     // PIX real (Mercado Pago) ou mock
const whatsapp = require('./whatsapp');            // comprovante no WhatsApp

/* ── Segurança da cancela (modelo online) ── */
const GATE_TOKEN = process.env.GATE_TOKEN || '';               // token embutido no QR físico
const GATE_REQUIRE_PRESENCE = process.env.GATE_REQUIRE_PRESENCE === 'true'; // laço indutivo
const presence = { entrada: false, saida: false };             // estado do sensor de presença
const rateHits = new Map();                                    // anti-abuso por placa
function gateGuard(body, url) {
  const token = (body && body.gateToken) || url.searchParams.get('gate') || '';
  if (GATE_TOKEN && token !== GATE_TOKEN) return { ok: false, code: 403, error: 'gate_token', message: 'Acesso inválido — escaneie o QR na cancela' };
  const key = D.normPlate((body && body.plate) || '') || 'anon';
  const now = Date.now(); const arr = (rateHits.get(key) || []).filter(t => now - t < 60000);
  if (arr.length >= 8) return { ok: false, code: 429, error: 'muitas_tentativas', message: 'Muitas tentativas — aguarde um instante' };
  arr.push(now); rateHits.set(key, arr);
  if (GATE_REQUIRE_PRESENCE) {
    const lane = (body && body.lane) || url.searchParams.get('lane') || 'entrada';
    if (!presence[lane]) return { ok: false, code: 409, error: 'sem_veiculo', message: 'Aproxime o veículo da cancela' };
  }
  return { ok: true };
}
async function notifyEntry(v, reg, cfg) {
  const secName = (D.listSectors().find(s => s.id === v.sector) || {}).name || v.sector;
  const wa = await whatsapp.sendTicket(reg, { ticket: v.ticket, plate: v.plate, entryTs: v.entry_ts, sector: secName, estab: cfg.name });
  D.logEvent('wa', `💬 Comprovante ${v.ticket} ${wa.sent ? 'enviado ao WhatsApp' : '(link wa.me pronto)'}`);
  return wa;
}

D.init();
const PORT = process.env.PORT || 4000;
const ROOT = path.join(__dirname, '..'); // raiz do repo (serve cliente/ e estacionamento/)

/* ---------- helpers ---------- */
const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};
const readBody = req => new Promise(resolve => {
  let d = ''; req.on('data', c => d += c); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
});
const minutesOf = v => Math.max(0, Math.round((Date.now() - v.entry_ts) / 60000));

function vehiclePricing(v, partner) {
  const cfg = D.getConfig();
  const monthly = v.monthly_id ? D.listMonthlies().find(m => m.id === v.monthly_id && m.status === 'ativo') : D.findMonthlyByPlate(v.plate);
  const mins = minutesOf(v);
  const gross = (v.type === 'mensalista' || monthly) ? 0 : calcCharge(mins, cfg.tariff);
  const discount = gross > 0 && partner ? applyPartner(gross, mins, partner, cfg.tariff) : 0;
  const net = Math.max(0, Math.round((gross - discount) * 100) / 100);
  return { mins, gross, discount, net, monthly: monthly || null };
}

const CONTENT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': CONTENT[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ═══════════ FLUXO PIX ═══════════ */
function abrirCancela(vehicle, motivo) {
  // Aciona o relé físico da cancela (entrada ou saída), com 1 retentativa. Mock apenas registra.
  const lane = motivo === 'entrada' ? 'entrada' : 'saida';
  (async () => {
    let r = await gate.open(lane);
    if (!r.ok) { await new Promise(s => setTimeout(s, 500)); r = await gate.open(lane); }  // retenta 1x
    const extra = r.driver === 'mock' ? '' : ` [${r.driver}${r.ok ? '' : ' FALHA: ' + r.error}]`;
    D.logEvent('gate', `🚧 Cancela (${lane}) liberada · ${vehicle.ticket} (${vehicle.plate || 's/ placa'}) · ${motivo}${extra}`);
  })();
}
function confirmarPagamento(txid, origem) {
  const pay = D.getPayment(txid);
  if (!pay || pay.status !== 'pending') return null;
  D.markPaid(txid);
  const v = D.getVehicle(pay.vehicle_id);
  const mins = minutesOf(v);
  D.settleVehicle(v.id, { charge: pay.amount, minutes: mins, method: pay.method, discount: pay.discount, partner: pay.partner });
  D.logEvent('pay', `₽ Pagamento confirmado (${origem}) · ${pay.method.toUpperCase()} · R$ ${pay.amount.toFixed(2)} · ${v.ticket}`);
  abrirCancela(v, 'pagamento ' + pay.method);
  return D.getPayment(txid);
}

/* ═══════════ ROTEADOR ═══════════ */
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

// Saúde
route('GET', /^\/api\/health$/, (req, res) => json(res, 200, { ok: true, service: 'parkflow-api', ts: Date.now() }));

// Tarifa / config
route('GET', /^\/api\/config$/, (req, res) => json(res, 200, D.getConfig()));
route('PUT', /^\/api\/config$/, async (req, res) => { const b = await readBody(req); const c = Object.assign(D.getConfig(), b); if (b.tariff) c.tariff = Object.assign(D.getConfig().tariff, b.tariff); D.setConfig(c); json(res, 200, c); });

// Entrada
// ENTRADA (modelo online por placa): 1ª vez pede cadastro; a partir daí, reconhece.
route('POST', /^\/api\/entrada$/, async (req, res, url) => {
  const b = await readBody(req);
  const g = gateGuard(b, url); if (!g.ok) return json(res, g.code, { error: g.error, message: g.message });
  const cfg = D.getConfig();
  const plate = D.normPlate(b.plate || '');
  if (!plate) return json(res, 400, { error: 'placa_obrigatoria', message: 'Informe a placa do veículo' });
  if (D.isInside(plate)) return json(res, 409, { error: 'ja_dentro', message: 'Este veículo já consta no pátio' });
  if (D.activeVehicles().length >= cfg.capacity) return json(res, 409, { error: 'lotado', message: 'Estacionamento lotado' });
  const monthly = D.findMonthlyByPlate(plate);
  const reg = D.findRegistration(plate);
  if (!monthly && !reg) return json(res, 200, { needsRegistration: true, plate });  // 1ª vez → cadastrar
  const sector = monthly ? monthly.sector : autoSector();
  const v = D.createEntry({ plate, type: monthly ? 'mensalista' : 'avulso', sector, monthly_id: monthly ? monthly.id : null });
  if (reg) D.incRegistrationVisit(plate);
  D.logEvent('entry', `🚗 Entrada ${v.ticket} · ${plate}${monthly ? ' · mensalista ' + monthly.name : reg ? ' · ' + reg.name : ''}`);
  const wa = (reg && !monthly) ? await notifyEntry(v, reg, cfg) : null;
  abrirCancela(v, 'entrada');
  json(res, 201, { returning: true, vehicle: v, monthly: monthly || null, cliente: reg ? { name: reg.name } : null, wa, gate: gate.DRIVER });
});

// CADASTRO + ENTRADA (1ª vez): salva placa/nome/telefone/modelo (com consentimento LGPD).
route('POST', /^\/api\/registro$/, async (req, res, url) => {
  const b = await readBody(req);
  const g = gateGuard(b, url); if (!g.ok) return json(res, g.code, { error: g.error, message: g.message });
  const cfg = D.getConfig();
  const plate = D.normPlate(b.plate || '');
  if (!plate || !b.name || !b.phone) return json(res, 400, { error: 'dados_incompletos', message: 'Preencha placa, nome e telefone' });
  if (!b.consent) return json(res, 400, { error: 'consentimento', message: 'É preciso aceitar o uso dos dados (LGPD)' });
  if (D.isInside(plate)) return json(res, 409, { error: 'ja_dentro', message: 'Este veículo já consta no pátio' });
  if (D.activeVehicles().length >= cfg.capacity) return json(res, 409, { error: 'lotado', message: 'Estacionamento lotado' });
  const reg = D.upsertRegistration({ plate, name: b.name, phone: b.phone, model: b.model, consent: true });
  const v = D.createEntry({ plate, type: 'avulso', sector: autoSector() });
  D.incRegistrationVisit(plate);
  D.logEvent('entry', `📝 Cadastro + entrada ${v.ticket} · ${plate} · ${reg.name}`);
  const wa = await notifyEntry(v, reg, cfg);
  abrirCancela(v, 'entrada');
  json(res, 201, { registered: true, vehicle: v, cliente: { name: reg.name }, wa, gate: gate.DRIVER });
});

// Sensor de presença (laço indutivo) informa se há veículo na cancela.
route('POST', /^\/api\/gate\/presence$/, async (req, res) => {
  const b = await readBody(req);
  const lane = b.lane === 'saida' ? 'saida' : 'entrada';
  presence[lane] = !!b.present;
  json(res, 200, { lane, present: presence[lane] });
});

// Consulta (por ticket ou placa)
route('GET', /^\/api\/consulta$/, (req, res, url) => {
  const ticket = url.searchParams.get('ticket');
  const plate = url.searchParams.get('plate');
  let v = null;
  if (ticket) v = D.findActiveByTicket(ticket.startsWith('#') ? ticket : '#' + ticket.replace(/\D/g, '').padStart(4, '0'));
  if (!v && plate) v = D.findActiveByPlate(plate);
  if (!v) return json(res, 404, { error: 'nao_encontrado', message: 'Ticket ou placa não localizado no pátio' });
  const partnerId = url.searchParams.get('partner');
  const partner = partnerId ? D.getPartner(partnerId) : null;
  const pr = vehiclePricing(v, partner);
  json(res, 200, {
    vehicle: { id: v.id, ticket: v.ticket, plate: v.plate, type: v.type, sector: v.sector, entry_ts: v.entry_ts },
    minutes: pr.mins, gross: pr.gross, discount: pr.discount, amount: pr.net,
    monthly: pr.monthly ? { name: pr.monthly.name, plan: pr.monthly.plan } : null,
    partner: partner ? { id: partner.id, name: partner.name, label: partner.label } : null,
    partnersDisponiveis: D.listPartners().map(p => ({ id: p.id, name: p.name, label: p.label })),
  });
});

// Criar cobrança PIX
route('POST', /^\/api\/cobranca$/, async (req, res) => {
  const b = await readBody(req);
  let v = null;
  if (b.ticket) v = D.findActiveByTicket(b.ticket.startsWith('#') ? b.ticket : '#' + String(b.ticket).replace(/\D/g, '').padStart(4, '0'));
  if (!v && b.plate) v = D.findActiveByPlate(b.plate);
  if (!v) return json(res, 404, { error: 'nao_encontrado', message: 'Veículo não localizado' });
  const partner = b.partnerId ? D.getPartner(b.partnerId) : null;
  const pr = vehiclePricing(v, partner);
  if (pr.net <= 0) {
    // nada a cobrar (mensalista/tolerância/isenção) → libera direto
    D.settleVehicle(v.id, { charge: 0, minutes: pr.mins, method: 'gratis', discount: pr.discount, partner: partner ? partner.name : null });
    abrirCancela(v, 'sem cobrança');
    return json(res, 200, { status: 'paid', amount: 0, free: true, message: 'Sem cobrança — liberado' });
  }
  if (partner) D.bumpPartner(partner.id);
  const cfg = D.getConfig();
  const txid = 'PF' + crypto.randomBytes(8).toString('hex').toUpperCase();
  let pixPayload = buildPixPayload({ key: cfg.pixKey, name: cfg.pixName, city: cfg.pixCity, amount: pr.net, txid });
  const method = (b.method || 'pix');
  let qrBase64 = null;
  // PIX real (Mercado Pago): substitui o BR Code local pela cobrança oficial do banco
  if (method === 'pix') {
    const charge = await pixProvider.createCharge({ amount: pr.net, description: 'Estacionamento ' + v.ticket, txid });
    if (charge.provider !== 'mock' && charge.pixPayload) { pixPayload = charge.pixPayload; qrBase64 = charge.qrBase64 || null; }
    else if (charge.error) { D.logEvent('pay', `⚠️ PIX (${charge.provider}) falhou: ${charge.error}`); }
  }
  const pay = D.createPayment({ txid, vehicle_id: v.id, amount: pr.net, method, pix_payload: pixPayload, discount: pr.discount, partner: partner ? partner.name : null });
  D.logEvent('pay', `₽ Cobrança criada · ${method.toUpperCase()} · R$ ${pr.net.toFixed(2)} · ${v.ticket} [${pixProvider.PROVIDER}]`);
  // Só no modo mock o backend confirma sozinho; com provedor real, quem confirma é o webhook do banco.
  if (method === 'pix' && cfg.autoPix && pixProvider.PROVIDER === 'mock') {
    const delay = 2000 + Math.random() * 3000;
    setTimeout(() => confirmarPagamento(txid, 'webhook-banco'), delay);
  }
  json(res, 201, { txid, amount: pr.net, status: 'pending', method, pixPayload, qrBase64, ticket: v.ticket, discount: pr.discount });
});

// Status da cobrança (polling do cliente)
route('GET', /^\/api\/cobranca\/[^/]+$/, (req, res, url) => {
  const txid = url.pathname.split('/').pop();
  const pay = D.getPayment(txid);
  if (!pay) return json(res, 404, { error: 'nao_encontrado' });
  json(res, 200, { txid: pay.txid, status: pay.status, amount: pay.amount, method: pay.method, paid_ts: pay.paid_ts });
});

// Webhook do banco (em produção, chamado pelo PSP/banco)
route('POST', /^\/api\/webhook\/pix$/, async (req, res, url) => {
  const b = await readBody(req);
  const q = Object.fromEntries(url.searchParams.entries());
  // Normaliza: o Mercado Pago manda ora no corpo, ora na query string.
  const type = b.type || b.topic || q.type || q.topic;
  const id   = (b.data && b.data.id) || b.id || q['data.id'] || q.id;
  const wh = await pixProvider.handleWebhook({ type, id });
  let txid = b.txid;
  if (wh.provider !== 'mock') {
    if (wh.error) { D.logEvent('pay', `⚠️ Webhook (${wh.provider}) erro: ${wh.error}`); }
    if (!wh.paid) return json(res, 200, { status: 'ignored' });  // pagamento ainda não aprovado
    txid = wh.externalRef;
  }
  if (!txid) return json(res, 400, { error: 'txid obrigatório' });
  const pay = confirmarPagamento(txid, wh.provider === 'mock' ? 'webhook' : wh.provider);
  if (!pay) return json(res, 404, { error: 'cobranca_invalida' });
  json(res, 200, { status: 'paid', txid: pay.txid });
});

// Simular pagamento (helper de demo / botão do cliente quando autoPix=off)
route('POST', /^\/api\/cobranca\/[^/]+\/simular$/, (req, res, url) => {
  const txid = url.pathname.split('/')[3];
  const pay = confirmarPagamento(txid, 'simulado');
  if (!pay) return json(res, 404, { error: 'cobranca_invalida' });
  json(res, 200, { status: 'paid', txid });
});

// Pátio
route('GET', /^\/api\/patio$/, (req, res) => {
  const cfg = D.getConfig();
  const active = D.activeVehicles().map(v => {
    const pr = vehiclePricing(v, null);
    return { id: v.id, ticket: v.ticket, plate: v.plate, type: v.type, sector: v.sector, entry_ts: v.entry_ts, minutes: pr.mins, amount: pr.net };
  });
  const sectors = D.listSectors().map(s => ({ ...s, used: active.filter(v => v.sector === s.id).length }));
  json(res, 200, { capacity: cfg.capacity, occupied: active.length, sectors, vehicles: active });
});

// Relatórios
route('GET', /^\/api\/relatorios$/, (req, res) => {
  const paid = D.db.prepare("SELECT * FROM vehicles WHERE status='pago'").all();
  const now = Date.now();
  const rev = (from) => paid.filter(v => v.exit_ts >= from).reduce((s, v) => s + (v.charge || 0), 0);
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const methods = { pix: 0, cartao: 0, dinheiro: 0 };
  paid.forEach(v => { if (methods[v.method] != null) methods[v.method] += v.charge || 0; });
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(now - i * D.DAY); days.push({ label: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d.getDay()], key: d.toDateString(), value: 0 }); }
  paid.forEach(v => { const k = new Date(v.exit_ts).toDateString(); const d = days.find(x => x.key === k); if (d) d.value += v.charge || 0; });
  json(res, 200, {
    revenueToday: rev(today0.getTime()), revenue7d: rev(now - 7 * D.DAY),
    totalPaid: paid.length,
    avgTicket: paid.length ? paid.reduce((s, v) => s + (v.charge || 0), 0) / paid.length : 0,
    avgStay: paid.length ? paid.reduce((s, v) => s + (v.minutes || 0), 0) / paid.length : 0,
    methods, daily: days.map(d => ({ label: d.label, value: d.value })),
  });
});

// Eventos ao vivo
route('GET', /^\/api\/eventos$/, (req, res) => json(res, 200, D.recentEvents(30)));
route('GET', /^\/api\/mensalistas$/, (req, res) => json(res, 200, D.listMonthlies()));
route('GET', /^\/api\/convenios$/, (req, res) => json(res, 200, D.listPartners()));

function autoSector() {
  const active = D.activeVehicles();
  let best = D.listSectors()[0], bestFree = -1;
  D.listSectors().forEach(s => { const free = s.capacity - active.filter(v => v.sector === s.id).length; if (free > bestFree) { bestFree = free; best = s; } });
  return best.id;
}

/* ═══════════ SERVIDOR ═══════════ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }

  // API
  if (url.pathname.startsWith('/api/')) {
    const m = routes.find(r => r.method === req.method && r.pattern.test(url.pathname));
    if (!m) return json(res, 404, { error: 'rota_inexistente', path: url.pathname });
    try { return await m.handler(req, res, url); }
    catch (e) { console.error(e); return json(res, 500, { error: 'interno', message: e.message }); }
  }

  // Estáticos
  if (url.pathname === '/' ) return serveFile(res, path.join(__dirname, 'landing.html'));
  if (url.pathname === '/cliente' || url.pathname === '/cliente/') return serveFile(res, path.join(ROOT, 'cliente', 'index.html'));
  if (url.pathname === '/operador' || url.pathname === '/operador/') return serveFile(res, path.join(ROOT, 'estacionamento', 'index.html'));
  // arquivos dentro de cliente/ e estacionamento/
  const safe = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
  const candidate = path.join(ROOT, safe);
  if (candidate.startsWith(ROOT) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return serveFile(res, candidate);
  const landing = path.join(__dirname, 'landing.html');
  if (fs.existsSync(landing)) return serveFile(res, landing);
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🅿️  ParkFlow API rodando em http://localhost:${PORT}`);
  console.log(`   • App do cliente:   http://localhost:${PORT}/cliente`);
  console.log(`   • Painel operador:  http://localhost:${PORT}/operador`);
  console.log(`   • API health:       http://localhost:${PORT}/api/health\n`);
});

module.exports = { server };
