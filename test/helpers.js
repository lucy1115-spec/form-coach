// 测试工具：读 test/fixtures/ 里的关节点数据，按 App 的方式跑一遍引擎。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Tracker} from '../src/engine.js';
import {PRESETS} from '../src/presets.js';

export const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function loadFixture(name) {
  const file = path.join(FIXTURE_DIR, name + '.json');
  if (!fs.existsSync(file)) return null;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  j.frames = j.frames.map(f => ({t: f.t, lm: f.lm && f.lm.map(([x, y, z, visibility]) => ({x, y, z, visibility}))}));
  return j;
}

export function preset(id) { return PRESETS.find(p => p.id === id); }

// 和 index.html 的 specFor 一样
export function specFor(p, prof) {
  return {view: p.view, unilateral: !!p.unilateral, primary: prof ? prof.primary : p.primary, secondary: p.secondary, rest: p.rest};
}

// 和 index.html 的 refFrame 一样：只收 ok 的帧
export function toSeries(fx, spec) {
  const tr = new Tracker(spec), series = [];
  for (const f of fx.frames) {
    if (!f.lm) continue;
    const r = tr.update(f.lm, fx.W, fx.H, f.t);
    if (r.ok) series.push({t: f.t, values: r.values, side: r.side});
  }
  return series;
}
