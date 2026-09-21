// Serving the site's own files. An allowlist of folders, so nothing else in the project (server code, data, tests) is reachable.

import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';

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

/**
 * A short fingerprint for every script and stylesheet the page loads, keyed by URL path ("/src/app/ui.js").
 * Cloudflare (and browsers) may keep .js and .css for hours whatever the origin says, so the page asks for
 * "ui.js?v=<fingerprint>" instead: a changed file has a new address and can never be served stale.
 */
export function fingerprints(base) {
  const versions = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|css)$/.test(entry.name)) {
        const path = `/${relative(base, full).split(sep).join('/')}`;
        versions.set(path, createHash('sha256').update(readFileSync(full)).digest('hex').slice(0, 10));
      }
    }
  };
  for (const folder of ['src', 'css']) {
    try { walk(join(base, folder)); } catch { /* a missing folder just means nothing to fingerprint */ }
  }
  return versions;
}

/**
 * The page with versioned addresses: stylesheet and entry-script URLs get "?v=...", and an import map gives every
 * module the same, so the modules that import each other are versioned too. Pure, so it can be tested.
 */
export function versionedHtml(html, versions) {
  const imports = {};
  for (const [path, v] of versions) if (path.endsWith('.js')) imports[path] = `${path}?v=${v}`;
  let out = html.replace(/(href|src)="((?:css|src)\/[^"?#]+)"/g, (whole, attr, path) => (
    versions.has(`/${path}`) ? `${attr}="${path}?v=${versions.get(`/${path}`)}"` : whole
  ));
  const at = out.search(/<script[^>]*\stype="module"/);
  if (at !== -1) out = `${out.slice(0, at)}<script type="importmap">${JSON.stringify({ imports })}</script>
  ${out.slice(at)}`;
  return out;
}

/**
 * @param {string} root the project directory
 * @param {{watch?: boolean}} [opts] watch: files may change while the server runs (development), so re-read them
 */
export function createStatic(root, { watch = false } = {}) {
  const base = resolve(root);
  let versions;
  let page;
  let builtAt = 0;

  /** (Re)build the fingerprints and the page. In production this happens once; in development, at most twice a second. */
  function build() {
    versions = fingerprints(base);
    const html = versionedHtml(readFileSync(join(base, 'index.html'), 'utf8'), versions);
    const tag = createHash('sha256').update(html).digest('hex').slice(0, 16);
    page = { html, csp: buildCsp(html), etag: `W/"${tag}"` };
    builtAt = Date.now();
  }
  build();

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
    if (watch && Date.now() - builtAt > 500) build();

    if (pathname === '/' || pathname === '/index.html') {
      const headers = {
        'Content-Type': TYPES['.html'], ETag: page.etag, 'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': page.csp,
      };
      if (req.headers['if-none-match'] === page.etag) {
        res.writeHead(304, { ETag: page.etag, 'Cache-Control': 'no-cache' });
        return res.end();
      }
      const body = Buffer.from(page.html, 'utf8');
      res.writeHead(200, { ...headers, 'Content-Length': body.length });
      return res.end(req.method === 'HEAD' ? undefined : body);
    }

    const file = locate(pathname);
    let info;
    try { info = file && (await stat(file)); } catch { info = null; }
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    // an address with the file's current fingerprint never changes meaning, so it can be kept for good
    const asked = new URL(req.url, 'http://localhost').searchParams.get('v');
    const versioned = asked !== null && asked === versions.get(pathname);
    const headers = {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      ETag: etag,
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : LONG_CACHE.test(pathname) ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
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
