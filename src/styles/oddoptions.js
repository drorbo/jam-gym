// The groove and bass-pattern choices that only exist in the /8 meters (6/8, 7/8, 10/8), where the feel comes from the groupings:
// 6/8 = 3+3, 7/8 = 3+2+2, 10/8 = 3+3+2+2 eighths. Pure data, shared by the panels' schema (settings.js) and the players
// (oddgrooves.js for the drums, figures.js for the bass). In 4/4 they are not offered, and a stored choice plays as `elsewhere`.

export const ODD_METERS = ['6/8', '7/8', '10/8'];

/** Drum grooves. `styles` says who gets it; `meters` (default: all three) where it exists. */
export const ODD_GROOVE_OPTIONS = [
  { id: 'pushgroups', name: 'Pushed groups', styles: ['jazz', 'blues', 'rock'], hint: 'the kick leans on the last eighth of each group, and the snare answers on every other group' },
  { id: 'halfgroups', name: 'Half-time groups', styles: ['blues', 'rock'], hint: 'one heavy snare in the middle of the bar, the kick under the first group' },
  { id: 'tomdrive', name: 'Tom drive', styles: ['jazz', 'blues', 'rock'], hint: 'low and middle toms on every group, a kick on the bar line' },
  { id: 'bell', name: 'Bell pattern', styles: ['jazz', 'rock'], hint: 'a bell-like ride on each group and its last eighth, the foot on every other group' },
  { id: 'bembe', name: 'Bembé (Afro-Cuban 6/8)', styles: ['jazz', 'rock'], meters: ['6/8'], hint: 'the standard bell pattern across two bars of 6/8, with a kick under it' },
  { id: 'rimgroups', name: 'Cross-stick groups', styles: ['jazz', 'blues'], hint: 'a cross-stick on every group, a light ride on the last eighths' },
  { id: 'traingroups', name: 'Brushed train', styles: ['blues'], hint: 'a chugging snare on every eighth, leaning on the group downbeats' },
];

/** Bass patterns: fixed figures that follow the groups. `elsewhere` is what they play as in 4/4. */
export const ODD_BASS_OPTIONS = [
  { id: 'grouproots', name: 'Group roots', hint: 'a long root on every group, holding it until the next' },
  { id: 'bounce', name: 'Roots and fifths', hint: 'the root on each group, and the fifth on its last eighth' },
  { id: 'arp', name: 'Arpeggio', hint: 'an eighth-note arpeggio of the chord that runs on across the groups' },
  { id: 'stepin', name: 'Step-in', hint: 'the root on each group, and a step into the next one on its last eighth' },
].map((o) => ({ ...o, styles: ['jazz', 'blues', 'rock'], elsewhere: { jazz: 'walk', blues: 'mixed', rock: 'mixed' } }));

/** The odd-meter grooves a style (in a meter) can play: what "Mixed" chooses among, besides the plain groove. */
export const oddGrooveIds = (styleId, meterId) => ODD_GROOVE_OPTIONS
  .filter((o) => o.styles.includes(styleId) && (o.meters ?? ODD_METERS).includes(meterId)).map((o) => o.id);
