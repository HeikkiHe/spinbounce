// Spinbounce — Copyright (C) 2026 Heikki Heinonen
// SPDX-License-Identifier: GPL-3.0-or-later
// Game idea and game mechanics by Heikki Heinonen. Implementation built with Claude (Anthropic).
// Kenttägeneraattori 2: useita kenttätyyppejä. Jokainen siirtymä tarkistetaan simuloimalla.
const {buildGrid}=require('./phys.js');
const G1=require('./gen.js'), scoreOf=G1.scoreOf; let RC=0, RT=0; const reach=(...a)=>{ const t=Date.now(); const r=G1.reach(...a); RC++; RT+=Date.now()-t; return r; };
const {Worker,isMainThread,parentPort}=require('worker_threads');

function rngOf(seed){ let a=seed>>>0; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function pickW(r,arr){ let t=0; for(const a of arr) t+=Math.max(0,a[1]); let x=r()*t; for(const a of arr){ x-=Math.max(0,a[1]); if(x<=0) return a[0]; } return arr[arr.length-1][0]; }
const ri=(r,a,b)=>a+Math.floor(r()*(b-a+1));
const near=(a,b)=>Math.abs(a-b)<1e-3;

// tason omat ruudut: suorakaiteen ruudut, joiden korkeus on tason korkeus (sisäkkäiset terassit)
function cellsOfH(L,p){ const a=[]; for(let j=p[1];j<p[1]+p[3];j++) for(let i=p[0];i<p[0]+p[2];i++){ const k=j*L.W+i; if(near(L.h[k],p[4])) a.push(k); } return a; }
function floorCells(L){ const a=[]; for(let k=0;k<L.h.length;k++) if(L.t[k]!==4&&L.t[k]!==3&&near(L.h[k],0.5)) a.push(k); return a; }
function floorConnected(L){ const fl=floorCells(L); if(!fl.length) return false; const set=new Set(fl), W=L.W, seen=new Set([fl[0]]), st=[fl[0]];
  while(st.length){ const k=st.pop(); for(const d of [1,-1,W,-W]){ const q=k+d; if(set.has(q)&&!seen.has(q)){ seen.add(q); st.push(q); } } } return seen.size===fl.length; }
function partialGrid(lv){ const L=buildGrid(lv), p=lv.plats[lv.plats.length-1];
  for(const k of cellsOfH(L,p)){ L.t[k]=p[5]||0; for(const t of lv.tramp) if(t[1]*L.W+t[0]===k) L.t[k]=1; for(const b of (lv.boost||[])) if(b[1]*L.W+b[0]===k) L.t[k]=8+b[2]; } return L; }

// koko kentän tarkistus: lattia yhtenäinen ja jokainen siirtymä mahdollinen
function evaluate(lv,pmin){
  const L=buildGrid({...lv,gates:[]}); if(!floorConnected(L)) return null;
  let src=floorCells(L); const ps=[];
  for(let i=0;i<lv.plats.length;i++){
    const tg=cellsOfH(L,lv.plats[i]); if(!tg.length) return null;
    if(lv.tpSteps&&lv.tpSteps.includes(i)){ ps.push(1); src=tg; continue; }   // tälle tasolle tullaan teleportilla
    const ss=new Set(src); for(const q of lv.ramps||[]) if(q[5]===i-1) ss.add(q[1]*L.W+q[0]);
    const p=reach(L,src,ss,tg,i===lv.plats.length-1); ps.push(+p.toFixed(4));
    if(p<pmin) return {fail:i,ps};
    src=tg;
  }
  return {ps};
}

// ---------- Yleinen polkurakentaja (portaat, saaristo, pilarit, hyppyasema, jää, sillat, kraatteri) ----------
function makeChain(f,r,pmin,o){
  const n=o.n, K=o.K, plats=[], tramp=[], boost=[], blocks=o.blocks||[], tp=[], tpSteps=[], ramps=[];
  const isPad=(i,j)=>tp.some(t=>(t[0]===i&&t[1]===j)||(t[2]===i&&t[3]===j));
  // oikotiesuoja: uudelle tasolle k ei saa päästä suoraan lattialta eikä kahta tai useampaa askelta aiemmalta tasolta
  const rd=(a,b)=>Math.max(Math.max(a[0]-(b[0]+b[2]-1),b[0]-(a[0]+a[2]-1),0),Math.max(a[1]-(b[1]+b[3]-1),b[1]-(a[1]+a[3]-1),0));
  const noShortcut=(L,k)=>{ if(k<2) return true; const tg=cellsOfH(L,plats[k]); if(!tg.length) return false;
    const fl=floorCells(L); if(reach(L,fl,new Set(fl),tg,false,true)>=0.01) return false;
    for(let q=0;q<k-2;q++){ const pq=plats[q]; if(rd(pq,plats[k])>5||plats[k][4]>pq[4]+1.6) continue;
      const src=cellsOfH(L,pq); if(src.length&&reach(L,src,new Set(src),tg,false,true)>=0.01) return false; }
    return true; };
  const lvOf=()=>({n,plats,tramp,boost,ice:[],blocks,ramps});
  const sf=o.surf||{}, surfPick=r=>{ const k=Object.keys(sf); if(!k.length||r()>(o.surfP||0.3)) return 0; return pickW(r,k.map(x=>[+x,sf[x]])); };
  const occ=(x,y)=>{ for(let k=0;k<plats.length;k++){ const p=plats[k]; if(x>=p[0]&&x<p[0]+p[2]&&y>=p[1]&&y<p[1]+p[3]) return k; } return -1; };
  const rectOk=(x,y,w,d,prevIdx,touchPrev)=>{
    if(x<1||y<1||x+w-1>n||y+d-1>n) return false;
    for(let j=y-1;j<=y+d;j++) for(let i=x-1;i<=x+w;i++){ const k=occ(i,j); if(k<0) continue;
      if(i>=x&&i<x+w&&j>=y&&j<y+d) return false;
      if((i===x-1||i===x+w)&&(j===y-1||j===y+d)) continue;
      if(!(touchPrev&&k===prevIdx)) return false; }
    for(const t of tramp.concat(boost,ramps)) if(t[0]>=x-1&&t[0]<=x+w&&t[1]>=y-1&&t[1]<=y+d) return false;
    for(const b of blocks) if(x<=b[0]+b[2]&&b[0]<=x+w-1+1&&y<=b[1]+b[3]&&b[1]<=y+d) return false;
    return true; };
  // ensimmäinen taso lattialta
  for(let a=0;a<40&&!plats.length;a++){
    const [w,d]=o.firstSize(r), H=o.firstH(r);
    const x0=ri(r,1,n-w+1), y0=ri(r,1,n-d+1);
    if(!rectOk(x0,y0,w,d,-1,false)) continue;
    const s0=surfPick(r); plats.push(s0?[x0,y0,w,d,H,s0]:[x0,y0,w,d,H]);
    const L=partialGrid(lvOf()); if(!floorConnected(L)){ plats.pop(); continue; }
    const fl=floorCells(L), p=reach(L,fl,new Set(fl),cellsOfH(L,plats[0]),false);
    if(p<pmin) plats.pop();
  }
  if(!plats.length) return null;
  const D=[[1,0],[0,1],[-1,0],[0,-1]]; let dir=ri(r,0,3);
  for(let k=1;k<K;k++){
    let placed=false;
    const wantTp = ALLOW.has('tp') && k>=2 && tp.length<2 && !tpSteps.includes(k-1) && plats[k-1][2]*plats[k-1][3]>=4 && r()<(PINTRO.has('tp')?0.3:0.09);
    for(let a=0;a<60&&!placed;a++){
      const pv=plats[k-1], last=k===K-1;
      if(wantTp&&a<15){   // seuraavalle tasolle pääsee vain teleportilla: se voi olla missä tahansa
        const s=last?2:pickW(r,[[2,1],[3,0.6]]), nh=Math.max(2.5,Math.min(o.maxH||8.5,pv[4]+pickW(r,[[0,1],[1,1],[2,0.8],[-1,0.6],[1.5,0.5]]))), nx=ri(r,1,n-s+1), ny=ri(r,1,n-s+1);
        if(!rectOk(nx,ny,s,s,-1,false)) continue;
        const pc=[]; for(let j=pv[1];j<pv[1]+pv[3];j++) for(let i=pv[0];i<pv[0]+pv[2];i++) if(!isPad(i,j)&&!tramp.concat(boost).some(t=>t[0]===i&&t[1]===j)) pc.push([i,j]);
        if(!pc.length) continue;
        plats.push([nx,ny,s,s,nh]);
        { const Lp=partialGrid(lvOf()); if(!floorConnected(Lp)||!noShortcut(Lp,k)){ plats.pop(); continue; } }
        const a2=pc[ri(r,0,pc.length-1)]; tp.push([a2[0],a2[1],nx+Math.floor(s/2),ny+Math.floor(s/2)]); tpSteps.push(k); dir=ri(r,0,3); placed=true; continue;
      }
      const nd = r()<o.straight ? dir : ri(r,0,3);
      const [ddx,ddy]=D[nd];
      const [along,across]=o.size(r,last,k);
      const w=ddx?along:across, d=ddx?across:along;
      const useTramp = ALLOW.has('tramp') && r()<o.trampP && pv[4]<6.5 && pv[2]*pv[3]>=2;
      const useBoost = !useTramp && o.boostP && r()<o.boostP && pv[2]*pv[3]>=2;
      const useKick = !useTramp && !useBoost && ALLOW.has('ramp') && r()<(o.kickP||0) && pv[2]*pv[3]>=2;     // viisto kiila heittää raon yli
      const useSlide = !useTramp && !useBoost && !useKick && ALLOW.has('ramp') && r()<(o.slideP||0);          // viisto liuska tasolta toiselle
      const gap = useTramp ? pickW(r,[[0,1],[1,0.6]]) : useBoost ? pickW(r,[[2,1],[3,0.8],[4,0.4]]) : useKick ? pickW(r,[[2,1],[3,1],[4,0.5]]) : useSlide ? pickW(r,[[2,1],[3,0.8],[4,0.4]]) : o.gap(r,k);
      const dh = useTramp ? pickW(r,[[1.5,1],[2.0,0.8],[2.5,f]]) : useBoost ? pickW(r,[[0,1],[-0.5,0.7],[0.5,0.3]]) : useKick ? pickW(r,[[0,1],[-0.5,0.8],[0.5,0.3]]) : useSlide ? pickW(r,[[-0.5,1],[-1,0.8],[-1.5,0.4],[0.5,0.35]]) : o.dh(r,gap,k,pv[4]);
      if(useSlide&&Math.abs(dh)/gap>0.5) continue;
      const nh=pv[4]+dh; if(nh<(k>=2?2.5:1.0)||nh>(o.maxH||8.5)) continue;
      let nx,ny;
      if(ddx){ nx= ddx>0 ? pv[0]+pv[2]+gap : pv[0]-gap-w; ny=pv[1]-d+1+ri(r,0,pv[3]+d-2); }
      else { ny= ddy>0 ? pv[1]+pv[3]+gap : pv[1]-gap-d; nx=pv[0]-w+1+ri(r,0,pv[2]+w-2); }
      if(!rectOk(nx,ny,w,d,k-1,gap===0)) continue;
      let tc=null;
      if(useTramp){ const cand=[]; for(let j=pv[1];j<pv[1]+pv[3];j++) for(let i=pv[0];i<pv[0]+pv[2];i++){
          const dd=Math.max(Math.max(nx-i,i-(nx+w-1),0),Math.max(ny-j,j-(ny+d-1),0)); if(dd===gap+1&&!isPad(i,j)) cand.push([i,j]); }
        if(!cand.length) continue; tc=cand[ri(r,0,cand.length-1)]; }
      let bc=null;
      if(useBoost){ const cand=[]; for(let j=pv[1];j<pv[1]+pv[3];j++) for(let i=pv[0];i<pv[0]+pv[2];i++){   // reunaruutu kohti uutta tasoa, nuoli samaan suuntaan
          const ox=ddx?(ddx>0?i===pv[0]+pv[2]-1:i===pv[0]):true, oy=ddy?(ddy>0?j===pv[1]+pv[3]-1:j===pv[1]):true;
          const lat= ddx ? (j>=ny&&j<ny+d) : (i>=nx&&i<nx+w); if(ox&&oy&&lat&&!isPad(i,j)) cand.push([i,j,nd]); }
        if(!cand.length) continue; bc=cand[ri(r,0,cand.length-1)]; }
      const newRamps=[];
      if(useKick){ const cand=[]; for(let j=pv[1];j<pv[1]+pv[3];j++) for(let i=pv[0];i<pv[0]+pv[2];i++){
          const ox=ddx?(ddx>0?i===pv[0]+pv[2]-1:i===pv[0]):true, oy=ddy?(ddy>0?j===pv[1]+pv[3]-1:j===pv[1]):true;
          const lat= ddx ? (j>=ny&&j<ny+d) : (i>=nx&&i<nx+w); if(ox&&oy&&lat&&!isPad(i,j)&&!tramp.concat(boost,ramps).some(t=>t[0]===i&&t[1]===j)) cand.push([i,j]); }
        if(!cand.length) continue; const c=cand[ri(r,0,cand.length-1)]; newRamps.push([c[0],c[1],(nd+2)%4,pv[4],pickW(r,[[0.25,1],[0.5,0.7]]),k-1]); }
      if(useSlide){ // kaista raossa: korkeus muuttuu tasaisesti edelliseltä tasolta uudelle
        const lo=ddx?Math.max(pv[1],ny):Math.max(pv[0],nx), hi=ddx?Math.min(pv[1]+pv[3],ny+d):Math.min(pv[0]+pv[2],nx+w); if(hi<=lo) continue;
        const wd=(hi-lo>=2&&r()<0.5)?2:1, s0=lo+ri(r,0,hi-lo-wd);
        const sx=ddx?(ddx>0?pv[0]+pv[2]:pv[0]-gap):s0, sy=ddy?(ddy>0?pv[1]+pv[3]:pv[1]-gap):s0, sw2=ddx?gap:wd, sd2=ddx?wd:gap;
        if(!rectOk(sx,sy,sw2,sd2,k-1,true)) continue;
        for(let t=0;t<gap;t++) for(let q=0;q<wd;q++){ const i=ddx?(ddx>0?sx+t:sx+gap-1-t):s0+q, j=ddy?(ddy>0?sy+t:sy+gap-1-t):s0+q;
          const hs=pv[4]+dh*t/gap, he=pv[4]+dh*(t+1)/gap; newRamps.push([i,j,dh<0?(nd+2)%4:nd,Math.min(hs,he),Math.abs(he-hs),k-1]); } }
      const sn=last?0:surfPick(r);
      plats.push(sn?[nx,ny,w,d,nh,sn]:[nx,ny,w,d,nh]); if(tc) tramp.push(tc); if(bc) boost.push(bc); ramps.push(...newRamps);
      const L=partialGrid(lvOf());
      let ok=floorConnected(L);
      if(ok){ const src=cellsOfH(L,pv), ss=new Set(src); for(const q of newRamps) ss.add(q[1]*L.W+q[0]); ok = src.length>0 && reach(L,src,ss,cellsOfH(L,plats[k]),false)>=pmin && noShortcut(L,k); }
      if(!ok){ plats.pop(); if(tc) tramp.pop(); if(bc) boost.pop(); ramps.length-=newRamps.length; continue; }
      dir=nd; placed=true;
    }
    if(!placed) break;
  }
  if(plats.length<Math.max(2,Math.round(K*0.7))) return null;
  return {n,plats,tramp,boost,blocks,tp,tpSteps,ramps};
}
// jäälaikut, koristepilarit ja aloituspaikka
function finish(lv,r,o){
  const n=lv.n, inPl=(i,j,m)=>lv.plats.some(p=>i>=p[0]-m&&i<p[0]+p[2]+m&&j>=p[1]-m&&j<p[1]+p[3]+m)||lv.tramp.concat(lv.boost||[],lv.ramps||[]).some(t=>Math.abs(t[0]-i)<=m&&Math.abs(t[1]-j)<=m);
  const inBl=(i,j)=>lv.blocks.some(b=>i>=b[0]&&i<b[0]+b[2]&&j>=b[1]&&j<b[1]+b[3]);
  lv.ice=lv.ice||[];
  for(let q=0;q<(ALLOW.has('ice')?(o.ice||0):0);q++) for(let a=0;a<25;a++){ const w=ri(r,o.iceMin||2,o.iceMax||4), d=ri(r,o.iceMin||2,o.iceMax||3), x=ri(r,1,n-w+1), y=ri(r,1,n-d+1);
    let bad=false; for(let j=y-1;j<=y+d&&!bad;j++) for(let i=x-1;i<=x+w;i++) if(inPl(i,j,0)||inBl(i,j)){ bad=true; break; }
    if(!bad){ lv.ice.push([x,y,w,d]); break; } }
  lv.patches=lv.patches||[]; lv.boost=lv.boost||[];
  const pk=Object.keys(o.patch||{});
  if(pk.length) for(let q=0;q<(o.nPatch||0);q++){ const ty=pickW(r,pk.map(x=>[+x,o.patch[x]]));
    for(let a=0;a<25;a++){ const w=ri(r,2,5), d=ri(r,2,4), x=ri(r,1,n-w+1), y=ri(r,1,n-d+1);
      let bad=false; for(let j=y-1;j<=y+d&&!bad;j++) for(let i=x-1;i<=x+w;i++) if(inPl(i,j,0)||inBl(i,j)||lv.ice.some(c=>i>=c[0]&&i<c[0]+c[2]&&j>=c[1]&&j<c[1]+c[3])){ bad=true; break; }
      if(!bad){ lv.patches.push([x,y,w,d,ty]); break; } } }
  // viistot harjanteet lattialla: kaksi ruutua, jotka viettävät harjalta poispäin ja heittävät pallon sivuun
  lv.ramps=lv.ramps||[];
  const nRoof=ALLOW.has("ramp")?Math.round(n*n/110*(0.4+(n-14)/14)*(o.roofK===undefined?1:o.roofK)):0;
  for(let q=0;q<nRoof;q++) for(let a=0;a<20;a++){ const hz=r()<0.5, x=ri(r,1,n-(hz?1:0)), y=ri(r,1,n-(hz?0:1)), x2=x+(hz?1:0), y2=y+(hz?0:1);
    const bad=(i,j)=>inPl(i,j,1)||inBl(i,j)||lv.ice.concat(lv.patches).some(c=>i>=c[0]&&i<c[0]+c[2]&&j>=c[1]&&j<c[1]+c[3])||lv.ramps.some(t=>Math.abs(t[0]-i)<=1&&Math.abs(t[1]-j)<=1);
    if(bad(x,y)||bad(x2,y2)) continue; const rs=pickW(r,[[0.25,1],[0.5,1]]);
    lv.ramps.push([x,y,hz?0:1,0.5,rs,-1],[x2,y2,hz?2:3,0.5,rs,-1]); break; }
  for(let q=0;q<(o.deco||0);q++) for(let a=0;a<20;a++){ const x=ri(r,1,n), y=ri(r,1,n);
    if(inPl(x,y,2)||inBl(x,y)) continue; lv.blocks.push([x,y,1,1,o.decoH(r)]); break; }
  const p0=lv.plats[0], cand=[];
  for(let j=1;j<=n;j++) for(let i=1;i<=n;i++){ if(inPl(i,j,0)||inBl(i,j)) continue; if(lv.ice.concat(lv.patches).some(c=>i>=c[0]-1&&i<=c[0]+c[2]&&j>=c[1]-1&&j<=c[1]+c[3])) continue;
    const dd=Math.max(Math.max(p0[0]-i,i-(p0[0]+p0[2]-1),0),Math.max(p0[1]-j,j-(p0[1]+p0[3]-1),0)); if(dd>=(o.spMin||2)&&dd<=(o.spMax||4)) cand.push([i,j]); }
  if(!cand.length) return null;
  lv.spawn=cand[ri(r,0,cand.length-1)];
  return lv;
}

// ---------- Pinnat kenttätyypeittäin ----------
// 5 tarra, 6 puolijää, 7 vaimennin, 12 hiekka, 13 lumi, 'boost' = kiihdytin
let ALLOW=new Set(), INTRO=null, PINTRO=new Set();
const PREF={
  stairs:{surf:{12:1,13:1,5:1,6:0.6,7:0.6}, patch:{12:1,13:1,6:0.5}, boost:0.08, kick:0.08, slide:0.1},
  islands:{surf:{12:2,5:0.5,7:0.5}, patch:{12:2}, boost:0.25, kick:0.15, slide:0.12},
  pillars:{surf:{5:2,13:0.5}, patch:{13:1,12:0.5}, boost:0, kick:0.1, slide:0.05},
  tramp:{surf:{7:1.5,5:1}, patch:{12:0.5}, boost:0.1, kick:0.08, slide:0.1},
  ice:{surf:{13:2,6:2}, patch:{13:2,6:1.5}, boost:0.1, kick:0.08, slide:0.15},
  bridges:{surf:{6:1.5,5:0.7}, patch:{}, boost:0.3, kick:0.05, slide:0.3},
  crater:{surf:{12:1.5,7:1}, patch:{12:2}, boost:0.15, kick:0.1, slide:0.3},
  ziggurat:{surf:{12:1,13:1,5:0.5}, patch:{12:1,13:1}, boost:0},
  maze:{surf:{}, patch:{12:1,13:1,6:1}, boost:0},
};
function SO(type,f){ const P=PREF[type], surf={}, patch={};
  for(const k in P.surf) if(ALLOW.has(+k)) surf[k]=P.surf[k];
  for(const k in P.patch) if(ALLOW.has(+k)) patch[k]=P.patch[k];
  let surfP=0.15+0.25*f, nPatch=Object.keys(patch).length?Math.round(2+6*f):0, boostP=ALLOW.has('boost')?P.boost:0;
  if(INTRO!==null){ if(INTRO==='boost') boostP=Math.max(boostP,0.5);
    else { surf[INTRO]=(surf[INTRO]||0)+4; surfP=Math.max(surfP,0.55); if(INTRO!==5&&INTRO!==7){ patch[INTRO]=(patch[INTRO]||0)+4; nPatch+=3; } } }
  let kickP=P.kick||0, slideP=P.slide||0; if(PINTRO.has('ramp')){ kickP=Math.max(kickP,0.25); slideP=Math.max(slideP,0.3); }
  return {surf,surfP,patch,nPatch,boostP,kickP,slideP}; }

// ---------- Pulmat: kiteet (cr), kytkimet ja portit (sw), teleportit (tp) ----------
// Polkukenttien abstrakti malli: solmut 0 = lattia, 1..K = polun tasot, K+1.. = sivuhaarat.
// Tila = (solmu, porttien asento, kerätyt kiteet). Tarkistetaan, että maaliin pääsee jokaisesta saavutettavasta tilasta.
function chainSolve(K,tpSteps,gates,sws,crs,brPar){
  const nBr=brPar.length, N=1+K+nBr, nCr=crs.length, full=(1<<nCr)-1, S=N*4*(full+1);
  const gateAt=new Int8Array(K).fill(-1); gates.forEach((g,i)=>{ gateAt[g.k]=i; });
  const closed=(i,b)=>{ const g=gateAt[i]; return g>=0 && ((gates[g].init^((b>>gates[g].color)&1))===1); };
  const swAt=[], crAt=[]; for(let v=0;v<N;v++){ swAt.push([]); crAt.push([]); }
  sws.forEach(s=>swAt[s.node].push(s)); crs.forEach((c,i)=>crAt[c.node].push(i));
  const enter=(v,b,k)=>{ for(const i of crAt[v]) k|=1<<i; for(const s of swAt[v]) if(s.forced) b^=1<<s.color; return v+N*(b+4*k); };
  const succ=st=>{ const v=st%N, b=Math.floor(st/N)%4, k=Math.floor(st/(4*N)), out=[];
    if(v!==0) out.push(enter(0,b,k)); else out.push(enter(1,b,k));
    if(v>=1&&v<=K){ const i=v-1;
      if(i+1<K && (tpSteps.includes(i+1) || !closed(i+1,b))) out.push(enter(v+1,b,k));
      if(tpSteps.includes(i)) out.push(enter(v-1,b,k));
      for(let q=0;q<nBr;q++) if(brPar[q]===i) out.push(enter(K+1+q,b,k)); }
    for(const s of swAt[v]) if(!s.forced) out.push(v+N*((b^(1<<s.color))+4*k));
    return out; };
  const dist=new Int32Array(S).fill(-1), list=[], s0=enter(0,0,0); dist[s0]=0; list.push(s0);
  const pred=new Map(); let best=-1; const goals=[];
  for(let h=0;h<list.length;h++){ const st=list[h]; const v=st%N, k=Math.floor(st/(4*N));
    if(v===K&&k===full){ goals.push(st); if(best<0) best=dist[st]; }
    for(const t of succ(st)){ if(!pred.has(t)) pred.set(t,[]); pred.get(t).push(st); if(dist[t]<0){ dist[t]=dist[st]+1; list.push(t); } } }
  if(best<0) return {ok:false};
  const good=new Set(goals), stack=goals.slice();
  while(stack.length){ const t=stack.pop(); for(const p of (pred.get(t)||[])) if(!good.has(p)){ good.add(p); stack.push(p); } }
  return {ok:good.size===list.length, len:best};
}
function addPuzzle(lv,f,r,pmin,o){
  const A=ALLOW, n=lv.n, K=lv.plats.length, zig=!!o.zig;
  lv.cr=[]; lv.sw=[]; lv.gates=[]; lv.tp=lv.tp||[]; lv.tpSteps=lv.tpSteps||[]; lv.sol=K; lv.nBr=0;
  if(!A.has('cr')&&!A.has('sw')) return true;
  const used=new Set(), key=(i,j)=>i+','+j, specials=lv.tramp.concat(lv.boost||[],lv.ramps||[]);
  for(const t of specials) used.add(key(t[0],t[1])); for(const t of lv.tp){ used.add(key(t[0],t[1])); used.add(key(t[2],t[3])); }
  const inRect=(i,j,p,m)=>i>=p[0]-m&&i<p[0]+p[2]+m&&j>=p[1]-m&&j<p[1]+p[3]+m;
  const solid=(i,j)=>lv.plats.some(p=>inRect(i,j,p,0))||lv.blocks.some(b=>inRect(i,j,b,0))||(lv.ramps||[]).some(t=>t[0]===i&&t[1]===j);
  const rectFree=(x,y,w,d,par,touch)=>{ if(x<1||y<1||x+w-1>n||y+d-1>n) return false;
    if(inRect(lv.spawn[0],lv.spawn[1],[x,y,w,d],1)) return false;
    if(specials.some(t=>inRect(t[0],t[1],[x,y,w,d],1))) return false;
    for(let j=y-1;j<=y+d;j++) for(let i=x-1;i<=x+w;i++){ const inner=i>=x&&i<x+w&&j>=y&&j<y+d, diag=(i===x-1||i===x+w)&&(j===y-1||j===y+d);
      if(inner&&used.has(key(i,j))) return false;
      for(let q=0;q<lv.plats.length;q++) if(inRect(i,j,lv.plats[q],0)){ if(inner) return false; if(!diag&&!(touch&&q===par)) return false; }
      if(!diag) for(const b of lv.blocks) if(inRect(i,j,b,0)) return false; }
    return true; };
  const gateK=new Set(), branches=[], D=[[1,0],[0,1],[-1,0],[0,-1]];
  const openLv=()=>({n,plats:lv.plats,tramp:lv.tramp,boost:lv.boost,ice:lv.ice,patches:lv.patches,blocks:lv.blocks,ramps:lv.ramps});
  function addBranch(lo,hi){ if(zig||hi<lo) return null;
    for(let a=0;a<16;a++){ const par=ri(r,lo,hi), pv=lv.plats[par]; if(gateK.has(par)||par>=K-1) continue;
      const s=f<0.45?2:pickW(r,[[2,1],[1,f]]), gap=r()<0.25+f*0.4?1:0, nh=pv[4]+pickW(r,[[0,1],[0.5,0.8],[-0.5,0.5]]); if(nh<1||nh>8.5) continue;
      const [dx,dy]=D[ri(r,0,3)]; let nx,ny;
      if(dx){ nx=dx>0?pv[0]+pv[2]+gap:pv[0]-gap-s; ny=pv[1]-s+1+ri(r,0,pv[3]+s-2); } else { ny=dy>0?pv[1]+pv[3]+gap:pv[1]-gap-s; nx=pv[0]-s+1+ri(r,0,pv[2]+s-2); }
      if(!rectFree(nx,ny,s,s,par,gap===0)) continue;
      const b=[nx,ny,s,s,nh]; lv.blocks.push(b);
      const L=buildGrid(openLv()); let ok=floorConnected(L);
      if(ok){ const src=cellsOfH(L,pv).filter(c=>!used.has(key(c%L.W,Math.floor(c/L.W)))); ok=src.length>0&&reach(L,src,new Set(cellsOfH(L,pv)),cellsOfH(L,b),false)>=pmin; }
      if(!ok){ lv.blocks.pop(); continue; }
      const br={par,b,node:K+1+branches.length}; branches.push(br); return br; }
    return null; }
  const cellOn=rect=>{ const L=buildGrid(openLv()), c=cellsOfH(L,rect).map(k=>[k%L.W,Math.floor(k/L.W)]).filter(c=>!used.has(key(c[0],c[1]))); return c.length?c[ri(r,0,c.length-1)]:null; };
  const floorCell=()=>{ for(let a=0;a<80;a++){ const i=ri(r,1,n), j=ri(r,1,n); if(solid(i,j)||used.has(key(i,j))||lv.ice.some(c=>inRect(i,j,c,0))) continue;
      if(Math.abs(i-lv.spawn[0])<2&&Math.abs(j-lv.spawn[1])<2) continue; return [i,j]; } return null; };
  const gates=[], sws=[], crs=[];
  const brPar=()=>branches.map(b=>b.par);
  const putSw=(node,cell,color,forced)=>{ if(!cell) return false; used.add(key(cell[0],cell[1])); sws.push({node,color,forced,cell}); return true; };
  // --- portit ja kytkimet ---
  if(A.has('sw')&&!zig&&K>=4){
    const cand=[]; for(let k=1;k<=K-2;k++){ const p=lv.plats[k], q=lv.plats[k-1];
      if(lv.tpSteps.includes(k)||lv.tpSteps.includes(k+1)) continue;
      if(specials.some(t=>inRect(t[0],t[1],p,0)||inRect(t[0],t[1],q,0))) continue;
      if(lv.tp.some(t=>inRect(t[0],t[1],p,0)||inRect(t[2],t[3],p,0))) continue; cand.push(k); }
    const want=PINTRO.has('sw')?1:(f<0.55?1:pickW(r,[[1,1],[2,0.5+f]])), ks=[];
    for(let a=0;a<30&&ks.length<want&&cand.length;a++){ const k=cand[ri(r,0,cand.length-1)]; if(!ks.some(q=>Math.abs(q-k)<2)) ks.push(k); }
    ks.sort((a,b)=>a-b);
    if(ks.length){
      const inverse=ks.length===2&&r()<0.45;
      ks.forEach((k,i)=>{ gates.push({k,color:inverse?0:(ks.length===2?i:ri(r,0,1)),init:(inverse&&i===1)?0:1}); gateK.add(k); });
      const place=(lo,hi,color,kind)=>{ // kytkin tasolle välillä lo..hi, sivuhaaraan tai lattialle
        if(kind==='branch'){ const br=addBranch(lo,hi); if(br) return putSw(br.node,cellOn(br.b),color,br.b[2]*br.b[3]===1); kind='chain'; }
        if(kind==='chain'){ for(let a=0;a<10;a++){ const j=ri(r,lo,hi); if(gateK.has(j)) continue; const p=lv.plats[j]; return putSw(1+j,cellOn(p),color,p[2]*p[3]===1); } kind='floor'; }
        return putSw(0,floorCell(),color,false); };
      const kindOf=()=>PINTRO.has('sw')?'chain':pickW(r,[['branch',0.5],['floor',0.3],['chain',0.2]]);
      const colors=[...new Set(gates.map(g=>g.color))];
      for(const c of colors){ const first=Math.min(...gates.filter(g=>g.color===c).map(g=>g.k)); place(PINTRO.has('sw')?first-1:0,first-1,c,kindOf()); }
      if(inverse) place(ks[0]+1,ks[1]-1,0,r()<0.6?'branch':'chain');
      let res=chainSolve(K,lv.tpSteps,gates,sws,[],brPar());
      if(!res.ok){ for(const c of colors) putSw(0,floorCell(),c,false); res=chainSolve(K,lv.tpSteps,gates,sws,[],brPar()); }
      if(!res.ok){ gates.length=0; sws.length=0; gateK.clear(); }
    }
  }
  // --- kiteet ---
  if(A.has('cr')){
    const nCr=PINTRO.has('cr')?ri(r,2,3):Math.max(1,Math.min(6,Math.round(1+f*3.5+r()*1.5)));
    const nBr=(PINTRO.has('cr')||zig)?0:Math.round(nCr*(0.25+0.5*f));
    for(let q=0;q<nBr;q++){ const br=addBranch(0,K-2); if(!br) continue; const b=br.b; crs.push({node:br.node,pos:[b[0]+b[2]/2,b[1]+b[3]/2,b[4]+0.95]}); lv.nBr++; }
    for(let a=0;a<50&&crs.length<nCr;a++){
      if(zig||r()<0.6){ const i=ri(r,0,K-2); if(gateK.has(i)) continue; const c=cellOn(lv.plats[i]); if(!c) continue; used.add(key(c[0],c[1])); crs.push({node:1+i,pos:[c[0]+0.5,c[1]+0.5,lv.plats[i][4]+0.95]}); }
      else { const c=floorCell(); if(!c) continue; used.add(key(c[0],c[1])); crs.push({node:0,pos:[c[0]+0.5,c[1]+0.5,1.45]}); } }
  }
  const res=chainSolve(K,lv.tpSteps,gates,sws,crs,brPar());
  if(!res.ok) return false;
  lv.sol=res.len; lv.cr=crs.map(c=>c.pos); lv.sw=sws.map(s=>[s.cell[0],s.cell[1],s.color]);
  for(const g of gates){ const p=lv.plats[g.k], sunk=o.sunkP&&r()<o.sunkP&&Math.max(p[2],p[3])>=3&&p[4]>=1.5, hc=sunk?0.5:Math.min(9,p[4]+3);
    lv.gates.push([p[0],p[1],p[2],p[3],g.init?hc:p[4],g.init?p[4]:hc,g.color]); }
  return true;
}
// Labyrintin pulma: ovet (portit) käytävien aukoissa, kytkimet, kiteet ja teleportit. Ratkaisu haetaan leveyshaulla.
function mazeSolve(m,adj,doors,swC,tpTo,crC,nCr,forced,goal){
  const NC=m*m, full=(1<<nCr)-1, dist=new Int32Array(NC*4*(full+1)).fill(-1), q=[];
  const enter=(c,b,k)=>{ if(forced&&tpTo[c]>=0) c=tpTo[c]; if(crC[c]>=0) k|=1<<crC[c]; if(forced&&swC[c]>=0) b^=1<<swC[c]; return c+NC*(b+4*k); };
  const s0=enter(0,0,0); dist[s0]=0; q.push(s0);
  for(let h=0;h<q.length;h++){ const st=q[h], c=st%NC, b=Math.floor(st/NC)%4, k=Math.floor(st/(4*NC));
    if(c===goal&&k===full) return dist[st];
    const push=t=>{ if(dist[t]<0){ dist[t]=dist[st]+1; q.push(t); } };
    for(const e of adj[c]){ if(e.door>=0){ const d=doors[e.door]; if((d.closed^((b>>d.color)&1))===1) continue; } push(enter(e.to,b,k)); }
    if(!forced){ if(swC[c]>=0) push(c+NC*((b^(1<<swC[c]))+4*k)); if(tpTo[c]>=0) push(enter(tpTo[c],b,k)); } }
  return -1;
}
function mazePuzzle(lv,f,r,m,cw,pitch,open,goalCell){
  const want=lv.pathLen*(1.5+f);   // tavoiteltu ratkaisun pituus: mutkia ja paluuta, muttei loputonta ravaamista
  const A=ALLOW, NC=m*m, edges=[], adjBase=[]; for(let c=0;c<NC;c++) adjBase.push([]);
  for(const key of open){ const [sx,sy,o]=key.split(','), cx=+sx, cy=+sy, a=cy*m+cx, b=o==='h'?a+1:a+m; edges.push({a,b,cx,cy,o}); }
  const deg=new Int32Array(NC); for(const e of edges){ deg[e.a]++; deg[e.b]++; }
  const dead=[]; for(let c=1;c<NC;c++) if(deg[c]===1&&c!==goalCell) dead.push(c);
  const nD=A.has('sw')?Math.min(Math.floor(edges.length/3),PINTRO.has('sw')?1:1+Math.round(f*5+r())):0, nC=(f<0.45||nD<2)?1:2;
  const nK=A.has('cr')?Math.min(5,Math.round(f*4+r()*1.5)):0, nT=A.has('tp')?Math.min(Math.floor(dead.length/2),PINTRO.has('tp')?1:Math.round(r()*(0.7+f))):0;
  lv.cr=[]; lv.sw=[]; lv.gates=[]; lv.tp=[]; lv.items=new Set();
  if(!nD&&!nK&&!nT) return;
  const forced=cw===1, sh=a=>{ for(let i=a.length-1;i>0;i--){ const j=ri(r,0,i); [a[i],a[j]]=[a[j],a[i]]; } return a; };
  let best=null;
  for(let t=0;t<80;t++){
    const taken=new Set([0,goalCell]), pick=pool=>{ for(let a=0;a<30;a++){ const c=pool[ri(r,0,pool.length-1)]; if(!taken.has(c)){ taken.add(c); return c; } } return -1; };
    const all=[...Array(NC).keys()];
    const doors=sh(edges.slice()).slice(0,nD).map((e,i)=>({e,color:ri(r,0,nC-1),closed:(i===0||r()<0.7)?1:0}));
    if(nC===2&&doors.length>=2){ doors[0].color=0; doors[1].color=1; }
    const tps=[], dd=sh(dead.slice()); for(let q=0;q<nT;q++){ const a=dd[2*q], b=dd[2*q+1]; taken.add(a); taken.add(b); tps.push([a,b]); }
    const sws=[]; for(const c of new Set(doors.map(d=>d.color))){ const k=1+(r()<0.35?1:0); for(let q=0;q<k;q++){ const cell=pick(all); if(cell>=0) sws.push([cell,c]); } }
    const crs=[]; for(let q=0;q<nK;q++){ const cell=pick(dead.length&&r()<0.6?dead:all); if(cell>=0) crs.push(cell); }
    const adj=adjBase.map(()=>[]); const dOf=new Map(doors.map((d,i)=>[d.e,i]));
    for(const e of edges){ const di=dOf.has(e)?dOf.get(e):-1; adj[e.a].push({to:e.b,door:di}); adj[e.b].push({to:e.a,door:di}); }
    const swC=new Int8Array(NC).fill(-1), tpTo=new Int32Array(NC).fill(-1), crC=new Int8Array(NC).fill(-1);
    sws.forEach(s=>{ swC[s[0]]=s[1]; }); tps.forEach(p=>{ tpTo[p[0]]=p[1]; tpTo[p[1]]=p[0]; }); crs.forEach((c,i)=>{ crC[c]=i; });
    const len=mazeSolve(m,adj,doors,swC,tpTo,crC,crs.length,forced,goalCell);
    if(len>=0&&(!best||Math.abs(len-want)<Math.abs(best.len-want))) best={len,doors,sws,tps,crs};
  }
  if(!best) return;
  const org=c=>[1+(c%m)*pitch,1+Math.floor(c/m)*pitch], mid=Math.floor(cw/2);
  for(const d of best.doors){ const x0=1+d.e.cx*pitch, y0=1+d.e.cy*pitch, rc=d.e.o==='h'?[x0+cw,y0,1,cw]:[x0,y0+cw,cw,1];
    lv.gates.push([...rc,d.closed?3.5:0.5,d.closed?0.5:3.5,d.color]); }
  for(const s of best.sws){ const [x,y]=org(s[0]); lv.sw.push([x+mid,y+mid,s[1]]); lv.items.add(s[0]); }
  for(const p of best.tps){ const a=org(p[0]), b=org(p[1]); lv.tp.push([a[0]+mid,a[1]+mid,b[0]+mid,b[1]+mid]); lv.items.add(p[0]); lv.items.add(p[1]); }
  for(const c of best.crs){ const [x,y]=org(c); lv.cr.push([x+cw/2,y+cw/2,1.45]); lv.items.add(c); }
  lv.pathLen=best.len; lv.nDoors=best.doors.length;
}

// ---------- Kenttätyypit ----------
const N=(f,r)=>Math.round(14+f*13+r()*2);
const T={
  stairs:{ name:'Tähtiportaat', make(f,r,pm){ const n=N(f,r);
    const lv=makeChain(f,r,pm,{...SO('stairs',f),n,K:Math.max(3,Math.round(3+f*18+(r()-0.5)*3)), straight:0.55, trampP:f>0.15?0.12:0,
      firstSize:r=>{const s=pickW(r,[[3,1-f*0.6],[2,0.6]]); return [s,s];}, firstH:r=>0.5+pickW(r,[[0.5,1],[1.0,f]]),
      size:(r,last)=>{ const s=last?pickW(r,[[2,1-f*0.6],[1,f]]):pickW(r,[[3,Math.max(0.05,0.7-f)],[2,0.5],[1,Math.max(0,f-0.2)]]); return [s,s]; },
      gap:r=>r()<Math.min(0.5,f*0.9)?1+Math.floor(r()*(1+f*1.5)):0,
      dh:(r,g)=> g>=2?pickW(r,[[0,1],[0.5,f*0.5]]) : g===1?pickW(r,[[0,0.5],[0.5,1],[1.0,f*0.7]]) : pickW(r,[[0.5,1-0.4*f],[1.0,0.3+0.6*f],[1.5,Math.max(0,f-0.5)*0.6]]) });
    return lv&&finish(lv,r,{...SO('stairs',f),ice:f>0.3?ri(r,0,3):0}); } },
  islands:{ name:'Asteroidivyö', make(f,r,pm){ const n=N(f,r);
    const lv=makeChain(f,r,pm,{...SO('islands',f),n,K:Math.round(4+f*12+r()*2), straight:0.4, trampP:0, maxH:4.0,
      firstSize:r=>{const s=pickW(r,[[3,1],[2,0.5]]); return [s,s];}, firstH:()=>1.0,
      size:(r,last)=>{ const a=pickW(r,[[3,1-f*0.7],[2,0.7],[1,f*0.8]]), b=Math.max(1,a+pickW(r,[[0,1],[-1,0.4],[1,0.3]])); return last?[Math.min(a,2),Math.min(b,2)]:[a,b]; },
      gap:(r,k)=>k<=2?0:(r()<0.2*(1-f)?0:1+Math.floor(r()*(1+f*2.3))),   // kaksi ensimmäistä askelta portaina ilmaan
      dh:(r,g,k,H)=> H<2.5 ? pickW(r,[[0.5,1],[1.0,g===0?1:0.3]]) : pickW(r,[[0,1],[0.5,0.5],[-0.5,0.4],[1.0,g<=1?f*0.5:0]]) });
    return lv&&finish(lv,r,{...SO('islands',f),ice:f>0.4?ri(r,0,2):0}); } },
  pillars:{ name:'Pilarimetsä', make(f,r,pm){ const n=N(f,r);
    const lv=makeChain(f,r,pm,{...SO('pillars',f),n,K:Math.round(4+f*14+r()*2), straight:0.45, trampP:0,
      firstSize:()=>[2,2], firstH:r=>pickW(r,[[1.0,1],[1.5,0.6]]),
      size:(r,last)=>{ const s=pickW(r,[[2,Math.max(0.1,1-f*1.4)],[1,0.4+f]]); return [s,s]; },
      gap:r=>r()<0.25+f*0.4?1:0,
      dh:(r,g,k,H)=>pickW(r,[[0,1],[0.5,H<5?0.9:0.2],[-0.5,0.4],[1.0,g===0?f*0.6:0]]) });
    return lv&&finish(lv,r,{...SO('pillars',f),deco:Math.round(n*n*(0.05+0.06*f)), decoH:r=>pickW(r,[[1.0,1],[1.5,1],[2.5,0.8],[4,0.6],[6,0.3]])}); } },
  tramp:{ name:'Hyppyasema', make(f,r,pm){ const n=N(f,r);
    const lv=makeChain(f,r,pm,{...SO('tramp',f),n,K:Math.round(3+f*10+r()*2), straight:0.5, trampP:0.55,
      firstSize:()=>[3,3], firstH:()=>1.0,
      size:(r,last)=>{ const s=last?2:pickW(r,[[3,1],[2,0.6+f]]); return [s,s]; },
      gap:r=>r()<0.3+f*0.3?1:0,
      dh:(r,g)=>pickW(r,[[0.5,1],[0,0.4],[1.0,f*0.6]]) });
    return lv&&finish(lv,r,{...SO('tramp',f),}); } },
  ice:{ name:'Jääkomeetta', make(f,r,pm){ const n=N(f,r);
    const lv=makeChain(f,r,pm,{...SO('ice',f),n,K:Math.round(3+f*12+r()*2), straight:0.5, trampP:0.1,
      firstSize:()=>[3,3], firstH:r=>pickW(r,[[1.0,1],[1.5,f]]),
      size:(r,last)=>{ const s=last?2:pickW(r,[[3,1-f*0.5],[2,0.7],[1,f*0.5]]); return [s,s]; },
      gap:r=>r()<f*0.6?1+Math.floor(r()*(1+f)):0,
      dh:(r,g)=> g>=1?pickW(r,[[0,1],[0.5,0.6]]) : pickW(r,[[0.5,1],[1.0,0.3+f*0.5]]) });
    return lv&&finish(lv,r,{...SO('ice',f),ice:Math.round(6+f*10), iceMin:3, iceMax:6, spMin:2, spMax:5}); } },
  bridges:{ name:'Valosillat', make(f,r,pm){ const n=N(f,r); const bw=f<0.35?2:pickW(r,[[1,f],[2,1-f]]);
    const lv=makeChain(f,r,pm,{...SO('bridges',f),n,K:Math.round(4+f*12+r()*2), straight:0.15, trampP:0,
      firstSize:()=>[3,3], firstH:r=>pickW(r,[[1.0,1],[1.5,1]]),
      size:(r,last)=> last?[2,2]:[ri(r,3,5+Math.round(f*2)), bw],
      gap:r=>r()<f*0.5?1:0,
      dh:(r,g,k,H)=>pickW(r,[[0,1],[0.5,H<6?0.8:0.1],[-0.5,0.2]]) });
    return lv&&finish(lv,r,{...SO('bridges',f),}); } },
  crater:{ name:'Kraatteri', make(f,r,pm){ const n=N(f,r), K=Math.round(6+f*12+r()*2), top=Math.round(K*0.55);
    const lv=makeChain(f,r,pm,{...SO('crater',f),n,K, straight:0.5, trampP:0.08,
      firstSize:()=>[3,3], firstH:()=>1.0,
      size:(r,last)=>{ const s=last?2:pickW(r,[[3,0.8-f*0.5],[2,1],[1,f*0.6]]); return [s,s]; },
      gap:(r,k)=> k>=top ? (r()<0.4+f*0.4?1+Math.floor(r()*(1+f*1.5)):0) : (r()<f*0.3?1:0),
      dh:(r,g,k,H)=> k<top ? pickW(r,[[0.5,1],[1.0,0.4+f*0.6]]) : (H<=3?pickW(r,[[0,1],[0.5,0.3]]):pickW(r,[[-0.5,1],[-1.0,0.5+f*0.5],[0,0.4]])) });
    return lv&&finish(lv,r,{...SO('crater',f),ice:f>0.4?ri(r,0,2):0}); } },
  maze:{ name:'Labyrintti', make(f,r,pm){
    const cw = f<0.3 ? 3 : (f<0.65 ? 2 : pickW(r,[[2,1-f],[1,f]])), pitch=cw+1;
    const m = Math.max(4, Math.min(cw===3?6:cw===2?7:9, Math.round((cw===3?4:cw===2?4.5:5.5) + f*3 + r()*1.5)));
    const n = m*pitch-1, WH=3.5;
    // syvyyshaku: avoin solu jokaiselle (cx,cy); seinäruudut ruudukon viivoilla
    const open=new Set(), seen=new Set(['0,0']), st=[[0,0]];
    while(st.length){ const [cx,cy]=st[st.length-1]; const nb=[[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy])=>{ const x=cx+dx,y=cy+dy; return x>=0&&y>=0&&x<m&&y<m&&!seen.has(x+','+y); });
      if(!nb.length){ st.pop(); continue; } const [dx,dy]=nb[ri(r,0,nb.length-1)], x=cx+dx, y=cy+dy;
      open.add(`${Math.min(cx,x)},${Math.min(cy,y)},${dx?'h':'v'}`); seen.add(x+','+y); st.push([x,y]); }
    // silmukoita helpoissa: poistetaan muutama lisäseinä
    const extra=ALLOW.has('sw')?0:Math.round(m*m*(0.12*(1-f)));   // pulmalabyrintissa ei oikoteitä ovien ohi
    for(let q=0;q<extra;q++){ const cx=ri(r,0,m-2), cy=ri(r,0,m-2); open.add(`${cx},${cy},${r()<0.5?'h':'v'}`); }
    const wall=new Set();
    for(let cy=0;cy<m;cy++) for(let cx=0;cx<m;cx++){ const x0=1+cx*pitch, y0=1+cy*pitch;
      if(cx<m-1&&!open.has(`${cx},${cy},h`)) for(let j=y0-1;j<y0+cw+1;j++) if(j>=1&&j<=n) wall.add((x0+cw)+','+j);
      if(cy<m-1&&!open.has(`${cx},${cy},v`)) for(let i=x0-1;i<x0+cw+1;i++) if(i>=1&&i<=n) wall.add(i+','+(y0+cw));
      if(cx<m-1&&cy<m-1) wall.add((x0+cw)+','+(y0+cw)); }
    const blocks=[]; // rivit yhdistetään suorakaiteiksi
    for(let j=1;j<=n;j++){ let i=1; while(i<=n){ if(!wall.has(i+','+j)){ i++; continue; } let e=i; while(e+1<=n&&wall.has((e+1)+','+j)) e++; blocks.push([i,j,e-i+1,1,WH]); i=e+1; } }
    // maali kauimmaiseen soluun
    const dist={'0,0':0}, q=[[0,0]]; let far=[0,0];
    while(q.length){ const [cx,cy]=q.shift(); far=[cx,cy];
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const x=cx+dx,y=cy+dy; if(x<0||y<0||x>=m||y>=m||dist[x+','+y]!==undefined) continue;
        if(!open.has(`${Math.min(cx,x)},${Math.min(cy,y)},${dx?'h':'v'}`)) continue; dist[x+','+y]=dist[cx+','+cy]+1; q.push([x,y]); } }
    const gx=1+far[0]*pitch, gy=1+far[1]*pitch, gh= f<0.3?0.5:(f<0.6?1.0:pickW(r,[[1.0,1],[1.5,f]]));
    const lv={n,plats:[[gx,gy,cw,cw,gh]],tramp:[],blocks,ice:[],spawn:[1,1]};
    lv.pathLen=dist[far[0]+','+far[1]];
    mazePuzzle(lv,f,r,m,cw,pitch,open,far[1]*m+far[0]);
    if(f>0.35&&ALLOW.has('ice')){ const nI=Math.round(f*m*0.8); for(let k=0;k<nI;k++){ const cx=ri(r,1,m-1), cy=ri(r,0,m-1); if((cx===far[0]&&cy===far[1])||lv.items.has(cy*m+cx)) continue; lv.ice.push([1+cx*pitch,1+cy*pitch,cw,cw]); } }
    const so=SO('maze',f), pk=Object.keys(so.patch); lv.patches=[];
    if(pk.length){ const nP=Math.round(so.nPatch*m/6); for(let k=0;k<nP;k++){ const cx=ri(r,0,m-1), cy=ri(r,0,m-1); if((cx===far[0]&&cy===far[1])||(cx===0&&cy===0)) continue;
      lv.patches.push([1+cx*pitch,1+cy*pitch,cw,cw,+pickW(r,pk.map(x=>[x,so.patch[x]]))]); } }
    delete lv.items;
    return lv; } },
  ziggurat:{ name:'Zikkurat', make(f,r,pm){ const n=N(f,r), plats=[];
    const t0=f<0.3?3:pickW(r,[[3,1-f],[2,1],[1,f]]);
    let x0=ri(r,1,Math.max(1,Math.floor(n*0.25))), y0=ri(r,1,Math.max(1,Math.floor(n*0.25))), x1=n-ri(r,0,Math.floor(n*0.25)), y1=n-ri(r,0,Math.floor(n*0.25));
    if(r()<0.4){ if(r()<0.5) x0=1; else y0=1; }   // terassi seinää vasten
    x0+=1; y0+=1; x1-=1; y1-=1;   // lattiakaista reunoille
    let H=0.5;
    while(x1-x0>=1&&y1-y0>=1&&H<8){ const dh=pickW(r,[[0.5,1],[1.0,0.2+f*0.7]]); H+=dh;
      plats.push([x0,y0,x1-x0+1,y1-y0+1,H]);
      const t=Math.max(1,t0+pickW(r,[[0,1],[-1,f*0.6],[1,0.3*(1-f)]]));
      // terassin kaventuminen eri puolilta: epäsymmetrisyys tuo vaihtelua
      const sh=[0,0,0,0], ns=pickW(r,[[1,1],[2,1],[3,0.3*(1-f)]]); const sides=[0,1,2,3].sort(()=>r()-0.5).slice(0,ns); for(const sd of sides) sh[sd]=t;
      x0+=sh[0]; y0+=sh[1]; x1-=sh[2]; y1-=sh[3]; }
    if(plats.length<2) return null;
    const g=plats[plats.length-1]; if(g[2]*g[3]>9){ const cx=g[0]+Math.floor(g[2]/2)-1, cy=g[1]+Math.floor(g[3]/2)-1; plats.push([cx,cy,2,2,g[4]+0.5]); }
    const so=SO('ziggurat',f), sk=Object.keys(so.surf);
    if(sk.length) for(let i=0;i<plats.length-1;i++) if(r()<so.surfP) plats[i][5]=+pickW(r,sk.map(x=>[x,so.surf[x]]));
    const lv={n,plats,tramp:[],blocks:[],ice:[]};
    return finish(lv,r,{...so,spMin:2,spMax:3}); } },
};

