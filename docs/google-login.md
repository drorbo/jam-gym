# "Continue with Google"

Jam Gym can sign people in directly with Google. It is separate from "Sign in with eardle" (see [eardle-accounts.md](eardle-accounts.md)): the two
are independent ways to open the same Jam Gym library, and nothing in the Google flow touches eardle.

## What people get

- **Continue with Google** in Jam Gym → My account (for a guest, or for a library that has no login yet). It makes an account, or signs in to
  the one that Google account already opened, on any device.
- **Connect Google** (same place, once there is a login of another kind) adds Google to an existing account, so either way opens the same
  library. Someone who uses a username and password, or eardle, connects Google once.
- A library saved in a browser without any account keeps everything when Google is connected to it; a browser's own unsaved library joins the
  Google account's one when it signs in (the same rule as the other logins).

## What Jam Gym learns

Only the person's **Google account id** (the `sub` claim), stored in `users.google_sub` (unique). The only scope asked for is `openid`, so no
name, email or photo ever reaches Jam Gym, and a real name never ends up on a public profile (the display name stays `Player-xxxx` until the
person picks one).

## How it works (`server/google.js`, routes in `server/app.js`)

1. `GET /api/auth/google/start` makes a random `state`, `nonce` and PKCE verifier, keeps them in the `jg_google` cookie (HttpOnly, path
   `/api/auth/google`, 10 minutes) and redirects to Google (`prompt=select_account`, `code_challenge_method=S256`).
2. Google redirects back to `GET /api/auth/google/callback?code=...&state=...`.
3. The callback clears the cookie (one attempt per state), checks `state` against it in constant time, then swaps the code for an ID token **from
   Google's token endpoint over TLS**, sending the client secret and the PKCE verifier. It checks the token's issuer, audience (this client id),
   expiry and nonce. (A token received directly from the token endpoint over TLS needs no signature check: OpenID Connect Core 3.1.3.7.)
4. Any failure lands on `/?google=failed` (or `/?google=cancelled` if the person said no) and changes nothing.
5. Then: the Google id is already an account → this browser gets a session on it (an anonymous library here is absorbed first); otherwise, if the
   browser has an account without Google, it is **connected** to it; otherwise a new account is made. It ends on `/?google=ok`.

## Setting it up

In the [Google Cloud console](https://console.cloud.google.com/), in the project eardle's Google login already uses (or a new one):

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application** (or add to an existing web client).
2. **Authorized redirect URIs**: `https://jam-gym.eardle.com/api/auth/google/callback` (exact; Google allows no wildcards). For local testing also
   `http://localhost:5173/api/auth/google/callback`.
3. **OAuth consent screen**: the app name people see; `eardle.com` as an authorized domain covers `jam-gym.eardle.com`. Only the basic `openid` scope
   is used, which needs no Google review.
4. On the server, put the id and secret in `~/drorbo/jam-gym/.env` (read by `docker-compose.yml`, never committed):

   ```
   GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   ```

   `GOOGLE_REDIRECT_URI` defaults to `https://jam-gym.eardle.com/api/auth/google/callback` there; it must match step 2 exactly.
5. Deploy (`bash scripts/ship.sh`). While the id or the secret is empty the feature is off: no button, and the routes answer 404 / `?google=failed`.

Locally: `GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm start`, then open http://localhost:5173 (the redirect address is worked out from the request
when `GOOGLE_REDIRECT_URI` is not set).

## Tests

`test/google-login.test.js` runs the whole flow against a stand-in for Google that checks the code, client secret, redirect address and PKCE verifier
the way Google does (`GOOGLE_AUTH_URL` / `GOOGLE_TOKEN_URL` exist only so tests can point at it; leave them unset in production).
