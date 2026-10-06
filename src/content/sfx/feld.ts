/**
 * The field (MASTERPROMPT §17, §2.7; docs/SPIEL.md §20; M7-19 … M7-23, strand D): what sowing, watering, fertilising, harvesting
 * and planting sound like (`FARM_SFX`, src/game/farming/events.ts), the crows at a plot, and the compost box at work.
 *
 * - Sowing: seeds trickling from the hand, a soft pat of earth. Planting a sapling: the blade in, earth pressed down twice.
 * - Watering: a stream pouring onto soil, gurgling out of the can's rose. Filling the can: water glugging into a vessel, rising.
 * - Fertilising: a crumbly scatter and a soft thud of the sack.
 * - Harvesting: roots tearing from the soil, leaves rustling, a little shake. Clearing a dead plant: a dry rustle and snap.
 * - Crows: two harsh caws at the plot (quieter than a creature's call – they are birds at the edge of hearing).
 * - The compost box: a slow, wet settling and a faint fizz while it works; finished: a dull thump of the lid.
 */
import { bandpass, bogen, dauerton, defineSfxGroup, fm, hochpass, knistern, rauschen, schlag, tiefpass, ton } from './define';

/** The player's own work at a plot (heard around it). */
const ARBEIT = {
  bus: 'effekte',
  varianten: 3,
  streuung: { tonhoehe: 80, lautstaerke: 1.5, klang: 0.08 },
  stimmen: 3,
  sperrzeit: 0.08,
  reichweite: 12,
} as const;

/** Something at a plot the player did not do (crows). */
const BEET = {
  bus: 'effekte',
  varianten: 2,
  streuung: { tonhoehe: 120, lautstaerke: 2, klang: 0.1 },
  stimmen: 2,
  sperrzeit: 0.6,
  reichweite: 18,
} as const;

