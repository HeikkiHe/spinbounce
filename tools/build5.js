// Spinbounce — Copyright (C) 2026 Heikki Heinonen
// SPDX-License-Identifier: GPL-3.0-or-later
// Game idea and game mechanics by Heikki Heinonen. Implementation built with Claude (Anthropic).
// Kokoaa pelin: opetuskentät + vaihtelevat kenttätyypit + teemat, nimet ja vihjeet
const fs=require('fs');
const {evaluate,T,WORLDS}=require('./gen2.js');
const {scoreOf}=require('./gen.js');
const W=3.5;
const TUT=[
 {th:'stairs', name:'Ensimmäinen pomppu', n:12, spawn:[4,8], plats:[[8,3,2,2,0.5]],
  hint:'Kallista puhelinta (tai osoita hiirellä) maalin suuntaan. Pallo lähtee liikkeelle, kun se osuu maahan.'},
 {th:'stairs', name:'Mutka', n:12, spawn:[2,11], blocks:[[1,1,8,8,W]], plats:[[10,2,2,2,0.5]],
  hint:'Pallo jatkaa vauhdissa. Kallista vastakkaiseen suuntaan, niin se jarruttaa – ja kääntyy mutkassa.'},
 {th:'stairs', name:'Porras', n:12, spawn:[3,10], plats:[[6,3,4,4,1.0]],
  hint:'Matala porras: pallo nousee sen päälle, kun pomppu ylittää reunan.'},
 {th:'stairs', name:'Terassit', n:12, spawn:[2,11], plats:[[4,4,6,6,1.0],[6,6,2,2,1.5]],
  hint:'Valkoinen rengas näyttää, mihin pallo osuu seuraavaksi.'},
 {th:'stairs', name:'Korkea porras', n:12, spawn:[2,10], plats:[[3,4,4,4,1.5],[7,4,3,3,2.0]],
  hint:'Korkeampi porras: pallon pitää ylittää reuna juuri lakipisteessä.'},
 {th:'stairs', name:'Rako', n:12, spawn:[3,10], plats:[[2,4,3,3,1.0],[6,4,3,3,1.0],[10,4,2,3,1.5]],
  hint:'Rako tasojen välissä: ota vauhtia. Jos putoat, kiipeät uudelleen.'},
];
const TYPE_HINT={ // maailman ensimmäisen kentän ohje

  islands:'Asteroidivyö: hypi saarelta toiselle. Putoaminen ei vie pitkälle.',
  maze:'Labyrintti: etsi reitti maaliin – seinien yli ei pääse.',
  ziggurat:'Zikkurat: nouse terassi kerrallaan huipulle.',
  pillars:'Pilarimetsä: kapeita pylväitä – jarruta ennen jokaista laskeutumista.',
  tramp:'Hyppyasema: sykkivä violetti trampoliini heittää pallon tavallista korkeammalle.',
  ice:'Jääkomeetta: lattia on lähes kitkaton. Ota vauhti ennen jäätä ja tähtää huolella.',
  bridges:'Valosillat: kapeita siltoja korkealla – pidä pallo keskellä.',
  crater:'Kraatteri: ensin ylös, sitten hallitusti alas maaliin.',
};
const FEAT_HINT={
  tramp:'Uutta: sykkivä violetti trampoliini heittää pallon tavallista korkeammalle.',
  ice:'Uutta: jäällä pyöriminen ei pure – pallo liukuu samalla vauhdilla.',
  pillar:'Uutta: kapea pilari. Jarruta ajoissa, ettei pallo pomppaa yli.',
  ramp:'Uutta: viisto pinta heittää pallon alamäen suuntaan. Sillä pääsee pitkän raon yli – tai lentää ohi.',
  cr:'Uutta: kerää kaikki kiteet – maaliportti aukeaa vasta sitten.',
  sw:'Uutta: kytkin liikuttaa samanvärisiä portteja. Pomppaa sen päälle. Uusi painallus vaatii, että käyt välillä muualla.',
  tp:'Uutta: teleportti siirtää pallon parinsa luo. Vauhti säilyy, joten tule sille rauhassa.',
  room:'Pulmahuone: selvitä, missä järjestyksessä kytkimet, kiteet ja teleportit kannattaa käydä läpi.',
  sand:'Uutta: hiekka pölähtää ja jarruttaa – pomppu jää matalammaksi.',
  snow:'Uutta: lumi on pehmeää: pomppu madaltuu, vauhti hidastuu ja pallo jättää jäljet.',
  sticky:'Uutta: keltainen tarrapinta pysäyttää pallon heti. Hyvä paikka tasapainottaa.',
  halfice:'Uutta: puolijää – pyöriminen tarttuu hitaasti, usean pompun aikana.',
  damper:'Uutta: violetti vaimennin madaltaa pomppua. Sen päältä ei pääse kovin korkealle.',
  boost:'Uutta: vihreä kiihdytin heittää pallon nuolen suuntaan – pitkä loikka!',
};
const tut=[];
for(const t of TUT){ const lv=Object.assign({tramp:[],ice:[],blocks:[]},t); const ev=evaluate(lv,0.02);
  if(!ev||ev.fail!==undefined){ console.error('opetuskenttä ei kelpaa',t.name,ev); process.exit(1); }
  lv.ps=ev.ps; lv.score=scoreOf(ev.ps); lv.type=t.th; tut.push(lv); }
