/**
 * Storage (MASTERPROMPT §16.7, §2.7; M4-29): chests opening and closing per kind (`STORAGE_AUDIO`,
 * src/audio/baseSounds.ts) and the hands in them.
 *
 * - `sfx_kiste_*` (wooden crate), `sfx_truhe_*` (the chest with bronze fittings), `sfx_regal_*` (the open storage
 *   shelf – no lid: boards creaking as it is rummaged, settling again): positioned at the chest, bus `effekte`.
 * - Putting in, "Alles einlagern", sorting, naming and labelling, the quick stash into the chests around: the chest
 *   screen's sounds, bus `ui` like the bags (src/content/sfx/gegenstaende.ts), but hollow and wooden – a hand in a
 *   box, not in a bag. Taking out sounds like the item arriving in the bags (its handling sound).
 */
import { bandpass, bogen, defineSfxGroup, fm, rauschen, schlag, tiefpass, ton } from './define';

/** Lids and shelves: at the chest. */
const DECKEL = {
  bus: 'effekte',
  varianten: 2,
  streuung: { tonhoehe: 70, lautstaerke: 1, klang: 0.06 },
  stimmen: 2,
  sperrzeit: 0.1,
  reichweite: 12,
} as const;

/** Hands in the chest: the chest screen. */
const INHALT = {
  bus: 'ui',
  varianten: 2,
  streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
  stimmen: 2,
  sperrzeit: 0.05,
} as const;

