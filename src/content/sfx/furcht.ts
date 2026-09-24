/**
 * Fear (MASTERPROMPT §12.3; `FEAR_SFX` of src/game/fear/events.ts): whispers from the stage `fluestern`
 * and a heartbeat from `bedrohlich` (both loops), a sudden fright, relief, a hallucination creeping out of
 * the dark, dissolving and striking, the Nachtmahr's call and its retreat.
 *
 * Fear is the one place where sound may be unsettling: unresolved intervals (semitones, tritones),
 * breathy noise shaped like syllables, slow vibrato. Everything stays quiet enough not to mask the
 * world – the threat should be heard in it, not over it (§2.8 Lesbarkeit).
 */
import { bandpass, bogen, dauerton, defineSfxGroup, fm, hochpass, knistern, rauschen, schlag, tiefpass, ton } from './define';

/** Warnings of the fear system: important, subtitled, one voice. */
const DREAD = {
  bus: 'effekte',
  stimmen: 1,
  sperrzeit: 1,
  reichweite: 64,
} as const;

export const SFX_FURCHT = defineSfxGroup('furcht', [
  {
    // Whispers at the edge of hearing (loop, 5 s): breathy syllables, never words.
    id: 'sfx_furcht_fluestern',
    bus: 'umgebung',
    varianten: 2,
    stimmen: 1,
    sperrzeit: 0,
    reichweite: 64,
    lautstaerke: 0.26,
    schleife: { dauer: 5 },
    untertitel: { de: 'Flüstern', en: 'Whispers' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.12, 0.1, 0.6, 0.2, 0.2), filter: bandpass(3600, 3, 2400), pegel: 0.8, start: 0.3 },
      { quelle: rauschen('rosa'), huelle: bogen(0.08, 0.1, 0.5, 0.15, 0.3), filter: bandpass(1800, 4, 2600), pegel: 0.7, start: 1.1 },
      { quelle: rauschen('rosa'), huelle: bogen(0.15, 0.15, 0.6, 0.3, 0.25), filter: bandpass(4200, 3, 3000), pegel: 0.6, start: 2.2 },
      { quelle: rauschen('rosa'), huelle: bogen(0.06, 0.1, 0.5, 0.1, 0.2), filter: bandpass(2200, 5, 1500), pegel: 0.7, start: 3.1 },
      { quelle: rauschen('rosa'), huelle: bogen(0.1, 0.1, 0.5, 0.25, 0.35), filter: bandpass(3000, 3, 4000), pegel: 0.6, start: 3.9 },
      { quelle: ton('sinus', 116), huelle: dauerton(), pegel: 0.12, vibrato: { tiefe: 40, rate: 0.4 } },
    ],
  },
  {
    // A racing heartbeat (loop, 0,75 s ≈ 80 per minute): lub – dub, deep in the chest.
    id: 'sfx_furcht_herzschlag',
    bus: 'effekte',
    stimmen: 1,
    sperrzeit: 0,
    reichweite: 64,
    lautstaerke: 0.4,
    schleife: { dauer: 0.75 },
    untertitel: { de: 'Herzklopfen', en: 'Heart pounding' },
    schichten: [
      { quelle: ton('sinus', 62, 42), huelle: schlag(0.006, 0.13), pegel: 1, start: 0.14 },
      { quelle: rauschen('braun'), huelle: schlag(0.006, 0.08), filter: tiefpass(260), pegel: 0.5, start: 0.14 },
      { quelle: ton('sinus', 56, 40), huelle: schlag(0.006, 0.11), pegel: 0.7, start: 0.36 },
    ],
  },
  {
    // A fright (sighting, bad food, a settler's death): a dissonant stab over a low boom.
    id: 'sfx_furcht_schreck',
    ...DREAD,
    lautstaerke: 0.66,
    untertitel: { de: 'Schreck!', en: 'Fright!' },
    schichten: [
      { quelle: ton('saege', 466), huelle: schlag(0.003, 0.6, 2), filter: tiefpass(3200, 1, 1200), pegel: 0.5 },
      { quelle: ton('saege', 494), huelle: schlag(0.003, 0.6, 2), filter: tiefpass(3000, 1, 1100), pegel: 0.45 },
      { quelle: ton('sinus', 70, 38), huelle: schlag(0.003, 0.45), pegel: 0.8 },
      { quelle: rauschen('weiss'), huelle: schlag(0.002, 0.12), filter: bandpass(2500, 1), pegel: 0.4 },
    ],
  },
  {
    // Relief (comfort food, courage returns): a released breath into a warm, open chord.
    id: 'sfx_furcht_erleichterung',
    bus: 'effekte',
    stimmen: 1,
    sperrzeit: 1,
    reichweite: 64,
    lautstaerke: 0.36,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.2, 0.4, 0.1, 0.4), filter: bandpass(900, 1.2, 600), pegel: 0.5 },
      { quelle: ton('dreieck', 330), huelle: bogen(0.25, 0.3, 0.6, 0.2, 0.6), filter: tiefpass(1600), pegel: 0.45, start: 0.1 },
      { quelle: ton('dreieck', 494), huelle: bogen(0.3, 0.3, 0.5, 0.2, 0.6), filter: tiefpass(1800), pegel: 0.35, start: 0.2 },
    ],
  },
  {
    // A hallucination creeps out of the dark (at its place): a swelling, wavering shape of sound.
    id: 'sfx_furcht_trugbild',
    bus: 'effekte',
    stimmen: 2,
    sperrzeit: 0.5,
    reichweite: 24,
    lautstaerke: 0.45,
    untertitel: { de: 'Etwas regt sich im Dunkeln', en: 'Something stirs in the dark' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.7, 0.2, 0.6, 0.2, 0.4), filter: bandpass(900, 2.5, 380), pegel: 0.8 },
      { quelle: ton('sinus', 196, 185), huelle: bogen(0.6, 0.3, 0.5, 0.3, 0.4), pegel: 0.4, vibrato: { tiefe: 120, rate: 3.2 } },
      { quelle: fm(277, 1.41, 3, 0.5), huelle: bogen(0.8, 0.2, 0.4, 0.2, 0.4), pegel: 0.25 },
    ],
  },
  {
    // It dissolves (light, struck, time): an airy shimmer rising away.
    id: 'sfx_furcht_verblassen',
    bus: 'effekte',
    stimmen: 2,
    sperrzeit: 0.3,
    reichweite: 24,
    lautstaerke: 0.36,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.03, 0.6, 1.5), filter: hochpass(1800, 1.5, 7000), pegel: 0.6 },
      { quelle: ton('sinus', 620, 1250), huelle: schlag(0.02, 0.5), pegel: 0.4 },
      { quelle: knistern(60, 0.004, 5), huelle: schlag(0.05, 0.6), filter: hochpass(4000), pegel: 0.3 },
    ],
  },
  {
    // A hallucination strikes (§12.3 "ab 80 mit Schaden"): a cold slash and a hollow ache.
    id: 'sfx_furcht_trugbild_treffer',
    bus: 'effekte',
    stimmen: 1,
    sperrzeit: 0.3,
    reichweite: 24,
    lautstaerke: 0.58,
    untertitel: { de: 'Ein Trugbild schlägt zu', en: 'A phantom strikes' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.004, 0.12, 2), filter: bandpass(2600, 1.5, 1200), pegel: 0.8 },
      { quelle: ton('saege', 147, 139), huelle: schlag(0.004, 0.4), filter: tiefpass(900, 3), pegel: 0.6 },
      { quelle: ton('saege', 208, 196), huelle: schlag(0.004, 0.4), filter: tiefpass(900, 3), pegel: 0.45 },
    ],
  },
  {
    // The Nachtmahr hunts (§12.3, fear 100): a long, deep, growling call.
    id: 'sfx_furcht_nachtmahr',
    ...DREAD,
    sperrzeit: 3,
    lautstaerke: 0.78,
    untertitel: { de: 'Der Nachtmahr ruft', en: 'The Nightmare calls' },
    schichten: [
      { quelle: ton('saege', 58, 41), huelle: bogen(0.4, 0.4, 0.7, 0.9, 0.8), filter: bandpass(320, 3, 160), pegel: 0.9, vibrato: { tiefe: 60, rate: 5 } },
      { quelle: fm(87, 0.5, 6, 2), huelle: bogen(0.5, 0.4, 0.6, 0.8, 0.8), filter: tiefpass(700), pegel: 0.5 },
      { quelle: rauschen('braun'), huelle: bogen(0.3, 0.5, 0.5, 0.8, 0.9), filter: tiefpass(600, 1.5, 200), pegel: 0.6 },
      { quelle: rauschen('rosa'), huelle: bogen(0.6, 0.3, 0.3, 0.6, 0.8), filter: bandpass(2600, 3, 1400), pegel: 0.2 },
    ],
  },
  {
    // The Nachtmahr gives up (glaring light, defeated): a falling hiss, the growl sinking away.
    id: 'sfx_furcht_nachtmahr_weicht',
    ...DREAD,
    sperrzeit: 3,
    lautstaerke: 0.55,
    untertitel: { de: 'Der Nachtmahr weicht', en: 'The Nightmare retreats' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.1, 1.4, 1.5), filter: bandpass(3000, 1.2, 600), pegel: 0.6 },
      { quelle: ton('saege', 55, 30), huelle: schlag(0.1, 1.6, 1.5), filter: tiefpass(400, 2), pegel: 0.6, vibrato: { tiefe: 40, rate: 4 } },
      { quelle: ton('dreieck', 392), huelle: bogen(0.6, 0.4, 0.4, 0.3, 0.6), filter: tiefpass(1500), pegel: 0.2, start: 0.8 },
    ],
  },
]);
