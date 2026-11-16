// 运行：在 app/ 里 `node --test`；只跑一个：`node --test --test-name-pattern="计次"`
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ang, median, RepCounter, analyzeReference, compareRep, METRICS, CURVE_N, Tracker, kneeForward, resample,
  summarizeSet, formNote, trainingLogRow, TRAINING_LOG_HEADER} from '../src/engine.js';
import {loadFixture, preset, specFor, toSeries} from './helpers.js';

// ---------- 不需要视频的基础测试 ----------

test('ang：直角是 90°，直线是 180°', () => {
  const P = (x, y) => ({x, y});
  assert.equal(Math.round(ang(P(0, 1), P(0, 0), P(1, 0), 100, 100)), 90);
  assert.equal(Math.round(ang(P(0, 1), P(0, 0), P(0, -1), 100, 100)), 180);
  // 画面不是正方形时要按像素算：x 方向拉长后不再是 45°
  assert.equal(Math.round(ang(P(1, 0), P(0, 0), P(1, 1), 100, 100)), 45);
  assert.notEqual(Math.round(ang(P(1, 0), P(0, 0), P(1, 1), 200, 100)), 45);
});

// 合成一段"站直 170° -> 蹲到 60° -> 站起"的膝角曲线
function synthSeries(reps, {rest = 170, far = 60, period = 3, fps = 30, lead = 1} = {}) {
  const out = [];
  const total = lead + reps * period + lead;
  for (let i = 0; i <= total * fps; i++) {
    const t = i / fps, u = t - lead;
    const v = u < 0 || u > reps * period ? rest : rest - (rest - far) * (1 - Math.cos(2 * Math.PI * u / period)) / 2;
    out.push({t, values: {kneeMin: v, trunk: 8}});
  }
  return out;
}

test('RepCounter 计次：合成 5 下就数出 5 下', () => {
  const c = new RepCounter({rest: 170, far: 60});
  const reps = synthSeries(5).map(s => c.push(s.t, s.values.kneeMin, s.values)).filter(Boolean);
  assert.equal(reps.length, 5);
  for (const r of reps) assert.ok(Math.abs(r.farV - 60) < 2, `最远点 ${r.farV}`);
});

test('RepCounter：幅度只到一半的抖动不算一下', () => {
  const c = new RepCounter({rest: 170, far: 60});
  const reps = synthSeries(3, {far: 130}).map(s => c.push(s.t, s.values.kneeMin, s.values)).filter(Boolean);
  assert.equal(reps.length, 0);
});

test('RepCounter：不到 0.6 秒的快速晃动（换脚、调整站位）不算一下', () => {
  const c = new RepCounter({rest: 170, far: 60});
  const series = [];
  for (let i = 0; i <= 30; i++) series.push({t: i / 30, v: 170});                       // 站着
  for (let i = 1; i <= 12; i++) series.push({t: 1 + i / 30, v: 170 - 70 * Math.sin(Math.PI * i / 12)}); // 0.4 秒晃到 100°
  for (let i = 1; i <= 15; i++) series.push({t: 1.4 + i / 30, v: 170});
  const quick = series.map(s => c.push(s.t, s.v, {kneeMin: s.v})).filter(Boolean);
  assert.equal(quick.length, 0);
  // 之后一下正常的仍然能数出来
  const normal = synthSeries(1).map(s => c.push(s.t + 2, s.values.kneeMin, s.values)).filter(Boolean);
  assert.equal(normal.length, 1);
  assert.equal(normal[0].n, 1);
});

test('RepCounter：视频从最低点开始时，开头那半下不算', () => {
  // 先从 60° 站起来（半下），再完整做 2 下
  const s = synthSeries(2, {lead: 1.5});
  const half = [];
  for (let i = 0; i <= 45; i++) { const t = i / 30; half.push({t, values: {kneeMin: 60 + (170 - 60) * t / 1.5, trunk: 8}}); }
  const series = half.concat(s.map(x => ({t: x.t + 1.6, values: x.values})));
  const c = new RepCounter({rest: 170, far: 60});
  assert.equal(series.map(x => c.push(x.t, x.values.kneeMin, x.values)).filter(Boolean).length, 2);
  // 预设写明起始位在"大角度"一端，开头在最低点也不会把方向弄反
  const prof = analyzeReference(series, specFor(preset('smith-reverse-lunge')));
  assert.equal(prof.reps, 2);
  assert.ok(prof.rest > prof.far);
});

