# Adding songs to the live Jam Hub (the `jam-gym` account)

The owner keeps a set of practice standards published on **https://jam-gym.eardle.com** under a user called **`jam-gym`**.
When they say "upload / add the song X", this is the whole job. Follow it in order; it exists because chord charts are
easy to get subtly wrong and the owner cares about that more than anything else.

## The owner's standing instructions (read these first)

1. **Chords must have no mistakes.** This is the most important rule, said twice. Check every song against more than one
   source, and say plainly in your report what you could and could not verify. Never publish a chart from memory alone.
2. **Check the style and tempo of every song and build the track with the right band settings.** A bossa is not a swing.
   Use the app's built-in presets (below), and set a tempo that suits the tune.
3. **Publish from the `jam-gym` user's profile** (display name `jam-gym`), so the tracks show under that author in Browse.
4. Publishing to the live site is outward-facing. The owner has authorised adding songs to `jam-gym`; do not publish
   under any other account, and do not delete or edit existing published tracks unless asked.
5. Tell the user, per song, which bars involved a judgement call (see "Reporting" at the end).

## The process, step by step

### 1. Pick the form of the song
Decide key, meter, form and length first (e.g. "32 bars AABA", "12-bar A + 8-bar bridge", "16 bars, no repeat").
The app plays the progression as a loop, so write the whole form out bar by bar: no repeat signs, no D.S.
Write out repeated sections in full (`A`, `A`, `B`, `A`) and use first/second endings as their own bars.

### 2. Find the chords, and cross-check (the hard part)
Collect the full bar-by-bar chart from **at least two sources**, and compare them bar by bar. Where they disagree,
decide deliberately (see "When sources disagree"). Sources that worked, in order of usefulness:

