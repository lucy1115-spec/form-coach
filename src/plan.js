// 训练计划：纯逻辑（不碰 DOM，Node 能测）。
// 计划本身是用户的私人内容，不在这个公开仓库里：由 coach/plan/app-plan.json 生成，放到 Google Drive，
// 手机上"导入训练计划"后存在本机。格式见 validatePlan()。

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
const fmtPlates = ps => ps.length ? ps.map(fmtNum).join(' + ') + ' 磅' : '不加片';

/* 杠铃片说明，每个目标重量一行。load = {kind:'barbell', bar, weights} | {kind:'smith', weights} */
export function loadLines(load, plates = DEFAULT_PLATES) {
  if (!load || !Array.isArray(load.weights)) return [];
  return load.weights.map(w => {
    if (load.kind === 'barbell') {
      const bar = load.bar ?? 35, ps = platesPerSide((w - bar) / 2, plates);
      return ps ? `${fmtNum(w)} 磅 = 杠铃 ${fmtNum(bar)} 磅 + 每边 ${fmtPlates(ps)}` : `${fmtNum(w)} 磅（杠铃 ${fmtNum(bar)} 磅，片凑不出来，按手边的片调整）`;
    }
    if (load.kind === 'smith') {
      const ps = platesPerSide(w / 2, plates);
      return ps ? `加片共 ${fmtNum(w)} 磅 = 每边 ${fmtPlates(ps)}（不含杆）` : `加片共 ${fmtNum(w)} 磅（不含杆）`;
    }
    return `${fmtNum(w)} 磅`;
  });
}

/* 给耳机念的文字：把"3 × 12 @ 40 磅"这类写法换成好听的说法 */
export function speakable(s) {
  return String(s || '')
    .replace(/(\d+)\s*×\s*(\d+(?:\s*[–-]\s*\d+)?)/g, (_, a, b) => `${a} 组，每组 ${b} 次`)
    .replace(/\s*@\s*/g, '，')
    .replace(/(\d)\s*[–-]\s*(\d)/g, '$1 到 $2')
    .replace(/[（(]/g, '，').replace(/[）)]/g, '，')
    .replace(/，\s*，/g, '，').replace(/，\s*([。；])/g, '$1');
}

/* 一个动作的朗读稿：名字、单边、目标、杠铃片、设置、动作、要点 */
export function exerciseSpeech(ex, plates) {
  const parts = [ex.name.replace(/[（(].*?[）)]/g, '')];
  if (ex.side) parts.push(ex.side);
  if (ex.target) parts.push('目标：' + ex.target);
  for (const l of loadLines(ex.load, plates)) parts.push(l);
  if (ex.setup) parts.push('设置：' + ex.setup);
  if (ex.action) parts.push('动作：' + ex.action);
  if (ex.cues) parts.push('要点：' + ex.cues);
  return speakable(parts.join('。').replace(/。。/g, '。'));
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
  if (!j || j.app !== PLAN_APP) return '这不是训练计划文件（应该是 coach/plan/app-plan.json 生成的那个）。';
  if (!Array.isArray(j.days) || !j.days.length) return '计划里没有训练日。';
  for (const d of j.days) {
    if (!d.id || !d.name || !Array.isArray(d.exercises)) return `训练日格式不对：${d.name || d.id || '?'}`;
    for (const ex of d.exercises) if (!ex.id || !ex.name) return `${d.name} 里有动作缺名字。`;
  }
  return null;
}
