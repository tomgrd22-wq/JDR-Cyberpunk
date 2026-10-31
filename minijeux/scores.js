/* ═════ CLASSEMENT PARTAGÉ DES MINI-JEUX (MQTT, état retenu par code de session) ═════
   Usage : NPScores.init({game:'reflexes'}); puis NPScores.submit(score) en fin de partie.
   Un bouton 🏆 s'affiche en haut à droite et ouvre le classement du jeu en cours. */
(function(){
var BROKER='wss://broker.emqx.io:8084/mqtt';
var CHARS={
  tamuro:{n:'TAMURO',c:'#ff2040'},kiki:{n:'KIKI',c:'#ffaa00'},keiyo:{n:'KEIYO',c:'#ff33cc'},
  fury:{n:'FURY',c:'#00ff88'},hunter:{n:'MOON',c:'#00ccff'},mj:{n:'MJ',c:'#ffc83c'}
};
var GAMES={
  reflexes:{label:'Réflexes',ico:'⚡',unit:' ms',low:true,url:'reflexes.html',hint:'temps moyen sur 5 manches, le plus bas gagne'},
  sequence:{label:'Séquence',ico:'🧠',unit:' manches',low:false,url:'sequence.html',hint:'nombre de manches réussies'},
  code:{label:'Craquage',ico:'🔓',unit:' pts',low:false,url:'code-breaker.html',hint:'moins d\'essais et plus vite = plus de points'},
  iceworm:{label:'Ice-Worm',ico:'🟩',unit:' pts',low:false,url:'ice-worm.html',hint:'score'},
  firewall:{label:'Firewall Breaker',ico:'🧱',unit:' pts',low:false,url:'firewall-breaker.html',hint:'score'},
  netrunner:{label:'Net-Runner',ico:'🕹',unit:' pts',low:false,url:'net-runner.html',hint:'score'},
  runner:{label:'Neon Run',ico:'🏃',unit:' s',low:false,url:'runner.html',hint:'temps tenu sans toucher d\'obstacle'},
  dodge:{label:'Pluie de données',ico:'☔',unit:' s',low:false,url:'dodge.html',hint:'temps tenu sans être touché'}
};
var RANK_POINTS=[5,3,2,1,1,1];

var ident=null,mc=null,state={t:0,s:{}},cfg={},topic='',listeners=[],connected=false;

function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function canon(o){
  if(o===null||typeof o!=='object')return JSON.stringify(o);
  if(Array.isArray(o))return '['+o.map(canon).join(',')+']';
  return '{'+Object.keys(o).sort().map(function(k){return JSON.stringify(k)+':'+canon(o[k]);}).join(',')+'}';
}
function better(game,a,b){return GAMES[game].low?a<b:a>b;}
function merge(a,b){
  if(a.t>b.t)return a;
  if(b.t>a.t)return b;
  var out={t:a.t,s:{}};
  [a,b].forEach(function(x){
    Object.keys(x.s||{}).forEach(function(g){
      if(!GAMES[g])return;
      out.s[g]=out.s[g]||{};
      Object.keys(x.s[g]||{}).forEach(function(r){
        var v=x.s[g][r];
        if(!CHARS[r]||typeof v!=='number'||!isFinite(v))return;
        if(out.s[g][r]===undefined||better(g,v,out.s[g][r]))out.s[g][r]=v;
      });
    });
  });
  return out;
}
function localKey(){return 'np_scores_'+(ident?ident.code:'');}
function saveLocal(){try{localStorage.setItem(localKey(),JSON.stringify(state));}catch(e){}}
function loadLocal(){
  try{var v=JSON.parse(localStorage.getItem(localKey()));if(v&&typeof v.s==='object')state=merge(state,{t:+v.t||0,s:v.s});}catch(e){}
}
function notify(){listeners.forEach(function(fn){try{fn();}catch(e){}});renderPanel();}
function publish(){
  if(mc&&mc.connected)mc.publish(topic,JSON.stringify(state),{retain:true});
}
function onMessage(payload){
  var inc;
  try{inc=JSON.parse(payload.toString());}catch(e){return;}
  if(!inc||typeof inc.s!=='object')inc={t:0,s:{}};
  inc.t=+inc.t||0;
  var merged=merge(state,inc);
  var changedLocal=canon(merged)!==canon(state);
  var needBroadcast=canon(merged)!==canon(inc);
  state=merged;
  if(changedLocal){saveLocal();notify();}
  if(needBroadcast)publish();
}
function connect(){
  if(typeof mqtt==='undefined')return;
  topic='spectre_scores_v1_'+ident.code;
  try{
    mc=mqtt.connect(BROKER,{clientId:'sc'+Date.now()+Math.random().toString(36).slice(2,6),clean:true,connectTimeout:8000,reconnectPeriod:4000});
    mc.on('connect',function(){connected=true;mc.subscribe(topic,function(){setTimeout(function(){if(canon(state)!==canon({t:0,s:{}}))publish();},1500);});renderPanel();});
    mc.on('close',function(){connected=false;renderPanel();});
    mc.on('message',function(t,p){onMessage(p);});
  }catch(e){}
}

/* ── identification ── */
function readIdent(){
  var p=new URLSearchParams(window.location.search);
  var code=(p.get('code')||'').trim().toLowerCase().replace(/\s+/g,'_');
  var role=(p.get('role')||'').trim();
  if(code.length>=3&&CHARS[role]){
    try{localStorage.setItem('np_ident',JSON.stringify({code:code,role:role}));}catch(e){}
    return {code:code,role:role};
  }
  try{
    var v=JSON.parse(localStorage.getItem('np_ident'));
    if(v&&v.code&&CHARS[v.role])return v;
  }catch(e){}
  return null;
}
function promptIdent(done){
  var ov=document.createElement('div');ov.className='np-ov';
  var h='<div class="np-box"><div class="np-title">IDENTIFICATION</div>'
    +'<div class="np-sub">Pour apparaître au classement</div>'
    +'<input id="np-code" class="np-in" placeholder="Code de session" autocomplete="off">'
    +'<div class="np-chars">';
  Object.keys(CHARS).forEach(function(k){h+='<button data-r="'+k+'" style="--c:'+CHARS[k].c+'">'+CHARS[k].n+'</button>';});
  h+='</div><div id="np-err" class="np-err"></div><button class="np-skip" id="np-skip">JOUER SANS CLASSEMENT</button></div>';
  ov.innerHTML=h;document.body.appendChild(ov);
  ov.querySelectorAll('.np-chars button').forEach(function(b){
    b.onclick=function(){
      var code=document.getElementById('np-code').value.trim().toLowerCase().replace(/\s+/g,'_');
      if(code.length<3){document.getElementById('np-err').textContent='CODE TROP COURT';return;}
      var id={code:code,role:b.getAttribute('data-r')};
      try{localStorage.setItem('np_ident',JSON.stringify(id));}catch(e){}
      ov.remove();done(id);
    };
  });
  document.getElementById('np-skip').onclick=function(){ov.remove();done(null);};
}

/* ── rendu ── */
function entries(game){
  var m=state.s[game]||{};
  var arr=Object.keys(m).map(function(r){return {role:r,score:m[r]};});
  arr.sort(function(a,b){return GAMES[game].low?a.score-b.score:b.score-a.score;});
  return arr;
}
function fmt(game,v){return esc(v)+esc(GAMES[game].unit);}
function boardHTML(game){
  var arr=entries(game);
  if(!arr.length)return '<div class="np-empty">Aucun score pour l\'instant. Sois le premier.</div>';
  var medals=['🥇','🥈','🥉'];
  return arr.map(function(e,i){
    var c=CHARS[e.role];
    var me=ident&&ident.role===e.role;
    return '<div class="np-row'+(me?' me':'')+'"><span class="np-rk">'+(medals[i]||(i+1))+'</span>'
      +'<span class="np-nm" style="color:'+c.c+'">'+esc(c.n)+'</span><span class="np-sc">'+fmt(game,e.score)+'</span></div>';
  }).join('');
}
function overall(){
  var pts={};
  Object.keys(CHARS).forEach(function(r){pts[r]=0;});
  Object.keys(GAMES).forEach(function(g){
    entries(g).forEach(function(e,i){pts[e.role]+=RANK_POINTS[i]||1;});
  });
  return Object.keys(pts).filter(function(r){return pts[r]>0;}).map(function(r){return {role:r,pts:pts[r]};})
    .sort(function(a,b){return b.pts-a.pts;});
}
function overallHTML(){
  var arr=overall();
  if(!arr.length)return '<div class="np-empty">Aucun score pour l\'instant.</div>';
  var medals=['🥇','🥈','🥉'];
  return arr.map(function(e,i){
    var c=CHARS[e.role];
    return '<div class="np-row'+(ident&&ident.role===e.role?' me':'')+'"><span class="np-rk">'+(medals[i]||(i+1))+'</span>'
      +'<span class="np-nm" style="color:'+c.c+'">'+esc(c.n)+'</span><span class="np-sc">'+e.pts+' pts</span></div>';
  }).join('');
}

/* ── panneau flottant ── */
var panel=null,btn=null,flash='';
function injectStyle(){
  if(document.getElementById('np-style'))return;
  var st=document.createElement('style');st.id='np-style';
  st.textContent=
  '.np-btn{position:fixed;top:12px;right:12px;z-index:900;width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,200,60,.5);background:rgba(5,5,10,.85);color:#ffc83c;font-size:17px;cursor:pointer;}'
  +'.np-panel{position:fixed;top:58px;right:12px;z-index:900;width:min(300px,calc(100vw - 24px));max-height:70vh;overflow-y:auto;background:#0b0b14;border:1px solid rgba(255,200,60,.35);border-radius:10px;padding:14px;display:none;box-shadow:0 10px 40px rgba(0,0,0,.7);font-family:"Share Tech Mono",monospace;color:#e8e8f4;}'
  +'.np-panel.on{display:block;}'
  +'.np-ph{font-family:Orbitron,monospace;font-size:12px;letter-spacing:3px;color:#ffc83c;margin-bottom:2px;}'
  +'.np-pg{font-size:9px;letter-spacing:1px;color:rgba(255,255,255,.35);margin-bottom:10px;}'
  +'.np-row{display:flex;align-items:center;gap:10px;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;}'
  +'.np-row.me{background:rgba(255,200,60,.08);border-radius:4px;}'
  +'.np-rk{width:22px;text-align:center;color:rgba(255,255,255,.6);}'
  +'.np-nm{flex:1;font-family:Orbitron,monospace;font-size:11px;letter-spacing:1px;}'
  +'.np-sc{color:#fff;}'
  +'.np-empty{padding:16px 6px;text-align:center;font-size:11px;color:rgba(255,255,255,.35);line-height:1.6;}'
  +'.np-flash{margin-bottom:10px;padding:8px;border-radius:6px;font-size:11px;text-align:center;background:rgba(0,255,136,.1);border:1px solid rgba(0,255,136,.4);color:#00ff88;}'
  +'.np-flash.no{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.15);color:rgba(255,255,255,.6);}'
  +'.np-foot{margin-top:10px;font-size:9px;letter-spacing:1px;color:rgba(255,255,255,.3);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;}'
  +'.np-foot a{color:#00ccff;text-decoration:none;}'
  +'.np-ov{position:fixed;inset:0;z-index:1000;background:rgba(2,2,6,.94);display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Share Tech Mono",monospace;}'
  +'.np-box{width:min(340px,100%);text-align:center;}'
  +'.np-title{font-family:Orbitron,monospace;font-size:16px;letter-spacing:4px;color:#ffc83c;}'
  +'.np-sub{font-size:10px;letter-spacing:2px;color:rgba(255,255,255,.4);margin:6px 0 16px;}'
  +'.np-in{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.2);border-radius:5px;padding:11px;color:#fff;font-family:inherit;text-align:center;letter-spacing:2px;outline:none;margin-bottom:12px;}'
  +'.np-chars{display:grid;grid-template-columns:1fr 1fr;gap:8px;}'
  +'.np-chars button{padding:11px 6px;border-radius:6px;border:1px solid var(--c);color:var(--c);background:transparent;font-family:Orbitron,monospace;font-size:11px;letter-spacing:1px;cursor:pointer;}'
  +'.np-err{min-height:16px;margin-top:10px;font-size:10px;color:#ff2040;letter-spacing:1px;}'
  +'.np-skip{margin-top:6px;background:transparent;border:none;color:rgba(255,255,255,.35);font-family:inherit;font-size:10px;letter-spacing:2px;cursor:pointer;text-decoration:underline;}';
  document.head.appendChild(st);
}
function classementUrl(){
  return 'classement.html'+(ident?'?code='+encodeURIComponent(ident.code)+'&role='+ident.role:'');
}
function buildPanel(){
  injectStyle();
  btn=document.createElement('button');btn.className='np-btn';btn.title='Classement';btn.textContent='🏆';
  btn.onclick=function(){panel.classList.toggle('on');renderPanel();};
  panel=document.createElement('div');panel.className='np-panel';
  document.body.appendChild(btn);document.body.appendChild(panel);
}
function renderPanel(){
  if(!panel||!cfg.game)return;
  var g=GAMES[cfg.game];
  var h='<div class="np-ph">🏆 '+esc(g.label.toUpperCase())+'</div><div class="np-pg">'+esc(g.hint)+'</div>';
  if(flash)h+=flash;
  if(!ident)h+='<div class="np-empty">Tu joues sans classement. Recharge la page et identifie-toi pour enregistrer tes scores.</div>';
  else h+=boardHTML(cfg.game);
  h+='<div class="np-foot"><span>'+(ident?esc(ident.code)+(connected?' · en ligne':' · hors ligne'):'')+'</span><a href="'+classementUrl()+'" target="_blank">TOUS LES CLASSEMENTS →</a></div>';
  panel.innerHTML=h;
}

/* ── API publique ── */
function init(opts){
  cfg=opts||{};
  ident=readIdent();
  function go(id){
    ident=id;
    if(ident){loadLocal();connect();}
    if(!cfg.noPanel&&cfg.game){buildPanel();renderPanel();}
    notify();
  }
  function start(){if(ident)go(ident);else if(cfg.askIdent===false)go(null);else promptIdent(go);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
}
function submit(score){
  var game=cfg.game;
  if(!game||!GAMES[game]||typeof score!=='number'||!isFinite(score))return {record:false,saved:false};
  if(!ident){return {record:false,saved:false};}
  var cur=(state.s[game]||{})[ident.role];
  var record=(cur===undefined)||better(game,score,cur);
  if(record){
    state.s[game]=state.s[game]||{};
    state.s[game][ident.role]=score;
    saveLocal();publish();notify();
    flash='<div class="np-flash">NOUVEAU RECORD : '+esc(score)+esc(GAMES[game].unit)+'</div>';
  } else {
    flash='<div class="np-flash no">Ton record reste '+fmt(game,cur)+'.</div>';
  }
  renderPanel();
  if(panel)panel.classList.add('on');
  return {record:record,saved:true,best:record?score:cur};
}
function reset(){
  if(!ident||ident.role!=='mj')return false;
  state={t:Date.now(),s:{}};
  saveLocal();publish();notify();
  return true;
}
function onUpdate(fn){listeners.push(fn);}

window.NPScores={init:init,submit:submit,reset:reset,onUpdate:onUpdate,boardHTML:boardHTML,overallHTML:overallHTML,
  GAMES:GAMES,CHARS:CHARS,ident:function(){return ident;},isOnline:function(){return connected;},esc:esc};
})();
