// 运行：在 app/ 里 `node --test`；只跑一个：`node --test --test-name-pattern="计次"`
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ang, median, RepCounter, analyzeReference, compareRep, METRICS} from '../src/engine.js';
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
});