function genOne(task){
  const {g,f,type,seed0}=task, A=T[type]; ALLOW=new Set(task.allow||[]);
  const intro=task.intro||[]; PINTRO=new Set(intro.filter(x=>x==='cr'||x==='sw'||x==='tp'||x==='ramp')); INTRO=intro.find(x=>typeof x==='number'||x==='boost'); if(INTRO===undefined) INTRO=null;
  const pmin = 0.15*Math.pow(1-f,1.5)+0.006;
  for(let a=0;a<80;a++){
    const r=rngOf(seed0*1000+a); const lv=A.make(f,r,pmin); if(!lv) continue;
    if(type!=='maze'&&!addPuzzle(lv,f,r,pmin,{zig:type==='ziggurat',sunkP:type==='bridges'?0.6:0.15})) continue;
    const ev=evaluate(lv, type==='maze'?0.002:pmin*0.6); if(!ev||ev.fail!==undefined) continue;
    const K=lv.plats.length;
    const bonus= type==='maze' ? (lv.pathLen||0)*0.8+1.5*(lv.nDoors||0) : 1.2*Math.max(0,(lv.sol||K)-K)+2*(lv.nBr||0)+0.5*lv.cr.length+3*lv.gates.length+1.5*lv.tp.length+0.3*(lv.ramps||[]).filter(q=>q[5]<0).length;
    lv.ps=ev.ps; lv.score=scoreOf(ev.ps)+bonus; lv.g=g; lv.type=type; lv.f=f; lv.w=task.w; lv.j=task.j; lv.room=!!task.room; lv.RC=RC; lv.RT=RT; return lv;
  }
  return {g,type,w:task.w,j:task.j,failed:true,RC,RT};
}
// Maailmat: jokainen teema kestää yhtäjaksoisesti. add = maailmassa käyttöön tulevat asiat, intro = maailman alussa esiteltävät,
// late = maailman jälkipuoliskolla käyttöön tulevat, nc = luotavat teemakentät, nr = luotavat pulmahuoneet (labyrinttirakenne teeman väreissä)
const WORLDS=[
  {type:'stairs',  gen:6,  add:[]},
  {type:'islands', gen:11, add:[12,'cr'], intro:[12,'cr'], late:['ramp'], nc:22},
  {type:'ziggurat',gen:11, add:[13,'ramp'], intro:[13], nc:22},
  {type:'maze',    gen:11, add:['sw'], intro:['sw'], late:['tp'], nc:28},
  {type:'ice',     gen:11, add:['ice',6,'tp'], intro:[6,'sw'], nc:18, nr:9},
  {type:'tramp',   gen:11, add:['tramp',7], intro:[7,'tp'], nc:18, nr:9},
  {type:'pillars', gen:11, add:[5], intro:[5], nc:18, nr:9},
  {type:'bridges', gen:11, add:['boost'], intro:['boost'], nc:18, nr:9},
  {type:'crater',  gen:11, add:[], nc:18, nr:9},
];
function schedule(){
  const tasks=[], allow=[]; let g=3000;
  const RANGE=[[0,0.14],[0.04,0.3],[0.1,0.38],[0.0,0.3],[0.2,0.55],[0.35,0.7],[0.5,0.82],[0.62,0.92],[0.75,1]];
  const NC=[14,16,16,22,16,16,16,16,16], NR=[0,0,0,0,6,6,6,6,6];
  WORLDS.forEach((w,wi)=>{ allow.push(...w.add); const [f0,f1]=RANGE[wi];
    const mk=(type,j,q,isIntro)=>{ const al=allow.slice(); if(w.late&&q>=0.45) al.push(...w.late);
      tasks.push({g, w:wi, j, f:f0+(f1-f0)*q, type, room:type!==w.type, seed0:86028121+15485863*g, allow:al, intro:isIntro?(w.intro||[]):(w.late&&q>=0.45&&q<0.75?w.late:[])}); g++; };
    for(let j=0;j<NC[wi];j++) mk(w.type,j,j/(NC[wi]-1),j<5);
    for(let j=0;j<NR[wi];j++) mk('maze',100+j,j/(NR[wi]-1),false);
  });
  return tasks;
}
module.exports={T,evaluate,genOne,schedule,cellsOfH,floorConnected,WORLDS,chainSolve,mazeSolve};
if(isMainThread && require.main===module){
  let tasks=schedule(); const out=[];
  if(process.env.EXTRA){ const ws=process.env.EXTRA.split(',').map(Number); const ex=[];   // lisäehdokkaita valituille maailmoille uusilla siemenillä
    for(const rep of [1,2]) for(const t of tasks) if(ws.includes(t.w)&&!t.room&&(rep===1||t.w>=6)) ex.push({...t,g:t.g+1000*rep,seed0:t.seed0+7919*rep,intro:[]});
    tasks=ex; } let next=0, done=0; const t0=Date.now();
  for(let w=0;w<2;w++){ const wk=new Worker(__filename);
    const feed=()=>{ if(next<tasks.length) wk.postMessage(tasks[next++]); else wk.terminate(); };
    wk.on('message',m=>{ out.push(m); done++; process.stderr.write(`${done}/${tasks.length} g=${m.g} ${m.type} ${m.failed?'EPÄONNISTUI':'score '+m.score.toFixed(1)+' k='+m.plats.length+' n='+m.n} ${((Date.now()-t0)/1000).toFixed(0)}s\n`); feed();
      if(done===tasks.length) require('fs').writeFileSync(process.argv[2]||'pool6.json',JSON.stringify(out)); });
    feed(); }
} else if(!isMainThread){ parentPort.on('message',t=>parentPort.postMessage(genOne(t))); }
