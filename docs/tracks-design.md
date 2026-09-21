# Tracks: save, publish, search and like

Status: design, approved with the decisions in section 2a. Date: 2026-09-21.

## 1. What we are building

Today "saved progressions" live in one browser's `localStorage`. Replace that with a **track platform**:

- A **track** is a complete practice setup: chords, key, time signature, tempo, style, swing, sounds, key-change and
  tempo-ramp settings, loop / count-in, and the mixer. Loading a track restores everything.
- Every visitor gets an **anonymous identity in a cookie**. They can **save tracks privately** to their own library,
  which follows them across visits (not across browsers, unless they use the recovery code).
- A track can be **published**, making it visible to everyone. Anyone can **search** published tracks, **open** one,
  **save a copy** into their own library, and **like** it. Each published track shows its like count.

Non-goals for this version: comments, follows, playlists, per-user profile pages, editing someone else's track,
real-time updates, email or passwords, chord-progression search that ignores the key.

## 2. Decisions and why

| # | Decision | Why |
| --- | --- | --- |
| D1 | **Identity = a random secret in an HttpOnly cookie**, plus an optional display name and a **recovery code** | Matches "save user cookies". No sign-up friction. The recovery code covers the weak point (clearing cookies or switching device). |
| D2 | **One Node container** (no dependencies) serves the static site *and* `/api`; data in **SQLite** on a Docker volume | The host nginx keeps proxying to the same port, so the **shared nginx config does not change**. No second database server on a small shared VPS. |
| D3 | **`node:sqlite`** (built into Node 24) with **FTS5** search | Verified working: FTS5, JSON functions, online backup, no flags. Zero npm packages, in keeping with the rest of the project. |
| D4 | The server **reuses the client's own validators** (`sanitize`, `parseProgression`) | A track that the app can't play can never be stored. One definition of "valid". |
| D5 | Publishing **shares the same record** (visibility flag), it doesn't copy it | Likes survive edits; unpublish is instant and reversible. |
| D6 | **Cookie is issued lazily**, only when the user first saves, publishes or likes | Browsing and playing set no cookie. Keeps the cookie "strictly necessary for a feature the user asked for". |
| D7 | Moderation by **report button + CLI on the server**, not an admin web page | No admin login surface to attack. |

## 2a. Decisions confirmed with the owner

- **Identity: cookie now, accounts later.** Build the anonymous-cookie identity with the recovery code. The `users`
  table carries nullable `auth_provider` / `auth_subject` columns (unused for now), so a later Google sign-in can link
  an account to an existing library instead of starting a new one.
- **Moderation: publish instantly, with a Report button.** Three distinct reporters auto-hide a track; a CLI on the
  server removes, restores or bans. No admin web page.
- **Deployment: deploy when all tests pass**, with the same safeguards as the first deploy (new files only, `nginx`
  untouched, eardle re-verified before and after).

## 3. Identity

- The cookie `jg_session` holds a 160-bit random secret in Crockford base32 (32 characters). The database stores only its **SHA-256**, so a leaked
  database gives nobody a usable session.
- Attributes: `HttpOnly; SameSite=Lax; Path=/; Max-Age=2 years` (sliding: refreshed when used), and `Secure` in production.
- **Lazy creation**: `POST /api/session` (called before the first write) creates the user and sets the cookie.
  Read-only browsing never needs one.
- **Display name**: shown on published tracks. Default `Player-4F2K` (from the public id). Editable (2 to 24
  characters). Changing it updates all the user's published tracks.
