/**
 * World events (MASTERPROMPT §10, §2.7; docs/SPIEL.md §18; M7-38 … M7-40, strand B): what an announcement, a lightning strike,
 * the meteorite and a falling Lumen shard sound like (`WORLD_EVENT_SFX`, src/game/worldevents/events.ts). The distant thunder
 * of a storm and the weather's beds are the ambience's (strand A, M7-06); here only what happens at a point.
 *
 * - Announcement: a low horn-like swell with a shimmer – something is coming, not yet here (the music's stinger `ereignis`
 *   may lie on top).
 * - Strike: the crack right at the bolt (white noise, very short), the rip of the air, a deep boom after it.
 * - Meteorite: a falling whistle, the impact's thud and a rumble with debris.
 * - Shard: a soft descending whoosh ending in a glassy chime – a small gift from the sky.
 */
import { bandpass, bogen, defineSfxGroup, fm, hochpass, knistern, rauschen, schlag, tiefpass, ton } from './define';

/** Heard at the player (the announcement). */
const SPIELER = {
  bus: 'effekte',
  stimmen: 1,
  sperrzeit: 1,
  reichweite: 10,
} as const;

/** At the point it happens; strikes and impacts carry far. */
const WELT = {
  bus: 'effekte',
  varianten: 3,
  streuung: { tonhoehe: 80, lautstaerke: 1.5, klang: 0.08 },
  stimmen: 3,
  sperrzeit: 0.15,
  reichweite: 40,
} as const;

export const SFX_EREIGNISSE = defineSfxGroup('ereignisse', [
  {
    // A world event is coming: a low swell and a high shimmer.
    id: 'sfx_ereignis_ankuendigung',
    ...SPIELER,
    lautstaerke: 0.38,
    untertitel: { de: 'Etwas kündigt sich an', en: 'Something is coming' },
    schichten: [
      { quelle: ton('saege', 98, 110), huelle: bogen(0.6, 0.3, 0.7, 0.8, 1.2), filter: tiefpass(700, 1.5), pegel: 0.6, vibrato: { tiefe: 8, rate: 4 } },
      { quelle: ton('dreieck', 147, 165), huelle: bogen(0.7, 0.3, 0.6, 0.8, 1.2), filter: tiefpass(900), pegel: 0.4, start: 0.15 },
      { quelle: fm(1760, 2, 0.5, 0.1), huelle: bogen(0.9, 0.2, 0.4, 0.6, 1), pegel: 0.15, start: 0.5, vibrato: { tiefe: 20, rate: 7 } },
    ],
  },
  {
    // Lightning strikes close: the crack, the ripping air, the boom.
    id: 'sfx_blitz_einschlag',
    ...WELT,
    lautstaerke: 0.8,
    untertitel: { de: 'Blitzeinschlag', en: 'Lightning strike' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.08, 3), filter: hochpass(1800), pegel: 1 },
      { quelle: knistern(900, 0.002, 200), huelle: schlag(0.002, 0.45, 1.5), filter: bandpass(2600, 0.6), pegel: 0.5, start: 0.02 },
      { quelle: rauschen('braun'), huelle: bogen(0.01, 0.2, 0.7, 0.4, 1.4), filter: tiefpass(420, 1.2), pegel: 0.9, start: 0.05 },
      { quelle: ton('sinus', 55, 38), huelle: schlag(0.01, 1.2, 2), pegel: 0.7, start: 0.06 },
    ],
  },
  {
    // The meteorite comes down: a falling whistle, the thud, debris and rumble.
    id: 'sfx_meteor_einschlag',
    ...WELT,
    lautstaerke: 0.75,
    untertitel: { de: 'Meteoriteneinschlag', en: 'Meteorite impact' },
    schichten: [
      { quelle: ton('sinus', 1800, 420), huelle: bogen(0.4, 0.2, 0.6, 0.6, 0.05), pegel: 0.35 },
      { quelle: ton('sinus', 70, 34), huelle: schlag(0.005, 1.4, 2), pegel: 1, start: 1.05 },
      { quelle: rauschen('braun'), huelle: bogen(0.01, 0.3, 0.6, 0.6, 1.5), filter: tiefpass(600, 1), pegel: 0.8, start: 1.05 },
      { quelle: knistern(120, 0.006, 15), huelle: schlag(0.05, 1.2, 1.5), filter: bandpass(1400, 0.6), pegel: 0.4, start: 1.1 },
    ],
  },
  {
    // A Lumen shard lands: a soft whoosh and a glassy chime.
    id: 'sfx_lumen_scherbe',
    ...WELT,
    reichweite: 24,
    sperrzeit: 0.3,
    lautstaerke: 0.4,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.2, 0.1, 0.5, 0.2, 0.05), filter: bandpass(1800, 1, 900), pegel: 0.4 },
      { quelle: fm(2349, 2, 0.6, 0.1), huelle: schlag(0.002, 0.7, 2.5), pegel: 0.55, start: 0.42 },
      { quelle: ton('sinus', 3136), huelle: schlag(0.002, 0.4, 2.5), pegel: 0.2, start: 0.45 },
    ],
  },
]);
