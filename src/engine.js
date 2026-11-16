// 识别引擎：关节点 -> 角度 -> 计次 -> 和教练标准对比。不碰 DOM，浏览器和 Node 都能用。
// 来源：reference/form-mirror.html 的 <script id="engine">（2026-10-26）。
// 改动：RepCounter 要先见到起始位才计次；analyzeReference 支持预设指定起始位方向（spec.rest）。
// 第 2 步：新指标 neck（耳-肩-髋夹角）和 kneeFwd（前腿膝盖超过脚尖多少）；每一下保存整条曲线，
//          按 0–100% 动作进度和教练曲线对比；summarizeSet 做一组总结；trainingLogRow 生成训练记录。

// 双语：所有给人看/听的文字都从 i18n.js 的 t() 取（指标名 m.*、关节名 j.*、对比结果 cmp.*、总结 sum.*）。
// METRICS 里的 zh 字段只是给读代码的人看的，界面用 mname()。
import {t, isEn} from './i18n.js';
const mname=k=>t('m.'+k);
// 动作预设的语音提示：英文界面用 cuesEn（没有就退回中文）
const presetCues=p=>(isEn()&&p.cuesEn)||p.cues||{};

// Ea=耳朵 F=脚尖 Hl=脚跟（MediaPipe 33 点编号）
const SIDES={L:{Ea:7,S:11,E:13,W:15,H:23,K:25,A:27,Hl:29,F:31},R:{Ea:8,S:12,E:14,W:16,H:24,K:26,A:28,Hl:30,F:32}};
const JOINT_ZH={Ea:'头',S:'肩',E:'手肘',W:'手腕',H:'髋',K:'膝盖',A:'脚踝',Hl:'脚跟',F:'脚尖'};
const CHAIN={knee:['H','K','A'],hip:['S','H','K'],elbow:['S','E','W'],shoulder:['H','S','E'],neck:['Ea','S','H']};
const METRICS={
  knee:{zh:'膝角',tol:10},kneeMin:{zh:'膝角（较弯的腿）',tol:10},hip:{zh:'髋角',tol:10},
  elbow:{zh:'肘角',tol:12},shoulder:{zh:'肩角',tol:12},trunk:{zh:'躯干倾斜',tol:10},
  kneeSpread:{zh:'膝间距（×髋宽）',tol:0.15,ratio:true},elbowAsym:{zh:'左右肘角差',tol:15},
  neck:{zh:'耳-肩-髋夹角（头和背）',tol:12},
  // bottomOnly：只在动作下半段（进度 ≥ 50%）比较。弓步迈步时两只脚都在动，分不清前后腿，那段数字没意义
  kneeFwd:{zh:'前腿膝盖超过脚尖（×小腿长）',tol:0.12,ratio:true,bottomOnly:true},
  // 前腿大腿和水平线的夹角：0 = 水平，站直约 70–90。前腿 = 膝盖更高的那条。
  // 只看前腿，所以后腿被史密斯机挡住时也能判断深度（11/15 用户实测：后腿被挡，左右腿点都落在前腿上）
  frontThigh:{zh:'前腿大腿离水平',tol:15}
};
// 评估优先级：背 > 膝盖前冲 > 幅度 > 节奏。问题按 严重程度 × 权重 排序
const WEIGHT={trunk:1.3,neck:1.3,kneeFwd:1.15};
const ALL_KEYS=['knee','kneeMin','hip','elbow','shoulder','trunk','kneeSpread','elbowAsym','neck','kneeFwd','viewRatio','frontThigh','legGap'];
// 两只脚踝的水平距离 ÷ 前腿小腿长。弓步最低点正常应 > 1；接近 0 说明两条腿的点叠在一起（后腿被挡住）
const LEG_HIDDEN_GAP=0.3;
// 机位：肩宽 ÷ 躯干长。正侧面时两肩重叠（约 0.1–0.2），正面或背面时约 0.5–0.6。
// 身体在动作中会转，斜侧面和侧面分不准，所以只用它认出"正面或背面"
const FRONT_BACK_RATIO=0.45;
const CURVE_N=51;
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

/* 前腿膝盖超过脚尖多少，以小腿长为单位（正数 = 膝盖在脚尖前面）。
   前腿 = 脚跟抬得少的那条腿（弓步时后脚踮着）；看不清脚时退回"膝盖更弯的那条腿"。
   方向用脚踝 -> 脚尖判断，所以面朝左右都可以。 */
