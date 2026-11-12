// Spinbounce — Copyright (C) 2026 Heikki Heinonen
// SPDX-License-Identifier: GPL-3.0-or-later
// Game idea and game mechanics by Heikki Heinonen. Implementation built with Claude (Anthropic).
// Pelaajabotti: pelaa kentät pelin omalla fysiikalla ja pulmasäännöillä.
// Siirto = kallistus vakiona tietyn määrän pomppuja, sitten jarrutus kunnes pallo pysähtyy.
// Haku käy läpi lepotiloja (ruutu, kytkinten asento, kerätyt kiteet) ja etenee kide kerrallaan kohti maalia.
const fs=require('fs');
const P=require('./phys.js'); const {newState,stepS,buildGrid,R,DT}=P;
const {Worker,isMainThread,parentPort,workerData}=require('worker_threads');

function loadLevels(file){ const h=fs.readFileSync(file,'utf8'); return JSON.parse(h.match(/const LEVELS = (\[.*?\]);\n/s)[1]); }

// ---------- pelin ajonaikainen logiikka (sama kuin pelissä) ----------
function makeGame(lv){
  const L=buildGrid(lv), NN=L.h.length;
  const G={L,lv,sw:new Int8Array(NN).fill(-1),tp:new Int32Array(NN).fill(-1),gates:[],cr:[],bits:0,got:0,crMask:0,prev:-1,armed:true,won:false,falls:0,lastLand:0.5,t:0};
  for(const q of lv.sw||[]) G.sw[q[1]*L.W+q[0]]=q[2];
  for(const q of lv.tp||[]){ const a=q[1]*L.W+q[0], b=q[3]*L.W+q[2]; G.tp[a]=b; G.tp[b]=a; }
  for(const g of lv.gates||[]){ const cells=[]; for(let j=g[1];j<g[1]+g[3];j++) for(let i=g[0];i<g[0]+g[2];i++) cells.push(j*L.W+i); G.gates.push({cells,hA:g[4],hB:g[5],color:g[6],cur:g[4],tog:false}); }
  G.cr=(lv.cr||[]).map(c=>({x:c[0],y:c[1],z:c[2]}));
  const k0=lv.spawn[1]*L.W+lv.spawn[0], h0=L.h[k0];
  G.ball=newState(lv.spawn[0]+0.5,lv.spawn[1]+0.5,h0+R+1.6,0); G.lastLand=h0;
  return G;
}
function tick(G,ux,uy){
  const b=G.ball, L=G.L; b.hit=-1; stepS(b,ux,uy,L); G.t+=DT;
  if(b.hit>=0){ const hk=b.hit, hh=L.h[hk], ty=L.t[hk];
    if(hh<G.lastLand-0.75) G.falls++; G.lastLand=hh;
    if(G.sw[hk]>=0&&(G.prev<0||G.sw[G.prev]!==G.sw[hk])){ G.bits^=1<<G.sw[hk]; for(const g of G.gates) if(g.color===G.sw[hk]) g.tog=!g.tog; }
    G.prev=hk;
    if(G.tp[hk]>=0){ if(G.armed){ const d=G.tp[hk], W=L.W; b.px+=(d%W)-(hk%W); b.py+=Math.floor(d/W)-Math.floor(hk/W); b.pz+=L.h[d]-L.h[hk]; G.armed=false; G.prev=d; G.lastLand=L.h[d]; } }
    else G.armed=true;
    if(ty===3&&G.got>=G.cr.length) G.won=true;
  }
  for(const g of G.gates){ const tgt=g.tog?g.hB:g.hA; if(g.cur!==tgt){ const d=tgt-g.cur, st=7*DT; g.cur=Math.abs(d)<=st?tgt:g.cur+Math.sign(d)*st; for(const k of g.cells) L.h[k]=g.cur; } }
  for(let i=0;i<G.cr.length;i++){ if(G.crMask>>i&1) continue; const c=G.cr[i], dx=c.x-b.px, dy=c.y-b.py, dz=c.z-b.pz;
    if(dx*dx+dy*dy+dz*dz<(R+0.5)*(R+0.5)){ G.crMask|=1<<i; G.got++; } }
}
function snap(G){ return {ball:{...G.ball},bits:G.bits,got:G.got,crMask:G.crMask,prev:G.prev,armed:G.armed,won:G.won,falls:G.falls,lastLand:G.lastLand,t:G.t,gates:G.gates.map(g=>[g.cur,g.tog])}; }
function restore(G,s){ Object.assign(G.ball,s.ball); G.bits=s.bits; G.got=s.got; G.crMask=s.crMask; G.prev=s.prev; G.armed=s.armed; G.won=s.won; G.falls=s.falls; G.lastLand=s.lastLand; G.t=s.t;
  s.gates.forEach((q,i)=>{ const g=G.gates[i]; g.cur=q[0]; g.tog=q[1]; for(const k of g.cells) G.L.h[k]=g.cur; }); }

