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

/* ---------- 记一组 ----------
   每组记：重量（或辅助级别）、次数、感受。感受用 4 个表情，对应留几次余力（RIR），写进训练记录的 rir 列。 */
export const FEELS = [
  {id: 'easy', emoji: '😌', rir: 3},
  {id: 'ok', emoji: '🙂', rir: 2},
  {id: 'hard', emoji: '😣', rir: 1},
  {id: 'fail', emoji: '😵', rir: 0},
];
export const feelById = id => FEELS.find(f => f.id === id) || null;

const num = s => (s == null || s === '' ? null : Number(s));
// "轻松就加到…""做到 3 × 15 再…"这类是条件，不是今天要做的组
const CONDITIONAL = /轻松|做到|再加|再用|再回到|后加到|就最后|if easy|once/i;

/* 从计划目标文字（中文）读出今天每一组：[{warm, w, r, rMax}]，unit 是 'lb' 或 'level'。
   认得：3 × 10–12 @ 25–30 磅、热身 1 × 15、热身 20 磅、12 @ 7 级、2 组 @ 3–5 磅。重量是范围时取小的。
   读不出来就给 3 组空白，用户自己填。计划里写了 ex.log.sets 就直接用。 */
export function parseTarget(text) {
  const s = String(text || '');
  const unit = /级/.test(s) ? 'level' : 'lb';
  const sets = [];
  for (const seg of s.split(/[；;，,、]/)) {
    if (CONDITIONAL.test(seg)) continue;
    const warm = /热身/.test(seg);
    let m = seg.match(/(\d+)\s*×\s*(\d+)(?:\s*[–-]\s*(\d+))?(?:\s*@\s*(\d+(?:\.\d+)?)(?:\s*[–-]\s*\d+(?:\.\d+)?)?)?/);
    if (m) { for (let i = 0; i < +m[1]; i++) sets.push({warm, w: num(m[4]), r: +m[2], rMax: num(m[3]) ?? +m[2]}); continue; }
    m = seg.match(/(\d+)(?:\s*[–-]\s*(\d+))?\s*@\s*(\d+(?:\.\d+)?)\s*级/);
    if (m) { sets.push({warm, w: +m[3], r: +m[1], rMax: num(m[2]) ?? +m[1]}); continue; }
    m = seg.match(/(\d+)\s*[组轮]\s*@\s*(\d+(?:\.\d+)?)/);
    if (m) { for (let i = 0; i < +m[1]; i++) sets.push({warm, w: +m[2], r: null, rMax: null}); continue; }
    m = seg.match(/(\d+(?:\.\d+)?)\s*磅/);
    if (warm && m) { sets.push({warm: true, w: +m[1], r: null, rMax: null}); continue; }
    m = seg.match(/(\d+)\s*[组轮]/);
    if (m && !sets.length) for (let i = 0; i < +m[1]; i++) sets.push({warm, w: null, r: null, rMax: null});
  }
  // "3 组，每边 12 步"：次数写在别的段里
  const steps = s.match(/(\d+)\s*步/);
  if (steps) for (const x of sets) if (x.r == null) { x.r = +steps[1]; x.rMax = x.r; }
  // 热身没写次数：用正式组的次数
  const main = sets.find(x => !x.warm && x.r);
  for (const x of sets) if (x.warm && x.r == null && main) { x.r = main.r; x.rMax = main.r; }
  return {sets: sets.length ? sets : [1, 2, 3].map(() => ({warm: false, w: null, r: null, rMax: null})), unit};
}

export function setDefaults(ex) {
  if (ex && ex.log && Array.isArray(ex.log.sets)) return {unit: ex.log.unit || 'lb', sets: ex.log.sets.map(x => ({warm: !!x.warm, w: num(x.w), r: num(x.r), rMax: num(x.rMax) ?? num(x.r)}))};
  const d = parseTarget(ex && ex.target);
  // 杠铃热身没写重量：空杆
  if (ex && ex.load && ex.load.kind === 'barbell') for (const x of d.sets) if (x.warm && x.w == null) x.w = ex.load.bar ?? 35;
  return d;
}

/* +/− 一下加减多少：级别 1；杠铃 / 史密斯 5 磅（每边 2.5）；其他 25 磅以下 2.5，以上 5 */
export function weightStep(unit, w, kind) {
  if (unit === 'level') return 1;
  if (kind === 'barbell' || kind === 'smith') return 5;
  return w != null && w < 25 ? 2.5 : 5;
}

/* 休息多久（秒）：杠铃 / 史密斯 2 分钟，其他 75 秒 */
export const restSeconds = ex => (ex && ex.load && (ex.load.kind === 'barbell' || ex.load.kind === 'smith') ? 120 : 75);

/* 下次建议（双重进阶）。done = 这次记的组 [{warm, w, r, feel}]，plan = setDefaults 的结果。
   - 组数没做完、有一组"做不完"、或次数没到下限 → 保持
   - 正式组都做到上限、感受都是轻松或刚好 → 加重（级别：试更难一级）；计划写了不加重 → 保持
   - 其他 → 保持重量，争取多做 1 次 */
