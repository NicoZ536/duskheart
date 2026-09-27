/**
 * Doors, gates and trapdoors opening and closing (MASTERPROMPT §16.2 "Türen (Holz, verstärkt, … zweibreites Tor,
 * Falltür)", §2.7; M4-29), per kind of door (`DOOR_AUDIO`, src/audio/baseSounds.ts):
 *
 * - `sfx_tuer_holz_*`: a plain wooden door – latch, a short creak, the swing; closing ends in a thud and the latch.
 * - `sfx_tuer_beschlagen_*`: the reinforced door with its bronze bands – heavier, an iron latch, the bands ringing.
 * - `sfx_tor_holz_*`: the two-wide gate – a long, low creak of big hinges; closing booms.
 * - `sfx_falltuer_*`: the trapdoor – lifted and laid back open, or dropped shut.
 *
 * Positioned at the door (range 14 tiles): creatures of later milestones hear a door too, so the player should.
 */
import { bandpass, bogen, defineSfxGroup, fm, rauschen, schlag, tiefpass, ton } from './define';

/** Shared settings of doors. */
const TUER = {
  bus: 'effekte',
  varianten: 2,
  streuung: { tonhoehe: 70, lautstaerke: 1, klang: 0.06 },
  stimmen: 2,
  sperrzeit: 0.1,
  reichweite: 14,
} as const;