// ehdokkaat ja niiden botilla mitattu vaikeus: vain läpäistyt, joissa reitti ei ohita tasoja
const BOT=JSON.parse(fs.readFileSync('pool7_bot.json','utf8'));
const all=JSON.parse(fs.readFileSync(process.argv[2]||'pool7.json','utf8')).filter(l=>!l.failed&&BOT[l.g]&&BOT[l.g].ok&&(BOT[l.g].maxSkip||0)<=1)
  .map(l=>Object.assign(l,{score:(l.type==='maze'?0.6:1)*BOT[l.g].moves+0.25*Math.log2(1+BOT[l.g].sims/Math.max(1,BOT[l.g].moves)), botPlan:BOT[l.g].plan}));   // labyrintin lyhyet käytäväsiirrot ovat helpompia
// tavoitevaikeus kasvaa tasaisesti (geometrisesti) kentästä 7 kenttään 100; uuden maailman kaksi ensimmäistä kenttää ovat hieman kevyempiä
// tavoitevaikeus maailmoittain (botin siirrot + tarkkuuslisä): jokainen maailma alkaa hieman edellisen lopun alta ja nousee tasaisesti
const WT=[[2,4],[3.5,8],[6,10.5],[8.5,12.5],[10.5,14.5],[13,18],[16,22],[20,26],[24,36]];
let curW=0, curJ=0, curN=1; const target=()=>{ const [a,b]=WT[curW]; return a*Math.pow(b/a,curN>1?curJ/(curN-1):0); };
let gi=TUT.length;
const failed=all.filter(l=>l.failed); if(failed.length) console.error('epäonnistuneita:',failed.map(l=>l.w+'/'+l.j+':'+l.type).join(' '));
const out=[], seenF={pillar:1}, summary=[];
WORLDS.forEach((w,wi)=>{
  // maailman kentät: ensin luontijärjestyksessä (varakentät viimeisinä), sitten mitatun vaikeuden mukaan
  const C=all.filter(l=>!l.failed&&l.w===wi&&!l.room).sort((a,b)=>a.score-b.score), RM=all.filter(l=>!l.failed&&l.w===wi&&l.room).sort((a,b)=>a.score-b.score);
  // pulmahuoneet (labyrinttirakenne maailman väreissä) kiinteille paikoille 4., 7. ja 10. kentäksi
  const roomAt=RM.length>=3?[3,6,9]:[], nGen=w.gen-roomAt.length;
  if(C.length<nGen){ console.error('maailmasta puuttuu kenttiä',w.type,C.length); process.exit(1); }
  const tgAll=[]; curW=wi; curN=w.gen; for(let j=0;j<w.gen;j++){ curJ=j; tgAll.push(target()*(wi>0&&j===0?0.85:1)); gi++; }
  const tg=tgAll.filter((t,j)=>!roomAt.includes(j));
  // valitaan ehdokkaista nouseva sarja, joka osuu lähimmäksi tavoitteita (dynaaminen ohjelmointi)
  const dp=[], bk=[]; for(let k=0;k<nGen;k++){ dp.push([]); bk.push([]);
    for(let c=0;c<C.length;c++){ const cost=Math.abs(Math.log(C[c].score/tg[k])); let best=k===0?0:Infinity, bi=-1;
      if(k>0) for(let q=0;q<c;q++) if(dp[k-1][q]<best){ best=dp[k-1][q]; bi=q; }
      dp[k][c]=best+cost; bk[k][c]=bi; } }
  let c=0; for(let q=0;q<C.length;q++) if(dp[nGen-1][q]<dp[nGen-1][c]) c=q;
  const chain=[]; for(let k=nGen-1;k>=0;k--){ chain.unshift(C[c]); c=bk[k][c]; }
  const usedR=new Set(), rooms=roomAt.map(j=>{ let b=null; for(const c of RM) if(!usedR.has(c)&&(!b||Math.abs(Math.log(c.score/tgAll[j]))<Math.abs(Math.log(b.score/tgAll[j])))) b=c; usedR.add(b); return b; });
  const gen=[]; for(let j=0,a=0,b2=0;j<w.gen;j++) gen.push(roomAt.includes(j)?rooms[b2++]:chain[a++]);
  const list=(wi===0?tut:[]).concat(gen), m=list.length;
  summary.push(`${wi+1} ${T[w.type].name.padEnd(13)} kenttiä ${m}  vaikeus ${list.map(l=>(l.room?'h':'')+(+l.score).toFixed(0)).join(' ')}`);
  list.forEach((l,j)=>{
    l.th=w.type; l.name=`${T[w.type].name} ${j+1}/${m}`;
    if(j===0&&wi>0){ l.hint=TYPE_HINT[w.type]; if(w.type==='tramp') seenF.tramp=1; if(w.type==='ice') seenF.ice=1; }
    const sf=new Set(l.plats.slice(0,-1).map(p=>p[5]||0).concat((l.patches||[]).map(p=>p[4])));
    const f={ramp:(l.ramps||[]).length>0, cr:(l.cr||[]).length>0, sw:(l.sw||[]).length>0, tp:(l.tp||[]).length>0, room:!!l.room, tramp:(l.tramp||[]).length>0, ice:(l.ice||[]).length>0, pillar:wi>0&&l.plats.slice(0,-1).some(p=>p[2]===1&&p[3]===1),
      sand:sf.has(12), snow:sf.has(13), sticky:sf.has(5), halfice:sf.has(6), damper:sf.has(7), boost:(l.boost||[]).length>0};
    if(!l.hint){ for(const k of ['cr','sw','tp','room','ramp','sand','snow','sticky','halfice','damper','boost','tramp','ice','pillar']) if(f[k]&&!seenF[k]){ seenF[k]=1; l.hint=FEAT_HINT[k]; break; } }
    else if(wi>0) for(const k of ['cr','sw','tp','ramp','sand','snow','sticky','halfice','damper','boost']) if(f[k]&&!seenF[k]){ seenF[k]=1; l.hint+=' '+FEAT_HINT[k]; break; }
    out.push(l); });
});
console.log(summary.join('\n'));
fs.writeFileSync('order2.txt', out.map((l,i)=>`${i+1}\t${l.type}\t${l.name}\tn=${l.n}\tk=${l.plats.length}\tscore=${(+l.score).toFixed(1)}${l.hint?'\t['+l.hint.slice(0,28)+']':''}`).join('\n'));
// nimet ja ohjeet kieliriippumattomiksi: kentän numero maailmassa ja ohjeavaimet (tekstit ovat pelin kielitiedostossa)
const HK=[]; TUT.forEach((t,i)=>HK.push(['tut'+i,t.hint])); for(const k in TYPE_HINT) HK.push(['type_'+k,TYPE_HINT[k]]); for(const k in FEAT_HINT) HK.push(['feat_'+k,FEAT_HINT[k]]);
const hintKeys=h=>{ if(!h) return null; const f=[]; let rest=h; for(const [k,t] of HK){ const p=h.indexOf(t); if(p>=0&&!(k.startsWith('feat_')&&HK.some(([k2,t2])=>k2.startsWith('type_')&&t2.endsWith(t.replace('Uutta: ',''))&&h.indexOf(t2)===p-0))) f.push([p,k]); }
  f.sort((a,b)=>a[0]-b[0]); const keys=[]; let cov=0; for(const [p,k] of f){ if(p<cov) continue; keys.push(k); cov=p+HK.find(x=>x[0]===k)[1].length; } return keys; };
