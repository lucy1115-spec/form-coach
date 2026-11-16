// 训练计划的纯逻辑。真实计划是私人内容，不在仓库里：有 ../../plan/app-plan.json 时额外检查它。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {platesPerSide, loadLines, speakable, exerciseSpeech, defaultDayId, allVideoIds, matchVideoId, validatePlan} from '../src/plan.js';

const PLATES = [45, 35, 30, 25, 10, 5, 2.5];

test('每边加片：从大到小凑', () => {
  assert.deepEqual(platesPerSide(35, PLATES), [35]);
  assert.deepEqual(platesPerSide(30, PLATES), [30]);
  assert.deepEqual(platesPerSide(20, PLATES), [10, 10]);
  assert.deepEqual(platesPerSide(27.5, PLATES), [25, 2.5]);
  assert.deepEqual(platesPerSide(12.5, PLATES), [10, 2.5]);
  assert.deepEqual(platesPerSide(0, PLATES), []);
  assert.equal(platesPerSide(1, PLATES), null);
});

test('杠铃和史密斯的说明：杠铃含杆，史密斯只算加的片', () => {
  assert.deepEqual(loadLines({kind: 'barbell', bar: 35, weights: [105]}, PLATES), ['105 磅 = 杠铃 35 磅 + 每边 35 磅']);
  assert.deepEqual(loadLines({kind: 'barbell', bar: 35, weights: [95]}, PLATES), ['95 磅 = 杠铃 35 磅 + 每边 30 磅']);
  assert.deepEqual(loadLines({kind: 'barbell', bar: 35, weights: [85]}, PLATES), ['85 磅 = 杠铃 35 磅 + 每边 25 磅']);
  assert.deepEqual(loadLines({kind: 'smith', weights: [55, 60]}, PLATES),
    ['加片共 55 磅 = 每边 25 + 2.5 磅（不含杆）', '加片共 60 磅 = 每边 30 磅（不含杆）']);
  assert.deepEqual(loadLines(undefined), []);
});

test('朗读稿：组数次数读得顺', () => {
  assert.equal(speakable('3 × 12 @ 40 磅'), '3 组，每组 12 次，40 磅');
  assert.equal(speakable('3 × 10–12 @ 55–60 磅'), '3 组，每组 10 到 12 次，55 到 60 磅');
  const s = exerciseSpeech({name: '史密斯反向弓步', side: '先左腿', target: '3 × 10–12 @ 25–30 磅',
    load: {kind: 'smith', weights: [25]}, cues: '上身直立。'}, PLATES);
  assert.match(s, /^史密斯反向弓步。先左腿。目标：3 组，每组 10 到 12 次，25 到 30 磅。/);
  assert.match(s, /每边 10 \+ 2\.5 磅，不含杆/);
  assert.match(s, /要点：上身直立。$/);
});

const plan = {app: 'form-coach-plan', days: [
  {id: 'mon', weekday: 1, name: '周一', exercises: [{id: 'a', name: 'A', videos: ['IMG_0688']}]},
  {id: 'tue', weekday: 2, name: '周二', exercises: [{id: 'b', name: 'B', videos: ['IMG_0677', 'IMG_0688']}]},
  {id: 'thu', weekday: 4, name: '周四', exercises: [{id: 'c', name: 'C', videos: []}]},
]};

test('默认训练日：当天有就选当天，否则选下一个', () => {
  assert.equal(defaultDayId(plan, new Date(2026, 10, 16)), 'mon'); // 周一
  assert.equal(defaultDayId(plan, new Date(2026, 10, 18)), 'thu'); // 周三 → 周四
  assert.equal(defaultDayId(plan, new Date(2026, 10, 20)), 'mon'); // 周五 → 下周一
});

test('视频编号：去重、从文件名认出', () => {
  assert.deepEqual(allVideoIds(plan), ['IMG_0688', 'IMG_0677']);
  assert.equal(matchVideoId('IMG_0688.MOV', ['IMG_0677', 'IMG_0688']), 'IMG_0688');
  assert.equal(matchVideoId('img_0677 (1).mov', ['IMG_0677']), 'IMG_0677');
  assert.equal(matchVideoId('trim.ABCD.MOV', ['IMG_0677']), null);
});

test('导入检查', () => {
  assert.equal(validatePlan(plan), null);
  assert.match(validatePlan({app: 'form-mirror'}), /不是训练计划/);
  assert.match(validatePlan({app: 'form-coach-plan', days: []}), /没有训练日/);
});

const real = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plan/app-plan.json');
test('真实计划文件能通过检查，杠铃片都凑得出来', {skip: !fs.existsSync(real) && '没有 coach/plan/app-plan.json'}, () => {
  const p = JSON.parse(fs.readFileSync(real, 'utf8'));
  assert.equal(validatePlan(p), null);
  for (const d of p.days) for (const ex of d.exercises) {
    for (const l of loadLines(ex.load, p.plates)) assert.doesNotMatch(l, /凑不出来/, `${ex.name}: ${l}`);
    assert.ok(exerciseSpeech(ex, p.plates).length > 10);
  }
});
