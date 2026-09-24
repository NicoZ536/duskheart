/**
 * Conditions (MASTERPROMPT §11.3; M3-19): the sound a condition makes when it begins (`sound` of each
 * condition in src/content/conditions.ts – the survival stages reuse the body sounds of `spieler.ts`),
 * a condition ending and the retching of food poisoning (`CONDITION_SFX`).
 *
 * Good conditions sound warm and resolved (major intervals, soft sine and triangle), bad ones rough or
 * wavering (detuned pairs, vibrato, noise); bad ones carry subtitles because they call for action.
 */
import { bandpass, bogen, defineSfxGroup, digital, fm, hochpass, knistern, puls, rauschen, schlag, tiefpass, ton } from './define';

/** Onsets of conditions: heard by the player only, once. */
const ONSET = {
  bus: 'effekte',
  stimmen: 1,
  sperrzeit: 0.5,
  reichweite: 10,
} as const;

export const SFX_ZUSTAENDE = defineSfxGroup('zustaende', [
  // --- Bad ---------------------------------------------------------------------------------
  {
    // Bleeding: a wet sting and dripping.
    id: 'sfx_zustand_blutung',
    ...ONSET,
    lautstaerke: 0.45,
    untertitel: { de: 'Blutung', en: 'Bleeding' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.002, 0.06, 2), filter: bandpass(2800, 1.5), pegel: 0.6 },
      { quelle: ton('sinus', 520, 300), huelle: schlag(0.004, 0.07), pegel: 0.6, start: 0.1, wiederholung: { anzahl: 3, abstand: 0.2, abfall: 0.75, tonhoehe: 0.94 } },
    ],
  },
  {
    // Poisoned: a sickly, detuned wobble.
    id: 'sfx_zustand_vergiftung',
    ...ONSET,
    lautstaerke: 0.45,
    untertitel: { de: 'Vergiftet', en: 'Poisoned' },
    schichten: [
      { quelle: ton('saege', 196, 160), huelle: bogen(0.08, 0.2, 0.6, 0.2, 0.3), filter: tiefpass(1000, 2), pegel: 0.6, vibrato: { tiefe: 70, rate: 6 } },
      { quelle: ton('saege', 208, 170), huelle: bogen(0.08, 0.2, 0.6, 0.2, 0.3), filter: tiefpass(900, 2), pegel: 0.5, vibrato: { tiefe: 60, rate: 5 } },
      { quelle: digital(160, 90), huelle: schlag(0.05, 0.5), filter: tiefpass(600), pegel: 0.3 },
    ],
  },
  {
    // Food poisoning: a queasy, sinking gurgle.
    id: 'sfx_zustand_uebelkeit',
    ...ONSET,
    lautstaerke: 0.45,
    untertitel: { de: 'Übelkeit', en: 'Nausea' },
    schichten: [
      { quelle: ton('sinus', 150, 105), huelle: bogen(0.1, 0.2, 0.6, 0.3, 0.3), pegel: 0.7, vibrato: { tiefe: 110, rate: 3.5 } },
      { quelle: digital(80, 55), huelle: bogen(0.05, 0.2, 0.5, 0.3, 0.3), filter: tiefpass(500, 3), pegel: 0.5 },
    ],
  },
  {
    // Fever: a shimmering, beating heat haze.
    id: 'sfx_zustand_fieber',
    ...ONSET,
    lautstaerke: 0.4,
    untertitel: { de: 'Fieber', en: 'Fever' },
    schichten: [
      { quelle: fm(620, 1.007, 1.5, 0.5), huelle: bogen(0.25, 0.3, 0.5, 0.3, 0.5), pegel: 0.6 },
      { quelle: ton('sinus', 626), huelle: bogen(0.25, 0.3, 0.4, 0.3, 0.5), pegel: 0.3 },
      { quelle: rauschen('rosa'), huelle: bogen(0.3, 0.3, 0.4, 0.3, 0.5), filter: hochpass(3000), pegel: 0.2 },
    ],
  },
  {
    // Burning: a flame bursting on the body and sizzling.
    id: 'sfx_zustand_brennen',
    ...ONSET,
    lautstaerke: 0.55,
    untertitel: { de: 'Du brennst!', en: 'You are burning!' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.03, 0.2, 0.5, 0.2, 0.3), filter: bandpass(700, 1, 1400), pegel: 0.8 },
      { quelle: knistern(120, 0.005, 40), huelle: bogen(0.05, 0.2, 0.6, 0.2, 0.3), filter: hochpass(1600), pegel: 0.7 },
      { quelle: rauschen('weiss'), huelle: bogen(0.1, 0.3, 0.3, 0.2, 0.3), filter: hochpass(5000), pegel: 0.25 },
    ],
  },
  {
    // Slowed: a heavy, sagging glide.
    id: 'sfx_zustand_verlangsamt',
    ...ONSET,
    lautstaerke: 0.38,
    untertitel: { de: 'Verlangsamt', en: 'Slowed' },
    schichten: [
      { quelle: ton('dreieck', 520, 240), huelle: schlag(0.01, 0.45, 1.5), filter: tiefpass(1500), gleiten: 'linear', pegel: 0.7 },
      { quelle: rauschen('braun'), huelle: schlag(0.02, 0.35), filter: tiefpass(500), pegel: 0.4 },
    ],
  },
  {
    // Stunned: a ringing in the ears after a knock.
    id: 'sfx_zustand_betaeubt',
    ...ONSET,
    lautstaerke: 0.45,
    untertitel: { de: 'Benommen', en: 'Stunned' },
    schichten: [
      { quelle: ton('sinus', 90, 50), huelle: schlag(0.002, 0.15), pegel: 0.7 },
      { quelle: ton('sinus', 2400), huelle: schlag(0.01, 1.2, 1.5), pegel: 0.35 },
      { quelle: ton('sinus', 2460), huelle: schlag(0.01, 1.2, 1.5), pegel: 0.3 },
    ],
  },
  {
    // Blinded: a searing white flash of sound.
    id: 'sfx_zustand_geblendet',
    ...ONSET,
    lautstaerke: 0.48,
    untertitel: { de: 'Geblendet', en: 'Blinded' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.004, 0.5, 2), filter: hochpass(3500, 0.7, 1500), pegel: 0.7 },
      { quelle: ton('sinus', 3100, 2900), huelle: schlag(0.004, 0.7, 2), pegel: 0.3 },
    ],
  },
  {
    // Tipsy: a hiccup.
    id: 'sfx_zustand_beschwipst',
    ...ONSET,
    lautstaerke: 0.4,
    untertitel: { de: 'Hicks!', en: 'Hic!' },
    schichten: [
      { quelle: ton('sinus', 360, 720), huelle: schlag(0.004, 0.06), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.04), filter: bandpass(1300, 2), pegel: 0.5 },
    ],
  },
  {
    // Shaken after death (§11.6 Erschüttert): a dull double pulse, still echoing.
    id: 'sfx_zustand_erschuettert',
    ...ONSET,
    lautstaerke: 0.45,
    schichten: [
      { quelle: ton('sinus', 64, 44), huelle: schlag(0.005, 0.18), pegel: 0.9, wiederholung: { anzahl: 2, abstand: 0.28, abfall: 0.6 } },
      { quelle: rauschen('braun'), huelle: bogen(0.1, 0.3, 0.3, 0.2, 0.4), filter: tiefpass(300), pegel: 0.4 },
    ],
  },
  {
    // Retching (food poisoning pulse): a heave and a splatter.
    id: 'sfx_zustand_erbrechen',
    ...ONSET,
    lautstaerke: 0.5,
    untertitel: { de: 'Würgen', en: 'Retching' },
    schichten: [
      { quelle: ton('saege', 120, 90), huelle: bogen(0.06, 0.15, 0.6, 0.2, 0.2), filter: bandpass(500, 3), pegel: 0.7, vibrato: { tiefe: 80, rate: 9 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.1, 0.5, 0.25, 0.2), filter: bandpass(900, 1.5), pegel: 0.5 },
      { quelle: knistern(200, 0.006, 40), huelle: schlag(0.02, 0.3), filter: bandpass(1400, 1.5), pegel: 0.5, start: 0.45 },
    ],
  },
  // --- Good --------------------------------------------------------------------------------
  {
    // Well fed: a contented, warm third.
    id: 'sfx_zustand_wohlig',
    ...ONSET,
    lautstaerke: 0.32,
    schichten: [
      { quelle: ton('sinus', 330), huelle: bogen(0.05, 0.3, 0.5, 0.1, 0.4), pegel: 0.6 },
      { quelle: ton('sinus', 415), huelle: bogen(0.08, 0.3, 0.4, 0.1, 0.4), pegel: 0.45, start: 0.08 },
    ],
  },
  {
    // Rested: a soft rising chime.
    id: 'sfx_zustand_ausgeruht',
    ...ONSET,
    lautstaerke: 0.34,
    schichten: [{ quelle: ton('sinus', 523), huelle: schlag(0.01, 0.4, 2), pegel: 0.7, wiederholung: { anzahl: 3, abstand: 0.1, abfall: 0.9, tonhoehe: 1.26 } }],
  },
  {
    // Cosy: a warm hum of a small chord.
    id: 'sfx_zustand_behaglich',
    ...ONSET,
    lautstaerke: 0.32,
    schichten: [
      { quelle: ton('dreieck', 262), huelle: bogen(0.15, 0.3, 0.6, 0.2, 0.5), filter: tiefpass(1200), pegel: 0.6 },
      { quelle: ton('dreieck', 330), huelle: bogen(0.2, 0.3, 0.5, 0.2, 0.5), filter: tiefpass(1300), pegel: 0.45, start: 0.05 },
      { quelle: ton('dreieck', 392), huelle: bogen(0.25, 0.3, 0.4, 0.2, 0.5), filter: tiefpass(1400), pegel: 0.35, start: 0.1 },
    ],
  },
  {
    // Enlightened: rising sparkles of light.
    id: 'sfx_zustand_erleuchtet',
    ...ONSET,
    lautstaerke: 0.36,
    schichten: [
      { quelle: fm(1760, 2, 1, 0.1), huelle: schlag(0.003, 0.25, 2), pegel: 0.6, wiederholung: { anzahl: 4, abstand: 0.07, abfall: 0.9, tonhoehe: 1.122 } },
      { quelle: knistern(80, 0.004, 20), huelle: schlag(0.05, 0.5), filter: hochpass(5000), pegel: 0.3 },
    ],
  },
  {
    // Dawn's blessing (Morgenrot): a slow swell of an open fifth with a glow on top.
    id: 'sfx_zustand_morgenrot',
    ...ONSET,
    lautstaerke: 0.38,
    schichten: [
      { quelle: ton('sinus', 392), huelle: bogen(0.4, 0.3, 0.6, 0.2, 0.6), pegel: 0.6 },
      { quelle: ton('sinus', 587), huelle: bogen(0.5, 0.3, 0.5, 0.2, 0.6), pegel: 0.45, start: 0.1 },
      { quelle: fm(1175, 2, 0.8, 0), huelle: bogen(0.6, 0.3, 0.3, 0.2, 0.6), pegel: 0.2, start: 0.2 },
    ],
  },
  {
    // Night vision: a low, mysterious glide opening up.
    id: 'sfx_zustand_nachtsicht',
    ...ONSET,
    lautstaerke: 0.36,
    schichten: [
      { quelle: ton('sinus', 220, 330), huelle: bogen(0.2, 0.3, 0.5, 0.2, 0.5), pegel: 0.6, vibrato: { tiefe: 15, rate: 4 } },
      { quelle: fm(880, 3, 0.6, 0), huelle: bogen(0.3, 0.3, 0.3, 0.2, 0.5), pegel: 0.25, start: 0.15 },
    ],
  },
  {
    // A condition ends: a small release.
    id: 'sfx_zustand_ende',
    bus: 'ui',
    stimmen: 2,
    sperrzeit: 0.2,
    lautstaerke: 0.2,
    schichten: [{ quelle: puls(660, 0.25, 880), huelle: schlag(0.004, 0.14, 2), filter: tiefpass(3000), pegel: 1 }],
  },
]);
