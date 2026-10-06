/**
 * Places (MASTERPROMPT §21, §2.7; docs/SPIEL.md §18; M7-07 … M7-09, strand B): what discovering and using a place sounds
 * like (`PLACE_SFX`, src/game/places/events.ts) and the blessing of a shrine (`sound` of the condition `gesegnet`).
 *
 * - Discovery: a rising open fifth on soft bells – heard by the player, quieter than a notification; the music's discovery
 *   stinger (M7-73) lies on top once the place types name one.
 * - The old chests of the places: a long, rusted hinge, dust trickling, the lid falling back (deeper and drier than the
 *   bronze-fitted chest of the base, `sfx_truhe_oeffnen`).
 * - The tower: wind over the platform, two boards creaking. The note: paper unfolding. The dig site's cache: the blade
 *   knocks on a hollow box. A cleansed place: a calm low chord settling. The blessing: a warm major chord with a shimmer.
 */
import { bandpass, bogen, defineSfxGroup, fm, hochpass, knistern, rauschen, schlag, tiefpass, ton } from './define';

/** Sounds at the player (discovery, reading, blessing). */
const SPIELER = {
  bus: 'effekte',
  stimmen: 1,
  sperrzeit: 0.5,
  reichweite: 10,
} as const;

/** Sounds at a mark of the place (chest, cache, tower). */
const ORT = {
  bus: 'effekte',
  varianten: 2,
  streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.06 },
  stimmen: 2,
  sperrzeit: 0.2,
  reichweite: 14,
} as const;

export const SFX_ORTE = defineSfxGroup('orte', [
  {
    // A place discovered: two soft bells rising a fifth, a breath of air under them.
    id: 'sfx_ort_entdeckt',
    ...SPIELER,
    lautstaerke: 0.32,
    untertitel: { de: 'Ort entdeckt', en: 'Place discovered' },
    schichten: [
      { quelle: fm(659, 2, 0.8, 0.1), huelle: schlag(0.003, 0.9, 2.5), pegel: 0.6 },
      { quelle: fm(988, 2, 0.8, 0.1), huelle: schlag(0.003, 1.1, 2.5), pegel: 0.55, start: 0.18 },
      { quelle: rauschen('rosa'), huelle: bogen(0.3, 0.2, 0.4, 0.4, 0.6), filter: bandpass(1800, 0.8), pegel: 0.12 },
    ],
  },
  {
    // An old chest of a place opens: rusted hinge, dust, the lid falling back.
    id: 'sfx_ort_truhe_auf',
    ...ORT,
    lautstaerke: 0.46,
    untertitel: { de: 'Truhe geöffnet', en: 'Chest opened' },
    schichten: [
      { quelle: fm(1400, 2.4, 1.2, 0.1), huelle: schlag(0.0008, 0.08, 3), pegel: 0.4 },
      { quelle: ton('saege', 160, 260), huelle: bogen(0.06, 0.1, 0.7, 0.3, 0.1), filter: bandpass(900, 6), vibrato: { tiefe: 30, rate: 11 }, pegel: 0.9, start: 0.05 },
      { quelle: knistern(300, 0.004, 60), huelle: schlag(0.02, 0.5, 1.5), filter: hochpass(2500), pegel: 0.25, start: 0.2 },
      { quelle: ton('sinus', 100, 70), huelle: schlag(0.002, 0.16, 3), pegel: 0.6, start: 0.5 },
    ],
  },
  {
    // The look-out tower: wind sweeping over the platform, boards creaking.
    id: 'sfx_ort_aussicht',
    ...SPIELER,
    lautstaerke: 0.4,
    untertitel: { de: 'Wind auf dem Turm', en: 'Wind on the tower' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.4, 0.3, 0.7, 0.8, 0.9), filter: bandpass(700, 1.2, 1300), pegel: 0.7 },
      { quelle: ton('saege', 140, 190), huelle: bogen(0.05, 0.1, 0.5, 0.15, 0.1), filter: bandpass(800, 6), vibrato: { tiefe: 20, rate: 9 }, pegel: 0.35, start: 0.3 },
      { quelle: ton('saege', 120, 150), huelle: bogen(0.05, 0.1, 0.5, 0.12, 0.1), filter: bandpass(700, 6), vibrato: { tiefe: 20, rate: 8 }, pegel: 0.3, start: 0.9 },
    ],
  },
  {
    // A note unfolded: dry paper rustling.
    id: 'sfx_ort_notiz',
    ...SPIELER,
    sperrzeit: 0.3,
    lautstaerke: 0.34,
    schichten: [
      { quelle: knistern(500, 0.003, 150), huelle: schlag(0.01, 0.35, 1.5), filter: bandpass(3200, 0.8), pegel: 0.7 },
      { quelle: rauschen('weiss'), huelle: bogen(0.03, 0.05, 0.4, 0.1, 0.12), filter: bandpass(4500, 1), pegel: 0.25, start: 0.12 },
    ],
  },
  {
    // The shovel finds the cache: a hollow knock on wood, earth trickling off.
    id: 'sfx_ort_fund',
    ...ORT,
    lautstaerke: 0.5,
    untertitel: { de: 'Etwas Hartes in der Erde', en: 'Something hard in the earth' },
    schichten: [
      { quelle: ton('sinus', 180, 120), huelle: schlag(0.002, 0.18, 3), pegel: 0.9 },
      { quelle: fm(420, 1.5, 2, 0.2), huelle: schlag(0.001, 0.12, 3), filter: tiefpass(1500), pegel: 0.5 },
      { quelle: knistern(250, 0.004, 40), huelle: schlag(0.02, 0.4, 1.5), filter: bandpass(1200, 0.7), pegel: 0.3, start: 0.1 },
    ],
  },
  {
    // A place cleansed: a low, calm chord settling.
    id: 'sfx_ort_gesaeubert',
    ...SPIELER,
    lautstaerke: 0.3,
    untertitel: { de: 'Der Ort ist frei', en: 'The place is clear' },
    schichten: [
      { quelle: ton('dreieck', 196), huelle: bogen(0.15, 0.2, 0.6, 0.6, 0.9), filter: tiefpass(1200), pegel: 0.6 },
      { quelle: ton('dreieck', 247), huelle: bogen(0.2, 0.2, 0.6, 0.6, 0.9), filter: tiefpass(1200), pegel: 0.45, start: 0.08 },
      { quelle: ton('sinus', 294), huelle: bogen(0.25, 0.2, 0.6, 0.6, 1), pegel: 0.4, start: 0.16 },
    ],
  },
  {
    // Blessed (shrine, §21 "zeitweiliger Segen"): a warm major chord and a high shimmer.
    id: 'sfx_zustand_gesegnet',
    ...SPIELER,
    lautstaerke: 0.4,
    untertitel: { de: 'Gesegnet', en: 'Blessed' },
    schichten: [
      { quelle: ton('sinus', 262), huelle: bogen(0.1, 0.2, 0.7, 0.5, 0.8), pegel: 0.5 },
      { quelle: ton('sinus', 330), huelle: bogen(0.12, 0.2, 0.7, 0.5, 0.8), pegel: 0.45, start: 0.06 },
      { quelle: ton('sinus', 392), huelle: bogen(0.14, 0.2, 0.7, 0.5, 0.8), pegel: 0.45, start: 0.12 },
      { quelle: fm(1568, 2, 0.6, 0.1), huelle: schlag(0.01, 1.2, 2), pegel: 0.2, start: 0.2, vibrato: { tiefe: 15, rate: 6 } },
    ],
  },
]);
