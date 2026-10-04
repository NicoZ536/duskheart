/**
 * Creatures of the Salt Coast (MASTERPROMPT §20.1 "Jede Kreatur: … Sounds", §19.4 "Telegraphs … hörbar", §27; M6-23,
 * M6-24): call, hurt cry, death and one sound per attack of crab, gull, seal, lobster, jellyfish and beach raider – the ids
 * their records name (src/content/creatures/salzkueste.ts).
 *
 * Every creature sounds like its body: the crab's clicks are dry and tiny, the gull laughs in falling cries, the seal
 * barks low and wet, the lobster's shell clatters and its great claw lands with a crack, the jellyfish only bubbles and
 * fizzes, and the beach raider – a person the dark has taken – breathes a hoarse, wordless growl. Peaceful animals are
 * quiet and carry little; what warns of danger (a foe's call, a heavy wind-up) is louder, subtitled and heard from further
 * away (§27 "Untertitel für wichtige Laute").
 */
import { bandpass, bogen, defineSfxGroup, fm, hochpass, knistern, puls, rauschen, schlag, tiefpass, ton } from './define';

/** Small animals: quiet, heard only nearby, several at once. */
const KLEINTIER = { bus: 'effekte', reichweite: 14, stimmen: 3, sperrzeit: 0.25 } as const;
/** Bigger animals: a little further. */
const WILD = { bus: 'effekte', reichweite: 20, stimmen: 3, sperrzeit: 0.25 } as const;
/** Threats: heard from afar, one voice at a time. */
const BEDROHUNG = { bus: 'effekte', reichweite: 32, stimmen: 2, sperrzeit: 0.4 } as const;

