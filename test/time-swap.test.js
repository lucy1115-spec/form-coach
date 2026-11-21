// 时间不够时精简今天的动作；换一个动作
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {exerciseMinutes, trimForTime, swapExercise, sessionRows, setDefaults} from '../src/plan.js';

const mon = [
  {id: 'kick', name: '后踢', target: '2 × 12 @ 7.5 磅'},
  {id: 'thrust', name: '臀推', target: '热身 1 × 15；3 × 10 @ 105 磅', load: {kind: 'barbell', bar: 35, weights: [105]}},
  {id: 'rdl', name: 'RDL', target: '热身 1 × 15，3 × 10 @ 85 磅', load: {kind: 'barbell', bar: 35, weights: [85]}},
  {id: 'press', name: '腿举', target: '3 × 15 @ 100 磅'},
  {id: 'abd', name: '外展', target: '3 × 12 @ 40 磅'},
  {id: 'add', name: '内收', target: '2 × 15 @ 35 磅', optional: true}];

test('估时：杠铃动作休息长，所以更花时间', () => {
  assert.equal(exerciseMinutes(mon[0]), 1.5 + 2 * 2);      // 75 秒休息
  assert.equal(exerciseMinutes(mon[1]), 1.5 + 4 * 2.75);   // 120 秒休息，含热身组
});

test('时间够：不去掉；不限时间：不去掉', () => {
  assert.deepEqual(trimForTime(mon, 60).skip, []);
  assert.deepEqual(trimForTime(mon, null).skip, []);
});

test('时间不够：先去可选，再从后往前；超出 10% 以内算够', () => {
  const r = trimForTime(mon, 30);
  assert.deepEqual(r.skip, ['add', 'abd', 'press']);
  assert.equal(r.full, 51);
  assert.ok(r.total <= 33);
  assert.deepEqual(trimForTime(mon, 45).skip, ['add']);
  assert.deepEqual(trimForTime(mon, 40).skip, ['add', 'abd']);
});

test('已经记过组的动作不去掉；至少留一个', () => {
  assert.ok(!trimForTime(mon, 30, ['abd']).skip.includes('abd'));
  assert.equal(trimForTime(mon, 1).skip.length, mon.length - 1);
});

test('换动作：用替代的名字和目标，不用杠铃片；记录记在替代动作名下', () => {
  const ex = swapExercise(mon[1], {name: 'Glute Drive 臀推机', target: '3 × 10–12 @ 85 磅', en: {name: 'Glute Drive machine'}});
  assert.equal(ex.name, 'Glute Drive 臀推机');
  assert.equal(ex.load, null);
  assert.equal(ex.swappedFrom, '臀推');
  assert.deepEqual(setDefaults(ex).sets.map(s => `${s.w}x${s.r}-${s.rMax}`), ['85x10-12', '85x10-12', '85x10-12']);
  assert.equal(swapExercise(mon[1], null), mon[1]);
  // 自己写的名字：沿用原来的组数和次数，重量空着
  assert.deepEqual(setDefaults(swapExercise(mon[1], {name: '臀推机'})).sets.map(s => `${s.warm ? 'W' : ''}${s.w}x${s.r}`), ['Wnullx15', 'nullx10', 'nullx10', 'nullx10']);
  const plan = {days: [{id: 'mon', name: '周一 · 下肢', exercises: mon}]};
  const rows = sessionRows({date: '2026-11-21', sets: {thrust: [{w: 85, r: 12, feel: 'ok', name: 'Glute Drive 臀推机', from: '臀推'}]}}, plan);
  assert.equal(rows[0].exercise, 'Glute Drive 臀推机');
  assert.equal(rows[0].note, '替代臀推；🙂 刚好');
});

const real = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plan/app-plan.json');
test('真实计划：每天的估时和计划写的分钟数差不多', {skip: !fs.existsSync(real) && '没有 coach/plan/app-plan.json'}, () => {
  const p = JSON.parse(fs.readFileSync(real, 'utf8'));
  for (const d of p.days) if (d.minutes) {
    const {full} = trimForTime(d.exercises, null);
    assert.ok(Math.abs(full - d.minutes) <= 15, `${d.id}: 估 ${full}，计划 ${d.minutes}`);
  }
});

test('真实计划：每个替代动作都有中英文名字，都读得出组数和次数', {skip: !fs.existsSync(real) && '没有 coach/plan/app-plan.json'}, () => {
  const p = JSON.parse(fs.readFileSync(real, 'utf8'));
  for (const d of p.days) for (const ex of d.exercises) for (const s of ex.swaps || []) {
    assert.ok(s.name && s.target && s.en && s.en.name && s.en.target, `${ex.id} → ${s.name}`);
    assert.ok(setDefaults(swapExercise(ex, s)).sets.every(x => x.r != null), `${ex.id} → ${s.name}: ${s.target}`);
  }
});
