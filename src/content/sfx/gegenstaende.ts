/**
 * Items, drops, bags and equipment (MASTERPROMPT §2.7, §13, §14 "fliegende Drops mit Magnet"):
 *
 * - `sfx_item_<material>`: handling sound of an item (`sounds.aufheben` of the item content,
 *   `ITEM_SFX` in src/content/items/define.ts) – picked up, moved, dropped.
 * - `sfx_drop_*`: a stack pops out of a harvested object, lands, is pulled in by the magnet
 *   (`DROP_SFX`, src/game/drops/events.ts).
 * - `sfx_inventar_*`, `sfx_ausruestung_*`: bag and equipment actions (`INVENTORY_FEEDBACK_SFX`,
 *   `EQUIPMENT_FEEDBACK_SFX`); they sit on the UI bus – the inventory screen is UI.
 *
 * Handling sounds are small and dry (they repeat constantly); only a full bag and a broken tool are
 * meant to be noticed and carry subtitles.
 */
import { bandpass, defineSfxGroup, fm, hochpass, knistern, puls, rauschen, schlag, tiefpass, ton } from './define';

/** Shared variation of item handling. */
const ITEM = {
  bus: 'effekte',
  varianten: 3,
  streuung: { tonhoehe: 100, lautstaerke: 2, klang: 0.08 },
  stimmen: 3,
  sperrzeit: 0.05,
  reichweite: 12,
} as const;

/** Shared settings of bag clicks. */
const BAG = {
  bus: 'ui',
  varianten: 2,
  streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.04 },
  stimmen: 2,
  sperrzeit: 0.04,
} as const;

