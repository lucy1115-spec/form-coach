// 识别引擎：关节点 -> 角度 -> 计次 -> 和教练标准对比。不碰 DOM，浏览器和 Node 都能用。
// 来源：reference/form-mirror.html 的 <script id="engine">（2026-10-26）。
// 改动：RepCounter 要先见到起始位才计次；analyzeReference 支持预设指定起始位方向（spec.rest）。

const SIDES={L:{S:11,E:13,W:15,H:23,K:25,A:27},R:{S:12,E:14,W:16,H:24,K:26,A:28}};
const JOINT_ZH={S:'肩',E:'手肘',W:'手腕',H:'髋',K:'膝盖',A:'脚踝'};
const CHAIN={knee:['H','K','A'],hip:['S','H','K'],elbow:['S','E','W'],shoulder:['H','S','E']};
const METRICS={
  knee:{zh:'膝角',tol:10},kneeMin:{zh:'膝角（较弯的腿）',tol:10},hip:{zh:'髋角',tol:10},
  elbow:{zh:'肘角',tol:12},shoulder:{zh:'肩角',tol:12},trunk:{zh:'躯干倾斜',tol:10},
  kneeSpread:{zh:'膝间距（×髋宽）',tol:0.15,ratio:true},elbowAsym:{zh:'左右肘角差',tol:15}
};
const ALL_KEYS=['knee','kneeMin','hip','elbow','shoulder','trunk','kneeSpread','elbowAsym'];
const AUTO_CANDIDATES=['knee','hip','elbow','shoulder','kneeSpread'];

function ang(a,b,c,W,H){
  const ax=(a.x-b.x)*W,ay=(a.y-b.y)*H,cx=(c.x-b.x)*W,cy=(c.y-b.y)*H;
  const d=Math.hypot(ax,ay)*Math.hypot(cx,cy); if(!d) return NaN;
  return Math.acos(Math.max(-1,Math.min(1,(ax*cx+ay*cy)/d)))*180/Math.PI;
}
function vis(lm,i){const v=lm[i].visibility; return v==null?1:v}
function sideAngle(lm,key,s,W,H){const c=CHAIN[key].map(j=>lm[SIDES[s][j]]);return ang(c[0],c[1],c[2],W,H)}
function sideVis(lm,key,s){return Math.min(...CHAIN[key].map(j=>vis(lm,SIDES[s][j])))}
function fmtVal(key,v){if(v==null||isNaN(v))return '—';return METRICS[key]&&METRICS[key].ratio?v.toFixed(2)+'×':Math.round(v)+'°'}
function median(a){const b=a.filter(x=>!isNaN(x)).sort((x,y)=>x-y);if(!b.length)return NaN;const m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])/2}
function pct(a,p){const b=a.filter(x=>!isNaN(x)).sort((x,y)=>x-y);if(!b.length)return NaN;return b[Math.min(b.length-1,Math.max(0,Math.round(p*(b.length-1))))]}
function baseKey(k){return CHAIN[k]?k:(k==='kneeMin'?'knee':null)}

