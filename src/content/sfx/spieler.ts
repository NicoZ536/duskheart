/**
 * The player's body (MASTERPROMPT §11, §2.7 "Jede Aktion hat … akustisches Feedback"): movement
 * (`PLAYER_SFX` of src/game/player/events.ts), hurt per cause and survival stages (`SURVIVAL_SFX`,
 * `CONDITION_SFX.hurt`). Actions, sleep and death are in `aktionen.ts`.
 *
 * The voice is never a sampled human: grunts and breaths are formant-filtered tones and noise, pitched
 * low and short so they read as effort, not as speech. Warnings (hunger, thirst, cold, drowning, a broken
 * bone) carry subtitles for players who play without sound (§27 Barrierefreiheit).
 */
import { bandpass, bogen, defineSfxGroup, digital, hochpass, knistern, puls, rauschen, schlag, tiefpass, ton } from './define';

/** Shared settings of body sounds heard only near the player. */
const BODY = {
  bus: 'effekte',
  varianten: 2,
  streuung: { tonhoehe: 80, lautstaerke: 1.5, klang: 0.06 },
  stimmen: 2,
  sperrzeit: 0.08,
  reichweite: 14,
} as const;

/** Warnings: one voice, a long lock-out (a stage entered twice in a moment plays once). */
const WARNING = {
  bus: 'effekte',
  varianten: 2,
  streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
  stimmen: 1,
  sperrzeit: 1,
  reichweite: 14,
} as const;

