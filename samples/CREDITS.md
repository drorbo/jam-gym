# Sound credits

The recorded instruments in this folder come from four openly licensed libraries. Thank you to their authors.

| Sound in Jam Gym | Source | Author | Licence |
| --- | --- | --- | --- |
| Jazz kit | [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums) | Versilian Studios and Karoryfer Samples (drummer: Austin McMahon) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Rock kit | [MuldjordKit](https://drumgizmo.org/wiki/doku.php?id=kits:muldjordkit) (SFZ port: [sfzinstruments/DrumGizmo.MuldjordKit](https://github.com/sfzinstruments/DrumGizmo.MuldjordKit)) | Lars Muldjord, [drumgizmo.org](https://drumgizmo.org) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Grand piano | [Salamander Grand Piano](https://github.com/Tonejs/audio/tree/master/salamander) (Yamaha C5) | Alexander Holm | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Wurlitzer | Wurlitzer EP200 ([sfzinstruments/GregSullivan.E-Pianos](https://github.com/sfzinstruments/GregSullivan.E-Pianos)) | Greg Sullivan, [sullivang.net](http://www.sullivang.net/) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |

## What was changed

The originals are large multi-microphone and multi-velocity recordings. For this app they were:

- **cut down** to a handful of velocity layers and round-robins per drum, and to every third key or so for the pianos
  (the app pitch-shifts between recorded notes);
- **mixed to mono**. For the Rock kit the close, overhead and ambience microphones were combined, with each close
  microphone time-aligned and polarity-matched to the overheads so they add rather than cancel;
- **trimmed** of leading silence and decayed tails, faded out, level-matched, and (pianos only) resampled to 32 kHz;
- **saved as 16-bit WAV**.

`tools/build_samples.py` reproduces all of this from the original sources.

The synthesised sounds (electronic drums, synth electric piano, organ, guitar and bass) are generated in the browser and
contain no recordings.
