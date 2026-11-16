// AI 点评：一组做完后，把这一组的数字和三张截图（最好一下、最需要改的一下、标准最低点）发给 Claude，
// 拿回一句耳机朗读的话和几句详细点评。
//
// - API key 只存在这台手机的浏览器里（设置里粘贴），不写进代码、不进仓库
// - 浏览器直接调用：官方 SDK 的 dangerouslyAllowBrowser 会加上 Anthropic 要求的浏览器访问请求头
// - 模型 claude-opus-5-5，effort medium；开了服务端 refusal fallback（fallbacks: "default"），
//   万一被安全分类器拦下，API 会在同一次调用里换模型重试
// - buildReviewRequest() 是纯函数，Node 测试里可以直接检查；reviewSet() 才真正联网
import {METRICS, fmtVal} from './engine.js';

export const AI_MODEL = 'claude-opus-5-5';
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';

const SYSTEM = `你是一位力量训练教练，在给一位学员点评她刚做完的一组动作。学员在健身房，戴着 AirPods 听你的点评。

依据：只用下面给你的识别数据和截图。截图上的火柴人是手机姿态识别画出来的，角度是 2D 估算，有误差。
评估优先级：① 背是否平直、躯干角度 ② 膝盖方向和是否往前冲 ③ 下蹲幅度 ④ 节奏。
要求：
- 全部用中文。先说最重要的一条，再给一个下一组就能直接用的动作提示。
- 数据和截图对不上、机位和标准不一样、或者识别明显有误时，直说不确定，不要硬下结论。
- 标准视频可能和学员的做法不完全一样（例如标准是徒手、学员扛着史密斯机的杠）；这种差别带来的差异要打折扣，不要当成错误。
- 不要编造数据里没有的东西，不要做医疗判断。`;

const SCHEMA = {
  type: 'object',
  properties: {
    speech: {type: 'string', description: '给耳机朗读的一句话，40 个字以内，先说最重要的问题或肯定'},
    details: {type: 'string', description: '详细点评，3 到 5 句，包括下一组的具体提示和不确定的地方'},
  },
  required: ['speech', 'details'],
  additionalProperties: false,
};

const b64 = dataUrl => (dataUrl || '').replace(/^data:image\/\w+;base64,/, '');

/* 把一组整理成 Messages API 的请求参数（不含 key）。
   set = {exercise, standardName, summary, reps, profile}，reps 里每一下有 n/farV/out/back/cmp/img */
export function buildReviewRequest({exercise, standardName, summary, reps, profile}) {
  const P = profile.primary;
  const lines = [];
  lines.push(`动作：${exercise}（侧面拍）`);
  lines.push(`标准：${standardName}。标准最低点 ${METRICS[P].zh} ${fmtVal(P, profile.far)}，起始位 ${fmtVal(P, profile.rest)}；` +
    Object.entries(profile.secondary || {}).map(([k, v]) => `${METRICS[k].zh} ${fmtVal(k, v)}`).join('，'));
  lines.push(`这一组：共 ${summary.n} 下，评估 ${summary.n - (summary.skipped || 0)} 下，其中 ${summary.clean} 下和标准一致` +
    (summary.skipped ? `；${summary.skipped} 下机位不对没有评估` : '') + '。');
  if (summary.depthMedian != null)
    lines.push(`深度按${METRICS[summary.depthKey].zh}判断（15° 以内算蹲到位，不和标准视频的膝角比）：每下最低时中位数 ${Math.round(summary.depthMedian)}°。`);
  else lines.push(`你的${METRICS[P].zh}中位数 ${fmtVal(P, summary.farMedian)}。`);
  if (summary.legHidden)
    lines.push(`有 ${summary.legHidden} 下看不到后腿（被史密斯机的立柱或底座挡住，识别把两条腿都标在了前腿上）。所以"膝角（较弯的腿）"其实是前腿的膝角，和标准比的差值不代表蹲得不够深；后膝离地多高无法判断，不要据此要求学员再蹲低。`);
  if (summary.top.length) lines.push('出现最多的问题：' + summary.top.slice(0, 4).map(x => `${x.voice}（${x.count} 下）`).join('；') + '。');
  lines.push('每一下：');
  for (const r of reps) {
    const iss = r.cmp.skipped ? '机位不对，未评估' : (r.cmp.issues.map(i => i.text).join('；') || '和标准一致');
    lines.push(`- 第 ${r.n} 下：最低点 ${fmtVal(P, r.farV)}，下 ${r.out.toFixed(1)} 秒 / 起 ${r.back.toFixed(1)} 秒；${iss}`);
  }

  const content = [];
  const addImg = (label, url) => {
    if (!url) return;
    content.push({type: 'text', text: label});
    content.push({type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: b64(url)}});
  };
  if (summary.best) addImg(`截图 1：学员最好的一下（第 ${summary.best.n} 下）的最低点`, summary.best.img);
  if (summary.worst) addImg(`截图 2：学员最需要改的一下（第 ${summary.worst.n} 下）的最低点`, summary.worst.img);
  addImg('截图 3：标准动作的最低点', profile.images && profile.images.far);
  content.push({type: 'text', text: lines.join('\n') + '\n\n请点评这一组。'});

  return {
    model: AI_MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: {effort: 'medium', format: {type: 'json_schema', schema: SCHEMA}},
    messages: [{role: 'user', content}],
  };
}

/* 读出点评；被拒绝或格式不对时返回 {error} */
export function parseReview(res) {
  if (res.stop_reason === 'refusal') return {error: 'AI 这次没有给出点评。'};
  const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  try {
    const j = JSON.parse(text);
    if (typeof j.speech === 'string' && typeof j.details === 'string') return {speech: j.speech.trim(), details: j.details.trim()};
  } catch (e) { /* 落到下面 */ }
  return {error: res.stop_reason === 'max_tokens' ? 'AI 点评被截断了，再试一次。' : 'AI 返回的格式不对，再试一次。'};
}

let sdk = null;
async function loadSdk() { if (!sdk) sdk = await import(SDK_URL); return sdk; }

/* 真正调用 API。错误按类型给出中文说明 */
export async function reviewSet(apiKey, set) {
  const mod = await loadSdk();
  const client = new mod.default({apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 90_000});
  try {
    const res = await client.beta.messages.create(buildReviewRequest(set));
    return parseReview(res);
  } catch (e) {
    if (e instanceof mod.AuthenticationError) return {error: 'API key 不对或已失效，到设置里重新粘贴。'};
    if (e instanceof mod.PermissionDeniedError) return {error: '这个 API key 没有权限，检查 Anthropic 后台的设置。'};
    if (e instanceof mod.RateLimitError) return {error: '请求太频繁或额度用完了（可能到了每月花费上限），稍后再试。'};
    if (e instanceof mod.BadRequestError) return {error: '请求被拒绝：' + (e.message || '').slice(0, 120)};
    if (e instanceof mod.InternalServerError) return {error: 'Anthropic 服务暂时出问题，稍后再试。'};
    if (e instanceof mod.APIConnectionError) return {error: '连不上 Anthropic，检查网络。'};
    return {error: '出错了：' + String(e && e.message || e).slice(0, 120)};
  }
}