/* Tracker: landmarks -> smoothed metric values for one exercise spec */
class Tracker{
  constructor(spec){this.spec=spec;this.ema={};this.vis={L:.5,R:.5};this.side=spec.fixedSide||'L';this.hist=[];this.locked=false;this.alpha=.5}
  update(lm,W,H,t){
    const sp=this.spec, chainKey=baseKey(sp.primary)||'knee';
    this.vis.L=this.vis.L*.85+sideVis(lm,chainKey,'L')*.15;
    this.vis.R=this.vis.R*.85+sideVis(lm,chainKey,'R')*.15;
    const raw={};
    for(const k of ['knee','hip','elbow','shoulder']){raw[k+'L']=sideAngle(lm,k,'L',W,H);raw[k+'R']=sideAngle(lm,k,'R',W,H)}
    // which side drives side-specific metrics
    let mode=sp.view==='side'?'visible':'avg';
    if(sp.unilateral) mode='active';
    let side=this.side;
    if(mode==='visible'){ if(Math.abs(this.vis.L-this.vis.R)>.08 && !this.locked) side=this.vis.L>this.vis.R?'L':'R' }
    if(mode==='active'){
      this.hist.push({t,L:raw[chainKey+'L'],R:raw[chainKey+'R']});
      while(this.hist.length&&t-this.hist[0].t>3)this.hist.shift();
      if(!sp.fixedSide && !this.locked && this.hist.length>10){
        const rng=s=>{const v=this.hist.map(h=>h[s]).filter(x=>!isNaN(x));return v.length?Math.max(...v)-Math.min(...v):0};
        const rl=rng('L'),rr=rng('R'); const cur=side==='L'?rl:rr, oth=side==='L'?rr:rl;
        if(oth>cur+8) side=side==='L'?'R':'L';
      }
    }
    if(side!==this.side){this.side=side;this.ema={}}
    const out={}, missing=new Set();
    if(!this.relevant) this.relevant=new Set([sp.primary,...(sp.secondary||[])].map(baseKey).filter(Boolean));
    const pick=(k)=>{
      const track=this.relevant.has(k);
      if(mode==='avg'){
        const vl=sideVis(lm,k,'L'),vr=sideVis(lm,k,'R');
        if(vl>=.5&&vr>=.5) return (raw[k+'L']+raw[k+'R'])/2;
        if(vl>=.5) return raw[k+'L']; if(vr>=.5) return raw[k+'R'];
        if(track) CHAIN[k].forEach(j=>{if(vis(lm,SIDES.L[j])<.5&&vis(lm,SIDES.R[j])<.5)missing.add(j)}); return NaN;
      }
      if(track) CHAIN[k].forEach(j=>{if(vis(lm,SIDES[side][j])<.5)missing.add(j)});
      return raw[k+side];
    };
    for(const k of ['knee','hip','elbow','shoulder']) out[k]=pick(k);
    // knee of the more-bent leg (lunges)
    const kl=sideVis(lm,'knee','L')>=.35?raw.kneeL:NaN, kr=sideVis(lm,'knee','R')>=.35?raw.kneeR:NaN;
    out.kneeMin=isNaN(kl)?kr:isNaN(kr)?kl:Math.min(kl,kr);
    const S1=lm[11],S2=lm[12],H1=lm[23],H2=lm[24];
    const sx=((S1.x+S2.x)/2)*W, sy=((S1.y+S2.y)/2)*H, hx=((H1.x+H2.x)/2)*W, hy=((H1.y+H2.y)/2)*H;
    out.trunk=Math.atan2(Math.abs(sx-hx),hy-sy)*180/Math.PI;
    const hw=Math.hypot((H1.x-H2.x)*W,(H1.y-H2.y)*H), kw=Math.hypot((lm[25].x-lm[26].x)*W,(lm[25].y-lm[26].y)*H);
    out.kneeSpread=hw>4?kw/hw:NaN;
    out.elbowAsym=(sideVis(lm,'elbow','L')>=.5&&sideVis(lm,'elbow','R')>=.5)?Math.abs(raw.elbowL-raw.elbowR):NaN;
    // smoothing
    for(const k of ALL_KEYS){const v=out[k]; if(isNaN(v)){out[k]=NaN;continue}
      this.ema[k]=this.ema[k]==null?v:this.ema[k]+(v-this.ema[k])*this.alpha; out[k]=this.ema[k]}
    const pk=sp.primary==='auto'?null:sp.primary;
    let need=[]; if(pk==='kneeSpread') need=['H','K'];
    need.forEach(j=>{if(vis(lm,SIDES.L[j])<.5||vis(lm,SIDES.R[j])<.5)missing.add(j)});
    const ok=pk?!isNaN(out[pk]):true;
    return {values:out,side,missing:[...missing].map(j=>JOINT_ZH[j]),ok};
  }
}

/* RepCounter: online rep segmentation on the primary signal */
class RepCounter{
  constructor({rest,far,startThr=.5,endThr=.2}){this.rest=rest;this.far=far;this.startThr=startThr;this.endThr=endThr;this.state='rest';this.count=0;this.restV=null;this.lastRestT=null;this.seenRest=false;this.cur=null}
  prog(v){return (v-this.rest)/(this.far-this.rest)}
  push(t,v,vals){
    if(isNaN(v))return null; const p=this.prog(v);
    if(this.state==='rest'){
      if(this.restV==null||p<this.prog(this.restV)) this.restV=v;
      // 必须先看到一次起始位，才开始算一下（视频从动作中间开始时，那半下不算）
      if(p<=.15){this.lastRestT=t;this.seenRest=true}
      if(p>=this.startThr&&this.seenRest){this.state='out';this.cur={start:this.lastRestT,restBefore:this.restV,farV:v,farT:t,vals:{...vals},newFar:true}}
      return null;
    }
    const c=this.cur; c.newFar=false;
    if(p>this.prog(c.farV)){c.farV=v;c.farT=t;c.vals={...vals};c.newFar=true}
    if(p<=this.endThr){
      this.count++; this.state='rest'; this.restV=v; this.lastRestT=t;
      const rep={n:this.count,start:c.start,farT:c.farT,end:t,farV:c.farV,restBefore:c.restBefore,vals:c.vals,out:c.farT-c.start,back:t-c.farT};
      this.cur=null; return rep;
    }
    return null;
  }
}

