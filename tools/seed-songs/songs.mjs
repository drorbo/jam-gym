// The songs published to the live Jam Hub by the "jam-gym" account. See docs/adding-songs.md.
// One entry per song. Add new ones at the END (and update the catalog table in the doc after publishing).
//   title, key (the key the chords are WRITTEN in), preset (id from src/styles/presets.js), tempo, bars (expected, checked), description (<= 500 chars), text (progression).

const rep = (bar, n) => Array(n).fill(bar).join(' | ');

export const SONGS = [
{
    title: 'Autumn Leaves', key: 'Gm', preset: 'jazz-swing', tempo: 120,
    description: 'Kosma. 32 bars AABC in G minor: ii-V-I in Bb, then ii-V-i in G minor. The last eight bars use the chromatic Gm7 Gb7 | Fm7 E7 ending.',
    text: [
      'Cm7 | F7 | Bbmaj7 | Ebmaj7 | Am7b5 | D7 | Gm6 | Gm6',
      'Cm7 | F7 | Bbmaj7 | Ebmaj7 | Am7b5 | D7 | Gm6 | Gm6',
      'Am7b5 | D7 | Gm6 | Gm6 | Cm7 | F7 | Bbmaj7 | Ebmaj7',
      'Am7b5 | D7 | Gm7 Gb7 | Fm7 E7 | Am7b5 | D7 | Gm6 | Gm6',
    ].join('\n'), bars: 32,
  },
  {
    title: 'All The Things You Are', key: 'Ab', preset: 'jazz-swing', tempo: 128,
    description: 'Kern. 36 bars in Ab: it passes through Ab, C, Eb, G and E major. The bridge is Am7 D7 Gmaj7 | F#m7b5 B7 Emaj7 C7#5; the last A runs Dbmaj7 Dbm7 Cm7 Bdim7 and ends on a turnaround.',
    text: [
      'Fm7 | Bbm7 | Eb7 | Abmaj7 | Dbmaj7 | Dm7 G7 | Cmaj7 | Cmaj7',
      'Cm7 | Fm7 | Bb7 | Ebmaj7 | Abmaj7 | Am7 D7 | Gmaj7 | Gmaj7',
      'Am7 | D7 | Gmaj7 | Gmaj7 | F#m7b5 | B7 | Emaj7 | C7#5',
      'Fm7 | Bbm7 | Eb7 | Abmaj7 | Dbmaj7 | Dbm7 | Cm7 | Bdim7 | Bbm7 | Eb7 | Abmaj7 | Gm7b5 C7b9',
    ].join('\n'), bars: 36,
  },
  {
    title: 'Blue Bossa', key: 'Cm', preset: 'jazz-bossa', tempo: 136,
    description: 'Kenny Dorham. 16 bars in C minor with a quick move to Db major (Ebm7 Ab7 Dbmaj7) in the middle. Bossa nova groove.',
    text: 'Cm7 | Cm7 | Fm7 | Fm7 | Dm7b5 | G7b9 | Cm7 | Cm7 | Ebm7 | Ab7 | Dbmaj7 | Dbmaj7 | Dm7b5 | G7b9 | Cm7 | Dm7b5 G7b9', bars: 16,
  },
  {
    title: 'Solar', key: 'Cm', preset: 'jazz-swing', tempo: 150,
    description: 'Miles Davis. 12 bars in C minor that move down through F, Eb and Db major, each by ii-V.',
    text: 'Cm(maj7) | Cm(maj7) | Gm7 | C7 | Fmaj7 | Fmaj7 | Fm7 | Bb7 | Ebmaj7 | Ebm7 Ab7 | Dbmaj7 | Dm7b5 G7b9', bars: 12,
  },
  {
    title: 'Take the A Train', key: 'C', preset: 'jazz-swing', tempo: 160,
    description: 'Strayhorn. 32 bars AABA. The A has the D7#11 (the "A train" sound); the bridge sits on Fmaj7 and then D7 Dm7 G7.',
    text: [
      'C6 | C6 | D7#11 | D7#11 | Dm7 | G7 | C6 | Dm7 G7',
      'C6 | C6 | D7#11 | D7#11 | Dm7 | G7 | C6 | Gm7 C7',
      'Fmaj7 | Fmaj7 | Fmaj7 | Fmaj7 | D7 | D7 | Dm7 | G7',
      'C6 | C6 | D7#11 | D7#11 | Dm7 | G7 | C6 | Dm7 G7',
    ].join('\n'), bars: 32,
  },
  {
    title: 'Satin Doll', key: 'C', preset: 'jazz-swing', tempo: 120,
    description: 'Ellington and Strayhorn. 32 bars AABA built from chains of ii-V: Dm7 G7, Em7 A7, Am7 D7, then the half-step-down Abm7 Db7. The bridge goes to F.',
    text: [
      'Dm7 G7 | Dm7 G7 | Em7 A7 | Em7 A7 | Am7 D7 | Abm7 Db7 | Cmaj7 F7 | Em7 A7',
      'Dm7 G7 | Dm7 G7 | Em7 A7 | Em7 A7 | Am7 D7 | Abm7 Db7 | Cmaj7 | Cmaj7',
      'Gm7 C7 | Gm7 C7 | Fmaj7 | Fmaj7 | Am7 D7 | Am7 D7 | G7 | G7',
      'Dm7 G7 | Dm7 G7 | Em7 A7 | Em7 A7 | Am7 D7 | Abm7 Db7 | Cmaj7 F7 | Em7 A7',
    ].join('\n'), bars: 32,
  },
  {
    title: 'All of Me', key: 'C', preset: 'jazz-swing', tempo: 132,
    description: 'Marks and Simons. 32 bars ABAC in C: a chain of dominants (E7, A7, D7) in A and B, and a Fm6 that borrows from the minor in the last eight.',
    text: [
      'Cmaj7 | Cmaj7 | E7 | E7 | A7 | A7 | Dm7 | Dm7',
      'E7 | E7 | Am7 | Am7 | D7 | D7 | Dm7 | G7',
      'Cmaj7 | Cmaj7 | E7 | E7 | A7 | A7 | Dm7 | Dm7',
      'Fmaj7 | Fm6 | Em7 | A7 | Dm7 | G7 | C6 Ebdim7 | Dm7 G7',
    ].join('\n'), bars: 32,
  },
  {
    title: 'So What', key: 'Dm', preset: 'jazz-swing', tempo: 136,
    description: 'Miles Davis. Modal: 32 bars AABA, 16 bars of D dorian, 8 bars of Eb dorian, back to D. One chord per section, so play the scale, not the changes.',
    text: [rep('Dm7', 8), rep('Dm7', 8), rep('Ebm7', 8), rep('Dm7', 8)].join('\n'), bars: 32,
  },
  {
    title: 'Mr. P.C.', key: 'Cm', preset: 'jazz-swing', tempo: 168,
    description: 'Coltrane. A 12-bar minor blues in C minor, played fast. The Ab7 and G7 in bars 9 and 10 lead back home.',
    text: 'Cm7 | Cm7 | Cm7 | Cm7 | Fm7 | Fm7 | Cm7 | Cm7 | Ab7 | G7 | Cm7 | Cm7', bars: 12,
  },
  {
    title: 'Fly Me to the Moon', key: 'C', preset: 'jazz-swing', tempo: 120,
    description: 'Bart Howard. 16 bars: a run around the circle of fifths in A minor (Am7 Dm7 G7 Cmaj7 Fmaj7 Bm7b5 E7), then a second half with Cmaj7 F7 | Em7 A7.',
    text: [
      'Am7 | Dm7 | G7 | Cmaj7 | Fmaj7 | Bm7b5 | E7b9 | Am7 A7',
      'Dm7 | G7 | Cmaj7 F7 | Em7 A7 | Dm7 | G7 | Cmaj7 | Bm7b5 E7b9',
    ].join('\n'), bars: 16,
  },
{
    title: 'Stella by Starlight', key: 'Bb', preset: 'jazz-swing', tempo: 132,
    description: 'Victor Young. 32 bars in Bb: a 16-bar A built from ii-V chains (Em7b5 A7, Cm7 F7, Fm7 Bb7), a bridge that sits two bars each on G7, Cm7, Ab7 and Bbmaj7, then a last eight of descending ii-Vs.',
    text: [
      'Em7b5 | A7b9 | Cm7 | F7 | Fm7 | Bb7 | Ebmaj7 | Ab7 | Bbmaj7 | Em7b5 A7b9 | Dm7 | Bbm7 Eb7 | Fmaj7 | Em7b5 A7 | Am7b5 | D7b9',
      'G7 | G7 | Cm7 | Cm7 | Ab7 | Ab7 | Bbmaj7 | Bbmaj7',
      'Em7b5 | A7b9 | Dm7b5 | G7b9 | Cm7b5 | F7b9 | Bbmaj7 | Bbmaj7',
    ].join('\n'), bars: 32,
  },
  {
    title: "You Don't Know What Love Is", key: 'Fm', preset: 'jazz-ballad', tempo: 64,
    description: 'Raye and DePaul. 32 bars AABA in F minor, a ballad. Listen for the chromatic bass walking down F, E, Eb, D, Db, C in bars 6 to 8 of each A. The bridge turns to Ab and C major.',
    text: [
      'Fm7 | Db7 C7b9 | Fm7 C7b9 | Db7 | Gm7b5 C7b9 | Fm7 E7 Ebm7 D7 | Db7 | Gm7b5 C7b9',
      'Fm7 | Db7 C7b9 | Fm7 C7b9 | Db7 | Gm7b5 C7b9 | Fm7 E7 Ebm7 D7 | Db7 C7b9 | Fm6',
      'Bbm7 Eb7 | Abmaj7 | Bbm7 Eb7 | Abmaj7 | Dm7 G7 | Cmaj7 | Db7 | C7b9',
      'Fm7 | Db7 C7b9 | Fm7 C7b9 | Db7 | Gm7b5 C7b9 | Fm7 E7 Ebm7 D7 | Db7 C7b9 | Fm6',
    ].join('\n'), bars: 32,
  },
  {
    title: 'Wave', key: 'D', preset: 'jazz-bossa', tempo: 126,
    description: 'Jobim. 44 bars AABA in D: a 12-bar A (Dmaj7 Bbdim7 Am7 D7b9, then Gmaj7 Gm6 and a run of dominants down to Dm7 G7) and an 8-bar bridge over bass-line chords (Gm7/Bb C7/Bb Fmaj7/A). Bossa nova.',
    text: [
      'Dmaj7 | Bbdim7 | Am7 | D7b9 | Gmaj7 | Gm6 | F#7 F#7b13 | B9 B7b9 | E7 | Bb7 A7 | Dm7 G7 | Dm7 G7',
      'Dmaj7 | Bbdim7 | Am7 | D7b9 | Gmaj7 | Gm6 | F#7 F#7b13 | B9 B7b9 | E7 | Bb7 A7 | Dm7 G7 | Dm7 G7',
      'Gm7/Bb | C7/Bb | Fmaj7/A | Fmaj7/A | Fm7/Ab | Bb7/Ab | Ebmaj7/G | A7b9',
      'Dmaj7 | Bbdim7 | Am7 | D7b9 | Gmaj7 | Gm6 | F#7 F#7b13 | B9 B7b9 | E7 | Bb7 A7 | Dm7 G7 | Dm7 G7',
    ].join('\n'), bars: 44,
  },
  {
    title: 'Triste', key: 'A', preset: 'jazz-bossa', tempo: 120,
    description: 'Jobim. 34 bars in A: a 16-bar A that drifts through Fmaj7#11 and a long ii-V chain down to C#maj7, and an 18-bar B with a Am7 D7 vamp at the end. Bossa nova.',
    text: [
      'Amaj7 | Amaj7 | Fmaj7#11 | Fmaj7#11 | Amaj7 | Amaj7 | C#m7 | F#7b9 | Bm7 | G#m7b5 C#7b9 | F#m7 | G#7#9 | C#maj7 | D#m7 G#7 | C#m7 F#7 | Bm7 E7',
      'Amaj7 | Amaj7 | Am7 | D7 | Amaj7 | Amaj7 | Em7 | A7 | Dmaj7 | G7 | C#m7 F#7 | B7 | Bm7 | E7 | Am7 D7 | Am7 D7 | Am7 D7 | Am7 D7',
    ].join('\n'), bars: 34,
  },
  {
    title: 'Alone Together', key: 'Dm', preset: 'jazz-swing', tempo: 132,
    description: 'Schwartz. 44 bars in D minor: a 14-bar A (played twice, with an ending that closes on Dmaj7), an 8-bar bridge that moves to F major, and a last A. Mostly ii-V pairs: Em7b5 A7b9 into Dm, Bm7 E7 into Gm7.',
    text: [
      'Dm | Em7b5 A7b9 | Dm | Em7b5 A7b9 | Dm | Am7b5 D7b9 | Gm7 | Gm7 | Bm7 E7 | Gm7 C7 | Fmaj7 | Em7b5 A7b9 | Dmaj7 | Em7b5 A7b9',
      'Dm | Em7b5 A7b9 | Dm | Em7b5 A7b9 | Dm | Am7b5 D7b9 | Gm7 | Gm7 | Bm7 E7 | Gm7 C7 | Fmaj7 | Em7b5 A7b9 | Dmaj7 | Dmaj7',
      'Am7b5 | D7b9 | Gm | Gm | Gm7b5 | C7b9 | Fmaj7 | Em7b5 A7b9',
      'Dm | Em7b5 A7b9 | Dm | Em7b5 A7b9 | Dm | Bb7 A7b9 | Dm | Em7b5 A7b9',
    ].join('\n'), bars: 44,
  },
  {
    title: 'Beautiful Love', key: 'Dm', preset: 'jazz-swing', tempo: 138,
    description: 'Victor Young. 32 bars in D minor, ABAC: the same 8-bar A twice, with two different bridges. The first bridge turns around to the A (G7#11 Em7b5 A7b9); the second goes through B7 and Bb7 and settles on Dm.',
    text: [
      'Em7b5 | A7b9 | Dm | Dm | Gm7 | C7 | Fmaj7 | Em7b5 A7b9',
      'Dm7 | Gm7 | Bb7 | A7b9 | Dm | G7#11 | Em7b5 | A7b9',
      'Em7b5 | A7b9 | Dm | Dm | Gm7 | C7 | Fmaj7 | Em7b5 A7b9',
      'Dm7 | Gm7 | Bb7 | A7b9 | Dm B7 | Bb7 A7b9 | Dm | Dm',
    ].join('\n'), bars: 32,
  },
  {
    title: 'Black Orpheus', key: 'Am', preset: 'jazz-bossa', tempo: 132,
    description: 'Bonfa, "Manha de Carnaval". 32 bars in A minor: a 16-bar A built from Bm7b5 E7b9 into Am, then a ii-V chain to Cmaj7 and Fmaj7, and a 16-bar B that borrows the A\'s opening before moving through Dm and Em7b5 A7b9. Bossa nova.',
    text: [
      'Am | Bm7b5 E7b9 | Am | Bm7b5 E7b9 | Am | Dm7 G7 | Cmaj7 | A7b9 | Dm7 | G7 | Cmaj7 | Fmaj7 | Bm7b5 | E7b9 | Am | Bm7b5 E7b9',
      'Am | Bm7b5 E7b9 | Am | Bm7b5 E7b9 | Em7b5 | A7b9 | Dm | Dm | Dm7 Dm7/C | Bm7b5 E7b9 | Am Am7/G | Fmaj7 | Bm7b5 | E7b9 | Am | Bm7b5 E7b9',
    ].join('\n'), bars: 32,
  },
  {
    title: 'My Funny Valentine', key: 'Cm', preset: 'jazz-ballad', tempo: 66,
    description: 'Rodgers. 36 bars in C minor, a ballad. The A section has a descending line in its top note (Cm, Cm(maj7), Cm7, Cm6); the bridge moves to Eb major and falls by half steps (Cm7 B7 Bbm7 A7) into Abmaj7. The last A ends on Eb6 with a turnaround.',
    text: [
      'Cm | Cm(maj7) | Cm7 | Cm6 | Abmaj7 | Fm7 | Dm7b5 | G7b9',
      'Cm | Cm(maj7) | Cm7 | Cm6 | Abmaj7 | Fm7 | Fm7b5 | Bb7b9',
      'Ebmaj7 Fm7 | Gm7 Fm7 | Ebmaj7 Fm7 | Gm7 Fm7 | Ebmaj7 G7 | Cm7 B7 Bbm7 A7 | Abmaj7 | Dm7b5 G7b9',
      'Cm | Cm(maj7) | Cm7 | Cm6 | Abmaj7 | Dm7b5 G7b9 | Cm7 B7 | Bbm7 A7 | Abmaj7 | Fm7 Bb7b9 | Eb6 | Dm7b5 G7b9',
    ].join('\n'), bars: 36,
  },
  {
    title: 'On Green Dolphin Street', key: 'Eb', preset: 'jazz-swing', tempo: 144,
    description: 'Kaper. 32 bars ABAC in Eb. The A sits over an Eb pedal with a chromatic climb (Ebm7, F7/Eb, Emaj7/Eb); the bridge is ii-V in Eb then Gb; the last eight run down a chain of ii-Vs. Traditionally the A is played Latin and the rest swung; this track swings throughout.',
    text: [
      'Ebmaj7 | Ebmaj7 | Ebm7 | Ebm7 | F7/Eb | Emaj7/Eb | Ebmaj7 | Ebmaj7',
      'Fm7 | Bb7 | Ebmaj7 | Ebmaj7 | Abm7 | Db7 | Gbmaj7 | Bb7',
      'Ebmaj7 | Ebmaj7 | Ebm7 | Ebm7 | F7/Eb | Emaj7/Eb | Ebmaj7 | Ebmaj7',
      'Fm7 Fm7/Eb | Dm7b5 G7b9 | Cm7 Cm7/Bb | Am7b5 D7b9 | Gm7 C7 | Fm7 Bb7 | Ebmaj7 | Ebmaj7',
    ].join('\n'), bars: 32,
  },
];
