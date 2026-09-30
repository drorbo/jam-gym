# Security & Bug Audit

Audit date: 2026-09-26. Audited version: Jam Gym `c0e6934` (live), plus the parts of eardle's sign-in that Jam Gym now depends on (eardle `f2097c6`).
**Read-only audit: nothing in either project, on the server or in any database was changed.** This file is the only thing written.

## Executive Summary

- **Examined:** all of Jam Gym (server, client, database, Docker, nginx, deploy scripts, the new "Sign in with eardle" flow), the production host it shares with eardle, and eardle's *authentication* code and libraries. Per your instruction, eardle's exercise/daily/lesson code was **not** audited (see "Incidental observation" at the end).
- **Environments:** source review; a local throwaway Jam Gym server for dynamic tests; safe read-only requests to the live sites; read-only commands over SSH on the production host.
- **Findings:** 0 critical, 1 high, 5 medium, 7 low, 8 informational; plus 8 minor functional bugs.
- **Reproduced:** the high finding (effective server configuration plus the attack traffic already in the logs), 4 of the 5 mediums (locally or live), and most lows. Items that could not be conclusively established are listed under "Needs verification".
- **Main areas of concern:**
  1. **The production server accepts SSH password logins and is being brute-forced right now** (about 50,000 failed attempts since 20 September, no fail2ban). The deploy docs say "key-only"; the effective configuration says otherwise.
  2. **The site's abuse controls rest on things an attacker can bypass**: the origin server answers directly (not only through Cloudflare), so every per-IP limit can be defeated with a forged header; free anonymous identities can then be minted without limit.
  3. **Three throwaway identities can permanently hide anyone's published track**, and the owner cannot get it back.
  4. **eardle's Google sign-in links to an existing password account by email without checking that the email is verified**, so an account can be pre-hijacked, and that identity now also opens Jam Gym libraries.
- **What is solid:** the core web-security controls of Jam Gym held up under every test I could devise: no SQL/FTS injection, no XSS sink, no path traversal, correct CSRF defence, no cross-user data access, a sound token design, no secrets in either repository's history, zero third-party dependencies.

## Scope & Methodology

**Inspected (source):** `server/*.js` (HTTP app, users, tracks, presets, search, static files, config, db/migrations, backup, admin, SSO), `src/app/*` (client: API layer, controllers, DOM rendering), `index.html`, `Dockerfile`, `docker-compose.yml`, `scripts/*.sh`, both nginx site files on the server, git history of both repositories (pattern scan for keys, tokens, private keys; classification of old committed `.env` values without printing them), eardle `lib/auth.ts`, `lib/authz.ts`, `middleware.ts`, sign-in/sign-up pages, `app/api/user/*`, `app/api/auth`, the new `/jam-gym/authorize` page and `lib/jamGymSso.ts`, `lib/safeNext.ts`, `scripts/init-db.ts`, and eardle's dependency advisories (`npm audit --omit=dev`, read-only).

