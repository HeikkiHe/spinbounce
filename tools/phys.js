// Spinbounce — Copyright (C) 2026 Heikki Heinonen
// SPDX-License-Identifier: GPL-3.0-or-later
// Game idea and game mechanics by Heikki Heinonen. Implementation built with Claude (Anthropic).
// ---------- Fysiikka (yhteinen pelille ja kenttägeneraattorille) ----------
const G=20, R=0.3, I=0.4*R*R, SPIN_ACC=75, MU=1.2, WMAX=18, BH=1.7, V0=Math.sqrt(2*G*BH), SQH=Math.SQRT1_2, DT=1/240;
// tyypit: 0 tavallinen, 1 trampoliini, 2 jää, 3 maali, 4 muuri, 5 tarra, 6 puolijää, 7 vaimennin,
//         8–11 kiihdytin (+x, +y, −x, −y), 12 hiekka, 13 lumi
const S_MU  =[1.2,1.2,0.03,1.2,1.2,4.0,0.07,1.2,1.2,1.2,1.2,1.2,1.6,0.7];   // kitka
const S_BNC =[1,  1.5,1,   1,  1,  1,  1,   0.7,1,  1,  1,  1,  0.84,0.8];  // pompun nopeuskerroin
const S_DAMP=[0,  0,  0,   0,  0,  0.8,0,   0.1,0,  0,  0,  0,  0.45,0.18]; // vaakanopeuden ja pyörimisen menetys osumassa
const NB=[[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
const BOOST=4.6, BDIR=[[1,0],[0,1],[-1,0],[0,-1]];
// L = { W, H, h: korkeudet, t: tyypit }   s = pallon tila
function newState(x,y,z,vz){ return {px:x,py:y,pz:z,vx:0,vy:0,vz:vz,wx:0,wy:0,wz:0,hit:-1,side:0}; }
function stepS(s,ux,uy,L){
  const dt=DT;
  // kallistus = tavoitepyöriminen; näytön suunnat käännetään 45° kentän suuntiin
  const dx=(ux+uy)*SQH, dy=(uy-ux)*SQH;
  let ex=-dy*WMAX-s.wx, ey=dx*WMAX-s.wy; const el=Math.hypot(ex,ey), md=SPIN_ACC*dt;
  if(el>md){ ex*=md/el; ey*=md/el; } s.wx+=ex; s.wy+=ey; s.wz*=1-2*dt;
  s.vz-=G*dt; s.px+=s.vx*dt; s.py+=s.vy*dt; s.pz+=s.vz*dt;
  const ci=Math.floor(s.px), cj=Math.floor(s.py), W=L.W;
  // pallon alla oleva ruutu käsitellään ensin: silloin naapuriruutujen saumat eivät anna vinoja potkuja
  for(let o=0;o<9;o++){ const i=ci+NB[o][0], j=cj+NB[o][1]; if(j<0||j>=L.H||i<0||i>=W) continue;
    { const idx=j*W+i, gx=L.gx[idx], gy=L.gy[idx], sl=gx!==0||gy!==0; let h=L.h[idx];
      const qx=s.px<i?i:(s.px>i+1?i+1:s.px), qy=s.py<j?j:(s.py>j+1?j+1:s.py);
      let nx,ny,nz,d;
      if(sl&&qx===s.px&&qy===s.py){   // viisto ruutu pallon alla: kosketus kaltevaan tasoon
        const il=1/Math.sqrt(gx*gx+gy*gy+1); nx=-gx*il; ny=-gy*il; nz=il;
        d=(s.pz-(h+gx*(s.px-i-0.5)+gy*(s.py-j-0.5)))*il; if(d>=R) continue;
      } else {
        if(sl) h+=gx*(qx-i-0.5)+gy*(qy-j-0.5);   // viiston ruudun reuna: korkeus reunan kohdalla
        const qz=s.pz<h?s.pz:h; nx=s.px-qx; ny=s.py-qy; nz=s.pz-qz; d=Math.sqrt(nx*nx+ny*ny+nz*nz);
        if(d>=R) continue;
        if(d>1e-6){ nx/=d; ny/=d; nz/=d; } else { nx=0; ny=0; nz=1; d=0; }
      }
      s.px+=nx*(R-d); s.py+=ny*(R-d); s.pz+=nz*(R-d);
      const vn=s.vx*nx+s.vy*ny+s.vz*nz; if(vn>=0) continue;
      const ty=L.t[idx]; let jn;
      if(nz>0.7){ jn=S_BNC[ty]*V0-vn; s.hit=idx;   // pinta: pomppu aina samaan korkeuteen (pinnan mukaan)
        const dm=S_DAMP[ty]; if(dm>0){ s.vx*=1-dm; s.vy*=1-dm; s.wx*=1-dm*0.4; s.wy*=1-dm*0.4; } }   // pehmeä pinta syö tulovauhdin
      else { jn=-1.6*vn; if(-vn>s.side) s.side=-vn; }      // portaan kylki tai muuri
      s.vx+=nx*jn; s.vy+=ny*jn; s.vz+=nz*jn;
      // kitka kytkee pyörimisen ja liikkeen: r = -n·R, kosketuspisteen nopeus v + w×r
      const rx=-nx*R, ry=-ny*R, rz=-nz*R;
      const cx=s.vx+(s.wy*rz-s.wz*ry), cy=s.vy+(s.wz*rx-s.wx*rz), cz=s.vz+(s.wx*ry-s.wy*rx);
      const cn=cx*nx+cy*ny+cz*nz, tx=cx-nx*cn, tyy=cy-ny*cn, tz=cz-nz*cn, tl=Math.sqrt(tx*tx+tyy*tyy+tz*tz);
      if(tl>1e-6){ const lim=S_MU[ty]*jn, jt=Math.min(tl/(1+R*R/I),lim), k=-jt/tl, Jx=tx*k, Jy=tyy*k, Jz=tz*k;
        s.vx+=Jx; s.vy+=Jy; s.vz+=Jz;
        s.wx+=(ry*Jz-rz*Jy)/I; s.wy+=(rz*Jx-rx*Jz)/I; s.wz+=(rx*Jy-ry*Jx)/I; }
      if(nz>0.7){
        if(ty>=8&&ty<=11){ const b=BDIR[ty-8], c=s.vx*b[0]+s.vy*b[1]; if(c<BOOST){ s.vx+=b[0]*(BOOST-c); s.vy+=b[1]*(BOOST-c); } } }
    } }
}
// kenttädatasta ruudukko: reunamuuri ympärille
function buildGrid(lv){
  const N=lv.n, W=N+2, H=N+2, h=new Float32Array(W*H), t=new Uint8Array(W*H), gx=new Float32Array(W*H), gy=new Float32Array(W*H);
  for(let j=0;j<H;j++) for(let i=0;i<W;i++){ const k=j*W+i;
    if(i===0||j===0||i===W-1||j===H-1){ h[k]=9.5; t[k]=4; } else { h[k]=0.5; t[k]=0; } }
  for(const r of (lv.ice||[])) for(let j=r[1];j<r[1]+r[3];j++) for(let i=r[0];i<r[0]+r[2];i++) t[j*W+i]=2;
  for(const r of (lv.patches||[])) for(let j=r[1];j<r[1]+r[3];j++) for(let i=r[0];i<r[0]+r[2];i++) t[j*W+i]=r[4];
  for(const b of (lv.blocks||[])) for(let j=b[1];j<b[1]+b[3];j++) for(let i=b[0];i<b[0]+b[2];i++){ h[j*W+i]=b[4]; t[j*W+i]=0; }
  lv.plats.forEach((p,pi)=>{ for(let j=p[1];j<p[1]+p[3];j++) for(let i=p[0];i<p[0]+p[2];i++){ const k=j*W+i; h[k]=p[4]; t[k]= pi===lv.plats.length-1?3:(p[5]||0); } });
  for(const c of (lv.tramp||[])){ t[c[1]*W+c[0]]=1; }
  for(const c of (lv.boost||[])){ t[c[1]*W+c[0]]=8+c[2]; }
  // viistot ruudut: [x, y, ylämäen suunta 0–3 (+x,+y,−x,−y), alareunan korkeus, nousu]
  for(const q of (lv.ramps||[])){ const k=q[1]*W+q[0], dv=BDIR[q[2]]; h[k]=q[3]+q[4]/2; gx[k]=dv[0]*q[4]; gy[k]=dv[1]*q[4]; if(t[k]===3) t[k]=0; }
  for(const g of (lv.gates||[])) for(let j=g[1];j<g[1]+g[3];j++) for(let i=g[0];i<g[0]+g[2];i++){ h[j*W+i]=g[4]; if(t[j*W+i]===3) t[j*W+i]=0; }   // portit alkukorkeudessaan
  return {W,H,h,t,gx,gy};
}
if(typeof module!=='undefined') module.exports={G,R,I,SPIN_ACC,MU,WMAX,BH,V0,SQH,DT,S_MU,S_BNC,S_DAMP,newState,stepS,buildGrid};
