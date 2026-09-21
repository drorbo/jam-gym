// The HTTP application: routing, cookies, CSRF, rate limits, JSON in and out. Business rules live in users.js and tracks.js.

import { LIMITS } from './config.js';
import { SCHEMA_VERSION } from './db.js';
import { createLimiter } from './limits.js';
import { createStatic } from './static.js';
import { createTracks } from './tracks.js';
import { createUsers, publicMe } from './users.js';
import { HttpError, bad, isSecret } from './util.js';

const COOKIE = 'jg_session';
const TWO_YEARS = 60 * 60 * 24 * 365 * 2;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * @param {{db: import('node:sqlite').DatabaseSync, config: ReturnType<import('./config.js').loadConfig>, root: string,
 *          limiter?: ReturnType<typeof createLimiter>}} deps
 */
export function createApp({ db, config, root, limiter = createLimiter() }) {
  const users = createUsers(db);
  const tracks = createTracks(db);
  const serveStatic = createStatic(root);

  // ---- request helpers -------------------------------------------------------------------

  const clientIp = (req) => {
    if (config.trustProxy) {
      const cf = req.headers['cf-connecting-ip'];
      if (typeof cf === 'string' && cf) return cf.trim();
      const xff = req.headers['x-forwarded-for'];
      if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  const isHttps = (req) => config.trustProxy && req.headers['x-forwarded-proto'] === 'https';

  function setSessionCookie(res, req, secret) {
    const attrs = [`${COOKIE}=${secret}`, 'Path=/', `Max-Age=${TWO_YEARS}`, 'HttpOnly', 'SameSite=Lax'];
    if (isHttps(req)) attrs.push('Secure');
    res.setHeader('Set-Cookie', attrs.join('; '));
  }

  function clearSessionCookie(res, req) {
    const attrs = [`${COOKIE}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
    if (isHttps(req)) attrs.push('Secure');
    res.setHeader('Set-Cookie', attrs.join('; '));
  }

  /** Every request that changes something must say it is ours (custom header) and come from our own origin. */
  function checkCsrf(req) {
    if (req.headers['x-jg'] !== '1') throw new HttpError(403, 'csrf', 'Missing the X-JG header.');
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      let host;
      try { host = new URL(origin).host; } catch { throw new HttpError(403, 'csrf', 'Bad Origin.'); }
      if (host !== req.headers.host) throw new HttpError(403, 'csrf', 'Cross-site request refused.');
    } else if (origin === 'null') {
      throw new HttpError(403, 'csrf', 'Cross-site request refused.');
    }
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const type = String(req.headers['content-type'] ?? '');
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        // Over the limit: stop keeping it, but let the client finish so it receives our 413 (not a dropped connection).
        // Far over the limit: it isn't a real client, so cut it off.
        if (size > 1024 * 1024) { req.destroy(); return; }
        if (size <= LIMITS.bodyBytes) chunks.push(c);
      });
      req.on('end', () => {
        if (size > LIMITS.bodyBytes) return reject(new HttpError(413, 'too_large', 'That request is too large.'));
        if (!chunks.length) return resolve({});
        if (!type.includes('application/json')) return reject(bad('Send JSON.', 'bad_content_type'));
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (value === null || typeof value !== 'object' || Array.isArray(value)) return reject(bad('The request body must be a JSON object.'));
          return resolve(value);
        } catch { return reject(bad('The request body is not valid JSON.')); }
      });
      req.on('error', reject);
    });
  }

  function send(res, status, body) {
    const text = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(text),
      ...(res.getHeader('Set-Cookie') ? { 'Set-Cookie': res.getHeader('Set-Cookie') } : {}),
    });
    res.end(text);
  }

  // ---- routes ----------------------------------------------------------------------------
  // auth: 'none' | 'optional' (use the user if there is one) | 'user' (must have one) | 'create' (make one if missing)
  // limits: [name, max, windowMs, perIpToo?] counted per user, or per IP when there is no user
  const W = ['write', 60, MINUTE];

  const routes = [
    ['GET', '/api/health', { auth: 'none', limit: null }, () => {
      db.prepare('SELECT 1').get();
      return { ok: true, schema: SCHEMA_VERSION };
    }],

    ['POST', '/api/session', { auth: 'none', limit: ['session', 60, MINUTE] }, ({ req, res, user, ip }) => {
      if (user) return { me: publicMe(user, users.counts(user)) };
      const gate = limiter.hit(`newid:${ip}`, 10, HOUR);
      if (!gate.ok) throw new HttpError(429, 'rate_limited', 'Too many new sessions from here. Try again later.');
      const made = users.create();
      setSessionCookie(res, req, made.secret);
      return { me: publicMe(made.user, users.counts(made.user)) };
    }],

    // Refreshing the cookie here keeps it alive for people who keep visiting.
    ['GET', '/api/me', { auth: 'optional', limit: ['read', 240, MINUTE] }, ({ req, res, user, secret }) => {
      if (user) setSessionCookie(res, req, secret);
      return { me: user ? publicMe(user, users.counts(user)) : null };
    }],

    ['PATCH', '/api/me', { auth: 'user', limit: W }, ({ user, body }) => {
      const updated = users.rename(user, body.displayName);
      return { me: publicMe(updated, users.counts(updated)) };
    }],

    ['GET', '/api/me/recovery', { auth: 'user', limit: ['recovery', 20, HOUR] }, ({ secret }) => ({ code: users.recoveryCode(secret) })],

    ['POST', '/api/me/recover', { auth: 'none', limit: ['recover', 20, HOUR] }, ({ req, res, body }) => {
      const found = users.findByRecoveryCode(body.code);
      if (!found) throw new HttpError(404, 'bad_code', 'That recovery code was not recognised.');
      setSessionCookie(res, req, found.secret);
      return { me: publicMe(found.user, users.counts(found.user)) };
    }],

    ['DELETE', '/api/me', { auth: 'user', limit: ['delete-me', 5, HOUR] }, ({ req, res, user }) => {
      users.deleteUser(user);
      clearSessionCookie(res, req);
      return { deleted: true };
    }],

    ['GET', '/api/tracks/mine', { auth: 'optional', limit: ['read', 240, MINUTE] }, ({ user }) => ({ tracks: user ? tracks.listMine(user) : [] })],

    ['POST', '/api/tracks/import', { auth: 'create', limit: ['import', 10, HOUR] }, ({ user, body }) => tracks.importMany(user, body.items)],

    ['POST', '/api/tracks', { auth: 'create', limit: ['create', 30, HOUR, true] }, ({ user, body }) => ({ track: tracks.create(user, body) }), 201],

    ['GET', '/api/tracks/:id', { auth: 'optional', limit: ['read', 240, MINUTE] }, ({ user, params }) => ({ track: tracks.get(params.id, user) })],

    ['PUT', '/api/tracks/:id', { auth: 'user', limit: W }, ({ user, params, body }) => ({ track: tracks.update(user, params.id, body) })],

    ['DELETE', '/api/tracks/:id', { auth: 'user', limit: W }, ({ user, params }) => { tracks.remove(user, params.id); return { deleted: true }; }],

    ['POST', '/api/tracks/:id/publish', { auth: 'user', limit: ['publish', 10, HOUR] }, ({ user, params }) => ({ track: tracks.publish(user, params.id) })],

    ['POST', '/api/tracks/:id/unpublish', { auth: 'user', limit: W }, ({ user, params }) => ({ track: tracks.unpublish(user, params.id) })],

    ['POST', '/api/tracks/:id/copy', { auth: 'create', limit: ['create', 30, HOUR, true] }, ({ user, params }) => ({ track: tracks.copy(user, params.id) }), 201],

    ['PUT', '/api/tracks/:id/like', { auth: 'create', limit: ['like', 120, MINUTE, true] }, ({ user, params }) => tracks.like(user, params.id)],

    ['DELETE', '/api/tracks/:id/like', { auth: 'user', limit: ['like', 120, MINUTE, true] }, ({ user, params }) => tracks.unlike(user, params.id)],

    ['POST', '/api/tracks/:id/report', { auth: 'create', limit: ['report', 20, HOUR, true] }, ({ user, params, body }) => tracks.report(user, params.id, body.reason)],

    ['GET', '/api/browse', { auth: 'optional', limit: ['browse', 120, MINUTE, true] }, ({ user, url }) => tracks.browse(user, url.searchParams)],
  ].map(([method, path, opts, handler, status = 200]) => ({
    method, opts, handler, status,
    regex: new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`),
  }));

  // ---- dispatch --------------------------------------------------------------------------

  async function handleApi(req, res, url) {
    const ip = clientIp(req);
    let matched = null;
    let pathMatched = false;
    for (const r of routes) {
      const m = r.regex.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method === req.method) { matched = { r, params: { ...m.groups } }; break; }
    }
    if (!matched) {
      if (pathMatched) throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
      throw new HttpError(404, 'not_found', 'No such endpoint.');
    }
    const { r, params } = matched;

    const overall = limiter.hit(`ip:${ip}`, 600, MINUTE);
    if (!overall.ok) throw Object.assign(new HttpError(429, 'rate_limited', 'Too many requests. Slow down a little.'), { retryAfter: overall.retryAfter });

    const writes = !['GET', 'HEAD'].includes(req.method);
    if (writes) checkCsrf(req);
    const body = writes ? await readJson(req) : {};

    const secret = parseCookies(req.headers.cookie)[COOKIE];
    let user = isSecret(secret) ? users.findBySecret(secret) : null;
    let activeSecret = user ? secret : null;
    if (r.opts.auth === 'user' && !user) throw new HttpError(401, 'no_session', 'You have not saved anything yet.');
    if (r.opts.auth === 'create' && !user) {
      const gate = limiter.hit(`newid:${ip}`, 10, HOUR);
      if (!gate.ok) throw new HttpError(429, 'rate_limited', 'Too many new sessions from here. Try again later.');
      const made = users.create();
      user = made.user;
      activeSecret = made.secret;
      setSessionCookie(res, req, made.secret);
    }

    if (r.opts.limit) {
      const [name, max, windowMs, alsoIp] = r.opts.limit;
      const who = user ? `u${user.id}` : `ip:${ip}`;
      const a = limiter.hit(`${name}:${who}`, max, windowMs);
      const b = alsoIp && user ? limiter.hit(`${name}:ip:${ip}`, max * 2, windowMs) : { ok: true };
      if (!a.ok || !b.ok) {
        throw Object.assign(new HttpError(429, 'rate_limited', 'Too many requests. Please wait a moment.'), { retryAfter: (a.ok ? b : a).retryAfter });
      }
    }

    const result = await r.handler({ req, res, url, params, body, user, secret: activeSecret, ip });
    send(res, r.status, result);
  }

  return async function handle(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return undefined;
      }
      return await serveStatic(req, res, url.pathname);
    } catch (err) {
      if (res.headersSent) { res.end(); return undefined; }
      if (err instanceof HttpError) {
        if (err.retryAfter) res.setHeader('Retry-After', err.retryAfter);
        send(res, err.status, { error: { code: err.code, message: err.message } });
      } else {
        console.error('Unhandled error:', err);
        send(res, 500, { error: { code: 'server_error', message: 'Something went wrong on our side.' } });
      }
      return undefined;
    }
  };
}