const data=JSON.stringify(out.map(l=>{ const mm=l.name.match(/ (\d+)\/(\d+)$/); const o={n:l.n,spawn:l.spawn,plats:l.plats,th:l.th,nm:[+mm[1],+mm[2]]};
  for(const k of ['cr','sw','gates','tp']) if(l[k]&&l[k].length) o[k]=k==='cr'?l[k].map(c=>c.map(v=>+v.toFixed(2))):l[k];
  if(l.type==='maze') o.fw=1;
  if(l.ramps&&l.ramps.length) o.ramps=l.ramps.map(q=>q.slice(0,5));   // täysi tarkkuus: ratkaisujen toisto vaatii täsmälleen samat korkeudet
  if(l.tramp&&l.tramp.length) o.tramp=l.tramp; if(l.patches&&l.patches.length) o.patches=l.patches; if(l.boost&&l.boost.length) o.boost=l.boost; if(l.ice&&l.ice.length) o.ice=l.ice; if(l.blocks&&l.blocks.length) o.blocks=l.blocks; if(l.hint){ o.hk=hintKeys(l.hint); const back=o.hk.map(k=>HK.find(x=>x[0]===k)[1]).join(' '); if(back!==l.hint) console.error('ohjeen avainnus ei täsmää:',l.hint,'→',o.hk); } return o; }));
