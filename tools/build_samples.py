#!/usr/bin/env python3
"""
Builds the bundled instrument samples in ./samples from openly licensed sources.

    pip install numpy soundfile
    python tools/build_samples.py            # downloads (cached), processes, writes ./samples

Sources (see CREDITS.md for licences and attribution):
  jazz drums   Virtuosity Drums (Versilian Studios / Karoryfer Samples)   CC0
  rock drums   MuldjordKit (Lars Muldjord, DrumGizmo)                     CC BY 4.0
  piano        Salamander Grand Piano V3 (Alexander Holm), via Tone.js    CC BY 3.0
  e-piano      Wurlitzer EP200 (Greg Sullivan)                            CC BY 3.0
  double bass  Meatbass, pizzicato (Karoryfer Samples / D. Smolken)       CC0
  bass guitar  Black And Blue Basses (Karoryfer Samples): Dark Black, Baby Blue   CC0

What the script does to each hit: mixes microphones (multi-mic kits), time-aligns and
polarity-matches close mics to the overheads so they can't cancel, trims leading silence and
the decayed tail, fades the end, folds to mono, and writes 16-bit WAV (decodes everywhere,
no encoder delay, so hits land exactly on the beat).
"""
import json, os, re, sys, tempfile, hashlib, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'samples')
CACHE = os.path.join(tempfile.gettempdir(), 'jamgym-sample-cache')
os.makedirs(CACHE, exist_ok=True)

GH = 'https://raw.githubusercontent.com/sfzinstruments'
TONE = 'https://raw.githubusercontent.com/Tonejs/audio/master/salamander'


# ---- download ---------------------------------------------------------------------------

def fetch(url):
    path = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest() + os.path.splitext(url)[1])
    if not os.path.exists(path):
        for attempt in range(4):
            try:
                with urllib.request.urlopen(urllib.parse.quote(url, safe=':/%?=&'), timeout=60) as r, open(path + '.part', 'wb') as f:
                    f.write(r.read())
                os.replace(path + '.part', path)
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 3:
                    raise RuntimeError(f'download failed: {url}: {e}')
    return path


def fetch_text(url):
    return open(fetch(url), encoding='utf-8', errors='replace').read()


def fetch_many(urls):
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(fetch, urls))


def read(url):
    data, sr = sf.read(fetch(url), dtype='float32', always_2d=True)
    return data.mean(axis=1), sr


# ---- audio helpers ----------------------------------------------------------------------

def db(x):
    return 10 ** (x / 20)


def shift(x, lag):
    """Delay x by `lag` samples (negative = advance), keeping its length."""
    if lag == 0:
        return x
    out = np.zeros_like(x)
    if lag > 0:
        out[lag:] = x[:-lag]
    else:
        out[:lag] = x[-lag:]
    return out


def align_to(ref, x, max_lag):
    """Shift/flip x so it adds coherently with ref (fixes close-mic vs overhead cancellation)."""
    n = min(len(ref), len(x), 4096)
    a, b = ref[:n], x[:n]
    c = np.correlate(a, b, 'full')
    lags = np.arange(-(n - 1), n)
    keep = np.abs(lags) <= max_lag
    k = np.argmax(np.abs(np.where(keep, c, 0)))
    lag = int(lags[k])
    sign = 1.0 if c[k] >= 0 else -1.0
    return sign * shift(x, lag)


def mix_mics(chans, sr, close_gain, oh_gain, amb_gain):
    """chans: dict with optional 'close' (list), 'oh' (list), 'amb' (list) of mono arrays."""
    n = max(len(a) for grp in chans.values() for a in grp)
    pad = lambda a: np.pad(a, (0, n - len(a)))
    oh = sum(pad(a) for a in chans['oh']) * oh_gain / max(1, len(chans['oh']))
    amb = sum(pad(a) for a in chans['amb']) * amb_gain / max(1, len(chans['amb'])) if chans.get('amb') else 0
    room = oh + amb
    out = room.copy() if isinstance(room, np.ndarray) else np.zeros(n, dtype=np.float32)
    for c in chans.get('close', []):
        out = out + close_gain * align_to(room if np.any(room) else pad(c), pad(c), int(sr * 0.004))
    return out