/* Build a reference profile from a recorded series [{t, values}] */
function analyzeReference(series,spec){
  if(series.length<20) return {error:'画面里识别到的有效帧太少。请确认全身（至少相关关节）都在画面里。'};
  let primary=spec.primary;
  const col=k=>series.map(s=>s.values[k]);
  if(primary==='auto'){
    let best=null,bestR=0;
    for(const k of AUTO_CANDIDATES){const a=col(k);const r=(pct(a,.95)-pct(a,.05))*(METRICS[k].ratio?100:1);if(r>bestR){bestR=r;best=k}}
    primary=best;
  }
  const pv=col(primary), lo=pct(pv,.05), hi=pct(pv,.95);
  const minRange=METRICS[primary].ratio?.15:15;
  if(!(hi-lo>=minRange)) return {error:`动作幅度太小（${METRICS[primary].zh}只变了 ${fmtVal(primary,hi-lo)}），可能机位不对，或关节被挡住了。`};
  const t0=series[0].t, early=median(series.filter(s=>s.t-t0<1.0).map(s=>s.values[primary]));
  // 起始位在哪一端：动作预设写明了就用预设（spec.rest = 'high' | 'low'），否则看视频开头 1 秒
  const restIsLo=spec.rest?spec.rest==='low':Math.abs(early-lo)<=Math.abs(early-hi);
  const rest=restIsLo?lo:hi, far=restIsLo?hi:lo;
  const ctr=new RepCounter({rest,far});
  const reps=[]; for(const s of series){const r=ctr.push(s.t,s.values[primary],s.values); if(r)reps.push(r)}
  if(!reps.length) return {error:'没有识别到完整的一下。请让教练从起始姿势开始，完整做 3–5 下。'};
  const farM=median(reps.map(r=>r.farV)), restM=median(reps.map(r=>r.restBefore));
  const secondary={};
  for(const k of spec.secondary||[]){ if(k===primary)continue; const m=median(reps.map(r=>r.vals[k])); if(!isNaN(m)) secondary[k]=m }
  const best=reps.reduce((a,b)=>Math.abs(b.farV-farM)<Math.abs(a.farV-farM)?b:a);
  return {primary,rest:restM,far:farM,reps:reps.length,secondary,
    tempo:{out:median(reps.map(r=>r.out)),back:median(reps.map(r=>r.back))},
    bestFarT:best.farT,bestRestT:best.start,repList:reps};
}

/* Compare one rep against the profile -> issues (most severe first) */
function compareRep(rep,prof,preset,k){
  const dir=Math.sign(prof.far-prof.rest)||1, P=prof.primary, tolP=METRICS[P].tol*k, cues=preset.cues||{};
  const issues=[], infos=[];
  const farShort=(prof.far-rep.farV)*dir;
  if(farShort>tolP) issues.push({key:P,sev:farShort/tolP*1.2,text:`${METRICS[P].zh}差了 ${fmtVal(P,farShort)}`,voice:cues.farShort||'幅度再大一点'});
  else if(-farShort>2*tolP) infos.push({cls:'warn',text:'幅度比教练还大'});
  else infos.push({cls:'good',text:'幅度到位'});
  const restShort=(rep.restBefore-prof.rest)*dir;
  if(restShort>tolP && cues.restShort!==null) issues.push({key:P,sev:restShort/tolP,text:`起始位置没回到位，差 ${fmtVal(P,restShort)}`,voice:cues.restShort||'回到起始位置'});
  for(const key in prof.secondary){
    const ref=prof.secondary[key], v=rep.vals[key]; if(v==null||isNaN(v))continue;
    const d=v-ref, tol=METRICS[key].tol*k; if(Math.abs(d)<=tol){infos.push({cls:'good',text:METRICS[key].zh+' ✓'});continue}
    const c=cues[key]?cues[key][d>0?'high':'low']:undefined;
    const text=`${METRICS[key].zh}${d>0?'比教练大':'比教练小'} ${fmtVal(key,Math.abs(d))}`;
    if(c===null){infos.push({cls:'warn',text});continue}
    issues.push({key,sev:Math.abs(d)/tol,text,voice:c||text});
  }
  const ecc=preset.ecc==='back'?rep.back:rep.out, refEcc=preset.ecc==='back'?prof.tempo.back:prof.tempo.out;
  if(refEcc>.5 && ecc<refEcc*.6) issues.push({key:'tempo',sev:1.05,text:`离心 ${ecc.toFixed(1)}s，教练 ${refEcc.toFixed(1)}s`,voice:cues.fast||'慢一点，控制住'});
  else infos.push({cls:'good',text:`节奏 ${(rep.out+rep.back).toFixed(1)}s`});
  issues.sort((a,b)=>b.sev-a.sev);
  return {issues,infos};
}

export {SIDES,JOINT_ZH,CHAIN,METRICS,ALL_KEYS,AUTO_CANDIDATES,ang,vis,sideAngle,sideVis,fmtVal,median,pct,baseKey,Tracker,RepCounter,analyzeReference,compareRep};