test('analyzeReference：合成教练示范得出起始位、最远点和次数', () => {
  const spec = specFor(preset('smith-reverse-lunge'));
  const r = analyzeReference(synthSeries(4), spec);
  assert.equal(r.error, undefined);
  assert.equal(r.primary, 'kneeMin');
  assert.equal(r.reps, 4);
  assert.ok(Math.abs(r.rest - 170) < 3 && Math.abs(r.far - 60) < 3);
  assert.ok(Math.abs(r.secondary.trunk - 8) < 0.5);
});

test('analyzeReference：帧太少或幅度太小时给出中文错误', () => {
  const spec = specFor(preset('smith-reverse-lunge'));
  assert.match(analyzeReference(synthSeries(1).slice(0, 10), spec).error, /有效帧太少/);
  assert.match(analyzeReference(synthSeries(3, {far: 165}), spec).error, /动作幅度太小/);
});

test('compareRep：蹲得不够深时第一条问题是幅度', () => {
  const p = preset('smith-reverse-lunge');
  const prof = analyzeReference(synthSeries(4), specFor(p));
  const shallow = {farV: prof.far + 30, restBefore: prof.rest, vals: {trunk: 8}, out: 1.5, back: 1.5};
  const res = compareRep(shallow, prof, p, 1);
  assert.equal(res.issues[0].voice, p.cues.farShort);
  const good = {farV: prof.far, restBefore: prof.rest, vals: {trunk: 8}, out: 1.5, back: 1.5};
  assert.equal(compareRep(good, prof, p, 1).issues.length, 0);
});

// ---------- 第 2 步：新指标、曲线、一组总结、训练记录 ----------

// 造一个侧面站立、面朝右（+x）的人。画面 100×100，单位都是像素/100
function standing({headFwd = 0, kneeFwdPx = 0} = {}) {
  const lm = Array.from({length: 33}, () => ({x: .5, y: .5, z: 0, visibility: 1}));
  const P = (i, x, y) => { lm[i] = {x, y, z: 0, visibility: 1}; };
  for (const [e, s, h, k, a, hl, f] of [[7, 11, 23, 25, 27, 29, 31], [8, 12, 24, 26, 28, 30, 32]]) {
    P(e, .50 + headFwd, .10); P(s, .50, .20); P(h, .50, .50);
    P(k, .50 + kneeFwdPx, .70); P(a, .50, .90); P(hl, .48, .92); P(f, .58, .92);
  }
  P(0, .53 + headFwd, .10); // 鼻子在耳朵前面 = 面朝右
  return lm;
}

test('耳-肩-髋夹角：头和背一条直线是 180°，低头时变小', () => {
  const tr = new Tracker({view: 'side', primary: 'neck', secondary: []});
  assert.equal(Math.round(tr.update(standing(), 100, 100, 0).values.neck), 180);
  const tr2 = new Tracker({view: 'side', primary: 'neck', secondary: []});
  assert.ok(tr2.update(standing({headFwd: .08}), 100, 100, 0).values.neck < 170);
});

test('膝盖超过脚尖：以小腿长为单位，膝盖在脚尖前为正', () => {
  // 脚尖在 x=58px；膝盖移到 (68,70)，脚踝 (50,90) -> 小腿长 √(18²+20²)，超过脚尖 10px
  const want = 10 / Math.hypot(18, 20);
  assert.ok(Math.abs(kneeForward(standing({kneeFwdPx: .18}), 100, 100) - want) < 0.01);
  assert.ok(kneeForward(standing(), 100, 100) < 0);
});

test('resample：不管一下多快多慢，都变成固定长度的曲线', () => {
  const samples = [0, 1, 2, 3, 4].map(t => ({t, vals: {a: t * 10}}));
  const c = resample(samples, ['a'], 5);
  assert.deepEqual(c.a.map(Math.round), [0, 10, 20, 30, 40]);
  assert.equal(resample(samples, ['a']).a.length, CURVE_N);
});

test('曲线对比：最远点一样，但下蹲途中上身前倾，也能抓出来', () => {
  const p = preset('smith-reverse-lunge');
  const prof = analyzeReference(synthSeries(4), specFor(p));
  assert.equal(prof.curves.kneeMin.length, CURVE_N);
  // 一下：幅度和最远点时的躯干都和教练一样，只有下蹲途中躯干倾斜 30°
  const c = new RepCounter({rest: prof.rest, far: prof.far});
  let rep = null;
  for (const s of synthSeries(1)) {
    const u = (s.t - 1) / 3, lean = u > .1 && u < .4 ? 30 : 8;
    rep = c.push(s.t, s.values.kneeMin, {...s.values, trunk: lean}) || rep;
  }
  assert.ok(rep);
  assert.equal(rep.vals.trunk, 8); // 最远点那一帧看不出问题
  const issues = compareRep(rep, prof, p, 1).issues;
  assert.equal(issues[0]?.key, 'trunk', JSON.stringify(issues));
  assert.equal(issues[0].voice, p.cues.trunk.high);
});

