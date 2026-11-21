// 训练日按顺序轮换
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setLang} from '../src/i18n.js';
import {dayTitle, dayTab, nextDayId, recordWorkout, pickDay} from '../src/plan.js';

afterEach(() => setLang('zh'));
const plan = {days: [
  {id: 'mon', weekday: 1, name: '周一 · 下肢', en: {name: 'Mon · Lower body'}},
  {id: 'tue', weekday: 2, name: '周二 · 上肢', en: {name: 'Tue · Upper body'}},
  {id: 'thu', weekday: 4, name: '周四 · 全身（史密斯机）', en: {name: 'Thu · Full body (Smith machine)'}}]};

test('名字去掉星期', () => {
  assert.equal(dayTitle(plan.days[2]), '全身（史密斯机）');
  assert.equal(dayTab(plan.days[2]), '全身');
  assert.equal(dayTab({name: '腿'}), '腿');
  setLang('en');
  assert.equal(dayTab(plan.days[2]), 'Full body');
  assert.equal(dayTitle(plan.days[0]), 'Lower body');
});

test('轮换：最后一天之后回到第一天', () => {
  assert.equal(nextDayId(plan, 'mon'), 'tue');
  assert.equal(nextDayId(plan, 'thu'), 'mon');
  assert.equal(nextDayId(plan, 'gone'), 'mon');
});

test('记训练：同一天只留一条；全删了就去掉', () => {
  let h = recordWorkout([], {date: '2026-11-18', dayId: 'tue', at: '2026-11-18T18:00:00'});
  h = recordWorkout(h, {date: '2026-11-20', dayId: 'mon', at: '2026-11-20T18:00:00'});
  h = recordWorkout(h, {date: '2026-11-20', dayId: 'mon', at: '2026-11-20T18:30:00'});
  assert.deepEqual(h.map(x => x.at), ['2026-11-18T18:00:00', '2026-11-20T18:30:00']);
  h = recordWorkout(h, {date: '2026-11-20', dayId: null});
  assert.deepEqual(h.map(x => x.dayId), ['tue']);
});

test('默认选哪天：今天练过的 > 上次的下一天 > 星期几', () => {
  const now = new Date('2026-11-20T18:00:00');
  assert.equal(pickDay(plan, [], now, '2026-11-20').id, 'mon'); // 周五没安排 → 下周一
  const h = [{date: '2026-11-18', dayId: 'tue', at: '2026-11-18T20:00:00'}];
  const p = pickDay(plan, h, now, '2026-11-20');
  assert.equal(p.id, 'thu');
  assert.equal(p.gapHours, 46);
  const today = [...h, {date: '2026-11-20', dayId: 'mon', at: '2026-11-20T17:00:00'}];
  assert.deepEqual([pickDay(plan, today, now, '2026-11-20').id, pickDay(plan, today, now, '2026-11-20').gapHours], ['mon', null]);
  assert.equal(pickDay(plan, [{date: '2026-11-01', dayId: 'gone', at: '2026-11-01T10:00:00'}], now, '2026-11-20').id, 'mon');
});