function legVis(lm,s){const J=SIDES[s];return Math.min(vis(lm,J.K),vis(lm,J.A),vis(lm,J.F))}
function kneeForward(lm,W,H){
  const ok=s=>legVis(lm,s)>=.35, heelUp=s=>{const J=SIDES[s];if(vis(lm,J.Hl)<.35)return NaN;
    const shin=Math.hypot((lm[J.K].x-lm[J.A].x)*W,(lm[J.K].y-lm[J.A].y)*H);return shin>4?(lm[J.F].y-lm[J.Hl].y)*H/shin:NaN};
  let front;
  if(ok('L')&&ok('R')){
    const uL=heelUp('L'),uR=heelUp('R');
    if(!isNaN(uL)&&!isNaN(uR)&&Math.abs(uL-uR)>.1) front=uL<uR?'L':'R';
    else front=sideAngle(lm,'knee','L',W,H)<=sideAngle(lm,'knee','R',W,H)?'L':'R';
  } else if(ok('L')) front='L'; else if(ok('R')) front='R'; else return NaN;
  const J=SIDES[front],K=lm[J.K],A=lm[J.A],F=lm[J.F];
  const shin=Math.hypot((K.x-A.x)*W,(K.y-A.y)*H); if(shin<4)return NaN;
  // 朝向：优先用鼻子在耳朵哪一边（脚尖点偶尔会被识别反），看不清头再用脚踝 -> 脚尖
  const ear=vis(lm,7)>=vis(lm,8)?lm[7]:lm[8], nose=lm[0];
  const dir=(vis(lm,0)>=.5&&Math.abs(nose.x-ear.x)*W>3)?Math.sign(nose.x-ear.x):(Math.sign(F.x-A.x)||1);
  return (K.x-F.x)*W*dir/shin;
}

/* Tracker: landmarks -> smoothed metric values for one exercise spec */
class Tracker{
  constructor(spec){this.spec=spec;this.ema={};this.vis={L:.5,R:.5};this.side=spec.fixedSide||'L';this.hist=[];this.locked=false;this.alpha=.5}
  update(lm,W,H,t){
    const sp=this.spec, chainKey=baseKey(sp.primary)||'knee';
    this.vis.L=this.vis.L*.85+sideVis(lm,chainKey,'L')*.15;
    this.vis.R=this.vis.R*.85+sideVis(lm,chainKey,'R')*.15;
    const raw={};
    for(const k of ['knee','hip','elbow','shoulder','neck']){raw[k+'L']=sideAngle(lm,k,'L',W,H);raw[k+'R']=sideAngle(lm,k,'R',W,H)}
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
    for(const k of ['knee','hip','elbow','shoulder','neck']) out[k]=pick(k);
    // knee of the more-bent leg (lunges)
    const kl=sideVis(lm,'knee','L')>=.35?raw.kneeL:NaN, kr=sideVis(lm,'knee','R')>=.35?raw.kneeR:NaN;
    out.kneeMin=isNaN(kl)?kr:isNaN(kr)?kl:Math.min(kl,kr);
    out.kneeFwd=kneeForward(lm,W,H);
    const S1=lm[11],S2=lm[12],H1=lm[23],H2=lm[24];
    const sx=((S1.x+S2.x)/2)*W, sy=((S1.y+S2.y)/2)*H, hx=((H1.x+H2.x)/2)*W, hy=((H1.y+H2.y)/2)*H;
    out.trunk=Math.atan2(Math.abs(sx-hx),hy-sy)*180/Math.PI;
    const hw=Math.hypot((H1.x-H2.x)*W,(H1.y-H2.y)*H), kw=Math.hypot((lm[25].x-lm[26].x)*W,(lm[25].y-lm[26].y)*H);
    out.kneeSpread=hw>4?kw/hw:NaN;
    out.elbowAsym=(sideVis(lm,'elbow','L')>=.5&&sideVis(lm,'elbow','R')>=.5)?Math.abs(raw.elbowL-raw.elbowR):NaN;
    const torso=Math.hypot(sx-hx,sy-hy), sw=Math.hypot((S1.x-S2.x)*W,(S1.y-S2.y)*H);
    out.viewRatio=torso>4?sw/torso:NaN;
    const fk=lm[25].y<lm[26].y?25:26, fh=fk-2, fa=fk+2;
    out.frontThigh=(vis(lm,fk)>=.35&&vis(lm,fh)>=.35)?Math.atan2((lm[fk].y-lm[fh].y)*H,Math.abs(lm[fk].x-lm[fh].x)*W)*180/Math.PI:NaN;
    const shinF=Math.hypot((lm[fk].x-lm[fa].x)*W,(lm[fk].y-lm[fa].y)*H);
    out.legGap=shinF>4?Math.abs(lm[27].x-lm[28].x)*W/shinF:NaN;
    // smoothing
    for(const k of ALL_KEYS){const v=out[k]; if(isNaN(v)){out[k]=NaN;continue}
      this.ema[k]=this.ema[k]==null?v:this.ema[k]+(v-this.ema[k])*this.alpha; out[k]=this.ema[k]}
    const pk=sp.primary==='auto'?null:sp.primary;
    let need=[]; if(pk==='kneeSpread') need=['H','K'];
    need.forEach(j=>{if(vis(lm,SIDES.L[j])<.5||vis(lm,SIDES.R[j])<.5)missing.add(j)});
    const ok=pk?!isNaN(out[pk]):true;
    return {values:out,side,missing:[...missing].map(j=>t('j.'+j)),ok};
  }
}

