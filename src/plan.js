// 训练计划：纯逻辑（不碰 DOM，Node 能测）。
// 计划本身是用户的私人内容，不在这个公开仓库里：由 coach/plan/app-plan.json 生成，放到 Google Drive，
// 手机上"导入训练计划"后存在本机。格式见 validatePlan()。

import {t, isEn, loc} from './i18n.js';

export const PLAN_APP = 'form-coach-plan';
const DEFAULT_PLATES = [45, 35, 25, 10, 5, 2.5];

/* 每边要加的片（从大到小贪心）。凑不出来返回 null */
export function platesPerSide(perSide, plates = DEFAULT_PLATES) {
  let left = Math.round(perSide * 100) / 100;
  if (left < 0) return null;
  const out = [];
  for (const p of [...plates].sort((a, b) => b - a)) {
    while (left >= p - 1e-9) { out.push(p); left = Math.round((left - p) * 100) / 100; }
  }
  return left < 1e-9 ? out : null;
}

const fmtNum = n => (Number.isInteger(n) ? String(n) : String(n).replace(/\.0+$/, ''));
const fmtPlates = ps => ps.length ? t('load.plates', {list: ps.map(fmtNum).join(' + ')}) : t('load.none');

/* 杠铃片说明，每个目标重量一行。load = {kind:'barbell', bar, weights} | {kind:'smith', weights} */
export function loadLines(load, plates = DEFAULT_PLATES) {
  if (!load || !Array.isArray(load.weights)) return [];
  return load.weights.map(w => {
    if (load.kind === 'barbell') {
      const bar = load.bar ?? 35, ps = platesPerSide((w - bar) / 2, plates);
      return ps ? t('load.barbell', {w: fmtNum(w), bar: fmtNum(bar), plates: fmtPlates(ps)}) : t('load.barbellOdd', {w: fmtNum(w), bar: fmtNum(bar)});
    }
    if (load.kind === 'smith') {
      const ps = platesPerSide(w / 2, plates);
      return ps ? t('load.smith', {w: fmtNum(w), plates: fmtPlates(ps)}) : t('load.smithOdd', {w: fmtNum(w)});
    }
    return t('load.plain', {w: fmtNum(w)});
  });
}

/* 给耳机念的文字：把"3 × 12 @ 40 磅"这类写法换成好听的说法 */
export function speakable(s) {
  if (isEn()) return String(s || '')
    .replace(/(\d+)\s*×\s*(\d+(?:\s*[–-]\s*\d+)?)/g, (_, a, b) => `${a} sets of ${b}`)
    .replace(/\s*@\s*/g, ', ')
    .replace(/(\d)\s*[–-]\s*(\d)/g, '$1 to $2')
    .replace(/\blb\b/g, 'pounds')
    .replace(/\s*[（(]\s*/g, ', ').replace(/\s*[）)]\s*/g, ', ')
    .replace(/,\s*,/g, ',').replace(/,\s*([.;])/g, '$1').replace(/,\s*$/, '');
  return String(s || '')
    .replace(/(\d+)\s*×\s*(\d+(?:\s*[–-]\s*\d+)?)/g, (_, a, b) => `${a} 组，每组 ${b} 次`)
    .replace(/\s*@\s*/g, '，')
    .replace(/(\d)\s*[–-]\s*(\d)/g, '$1 到 $2')
    .replace(/[（(]/g, '，').replace(/[）)]/g, '，')
    .replace(/，\s*，/g, '，').replace(/，\s*([。；])/g, '$1');
}

/* 一个动作的朗读稿：名字、单边、目标、杠铃片、设置、动作、要点 */
export function exerciseSpeech(ex, plates) {
  const f = k => loc(ex, k); // 英文界面优先 ex.en[k]
  const strip = s => String(s || '').replace(/[。.]\s*$/, '');
  const parts = [strip(f('name').replace(/[（(].*?[）)]/g, ''))];
  if (f('side')) parts.push(strip(f('side')));
  if (f('target')) parts.push(t('say.target') + strip(f('target')));
  for (const l of loadLines(ex.load, plates)) parts.push(l);
  if (f('setup')) parts.push(t('say.setup') + strip(f('setup')));
  if (f('action')) parts.push(t('say.action') + strip(f('action')));
  if (f('cues')) parts.push(t('say.cues') + strip(f('cues')));
  const sep = t('say.sep');
  return speakable(parts.join(sep) + sep.trim());
}

/* 按星期几选默认的训练日；当天没有安排就取下一个有安排的日子 */
export function defaultDayId(plan, date = new Date()) {
  const wd = date.getDay(); // 0 = 周日
  const days = plan.days.filter(d => Number.isInteger(d.weekday));
  if (!days.length) return plan.days[0] && plan.days[0].id;
  for (let k = 0; k < 7; k++) { const d = days.find(x => x.weekday === (wd + k) % 7); if (d) return d.id; }
  return days[0].id;
}

/* 计划里所有视频编号（去重，按出现顺序） */
export function allVideoIds(plan) {
  const out = [];
  for (const d of plan.days) for (const ex of d.exercises) for (const v of ex.videos || []) if (!out.includes(v)) out.push(v);
  return out;
}

/* 从文件名里认出视频编号：IMG_0688.MOV、img_0688(1).mov、0688.mp4 都算 0688 */
export function matchVideoId(fileName, ids) {
  const m = String(fileName).match(/(\d{3,5})/g);
  if (!m) return null;
  for (const id of ids) { const num = id.replace(/\D/g, ''); if (m.includes(num)) return id; }
  return null;
}

/* 检查导入的计划文件。返回错误说明，没问题返回 null */
export function validatePlan(j) {
  if (!j || j.app !== PLAN_APP) return t('plan.bad');
  if (!Array.isArray(j.days) || !j.days.length) return t('plan.noDays');
  for (const d of j.days) {
    if (!d.id || !d.name || !Array.isArray(d.exercises)) return t('plan.badDay', {name: d.name || d.id || '?'});
    for (const ex of d.exercises) if (!ex.id || !ex.name) return t('plan.noName', {name: d.name});
  }
  return null;
}
