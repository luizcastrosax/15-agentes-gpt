"use strict";const API = ''; // mesma origem (servido pelo backend)
const $ = s => document.querySelector(s);
const scr = () => $('#screen');
const money = v => 'R$ ' + (v||0).toFixed(2).replace('.',',');
function fmtDur(m){ m=Math.max(0,Math.round(m)); const d=Math.floor(m/1440),h=Math.floor((m%1440)/60),mm=m%60; if(d>0)return `${d}d ${h}h${String(mm).padStart(2,'0')}`; return h>0?`${h}h${String(mm).padStart(2,'0')}min`:`${mm}min`; }
function fmtDT(ts){ const d=new Date(ts); const p=n=>String(n).padStart(2,'0'); return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`; }
async function api(path, opts){ const r=await fetch(API+path, Object.assign({headers:{'Content-Type':'application/json'}},opts)); const j=await r.json().catch(()=>({})); if(!r.ok) throw Object.assign(new Error(j.message||'Erro'),{data:j,status:r.status}); return j; }

let state = { vehicle:null, quote:null, partnerId:null, txid:null, poll:null };

/* ---------- QR estilizado (o pagamento no mesmo aparelho usa "copia e cola") ---------- */
function drawQR(canvas, seed){
  const N=29, px=Math.floor(canvas.width/N)||6; canvas.width=N*px; canvas.height=N*px;
  const ctx=canvas.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
  let s=0; for(let i=0;i<seed.length;i++)s=(s*31+seed.charCodeAt(i))>>>0;
  const rng=()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff;};
  ctx.fillStyle='#000'; for(let y=0;y<N;y++)for(let x=0;x<N;x++){if(rng()>.5)ctx.fillRect(x*px,y*px,px,px);}
  const fp=(ox,oy)=>{ctx.fillStyle='#fff';ctx.fillRect(ox*px,oy*px,7*px,7*px);ctx.fillStyle='#000';ctx.fillRect(ox*px,oy*px,7*px,7*px);ctx.fillStyle='#fff';ctx.fillRect((ox+1)*px,(oy+1)*px,5*px,5*px);ctx.fillStyle='#000';ctx.fillRect((ox+2)*px,(oy+2)*px,3*px,3*px);};
  fp(0,0);fp(N-7,0);fp(0,N-7);
}

/* ---------- TELA 1: consulta ---------- */
async function renderHome(){
  clearPoll();
  state={vehicle:null,quote:null,partnerId:null,txid:null,poll:null};
  scr().innerHTML=`
    <div class="steps"><span class="s on"></span><span class="s"></span><span class="s"></span></div>
    <div class="hero"><div class="emo">🚗</div><h1>Já vai sair?</h1><p>Informe a placa do seu veículo para consultar e pagar.</p></div>
    <div class="field"><label>Placa do veículo</label><input id="plate" placeholder="ABC1D23" maxlength="8" autocomplete="off"></div>
    <div class="chips" id="chips"></div>
    <div id="err"></div>
    <button class="btn btn-lg" id="go">Consultar</button>
    <p class="foot" style="padding-top:22px">Também é possível digitar o número do ticket.</p>`;
  const inp=$('#plate'); inp.focus();
  $('#go').onclick=consultar;
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')consultar();});
  // sugere placas reais do pátio
  try{ const p=await api('/api/patio'); const plates=p.vehicles.filter(v=>v.plate&&v.amount>0).slice(0,3);
    $('#chips').innerHTML = plates.length?('<span class="muted" style="font-size:11px;width:100%;text-align:center;margin-bottom:2px">Exemplos no pátio:</span>'+plates.map(v=>`<button class="chip" data-p="${v.plate}">${v.plate}</button>`).join('')):'';
    document.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{inp.value=c.dataset.p;consultar();});
  }catch(e){ setOffline(); }
}
async function consultar(){
  const val=$('#plate').value.trim(); if(!val){return;}
  $('#err').innerHTML=''; $('#go').disabled=true; $('#go').textContent='Consultando…';
  const isTicket=/^\d+$/.test(val.replace(/\D/g,''))&&val.replace(/[A-Z]/gi,'')===val.replace(/\D/g,'');
  try{
    const q=await api(`/api/consulta?${/[A-Za-z]/.test(val)?'plate='+encodeURIComponent(val):'ticket='+encodeURIComponent(val)}`+(state.partnerId?'&partner='+state.partnerId:''));
    state.vehicle=q.vehicle; state.quote=q; renderQuote();
  }catch(e){ $('#go').disabled=false; $('#go').textContent='Consultar'; $('#err').innerHTML=`<div class="err">${e.message||'Não encontramos esse veículo no pátio.'}</div>`; }
}

/* ---------- TELA 2: resumo/valor ---------- */
function renderQuote(){
  const q=state.quote, v=q.vehicle;
  scr().innerHTML=`
    <div class="steps"><span class="s on"></span><span class="s on"></span><span class="s"></span></div>
    <div style="text-align:center;margin-top:16px"><span class="plate-badge">${v.plate||v.ticket}</span></div>
    <div class="card">
      <div class="rowline"><span class="k">Ticket</span><span class="v mono">${v.ticket}</span></div>
      <div class="rowline"><span class="k">Entrada</span><span class="v">${fmtDT(v.entry_ts)}</span></div>
      <div class="rowline"><span class="k">Permanência</span><span class="v">${fmtDur(q.minutes)}</span></div>
      ${q.monthly?`<div class="rowline"><span class="k">Mensalista</span><span class="v">${q.monthly.name}</span></div>`
        :`<div class="rowline"><span class="k">Tarifa</span><span class="v">${money(q.gross)}</span></div>`}
      ${q.partner?`<div class="rowline disc"><span class="k">Convênio · ${q.partner.name}</span><span class="v">- ${money(q.discount)}</span></div>`:''}
    </div>
    <div class="total"><span class="k">${q.amount>0?'Total a pagar':'Nada a pagar'}</span><span class="v">${money(q.amount)}</span></div>
    ${q.amount>0 && !q.monthly && !q.partner?`<div class="conv-link"><button id="conv">🤝 Tenho um convênio / validação</button></div>`:''}
    ${q.amount>0
      ? `<button class="btn btn-green btn-lg" id="pay">📱 Pagar com PIX</button>`
      : `<button class="btn btn-green btn-lg" id="free">Liberar saída</button>`}
    <button class="btn btn-ghost" id="back">Voltar</button>`;
  $('#back').onclick=renderHome;
  if($('#conv')) $('#conv').onclick=()=>renderConvenios();
  if($('#pay')) $('#pay').onclick=criarCobranca;
  if($('#free')) $('#free').onclick=criarCobranca; // backend libera direto quando amount=0
}
function renderConvenios(){
  const parts=state.quote.partnersDisponiveis||[];
  scr().innerHTML=`
    <div class="hero" style="padding-top:8px"><div class="emo">🤝</div><h1>Convênio</h1><p>Selecione o parceiro que validou seu estacionamento.</p></div>
    <div class="card">${parts.map(p=>`<button class="btn btn-ghost" style="justify-content:space-between;margin-top:10px" data-id="${p.id}"><span>${p.name}</span><span class="muted">${p.label}</span></button>`).join('')}</div>
    <button class="btn btn-ghost" id="back">Voltar</button>`;
  document.querySelectorAll('[data-id]').forEach(b=>b.onclick=async()=>{ state.partnerId=b.dataset.id;
    const val=state.vehicle.plate||state.vehicle.ticket;
    const q=await api(`/api/consulta?${state.vehicle.plate?'plate='+state.vehicle.plate:'ticket='+state.vehicle.ticket}&partner=${state.partnerId}`);
    state.quote=q; renderQuote();
  });
  $('#back').onclick=renderQuote;
}

/* ---------- TELA 3: PIX ---------- */
async function criarCobranca(){
  const v=state.vehicle;
  try{
    const body={ method:'pix', partnerId:state.partnerId||undefined };
    if(v.plate) body.plate=v.plate; else body.ticket=v.ticket;
    const r=await api('/api/cobranca',{method:'POST',body:JSON.stringify(body)});
    if(r.free||r.status==='paid'){ return renderSuccess(0); }
    state.txid=r.txid;
    renderPix(r);
  }catch(e){ alert(e.message||'Erro ao gerar cobrança'); }
}
function renderPix(r){
  scr().innerHTML=`
    <div class="steps"><span class="s on"></span><span class="s on"></span><span class="s on"></span></div>
    <div class="pix-head"><span class="pl">₽</span><b>PIX · ${money(r.amount)}</b></div>
    <div class="qr-wrap"><canvas id="qr" width="174" height="174"></canvas></div>
    <p class="foot" style="padding:14px 0 0">Escaneie com outro aparelho, ou copie o código abaixo e cole no app do seu banco:</p>
    <div class="copia mono" id="copia">${r.pixPayload}</div>
    <button class="btn btn-blue" id="copy">📋 Copiar código PIX</button>
    <div class="await" id="await"><span class="spin"></span> Aguardando confirmação do banco…</div>
    <button class="btn btn-ghost" id="cancel">Cancelar</button>`;
  drawQR($('#qr'), r.pixPayload);
  $('#copy').onclick=()=>{ navigator.clipboard&&navigator.clipboard.writeText(r.pixPayload); $('#copy').textContent='✓ Código copiado'; setTimeout(()=>{if($('#copy'))$('#copy').textContent='📋 Copiar código PIX';},1800); };
  $('#cancel').onclick=renderHome;
  // polling de status
  state.poll=setInterval(async()=>{
    try{ const s=await api('/api/cobranca/'+state.txid);
      if(s.status==='paid'){ clearPoll(); renderSuccess(r.amount); }
    }catch(e){}
  },1500);
}

/* ---------- TELA 4: sucesso ---------- */
function renderSuccess(amount){
  clearPoll();
  scr().innerHTML=`
    <div class="success">
      <div class="check">✓</div>
      <h1>${amount>0?'Pagamento confirmado!':'Saída liberada!'}</h1>
      <p>${amount>0?money(amount)+' recebido via PIX':'Nada a pagar'}</p>
    </div>
    <div class="gate-msg"><span class="g">🚧</span><div><b>Cancela liberada</b><span>Pode seguir até a saída — a cancela vai abrir automaticamente. Boa viagem!</span></div></div>
    <button class="btn" id="done" style="margin-top:28px">Concluir</button>`;
  $('#done').onclick=renderHome;
}

function clearPoll(){ if(state.poll){clearInterval(state.poll);state.poll=null;} }
function setOffline(){ $('#apiStatus').className='status off'; $('#apiStatus').innerHTML='<span class="d"></span> sem conexão'; }

/* ===== ENTRADA (modelo online por placa) ===== */
const MODE = new URLSearchParams(location.search).get('modo') || 'saida';
const GATE = new URLSearchParams(location.search).get('gate') || '';
function renderEntryHome(){
  const sub=document.querySelector('.appbar small'); if(sub) sub.textContent='Entrada';
  scr().innerHTML=`
    <div class="steps"><span class="s on"></span><span class="s"></span><span class="s"></span></div>
    <div class="hero"><div class="emo">🚗</div><h1>Bem-vindo!</h1><p>Informe a placa do seu veículo para entrar.</p></div>
    <div class="field"><label>Placa do veículo</label><input id="plate" placeholder="ABC1D23" maxlength="8" autocomplete="off"></div>
    <div id="err"></div>
    <button class="btn btn-lg btn-green" id="go">Entrar</button>`;
  const inp=$('#plate'); inp.focus();
  const go=async()=>{
    const plate=inp.value.trim(); if(!plate) return;
    $('#err').innerHTML=''; $('#go').disabled=true; $('#go').textContent='Verificando…';
    try{
      const r=await api('/api/entrada',{method:'POST',body:JSON.stringify({plate,gateToken:GATE,lane:'entrada'})});
      if(r.needsRegistration) return renderRegister(r.plate);
      renderEntrySuccess(r);
    }catch(e){ $('#go').disabled=false; $('#go').textContent='Entrar'; $('#err').innerHTML=`<div class="err">${e.message||'Erro'}</div>`; }
  };
  $('#go').onclick=go; inp.addEventListener('keydown',e=>{if(e.key==='Enter')go();});
}
function renderRegister(plate){
  scr().innerHTML=`
    <div class="steps"><span class="s on"></span><span class="s on"></span><span class="s"></span></div>
    <div class="hero" style="padding:12px 0 0"><div class="emo">📝</div><h1>Primeiro acesso</h1><p>Cadastro rápido — só desta vez. Nas próximas, é só a placa.</p></div>
    <div style="text-align:center;margin-top:14px"><span class="plate-badge">${plate}</span></div>
    <div class="field"><label>Seu nome</label><input id="rgName" style="text-align:left;letter-spacing:0;font-size:16px;text-transform:none" placeholder="Nome completo"></div>
    <div class="field"><label>WhatsApp (com DDD)</label><input id="rgPhone" style="text-align:left;letter-spacing:0;font-size:16px" inputmode="tel" placeholder="(11) 90000-0000"></div>
    <div class="field"><label>Modelo do veículo</label><input id="rgModel" style="text-align:left;letter-spacing:0;font-size:16px;text-transform:none" placeholder="Ex: Honda Civic prata"></div>
    <label style="display:flex;gap:10px;align-items:flex-start;margin-top:16px;font-size:12.5px;color:var(--text2)"><input type="checkbox" id="rgConsent" style="margin-top:3px;width:auto"><span>Autorizo o uso dos meus dados para controle de entrada/saída e envio do comprovante (LGPD).</span></label>
    <div id="err"></div>
    <button class="btn btn-lg btn-green" id="go">Cadastrar e entrar</button>
    <button class="btn btn-ghost" id="back">Voltar</button>`;
  $('#back').onclick=renderEntryHome;
  $('#go').onclick=async()=>{
    const name=$('#rgName').value.trim(), phone=$('#rgPhone').value.trim(), model=$('#rgModel').value.trim(), consent=$('#rgConsent').checked;
    if(!name||!phone){ $('#err').innerHTML='<div class="err">Preencha nome e WhatsApp.</div>'; return; }
    if(!consent){ $('#err').innerHTML='<div class="err">É preciso aceitar o uso dos dados.</div>'; return; }
    $('#go').disabled=true; $('#go').textContent='Cadastrando…';
    try{
      const r=await api('/api/registro',{method:'POST',body:JSON.stringify({plate,name,phone,model,consent:true,gateToken:GATE,lane:'entrada'})});
      renderEntrySuccess(r);
    }catch(e){ $('#go').disabled=false; $('#go').textContent='Cadastrar e entrar'; $('#err').innerHTML=`<div class="err">${e.message||'Erro'}</div>`; }
  };
}
function renderEntrySuccess(r){
  const wa=r.wa&&r.wa.link, nome=r.cliente&&r.cliente.name?r.cliente.name.split(' ')[0]:null;
  scr().innerHTML=`
    <div class="steps"><span class="s on"></span><span class="s on"></span><span class="s on"></span></div>
    <div class="success">
      <div class="check">✓</div>
      <h1>Entrada liberada!</h1>
      <p>${nome?('Bem-vindo, '+nome+'! · '):''}Ticket ${r.vehicle.ticket}</p>
    </div>
    <div class="gate-msg"><span class="g">🚧</span><div><b>Cancela abrindo</b><span>Pode seguir e estacionar. Boa estadia!</span></div></div>
    ${wa?`<a class="btn btn-green" href="${wa}" target="_blank" rel="noopener" style="text-decoration:none">💬 Salvar comprovante no WhatsApp</a>`:''}
    <button class="btn btn-ghost" id="done">Concluir</button>`;
  $('#done').onclick=renderEntryHome;
}

/* boot */
(async()=>{ try{ await api('/api/health'); }catch(e){ setOffline(); } (MODE==='entrada'?renderEntryHome:renderHome)(); })();
