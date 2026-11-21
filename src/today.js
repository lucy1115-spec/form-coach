// "今天"卡片：根据 Oura（电脑每天早上写到 Drive 的「Oura 今天.json」）给出今天练不练的建议。
// 只用规则，不调 AI（11/21 用户选了 C 版"建议优先"）。纯逻辑，Node 能测。
import {t} from './i18n.js';

/* 取今天那一行；今天还没有就取最近的一天（stale = true） */
export function pickToday(days, today) {
  const list = (days || []).filter(d => d && d.date).sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return null;
  const hit = list.find(d => d.date === today);
  return hit ? {...hit, stale: false} : {...list[list.length - 1], stale: true};
}

/* 建议：
   - 准备度 < 60 → 休息（或散步）
   - 准备度 60–74，或体温比平时高 0.5°C 以上 → 减量（不加重，可以少做一组）
   - 离上次力量训练不到 48 小时 → 减量或换成休息日（用户的规则）
   - 其他 → 照常练
   返回 {level: 'go'|'light'|'rest', head, reasons[]} */
export function recommend(day, {gapHours = null} = {}) {
  if (!day || day.readiness == null) return null;
  const r = day.readiness, temp = day.temp_deviation;
  const reasons = [];
  let level = 'go';
  if (r < 60) { level = 'rest'; reasons.push(t('today.rLow', {n: r})); }
  else if (r < 75) { level = 'light'; reasons.push(t('today.rMid', {n: r})); }
  if (temp != null && temp >= 0.5) { if (level === 'go') level = 'light'; reasons.push(t('today.temp', {n: temp})); }
  if (gapHours != null && gapHours < 48) { if (level === 'go') level = 'light'; reasons.push(t('today.gap', {h: Math.max(1, Math.round(gapHours))})); }
  if (!reasons.length) reasons.push(t('today.good'));
  return {level, head: t('today.level.' + level), reasons};
}

export const fmtSleep = min => (min == null ? '—' : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`);

/* 点"问 Claude"时复制的一段话：今天的数据 + 建议 + 今天的训练，接着在 Claude 里问 */
export function claudePrompt({date, day, rec, dayName, last}) {
  const lines = [t('ask.intro', {date})];
  if (day) {
    lines.push(t('ask.oura', {date: day.date, r: day.readiness ?? '—', sleep: fmtSleep(day.total_sleep_min), deep: day.deep_min ?? '—', hrv: day.avg_hrv ?? '—', hr: day.lowest_hr ?? '—',
      temp: day.temp_deviation == null ? '—' : (day.temp_deviation > 0 ? '+' : '') + day.temp_deviation}));
  }
  if (rec) lines.push(t('ask.rec', {head: rec.head, why: rec.reasons.join(t('list.sep'))}));
  if (dayName) lines.push(t('ask.plan', {day: dayName}));
  if (last) lines.push(t('ask.last', {text: last}));
  lines.push(t('ask.q'));
  return lines.join('\n');
}
