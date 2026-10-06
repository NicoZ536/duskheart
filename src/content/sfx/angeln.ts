/**
 * Fishing (MASTERPROMPT §14 "Angeln", §2.7; docs/SPIEL.md §20; M7-24, strand D): the sounds of the rod, the float, the fight,
 * the ice hole and the fish traps (`FISHING_SFX`, src/game/fishing/events.ts).
 *
 * - The cast: a whip through the air and the reel's ratchet at the player; the float's plop where it lands (half a second on).
 * - The bite: a small bloop and a ripple at the float – clear, so the ear catches it before the eye.
 * - The strike: the reel's ratchet tight, a splash. A leap: a brighter splash at the float.
 * - The catch: the fish breaks the surface and flaps wet on the bank. Lost: the line snapping (a thin high twang), or a fish
 *   gliding off (a soft swirl). Reeled in empty: the reel whirring.
 * - The ice hole: three chops of the pickaxe into ice and a crack. The fish trap: wicker settling into water; emptied: wet
 *   flapping and dripping.
 */
import { bandpass, bogen, defineSfxGroup, fm, hochpass, knistern, rauschen, schlag, tiefpass, ton } from './define';

/** At the player (the rod, the reel). */
const ANGLER = {
  bus: 'effekte',
  varianten: 2,
  streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.06 },
  stimmen: 2,
  sperrzeit: 0.1,
  reichweite: 12,
} as const;

/** At the float or the trap, out on the water. */
const WASSER = {
  bus: 'effekte',
  varianten: 3,
  streuung: { tonhoehe: 90, lautstaerke: 1.5, klang: 0.08 },
  stimmen: 3,
  sperrzeit: 0.08,
  reichweite: 16,
} as const;