**Executed locally** against a real Jam Gym server with an in-memory database (scripts kept outside the repo): forged-header rate-limit bypass, CSRF variants, 19 path-traversal/file-exposure probes, malformed/oversized/odd inputs, FTS injection strings, prototype pollution, cross-user authorization (read/edit/delete/publish/copy other people's tracks), the report-based hiding, like inflation, login-CSRF/replay/fixation attempts against the sign-in flow, oversized tokens, preset tombstone growth. The eardle round trip (real eardle build + real Jam Gym) was also exercised during development.

**Against production (safe, read-only):** response headers of both sites; 19 GET probes for exposed files/endpoints; a direct-to-origin GET that bypasses Cloudflare; eardle's public `/api/auth/providers`; one SSH connection attempt that offered no credentials (to see which methods the server advertises); read-only SSH commands (`nginx` and `sshd` configuration, `sshd -T`, log counts, file permissions, disk usage). **Not done on production:** any write, any account creation, any login attempt, any brute force, any load.

**Limitations:** no credentials for a real eardle account were used, so eardle's login/Google flows were reviewed in source only; Cloudflare's dashboard settings were not visible to me; `ufw` and Docker network rules were read only at the level of listening sockets.

## Architecture Overview

- **Jam Gym:** one Node 24 process (no npm dependencies, no build step) serving a static ES-module site and a JSON API on Node's built-in `http`. Data in SQLite (`node:sqlite`, WAL, foreign keys on) in the Docker volume `jam-gym_data`; hourly-checked snapshots every 6 h (28 kept) plus a pre-deploy backup copied to `~/jam-gym-backups`. Container runs as the non-root `node` user, memory-capped at 192 MB, published only on `127.0.0.1:3100`.
- **Identity:** anonymous by default: a 160-bit random secret in an HttpOnly `jg_session` cookie (only its SHA-256 is stored) plus a recovery code. New: optional **Sign in with eardle** (HMAC-signed 2-minute token, bound to a state cookie, `sessions` table for extra devices).
- **Edge:** Cloudflare → host nginx (TLS, security headers, proxy) → container. Same host and nginx process as eardle (Next.js + next-auth v5 beta, JWT sessions, Postgres in its own container).
- **API surface (Jam Gym, 24 routes):** health; session/me/recovery/recover/signout/delete; tracks CRUD, publish/unpublish, copy, like/unlike, report, import; browse (FTS5 search); presets sync; sign-in start/callback. Every state-changing route requires the `X-JG: 1` header and a same-origin `Origin`; per-user and per-IP rate limits are in memory.
- **No AI/LLM functionality, no file uploads, no payments, no email, no outbound requests (no SSRF surface), no WebSockets, no background jobs beyond backups.**

## Findings Summary

| ID | Severity | Confidence | Category | Finding | Location |
| -- | -------- | ---------- | -------- | ------- | -------- |
| H-1 | High | Confirmed | Infrastructure | SSH password login is enabled on the production host and under constant brute-force attack; no fail2ban or firewall | `/etc/ssh/sshd_config.d/50-cloud-init.conf` |
| M-1 | Medium | Confirmed | Infrastructure / abuse | The origin answers directly, so all per-IP limits can be bypassed with a forged `CF-Connecting-IP` | nginx site files; `server/app.js` `clientIp` |
| M-2 | Medium | Confirmed | Business logic | Three throwaway identities permanently hide any published track; the owner cannot restore it | `server/tracks.js` `report`, `publish` |
| M-3 | Medium | Confirmed | Availability | Unbounded storage growth: free identities × 200 tracks, and unbounded preset deletion markers | `server/tracks.js`, `server/presets.js` |
| M-4 | Medium | Confirmed (code) | Authentication (eardle) | Google sign-in links to an existing password account by email without `email_verified`; sign-up needs no email verification (account pre-hijacking) | eardle `lib/auth.ts` (jwt callback), `app/api/user/register/route.ts` |
| M-5 | Medium | Probable | Dependencies (eardle auth) | next-auth 5.0.0-beta.31 / `@auth/core` and Next.js carry critical/high advisories, including a fail-open auth advisory | eardle `package.json` |
| L-1 | Low | Confirmed | Availability | In-memory rate-limit table can be inflated with forged IPs (memory growth to the 192 MB cap) | `server/limits.js` |
| L-2 | Low | Plausible | Session security | Cookies lack the `__Host-` prefix: a sibling `*.eardle.com` origin could plant `jg_session` / `jg_sso` (fixation, login CSRF) | `server/app.js` `addCookie` |
| L-3 | Low | Confirmed | Session security | Sign-in sessions never expire, cannot be revoked all at once, and one row is added per sign-in | `server/users.js` `startSession`, migration 3 |
| L-4 | Low | Confirmed | Infrastructure | No firewall (ufw inactive) and nginx discloses its version on direct connections | host; `server_tokens build` |
| L-5 | Low | Confirmed | Authentication (eardle) | Login throttling is per email only (spraying is unlimited, one account can be locked out); register limit trusts a client-controllable `X-Forwarded-For` | eardle `lib/auth.ts`, `register/route.ts`, nginx |
| L-6 | Low | Confirmed | Data hygiene | Pre-deploy backups on the host are world-readable files in a group-writable directory | `scripts/ship.sh` |
| L-7 | Low | Confirmed | Authentication (eardle) | Emails are neither validated nor case-normalised; nickname and avatar URL have no length or scheme limits | eardle `register`, `profile` routes |
| I-1 | Info | Confirmed | Impersonation | Display names are not unique and not reserved ("Admin", "eardle", another person's name) | `server/users.js` |
| I-2 | Info | Confirmed | Headers | Jam Gym sends no HSTS itself; `X-Content-Type-Options` is sent twice | nginx + `server/static.js` |
| I-3 | Info | Confirmed | Container | Base image `node:24-alpine` is an unpinned tag; no `cap_drop`, `no-new-privileges` or read-only root filesystem | `Dockerfile`, `docker-compose.yml` |
| I-4 | Info | Confirmed | Logging | The one-time sign-in token appears in the nginx access log (2-minute life, useless without the state cookie) | nginx |
| I-5 | Info | Confirmed | Business logic | A banned browser can shed its ban by signing in to a clean, already-linked eardle account | `server/app.js` callback |
| I-6 | Info | Confirmed | Configuration | The SSO secret has no minimum-length check | `server/config.js` |
| I-7 | Info | Confirmed | eardle | No Content-Security-Policy on eardle; JWT sessions cannot be revoked | eardle `next.config.ts`, `lib/auth.ts` |
| I-8 | Info | Needs verification | eardle | Production admin address is the placeholder `admin@example.com`; old commits contain short development secrets | eardle server `.env`, git history |

## Critical Findings

None.

## High Findings

### H-1: SSH password authentication is on, and the host is under constant brute-force attack

- **Severity / confidence:** High / Confirmed. **Category:** Infrastructure. **Affects:** production (the host carries both sites, the database and every user's data).
- **Location:** `/etc/ssh/sshd_config.d/50-cloud-init.conf` (`PasswordAuthentication yes`).
- **Why it happens:** OpenSSH uses the *first* value it reads. `50-cloud-init.conf` (`yes`) loads before `60-cloudimg-settings.conf` (`no`), so the intended "no" is ignored. `sshd -T` reports `passwordauthentication yes` and `maxauthtries 6`. `docs/deployment.md` in both repositories state key-only access.
- **Evidence:** `ssh -o PreferredAuthentications=password ubuntu@…` answered `Permission denied (publickey,password)` (it advertises password login). `/var/log/auth.log` holds **about 50,000 "Failed password" entries since 2026-09-20**, rising to 15,477 on 25 Sep and 11,629 so far on 26 Sep, the top source alone 17,188. `fail2ban` is inactive and `ufw` is inactive. The `ubuntu` user has passwordless `sudo`, so a guessed password means full root on the host.
- **Attack scenario:** a bot guesses the `ubuntu` password (or any other account's); result is root, and with it eardle's database, Jam Gym's database and backups, the shared secret, the TLS key.
- **Preconditions:** a guessable password on any account that allows login. I did not and must not test that.
- **Impact:** total compromise of everything on the host.
- **Verification:** read-only (`sshd -T`, config files, log counts). No login attempt with credentials was made. Exploitation not attempted.
- **Remediation:** disable password logins (remove or correct `50-cloud-init.conf`, then `sshd -T` to confirm `passwordauthentication no`), keep key-only; add fail2ban (or restrict port 22 by source IP / a Cloudflare-independent allowlist); check `auth.log` for any *Accepted password* entry from an unknown address and rotate the `ubuntu` password regardless.

## Medium Findings

### M-1: Origin reachable directly; per-IP limits defeated by a forged header

- **Confirmed** live and locally. **Category:** infrastructure/abuse. **Affects:** production.
- **Location:** `server/app.js` `clientIp()` trusts `CF-Connecting-IP` (then `X-Forwarded-For`) whenever `TRUST_PROXY=1`; nginx accepts connections from anywhere.
- **Evidence:** `curl --resolve jam-gym.eardle.com:443:<origin IP> https://…/api/health` (GET) returned `200` without passing through Cloudflare (also for eardle); the `Server:` header on that path reveals `nginx/1.28.3 (Ubuntu)`. Locally, with `TRUST_PROXY=1`, **40 of 40** anonymous identities were created by sending a different `CF-Connecting-IP` each, versus 9 of 40 from one address (limit 10/hour).
- **Impact:** the 10-new-identities-per-hour, 600-requests-per-minute and every other per-IP limit stop meaning anything; this multiplies M-2, M-3, L-1 and like/report abuse.
- **Remediation:** accept traffic only from Cloudflare (nginx `allow`/`deny` on Cloudflare's published ranges, or Authenticated Origin Pulls with mTLS, plus a firewall rule), and read the client IP only from a header nginx sets itself (`real_ip` module with Cloudflare ranges), not from a raw request header.

### M-2: Three throwaway identities permanently hide any published track

- **Confirmed** (locally). **Category:** business logic / abuse. **Affects:** production.
- **Location:** `server/tracks.js` `report()` (auto-hide at `LIMITS.autoHideReports = 3` distinct reporters) and `publish()`/`unpublish()` (a hidden track answers 403 "removed").
- **Scenario/evidence:** identities are free (`POST /api/session`, no proof of anything). Three of them report a track: `{"reported":true,"hidden":true}`; the owner then sees `visibility: hidden`, `unpublish` → 403, `publish` → 403. Only a moderator using the server CLI can restore it.
- **Impact:** anyone can censor any person's published track at will; like counts can likewise be inflated by throwaway identities (5 likes from 25 attempts locally, only because of the new-identity limit that M-1 removes).
- **Remediation options (your call, not applied):** let the owner appeal or unpublish/republish; weight reports by identity age or by eardle-linked accounts; hold a reported track "pending review" for the reporters only instead of hiding it for everyone; rate-limit reports per IP across identities.

### M-3: Unbounded storage growth

- **Confirmed.** **Category:** availability. **Affects:** production (Jam Gym's volume shares the 38 GB disk with eardle's Postgres; 22 GB free at audit time).
- **Location:** `server/tracks.js` `insert` (200 tracks × up to 16 KB of data per identity, identities are free), `server/presets.js` `tombstone` (deletion markers are inserted for *any* id, capped only per request at 300, not per user).
- **Evidence:** one identity created 1,455 preset rows in 5 calls (20 ms). At the allowed 60 calls/minute that is up to 18,000 rows per minute per identity; there is no per-user cap on markers and no global size cap.
- **Impact:** disk exhaustion would also take down eardle's database and both sites.
- **Remediation:** cap deletion markers per user (and reject markers for unknown ids beyond a small number), add per-IP and global caps on identity creation once M-1 is fixed, monitor volume size and set a disk alarm.

### M-4: eardle's Google sign-in links to a password account by email without verifying it (pre-hijacking)

- **Confirmed by code reading; not exploited.** **Category:** authentication. **Affects:** eardle production, and Jam Gym through the shared identity.
- **Location:** eardle `lib/auth.ts` jwt callback: `findFirst(users.email === p.email)` is used to attach a Google identity to an existing row; `email_verified` is never checked. `app/api/user/register/route.ts` creates accounts for any email with no verification step.
- **Scenario:** an attacker registers `victim@gmail.com` with a password they know; later the victim uses "Continue with Google", is attached to the attacker's row (Google id written to it), and the attacker still knows the password. Both now use the same account, and its Jam Gym library (linked by user id).
- **Impact:** account takeover of the victim's eardle progress and Jam Gym library.
- **Remediation:** only link on a verified email (`profile.email_verified === true`), and require email verification for password sign-ups (or refuse to link an unverified password account).

### M-5: eardle authentication libraries with critical/high advisories

- **Probable; needs verification of exploitability.** **Category:** dependencies. **Affects:** eardle production.
- **Evidence (`npm audit --omit=dev`):** `next-auth` 5.0.0-beta.31 / `@auth/core`: *configuration errors can cause existence-based auth checks to fail open* (critical, GHSA-8fpg-xm3f-6cx3), email-normaliser homoglyph bypass (critical, applies to the email provider, which eardle does not use), `getToken()` uncaught exception on malformed Bearer headers (high; eardle's middleware calls `getToken`), OAuth state/PKCE cookies not bound to a provider (moderate). `next` 16.2.9: middleware bypass with Turbopack + single locale, server-actions DoS/SSRF, cache confusion (fix: 16.3.6).
- **Mitigating factors:** eardle's admin API routes and admin layout check `auth()` and the role themselves (defence in depth), and eardle has no server actions I saw in the auth code. Whether the fail-open advisory applies depends on configuration errors occurring at runtime.
- **Remediation:** update within the supported versions and re-test sign-in; keep the per-route role checks.

## Low Findings

- **L-1: rate-limit table can be inflated (availability).** `server/limits.js` keeps one bucket per key for its window (up to an hour); with forged IPs (M-1) each request can create new buckets, growing memory toward the 192 MB container cap and causing an OOM restart. Not reproduced at scale (I did not load-test); the code path is plain. Fix with M-1; add a maximum bucket count.
- **L-2: cookie tossing (needs verification).** `jg_session` and `jg_sso` are host-only cookies without the `__Host-` prefix. A page on any sibling `*.eardle.com` origin that an attacker controls (or an XSS there) could set a cookie for `.eardle.com` that Jam Gym would read: fixation of a victim into the attacker's identity, or a login-CSRF against the sign-in flow. Requires control of another subdomain; none exists today. Consider `__Host-` names.
- **L-3: sign-in sessions.** `sessions` rows have no expiry (`created_at` unused), there is no "sign out everywhere", and every sign-in adds a row (bounded only by 30 sign-ins/hour/IP). A stolen session cookie is valid forever; the account's own cookie is 2 years sliding.
- **L-4: no firewall; version disclosure.** `ufw` inactive (only 22/80/443 listen, Postgres is not published, so exposure is limited); nginx `server_tokens build` shows the exact version on direct connections.
- **L-5: eardle login/registration throttling.** `checkRateLimit('login:<email>', 5, 15 min)` only: a distributed password-spraying attack across many emails is not throttled, one account can be locked out by anyone, and the registration limiter keys on the first `X-Forwarded-For` value, which nginx passes through from the client (`$proxy_add_x_forwarded_for`). State is in memory and resets on restart.
- **L-6: backup permissions.** `~/jam-gym-backups` is `drwxrwxr-x` with files `-rw-r--r--`; any local account on the host can read every user's tracks and the identity hashes. Currently one user exists; `chmod 700`/`600` in `ship.sh` would close it.
- **L-7: eardle input hygiene.** Emails are matched case-sensitively and not validated; nickname and avatar URL are unbounded (the values travel in the session JWT cookie, so a huge nickname can break the person's own login; an avatar URL makes their browser fetch any URL). Jam Gym itself is unaffected: it cuts names to 24 characters and strips control characters.

## Informational / Hardening

- **I-1:** anyone can call themselves anything, including another person's name or "Admin". Names render as text (no XSS). Consider reserved names and showing an "eardle account" badge.
- **I-2:** Jam Gym relies on eardle.com's `includeSubDomains` HSTS, which only protects a browser that has visited eardle.com; the duplicate `X-Content-Type-Options` is harmless. The CSP (hash-based inline script, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'self'`) is strong; do not loosen it.
- **I-3:** pin the base image by digest; add `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]` and `read_only: true` (with `/data` and a tmpfs) to the compose service.
- **I-4:** the callback URL with the token is logged by nginx; log rotation defaults limit retention. Harmless because tokens die in 2 minutes and need the state cookie.
- **I-5:** a banned identity can sign in to a clean eardle account and use it (it could also simply clear its cookies today). If bans are meant to bite, ban by eardle account too.
- **I-6:** reject a shared secret shorter than, say, 32 characters at start-up. The setup script generates 64 hex characters.
- **I-7:** eardle has no CSP; JWT sessions cannot be revoked server-side (30-day default lifetime).
- **I-8 (needs verification):** eardle's container start-up log prints `Admin user ready: admin@example.com`. The admin password's strength is unknown to me (not tested). The admin account signs in through the public credentials endpoint (5 tries per 15 minutes per email, which also makes it lockable). eardle's history holds development values, including a 16-character `NEXTAUTH_SECRET` and a 3-character admin password in commit `b9553fe`; the eardle repository is **public on GitHub** (HTTP 200). Confirm the production values differ from anything ever committed, and rotate `NEXTAUTH_SECRET` if there is doubt (a leaked signing secret lets anyone forge sessions, including a session Jam Gym would accept).

## Functional Bugs

All minor; none loses data.

1. **Merged accounts can exceed limits.** `users.absorb()` moves tracks without checking the 200-track / 50-published limits; a merged account can be over them.
2. **Two tabs starting "Sign in with eardle" cancel each other.** They share one `jg_sso` cookie, so the first tab's return fails with "did not work" (safe, but confusing).
3. **A like can't be undone after the track is hidden** (`unlike` uses the visibility rule), so the count stays.
4. **Silent truncation.** Titles are cut to 80 characters and names to 24 without telling the person (a name is cut mid-tag/character-safe but can end in the middle of a word).
5. **A device signed in through eardle has no recovery code**; the panel explains this, but "Recovery code" is still offered there.
6. **Sign-in failure gives one generic message** for every cause (bad token, expired, wrong state), which makes support hard.
7. **`HEAD` on API routes returns 405** rather than the GET response headers.
8. **Preset deletions of unknown ids are stored** (see M-3) rather than ignored.

## Authentication & Authorization Review

- **Jam Gym identity:** strong. 160-bit secrets, only hashes stored, constant-time-safe lookup by hash, cookie `HttpOnly; SameSite=Lax; Secure` (verified behind the proxy headers), recovery-code and recover routes rate-limited, `Origin` checked on writes.
- **Authorization (IDOR/BOLA):** every track operation resolves the row through `owned()`/`visible()`; another person's private or unpublished track returns 404 (never 403, so ids cannot be probed). Tested: read, edit, delete, publish, copy of someone else's private track, edit and delete of someone else's public track: all 404. Presets and library are always keyed by the cookie's user, never by a client-supplied owner id. Browse never exposes author ids or emails.
- **Sign in with eardle:** token = HMAC-SHA256, audience `jam-gym`, 2-minute life (10-minute ceiling), bound to a state cookie that is cleared on first use; comparison is constant-time; `sub` must be digits; unsigned/expired/wrong-state/oversized/malformed tokens all end in `?eardle=failed` and change nothing (tested, including replay and a token minted for another browser's state). eardle refuses admin sessions (admin ids overlap user ids). The login-CSRF/fixation scenarios failed as designed. The residual risks are in eardle itself (M-4, M-5, I-8) and cookie tossing (L-2).
- **Admin (Jam Gym):** only through a shell inside the container (`admin.js`); there is no web admin.

## API Security Review

- 24 routes, each declaring its auth mode (`none`/`optional`/`user`/`create`) and rate limit. Writes need the custom header and a same-origin `Origin` (tested: missing header 403, foreign origin 403, `Origin: null` 403, `text/plain` body 400).
- Bodies are limited to 32 KB (presets 192 KB), streamed with a hard cut-off at 1 MB; requests time out in 30 s (headers 15 s). Malformed JSON, arrays, wrong content types → 400; oversize → 413; huge URLs → 431.
- Track data is re-validated on the server with the same code the app uses; out-of-range values are clamped (tempo −5 → 40, 1e9 → 220), text is stripped of control/bidi characters.
- No CORS headers are sent, so no cross-origin browser can read responses (checked live).
- Weaknesses: only the rate-limit bypasses (M-1) and abuse rules (M-2, M-3).

## Database Security Review

- SQLite via `node:sqlite` with **parameterised statements throughout**; the only dynamically built SQL (`browse`) concatenates fixed fragments chosen from an allow-list (`SORTS`) and ints; the FTS5 query is built by quoting every word, so `NEAR`, `*`, `"`, `-`, `:`, `{}` cannot act as syntax (tested with seven hostile strings: all 200, no error).
- Foreign keys are enforced (`PRAGMA foreign_keys = ON`), deletes cascade correctly, uniqueness on `(auth_provider, auth_subject)`, `(track, reporter)`, likes; multi-step changes run in `BEGIN IMMEDIATE` transactions; migrations are versioned and run in transactions with a pre-deploy backup.
- Weaknesses: no per-user cap on preset deletion markers (M-3); `sessions` never pruned (L-3).

## Frontend Security Review

- **No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function` anywhere in the client**; all user text (track names, descriptions, authors, display names) is set with `textContent`. Stored HTML in a description (`<img onerror>`) and a display name (`<script>`) come back verbatim from the API and are inert in the page.
- CSP as above; the only inline script is allowed by hash. `img-src 'self' data:`, `connect-src 'self'`, no third-party origins except Cloudflare's analytics script.
- The "Sign in with eardle" control is a plain same-origin link to `/api/auth/eardle/start`; the destination is fixed by server configuration, never by the request (no open redirect).
- localStorage holds only the person's own settings, saved progressions and presets (all validated before use).

## Infrastructure & Deployment Review

- Good: TLS 1.2/1.3 at nginx with a Cloudflare Origin certificate, HTTP→HTTPS redirect, hidden files denied (`/.env`, `/.git/*` → 403), only ports 22/80/443 listening, Docker ports bound to loopback, Postgres unpublished, containers non-root, secrets kept out of git and out of images (`.dockerignore` excludes `.env*`), `.env` files on the server are mode 600, deploy scripts contain no credentials and back up before every change.
- Problems: H-1 (SSH), M-1 (origin reachable directly, no Cloudflare-only allow-list), L-4, L-6, I-3.
- TLS cipher string is `HIGH:!aNULL:!MD5` (acceptable); no OCSP stapling needed with Cloudflare in front.

## AI Security Review

Not applicable: neither Jam Gym nor the parts of eardle reviewed use any AI/LLM functionality.

## Privacy / User Data Review

- **What Jam Gym stores:** a random id, a chosen display name, an hour-resolution "last seen", tracks/presets/likes/reports, and (for eardle sign-ins) eardle's numeric user id. **No email, no password, no IP address** is stored in the database. IPs and tokens exist only in nginx logs.
- **Access:** other people see only published tracks with the author's display name; never ids, emails, or last-seen. Deletion ("Delete my data") removes the identity, tracks, likes, presets and sessions and corrects other tracks' like counts (tested).
- **eardle → Jam Gym:** only the eardle user id and nickname cross; the email is never sent.
- Concerns: backups readable by every local host account (L-6); eardle nickname copied into a public display name without asking (by design, shown as changeable).

## Dependency Review

- **Jam Gym: zero npm dependencies** (nothing to audit or confuse). Base image `node:24-alpine` is a floating tag (I-3).
- **eardle (auth-relevant libraries only):** see M-5.

## Areas Tested With No Significant Findings

SQL injection and FTS injection (7 strings, sort/limit/offset/style injection); XSS (source scan and stored-HTML round trips); path traversal and file exposure (19 encodings/variants incl. `%2e%2e`, `..%2f`, backslashes, NUL, `.git`, `server/`, `data/`, `test/`, `scripts/`); CSRF (4 variants); CORS; cross-user authorization (9 operations); prototype pollution; oversized/malformed bodies and URLs; sign-in flow tampering (forged, expired, replayed, wrong-state, oversized tokens; login CSRF); cookie attributes; concurrency (single-threaded synchronous SQLite behind transactions: no interleaving possible); error handling (generic 500, no stack traces or paths in responses); secrets in both repositories' full history (none; eardle's early commits contain only placeholder-looking or short development values); information disclosure on Jam Gym (`/api/health` reveals only `{"ok":true,"schema":N}`).

## Unresolved Questions / Needs Verification

1. Does the `ubuntu` account (or any other) have a guessable password? Not tested, must not be. Check `auth.log` for any `Accepted password` from an unfamiliar address.
2. Is eardle's production `NEXTAUTH_SECRET` different from anything ever committed, and how strong is the production admin password (I-8)?
3. Whether the next-auth fail-open advisory is reachable in eardle's configuration (M-5).
4. Cloudflare-side settings (Authenticated Origin Pulls, WAF, bot fight mode) that might already mitigate M-1 for traffic through Cloudflare; the direct-to-origin path is confirmed open regardless.
5. Memory behaviour under a forged-IP flood (L-1) was reasoned from the code, not load-tested.
6. Cookie tossing (L-2): depends on whether any other origin under `eardle.com` can ever be attacker-influenced.

## Recommended Remediation Order

1. **H-1** Close SSH password login, add fail2ban, review `auth.log` for accepted logins. (Highest impact, minutes of work, and attacks are happening now.)
2. **M-1** Make the origin accept only Cloudflare (and take the client IP from nginx's `real_ip`), which restores every per-IP limit and shrinks M-3 and L-1.
3. **M-4** eardle: require a verified email before linking Google to an existing account and verify email addresses on sign-up. **M-5** update next-auth/Next.js and re-test sign-in. **I-8** confirm production secrets differ from anything committed.
4. **M-2** Change the auto-hide rule so a handful of free identities cannot censor a track (owner recourse, review queue, or reporter weighting).
5. **M-3** Cap preset deletion markers per user, cap identities/tracks per IP and overall, alarm on disk usage.
6. **L-5, L-7** eardle login/registration throttling and input validation; **L-3** session expiry/revocation; **L-6** backup permissions; **L-1**, **L-2**, **L-4**.
7. Informational items and the functional bugs, in any order.

## Incidental observation (out of scope, not investigated)

While mapping eardle's API for the authentication review I noticed that an unauthenticated endpoint exposes exercise answers, which appears to include the answer of the current daily puzzle. You asked me not to go into eardle's game code, so I did no further testing and did not use what I saw; it is mentioned only so you can decide whether to look at it.