// ---------- siirrot ----------
const MOVES=[]; for(let a=0;a<16;a++) for(const [m,nb] of [[0.35,1],[0.6,1],[1,1],[1,2],[1,3],[1,5]]) MOVES.push([a*Math.PI/8,m,nb]);
const toU=(dx,dy,m)=>[(dx-dy)*Math.SQRT1_2*m,(dx+dy)*Math.SQRT1_2*m];
// Pelaa yksi siirto. Palauttaa lopputilan tai null, jos pallo ei asettunut.
function doMove(G,mv,rec){
  const [th,m,nb]=mv, u=toU(Math.cos(th),Math.sin(th),m); let hits=0, rest=0, n=0;
  const MAX=Math.round(9/DT);
  for(;n<MAX;n++){
    let ux=u[0], uy=u[1];
    if(hits>=nb){ const b=G.ball, sp=Math.hypot(b.vx,b.vy);   // jarrutus: pyöritä liikesuuntaa vastaan
      if(sp>1e-3){ const mm=Math.min(1,0.45*sp), q=toU(-b.vx/sp,-b.vy/sp,mm); ux=q[0]; uy=q[1]; } else { ux=0; uy=0; } }
    tick(G,ux,uy); if(rec) rec.push(ux,uy);
    if(G.won) return true;
    if(G.ball.hit>=0){ hits++;
      if(hits>nb){ const sp=Math.hypot(G.ball.vx,G.ball.vy), w=Math.hypot(G.ball.wx,G.ball.wy); if(sp<0.08&&w<1.5){ if(++rest>=2) return true; } else rest=0; } }
  }
  return false;
}
const cellOf=G=>G.prev>=0?G.prev:-1;

