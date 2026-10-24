// Editing a progression one bar at a time, for the chord picker.
//
// The progression *text* stays the single source of truth. Each edit takes the text and returns new text, rewriting only
// the bars it touches: separators, line breaks and every other bar stay byte-for-byte as they were. Bars are indexed
// the way the text has them (not the way parseProgression does, which drops bars it cannot parse).
//
//   Cmaj7 | Am7 | Dm7 G7 | %      bars: "Cmaj7", "Am7", "Dm7 G7", "%"

import { tryParseChord } from './chord.js';
import { getMeter } from './meter.js';

const isNoChord = (t) => /^(n\.?c\.?|nc)$/i.test(t);
const SEP = /([|‖:\r\n]+)/;
const DEFAULT_SEP = ' | ';
/** The words of a bar's text: chords, N.C. or a repeat sign (commas count as spaces, as in the parser). */
const words = (content) => content.replace(/,/g, ' ').trim().split(/\s+/);

/**
 * @typedef {Object} Token
 * @property {'chord'|'nc'|'repeat'|'invalid'} kind
 * @property {string} text
 * @property {import('./chord.js').Chord} [chord]
 * @property {string} [error]
 *
 * @typedef {Object} EditBar
 * @property {string} content  the bar as typed, trimmed ("Dm7 G7")
 * @property {string} sep      what follows it in the text (" | ", a line break, or the trailing text after the last bar)
 * @property {Token[]} tokens
 */

/** Split progression text into its bars. Blank stretches between separators are not bars (as in parseProgression). */
export function tokenizeBars(text) {
  const pieces = String(text ?? '').split(SEP); // [content, sep, content, sep, ..., content]
  let lead = '';
  /** @type {EditBar[]} */
  const bars = [];
  for (let i = 0; i < pieces.length; i += 2) {
    const raw = pieces[i];
    const sepAfter = pieces[i + 1] ?? '';
    const content = raw.replace(/,/g, ' ').trim();
    if (!content) {
      if (bars.length) bars[bars.length - 1].sep += raw + sepAfter;
      else lead += raw + sepAfter;
      continue;
    }
    // keep the original spacing around the content so an untouched bar is returned exactly
    const left = raw.slice(0, raw.length - raw.trimStart().length);
    const right = raw.slice(raw.trimEnd().length);
    if (bars.length === 0) lead += left;
    else bars[bars.length - 1].sep += left;
    bars.push({ content: raw.trim(), sep: right + sepAfter, tokens: classify(content) });
  }
  return { lead, bars };
}

function classify(content) {
  return words(content).map((t) => {
    if (t === '%') return { kind: 'repeat', text: t };
    if (isNoChord(t)) return { kind: 'nc', text: t };
    const r = tryParseChord(t);
    return 'error' in r ? { kind: 'invalid', text: t, error: r.error } : { kind: 'chord', text: t, chord: r.chord };
  });
}

const join = ({ lead, bars }) => lead + bars.map((b) => b.content + b.sep).join('');

/** Does every bar of this text parse as chords, N.C. or a repeat? (Structural edits are refused when it does not.) */
export function canEditText(text) {
  return tokenizeBars(text).bars.every((b) => b.tokens.every((t) => t.kind !== 'invalid'));
}

/** What a bar plays, with repeats followed back to the bar they repeat. */
function resolved(bars, i) {
  let k = i;
  while (k > 0 && bars[k].content === '%') k -= 1;
  return bars[k].content === '%' ? null : bars[k].content;
}

const fail = (error) => ({ error });
const ok = (doc) => ({ text: join(doc) });
const clone = (doc) => ({ lead: doc.lead, bars: doc.bars.map((b) => ({ ...b })) });

/** A bar index that exists in this text. */
function target(text, i) {
  const doc = tokenizeBars(text);
  if (!Number.isInteger(i) || i < 0 || i >= doc.bars.length) return { error: 'That bar does not exist' };
  if (doc.bars.some((b) => b.tokens.some((t) => t.kind === 'invalid'))) {
    return { error: 'Fix the highlighted chord in the text first, then use the buttons' };
  }
  return { doc: clone(doc) };
}

/** A repeat sign stands for the bar before it. Before editing or moving things around it, write it out. */
function expandRepeat(doc, i) {
  if (doc.bars[i]?.content === '%') {
    const source = resolved(doc.bars, i);
    if (source !== null) doc.bars[i].content = source;
  }
}