def trim(x, sr, max_len, floor_db=-58, pre_ms=0.5):
    """Cut leading silence (keep a hair of pre-roll), cut the tail once it decays, fade the end."""
    peak = np.max(np.abs(x)) + 1e-12
    thr = peak * db(-42)
    on = int(np.argmax(np.abs(x) > thr))
    start = max(0, on - int(sr * pre_ms / 1000))
    y = x[start:]
    env = np.abs(y)
    win = int(sr * 0.02)
    smooth = np.convolve(env, np.ones(win) / win, 'same')
    floor = peak * db(floor_db)
    idx = np.where(smooth > floor)[0]
    end = int(idx[-1]) if len(idx) else len(y)
    end = min(end + int(sr * 0.03), len(y), int(sr * max_len))
    y = y[:end].copy()
    fade = min(len(y), int(sr * min(0.12, max_len * 0.15)))
    y[-fade:] *= np.linspace(1, 0, fade) ** 1.5
    return y


def resample(x, sr_from, sr_to):
    if sr_from == sr_to:
        return x
    n_out = int(round(len(x) * sr_to / sr_from))
    spec = np.fft.rfft(x)
    m = n_out // 2 + 1
    spec = spec[:m] if m <= len(spec) else np.pad(spec, (0, m - len(spec)))
    return np.fft.irfft(spec, n_out) * (n_out / len(x))


def write(rel, x, sr, stats=None):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    x = np.clip(x, -1, 1)
    sf.write(path, x, sr, subtype='PCM_16')
    return {'file': rel.replace('\\', '/'), 'ms': round(1000 * len(x) / sr)}


def layer_target(ref, trim_gain):
    """Peak level for a velocity layer. Recorded layers span 30 dB or more; a gentler curve keeps soft
    hits (ghost notes, feathered kick) usable while their softer, darker character is preserved."""
    return db(-2) * trim_gain * (0.35 + 0.65 * ref)


def pick(seq, k):
    """k items spread evenly through seq (first and last included)."""
    if k >= len(seq):
        return list(seq)
    return [seq[round(i * (len(seq) - 1) / (k - 1))] for i in range(k)]


# ---- Jazz kit: Virtuosity Drums, 'mid' microphone ---------------------------------------

def build_jazz():
    base = f'{GH}/virtuosity_drums/master/Samples/mid'
    tree = json.loads(fetch_text('https://api.github.com/repos/sfzinstruments/virtuosity_drums/git/trees/master?recursive=1'))
    names = {t['path'] for t in tree['tree'] if t['type'] == 'blob'}

    def layers(folder, prefix, count, rrs):
        """Available (vl, [rr files]) for files named {prefix}_vl{N}[_rr{M}].flac, spread to `count` layers."""
        found = {}
        for p in names:
            m = re.fullmatch(rf'Samples/mid/{folder}/{re.escape(prefix)}_vl(\d+)(?:_rr(\d+))?\.flac', p)
            if m:
                found.setdefault(int(m.group(1)), []).append((int(m.group(2) or 1), p))
        vls = sorted(found)
        chosen = pick(vls, count)
        return [(vl, [p for _, p in sorted(found[vl])[:rrs]]) for vl in chosen]

    voices = {}
    spec = {
        # voice: (folder, prefix, layers, rr, max_len, trim_gain)
        'kick':     ('kick', 'mid_kick_snoff', 4, 2, 0.55, 1.0),
        'snare':    ('snare', 'mid_snare_center', 4, 1, 0.8, 1.0),
        'hat':      ('hh', 'mid_hh_closed', 4, 2, 0.30, 0.85),
        'hatOpen':  ('hh', 'mid_hh_open', 2, 1, 1.1, 0.85),
        'hatPedal': ('hh', 'mid_hh_pedal', 2, 2, 0.30, 0.85),
        'ride':     ('ride', 'mid_ride_ride', 3, 2, 1.7, 0.9),
        'crash':    ('crash', 'mid_crash_crash', 2, 1, 2.6, 0.9),
        'tomHigh':  ('htom', 'mid_htom_center', 3, 1, 0.9, 1.0),
        'tomLow':   ('ltom', 'mid_ltom_center', 3, 1, 1.0, 1.0),
    }
    fetch_many([f'{GH}/virtuosity_drums/master/{p}' for folder, prefix, cnt, rr, ml, g in spec.values()
                for _, files in layers(folder, prefix, cnt, rr) for p in files])

    for voice, (folder, prefix, cnt, rr, max_len, tg) in spec.items():
        ls = layers(folder, prefix, cnt, rr)
        raw = []
        for vl, files in ls:
            hits = []
            for p in files:
                x, sr = read(f'{GH}/virtuosity_drums/master/{p}')
                hits.append(trim(x, sr, max_len))
            raw.append((vl, hits, sr))
        out = []
        for i, (vl, hits, sr) in enumerate(raw):
            ref = round((i + 1) / len(raw), 2)
            scale = layer_target(ref, tg) / max(np.max(np.abs(h)) for h in hits)
            files = [write(f'drums/jazz/{voice}_{i + 1}_{j + 1}.wav', h * scale, sr)['file'] for j, h in enumerate(hits)]
            out.append({'ref': ref, 'files': files})
        voices[voice] = out
    # the jazz kit only has two toms: reuse the small one, pitched up, for "mid"
    voices['tomMid'] = [{'ref': l['ref'], 'files': l['files'], 'rate': 1.19} for l in voices['tomLow']]
    return {
        'id': 'jazz', 'name': 'Jazz kit',
        'credit': 'Virtuosity Drums, Versilian Studios and Karoryfer Samples (CC0)',
        'voices': voices,
    }