export const SFX_KREATUREN_SALZKUESTE = defineSfxGroup('kreaturen_salzkueste', [
  // -------------------------------------------------------------------------------------------
  // Krabbe
  // -------------------------------------------------------------------------------------------
  {
    // A crab's warning: a quick run of dry clicks, claws knocking on the shell.
    id: 'sfx_kreatur_krabbe_laut',
    ...KLEINTIER,
    lautstaerke: 0.26,
    varianten: 2,
    streuung: { tonhoehe: 80, lautstaerke: 1.5, klang: 0.06 },
    schichten: [
      { quelle: ton('dreieck', 2600, 2200), huelle: schlag(0.0005, 0.012, 3), pegel: 0.7, wiederholung: { anzahl: 4, abstand: 0.045, abfall: 0.8, tonhoehe: 1.06 } },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.01, 3), filter: bandpass(5200, 2), pegel: 0.4, wiederholung: { anzahl: 4, abstand: 0.045, abfall: 0.8 } },
    ],
  },
  {
    // Hurt: the shell cracks, a thin squeak of air.
    id: 'sfx_kreatur_krabbe_treffer',
    ...KLEINTIER,
    lautstaerke: 0.34,
    varianten: 2,
    streuung: { tonhoehe: 70, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: knistern(900, 0.004), huelle: schlag(0.001, 0.05), filter: bandpass(2800, 1.2), pegel: 0.6 },
      { quelle: puls(1900, 0.2, 1500), huelle: bogen(0.003, 0.03, 0.4, 0.03, 0.04), filter: bandpass(2600, 2), pegel: 0.4 },
    ],
  },
  {
    // Death: the shell gives, the legs rattle once more and go still.
    id: 'sfx_kreatur_krabbe_tod',
    ...KLEINTIER,
    lautstaerke: 0.34,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: knistern(700, 0.005, 200), huelle: bogen(0.002, 0.08, 0.4, 0.1, 0.15), filter: bandpass(2400, 1.2), pegel: 0.6 },
      { quelle: ton('dreieck', 2200, 1600), huelle: schlag(0.0005, 0.012, 3), pegel: 0.4, start: 0.12, wiederholung: { anzahl: 3, abstand: 0.07, abfall: 0.6 } },
    ],
  },
  {
    // The pinch: a snip of chitin.
    id: 'sfx_kreatur_krabbe_kneifen',
    ...KLEINTIER,
    lautstaerke: 0.36,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: bandpass(4200, 2.5), pegel: 0.6 },
      { quelle: ton('dreieck', 1800, 1300), huelle: schlag(0.0005, 0.025, 3), pegel: 0.5 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Möwe
  // -------------------------------------------------------------------------------------------
  {
    // The gull's laugh: three bright cries falling in pitch, "kyow – kyow – kyow".
    id: 'sfx_kreatur_moewe_laut',
    ...WILD,
    lautstaerke: 0.36,
    varianten: 3,
    streuung: { tonhoehe: 70, lautstaerke: 1.5, klang: 0.06 },
    schichten: [
      { quelle: fm(1250, 2, 2.5, 1, 980), huelle: bogen(0.01, 0.05, 0.6, 0.06, 0.06), filter: bandpass(1800, 1.4), pegel: 0.7, vibrato: { tiefe: 40, rate: 16 }, wiederholung: { anzahl: 3, abstand: 0.24, abfall: 0.85, tonhoehe: 0.94 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.01, 0.05, 0.3, 0.05, 0.05), filter: bandpass(2600, 1.2), pegel: 0.25, wiederholung: { anzahl: 3, abstand: 0.24, abfall: 0.85 } },
    ],
  },
  {
    // Hurt: a harsh, broken squawk.
    id: 'sfx_kreatur_moewe_treffer',
    ...WILD,
    lautstaerke: 0.4,
    varianten: 2,
    streuung: { tonhoehe: 80, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: puls(1100, 0.2, 820), huelle: bogen(0.003, 0.04, 0.5, 0.05, 0.07), filter: bandpass(1700, 2), pegel: 0.6, koernung: 7 },
      { quelle: rauschen('weiss'), huelle: schlag(0.002, 0.06), filter: bandpass(3400, 1.5), pegel: 0.3 },
    ],
  },
  {
    // Death: a last cry breaking off, feathers thrashing.
    id: 'sfx_kreatur_moewe_tod',
    ...WILD,
    lautstaerke: 0.4,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: fm(1150, 2, 2.5, 0.5, 600), huelle: bogen(0.01, 0.12, 0.5, 0.15, 0.2), filter: bandpass(1500, 1.4, 900), pegel: 0.6, vibrato: { tiefe: 70, rate: 14 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.003, 0.035), filter: bandpass(1300, 1.1), pegel: 0.4, start: 0.3, wiederholung: { anzahl: 5, abstand: 0.06, abfall: 0.7 } },
    ],
  },
  {
    // The peck: a sharp tap of the beak.
    id: 'sfx_kreatur_moewe_picken',
    ...WILD,
    lautstaerke: 0.36,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: ton('dreieck', 1500, 900), huelle: schlag(0.0005, 0.03, 3), pegel: 0.6 },
      { quelle: rauschen('rosa'), huelle: bogen(0.02, 0.04, 0, 0, 0.01), filter: bandpass(1800, 1.2, 800), pegel: 0.3 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Robbe
  // -------------------------------------------------------------------------------------------
  {
    // The seal's call: a low, wet bark, twice.
    id: 'sfx_kreatur_robbe_laut',
    ...WILD,
    lautstaerke: 0.42,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1.5, klang: 0.06 },
    schichten: [
      { quelle: fm(220, 1, 3, 1, 170), huelle: bogen(0.02, 0.06, 0.55, 0.08, 0.1), filter: bandpass(600, 1.3), pegel: 0.7, wiederholung: { anzahl: 2, abstand: 0.36, abfall: 0.85 } },
      { quelle: rauschen('braun'), huelle: bogen(0.02, 0.06, 0.4, 0.06, 0.08), filter: bandpass(900, 1.1), pegel: 0.45, wiederholung: { anzahl: 2, abstand: 0.36, abfall: 0.85 } },
    ],
  },
  {
    // Hurt: a grunting moan.
    id: 'sfx_kreatur_robbe_treffer',
    ...WILD,
    lautstaerke: 0.44,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: puls(260, 0.35, 200), huelle: bogen(0.006, 0.07, 0.5, 0.08, 0.12), filter: bandpass(700, 1.6), pegel: 0.7, vibrato: { tiefe: 60, rate: 9 } },
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.1), filter: tiefpass(600), pegel: 0.4 },
    ],
  },
  {
    // Death: a long, sinking moan; the heavy body slumps on the sand.
    id: 'sfx_kreatur_robbe_tod',
    ...WILD,
    lautstaerke: 0.46,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: puls(240, 0.35, 120), huelle: bogen(0.01, 0.2, 0.5, 0.3, 0.35), filter: bandpass(600, 1.5, 380), pegel: 0.7, vibrato: { tiefe: 80, rate: 7 } },
      { quelle: ton('sinus', 80, 50), huelle: schlag(0.004, 0.2), pegel: 0.6, start: 0.7 },
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.25), filter: tiefpass(450), pegel: 0.5, start: 0.7 },
    ],
  },
  {
    // The bite: jaws snapping shut, wet.
    id: 'sfx_kreatur_robbe_biss',
    ...WILD,
    lautstaerke: 0.48,
    varianten: 2,
    streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.03, 0.05, 0, 0, 0.02), filter: bandpass(1200, 1.4, 700), pegel: 0.4 },
      { quelle: ton('dreieck', 420, 180), huelle: schlag(0.001, 0.05), pegel: 0.6, start: 0.06 },
      { quelle: rauschen('braun'), huelle: schlag(0.002, 0.07), filter: tiefpass(900), pegel: 0.5, start: 0.06 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Scherenkrebs
  // -------------------------------------------------------------------------------------------
  {
    // Its threat: a hissing clatter of plates and claws.
    id: 'sfx_kreatur_scherenkrebs_laut',
    ...BEDROHUNG,
    lautstaerke: 0.46,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1.5, klang: 0.06 },
    untertitel: { de: 'Scherenkrebs klappert', en: 'Lobster clatters' },
    schichten: [
      { quelle: knistern(160, 0.006, 260), huelle: bogen(0.02, 0.15, 0.6, 0.2, 0.2), filter: bandpass(2200, 1.1), pegel: 0.6 },
      { quelle: rauschen('weiss'), huelle: bogen(0.05, 0.2, 0.4, 0.15, 0.2), filter: bandpass(4800, 1.5), pegel: 0.35 },
      { quelle: ton('dreieck', 900, 700), huelle: schlag(0.0005, 0.02, 3), pegel: 0.4, wiederholung: { anzahl: 3, abstand: 0.12, abfall: 0.8, tonhoehe: 0.95 } },
    ],
  },
  {
    // Hurt: the shell cracks.
    id: 'sfx_kreatur_scherenkrebs_treffer',
    ...BEDROHUNG,
    lautstaerke: 0.46,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: knistern(1100, 0.004), huelle: schlag(0.001, 0.07), filter: bandpass(2400, 1.1), pegel: 0.6 },
      { quelle: ton('dreieck', 520, 330), huelle: schlag(0.001, 0.06), pegel: 0.45 },
    ],
  },
  {
    // Death: plates split, the claws rattle down.
    id: 'sfx_kreatur_scherenkrebs_tod',
    ...BEDROHUNG,
    lautstaerke: 0.48,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: knistern(900, 0.005, 150), huelle: bogen(0.002, 0.15, 0.5, 0.2, 0.3), filter: bandpass(2000, 1.1), pegel: 0.6 },
      { quelle: ton('dreieck', 700, 400), huelle: schlag(0.0005, 0.03, 3), pegel: 0.45, start: 0.25, wiederholung: { anzahl: 3, abstand: 0.09, abfall: 0.6 } },
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.15), filter: tiefpass(700), pegel: 0.4, start: 0.5 },
    ],
  },
  {
    // The pinch: a hard snap of chitin.
    id: 'sfx_kreatur_scherenkrebs_kneifen',
    ...BEDROHUNG,
    lautstaerke: 0.44,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.03, 3), filter: bandpass(3600, 2), pegel: 0.6 },
      { quelle: ton('dreieck', 1200, 800), huelle: schlag(0.0005, 0.04, 3), pegel: 0.55 },
    ],
  },
  {
    // The claw slam: the great claw sweeps down and cracks on the ground.
    id: 'sfx_kreatur_scherenkrebs_scherenschlag',
    ...BEDROHUNG,
    lautstaerke: 0.56,
    varianten: 2,
    streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.05, 0, 0, 0.02), filter: bandpass(900, 1.2, 2200), pegel: 0.5 },
      { quelle: ton('sinus', 110, 55), huelle: schlag(0.002, 0.25), pegel: 0.8, start: 0.08 },
      { quelle: knistern(700, 0.005), huelle: schlag(0.002, 0.12), filter: bandpass(1800, 1), pegel: 0.5, start: 0.08 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Qualle
  // -------------------------------------------------------------------------------------------
  {
    // The jellyfish pulses: soft bubbling under the surface.
    id: 'sfx_kreatur_qualle_laut',
    ...KLEINTIER,
    lautstaerke: 0.24,
    varianten: 2,
    streuung: { tonhoehe: 80, lautstaerke: 1.5, klang: 0.08 },
    schichten: [
      { quelle: ton('sinus', 420, 700), huelle: schlag(0.004, 0.05), pegel: 0.5, wiederholung: { anzahl: 5, abstand: 0.07, abfall: 0.8, tonhoehe: 1.08 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.15, 0.3, 0.1, 0.15), filter: bandpass(700, 1.5), pegel: 0.35 },
    ],
  },
  {
    // Hurt: a wet squelch.
    id: 'sfx_kreatur_qualle_treffer',
    ...KLEINTIER,
    lautstaerke: 0.36,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.004, 0.06, 0.3, 0.04, 0.06), filter: bandpass(800, 1.6, 400), pegel: 0.7 },
      { quelle: ton('sinus', 300, 160), huelle: schlag(0.003, 0.08), pegel: 0.4 },
    ],
  },
  {
    // Death: it runs apart into the sand – a long, sinking gurgle.
    id: 'sfx_kreatur_qualle_tod',
    ...KLEINTIER,
    lautstaerke: 0.36,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: ton('sinus', 600, 180), huelle: schlag(0.004, 0.06), pegel: 0.45, wiederholung: { anzahl: 6, abstand: 0.09, abfall: 0.75, tonhoehe: 0.9 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.02, 0.3, 0.3, 0.2, 0.3), filter: bandpass(900, 1.2, 300), pegel: 0.45 },
    ],
  },
  {
    // The sting: a crackling fizz of a hundred threads.
    id: 'sfx_kreatur_qualle_nesseln',
    ...WILD,
    lautstaerke: 0.42,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.08 },
    schichten: [
      { quelle: knistern(1400, 0.002, 600), huelle: bogen(0.01, 0.12, 0.4, 0.08, 0.15), filter: hochpass(2600), pegel: 0.6 },
      { quelle: fm(1600, 1.5, 2, 1), huelle: schlag(0.002, 0.12), filter: bandpass(3000, 1.5), pegel: 0.3 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Strandräuber
  // -------------------------------------------------------------------------------------------
  {
    // A beach raider's call: a hoarse, wordless growl through clenched teeth.
    id: 'sfx_kreatur_strandraeuber_laut',
    ...BEDROHUNG,
    lautstaerke: 0.5,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1.5, klang: 0.06 },
    untertitel: { de: 'Strandräuber knurrt', en: 'Beach raider growls' },
    schichten: [
      { quelle: ton('saege', 118, 96), huelle: bogen(0.08, 0.2, 0.6, 0.3, 0.3), filter: bandpass(700, 1.6), pegel: 0.6, vibrato: { tiefe: 40, rate: 7 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.08, 0.2, 0.5, 0.3, 0.3), filter: bandpass(1500, 1.2), pegel: 0.45 },
    ],
  },
  {
    // Hurt: a pained grunt.
    id: 'sfx_kreatur_strandraeuber_treffer',
    ...BEDROHUNG,
    lautstaerke: 0.48,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: puls(170, 0.3, 130), huelle: bogen(0.005, 0.06, 0.5, 0.05, 0.08), filter: bandpass(600, 1.4), pegel: 0.7 },
      { quelle: rauschen('rosa'), huelle: schlag(0.003, 0.08), filter: bandpass(1100, 1.2), pegel: 0.35 },
    ],
  },
  {
    // Death: a groan that fades into a sigh – almost relief.
    id: 'sfx_kreatur_strandraeuber_tod',
    ...BEDROHUNG,
    lautstaerke: 0.5,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 },
    untertitel: { de: 'Strandräuber fällt', en: 'Beach raider falls' },
    schichten: [
      { quelle: puls(160, 0.3, 90), huelle: bogen(0.01, 0.25, 0.5, 0.3, 0.4), filter: bandpass(550, 1.4, 350), pegel: 0.6, vibrato: { tiefe: 50, rate: 6 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.1, 0.4, 0.3, 0.2, 0.6), filter: bandpass(1800, 1.5, 900), pegel: 0.35, start: 0.4 },
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.2), filter: tiefpass(500), pegel: 0.45, start: 0.6 },
    ],
  },
  {
    // The cut of the flint blade: a swish and the bite of stone.
    id: 'sfx_kreatur_strandraeuber_hieb',
    ...BEDROHUNG,
    lautstaerke: 0.5,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.04, 0.06, 0, 0, 0.02), filter: bandpass(1600, 1.2, 4200), pegel: 0.55 },
      { quelle: knistern(900, 0.003), huelle: schlag(0.001, 0.05), filter: hochpass(1800), pegel: 0.45, start: 0.09 },
    ],
  },
]);