export const SFX_FELD = defineSfxGroup('feld', [
  {
    // Seeds trickle from the hand into the furrow, the palm pats the earth.
    id: 'sfx_feld_saeen',
    ...ARBEIT,
    lautstaerke: 0.32,
    untertitel: { de: 'Saat ausgebracht', en: 'Seeds sown' },
    schichten: [
      { quelle: knistern(180, 0.003, 60), huelle: bogen(0.02, 0.1, 0.6, 0.15, 0.1), filter: hochpass(2200), pegel: 0.55 },
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.09, 3), filter: tiefpass(500), pegel: 0.7, start: 0.3 },
      { quelle: ton('sinus', 120, 80), huelle: schlag(0.002, 0.07, 3), pegel: 0.4, start: 0.3 },
    ],
  },
  {
    // A sapling into the ground: the blade bites, earth pressed down twice.
    id: 'sfx_feld_pflanzen',
    ...ARBEIT,
    lautstaerke: 0.36,
    untertitel: { de: 'Setzling gepflanzt', en: 'Sapling planted' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.003, 0.12, 3), filter: bandpass(900, 1.2), pegel: 0.7 },
      { quelle: knistern(120, 0.004, 30), huelle: schlag(0.01, 0.2, 2), filter: bandpass(1800, 1), pegel: 0.35 },
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.08, 3), filter: tiefpass(420), pegel: 0.8, start: 0.32, wiederholung: { anzahl: 2, abstand: 0.22, abfall: 0.8 } },
      { quelle: ton('sinus', 110, 70), huelle: schlag(0.002, 0.06, 3), pegel: 0.45, start: 0.32, wiederholung: { anzahl: 2, abstand: 0.22, abfall: 0.8 } },
    ],
  },
  {
    // The can's rose: a soft stream on soil, gurgling as the can tips.
    id: 'sfx_feld_giessen',
    ...ARBEIT,
    lautstaerke: 0.36,
    untertitel: { de: 'Gegossen', en: 'Watered' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.08, 0.1, 0.7, 0.55, 0.25), filter: bandpass(3200, 0.8, 2600), pegel: 0.45 },
      { quelle: rauschen('rosa'), huelle: bogen(0.1, 0.1, 0.6, 0.5, 0.25), filter: bandpass(700, 1.5), pegel: 0.4 },
      { quelle: knistern(40, 0.012, 25), huelle: bogen(0.1, 0.1, 0.7, 0.45, 0.2), filter: bandpass(1300, 2), pegel: 0.4 },
    ],
  },
  {
    // Filling the can at the water: glugs into the vessel, rising in pitch as it fills.
    id: 'sfx_feld_kanne_fuellen',
    ...ARBEIT,
    lautstaerke: 0.36,
    untertitel: { de: 'Gießkanne gefüllt', en: 'Can filled' },
    schichten: [
      { quelle: ton('sinus', 260, 520), huelle: schlag(0.004, 0.06, 3), pegel: 0.5, wiederholung: { anzahl: 6, abstand: 0.11, abfall: 0.95, tonhoehe: 1.08 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.1, 0.6, 0.6, 0.15), filter: bandpass(1500, 1.2, 2400), pegel: 0.4 },
    ],
  },
  {
    // Compost or bone meal scattered, the sack set down.
    id: 'sfx_feld_duengen',
    ...ARBEIT,
    lautstaerke: 0.34,
    untertitel: { de: 'Gedüngt', en: 'Fertilised' },
    schichten: [
      { quelle: knistern(260, 0.004, 80), huelle: bogen(0.02, 0.1, 0.7, 0.25, 0.15), filter: bandpass(2600, 0.8), pegel: 0.5 },
      { quelle: rauschen('rosa'), huelle: bogen(0.03, 0.1, 0.5, 0.2, 0.15), filter: bandpass(800, 1), pegel: 0.4 },
      { quelle: rauschen('braun'), huelle: schlag(0.005, 0.12, 3), filter: tiefpass(300), pegel: 0.6, start: 0.45 },
    ],
  },
  {
    // A crop pulled: roots tear from the soil, leaves rustle, a shake of earth.
    id: 'sfx_feld_ernten',
    ...ARBEIT,
    lautstaerke: 0.38,
    untertitel: { de: 'Geerntet', en: 'Harvested' },
    schichten: [
      { quelle: knistern(400, 0.002, 120), huelle: schlag(0.01, 0.16, 2), filter: bandpass(1600, 1.2), pegel: 0.55 },
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.14, 3), filter: tiefpass(600), pegel: 0.6 },
      { quelle: rauschen('rosa'), huelle: bogen(0.03, 0.1, 0.5, 0.15, 0.15), filter: bandpass(3500, 1), pegel: 0.4, start: 0.15 },
      { quelle: knistern(90, 0.006, 20), huelle: schlag(0.01, 0.2, 2), filter: tiefpass(1200), pegel: 0.3, start: 0.35 },
    ],
  },
  {
    // A dead plant cleared: dry stalks rustling and snapping.
    id: 'sfx_feld_raeumen',
    ...ARBEIT,
    lautstaerke: 0.32,
    untertitel: { de: 'Welke Pflanze geräumt', en: 'Wilted plant cleared' },
    schichten: [
      { quelle: knistern(300, 0.002, 50), huelle: schlag(0.01, 0.25, 2), filter: hochpass(1800), pegel: 0.6 },
      { quelle: fm(1800, 1.41, 1.5, 0.1), huelle: schlag(0.0008, 0.03, 3), pegel: 0.35, start: 0.12, wiederholung: { anzahl: 2, abstand: 0.09, abfall: 0.7 } },
    ],
  },
  {
    // Crows at a plot: two harsh caws.
    id: 'sfx_feld_kraehe',
    ...BEET,
    lautstaerke: 0.3,
    untertitel: { de: 'Krähen am Beet', en: 'Crows at the bed' },
    schichten: [
      { quelle: ton('saege', 720, 560), huelle: bogen(0.01, 0.04, 0.7, 0.1, 0.06), filter: bandpass(1500, 3), vibrato: { tiefe: 60, rate: 32 }, pegel: 0.8, wiederholung: { anzahl: 2, abstand: 0.3, abfall: 0.85, tonhoehe: 0.94 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.01, 0.04, 0.5, 0.1, 0.06), filter: bandpass(2400, 2), pegel: 0.3, wiederholung: { anzahl: 2, abstand: 0.3, abfall: 0.85 } },
    ],
  },
  {
    // The compost box at work: a slow wet settling, a faint fizz (a quiet bed of the base).
    id: 'sfx_station_kompost',
    bus: 'umgebung',
    varianten: 2,
    stimmen: 3,
    sperrzeit: 0,
    lautstaerke: 0.18,
    schleife: { dauer: 3 },
    schichten: [
      { quelle: rauschen('braun'), huelle: dauerton(), filter: tiefpass(220), pegel: 0.35 },
      { quelle: knistern(14, 0.01), huelle: dauerton(), filter: bandpass(1100, 1.5), pegel: 0.35 },
      { quelle: rauschen('rosa'), huelle: bogen(0.4, 0.2, 0.6, 0.4, 0.5), filter: bandpass(500, 1.2), pegel: 0.35, start: 0.2, wiederholung: { anzahl: 2, abstand: 1.5, abfall: 0.9 } },
    ],
  },
  {
    // The compost is ready: the lid lifted with a dull wooden thump, earth sliding.
    id: 'sfx_station_kompost_fertig',
    bus: 'effekte',
    varianten: 2,
    streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.04 },
    stimmen: 2,
    sperrzeit: 0.1,
    reichweite: 16,
    lautstaerke: 0.38,
    untertitel: { de: 'Kompost fertig', en: 'Compost ready' },
    schichten: [
      { quelle: ton('sinus', 140, 95), huelle: schlag(0.002, 0.14, 3), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.05, 3), filter: bandpass(900, 1.4), pegel: 0.45 },
      { quelle: rauschen('braun'), huelle: bogen(0.05, 0.1, 0.5, 0.25, 0.2), filter: tiefpass(500), pegel: 0.5, start: 0.12 },
    ],
  },
]);
