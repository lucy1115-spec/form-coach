// 月经周期：用经期开始日期推算今天是第几天、在哪个阶段（11/21 用户要求加进"今天"卡片）。
// Oura 的周期接口只开放给认证合作应用，个人应用拿不到，所以日期由用户在 App 里点"经期开始了"、
// 或电脑上的 data/cycle.csv 提供。纯逻辑，Node 能测。
import {t} from './i18n.js';

export const DEFAULT_LENGTH = 31; // 用户的周期约 31 天（10/14 → 11/14，按「吃练计划」里"11/10 是周期第 28 天"推的）
export const PERIOD_DAYS = 5;     // 经期一般 4–5 天（11/21 用户说的）

const dayNum = s => Math.floor(Date.parse(s + 'T12:00:00Z') / 864e5);
const ymd = n => new Date(n * 864e5).toISOString().slice(0, 10);

/* 去重、排序、去掉明显不对的（两次相隔不到 15 天的，留后一次） */
export function cleanStarts(starts) {
  const s = [...new Set((starts || []).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
  const out = [];
  for (const x of s) { if (out.length && dayNum(x) - dayNum(out[out.length - 1]) < 15) out.pop(); out.push(x); }
  return out;
}

/* 平均周期长度：最近 3 次间隔的平均（21–40 天之间才算数），不够就用默认 */
export function cycleLength(starts) {
  const s = cleanStarts(starts), gaps = [];
  for (let i = 1; i < s.length; i++) { const g = dayNum(s[i]) - dayNum(s[i - 1]); if (g >= 21 && g <= 40) gaps.push(g); }
  const last = gaps.slice(-3);
  return last.length ? Math.round(last.reduce((a, b) => a + b, 0) / last.length) : DEFAULT_LENGTH;
}

/* 今天是周期第几天、哪个阶段。
   阶段（L = 周期长度）：经期 1–5 天 → 卵泡期 → 排卵前后（L−15 到 L−13）→ 黄体期 → 经前一周（最后 7 天，「吃练计划」的经前规则）。
   超过预计长度还没来：仍算经前，标 late。没有任何开始日期返回 null */
export function cycleInfo(starts, today) {
  const s = cleanStarts(starts).filter(x => x <= today);
  if (!s.length) return null;
  const L = cycleLength(s), last = s[s.length - 1];
  const day = dayNum(today) - dayNum(last) + 1;
  let phase;
  if (day <= PERIOD_DAYS) phase = 'period';
  else if (day >= L - 6) phase = 'pms';
  else if (day >= L - 15 && day <= L - 13) phase = 'ovulation';
  else if (day < L - 15) phase = 'follicular';
  else phase = 'luteal';
  return {day, phase, length: L, estimated: s.length < 2, late: day > L, lastStart: last, nextStart: ymd(dayNum(last) + L)};
}

export const phaseLabel = c => (c ? t('cycle.label', {day: c.day, phase: t('cycle.phase.' + c.phase)}) : '');