/* RepCounter: online rep segmentation on the primary signal */
class RepCounter{
  // minDur：短于这个秒数的"一下"不算（比如弓步换脚、调整站位时膝盖晃一下）
  constructor({rest,far,startThr=.5,endThr=.2,minDur=.6}){this.rest=rest;this.far=far;this.startThr=startThr;this.endThr=endThr;this.minDur=minDur;this.state='rest';this.count=0;this.restV=null;this.lastRestT=null;this.seenRest=false;this.cur=null;this.buf=[]}
  prog(v){return (v-this.rest)/(this.far-this.rest)}
  push(t,v,vals){
    if(isNaN(v))return null; const p=this.prog(v);
    const sample={t,vals:{...vals}};
    if(this.state==='rest'){
      if(this.restV==null||p<this.prog(this.restV)) this.restV=v;
      // 必须先看到一次起始位，才开始算一下（视频从动作中间开始时，那半下不算）
      // buf 从最后一次在起始位的那一帧开始存，存到这一下结束，就是这一下的整条曲线
      if(p<=.15){this.lastRestT=t;this.seenRest=true;this.buf=[sample]}
      else if(this.seenRest) this.buf.push(sample);
      if(p>=this.startThr&&this.seenRest){this.state='out';this.cur={start:this.lastRestT,restBefore:this.restV,farV:v,farT:t,vals:{...vals},newFar:true}}
      return null;
    }
    const c=this.cur; c.newFar=false;
    if(this.buf.length<2000) this.buf.push(sample);
    if(p>this.prog(c.farV)){c.farV=v;c.farT=t;c.vals={...vals};c.newFar=true}
    if(p<=this.endThr&&t-c.start<this.minDur){
      this.state='rest'; this.restV=v; this.lastRestT=t; this.buf=p<=.15?[sample]:[]; this.cur=null; return null;
    }
    if(p<=this.endThr){
      this.count++; this.state='rest'; this.restV=v; this.lastRestT=t;
      const rep={n:this.count,start:c.start,farT:c.farT,end:t,farV:c.farV,restBefore:c.restBefore,vals:c.vals,out:c.farT-c.start,back:t-c.farT,samples:this.buf};
      this.buf=p<=.15?[sample]:[];
      this.cur=null; return rep;
    }
    return null;
  }
}

