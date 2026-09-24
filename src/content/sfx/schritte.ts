/**
 * Footsteps per ground (MASTERPROMPT §27 "Schritte je Untergrund (Gras, Erde, Stein, Holz, Sand, Schnee,
 * Wasser, Matsch, Asche, Kristall)"): `sfx_schritt_<material>` for every footstep material of the
 * terrain content (`FOOTSTEP_MATERIALS`: bog mud is `schlamm`, the glossary term for "Matsch"), plus
 * `holz` for wooden floors and `wasser` for wading. The sim reports a step every 1,5 tiles
 * (`playerStep`); sneaking and sprinting scale the volume in src/audio/eventMap.ts.
 *
 * Every step is heel + surface: a low body thud and the material's own texture (blades, grit, crust,
 * a hollow knock, a splash). Four takes, ±1,2 semitones and ±2,5 dB per step keep a walk from ticking.
 */
import { bandpass, bogen, defineSfxGroup, fm, hochpass, knistern, rauschen, schlag, tiefpass, ton } from './define';

/** Shared variation of all footsteps. */
const STEP = {
  bus: 'effekte',
  varianten: 4,
  streuung: { tonhoehe: 120, lautstaerke: 2.5, klang: 0.1 },
  stimmen: 3,
  sperrzeit: 0.06,
  reichweite: 10,
} as const;