export const SFX_LAGERUNG = defineSfxGroup('lagerung', [
  // --- Lids -------------------------------------------------------------------------------------
  {
    // Wooden crate opens: the hasp, a short hinge creak, the lid falling back.
    id: 'sfx_kiste_oeffnen',
    ...DECKEL,
    lautstaerke: 0.4,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: bandpass(2600, 1.4), pegel: 0.5 },
      { quelle: ton('saege', 300, 420), huelle: bogen(0.03, 0.06, 0.6, 0.08, 0.06), filter: bandpass(1400, 5), vibrato: { tiefe: 20, rate: 20 }, pegel: 1, start: 0.03 },
      { quelle: ton('sinus', 160, 110), huelle: schlag(0.002, 0.08, 3), pegel: 0.45, start: 0.25 },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.04, 3), filter: bandpass(900, 1.3), pegel: 0.3, start: 0.25 },
    ],
  },
  {
    // Wooden crate closes: the lid drops with a hollow thud.
    id: 'sfx_kiste_schliessen',
    ...DECKEL,
    lautstaerke: 0.42,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.04, 0.05, 1.5), filter: bandpass(700, 1), pegel: 0.35 },
      { quelle: ton('sinus', 130, 90), huelle: schlag(0.002, 0.12, 3), pegel: 0.9, start: 0.07 },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.06, 3), filter: bandpass(450, 3), pegel: 0.5, start: 0.07 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: bandpass(1600, 1.3), pegel: 0.4, start: 0.08 },
    ],
  },
  {
    // Chest opens: a bronze latch clicks, a deeper creak, the heavy lid laid back.
    id: 'sfx_truhe_oeffnen',
    ...DECKEL,
    lautstaerke: 0.44,
    schichten: [
      { quelle: fm(1600, 2.4, 1.5, 0.1), huelle: schlag(0.0008, 0.1, 3), pegel: 0.45 },
      { quelle: ton('saege', 200, 300), huelle: bogen(0.05, 0.1, 0.6, 0.12, 0.08), filter: bandpass(1000, 5), vibrato: { tiefe: 20, rate: 15 }, pegel: 1, start: 0.06 },
      { quelle: ton('sinus', 120, 85), huelle: schlag(0.002, 0.12, 3), pegel: 0.55, start: 0.35 },
      { quelle: fm(900, 2.7, 1, 0.1), huelle: schlag(0.0008, 0.12, 3), pegel: 0.2, start: 0.35 },
    ],
  },
  {
    // Chest closes: a heavy lid, the fittings ringing, the latch.
    id: 'sfx_truhe_schliessen',
    ...DECKEL,
    lautstaerke: 0.48,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.05, 0.05, 1.5), filter: bandpass(600, 1), pegel: 0.35 },
      { quelle: ton('sinus', 110, 75), huelle: schlag(0.002, 0.14, 3), pegel: 1, start: 0.09 },
      { quelle: fm(1100, 2.7, 1.5, 0.2), huelle: schlag(0.0008, 0.2, 3), pegel: 0.35, start: 0.09 },
      { quelle: fm(1600, 2.4, 1.2, 0.1), huelle: schlag(0.0008, 0.08, 3), pegel: 0.35, start: 0.2 },
    ],
  },
  {
    // Storage shelf: boards creaking under the hand, stacks shifted.
    id: 'sfx_regal_oeffnen',
    ...DECKEL,
    lautstaerke: 0.36,
    schichten: [
      { quelle: ton('saege', 180, 200), huelle: bogen(0.03, 0.06, 0.4, 0.08, 0.06), filter: bandpass(900, 4), vibrato: { tiefe: 15, rate: 12 }, pegel: 0.4 },
      { quelle: rauschen('rosa'), huelle: schlag(0.005, 0.05, 2), filter: bandpass(1800, 1.3), pegel: 0.6, start: 0.1, wiederholung: { anzahl: 3, abstand: 0.07, abfall: 0.8, tonhoehe: 1.08 } },
      { quelle: ton('sinus', 210, 170), huelle: schlag(0.001, 0.05, 3), pegel: 0.4, start: 0.12, wiederholung: { anzahl: 2, abstand: 0.1, abfall: 0.8 } },
    ],
  },
  {
    // Storage shelf left: the boards settling with a knock.
    id: 'sfx_regal_schliessen',
    ...DECKEL,
    lautstaerke: 0.34,
    schichten: [
      { quelle: ton('sinus', 190, 140), huelle: schlag(0.002, 0.08, 3), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.04, 3), filter: bandpass(1100, 1.3), pegel: 0.5 },
      { quelle: ton('saege', 160, 150), huelle: bogen(0.02, 0.04, 0.3, 0.05, 0.05), filter: bandpass(800, 4), pegel: 0.2, start: 0.06 },
    ],
  },
  // --- Hands in the chest -----------------------------------------------------------------------
  {
    // A stack laid into the chest: a hollow wooden tup.
    id: 'sfx_kiste_einlagern',
    ...INHALT,
    lautstaerke: 0.28,
    schichten: [
      { quelle: ton('sinus', 240, 180), huelle: schlag(0.001, 0.06, 3), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.05, 2.5), filter: bandpass(420, 3), pegel: 0.6 },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.02, 3), filter: bandpass(1400, 1.3), pegel: 0.35 },
    ],
  },
  {
    // "Alles einlagern": a flurry of stacks thunking into the box.
    id: 'sfx_kiste_alles',
    ...INHALT,
    sperrzeit: 0.3,
    lautstaerke: 0.32,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.005, 0.05, 2), filter: bandpass(1400, 1.2), pegel: 0.6, wiederholung: { anzahl: 5, abstand: 0.06, abfall: 0.9, tonhoehe: 1.04 } },
      { quelle: ton('sinus', 220, 170), huelle: schlag(0.001, 0.05, 3), pegel: 0.7, start: 0.02, wiederholung: { anzahl: 4, abstand: 0.08, abfall: 0.85, tonhoehe: 0.95 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.003, 0.08, 2), filter: bandpass(420, 3), pegel: 0.4, start: 0.02, wiederholung: { anzahl: 4, abstand: 0.08, abfall: 0.85 } },
    ],
  },
  {
    // Sorting the chest: stacks shuffled about, a settling knock.
    id: 'sfx_kiste_sortieren',
    ...INHALT,
    sperrzeit: 0.2,
    lautstaerke: 0.3,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.004, 0.035, 2), filter: bandpass(2000, 1.4), pegel: 0.7, wiederholung: { anzahl: 6, abstand: 0.05, abfall: 0.9, tonhoehe: 1.03 } },
      { quelle: ton('sinus', 200, 150), huelle: schlag(0.001, 0.07, 3), pegel: 0.6, start: 0.34 },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.06, 2.5), filter: bandpass(420, 3), pegel: 0.4, start: 0.34 },
    ],
  },
  {
    // Naming or labelling the chest: a scratch of chalk on wood.
    id: 'sfx_kiste_beschriften',
    ...INHALT,
    sperrzeit: 0.15,
    lautstaerke: 0.24,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.005, 0.04, 2), filter: bandpass(3800, 2), pegel: 0.7, wiederholung: { anzahl: 4, abstand: 0.07, abfall: 0.9, tonhoehe: 1.1 } },
      { quelle: ton('sinus', 900, 850), huelle: schlag(0.001, 0.03, 3), pegel: 0.3, start: 0.28 },
    ],
  },
  {
    // Quick stash (§16.7): a sweep of the arms, stacks thunking into several boxes around.
    id: 'sfx_kiste_schnellablage',
    ...INHALT,
    sperrzeit: 0.3,
    lautstaerke: 0.34,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.03, 0.15, 1.5), filter: bandpass(700, 1, 2000), pegel: 0.6 },
      { quelle: ton('sinus', 230, 170), huelle: schlag(0.001, 0.06, 3), pegel: 0.7, start: 0.12, wiederholung: { anzahl: 3, abstand: 0.09, abfall: 0.85, tonhoehe: 0.9 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.06, 2.5), filter: bandpass(420, 3), pegel: 0.45, start: 0.12, wiederholung: { anzahl: 3, abstand: 0.09, abfall: 0.85, tonhoehe: 0.9 } },
      { quelle: ton('dreieck', 784), huelle: schlag(0.004, 0.2, 2.5), filter: tiefpass(3000), pegel: 0.2, start: 0.4 },
    ],
  },
]);