# ---- Rock kit: MuldjordKit (multi-mic, mixed and phase-aligned here) --------------------

def build_rock():
    base = f'{GH}/DrumGizmo.MuldjordKit/master/DrumGizmo/MuldjordKit'

    def region_layers(instr):
        """Velocity layers from the kit's region map: [[hit numbers of layer 1], [layer 2], ...]."""
        txt = fetch_text(f'{base}/Data/region/{instr}.txt')
        layers = {}
        order = []
        for m in re.finditer(r'lovel=\$(v\d+)l.*?sample=\$instr/(\d+)-', txt):
            if m.group(1) not in layers:
                layers[m.group(1)] = []
                order.append(m.group(1))
            layers[m.group(1)].append(int(m.group(2)))
        return [layers[k] for k in order]

    def mics(instr, n, names):
        return [f'{base}/Samples/{instr}/{n}-{instr}-{m}.flac' for m in names]

    OH, AMB = ['OHL', 'OHR'], ['AmbL', 'AmbR']
    spec = {
        # voice: (folder, close mics, close_gain, oh_gain, amb_gain, layers, rr, max_len, trim_gain)
        'kick':     ('KdrumL', ['KdrumL', 'KdrumR'], 0.7, 0.45, 0.35, 4, 2, 0.6, 1.0),
        'snare':    ('Snare', ['Snare_top'], 0.55, 0.5, 0.35, 4, 2, 0.9, 1.0),
        'hat':      ('HihatClosed', ['Hihat'], 0.45, 0.55, 0.3, 3, 2, 0.3, 0.8),
        'hatOpen':  ('HihatOpen', ['Hihat'], 0.45, 0.55, 0.3, 2, 1, 1.2, 0.8),
        'ride':     ('RideR', ['RideR'], 0.35, 0.5, 0.3, 3, 1, 1.6, 0.85),
        'crash':    ('CrashL', [], 0, 0.8, 0.4, 2, 1, 2.6, 0.9),
        'tomHigh':  ('Tom1', ['Tom1'], 0.5, 0.5, 0.3, 3, 1, 0.9, 1.0),
        'tomMid':   ('Tom2', ['Tom2'], 0.5, 0.5, 0.3, 3, 1, 1.0, 1.0),
        'tomLow':   ('Tom3', ['Tom3'], 0.5, 0.5, 0.3, 3, 1, 1.1, 1.0),
    }

    plan = {}
    urls = []
    for voice, (folder, close, cg, og, ag, cnt, rr, ml, tg) in spec.items():
        ls = region_layers(folder)
        chosen = pick(ls, cnt)
        plan[voice] = [(hits[:rr]) for hits in chosen]
        for hits in plan[voice]:
            for n in hits:
                urls += mics(folder, n, close + OH + AMB)
    fetch_many(urls)

    voices, report = {}, []
    for voice, (folder, close, cg, og, ag, cnt, rr, ml, tg) in spec.items():
        mixed_layers = []
        for hits in plan[voice]:
            mixed = []
            for n in hits:
                chans = {'close': [], 'oh': [], 'amb': []}
                sr = None
                for m in close:
                    x, sr = read(mics(folder, n, [m])[0]); chans['close'].append(x)
                for m in OH:
                    x, sr = read(mics(folder, n, [m])[0]); chans['oh'].append(x)
                for m in AMB:
                    x, sr = read(mics(folder, n, [m])[0]); chans['amb'].append(x)
                y = mix_mics(chans, sr, cg, og, ag)
                # phase sanity: coherent sum keeps energy close to the incoherent sum
                parts = [np.sqrt(np.mean(np.square(a))) for g in chans.values() for a in g]
                coh = np.sqrt(np.mean(np.square(y))) / (np.sqrt(sum(p * p for p in parts)) + 1e-12)
                report.append((voice, n, round(float(coh), 2)))
                mixed.append(trim(y, sr, ml))
            mixed_layers.append((mixed, sr))
        out = []
        for i, (hits, sr) in enumerate(mixed_layers):
            ref = round((i + 1) / len(mixed_layers), 2)
            scale = layer_target(ref, tg) / max(np.max(np.abs(h)) for h in hits)
            files = [write(f'drums/rock/{voice}_{i + 1}_{j + 1}.wav', h * scale, sr)['file'] for j, h in enumerate(hits)]
            out.append({'ref': ref, 'files': files})
        voices[voice] = out
    worst = sorted(report, key=lambda r: r[2])[:6]
    print('  lowest coherence (1.0+ = mics add cleanly, <0.6 = cancelling):', worst)
    return {
        'id': 'rock', 'name': 'Rock kit',
        'credit': 'MuldjordKit by Lars Muldjord, drumgizmo.org (CC BY 4.0)',
        'voices': voices,
    }