- **Recovery code**: the cookie secret in groups of four (`xxxx-xxxx-...`), read back from the cookie when asked, so the server never stores it, shown on demand ("Show my recovery
  code"). Entering it in another browser replaces that browser's cookie. It is a password: anyone holding it owns the
  library, and the UI says so. Switching identity leaves the browser's previous anonymous library behind, and the UI warns.
- **Delete my data**: removes the user, their tracks and their likes, and clears the cookie.
- Known limits, stated plainly: with cookies only, someone can make many identities to inflate likes. We limit the
  damage with per-IP rate limits (section 8), not by preventing it.

## 4. Data model (SQLite, WAL mode, foreign keys on)

```sql
users(
  id            INTEGER PRIMARY KEY,
  public_id     TEXT UNIQUE NOT NULL,      -- 8 chars, shown in default names
  secret_hash   TEXT UNIQUE NOT NULL,      -- sha256 of the cookie secret
  display_name  TEXT NOT NULL,
  banned        INTEGER NOT NULL DEFAULT 0,
  auth_provider TEXT,                      -- reserved for a later sign-in (e.g. 'google'); NULL today
  auth_subject  TEXT,                      -- the provider's user id; UNIQUE with auth_provider when set
  created_at    INTEGER NOT NULL,          -- epoch ms
  last_seen_at  INTEGER NOT NULL
);

tracks(
  id            TEXT PRIMARY KEY,          -- 10 random base62 chars: unguessable, URL-safe
  owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,             -- 1..80
  description   TEXT NOT NULL DEFAULT '',  -- 0..500
  data          TEXT NOT NULL,             -- the full setup as JSON (section 5), <= 16 KB
  -- copied out of `data` so they can be filtered and sorted without parsing JSON:
  style TEXT NOT NULL, key TEXT NOT NULL, time_signature TEXT NOT NULL, tempo INTEGER NOT NULL,
  bars INTEGER NOT NULL, chords TEXT NOT NULL,   -- chords = distinct chord symbols, space-separated
  visibility    TEXT NOT NULL DEFAULT 'private'
                CHECK (visibility IN ('private','published','hidden')),  -- hidden = removed by moderation
  like_count    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, published_at INTEGER
);
CREATE INDEX tracks_owner     ON tracks(owner_id, updated_at DESC);
CREATE INDEX tracks_published ON tracks(visibility, like_count DESC, published_at DESC);

likes(
  user_id  INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  track_id TEXT    NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_id)          -- one like per user per track, enforced by the database
);

reports(id INTEGER PRIMARY KEY, track_id TEXT REFERENCES tracks(id) ON DELETE CASCADE,
        reporter_id INTEGER REFERENCES users(id) ON DELETE CASCADE, reason TEXT, created_at INTEGER,
        UNIQUE(track_id, reporter_id));

-- Search index over PUBLISHED tracks only (kept in step by the same code paths that publish, edit and rename):
track_search USING fts5(title, description, author, chords, tokenize = 'unicode61 remove_diacritics 2')
```

`like_count` is a denormalised counter, updated **in the same transaction** as the like row, and covered by a test that
recounts from `likes` and compares. Users are never deleted implicitly; a user with no tracks and no likes for 12
months could be pruned later.

## 5. The track payload (`data`, version 1)

```json
{
  "v": 1,
  "song":   { "key": "C", "tempo": 132, "timeSignature": "4/4", "progressionText": "Cmaj7 | Am7 | Dm7 | G7" },
  "config": { "style": "jazz", "swing": 65, "loop": true, "countIn": true,
              "sounds": { "drums": "auto", "keys": "auto" },
              "modulation": { "type": "off", "interval": 2, "everyLoops": 1, "randomMode": "no-repeat" },
              "tempoRamp": { "enabled": false, "increment": 5, "everyLoops": 2, "maxBpm": 220 } },
  "mixer":  { "drums": { "volume": 0.75, "muted": false }, "bass": {}, "chords": {} }
}
```

It is the same shape the app already keeps in its state, so saving is `{song, config, mixer}` and loading is the
reverse. Not included: the theme (a personal preference). The server runs `sanitize()` over it, requires
`parseProgression(...).ok`, caps the progression at 200 bars, and stores the **sanitised** result, never the raw input.
The `v` field lets a future format be migrated instead of guessed.

## 6. HTTP API (JSON; all under `/api`)

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/health` | none | liveness for Docker |
| `POST /api/session` | none | ensure an identity exists; sets the cookie; returns `me` |
| `GET /api/me` | cookie | `{ id, displayName, trackCount, publishedCount }`, or `null` if no cookie |
| `PATCH /api/me` | cookie | change display name |
| `GET /api/me/recovery` | cookie | the recovery code |
| `POST /api/me/recover` | none | `{ code }`: switch this browser to that identity |
| `DELETE /api/me` | cookie | delete my data |
| `GET /api/tracks/mine` | cookie | my tracks (all states), newest first |
| `POST /api/tracks` | cookie | create a private track `{ title, description?, data }`; also `{ importFrom }` for migration |
| `GET /api/tracks/:id` | none / cookie | a published track, or mine in any state |
| `PUT /api/tracks/:id` | owner | update title, description and/or data (overwrite with the current setup) |
| `DELETE /api/tracks/:id` | owner | delete |
| `POST /api/tracks/:id/publish`, `.../unpublish` | owner | change visibility |
| `POST /api/tracks/:id/copy` | cookie | copy a published track into my library, as private |
| `PUT /api/tracks/:id/like`, `DELETE ...` | cookie | like / unlike (idempotent). Published, and not my own |
| `POST /api/tracks/:id/report` | cookie | `{ reason }` |
| `GET /api/browse` | none (cookie adds `likedByMe`) | search and list published tracks |

Errors are `{ "error": { "code": "not_found", "message": "..." } }` with the right status (400, 401, 403, 404, 409,
413, 429). Someone else's private track answers **404**, not 403, so ids can't be probed.

### Browse and search

`GET /api/browse?q=&style=&meter=&key=&bpmMin=&bpmMax=&sort=likes|new|relevance&limit=20&offset=0`

- `q` is split into words. Words that parse as **chord symbols** (`Dm7`, `Bb7`, `F#m7b5`) must appear in a track's
  chords; every other word is matched as a prefix against title, description, author and chords. All words must
  match (AND). Words are quoted before they reach FTS5, so user input can never be interpreted as FTS syntax.
- `sort=relevance` (default when `q` is present) uses `bm25`, with likes as a tie-break; otherwise `likes`
  (like_count, then newest) or `new`.
- Filters are plain SQL on the copied columns. `limit` is capped at 50.
- Each result: `{ id, title, description, author, style, key, timeSignature, tempo, bars, chordsPreview, likes,
  likedByMe, isMine, publishedAt }`. **No `data` in list results**; `GET /api/tracks/:id` returns the full payload.

## 7. Likes

- Only **published** tracks, **not your own**, one per user per track (database primary key).
- `PUT` on an existing like and `DELETE` on a missing one both succeed and change nothing (idempotent).
- The counter and the row change in one transaction. Unpublishing keeps likes, and republishing brings the count back.
- The UI updates immediately and rolls back if the server says no.

## 8. Abuse, limits and moderation

- **Rate limits** (in memory, per identity and per client IP): writes 60/min, creates 30/hour, publishes 10/hour,
  likes 120/min, browse 120/min. The client IP is read from `CF-Connecting-IP` only when the request comes from the
  loopback nginx, since the origin can also be reached directly. Best effort, and documented as such.
- **Caps**: 200 tracks and 50 published per user; title 80, description 500, display name 24, body 32 KB.
- **Reports**: one per user per track. **3 distinct reporters auto-hide** a track (`hidden`) until reviewed.
- **Moderator tools are a CLI**, run on the server: `docker exec jam-gym-web-1 node server/admin.js
  reports | hide <id> | restore <id> | delete <id> | ban <user> | stats`. There is no admin web endpoint.
  A hidden track shows its owner "removed by a moderator" and can't be republished.
- **XSS**: every user-supplied string is rendered with `textContent`; the API returns JSON only. A Content-Security-Policy
  (`default-src 'self'`, `script-src 'self'` plus the hash of the one inline theme script, `worker-src blob:`,
  `img-src 'self' data:`) is defence in depth.
- **CSRF**: `SameSite=Lax`, plus every state-changing request must send `X-JG: 1` and, if an `Origin` header is
  present, it must match the site's host.

## 9. Privacy

- Stored: a random id, a display name the user chose, their tracks, their likes. **No IP addresses are stored.** Rate
  limit counters live in memory only.
- The cookie is only set when a user starts using the feature (D6). The footer gets a one-line notice, and the account
  panel says exactly what is kept and offers Delete my data.

## 10. Architecture and deployment

```
browser ─► Cloudflare ─► host nginx (unchanged) ─► 127.0.0.1:3100 ─► jam-gym-web-1 (node:24-alpine)
                                                                      ├─ static files (src/, css/, samples/ ...)
                                                                      └─ /api  ─► /data/jamgym.sqlite  (volume)
```

- `server/`: `index.js` (http, routing, static, headers), `db.js` (schema, migrations, queries), `auth.js`, `tracks.js`,
  `search.js`, `limits.js`, `admin.js`. No dependencies. `npm start` runs the same server locally, with data in `./data`.
- **The container changes from `nginx:alpine` to `node:24-alpine`**, on the same port (3100). The host nginx file is
  untouched, so eardle's shared proxy config is not at risk.
- **Data**: a new named volume `jam-gym_data` mounted at `/data`. Nothing touches `eardle_postgres_data`.
- **Backups**: the app snapshots the database once a day with SQLite's online backup into `/data/backups`, keeping 14.
  No server cron is needed.
- Limits on the shared box: container capped at 192 MB; expected use is under 60 MB. Health check on `/api/health`.
- **Schema migrations** are numbered and run at startup inside a transaction (`PRAGMA user_version`), so every deploy
  is safe to repeat.
- **Rollback**: redeploy the previous git commit. The data is forward compatible (new columns are additive).
- Update `JAM-GYM-ON-THIS-SERVER.md` for the eardle agent: there is now a **volume that must not be pruned**
  (`docker volume prune` would delete the tracks database if the container were stopped).

## 11. UX

The "Saved progressions" block becomes **Tracks**, with two tabs. Same visual language as now: fret lines, brass, no cards.

**My tracks**
- A line naming the identity: "You are Player-4F2K · Change name · Recovery code · Delete my data". The first save
  creates the identity and shows a short note about the cookie.
- Save box: name field, **Save** (or **Update** if that name exists), as today.
- Each track: title; a meta line (key, meter, style, tempo, bars); a status chip, **Private** or **Published · ♥ 12**;
  actions **Load**, **Update from current setup**, **Publish** / **Unpublish**, **Copy link** (published only), **Delete** (with Undo).
- **Publish** opens an inline confirmation: "Everyone will be able to see and play this track: its title, chords,
  tempo and style, and your name (Player-4F2K). You can unpublish at any time." **Publish** / **Cancel**.
- "Edited since loaded" marker, as now.

**Browse**
- A search box ("Search titles, names or chords, e.g. Dm7 G7"), filters (Style, Time, Key, Tempo from-to) and Sort
  (Most liked, Newest). Results as a plain list: title, author, meta line, a chord preview, **♥ 12**.
- Actions per result: **Open** (loads the whole setup into the player), **Save a copy**, **Report**, **Copy link**.
- The heart is a toggle. On your own tracks it is a plain count.
- Empty and error states say what happened and what to do. Pagination is a "Show more" button.

**Deep links**: `https://jam-gym.eardle.com/?track=<id>` opens that track, ready to play. **Loaded track** line under
the tempo: "Loaded: *Title* by *Author* · ♥ 12".

**Offline or API down**: My tracks falls back to the browser's own storage (the current behaviour) with a notice;
Browse says it needs a connection. **Migration**: the first time the API is available and browser storage has
saved progressions, offer "Move your 5 saved progressions into your library" (one click; the local copy is kept until
the import succeeds).

## 12. Testing plan

- **Unit**: payload sanitising (rejects unplayable tracks, oversized input, junk), chord-token extraction, FTS query
  builder (including hostile input like `"`, `*`, `NEAR(`, unicode), name and id generators.
- **API integration** (real HTTP server on a random port, in-memory SQLite): identity flow and cookie attributes;
  CSRF and Origin checks; ownership (others' private tracks answer 404); publish/unpublish visibility; copy; caps
  and rate limits (429); like idempotency, self-like refusal, counter always equals a recount; search by words, by
  chords, filters, sorts, pagination; reports and auto-hide; admin CLI; migration import; delete-my-data cascade;
  recovery code round trip; startup migration is repeatable; backup file opens and matches.
- **Browser**: the whole flow with two separate identities (two cookie jars), on desktop and phone widths, checking
  the console for CSP violations and that audio still works under the CSP.
- **Regression**: all 180 existing tests continue to pass.

## 13. Build order

1. `server/` core: db + migrations, identity, static serving, headers, limits, health. (Tests.)
2. Tracks API: CRUD, publish, copy, validation. (Tests.)
3. Search, likes, reports, admin CLI, backups. (Tests.)
4. Client: API layer with offline fallback; Tracks panel (My tracks, then Browse); deep links; migration.
5. Docker and compose changes; docs; local end-to-end verification.
6. Production deploy, only after 1 to 5 pass, following `docs/deployment.md` and re-verifying that eardle is untouched.

## 14. Implementation notes (what differs from the plan above)

- **Chord search compares sounding notes, not spelling.** Each chord is stored as a canonical token (root pitch class,
  the pitch classes of its notes, and the bass if it differs), so `Dm7`, `Dmin7` and `D-7` all match one another, and `C#`
  matches `Db`. A bare letter in a search (`a`, `e`) is a word, not a chord.
- **The API is small:** `GET /api/health`; `POST /api/session`; `GET|PATCH|DELETE /api/me`; `GET /api/me/recovery`;
  `POST /api/me/recover`; `GET /api/tracks/mine`; `POST /api/tracks`, `POST /api/tracks/import`;
  `GET|PUT|DELETE /api/tracks/:id`; `POST /api/tracks/:id/{publish,unpublish,copy,report}`;
  `PUT|DELETE /api/tracks/:id/like`; `GET /api/browse`. Every write needs `X-JG: 1` and a matching `Origin`.
- **The CSP hash ignores the file's line endings**, because the browser hashes the script after the HTML parser has
  turned CRLF into LF. (Found when testing on Windows.)
- **Path traversal:** an encoded `%2f` in a static path was found by the hostile-input tests and is fixed: `.` and `..`
  segments are rejected before anything touches the disk, and the resolved path is checked against the folder allowlist.
- **Client layering:** `api.js` (HTTP) → `tracks-model.js` (setup <-> stored data) → `tracks.js` (state and actions, no
  DOM, fully unit-tested with a fake API) → `tracks-ui.js` (DOM only). The UI redraws a region only when its own inputs
  change, so a beat event never disturbs typing in the search or rename boxes.
- **Test count:** 266 (unit, API over real HTTP, client controller, and the original engine and UI-model suites).
