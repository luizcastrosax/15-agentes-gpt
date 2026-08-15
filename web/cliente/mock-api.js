/* ═══════════════════════════════════════════════════════════════
   ParkFlow · Mock do backend no navegador (build web autônomo p/ Vercel)
   Intercepta window.fetch em /api/* e responde com a MESMA lógica do
   servidor real (motor de tarifas, PIX EMV, confirmação simulada).
   Sem servidor: ideal para demonstração online estática.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const LS = 'parkflow_client_web_v1';
  const DAY = 86400000;
  const CFG = { pixKey: 'estacionamento@parkflow.com.br', pixName: 'PARKFLOW ESTACIONAMENTO', pixCity: 'SAO PAULO',
    tariff: { graceMin: 15, firstMin: 60, firstPrice: 12, addMin: 30, addPrice: 5, dailyMax: 45, minPrice: 5 } };

  const normPlate = p => (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const uid = () => Math.random().toString(36).slice(2, 10);
  function randPlate() {
    const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', N = '0123456789';
    const r = (s, n) => Array.from({ length: n }, () => s[Math.random() * s.length | 0]).join('');
    return Math.random() < .5 ? r(L, 3) + r(N, 1) + r(L, 1) + r(N, 2) : r(L, 3) + r(N, 4);
  }

  /* motor de tarifas (idêntico ao servidor) */
  function calcCharge(mins, t) {
    if (mins <= t.graceMin) return 0;
    let price = t.firstPrice;
    const extra = mins - t.firstMin;
    if (extra > 0) price += Math.ceil(extra / t.addMin) * t.addPrice;
    const days = Math.max(1, Math.ceil(mins / 1440));
    price = Math.min(price, t.dailyMax * days);
    return Math.round(Math.max(price, t.minPrice || 0) * 100) / 100;
  }
  function applyPartner(gross, mins, p, t) {
    if (!p) return 0;
    if (p.type === 'free') return gross;
    if (p.type === 'discount') return Math.min(gross, p.value);
    if (p.type === 'percent') return Math.round(gross * p.value) / 100;
    if (p.type === 'freehours') return Math.round((gross - calcCharge(Math.max(0, mins - p.value * 60), t)) * 100) / 100;
    return 0;
  }
  /* PIX EMV + CRC16 */
  function crc16(str) { let c = 0xFFFF; for (let i = 0; i < str.length; i++) { c ^= str.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) { c = (c & 0x8000) ? ((c << 1) ^ 0x1021) : (c << 1); c &= 0xFFFF; } } return c.toString(16).toUpperCase().padStart(4, '0'); }
  const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
  function buildPix(amount, txid) {
    const mai = tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', CFG.pixKey);
    let p = tlv('00', '01') + tlv('26', mai) + tlv('52', '0000') + tlv('53', '986') + tlv('54', amount.toFixed(2)) + tlv('58', 'BR') + tlv('59', CFG.pixName.slice(0, 25)) + tlv('60', CFG.pixCity.slice(0, 15)) + tlv('62', tlv('05', txid.slice(0, 25)));
    p += '6304'; return p + crc16(p);
  }

  /* ---------- store ---------- */
  let store = load();
  if (!store.registrations) store.registrations = {};
  function load() {
    try { const d = JSON.parse(localStorage.getItem(LS)); if (d && d.vehicles && d.vehicles.some(v => v.status === 'ativo')) return d; } catch (e) {}
    return seed();
  }
  function persist() { try { localStorage.setItem(LS, JSON.stringify(store)); } catch (e) {} }
  function seed() {
    const now = Date.now();
    const sectors = [{ id: 'ter', name: 'Térreo' }, { id: 'sub1', name: '1º Subsolo' }, { id: 'cob', name: 'Coberto VIP' }];
    const monthlies = [
      { id: uid(), name: 'Ana Beatriz Souza', plate: 'RTF2A45', plan: 'Mensal Carro' },
      { id: uid(), name: 'Carlos E. Martins', plate: 'BRA1E23', plan: 'Mensal Carro' },
      { id: uid(), name: 'Dra. Helena Nunes', plate: 'QPX7B88', plan: 'Diarista 12h' },
    ];
    const partners = [
      { id: uid(), name: 'Restaurante Sabor & Cia', type: 'freehours', value: 2, label: '2h grátis' },
      { id: uid(), name: 'Farmácia Saúde+', type: 'discount', value: 8, label: 'R$ 8 desconto' },
      { id: uid(), name: 'Loja Fashion Center', type: 'percent', value: 50, label: '50% off' },
      { id: uid(), name: 'Cliente VIP (isenção)', type: 'free', value: 0, label: 'Isenção total' },
    ];
    const vehicles = []; let seq = 620;
    const monthPlates = monthlies.map(m => m.plate);
    for (let i = 0; i < 22; i++) {
      const stay = 20 + Math.pow(Math.random(), 1.6) * 260;
      const isM = Math.random() < .12;
      vehicles.push({ id: ++seq, ticket: '#' + String(seq).padStart(4, '0'),
        plate: isM ? monthPlates[Math.random() * monthPlates.length | 0] : randPlate(),
        type: isM ? 'mensalista' : 'avulso', sector: sectors[Math.random() * 3 | 0].id,
        entry_ts: now - stay * 60000, status: 'ativo' });
    }
    const registrations = {};  // clientes já cadastrados (reconhecidos na entrada)
    monthlies.forEach(m => { registrations[normPlate(m.plate)] = { name: m.name, phone: '11999990000', model: '', plate: normPlate(m.plate) }; });
    return { sectors, monthlies, partners, vehicles, payments: {}, registrations, seq };
  }
  function waLinkMock(phone, ticket, plate) {
    const to = (phone || '').replace(/\D/g, ''); const num = to.length <= 11 ? '55' + to : to;
    const text = '🅿️ ParkFlow — comprovante de entrada\nTicket: ' + ticket + '\nPlaca: ' + plate + '\nGuarde esta mensagem.';
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(text);
  }

  const minutesOf = v => Math.max(0, Math.round((Date.now() - v.entry_ts) / 60000));
  const findMonthly = plate => store.monthlies.find(m => normPlate(m.plate) === normPlate(plate));
  function findActive(q) {
    if (q.ticket) { const t = q.ticket.startsWith('#') ? q.ticket : '#' + String(q.ticket).replace(/\D/g, '').padStart(4, '0'); const v = store.vehicles.find(x => x.status === 'ativo' && x.ticket === t); if (v) return v; }
    if (q.plate) return store.vehicles.find(x => x.status === 'ativo' && normPlate(x.plate) === normPlate(q.plate));
    return null;
  }
  function pricing(v, partner) {
    const mins = minutesOf(v);
    const monthly = v.type === 'mensalista' ? findMonthly(v.plate) : (v.plate ? findMonthly(v.plate) : null);
    const gross = (v.type === 'mensalista' || monthly) ? 0 : calcCharge(mins, CFG.tariff);
    const discount = gross > 0 && partner ? applyPartner(gross, mins, partner, CFG.tariff) : 0;
    const net = Math.max(0, Math.round((gross - discount) * 100) / 100);
    return { mins, gross, discount, net, monthly: monthly || null };
  }

  /* ---------- roteador ---------- */
  function handle(pathname, search, method, body) {
    const qs = new URLSearchParams(search);
    if (pathname === '/api/health') return [200, { ok: true, service: 'parkflow-mock' }];

    if (pathname === '/api/patio') {
      const active = store.vehicles.filter(v => v.status === 'ativo').map(v => { const pr = pricing(v, null); return { id: v.id, ticket: v.ticket, plate: v.plate, type: v.type, sector: v.sector, entry_ts: v.entry_ts, minutes: pr.mins, amount: pr.net }; });
      return [200, { capacity: 130, occupied: active.length, vehicles: active, sectors: store.sectors }];
    }
    if (pathname === '/api/consulta') {
      const v = findActive({ ticket: qs.get('ticket'), plate: qs.get('plate') });
      if (!v) return [404, { error: 'nao_encontrado', message: 'Ticket ou placa não localizado no pátio' }];
      const partner = qs.get('partner') ? store.partners.find(p => p.id === qs.get('partner')) : null;
      const pr = pricing(v, partner);
      return [200, {
        vehicle: { id: v.id, ticket: v.ticket, plate: v.plate, type: v.type, sector: v.sector, entry_ts: v.entry_ts },
        minutes: pr.mins, gross: pr.gross, discount: pr.discount, amount: pr.net,
        monthly: pr.monthly ? { name: pr.monthly.name, plan: pr.monthly.plan } : null,
        partner: partner ? { id: partner.id, name: partner.name, label: partner.label } : null,
        partnersDisponiveis: store.partners.map(p => ({ id: p.id, name: p.name, label: p.label })),
      }];
    }
    if (pathname === '/api/cobranca' && method === 'POST') {
      const v = findActive({ ticket: body.ticket, plate: body.plate });
      if (!v) return [404, { error: 'nao_encontrado', message: 'Veículo não localizado' }];
      const partner = body.partnerId ? store.partners.find(p => p.id === body.partnerId) : null;
      const pr = pricing(v, partner);
      if (pr.net <= 0) { v.status = 'pago'; v.exit_ts = Date.now(); persist(); return [200, { status: 'paid', amount: 0, free: true }]; }
      const txid = 'PF' + Array.from({ length: 16 }, () => '0123456789ABCDEF'[Math.random() * 16 | 0]).join('');
      const pixPayload = buildPix(pr.net, txid);
      store.payments[txid] = { txid, vehicleId: v.id, amount: pr.net, status: 'pending', created: Date.now() };
      persist();
      // confirmação automática (simula webhook do banco) em 2,5–4,5s
      setTimeout(() => { const p = store.payments[txid]; if (p && p.status === 'pending') { p.status = 'paid'; p.paid = Date.now(); const veh = store.vehicles.find(x => x.id === p.vehicleId); if (veh) { veh.status = 'pago'; veh.exit_ts = Date.now(); veh.charge = p.amount; } persist(); } }, 2500 + Math.random() * 2000);
      return [201, { txid, amount: pr.net, status: 'pending', method: 'pix', pixPayload, ticket: v.ticket, discount: pr.discount }];
    }
    if (pathname === '/api/entrada' && method === 'POST') {
      const plate = normPlate(body.plate);
      if (!plate) return [400, { error: 'placa_obrigatoria', message: 'Informe a placa do veículo' }];
      if (store.vehicles.some(v => v.status === 'ativo' && normPlate(v.plate) === plate)) return [409, { error: 'ja_dentro', message: 'Este veículo já consta no pátio' }];
      const reg = store.registrations[plate];
      if (!reg) return [200, { needsRegistration: true, plate }];
      const s = ++store.seq; const v = { id: s, ticket: '#' + String(s).padStart(4, '0'), plate, type: 'avulso', sector: store.sectors[0].id, entry_ts: Date.now(), status: 'ativo' };
      store.vehicles.push(v); persist();
      return [201, { returning: true, vehicle: v, cliente: { name: reg.name }, wa: { sent: false, provider: 'mock', link: waLinkMock(reg.phone, v.ticket, plate) } }];
    }
    if (pathname === '/api/registro' && method === 'POST') {
      const plate = normPlate(body.plate);
      if (!plate || !body.name || !body.phone) return [400, { error: 'dados_incompletos', message: 'Preencha placa, nome e telefone' }];
      if (!body.consent) return [400, { error: 'consentimento', message: 'É preciso aceitar o uso dos dados (LGPD)' }];
      if (store.vehicles.some(v => v.status === 'ativo' && normPlate(v.plate) === plate)) return [409, { error: 'ja_dentro', message: 'Este veículo já consta no pátio' }];
      store.registrations[plate] = { name: body.name, phone: body.phone, model: body.model || '', plate };
      const s = ++store.seq; const v = { id: s, ticket: '#' + String(s).padStart(4, '0'), plate, type: 'avulso', sector: store.sectors[0].id, entry_ts: Date.now(), status: 'ativo' };
      store.vehicles.push(v); persist();
      return [201, { registered: true, vehicle: v, cliente: { name: body.name }, wa: { sent: false, provider: 'mock', link: waLinkMock(body.phone, v.ticket, plate) } }];
    }
    const mCob = pathname.match(/^\/api\/cobranca\/([^/]+)$/);
    if (mCob) { const p = store.payments[mCob[1]]; if (!p) return [404, { error: 'nao_encontrado' }]; return [200, { txid: p.txid, status: p.status, amount: p.amount, method: 'pix', paid_ts: p.paid || null }]; }
    const mSim = pathname.match(/^\/api\/cobranca\/([^/]+)\/simular$/);
    if (mSim && method === 'POST') { const p = store.payments[mSim[1]]; if (!p) return [404, {}]; p.status = 'paid'; p.paid = Date.now(); const veh = store.vehicles.find(x => x.id === p.vehicleId); if (veh) { veh.status = 'pago'; veh.exit_ts = Date.now(); } persist(); return [200, { status: 'paid' }]; }

    return [404, { error: 'rota_inexistente', path: pathname }];
  }

  /* ---------- intercepta fetch ---------- */
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opts) {
    opts = opts || {};
    const raw = String(url);
    const idx = raw.indexOf('/api/');
    if (idx < 0) return realFetch ? realFetch(url, opts) : Promise.reject(new Error('no fetch'));
    const after = raw.slice(idx);
    const qi = after.indexOf('?');
    const pathname = qi >= 0 ? after.slice(0, qi) : after;
    const search = qi >= 0 ? after.slice(qi) : '';
    const method = (opts.method || 'GET').toUpperCase();
    let body = {}; try { if (opts.body) body = JSON.parse(opts.body); } catch (e) {}
    let result; try { result = handle(pathname, search, method, body); } catch (e) { result = [500, { error: 'mock', message: e.message }]; }
    const [status, data] = result;
    return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }));
  };
})();
