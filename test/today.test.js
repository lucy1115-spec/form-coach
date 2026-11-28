// 今天卡片：建议规则和"问 Claude"的文字
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setLang} from '../src/i18n.js';
import {pickToday, recommend, claudePrompt, fmtSleep} from '../src/today.js';

afterEach(() => setLang('zh'));
const D = (date, readiness, extra = {}) => ({date, readiness, total_sleep_min: 423, deep_min: 70, avg_hrv: 41, lowest_hr: 55, temp_deviation: 0.1, ...extra});

test('取今天；今天没有就取最近一天并标出来', () => {
  assert.equal(pickToday([D('2026-11-20', 81), D('2026-11-21', 84)], '2026-11-21').readiness, 84);
  const s = pickToday([D('2026-11-19', 84), D('2026-11-20', 81)], '2026-11-21');
  assert.equal(s.date, '2026-11-20'); assert.equal(s.stale, true);
  assert.equal(pickToday([], '2026-11-21'), null);
});

test('建议：照常 / 减量 / 休息', () => {
  assert.equal(recommend(D('d', 84), {gapHours: 60}).level, 'go');
  assert.equal(recommend(D('d', 84), {gapHours: 60}).head, '今天照常练');
  assert.equal(recommend(D('d', 70)).level, 'light');
  assert.equal(recommend(D('d', 55)).level, 'rest');
  assert.equal(recommend(D('d', 84, {temp_deviation: 0.6})).level, 'light');
  const g = recommend(D('d', 84), {gapHours: 20});
  assert.equal(g.level, 'light'); assert.match(g.reasons[0], /20 小时/);
  assert.equal(recommend(D('d', null)), null);
});

test('问 Claude 的文字：数据、建议、今天的训练', () => {
  const day = D('2026-11-21', 84);
  const s = claudePrompt({date: '2026-11-21', day, rec: recommend(day, {gapHours: 60}), dayName: '上肢', last: '11/20 下肢'});
  assert.match(s, /准备度 84，睡眠 7h03（深睡 70 分钟），HRV 41/);
  assert.match(s, /今天照常练/);
  assert.match(s, /今天轮到：上肢/);
  assert.equal(fmtSleep(65), '1h05');
  setLang('en');
  assert.doesNotMatch(claudePrompt({date: '2026-11-21', day, rec: recommend(day), dayName: 'Upper body'}), /[一-鿿]/);
});

test('本周力量：周一到周日，同一天只算一次，上周的不算', async () => {
  const {weekStrength} = await import('../src/today.js');
  // 2026-11-27 是周五；这周一是 11/23
  const w = weekStrength([{date: '2026-11-22'}, {date: '2026-11-23'}, {date: '2026-11-23'}, {date: '2026-11-25'}], '2026-11-27');
  assert.equal(w.n, 2);
  assert.deepEqual(w.days.map(x => x.date.slice(8)), ['23', '24', '25', '26', '27', '28', '29']);
  assert.equal(w.days[4].today, true);
  assert.equal(weekStrength([], '2026-11-29').days[0].date, '2026-11-23'); // 周日还在同一周
});
