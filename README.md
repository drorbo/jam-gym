# Jam Gym

A backing band for improvisers. Type a chord progression, pick a style, press play, and keep going.
The band (drums, bass, keys or guitar) loops the progression indefinitely and can move the key and
speed up the tempo on its own, so you can practise the same idea in all twelve keys.

No dependencies and no build step. Recorded drums and keyboards load on demand; everything else is
synthesised in the browser. It works offline.

## Run it

```
npm start        # serves http://localhost:5173
npm test         # 170 tests, Node's built-in runner, no install needed
```

Any static file server works. The app must be served over `http://` (ES modules don't load from `file://`).

Live at **[jam-gym.eardle.com](https://jam-gym.eardle.com)**. How it is deployed: [docs/deployment.md](docs/deployment.md).

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
- **Sounds**: drums are a Jazz kit, a Rock kit or Electronic drums. Keys are a Grand piano, a Wurlitzer, or
  the synth electric piano, organ or guitar. Each style has its own default; you can override either.
- **Saved progressions**: name the current setup and press Save. It keeps the progression, key, time signature, style
  and tempo. Saving under an existing name updates it, clicking a saved item brings it all back, and Delete has Undo.
- **Key change**: *Step* moves by an interval (−11…+11 semitones, named) every N loops.
  *Random* picks a key every N loops: never the same twice, completely random, all 12 in random order,
  circle of fifths, circle of fourths, or chromatic.
- **Tempo ramp**: add X BPM every N loops, up to a cap. It combines freely with the key change,
  and the two can run on different schedules.
- **While playing**: tempo, style, sound and mixer changes apply straight away; progression edits, key jumps,
  time-signature changes and loaded songs apply from the next chorus. Invalid text is flagged and the last
  valid version keeps playing.
- Space plays and pauses.

## How it is put together

```
src/theory/    notes, chords, meters, progressions, keys   pure functions: parse, spell, transpose
src/engine/    planner   key + tempo of each chorus        pure: (state, settings, seed) -> next state
               conductor lookahead scheduler               clock and sink injected, no DOM, no Web Audio
               voicing, feel, rng
src/styles/    jazz, blues, rock + registry                data + generators that emit note events
               oddMeters                                   how every style plays in 6/8, 7/8 and 10/8
src/audio/     voices        synthesised instruments
               samples       loader + player for recorded instruments (samplemap: pure selection logic)
               engine, ticker  mixer bus, worker-driven timer
src/app/       state, saved, player, ui                    store, saved progressions, wiring, DOM
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

The Jazz kit, Rock kit, Grand piano and Wurlitzer are recordings, downloaded when first needed (a few MB each) and
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
exporting and importing saved progressions as a file (they live in this browser's storage, so clearing site data
clears them), recorded guitar and bass, sections and fills, metronome, recording/microphone, scale suggestions.