test('问题排序：背的问题排在幅度前面', () => {
  const p = preset('smith-reverse-lunge');
  const prof = analyzeReference(synthSeries(4), specFor(p));
  // 幅度差 12°（略超 10°），躯干全程多 14°（略超 10°）
  const c = new RepCounter({rest: prof.rest, far: prof.far});
  let rep = null;
  for (const s of synthSeries(1, {far: 72})) rep = c.push(s.t, s.values.kneeMin, {...s.values, trunk: 22}) || rep;
  const keys = compareRep(rep, prof, p, 1).issues.map(i => i.key);
  assert.deepEqual(keys.slice(0, 2), ['trunk', 'kneeMin']);
});

function fakeRep(n, issues = [], farV = 60) {
  return {n, farV, img: `img${n}`, cmp: {issues: issues.map(([voice, sev = 1.5]) => ({voice, sev, text: voice})), infos: []}};
}

test('一组总结：数出标准的几下、最常见的问题、最好和最差的一下', () => {
  const prof = {primary: 'kneeMin', far: 60, rest: 170};
  const reps = [fakeRep(1), fakeRep(2, [['挺胸', 2]]), fakeRep(3, [['挺胸', 1.2], ['慢一点', 1.1]]), fakeRep(4, [], 63)];
  const s = summarizeSet(reps, prof);
  assert.equal(s.n, 4);
  assert.equal(s.clean, 2);
  assert.deepEqual(s.top[0], {voice: '挺胸', count: 2});
  assert.equal(s.best.n, 1);
  assert.equal(s.worst.n, 3);
  assert.equal(s.speech, '这一组4下，2下标准。主要问题：挺胸，2下；慢一点，1下。');
  assert.equal(summarizeSet([fakeRep(1), fakeRep(2)], prof).speech, '这一组2下，2下标准。全部和教练一致，很好。');
  assert.equal(summarizeSet([], prof).n, 0);
});

test('训练记录行：列顺序和 training_log.csv 一样，逗号和引号会转义', () => {
  assert.equal(TRAINING_LOG_HEADER, 'date,session,exercise,sets,reps,weight_lb,rir,note');
  const s = summarizeSet([fakeRep(1), fakeRep(2, [['挺胸, "别弯腰"']])], {primary: 'kneeMin', far: 60, rest: 170});
  const row = trainingLogRow({date: '2026-11-15', exercise: 'Smith Machine Reverse Lunge', reps: 2, weight_lb: 35, rir: 2, note: formNote(s)});
  assert.equal(row, '2026-11-15,,Smith Machine Reverse Lunge,1,2,35,2,"动作评估 1/2 下标准；挺胸, ""别弯腰"" ×1"');
});

test('机位检查：侧面动作里，正面或背面拍到的那一下不评估，总结里单独说', () => {
  const p = preset('smith-reverse-lunge');
  const prof = analyzeReference(synthSeries(4), specFor(p));
  const mkRep = (view, far) => {
    const c = new RepCounter({rest: prof.rest, far: prof.far}); let rep = null;
    for (const s of synthSeries(1, {far})) rep = c.push(s.t, s.values.kneeMin, {...s.values, viewRatio: view}) || rep;
    rep.cmp = compareRep(rep, prof, p, 1); return rep;
  };
  const back = mkRep(0.6, 100), side = mkRep(0.15, 60), sideShallow = mkRep(0.15, 90);
  assert.equal(back.cmp.skipped, true);
  assert.equal(side.cmp.skipped, undefined);
  assert.equal(side.cmp.issues.length, 0);
  const s = summarizeSet([back, side, sideShallow], prof);
  assert.equal(s.skipped, 1);
  assert.equal(s.clean, 1);
  assert.equal(s.best, side);
  assert.equal(s.speech, `这一组3下，其中1下不是侧面拍的，没有评估。评估的2下里，1下标准。主要问题：${p.cues.farShort}，1下。`);
  assert.match(formNote(s), /^动作评估 1\/2 下标准；1 下机位不对未评估/);
  assert.equal(summarizeSet([back], prof).speech, '这一组1下，其中1下不是侧面拍的，没有评估。手机要放在身体正侧面。');
});