/* Build a reference profile from a recorded series [{t, values}] */
function analyzeReference(series,spec){
  if(series.length<20) return {error:t('err.fewFrames')};
  let primary=spec.primary;
  const col=k=>series.map(s=>s.values[k]);
  if(primary==='auto'){
    let best=null,bestR=0;
    for(const k of AUTO_CANDIDATES){const a=col(k);const r=(pct(a,.95)-pct(a,.05))*(METRICS[k].ratio?100:1);if(r>bestR){bestR=r;best=k}}
    primary=best;
  }
  const pv=col(primary), lo=pct(pv,.05), hi=pct(pv,.95);
  const minRange=METRICS[primary].ratio?.15:15;
  if(!(hi-lo>=minRange)) return {error:t('err.smallRange',{name:mname(primary),val:fmtVal(primary,hi-lo)})};
  const t0=series[0].t, early=median(series.filter(s=>s.t-t0<1.0).map(s=>s.values[primary]));
  // 起始位在哪一端：动作预设写明了就用预设（spec.rest = 'high' | 'low'），否则看视频开头 1 秒
  const restIsLo=spec.rest?spec.rest==='low':Math.abs(early-lo)<=Math.abs(early-hi);
  const rest=restIsLo?lo:hi, far=restIsLo?hi:lo;
  const ctr=new RepCounter({rest,far});
  const reps=[]; for(const s of series){const r=ctr.push(s.t,s.values[primary],s.values); if(r)reps.push(r)}
  if(!reps.length) return {error:t('err.noRep')};
  const farM=median(reps.map(r=>r.farV)), restM=median(reps.map(r=>r.restBefore));
  const secondary={};
  for(const k of spec.secondary||[]){ if(k===primary)continue; const m=median(reps.map(r=>r.vals[k])); if(!isNaN(m)) secondary[k]=m }
  const best=reps.reduce((a,b)=>Math.abs(b.farV-farM)<Math.abs(a.farV-farM)?b:a);
  // 每个指标的标准曲线：每一下按 0–100% 进度重采样，再逐点取中位数
  const keys=[primary,...Object.keys(secondary)], curves={};
  const per=reps.map(r=>repCurve(r,keys));
  for(const k of keys) curves[k]=Array.from({length:CURVE_N},(_,i)=>median(per.map(c=>c[k][i])));
  return {primary,rest:restM,far:farM,reps:reps.length,secondary,curves,
    tempo:{out:median(reps.map(r=>r.out)),back:median(reps.map(r=>r.back))},
    bestFarT:best.farT,bestRestT:best.start,repList:reps};
}

/* 把一下的样本按时间均匀重采样成 n 个点（0% = 离开起始位，100% = 回到起始位） */
function resample(samples,keys,n=CURVE_N){
  const out={}; for(const k of keys) out[k]=new Array(n).fill(NaN);
  if(!samples||samples.length<2) return out;
  const t0=samples[0].t, t1=samples[samples.length-1].t; let j=0;
  for(let i=0;i<n;i++){
    const tt=t0+(t1-t0)*i/(n-1);
    while(j<samples.length-2&&samples[j+1].t<tt) j++;
    const a=samples[j], b=samples[j+1], u=b.t>a.t?Math.min(1,Math.max(0,(tt-a.t)/(b.t-a.t))):0;
    for(const k of keys){const va=a.vals[k], vb=b.vals[k];
      out[k][i]=isNaN(va)?vb:isNaN(vb)?va:va+(vb-va)*u}
  }
  return out;
}
function repCurve(rep,keys){return rep.curve&&keys.every(k=>rep.curve[k])?rep.curve:resample(rep.samples,keys)}

/* 一个次要指标和教练的差：有曲线就看整下动作里偏得最多的地方（取 10%/90% 分位，去掉抖动），
   没有曲线（旧的标准）就只看最远点那一帧。返回带正负号的差值。 */
function secondaryDiff(key,rep,prof,tol){
  const ref=prof.curves&&prof.curves[key];
  if(ref&&rep.samples){
    const mine=repCurve(rep,[key])[key], P=prof.primary, pc=prof.curves[P];
    const keep=i=>!METRICS[key].bottomOnly||(pc&&(pc[i]-prof.rest)/(prof.far-prof.rest)>=.5);
    const all=mine.map((v,i)=>keep(i)?v-ref[i]:NaN), d=all.filter(x=>!isNaN(x));
    const need=all.filter((_,i)=>keep(i)).length*.6;
    if(d.length&&d.length>=need){
      // 只看最低点附近的指标：比较那一段的中位数（单帧识别抖动大）
      if(METRICS[key].bottomOnly) return {d:median(d),whole:true};
      const hi=pct(d,.9), lo=pct(d,.1);
      if(hi>tol&&hi>=-lo) return {d:hi,whole:true};
      if(lo<-tol) return {d:lo,whole:true};
      return {d:Math.abs(hi)>=Math.abs(lo)?hi:lo,whole:true};
    }
  }
  const v=rep.vals[key], r=prof.secondary[key];
  return v==null||isNaN(v)||r==null?null:{d:v-r,whole:false};
}

