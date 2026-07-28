"use strict";
/* ═══════════════════════════════════════════════════════════
   ParkFlow · Sistema de Gestão de Estacionamento (protótipo)
   Núcleo: estado, motor de tarifas, operação, caixa, BI.
   Sem dependências externas · persistência em localStorage.
═══════════════════════════════════════════════════════════ */

const LS = 'parkflow_v2';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ─────────── HELPERS ─────────── */
const pad = n => String(n).padStart(2,'0');
const money = v => 'R$ ' + (v||0).toFixed(2).replace('.',',');
const fmtTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const fmtHM = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDT = d => `${pad(d.getDate())}/${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDate = d => `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
const HOUR=3600000, DAY=86400000;
const uid = () => Math.random().toString(36).slice(2,9);
const normPlate = p => (p||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
function randPlate(){
  const L='ABCDEFGHIJKLMNOPQRSTUVWXYZ',N='0123456789';
  const r=(s,n)=>Array.from({length:n},()=>s[Math.random()*s.length|0]).join('');
  return Math.random()<.5 ? r(L,3)+r(N,1)+r(L,1)+r(N,2) : r(L,3)+r(N,4); // Mercosul ou antiga
}
function fmtDur(mins){
  mins=Math.max(0,Math.round(mins));
  const d=Math.floor(mins/1440), h=Math.floor((mins%1440)/60), m=mins%60;
  if(d>0) return `${d}d ${h}h${pad(m)}`;
  return h>0 ? `${h}h${pad(m)}min` : `${m}min`;
}

/* ─────────── STATE ─────────── */
let db = load();

function baseCfg(){
  return {
    name:'ParkFlow Estacionamento', capacity:130,
    tariff:{ graceMin:15, firstMin:60, firstPrice:12, addMin:30, addPrice:5, dailyMax:45, nightPrice:35, lostTicket:90, minPrice:5 },
    pixKey:'estacionamento@parkflow.com.br',
    ocr:true, autoPix:true, fastDemo:true, requireCash:false,
  };
}
function load(){
  try{
    const d=JSON.parse(localStorage.getItem(LS));
    if(d&&d.vehicles) return migrate(d);
  }catch(e){}
  return seed();
}
function migrate(d){
  d.cfg = Object.assign(baseCfg(), d.cfg||{});
  d.cfg.tariff = Object.assign(baseCfg().tariff, d.cfg.tariff||{});
  return d;
}
function save(){ localStorage.setItem(LS, JSON.stringify(db)); refreshChrome(); }

function seed(){
  const cfg=baseCfg();
  const sectors=[
    {id:'ter', name:'Térreo', capacity:40, icon:'🅿️'},
    {id:'sub1',name:'1º Subsolo', capacity:60, icon:'🅱️'},
    {id:'cob', name:'Coberto VIP', capacity:30, icon:'⭐'},
  ];
  const monthlies=[
    {id:uid(),name:'Ana Beatriz Souza',plate:'RTF2A45',plan:'Mensal Carro',phone:'(11) 98812-3344',price:320,sector:'cob',spot:'C-04',since:Date.now()-120*DAY,validUntil:Date.now()+12*DAY,status:'ativo'},
    {id:uid(),name:'Carlos E. Martins',plate:'BRA1E23',plan:'Mensal Carro',phone:'(11) 99771-2210',price:280,sector:'ter',spot:'T-18',since:Date.now()-300*DAY,validUntil:Date.now()+3*DAY,status:'ativo'},
    {id:uid(),name:'Moto Express Ltda',plate:'FJK5C09',plan:'Mensal Moto',phone:'(11) 3255-9000',price:150,sector:'sub1',spot:'S-42',since:Date.now()-60*DAY,validUntil:Date.now()-2*DAY,status:'vencido'},
    {id:uid(),name:'Dra. Helena Nunes',plate:'QPX7B88',plan:'Diarista 12h',phone:'(11) 98123-0000',price:420,sector:'cob',spot:'C-11',since:Date.now()-45*DAY,validUntil:Date.now()+20*DAY,status:'ativo'},
  ];
  const partners=[
    {id:uid(),name:'Restaurante Sabor & Cia',type:'freehours',value:2,label:'2h grátis',today:0,status:'ativo'},
    {id:uid(),name:'Farmácia Saúde+',type:'discount',value:8,label:'R$ 8 desconto',today:0,status:'ativo'},
    {id:uid(),name:'Loja Fashion Center',type:'percent',value:50,label:'50% off',today:0,status:'ativo'},
    {id:uid(),name:'Cliente VIP (isenção)',type:'free',value:0,label:'Isenção total',today:0,status:'ativo'},
  ];
  const operators=['João Pedro','Maria Clara','Rafael Lima'];
  const db={
    cfg, sectors, monthlies, partners, operators, seq:421,
    vehicles:[], cashier:{open:false, operator:null, openedTs:null, openingFloat:0, movements:[]},
    history:[] // closed cashier sessions
  };
  seedHistory(db);
  seedActive(db);
  return db;
}
function seedHistory(db){
  // gera ~7 dias de veículos concluídos para relatórios
  const methods=['pix','pix','pix','cartao','cartao','dinheiro'];
  const now=Date.now();
  for(let day=7; day>=0; day--){
    const count = 18 + (Math.random()*22|0);
    for(let i=0;i<count;i++){
      const hour = 7 + (Math.random()*14|0);
      const entryTs = now - day*DAY - (Math.random()*HOUR*2) ;
      const start = new Date(entryTs); start.setHours(hour, Math.random()*60|0,0,0);
      const stayMin = 20 + Math.pow(Math.random(),1.6)*600;
      const exit = start.getTime()+stayMin*60000;
      if(exit>now) continue;
      const charge = calcCharge(stayMin, db.cfg.tariff);
      const method = charge===0?'gratis':methods[Math.random()*methods.length|0];
      db.vehicles.push({
        id:++db.seq, plate:randPlate(), type:'avulso', sector:db.sectors[Math.random()*3|0].id,
        entryTs:start.getTime(), exitTs:exit, status:'pago', charge, minutes:Math.round(stayMin),
        method, discount:0
      });
    }
  }
}
function seedActive(db){
  const n = 34 + (Math.random()*20|0);
  const now=Date.now();
  for(let i=0;i<n;i++){
    const stayMin = 5 + Math.pow(Math.random(),2.1)*230;
    const isMonthly = Math.random()<.12;
    const m = isMonthly ? db.monthlies[Math.random()*db.monthlies.length|0] : null;
    db.vehicles.push({
      id:++db.seq, plate: m?m.plate:randPlate(),
      type:isMonthly?'mensalista':'avulso', monthlyId:m?m.id:null,
      sector:db.sectors[Math.random()*3|0].id,
      entryTs:now - stayMin*60000, exitTs:null, status:'ativo', charge:null, discount:0, partner:null
    });
  }
}

/* ═══════════ MOTOR DE TARIFAS ═══════════ */
function calcCharge(mins, t){
  if(mins <= t.graceMin) return 0;
  let price = t.firstPrice;
  const extra = mins - t.firstMin;
  if(extra > 0) price += Math.ceil(extra / t.addMin) * t.addPrice;
  const days = Math.max(1, Math.ceil(mins/1440));
  price = Math.min(price, t.dailyMax * days);      // teto de diária
  return Math.max(price, t.minPrice||0);
}
const DEMO_OFFSET=75; // min somados à permanência no modo demo (p/ exibir cobrança em testes instantâneos)
function elapsedMin(v){
  const realMin=(Date.now()-v.entryTs)/60000;
  return db.cfg.fastDemo ? realMin+DEMO_OFFSET : realMin;
}

/* ═══════════ TOAST / MODAL ═══════════ */
function toast(title, sub='', kind=''){
  const el=document.createElement('div');
  const icons={ok:'✅',warn:'⚠️',err:'❌','':'ℹ️'};
  el.className='toast '+kind;
  el.innerHTML=`<span class="ti">${icons[kind]||'ℹ️'}</span><div class="tc"><b>${title}</b>${sub?`<span>${sub}</span>`:''}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(()=>{el.style.transition='.3s';el.style.opacity='0';el.style.transform='translateX(40px)';setTimeout(()=>el.remove(),300);},3800);
}
function openModal(title, bodyHtml, footHtml){
  $('#modal').innerHTML=`
    <div class="modal-h"><h3>${title}</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="modal-b">${bodyHtml}</div>
    ${footHtml?`<div class="modal-f">${footHtml}</div>`:''}`;
  $('#modalOverlay').classList.add('open');
}
function closeModal(){ $('#modalOverlay').classList.remove('open'); }
$('#modalOverlay').addEventListener('click',e=>{if(e.target.id==='modalOverlay')closeModal();});

/* ═══════════ QR ═══════════ */
function drawQR(canvas, seedStr){
  const N=25, px=canvas.width/N, ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  let s=0;for(let i=0;i<seedStr.length;i++)s=(s*31+seedStr.charCodeAt(i))>>>0;
  const rng=()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff;};
  ctx.fillStyle='#000';
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){if(rng()>.5)ctx.fillRect(x*px,y*px,px,px);}
  const fp=(ox,oy)=>{ctx.fillStyle='#fff';ctx.fillRect(ox*px,oy*px,7*px,7*px);ctx.fillStyle='#000';ctx.fillRect(ox*px,oy*px,7*px,7*px);ctx.fillStyle='#fff';ctx.fillRect((ox+1)*px,(oy+1)*px,5*px,5*px);ctx.fillStyle='#000';ctx.fillRect((ox+2)*px,(oy+2)*px,3*px,3*px);};
  fp(0,0);fp(N-7,0);fp(0,N-7);
}

/* ═══════════ LOG / GATE / CAMERA ═══════════ */
function logLine(msg, cls=''){
  const el=$('#log'); if(!el) return;
  const d=document.createElement('div');d.className='l '+cls;
  d.innerHTML=`<span class="tm mono">${fmtTime(new Date())}</span><span>${msg}</span>`;
  el.prepend(d); while(el.children.length>50)el.removeChild(el.lastChild);
}
function openGate(afterMsg){
  const g=$('#gate'); if(!g){ if(afterMsg)logLine(afterMsg,'ok'); return renderIdle(); }
  $('#gateStatus').className='gate-status open';$('#gateStatus').textContent='Aberta';
  g.classList.add('open');
  logLine('🚧 Comando → controladora: cancela ABRIU','gate');
  g.classList.add('enter-car');
  setTimeout(()=>{g.classList.remove('enter-car');g.classList.add('pass-car');},1400);
  setTimeout(()=>{
    g.classList.remove('open','pass-car');
    $('#gateStatus').className='gate-status closed';$('#gateStatus').textContent='Fechada';
    logLine('🚧 Veículo passou · cancela fechou','gate');
    if(afterMsg)logLine(afterMsg,'ok');
    renderIdle();
  },3600);
}
function runCamera(plate, cb){
  $('#camPanel').style.display='';
  const cam=$('#cam');
  cam.innerHTML='<span class="cam-tag">REC</span><div class="scan"></div><span class="cam-off">detectando placa…</span>';
  logLine('📷 Câmera LPR ativada · capturando','');
  setTimeout(()=>{
    cam.innerHTML=`<span class="cam-tag">REC</span><div class="scan"></div><div class="plate-read">${plate}</div>`;
    logLine('📷 OCR reconheceu: <b>'+plate+'</b>','ok');
    cb&&cb();
  },1500);
}

/* ═══════════ OPERAÇÃO / TOTEM ═══════════ */
const stage=()=>$('#stage');

function renderIdle(){
  $('#camPanel').style.display = db.cfg.ocr?'':'none';
  stage().innerHTML=`
    <div class="idle-hero">
      <div class="logo">🅿️</div>
      <h2>Bem-vindo ao ${db.cfg.name}</h2>
      <p>${db.cfg.ocr?'Câmera lê a placa automaticamente. Toque para começar.':'Retire o ticket na entrada ou pague na saída.'}</p>
    </div>
    <div class="big-actions">
      <button class="big-btn enter" id="btnEnter"><span class="ic">🎫</span><span class="t">ENTRADA</span><span class="s">Retirar ticket</span></button>
      <button class="big-btn exit" id="btnExit"><span class="ic">💳</span><span class="t">SAÍDA</span><span class="s">Pagar &amp; sair</span></button>
    </div>`;
  $('#btnEnter').onclick=flowEntry;
  $('#btnExit').onclick=()=>flowExitStart();
}

/* — ENTRADA — */
function flowEntry(){
  const occ=activeVehicles().length;
  if(occ>=db.cfg.capacity){ toast('Estacionamento lotado','Sem vagas disponíveis','warn'); return; }
  const plate = db.cfg.ocr ? randPlate() : null;
  if(db.cfg.ocr){
    stage().innerHTML=`<div class="idle-hero"><div class="logo">📷</div><h2>Lendo sua placa…</h2><p>Aguarde um instante.</p></div>`;
    runCamera(plate, ()=>issueTicket(plate));
  } else issueTicket(null);
}
function issueTicket(plate){
  const now=new Date();
  const monthly = plate ? findMonthly(plate) : null;
  const sector = monthly ? monthly.sector : autoSector();
  const rec={ id:++db.seq, plate, type:monthly?'mensalista':'avulso', monthlyId:monthly?monthly.id:null,
    sector, entryTs:now.getTime(), exitTs:null, status:'ativo', charge:null, discount:0, partner:null };
  db.vehicles.push(rec); save();
  const secName=sectorName(sector);
  if(monthly && plate){
    // mensalista: entrada liberada direto
    stage().innerHTML=`
      <div class="confirmed">
        <div class="check" style="background:var(--blue)">👤</div>
        <h2 style="color:var(--blue-light)">Mensalista reconhecido</h2>
        <p><b>${monthly.name}</b> · ${monthly.plan}<br>Placa ${plate} · Vaga ${monthly.spot||secName}</p>
      </div>
      <button class="btn btn-blue" id="proceed">Liberar entrada</button>`;
    logLine(`👤 Mensalista ${monthly.name} entrou · ${plate}`,'ok');
    $('#proceed').onclick=()=>openGate(`✅ Mensalista ${monthly.name} no pátio`);
    return;
  }
  const cv=document.createElement('canvas');cv.width=118;cv.height=118;drawQR(cv,'PARK'+rec.id+rec.entryTs);
  stage().innerHTML=`
    <div class="ticket">
      <h3>🅿️ PARKFLOW</h3><div class="sub">Ticket de Entrada</div>
      <div class="num mono">#${pad4(rec.id)}</div>
      ${plate?`<div class="plate">${plate}</div>`:''}
      <div class="rows">
        <div class="r"><span>Data</span><span>${fmtDate(now)}</span></div>
        <div class="r"><span>Entrada</span><span>${fmtTime(now)}</span></div>
        <div class="r"><span>Setor</span><span>${secName}</span></div>
      </div>
      <div class="qrslot"></div>
      <div class="foot">Guarde este ticket · apresente na saída</div>
    </div>
    <button class="btn btn-green" id="proceed">Retirei o ticket → abrir cancela</button>`;
  const slot=stage().querySelector('.qrslot');slot.appendChild(cv);cv.className='qr';
  logLine(`🎫 Ticket #${pad4(rec.id)} emitido${plate?' · '+plate:''} · ${secName}`,'ok');
  $('#proceed').onclick=()=>openGate(`✅ Entrada #${rec.id} registrada`);
}

/* — SAÍDA — */
function flowExitStart(preId){
  const active=activeVehicles();
  if(db.cfg.ocr && !preId){
    if(!active.length){ return renderExitError('Nenhum veículo no pátio.'); }
    const rec=active[active.length-1];
    stage().innerHTML=`<div class="idle-hero"><div class="logo">📷</div><h2>Identificando veículo…</h2><p>Lendo a placa na saída.</p></div>`;
    runCamera(rec.plate||randPlate(), ()=>renderExitSummary(rec));
    return;
  }
  if(preId){
    const rec=db.vehicles.find(v=>v.id===preId&&v.status==='ativo');
    if(rec) return renderExitSummary(rec);
  }
  stage().innerHTML=`
    <div class="pay-card">
      <div class="field"><label>Número do ticket ou placa</label><input type="text" id="tk" class="mono" placeholder="ex: 0421 ou ABC1D23" autocomplete="off"></div>
      <div id="tkErr"></div>
      <button class="btn btn-full" id="lookup">Consultar</button>
      <button class="btn btn-ghost btn-full btn-sm" id="cancel">Voltar</button>
      ${active.length?`<div class="hint">💡 No pátio: ${active.slice(-6).map(r=>'#'+pad4(r.id)).join(', ')}${active.length>6?'…':''}</div>`:''}
    </div>`;
  const inp=$('#tk');inp.focus();
  $('#lookup').onclick=()=>{
    const val=inp.value.trim();
    let rec=null;
    if(/^\d+$/.test(val.replace(/\D/g,''))&&val.replace(/\D/g,'')) rec=db.vehicles.find(v=>v.id===parseInt(val.replace(/\D/g,''),10)&&v.status==='ativo');
    if(!rec){ const np=normPlate(val); rec=db.vehicles.find(v=>v.status==='ativo'&&normPlate(v.plate)===np); }
    if(!rec){ $('#tkErr').innerHTML='<div class="err">Ticket/placa não encontrado no pátio.</div>'; return; }
    renderExitSummary(rec);
  };
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')$('#lookup').click();});
  $('#cancel').onclick=renderIdle;
}
function renderExitError(msg){
  stage().innerHTML=`<div class="idle-hero"><div class="logo">⚠️</div><h2>Ops</h2><p>${msg}</p></div><button class="btn btn-ghost" id="bk">Voltar</button>`;
  $('#bk').onclick=renderIdle;
}
function renderExitSummary(rec){
  const mins=elapsedMin(rec);
  const monthly = rec.monthlyId ? db.monthlies.find(m=>m.id===rec.monthlyId&&m.status==='ativo') : null;
  const entry=new Date(rec.entryTs);
  let gross = monthly ? 0 : calcCharge(mins, db.cfg.tariff);
  const discount = rec._discount||0, partner=rec._partner||null;
  const net = Math.max(0, gross - discount);
  const secName=sectorName(rec.sector);
  logLine(`💳 Saída #${pad4(rec.id)} · ${fmtDur(mins)} · ${money(net)}`,'');

  stage().innerHTML=`
    <div class="pay-card">
      <div class="summary">
        ${rec.plate?`<div class="line"><span>Placa</span><span class="v mono">${rec.plate}</span></div>`:''}
        <div class="line"><span>Ticket</span><span class="v mono">#${pad4(rec.id)}</span></div>
        <div class="line"><span>Tipo</span><span class="v">${rec.type==='mensalista'?'Mensalista':'Avulso'}</span></div>
        <div class="line"><span>Entrada</span><span class="v">${fmtDT(entry)}</span></div>
        <div class="line"><span>Permanência</span><span class="v">${fmtDur(mins)}</span></div>
        ${monthly?`<div class="line"><span>Mensalista</span><span class="v">${monthly.name}</span></div>`:`<div class="line"><span>Tarifa</span><span class="v">${money(gross)}</span></div>`}
        ${partner?`<div class="line disc"><span>Convênio (${partner.name})</span><span class="v">- ${money(discount)}</span></div>`:''}
        <div class="line total"><span>Total a pagar</span><span class="v">${money(net)}</span></div>
      </div>
      ${monthly||net===0
        ? `<button class="btn btn-green btn-full btn-lg" id="freeout">${monthly?'Liberar mensalista':'Sair — sem cobrança'}</button>`
        : `${!partner?`<button class="btn btn-ghost btn-full btn-sm" id="applyConv">🤝 Aplicar convênio / validação</button>`:''}
           <div class="hint" style="text-align:center">Escolha a forma de pagamento:</div>
           <div class="pay-methods">
             <button class="pay-m pix" data-m="pix"><span class="mi">📱</span>PIX</button>
             <button class="pay-m" data-m="cartao"><span class="mi">💳</span>Cartão</button>
             <button class="pay-m" data-m="dinheiro"><span class="mi">💵</span>Dinheiro</button>
           </div>`}
      <button class="btn btn-ghost btn-full btn-sm" id="cancel">Cancelar</button>
    </div>`;
  $('#cancel').onclick=renderIdle;
  if(monthly||net===0){
    $('#freeout').onclick=()=>settle(rec,0,mins,'gratis',discount,partner,`✅ #${pad4(rec.id)} liberado sem cobrança`);
  }else{
    if($('#applyConv')) $('#applyConv').onclick=()=>chooseConvenio(rec, gross, mins);
    $$('.pay-m').forEach(b=>b.onclick=()=>payMethod(rec, net, mins, b.dataset.m, discount, partner));
  }
}
function chooseConvenio(rec, gross, mins){
  const opts=db.partners.filter(p=>p.status==='ativo').map(p=>`<option value="${p.id}">${p.name} — ${p.label}</option>`).join('');
  openModal('🤝 Validar convênio',
    `<div class="field"><label>Parceiro</label><select id="convSel"><option value="">Selecione…</option>${opts}</select></div>
     <p class="hint" style="margin-top:12px">A validação aplica o benefício do parceiro sobre o valor a pagar (${money(gross)}).</p>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-green" id="convOk">Aplicar</button>`);
  $('#convOk').onclick=()=>{
    const p=db.partners.find(x=>x.id===$('#convSel').value);
    if(!p){ closeModal(); return; }
    let disc=0;
    if(p.type==='free') disc=gross;
    else if(p.type==='discount') disc=Math.min(gross,p.value);
    else if(p.type==='percent') disc=gross*p.value/100;
    else if(p.type==='freehours'){ const freeCharge=calcCharge(Math.max(0,mins-p.value*60),db.cfg.tariff); disc=gross-freeCharge; }
    p.today=(p.today||0)+1;
    rec._discount=Math.round(disc*100)/100; rec._partner=p; save();
    closeModal();
    toast('Convênio aplicado', `${p.name} · -${money(disc)}`,'ok');
    logLine(`🤝 Convênio ${p.name} aplicado · -${money(disc)}`,'ok');
    renderExitSummary(rec);
  };
}
function payMethod(rec, amount, mins, method, discount, partner){
  if(db.cfg.requireCash && !db.cashier.open && method!=='pix'){
    toast('Caixa fechado','Abra o caixa para receber em cartão/dinheiro','warn'); return;
  }
  if(method==='pix') return renderPix(rec, amount, mins, discount, partner);
  if(method==='cartao') return renderCard(rec, amount, mins, discount, partner);
  if(method==='dinheiro') return renderCash(rec, amount, mins, discount, partner);
}
function renderPix(rec, amount, mins, discount, partner){
  const cv=document.createElement('canvas');cv.width=148;cv.height=148;
  const payload=`00020126PIX${db.cfg.pixKey}5204000053039865${amount.toFixed(2)}6009SAO PAULO`;
  drawQR(cv, payload+rec.id);
  stage().innerHTML=`
    <div class="pay-card">
      <div class="pix-box">
        <div class="pix-h"><span class="pl">₽</span> Pague ${money(amount)} via PIX</div>
        <div class="qrslot"></div>
        <div class="pix-copia mono">${payload.slice(0,44)}…</div>
        <div class="await" id="await"><span class="spinner"></span> Consultando API do banco…</div>
      </div>
      ${db.cfg.autoPix?'':'<button class="btn btn-green btn-full" id="simpay">🏦 Simular pagamento recebido</button>'}
      <button class="btn btn-ghost btn-full btn-sm" id="cancel">Cancelar</button>`;
  const slot=stage().querySelector('.qrslot');slot.appendChild(cv);cv.className='qr';cv.style.width='148px';cv.style.height='148px';
  logLine('₽ QR PIX gerado · consultando banco…','pay');
  $('#cancel').onclick=renderIdle;
  const done=()=>{ logLine(`₽ PIX confirmado · ${money(amount)}`,'pay'); renderConfirmed(rec,amount,mins,'pix',discount,partner); };
  if(db.cfg.autoPix){ const t=2000+Math.random()*3000; setTimeout(()=>{if($('#await'))done();},t); }
  else $('#simpay').onclick=done;
}
function renderCard(rec, amount, mins, discount, partner){
  stage().innerHTML=`
    <div class="pay-card">
      <div class="pix-box">
        <div class="pix-h"><span class="pl" style="background:var(--blue)">💳</span> Cartão · ${money(amount)}</div>
        <div style="font-size:44px">💳</div>
        <div class="await" id="await"><span class="spinner"></span> Aproxime/insira o cartão…</div>
      </div>
      <button class="btn btn-blue btn-full" id="approve">Simular aprovação</button>
      <button class="btn btn-ghost btn-full btn-sm" id="cancel">Cancelar</button>`;
  $('#cancel').onclick=renderIdle;
  $('#approve').onclick=()=>{ logLine(`💳 Cartão aprovado · ${money(amount)}`,'pay'); renderConfirmed(rec,amount,mins,'cartao',discount,partner); };
}
function renderCash(rec, amount, mins, discount, partner){
  const notes=[5,10,20,50,100];
  stage().innerHTML=`
    <div class="pay-card">
      <div class="summary"><div class="line total"><span>Valor a receber</span><span class="v">${money(amount)}</span></div></div>
      <div class="field"><label>Valor recebido (R$)</label><input type="number" id="recv" step="0.5" min="0" value="${amount.toFixed(2)}" class="mono"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center">
        ${notes.map(n=>`<button class="btn btn-ghost btn-sm" data-n="${n}">R$ ${n}</button>`).join('')}
      </div>
      <div id="changeArea"></div>
      <button class="btn btn-green btn-full" id="confirmCash">Confirmar recebimento</button>
      <button class="btn btn-ghost btn-full btn-sm" id="cancel">Cancelar</button>`;
  const recv=$('#recv');
  const upd=()=>{ const r=parseFloat(recv.value)||0; const ch=r-amount;
    $('#changeArea').innerHTML = ch>=0?`<div class="change-box">Troco<div class="cv">${money(ch)}</div></div>`:`<div class="err" style="text-align:center">Valor insuficiente</div>`;
    $('#confirmCash').disabled = r<amount; };
  recv.oninput=upd; upd();
  $$('[data-n]').forEach(b=>b.onclick=()=>{recv.value=b.dataset.n;upd();});
  $('#cancel').onclick=renderIdle;
  $('#confirmCash').onclick=()=>{ const r=parseFloat(recv.value)||0; logLine(`💵 Dinheiro · recebido ${money(r)} · troco ${money(r-amount)}`,'pay'); renderConfirmed(rec,amount,mins,'dinheiro',discount,partner); };
}
function renderConfirmed(rec, amount, mins, method, discount, partner){
  const label={pix:'PIX',cartao:'Cartão',dinheiro:'Dinheiro'}[method]||method;
  stage().innerHTML=`
    <div class="confirmed">
      <div class="check">✓</div>
      <h2>Pagamento confirmado!</h2>
      <p>${money(amount)} via ${label} · Abrindo a cancela…</p>
    </div>`;
  settle(rec, amount, mins, method, discount, partner, `✅ #${pad4(rec.id)} pago (${money(amount)} · ${label}) — liberado`);
}
function settle(rec, amount, mins, method, discount, partner, msg){
  rec.status='pago'; rec.exitTs=Date.now(); rec.charge=amount; rec.minutes=Math.round(mins);
  rec.method=method; rec.discount=discount||0; rec.partner=partner?partner.name:null;
  delete rec._discount; delete rec._partner;
  if(amount>0 && db.cashier.open){
    db.cashier.movements.push({type:'venda', method, amount, ts:Date.now(), ref:'#'+pad4(rec.id)});
  }
  save();
  setTimeout(()=>openGate(msg), amount===0?300:800);
}

/* ═══════════ HELPERS de domínio ═══════════ */
function pad4(n){return String(n).padStart(4,'0');}
function activeVehicles(){return db.vehicles.filter(v=>v.status==='ativo');}
function findMonthly(plate){const np=normPlate(plate);return db.monthlies.find(m=>m.status==='ativo'&&normPlate(m.plate)===np);}
function sectorName(id){const s=db.sectors.find(x=>x.id===id);return s?s.name:'—';}
function autoSector(){ // setor com mais vaga livre
  let best=db.sectors[0],bestFree=-1;
  db.sectors.forEach(s=>{const used=activeVehicles().filter(v=>v.sector===s.id).length;const free=s.capacity-used;if(free>bestFree){bestFree=free;best=s;}});
  return best.id;
}

/* ═══════════ CHROME (topbar/sidebar counters) ═══════════ */
function refreshChrome(){
  const occ=activeVehicles().length;
  $('#tbOcc').textContent=`${occ}/${db.cfg.capacity}`;
  $('#nvPatio').textContent=occ;
  $('#nvMens').textContent=db.monthlies.filter(m=>m.status==='ativo').length;
  const c=$('#tbCash'), t=$('#tbCashTxt');
  if(db.cashier.open){ c.className='pill cash-open'; t.textContent=`Caixa aberto · ${db.cashier.operator}`; }
  else{ c.className='pill cash-closed'; t.textContent='Caixa fechado'; }
}

/* ═══════════ PÁTIO ═══════════ */
function renderPatio(){
  const active=activeVehicles();
  const occ=active.length, cap=db.cfg.capacity;
  const avgMin = active.length? active.reduce((s,v)=>s+elapsedMin(v),0)/active.length : 0;
  const potential = active.reduce((s,v)=>s+(v.type==='mensalista'?0:calcCharge(elapsedMin(v),db.cfg.tariff)),0);
  $('#patioKpis').innerHTML=`
    ${kpi('Ocupação',`${occ}/${cap}`,`${Math.round(occ/cap*100)}% do pátio`,'🚗','blue')}
    ${kpi('Vagas livres', cap-occ,'disponíveis agora','🅿️','green')}
    ${kpi('Permanência média', fmtDur(avgMin),'dos veículos ativos','⏱️','gold')}
    ${kpi('A receber (pátio)', money(potential),'se saíssem agora','💵','purple')}`;
  $('#occGrid').innerHTML=db.sectors.map(s=>{
    const used=active.filter(v=>v.sector===s.id).length;
    const pct=Math.min(100,Math.round(used/s.capacity*100));
    const cls=pct>=90?'high':pct>=60?'mid':'';
    return `<div class="occ-card">
      <div class="oc-h"><b>${s.icon} ${s.name}</b><span class="oc-nums"><b>${used}</b>/${s.capacity}</span></div>
      <div class="bar"><div class="fill ${cls}" style="width:${pct}%"></div></div>
      <div class="oc-pct">${pct}% ocupado · ${s.capacity-used} livres</div>
    </div>`;
  }).join('');
  renderPatioRows();
}
function renderPatioRows(filter=''){
  const f=filter.toLowerCase();
  let active=activeVehicles().slice().sort((a,b)=>a.entryTs-b.entryTs);
  if(f) active=active.filter(v=>(v.plate||'').toLowerCase().includes(f)||pad4(v.id).includes(f.replace(/\D/g,'')));
  const tb=$('#patioRows');
  if(!active.length){ tb.innerHTML=`<tr><td colspan="8"><div class="empty"><div class="big">🅿️</div>Pátio vazio.</div></td></tr>`; return; }
  tb.innerHTML=active.map(v=>{
    const mins=elapsedMin(v);
    const charge=v.type==='mensalista'?0:calcCharge(mins,db.cfg.tariff);
    const typeTag=v.type==='mensalista'?'<span class="tag blue">Mensalista</span>':'<span class="tag gray">Avulso</span>';
    return `<tr>
      <td class="mono">#${pad4(v.id)}</td>
      <td>${v.plate?`<span class="plate-badge">${v.plate}</span>`:'—'}</td>
      <td>${typeTag}</td>
      <td>${sectorName(v.sector)}</td>
      <td>${fmtDT(new Date(v.entryTs))}</td>
      <td>${fmtDur(mins)}</td>
      <td>${v.type==='mensalista'?'<span class="muted3">isento</span>':money(charge)}</td>
      <td><button class="btn btn-sm" onclick="goExit(${v.id})">Cobrar / Liberar</button></td>
    </tr>`;
  }).join('');
}
function goExit(id){ switchView('operacao'); setTimeout(()=>flowExitStart(id),60); }

/* ═══════════ MENSALISTAS ═══════════ */
function renderMensalistas(){
  const ativos=db.monthlies.filter(m=>m.status==='ativo');
  const mrr=ativos.reduce((s,m)=>s+m.price,0);
  const venc=db.monthlies.filter(m=>m.status==='ativo'&&m.validUntil-Date.now()<7*DAY).length;
  $('#mensKpis').innerHTML=`
    ${kpi('Mensalistas ativos', ativos.length,'contratos vigentes','👤','blue')}
    ${kpi('Receita recorrente', money(mrr),'MRR mensal','💳','green')}
    ${kpi('Vencendo em 7 dias', venc,'renovações a cobrar','⏰','gold')}
    ${kpi('Vencidos', db.monthlies.filter(m=>m.status==='vencido').length,'inadimplentes','⚠️','red')}`;
  renderMensRows();
}
function renderMensRows(filter=''){
  const f=filter.toLowerCase();
  let list=db.monthlies.slice();
  if(f) list=list.filter(m=>m.name.toLowerCase().includes(f)||m.plate.toLowerCase().includes(f));
  const tb=$('#mensRows');
  if(!list.length){ tb.innerHTML=`<tr><td colspan="8"><div class="empty"><div class="big">👤</div>Nenhum mensalista.</div></td></tr>`; return; }
  tb.innerHTML=list.map(m=>{
    const days=Math.ceil((m.validUntil-Date.now())/DAY);
    let st = m.status==='vencido'?'<span class="tag red">Vencido</span>':days<7?'<span class="tag gold">Vence em '+days+'d</span>':'<span class="tag green">Ativo</span>';
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px"><span class="avatar">${initials(m.name)}</span><div><b>${m.name}</b><br><small class="muted3">${m.phone}</small></div></div></td>
      <td><span class="plate-badge">${m.plate}</span></td>
      <td>${m.plan}</td>
      <td class="mono">${m.spot||'—'}</td>
      <td>${money(m.price)}</td>
      <td>${fmtDate(new Date(m.validUntil))}</td>
      <td>${st}</td>
      <td><div class="row-actions">
        <button class="icon-btn" title="Renovar +30d" onclick="renewMonthly('${m.id}')">🔄</button>
        <button class="icon-btn" title="Editar" onclick="editMonthly('${m.id}')">✏️</button>
        <button class="icon-btn danger" title="Excluir" onclick="delMonthly('${m.id}')">🗑️</button>
      </div></td>
    </tr>`;
  }).join('');
}
function monthlyForm(m){
  const secs=db.sectors.map(s=>`<option value="${s.id}" ${m&&m.sector===s.id?'selected':''}>${s.name}</option>`).join('');
  return `<div class="form-grid">
    <div class="field full"><label>Nome do cliente</label><input id="mName" value="${m?m.name:''}" placeholder="Nome completo"></div>
    <div class="field"><label>Placa</label><input id="mPlate" class="mono" value="${m?m.plate:''}" placeholder="ABC1D23"></div>
    <div class="field"><label>Telefone</label><input id="mPhone" value="${m?m.phone:''}" placeholder="(11) 90000-0000"></div>
    <div class="field"><label>Plano</label><select id="mPlan">
      ${['Mensal Carro','Mensal Moto','Diarista 12h','Mensal VIP'].map(p=>`<option ${m&&m.plan===p?'selected':''}>${p}</option>`).join('')}
    </select></div>
    <div class="field"><label>Mensalidade (R$)</label><input id="mPrice" type="number" step="10" value="${m?m.price:300}"></div>
    <div class="field"><label>Setor</label><select id="mSector">${secs}</select></div>
    <div class="field"><label>Vaga</label><input id="mSpot" value="${m?(m.spot||''):''}" placeholder="C-04"></div>
  </div>`;
}
function addMens(){
  openModal('👤 Novo mensalista', monthlyForm(null),
    `<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn" id="saveM">Salvar</button>`);
  $('#saveM').onclick=()=>saveMonthly(null);
}
function editMonthly(id){
  const m=db.monthlies.find(x=>x.id===id);
  openModal('✏️ Editar mensalista', monthlyForm(m),
    `<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn" id="saveM">Salvar</button>`);
  $('#saveM').onclick=()=>saveMonthly(id);
}
function saveMonthly(id){
  const data={ name:$('#mName').value.trim(), plate:normPlate($('#mPlate').value), phone:$('#mPhone').value.trim(),
    plan:$('#mPlan').value, price:parseFloat($('#mPrice').value)||0, sector:$('#mSector').value, spot:$('#mSpot').value.trim() };
  if(!data.name||!data.plate){ toast('Preencha nome e placa','','warn'); return; }
  if(id){ Object.assign(db.monthlies.find(x=>x.id===id), data); toast('Mensalista atualizado','','ok'); }
  else{ db.monthlies.push(Object.assign({id:uid(),since:Date.now(),validUntil:Date.now()+30*DAY,status:'ativo'},data)); toast('Mensalista cadastrado',data.name,'ok'); }
  save(); closeModal(); renderMensalistas();
}
function renewMonthly(id){ const m=db.monthlies.find(x=>x.id===id); m.validUntil=Math.max(Date.now(),m.validUntil)+30*DAY; m.status='ativo'; save(); toast('Renovado +30 dias',m.name,'ok'); renderMensalistas(); }
function delMonthly(id){ const m=db.monthlies.find(x=>x.id===id); if(confirm('Excluir '+m.name+'?')){ db.monthlies=db.monthlies.filter(x=>x.id!==id); save(); renderMensalistas(); } }

/* ═══════════ CONVÊNIOS ═══════════ */
function renderConvenios(){
  const tb=$('#convRows');
  const typeLabel={free:'Isenção total',discount:'Desconto fixo',percent:'Percentual',freehours:'Horas grátis'};
  tb.innerHTML=db.partners.map(p=>`<tr>
    <td><b>${p.name}</b></td>
    <td><span class="tag purple">${typeLabel[p.type]}</span></td>
    <td>${p.label}</td>
    <td><b>${p.today||0}</b></td>
    <td>${p.status==='ativo'?'<span class="tag green">Ativo</span>':'<span class="tag gray">Inativo</span>'}</td>
    <td><div class="row-actions">
      <button class="icon-btn" title="Editar" onclick="editConv('${p.id}')">✏️</button>
      <button class="icon-btn danger" title="Excluir" onclick="delConv('${p.id}')">🗑️</button>
    </div></td>
  </tr>`).join('') || `<tr><td colspan="6"><div class="empty"><div class="big">🤝</div>Nenhum convênio.</div></td></tr>`;
}
function convForm(p){
  const types=[['free','Isenção total'],['discount','Desconto fixo (R$)'],['percent','Percentual (%)'],['freehours','Horas grátis']];
  return `<div class="form-grid">
    <div class="field full"><label>Nome do parceiro</label><input id="cName" value="${p?p.name:''}" placeholder="Loja / Restaurante"></div>
    <div class="field"><label>Tipo de benefício</label><select id="cType">${types.map(t=>`<option value="${t[0]}" ${p&&p.type===t[0]?'selected':''}>${t[1]}</option>`).join('')}</select></div>
    <div class="field"><label>Valor (R$ / % / horas)</label><input id="cVal" type="number" step="1" value="${p?p.value:0}"></div>
  </div>`;
}
function addConv(){ openModal('🤝 Novo convênio', convForm(null), `<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn" id="saveC">Salvar</button>`); $('#saveC').onclick=()=>saveConv(null); }
function editConv(id){ const p=db.partners.find(x=>x.id===id); openModal('✏️ Editar convênio', convForm(p), `<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn" id="saveC">Salvar</button>`); $('#saveC').onclick=()=>saveConv(id); }
function saveConv(id){
  const type=$('#cType').value, val=parseFloat($('#cVal').value)||0, name=$('#cName').value.trim();
  if(!name){ toast('Informe o nome','','warn'); return; }
  const label = type==='free'?'Isenção total':type==='discount'?`R$ ${val} desconto`:type==='percent'?`${val}% off`:`${val}h grátis`;
  if(id){ Object.assign(db.partners.find(x=>x.id===id),{name,type,value:val,label}); }
  else{ db.partners.push({id:uid(),name,type,value:val,label,today:0,status:'ativo'}); }
  save(); closeModal(); renderConvenios(); toast('Convênio salvo',name,'ok');
}
function delConv(id){ if(confirm('Excluir convênio?')){ db.partners=db.partners.filter(x=>x.id!==id); save(); renderConvenios(); } }

/* ═══════════ TARIFAS ═══════════ */
function renderTarifas(){
  const t=db.cfg.tariff;
  $('#tarifasBody').innerHTML=`
    <div class="two-col">
      <div class="card">
        <div class="card-h"><h3><span class="emoji">🏷️</span> Tabela de tarifas</h3></div>
        <div class="set-grid">
          ${tf('graceMin','Tolerância grátis (min)',t.graceMin)}
          ${tf('minPrice','Valor mínimo (R$)',t.minPrice)}
          ${tf('firstMin','1ª fração (min)',t.firstMin)}
          ${tf('firstPrice','Valor 1ª fração (R$)',t.firstPrice)}
          ${tf('addMin','Fração adicional (min)',t.addMin)}
          ${tf('addPrice','Valor fração adic. (R$)',t.addPrice)}
          ${tf('dailyMax','Teto diária (R$)',t.dailyMax)}
          ${tf('nightPrice','Pernoite (R$)',t.nightPrice)}
          ${tf('lostTicket','Perda de ticket (R$)',t.lostTicket)}
        </div>
        <button class="btn" id="saveTar" style="margin-top:18px">Salvar tarifas</button>
      </div>
      <div class="card">
        <div class="card-h"><h3><span class="emoji">🧮</span> Simulador de cobrança</h3></div>
        <div class="field"><label>Permanência (minutos)</label><input type="range" id="simRange" min="0" max="1440" value="138" style="width:100%"></div>
        <div class="summary" style="margin-top:14px">
          <div class="line"><span>Permanência</span><span class="v" id="simDur">—</span></div>
          <div class="line total"><span>Valor calculado</span><span class="v" id="simVal">—</span></div>
        </div>
        <div id="simTable" style="margin-top:16px"></div>
      </div>
    </div>`;
  $('#saveTar').onclick=()=>{
    ['graceMin','minPrice','firstMin','firstPrice','addMin','addPrice','dailyMax','nightPrice','lostTicket'].forEach(k=>{
      db.cfg.tariff[k]=parseFloat($('#tf_'+k).value)||0;
    });
    save(); toast('Tarifas atualizadas','','ok'); renderTarifas();
  };
  const r=$('#simRange');
  const upd=()=>{ const m=+r.value; $('#simDur').textContent=fmtDur(m); $('#simVal').textContent=money(calcCharge(m,db.cfg.tariff)); };
  r.oninput=upd; upd();
  $('#simTable').innerHTML='<table style="width:100%"><thead><tr><th>Tempo</th><th>Valor</th></tr></thead><tbody>'+
    [15,30,60,90,120,180,240,480,720,1440].map(m=>`<tr><td>${fmtDur(m)}</td><td>${money(calcCharge(m,db.cfg.tariff))}</td></tr>`).join('')+'</tbody></table>';
}
function tf(k,label,val){ return `<div class="field"><label>${label}</label><input type="number" step="0.5" id="tf_${k}" value="${val}"></div>`; }

/* ═══════════ CAIXA ═══════════ */
function renderCaixa(){
  const c=db.cashier;
  if(!c.open){
    $('#caixaBody').innerHTML=`
      <div class="card" style="max-width:460px;margin:0 auto;text-align:center">
        <div style="font-size:52px">💰</div>
        <h3 style="margin:10px 0 6px">Caixa fechado</h3>
        <p class="muted" style="margin-bottom:20px">Abra o turno para começar a registrar pagamentos em cartão e dinheiro.</p>
        <div class="field" style="text-align:left;margin-bottom:12px"><label>Operador</label><select id="cxOp">${db.operators.map(o=>`<option>${o}</option>`).join('')}</select></div>
        <div class="field" style="text-align:left;margin-bottom:18px"><label>Fundo de troco inicial (R$)</label><input type="number" id="cxFloat" value="100" step="10"></div>
        <button class="btn btn-green btn-full btn-lg" id="openCash">🔓 Abrir caixa</button>
      </div>`;
    $('#openCash').onclick=()=>{
      db.cashier={open:true,operator:$('#cxOp').value,openedTs:Date.now(),openingFloat:parseFloat($('#cxFloat').value)||0,movements:[]};
      save(); toast('Caixa aberto',db.cashier.operator,'ok'); renderCaixa();
    };
    return;
  }
  const byMethod=m=>c.movements.filter(x=>x.type==='venda'&&x.method===m).reduce((s,x)=>s+x.amount,0);
  const sangrias=c.movements.filter(x=>x.type==='sangria').reduce((s,x)=>s+x.amount,0);
  const suprimentos=c.movements.filter(x=>x.type==='suprimento').reduce((s,x)=>s+x.amount,0);
  const vendas=c.movements.filter(x=>x.type==='venda').reduce((s,x)=>s+x.amount,0);
  const cashInDrawer=c.openingFloat+byMethod('dinheiro')+suprimentos-sangrias;
  $('#caixaBody').innerHTML=`
    <div class="kpis">
      ${kpi('Turno aberto', fmtHM(new Date(c.openedTs)),c.operator,'🕐','blue')}
      ${kpi('Total vendido', money(vendas),c.movements.filter(x=>x.type==='venda').length+' transações','💵','green')}
      ${kpi('Dinheiro em caixa', money(cashInDrawer),'fundo + recebido','🪙','gold')}
      ${kpi('Sangrias', money(sangrias),'retiradas do caixa','📤','red')}
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-h"><h3><span class="emoji">💳</span> Recebido por forma</h3></div>
        <div class="summary">
          <div class="line"><span>📱 PIX</span><span class="v">${money(byMethod('pix'))}</span></div>
          <div class="line"><span>💳 Cartão</span><span class="v">${money(byMethod('cartao'))}</span></div>
          <div class="line"><span>💵 Dinheiro</span><span class="v">${money(byMethod('dinheiro'))}</span></div>
          <div class="line total"><span>Total</span><span class="v">${money(vendas)}</span></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" id="btnSangria">📤 Sangria</button>
          <button class="btn btn-ghost btn-sm" id="btnSuprimento">📥 Suprimento</button>
          <button class="btn btn-sm" id="btnClose" style="margin-left:auto">🔒 Fechar caixa</button>
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h3><span class="emoji">📜</span> Movimentações</h3></div>
        <div class="log" style="max-height:320px">
          ${c.movements.slice().reverse().map(m=>{
            const lbl={venda:'Venda',sangria:'Sangria',suprimento:'Suprimento'}[m.type];
            const cls=m.type==='venda'?'pay':m.type==='sangria'?'warn':'ok';
            return `<div class="l ${cls}"><span class="tm mono">${fmtHM(new Date(m.ts))}</span><span>${lbl} ${m.ref||''} ${m.method?'· '+m.method:''} · <b>${money(m.amount)}</b></span></div>`;
          }).join('')||'<div class="muted3" style="padding:10px">Sem movimentações ainda.</div>'}
        </div>
      </div>
    </div>`;
  $('#btnSangria').onclick=()=>cashMove('sangria');
  $('#btnSuprimento').onclick=()=>cashMove('suprimento');
  $('#btnClose').onclick=closeCash;
}
function cashMove(type){
  const t=type==='sangria'?'📤 Sangria (retirada)':'📥 Suprimento (reforço)';
  openModal(t, `<div class="field"><label>Valor (R$)</label><input type="number" id="cmVal" step="10" value="50"></div><div class="field" style="margin-top:12px"><label>Observação</label><input id="cmObs" placeholder="Motivo (opcional)"></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn" id="cmOk">Confirmar</button>`);
  $('#cmOk').onclick=()=>{ const v=parseFloat($('#cmVal').value)||0; if(v<=0){closeModal();return;} db.cashier.movements.push({type,amount:v,ts:Date.now(),ref:$('#cmObs').value||''}); save(); closeModal(); renderCaixa(); toast(type==='sangria'?'Sangria registrada':'Suprimento registrado',money(v),'ok'); };
}
function closeCash(){
  const c=db.cashier;
  const vendas=c.movements.filter(x=>x.type==='venda').reduce((s,x)=>s+x.amount,0);
  openModal('🔒 Fechar caixa',
    `<p class="muted" style="margin-bottom:14px">Turno de <b>${c.operator}</b> · aberto às ${fmtHM(new Date(c.openedTs))}</p>
     <div class="summary"><div class="line"><span>Transações</span><span class="v">${c.movements.filter(x=>x.type==='venda').length}</span></div>
     <div class="line total"><span>Total do turno</span><span class="v">${money(vendas)}</span></div></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-green" id="closeOk">Confirmar fechamento</button>`);
  $('#closeOk').onclick=()=>{
    db.history=db.history||[]; db.history.push({operator:c.operator,openedTs:c.openedTs,closedTs:Date.now(),total:vendas,movements:c.movements.length});
    db.cashier={open:false,operator:null,openedTs:null,openingFloat:0,movements:[]};
    save(); closeModal(); toast('Caixa fechado',money(vendas)+' no turno','ok'); renderCaixa();
  };
}

/* ═══════════ RELATÓRIOS / BI ═══════════ */
function renderRelatorios(){
  const paid=db.vehicles.filter(v=>v.status==='pago');
  const today=new Date().toDateString();
  const revToday=paid.filter(v=>new Date(v.exitTs).toDateString()===today).reduce((s,v)=>s+(v.charge||0),0);
  const rev7=paid.filter(v=>Date.now()-v.exitTs<7*DAY).reduce((s,v)=>s+(v.charge||0),0);
  const avgTicket=paid.length?paid.reduce((s,v)=>s+(v.charge||0),0)/paid.length:0;
  const avgStay=paid.length?paid.reduce((s,v)=>s+(v.minutes||0),0)/paid.length:0;
  $('#relBody').innerHTML=`
    <div class="kpis">
      ${kpi('Faturamento hoje',money(revToday),'entradas pagas hoje','💰','green')}
      ${kpi('Faturamento 7 dias',money(rev7),'acumulado semanal','📈','blue')}
      ${kpi('Ticket médio',money(avgTicket),'por veículo','🎟️','gold')}
      ${kpi('Permanência média',fmtDur(avgStay),'tempo por veículo','⏱️','purple')}
    </div>
    <div class="chart-grid">
      <div class="chart-box"><h3>Faturamento diário</h3><div class="csub">Últimos 7 dias</div><canvas class="chart-canvas" id="chRev" height="240"></canvas></div>
      <div class="chart-box"><h3>Formas de pagamento</h3><div class="csub">Distribuição da receita</div><canvas class="chart-canvas" id="chPay" height="200"></canvas><div class="legend" id="payLeg"></div></div>
    </div>
    <div class="chart-grid" style="grid-template-columns:1fr 1fr">
      <div class="chart-box"><h3>Movimento por hora</h3><div class="csub">Entradas ao longo do dia</div><canvas class="chart-canvas" id="chHour" height="200"></canvas></div>
      <div class="chart-box"><h3>Receita por setor</h3><div class="csub">Onde o dinheiro entra</div><canvas class="chart-canvas" id="chSector" height="200"></canvas><div class="legend" id="secLeg"></div></div>
    </div>
    <div class="table-wrap" style="margin-top:16px">
      <div class="table-head"><h3>Últimas movimentações</h3><button class="btn btn-ghost btn-sm" id="expCsv">⬇️ Exportar CSV</button></div>
      <div class="scroll-x"><table><thead><tr><th>Ticket</th><th>Placa</th><th>Entrada</th><th>Saída</th><th>Permanência</th><th>Forma</th><th>Valor</th></tr></thead>
      <tbody>${paid.slice(-12).reverse().map(v=>`<tr><td class="mono">#${pad4(v.id)}</td><td>${v.plate?`<span class="plate-badge">${v.plate}</span>`:'—'}</td><td>${fmtDT(new Date(v.entryTs))}</td><td>${fmtDT(new Date(v.exitTs))}</td><td>${fmtDur(v.minutes)}</td><td>${methodLabel(v.method)}</td><td><b>${money(v.charge)}</b></td></tr>`).join('')}</tbody></table></div>
    </div>`;
  $('#expCsv').onclick=exportCSV;
  drawReports(paid);
}
function methodLabel(m){ return ({pix:'📱 PIX',cartao:'💳 Cartão',dinheiro:'💵 Dinheiro',gratis:'🆓 Grátis'})[m]||'—'; }

function setupCanvas(id){
  const cv=$('#'+id); const dpr=window.devicePixelRatio||1;
  const w=cv.clientWidth||cv.parentElement.clientWidth-40; const h=cv.height;
  cv.width=w*dpr; cv.height=h*dpr; const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr);
  return {ctx,w,h};
}
function drawReports(paid){
  // Faturamento diário (barras)
  const days=[]; const now=new Date();
  for(let i=6;i>=0;i--){ const d=new Date(now); d.setDate(d.getDate()-i); days.push({label:['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()], key:d.toDateString(), val:0}); }
  paid.forEach(v=>{ const k=new Date(v.exitTs).toDateString(); const d=days.find(x=>x.key===k); if(d)d.val+=v.charge||0; });
  barChart('chRev', days.map(d=>d.label), days.map(d=>d.val), '#1DB954');
  // Formas de pagamento (donut)
  const methods={pix:0,cartao:0,dinheiro:0}; paid.forEach(v=>{ if(methods[v.method]!=null)methods[v.method]+=v.charge||0; });
  const payData=[['PIX',methods.pix,'#1DB954'],['Cartão',methods.cartao,'#3B82F6'],['Dinheiro',methods.dinheiro,'#F5A623']];
  donut('chPay', payData); legend('payLeg', payData);
  // Movimento por hora (linha)
  const hours=Array.from({length:24},(_,h)=>({h,val:0}));
  paid.filter(v=>Date.now()-v.exitTs<7*DAY).forEach(v=>{ hours[new Date(v.entryTs).getHours()].val++; });
  lineChart('chHour', hours.map(x=>x.h), hours.map(x=>x.val), '#8B5CF6');
  // Receita por setor (donut)
  const secMap={}; db.sectors.forEach(s=>secMap[s.id]=0); paid.forEach(v=>{ if(secMap[v.sector]!=null)secMap[v.sector]+=v.charge||0; });
  const cols=['#E8344A','#06B6D4','#F5A623'];
  const secData=db.sectors.map((s,i)=>[s.name,secMap[s.id],cols[i%cols.length]]);
  donut('chSector', secData); legend('secLeg', secData);
}
function barChart(id, labels, values, color){
  const {ctx,w,h}=setupCanvas(id); const max=Math.max(...values,1); const pad=30, bw=(w-pad*2)/labels.length;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='#2A2A30'; ctx.lineWidth=1;
  for(let i=0;i<=4;i++){ const y=pad+(h-pad*2)*(i/4); ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke(); }
  labels.forEach((lb,i)=>{
    const v=values[i]; const bh=(h-pad*2)*(v/max); const x=pad+bw*i+bw*.2; const y=h-pad-bh;
    const g=ctx.createLinearGradient(0,y,0,h-pad); g.addColorStop(0,color); g.addColorStop(1,color+'55');
    ctx.fillStyle=g; roundRect(ctx,x,y,bw*.6,bh,4); ctx.fill();
    ctx.fillStyle='#A1A1AA';ctx.font='11px system-ui';ctx.textAlign='center';ctx.fillText(lb,x+bw*.3,h-pad+15);
    if(v>0){ctx.fillStyle='#FAFAFA';ctx.font='bold 10px system-ui';ctx.fillText('R$'+Math.round(v),x+bw*.3,y-5);}
  });
}
function lineChart(id, labels, values, color){
  const {ctx,w,h}=setupCanvas(id); const max=Math.max(...values,1); const pad=28; const step=(w-pad*2)/(labels.length-1);
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='#2A2A30';ctx.lineWidth=1;
  for(let i=0;i<=3;i++){ const y=pad+(h-pad*2)*(i/3); ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke(); }
  const pts=values.map((v,i)=>[pad+step*i, h-pad-(h-pad*2)*(v/max)]);
  const grad=ctx.createLinearGradient(0,pad,0,h-pad); grad.addColorStop(0,color+'55'); grad.addColorStop(1,color+'00');
  ctx.beginPath();ctx.moveTo(pts[0][0],h-pad); pts.forEach(p=>ctx.lineTo(p[0],p[1])); ctx.lineTo(pts[pts.length-1][0],h-pad);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
  ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.stroke();
  ctx.fillStyle='#71717A';ctx.font='10px system-ui';ctx.textAlign='center';
  [0,6,12,18,23].forEach(hh=>ctx.fillText(hh+'h',pad+step*hh,h-8));
}
function donut(id, data){
  const {ctx,w,h}=setupCanvas(id); const total=data.reduce((s,d)=>s+d[1],0)||1;
  const cx=w/2, cy=h/2, r=Math.min(w,h)/2-10, ir=r*.62; let a=-Math.PI/2;
  ctx.clearRect(0,0,w,h);
  data.forEach(d=>{ const ang=d[1]/total*Math.PI*2; ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,a,a+ang);ctx.closePath();ctx.fillStyle=d[2];ctx.fill(); a+=ang; });
  ctx.beginPath();ctx.arc(cx,cy,ir,0,Math.PI*2);ctx.fillStyle='#111113';ctx.fill();
  ctx.fillStyle='#FAFAFA';ctx.font='bold 15px system-ui';ctx.textAlign='center';ctx.fillText(money(total).replace('R$ ','R$'),cx,cy+2);
  ctx.fillStyle='#71717A';ctx.font='10px system-ui';ctx.fillText('total',cx,cy+16);
}
function legend(id, data){
  const total=data.reduce((s,d)=>s+d[1],0)||1;
  $('#'+id).innerHTML=data.map(d=>`<div class="li"><span class="sw" style="background:${d[2]}"></span>${d[0]}<span class="val">${money(d[1])} · ${Math.round(d[1]/total*100)}%</span></div>`).join('');
}
function roundRect(ctx,x,y,w,h,r){ if(h<r*2)r=h/2; ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath(); }
function exportCSV(){
  const paid=db.vehicles.filter(v=>v.status==='pago');
  const head=['ticket','placa','tipo','setor','entrada','saida','permanencia_min','forma','desconto','valor'];
  const lines=paid.map(v=>[pad4(v.id),v.plate||'',v.type,sectorName(v.sector),new Date(v.entryTs).toISOString(),new Date(v.exitTs).toISOString(),v.minutes,v.method||'',(v.discount||0).toFixed(2),(v.charge||0).toFixed(2)].join(','));
  const csv=[head.join(','),...lines].join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='parkflow_relatorio.csv';a.click();
  toast('CSV exportado',paid.length+' registros','ok');
}

/* ═══════════ CONFIG ═══════════ */
function renderConfig(){
  const c=db.cfg;
  $('#configBody').innerHTML=`
    <div class="section-title">🏢 Estabelecimento</div>
    <div class="set-grid">
      <div class="field"><label>Nome do estacionamento</label><input id="cfName" value="${c.name}"></div>
      <div class="field"><label>Capacidade total (vagas)</label><input type="number" id="cfCap" value="${c.capacity}"></div>
      <div class="field"><label>Chave PIX (recebedor)</label><input id="cfPix" value="${c.pixKey}"></div>
    </div>
    <div class="section-title">📍 Setores / Vagas</div>
    <div id="secList"></div>
    <button class="btn btn-ghost btn-sm" id="addSec" style="margin-top:10px">+ Adicionar setor</button>
    <div class="section-title">⚙️ Automação &amp; simulação</div>
    <div class="set-grid">
      <label class="toggle"><span class="info"><b>Câmera LPR (OCR de placa)</b><small>Lê a placa na entrada/saída e dispensa ticket</small></span><span class="sw"><input type="checkbox" id="cfOcr" ${c.ocr?'checked':''}><span class="track"></span></span></label>
      <label class="toggle"><span class="info"><b>Confirmação PIX automática</b><small>Simula a API do banco em 2–5s</small></span><span class="sw"><input type="checkbox" id="cfAuto" ${c.autoPix?'checked':''}><span class="track"></span></span></label>
      <label class="toggle"><span class="info"><b>Exigir caixa aberto</b><small>Bloqueia cartão/dinheiro com caixa fechado</small></span><span class="sw"><input type="checkbox" id="cfCash" ${c.requireCash?'checked':''}><span class="track"></span></span></label>
      <label class="toggle"><span class="info"><b>Modo demonstração</b><small>Soma +${DEMO_OFFSET} min à permanência p/ exibir cobrança em testes</small></span><span class="sw"><input type="checkbox" id="cfFast" ${c.fastDemo?'checked':''}><span class="track"></span></span></label>
    </div>
    <div class="section-title">🗄️ Dados</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" id="cfExport">⬇️ Exportar dados (JSON)</button>
      <button class="btn btn-ghost btn-sm" id="cfReset">🗑️ Resetar sistema</button>
    </div>
    <p class="foot-note">ParkFlow · protótipo de sistema de gestão de estacionamento inspirado nas plataformas líderes de mercado.<br>A lógica de negócio é real; QR PIX, câmera LPR e integrações de hardware/banco são simulados. Dados 100% locais (localStorage).</p>`;
  renderSectors();
  $('#addSec').onclick=()=>{ db.sectors.push({id:uid(),name:'Novo setor',capacity:20,icon:'🅿️'}); save(); renderSectors(); };
  const bindTxt=(id,key)=>{ const el=$(id); el.onchange=()=>{ db.cfg[key]= key==='capacity'?parseInt(el.value)||0:el.value; save(); }; };
  bindTxt('#cfName','name'); bindTxt('#cfCap','capacity'); bindTxt('#cfPix','pixKey');
  const bindTog=(id,key,after)=>{ const el=$(id); el.onchange=()=>{ db.cfg[key]=el.checked; save(); after&&after(); }; };
  bindTog('#cfOcr','ocr',()=>{}); bindTog('#cfAuto','autoPix'); bindTog('#cfCash','requireCash'); bindTog('#cfFast','fastDemo');
  $('#cfExport').onclick=()=>{ const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(db,null,2)],{type:'application/json'}));a.download='parkflow_backup.json';a.click(); };
  $('#cfReset').onclick=()=>{ if(confirm('Resetar todo o sistema para os dados de demonstração?')){ localStorage.removeItem(LS); db=seed(); save(); toast('Sistema resetado','','ok'); renderConfig(); refreshChrome(); } };
}
function renderSectors(){
  $('#secList').innerHTML=db.sectors.map(s=>`<div class="toggle" style="margin-bottom:8px">
    <span class="info"><b>${s.icon} ${s.name}</b><small>${s.capacity} vagas</small></span>
    <div class="row-actions"><button class="icon-btn" onclick="editSector('${s.id}')">✏️</button><button class="icon-btn danger" onclick="delSector('${s.id}')">🗑️</button></div>
  </div>`).join('');
}
function editSector(id){
  const s=db.sectors.find(x=>x.id===id);
  openModal('📍 Editar setor', `<div class="form-grid"><div class="field"><label>Nome</label><input id="sName" value="${s.name}"></div><div class="field"><label>Ícone</label><input id="sIcon" value="${s.icon}"></div><div class="field full"><label>Capacidade (vagas)</label><input type="number" id="sCap" value="${s.capacity}"></div></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn" id="sOk">Salvar</button>`);
  $('#sOk').onclick=()=>{ s.name=$('#sName').value; s.icon=$('#sIcon').value||'🅿️'; s.capacity=parseInt($('#sCap').value)||0; save(); closeModal(); renderSectors(); };
}
function delSector(id){ if(db.sectors.length<=1){toast('Mantenha ao menos 1 setor','','warn');return;} if(confirm('Excluir setor?')){ db.sectors=db.sectors.filter(x=>x.id!==id); save(); renderSectors(); } }

/* ═══════════ SHARED UI ═══════════ */
function kpi(k,v,sub,ic,cls=''){ return `<div class="kpi ${cls}"><span class="ic">${ic}</span><div class="k">${k}</div><div class="v">${v}</div><div class="sub">${sub}</div></div>`; }
function initials(name){ return name.split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase(); }

/* ═══════════ ROUTER ═══════════ */
const titles={operacao:['🖥️','Operação'],patio:['🚗','Pátio ao vivo'],caixa:['💰','Caixa & Turno'],mensalistas:['👤','Mensalistas'],convenios:['🤝','Convênios'],tarifas:['🏷️','Tarifas'],relatorios:['📊','Relatórios & BI'],config:['⚙️','Configurações']};
function switchView(name){
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $$('.view').forEach(v=>v.classList.remove('active'));
  $('#view-'+name).classList.add('active');
  const [em,ti]=titles[name]; $('#ptEmoji').textContent=em; $('#ptTitle').textContent=ti;
  closeSidebar();
  ({operacao:renderIdle,patio:renderPatio,caixa:renderCaixa,mensalistas:renderMensalistas,convenios:renderConvenios,tarifas:renderTarifas,relatorios:renderRelatorios,config:renderConfig}[name])();
}
$$('.nav-item').forEach(b=>b.onclick=()=>switchView(b.dataset.view));

/* sidebar mobile */
function closeSidebar(){ $('#sidebar').classList.remove('open'); $('#backdrop').classList.remove('open'); }
$('#menuBtn').onclick=()=>{ $('#sidebar').classList.toggle('open'); $('#backdrop').classList.toggle('open'); };
$('#backdrop').onclick=closeSidebar;
$('#clearLog').onclick=()=>{ $('#log').innerHTML=''; };

/* search bindings */
$('#patioSearch').addEventListener('input',e=>renderPatioRows(e.target.value));
$('#mensSearch').addEventListener('input',e=>renderMensRows(e.target.value));
$('#addMens').onclick=addMens;
$('#addConv').onclick=addConv;

/* expose for inline onclick */
Object.assign(window,{closeModal,goExit,renewMonthly,editMonthly,delMonthly,editConv,delConv,editSector,delSector});

/* ═══════════ BOOT ═══════════ */
setInterval(()=>{ const el=$('#clock'); if(el)el.textContent=fmtTime(new Date()); },1000);
$('#clock').textContent=fmtTime(new Date());
refreshChrome();
renderIdle();
logLine('⚡ Sistema iniciado · '+activeVehicles().length+' veículos no pátio','ok');
// atualiza pátio ao vivo se estiver aberto
setInterval(()=>{ if($('#view-patio').classList.contains('active')) renderPatioRows($('#patioSearch').value); },15000);