export const SFX_SPIELER = defineSfxGroup('spieler', [
  // --- Movement --------------------------------------------------------------------------------
  {
    // Spawn at the start beach (§8): a breath in and a soft rising shimmer – waking up washed ashore.
    id: 'sfx_spieler_erwachen',
    bus: 'effekte',
    stimmen: 1,
    sperrzeit: 1,
    lautstaerke: 0.5,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.35, 0.2, 0.5, 0.1, 0.4), filter: bandpass(1100, 1.5, 1600), pegel: 0.5 },
      { quelle: ton('sinus', 392), huelle: schlag(0.05, 0.7, 2), pegel: 0.45, start: 0.3, wiederholung: { anzahl: 3, abstand: 0.16, abfall: 0.85, tonhoehe: 1.335 } },
      { quelle: ton('dreieck', 196), huelle: bogen(0.4, 0.3, 0.5, 0.3, 0.6), filter: tiefpass(900), pegel: 0.35, start: 0.25 },
    ],
  },
  {
    // Sprint start: a push-off whoosh.
    id: 'sfx_spieler_sprint',
    ...BODY,
    lautstaerke: 0.3,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.03, 0.14, 1.5), filter: bandpass(750, 1.2, 1700), pegel: 0.9 },
      { quelle: ton('sinus', 110, 70), huelle: schlag(0.002, 0.05), pegel: 0.5 },
    ],
  },
  {
    // Crouching into a sneak: a hushed cloth rustle.
    id: 'sfx_spieler_schleichen',
    ...BODY,
    lautstaerke: 0.18,
    reichweite: 6,
    schichten: [{ quelle: rauschen('rosa'), huelle: schlag(0.05, 0.16, 1.5), filter: tiefpass(1300, 0.9, 700), pegel: 1 }],
  },
  {
    // Dodge roll (§11.4): a tumble whoosh with the shoulder, then the hip touching the ground.
    id: 'sfx_spieler_rolle',
    ...BODY,
    lautstaerke: 0.42,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.03, 0.22, 1.5), filter: bandpass(600, 1, 1300), pegel: 0.9 },
      { quelle: ton('sinus', 120, 70), huelle: schlag(0.002, 0.06), pegel: 0.6, start: 0.05, wiederholung: { anzahl: 2, abstand: 0.14, abfall: 0.7, tonhoehe: 0.9 } },
      { quelle: knistern(120, 0.004), huelle: schlag(0.02, 0.2), filter: bandpass(1800, 1.2), pegel: 0.3, start: 0.06 },
    ],
  },
  {
    // Jump off a ledge: a short effort breath and a cloth whoosh.
    id: 'sfx_spieler_sprung',
    ...BODY,
    lautstaerke: 0.34,
    schichten: [
      { quelle: ton('dreieck', 190, 250), huelle: schlag(0.01, 0.07), filter: bandpass(700, 3), pegel: 0.5 },
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.12, 1.5), filter: bandpass(900, 1, 1800), pegel: 0.8 },
    ],
  },
  {
    // Landing: a soft thud of both feet.
    id: 'sfx_spieler_landung',
    ...BODY,
    lautstaerke: 0.4,
    schichten: [
      { quelle: ton('sinus', 115, 55), huelle: schlag(0.002, 0.1), pegel: 1 },
      { quelle: rauschen('rosa'), huelle: schlag(0.003, 0.08), filter: tiefpass(1100), pegel: 0.6 },
      { quelle: knistern(200, 0.003), huelle: schlag(0.005, 0.1), filter: bandpass(2200, 1.2), pegel: 0.3, start: 0.01 },
    ],
  },
  {
    // A broken bone (§11.3 Knochenbruch): a dry crack and a pained grunt.
    id: 'sfx_spieler_knochenbruch',
    ...WARNING,
    lautstaerke: 0.66,
    untertitel: { de: 'Knochen bricht', en: 'Bone breaks' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0004, 0.025, 3), filter: hochpass(2200), pegel: 0.9 },
      { quelle: knistern(1800, 0.0015, 200), huelle: schlag(0.001, 0.05), filter: bandpass(3000, 1), pegel: 0.6 },
      { quelle: ton('sinus', 140, 70), huelle: schlag(0.001, 0.06), pegel: 0.6 },
      { quelle: ton('saege', 210, 150), huelle: bogen(0.02, 0.1, 0.5, 0.08, 0.15), filter: bandpass(750, 4), pegel: 0.45, start: 0.07 },
    ],
  },
  {
    // Climbing a ladder: grip, scrape, pull.
    id: 'sfx_spieler_klettern',
    ...BODY,
    lautstaerke: 0.32,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.07), filter: bandpass(1500, 2), pegel: 0.8, wiederholung: { anzahl: 2, abstand: 0.13, abfall: 0.8, tonhoehe: 1.1 } },
      { quelle: ton('sinus', 210, 170), huelle: schlag(0.001, 0.05, 3), pegel: 0.5, wiederholung: { anzahl: 2, abstand: 0.13, abfall: 0.8 } },
    ],
  },
  // --- Hurt ------------------------------------------------------------------------------------
  {
    // Hurt (conditions, generic): a short grunt through the teeth.
    id: 'sfx_spieler_schmerz',
    ...BODY,
    sperrzeit: 0.25,
    lautstaerke: 0.5,
    schichten: [
      { quelle: ton('dreieck', 260, 170), huelle: schlag(0.008, 0.12), filter: bandpass(800, 3.5), pegel: 0.9 },
      { quelle: rauschen('rosa'), huelle: schlag(0.006, 0.08), filter: bandpass(1100, 2), pegel: 0.4 },
      { quelle: ton('sinus', 120, 80), huelle: schlag(0.002, 0.05), pegel: 0.4 },
    ],
  },
  {
    // Fall damage: an impact thud with a winded "oof".
    id: 'sfx_spieler_aufprall',
    ...BODY,
    sperrzeit: 0.25,
    lautstaerke: 0.6,
    untertitel: { de: 'Harter Aufprall', en: 'Hard landing' },
    schichten: [
      { quelle: ton('sinus', 100, 45), huelle: schlag(0.002, 0.18), pegel: 1 },
      { quelle: rauschen('braun'), huelle: schlag(0.003, 0.12), filter: tiefpass(1000), pegel: 0.7 },
      { quelle: ton('dreieck', 220, 140), huelle: schlag(0.01, 0.14), filter: bandpass(650, 3.5), pegel: 0.5, start: 0.04 },
    ],
  },
  {
    // Hunger (§11.1 Hungrig/Verhungernd): a rumbling, wobbling stomach growl.
    id: 'sfx_spieler_magenknurren',
    ...WARNING,
    lautstaerke: 0.5,
    untertitel: { de: 'Magen knurrt', en: 'Stomach growls' },
    schichten: [
      { quelle: ton('saege', 74, 58), huelle: bogen(0.12, 0.15, 0.7, 0.35, 0.3), filter: tiefpass(420, 4, 260), pegel: 1, vibrato: { tiefe: 90, rate: 11 } },
      { quelle: digital(95, 60), huelle: bogen(0.1, 0.2, 0.5, 0.3, 0.3), filter: tiefpass(500, 2), pegel: 0.5 },
      { quelle: ton('sinus', 130, 95), huelle: schlag(0.05, 0.25), pegel: 0.35, start: 0.55 },
    ],
  },
  {
    // Thirst and heat (§11.1, §11.2): two dry, heavy breaths.
    id: 'sfx_spieler_keuchen',
    ...WARNING,
    lautstaerke: 0.42,
    untertitel: { de: 'Keuchen', en: 'Panting' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.06, 0.08, 0.6, 0.05, 0.14), filter: bandpass(1400, 1.6), pegel: 0.9, wiederholung: { anzahl: 2, abstand: 0.36, abfall: 0.85, tonhoehe: 0.88 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.06, 0.5, 0.04, 0.12), filter: bandpass(2600, 2), pegel: 0.35, wiederholung: { anzahl: 2, abstand: 0.36, abfall: 0.85, tonhoehe: 0.9 } },
    ],
  },
  {
    // Drowning (§11.4, Ertrinkend): bubbles bursting upwards and a choked gurgle.
    id: 'sfx_spieler_ertrinken',
    ...WARNING,
    lautstaerke: 0.55,
    untertitel: { de: 'Ertrinken!', en: 'Drowning!' },
    schichten: [
      { quelle: ton('sinus', 320, 900), huelle: schlag(0.003, 0.05), pegel: 0.6, wiederholung: { anzahl: 6, abstand: 0.07, abfall: 0.9, tonhoehe: 1.08 } },
      { quelle: digital(70, 110), huelle: bogen(0.05, 0.1, 0.6, 0.25, 0.15), filter: tiefpass(600, 3), pegel: 0.7 },
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.1, 0.4, 0.2, 0.15), filter: bandpass(700, 2.5), pegel: 0.4 },
    ],
  },
  {
    // Cold (§11.2 Frierend … Erfrierend): chattering teeth and a shivering breath.
    id: 'sfx_spieler_zittern',
    ...WARNING,
    lautstaerke: 0.4,
    untertitel: { de: 'Zähneklappern', en: 'Teeth chattering' },
    schichten: [
      { quelle: puls(1900, 0.2), huelle: schlag(0.0008, 0.012, 3), filter: bandpass(2600, 2), pegel: 0.7, wiederholung: { anzahl: 9, abstand: 0.045, abfall: 0.93, tonhoehe: 0.99 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.08, 0.1, 0.5, 0.15, 0.15), filter: bandpass(1500, 1.5), pegel: 0.35 },
    ],
  },
  {
    // Tiredness (§11.1 Müde/Erschöpft): a long, falling yawn.
    id: 'sfx_spieler_gaehnen',
    ...WARNING,
    lautstaerke: 0.4,
    untertitel: { de: 'Gähnen', en: 'Yawning' },
    schichten: [
      { quelle: ton('dreieck', 290, 200), huelle: bogen(0.25, 0.15, 0.8, 0.45, 0.4, 1.5), filter: bandpass(850, 5, 480), pegel: 0.8, vibrato: { tiefe: 25, rate: 5 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.3, 0.2, 0.6, 0.4, 0.4), filter: bandpass(1000, 1.5, 600), pegel: 0.5 },
    ],
  },
]);
