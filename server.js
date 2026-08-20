// COUNTERMINE dev server. Sends no-store on everything: ES modules cached by the
// browser are the classic "fresh config + stale module = silent dead code" trap.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 5814;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  // Dev-only capture sink. The preview pane will not always composite, so the
  // page posts its own canvas here and the file is inspected off-disk.
  if (req.method === 'POST' && req.url.startsWith('/shot')) {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot')
          .replace(/[^a-z0-9_-]/gi, '');
        const data = body.replace(/^data:image\/\w+;base64,/, '');
        fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
        fs.writeFileSync(path.join(ROOT, 'shots', name + '.png'), Buffer.from(data, 'base64'));
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok ' + name);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' }).end('err ' + e.message);
      }
    });
    return;
  }

  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, path.normalize(rel).replace(/^[\\/]+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('no'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 ' + rel); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    });
    res.end(buf);
  });
}).listen(PORT, () => console.log('COUNTERMINE on http://localhost:' + PORT));
