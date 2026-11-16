// 中英双语：两种语言的文字齐全，英文界面下引擎、计划、AI 请求都输出英文
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {t, setLang, getLang, loc, missingKeys} from '../src/i18n.js';
import {RepCounter, analyzeReference, compareRep, summarizeSet, formNote} from '../src/engine.js';
import {loadLines, speakable, exerciseSpeech, validatePlan} from '../src/plan.js';
import {buildReviewRequest, parseReview} from '../src/ai.js';
import {preset, specFor} from './helpers.js';

afterEach(() => setLang('zh'));

const CJK = /[一-鿿]/;

test('两种语言的 key 一一对应', () => {
  assert.deepEqual(missingKeys(), {en: [], zh: []});
});

test('默认中文；切换后取英文；没有的 key 原样返回', () => {
  assert.equal(getLang(), 'zh');
  assert.equal(t('plan.say'), '听要点');
  setLang('en');
  assert.equal(t('plan.say'), 'Hear cues');
  assert.equal(t('num', {n: 3}), '3');
  assert.equal(t('no.such.key'), 'no.such.key');
  setLang('xx'); // 不认识的语言退回中文
  assert.equal(getLang(), 'zh');
});

test('loc：英文优先取 en 字段，没有就用中文', () => {
  const ex = {name: '杠铃臀推', cues: '夹臀', en: {name: 'Barbell hip thrust'}};
  assert.equal(loc(ex, 'name'), '杠铃臀推');
  setLang('en');
  assert.equal(loc(ex, 'name'), 'Barbell hip thrust');
  assert.equal(loc(ex, 'cues'), '夹臀');
});

function synthSeries(reps, {rest = 170, far = 60, period = 3, fps = 30, lead = 1} = {}) {
  const out = [];
  for (let i = 0; i <= (lead * 2 + reps * period) * fps; i++) {
    const t = i / fps, u = t - lead;
    const v = u < 0 || u > reps * period ? rest : rest - (rest - far) * (1 - Math.cos(2 * Math.PI * u / period)) / 2;
    out.push({t, values: {kneeMin: v, trunk: 8}});
  }
  return out;
}

test('英文：动作对比、一组总结、训练记录备注都是英文，提示用 cuesEn', () => {
  setLang('en');
  const p = preset('smith-reverse-lunge');
  const prof = analyzeReference(synthSeries(4), specFor(p));
  const c = new RepCounter({rest: prof.rest, far: prof.far});
  let rep = null;
  for (const s of synthSeries(1, {far: 95})) rep = c.push(s.t, s.values.kneeMin, s.values) || rep;
  rep.cmp = compareRep(rep, prof, p, 1);
  const top = rep.cmp.issues[0];
  assert.equal(top.voice, p.cuesEn.farShort);
  assert.doesNotMatch(top.text, CJK);
  for (const i of rep.cmp.infos) assert.doesNotMatch(i.text, CJK, i.text);
  const sum = summarizeSet([rep], prof);
  assert.equal(sum.speech, `This set: 1 rep, 0 matched the standard. Main issues: ${p.cuesEn.farShort}, 1 rep.`);
  assert.equal(formNote(sum), `Form check 0/1 reps matched; ${p.cuesEn.farShort} ×1`);
  assert.match(analyzeReference(synthSeries(1).slice(0, 5), specFor(p)).error, /^Too few usable frames/);
});

test('英文：杠铃片说明和朗读稿', () => {
  setLang('en');
  const PL = [45, 35, 30, 25, 10, 5, 2.5];
  assert.deepEqual(loadLines({kind: 'barbell', bar: 35, weights: [105]}, PL), ['105 lb = 35 lb bar + 35 lb per side']);
  assert.deepEqual(loadLines({kind: 'smith', weights: [55]}, PL), ['55 lb of plates = 25 + 2.5 lb per side (bar not included)']);
  assert.equal(speakable('3 × 10–12 @ 25–30 lb'), '3 sets of 10 to 12, 25 to 30 pounds');
  const s = exerciseSpeech({name: '史密斯反向弓步', target: '3 × 10–12 @ 25–30 磅',
    en: {name: 'Smith machine reverse lunge', side: 'Left leg first', target: '3 × 10–12 @ 25–30 lb', cues: 'Torso upright.'},
    load: {kind: 'smith', weights: [25]}}, PL);
  assert.equal(s, 'Smith machine reverse lunge. Left leg first. Target: 3 sets of 10 to 12, 25 to 30 pounds. 25 pounds of plates = 10 + 2.5 pounds per side, bar not included. Key points: Torso upright.');
  assert.match(validatePlan({app: 'x'}), /^This is not a training plan/);
});

test('英文：AI 请求的提示词和数据都是英文', () => {
  setLang('en');
  const IMG = 'data:image/jpeg;base64,QUJD';
  const rep = {n: 1, farV: 85, out: 1.5, back: 1.2, img: IMG, cmp: {issues: [{text: 'Torso lean larger than the coach by 14°', voice: 'x', sev: 1}], infos: []}};
  const req = buildReviewRequest({exercise: 'Smith machine reverse lunge', standardName: 'Pexels side', profile: {primary: 'kneeMin', rest: 174, far: 71, secondary: {trunk: 2}, images: {far: IMG}},
    summary: {n: 1, clean: 0, skipped: 0, top: [], best: rep, worst: null, farMedian: 85, depthMedian: 8, depthKey: 'frontThigh', legHidden: 1}, reps: [rep]});
  assert.match(req.system, /Answer entirely in English/);
  for (const b of req.messages[0].content) if (b.type === 'text') assert.doesNotMatch(b.text, CJK, b.text);
  assert.match(req.output_config.format.schema.properties.speech.description, /20 words/);
  assert.match(parseReview({stop_reason: 'refusal'}).error, /did not give feedback/);
});

const real = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plan/app-plan.json');
test('真实计划：每个训练日和动作都有英文，英文朗读稿里没有中文', {skip: !fs.existsSync(real) && '没有 coach/plan/app-plan.json'}, () => {
  const p = JSON.parse(fs.readFileSync(real, 'utf8'));
  setLang('en');
  assert.equal(p.en.principles.length, p.principles.length);
  for (const d of p.days) {
    assert.ok(d.en && d.en.name && d.en.notes.length === d.notes.length, d.id);
    for (const ex of d.exercises) {
      assert.ok(ex.en && ex.en.name, ex.id);
      const s = exerciseSpeech(ex, p.plates);
      assert.doesNotMatch(s, CJK, `${ex.id}: ${s}`);
      for (const l of loadLines(ex.load, p.plates)) assert.doesNotMatch(l, CJK);
    }
  }
});
