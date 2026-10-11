/**
 * The vault traps (MASTERPROMPT §21 "Fallen", §4.6 "Gefahren … Vorwarnung", §27; docs/SPIEL.md §19 "Fallen M7"; M7-14, strand
 * C): the common warning every trap gives before it strikes (§4.6: the ear warns with the eye) and the strike of each trap
 * (`sound` of the `vaultTraps` records, src/content/dungeons/fallen.ts).
 */
import { bandpass, bogen, defineSfxGroup, fm, hochpass, knistern, rauschen, schlag, tiefpass, ton } from './define';

/** Sounds at a trap (layer −1): heard far enough to react. */
const FALLE = { bus: 'effekte', varianten: 2, streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.05 }, stimmen: 3, sperrzeit: 0.08, reichweite: 18 } as const;

export const SFX_FALLEN = defineSfxGroup('fallen', [
  {
    // The warning: a mechanism catching – a dry click and a short rising whir.
    id: 'sfx_falle_warnung',
    ...FALLE,
    lautstaerke: 0.42,
    untertitel: { de: 'Falle klickt', en: 'Trap clicks' },
    schichten: [
      { quelle: fm(1800, 1.5, 1.2, 0.2), huelle: schlag(0.0006, 0.05, 3), pegel: 0.7 },
      { quelle: ton('saege', 300, 600), huelle: bogen(0.02, 0.05, 0.6, 0.2, 0.05), filter: bandpass(1200, 2), pegel: 0.3, start: 0.05 },
    ],
  },
  {
    // Spear trap: iron tips shooting up through the plate.
    id: 'sfx_falle_speer',
    ...FALLE,
    lautstaerke: 0.5,
    untertitel: { de: 'Speere schießen hoch', en: 'Spears thrust up' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.001, 0.12, 3), filter: hochpass(2500), pegel: 0.6 },
      { quelle: fm(900, 1.41, 2.5, 0.5), huelle: schlag(0.0008, 0.18, 3), pegel: 0.7 },
    ],
  },
  {
    // Dart thrower: a hiss of air, the dart's whistle.
    id: 'sfx_falle_pfeil',
    ...FALLE,
    lautstaerke: 0.46,
    untertitel: { de: 'Pfeil zischt', en: 'Dart hisses' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.002, 0.15, 2), filter: bandpass(3500, 1.2), pegel: 0.6 },
      { quelle: ton('sinus', 2200, 1400), huelle: schlag(0.002, 0.25, 2), pegel: 0.35, start: 0.03 },
    ],
  },
  {
    // Rolling boulder: a heavy rumble rolling down the lane.
    id: 'sfx_falle_rollstein',
    ...FALLE,
    lautstaerke: 0.56,
    untertitel: { de: 'Felsbrocken rollt', en: 'Boulder rolls' },
    schichten: [
      { quelle: rauschen('braun'), huelle: bogen(0.1, 0.2, 0.8, 1.0, 0.4), filter: tiefpass(320, 1.2), pegel: 1 },
      { quelle: ton('sinus', 55, 45), huelle: bogen(0.1, 0.2, 0.7, 1.0, 0.4), vibrato: { tiefe: 40, rate: 7 }, pegel: 0.7 },
    ],
  },
  {
    // Pit trap: the cover crumbling away, a hollow drop.
    id: 'sfx_falle_grube',
    ...FALLE,
    lautstaerke: 0.48,
    untertitel: { de: 'Boden gibt nach', en: 'Floor gives way' },
    schichten: [
      { quelle: knistern(300, 0.004, 80), huelle: schlag(0.005, 0.4, 2), filter: bandpass(1600, 1), pegel: 0.5 },
      { quelle: ton('sinus', 140, 60), huelle: schlag(0.004, 0.45, 2), pegel: 0.7, start: 0.12 },
    ],
  },
  {
    // Collapsing floor: a long crack, stone falling into darkness.
    id: 'sfx_falle_einsturz',
    ...FALLE,
    lautstaerke: 0.56,
    untertitel: { de: 'Boden stürzt ein', en: 'Floor collapses' },
    schichten: [
      { quelle: knistern(500, 0.004, 150), huelle: schlag(0.003, 0.6, 1.6), filter: hochpass(1000), pegel: 0.5 },
      { quelle: rauschen('braun'), huelle: bogen(0.05, 0.2, 0.7, 0.6, 0.6), filter: tiefpass(500), pegel: 0.9, start: 0.15 },
      { quelle: ton('sinus', 80, 40), huelle: schlag(0.005, 0.9, 2), pegel: 0.6, start: 0.25 },
    ],
  },
  {
    // Pendulum blade: a heavy whoosh through the air.
    id: 'sfx_falle_pendel',
    ...FALLE,
    lautstaerke: 0.46,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.12, 0.1, 0.6, 0.1, 0.2), filter: bandpass(700, 1.4, 1600), pegel: 0.9 },
      { quelle: fm(300, 1.5, 0.6, 0.2), huelle: bogen(0.15, 0.1, 0.4, 0.05, 0.15), pegel: 0.2 },
    ],
  },
]);