/* 这一下的机位（肩宽 ÷ 躯干长的中位数），没有样本时退回最远点那一帧 */
function repView(rep){
  const v=rep.samples?median(rep.samples.map(s=>s.vals.viewRatio)):NaN;
  return isNaN(v)&&rep.vals?rep.vals.viewRatio:v;
}

/* 这一下的深度（绝对标准）：取整下动作里该指标的 10% 分位，即接近最低点、去掉单帧抖动。没有数据返回 null */
function repDepth(rep,preset){
  if(!preset.depth||!rep.samples) return null;
  const v=rep.samples.map(s=>s.vals[preset.depth.key]).filter(x=>x!=null&&!isNaN(x));
  if(v.length<3) return null;
  return {key:preset.depth.key,value:pct(v,.1)};
}
/* 最低点附近两条腿的点是否叠在一起（后腿没识别到）。
   只看前腿大腿最低的 20% 帧：站直时两脚本来就并拢，不能算 */
function legHidden(rep){
  if(!rep.samples) return false;
  const s=rep.samples.filter(x=>!isNaN(x.vals.frontThigh)&&!isNaN(x.vals.legGap));
  if(s.length<5) return false;
  const cut=pct(s.map(x=>x.vals.frontThigh),.2);
  return median(s.filter(x=>x.vals.frontThigh<=cut).map(x=>x.vals.legGap))<LEG_HIDDEN_GAP;
}

/* Compare one rep against the profile -> issues (most severe first) */
function compareRep(rep,prof,preset,k){
  const dir=Math.sign(prof.far-prof.rest)||1, P=prof.primary, tolP=METRICS[P].tol*k, cues=presetCues(preset);
  const issues=[], infos=[];
  // 侧面拍的动作，这一下却是正面或背面拍到的：角度没法比，不评估
  const view=repView(rep);
  if(preset.view==='side'&&view>FRONT_BACK_RATIO)
    return {skipped:true,issues:[{key:'view',sev:0,text:t('cmp.viewSkip'),voice:t('cmp.viewSkipVoice')}],infos:[]};
  // 深度：预设给了绝对标准（如后撤弓步看前腿大腿是否水平）就用它，不和标准视频的膝角比
  const depth=repDepth(rep,preset);
  if(depth){
    const okAt=preset.depth.ok*k;
    if(depth.value>okAt) issues.push({key:'depth',sev:(depth.value-okAt)/METRICS[depth.key].tol*1.2+1,
      text:t('cmp.depthShort',{name:mname(depth.key),val:Math.round(depth.value),ok:Math.round(okAt)}),voice:cues.farShort||t('cmp.farShortVoice')});
    else infos.push({cls:'good',text:t('cmp.depthOk',{name:mname(depth.key),val:Math.round(depth.value)})});
  } else {
    const farShort=(prof.far-rep.farV)*dir;
    if(farShort>tolP) issues.push({key:P,sev:farShort/tolP*1.2,text:t('cmp.farShort',{name:mname(P),val:fmtVal(P,farShort)}),voice:cues.farShort||t('cmp.farShortVoice')});
    else if(-farShort>2*tolP) infos.push({cls:'warn',text:t('cmp.farOver')});
    else infos.push({cls:'good',text:t('cmp.farOk')});
  }
  if(legHidden(rep)) infos.push({cls:'warn',text:t('cmp.legHidden')});
  const restShort=(rep.restBefore-prof.rest)*dir;
  if(restShort>tolP && cues.restShort!==null) issues.push({key:P,sev:restShort/tolP,text:t('cmp.restShort',{val:fmtVal(P,restShort)}),voice:cues.restShort||t('cmp.restShortVoice')});
  for(const key in prof.secondary){
    const tol=METRICS[key].tol*k, r=secondaryDiff(key,rep,prof,tol); if(!r)continue;
    const d=r.d; if(Math.abs(d)<=tol){infos.push({cls:'good',text:t('cmp.secOk',{name:mname(key)})});continue}
    const c=cues[key]?cues[key][d>0?'high':'low']:undefined;
    const text=t('cmp.secDiff',{name:mname(key),more:d>0,val:fmtVal(key,Math.abs(d)),whole:r.whole});
    if(c===null){infos.push({cls:'warn',text});continue}
    issues.push({key,sev:Math.abs(d)/tol*(WEIGHT[key]||1),text,voice:c||text});
  }
  const ecc=preset.ecc==='back'?rep.back:rep.out, refEcc=preset.ecc==='back'?prof.tempo.back:prof.tempo.out;
  if(refEcc>.5 && ecc<refEcc*.6) issues.push({key:'tempo',sev:1.05,text:t('cmp.tempo',{mine:ecc.toFixed(1),ref:refEcc.toFixed(1)}),voice:cues.fast||t('cmp.tempoVoice')});
  else infos.push({cls:'good',text:t('cmp.tempoOk',{val:(rep.out+rep.back).toFixed(1)})});
  issues.sort((a,b)=>b.sev-a.sev);
  return {issues,infos,depth:depth?depth.value:null,depthKey:depth?depth.key:null,legHidden:legHidden(rep)};
}