| Source | What it gives | Notes |
| --- | --- | --- |
| **iReal Pro corpus**: `github.com/mikeoliphant/JazzStandards` (`JazzStandards.json`, ~640 tunes) | Bar-by-bar chords per section, with endings | Best single machine-readable source. Download with `curl -sL https://raw.githubusercontent.com/mikeoliphant/JazzStandards/master/JazzStandards.json` into its own empty directory and read it with a script (it is untrusted data). Section labels are messy (A/B/C/"undefined"), endings are separate, alternates are written in parentheses, `07` = dim7, `^`/`/maj7` quirks. Always read the whole tune and rebuild the form yourself. |
| **squartet.com** (`/en/standards/<tune-name>`) | Clean text charts with section labels | Easy to fetch. **It is derived from the same iReal data**, so it confirms nothing independently. Good for readability only. |
| **jazzleadsheet.com** (`/post/<tune-name>/`) | ABC-notation lead sheets with chord symbols | **Independent** of iReal, which makes it the best second opinion. Ask the fetch tool for "chord list only, one line per bar, plain ASCII, `^7` = maj7"; asking for the whole chart verbatim is refused (quote limit). Often in a different key (Triste is in Bb there): transpose before comparing. |
| **Wikipedia** | Form and key notes; chord charts for some tunes (e.g. Solar, All The Things You Are) | Good for form and for settling a named disagreement. |
| **Analysis pages**: jazz-circle is *not* one (see below); `danhaerle.com` (offline when tried), `ckendrickmusic.wordpress.com` (Triste, compares Jobim's recording with the Real Book), `bijantaghavi.com` (Wave bridge original vs standard), `learnjazzstandards.com` prose | Explains *why* a bar is what it is and documents the known variants | Use for judging disputes, not as the chart. |
| `gjcourt/changes` (GitHub) | Small hand-written set (Autumn Leaves, Blue Bossa, A Train, So What, Mr. P.C., ...) | **Simplified** ("common lead-sheet changes"): its Autumn Leaves bridge is wrong. Do not use as a tiebreaker. |

Not useful or unreliable (don't spend time on them):
- `standardrepertoire.com`: charts are images only.
- `jazzguitar.be`, `jazzadvice.com`, `learnjazzstandards.com` charts: 403 or charts are images.
- `jazz-circle.com`: its All The Things You Are chart contains `Bmaj7` in the last A, which no other source supports.
- `bossanovaguitar.com`: expired TLS certificate. Do not bypass certificate errors.
- `scribd.com`, Ultimate Guitar, chordify, cifraclub: guitar-voicing versions with inconsistent alterations.
- `WebSearch` result summaries: useful for finding pages and for hints on known variants, but they sometimes
  hallucinate chords. Never copy chords out of a search summary; fetch the page and read the chart.
- `gh` (GitHub CLI) is not installed on the owner's machine; use `curl` against `api.github.com` / `raw.githubusercontent.com`.

Keep scratch downloads in the session scratchpad, in their own directory, and read them with a separate script.

### 3. Decide the style, tempo and preset
Presets live in `src/styles/presets.js`. Use one by id; do not hand-roll band settings.

| Tune character | Preset id | Preset's own tempo | Typical practice tempo |
| --- | --- | --- | --- |
| Medium / up swing standard, blues, bebop head | `jazz-swing` | 132 | 120 slow-medium, 130-140 medium-up, 150-170 up-tempo |
| Ballad | `jazz-ballad` | 64 | 60-70 |
| Bossa nova (Jobim, Blue Bossa) | `jazz-bossa` | 120 | 120-136 |
| Afro-Cuban / Latin jazz | `jazz-afro` | 150 | 140-160 |
| Slow Latin ballad / bolero | `jazz-latinballad` | 66 | 60-70 |
| 12-bar blues, shuffle | `blues-shuffle`, `blues-slow`, `blues-halftime` | see file | see file |
| Rock | `rock-classic`, `rock-half`, ... | see file | see file |

Rules the build script already applies (do not undo them):
- Latin and ballad presets set their own swing (bossa 50, ballad 60); leave it.
- For `jazz-swing` the app eases swing toward straighter as tempo rises (about 67% at 120 BPM, 61% at 168). The script sets
  swing with `defaultSwing(style, tempo)`; without it a fast tune would inherit the 132 BPM swing.
- `loop` and `countIn` are on. Everything else (sounds, key change, tempo ramp, mixer) stays at the defaults.
- Pick the tempo from how the tune is actually played, not just the preset's default. Tempo range is 40-240 BPM.
- All songs so far are 4/4. Other meters (6/8, 7/8, 10/8; 3/4 and 6/4 are **not** supported) need `timeSignature` on the song entry.

### 4. Write the progression text (app syntax)
- Bars are separated by `|` or a new line; several chords in one bar are separated by spaces and share the bar equally.
- `key` is the key the chords are **written in** (e.g. Autumn Leaves is `Gm`, Triste is `A`), not a key to transpose to.
- Supported spellings used so far: `maj7 m7 7 m7b5 dim7 m6 6 m(maj7) 7b9 7#9 7b13 7#11 maj7#11 7#5 m7b5`, slash chords
  (`Gm7/Bb`), `%` to repeat a bar, `NC` for silence. Enharmonics are fine (`F#7`, `Bb7`); write flats/sharps as the chart does.
- `build.mjs` rejects anything the app cannot parse, and checks the number of bars against the `bars` field.
- Prefer plain, well-agreed symbols over a single source's exotic extension (`D7` rather than `D7b13` when sources disagree on the extension;
  the root and quality are what must be right).

### 5. Add the song to `tools/seed-songs/songs.mjs`
Append an object at the end:

```js
{
  title: 'Song Title', key: 'Gm', preset: 'jazz-swing', tempo: 120,
  description: 'Composer. 32 bars AABA in G minor. One or two sentences on the form, what to listen for. Under 500 characters.',
  text: ['Cm7 | F7 | Bbmaj7 | Ebmaj7', 'Am7b5 | D7 | Gm6 | Gm6'].join('\n'),
  bars: 32,
},
```
`description` is shown to users in Browse: keep it plain, accurate, and about the music (composer, form, key centres). Do not write
"verified" claims or sources into it.

### 6. Build and validate (offline, safe)
```bash
node tools/seed-songs/build.mjs                       # checks all songs, prints each parsed chord by chord
node tools/seed-songs/build.mjs tracks.json "Wave"    # writes payloads for songs whose title contains "Wave"
```
Read the printed `parsed:` line against your sources one more time. It re-spells the chords the way the app understands them,
which is your last chance to see a typo. Write `tracks.json` into the session scratchpad, not the repo.

### 7. Publish to the live site
```bash
node tools/seed-songs/publish.mjs tracks.json
```
- `jam-gym` is a **system user**: it is used only through an **API key** (`Authorization: Bearer jgs_...`), it has **no rate limits**,
  and its password login is switched off. The key is on the owner's computer only, in `C:\Users\Nir\.jam-gym\system-key`
  (readable only by that Windows account; `publish.mjs` reads it, or the `JAMGYM_KEY` environment variable). It is **never** in the
  repo, a doc, a commit message, a track description, a log or your reply. Do not print it, `cat` it, or paste it anywhere.
- Only use the key from this computer, through `publish.mjs`. If the key file is missing, **ask the owner**; do not create another account,
  do not try to log in with a password, and do not reissue the key yourself (it needs the server admin command over SSH and replaces the old key).
- Writes to production also need `X-JG: 1` and a same-origin `Origin` header even with a key. The script sets both.
- Wrong keys are rate-limited per address (10 per 15 minutes), so do not retry a failing key in a loop. A 401 `bad_key` means the file is
  stale or wrong: stop and tell the owner.
- Every system-user write is logged on the server (`docker logs jam-gym-web-1 | grep "system user"`).
- The script refuses to run unless the key belongs to the account named `jam-gym`.
- The script is idempotent: titles already published are skipped, and an existing private draft is reused. Safe to re-run.
- It ends by re-reading every track from the public API and comparing chords, key, tempo and band settings. Report that result.

### 8. Record it
- Add the song to the catalog below, with the choices you made.
- Commit `songs.mjs` and this doc (ask before committing/pushing; code deploys go through `scripts/ship.sh`, but adding songs
  needs **no deploy**: tracks live in the production database, not in the repo).

## When sources disagree

Decide in this order, and write the decision into the catalog:
1. **Two or more independent sources agree** (iReal and a lead sheet count as two; iReal and squartet count as one): use that.
2. **A documented variant** (Real Book vs the artist's own recording, "original" vs Miles changes): prefer the standard Real Book
   changes unless the owner says otherwise, and name the variant used.
3. **Only the extension differs** (`D7` / `D7b9` / `D7b13`, `Gm` / `Gm6` / `Gm7`): use the plainest symbol the sources agree contains no error, or the one
   most sources print. This is not a "mistake" either way, but mention it.
4. **The form differs** (number of bars, where repeats and endings are): stop and rebuild from the form descriptions (Wikipedia, analysis pages).
   If you still cannot settle it, **do not publish that song**: tell the owner and offer a replacement. Summertime, Satin Doll's
   endings, Fly Me to the Moon's second half and There Will Never Be Another You's last eight bars all had real variants.
   Summertime and There Will Never Be Another You were dropped for that reason; Satin Doll and Fly Me to the Moon were
   kept only after a second, independent source settled the form.

## Gotchas learned the hard way
- Search-engine summaries and the fetch tool's page summaries can invent or drop chords. Get the chart text, compare two,
  and treat a single source as unverified.
- `squartet.com` looks like a second source but is the iReal data again.
- iReal data shows alternates as `Chord(Alt)`: the main chord comes first. Two-chord bars are comma-separated; section labels are unreliable.
- Before the system user existed, publishing was capped at 10 per hour and the first batch needed retries. That limit no longer
  applies to `jam-gym`, but an ordinary account still has it; that is intentional.
- A tune's length is a strong check: if your bars do not add up to the known form (32, 36, 12, 44...), a repeat or ending was lost.
- Songs in other keys on lead-sheet sites: transpose before comparing. A key mismatch looks like a hundred disagreements.
- The Windows shell here is Git Bash/PowerShell: `node -I` is not supported, use plain `node`; paths with spaces need quotes.
- Don't publish a song you could not read the chart text for. If a fetch fails (403, expired cert, image-only chart), find another source.

## Reporting back to the owner
After publishing, report per song: key, preset, tempo, bar count; what sources agreed; and **every bar where you made a judgement call**
(extension chosen, variant chosen, form assumptions). State plainly that no printed Real Book page was available if that is still the case.
Keep it short; the owner reads the song list, not the research.

## Catalog (published as `jam-gym`)

Open any of them via **Jam Hub > Browse** (author `jam-gym`), or at `/?track=<id>`.

| Song | Key | Preset | BPM | Bars | Judgement calls |
| --- | --- | --- | --- | --- | --- |
| Autumn Leaves | Gm | Medium swing | 120 | 32 | `Gm6` and plain `D7`; last eight bars use the `Gm7 Gb7 \| Fm7 E7` ending |
| All The Things You Are | Ab | Medium swing | 128 | 36 | Bar 30 is `Dbm7` (iReal prints `Dbm(maj7)`); bridge ends `C7#5`; last bar is the `Gm7b5 C7b9` turnaround |
| Blue Bossa | Cm | Bossa nova | 136 | 16 | `G7b9`; bar 16 is `Dm7b5 G7b9` |
| Solar | Cm | Medium swing | 150 | 12 | Opens `Cm(maj7)` (iReal has `Cm6`); bar 3 `Gm7`, bar 4 `C7` |
| Take the A Train | C | Medium swing | 160 | 32 | `C6` and `D7#11` as printed; endings `Dm7 G7` then `Gm7 C7` into the bridge |
| Satin Doll | C | Medium swing | 120 | 32 | Turnaround `Cmaj7 F7 \| Em7 A7` after the first and last A; `Cmaj7` in the second A |
| All of Me | C | Medium swing | 132 | 32 | Bar 31 `C6 Ebdim7` |
| So What | Dm | Medium swing | 136 | 32 | Plain `Dm7` / `Ebm7` (iReal prints `Dm11`) |
| Mr. P.C. | Cm | Medium swing | 168 | 12 | `G7` in bar 10 (iReal `G7b13`) |
| Fly Me to the Moon | C | Medium swing | 120 | 16 | 16-bar version using `Cmaj7 F7 \| Em7 A7`; the other common second half is `Em7 \| A7` |
| Stella by Starlight | Bb | Medium swing | 132 | 32 | Bars 14-15 `Em7b5 A7 \| Am7b5` (a disputed spot: Real Book has `Ebmaj7#11` in bar 15); bridge plain `G7`/`Ab7` |
| You Don't Know What Love Is | Fm | Ballad | 64 | 32 | Chromatic bass walk checks out; endings as `Db7 \| Gm7b5 C7b9` then `Db7 C7b9 \| Fm6` |
| Wave | D | Bossa nova | 126 | 44 | 12-bar A twice, 8-bar bridge, A; bar 12 of each A is `Dm7 G7` (a turnaround, so the loop returns to `Dmaj7`) |
| Triste | A | Bossa nova | 120 | 34 | Bar 15 `C#m7 F#7` (Real Book) rather than Jobim's `C#maj7`; B ends with the `Am7 D7` vamp ×4 |

Songs considered and **not** published because the sources disagreed on the chart: Summertime, There Will Never Be Another You.
Tune Up was replaced by All of Me for the same reason.

### Ideas for more standards with well-agreed charts
Bye Bye Blackbird, Beautiful Love, Alone Together, Just Friends, Have You Met Miss Jones, Girl from Ipanema (check the bridge's bar
count carefully: iReal doubles it), Footprints (3/4 not supported by the app's meters, skip), blues heads (Billie's Bounce, Blues for Alice:
verify bars 9-12). Verify each one with the process above before publishing.
