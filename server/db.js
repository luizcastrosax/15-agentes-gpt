'use strict';
/* Camada de dados — SQLite real (node:sqlite). Schema, seed e acesso. */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.PARKFLOW_DB || path.join(__dirname, 'parkflow.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const HOUR = 3600000, DAY = 86400000;
const uid = () => Math.random().toString(36).slice(2, 10);
const normPlate = p => (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS sectors  (id TEXT PRIMARY KEY, name TEXT, capacity INTEGER, icon TEXT);
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket TEXT, plate TEXT, type TEXT, sector TEXT,
      entry_ts INTEGER, exit_ts INTEGER, status TEXT,
      charge REAL, minutes INTEGER, method TEXT, discount REAL DEFAULT 0,
      partner TEXT, monthly_id TEXT
    );
    CREATE TABLE IF NOT EXISTS monthlies (
      id TEXT PRIMARY KEY, name TEXT, plate TEXT, plan TEXT, phone TEXT,
      price REAL, sector TEXT, spot TEXT, since INTEGER, valid_until INTEGER, status TEXT
    );
    CREATE TABLE IF NOT EXISTS partners (
      id TEXT PRIMARY KEY, name TEXT, type TEXT, value REAL, label TEXT, today INTEGER DEFAULT 0, status TEXT
    );
    CREATE TABLE IF NOT EXISTS payments (
      txid TEXT PRIMARY KEY, vehicle_id INTEGER, amount REAL, method TEXT,
      status TEXT, created_ts INTEGER, paid_ts INTEGER, pix_payload TEXT, discount REAL DEFAULT 0, partner TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, kind TEXT, message TEXT
    );
    CREATE TABLE IF NOT EXISTS registrations (
      plate TEXT PRIMARY KEY, name TEXT, phone TEXT, model TEXT,
      consent_ts INTEGER, created_ts INTEGER, visits INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_veh_status ON vehicles(status);
    CREATE INDEX IF NOT EXISTS idx_veh_plate ON vehicles(plate);
  `);
  if (!getSetting('seeded')) seed();
}

/* ---------- settings ---------- */
function getSetting(k) { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? JSON.parse(r.value) : null; }
function setSetting(k, v) { db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v)); }

function getConfig() {
  const c = getSetting('config') || {
    name: 'ParkFlow Estacionamento', capacity: 130,
    pixKey: 'estacionamento@parkflow.com.br', pixName: 'PARKFLOW ESTACIONAMENTO', pixCity: 'SAO PAULO',
    autoPix: true, gateGraceMin: 15,
    tariff: { graceMin: 15, firstMin: 60, firstPrice: 12, addMin: 30, addPrice: 5, dailyMax: 45, nightPrice: 35, lostTicket: 90, minPrice: 5 }
  };
  // A chave PIX real vem do .env (privado, fora do repositório). Nunca hardcode o CPF aqui.
  if (process.env.PIX_KEY)  c.pixKey  = process.env.PIX_KEY;
  if (process.env.PIX_NAME) c.pixName = process.env.PIX_NAME;
  if (process.env.PIX_CITY) c.pixCity = process.env.PIX_CITY;
  return c;
}
function setConfig(c) { setSetting('config', c); }

/* ---------- seed ---------- */
function seed() {
  const cfg = getConfig(); setConfig(cfg);
  const sectors = [
    { id: 'ter', name: 'Térreo', capacity: 40, icon: '🅿️' },
    { id: 'sub1', name: '1º Subsolo', capacity: 60, icon: '🅱️' },
    { id: 'cob', name: 'Coberto VIP', capacity: 30, icon: '⭐' },
  ];
  const insSec = db.prepare('INSERT OR REPLACE INTO sectors(id,name,capacity,icon) VALUES(?,?,?,?)');
  sectors.forEach(s => insSec.run(s.id, s.name, s.capacity, s.icon));

  const now = Date.now();
  const monthlies = [
    ['Ana Beatriz Souza', 'RTF2A45', 'Mensal Carro', '(11) 98812-3344', 320, 'cob', 'C-04', now - 120 * DAY, now + 12 * DAY, 'ativo'],
    ['Carlos E. Martins', 'BRA1E23', 'Mensal Carro', '(11) 99771-2210', 280, 'ter', 'T-18', now - 300 * DAY, now + 3 * DAY, 'ativo'],
    ['Moto Express Ltda', 'FJK5C09', 'Mensal Moto', '(11) 3255-9000', 150, 'sub1', 'S-42', now - 60 * DAY, now - 2 * DAY, 'vencido'],
    ['Dra. Helena Nunes', 'QPX7B88', 'Diarista 12h', '(11) 98123-0000', 420, 'cob', 'C-11', now - 45 * DAY, now + 20 * DAY, 'ativo'],
  ];
  const insM = db.prepare('INSERT INTO monthlies(id,name,plate,plan,phone,price,sector,spot,since,valid_until,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  monthlies.forEach(m => insM.run(uid(), m[0], normPlate(m[1]), m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9]));

  const partners = [
    ['Restaurante Sabor & Cia', 'freehours', 2, '2h grátis'],
    ['Farmácia Saúde+', 'discount', 8, 'R$ 8 desconto'],
    ['Loja Fashion Center', 'percent', 50, '50% off'],
    ['Cliente VIP (isenção)', 'free', 0, 'Isenção total'],
  ];
  const insP = db.prepare('INSERT INTO partners(id,name,type,value,label,today,status) VALUES(?,?,?,?,?,0,?)');
  partners.forEach(p => insP.run(uid(), p[0], p[1], p[2], p[3], 'ativo'));

  // histórico de 7 dias (relatórios) + veículos ativos (pátio)
  const { calcCharge } = require('./tariff');
  const insV = db.prepare('INSERT INTO vehicles(ticket,plate,type,sector,entry_ts,exit_ts,status,charge,minutes,method,discount) VALUES(?,?,?,?,?,?,?,?,?,?,0)');
  const methods = ['pix', 'pix', 'pix', 'cartao', 'cartao', 'dinheiro'];
  const randPlate = () => {
    const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', N = '0123456789';
    const r = (s, n) => Array.from({ length: n }, () => s[Math.random() * s.length | 0]).join('');
    return Math.random() < .5 ? r(L, 3) + r(N, 1) + r(L, 1) + r(N, 2) : r(L, 3) + r(N, 4);
  };
  let seq = 421;
  for (let day = 7; day >= 0; day--) {
    const count = 18 + (Math.random() * 22 | 0);
    for (let i = 0; i < count; i++) {
      const start = new Date(now - day * DAY);
      start.setHours(7 + (Math.random() * 14 | 0), Math.random() * 60 | 0, 0, 0);
      const stay = 20 + Math.pow(Math.random(), 1.6) * 600;
      const exit = start.getTime() + stay * 60000;
      if (exit > now) continue;
      const charge = calcCharge(stay, cfg.tariff);
      insV.run('#' + String(++seq).padStart(4, '0'), randPlate(), 'avulso', sectors[Math.random() * 3 | 0].id,
        start.getTime(), exit, 'pago', charge, Math.round(stay), charge === 0 ? 'gratis' : methods[Math.random() * methods.length | 0]);
    }
  }
  // ativos no pátio (entrada no passado p/ terem valor a pagar)
  const monthPlates = monthlies.filter(m => m[9] === 'ativo').map(m => normPlate(m[1]));
  const nActive = 30 + (Math.random() * 16 | 0);
  const insA = db.prepare('INSERT INTO vehicles(ticket,plate,type,sector,entry_ts,status,discount) VALUES(?,?,?,?,?,?,0)');
  for (let i = 0; i < nActive; i++) {
    const stay = 20 + Math.pow(Math.random(), 1.6) * 260;
    const isM = Math.random() < .1;
    insA.run('#' + String(++seq).padStart(4, '0'),
      isM ? monthPlates[Math.random() * monthPlates.length | 0] : randPlate(),
      isM ? 'mensalista' : 'avulso', sectors[Math.random() * 3 | 0].id,
      now - stay * 60000, 'ativo');
  }
  setSetting('seeded', true);
  setSetting('seq', seq);
  logEvent('sys', 'Banco de dados inicializado com dados de demonstração');
}

/* ---------- events ---------- */
function logEvent(kind, message) {
  db.prepare('INSERT INTO events(ts,kind,message) VALUES(?,?,?)').run(Date.now(), kind, message);
}
function recentEvents(limit = 30) {
  return db.prepare('SELECT ts,kind,message FROM events ORDER BY id DESC LIMIT ?').all(limit);
}

/* ---------- vehicles ---------- */
function nextTicket() { const s = (getSetting('seq') || 421) + 1; setSetting('seq', s); return { seq: s, ticket: '#' + String(s).padStart(4, '0') }; }
function activeVehicles() { return db.prepare("SELECT * FROM vehicles WHERE status='ativo' ORDER BY entry_ts").all(); }
function findActiveByTicket(t) { return db.prepare("SELECT * FROM vehicles WHERE status='ativo' AND ticket=?").get(t); }
function findActiveByPlate(p) { return db.prepare("SELECT * FROM vehicles WHERE status='ativo' AND plate=?").get(normPlate(p)); }
function getVehicle(id) { return db.prepare('SELECT * FROM vehicles WHERE id=?').get(id); }
function createEntry({ plate, type, sector, monthly_id }) {
  const { ticket } = nextTicket();
  const r = db.prepare('INSERT INTO vehicles(ticket,plate,type,sector,entry_ts,status,monthly_id,discount) VALUES(?,?,?,?,?,?,?,0)')
    .run(ticket, plate ? normPlate(plate) : null, type || 'avulso', sector, Date.now(), 'ativo', monthly_id || null);
  return getVehicle(r.lastInsertRowid);
}
function settleVehicle(id, { charge, minutes, method, discount, partner }) {
  db.prepare("UPDATE vehicles SET status='pago', exit_ts=?, charge=?, minutes=?, method=?, discount=?, partner=? WHERE id=?")
    .run(Date.now(), charge, minutes, method, discount || 0, partner || null, id);
}

/* ---------- registros de clientes/veículos (modelo online) ---------- */
function findRegistration(plate) { return db.prepare('SELECT * FROM registrations WHERE plate=?').get(normPlate(plate)); }
function upsertRegistration({ plate, name, phone, model, consent }) {
  const p = normPlate(plate), now = Date.now();
  const cur = findRegistration(p);
  if (cur) {
    db.prepare('UPDATE registrations SET name=?, phone=?, model=? WHERE plate=?').run(name || cur.name, phone || cur.phone, model || cur.model, p);
  } else {
    db.prepare('INSERT INTO registrations(plate,name,phone,model,consent_ts,created_ts,visits) VALUES(?,?,?,?,?,?,0)')
      .run(p, name || null, phone || null, model || null, consent ? now : null, now);
  }
  return findRegistration(p);
}
function incRegistrationVisit(plate) { db.prepare('UPDATE registrations SET visits=visits+1 WHERE plate=?').run(normPlate(plate)); }
function isInside(plate) { return !!db.prepare("SELECT id FROM vehicles WHERE status='ativo' AND plate=?").get(normPlate(plate)); }

/* ---------- monthlies / partners ---------- */
function findMonthlyByPlate(p) { return db.prepare("SELECT * FROM monthlies WHERE plate=? AND status='ativo'").get(normPlate(p)); }
function listMonthlies() { return db.prepare('SELECT * FROM monthlies ORDER BY name').all(); }
function listPartners() { return db.prepare("SELECT * FROM partners WHERE status='ativo' ORDER BY name").all(); }
function getPartner(id) { return db.prepare('SELECT * FROM partners WHERE id=?').get(id); }
function bumpPartner(id) { db.prepare('UPDATE partners SET today=today+1 WHERE id=?').run(id); }
function listSectors() { return db.prepare('SELECT * FROM sectors').all(); }

/* ---------- payments ---------- */
function createPayment(p) {
  db.prepare('INSERT INTO payments(txid,vehicle_id,amount,method,status,created_ts,pix_payload,discount,partner) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(p.txid, p.vehicle_id, p.amount, p.method, 'pending', Date.now(), p.pix_payload || null, p.discount || 0, p.partner || null);
  return getPayment(p.txid);
}
function getPayment(txid) { return db.prepare('SELECT * FROM payments WHERE txid=?').get(txid); }
function markPaid(txid) { db.prepare("UPDATE payments SET status='paid', paid_ts=? WHERE txid=? AND status='pending'").run(Date.now(), txid); return getPayment(txid); }

module.exports = {
  db, init, HOUR, DAY, uid, normPlate,
  getConfig, setConfig, getSetting, setSetting,
  logEvent, recentEvents,
  activeVehicles, findActiveByTicket, findActiveByPlate, getVehicle, createEntry, settleVehicle,
  findRegistration, upsertRegistration, incRegistrationVisit, isInside,
  findMonthlyByPlate, listMonthlies, listPartners, getPartner, bumpPartner, listSectors,
  createPayment, getPayment, markPaid,
};
