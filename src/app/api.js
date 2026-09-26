// Client for the /api. Thin on purpose: it builds requests, sends the headers the server requires, and turns failures
// into one error type the rest of the app can show.

export class ApiError extends Error {
  /**
   * @param {number} status HTTP status, or 0 when the server could not be reached
   * @param {string} code   machine-readable, e.g. 'not_found', 'rate_limited', 'offline'
   */
  constructor(status, code, message, retryAfter = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
  get offline() { return this.status === 0; }
}

/** @param {{fetch?: typeof fetch, base?: string}} [opts] */
export function createApi({ fetch: fetchImpl = globalThis.fetch?.bind(globalThis), base = '' } = {}) {
  async function call(method, path, body) {
    const headers = { 'X-JG': '1', Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method, headers, credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'offline', "Can't reach the server. Check your connection and try again.");
    }
    let json = null;
    try { json = await res.json(); } catch { /* an empty or non-JSON body */ }
    if (!res.ok) {
      const err = json?.error;
      const retry = Number(res.headers?.get?.('retry-after')) || null;
      throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `The server answered ${res.status}.`, retry);
    }
    return json;
  }

  const qs = (params) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
    const s = u.toString();
    return s ? `?${s}` : '';
  };
  const id = (x) => encodeURIComponent(x);

  return {
    health: () => call('GET', '/api/health'),

    // identity
    session: () => call('POST', '/api/session').then((r) => r.me),
    me: () => call('GET', '/api/me').then((r) => r.me),
    /** Who I am and what this server offers: { me, features: { eardle } }. */
    whoami: () => call('GET', '/api/me'),
    signOut: () => call('POST', '/api/me/signout'),
    rename: (displayName) => call('PATCH', '/api/me', { displayName }).then((r) => r.me),
    recoveryCode: () => call('GET', '/api/me/recovery').then((r) => r.code),
    recover: (code) => call('POST', '/api/me/recover', { code }).then((r) => r.me),
    deleteMe: () => call('DELETE', '/api/me'),

    // tracks
    myTracks: () => call('GET', '/api/tracks/mine').then((r) => r.tracks),
    getTrack: (trackId) => call('GET', `/api/tracks/${id(trackId)}`).then((r) => r.track),
    createTrack: (payload) => call('POST', '/api/tracks', payload).then((r) => r.track),
    importTracks: (items) => call('POST', '/api/tracks/import', { items }),
    updateTrack: (trackId, patch) => call('PUT', `/api/tracks/${id(trackId)}`, patch).then((r) => r.track),
    deleteTrack: (trackId) => call('DELETE', `/api/tracks/${id(trackId)}`),
    publish: (trackId) => call('POST', `/api/tracks/${id(trackId)}/publish`).then((r) => r.track),
    unpublish: (trackId) => call('POST', `/api/tracks/${id(trackId)}/unpublish`).then((r) => r.track),
    copy: (trackId) => call('POST', `/api/tracks/${id(trackId)}/copy`).then((r) => r.track),

    // presets: send this device's list and deletions, get the merged list back
    syncPresets: (payload) => call('POST', '/api/presets/sync', payload),

    // community
    browse: (params) => call('GET', `/api/browse${qs(params)}`),
    like: (trackId) => call('PUT', `/api/tracks/${id(trackId)}/like`),
    unlike: (trackId) => call('DELETE', `/api/tracks/${id(trackId)}/like`),
    report: (trackId, reason) => call('POST', `/api/tracks/${id(trackId)}/report`, { reason }),
  };
}
