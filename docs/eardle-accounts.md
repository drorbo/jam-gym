# eardle accounts: "Sign in with eardle"

Jam Gym is part of eardle: it runs as `jam-gym.eardle.com` on eardle's server, and people can sign in with their **eardle
account** (email and password, or Google, whatever eardle offers). This page is the Jam Gym half. The eardle half, the
security reasoning and the token format live in the eardle repo (the neighbour folder `eardle`), in
**`docs/jam-gym-integration.md`**. Read both before changing either side.

Jam Gym never sees a password, an email or a Google id. It keeps its own database; eardle only vouches for who someone is.

## What people get

- Optional. Jam Gym still works with no account: each browser gets an anonymous identity and a recovery code.
- **Sidebar, Tracks, "Sign in with eardle"** links the browser's library to the eardle account. From then on the library
  follows the person to every device, and survives cleared cookies.
- Signing in on a second device opens the same library. "Sign out" (shown only for eardle accounts) ends that device only.
- If a browser had been used without an account and then signs in to an eardle account that already has a library, the two are **merged**: tracks, likes, reports and saved presets all move, nothing is lost, a track both liked counts once.

## How it works

1. `GET /api/auth/eardle/start` makes a random `state`, stores it in the `jg_sso` cookie (HttpOnly, path `/api/auth/eardle`, 10 minutes) and redirects to `EARDLE_URL/jam-gym/authorize?state=...`.
2. eardle signs the person in if needed and redirects back to `GET /api/auth/eardle/callback?token=...`.
3. `server/sso.js` (`verifyToken`) checks the HMAC signature, the audience (`jam-gym`), the expiry (issued for 2 minutes, at most 10 accepted) and that the token's `state` equals the `jg_sso` cookie. Any failure lands on `/?eardle=failed` and changes nothing.
4. `server/app.js` (callback route) then:
   - eardle account **already linked**: the browser signs in to it (a row in `sessions`, a cookie of its own). If the browser held an unlinked, unbanned anonymous identity, its library is absorbed into the account first (`users.absorb`) and the identity deleted.
   - eardle account **new** and the browser has an unlinked identity: that identity becomes the eardle account (`auth_provider='eardle'`, `auth_subject=<eardle user id>`); its cookie is unchanged. A default `Player-xxxx` name takes the eardle nickname; a name the person chose stays.
   - eardle account **new**, no identity (or one linked to another eardle account): a fresh linked identity is created.
   - Then it redirects to `/?eardle=ok`, and the page says who they signed in as.
5. `POST /api/me/signout` ends a sign-in (linked accounts only; an anonymous library is never signed out by accident).

## Where it lives

| Piece | File |
| --- | --- |
| Token check (and `signToken` for tests) | `server/sso.js` |
| Routes: start, callback, signout; `features.eardle` in `/api/me` | `server/app.js` |
| Linking, sessions, merging (`linkEardle`, `createLinked`, `startSession`, `absorb`, `findByEardle`) | `server/users.js` |
| Table `sessions` (schema 3) | `server/db.js` |
| Config `EARDLE_URL`, `EARDLE_SSO_SECRET` | `server/config.js` |
| The link, "(eardle account)" label, Sign out | `src/app/tracks-ui.js`, `src/app/tracks.js`, `src/app/api.js` |
| Tests (token, routes, merging, refusals; the pinned token shared with eardle's test) | `test/eardle-signin.test.js`, `test/client-tracks.test.js` |
| One-time secret setup on the server | `scripts/setup-eardle-sso.sh` |
| Deploy check that eardle answers when the feature is on | `scripts/ship.sh` |

The users table already had `auth_provider` and `auth_subject` (unique together) from the first schema; migration 3 only adds `sessions`.

## Configuration

| Variable | Meaning |
| --- | --- |
| `EARDLE_SSO_SECRET` | The secret shared with eardle's `JAMGYM_SSO_SECRET`. **Empty switches the feature off**: no link is shown and the routes answer 404 / `?eardle=failed`. |
| `EARDLE_URL` | Where eardle is. Default `https://eardle.com`. Locally use `http://localhost:3000`. |

On the server both come from `~/drorbo/jam-gym/.env` (read by `docker-compose.yml`, never committed).

## Putting it live (order matters)

```bash
bash scripts/setup-eardle-sso.sh --status   # do the two .env files on the server share a secret?
bash scripts/setup-eardle-sso.sh            # once: make the secret and write it into both .env files (never printed)
# 1. eardle first: in the eardle repo, bash scripts/deploy-prod.sh
# 2. then here:    bash scripts/ship.sh     (its checks include "eardle answers /jam-gym/authorize")
```

`ship.sh` fails its verification if Jam Gym offers the sign-in but eardle's authorize page is not answering, which is what
you would see if the two were deployed in the wrong order.

Rolling back: delete `EARDLE_SSO_SECRET` from `~/drorbo/jam-gym/.env` and run `docker compose -f docker-compose.yml up -d web` in
`~/drorbo/jam-gym`. The link disappears; linked people keep their libraries and their existing sessions.

## Things to know

- A person's Jam Gym identity is `users.id`; the eardle link is a label on it. Deleting your Jam Gym data ("Delete my data") deletes the Jam Gym library, sessions included, and does **not** touch the eardle account.
- The recovery code still works for the first device of an account (it holds the original secret). A device that signed in by eardle has no recovery code to show; sign in with eardle there instead.
- A session token is **not** accepted as a recovery code (only a person's own secret is).
- Bans are per Jam Gym identity. A browser whose anonymous identity is banned that signs in to a clean eardle account does not carry its ban to that account, and its library is not merged into it.
- eardle's numeric user id is the only identifier stored. It is never reused (Postgres `serial`).
- Cookies: `jg_session` (a person's own secret, or a sign-in session token) and `jg_sso` (a sign-in in progress). Nothing is shared with eardle's cookies.

## Local development

```bash
# in the eardle folder (needs its Postgres, see its README)
JAMGYM_SSO_SECRET=dev-secret JAMGYM_URL=http://localhost:5173 npm run dev
# in this folder
EARDLE_SSO_SECRET=dev-secret EARDLE_URL=http://localhost:3000 npm start
```

Open http://localhost:5173, sidebar, Tracks, "Sign in with eardle". `npm test` needs neither app running.