// ---------- 用真实视频导出的关节点（test/fixtures/，不进 git） ----------

const coach = loadFixture('coach-reverse-lunge');

test('教练示范 · 史密斯后撤弓步：识别出 2 下，数值合理', {skip: !coach && '缺少 test/fixtures/coach-reverse-lunge.json，先用 tools/extract.html 导出'}, () => {
  const p = preset('smith-reverse-lunge'), spec = specFor(p);
  const series = toSeries(coach, spec);
  assert.ok(series.length > 150, `有效帧 ${series.length}`);
  const prof = analyzeReference(series, spec);
  assert.equal(prof.error, undefined, prof.error);
  assert.equal(prof.primary, 'kneeMin');
  assert.equal(prof.reps, 2);
  assert.ok(prof.rest > 150, `起始位膝角 ${prof.rest}`);
  assert.ok(prof.far > 30 && prof.far < 80, `最低点膝角 ${prof.far}`);
  assert.ok(prof.tempo.out > 0.8 && prof.tempo.out < 3, `下蹲用时 ${prof.tempo.out}`);
});

test('教练示范 · 拿教练自己的视频按"我来练"跑一遍：2 下都和标准一致', {skip: !coach && '缺少 fixture'}, () => {
  const p = preset('smith-reverse-lunge'), spec = specFor(p);
  const prof = analyzeReference(toSeries(coach, spec), spec);
  const c = new RepCounter({rest: prof.rest, far: prof.far});
  const reps = toSeries(coach, specFor(p, prof)).map(s => c.push(s.t, s.values[prof.primary], s.values)).filter(Boolean);
  assert.equal(reps.length, 2);
  for (const r of reps) {
    const {issues} = compareRep(r, prof, p, 1);
    assert.equal(issues.filter(i => i.key === prof.primary).length, 0, `第 ${r.n} 下：${issues.map(i => i.text).join('；')}`);
  }
  assert.ok(Math.abs(median(reps.map(r => r.farV)) - prof.far) < METRICS.kneeMin.tol);
  // 新指标（背、膝盖前冲）也都和自己一致
  for (const r of reps) assert.deepEqual(compareRep(r, prof, p, 1).issues, []);
  assert.equal(summarizeSet(reps.map(r => ({...r, cmp: compareRep(r, prof, p, 1)})), prof).clean, 2);
});

test('教练示范：新指标在合理范围', {skip: !coach && '缺少 fixture'}, () => {
  const p = preset('smith-reverse-lunge'), spec = specFor(p);
  const prof = analyzeReference(toSeries(coach, spec), spec);
  assert.ok(prof.secondary.neck > 150 && prof.secondary.neck <= 180, `耳-肩-髋 ${prof.secondary.neck}`);
  assert.ok(Math.abs(prof.secondary.kneeFwd) < 1, `膝盖前冲 ${prof.secondary.kneeFwd}`);
  for (const k of ['kneeMin', 'trunk', 'neck', 'kneeFwd']) assert.equal(prof.curves[k].length, CURVE_N);
});

// 用户自己的第一段视频（2026-11-15）：前 15 秒从背后拍，之后换到正侧面
const me1 = loadFixture('me-reverse-lunge-1');

function runSet(prof, p, fx) {
  const c = new RepCounter({rest: prof.rest, far: prof.far}), reps = [];
  for (const x of toSeries(fx, specFor(p, prof))) {
    const r = c.push(x.t, x.values[prof.primary], x.values);
    if (r) { r.cmp = compareRep(r, prof, p, 1); reps.push(r); }
  }
  return reps;
}

// 画面核对过：背后拍时 1 下（另有一个 0.5 秒的晃动不算），换到侧面后 9 下；46 秒左右撤步调整不算
test('我的视频 1：背后拍的 1 下不评估，侧面拍的 9 下都评估', {skip: !(coach && me1) && '缺少 fixture'}, () => {
  const p = preset('smith-reverse-lunge'), spec = specFor(p);
  const reps = runSet(analyzeReference(toSeries(coach, spec), spec), p, me1);
  assert.equal(reps.length, 10);
  assert.deepEqual(reps.filter(r => r.cmp.skipped).map(r => r.n), [1]);
  for (const r of reps.slice(1)) assert.ok(r.start > 15, `第 ${r.n} 下从 ${r.start}s 开始`);
});

