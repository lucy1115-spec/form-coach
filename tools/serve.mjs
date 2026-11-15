// 本地开发服务器（只给自己电脑用，不部署）。
//   node tools/serve.mjs            -> http://localhost:8080
// - 静态文件：app/ 目录
// - /video/<文件名>：读 VIDEO_DIR（默认 ../video，即 coach/video），支持 Range，方便 <video> 拖动
// - POST /__fixture/<名字>.json：把关节点数据存到 test/fixtures/（tools/extract.html 用）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO_DIR = path.resolve(ROOT, process.env.VIDEO_DIR || '../video');
const FIXTURE_DIR = path.join(ROOT, 'test', 'fixtures');
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
  '.webm': 'video/webm', '.webmanifest': 'application/manifest+json',
};

function inside(base, p) { const r = path.relative(base, p); return r && !r.startsWith('..') && !path.isAbsolute(r); }

function sendFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
      start = Math.max(0, start); end = Math.min(st.size - 1, end);
      if (start > end) { res.writeHead(416, {'Content-Range': `bytes */${st.size}`}); res.end(); return; }
      res.writeHead(206, {'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Cache-Control': 'no-store'});
      fs.createReadStream(file, {start, end}).pipe(res);
      return;
    }
    res.writeHead(200, {'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size, 'Cache-Control': 'no-store'});
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);

  if (req.method === 'POST' && p.startsWith('/__fixture/')) {
    const name = path.basename(p);
    if (!/^[\w.-]+\.json$/.test(name)) { res.writeHead(400); res.end('bad name'); return; }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      fs.mkdirSync(FIXTURE_DIR, {recursive: true});
      fs.writeFileSync(path.join(FIXTURE_DIR, name), Buffer.concat(chunks));
      console.log('saved fixture', name);
      res.writeHead(200); res.end('ok');
    });
    return;
  }

  if (p.startsWith('/video/')) {
    const file = path.join(VIDEO_DIR, p.slice('/video/'.length));
    if (!inside(VIDEO_DIR, file)) { res.writeHead(403); res.end(); return; }
    sendFile(req, res, file);
    return;
  }

  const file = path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
  if (!inside(ROOT, file)) { res.writeHead(403); res.end(); return; }
  sendFile(req, res, file);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Form Coach dev server: http://localhost:${PORT}/  (video: ${VIDEO_DIR})`);
});