# ---- Keys -------------------------------------------------------------------------------

NOTE = {'C': 0, 'Cs': 1, 'D': 2, 'Ds': 3, 'E': 4, 'F': 5, 'Fs': 6, 'G': 7, 'Gs': 8, 'A': 9, 'As': 10, 'B': 11}


def build_piano():
    roots = ['A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6']
    fetch_many([f'{TONE}/{r}.ogg' for r in roots])
    notes = []
    for r in roots:
        m = re.fullmatch(r'([A-G]s?)(\d)', r)
        midi = 12 * (int(m.group(2)) + 1) + NOTE[m.group(1)]
        x, sr = read(f'{TONE}/{r}.ogg')
        length = 4.2 if midi < 60 else 3.4 if midi < 78 else 2.4
        y = trim(x, sr, length, floor_db=-70)
        y = resample(y, sr, 32000)
        y *= db(-3) / (np.max(np.abs(y)) + 1e-9)
        notes.append({**write(f'keys/piano/{r}.wav', y, 32000), 'midi': midi})
    return {
        'id': 'piano', 'name': 'Grand piano', 'kind': 'multisample', 'release': 0.35, 'gain': 0.9, 'brightness': True,
        'credit': 'Salamander Grand Piano by Alexander Holm (CC BY 3.0)', 'notes': notes,
    }