/**
 * Chord symbols in a bar, as the picker shows them. A repeat bar shows the bar it repeats.
 * @returns {string[]} one entry per segment: a chord symbol, or "NC"
 */
export function barSymbols(text, i) {
  const { bars } = tokenizeBars(text);
  if (i < 0 || i >= bars.length) return [];
  const content = bars[i].content === '%' ? resolved(bars, i) : bars[i].content;
  return content ? words(content).map((t) => (isNoChord(t) ? 'NC' : t)) : [];
}

/**
 * The bars of a progression as the grid shows them: one per bar of the text (nothing is dropped, so numbering always
 * matches the text), with a repeat sign shown as the bar it repeats and a chord that cannot be read marked `invalid`.
 * @returns {{index:number, source:string, repeat:boolean, chords:{chord:import('./chord.js').Chord|null, text:string, invalid:boolean}[]}[]}
 */
export function gridBars(text) {
  const { bars } = tokenizeBars(text);
  return bars.map((b, index) => {
    const repeat = b.content === '%';
    const shown = repeat ? resolved(bars, index) : b.content;
    const tokens = shown ? classify(shown) : [{ kind: 'invalid', text: '%' }];
    return {
      index, source: b.content, repeat,
      chords: tokens.map((t) => ({ chord: t.kind === 'chord' ? t.chord : null, text: t.kind === 'nc' ? 'N.C.' : t.text, invalid: t.kind === 'invalid' })),
    };
  });
}

/** @returns {{text:string}|{error:string}} */
export function setChord(text, i, seg, symbol) {
  const r = target(text, i);
  if (r.error) return fail(r.error);
  const { doc } = r;
  const sym = String(symbol).trim();
  if (!isNoChord(sym)) {
    const p = tryParseChord(sym);
    if ('error' in p) return fail(p.error);
  }
  expandRepeat(doc, i);
  const tokens = words(doc.bars[i].content);
  if (seg < 0 || seg >= tokens.length) return fail('That chord does not exist');
  tokens[seg] = isNoChord(sym) ? 'NC' : sym;
  doc.bars[i].content = tokens.join(' ');
  return ok(doc);
}

/** Add a bar after bar `after` (-1 puts it first). With no content it copies that bar (or is a C in an empty progression). */
export function insertBar(text, after, content) {
  const doc = tokenizeBars(text);
  if (doc.bars.some((b) => b.tokens.some((t) => t.kind === 'invalid'))) return fail('Fix the highlighted chord in the text first, then use the buttons');
  const d = clone(doc);
  if (!d.bars.length) return { text: content ?? 'C' };
  if (after < -1 || after >= d.bars.length) return fail('That bar does not exist');
  // new bars are separated the way the text already separates its bars (a line break, or a bar line)
  const style = d.bars.length > 1 && d.bars[0].sep.trim() === '' && /\n/.test(d.bars[0].sep) ? d.bars[0].sep : DEFAULT_SEP;
  const fallback = after >= 0 ? resolved(d.bars, after) : resolved(d.bars, 0);
  const made = (content ?? fallback ?? 'C').trim();
  if (after === -1) {
    d.bars.unshift({ content: made, sep: style, tokens: [] });
    return ok(d);
  }
  const prev = d.bars[after];
  const last = after === d.bars.length - 1;
  d.bars.splice(after + 1, 0, { content: made, sep: prev.sep, tokens: [] });
  if (last) prev.sep = style;
  return ok(d);
}

/** A copy of the bar, right after it, written out in full (a repeat sign is not copied as "%"). */
export function duplicateBar(text, i) {
  const r = target(text, i);
  if (r.error) return fail(r.error);
  return insertBar(text, i, resolved(r.doc.bars, i) ?? 'C');
}

export function deleteBar(text, i) {
  const r = target(text, i);
  if (r.error) return fail(r.error);
  const { doc } = r;
  if (doc.bars.length === 1) return { text: doc.lead.trim() ? doc.lead : '' };
  // a repeat sign after this bar would start repeating the bar before it: keep what it meant
  expandRepeat(doc, i + 1);
  const [gone] = doc.bars.splice(i, 1);
  if (i === doc.bars.length) doc.bars[i - 1].sep = gone.sep; // it was the last bar: the one before takes the trailing text
  return ok(doc);
}