/* 一组总结。reps 里每一下要有 cmp（compareRep 的结果）。
   score 越小越好：问题严重程度之和 + 幅度离教练多远（很小的权重，只用来分出高下） */
function repScore(r,prof){return r.cmp.issues.reduce((s,i)=>s+i.sev,0)+Math.abs(r.farV-prof.far)/(METRICS[prof.primary].tol*10)}
function summarizeSet(reps,prof){
  const n=reps.length;
  if(!n) return {n:0,clean:0,skipped:0,top:[],best:null,worst:null,farMedian:NaN,speech:t('sum.none')};
  // 机位不对没评估的几下单独算，不参与"标准几下"、最好最差和主要问题
  const done=reps.filter(r=>!r.cmp.skipped), skipped=n-done.length, m=done.length;
  const clean=done.filter(r=>!r.cmp.issues.length).length;
  const cnt=new Map();
  for(const r of done) for(const v of new Set(r.cmp.issues.map(i=>i.voice))) cnt.set(v,(cnt.get(v)||0)+1);
  const top=[...cnt.entries()].sort((a,b)=>b[1]-a[1]).map(([voice,count])=>({voice,count}));
  const scored=done.map(r=>({r,s:repScore(r,prof)})).sort((a,b)=>a.s-b.s);
  const best=m?scored[0].r:null, worst=m>1&&scored[m-1].r.cmp.issues.length?scored[m-1].r:null;
  const speech=t('sum.speech',{n,skipped,m,clean,top:top.slice(0,2)});
  const dv=done.map(r=>r.cmp.depth).filter(x=>x!=null);
  return {n,clean,skipped,top,best,worst,farMedian:median(done.map(r=>r.farV)),
    depthMedian:dv.length?median(dv):null,depthKey:(done.find(r=>r.cmp.depthKey)||{cmp:{}}).cmp.depthKey||null,
    legHidden:done.filter(r=>r.cmp.legHidden).length,speech};
}

/* 训练记录一行，列和 coach/data/training_log.csv 一样：date,session,exercise,sets,reps,weight_lb,rir,note */
const TRAINING_LOG_HEADER='date,session,exercise,sets,reps,weight_lb,rir,note';
function csvCell(v){if(v==null||(typeof v==='number'&&isNaN(v)))return '';const s=String(v);return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function formNote(sum){
  if(!sum||!sum.n) return '';
  const parts=[t('note.eval',{clean:sum.clean,m:sum.n-(sum.skipped||0)})];
  if(sum.skipped) parts.push(t('note.skipped',{n:sum.skipped}));
  for(const x of sum.top.slice(0,3)) parts.push(`${x.voice} ×${x.count}`);
  return parts.join(t('note.sep'));
}
function trainingLogRow({date,session='',exercise,sets=1,reps,weight_lb,rir,note=''}){
  return [date,session,exercise,sets,reps,weight_lb,rir,note].map(csvCell).join(',');
}

export {SIDES,JOINT_ZH,CHAIN,METRICS,WEIGHT,ALL_KEYS,AUTO_CANDIDATES,CURVE_N,FRONT_BACK_RATIO,TRAINING_LOG_HEADER,ang,vis,sideAngle,sideVis,fmtVal,median,pct,baseKey,
  kneeForward,resample,repCurve,repView,mname,Tracker,RepCounter,analyzeReference,compareRep,summarizeSet,formNote,trainingLogRow};
