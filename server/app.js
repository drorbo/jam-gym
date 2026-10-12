// The HTTP application: routing, cookies, CSRF, rate limits, JSON in and out. Business rules live in users.js and tracks.js.

import { LIMITS } from './config.js';
import { SCHEMA_VERSION } from './db.js';
import { createLimiter } from './limits.js';
import { createPresets } from './presets.js';
import { createStatic } from './static.js';
import { createTracks } from './tracks.js';
import { verifyToken } from './sso.js';
import { readAvatar } from './avatar.js';
import { authorizeUrl, exchangeCode, pkcePair } from './google.js';
import { checkPassword, checkUsername, hashPassword, verifyPassword } from './password.js';
import { createUsers, publicMe } from './users.js';
import { HttpError, bad, isSecret, randomId } from './util.js';
import { timingSafeEqual } from 'node:crypto';

const SSO_COOKIE = 'jg_sso'; // the state of a sign-in with eardle that is under way (10 minutes); scoped to SSO_PATH,
// so it cannot itself take the __Host- prefix below (that prefix requires Path=/), but that narrow path is its own
// protection: nothing other than the two sign-in routes ever sees it.
const SSO_PATH = '/api/auth/eardle';
const GOOGLE_COOKIE = 'jg_google'; // state.nonce.verifier of a Google sign-in under way (10 minutes), scoped to GOOGLE_PATH like the one above
const GOOGLE_PATH = '/api/auth/google';
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
  const presets = createPresets(db);
  const features = { eardle: Boolean(config.eardle.secret), google: Boolean(config.google.clientId && config.google.clientSecret) };
  const sameText = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && a.length > 0 && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  /** The Google settings for this request: the redirect address is the configured one, or this site's own callback. */
  const googleConfig = (req) => ({
    ...config.google,
    redirectUri: config.google.redirectUri || `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}${GOOGLE_PATH}/callback`,
  });
  const serveStatic = createStatic(root, { watch: !config.production });
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

  // The __Host- prefix tells the browser to refuse the cookie unless it also carries Secure, Path=/ and no Domain —
  // sent here only, never settable by a script or by another origin. Decided per request (by isHttps, the same check
  // that decides Secure) rather than once for the whole process: the two must always agree, or a browser would
  // refuse the cookie outright (a __Host- name demands Secure). In production every request is already HTTPS by the
  // time it reaches here, so this is always the hardened name there; plain local development over http://localhost
  // keeps the plain name, so `npm start` needs no special-casing.
  const cookieName = (req) => (isHttps(req) ? '__Host-jg_session' : 'jg_session');

  /** Add a Set-Cookie without replacing one already set on this response (a sign-in sets two). */
  function addCookie(res, req, name, value, { path = '/', maxAge }) {
    const attrs = [`${name}=${value}`, `Path=${path}`, `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax'];
    if (isHttps(req)) attrs.push('Secure');
    const earlier = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', earlier ? [].concat(earlier, attrs.join('; ')) : attrs.join('; '));
  }

  const setSessionCookie = (res, req, secret) => addCookie(res, req, cookieName(req), secret, { maxAge: TWO_YEARS });
  const clearSessionCookie = (res, req) => addCookie(res, req, cookieName(req), '', { maxAge: 0 });

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

  function readJson(req, maxBytes = LIMITS.bodyBytes) {
    return new Promise((resolve, reject) => {
      const type = String(req.headers['content-type'] ?? '');
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        // Over the limit: stop keeping it, but let the client finish so it receives our 413 (not a dropped connection).
        // Far over the limit: it isn't a real client, so cut it off.
        if (size > 1024 * 1024) { req.destroy(); return; }
        if (size <= maxBytes) chunks.push(c);
      });
      req.on('end', () => {
        if (size > maxBytes) return reject(new HttpError(413, 'too_large', 'That request is too large.'));
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
      if (user) return { me: publicMe(user, users.counts(user)), features };
      const gate = limiter.hit(`newid:${ip}`, 10, HOUR);
      if (!gate.ok) throw new HttpError(429, 'rate_limited', 'Too many new sessions from here. Try again later.');
      const made = users.create();
      setSessionCookie(res, req, made.secret);
      return { me: publicMe(made.user, users.counts(made.user)), features };
    }],

    // Refreshing the cookie here keeps it alive for people who keep visiting.
    ['GET', '/api/me', { auth: 'optional', limit: ['read', 240, MINUTE] }, ({ req, res, user, secret }) => {
      if (user) setSessionCookie(res, req, secret);
      return { me: user ? publicMe(user, users.counts(user)) : null, features };
    }],

    // the name and/or the bio; send only what changes
    ['PATCH', '/api/me', { auth: 'user', limit: W }, ({ user, body }) => {
      let updated = user;
      if (body.displayName !== undefined || body.bio === undefined) updated = users.rename(updated, body.displayName);
      if (body.bio !== undefined) updated = users.setBio(updated, body.bio);
      return { me: publicMe(updated, users.counts(updated)) };
    }],

    // the photo: a small JPEG as base64, cropped and re-encoded by the browser (src/app/avatar.js) and re-checked here
    ['PUT', '/api/me/avatar', { auth: 'user', limit: ['avatar', 10, HOUR], bodyBytes: LIMITS.avatarBodyBytes }, ({ user, body }) => {
      if (user.banned) throw new HttpError(403, 'banned', 'This account can no longer change its profile.');
      const updated = users.setAvatar(user, readAvatar(body.image));
      return { me: publicMe(updated, users.counts(updated)) };
    }],

    ['DELETE', '/api/me/avatar', { auth: 'user', limit: W }, ({ user }) => {
      const updated = users.clearAvatar(user);
      return { me: publicMe(updated, users.counts(updated)) };
    }],

    // anyone can see a photo and a profile of someone who has published; the id is the public one, never the secret
    ['GET', '/api/avatar/:id', { auth: 'none', limit: ['avatar-read', 600, MINUTE, true], raw: true }, ({ params }) => {
      const a = users.avatarOf(params.id);
      if (!a) throw new HttpError(404, 'not_found', 'No photo.');
      return {
        status: 200,
        body: a.data,
        headers: {
          'Content-Type': 'image/jpeg',
          // the address carries ?v=<version>, so a changed photo has a new address and this can be kept for a long time
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Cross-Origin-Resource-Policy': 'same-origin',
        },
      };
    }],

    ['GET', '/api/profiles/:id', { auth: 'optional', limit: ['read', 240, MINUTE] }, ({ user, params }) => {
      const profile = users.profileOf(params.id);
      if (!profile) throw new HttpError(404, 'not_found', 'That profile was not found.');
      return { profile, tracks: tracks.listPublishedBy(params.id, user) };
    }],

    // ---- a username and a password ----
    // signup: with no account yet it makes one; from a browser that already has an anonymous library it gives that
    // library a login, so nothing already saved is lost. There is no reset (no email is kept), which the page says.
    ['POST', '/api/auth/signup', { auth: 'optional', limit: ['signup', 10, HOUR, true] }, async ({ req, res, user, ip, body }) => {
      const name = checkUsername(body.username);
      const password = checkPassword(body.password, name);
      if (user?.username) throw new HttpError(409, 'already_has_login', 'This account already has a login.');
      if (users.findByUsername(name)) throw new HttpError(409, 'username_taken', 'That username is taken. Try another.');
      const hash = await hashPassword(password);
      let target = user;
      let made = null;
      if (!target) {
        const gate = limiter.hit(`newid:${ip}`, 10, HOUR);
        if (!gate.ok) throw new HttpError(429, 'rate_limited', 'Too many new sessions from here. Try again later.');
        made = users.create();
        target = made.user;
      }
      let updated;
      try { updated = users.setLogin(target, name, hash); } catch (err) { if (made) users.deleteUser(made.user); throw err; }
      if (made) setSessionCookie(res, req, made.secret);
      return { me: publicMe(updated, users.counts(updated)) };
    }, 201],

    // login: this browser becomes that account (a session, like signing in with eardle on a second device). A library this
    // browser had made without an account joins it. Wrong name and wrong password get the same answer and the same cost.
    ['POST', '/api/auth/login', { auth: 'optional', limit: ['login', 40, 15 * MINUTE, true] }, async ({ req, res, user, ip, body }) => {
      const name = String(body.username ?? '').trim().slice(0, 40);
      const password = typeof body.password === 'string' ? body.password : '';
      for (const [key, max, window] of [[`login:${ip}:${name.toLowerCase()}`, 10, 15 * MINUTE], [`login-name:${name.toLowerCase()}`, 60, HOUR]]) {
        if (!limiter.hit(key, max, window).ok) throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.');
      }
      const target = users.findByUsername(name);
      if (!(await verifyPassword(password, target?.password_hash)) || !target) {
        throw new HttpError(401, 'bad_login', 'That username and password do not match.');
      }
      if (user?.id !== target.id) {
        // whatever this browser had been building without an account joins the one being logged in to
        if (user && !user.auth_provider && !user.username && !user.google_sub && !user.banned) users.absorb(target, user);
        setSessionCookie(res, req, users.startSession(target));
      }
      const fresh = users.findByUsername(name);
      return { me: publicMe(fresh, users.counts(fresh)) };
    }],

    // changing it needs the current one; every other device is logged out, this one stays in
    ['POST', '/api/me/password', { auth: 'user', limit: ['password', 10, HOUR] }, async ({ req, res, user, secret, body }) => {
      if (!user.password_hash) throw bad('This account has no password yet. Create a login first.', 'no_login');
      if (!(await verifyPassword(typeof body.current === 'string' ? body.current : '', user.password_hash))) {
        throw new HttpError(401, 'bad_login', 'The current password is not right.');
      }
      const next = checkPassword(body.next, user.username);
      users.setPasswordHash(user, await hashPassword(next));
      users.endAllSessions(user);
      if (!users.isOwnSecret(user, secret)) setSessionCookie(res, req, users.startSession(user));
      return { changed: true };
    }],

    // ---- continue with Google (server/google.js, docs/google-login.md) ----
    // start: remember a random state, nonce and PKCE verifier in a cookie and send the person to Google
    ['GET', `${GOOGLE_PATH}/start`, { auth: 'none', limit: ['sso', 30, HOUR], redirect: true }, ({ req, res }) => {
      if (!features.google) throw new HttpError(404, 'google_off', 'Continue with Google is not switched on here.');
      const state = randomId(32);
      const nonce = randomId(32);
      const { verifier, challenge } = pkcePair();
      addCookie(res, req, GOOGLE_COOKIE, `${state}.${nonce}.${verifier}`, { path: GOOGLE_PATH, maxAge: 600 });
      return authorizeUrl(googleConfig(req), { state, nonce, challenge });
    }],

    // callback: Google sends the person back with a one-time code. Whatever goes wrong, they land on the home page with a
    // message and nothing is changed; only a code that checks out against the cookie gets as far as a Google account id.
    ['GET', `${GOOGLE_PATH}/callback`, { auth: 'none', limit: ['sso', 30, HOUR], redirect: true }, async ({ req, res, url, user, secret }) => {
      const [state, nonce, verifier] = String(parseCookies(req.headers.cookie)[GOOGLE_COOKIE] ?? '').split('.');
      addCookie(res, req, GOOGLE_COOKIE, '', { path: GOOGLE_PATH, maxAge: 0 }); // a state is good for one attempt
      if (!features.google) return '/?google=failed';
      if (url.searchParams.get('error')) return '/?google=cancelled'; // the person said no, or closed the window
      const code = url.searchParams.get('code');
      if (!sameText(state, url.searchParams.get('state')) || !code || !nonce || !verifier) return '/?google=failed';
      let who;
      try { who = await exchangeCode(googleConfig(req), { code, verifier, nonce }); } catch { return '/?google=failed'; }

      const existing = users.findByGoogle(who.sub);
      if (existing) {
        if (user?.id === existing.id) return '/?google=ok';
        // whatever this browser had been building without an account joins the Google account's library
        if (user && !user.auth_provider && !user.username && !user.google_sub && !user.banned) users.absorb(existing, user);
        setSessionCookie(res, req, users.startSession(existing));
      } else if (user && !user.google_sub) {
        users.linkGoogle(user, who.sub); // "Connect Google": this browser's account (with or without another login) gains it; its cookie stays
      } else {
        setSessionCookie(res, req, users.createLinkedGoogle(who.sub).secret);
      }
      return '/?google=ok';
    }],

    // ---- sign in with eardle (server/sso.js, docs/eardle-accounts.md) ----
    // start: remember a random state in a cookie and send the person to eardle, which signs them in if needed and comes back
    ['GET', `${SSO_PATH}/start`, { auth: 'none', limit: ['sso', 30, HOUR], redirect: true }, ({ req, res }) => {
      if (!features.eardle) throw new HttpError(404, 'sso_off', 'Sign in with eardle is not switched on here.');
      const state = randomId(32);
      addCookie(res, req, SSO_COOKIE, state, { path: SSO_PATH, maxAge: 600 });
      return `${config.eardle.url}/jam-gym/authorize?state=${state}`;
    }],

    // callback: eardle's signed token names an eardle user. Whatever goes wrong, the person lands on the home page with a
    // message; nothing is changed unless the token checks out against the state cookie.
    ['GET', `${SSO_PATH}/callback`, { auth: 'none', limit: ['sso', 30, HOUR], redirect: true }, ({ req, res, url, user, secret }) => {
      const state = parseCookies(req.headers.cookie)[SSO_COOKIE];
      addCookie(res, req, SSO_COOKIE, '', { path: SSO_PATH, maxAge: 0 }); // a state is good for one attempt
      let who;
      try { who = verifyToken(config.eardle.secret, url.searchParams.get('token'), state); } catch { return '/?eardle=failed'; }

      const existing = users.findByEardle(who.sub);
      if (existing) {
        if (user?.id === existing.id) return '/?eardle=ok';
        // whatever this browser had been building without an account joins the eardle account's library
        if (user && !user.auth_provider && !user.username && !user.google_sub && !user.banned) users.absorb(existing, user);
        setSessionCookie(res, req, users.startSession(existing));
      } else if (user && !user.auth_provider) {
        users.linkEardle(user, who.sub, who.name); // the browser's own library becomes the eardle account's; its cookie stays
      } else {
        setSessionCookie(res, req, users.createLinked(who.sub, who.name).secret);
      }
      return '/?eardle=ok';
    }],

    // only for an account that can be logged back in to (eardle, or a username and password): it ends this browser's session
    // (the library stays with the account).
    // With { everywhere: true } it also ends every other device's session — a stolen or forgotten session can be cut off
    // without needing to know which one it is.
    ['POST', '/api/me/signout', { auth: 'user', limit: W }, ({ req, res, user, secret, body }) => {
      if (!user.auth_provider && !user.username && !user.google_sub) throw bad('Create a login first: without one, logging out would lose this library.', 'not_linked');
      if (body?.everywhere) users.endAllSessions(user);
      else users.endSession(secret);
      clearSessionCookie(res, req);
      return { signedOut: true };
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

    // a person's saved band settings: send what this device has, get the merged list back
    ['POST', '/api/presets/sync', { auth: 'user', limit: ['presets', 60, MINUTE], bodyBytes: LIMITS.presetBodyBytes }, ({ user, body }) => presets.sync(user, body)],

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
    const body = writes ? await readJson(req, r.opts.bodyBytes) : {};

    const secret = parseCookies(req.headers.cookie)[cookieName(req)];
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
    if (r.opts.raw) {
      res.writeHead(result.status, { ...result.headers, 'Content-Length': result.body.length });
      res.end(result.body);
      return;
    }
    if (r.opts.redirect) {
      res.writeHead(302, { Location: result, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
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
