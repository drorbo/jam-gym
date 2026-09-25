// The built-in style presets: three ways to play each style, chosen from the Style panel.
//
// A preset is band settings (style, swing, the Bass line, Keys and Drums panels, the sound choices) plus its best tempo.
// It never touches the chords, key or meter. `settings` lists only what differs from the style's own defaults; the rest is filled in
// (and checked) by src/app/presets.js. `tempo` is the tempo the preset sounds best at: choosing a built-in preset sets it.
// (A preset of your own is band settings only; it leaves your tempo alone.)

export const BUILTIN_PRESETS = [
  // ---- jazz ------------------------------------------------------------------------------------
  {
    id: 'jazz-swing', style: 'jazz', name: 'Medium swing', tempo: 132,
    blurb: 'Ride cymbal, hi-hat on two and four, walking bass and piano comping.',
    settings: {},
  },
  {
    id: 'jazz-ballad', style: 'jazz', name: 'Ballad', tempo: 64,
    blurb: 'Brush sweeps, a two-feel bass and soft, sustained chords.',
    settings: {
      swing: 60,
      bass: { rhythm: 'two', line: 35, length: 70 },
      comp: { density: 30, length: 75, power: 35, tension: 55, spread: 55 },
      kit: { groove: 'sweep', cymbal: 35, kick: 30, snare: 30, fills: 20, crash: 30, power: 30 },
    },
  },
  {
    id: 'jazz-bossa', style: 'jazz', name: 'Bossa nova', tempo: 120,
    blurb: 'Straight eighths, the clave on the cross-stick, a two-feel bass.',
    settings: {
      swing: 50,
      bass: { rhythm: 'two', line: 30, approach: 'step', length: 60 },
      comp: { density: 45, sync: 65, tension: 55, length: 35 },
      kit: { groove: 'bossa', power: 45 },
    },
  },

  // ---- blues -----------------------------------------------------------------------------------
  {
    id: 'blues-shuffle', style: 'blues', name: 'Shuffle', tempo: 100,
    blurb: 'The triplet shuffle: boogie bass, a backbeat and electric piano.',
    settings: {},
  },
  {
    id: 'blues-slow', style: 'blues', name: 'Slow blues', tempo: 58,
    blurb: 'A slow 12/8 with a triplet bass pulse and long organ chords.',
    settings: {
      swing: 67,
      bass: { pattern: 'triplets', length: 70 },
      comp: { rhythm: 'pad', density: 50, length: 80, tension: 45, power: 45 },
      kit: { groove: 'slow', power: 45, ghosts: 60, fills: 30, crash: 30 },
      sounds: { keys: 'organ' },
    },
  },
  {
    id: 'blues-halftime', style: 'blues', name: 'Half-time shuffle', tempo: 92,
    blurb: 'One big snare on three with ghost notes, a Chicago bass and stabbed chords.',
    settings: {
      bass: { pattern: 'chicago' },
      comp: { rhythm: 'stabs', density: 55, sync: 55 },
      kit: { groove: 'purdie', ghosts: 70, power: 60 },
    },
  },

  // ---- rock ------------------------------------------------------------------------------------
  {
    id: 'rock-classic', style: 'rock', name: 'Classic rock', tempo: 120,
    blurb: 'Eighth-note hats, driving bass and power-chord guitar.',
    settings: {},
  },
  {
    id: 'rock-half', style: 'rock', name: 'Half-time heavy', tempo: 80,
    blurb: 'One heavy snare on three, held bass roots and open, ringing chords.',
    settings: {
      bass: { pattern: 'held', tension: 10 },
      comp: { rhythm: 'open', tension: 25, length: 75, power: 65 },
      kit: { groove: 'half', power: 70, crash: 70, cymbal: 40 },
    },
  },
  {
    id: 'rock-funk', style: 'rock', name: 'Funk rock', tempo: 108,
    blurb: 'Sixteenth-note hats, ghosted snares, a syncopated bass and stabbed guitar.',
    settings: {
      bass: { pattern: 'syncopated', line: 45, tension: 35 },
      comp: { rhythm: 'stabs', sync: 65, density: 60, tension: 35 },
      kit: { groove: 'funk', ghosts: 65, cymbal: 65, kick: 60, power: 55 },
    },
  },
];

export const presetsForStyle = (styleId) => BUILTIN_PRESETS.filter((p) => p.style === styleId);
