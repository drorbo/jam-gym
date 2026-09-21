// Test helper: a real Jam Gym server on a random port with an in-memory database, plus "browsers" that each keep
// their own cookies, so tests can play two different people against each other.

import { buildServer } from '../server/index.js';
import { loadConfig } from '../server/config.js';
import { defaultState } from '../src/app/state.js';

export async function startTestServer(env = {}) {
  const config = loadConfig({ PORT: '0', ...env });
  const { server, db } = buildServer({ config, dbFile: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  /** A browser: its own cookie jar, and the headers the real client sends. */
  function browser(defaults = {}) {
    const jar = new Map();
    async function call(method, path, body, extraHeaders = {}) {
      const headers = { 'X-JG': '1', ...defaults, ...extraHeaders };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      const setCookies = res.headers.getSetCookie?.() ?? [];
      for (const c of setCookies) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i);
        const value = pair.slice(i + 1);
        if (/Max-Age=0/i.test(c) || !value) jar.delete(name); else jar.set(name, value);
      }
      let json = null;
      const text = await res.text();
      try { json = text ? JSON.parse(text) : null; } catch { /* not JSON (static files) */ }
      return { status: res.status, headers: res.headers, setCookies, json, text };
    }
    return {
      jar,
      get: (p, h) => call('GET', p, undefined, h),
      post: (p, b = {}, h) => call('POST', p, b, h),
      put: (p, b = {}, h) => call('PUT', p, b, h),
      patch: (p, b = {}, h) => call('PATCH', p, b, h),
      del: (p, h) => call('DELETE', p, undefined, h),
      /** Send a request exactly as given (for CSRF tests): no default headers. */
      raw: async (method, path, { headers = {}, body } = {}) => {
        const res = await fetch(base + path, { method, headers, body });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* ignore */ }
        return { status: res.status, headers: res.headers, json, text };
      },
    };
  }

  return {
    base, db, config, browser,
    async close() { await new Promise((r) => server.close(r)); db.close(); },
  };
}

/** A valid track payload, built from the app's own default state so it is always playable. */
export function trackData({ song = {}, config = {}, mixer } = {}) {
  const d = defaultState();
  return {
    v: 1,
    song: { ...d.song, ...song },
    config: { ...d.config, ...config },
    mixer: mixer ?? d.mixer,
  };
}

/** Create a track as `b` and return it. */
export async function makeTrack(b, { title = 'A track', description = '', song, config } = {}) {
  const r = await b.post('/api/tracks', { title, description, data: trackData({ song, config }) });
  if (r.status !== 201) throw new Error(`makeTrack failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.track;
}

/** Create and publish a track as `b`. */
export async function publishTrack(b, opts) {
  const t = await makeTrack(b, opts);
  const r = await b.post(`/api/tracks/${t.id}/publish`);
  if (r.status !== 200) throw new Error(`publish failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.track;
}
