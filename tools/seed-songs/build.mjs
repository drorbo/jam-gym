// Turns the songs in songs.mjs into Jam Hub track payloads, validating each one with the server's own validator
// and the app's own chord parser. Offline: it never touches the network.
//
//   node tools/seed-songs/build.mjs                  check every song and print how each one parses
//   node tools/seed-songs/build.mjs out.json         also write the payloads (publish.mjs reads this file)
//   node tools/seed-songs/build.mjs out.json "Wave"  only the songs whose title contains this text
//
// See docs/adding-songs.md.

import fs from 'node:fs';
import { SONGS } from './songs.mjs';
import { prepareTrackData, prepareText } from '../../server/trackdata.js';
import { builtinPresets, applySettings } from '../../src/app/presets.js';
import { defaultState } from '../../src/app/state.js';
import { parseProgression } from '../../src/theory/progression.js';
import { defaultSwing, getStyle } from '../../src/styles/index.js';

const [outFile, only] = process.argv.slice(2);
const presets = builtinPresets();
const out = [];

for (const t of SONGS.filter((s) => !only || s.title.toLowerCase().includes(only.toLowerCase()))) {
  const preset = presets.find((p) => p.id === t.preset);
  if (!preset) throw new Error(`${t.title}: no preset "${t.preset}" (see src/styles/presets.js)`);
  const d = defaultState();
  const config = { ...applySettings(d.config, preset.settings), loop: true, countIn: true };
  // Medium swing eases toward straighter as the tempo rises (the app does this when you change tempo).
  // Latin and ballad presets set their own swing, so they are left alone.
  if (preset.id === 'jazz-swing') config.swing = defaultSwing(getStyle('jazz'), t.tempo);
  const data = { v: 1, song: { key: t.key, tempo: t.tempo, timeSignature: t.timeSignature ?? '4/4', progressionText: t.text }, config, mixer: d.mixer };

  const prepared = prepareTrackData(data); // throws if the app could not play it
  const { title, description } = prepareText({ title: t.title, description: t.description });
  if (prepared.bars !== t.bars) throw new Error(`${t.title}: expected ${t.bars} bars, parsed ${prepared.bars}`);

  const parsed = parseProgression(t.text, { timeSignature: t.timeSignature ?? '4/4' });
  const flat = parsed.bars.map((b) => b.chords.map((s) => s.chord?.symbol ?? 'N.C.').join(' ')).join(' | ');
  console.log(`\n${title}  [${prepared.key}, ${prepared.tempo} BPM, ${preset.name}, swing ${prepared.data.config.swing}, ${prepared.bars} bars]`);
  console.log('  parsed:', flat);
  out.push({ title, description, data: prepared.data });
}

if (outFile) { fs.writeFileSync(outFile, JSON.stringify(out, null, 1)); console.log(`\nwrote ${out.length} track(s) to ${outFile}`); }
else console.log(`\n${out.length} song(s) OK (nothing written; pass an output file to write payloads)`);