/** Swap a bar with its neighbour (dir -1 = earlier, +1 = later). Repeat signs involved are written out first. */
export function moveBar(text, i, dir) {
  const r = target(text, i);
  if (r.error) return fail(r.error);
  const { doc } = r;
  const j = i + dir;
  if (j < 0 || j >= doc.bars.length) return fail(dir < 0 ? 'It is already the first bar' : 'It is already the last bar');
  const lo = Math.min(i, j);
  for (let k = lo; k <= Math.min(lo + 2, doc.bars.length - 1); k += 1) expandRepeat(doc, k);
  const tmp = doc.bars[i].content;
  doc.bars[i].content = doc.bars[j].content;
  doc.bars[j].content = tmp;
  return ok(doc);
}

/** Put another chord in the bar (it shares the beats with the chords already there), up to what the time signature fits. */
export function splitBar(text, i, timeSignature = '4/4') {
  const r = target(text, i);
  if (r.error) return fail(r.error);
  const { doc } = r;
  expandRepeat(doc, i);
  const tokens = words(doc.bars[i].content);
  const max = getMeter(timeSignature).groups.length;
  if (tokens.length >= max) return fail(`${timeSignature} fits at most ${max} chords in a bar`);
  tokens.push(tokens[tokens.length - 1]);
  doc.bars[i].content = tokens.join(' ');
  return ok(doc);
}

export function removeSegment(text, i, seg) {
  const r = target(text, i);
  if (r.error) return fail(r.error);
  const { doc } = r;
  expandRepeat(doc, i);
  const tokens = words(doc.bars[i].content);
  if (tokens.length < 2) return fail('A bar needs at least one chord. Delete the bar instead');
  if (seg < 0 || seg >= tokens.length) return fail('That chord does not exist');
  tokens.splice(seg, 1);
  doc.bars[i].content = tokens.join(' ');
  return ok(doc);
}

/** Turn a bar into a repeat of the one before it, or write a repeat out as chords again. */
export function toggleRepeat(text, i) {
  const r = target(text, i);
  if (r.error) return fail(r.error);
  const { doc } = r;
  if (doc.bars[i].content === '%') {
    expandRepeat(doc, i);
    return ok(doc);
  }
  if (i === 0) return fail('The first bar has nothing before it to repeat');
  doc.bars[i].content = '%';
  return ok(doc);
}

// ---- the picker's vocabulary ------------------------------------------------------------------------------------

export const ROOTS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/** [label shown, text written] */
export const ACCIDENTALS = [['♭', 'b'], ['♮', ''], ['♯', '#']];
/** [label shown, suffix written]. Every one of these is checked against the chord parser by the tests. */
export const QUALITIES = [
  ['maj', ''], ['m', 'm'], ['7', '7'], ['maj7', 'maj7'], ['m7', 'm7'], ['m7♭5', 'm7b5'],
  ['dim', 'dim'], ['dim7', 'dim7'], ['aug', 'aug'], ['6', '6'], ['m6', 'm6'], ['6/9', '69'],
  ['9', '9'], ['m9', 'm9'], ['maj9', 'maj9'], ['11', '11'], ['13', '13'], ['sus2', 'sus2'],
  ['sus4', 'sus4'], ['7sus4', '7sus4'], ['7♭9', '7b9'], ['7♯9', '7#9'], ['7♯11', '7#11'], ['alt', 'alt'],
  ['add9', 'add9'], ['m(maj7)', 'mMaj7'], ['5', '5'],
];

/** "Bb" + "maj7" + "D" -> "Bbmaj7/D", or null if it is not a chord the parser accepts. */
export function buildSymbol({ root, acc = '', quality = '', bass = '' }) {
  const symbol = `${root}${acc}${quality}${bass ? `/${bass}` : ''}`;
  return 'error' in tryParseChord(symbol) ? null : symbol;
}

/** A chord symbol back into the picker's parts, or null for N.C. and anything unparseable. */
export function symbolToPicker(symbol) {
  const r = tryParseChord(symbol);
  if ('error' in r) return null;
  const { rootName, bassName, suffix } = r.chord;
  return { root: rootName[0], acc: rootName.slice(1), quality: suffix, bass: bassName ?? '' };
}