const phys=fs.readFileSync('phys.js','utf8').replace(/\nif\(typeof module[^\n]*\n?/,'\n');
const music=fs.readFileSync('music.js','utf8');
// botin ratkaisut (playthrough.json) siirtoindekseinä; puuttuvat tyhjinä
const PT=fs.existsSync('playthrough.json')?JSON.parse(fs.readFileSync('playthrough.json','utf8')):{};
const MV=[[0.35,1],[0.6,1],[1,1],[1,2],[1,3],[1,5]];
const demos=JSON.stringify(out.map((l,i)=>{ const plan=l.botPlan||(i<6&&PT[i+1]&&PT[i+1].r.ok?PT[i+1].r.plan:null); if(!plan) return null; return plan.map(([th,m,nb])=>Math.round(th/(Math.PI/8))*6+MV.findIndex(q=>q[0]===m&&q[1]===nb)); }));
const html=fs.readFileSync('template.html','utf8').replace('/*PHYS*/',()=>phys).replace('/*I18N*/',()=>fs.readFileSync('i18n.js','utf8')).replace('/*MUSIC*/',()=>music).replace('/*LEVELS*/',()=>data).replace('/*DEMOS*/',()=>demos);
fs.writeFileSync(process.argv[3]||'../pomppupallo-100.html',html);
console.log('kenttiä',out.length,'koko',html.length);
