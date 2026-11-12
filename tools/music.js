// Spinbounce — Copyright (C) 2026 Heikki Heinonen
// SPDX-License-Identifier: GPL-3.0-or-later
// Game idea and game mechanics by Heikki Heinonen. Implementation built with Claude (Anthropic).
// ---------- Musiikki: Amiga-henkinen 4-kanavainen tracker ----------
// Kanavat kuten Paula-piirissä: 0 basso (vasen), 1 arpeggio (oikea), 2 melodia (oikea), 3 rummut (vasen).
// Näytteet ovat 8-bittisiä ja niiden sävelkorkeus muutetaan toistonopeudella, kuten modeissa.
const MUS=(()=>{
  let AC=null, musGain=null, timer=null, cur='', on=true, vol=0.55, active=null;
  const insts=[], SR=16726;
  const XF=2.4;   // ristihäivytyksen kesto sekunteina
  let SMP=null;
  const midiF=n=>440*Math.pow(2,(n-69)/12);
  function rng(seed){ let a=seed>>>0; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

  // ----- näytteet -----
  function mk(len,fn,loop){ const b=AC.createBuffer(1,len,SR), d=b.getChannelData(0); let ph=0;
    for(let i=0;i<len;i++){ let v=fn(i); v=Math.max(-1,Math.min(1,v)); d[i]=Math.round(v*127)/128; } return {buf:b,loop,base:loop?SR/len:0}; }
  function makeSamples(){
    const nz=()=>Math.random()*2-1;
    let kp=0, last=0;
    SMP={
      bass: mk(32,i=>0.55*(i<16?1:-1)+0.45*(1-2*i/32),true),
      pulse:mk(32,i=>i<8?0.65:-0.65,true),
      saw:  mk(32,i=>0.8*(1-2*i/32),true),
      tri:  mk(32,i=>0.9*(i<16?(-1+i/8):(3-i/8)),true),
      chord:mk(64,i=>0.45*(1-2*i/64)+0.3*(1-2*((i*2)%64)/64)+0.15*(i<32?1:-1),true),
      kick: mk(Math.round(SR*0.28),i=>{ const f=48+120*Math.exp(-i/(SR*0.025)); kp+=2*Math.PI*f/SR; return Math.sin(kp)*Math.exp(-i/(SR*0.09))*1.1; },false),
      snare:mk(Math.round(SR*0.2),i=>nz()*0.75*Math.exp(-i/(SR*0.055))+Math.sin(2*Math.PI*190*i/SR)*0.55*Math.exp(-i/(SR*0.03)),false),
      hat:  mk(Math.round(SR*0.06),i=>{ const n=nz(), v=n-last; last=n; return v*0.45*Math.exp(-i/(SR*0.012)); },false),
      ohat: mk(Math.round(SR*0.2),i=>{ const n=nz(), v=n-last; last=n; return v*0.35*Math.exp(-i/(SR*0.05)); },false),
    };
  }

  // ----- sävellys -----
  const Q={M:[0,4,7],m:[0,3,7],M7:[0,4,7,11],m7:[0,3,7,10],'7':[0,4,7,10],sus:[0,5,7]};
  const DR={
    four:  {k:'x...x...x...x...', s:'....x.......x...', h:'x.x.x.x.x.x.x.xo', f:'....x.......x.xx'},
    break: {k:'x.....x...x.....', s:'....x.......x..x', h:'xxxxxxxxxxxxxxxx', f:'....x..x.xx.xxxx'},
    half:  {k:'x.........x.....', s:'........x.......', h:'x.x.x.x.x.x.x.x.', f:'........x...x.xx'},
    sparse:{k:'x.......x.......', s:'................', h:'..x...x...x...xo', f:'............x.x.'},
  };
  const RHY=['x...x.x.x...x...','x.x...x...x.x...','x..x..x.x.......','x...x...x.x.x...','x.....x.x...x...','x..x..x...x.x...'];
  const SEC=['intro','A','A','B','C','A','B'];
  function norm(n,lo){ return lo+(((n-lo)%12)+12)%12; }
  function build(def){
    const r=rng(def.seed), bars=def.prog.length, chords=def.prog.map(([s,q])=>({root:def.root+s,tones:Q[q]}));
    const scalePC=def.scale.map(x=>(def.root+x)%12), scaleNotes=[]; for(let n=55;n<=91;n++) if(scalePC.includes(n%12)) scaleNotes.push(n);
    const nearestIdx=n=>{ let b=0; for(let i=0;i<scaleNotes.length;i++) if(Math.abs(scaleNotes[i]-n)<Math.abs(scaleNotes[b]-n)) b=i; return b; };
    const isCT=(n,c)=>c.tones.some(t=>((c.root+t-n)%12+12)%12===0);
    const snapCT=(idx,c)=>{ for(let d=0;d<=3;d++) for(const q of [idx+d,idx-d]) if(q>=0&&q<scaleNotes.length&&isCT(scaleNotes[q],c)) return q; return idx; };
    // melodiamotiivi: rytmi ja sävelaskeleet, toistetaan jokaisen soinnun päällä
    function motif(seedOff,hi){ const rr=rng(def.seed+seedOff), rh=RHY[Math.floor(rr()*RHY.length)], rh2=RHY[Math.floor(rr()*RHY.length)];
      const steps=[]; for(let i=0;i<32;i++) steps.push([[1,3],[-1,3],[2,2],[-2,2],[0,0.5],[3,0.6],[-3,0.6]].reduce((a,b)=>{ a.t+=b[1]; if(rr()*a.t<b[1]) a.v=b[0]; return a; },{t:0,v:1}).v);
      const out=[]; let idx=nearestIdx(hi?79:72);
      for(let b=0;b<bars;b++){ const c=chords[b], rhy=b%2?rh2:rh; let first=true;
        for(let i=0;i<16;i++){ if(rhy[i]!=='x') continue;
          if(first){ idx=snapCT(idx,c); first=false; }   // soinnun alussa lähin sointusävel
          else { idx+=steps[(b%2)*16+i]; idx=Math.max(nearestIdx(hi?70:62),Math.min(nearestIdx(hi?88:82),idx));
            if(i%8===0) idx=snapCT(idx,c); }
          let len=1; while(i+len<16&&rhy[i+len]!=='x') len++;
          if(b===bars-1&&i>=12){ // fraasin loppu: soinnun perussävel
            for(let d=0;d<=4;d++){ const hit=[idx+d,idx-d].find(q=>q>=0&&q<scaleNotes.length&&((scaleNotes[q]-c.root)%12+12)%12===0); if(hit!==undefined){ idx=hit; break; } } }
          const pv=out.length>1?out[out.length-1].n:null, pv2=out.length>1?out[out.length-2].n:null;
          if(pv===scaleNotes[idx]&&pv2===pv){ const q=idx+(rr()<0.5?1:-1); if(q>=0&&q<scaleNotes.length) idx=q; }
          out.push({r:b*16+i,n:scaleNotes[idx],len}); } }
      return out; }
    const explicit=lst=>{ if(!lst) return null; const o=[]; let t=0; for(const [n,l] of lst){ if(n) o.push({r:t,n,len:l}); t+=l; } return o; };
    const leadA=explicit(def.leadA)||motif(11,false), leadB=explicit(def.leadB)||motif(29,true);
    const L=SEC.length*bars*16, rows=[]; for(let i=0;i<L;i++) rows.push([]);
    const dr=DR[def.drums];
    SEC.forEach((sec,si)=>{ const o=si*bars*16;
      for(let b=0;b<bars;b++){ const c=chords[b], rb=o+b*16, bn=norm(c.root,28), last=b===bars-1;
        // basso
        const bs = sec==='C' ? 'sparse' : def.bass;
        const bp = {oct:[[0,0,2],[2,12,2],[4,0,2],[6,12,2],[8,0,2],[10,12,2],[12,0,2],[14,12,2]],
                    drive:[[0,0,2],[2,0,2],[4,0,2],[6,12,1],[8,0,2],[10,0,2],[12,7,2],[14,12,2]],
                    walk:[[0,0,4],[4,c.tones[1],4],[8,7,4],[12,12,4]],
                    sparse:[[0,0,10],[10,7,2],[12,0,4]]}[bs];
        for(const [i,iv,len] of bp) rows[rb+i].push({ch:0,s:'bass',n:bn+iv,len,v:0.55});
        // arpeggio-soinnut: trackerin 0xy-efekti
        const arp=[0,c.tones[1],c.tones[2]], an=norm(c.root,52);
        for(let i=0;i<16;i++) if(def.arpRhy[i]==='x'){ let len=1; while(i+len<16&&def.arpRhy[i+len]==='-') len++; rows[rb+i].push({ch:1,s:'chord',n:an,len,v:sec==='intro'?0.2:0.26,arp}); }
        // rummut
        if(sec!=='C'||true){ const k=dr.k, s=last&&sec!=='intro'?dr.f:dr.s, h=dr.h;
          for(let i=0;i<16;i++){
            if(sec==='C'){ if(h[i]!=='.') rows[rb+i].push({ch:3,s:h[i]==='o'?'ohat':'hat',v:0.16}); continue; }
            if(k[i]==='x') rows[rb+i].push({ch:3,s:'kick',v:0.7});
            else if(s[i]==='x'&&sec!=='intro') rows[rb+i].push({ch:3,s:'snare',v:0.5});
            else if(h[i]!=='.') rows[rb+i].push({ch:3,s:h[i]==='o'?'ohat':'hat',v:h[i]==='o'?0.18:0.15}); } }
      }
      // melodia
      const ld = sec==='A'?leadA : sec==='B'?leadB : null;
      if(ld) for(const e of ld) rows[o+e.r].push({ch:2,s:def.lead,n:e.n,len:e.len,v:0.3,vib:true});
    });
    return {rows,len:L,loop:bars*16,rowDur:60/(def.bpm*4)};
  }

  // ----- soitto -----
  // Jokainen kappale soi omana soittimenaan (omat kanavat, äänenvoimakkuus ja suodin), joten vanha voi
  // hiipua ja tummua samalla kun uusi nousee esiin: kappaleet limittyvät eivätkä katkea.
  function makeInst(name){
    const def=SONGS[name]||SONGS.title, g=AC.createGain(), f=AC.createBiquadFilter();
    f.type='lowpass'; f.frequency.value=4400; f.Q.value=0.6; g.connect(f); f.connect(musGain);
    const pans=[-0.6,0.6,0.6,-0.6].map(p=>{ const sp=AC.createStereoPanner?AC.createStereoPanner():AC.createGain(); if(sp.pan) sp.pan.value=p; sp.connect(g); return sp; });
    return {name, song:def._built||(def._built=build(def)), row:0, nextT:0, g, f, pans, chan:[null,null,null,null], stopAt:Infinity};
  }
  function play(e,t,rd,it){
    const sm=SMP[e.s]; if(!sm) return;
    const src=AC.createBufferSource(); src.buffer=sm.buf; src.loop=sm.loop;
    const g=AC.createGain(); src.connect(g); g.connect(it.pans[e.ch]);
    if(sm.loop){
      const rate=n=>midiF(n)/sm.base;
      src.playbackRate.setValueAtTime(rate(e.n),t);
      if(e.arp){ const tick=rd/6; for(let k=1;k<e.len*6;k++) src.playbackRate.setValueAtTime(rate(e.n+e.arp[k%3]),t+k*tick); }
      if(e.vib){ const lfo=AC.createOscillator(), lg=AC.createGain(); lfo.frequency.value=5.5; lg.gain.setValueAtTime(0,t); lg.gain.linearRampToValueAtTime(18,t+0.25);
        lfo.connect(lg); lg.connect(src.detune); lfo.start(t); lfo.stop(t+e.len*rd+0.1); }
      const end=t+e.len*rd;
      g.gain.setValueAtTime(e.v,t); g.gain.setTargetAtTime(e.v*(e.ch===2?0.75:0.5),t+0.01,e.ch===0?0.12:0.2);
      g.gain.setTargetAtTime(0,end-0.02,0.015);
      src.start(t); src.stop(end+0.1);
      const prev=it.chan[e.ch]; if(prev&&prev.end>t){ try{ prev.g.gain.cancelScheduledValues(t); prev.g.gain.setTargetAtTime(0,t,0.008); prev.src.stop(t+0.05); }catch(err){} }
      it.chan[e.ch]={src,g,end};
    } else { g.gain.value=e.v; src.start(t); }
  }
  function tick(){
    if(!AC) return;
    const now=AC.currentTime, ahead=now+0.25;
    for(let k=insts.length-1;k>=0;k--){ const it=insts[k];
      if(it.nextT<now-0.5){ const lag=Math.ceil((now+0.05-it.nextT)/it.song.rowDur); it.row=(it.row+lag)%it.song.len; it.nextT+=lag*it.song.rowDur; }   // tauon jälkeen jatketaan tahdissa
      while(it.nextT<ahead && it.nextT<it.stopAt){ for(const e of it.song.rows[it.row]) play(e,it.nextT,it.song.rowDur,it);
        it.nextT+=it.song.rowDur; it.row++; if(it.row>=it.song.len) it.row=it.song.loop; }
      if(now>it.stopAt+0.6){ try{ it.f.disconnect(); }catch(e){} insts.splice(k,1); } }
  }
  function init(ac){
    if(AC) return; AC=ac; makeSamples();
    musGain=AC.createGain(); musGain.gain.value=on?vol:0;
    musGain.connect(AC.destination);
    timer=setInterval(tick,40);
    if(cur){ const c=cur; cur=''; start(c); }
  }
  function start(name){
    if(name===cur) return; cur=name; if(!AC) return;
    const now=AC.currentTime, old=active;
    // vaihto alkaa vanhan kappaleen seuraavalta iskulta, jotta rytmi ei nyrjähdä
    let t0=now+0.12;
    if(old){ const rd=old.song.rowDur, toBeat=(4-old.row%4)%4; t0=Math.max(now+0.08, old.nextT+toBeat*rd); if(t0-now>0.9) t0=now+0.12;
      old.g.gain.cancelScheduledValues(now); old.g.gain.setValueAtTime(old.g.gain.value,now); old.g.gain.setValueAtTime(old.g.gain.value,t0); old.g.gain.linearRampToValueAtTime(0,t0+XF);
      old.f.frequency.cancelScheduledValues(now); old.f.frequency.setValueAtTime(old.f.frequency.value,t0); old.f.frequency.exponentialRampToValueAtTime(450,t0+XF);
      old.stopAt=t0+XF; }
    // nopeissa vaihdoissa (testitila) vanhimmat hiljennetään heti
    for(const it of insts) if(it!==old && it.stopAt>now+0.3){ it.g.gain.cancelScheduledValues(now); it.g.gain.setTargetAtTime(0,now,0.08); it.stopAt=now+0.3; }
    const it=makeInst(name); it.nextT=t0;
    it.g.gain.setValueAtTime(0,now); it.g.gain.setValueAtTime(0,t0); it.g.gain.linearRampToValueAtTime(1,t0+XF*0.8);
    it.f.frequency.setValueAtTime(700,t0); it.f.frequency.exponentialRampToValueAtTime(4400,t0+XF);
    insts.push(it); active=it;
  }
  return {
    init, play:start,
    set(o){ if('on' in o) on=o.on; if('vol' in o) vol=o.vol; if(musGain) musGain.gain.setTargetAtTime(on?vol:0,AC.currentTime,0.05); },
    duck(sec){ if(!musGain||!on) return; const t=AC.currentTime; musGain.gain.cancelScheduledValues(t); musGain.gain.setTargetAtTime(vol*0.25,t,0.05); musGain.gain.setTargetAtTime(vol,t+sec,0.4); },
    get on(){ return on; }, get vol(){ return vol; }, get cur(){ return cur; }, get n(){ return insts.length; }, _build:build,
  };
})();

// ---------- Kappaleet ----------
// root = sävellajin perussävel (MIDI), prog = soinnut [puolisävelaskel, laatu], scale = asteikko
const MAJ=[0,2,4,5,7,9,11], MIN=[0,2,3,5,7,8,10], DOR=[0,2,3,5,7,9,10], MIX=[0,2,4,5,7,9,10], HMIN=[0,2,3,5,7,8,11], PHD=[0,1,4,5,7,8,10];
const SONGS={
  // tunnusmusiikki: melodia sävelletty käsin (A-molli, Am–F–C–G)
  title:{root:45,bpm:125,seed:7,scale:MIN,prog:[[0,'m'],[-4,'M'],[3,'M'],[-2,'M']],drums:'four',bass:'oct',arpRhy:'x--x--x-x--x-x--',lead:'pulse',
    leadA:[[76,4],[81,2],[79,2],[76,4],[74,2],[76,2], [72,4],[74,2],[76,2],[77,4],[76,2],[74,2], [76,6],[79,2],[72,4],[74,2],[76,2], [74,4],[71,2],[67,2],[71,4],[74,4]],
    leadB:[[81,4],[79,2],[76,2],[81,4],[83,2],[84,2], [84,4],[81,4],[77,4],[81,4], [79,4],[76,2],[79,2],[84,4],[83,2],[81,2], [79,4],[83,4],[86,4],[83,4]]},
  stairs:  {root:38,bpm:128,seed:101,scale:DOR, prog:[[0,'m'],[-2,'M'],[-4,'M'],[-2,'M']],drums:'four',bass:'oct',arpRhy:'x--x--x-x--x-x--',lead:'pulse'},
  islands: {root:40,bpm:108,seed:202,scale:MIX, prog:[[0,'M'],[-2,'M'],[5,'M'],[0,'M']],drums:'half',bass:'walk',arpRhy:'x-.x-.x.x-.x-.x.',lead:'tri'},
  maze:    {root:37,bpm:118,seed:303,scale:HMIN,prog:[[0,'m'],[-4,'M'],[5,'m'],[7,'7']],drums:'break',bass:'drive',arpRhy:'x-x-x-x-x-x-x-x-',lead:'saw'},
  ziggurat:{root:40,bpm:100,seed:404,scale:PHD, prog:[[0,'M'],[1,'M'],[0,'M'],[-2,'m']],drums:'half',bass:'sparse',arpRhy:'x---x---x-x-x---',lead:'pulse'},
  pillars: {root:42,bpm:96, seed:505,scale:DOR, prog:[[0,'m7'],[5,'M'],[0,'m7'],[3,'M']],drums:'sparse',bass:'sparse',arpRhy:'x-------x-------',lead:'tri'},
  tramp:   {root:43,bpm:140,seed:606,scale:MAJ, prog:[[0,'M'],[-3,'m'],[5,'M'],[7,'M']],drums:'four',bass:'oct',arpRhy:'x-x.x-x.x-x.x-x.',lead:'pulse'},
  ice:     {root:35,bpm:88, seed:707,scale:MIN, prog:[[0,'m7'],[-4,'M7'],[5,'m7'],[7,'7']],drums:'sparse',bass:'sparse',arpRhy:'x-----x-----x---',lead:'tri'},
  bridges: {root:45,bpm:134,seed:808,scale:MIN, prog:[[0,'m'],[-2,'M'],[-4,'M'],[-5,'M']],drums:'break',bass:'drive',arpRhy:'x--x--x-x--x-x--',lead:'saw'},
  crater:  {root:38,bpm:112,seed:909,scale:HMIN,prog:[[0,'m'],[-4,'M'],[5,'m'],[7,'M']],drums:'break',bass:'oct',arpRhy:'x-.x-.x-x-.x-.x-',lead:'pulse'},
};
