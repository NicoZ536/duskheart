/**
 * Fire and torches (MASTERPROMPT §12 Licht, §15.4 Brennstoff; M3-22): the campfire's crackle as a
 * positional loop on the ambience bus, lighting and dying fires, the torch struck alight, snuffed out
 * (F toggles the light) and its quiet burn while carried or on a wall.
 *
 * The crackle is layered like the real thing: a soft roar of the flames (low pink noise), frequent small
 * crackles and rare loud pops – loops of 3 s with sparse impulses never sound like a short sample.
 */
import { bandpass, bogen, dauerton, defineSfxGroup, hochpass, knistern, rauschen, schlag, tiefpass } from './define';

export const SFX_FEUER = defineSfxGroup('feuer', [
  {
    // Campfire burning (loop): roar, crackles, pops.
    id: 'sfx_feuer_knistern',
    bus: 'umgebung',
    varianten: 2,
    stimmen: 6,
    sperrzeit: 0,
    reichweite: 14,
    lautstaerke: 0.4,
    schleife: { dauer: 3 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: tiefpass(700, 0.8), pegel: 0.35 },
      { quelle: rauschen('braun'), huelle: dauerton(), filter: bandpass(260, 1.2), pegel: 0.25 },
      { quelle: knistern(22, 0.006), huelle: dauerton(), filter: hochpass(1400), pegel: 1 },
      { quelle: knistern(5, 0.018), huelle: dauerton(), filter: bandpass(2300, 1.1), pegel: 0.8 },
      { quelle: knistern(60, 0.0015), huelle: dauerton(), filter: hochpass(4500), pegel: 0.35 },
    ],
  },
  {
    // A fire catches (campfire lit, §15.4): a breathy whoosh swelling into the first crackles.
    id: 'sfx_feuer_entzuenden',
    bus: 'effekte',
    stimmen: 2,
    sperrzeit: 0.3,
    reichweite: 18,
    lautstaerke: 0.58,
    untertitel: { de: 'Feuer lodert auf', en: 'Fire flares up' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.12, 0.25, 0.5, 0.15, 0.3), filter: bandpass(320, 1, 1500), pegel: 0.9 },
      { quelle: rauschen('braun'), huelle: schlag(0.15, 0.5), filter: tiefpass(500), pegel: 0.5 },
      { quelle: knistern(80, 0.006, 20), huelle: bogen(0.2, 0.2, 0.6, 0.3, 0.3), filter: hochpass(1500), pegel: 0.7, start: 0.12 },
    ],
  },
  {
    // A fire goes out (no fuel, rain): a sinking hiss and the last crackles.
    id: 'sfx_feuer_erloeschen',
    bus: 'effekte',
    stimmen: 2,
    sperrzeit: 0.3,
    reichweite: 16,
    lautstaerke: 0.45,
    untertitel: { de: 'Feuer erlischt', en: 'Fire dies out' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.02, 0.2, 0.5, 0.2, 0.5), filter: hochpass(2800, 0.8, 5200), pegel: 0.7 },
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.5), filter: tiefpass(800, 0.8, 200), pegel: 0.5 },
      { quelle: knistern(12, 0.01, 2), huelle: schlag(0.05, 0.8, 1.5), filter: bandpass(2200, 1.2), pegel: 0.5, start: 0.1 },
    ],
  },
  {
    // Torch struck alight (F, §12): a flint scratch, then the flame taking hold.
    id: 'sfx_fackel_entzuenden',
    bus: 'effekte',
    stimmen: 1,
    sperrzeit: 0.2,
    reichweite: 14,
    lautstaerke: 0.48,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.001, 0.035, 3), filter: hochpass(2600), pegel: 0.8 },
      { quelle: knistern(900, 0.001, 200), huelle: schlag(0.002, 0.06), filter: hochpass(4000), pegel: 0.5 },
      { quelle: rauschen('rosa'), huelle: bogen(0.06, 0.12, 0.5, 0.08, 0.2), filter: bandpass(500, 1, 1300), pegel: 0.8, start: 0.04 },
      { quelle: knistern(50, 0.005), huelle: schlag(0.05, 0.3), filter: hochpass(1600), pegel: 0.5, start: 0.08 },
    ],
  },
  {
    // Torch snuffed (F, rain): a short puff and hiss.
    id: 'sfx_fackel_erloeschen',
    bus: 'effekte',
    stimmen: 1,
    sperrzeit: 0.2,
    reichweite: 12,
    lautstaerke: 0.38,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.18, 2), filter: bandpass(1400, 1, 600), pegel: 0.8 },
      { quelle: rauschen('weiss'), huelle: bogen(0.01, 0.05, 0.4, 0.05, 0.15), filter: hochpass(4000), pegel: 0.35 },
    ],
  },
  {
    // A burning torch (loop, carried or on a wall): a quiet flutter with the odd crackle.
    id: 'sfx_fackel_brennen',
    bus: 'umgebung',
    stimmen: 8,
    sperrzeit: 0,
    reichweite: 8,
    lautstaerke: 0.22,
    schleife: { dauer: 2 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: bandpass(420, 0.9), pegel: 0.6 },
      { quelle: knistern(9, 0.005), huelle: dauerton(), filter: hochpass(1800), pegel: 0.8 },
    ],
  },
]);