def build_wurli():
    """Greg Sullivan's Wurlitzer EP200: file names are <note><octave><dynamic>, e.g. ab3mp = A-flat 3, mezzo-piano."""
    tree = json.loads(fetch_text('https://api.github.com/repos/sfzinstruments/GregSullivan.E-Pianos/git/trees/master?recursive=1'))
    base = f'{GH}/GregSullivan.E-Pianos/master'
    LAYERS = {'mp': 0.5, 'f': 0.85}                       # two dynamics keep the download small
    FLAT = {'db': 'Cs', 'eb': 'Ds', 'gb': 'Fs', 'ab': 'Gs', 'bb': 'As'}
    found = {}
    for t in tree['tree']:
        m = re.fullmatch(r'Wurlitzer EP200/Samples/([a-g]b?)(\d)(pp|mp|f|ff)\.flac', t['path'])
        if not m or m.group(3) not in LAYERS:
            continue
        n = m.group(1).lower()
        pc = NOTE[FLAT.get(n, n.upper())]
        midi = 12 * (int(m.group(2)) + 1) + pc
        found.setdefault(m.group(3), []).append((midi, t['path']))
    fetch_many([f'{base}/{p}' for lst in found.values() for _, p in lst])
    notes = []
    for layer, lst in found.items():
        for midi, p in sorted(lst):
            x, sr = read(f'{base}/{p}')
            y = trim(x, sr, 2.6, floor_db=-66)
            y = resample(y, sr, 32000)
            name = os.path.basename(p).replace('.flac', '')
            notes.append({**write(f'keys/wurli/{name}.wav', y, 32000), 'midi': midi, 'ref': LAYERS[layer], 'peak': float(np.max(np.abs(y)))})
    # one shared gain per layer so dynamics survive, normalised to the loudest note
    top = max(n['peak'] for n in notes)
    for n in notes:
        path = os.path.join(OUT, n['file'])
        y, sr = sf.read(path, dtype='float32')
        sf.write(path, np.clip(y * (db(-3) / top), -1, 1), sr, subtype='PCM_16')
        del n['peak']
    print('  wurlitzer notes per layer:', {k: len(v) for k, v in found.items()})
    return {
        'id': 'wurli', 'name': 'Wurlitzer', 'kind': 'multisample', 'release': 0.12, 'gain': 0.55, 'brightness': False,
        'credit': 'Wurlitzer EP200 by Greg Sullivan (CC BY 3.0)', 'notes': notes,
    }


# ---- Basses -----------------------------------------------------------------------------

MEATBASS = 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.meatbass/master/Samples/pizz'
BLACKBLUE = 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.black-and-blue-basses/main/Samples'
BASS_RATE = 24000      # bass has little above 8 kHz; 24 kHz keeps the pluck and halves the download
FLATS = {'db': 1, 'eb': 3, 'gb': 6, 'ab': 8, 'bb': 10}


def note_midi(name):
    """'c2' -> 36, 'eb1' -> 27, 'gb3' -> 54 (scientific pitch, C4 = 60)."""
    m = re.fullmatch(r'([a-g]b?)(\d)', name)
    letter = m.group(1)
    pc = FLATS[letter] if letter in FLATS else NOTE[letter.upper()]
    return 12 * (int(m.group(2)) + 1) + pc


def rms(x, sr, seconds=0.5):
    seg = x[: int(sr * seconds)]
    return float(np.sqrt(np.mean(np.square(seg))) + 1e-12)


def squash(x, sr, threshold_db=-14, ratio=3.5, attack_ms=1.0, release_ms=90):
    """
    A gentle feed-forward compressor. A plucked bass note is all transient: its peak is far above its body, so at a level
    where the peak is safe the note sounds thin next to a sustained synth. Taming the peak lets the body come up.
    """
    peak = float(np.max(np.abs(x))) + 1e-12
    thr = peak * db(threshold_db)
    env = np.abs(x)
    a = np.exp(-1 / (sr * attack_ms / 1000))
    r = np.exp(-1 / (sr * release_ms / 1000))
    out = np.empty_like(x)
    level = 0.0
    for i, v in enumerate(env):
        level = a * level + (1 - a) * v if v > level else r * level + (1 - r) * v
        gain = 1.0 if level <= thr else (thr / level) ** (1 - 1 / ratio)
        out[i] = x[i] * gain
    return out