export const SFX_ANGELN = defineSfxGroup('angeln', [
  {
    // The cast: the rod whips through the air, the reel ratchets out.
    id: 'sfx_angeln_wurf',
    ...ANGLER,
    lautstaerke: 0.34,
    untertitel: { de: 'Ausgeworfen', en: 'Cast' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.05, 0.05, 0.6, 0.06, 0.12), filter: bandpass(1800, 1.5, 3800), pegel: 0.6 },
      { quelle: fm(2600, 1.5, 1.2, 0.2), huelle: schlag(0.0005, 0.012, 3), pegel: 0.35, start: 0.08, wiederholung: { anzahl: 7, abstand: 0.035, abfall: 0.9, tonhoehe: 0.98 } },
    ],
  },
  {
    // The float lands: a plop and rings on the water.
    id: 'sfx_angeln_platsch',
    ...WASSER,
    lautstaerke: 0.3,
    untertitel: { de: 'Pose landet', en: 'Float lands' },
    schichten: [
      { quelle: ton('sinus', 900, 300), huelle: schlag(0.002, 0.08, 3), pegel: 0.6, start: 0.45 },
      { quelle: rauschen('rosa'), huelle: schlag(0.003, 0.18, 2), filter: bandpass(1200, 1), pegel: 0.45, start: 0.45 },
    ],
  },
  {
    // A bite: the float bloops under, a ripple.
    id: 'sfx_angeln_biss',
    ...WASSER,
    lautstaerke: 0.42,
    sperrzeit: 0.3,
    untertitel: { de: 'Biss!', en: 'A bite!' },
    schichten: [
      { quelle: ton('sinus', 520, 180), huelle: schlag(0.002, 0.12, 3), pegel: 0.8 },
      { quelle: ton('sinus', 640, 240), huelle: schlag(0.002, 0.1, 3), pegel: 0.6, start: 0.16 },
      { quelle: rauschen('rosa'), huelle: schlag(0.005, 0.25, 2), filter: bandpass(900, 1.2), pegel: 0.35 },
    ],
  },
  {
    // The strike: the ratchet clicks tight, the water bursts.
    id: 'sfx_angeln_anschlag',
    ...ANGLER,
    lautstaerke: 0.4,
    untertitel: { de: 'Angeschlagen', en: 'Hooked' },
    schichten: [
      { quelle: fm(2200, 1.5, 1.4, 0.2), huelle: schlag(0.0005, 0.01, 3), pegel: 0.45, wiederholung: { anzahl: 5, abstand: 0.028, abfall: 0.95 } },
      { quelle: rauschen('weiss'), huelle: schlag(0.004, 0.22, 2), filter: bandpass(1600, 0.8), pegel: 0.55, start: 0.05 },
      { quelle: ton('sinus', 180, 90), huelle: schlag(0.003, 0.12, 3), pegel: 0.5, start: 0.05 },
    ],
  },
  {
    // The fish leaps: a bright splash at the float.
    id: 'sfx_angeln_sprung',
    ...WASSER,
    lautstaerke: 0.4,
    untertitel: { de: 'Fisch springt', en: 'Fish leaps' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.003, 0.3, 2), filter: bandpass(2400, 0.8), pegel: 0.6 },
      { quelle: ton('sinus', 400, 150), huelle: schlag(0.002, 0.1, 3), pegel: 0.4, start: 0.18 },
      { quelle: knistern(60, 0.006, 10), huelle: schlag(0.02, 0.4, 2), filter: bandpass(1800, 1), pegel: 0.3, start: 0.2 },
    ],
  },
  {
    // Landed: the fish breaks out of the water and flaps wet on the bank.
    id: 'sfx_angeln_fang',
    ...ANGLER,
    lautstaerke: 0.42,
    untertitel: { de: 'Fisch gefangen', en: 'Fish caught' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.004, 0.25, 2), filter: bandpass(1800, 0.8), pegel: 0.55 },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.05, 3), filter: bandpass(700, 1.5), pegel: 0.7, start: 0.32, wiederholung: { anzahl: 3, abstand: 0.13, abfall: 0.75, tonhoehe: 1.05 } },
      { quelle: ton('sinus', 200, 130), huelle: schlag(0.002, 0.05, 3), pegel: 0.4, start: 0.32, wiederholung: { anzahl: 3, abstand: 0.13, abfall: 0.75 } },
    ],
  },
  {
    // The line snaps: a thin high twang and the rod springing back.
    id: 'sfx_angeln_riss',
    ...ANGLER,
    lautstaerke: 0.4,
    untertitel: { de: 'Schnur gerissen', en: 'Line snapped' },
    schichten: [
      { quelle: fm(1900, 1.5, 2, 0.2, 1500), huelle: schlag(0.0008, 0.35, 3), pegel: 0.6 },
      { quelle: rauschen('weiss'), huelle: bogen(0.01, 0.05, 0.4, 0.05, 0.1), filter: bandpass(3200, 1.2, 1400), pegel: 0.4, start: 0.04 },
    ],
  },
  {
    // A fish glides away: a soft swirl at the float.
    id: 'sfx_angeln_entkommen',
    ...WASSER,
    lautstaerke: 0.3,
    untertitel: { de: 'Fisch entkommen', en: 'Fish got away' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.03, 0.1, 0.5, 0.2, 0.3), filter: bandpass(800, 1.2, 500), pegel: 0.6 },
      { quelle: ton('sinus', 300, 180), huelle: schlag(0.004, 0.18, 2), pegel: 0.3 },
    ],
  },
  {
    // Reeled in empty: the reel whirring, the float skipping home.
    id: 'sfx_angeln_einholen',
    ...ANGLER,
    lautstaerke: 0.3,
    untertitel: { de: 'Eingeholt', en: 'Reeled in' },
    schichten: [
      { quelle: fm(1800, 1.5, 1, 0.2), huelle: schlag(0.0005, 0.01, 3), pegel: 0.35, wiederholung: { anzahl: 12, abstand: 0.04, abfall: 0.97 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.1, 0.4, 0.35, 0.1), filter: bandpass(1400, 1.2), pegel: 0.25 },
    ],
  },
  {
    // The ice hole: three chops into ice, a crack running.
    id: 'sfx_angeln_eisloch',
    ...ANGLER,
    lautstaerke: 0.42,
    untertitel: { de: 'Eisloch geschlagen', en: 'Ice hole cut' },
    schichten: [
      { quelle: fm(1600, 2.1, 2.2, 0.3), huelle: schlag(0.0006, 0.08, 3), pegel: 0.55, wiederholung: { anzahl: 3, abstand: 0.22, abfall: 0.9, tonhoehe: 0.96 } },
      { quelle: knistern(500, 0.002, 80), huelle: schlag(0.005, 0.3, 2), filter: hochpass(2600), pegel: 0.4, start: 0.66 },
      { quelle: ton('sinus', 90, 60), huelle: schlag(0.004, 0.2, 2), pegel: 0.4, start: 0.66 },
    ],
  },
  {
    // A fish trap set into the water (and lifted out): wicker creaking, water closing over it.
    id: 'sfx_angeln_reuse',
    ...WASSER,
    lautstaerke: 0.36,
    untertitel: { de: 'Reuse', en: 'Fish trap' },
    schichten: [
      { quelle: knistern(150, 0.003, 40), huelle: schlag(0.01, 0.2, 2), filter: bandpass(2200, 1.2), pegel: 0.45 },
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.35, 2), filter: bandpass(700, 1), pegel: 0.5, start: 0.12 },
      { quelle: ton('sinus', 240, 120), huelle: schlag(0.004, 0.12, 3), pegel: 0.35, start: 0.12 },
    ],
  },
  {
    // A trap emptied: fish flapping, water dripping back.
    id: 'sfx_angeln_reuse_leeren',
    ...WASSER,
    lautstaerke: 0.38,
    untertitel: { de: 'Reuse geleert', en: 'Fish trap emptied' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.05, 3), filter: bandpass(800, 1.5), pegel: 0.7, wiederholung: { anzahl: 4, abstand: 0.12, abfall: 0.8, tonhoehe: 1.06 } },
      { quelle: ton('sinus', 1400, 900), huelle: schlag(0.001, 0.04, 3), pegel: 0.25, start: 0.2, wiederholung: { anzahl: 3, abstand: 0.17, abfall: 0.7 } },
      { quelle: rauschen('weiss'), huelle: bogen(0.05, 0.1, 0.4, 0.3, 0.2), filter: tiefpass(2500), pegel: 0.2 },
    ],
  },
]);
