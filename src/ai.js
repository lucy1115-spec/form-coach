// AI 点评：一组做完后，把这一组的数字和三张截图（最好一下、最需要改的一下、标准最低点）发给 Claude，
// 拿回一句耳机朗读的话和几句详细点评。
//
// - API key 只存在这台手机的浏览器里（设置里粘贴），不写进代码、不进仓库
// - 浏览器直接调用：官方 SDK 的 dangerouslyAllowBrowser 会加上 Anthropic 要求的浏览器访问请求头
// - 模型 claude-opus-5-5，effort medium；开了服务端 refusal fallback（fallbacks: "default"），
//   万一被安全分类器拦下，API 会在同一次调用里换模型重试
// - 双语：界面是英文时，提示词和要求的回答都是英文（PROMPT.en），否则中文（PROMPT.zh，原来的文字）
// - buildReviewRequest() 是纯函数，Node 测试里可以直接检查；reviewSet() 才真正联网
import {fmtVal, mname} from './engine.js';
import {t, getLang} from './i18n.js';

export const AI_MODEL = 'claude-opus-5-5';
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';

const PROMPT = {
  zh: {
    system: `你是一位力量训练教练，在给一位学员点评她刚做完的一组动作。学员在健身房，戴着 AirPods 听你的点评。

依据：只用下面给你的识别数据和截图。截图上的火柴人是手机姿态识别画出来的，角度是 2D 估算，有误差。
评估优先级：① 背是否平直、躯干角度 ② 膝盖方向和是否往前冲 ③ 下蹲幅度 ④ 节奏。
要求：
- 全部用中文。先说最重要的一条，再给一个下一组就能直接用的动作提示。
- 数据和截图对不上、机位和标准不一样、或者识别明显有误时，直说不确定，不要硬下结论。
- 标准视频可能和学员的做法不完全一样（例如标准是徒手、学员扛着史密斯机的杠）；这种差别带来的差异要打折扣，不要当成错误。
- 不要编造数据里没有的东西，不要做医疗判断。`,
    speechDesc: '给耳机朗读的一句话，40 个字以内，先说最重要的问题或肯定',
    detailsDesc: '详细点评，3 到 5 句，包括下一组的具体提示和不确定的地方',
    exercise: x => `动作：${x}（侧面拍）`,
    standard: (name, prim, rest, sec) => `标准：${name}。标准最低点 ${prim}，起始位 ${rest}；${sec}`,
    secSep: '，',
    set: (n, m, clean, skipped) => `这一组：共 ${n} 下，评估 ${m} 下，其中 ${clean} 下和标准一致` + (skipped ? `；${skipped} 下机位不对没有评估` : '') + '。',
    depth: (name, v) => `深度按${name}判断（15° 以内算蹲到位，不和标准视频的膝角比）：每下最低时中位数 ${v}°。`,
    primary: (name, v) => `你的${name}中位数 ${v}。`,
    legHidden: n => `有 ${n} 下看不到后腿（被史密斯机的立柱或底座挡住，识别把两条腿都标在了前腿上）。所以"膝角（较弯的腿）"其实是前腿的膝角，和标准比的差值不代表蹲得不够深；后膝离地多高无法判断，不要据此要求学员再蹲低。`,
    top: list => '出现最多的问题：' + list.map(x => `${x.voice}（${x.count} 下）`).join('；') + '。',
    eachHead: '每一下：',
    skipped: '机位不对，未评估', clean: '和标准一致', issueSep: '；',
    rep: (n, far, out, back, iss) => `- 第 ${n} 下：最低点 ${far}，下 ${out} 秒 / 起 ${back} 秒；${iss}`,
    img1: n => `截图 1：学员最好的一下（第 ${n} 下）的最低点`,
    img2: n => `截图 2：学员最需要改的一下（第 ${n} 下）的最低点`,
    img3: '截图 3：标准动作的最低点',
    ask: '请点评这一组。',
  },
  en: {
    system: `You are a strength coach reviewing the set your client just finished. She is at the gym, listening to your feedback through AirPods.

Basis: use only the tracking data and screenshots below. The stick figure on the screenshots is drawn by the phone's pose recognition; angles are 2D estimates and have error.
Priorities: 1) flat back and torso angle 2) knee direction and whether the knee drifts forward 3) depth 4) tempo.
Requirements:
- Answer entirely in English. Lead with the single most important point, then give one cue she can use on the very next set.
- If the data and screenshots disagree, the camera angle differs from the standard, or recognition is clearly off, say you are unsure instead of forcing a conclusion.
- The standard video may differ from how she does the lift (e.g. the standard is bodyweight while she carries a Smith machine bar); discount differences that come from that rather than calling them errors.
- Do not invent anything not in the data, and make no medical judgments.`,
    speechDesc: 'One sentence to be read aloud in her earbuds, at most 20 words, leading with the most important issue or praise',
    detailsDesc: 'Detailed feedback, 3 to 5 sentences, including a concrete cue for the next set and anything you are unsure about',
    exercise: x => `Exercise: ${x} (filmed from the side)`,
    standard: (name, prim, rest, sec) => `Standard: ${name}. Standard bottom ${prim}, start ${rest}; ${sec}`,
    secSep: ', ',
    set: (n, m, clean, skipped) => `This set: ${n} reps, ${m} evaluated, ${clean} matched the standard` + (skipped ? `; ${skipped} not evaluated (wrong camera angle)` : '') + '.',
    depth: (name, v) => `Depth is judged by ${name} (within 15° counts as full depth; not compared with the standard video's knee angle): median at the bottom of each rep ${v}°.`,
    primary: (name, v) => `Her median ${name}: ${v}.`,
    legHidden: n => `In ${n} reps the back leg was not visible (blocked by the Smith machine's upright or base, so recognition put both legs on the front leg). The "knee angle (more-bent leg)" is therefore the front knee, and its difference from the standard does not mean she is too shallow; back-knee height cannot be judged, so do not tell her to go lower on that basis.`,
    top: list => 'Most frequent issues: ' + list.map(x => `${x.voice} (${x.count} reps)`).join('; ') + '.',
    eachHead: 'Each rep:',
    skipped: 'wrong camera angle, not evaluated', clean: 'matched the standard', issueSep: '; ',
    rep: (n, far, out, back, iss) => `- Rep ${n}: bottom ${far}, down ${out}s / up ${back}s; ${iss}`,
    img1: n => `Screenshot 1: bottom of her best rep (rep ${n})`,
    img2: n => `Screenshot 2: bottom of the rep that most needs work (rep ${n})`,
    img3: 'Screenshot 3: bottom of the standard',
    ask: 'Please review this set.',
  },
};

