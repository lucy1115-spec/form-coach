// HIIT（Ultra Fit：跑步机分段 + BOSU 动作）：动作库、每周组合、跟练计时流程。纯逻辑，Node 能测。
// 11/21 用户要求：HIIT 日打开 App 就看到；跟练计时器；转换不计时（拿器械、换姿势时间不定，点"准备好了"才开始）；
// BOSU 动作每周换一套，可以单个换；动作有示范（BOSU 官网的 Vimeo 短视频，用官方播放器嵌入，不下载）。
// 用户自己的动作（单腿 RDL + 对侧划船、单臂抓举）和分段结构是私人内容，放在计划文件里（plan.hiit），不在这个公开仓库。

/* BOSU 官网（bosu.com/pages/exercise-videos）的动作，视频在 Vimeo 上、允许嵌入。cat：glute 臀部 / cardio 心肺 / core 核心 */
export const BOSU_LIBRARY = [
  {id: 'glute-buster', vimeo: '321279744', cat: 'glute', zh: '臀部强化组合', en: 'Glute Buster'},
  {id: 'fire-hydrant', vimeo: '297960526', cat: 'glute', zh: '消防栓抬腿', en: 'Fire Hydrant with Leg Drop', perSide: true},
  {id: 'glute-drop', vimeo: '297960628', cat: 'glute', zh: '臀部下压', en: 'Glute Drop', perSide: true},
  {id: 'curtsy-lunge', vimeo: '321280010', cat: 'glute', zh: '侧弓步 + 交叉弓步', en: 'Side Curtsy Lunge Combination', perSide: true},
  {id: 'reverse-plank', vimeo: '230974921', cat: 'glute', zh: '反向平板', en: 'BOSU Reverse Plank'},
  {id: 'lateral-crossovers', vimeo: '136135592', cat: 'cardio', zh: '侧向跨越', en: 'Lateral Crossovers'},
  {id: 'lateral-taps', vimeo: '136512420', cat: 'cardio', zh: '快速侧点', en: 'Quick Lateral Taps'},
  {id: 'mountain-climber', vimeo: '316179830', cat: 'cardio', zh: '登山者', en: 'Mt. Climber'},
  {id: 'forearm-plank', vimeo: '309150092', cat: 'core', zh: '前臂平板支撑', en: 'Forearm Plank'},
  {id: 'knee-cross-touch', vimeo: '232539778', cat: 'core', zh: '跪姿平衡对侧触碰', en: 'Knee Balance Cross-Touch'},
  {id: 'plank-walk', vimeo: '228810093', cat: 'core', zh: '四方向平板移动', en: 'Four Quadrant Plank Walk'},
  {id: 'v-sit-tuck', vimeo: '242073274', cat: 'core', zh: 'V 字坐收腹', en: 'V-Sit to Core Tuck'},
  {id: 'oblique-twist', vimeo: '231069528', cat: 'core', zh: '坐姿侧腹转体', en: 'Seated Oblique Tap Twist'},
  {id: 'stand-v-sit', vimeo: '350159622', cat: 'core', zh: '站起到 V 字坐', en: 'BOSU Stand to V-Sit'},
];

/* 全部动作 = BOSU 官网的 + 计划文件里用户自己的（cat 'mine'） */
export function allMoves(plan) {
  const mine = ((plan && plan.hiit && plan.hiit.myMoves) || []).map(m => ({...m, cat: 'mine'}));
  return BOSU_LIBRARY.concat(mine);
}

/* 周一开始的一周，用作"本周"的钥匙：2026-11-23 */
export function weekKey(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* 可重复的伪随机（同一周排出来一样） */
function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
const shuffle = (arr, r) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* 排一套组合：n 段，每段 [臀部/心肺/我的动作 之一, 核心]。
   pool = 勾选的动作 id；avoid = 上周用过的（尽量不重复）。返回 [[idA, idB], ...] */
export function buildLineup(moves, {n = 5, pool = null, seed = 'x', avoid = []} = {}) {
  const r = rng(seed);
  const ok = m => !pool || pool.includes(m.id);
  const pick = (list, k) => { // 先用上周没用过的，不够再用用过的
    const fresh = shuffle(list.filter(m => !avoid.includes(m.id)), r), used = shuffle(list.filter(m => avoid.includes(m.id)), r);
    const out = [], src = fresh.concat(used);
    for (let i = 0; i < k && src.length; i++) out.push(src[i % src.length].id);
    return out;
  };
  const a = pick(moves.filter(m => m.cat !== 'core' && ok(m)), n), b = pick(moves.filter(m => m.cat === 'core' && ok(m)), n);
  return Array.from({length: n}, (_, i) => [a[i] || null, b[i] || null].filter(Boolean));
}

/* 换一个：同类里换成组合里还没有的动作；没得换就原样 */
export function swapMove(moves, lineup, seg, slot, pool = null) {
  const cur = moves.find(m => m.id === lineup[seg][slot]); if (!cur) return lineup;
  const inUse = new Set(lineup.flat());
  const same = m => (cur.cat === 'core' ? m.cat === 'core' : m.cat !== 'core');
  const cands = moves.filter(m => same(m) && !inUse.has(m.id) && (!pool || pool.includes(m.id)));
  if (!cands.length) return lineup;
  const i = (moves.indexOf(cur) * 7 + seg * 3 + slot) % cands.length;
  return lineup.map((s, k) => (k === seg ? s.map((x, j) => (j === slot ? cands[i].id : x)) : s));
}

/* 跟练流程：热身 → 每段[跑步机 → BOSU 动作 × 2] → 冲刺。
   segments = 计划里的分段 [{speed, sec, reps?, rest?}]；最后一段有 reps 就是冲刺（每次之间休息）。
   每一步：{kind:'warm'|'run'|'rest'|'bosu'|'cool', sec, speed?, move?, seg, wait} —— wait=true 表示开始前要等用户点"准备好了"（转换不计时） */
export function buildFlow(hiit, lineup) {
  const steps = [];
  if (hiit.warmupSec) steps.push({kind: 'warm', sec: hiit.warmupSec, seg: 0, wait: true});
  (hiit.segments || []).forEach((g, i) => {
    const reps = g.reps || 1;
    for (let k = 0; k < reps; k++) {
      steps.push({kind: 'run', sec: g.sec, speed: g.speed, seg: i + 1, rep: reps > 1 ? k + 1 : null, reps: reps > 1 ? reps : null, wait: k === 0});
      if (reps > 1 && k < reps - 1 && g.rest) steps.push({kind: 'rest', sec: g.rest, seg: i + 1, wait: false});
    }
    const pair = lineup[i] || [];
    if (!g.noBosu) for (const id of pair) steps.push({kind: 'bosu', sec: hiit.bosuSec || 60, move: id, seg: i + 1, wait: true});
  });
  if (hiit.cooldownSec) steps.push({kind: 'cool', sec: hiit.cooldownSec, seg: (hiit.segments || []).length + 1, wait: true});
  return steps;
}

export const flowMinutes = steps => Math.round(steps.reduce((s, x) => s + x.sec, 0) / 60);
