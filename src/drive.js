// Google Drive 自动上传：训练记录 CSV 直接传到用户自己的 Google Drive，不用再走分享菜单。
// 授权用 Google Identity Services 的 token client（浏览器里拿 1 小时有效的 access token，没有密钥）。
// 权限只要 drive.file：App 只能看到、改它自己建的文件，碰不到 Drive 里的其他东西。
// 所以 App 建自己的文件夹（DRIVE_FOLDER），电脑上的导入脚本也读这个文件夹。
// 这里只放不碰 DOM 的部分（fetch 由调用方传入），Node 测试用假的 fetch，不联网。

// Google Cloud 里建的 OAuth 客户端 ID（Web 应用）。它不是密钥，公开也没关系：
// 只有 https://lucy1115-spec.github.io 和本地 http://localhost:8080 能用它要授权。
export const CLIENT_ID = '13880796032-3tqdcb9tfddnfmddssuulcsb1mar1rbc.apps.googleusercontent.com';
export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_FOLDER = 'Form Coach 记录';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/* token 还能用吗（留 2 分钟余量） */
export const tokenValid = (tok, now = Date.now()) => !!(tok && tok.access_token && tok.expires_at && tok.expires_at - now > 120000);

/* GIS 回调给的 {access_token, expires_in} → 存起来用的 {access_token, expires_at} */
export const tokenFrom = (resp, now = Date.now()) => ({access_token: resp.access_token, expires_at: now + (Number(resp.expires_in) || 3600) * 1000});

/* multipart/related 请求体：第一段是文件信息（JSON），第二段是文件内容 */
export function multipartBody(meta, content, type, boundary) {
  return `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: ${type}\r\n\r\n${content}\r\n--${boundary}--`;
}

async function call(fetch, url, token, init = {}) {
  const r = await fetch(url, {...init, headers: {...(init.headers || {}), Authorization: `Bearer ${token}`}});
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); if (j && j.error && j.error.message) msg += `: ${j.error.message}`; } catch (e) {}
    const err = new Error(msg); err.status = r.status; throw err;
  }
  return r.json();
}

/* 找 App 自己建的文件夹，没有就建一个。folderId 可以缓存，传进来时先确认还在 */
export async function ensureFolder(fetch, token, cachedId) {
  if (cachedId) {
    try { const f = await call(fetch, `${API}/${encodeURIComponent(cachedId)}?fields=id,trashed`, token); if (f && !f.trashed) return f.id; }
    catch (e) { if (e.status === 401) throw e; }
  }
  const q = `name='${DRIVE_FOLDER.replace(/'/g, "\\'")}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const list = await call(fetch, `${API}?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`, token);
  if (list.files && list.files.length) return list.files[0].id;
  const made = await call(fetch, `${API}?fields=id`, token, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: DRIVE_FOLDER, mimeType: FOLDER_MIME})});
  return made.id;
}

/* 上传一个 CSV 到文件夹里。返回 {id, name} */
export async function uploadCsv(fetch, token, {name, csv, folderId}) {
  const boundary = 'fc' + Math.random().toString(36).slice(2);
  return call(fetch, UPLOAD, token, {
    method: 'POST',
    headers: {'Content-Type': `multipart/related; boundary=${boundary}`},
    body: multipartBody({name, mimeType: 'text/csv', parents: [folderId]}, csv, 'text/csv; charset=UTF-8', boundary),
  });
}
