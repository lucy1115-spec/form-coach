// AI 点评的请求内容和返回解析（不联网）
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewRequest, parseReview, AI_MODEL} from '../src/ai.js';

const IMG = 'data:image/jpeg;base64,QUJD';
const profile = {primary: 'kneeMin', rest: 174, far: 71, secondary: {trunk: 2, neck: 146}, images: {far: IMG}};
const rep = (n, issues, extra = {}) => ({n, farV: 85, out: 1.5, back: 1.2, img: IMG,
  cmp: {issues: issues.map(t => ({text: t, voice: t, sev: 1.5})), infos: [], ...extra}});
const reps = [rep(1, [], {skipped: true}), rep(2, ['躯干倾斜比教练大 14°']), rep(3, [])];
const summary = {n: 3, clean: 1, skipped: 1, top: [{voice: '上身保持直立', count: 1}], best: reps[2], worst: reps[1], farMedian: 85};

test('AI 请求：模型、fallback、结构化输出都对', () => {
  const req = buildReviewRequest({exercise: '史密斯后撤弓步', standardName: 'Pexels 侧面', summary, reps, profile});
  assert.equal(req.model, AI_MODEL);
  assert.equal(req.model, 'claude-opus-5-5');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.fallbacks, 'default');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.deepEqual(req.output_config.format.schema.required, ['speech', 'details']);
  assert.equal(req.thinking, undefined); // Opus 5.5 不能关 thinking，不传
  assert.equal(req.temperature, undefined);
});

test('AI 请求：三张截图带说明，base64 去掉前缀，最后是文字', () => {
  const req = buildReviewRequest({exercise: '史密斯后撤弓步', standardName: 'Pexels 侧面', summary, reps, profile});
  const c = req.messages[0].content;
  const imgs = c.filter(b => b.type === 'image');
  assert.equal(imgs.length, 3);
  for (const i of imgs) { assert.equal(i.source.data, 'QUJD'); assert.equal(i.source.media_type, 'image/jpeg'); }
  assert.match(c[0].text, /最好的一下（第 3 下）/);
  const last = c[c.length - 1];
  assert.equal(last.type, 'text');
  assert.match(last.text, /第 1 下.*机位不对，未评估/);
  assert.match(last.text, /第 2 下.*躯干倾斜比教练大 14°/);
  assert.match(last.text, /第 3 下.*和标准一致/);
  assert.match(last.text, /1 下机位不对没有评估/);
});

test('AI 请求：没有"最差"的一下时只发两张图', () => {
  const req = buildReviewRequest({exercise: 'x', standardName: 'y', summary: {...summary, worst: null}, reps, profile});
  assert.equal(req.messages[0].content.filter(b => b.type === 'image').length, 2);
});

test('解析点评：正常、被拒绝、截断、格式不对', () => {
  const ok = parseReview({stop_reason: 'end_turn', content: [{type: 'text', text: '{"speech":"上身再直一点","details":"第二下前倾。"}'}]});
  assert.deepEqual(ok, {speech: '上身再直一点', details: '第二下前倾。'});
  assert.match(parseReview({stop_reason: 'refusal', content: []}).error, /没有给出点评/);
  assert.match(parseReview({stop_reason: 'max_tokens', content: [{type: 'text', text: '{"spe'}]}).error, /截断/);
  assert.match(parseReview({stop_reason: 'end_turn', content: [{type: 'text', text: 'hello'}]}).error, /格式不对/);
});
