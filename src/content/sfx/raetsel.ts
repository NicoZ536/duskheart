/**
 * The vault puzzles (MASTERPROMPT §21 "Rätseltypen", §2.7, §27; docs/SPIEL.md §19; M7-12, M7-13, strand C): a lever pulled, a
 * bowl lit, a bell rung (played at its pitch – the bell is a C, a tone of the tune `ton` semitones higher, src/audio/eventMap.ts),
 * a cracked wall that only thuds, a crate pushed and one settling onto its plate, the parts springing back, a puzzle solved.
 */
import { bandpass, bogen, defineSfxGroup, fm, knistern, rauschen, schlag, tiefpass, ton } from './define';

/** Sounds at a part of a puzzle (layer −1). */
const TEIL = { bus: 'effekte', varianten: 2, streuung: { tonhoehe: 30, lautstaerke: 1, klang: 0.04 }, stimmen: 3, sperrzeit: 0.08, reichweite: 16 } as const;
/** Sounds at the player (reset, solved). */
const SPIELER = { bus: 'effekte', stimmen: 1, sperrzeit: 0.3, reichweite: 10 } as const;

export const SFX_RAETSEL = defineSfxGroup('raetsel', [
  {
    // A lever pulled: iron grinding in its slot, a heavy clack.
    id: 'sfx_raetsel_hebel',
    ...TEIL,
    lautstaerke: 0.44,
    untertitel: { de: 'Hebel umgelegt', en: 'Lever pulled' },
    schichten: [
      { quelle: rauschen('braun'), huelle: bogen(0.01, 0.05, 0.6, 0.15, 0.05), filter: bandpass(700, 1.6), pegel: 0.6 },
      { quelle: fm(400, 1.41, 2, 0.4), huelle: schlag(0.001, 0.12, 3), pegel: 0.8, start: 0.18 },
      { quelle: ton('sinus', 110, 80), huelle: schlag(0.002, 0.2, 3), pegel: 0.6, start: 0.18 },
    ],
  },
  {
    // A fire bowl lit: a breath of ignition, flames taking hold.
    id: 'sfx_raetsel_schale',
    ...TEIL,
    lautstaerke: 0.44,
    untertitel: { de: 'Feuerschale entzündet', en: 'Fire bowl lit' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.1, 0.6, 0.3, 0.4), filter: bandpass(900, 0.9, 1800), pegel: 0.8 },
      { quelle: knistern(200, 0.003, 120), huelle: bogen(0.1, 0.2, 0.5, 0.4, 0.4), filter: bandpass(3000, 1), pegel: 0.4, start: 0.15 },
    ],
  },
  {
    // A bell rung: a bronze bell on C (the pitch of the event raises it to its tone).
    id: 'sfx_raetsel_glocke',
    ...TEIL,
    varianten: 1,
    streuung: { tonhoehe: 0, lautstaerke: 0.5, klang: 0 },
    lautstaerke: 0.48,
    untertitel: { de: 'Glocke klingt', en: 'Bell rings' },
    schichten: [
      { quelle: fm(523, 2.76, 2.2, 0.4), huelle: schlag(0.002, 1.8, 2.5), pegel: 0.7 },
      { quelle: fm(1046, 2, 0.8, 0.1), huelle: schlag(0.002, 1.2, 2.5), pegel: 0.35 },
      { quelle: ton('sinus', 261, 261), huelle: schlag(0.004, 1.6, 2), pegel: 0.3 },
    ],
  },
  {
    // A false cracked wall: a dull thud, a little grit trickling.
    id: 'sfx_raetsel_wand',
    ...TEIL,
    lautstaerke: 0.4,
    schichten: [
      { quelle: ton('sinus', 95, 70), huelle: schlag(0.002, 0.18, 3), pegel: 0.8 },
      { quelle: knistern(150, 0.003, 40), huelle: schlag(0.02, 0.4, 2), filter: bandpass(2200, 1), pegel: 0.25, start: 0.05 },
    ],
  },
  {
    // A crate pushed one tile: stone scraping on stone.
    id: 'sfx_raetsel_kiste',
    ...TEIL,
    lautstaerke: 0.44,
    schichten: [
      { quelle: rauschen('braun'), huelle: bogen(0.02, 0.05, 0.7, 0.3, 0.08), filter: bandpass(320, 1.6, 260), pegel: 0.9 },
      { quelle: knistern(260, 0.004, 120), huelle: bogen(0.02, 0.05, 0.5, 0.28, 0.06), filter: bandpass(1500, 1), pegel: 0.3 },
    ],
  },
  {
    // A crate settles onto a pressure plate: the scrape, then the plate sinking with a click.
    id: 'sfx_raetsel_platte',
    ...TEIL,
    lautstaerke: 0.46,
    untertitel: { de: 'Druckplatte sinkt ein', en: 'Pressure plate sinks' },
    schichten: [
      { quelle: rauschen('braun'), huelle: bogen(0.02, 0.05, 0.7, 0.3, 0.08), filter: bandpass(320, 1.6, 260), pegel: 0.8 },
      { quelle: fm(1200, 1.5, 1, 0.2), huelle: schlag(0.0008, 0.06, 3), pegel: 0.6, start: 0.36 },
      { quelle: ton('sinus', 80, 60), huelle: schlag(0.003, 0.25, 3), pegel: 0.6, start: 0.38 },
    ],
  },
  {
    // The parts spring back after a wrong step: a low falling groan of the mechanism.
    id: 'sfx_raetsel_zurueck',
    ...SPIELER,
    lautstaerke: 0.4,
    untertitel: { de: 'Mechanismus springt zurück', en: 'Mechanism resets' },
    schichten: [
      { quelle: ton('saege', 160, 90), huelle: bogen(0.02, 0.1, 0.6, 0.4, 0.2), filter: tiefpass(600), pegel: 0.6 },
      { quelle: rauschen('braun'), huelle: bogen(0.05, 0.1, 0.5, 0.4, 0.2), filter: bandpass(400, 1.2), pegel: 0.4 },
    ],
  },
  {
    // A puzzle solved: deep stone tumblers falling into place, a bright rising chime.
    id: 'sfx_raetsel_geloest',
    ...SPIELER,
    lautstaerke: 0.46,
    untertitel: { de: 'Rätsel gelöst', en: 'Puzzle solved' },
    schichten: [
      { quelle: ton('sinus', 120, 90), huelle: schlag(0.002, 0.2, 3), pegel: 0.6, wiederholung: { anzahl: 3, abstand: 0.14, abfall: 0.85, tonhoehe: 1.12 } },
      { quelle: fm(659, 2, 0.6, 0.1), huelle: schlag(0.003, 1.0, 2.5), pegel: 0.45, start: 0.45 },
      { quelle: fm(988, 2, 0.6, 0.1), huelle: schlag(0.003, 1.0, 2.5), pegel: 0.4, start: 0.6 },
    ],
  },
]);
