# Jam Gym for Android (Google Play)

The Android app is a thin Trusted Web Activity: it opens https://jam-gym.eardle.com in Chrome without a browser bar. It is the same site, so
sign-in (password, eardle, Google), saving and the offline mode all work exactly as on the web, and a site update reaches the app at once.
Nothing in this folder is needed to run or deploy the website.

## One-time setup (yours to do; none of it is in the repo)
1. A [Google Play developer account](https://play.google.com/console).
2. Node 18+ and a JDK 17 and the Android SDK; the first run of Bubblewrap offers to download them.
3. An **upload keystore**. Create it once and keep it (and its passwords) somewhere safe, never in git:
   `keytool -genkeypair -v -keystore jam-gym-upload.keystore -alias jam-gym -keyalg RSA -keysize 2048 -validity 10000`
   (`*.keystore` is ignored by this folder's `.gitignore`).

## Build
From this folder:
```
npx @bubblewrap/cli init --manifest https://jam-gym.eardle.com/manifest.webmanifest   # first time; or reuse twa-manifest.json
npx @bubblewrap/cli build
```
This writes `app-release-bundle.aab` (upload this to Play) and `app-release-signed.apk` (sideload to try it).
Raise `appVersionCode` in `twa-manifest.json` for every new upload.

## Link the app to the site (so the browser bar disappears)
Android only hides the bar when the site vouches for the app. Put the signing certificate's SHA-256 in `/.well-known/assetlinks.json` at the
repo root (served by the site), then deploy:
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.eardle.jamgym",
    "sha256_cert_fingerprints": ["AA:BB:...:FF"]
  }
}]
```
- Get the upload key's fingerprint with `npx @bubblewrap/cli fingerprint` (or `keytool -list -v -keystore jam-gym-upload.keystore`).
- If you use **Play App Signing** (the default), Google re-signs the app: also add the *App signing key* SHA-256 from Play Console, Setup,
  App integrity. List both fingerprints.
- Check it: https://jam-gym.eardle.com/.well-known/assetlinks.json must answer 200 with JSON, and Chrome's "Digital Asset Links" test in
  Bubblewrap (`npx @bubblewrap/cli doctor`) should pass.

The Play listing needs a privacy policy URL and screenshots; the app itself collects nothing beyond what the website does.
