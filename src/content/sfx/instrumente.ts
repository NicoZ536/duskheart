/**
 * The net and the firefly jar (M7-31; docs/SPIEL.md §24 "Netz", "Glühwürmchenglas"): the swing of the net, the little catch
 * in its mesh, crickets and fireflies in the bags, the jar's glass, its lid opening and closing and the faint glimmer it
 * makes while it glows (the jar's loop, the light system's furniture lamp).
 */
import { bandpass, bogen, dauerton, defineSfxGroup, fm, hochpass, knistern, rauschen, schlag, tabelle, tiefpass, ton } from './define';

export const SFX_INSTRUMENTE = defineSfxGroup('instrumente', [
  {
    // Handling the net: twigs creak, the mesh rustles.
    id: 'sfx_netz_aufheben',
    bus: 'ui',
    varianten: 2,
    streuung: { tonhoehe: 80, lautstaerke: 1, klang: 0.06 },
    stimmen: 2,
    sperrzeit: 0.08,
    lautstaerke: 0.32,
    schichten: [
      { quelle: knistern(260, 0.003), huelle: schlag(0.01, 0.16), filter: bandpass(2600, 1.2), pegel: 0.6 },
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.18), filter: bandpass(1600, 1), pegel: 0.4 },
    ],
  },
  {
    // A swing of the net: a soft whoosh through the air, the mesh billowing.
    id: 'sfx_netz_schwung',
    bus: 'effekte',
    varianten: 3,
    streuung: { tonhoehe: 120, lautstaerke: 1.5, klang: 0.08 },
    stimmen: 2,
    sperrzeit: 0.1,
    reichweite: 14,
    lautstaerke: 0.36,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.06, 0.12, 0.4, 0.04, 0.12), filter: bandpass(700, 1.2, 1600), pegel: 0.8 },
      { quelle: knistern(180, 0.003), huelle: bogen(0.05, 0.1, 0.4, 0.05, 0.1), filter: bandpass(2800, 1.3), pegel: 0.35 },
    ],
  },
  {
    // Something caught in the mesh: a flutter against the net, a bright little chime.
    id: 'sfx_netz_fang',
    bus: 'effekte',
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
    stimmen: 2,
    sperrzeit: 0.1,
    reichweite: 14,
    lautstaerke: 0.34,
    untertitel: { de: 'Gefangen', en: 'Caught' },
    schichten: [
      { quelle: knistern(500, 0.002, 120), huelle: schlag(0.01, 0.25), filter: bandpass(3500, 1.6), pegel: 0.5 },
      { quelle: fm(1568, 2, 1.2), huelle: schlag(0.003, 0.4, 2), pegel: 0.45, start: 0.06 },
      { quelle: fm(2093, 2, 1), huelle: schlag(0.003, 0.35, 2), pegel: 0.35, start: 0.12 },
    ],
  },
  {
    // A cricket or a firefly into the bags: a tiny chirp and the rustle of a leaf.
    id: 'sfx_item_insekt',
    bus: 'ui',
    varianten: 2,
    streuung: { tonhoehe: 100, lautstaerke: 1, klang: 0.06 },
    stimmen: 2,
    sperrzeit: 0.06,
    lautstaerke: 0.26,
    schichten: [
      { quelle: fm(4200, 0.5, 0.6), huelle: bogen(0.003, 0.01, 0.7, 0.02, 0.01), pegel: 0.5, wiederholung: { anzahl: 3, abstand: 0.045, abfall: 0.9 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.1), filter: bandpass(2200, 1.2), pegel: 0.4 },
    ],
  },
  {
    // The firefly jar handled: glass rings, the twig lid knocks.
    id: 'sfx_glas_aufheben',
    bus: 'ui',
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.04 },
    stimmen: 2,
    sperrzeit: 0.08,
    lautstaerke: 0.32,
    schichten: [
      { quelle: tabelle('glas', 1760), huelle: schlag(0.001, 0.35, 2), pegel: 0.55 },
      { quelle: tabelle('glas', 2350), huelle: schlag(0.001, 0.25, 2), pegel: 0.35, start: 0.01 },
      { quelle: rauschen('braun'), huelle: schlag(0.002, 0.05), filter: tiefpass(700), pegel: 0.4 },
    ],
  },
  {
    // The jar opened (the lamp lit): the twig lid lifts, a soft rising shimmer as the fireflies wake.
    id: 'sfx_glas_oeffnen',
    bus: 'effekte',
    stimmen: 2,
    sperrzeit: 0.2,
    reichweite: 12,
    lautstaerke: 0.32,
    schichten: [
      { quelle: knistern(200, 0.003), huelle: schlag(0.01, 0.12), filter: bandpass(2200, 1.3), pegel: 0.5 },
      { quelle: tabelle('glas', 1320, 1760), huelle: bogen(0.15, 0.2, 0.4, 0.2, 0.4), pegel: 0.4, start: 0.08, vibrato: { tiefe: 20, rate: 7 } },
      { quelle: fm(2640, 2, 0.8), huelle: bogen(0.2, 0.2, 0.3, 0.1, 0.4), pegel: 0.2, start: 0.15 },
    ],
  },
  {
    // The jar closed (the light out): the lid set down, the shimmer fading.
    id: 'sfx_glas_schliessen',
    bus: 'effekte',
    stimmen: 2,
    sperrzeit: 0.2,
    reichweite: 12,
    lautstaerke: 0.3,
    schichten: [
      { quelle: tabelle('glas', 1760, 1320), huelle: bogen(0.02, 0.2, 0.3, 0.1, 0.35), pegel: 0.4, vibrato: { tiefe: 20, rate: 7 } },
      { quelle: rauschen('braun'), huelle: schlag(0.002, 0.06), filter: tiefpass(800), pegel: 0.5, start: 0.12 },
      { quelle: knistern(160, 0.003), huelle: schlag(0.005, 0.08), filter: bandpass(2000, 1.3), pegel: 0.35, start: 0.12 },
    ],
  },
  {
    // The jar glowing (loop): the faintest hum of wings and a glassy shimmer coming and going.
    id: 'sfx_glas_glimmen',
    bus: 'umgebung',
    varianten: 2,
    stimmen: 4,
    sperrzeit: 0,
    reichweite: 6,
    lautstaerke: 0.12,
    schleife: { dauer: 4 },
    schichten: [
      { quelle: ton('saege', 185), huelle: dauerton(), filter: bandpass(1100, 3), pegel: 0.25, vibrato: { tiefe: 30, rate: 31 } },
      { quelle: tabelle('glas', 2640), huelle: bogen(0.6, 0.4, 0.3, 0.3, 0.8), pegel: 0.35, start: 0.4 },
      { quelle: tabelle('glas', 3520), huelle: bogen(0.5, 0.3, 0.3, 0.3, 0.7), pegel: 0.25, start: 2.2 },
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: hochpass(5000), pegel: 0.05 },
    ],
  },
]);
