// Serving the site's own files. An allowlist of folders, so nothing else in the project (server code, data, tests) is reachable.

import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const ALLOWED = ['src', 'css', 'fonts', 'samples'];
const LONG_CACHE = /^\/(fonts|samples\/(drums|keys))\//;

/**
 * Content-Security-Policy for the page. The one inline script (which applies the saved theme before first paint) is
 * allowed by its hash rather than by 'unsafe-inline'. The HTML parser turns CRLF into LF before the browser hashes the
 * script, so the hash is taken over the same text (a checkout with Windows line endings would otherwise break it).
 */
export function buildCsp(indexHtml) {
  const hashes = [...indexHtml.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => `'sha256-${createHash('sha256').update(m[1].replace(/\r\n?/g, '\n')).digest('base64')}'`);
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')} https://static.cloudflareinsights.com`,
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

/** @param {string} root the project directory */
export function createStatic(root) {
  const base = resolve(root);
  const csp = buildCsp(readFileSync(join(base, 'index.html'), 'utf8'));

  /** Map a URL path to a file path inside the allowlist, or null. */
  function locate(pathname) {
    let p;
    try { p = decodeURIComponent(pathname); } catch { return null; }
    if (p.includes('\0') || p.includes('\\')) return null;
    if (p === '/' || p === '/index.html') return join(base, 'index.html');
    // Never accept dot segments, even ones hidden as %2e or %2f. Then check the folder the path really lands in,
    // after resolving, not the one it starts with.
    if (p.split('/').some((seg) => seg === '..' || seg === '.')) return null;
    const file = resolve(base, normalize(`.${p}`));
    if (!file.startsWith(base + sep)) return null;
    const topFolder = file.slice(base.length + 1).split(sep)[0];
    return ALLOWED.includes(topFolder) ? file : null;
  }

  return async function serve(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Method not allowed');
    }
    const file = locate(pathname);
    let info;
    try { info = file && (await stat(file)); } catch { info = null; }
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      ETag: etag,
      'Cache-Control': LONG_CACHE.test(pathname) ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    if (file.endsWith('index.html')) headers['Content-Security-Policy'] = csp;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': headers['Cache-Control'] });
      return res.end();
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
    return undefined;
  };
}
