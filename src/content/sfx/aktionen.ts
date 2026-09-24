/**
 * The player's actions, sleep and death (MASTERPROMPT §11.4–§11.6, §2.7; M3-10, M3-24–M3-26): the tool
 * swing (`INTERACTION_SFX.swing`), eating, swallowing, drinking, sitting down and standing up, throwing
 * and the thrown piece landing, an interrupted action (`ACTION_SFX`), lying down, breathing in sleep
 * (loop), waking and being startled awake (`SLEEP_SFX`), the light going out, the grave, emptying it, a
 * bed becoming the respawn point and the return (`DEATH_SFX`).
 */
import { bandpass, bogen, defineSfxGroup, fm, hochpass, knistern, puls, rauschen, schlag, tiefpass, ton } from './define';

/** Shared settings of body actions heard near the player. */
const BODY = {
  bus: 'effekte',
  varianten: 2,
  streuung: { tonhoehe: 80, lautstaerke: 1.5, klang: 0.06 },
  stimmen: 2,
  sperrzeit: 0.08,
  reichweite: 14,
} as const;

/** Moments that happen once: one voice, a long lock-out. */
const MOMENT = {
  bus: 'effekte',
  stimmen: 1,
  sperrzeit: 1,
  reichweite: 16,
} as const;

export const SFX_AKTIONEN = defineSfxGroup('aktionen', [
  {
    // Tool swing without a hit (M3-06 clip `tool`): an air cut.
    id: 'sfx_werkzeug_schwung',
    ...BODY,
    varianten: 3,
    lautstaerke: 0.3,
    schichten: [{ quelle: rauschen('rosa'), huelle: schlag(0.05, 0.08, 1.5), filter: bandpass(600, 1.4, 2200), pegel: 1 }],
  },
  {
    // Eating starts (M3-25): three crunchy chews.
    id: 'sfx_aktion_essen',
    ...BODY,
    lautstaerke: 0.42,
    schichten: [
      { quelle: knistern(900, 0.002, 250), huelle: schlag(0.005, 0.1), filter: bandpass(1900, 1.1), pegel: 0.9, wiederholung: { anzahl: 3, abstand: 0.19, abfall: 0.8, tonhoehe: 0.95 } },
      { quelle: ton('sinus', 130, 90), huelle: schlag(0.002, 0.04), pegel: 0.5, wiederholung: { anzahl: 3, abstand: 0.19, abfall: 0.8 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.08), filter: tiefpass(900), pegel: 0.3, wiederholung: { anzahl: 3, abstand: 0.19, abfall: 0.8 } },
    ],
  },
  {
    // A piece is eaten: one swallow.
    id: 'sfx_aktion_schlucken',
    ...BODY,
    lautstaerke: 0.38,
    schichten: [
      { quelle: ton('sinus', 240, 150), huelle: schlag(0.012, 0.11), filter: bandpass(480, 4), pegel: 1 },
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.1), filter: bandpass(850, 2), pegel: 0.35 },
    ],
  },
  {
    // Drinking (M3-25): three gulps.
    id: 'sfx_aktion_trinken',
    ...BODY,
    lautstaerke: 0.42,
    schichten: [
      { quelle: ton('sinus', 260, 170), huelle: schlag(0.01, 0.09), filter: bandpass(520, 4), pegel: 1, wiederholung: { anzahl: 3, abstand: 0.24, abfall: 0.85, tonhoehe: 0.95 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.12), filter: bandpass(900, 2), pegel: 0.35, wiederholung: { anzahl: 3, abstand: 0.24, abfall: 0.85 } },
      { quelle: ton('sinus', 700, 1100), huelle: schlag(0.002, 0.03), pegel: 0.15, start: 0.05, wiederholung: { anzahl: 3, abstand: 0.24, abfall: 0.8 } },
    ],
  },
  {
    // Sitting down (stumps, M3-25): settling weight and cloth.
    id: 'sfx_aktion_hinsetzen',
    ...BODY,
    lautstaerke: 0.3,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.03, 0.14), filter: tiefpass(1000), pegel: 0.8 },
      { quelle: ton('sinus', 105, 70), huelle: schlag(0.004, 0.08), pegel: 0.6, start: 0.08 },
    ],
  },
  {
    // Standing up: cloth rustling upwards and a small push.
    id: 'sfx_aktion_aufstehen',
    ...BODY,
    lautstaerke: 0.28,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.04, 0.12), filter: bandpass(800, 1, 1500), pegel: 0.9 },
      { quelle: ton('dreieck', 170, 220), huelle: schlag(0.01, 0.06), filter: bandpass(650, 3), pegel: 0.3, start: 0.03 },
    ],
  },
  {
    // Throwing (M3-25): a swift arm whoosh.
    id: 'sfx_aktion_werfen',
    ...BODY,
    lautstaerke: 0.34,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.03, 0.1, 1.5), filter: bandpass(700, 1.3, 2400), pegel: 1 },
      { quelle: ton('dreieck', 200, 260), huelle: schlag(0.008, 0.05), filter: bandpass(700, 3), pegel: 0.3 },
    ],
  },
  {
    // The thrown piece lands: a thud and a short tumble.
    id: 'sfx_aktion_aufprall',
    ...BODY,
    reichweite: 18,
    lautstaerke: 0.36,
    schichten: [
      { quelle: ton('sinus', 180, 100), huelle: schlag(0.001, 0.06), pegel: 0.9 },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.04, 3), filter: bandpass(1700, 1.2), pegel: 0.6, wiederholung: { anzahl: 2, abstand: 0.09, abfall: 0.5, tonhoehe: 1.1 } },
    ],
  },
  {
    // An action stops before its end (hit, roll, deep water …): a clipped falling blip.
    id: 'sfx_aktion_abbruch',
    ...BODY,
    bus: 'ui',
    sperrzeit: 0.2,
    lautstaerke: 0.26,
    schichten: [
      { quelle: ton('dreieck', 620, 380), huelle: schlag(0.002, 0.08), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.03, 3), filter: bandpass(1400, 1.5), pegel: 0.4 },
    ],
  },
  // --- Sleep (§11.5) -------------------------------------------------------------------------
  {
    // Lying down: straw and cloth, then a slow falling lullaby of three soft tones over a warm hum.
    id: 'sfx_schlaf_hinlegen',
    ...MOMENT,
    lautstaerke: 0.42,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.03, 0.2), filter: bandpass(1500, 0.9), pegel: 0.4 },
      { quelle: ton('sinus', 784), huelle: schlag(0.03, 0.7, 2), filter: tiefpass(2400), pegel: 0.6, start: 0.15, wiederholung: { anzahl: 3, abstand: 0.3, abfall: 0.8, tonhoehe: 0.75 } },
      { quelle: ton('dreieck', 196), huelle: bogen(0.3, 0.3, 0.6, 0.6, 0.8), filter: tiefpass(700), pegel: 0.45, start: 0.1 },
    ],
  },
  {
    // Breathing in sleep (loop, 4 s): a slow inhale and a longer exhale.
    id: 'sfx_schlaf_atmen',
    bus: 'effekte',
    stimmen: 1,
    sperrzeit: 0,
    reichweite: 10,
    lautstaerke: 0.2,
    schleife: { dauer: 4 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(1.1, 0.2, 0.7, 0.1, 0.3, 1.5), filter: bandpass(1100, 1.4), pegel: 0.7, start: 0.2 },
      { quelle: rauschen('rosa'), huelle: bogen(0.3, 0.6, 0.5, 0.2, 0.9, 1.5), filter: bandpass(750, 1.2, 500), pegel: 0.9, start: 1.8 },
    ],
  },
  {
    // Waking up (06:00 or rested): a light rising figure and a stretch breath.
    id: 'sfx_schlaf_aufwachen',
    ...MOMENT,
    lautstaerke: 0.42,
    schichten: [
      { quelle: ton('sinus', 523), huelle: schlag(0.02, 0.45, 2), pegel: 0.6, wiederholung: { anzahl: 3, abstand: 0.14, abfall: 0.9, tonhoehe: 1.26 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.2, 0.15, 0.5, 0.15, 0.3), filter: bandpass(1200, 1.5, 1800), pegel: 0.35 },
    ],
  },
  {
    // Startled awake by an attack (§11.5 "Angriffe wecken"): a sharp gasp and a dissonant sting.
    id: 'sfx_schlaf_aufschrecken',
    ...MOMENT,
    lautstaerke: 0.62,
    untertitel: { de: 'Aufgeschreckt!', en: 'Startled awake!' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.03, 0.15), filter: bandpass(1600, 2, 2600), pegel: 0.6 },
      { quelle: puls(622, 0.3), huelle: schlag(0.004, 0.35, 2), filter: tiefpass(3000), pegel: 0.45 },
      { quelle: puls(659, 0.5), huelle: schlag(0.004, 0.35, 2), filter: tiefpass(2600), pegel: 0.4 },
      { quelle: ton('sinus', 90, 50), huelle: schlag(0.002, 0.12), pegel: 0.6 },
    ],
  },
  // --- Death and return (§11.6) --------------------------------------------------------------
  {
    // "Dein Licht ist erloschen.": a falling minor figure over a sinking drone, the light fading out.
    id: 'sfx_tod_erloschen',
    ...MOMENT,
    sperrzeit: 2,
    lautstaerke: 0.72,
    untertitel: { de: 'Dein Licht erlischt', en: 'Your light goes out' },
    schichten: [
      { quelle: puls(440, 0.5), huelle: schlag(0.01, 0.55, 2), filter: tiefpass(1800), pegel: 0.55, wiederholung: { anzahl: 4, abstand: 0.26, abfall: 0.9, tonhoehe: 0.8409 } },
      { quelle: ton('dreieck', 110, 82), huelle: bogen(0.2, 0.3, 0.7, 1, 1.1), filter: tiefpass(600), pegel: 0.7 },
      { quelle: fm(220, 1.5, 1.2, 0, 164), huelle: bogen(0.4, 0.3, 0.5, 0.8, 1), pegel: 0.3 },
      { quelle: rauschen('rosa'), huelle: bogen(0.8, 0.4, 0.3, 0.5, 1), filter: bandpass(1200, 1, 300), pegel: 0.25 },
    ],
  },
  {
    // Return at a bed, a beacon or the beach: a hopeful open fifth swelling up with a spark.
    id: 'sfx_tod_wiederkehr',
    ...MOMENT,
    sperrzeit: 2,
    lautstaerke: 0.55,
    untertitel: { de: 'Du kehrst zurück', en: 'You return' },
    schichten: [
      { quelle: ton('dreieck', 262), huelle: bogen(0.5, 0.3, 0.7, 0.5, 0.9), filter: tiefpass(1400), pegel: 0.6 },
      { quelle: ton('dreieck', 392), huelle: bogen(0.6, 0.3, 0.6, 0.4, 0.9), filter: tiefpass(1600), pegel: 0.45, start: 0.12 },
      { quelle: fm(1047, 2, 1.5, 0.2), huelle: schlag(0.01, 0.9, 2), pegel: 0.35, start: 0.55 },
      { quelle: knistern(40, 0.01, 8), huelle: bogen(0.3, 0.3, 0.5, 0.5, 0.6), filter: hochpass(3000), pegel: 0.25, start: 0.4 },
    ],
  },
  {
    // A grave rises at the place of death: one low, distant bell stroke.
    id: 'sfx_tod_grab',
    ...MOMENT,
    reichweite: 24,
    lautstaerke: 0.5,
    schichten: [
      { quelle: fm(196, 1.4, 2.4, 0.2), huelle: schlag(0.004, 1.8, 2.5), pegel: 0.8 },
      { quelle: fm(392, 2.76, 1, 0), huelle: schlag(0.004, 0.9, 3), pegel: 0.25 },
      { quelle: rauschen('braun'), huelle: schlag(0.02, 0.3), filter: tiefpass(500), pegel: 0.3 },
    ],
  },
  {
    // Taking items out of the grave: soil, the bundle, a small relieved chime.
    id: 'sfx_tod_grab_leeren',
    ...MOMENT,
    sperrzeit: 0.3,
    lautstaerke: 0.42,
    schichten: [
      { quelle: rauschen('braun'), huelle: schlag(0.01, 0.15), filter: tiefpass(1100), pegel: 0.7 },
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.12), filter: bandpass(1600, 1.2), pegel: 0.5, start: 0.08 },
      { quelle: ton('sinus', 659), huelle: schlag(0.005, 0.35, 2), pegel: 0.35, start: 0.18, wiederholung: { anzahl: 2, abstand: 0.1, abfall: 0.9, tonhoehe: 1.335 } },
    ],
  },
  {
    // A bed becomes the respawn point: straw settling and a warm two-note promise.
    id: 'sfx_tod_bett',
    ...MOMENT,
    sperrzeit: 0.5,
    lautstaerke: 0.4,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.18), filter: bandpass(1500, 0.9), pegel: 0.5 },
      { quelle: ton('dreieck', 392), huelle: schlag(0.01, 0.5, 2), filter: tiefpass(2000), pegel: 0.55, start: 0.1, wiederholung: { anzahl: 2, abstand: 0.16, abfall: 0.95, tonhoehe: 1.26 } },
      { quelle: ton('sinus', 196), huelle: bogen(0.1, 0.3, 0.5, 0.2, 0.4), pegel: 0.3, start: 0.1 },
    ],
  },
]);