def bass_bank(bank_id, name, credit, layers, folder, release, gain, max_len):
    """
    layers: [(ref, {sounding_midi: url})]. Every note is trimmed, resampled, levelled to the same loudness as its
    neighbours in the layer (so the line does not jump in volume), and each layer is then scaled with the same gentle
    velocity curve the drums use, so soft notes stay usable.
    """
    urls = [u for _, notes in layers for u in notes.values()]
    fetch_many(urls)
    out = []
    for ref, notes in layers:
        raw = {}
        for midi, url in notes.items():
            x, sr = read(url)
            y = resample(trim(x, sr, max_len, floor_db=-62), sr, BASS_RATE)
            raw[midi] = squash(y, BASS_RATE)
        target = float(np.median([rms(y, BASS_RATE) for y in raw.values()]))
        scaled = {m: y * min(4.0, max(0.25, target / rms(y, BASS_RATE))) for m, y in raw.items()}
        top = max(np.max(np.abs(y)) for y in scaled.values())
        k = layer_target(ref, 1.0) / top
        for midi, y in sorted(scaled.items()):
            entry = write(f'basses/{bank_id}/{midi}_{int(ref * 100)}.wav', y * k, BASS_RATE)
            out.append({**entry, 'midi': midi, 'ref': ref})
    return {
        'id': bank_id, 'name': name, 'kind': 'multisample', 'release': release, 'gain': gain, 'brightness': False,
        'credit': credit, 'notes': out,
    }


def build_double():
    """Meatbass pizzicato: a 1958 Otto Rubner double bass, four dynamics. File names are true (sounding) pitch."""
    names = ['eb1', 'gb1', 'a1', 'c2', 'eb2', 'gb2', 'a2', 'c3', 'eb3', 'gb3']          # every third semitone
    layers = [(ref, {note_midi(n): f'{MEATBASS}/{n}_vl{vl}_rr1.wav' for n in names})
              for ref, vl in [(0.25, 1), (0.7, 3), (0.95, 4)]]
    return bass_bank('double', 'Double bass', 'Meatbass double bass, pizzicato, by Karoryfer Samples and D. Smolken (CC0)',
                     layers, 'double', release=0.12, gain=2.2, max_len=2.4)


def build_guitar_lib(bank_id, name, lib, dyn, release, gain):
    """Black And Blue Basses file names are written an octave above the sounding pitch (bass-guitar notation)."""
    written = ['e2', 'g2', 'bb2', 'db3', 'e3', 'g3', 'bb3', 'db4', 'e4', 'g4']        # sounds E1 to G3
    layers = [(ref, {note_midi(n) - 12: f'{BLACKBLUE}/{lib}/reg/{lib}_{n}_{d}_rr1.wav' for n in written}) for ref, d in dyn]
    return bass_bank(bank_id, name, f'Black And Blue Basses ({lib}) by Karoryfer Samples (CC0)', layers, bank_id,
                     release=release, gain=gain, max_len=2.6)


def build_guitar():
    return build_guitar_lib('guitar', 'Bass guitar', 'darkblack', [(0.25, 'p'), (0.7, 'mf'), (0.95, 'f')], release=0.1, gain=2.1)


def build_bright():
    return build_guitar_lib('bright', 'Bass guitar (bright)', 'babyblue', [(0.55, 'f'), (0.95, 'ff')], release=0.08, gain=2.0)


# ---- main -------------------------------------------------------------------------------

if __name__ == '__main__':
    only = set(sys.argv[1:])
    manifest_path = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {'drums': {}, 'keys': {}}
    manifest.setdefault('basses', {})
    if not only or 'jazz' in only:
        print('jazz kit...'); manifest['drums']['jazz'] = build_jazz()
    if not only or 'rock' in only:
        print('rock kit...'); manifest['drums']['rock'] = build_rock()
    if not only or 'piano' in only:
        print('piano...'); manifest['keys']['piano'] = build_piano()
    if not only or 'wurli' in only:
        print('wurlitzer...'); manifest['keys']['wurli'] = build_wurli()
    if not only or 'double' in only:
        print('double bass...'); manifest['basses']['double'] = build_double()
    if not only or 'guitar' in only:
        print('bass guitar...'); manifest['basses']['guitar'] = build_guitar()
    if not only or 'bright' in only:
        print('bright bass guitar...'); manifest['basses']['bright'] = build_bright()
    os.makedirs(OUT, exist_ok=True)
    json.dump(manifest, open(manifest_path, 'w'), indent=1)
    total = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
    print(f'done. {total / 1e6:.1f} MB in {OUT}')
