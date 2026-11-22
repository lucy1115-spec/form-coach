// HIIT：每周组合、换动作、跟练流程
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BOSU_LIBRARY, allMoves, weekKey, buildLineup, swapMove, buildFlow, flowMinutes} from '../src/hiit.js';

const plan = {hiit: {myMoves: [{id: 'sl-rdl-row', zh: '单腿 RDL + 对侧划船'}, {id: 'db-snatch', zh: '单臂哑铃抓举'}]}};
const moves = allMoves(plan);

test('动作库：14 个 BOSU 官网动作 + 用户自己的 2 个；核心 6 个', () => {
  assert.equal(moves.length, 16);
  assert.equal(BOSU_LIBRARY.filter(m => m.cat === 'core').length, 6);
  assert.ok(BOSU_LIBRARY.every(m => /^\d+$/.test(m.vimeo) && m.zh && m.en));
  assert.equal(new Set(moves.map(m => m.id)).size, 16);
});

test('本周钥匙：周一', () => {
  assert.equal(weekKey(new Date(2026, 10, 21)), '2026-11-16'); // 周六 → 那周的周一
  assert.equal(weekKey(new Date(2026, 10, 23)), '2026-11-23');
  assert.equal(weekKey(new Date(2026, 10, 29)), '2026-11-23'); // 周日还算这一周
});

test('组合：5 段，每段一个非核心 + 一个核心，不重复；同一周排出来一样；尽量避开上周', () => {
  const a = buildLineup(moves, {seed: '2026-11-23'});
  assert.equal(a.length, 5);
  for (const [x, y] of a) {
    assert.notEqual(moves.find(m => m.id === x).cat, 'core');
    assert.equal(moves.find(m => m.id === y).cat, 'core');
  }
  assert.equal(new Set(a.flat()).size, 10);
  assert.deepEqual(buildLineup(moves, {seed: '2026-11-23'}), a);
  const b = buildLineup(moves, {seed: '2026-11-30', avoid: a.flat()});
  const firsts = b.map(s => s[0]);
  assert.ok(firsts.filter(x => a.flat().includes(x)).length <= 0, '非核心有 10 个，上周用过 5 个，这周应该全换');
  // 只勾了几个：按勾选的排
  const c = buildLineup(moves, {seed: 's', pool: ['glute-buster', 'forearm-plank', 'sl-rdl-row', 'plank-walk']});
  assert.ok(c.flat().every(x => ['glute-buster', 'forearm-plank', 'sl-rdl-row', 'plank-walk'].includes(x)));
});

test('换一个：同类、不和组合里已有的重复', () => {
  const a = buildLineup(moves, {seed: 'w'});
  const b = swapMove(moves, a, 2, 1);
  assert.notEqual(b[2][1], a[2][1]);
  assert.equal(moves.find(m => m.id === b[2][1]).cat, 'core');
  assert.ok(!a.flat().includes(b[2][1]));
  assert.deepEqual(b[0], a[0]);
});

test('跟练流程：热身、每段跑步机后两个 BOSU、冲刺 3 次中间休息；转换要等用户', () => {
  const hiit = {warmupSec: 300, bosuSec: 60, segments: [{speed: '5–6', sec: 180}, {speed: '7', sec: 120}, {speed: '10', sec: 30, reps: 3, rest: 45}]};
  const lineup = [['glute-buster', 'forearm-plank'], ['fire-hydrant', 'plank-walk']];
  const f = buildFlow(hiit, lineup);
  assert.deepEqual(f.map(s => s.kind), ['warm', 'run', 'bosu', 'bosu', 'run', 'bosu', 'bosu', 'run', 'rest', 'run', 'rest', 'run']);
  assert.equal(f[2].move, 'glute-buster');
  assert.ok(f[2].wait && f[3].wait && f[1].wait);
  assert.equal(f[9].wait, false); // 冲刺第 2 次：休息完直接开始
  assert.equal(f[11].rep, 3);
  assert.equal(flowMinutes(f), 17); // 300 + 180 + 120 + 120 + 120 + 30×3 + 45×2 秒
});

const real = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plan/app-plan.json');
test('真实计划：HIIT 分段能排出流程，用户自己的动作有中英文', {skip: !fs.existsSync(real) && '没有 coach/plan/app-plan.json'}, () => {
  const p = JSON.parse(fs.readFileSync(real, 'utf8'));
  if (!p.hiit) return;
  const all = allMoves(p), f = buildFlow(p.hiit, buildLineup(all, {seed: 'x'}));
  assert.ok(f.length > 10 && flowMinutes(f) >= 25 && flowMinutes(f) <= 50, String(flowMinutes(f)));
  for (const m of p.hiit.myMoves || []) assert.ok(m.zh && m.en && m.cue && m.cueEn, m.id);
});
