# Jam Gym

A backing band for improvisers. Type a chord progression, pick a style, press play, and keep going.
The band (drums, bass, keys or guitar) loops the progression indefinitely and can move the key and
speed up the tempo on its own, so you can practise the same idea in all twelve keys.

No npm dependencies and no build step. Recorded drums and keyboards load on demand; everything else is
synthesised in the browser. The band plays offline; saving and sharing tracks needs the server.

## Run it

```
npm start        # serves http://localhost:5173 (the site and the tracks API), data in ./data
npm test         # 542 tests, Node's built-in runner, no install needed
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
- **Quick progressions**: under the progression box, in kinds (Jazz, Blues, Rock, Odd meters). The tabs start on your style. Choosing
  one changes only the chords, moved into your starting key: never your style, settings or tempo. The odd-meter ones also set the
  time (their tooltip says so), because they only make sense in their meter.
- **Presets**: in the Style panel, three ways to play each style (jazz: Medium swing, Ballad, Bossa nova, Afro-Cuban, Latin ballad; blues: Shuffle, Slow
  blues, Half-time shuffle; rock: Classic rock, Half-time heavy, Funk rock). Each one also sets the tempo it sounds best at
  (from the next beat if you are playing), and never touches your chords, key or meter. Your own presets are in the sidebar's
  **My presets** tab, next to My tracks and Browse (the *My presets* button in the Style panel opens it), so the quick row stays
  short. There you name and save the band as it is now (style, swing, the Bass line, Keys and Drums panels with the groove and drum
  mixer, the sound choices, and the tempo), use one over any progression, replace it with the current settings, or delete it (with
  undo). Using one sets its tempo, like the built-in ones; a preset saved before tempo was included leaves yours alone. Presets are kept on this device, and once you have an account
  (saving a track creates one) they also sync to it, so another device shows the same list. A preset never creates an account by itself.
- **Starting key**: the key your progression is written in, and the key playback starts in. Hover the button for a
  short guide, click it to pick a tonic and major or minor. Your chords are never changed unless you tick
  *Transpose my chords too*. While playing, the new key starts at the next chorus. The chord strip always shows what is
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
- **Bass line, Keys and Drums**: three panels under the controls that shape how each part of the band plays. See below.
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

## Shaping the band: Bass line, Keys and Drums

Under the controls are three collapsible panels, one for each part of the band. Every slider has a word for where it
sits, "Style default" restores the panel, choosing a style resets all three, and the settings are saved with a track. They
apply from the next bar, in every time signature. At the middle a slider plays what the style always played; less is
sparser or simpler, more is busier or richer.

**Greyed-out controls.** A control that would change nothing right now is greyed out, its Mix button with it, and the
panel says why (hover it, or read the line under the panel): Snare with a groove that has its own snare pattern, Line and
Approach with a fixed bass figure, Crashes with brushes, and so on. In 6/8, 7/8 and 10/8, where the groupings decide the
feel, the lists also drop choices that would sound like another one (the named blues and rock bass figures, two-feel, the
named Keys rhythms, the blues and rock grooves). A choice you made in 4/4 is kept, shows as what plays in the /8 meter,
and comes back when you return to 4/4.

**In 6/8, 7/8 and 10/8** the feel comes from the groupings (3+3, 3+2+2, 3+3+2+2 eighths), so the Groove and Pattern lists change
to choices built from the groups, for every style, and work in all three meters (Bembé is 6/8 only). A 4/4 choice you made
shows as what plays there, and comes back when you return to 4/4.
- **Grooves.** *Pushed groups* (the kick leans on the last eighth of each group, the snare answers on every other group), *Half-time
  groups* (one heavy snare in the middle of the bar), *Tom drive* (low and middle toms on every group), *Bell pattern* (a bell-like
  ride on each group and its last eighth), *Cross-stick groups* (a rim on every group with a light ride) and *Brushed train* (a
  chugging snare on every eighth), and **Bembé**, the standard Afro-Cuban bell pattern (x.x.xx.x.x.x) across two bars of 6/8. Jazz gets
  pushed groups, tom drive, bell, Bembé and cross-stick groups (and still its brushes); blues pushed groups, half-time, toms,
  cross-stick groups and the brushed train; rock pushed groups, half-time, toms, bell and Bembé. Mixed changes among them every four bars.
- **Bass lines**, for every style: *Group roots* (a long root on every group), *Roots and fifths* (the fifth on the last eighth of each
  group), *Arpeggio* (an eighth-note arpeggio that runs on across the groups) and *Step-in* (a step into the next group, or into
  the next chord, on the last eighth). They turn the walking controls off, and a note is cut where its chord ends.

**Mixed.** Every parameter can vary by itself. Each dropdown has a **Mixed** choice (the band picks for itself: a
different Keys rhythm each bar, a mix of bass patterns, approaches or rhythms). Each slider has a **Mix** button: the
slider then wanders up to 30 either side of where you left it, drifting smoothly from bar to bar (a new target every four
bars) and differently in each run, instead of staying put. The stored setting never changes, and which sliders are mixed
is saved with the track.

**Drums**
- **Groove**. *Jazz*: sticks (ride, hat and feathered kick), **brushes: swing** (the swing pattern as brush taps on the snare,
  with a sweeping left hand that leans on two and four) and **brushes: ballad sweeps** (slow circular sweeps carry the time).
  **Straight ride (Metheny style)** is a fast, even-eighths ride in the manner of Pat Metheny's groups: the ride is unswung with the
  beats a little stronger (Cymbal thins it to quarters, and at the top adds a quiet flutter of sixteenths), the hi-hat is on two and
  four, the kick is feathered with syncopated bombs (Kick), and the snare is a busy, interactive comping on the sixteenth grid
  (Snare for how much, Ghost notes for the quiet hits), with straight fills. It sets Swing to 50%; it is a 4/4 groove and plays as
  sticks in 6/8, 7/8 and 10/8. The tempo goes up to 220, which is fast enough for it.
  **Jazz-funk** is the groove to pair with the jazz-funk bass riff: sixteenth-note hats, a backbeat on two and four, ghosted
  snares, and a kick that sits on the riff's own accents (1, the "a" of 1, the "and" of 2, 3, the "a" of 3, the "e" of 4, the "and"
  of 4) so the two lock together. It is straight, so it sets Swing to 50%, and it plays as sticks in 6/8, 7/8 and 10/8.
  Three Latin grooves, all in straight eighths: **bossa nova** (eighth-note hat, the bossa nova clave on the cross-stick, a rocking
  kick), **Afro-Cuban** (a bell-like ride on the beat, the son clave on the cross-stick, a cascara on the hat, the foot on two and
  four) and **Latin brushes (slow ballad)**, a bolero on brushes (a sweep on every beat, a soft clave on the cross-stick, a gentle
  kick, brushed fills and crashes). Choosing one sets Swing to 50% so the bass and keys agree, and leaving it puts the style's swing
  back; they are 4/4 grooves and play as sticks in 6/8, 7/8 and 10/8. Mixed never picks a Latin groove.
  Brushes are synthesised, work with either kit and in every meter, and their crashes are brushed crashes: a soft swell
  rather than a stick strike (the Crashes slider and the Crash fader still control them). *Blues and rock, in 4/4*: *Blues*: classic shuffle, slow 12/8 (three even hat notes to a beat), half-time shuffle
  (Purdie: one big snare on three, ghost notes through the shuffle), Chicago (kick on every beat under a shuffled ride) and
  the train beat (a brushed snare shuffle). *Rock*: classic rock, four on the floor, half-time, stomp and clap, ride groove,
  funk rock (sixteenth hats, ghosted snares) and Bo Diddley (the clave on the toms). *Mixed* (every style) changes groove every four bars.
  The sliders below still shape whichever groove is playing. In 6/8, 7/8 and 10/8 the kit follows the groupings instead.
- **Drum mixer**: a folded-away section at the bottom of the panel with a small fader for each drum: kick, snare, hi-hat,
  ride, crash, toms and (in jazz) brushes. Each runs from silent through 0 dB at the middle (the kit as recorded) to +12 dB,
  and double-clicking a fader puts it back. It answers straight away, even mid-bar, whatever the groove, and is saved with
  the track like the rest of the panel.
- **Snare sound**: play the snare part as a snare drum, a **cross-stick** (a stick laid across the head and struck on the rim) or
  **sticks** (a woody click; the cross-stick clave of a Latin groove turns into a stick click too). Mixed changes it every bar.
  It does nothing for brushes, which play the snare part with brushes.
- **Clave** (jazz, and only for the Latin grooves): the cross-stick clave they play. *The groove's own* (bossa nova plays the bossa
  clave, Afro-Cuban and the ballad the son clave), or **son**, **rumba** or **bossa nova**, each in **3-2** or **2-3**. A clave is two
  bars, a three side and a two side: the son is 1, the "and" of 2, 4, then 2, 3; the rumba moves the last hit of the three side
  to the "and" of 4; the bossa nova clave moves the last hit of the two side to the "and" of 3. Mixed changes clave every four bars.
- **Ride and hi-hat**: just quarters (room to breathe) up to a full ride or sixteenth-note hats.
- **Kick**: only on the beat, up to syncopated. **Snare**: the backbeat only (in jazz, no comping) up to chatty.
- **Ghost notes**: none to lots. **Fills**: how often one leads into the next phrase. **Fill style**: one snare pickup,
  a tidy fill, sixteenth-note (or triplet) tom runs, up to a half-bar roll; big fills are followed by a crash.
- **Crashes**, **Dynamics** (soft to hard), **Timing** (ahead of the beat to laid back) and **Feel** (machine tight to sloppy).

**Keys** (piano in jazz, organ or electric piano in the blues, guitar in rock)
- **How much**: one chord a bar up to constant comping. **On or off the beat**: chords on the beat, or on the "ands" and
  pushed ahead; the chord that starts a change is always heard within its first beat. **Pattern**: repeat a rhythm bar to
  bar, or change it every bar. **Rhythm**: build it from those sliders, or choose a named one (Charleston, four to the
  bar, palm-muted chug, ...).
- **Harmony**: jazz goes from shells (3rd and 7th) through rootless voicings and extended chords (9ths and 13ths) and upper structures
  (just the 9th and 13th) to altered tones; the blues from triads through sevenths, ninths and thirteenths to the sharp-nine "Hendrix"
  chord; rock from power chords through full chords and add 9 to open, ringing chords. Rules that hold at every setting:
  - **What you write is played.** A tension in the chord symbol (F79, F7#9, F7b13, Cmaj9, C6/9, Cm11, F7alt...) is always in the voicing,
    even at Shells, in jazz, blues and rock guitar (the guitar adds it above its chord; palm-muted chugs stay as they are).
  - **Nothing clashes with it.** A written 9 (natural, flat or sharp) keeps out every other 9; a written 13 or #5 every other 13;
    a written 11 or #11 every other 11; an altered fifth replaces the natural one.
  - **A natural 9 or 13 means "not altered".** F79 or F713 stay natural even at Altered: no b9, #9, b13 or #11 is added to them.
  - **Major chords never get an 11 or #11** from the Harmony setting except at Altered, where a #11 is added only now and then.
    Extended and Upper structures give major and dominant chords 9ths and 13ths. Altered dominants get b9, #9 (now and then a #11
    instead) and b13. Minor chords keep their natural 11.
- **Register** (low to high on the keyboard), **Voicing** (close to wide), **Note length** (staccato to sustained),
  **Dynamics**, **Timing**, **Feel**.

**Bass line** (all three styles)
- **Jazz** walks, or plays a fixed figure (Pattern). The jazz figures: **pedal point** (one long root a bar, for modal tunes), **modal
  vamp** (root, an octave skip on the "and" of two, root, fifth), **sparse** (a long root, then the fifth on the "and" of three) and
  **jazz-funk** (a syncopated riff in straight sixteenths, with ghosted notes and the seventh of the chord; it sets Swing to 50%). The
  first three swing with everything else. The **Latin figures**: *bossa nova* (root, fifth and root on the dotted pulse: 1, the "and" of 2, 4),
  *tumbao* (the "and" of two, four, and the next chord's root a half beat early) or *bolero* (long roots for a slow Latin ballad,
  the fifth on three, the next root anticipated); *Mixed* changes Latin figure every four bars. The Latin ones are straight
  eighths, so choosing one sets Swing to 50% too. Every figure turns the walking controls off, is cut where its chord ends, and in
  6/8, 7/8 and 10/8 jazz always walks.
- **Jazz and blues walk.** **Rhythm**: steady quarters, quarters with swung skips, running eighths, two-feel, or mixed.
  **Line** runs from scales to arpeggios, **Tensions** from chord tones to colourful (9ths, 13ths, #11), and **Approach** is
  how the last note leads into the next chord: a half step, a scale step, the fifth above, an enclosure, or a mix. The blues
  **Pattern** is the boogie with a lead into each change and a walking turnaround (the default), walking throughout, or
  boogie throughout.
  The blues **Pattern** also offers fixed figures: classic boogie, Chicago shuffle (root, fifth, sixth, fifth), rising boogie,
  roots and fifths, pushed roots, stop-time, and a slow 12/8 pulse of triplet roots. They lead a half step into each change and
  switch the walking controls off.
- **Rock** has its own **Pattern**: mixed, driving eighths, octaves, pushes, quarter notes, syncopated, a melodic
  line, rock and roll boogie, gallop, three-three-two, off-beat pumps or held half-note roots. **Line** runs from root notes to a melodic part (fifths, octaves, and with Tensions sevenths, fourths and
  sixths), **Approach** can be none, and **Bass fills** add a short run at the end of a phrase.
- **Note length**, **Timing** and **Feel** for every style.

How a walking line is chosen (`src/styles/walking.js`): the rhythm is planned first; beat one is the root, and the last
note is picked as an approach into the next chord; the notes between are found by a beam search that scores every
candidate on chord tones for strong beats, scale and passing tones for weak ones, step against leap, colour tones,
direction, leap recovery and not repeating last bar's shape, with seeded noise so each chorus differs. The panels are
described by one schema (`src/styles/settings.js`); the players are `drumming.js`, `comping.js`, `walking.js` and
`rockbass.js`.

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
- **A track keeps the whole setup**: progression, key, meter, tempo (set again when you open it, even while playing), style, swing, all three panels (grooves, patterns and the drum mixer
  included), sounds, key change, tempo ramp and the mixer. Saved, published, opened by someone else or copied, it comes back the same
  (`test/track-band.test.js`); a track saved before a setting existed opens with that setting at the style's own value.
- **Publish** makes a track public under your name (with a confirmation that says so); **Make private** takes it back.
  Published tracks have a link (`/?track=ID`) that opens them straight into the player.
- **Browse**: search titles, authors and chords together (`Dm7 G7` finds tracks that contain those chords, however they
  are spelled), filter by style, time signature, key and tempo, sort by best match, most liked or newest. Like a track
  with the heart, or save a copy to your own library. Report sends it to moderation; three different reporters hide it.
- Offline or with the server down, Save keeps the track on this device. Older browser-only saves are listed under
  "On this device" and can be moved into the library.

Design and decisions: [docs/tracks-design.md](docs/tracks-design.md). Moderation is a command on the server:
`docker exec jam-gym-web-1 node server/admin.js reports` (also `stats show hide restore delete ban unban backup`).

## Accounts: Jam Gym is part of eardle

Jam Gym runs as a subdomain of [eardle](https://eardle.com) on the same server, and people can **sign in with their eardle
account** (Tracks panel, "Sign in with eardle"). It is optional: without it each browser has an anonymous library and a
recovery code. Signing in links that library to the eardle account so it follows the person to every device; if a browser
already had a library and the account has one too, they are merged. Jam Gym never sees a password or email, and keeps its own
database. How it works, the setup script and the deploy order (eardle first) are in [docs/eardle-accounts.md](docs/eardle-accounts.md);
the eardle side is in that repo's `docs/jam-gym-integration.md`.

## How it is put together

```
src/theory/    notes, chords, meters, progressions, keys   pure functions: parse, spell, transpose
src/engine/    planner   key + tempo of each chorus        pure: (state, settings, seed) -> next state
               conductor lookahead scheduler               clock and sink injected, no DOM, no Web Audio
               voicing, feel, rng
src/styles/    jazz, blues, rock + registry                data + generators that emit note events
               settings                                    the schema for the Bass line, Keys and Drums panels
               walking, rockbass                           bass: walking engine; rock bass patterns and fills
               comping, drumming                           keys and guitar; the drummer (rhythm, voicings, fills)
               oddMeters                                   how every style plays in 6/8, 7/8 and 10/8
src/audio/     voices        synthesised instruments
               samples       loader + player for recorded instruments (samplemap: pure selection logic)
               engine, ticker  mixer bus, worker-driven timer
src/app/       state, player, ui, band-ui, sidebar         store, playback wiring, DOM
               progressions, quick-ui                      the quick progression chips (data, and the row under the box)
               presets, presets-controller, presets-ui     band presets: model, controller (device + account sync), the row
               api, tracks-model, tracks, tracks-ui        tracks: HTTP client, setup <-> track data, controller, panel
               saved                                       older browser-only saves (offline fallback, migration)
server/        index, app, static, db, tracks, users,      the site + /api on Node's built-in http and node:sqlite;
               presets, sso, search, trackdata, limits, backup, admin   reuses src/app/state.js and src/theory to validate tracks and presets
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
