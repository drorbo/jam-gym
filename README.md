# Jam Gym

A backing band for improvisers. Type a chord progression, pick a style, press play, and keep going.
The band (drums, bass, keys or guitar) loops the progression indefinitely and can move the key and
speed up the tempo on its own, so you can practise the same idea in all twelve keys.

No npm dependencies and no build step. Recorded drums and keyboards load on demand; everything else is
synthesised in the browser. The band plays offline; saving and sharing tracks needs the server.

## Run it

```
npm start        # serves http://localhost:5173 (the site and the tracks API), data in ./data
npm test         # 303 tests, Node's built-in runner, no install needed
npm run admin -- stats     # moderation and upkeep, see "Tracks" below
```

Needs Node 22.13 or newer (the database is Node's built-in `node:sqlite`). The app must be served over `http://`
(ES modules don't load from `file://`), and the tracks features need the Node server rather than a plain file server.

Live at **[jam-gym.eardle.com](https://jam-gym.eardle.com)**. How it is deployed: [docs/deployment.md](docs/deployment.md).
To ship a change (tests, commit, push, deploy, verify, in one go): `bash scripts/ship.sh -m "what changed"`.

## Using it

- **Progression**: `Cmaj7 | Am7 | Dm7 G7 | %`. Bars are separated by `|` or a new line, chords in one bar by
  spaces (they share the bar), `%` repeats the previous bar, `NC` is a bar of silence for the harmony.
  Extensions work: `maj7 m7 7 m7b5 dim dim7 sus2 sus4 add9 6 6/9 9 13 7#9 7b13 7alt m(maj7) C/E` and more.
- **Starting key** rewrites the progression into that key. The chord strip always shows what is
  sounding now, in the current key.
- **Time signature**: 4/4, 6/8 (3+3), 7/8 (3+2+2) and 10/8 (3+3+2+2). The beat display shows the grouping, the
  groove follows it (kick and snare on group downbeats, a ride ping or walking-bass step on each), and chords
  share a bar by group: in 7/8, two chords split it 3+2 | 2. Tempo is always quarter-note BPM, so changing
  meter keeps the eighth-note pace the same; the tempo hint says what that means in each meter.
- **Sounds**: drums are a Jazz kit, a Rock kit or Electronic drums. Bass is a recorded Double bass, a Bass guitar,
  a brighter Bass guitar, or a synth upright, electric or pick bass. Keys are a Grand piano, a Wurlitzer, or
  the synth electric piano, organ or guitar. Each style has its own default (jazz: double bass; blues: bass guitar;
  rock: bright bass guitar); you can override any of them. Sounds are saved with a track.
- **Swing**: a percentage slider from 50% (straight eighths) through about 67% (triplet swing) to 75% (hard swing).
  Choosing a style sets it to that style's default (jazz 65% at its default tempo, blues 67%, rock 50%; jazz eases toward
  straighter as the default tempo rises); a small button restores the default after you've moved it. It applies from
  the next bar, is saved with saved progressions, and is disabled in 6/8, 7/8 and 10/8, whose feel comes from their groupings.
- **Bass line** (jazz and blues): a panel under the controls that shapes how the walking bass is played. See below.
- **Tracks**: the button in the header opens the tracks sidebar, described below. Every section of it folds away, and
  remembers whether it was open. A track is the whole setup, not just the chords.
- **Key change**: *Step* moves by an interval (−11…+11 semitones, named) every N loops.
  *Random* picks a key every N loops: never the same twice, completely random, all 12 in random order,
  circle of fifths, circle of fourths, or chromatic.
- **Tempo ramp**: add X BPM every N loops, up to a cap. It combines freely with the key change,
  and the two can run on different schedules.
- **While playing**: tempo, style, sound and mixer changes apply straight away; progression edits, key jumps,
  time-signature changes and loaded songs apply from the next chorus. Invalid text is flagged and the last
  valid version keeps playing.
- Space plays and pauses.

## Bass line

Jazz and blues walk. Open **Bass line** to choose how, from the next bar on:

- **Rhythm**: steady quarters; quarters with skips (swung ghost notes and passing tones on the "and"); running eighths;
  two-feel (half notes on roots and fifths); or mixed, which mostly plays quarters and now and then a skip, a run of
  eighths or a two-feel bar (no eighths above 170 BPM, no two-feel in the blues).
- **Line**: from scales (stepwise, chromatic passing notes) to arpeggios (chord-tone leaps).
- **Tensions**: from chord tones only to colourful: the 9th, 13th and #11 (and any extension you wrote, such as the
  #9 in `G7#9`) are allowed on strong beats.
- **Approach**: how the last note leads into the next chord: a half step, a scale step, the fifth above, an enclosure
  (above, then below), or a mix.
- **Pattern** (blues): the eighth-note boogie with a half-step lead into each chord change and a walking bar to turn
  the chorus around (the default), walking throughout, or boogie throughout.

Choosing a style resets the panel to that style's defaults (a button restores them after you have changed things).
In 6/8, 7/8 and 10/8 the line follows the groupings. Rock keeps its driving root line, so the panel hides for it.
The settings are saved with a track.

How a line is chosen (`src/styles/walking.js`): the rhythm is planned first; beat one is the root, and the last note
is picked as an approach into the next chord; the notes between are found by a beam search that scores every
candidate on chord tones for strong beats, scale and passing tones for weak ones, step against leap (the Line
setting), colour tones (Tensions), direction, leap recovery and not repeating last bar's shape, with seeded noise
so each chorus differs.

## Tracks: save, publish, search, like

The **Tracks** button in the header opens a sidebar. On a wide window it docks beside the practice controls and
pushes them over, so the play button stays in reach; on a phone it slides over the page as a sheet. It remembers
whether you had it open.

- **My tracks**: name the current setup and press Save. A track keeps everything: progression, key, time signature,
  tempo, style, swing, sounds, key-change and tempo-ramp settings, loop, count-in and the mixer. Saving under an
  existing name updates it. Load brings it all back; Replace with current setup overwrites it.
- **Identity** is one random ID in an HttpOnly cookie (`jg_session`), set the first time you save, publish or like, never
  for just listening. Your name defaults to something like `Player-4F2K` and can be changed. A **recovery code** opens
  your library in another browser; keep it private. **Delete my data** removes your name, tracks and likes.
- **Publish** makes a track public under your name (with a confirmation that says so); **Make private** takes it back.
  Published tracks have a link (`/?track=ID`) that opens them straight into the player.
- **Browse**: search titles, authors and chords together (`Dm7 G7` finds tracks that contain those chords, however they
  are spelled), filter by style, time signature, key and tempo, sort by best match, most liked or newest. Like a track
  with the heart, or save a copy to your own library. Report sends it to moderation; three different reporters hide it.
- Offline or with the server down, Save keeps the track on this device. Older browser-only saves are listed under
  "On this device" and can be moved into the library.

Design and decisions: [docs/tracks-design.md](docs/tracks-design.md). Moderation is a command on the server:
`docker exec jam-gym-web-1 node server/admin.js reports` (also `stats show hide restore delete ban unban backup`).

## How it is put together

```
src/theory/    notes, chords, meters, progressions, keys   pure functions: parse, spell, transpose
src/engine/    planner   key + tempo of each chorus        pure: (state, settings, seed) -> next state
               conductor lookahead scheduler               clock and sink injected, no DOM, no Web Audio
               voicing, feel, rng
src/styles/    jazz, blues, rock + registry                data + generators that emit note events
               walking                                     the walking-bass engine and its settings
               oddMeters                                   how every style plays in 6/8, 7/8 and 10/8
src/audio/     voices        synthesised instruments
               samples       loader + player for recorded instruments (samplemap: pure selection logic)
               engine, ticker  mixer bus, worker-driven timer
src/app/       state, player, ui, bass-ui, sidebar         store, playback wiring, DOM
               api, tracks-model, tracks, tracks-ui        tracks: HTTP client, setup <-> track data, controller, panel
               saved                                       older browser-only saves (offline fallback, migration)
server/        index, app, static, db, tracks, users,      the site + /api on Node's built-in http and node:sqlite;
               search, trackdata, limits, backup, admin    reuses src/app/state.js and src/theory to validate tracks
samples/       recorded kits and keyboards + manifest.json + CREDITS.md
tools/         build_samples.py                            rebuilds ./samples from the original libraries
```

The **song** and the **playback config** are separate objects:

```js
{ key: 'C', tempo: 120, timeSignature: '7/8', progression: 'Cmaj7 | Am7 | Dm7 | G7' }
{ style: 'jazz', loop: true, countIn: true, sounds: { drums: 'auto', keys: 'piano' },
  modulation: { type: 'interval', interval: 2, everyLoops: 2 },
  tempoRamp: { enabled: true, increment: 5, everyLoops: 2, maxBpm: 220 } }
```

Transposition is musical: chord structure is untouched, roots and slash-basses move, and they are
re-spelled for the destination key (flats in F, B♭, E♭…; sharps in G, D, A…).

### Timing

Musical time comes only from the audio clock. A Worker (unthrottled in background tabs) wakes the
scheduler every 25 ms. The scheduler hands the audio engine one *slot* at a time, up to 250 ms ahead, each note
stamped with an exact `AudioContext` time. A slot is a quarter note in 4/4 and an eighth note in the /8 meters. Every
slot starts exactly one slot-length after the previous one, so nothing accumulates and tempo changes land cleanly.
The UI is fed the same timestamps and updates when you can hear the beat.

Measured in Chrome (4/4): 147 beats at 220 BPM had 0 µs deviation from the ideal grid, audio and wall clocks
differed by 1 ms over 40 s, and the UI reacted a median of 10 ms after the audible beat. The tests check exact
spacing and zero drift over 500 bars in every meter, with irregular timer ticks.

### Recorded sounds

The Jazz kit, Rock kit, Grand piano, Wurlitzer, Double bass and both Bass guitars are recordings, downloaded when first needed (a few MB each) and
kept in memory. If one can't be loaded, that instrument falls back to its synth and the app says so. See
[samples/CREDITS.md](samples/CREDITS.md) for the sources and licences (CC0 and CC BY, which need attribution) and for
what was changed. `python tools/build_samples.py` (needs `numpy` and `soundfile`) rebuilds them.

### Adding a style

A style is an object; write one and call `registerStyle()` in `src/styles/index.js`. The UI lists the
registry automatically.

```js
registerStyle({
  id: 'bossa', name: 'Bossa', description: '…', defaultTempo: 132,
  timeSignatures: ['4/4'],                          // the meters it can play
  feel: { name: 'straight', swing: 0.5 },           // 0.5 straight, 0.667 triplet, or (bpm) => ratio
  humanize: { drums: { t: 0.003, v: 0.07 }, bass: {}, chords: {} },
  timbres: { drums: 'jazz', bass: 'electric', chords: 'piano' },   // its default sounds
  parts: { drums(ctx) {…}, bass(ctx) {…}, chords(ctx) {…} },      // each returns note events
});
```

A part receives the bar (`ctx.segments`, `ctx.nextChord`, `ctx.meter`, `ctx.barIndex`, `ctx.isLastBar`, `ctx.rng`,
`ctx.state` for voice-leading memory…) and returns `{ inst, beat, dur, vel, midi | voice }` events, with positions in
quarter notes. Swing and humanising are applied afterwards. A new instrument is a new key in `parts` plus a voice in
`src/audio/voices.js`; a new drum kit or keyboard is a new entry in `samples/manifest.json`.

## Not built yet (the seams are in place)

Challenge mode (a random `{ song, config }` pair), natural-language modulation ("up a minor third every 2 loops",
which would produce the same `modulation` object the UI does), more time signatures (add a line to `theory/meter.js`),
sign-in with Google or email (the users table has room for it), tags and comments on tracks, exporting tracks as a file, recorded guitar and bass, sections and fills, metronome, recording/microphone, scale suggestions.