const schemaFor = p => ({
  type: 'object',
  properties: {
    speech: {type: 'string', description: p.speechDesc},
    details: {type: 'string', description: p.detailsDesc},
  },
  required: ['speech', 'details'],
  additionalProperties: false,
});

const b64 = dataUrl => (dataUrl || '').replace(/^data:image\/\w+;base64,/, '');

/* 把一组整理成 Messages API 的请求参数（不含 key）。
   set = {exercise, standardName, summary, reps, profile}，reps 里每一下有 n/farV/out/back/cmp/img */
export function buildReviewRequest({exercise, standardName, summary, reps, profile}) {
  const L = PROMPT[getLang()] || PROMPT.zh;
  const P = profile.primary;
  const lines = [];
  lines.push(L.exercise(exercise));
  lines.push(L.standard(standardName, `${mname(P)} ${fmtVal(P, profile.far)}`, fmtVal(P, profile.rest),
    Object.entries(profile.secondary || {}).map(([k, v]) => `${mname(k)} ${fmtVal(k, v)}`).join(L.secSep)));
  lines.push(L.set(summary.n, summary.n - (summary.skipped || 0), summary.clean, summary.skipped));
  if (summary.depthMedian != null) lines.push(L.depth(mname(summary.depthKey), Math.round(summary.depthMedian)));
  else lines.push(L.primary(mname(P), fmtVal(P, summary.farMedian)));
  if (summary.legHidden) lines.push(L.legHidden(summary.legHidden));
  if (summary.top.length) lines.push(L.top(summary.top.slice(0, 4)));
  lines.push(L.eachHead);
  for (const r of reps) {
    const iss = r.cmp.skipped ? L.skipped : (r.cmp.issues.map(i => i.text).join(L.issueSep) || L.clean);
    lines.push(L.rep(r.n, fmtVal(P, r.farV), r.out.toFixed(1), r.back.toFixed(1), iss));
  }

  const content = [];
  const addImg = (label, url) => {
    if (!url) return;
    content.push({type: 'text', text: label});
    content.push({type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: b64(url)}});
  };
  if (summary.best) addImg(L.img1(summary.best.n), summary.best.img);
  if (summary.worst) addImg(L.img2(summary.worst.n), summary.worst.img);
  addImg(L.img3, profile.images && profile.images.far);
  content.push({type: 'text', text: lines.join('\n') + '\n\n' + L.ask});

  return {
    model: AI_MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: L.system,
    output_config: {effort: 'medium', format: {type: 'json_schema', schema: schemaFor(L)}},
    messages: [{role: 'user', content}],
  };
}

/* 读出点评；被拒绝或格式不对时返回 {error} */
export function parseReview(res) {
  if (res.stop_reason === 'refusal') return {error: t('ai.err.refusal')};
  const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  try {
    const j = JSON.parse(text);
    if (typeof j.speech === 'string' && typeof j.details === 'string') return {speech: j.speech.trim(), details: j.details.trim()};
  } catch (e) { /* 落到下面 */ }
  return {error: res.stop_reason === 'max_tokens' ? t('ai.err.cut') : t('ai.err.format')};
}

let sdk = null;
async function loadSdk() { if (!sdk) sdk = await import(SDK_URL); return sdk; }

/* 真正调用 API。错误按类型给出说明 */
export async function reviewSet(apiKey, set) {
  const mod = await loadSdk();
  const client = new mod.default({apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 90_000});
  try {
    const res = await client.beta.messages.create(buildReviewRequest(set));
    return parseReview(res);
  } catch (e) {
    if (e instanceof mod.AuthenticationError) return {error: t('ai.err.auth')};
    if (e instanceof mod.PermissionDeniedError) return {error: t('ai.err.perm')};
    if (e instanceof mod.RateLimitError) return {error: t('ai.err.rate')};
    if (e instanceof mod.BadRequestError) return {error: t('ai.err.bad', {msg: (e.message || '').slice(0, 120)})};
    if (e instanceof mod.InternalServerError) return {error: t('ai.err.server')};
    if (e instanceof mod.APIConnectionError) return {error: t('ai.err.net')};
    return {error: t('ai.err.other', {msg: String(e && e.message || e).slice(0, 120)})};
  }
}
