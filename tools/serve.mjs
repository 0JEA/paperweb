// Minimal static server for the demo and the browser tests. No dependencies:
// the whole point of paperweb is that it runs from source with no build step, so
// its own tooling should not need one either.

import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELECTIONS = join(ROOT, 'demo', 'selections.json');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export function serve(port = 0) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      // The demo's keep/discard picker posts here; the result is written to
      // demo/selections.json so it can be read outside the browser.
      if (req.method === 'POST' && url.pathname === '/api/selections') {
        const chunks = [];
        let bytes = 0;
        for await (const c of req) {
          bytes += c.length;
          // The payload is a short list of labels. A cap keeps a stray client
          // from streaming the process out of memory.
          if (bytes > 1 << 20) { res.writeHead(413).end('too large'); return; }
          chunks.push(c);
        }
        const body = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(body); } catch { res.writeHead(400).end('bad json'); return; }
        const record = { savedAt: new Date().toISOString(), ...parsed };
        await writeFile(SELECTIONS, `${JSON.stringify(record, null, 2)}\n`);
        console.log(`selections saved: ${(parsed.keep || []).length} keep, ${(parsed.discard || []).length} discard -> ${SELECTIONS}`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: SELECTIONS }));
        return;
      }

      // normalize + the prefix check keeps a crafted ../ from escaping ROOT.
      let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
      if (!path.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
      let s = await stat(path).catch(() => null);
      if (s && s.isDirectory()) { path = join(path, 'index.html'); s = await stat(path).catch(() => null); }
      if (!s) { res.writeHead(404).end('not found'); return; }
      const body = await readFile(path);
      res.writeHead(200, {
        'content-type': TYPES[extname(path)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await serve(Number(process.env.PORT) || 8099);
  console.log(`paperweb demo: ${url}/demo/`);
}