// ---------- haku ----------
function solve(lv,opts={}){
  const G=makeGame(lv), W=G.L.W, maxExp=opts.maxExp||6000;
  // pudotetaan pallo alkuun ja annetaan asettua
  for(let i=0;i<Math.round(1.5/DT);i++) tick(G,0,0);
  let cur=snap(G); const plan=[]; let exps=0, sims=0;
  const goalCells=[]; for(let k=0;k<G.L.t.length;k++) if(G.L.t[k]===3) goalCells.push(k);
  while(true){
    const need=G.cr.length?G.cr.length-cur.got:0;
    // kohteet: keräämättömät kiteet, tai maali kun kaikki kerätty
    const targets=need>0?G.cr.map((c,i)=>(cur.crMask>>i&1)?null:[c.x,c.y]).filter(Boolean):goalCells.map(k=>[k%W+0.5,Math.floor(k/W)+0.5]);
    const h=s=>{ let d=1e9; for(const t of targets) d=Math.min(d,Math.max(Math.abs(t[0]-s.ball.px),Math.abs(t[1]-s.ball.py))); return d/3.5; };
    const startGot=cur.got;
    const seen=new Set([cellOf({prev:cur.prev})+'|'+cur.bits+'|'+cur.crMask]);
    let open=[{s:cur,g:0,f:h(cur),path:[]}], found=null;
    while(open.length&&!found){
      let bi=0; for(let i=1;i<open.length;i++) if(open[i].f<open[bi].f) bi=i;
      const nd=open[bi]; open[bi]=open[open.length-1]; open.pop();
      if(++exps>maxExp*(G.cr.length+1)) break;
      for(const mv of MOVES){ restore(G,nd.s); sims++;
        const ok=doMove(G,mv,null); if(!ok) continue;
        const s=snap(G);
        if(G.won||s.got>startGot){ found={s,path:nd.path.concat([mv])}; break; }
        const key=G.prev+'|'+s.bits+'|'+s.crMask; if(seen.has(key)) continue; seen.add(key);
        open.push({s,g:nd.g+1,f:nd.g+1+h(s),path:nd.path.concat([mv])}); }
    }
    if(!found) return {ok:false,moves:plan.length,exps,sims,got:cur.got,ncr:G.cr.length,reason:open.length?'hakuraja':'umpikuja'};
    plan.push(...found.path); cur=found.s;
    if(cur.won) break;
  }
  // toisto alusta: varmistetaan, että suunnitelma toimii yhtenä jatkumona, ja kirjataan ohjaus
  const R2=makeGame(lv); for(let i=0;i<Math.round(1.5/DT);i++) tick(R2,0,0);
  const rec=[]; for(const mv of plan){ doMove(R2,mv,rec); if(R2.won) break; }
  const sc=shortcutCheck(lv,plan);
  return {ok:R2.won,moves:plan.length,time:+R2.t.toFixed(1),falls:R2.falls,exps,sims,ncr:R2.cr.length,plan,maxSkip:sc.maxSkip,skips:sc.skips};
}
// Reitin tason indeksi ruudulle (-1 lattia, null muu). Hyppy tasolta i tasolle j>i+1 ohittaa reitin – ellei se ole teleportti.
function shortcutCheck(lv,plan){
  const G=makeGame(lv), W=G.L.W, idx=new Map();
  if(lv.fw||!lv.plats||lv.plats.length<3) return {maxSkip:0,skips:[]};
  lv.plats.forEach((p,pi)=>{ for(let j=p[1];j<p[1]+p[3];j++) for(let i=p[0];i<p[0]+p[2];i++) idx.set(j*W+i,pi); });
  const onIdx=k=>{ if(!idx.has(k)) return Math.abs(G.L.h[k]-0.5)<1e-3?-1:null; const pi=idx.get(k), p=lv.plats[pi]; return Math.abs(G.L.h[k]-p[4])<0.05?pi:null; };
  for(let i=0;i<Math.round(1.5/DT);i++) tick(G,0,0);
  let last=-1, best=-1, maxSkip=0; const skips=[];
  const tpCells=new Set(); for(const q of lv.tp||[]){ tpCells.add(q[1]*W+q[0]); tpCells.add(q[3]*W+q[2]); }
  for(const mv of plan){ const [th,m,nb]=mv, u=toU(Math.cos(th),Math.sin(th),m); let hits=0, rest=0;
    for(let n=0;n<Math.round(9/DT);n++){ let ux=u[0], uy=u[1];
      if(hits>=nb){ const b=G.ball, sp=Math.hypot(b.vx,b.vy); if(sp>1e-3){ const q=toU(-b.vx/sp,-b.vy/sp,Math.min(1,0.45*sp)); ux=q[0]; uy=q[1]; } else { ux=0; uy=0; } }
      const prevTp=G.prev>=0&&tpCells.has(G.prev);
      tick(G,ux,uy); if(G.won) break;
      if(G.ball.hit>=0){ hits++; const k=G.ball.hit, pi=onIdx(k);
        if(pi!==null&&!prevTp&&!tpCells.has(k)){ if(pi>best+1&&pi>last+1){ const sk=pi-Math.max(best,last)-1; if(sk>maxSkip) maxSkip=sk; skips.push([Math.max(best,last),pi]); } last=pi; if(pi>best) best=pi; }
        else if(pi!==null) { last=pi; if(pi>best) best=pi; }
        if(hits>nb){ const sp=Math.hypot(G.ball.vx,G.ball.vy), w=Math.hypot(G.ball.wx,G.ball.wy); if(sp<0.08&&w<1.5){ if(++rest>=2) break; } else rest=0; } } }
    if(G.won) break; }
  return {maxSkip,skips};
}
module.exports={solve,shortcutCheck,loadLevels,makeGame,tick,doMove,MOVES};

if(isMainThread&&require.main===module){
  const file=process.argv[2]||'../pomppupallo-100.html', LV=loadLevels(file);
  const only=process.argv[3]?process.argv[3].split(',').map(Number):LV.map((_,i)=>i+1);
  const out={}; let next=0, done=0; const t0=Date.now(), NW=2;
  for(let w=0;w<NW;w++){ const wk=new Worker(__filename,{workerData:{file}});
    const feed=()=>{ if(next<only.length) wk.postMessage(only[next++]); else wk.terminate(); };
    wk.on('message',m=>{ out[m.n]=m; done++; const r=m.r;
      process.stderr.write(`${String(m.n).padStart(3)} ${LV[m.n-1].name.padEnd(20)} ${r.ok?'LÄPI':'EI  '} siirtoja ${String(r.moves).padStart(3)} peliaika ${String(r.time??'-').padStart(6)} s putoamisia ${r.falls??'-'} kiteet ${r.ncr} sim ${r.sims} ${r.reason||''} [${((Date.now()-t0)/1000).toFixed(0)} s]\n`);
      feed(); if(done===only.length) fs.writeFileSync(process.argv[4]||'playthrough.json',JSON.stringify(out)); });
    feed(); }
} else if(!isMainThread&&require.main===module){
  const LV=loadLevels(workerData.file);
  parentPort.on('message',n=>{ const t=Date.now(); const r=solve(LV[n-1]); r.ms=Date.now()-t; parentPort.postMessage({n,r}); });
}
