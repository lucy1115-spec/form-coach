// Google Drive 上传：只测请求内容，用假的 fetch，不联网
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tokenValid, tokenFrom, multipartBody, ensureFolder, uploadCsv, DRIVE_FOLDER, SCOPE} from '../src/drive.js';

function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({url, init});
    for (const [match, resp] of routes) if (match(url, init)) {
      const {status = 200, body = {}} = typeof resp === 'function' ? resp(url, init) : resp;
      return {ok: status < 400, status, json: async () => body};
    }
    return {ok: false, status: 404, json: async () => ({error: {message: 'not found'}})};
  };
  f.calls = calls;
  return f;
}

test('token：有效期留 2 分钟余量', () => {
  const tok = tokenFrom({access_token: 'abc', expires_in: 3599}, 1000);
  assert.equal(tok.expires_at, 1000 + 3599000);
  assert.ok(tokenValid(tok, 1000));
  assert.ok(!tokenValid(tok, 1000 + 3599000 - 60000));
  assert.ok(!tokenValid(null));
  assert.equal(SCOPE, 'https://www.googleapis.com/auth/drive.file');
});

test('multipart 请求体', () => {
  const b = multipartBody({name: 'a.csv'}, 'x,y\n', 'text/csv', 'B');
  assert.equal(b, '--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"a.csv"}\r\n--B\r\nContent-Type: text/csv\r\n\r\nx,y\n\r\n--B--');
});

test('文件夹：缓存的还在就用；不在就搜；搜不到就建', async () => {
  let f = fakeFetch([[u => u.includes('/files/F1?'), {body: {id: 'F1', trashed: false}}]]);
  assert.equal(await ensureFolder(f, 'T', 'F1'), 'F1');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer T');

  f = fakeFetch([[u => u.includes('/files/OLD?'), {body: {id: 'OLD', trashed: true}}], [u => u.includes('?q='), {body: {files: [{id: 'F2'}]}}]]);
  assert.equal(await ensureFolder(f, 'T', 'OLD'), 'F2');
  assert.match(decodeURIComponent(f.calls[1].url), new RegExp(`name='${DRIVE_FOLDER}'`));

  f = fakeFetch([[u => u.includes('?q='), {body: {files: []}}], [(u, i) => i.method === 'POST', {body: {id: 'NEW'}}]]);
  assert.equal(await ensureFolder(f, 'T'), 'NEW');
  assert.deepEqual(JSON.parse(f.calls[1].init.body), {name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder'});
});

test('授权过期（401）要抛出来，让界面重新要授权', async () => {
  const f = fakeFetch([[() => true, {status: 401, body: {error: {message: 'Invalid Credentials'}}}]]);
  await assert.rejects(ensureFolder(f, 'T', 'F1'), e => e.status === 401 && /Invalid Credentials/.test(e.message));
});

test('上传：放进文件夹，文件名和内容对', async () => {
  const f = fakeFetch([[u => u.includes('uploadType=multipart'), {body: {id: 'X', name: 'form-coach-1.csv'}}]]);
  const r = await uploadCsv(f, 'T', {name: 'form-coach-1.csv', csv: 'date\n2026-11-20\n', folderId: 'F'});
  assert.deepEqual(r, {id: 'X', name: 'form-coach-1.csv'});
  const {init} = f.calls[0];
  const boundary = init.headers['Content-Type'].match(/boundary=(\S+)/)[1];
  assert.ok(init.body.startsWith(`--${boundary}\r\n`));
  assert.match(init.body, /"parents":\["F"\]/);
  assert.match(init.body, /2026-11-20/);
});

test('Oura 文件：找不到返回 null；建文件带 parents；读出 JSON', async () => {
  const {findFile, createJson, readJson} = await import('../src/drive.js');
  let f = fakeFetch([[u => u.includes('?q='), {body: {files: []}}]]);
  assert.equal(await findFile(f, 'T', 'F', 'Oura 今天.json'), null);
  assert.match(decodeURIComponent(f.calls[0].url), /name='Oura 今天\.json' and 'F' in parents/);
  f = fakeFetch([[u => u.includes('uploadType=multipart'), {body: {id: 'O1'}}]]);
  assert.equal(await createJson(f, 'T', 'F', 'Oura 今天.json', {}), 'O1');
  assert.match(f.calls[0].init.body, /"parents":\["F"\]/);
  const g = async () => ({ok: true, status: 200, text: async () => '{"days":[{"date":"2026-11-21","readiness":84}]}'});
  assert.equal((await readJson(g, 'T', 'O1')).days[0].readiness, 84);
  const empty = async () => ({ok: true, status: 200, text: async () => ''});
  assert.deepEqual(await readJson(empty, 'T', 'O1'), {});
});
