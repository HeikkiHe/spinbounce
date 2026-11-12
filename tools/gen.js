// Spinbounce — Copyright (C) 2026 Heikki Heinonen
// SPDX-License-Identifier: GPL-3.0-or-later
// Game idea and game mechanics by Heikki Heinonen. Implementation built with Claude (Anthropic).
// Kenttägeneraattori: luo kentän, tarkistaa simuloimalla että jokainen siirtymä on mahdollinen, mittaa vaikeuden
const {V0,R,DT,newState,stepS,buildGrid}=require('./phys.js');
const {Worker,isMainThread,parentPort,workerData}=require('worker_threads');

function rngOf(seed){ let a=seed>>>0; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

// Kuinka suuri osa satunnaisista yrityksistä pääsee alueelta src alueelle tgt (ja pysähtyy sinne).
// Pelaaja pitää kallistuksen vakiona lähtöön asti ja jarruttaa osuttuaan kohteeseen.
const OFFS=[[0,0],[.25,.25],[-.25,.25],[.25,-.25],[-.25,-.25]], MAGS=[0.3,0.55,0.8,1.0];
function reach(L, srcCells, srcSet, tgtCells, goal, lite){
  const W=L.W, tgtSet=new Set(tgtCells);
  let tx=0,ty=0; for(const c of tgtCells){ tx+=c%W+0.5; ty+=Math.floor(c/W)+0.5; } tx/=tgtCells.length; ty/=tgtCells.length;
  const dist=c=>{ let m=1e9; for(const t of tgtCells){ const dx=c%W-t%W, dy=Math.floor(c/W)-Math.floor(t/W); m=Math.min(m,dx*dx+dy*dy); } return m; };
  const starts=srcCells.filter(c=>L.t[c]!==2).sort((a,b)=>dist(a)-dist(b)).slice(0,6);
  let ok=0, tot=0;
  for(const c of (lite?starts.slice(0,4):starts)){ const cx=c%W+0.5, cy=Math.floor(c/W)+0.5, th0=Math.atan2(ty-cy,tx-cx);
    for(const o of (lite?OFFS.slice(0,1):OFFS)) for(let k=-6;k<=6;k++) for(const m of MAGS){
      tot++;
      const th=th0+k*Math.PI/12, dx=Math.cos(th), dy=Math.sin(th);
      const ux=(dx-dy)*Math.SQRT1_2*m, uy=(dx+dy)*Math.SQRT1_2*m;
      const s=newState(cx+o[0],cy+o[1],L.h[c]+R+0.001,V0*(L.t[c]===1?1.5:1));
      let phase=0, hits=0, land=0, res=0;
      for(let n=0;n<240*8&&!res;n++){
        let bx=ux, by=uy;
        if(phase===1){ const sp=Math.hypot(s.vx,s.vy); if(sp>1e-3){ const ddx=-s.vx/sp, ddy=-s.vy/sp, mm=Math.min(1,0.45*sp); bx=(ddx-ddy)*Math.SQRT1_2*mm; by=(ddx+ddy)*Math.SQRT1_2*mm; } else { bx=0; by=0; } }
        s.hit=-1; stepS(s,bx,by,L);
        if(s.hit>=0){
          if(phase===0){ hits++;
            if(tgtSet.has(s.hit)){ if(goal) res=1; else { phase=1; land=1; } }
            else if(!srcSet.has(s.hit) || hits>6) res=-1;
          } else { if(tgtSet.has(s.hit)){ if(++land>=3) res=1; } else res=-1; }
        }
      }
      if(res===1) ok++;
    } }
  return tot? ok/tot : 0;
}

function cellsOf(L,r){ const a=[]; for(let j=r[1];j<r[1]+r[3];j++) for(let i=r[0];i<r[0]+r[2];i++) a.push(j*L.W+i); return a; }

// Arvioi valmiin kentän: palauttaa siirtymien onnistumisosuudet tai null, jos jokin on mahdoton
function evaluate(lv, pmin){
  const L=buildGrid(lv), W=L.W;
  const floor=[]; for(let k=0;k<L.h.length;k++) if(L.t[k]!==4 && L.h[k]===0.5 && L.t[k]!==3) floor.push(k);
  const floorSet=new Set(floor);
  // lattian pitää olla yhtenäinen, ettei pallo jää loukkuun
  const seen=new Set([floor[0]]), st=[floor[0]];
  while(st.length){ const k=st.pop(); for(const d of [1,-1,W,-W]){ const q=k+d; if(floorSet.has(q)&&!seen.has(q)){ seen.add(q); st.push(q); } } }
  if(seen.size!==floor.length) return null;
  const ps=[]; let src=floor, srcSet=floorSet;
  for(let i=0;i<lv.plats.length;i++){
    const tg=cellsOf(L,lv.plats[i]), goal=i===lv.plats.length-1;
    const p=reach(L,src,srcSet,tg,goal); ps.push(+p.toFixed(4));
    if(p<pmin) return {fail:i, ps};
    src=tg; srcSet=new Set(tg);
  }
  return {ps};
}
function scoreOf(ps){ let s=0; ps.forEach((p,i)=>{ s+=Math.log2(1/Math.max(p,0.002))*(1+0.12*i); }); return +(s+0.3*ps.length).toFixed(2); }

// ---------- Kenttä rakennetaan taso kerrallaan; jokainen uusi siirtymä tarkistetaan heti ----------
function pickW(r,arr){ let t=0; for(const a of arr) t+=a[1]; let x=r()*t; for(const a of arr){ x-=a[1]; if(x<=0) return a[0]; } return arr[arr.length-1][0]; }
function partialGrid(n,plats,tramp){ const L=buildGrid({n,plats,tramp,ice:[]}); const p=plats[plats.length-1];
  for(let j=p[1];j<p[1]+p[3];j++) for(let i=p[0];i<p[0]+p[2];i++) L.t[j*L.W+i]=0; return L; }
function floorCells(L){ const a=[]; for(let k=0;k<L.h.length;k++) if(L.t[k]!==4&&L.h[k]===0.5&&L.t[k]!==3) a.push(k); return a; }
function makeLevel(f, seed, pmin){
  const r=rngOf(seed);
  const n=Math.round(14+f*14), K=Math.max(3,Math.round(3+f*21+(r()-0.5)*3));
  const plats=[], tramp=[], ps=[];
  const occ=(x,y)=>{ for(let k=0;k<plats.length;k++){ const p=plats[k]; if(x>=p[0]&&x<p[0]+p[2]&&y>=p[1]&&y<p[1]+p[3]) return k; } return -1; };
  const inside=(x,y,w,d)=>x>=1&&y>=1&&x+w-1<=n&&y+d-1<=n;
  const rectOk=(x,y,w,d,prevIdx,allowTouchPrev)=>{
    if(!inside(x,y,w,d)) return false;
    for(let j=y-1;j<=y+d;j++) for(let i=x-1;i<=x+w;i++){ const k=occ(i,j); if(k<0) continue;
      if(i>=x&&i<x+w&&j>=y&&j<y+d) return false;
      if((i===x-1||i===x+w)&&(j===y-1||j===y+d)) continue;
      if(!(allowTouchPrev&&k===prevIdx)) return false; }
    for(const t of tramp) if(t[0]>=x-1&&t[0]<=x+w&&t[1]>=y-1&&t[1]<=y+d) return false;
    return true; };
  const floorOk=()=>{ const L=buildGrid({n,plats,tramp,ice:[]}), fl=floorCells(L), set=new Set(fl), W=L.W, seen=new Set([fl[0]]), st=[fl[0]];
    while(st.length){ const k=st.pop(); for(const d of [1,-1,W,-W]){ const q=k+d; if(set.has(q)&&!seen.has(q)){ seen.add(q); st.push(q); } } } return seen.size===fl.length; };
  const sizeW=[[3,Math.max(0.05,0.7-f)],[2,0.5],[1,Math.max(0,f-0.15)*0.9]];
  const feats={tramp:0,ice:0,pillar:0,gap2:0,down:0};
  const D=[[1,0],[0,1],[-1,0],[0,-1]];
  // ensimmäinen taso lattialta
  for(let a=0;a<30&&!plats.length;a++){
    const s=Math.max(2,pickW(r,sizeW)), H=0.5+pickW(r,[[0.5,1],[1.0,f]]);
    const x0=1+Math.floor(r()*(n-s+1)), y0=1+Math.floor(r()*(n-s+1));
    plats.push([x0,y0,s,s,H]);
    const L=partialGrid(n,plats,tramp), fl=floorCells(L), tg=cellsOf(L,plats[0]);
    const p=reach(L,fl,new Set(fl),tg,K===1); if(p<pmin){ plats.pop(); continue; } ps.push(p);
  }
  if(!plats.length) return null;
  let dir=Math.floor(r()*4);
  for(let k=1;k<K;k++){
    let placed=false;
    for(let a=0;a<60&&!placed;a++){
      const pv=plats[k-1];
      const nd = r()<0.55 ? dir : Math.floor(r()*4);
      const last=k===K-1; let sz=last ? pickW(r,[[2,1-f*0.6],[1,f]]) : pickW(r,sizeW);
      const w=sz, d=sz;
      const useTramp = f>0.12 && r()<0.18 && pv[4]<6.5 && pv[2]*pv[3]>=2;
      const gap = useTramp ? pickW(r,[[0,1],[1,0.6]]) : (r()<Math.min(0.65,f*1.1) ? 1+Math.floor(r()*(1+f*2.4)) : 0);
      let dh;
      if(useTramp) dh=pickW(r,[[1.5,1],[2.0,0.7],[2.5,f]]);
      else if(gap>=2) dh=pickW(r,[[0,1],[-0.5,0.6],[0.5,f*0.5]]);
      else if(gap===1) dh=pickW(r,[[0,0.6],[0.5,1],[1.0,f*0.7],[-0.5,0.3]]);
      else dh=pickW(r,[[0.5,1-0.5*f],[1.0,0.25+0.6*f],[1.5,Math.max(0,f-0.5)*0.6]]);
      const nh=pv[4]+dh; if(nh<1.0||nh>8.5) continue;
      const [ddx,ddy]=D[nd]; let nx,ny;
      if(ddx){ nx= ddx>0 ? pv[0]+pv[2]+gap : pv[0]-gap-w; ny=pv[1]-d+1+Math.floor(r()*(pv[3]+d-1)); }
      else { ny= ddy>0 ? pv[1]+pv[3]+gap : pv[1]-gap-d; nx=pv[0]-w+1+Math.floor(r()*(pv[2]+w-1)); }
      if(!rectOk(nx,ny,w,d,k-1,gap===0)) continue;
      let tc=null;
      if(useTramp){ const cand=[]; for(let j=pv[1];j<pv[1]+pv[3];j++) for(let i=pv[0];i<pv[0]+pv[2];i++){
          const dd=Math.max(Math.max(nx-i,i-(nx+w-1),0),Math.max(ny-j,j-(ny+d-1),0)); if(dd===gap+1) cand.push([i,j]); }
        if(!cand.length) continue; tc=cand[Math.floor(r()*cand.length)]; }
      plats.push([nx,ny,w,d,nh]); if(tc) tramp.push(tc);
      if(!floorOk()){ plats.pop(); if(tc) tramp.pop(); continue; }
      const L=partialGrid(n,plats,tramp), src=cellsOf(L,pv);
      const p=reach(L,src,new Set(src),cellsOf(L,plats[k]),false);
      if(p<pmin){ plats.pop(); if(tc) tramp.pop(); continue; }
      ps.push(p); if(tc) feats.tramp=1; if(sz===1) feats.pillar=1; if(gap>=2) feats.gap2=1; if(dh<0) feats.down=1;
      dir=nd; placed=true;
    }
    if(!placed) break;   // ei enää mahdu: lyhyempi kenttä
  }
  if(plats.length<Math.max(2,Math.round(K*0.7))) return null;
  // jäälaikut lattialle
  const ice=[];
  if(f>0.1){ const nI=Math.floor(4*(f*4.5*r()+f*1.5));
    for(let q=0;q<nI;q++) for(let a=0;a<20;a++){ const w=2+Math.floor(r()*3), d=2+Math.floor(r()*2), x=1+Math.floor(r()*(n-w+1)), y=1+Math.floor(r()*(n-d+1));
      let bad=false; for(let j=y-1;j<=y+d&&!bad;j++) for(let i=x-1;i<=x+w;i++) if(occ(i,j)>=0||tramp.some(t=>t[0]===i&&t[1]===j)){ bad=true; break; }
      if(!bad){ ice.push([x,y,w,d]); feats.ice=1; break; } } }
  // aloituspaikka lattialle 2–4 ruudun päähän ensimmäisestä tasosta
  const p0=plats[0], cand=[];
  for(let j=1;j<=n;j++) for(let i=1;i<=n;i++){ if(occ(i,j)>=0) continue; if(ice.some(c=>i>=c[0]&&i<c[0]+c[2]&&j>=c[1]&&j<c[1]+c[3])) continue;
    const dd=Math.max(Math.max(p0[0]-i,i-(p0[0]+p0[2]-1),0),Math.max(p0[1]-j,j-(p0[1]+p0[3]-1),0)); if(dd>=2&&dd<=4) cand.push([i,j]); }
  if(!cand.length) return null;
  const sp=cand[Math.floor(r()*cand.length)];
  return {n, spawn:sp, plats, tramp, ice, feats};
}

function genOne(task){
  const {g,f,seed0}=task; let tries=0;
  const pmin = 0.15*Math.pow(1-f,1.5)+0.006;
  for(let a=0;a<60;a++){
    const lv=makeLevel(f, seed0*1000+a, pmin); tries++; if(!lv) continue;
    const ev=evaluate(lv, pmin*0.6); if(!ev||ev.fail!==undefined) continue;
    lv.ps=ev.ps; lv.score=scoreOf(ev.ps); lv.g=g; lv.tries=tries; return lv;
  }
  return {g, failed:true};
}

module.exports={reach,evaluate,scoreOf,makeLevel,genOne};
if(isMainThread){
  if(require.main===module){
    const total=+process.argv[2]||94, nw=2, tasks=[];
    for(let g=0;g<total;g++) tasks.push({g, f:g/(total-1), seed0:7919*(g+1)});
    const out=[]; let next=0, done=0; const t0=Date.now();
    for(let w=0;w<nw;w++){ const wk=new Worker(__filename,{workerData:null});
      const feed=()=>{ if(next<tasks.length) wk.postMessage(tasks[next++]); else wk.terminate(); };
      wk.on('message',m=>{ out.push(m); done++; process.stderr.write(`${done}/${tasks.length} g=${m.g} ${m.failed?'EPÄONNISTUI':'score '+m.score+' k='+m.plats.length+' yrit '+m.tries} ${((Date.now()-t0)/1000).toFixed(0)}s\n`); feed(); if(done===tasks.length) require('fs').writeFileSync(process.argv[3]||'levels.json', JSON.stringify(out)); });
      feed(); }
  }
} else if(require.main===module) {
  parentPort.on('message',t=>parentPort.postMessage(genOne(t)));
}
