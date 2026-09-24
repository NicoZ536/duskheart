/**
 * Harvesting (MASTERPROMPT §14 "materialspezifische Treffersounds", §27 "Werkzeugtreffer je Material"):
 * a hit per harvest material (`GATHERING_SFX.hit` of src/game/gathering/events.ts – wood, stone, ore,
 * crystal and plants are harvested, earth, sand and snow dug), the spark of a tool that is too weak, the
 * hand pick, the find of a dig spot, the creak and crash of a falling tree, and the break of a finished
 * node (`sfx_sammeln_bersten`) or an uprooted stump (`sfx_baum_roden`).
 *
 * Hits are loud, short and readable over the step sounds: a transient for the blade, a body tone for the
 * material, and debris (splinters, grit, clods) trailing after it.
 */
import { bandpass, bogen, defineSfxGroup, digital, fm, hochpass, knistern, puls, rauschen, schlag, tiefpass, ton } from './define';

/** Shared variation of the repeated hits. */
const HIT = {
  bus: 'effekte',
  varianten: 3,
  streuung: { tonhoehe: 90, lautstaerke: 1.5, klang: 0.06 },
  stimmen: 3,
  sperrzeit: 0.05,
  reichweite: 22,
} as const;

export const SFX_SAMMELN = defineSfxGroup('sammeln', [
  {
    // Axe biting into wood: a hollow "thock" with splinters.
    id: 'sfx_sammeln_holz',
    ...HIT,
    lautstaerke: 0.62,
    schichten: [
      { quelle: ton('sinus', 190, 105), huelle: schlag(0.001, 0.13, 2.5), pegel: 1 },
      { quelle: ton('dreieck', 380, 300), huelle: schlag(0.001, 0.05, 3), pegel: 0.35 },
      { quelle: rauschen('rosa'), huelle: schlag(0.0008, 0.05, 3), filter: bandpass(850, 1.6), pegel: 0.8 },
      { quelle: knistern(420, 0.003, 60), huelle: schlag(0.004, 0.14), filter: hochpass(2400), pegel: 0.35, start: 0.012 },
    ],
  },
  {
    // Pick on rock: a bright crack, a stony "tink", grit falling.
    id: 'sfx_sammeln_stein',
    ...HIT,
    lautstaerke: 0.62,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.04, 3), filter: bandpass(3200, 0.8), pegel: 0.9 },
      { quelle: fm(1150, 2.76, 3, 0.4), huelle: schlag(0.0008, 0.16, 3), pegel: 0.45 },
      { quelle: ton('sinus', 130, 80), huelle: schlag(0.001, 0.05), pegel: 0.6 },
      { quelle: knistern(260, 0.003, 40), huelle: schlag(0.01, 0.2), filter: bandpass(2600, 1.2), pegel: 0.4, start: 0.02 },
    ],
  },
  {
    // Pick on ore: the stone crack plus a metallic ring of the vein.
    id: 'sfx_sammeln_erz',
    ...HIT,
    lautstaerke: 0.64,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.035, 3), filter: bandpass(3000, 0.8), pegel: 0.8 },
      { quelle: fm(1480, 1.414, 4.5, 0.8), huelle: schlag(0.0008, 0.38, 3), pegel: 0.5 },
      { quelle: fm(2230, 2.37, 1.5, 0.3), huelle: schlag(0.0008, 0.22, 3), pegel: 0.25, start: 0.002 },
      { quelle: ton('sinus', 120, 75), huelle: schlag(0.001, 0.05), pegel: 0.55 },
      { quelle: knistern(200, 0.003, 30), huelle: schlag(0.01, 0.18), filter: bandpass(2400, 1.2), pegel: 0.3, start: 0.02 },
    ],
  },
  {
    // Pick on crystal: a glassy chime cluster over a short crack.
    id: 'sfx_sammeln_kristall',
    ...HIT,
    lautstaerke: 0.6,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.03, 3), filter: hochpass(2500), pegel: 0.7 },
      { quelle: fm(2090, 2.76, 1.2, 0.2), huelle: schlag(0.001, 0.45, 3), pegel: 0.45 },
      { quelle: ton('sinus', 3135, 3100), huelle: schlag(0.001, 0.35, 3), pegel: 0.2, start: 0.006 },
      { quelle: ton('sinus', 2637, 2600), huelle: schlag(0.001, 0.3, 3), pegel: 0.18, start: 0.018 },
      { quelle: knistern(500, 0.002, 60), huelle: schlag(0.005, 0.15), filter: hochpass(4000), pegel: 0.3, start: 0.01 },
    ],
  },
  {
    // Sickle or hand through stalks: a swish and rustling leaves.
    id: 'sfx_sammeln_pflanze',
    ...HIT,
    lautstaerke: 0.5,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.012, 0.12, 2), filter: bandpass(3200, 0.8, 1500), pegel: 0.9 },
      { quelle: knistern(380, 0.004, 120), huelle: schlag(0.01, 0.16), filter: bandpass(2400, 1), pegel: 0.6, start: 0.015 },
      { quelle: rauschen('weiss'), huelle: schlag(0.001, 0.015, 3), filter: hochpass(4500), pegel: 0.3, start: 0.03 },
    ],
  },
  {
    // Shovel into earth: a scrape, a thud, falling clods.
    id: 'sfx_graben_erde',
    ...HIT,
    lautstaerke: 0.58,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.004, 0.08, 2.5), filter: bandpass(1800, 1.2, 900), pegel: 0.6 },
      { quelle: ton('sinus', 105, 60), huelle: schlag(0.002, 0.1), pegel: 0.9, start: 0.01 },
      { quelle: rauschen('braun'), huelle: schlag(0.01, 0.16), filter: tiefpass(1100, 0.9, 500), pegel: 0.7, start: 0.02 },
      { quelle: knistern(140, 0.004, 30), huelle: schlag(0.01, 0.2), filter: bandpass(1500, 1.5), pegel: 0.4, start: 0.06 },
    ],
  },
  {
    // Shovel into sand: a hissing slide of grains.
    id: 'sfx_graben_sand',
    ...HIT,
    lautstaerke: 0.52,
    schichten: [
      { quelle: knistern(1400, 0.002, 300), huelle: schlag(0.015, 0.22, 2), filter: bandpass(4000, 0.7), pegel: 1 },
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.18), filter: hochpass(1800, 0.7, 3000), pegel: 0.45 },
      { quelle: ton('sinus', 95, 60), huelle: schlag(0.003, 0.07), pegel: 0.5 },
    ],
  },
  {
    // Shovel into snow: a soft crunch that settles.
    id: 'sfx_graben_schnee',
    ...HIT,
    lautstaerke: 0.5,
    schichten: [
      { quelle: knistern(1600, 0.003, 400), huelle: schlag(0.03, 0.2, 2), filter: tiefpass(3200), pegel: 1 },
      { quelle: rauschen('rosa'), huelle: schlag(0.03, 0.18), filter: bandpass(1100, 1.2), pegel: 0.5 },
      { quelle: ton('sinus', 90, 60), huelle: schlag(0.01, 0.07), pegel: 0.35 },
    ],
  },
  {
    // Tool too weak (§13.2 "Zu hart" + sparks): a clang that bounces off, sparks sizzling away.
    id: 'sfx_sammeln_zuhart',
    ...HIT,
    lautstaerke: 0.66,
    untertitel: { de: 'Klirren – zu hart', en: 'Clank – too hard' },
    schichten: [
      { quelle: fm(920, 3.3, 3.8, 0.3), huelle: schlag(0.0005, 0.3, 3), pegel: 0.9 },
      { quelle: ton('sinus', 460, 440), huelle: schlag(0.0005, 0.2, 2.5), pegel: 0.35 },
      { quelle: puls(1760, 0.25, 1650), huelle: schlag(0.0005, 0.05, 3), filter: tiefpass(6000), pegel: 0.2 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.03, 3), filter: bandpass(3000, 1), pegel: 0.5 },
      { quelle: knistern(500, 0.0015, 40), huelle: schlag(0.005, 0.28), filter: hochpass(4500), pegel: 0.3, start: 0.01 },
    ],
  },
  {
    // Picking by hand (berries, mushrooms, scatter): a quick pluck and a leaf rustle.
    id: 'sfx_sammeln_pfluecken',
    ...HIT,
    lautstaerke: 0.42,
    schichten: [
      { quelle: ton('sinus', 480, 920), huelle: schlag(0.002, 0.05, 2), pegel: 0.6 },
      { quelle: rauschen('rosa'), huelle: schlag(0.008, 0.09), filter: bandpass(2600, 1), pegel: 0.7 },
      { quelle: knistern(260, 0.003), huelle: schlag(0.005, 0.07), filter: hochpass(3000), pegel: 0.3, start: 0.02 },
    ],
  },
  {
    // A node gives way (rock, ore, crystal): cracking, then rubble tumbling.
    id: 'sfx_sammeln_bersten',
    bus: 'effekte',
    varianten: 2,
    streuung: { tonhoehe: 80, lautstaerke: 1.5, klang: 0.06 },
    stimmen: 2,
    reichweite: 26,
    lautstaerke: 0.7,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.06, 3), filter: bandpass(2400, 0.7), pegel: 0.8 },
      { quelle: ton('sinus', 95, 45), huelle: schlag(0.002, 0.25), pegel: 0.9 },
      { quelle: rauschen('braun'), huelle: schlag(0.01, 0.35), filter: tiefpass(1400, 0.8, 400), pegel: 0.8, start: 0.02 },
      { quelle: knistern(180, 0.006, 15), huelle: schlag(0.02, 0.5), filter: bandpass(1800, 1.3), pegel: 0.6, start: 0.05 },
    ],
  },
  {
    // A stump is torn out: roots snapping, soil tearing.
    id: 'sfx_baum_roden',
    bus: 'effekte',
    varianten: 2,
    streuung: { tonhoehe: 80, lautstaerke: 1.5, klang: 0.06 },
    stimmen: 2,
    reichweite: 26,
    lautstaerke: 0.68,
    schichten: [
      { quelle: knistern(90, 0.008, 20), huelle: schlag(0.02, 0.45), filter: bandpass(700, 3), pegel: 0.9 },
      { quelle: rauschen('braun'), huelle: bogen(0.05, 0.1, 0.6, 0.12, 0.2), filter: tiefpass(900, 1, 400), pegel: 0.8 },
      { quelle: ton('sinus', 80, 45), huelle: schlag(0.004, 0.2), pegel: 0.9, start: 0.22 },
      { quelle: knistern(160, 0.004, 20), huelle: schlag(0.01, 0.35), filter: bandpass(1600, 1.2), pegel: 0.45, start: 0.25 },
    ],
  },
  {
    // The tree starts to fall (§14 "Fall vom Spieler weg"): slow stick-slip creaking of the trunk.
    id: 'sfx_baum_knarren',
    bus: 'effekte',
    stimmen: 2,
    sperrzeit: 0.3,
    reichweite: 32,
    lautstaerke: 0.66,
    untertitel: { de: 'Ein Baum knarrt', en: 'A tree creaks' },
    schichten: [
      { quelle: knistern(70, 0.01, 18), huelle: bogen(0.15, 0.3, 0.7, 0.45, 0.3), filter: bandpass(520, 5, 380), pegel: 1 },
      { quelle: ton('saege', 82, 58), huelle: bogen(0.25, 0.2, 0.6, 0.5, 0.35), filter: bandpass(600, 4, 420), pegel: 0.45, vibrato: { tiefe: 35, rate: 6 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.4, 0.3, 0.5, 0.3, 0.3), filter: bandpass(2400, 0.8, 1200), pegel: 0.25, start: 0.3 },
    ],
  },
  {
    // The trunk hits the ground (§14): a heavy boom, a bounce, branches and leaves settling.
    id: 'sfx_baum_aufprall',
    bus: 'effekte',
    stimmen: 2,
    sperrzeit: 0.2,
    reichweite: 40,
    lautstaerke: 0.92,
    untertitel: { de: 'Ein Baum stürzt krachend', en: 'A tree crashes down' },
    schichten: [
      { quelle: ton('sinus', 72, 34), huelle: schlag(0.003, 0.65, 2), pegel: 1 },
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.8, 2), filter: tiefpass(1000, 0.8, 180), pegel: 0.9 },
      { quelle: rauschen('weiss'), huelle: schlag(0.001, 0.08, 3), filter: bandpass(1600, 0.7), pegel: 0.6 },
      { quelle: ton('sinus', 58, 38), huelle: schlag(0.004, 0.3), pegel: 0.55, start: 0.2 },
      { quelle: knistern(520, 0.005, 25), huelle: schlag(0.02, 1.2, 1.5), filter: bandpass(2600, 0.9), pegel: 0.5, start: 0.03 },
    ],
  },
  {
    // A hidden dig spot gives up its find (§14): the shovel strikes something, a small bright arpeggio.
    id: 'sfx_graben_fund',
    bus: 'effekte',
    stimmen: 1,
    sperrzeit: 0.3,
    reichweite: 16,
    lautstaerke: 0.6,
    untertitel: { de: 'Etwas gefunden!', en: 'Found something!' },
    schichten: [
      { quelle: fm(740, 2.9, 3, 0.5), huelle: schlag(0.001, 0.15, 3), pegel: 0.6 },
      { quelle: puls(784, 0.25), huelle: schlag(0.004, 0.16, 2), filter: tiefpass(5200), pegel: 0.45, start: 0.1, wiederholung: { anzahl: 3, abstand: 0.075, abfall: 0.9, tonhoehe: 1.26 } },
      { quelle: ton('dreieck', 1568), huelle: schlag(0.004, 0.35, 2), pegel: 0.3, start: 0.25 },
      { quelle: digital(3000, 900), huelle: schlag(0.003, 0.1), filter: tiefpass(2000), pegel: 0.25 },
    ],
  },
]);
