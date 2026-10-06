/**
 * The instruments in the bags (M7-31; docs/SPIEL.md §29 "`sfx_musik_*` (Instrumente)"): picking up and stowing the flute and
 * the lute sounds like the instruments themselves – a breath through the flute, a brush over the lute's strings – in the
 * sampled timbres of the music (the wavetables `floete` and `laute`, src/content/music/wavetables.ts). Their songs are
 * music (src/content/music/lieder.ts).
 */
import { bogen, defineSfxGroup, knistern, rauschen, schlag, tabelle, tiefpass, bandpass } from './define';

export const SFX_MUSIK = defineSfxGroup('musik', [
  {
    // The flute: a soft breath catches a short note, a wooden tap of the body.
    id: 'sfx_musik_floete_aufheben',
    bus: 'ui',
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.04 },
    stimmen: 2,
    sperrzeit: 0.08,
    lautstaerke: 0.4,
    schichten: [
      { quelle: tabelle('floete', 784, 790), huelle: bogen(0.03, 0.08, 0.5, 0.08, 0.1), pegel: 0.7, vibrato: { tiefe: 12, rate: 6 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.02, 0.06, 0.3, 0.06, 0.06), filter: bandpass(2400, 1.5), pegel: 0.25 },
      { quelle: rauschen('braun'), huelle: schlag(0.002, 0.05), filter: tiefpass(900), pegel: 0.5, start: 0.22 },
    ],
  },
  {
    // The lute: fingers brush down four strings (a quick strum), the body knocks softly.
    id: 'sfx_musik_laute_aufheben',
    bus: 'ui',
    varianten: 2,
    streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.04 },
    stimmen: 2,
    sperrzeit: 0.08,
    lautstaerke: 0.42,
    schichten: [
      { quelle: tabelle('laute', 196), huelle: schlag(0.002, 0.7, 2), filter: tiefpass(3000), pegel: 0.6 },
      { quelle: tabelle('laute', 294), huelle: schlag(0.002, 0.6, 2), filter: tiefpass(3000), pegel: 0.5, start: 0.025 },
      { quelle: tabelle('laute', 392), huelle: schlag(0.002, 0.5, 2), filter: tiefpass(3200), pegel: 0.45, start: 0.05 },
      { quelle: tabelle('laute', 494), huelle: schlag(0.002, 0.45, 2), filter: tiefpass(3400), pegel: 0.4, start: 0.075 },
      { quelle: knistern(400, 0.002), huelle: schlag(0.002, 0.08), filter: bandpass(3000, 1.5), pegel: 0.25 },
      { quelle: rauschen('braun'), huelle: schlag(0.003, 0.08), filter: tiefpass(500), pegel: 0.5, start: 0.12 },
    ],
  },
]);