export const SFX_TUEREN = defineSfxGroup('tueren', [
  {
    // Wooden door opens: latch click, a short creak, the swing.
    id: 'sfx_tuer_holz_auf',
    ...TUER,
    lautstaerke: 0.42,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: bandpass(2800, 1.4), pegel: 0.6 },
      { quelle: ton('dreieck', 1300, 1150), huelle: schlag(0.0008, 0.03, 3), pegel: 0.3 },
      { quelle: ton('saege', 220, 330), huelle: bogen(0.05, 0.1, 0.6, 0.15, 0.1), filter: bandpass(1100, 4), vibrato: { tiefe: 25, rate: 18 }, pegel: 0.5, start: 0.04 },
      { quelle: rauschen('rosa'), huelle: schlag(0.1, 0.2, 1.5), filter: bandpass(600, 1), pegel: 0.4, start: 0.05 },
    ],
  },
  {
    // Wooden door closes: the swing, a thud against the frame, the latch.
    id: 'sfx_tuer_holz_zu',
    ...TUER,
    lautstaerke: 0.46,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.08, 0.1, 1.5), filter: bandpass(700, 1), pegel: 0.4 },
      { quelle: ton('sinus', 120, 80), huelle: schlag(0.002, 0.12, 3), pegel: 0.9, start: 0.14 },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.05, 3), filter: bandpass(900, 1.4), pegel: 0.6, start: 0.14 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: bandpass(3000, 1.4), pegel: 0.5, start: 0.18 },
    ],
  },
  {
    // Reinforced door opens: an iron latch, a lower creak, the bands clinking.
    id: 'sfx_tuer_beschlagen_auf',
    ...TUER,
    lautstaerke: 0.46,
    schichten: [
      { quelle: fm(700, 2.4, 2, 0.2), huelle: schlag(0.001, 0.15, 3), pegel: 0.5 },
      { quelle: ton('saege', 160, 240), huelle: bogen(0.06, 0.12, 0.6, 0.2, 0.12), filter: bandpass(800, 4), vibrato: { tiefe: 20, rate: 14 }, pegel: 0.5, start: 0.06 },
      { quelle: ton('sinus', 900, 1300), huelle: bogen(0.05, 0.1, 0.4, 0.1, 0.1), vibrato: { tiefe: 30, rate: 11 }, pegel: 0.12, start: 0.1 },
      { quelle: rauschen('rosa'), huelle: schlag(0.12, 0.25, 1.5), filter: bandpass(500, 1), pegel: 0.4, start: 0.06 },
    ],
  },
  {
    // Reinforced door closes: a heavy thud and the bands ringing.
    id: 'sfx_tuer_beschlagen_zu',
    ...TUER,
    lautstaerke: 0.52,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.1, 0.1, 1.5), filter: bandpass(600, 1), pegel: 0.4 },
      { quelle: ton('sinus', 100, 65), huelle: schlag(0.002, 0.16, 3), pegel: 1, start: 0.16 },
      { quelle: fm(500, 2.7, 2.5, 0.3), huelle: schlag(0.001, 0.35, 3), pegel: 0.45, start: 0.16 },
      { quelle: fm(760, 2.4, 1.5, 0.1), huelle: schlag(0.001, 0.12, 3), pegel: 0.3, start: 0.24 },
    ],
  },
  {
    // The gate opens: big hinges creaking long and low, the wings dragging.
    id: 'sfx_tor_holz_auf',
    ...TUER,
    stimmen: 1,
    sperrzeit: 0.3,
    reichweite: 18,
    lautstaerke: 0.5,
    schichten: [
      { quelle: ton('saege', 110, 170), huelle: bogen(0.1, 0.2, 0.6, 0.35, 0.2), filter: bandpass(700, 4), vibrato: { tiefe: 30, rate: 9 }, pegel: 0.6 },
      { quelle: rauschen('braun'), huelle: bogen(0.1, 0.2, 0.6, 0.35, 0.25), filter: tiefpass(300), pegel: 0.6 },
      { quelle: ton('saege', 210, 260), huelle: bogen(0.05, 0.1, 0.5, 0.2, 0.1), filter: bandpass(1300, 5), vibrato: { tiefe: 25, rate: 15 }, pegel: 0.25, start: 0.3 },
      { quelle: rauschen('rosa'), huelle: schlag(0.2, 0.5, 1.5), filter: bandpass(450, 1), pegel: 0.4, start: 0.1 },
    ],
  },
  {
    // The gate closes: a short creak, the boom of the wings and the bar dropping.
    id: 'sfx_tor_holz_zu',
    ...TUER,
    stimmen: 1,
    sperrzeit: 0.3,
    reichweite: 20,
    lautstaerke: 0.58,
    schichten: [
      { quelle: ton('saege', 150, 110), huelle: bogen(0.05, 0.1, 0.5, 0.1, 0.1), filter: bandpass(650, 4), vibrato: { tiefe: 30, rate: 10 }, pegel: 0.4 },
      { quelle: ton('sinus', 70, 45), huelle: schlag(0.003, 0.35, 3), pegel: 1, start: 0.3 },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.2, 2), filter: tiefpass(800), pegel: 0.7, start: 0.3 },
      { quelle: ton('sinus', 240, 180), huelle: schlag(0.001, 0.07, 3), pegel: 0.5, start: 0.48 },
    ],
  },
  {
    // The trapdoor is lifted: a creak, and the flap lands open.
    id: 'sfx_falltuer_auf',
    ...TUER,
    lautstaerke: 0.44,
    schichten: [
      { quelle: ton('saege', 200, 280), huelle: bogen(0.04, 0.08, 0.5, 0.1, 0.08), filter: bandpass(1000, 4), vibrato: { tiefe: 25, rate: 16 }, pegel: 0.5 },
      { quelle: rauschen('rosa'), huelle: schlag(0.08, 0.12, 1.5), filter: bandpass(700, 1), pegel: 0.35, start: 0.05 },
      { quelle: ton('sinus', 140, 90), huelle: schlag(0.002, 0.1, 3), pegel: 0.8, start: 0.27 },
      { quelle: rauschen('weiss'), huelle: bogen(0.02, 0.1, 0.3, 0.1, 0.2), filter: bandpass(2500, 0.8), pegel: 0.15, start: 0.28 },
    ],
  },
  {
    // The trapdoor drops shut: a rush of air and a flat slam.
    id: 'sfx_falltuer_zu',
    ...TUER,
    lautstaerke: 0.5,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.08, 0.06, 1.5), filter: bandpass(800, 1, 400), pegel: 0.5 },
      { quelle: ton('sinus', 110, 70), huelle: schlag(0.002, 0.2, 3), pegel: 1, start: 0.12 },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.08, 3), filter: bandpass(1100, 1.3), pegel: 0.6, start: 0.12 },
    ],
  },
]);
