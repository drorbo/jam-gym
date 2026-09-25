// The quick progressions under the progression box. Chords are written in C (major keys) and moved into your starting key
// when you pick one. They only ever change the chords: never your style, your settings or your tempo. The odd-meter ones
// are the one exception, because they only make sense in their meter: they also set the time, and say so.

export const PROGRESSION_GROUPS = [
  {
    id: 'jazz', name: 'Jazz',
    items: [
      { name: 'ii–V–I', text: 'Dm7 | G7 | Cmaj7 | Cmaj7' },
      { name: 'I–vi–ii–V', text: 'Cmaj7 | Am7 | Dm7 | G7' },
      { name: 'Minor ii–V–i', text: 'Dm7b5 | G7 | Cm7 | Cm7' },
      { name: 'Autumn Leaves (A)', text: 'Cm7 | F7 | Bbmaj7 | Ebmaj7 | Am7b5 | D7 | Gm7 | Gm7' },
    ],
  },
  {
    id: 'blues', name: 'Blues',
    items: [
      { name: '12-bar blues', text: 'C7 | C7 | C7 | C7 | F7 | F7 | C7 | C7 | G7 | F7 | C7 | G7' },
      { name: 'Quick-change blues', text: 'C7 | F7 | C7 | C7 | F7 | F7 | C7 | C7 | G7 | F7 | C7 | G7' },
      { name: 'Minor blues', text: 'Cm7 | Cm7 | Cm7 | Cm7 | Fm7 | Fm7 | Cm7 | Cm7 | Ab7 | G7 | Cm7 | G7' },
      { name: '8-bar blues', text: 'C7 | G7 | F7 | F7 | C7 | G7 | C7 | C7' },
    ],
  },
  {
    id: 'rock', name: 'Rock',
    items: [
      { name: 'I–V–vi–IV', text: 'C | G | Am | F' },
      { name: 'I–IV–V', text: 'C | F | G | G' },
      { name: 'Am–G–F–E', text: 'Am | G | F | E' },
      { name: '12-bar rock', text: 'C5 | C5 | C5 | C5 | F5 | F5 | C5 | C5 | G5 | F5 | C5 | G5' },
    ],
  },
  {
    id: 'odd', name: 'Odd meters',
    items: [
      { name: '6/8 blues', text: 'C7 | F7 | C7 | C7 | F7 | F7 | C7 | C7 | G7 | F7 | C7 | G7', timeSignature: '6/8' },
      { name: '7/8 minor vamp', text: 'Am7 | Am7 | Dm7 | E7 | Am7 | Fmaj7 | Dm7 E7 | Am7', timeSignature: '7/8' },
      { name: '10/8 riff', text: 'Am | G | F | E', timeSignature: '10/8' },
    ],
  },
];

/** The group that goes with a style (odd meters go with none). */
export const groupForStyle = (styleId) => PROGRESSION_GROUPS.find((g) => g.id === styleId) ?? PROGRESSION_GROUPS[0];
