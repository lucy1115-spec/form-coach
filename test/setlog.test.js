// 记一组：从计划目标读出每组、下次建议、训练记录的行
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setLang} from '../src/i18n.js';
import {parseTarget, setDefaults, suggestNext, sessionRows, weightStep, restSeconds, FEELS} from '../src/plan.js';

afterEach(() => setLang('zh'));
const brief = d => d.sets.map(s => `${s.warm ? 'W' : ''}${s.w}x${s.r}${s.rMax !== s.r ? '-' + s.rMax : ''}`);

test('读目标：组数、次数范围、重量范围取小的、条件句不算', () => {
  assert.deepEqual(brief(parseTarget('3 × 10–12 @ 25–30 磅，到 30 磅就停，不再加重')), ['25x10-12', '25x10-12', '25x10-12']);
  assert.deepEqual(brief(parseTarget('3 × 12–15 @ 40 磅，做到 3 × 15 再加到 45 磅')), ['40x12-15', '40x12-15', '40x12-15']);
  assert.deepEqual(brief(parseTarget('热身 20 磅，3 × 12 @ 45 磅；轻松就最后一组用 50 磅')), ['W20x12', '45x12', '45x12', '45x12']);
  assert.deepEqual(brief(parseTarget('1 × 15 @ 15 磅，2 × 10–12 @ 20 磅；2 × 12 轻松后加到 22.5–25 磅')), ['15x15', '20x10-12', '20x10-12']);
  assert.deepEqual(brief(parseTarget('3 组，每边 12 步')), ['nullx12', 'nullx12', 'nullx12']);
  const lv = parseTarget('12 @ 7 级、10 @ 6 级、8–10 @ 6 级');
  assert.equal(lv.unit, 'level');
  assert.deepEqual(brief(lv), ['7x12', '6x10', '6x8-10']);
  assert.equal(parseTarget('随便练练').sets.length, 3); // 读不出就给 3 组空白
});

test('杠铃热身没写重量就是空杆；计划写了 log.sets 就用它', () => {
  const ex = {target: '热身 1 × 15，3 × 10 @ 85 磅', load: {kind: 'barbell', bar: 35, weights: [85]}};
  assert.deepEqual(brief(setDefaults(ex)), ['W35x15', '85x10', '85x10', '85x10']);
  assert.deepEqual(brief(setDefaults({target: 'x', log: {sets: [{w: 25, r: 15}, {w: 25, r: 15}]}})), ['25x15', '25x15']);
});

test('加减一步和休息时间', () => {
  assert.equal(weightStep('level', 6), 1);
  assert.equal(weightStep('lb', 45, 'smith'), 5);
  assert.equal(weightStep('lb', 10), 2.5);
  assert.equal(weightStep('lb', 50), 5);
  assert.equal(restSeconds({load: {kind: 'barbell'}}), 120);
  assert.equal(restSeconds({}), 75);
  assert.deepEqual(FEELS.map(f => f.rir), [3, 2, 1, 0]);
});

test('下次建议：双重进阶', () => {
  const ex = {target: '3 × 10–12 @ 50 磅'};
  const S = (r, feel, w = 50) => ({warm: false, w, r, feel});
  assert.equal(suggestNext(ex, [S(12, 'ok'), S(12, 'easy'), S(12, 'ok')]).text, '都做满而且不吃力：可以加到 55 磅');
  assert.equal(suggestNext(ex, [S(12, 'ok'), S(11, 'hard'), S(10, 'hard')]).text, '保持 50 磅，争取每组多做 1 次');
  assert.equal(suggestNext(ex, [S(12, 'ok'), S(9, 'fail')]).kind, 'hold');
  assert.equal(suggestNext(ex, []), null);
  assert.equal(suggestNext(ex, [S(12, 'easy'), S(12, 'easy')]).kind, 'hold'); // 3 组只做了 2 组
  // 热身组不算
  assert.equal(suggestNext({target: '热身 1 × 15，3 × 10 @ 85 磅', load: {kind: 'barbell'}}, [{warm: true, w: 35, r: 15, feel: 'hard'}, S(10, 'ok', 85), S(10, 'ok', 85), S(10, 'easy', 85)]).text, '都做满而且不吃力：可以加到 90 磅');
  assert.equal(suggestNext({target: '1 × 15 @ 100 磅，不加重'}, [S(15, 'easy', 100)]).kind, 'keep');
  assert.equal(suggestNext({target: '12 @ 7 级、10 @ 6 级'}, [S(12, 'ok', 7), S(10, 'ok', 6)]).text, '都做满而且不吃力：可以试更难一级');
  assert.equal(suggestNext({target: '12 @ 7 级、10 @ 6 级'}, [S(12, 'ok', 7), S(9, 'hard', 6)]).text, '保持 7 级 / 6 级，先把每组都做完整');
  setLang('en');
  assert.equal(suggestNext(ex, [S(12, 'ok'), S(12, 'ok'), S(12, 'ok')]).text, 'All reps done, not hard: go to 55 lb');
});

test('训练记录：每组一行，动作和训练日用中文，级别写在备注', () => {
  const plan = {days: [{id: 'thu', name: '周四 · 全身', exercises: [
    {id: 'smith-squat', name: '史密斯深蹲', target: '3 × 12 @ 45 磅'},
    {id: 'assisted-pullup', name: '辅助引体向上', target: '12 @ 7 级'}]}]};
  setLang('en'); // 界面是英文也一样
  const rows = sessionRows({date: '2026-11-20', sets: {
    'smith-squat': [{warm: true, w: 20, r: 12, feel: 'easy'}, {w: 45, r: 12, feel: 'ok', note: '左膝有点内扣'}],
    'assisted-pullup': [{w: 7, r: 12, feel: 'hard'}]}}, plan);
  // 在别的训练日补做：训练日写实际练的那天
  const extra = sessionRows({date: '2026-11-20', sets: {'smith-squat': [{w: 45, r: 12, feel: 'ok', day: 'mon'}]}}, {days: [...plan.days, {id: 'mon', name: '周一 · 下肢', exercises: []}]});
  assert.equal(extra[0].session, '周一 · 下肢');
  assert.equal(extra[0].exercise, '史密斯深蹲');
  assert.deepEqual(rows, [
    {date: '2026-11-20', session: '周四 · 全身', exercise: '史密斯深蹲', sets: 1, reps: 12, weight_lb: 20, rir: 3, note: '热身；😌 轻松'},
    {date: '2026-11-20', session: '周四 · 全身', exercise: '史密斯深蹲', sets: 1, reps: 12, weight_lb: 45, rir: 2, note: '🙂 刚好；左膝有点内扣'},
    {date: '2026-11-20', session: '周四 · 全身', exercise: '辅助引体向上', sets: 1, reps: 12, weight_lb: '', rir: 1, note: '7 级；😣 吃力'},
  ]);
});

const real = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plan/app-plan.json');
test('真实计划：除了超级组，每个动作都读得出次数', {skip: !fs.existsSync(real) && '没有 coach/plan/app-plan.json'}, () => {
  const p = JSON.parse(fs.readFileSync(real, 'utf8'));
  for (const d of p.days) for (const ex of d.exercises) {
    if (/超级组/.test(ex.name) || /热身/.test(ex.name) && /组 @/.test(ex.target)) continue;
    assert.ok(setDefaults(ex).sets.every(s => s.r != null), `${ex.id}: ${ex.target}`);
  }
});