// Pexels 6525491：正侧面、徒手、手叉腰；开头在最低点，中间完整 1 下，结尾停在最低点
const pexels = loadFixture('pexels-reverse-lunge-side');

test('Pexels 侧面标准：只认出中间完整的 1 下，是正侧面', {skip: !pexels && '缺少 fixture'}, () => {
  const p = preset('smith-reverse-lunge'), spec = specFor(p);
  const prof = analyzeReference(toSeries(pexels, spec), spec);
  assert.equal(prof.error, undefined);
  assert.equal(prof.reps, 1);
  assert.ok(prof.rest > 165 && prof.far > 60 && prof.far < 85, `${prof.rest} → ${prof.far}`);
  assert.ok(prof.repList[0].samples.every(s => s.vals.viewRatio < 0.25), '应是正侧面');
});

// 11/15 用户反馈：后膝已经贴地，点评还一直说"再低一点"。原因：后腿被史密斯机挡住，
// 识别把两条腿都标在前腿上，"较弯那条腿的膝角"其实是前腿的 ~90°，和徒手标准的 71° 比就差了 20°
test('后撤弓步的深度看前腿大腿是否水平：后腿被挡住时不再误报"再往下蹲"', {skip: !(pexels && me1) && '缺少 fixture'}, () => {
  const p = preset('smith-reverse-lunge'), spec = specFor(p);
  const prof = analyzeReference(toSeries(pexels, spec), spec);
  const done = runSet(prof, p, me1).filter(r => !r.cmp.skipped);
  assert.equal(done.length, 9);
  for (const r of done) {
    assert.ok(r.cmp.depth <= p.depth.ok, `第 ${r.n} 下前腿大腿 ${r.cmp.depth}°`);
    assert.equal(r.cmp.issues.filter(i => i.voice === p.cues.farShort).length, 0, `第 ${r.n} 下：${r.cmp.issues.map(i => i.text)}`);
  }
  assert.ok(done.filter(r => r.cmp.legHidden).length >= 6, '大部分几下应识别出后腿被挡住');
  const s = summarizeSet(done, prof);
  assert.ok(s.depthMedian < 15);
  assert.ok(!/往下蹲/.test(s.speech), s.speech);
});

test('两条腿都看得到的视频不会被标成"看不到后腿"', {skip: !(pexels && coach) && '缺少 fixture'}, () => {
  const p = preset('smith-reverse-lunge'), spec = specFor(p);
  const prof = analyzeReference(toSeries(pexels, spec), spec);
  for (const fx of [pexels, coach]) for (const r of runSet(prof, p, fx)) assert.equal(r.cmp.legHidden, false);
});

test('深度不够时按前腿大腿报问题', () => {
  const p = preset('smith-reverse-lunge');
  const prof = analyzeReference(synthSeries(4), specFor(p));
  const mk = thigh => {
    const c = new RepCounter({rest: prof.rest, far: prof.far}); let rep = null;
    for (const s of synthSeries(1)) {
      const u = Math.min(1, Math.max(0, (s.t - 1) / 3)), down = Math.sin(Math.PI * u); // 0 站立 → 1 最低
      rep = c.push(s.t, s.values.kneeMin, {...s.values, frontThigh: 80 - (80 - thigh) * down, legGap: 0.2 + 1.2 * down}) || rep;
    }
    return compareRep(rep, prof, p, 1);
  };
  const shallow = mk(35);
  assert.equal(shallow.issues[0].key, 'depth');
  assert.match(shallow.issues[0].text, /前腿大腿离水平还差 3\d°/);
  const deep = mk(5);
  assert.equal(deep.issues.filter(i => i.key === 'depth').length, 0);
  assert.equal(deep.legHidden, false);
});

test('我的视频 1 对 Pexels 侧面标准：9 下都评估，撤步调整不算一下，不再提示低头', {skip: !(pexels && me1) && '缺少 fixture'}, () => {
  const p = preset('smith-reverse-lunge'), spec = specFor(p);
  const prof = analyzeReference(toSeries(pexels, spec), spec);
  const reps = runSet(prof, p, me1);
  const done = reps.filter(r => !r.cmp.skipped);
  assert.equal(done.length, 9);
  assert.ok(done.every(r => r.out + r.back > 1.5), '每一下都应是完整动作');
  assert.equal(done.filter(r => r.cmp.issues.some(i => i.key === 'neck')).length, 0);
});
