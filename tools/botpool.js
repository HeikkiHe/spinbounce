// Spinbounce — Copyright (C) 2026 Heikki Heinonen
// SPDX-License-Identifier: GPL-3.0-or-later
// Game idea and game mechanics by Heikki Heinonen. Implementation built with Claude (Anthropic).
// Pelaa kaikki ehdokaskentät botilla ja tallentaa tuloksen (läpäisy, siirrot, oikotiet, ratkaisu) kentän g-tunnisteella.
const fs=require('fs'); const {Worker,isMainThread,parentPort,workerData}=require('worker_threads');
if(isMainThread){
  const pool=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).filter(l=>!l.failed), outF=process.argv[3];
  const out=fs.existsSync(outF)?JSON.parse(fs.readFileSync(outF,'utf8')):{}; const todo=pool.filter(l=>!out[l.g]);
  let next=0, done=0; const t0=Date.now();
  if(!todo.length){ console.log('kaikki jo pelattu'); process.exit(0); }
  for(let w=0;w<2;w++){ const wk=new Worker(__filename,{workerData:{}});
    const feed=()=>{ if(next<todo.length) wk.postMessage(todo[next++]); else wk.terminate(); };
    wk.on('message',m=>{ out[m.g]=m.r; done++; const r=m.r;
      process.stderr.write(`${done}/${todo.length} g=${m.g} w${m.w} ${r.ok?'LÄPI':'EI'} siirtoja ${r.moves} ohitus ${r.maxSkip} [${((Date.now()-t0)/1000).toFixed(0)} s]\n`);
      if(done%10===0||done===todo.length) fs.writeFileSync(outF,JSON.stringify(out)); feed(); });
    feed(); }
} else {
  const {solve}=require('./bot.js');
  parentPort.on('message',lv=>{ const L={...lv}; if(L.ramps) L.ramps=L.ramps.map(q=>q.slice(0,5)); if(L.type==='maze') L.fw=1;
    let r; try{ r=solve(L,{maxExp:5000}); }catch(e){ r={ok:false,moves:0,err:String(e)}; }
    delete r.exps; parentPort.postMessage({g:lv.g,w:lv.w,r}); });
}