export function suggestNext(ex, done, plan = setDefaults(ex)) {
  const work = (done || []).filter(x => !x.warm && x.r != null);
  if (!work.length) return null;
  const tgt = plan.sets.filter(x => !x.warm);
  // 第 i 个正式组和计划里第 i 个正式组比（多做的组按最后一组算）
  const tg = i => tgt[Math.min(i, tgt.length - 1)] || {};
  const ws = work.map(x => x.w).filter(x => x != null), wTop = ws.length ? Math.max(...ws) : null;
  const unit = plan.unit, step = weightStep(unit, wTop, ex && ex.load && ex.load.kind);
  const fmt = v => (v == null ? '' : unit === 'level' ? t('log.level', {n: v}) : t('log.lb', {n: v}));
  // 辅助级别每组可能不同（7 级、6 级、6 级）：保持时按顺序列出用过的级别
  const held = unit === 'level' && new Set(ws).size > 1 ? [...new Set(ws)].map(fmt).join(' / ') : fmt(wTop);
  // 计划的组没做完，不加重
  if (work.length < tgt.length) return {kind: 'hold', text: t('next.hold', {w: held})};
  if (work.some(x => x.feel === 'fail') || work.some((x, i) => tg(i).r != null && x.r < tg(i).r)) return {kind: 'hold', text: t('next.hold', {w: held})};
  const allTop = work.every((x, i) => tg(i).rMax != null && x.r >= tg(i).rMax);
  const allOk = work.every(x => x.feel === 'easy' || x.feel === 'ok');
  if (allTop && allOk) {
    if (/不加重|不再加重|不追重量|不变|就停/.test(String(ex && ex.target))) return {kind: 'keep', text: t('next.keep', {w: held})};
    if (unit === 'level') return {kind: 'up', text: t('next.levelUp')};
    if (wTop == null) return {kind: 'up', text: t('next.upNoW')};
    return {kind: 'up', w: wTop + step, text: t('next.up', {w: fmt(wTop + step)})};
  }
  return {kind: 'reps', text: t('next.reps', {w: held})};
}

/* 训练记录的行（和 data/training_log.csv 同一套列）：每组一行，sets=1。
   动作名用中文（和电脑上的记录一致），session 是训练日名字；级别写在 note，weight_lb 留空。 */
export function sessionRows(session, plan) {
  const rows = [];
  const find = id => { for (const d of plan.days) { const e = d.exercises.find(x => x.id === id); if (e) return {d, e}; } return null; };
  for (const [exId, sets] of Object.entries(session.sets || {})) {
    const hit = find(exId), unit = hit ? setDefaults(hit.e).unit : 'lb';
    for (const x of sets) {
      const f = feelById(x.feel);
      const note = [x.warm ? '热身' : '', unit === 'level' && x.w != null ? `${x.w} 级` : '', f ? `${f.emoji} ${FEEL_ZH[f.id]}` : '', x.note || ''].filter(Boolean).join('；');
      // 训练日写这一组实际练的那天（从别的训练日加进来的动作也算今天的训练日）
      const done = x.day && plan.days.find(d => d.id === x.day);
      rows.push({date: session.date, session: done ? done.name : hit ? hit.d.name : '', exercise: hit ? hit.e.name : exId, sets: 1, reps: x.r ?? '',
        weight_lb: unit === 'level' ? '' : (x.w ?? ''), rir: f ? f.rir : '', note});
    }
  }
  return rows;
}
// 训练记录里的感受固定写中文（和电脑上其他记录一致）
const FEEL_ZH = {easy: '轻松', ok: '刚好', hard: '吃力', fail: '做不完'};

/* ---------- 训练日按顺序轮换（11/20 用户要求：不按星期几，按"上次练了哪天，今天练下一个"） ---------- */

/* 去掉名字里的星期："周一 · 下肢" → "下肢"；tabs 用短的（再去掉括号）："全身（史密斯机）" → "全身" */
export function dayTitle(d) {
  const n = String(loc(d, 'name') || '');
  const i = n.indexOf(' · ');
  return i >= 0 ? n.slice(i + 3) : n;
}
export const dayTab = d => dayTitle(d).replace(/\s*[（(].*?[）)]\s*/g, '').trim() || dayTitle(d);

/* 计划里排在它后面的那一天（最后一天之后回到第一天） */
export function nextDayId(plan, lastId) {
  const i = plan.days.findIndex(d => d.id === lastId);
  return plan.days[(i + 1) % plan.days.length].id;
}

/* 记一次训练：history 是 [{date, dayId, at}]，同一天只留一条（练得最多的那一天，最后一组的时间）。
   今天一组都没有了（全删了）就去掉今天那条。返回新的 history（最多留 30 条） */
export function recordWorkout(history, {date, dayId, at}) {
  const out = (history || []).filter(h => h.date !== date);
  if (dayId) out.push({date, dayId, at});
  return out.slice(-30);
}

/* 打开 App 时默认选哪一天：
   - 今天已经练了 → 今天练的那一天
   - 以前练过 → 上次那一天的下一天（轮换）
   - 从没练过 → 按星期几（defaultDayId）
   gapHours：今天还没练、离上次训练过了几小时（给"不到 48 小时"的提醒用），没有就是 null */
export function pickDay(plan, history, now = new Date(), today) {
  const h = (history || []).filter(x => plan.days.some(d => d.id === x.dayId));
  const last = h[h.length - 1];
  if (!last) return {id: defaultDayId(plan, now), gapHours: null, last: null};
  if (last.date === today) return {id: last.dayId, gapHours: null, last};
  return {id: nextDayId(plan, last.dayId), gapHours: (now - new Date(last.at)) / 3600000, last};
}