export const SFX_SCHRITTE = defineSfxGroup('schritte', [
  {
    // Soft heel in turf, blades brushing the shoe.
    id: 'sfx_schritt_gras',
    ...STEP,
    lautstaerke: 0.3,
    schichten: [
      { quelle: ton('sinus', 120, 70), huelle: schlag(0.003, 0.06), pegel: 0.5 },
      { quelle: rauschen('rosa'), huelle: schlag(0.006, 0.09, 2.5), filter: bandpass(2600, 0.9, 1700), pegel: 0.9 },
      { quelle: knistern(260, 0.004), huelle: schlag(0.004, 0.08), filter: hochpass(3200), pegel: 0.45, start: 0.01 },
    ],
  },
  {
    // Dull packed earth: mostly thud, a little crumble.
    id: 'sfx_schritt_erde',
    ...STEP,
    lautstaerke: 0.32,
    schichten: [
      { quelle: ton('sinus', 95, 55), huelle: schlag(0.002, 0.07), pegel: 0.9 },
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.06), filter: tiefpass(900), pegel: 0.7 },
      { quelle: knistern(120, 0.003), huelle: schlag(0.005, 0.07), filter: bandpass(1800, 1.2), pegel: 0.3, start: 0.008 },
    ],
  },
  {
    // Hard sole click on rock with a short stony tick.
    id: 'sfx_schritt_stein',
    ...STEP,
    lautstaerke: 0.3,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0008, 0.025, 3), filter: bandpass(2600, 0.8), pegel: 0.7 },
      { quelle: ton('dreieck', 950, 620), huelle: schlag(0.001, 0.022, 3), pegel: 0.3 },
      { quelle: ton('sinus', 150, 90), huelle: schlag(0.001, 0.04), pegel: 0.65 },
      { quelle: knistern(300, 0.002), huelle: schlag(0.002, 0.04), filter: hochpass(2500), pegel: 0.3, start: 0.012 },
    ],
  },
  {
    // Hollow knock on planks.
    id: 'sfx_schritt_holz',
    ...STEP,
    lautstaerke: 0.32,
    schichten: [
      { quelle: ton('sinus', 210, 170), huelle: schlag(0.001, 0.09, 3), pegel: 0.9 },
      { quelle: ton('dreieck', 430, 400), huelle: schlag(0.001, 0.04, 3), pegel: 0.3 },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.03, 3), filter: bandpass(1300, 2.5), pegel: 0.6 },
    ],
  },
  {
    // Grainy sand giving way under the foot.
    id: 'sfx_schritt_sand',
    ...STEP,
    lautstaerke: 0.28,
    schichten: [
      { quelle: ton('sinus', 90, 60), huelle: schlag(0.004, 0.05), pegel: 0.4 },
      { quelle: knistern(1100, 0.0025, 500), huelle: schlag(0.012, 0.12, 2.5), filter: bandpass(3000, 0.8), pegel: 0.9 },
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.1), filter: bandpass(1600, 0.9), pegel: 0.35 },
    ],
  },
  {
    // Compressing snow: slow onset, squeaky crunch.
    id: 'sfx_schritt_schnee',
    ...STEP,
    lautstaerke: 0.3,
    schichten: [
      { quelle: knistern(1500, 0.003, 700), huelle: schlag(0.025, 0.12, 2), filter: tiefpass(3600), pegel: 1 },
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.11), filter: bandpass(1200, 1.4), pegel: 0.45 },
      { quelle: ton('sinus', 85, 60), huelle: schlag(0.01, 0.06), pegel: 0.35 },
    ],
  },
  {
    // Wading through shallow water: slosh plus a few droplets.
    id: 'sfx_schritt_wasser',
    ...STEP,
    lautstaerke: 0.34,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.004, 0.16, 2.5), filter: bandpass(1500, 1.2, 700), pegel: 0.9 },
      { quelle: ton('sinus', 500, 1100), huelle: schlag(0.002, 0.045), pegel: 0.18, start: 0.02 },
      { quelle: knistern(220, 0.006, 60), huelle: schlag(0.01, 0.16), filter: bandpass(3000, 1.5), pegel: 0.5, start: 0.03 },
    ],
  },
  {
    // Bog mud: a wet, resonant squelch that sucks at the boot.
    id: 'sfx_schritt_schlamm',
    ...STEP,
    lautstaerke: 0.34,
    schichten: [
      { quelle: rauschen('braun'), huelle: schlag(0.012, 0.14), filter: tiefpass(700, 6, 280), pegel: 1 },
      { quelle: ton('sinus', 170, 90), huelle: schlag(0.006, 0.09), pegel: 0.5, vibrato: { tiefe: 60, rate: 22 } },
      { quelle: knistern(90, 0.008), huelle: schlag(0.02, 0.1), filter: bandpass(900, 3), pegel: 0.4, start: 0.05 },
    ],
  },
  {
    // Powdery ash: a soft puff with fine grit.
    id: 'sfx_schritt_asche',
    ...STEP,
    lautstaerke: 0.26,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.012, 0.1), filter: tiefpass(2100), pegel: 0.9 },
      { quelle: knistern(500, 0.002), huelle: schlag(0.01, 0.08), filter: hochpass(3000), pegel: 0.3 },
      { quelle: ton('sinus', 90, 65), huelle: schlag(0.006, 0.05), pegel: 0.35 },
    ],
  },
  {
    // Crystal ground: a hard click with a faint glassy ring.
    id: 'sfx_schritt_kristall',
    ...STEP,
    lautstaerke: 0.3,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0008, 0.02, 3), filter: hochpass(2200), pegel: 0.6 },
      { quelle: fm(1850, 2.5, 1.8, 0.2), huelle: schlag(0.001, 0.13, 3), pegel: 0.35 },
      { quelle: fm(2770, 2.01, 1, 0), huelle: schlag(0.001, 0.09, 3), pegel: 0.2, start: 0.004 },
      { quelle: ton('sinus', 140, 90), huelle: schlag(0.001, 0.03), pegel: 0.45 },
    ],
  },
  {
    // Glacier ice: slick click and a thin, cold ring.
    id: 'sfx_schritt_eis',
    ...STEP,
    lautstaerke: 0.28,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0008, 0.018, 3), filter: hochpass(2600), pegel: 0.75 },
      { quelle: ton('sinus', 2350, 2250), huelle: schlag(0.001, 0.06, 3), pegel: 0.15 },
      { quelle: ton('sinus', 130, 85), huelle: schlag(0.001, 0.035), pegel: 0.5 },
      { quelle: rauschen('rosa'), huelle: bogen(0.01, 0.02, 0.3, 0.04, 0.05), filter: bandpass(5200, 1.5), pegel: 0.15, start: 0.015 },
    ],
  },
  {
    // Root floor: a woody creak under the heel.
    id: 'sfx_schritt_wurzel',
    ...STEP,
    lautstaerke: 0.3,
    schichten: [
      { quelle: ton('dreieck', 165, 120), huelle: schlag(0.002, 0.07), filter: tiefpass(900), pegel: 0.7 },
      { quelle: knistern(160, 0.004, 60), huelle: schlag(0.01, 0.1), filter: bandpass(750, 3.5), pegel: 0.7 },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.03, 3), filter: bandpass(1200, 2), pegel: 0.4 },
    ],
  },
]);
