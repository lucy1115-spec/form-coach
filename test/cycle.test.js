// 月经周期：第几天、阶段、对建议的影响
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setLang} from '../src/i18n.js';
import {cycleInfo, cycleLength, cleanStarts, phaseLabel} from '../src/cycle.js';
import {recommend, claudePrompt} from '../src/today.js';

afterEach(() => setLang('zh'));

test('第几天和阶段（只有一次开始日期，按 31 天估）', () => {
  const c = cycleInfo(['2026-11-14'], '2026-11-21');
  assert.deepEqual([c.day, c.phase, c.length, c.estimated, c.nextStart], [8, 'follicular', 31, true, '2026-12-15']);
  assert.equal(cycleInfo(['2026-11-14'], '2026-11-14').phase, 'period');
  assert.equal(cycleInfo(['2026-11-14'], '2026-11-18').phase, 'period');   // 第 5 天
  assert.equal(cycleInfo(['2026-11-14'], '2026-11-30').phase, 'ovulation'); // 第 17 天（31−14）
  assert.equal(cycleInfo(['2026-11-14'], '2026-12-05').phase, 'luteal');    // 第 22 天
  assert.equal(cycleInfo(['2026-11-14'], '2026-12-09').phase, 'pms');       // 第 26 天（最后 7 天）
  const late = cycleInfo(['2026-11-14'], '2026-12-17');
  assert.equal(late.phase, 'pms'); assert.equal(late.late, true);
  assert.equal(cycleInfo([], '2026-11-21'), null);
  assert.equal(phaseLabel(cycleInfo(['2026-11-14'], '2026-11-21')), '卵泡期 · 第 8 天');
});

test('平均长度：用实际间隔；太近的重复记录去掉', () => {
  assert.equal(cycleLength(['2026-09-14', '2026-10-14', '2026-11-14']), 31);
  assert.equal(cycleLength(['2026-10-16', '2026-11-14']), 29);
  assert.deepEqual(cleanStarts(['2026-11-14', '2026-11-15', 'bad', '2026-10-14']), ['2026-10-14', '2026-11-15']);
});

test('建议：经前一周至少减量；其他阶段只在卡片的阶段一行说明', () => {
  const day = {readiness: 84, temp_deviation: 0.1};
  const pms = recommend(day, {gapHours: 60, cycle: cycleInfo(['2026-11-14'], '2026-12-09')});
  assert.equal(pms.level, 'light'); assert.equal(pms.why, 'pms');
  assert.match(pms.reasons.join(), /经前一周（周期第 26 天）/);
  const per = recommend(day, {gapHours: 60, cycle: cycleInfo(['2026-11-14'], '2026-11-15')});
  assert.equal(per.level, 'go'); assert.deepEqual(per.tips, []);
  const fol = recommend(day, {gapHours: 60, cycle: cycleInfo(['2026-11-14'], '2026-11-21')});
  assert.equal(fol.level, 'go'); assert.deepEqual(fol.tips, []);
  assert.equal(recommend({readiness: 55}, {cycle: cycleInfo(['2026-11-14'], '2026-12-09')}).level, 'rest');
});

test('问 Claude 带上周期', () => {
  const cycle = cycleInfo(['2026-11-14'], '2026-11-21');
  assert.match(claudePrompt({date: '2026-11-21', cycle}), /周期：第 8 天，卵泡期（下次预计 12\/15）/);
});
