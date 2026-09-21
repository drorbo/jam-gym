// Tiny zero-dependency static file server: `npm start` -> http://localhost:5173
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT) || 5173;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
    if (rel === '' || rel.endsWith('/') || rel.endsWith('\\')) rel = join(rel, 'index.html');
    const file = resolve(root, rel);
    if (!file.startsWith(root)) throw Object.assign(new Error('forbidden'), { code: 'EACCES' });
    const info = await stat(file);
    if (!info.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'EACCES' ? 403 : 404, { 'Content-Type': 'text/plain' });
    res.end(err.code === 'EACCES' ? 'Forbidden' : 'Not found');
  }
}).listen(port, () => console.log(`Jam Gym running at http://localhost:${port}`));