export const SFX_GEGENSTAENDE = defineSfxGroup('gegenstaende', [
  // --- Handling per material -------------------------------------------------------------
  {
    // Sticks and logs knocking together.
    id: 'sfx_item_holz',
    ...ITEM,
    lautstaerke: 0.4,
    schichten: [
      { quelle: ton('sinus', 320, 250), huelle: schlag(0.001, 0.06, 3), pegel: 0.8 },
      { quelle: ton('dreieck', 640, 560), huelle: schlag(0.001, 0.035, 3), pegel: 0.3 },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.025, 3), filter: bandpass(1500, 2), pegel: 0.6 },
      { quelle: ton('sinus', 290, 240), huelle: schlag(0.001, 0.045, 3), pegel: 0.4, start: 0.055 },
    ],
  },
  {
    // Two stones clacking.
    id: 'sfx_item_stein',
    ...ITEM,
    lautstaerke: 0.4,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: bandpass(3400, 1.2), pegel: 0.8, wiederholung: { anzahl: 2, abstand: 0.06, abfall: 0.55, tonhoehe: 0.92 } },
      { quelle: ton('sinus', 760, 520), huelle: schlag(0.0005, 0.03, 3), pegel: 0.35, wiederholung: { anzahl: 2, abstand: 0.06, abfall: 0.55, tonhoehe: 0.92 } },
    ],
  },
  {
    // A handful of soil: soft thump and crumble.
    id: 'sfx_item_erde',
    ...ITEM,
    lautstaerke: 0.36,
    schichten: [
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.08), filter: tiefpass(900), pegel: 0.9 },
      { quelle: ton('sinus', 130, 80), huelle: schlag(0.002, 0.05), pegel: 0.5 },
      { quelle: knistern(160, 0.003), huelle: schlag(0.005, 0.08), filter: bandpass(2000, 1.2), pegel: 0.35, start: 0.01 },
    ],
  },
  {
    // Heavy ore chunk: a dull metallic clunk.
    id: 'sfx_item_erz',
    ...ITEM,
    lautstaerke: 0.42,
    schichten: [
      { quelle: fm(620, 2.4, 3.2, 0.3), huelle: schlag(0.0008, 0.14, 3), pegel: 0.6 },
      { quelle: ton('sinus', 160, 110), huelle: schlag(0.001, 0.06), pegel: 0.7 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.015, 3), filter: bandpass(2800, 1), pegel: 0.5 },
    ],
  },
  {
    // Fibres, leaves, herbs: a dry rustle.
    id: 'sfx_item_pflanze',
    ...ITEM,
    lautstaerke: 0.34,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.012, 0.1), filter: bandpass(3400, 0.8), pegel: 0.9 },
      { quelle: knistern(420, 0.003, 150), huelle: schlag(0.01, 0.1), filter: hochpass(2600), pegel: 0.5 },
    ],
  },
  {
    // Berries and fruit: a soft, round plop.
    id: 'sfx_item_frucht',
    ...ITEM,
    lautstaerke: 0.36,
    schichten: [
      { quelle: ton('sinus', 380, 680), huelle: schlag(0.002, 0.06, 2), pegel: 0.9 },
      { quelle: ton('sinus', 180, 120), huelle: schlag(0.002, 0.04), pegel: 0.4 },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.02, 3), filter: bandpass(1800, 1.5), pegel: 0.3 },
    ],
  },
  {
    // Mushrooms: a spongy, muted pop.
    id: 'sfx_item_pilz',
    ...ITEM,
    lautstaerke: 0.34,
    schichten: [
      { quelle: ton('sinus', 290, 430), huelle: schlag(0.003, 0.05, 2), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.004, 0.05), filter: tiefpass(1500, 2), pegel: 0.5 },
    ],
  },
  {
    // Shells: a small porcelain clink.
    id: 'sfx_item_muschel',
    ...ITEM,
    lautstaerke: 0.36,
    schichten: [
      { quelle: fm(2400, 2.1, 1.6, 0.2), huelle: schlag(0.0008, 0.1, 3), pegel: 0.6 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.012, 3), filter: hochpass(3500), pegel: 0.5 },
      { quelle: fm(2050, 2.3, 1, 0.1), huelle: schlag(0.0008, 0.07, 3), pegel: 0.35, start: 0.045 },
    ],
  },
  {
    // Tools: a wooden haft with a stone head bumping.
    id: 'sfx_item_werkzeug',
    ...ITEM,
    lautstaerke: 0.42,
    schichten: [
      { quelle: ton('sinus', 240, 190), huelle: schlag(0.001, 0.07, 3), pegel: 0.7 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: bandpass(2600, 1.2), pegel: 0.6, start: 0.03 },
      { quelle: ton('sinus', 620, 470), huelle: schlag(0.0005, 0.03, 3), pegel: 0.3, start: 0.03 },
    ],
  },
  // --- Drops ---------------------------------------------------------------------------------
  {
    // A stack pops out of the harvested object.
    id: 'sfx_drop_auswurf',
    ...ITEM,
    lautstaerke: 0.34,
    schichten: [
      { quelle: ton('sinus', 260, 720), huelle: schlag(0.002, 0.08, 2), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.02, 3), filter: bandpass(2200, 1.2), pegel: 0.4 },
    ],
  },
  {
    // It lands: a tiny tap.
    id: 'sfx_drop_landung',
    ...ITEM,
    lautstaerke: 0.24,
    schichten: [
      { quelle: ton('sinus', 210, 120), huelle: schlag(0.001, 0.04), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.02, 3), filter: tiefpass(2200), pegel: 0.5 },
    ],
  },
  {
    // The magnet pulls it in (§11.4): a soft rising whip ending in a bright tick.
    id: 'sfx_drop_magnet',
    ...ITEM,
    lautstaerke: 0.3,
    schichten: [
      { quelle: ton('sinus', 560, 1500), huelle: schlag(0.01, 0.07, 1.5), pegel: 0.6 },
      { quelle: ton('dreieck', 1320, 2640), huelle: schlag(0.002, 0.05, 2), pegel: 0.4, start: 0.035 },
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.05), filter: bandpass(3000, 1, 5000), pegel: 0.3 },
    ],
  },
  // --- Bags ----------------------------------------------------------------------------------
  {
    // Placing a stack in a slot: a leather "tup".
    id: 'sfx_inventar_ablegen',
    ...BAG,
    lautstaerke: 0.28,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.04, 2.5), filter: bandpass(1200, 1.2), pegel: 0.8 },
      { quelle: ton('sinus', 280, 210), huelle: schlag(0.001, 0.045), pegel: 0.6 },
    ],
  },
  {
    // Splitting a stack: two quick ticks falling apart.
    id: 'sfx_inventar_teilen',
    ...BAG,
    lautstaerke: 0.26,
    schichten: [
      { quelle: ton('dreieck', 980), huelle: schlag(0.001, 0.025, 3), pegel: 0.7, wiederholung: { anzahl: 2, abstand: 0.055, abfall: 0.8, tonhoehe: 0.8 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.03), filter: bandpass(1600, 1.2), pegel: 0.4 },
    ],
  },
  {
    // Gathering equal stacks: ticks rising together.
    id: 'sfx_inventar_sammeln',
    ...BAG,
    lautstaerke: 0.26,
    schichten: [
      { quelle: ton('dreieck', 720), huelle: schlag(0.001, 0.03, 3), pegel: 0.7, wiederholung: { anzahl: 3, abstand: 0.04, abfall: 0.95, tonhoehe: 1.12 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.005, 0.1), filter: bandpass(1400, 1), pegel: 0.35 },
    ],
  },
  {
    // Sorting: a quick shuffle through the bag.
    id: 'sfx_inventar_sortieren',
    ...BAG,
    lautstaerke: 0.28,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.003, 0.03, 2), filter: bandpass(2100, 1.4), pegel: 0.8, wiederholung: { anzahl: 5, abstand: 0.035, abfall: 0.85, tonhoehe: 1.05 } },
      { quelle: ton('dreieck', 880, 820), huelle: schlag(0.001, 0.04, 3), pegel: 0.4, start: 0.18 },
    ],
  },
  {
    // Throwing away: a toss whoosh and a far-off thud.
    id: 'sfx_inventar_wegwerfen',
    ...BAG,
    lautstaerke: 0.3,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.14, 1.5), filter: bandpass(1500, 1, 500), pegel: 0.8 },
      { quelle: ton('sinus', 150, 90), huelle: schlag(0.002, 0.06), pegel: 0.5, start: 0.13 },
    ],
  },
  {
    // Taking something out: a small pluck.
    id: 'sfx_inventar_entnehmen',
    ...BAG,
    lautstaerke: 0.26,
    schichten: [
      { quelle: ton('sinus', 340, 520), huelle: schlag(0.002, 0.045), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.03), filter: bandpass(1600, 1.2), pegel: 0.5 },
    ],
  },
  {
    // Bags full (§11.4 "klarer Hinweis bei vollen Taschen"): a muffled double thud – nothing fits.
    id: 'sfx_inventar_voll',
    ...BAG,
    stimmen: 1,
    sperrzeit: 0.4,
    lautstaerke: 0.4,
    untertitel: { de: 'Taschen voll', en: 'Bags full' },
    schichten: [
      { quelle: puls(220, 0.5), huelle: schlag(0.004, 0.12, 2), filter: tiefpass(1100, 1.5), pegel: 0.7, wiederholung: { anzahl: 2, abstand: 0.11, abfall: 0.85, tonhoehe: 0.84 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.004, 0.06), filter: bandpass(900, 1.5), pegel: 0.5, wiederholung: { anzahl: 2, abstand: 0.11, abfall: 0.85 } },
    ],
  },
  {
    // Hotbar selection: a tiny tick.
    id: 'sfx_inventar_auswahl',
    ...BAG,
    lautstaerke: 0.2,
    schichten: [
      { quelle: puls(1250, 0.25), huelle: schlag(0.001, 0.025, 3), filter: tiefpass(4200), pegel: 0.7 },
      { quelle: ton('sinus', 620), huelle: schlag(0.001, 0.02, 3), pegel: 0.4 },
    ],
  },
  // --- Equipment -----------------------------------------------------------------------------
  {
    // Putting on / taking up: cloth rustle and a buckle clink.
    id: 'sfx_ausruestung_anlegen',
    ...BAG,
    lautstaerke: 0.32,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.1), filter: bandpass(950, 1.2), pegel: 0.8 },
      { quelle: fm(2000, 2.7, 1.2, 0.1), huelle: schlag(0.001, 0.09, 3), pegel: 0.45, start: 0.06 },
    ],
  },
  {
    // Taking off: the rustle downwards and a soft set-down.
    id: 'sfx_ausruestung_ablegen',
    ...BAG,
    lautstaerke: 0.3,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.1), filter: bandpass(1100, 1.2, 650), pegel: 0.8 },
      { quelle: ton('sinus', 200, 130), huelle: schlag(0.002, 0.05), pegel: 0.5, start: 0.07 },
    ],
  },
  {
    // A tool or piece breaks (§13.1 "kaputt = unbenutzbar"): a sharp snap and pieces clattering.
    id: 'sfx_ausruestung_kaputt',
    bus: 'effekte',
    stimmen: 1,
    sperrzeit: 0.3,
    reichweite: 14,
    lautstaerke: 0.6,
    untertitel: { de: 'Etwas ist zerbrochen', en: 'Something broke' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.05, 3), filter: hochpass(1300), pegel: 0.9 },
      { quelle: ton('sinus', 420, 150), huelle: schlag(0.001, 0.1), pegel: 0.6 },
      { quelle: knistern(320, 0.004, 30), huelle: schlag(0.01, 0.32), filter: bandpass(2400, 1.2), pegel: 0.6, start: 0.03 },
      { quelle: ton('dreieck', 900, 600), huelle: schlag(0.001, 0.05, 3), pegel: 0.25, start: 0.12, wiederholung: { anzahl: 3, abstand: 0.07, abfall: 0.6, tonhoehe: 0.9 } },
    ],
  },
]);
