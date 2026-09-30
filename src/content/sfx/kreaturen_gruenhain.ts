/**
 * The Grünhain creatures of M6-20 … M6-22 (MASTERPROMPT §20.1 "Jede Kreatur: … Sounds", §19.4 "Telegraphs … klar sichtbar
 * und hörbar", §27; docs/SPIEL.md §11): the calls, hurt cries, death sounds and attack sounds the creatures of
 * src/content/creatures/gruenhain.ts name in their `sounds` and `angriffe[].sound`. The shared sounds of the creature system
 * (the telegraph glint, carving, traps) are src/content/sfx/kreaturen.ts.
 *
 * Every voice sounds like its body, as in the reference creatures: the small peaceful ones quiet and near (they are the
 * meadow's ambience) – the squirrel's chatter, the frog's croak, the fireflies' faint shimmer; the foes louder, carried
 * further and subtitled where they warn (§27 "Untertitel für wichtige Laute"): the boar's grunt, the badger's hiss, the wolf's
 * howl, the Dornling's rustle when the bush wakes, the wasps' angry buzz. Attack sounds land with the blow (`creatureAttack`);
 * the wind-up before it has the telegraph's ping.
 */
import { bandpass, bogen, defineSfxGroup, fm, hochpass, knistern, puls, rauschen, schlag, tiefpass, ton } from './define';

/** Small animals: quiet, heard only nearby, several at once. */
const KLEINTIER = { bus: 'effekte', reichweite: 14, stimmen: 3, sperrzeit: 0.25 } as const;
/** Hurt and death cries of the foes: a little further than a small animal's. */
const WILD = { bus: 'effekte', reichweite: 20, stimmen: 3, sperrzeit: 0.25 } as const;
/** Threats: calls and blows of the foes, heard from afar, one voice at a time. */
const BEDROHUNG = { bus: 'effekte', reichweite: 32, stimmen: 2, sperrzeit: 0.4 } as const;

export const SFX_KREATUREN_GRUENHAIN = defineSfxGroup('kreaturen_gruenhain', [
  // -------------------------------------------------------------------------------------------
  // Eichhörnchen
  // -------------------------------------------------------------------------------------------
  {
    // The squirrel scolds from the undergrowth: a quick row of dry, bright "tschuk" clicks.
    id: 'sfx_kreatur_eichhoernchen_laut',
    ...KLEINTIER,
    lautstaerke: 0.28,
    varianten: 2,
    streuung: { tonhoehe: 80, lautstaerke: 1.5, klang: 0.06 },
    schichten: [
      { quelle: puls(2300, 0.3, 1700), huelle: schlag(0.002, 0.03), filter: bandpass(2600, 2), pegel: 0.7, wiederholung: { anzahl: 5, abstand: 0.07, abfall: 0.9 } },
      { quelle: rauschen('weiss'), huelle: schlag(0.001, 0.015), filter: bandpass(4200, 2), pegel: 0.35, wiederholung: { anzahl: 5, abstand: 0.07, abfall: 0.9 } },
    ],
  },
  {
    // Hurt: a thin, sharp squeak.
    id: 'sfx_kreatur_eichhoernchen_treffer',
    ...KLEINTIER,
    lautstaerke: 0.36,
    varianten: 2,
    streuung: { tonhoehe: 90, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: puls(2600, 0.25, 2000), huelle: bogen(0.003, 0.04, 0.5, 0.03, 0.05), filter: bandpass(3000, 2), pegel: 0.7, vibrato: { tiefe: 70, rate: 26 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.04), filter: bandpass(3600, 2), pegel: 0.25 },
    ],
  },
  {
    // Death: the squeak falls away, a small body in the leaves.
    id: 'sfx_kreatur_eichhoernchen_tod',
    ...KLEINTIER,
    lautstaerke: 0.36,
    schichten: [
      { quelle: puls(2400, 0.25, 1200), huelle: bogen(0.004, 0.08, 0.5, 0.12, 0.18), filter: bandpass(2400, 2, 1300), pegel: 0.7, vibrato: { tiefe: 90, rate: 20 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.003, 0.08), filter: bandpass(1800, 1), pegel: 0.35, start: 0.34 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Glühwürmchen
  // -------------------------------------------------------------------------------------------
  {
    // Fireflies are almost silent: a faint, high shimmer of wings, only heard right beside them.
    id: 'sfx_kreatur_gluehwuermchen_laut',
    bus: 'effekte',
    reichweite: 6,
    stimmen: 2,
    sperrzeit: 0.5,
    lautstaerke: 0.12,
    varianten: 2,
    streuung: { tonhoehe: 120, lautstaerke: 2, klang: 0.08 },
    schichten: [
      { quelle: ton('sinus', 3400, 3900), huelle: bogen(0.08, 0.1, 0.6, 0.25, 0.2), pegel: 0.6, vibrato: { tiefe: 60, rate: 34 } },
      { quelle: rauschen('weiss'), huelle: bogen(0.08, 0.1, 0.4, 0.25, 0.2), filter: bandpass(6000, 1.5), pegel: 0.3 },
    ],
  },
  {
    // Hurt: a tiny click and a fizz.
    id: 'sfx_kreatur_gluehwuermchen_treffer',
    bus: 'effekte',
    reichweite: 8,
    stimmen: 2,
    sperrzeit: 0.1,
    lautstaerke: 0.18,
    schichten: [
      { quelle: knistern(1500, 0.002), huelle: schlag(0.001, 0.06), filter: hochpass(3000), pegel: 0.5 },
      { quelle: ton('sinus', 4200, 2800), huelle: schlag(0.002, 0.08), pegel: 0.4 },
    ],
  },
  {
    // Death: its light goes out – a soft, falling glass tone.
    id: 'sfx_kreatur_gluehwuermchen_tod',
    bus: 'effekte',
    reichweite: 8,
    stimmen: 2,
    sperrzeit: 0.1,
    lautstaerke: 0.2,
    schichten: [
      { quelle: ton('sinus', 2640, 1320), huelle: bogen(0.004, 0.1, 0.4, 0.1, 0.3), pegel: 0.6 },
      { quelle: ton('sinus', 3960, 1980), huelle: bogen(0.004, 0.08, 0.3, 0.08, 0.2), pegel: 0.25 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Frosch
  // -------------------------------------------------------------------------------------------
  {
    // The frog's croak: a buzzing "quaak" of quick pulses, twice.
    id: 'sfx_kreatur_frosch_laut',
    ...KLEINTIER,
    lautstaerke: 0.3,
    varianten: 2,
    streuung: { tonhoehe: 90, lautstaerke: 1.5, klang: 0.08 },
    schichten: [
      { quelle: fm(190, 0.5, 4, 2, 170), huelle: schlag(0.004, 0.035), filter: bandpass(700, 1.6), pegel: 0.8, wiederholung: { anzahl: 7, abstand: 0.028, abfall: 0.95 } },
      { quelle: fm(210, 0.5, 4, 2, 180), huelle: schlag(0.004, 0.035), filter: bandpass(700, 1.6), pegel: 0.7, start: 0.36, wiederholung: { anzahl: 7, abstand: 0.028, abfall: 0.95 } },
    ],
  },
  {
    // Hurt: a squashed, short croak.
    id: 'sfx_kreatur_frosch_treffer',
    ...KLEINTIER,
    lautstaerke: 0.32,
    varianten: 2,
    streuung: { tonhoehe: 80, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: fm(260, 0.5, 5, 1, 200), huelle: bogen(0.003, 0.03, 0.5, 0.04, 0.05), filter: bandpass(900, 1.5), pegel: 0.7 },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.05), filter: bandpass(1500, 1.5), pegel: 0.3 },
    ],
  },
  {
    // Death: a last croak that sinks, and a small wet plop.
    id: 'sfx_kreatur_frosch_tod',
    ...KLEINTIER,
    lautstaerke: 0.32,
    schichten: [
      { quelle: fm(220, 0.5, 4, 1, 120), huelle: bogen(0.004, 0.08, 0.5, 0.12, 0.15), filter: bandpass(700, 1.4, 400), pegel: 0.7 },
      { quelle: ton('sinus', 520, 180), huelle: schlag(0.002, 0.06), pegel: 0.45, start: 0.34 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Keiler
  // -------------------------------------------------------------------------------------------
  {
    // The boar grunts deep and snorts – a warning to keep off its wallow.
    id: 'sfx_kreatur_keiler_laut',
    ...BEDROHUNG,
    lautstaerke: 0.5,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1.5, klang: 0.06 },
    untertitel: { de: 'Keiler grunzt', en: 'Boar grunts' },
    schichten: [
      { quelle: ton('saege', 96, 78), huelle: bogen(0.01, 0.05, 0.6, 0.06, 0.06), filter: bandpass(420, 1.8), pegel: 0.8, koernung: 8, wiederholung: { anzahl: 3, abstand: 0.19, abfall: 0.8 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.02, 0.06, 0.4, 0.05, 0.08), filter: bandpass(1100, 1.2), pegel: 0.5, start: 0.62 },
    ],
  },
  {
    // Hurt: a loud, piercing squeal.
    id: 'sfx_kreatur_keiler_treffer',
    ...WILD,
    lautstaerke: 0.5,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: puls(980, 0.3, 760), huelle: bogen(0.006, 0.06, 0.6, 0.1, 0.1), filter: bandpass(1500, 1.6), pegel: 0.7, vibrato: { tiefe: 80, rate: 14 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.003, 0.1), filter: bandpass(2200, 1.4), pegel: 0.35 },
    ],
  },
  {
    // Death: the squeal breaks into grunts; the heavy body falls.
    id: 'sfx_kreatur_keiler_tod',
    ...WILD,
    lautstaerke: 0.52,
    schichten: [
      { quelle: puls(900, 0.3, 420), huelle: bogen(0.006, 0.12, 0.6, 0.2, 0.25), filter: bandpass(1300, 1.6, 700), pegel: 0.7, vibrato: { tiefe: 100, rate: 11 } },
      { quelle: ton('saege', 90, 60), huelle: bogen(0.01, 0.05, 0.5, 0.05, 0.06), filter: tiefpass(400), pegel: 0.5, start: 0.5, wiederholung: { anzahl: 2, abstand: 0.16, abfall: 0.7 } },
      { quelle: ton('sinus', 70, 40), huelle: schlag(0.003, 0.25), pegel: 0.7, start: 0.72 },
      { quelle: rauschen('braun'), huelle: schlag(0.003, 0.22), filter: tiefpass(450), pegel: 0.5, start: 0.72 },
    ],
  },
  {
    // The charge: a snort, then hooves drumming towards the player.
    id: 'sfx_kreatur_keiler_ansturm',
    ...BEDROHUNG,
    lautstaerke: 0.58,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.01, 0.05, 0.5, 0.04, 0.06), filter: bandpass(1300, 1.4, 700), pegel: 0.6 },
      { quelle: ton('sinus', 110, 60), huelle: schlag(0.002, 0.07), pegel: 0.8, start: 0.08, wiederholung: { anzahl: 5, abstand: 0.075, abfall: 1 } },
      { quelle: rauschen('braun'), huelle: schlag(0.002, 0.06), filter: tiefpass(600), pegel: 0.6, start: 0.08, wiederholung: { anzahl: 5, abstand: 0.075, abfall: 1 } },
    ],
  },
  {
    // The tusk blow: a swish of the head and the hard click of the tusks.
    id: 'sfx_kreatur_keiler_hauer',
    ...BEDROHUNG,
    lautstaerke: 0.5,
    varianten: 2,
    streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.03, 0.05, 0, 0, 0.02), filter: bandpass(1600, 1.5, 3200), pegel: 0.5 },
      { quelle: ton('dreieck', 1300, 900), huelle: schlag(0.0005, 0.04, 3), pegel: 0.6, start: 0.07 },
      { quelle: ton('saege', 88, 70), huelle: schlag(0.004, 0.1), filter: tiefpass(360), pegel: 0.45, start: 0.05 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Dachs
  // -------------------------------------------------------------------------------------------
  {
    // The badger defends its sett: a rasping hiss over a low growl.
    id: 'sfx_kreatur_dachs_laut',
    ...BEDROHUNG,
    lautstaerke: 0.44,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1.5, klang: 0.06 },
    untertitel: { de: 'Dachs faucht', en: 'Badger hisses' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.02, 0.1, 0.6, 0.35, 0.15), filter: bandpass(3200, 1.2), pegel: 0.6 },
      { quelle: ton('saege', 128, 112), huelle: bogen(0.03, 0.1, 0.6, 0.35, 0.15), filter: tiefpass(520, 2), pegel: 0.6, vibrato: { tiefe: 45, rate: 16 }, koernung: 8 },
    ],
  },
  {
    // Hurt: a sharp yelping grunt.
    id: 'sfx_kreatur_dachs_treffer',
    ...WILD,
    lautstaerke: 0.44,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: puls(640, 0.3, 480), huelle: bogen(0.004, 0.05, 0.5, 0.05, 0.08), filter: bandpass(1100, 1.6), pegel: 0.7 },
      { quelle: rauschen('rosa'), huelle: schlag(0.003, 0.07), filter: bandpass(1800, 1.4), pegel: 0.35 },
    ],
  },
  {
    // Death: a whine that sinks into a last breath.
    id: 'sfx_kreatur_dachs_tod',
    ...WILD,
    lautstaerke: 0.44,
    schichten: [
      { quelle: puls(600, 0.3, 300), huelle: bogen(0.006, 0.12, 0.5, 0.2, 0.25), filter: bandpass(900, 1.5, 500), pegel: 0.7, vibrato: { tiefe: 70, rate: 8 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.1, 0.4, 0.1, 0.3), filter: bandpass(1400, 1), pegel: 0.3, start: 0.45 },
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.16), filter: tiefpass(420), pegel: 0.45, start: 0.5 },
    ],
  },
  {
    // The bite: a snarl and the snap of jaws.
    id: 'sfx_kreatur_dachs_biss',
    ...BEDROHUNG,
    lautstaerke: 0.48,
    varianten: 2,
    streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: ton('saege', 150, 120), huelle: bogen(0.01, 0.04, 0.5, 0.04, 0.03), filter: tiefpass(700, 2), pegel: 0.5, koernung: 8 },
      { quelle: knistern(1200, 0.003), huelle: schlag(0.0005, 0.04), filter: hochpass(1500), pegel: 0.6, start: 0.1 },
      { quelle: ton('dreieck', 700, 420), huelle: schlag(0.0005, 0.03, 3), pegel: 0.5, start: 0.1 },
    ],
  },
  {
    // The claws: three quick scratches through fur and cloth.
    id: 'sfx_kreatur_dachs_kratzer',
    ...BEDROHUNG,
    lautstaerke: 0.46,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.08 },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.004, 0.03, 0.3, 0.02, 0.03), filter: bandpass(3400, 2, 2200), pegel: 0.7, wiederholung: { anzahl: 3, abstand: 0.07, abfall: 0.85, tonhoehe: 0.92 } },
      { quelle: knistern(800, 0.002), huelle: schlag(0.002, 0.05), filter: hochpass(2000), pegel: 0.35, wiederholung: { anzahl: 3, abstand: 0.07, abfall: 0.85 } },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Wolf
  // -------------------------------------------------------------------------------------------
  {
    // The wolf's howl: it rises, holds and falls – the pack answers from the dark.
    id: 'sfx_kreatur_wolf_laut',
    ...BEDROHUNG,
    reichweite: 48,
    lautstaerke: 0.48,
    varianten: 2,
    streuung: { tonhoehe: 70, lautstaerke: 1.5, klang: 0.05 },
    untertitel: { de: 'Wolf heult', en: 'Wolf howls' },
    schichten: [
      { quelle: ton('sinus', 380, 560), huelle: bogen(0.2, 0.3, 0.8, 0.6, 0.5), pegel: 0.7, vibrato: { tiefe: 25, rate: 5 } },
      { quelle: ton('dreieck', 760, 1120), huelle: bogen(0.2, 0.3, 0.6, 0.6, 0.5), filter: tiefpass(1800), pegel: 0.25, vibrato: { tiefe: 25, rate: 5 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.2, 0.3, 0.3, 0.6, 0.5), filter: bandpass(900, 1.2), pegel: 0.2 },
    ],
  },
  {
    // Hurt: a yelp.
    id: 'sfx_kreatur_wolf_treffer',
    ...WILD,
    lautstaerke: 0.46,
    varianten: 2,
    streuung: { tonhoehe: 70, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: puls(1100, 0.3, 700), huelle: bogen(0.003, 0.05, 0.5, 0.04, 0.07), filter: bandpass(1400, 1.6), pegel: 0.7 },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.05), filter: bandpass(2400, 1.5), pegel: 0.3 },
    ],
  },
  {
    // Death: a whimper that fades, the body falls.
    id: 'sfx_kreatur_wolf_tod',
    ...WILD,
    lautstaerke: 0.46,
    schichten: [
      { quelle: puls(900, 0.3, 450), huelle: bogen(0.006, 0.12, 0.5, 0.25, 0.3), filter: bandpass(1100, 1.5, 600), pegel: 0.65, vibrato: { tiefe: 60, rate: 7 } },
      { quelle: ton('sinus', 80, 45), huelle: schlag(0.004, 0.2), pegel: 0.55, start: 0.6 },
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.2), filter: tiefpass(500), pegel: 0.45, start: 0.6 },
    ],
  },
  {
    // The bite: a snarl and the clack of teeth.
    id: 'sfx_kreatur_wolf_biss',
    ...BEDROHUNG,
    lautstaerke: 0.5,
    varianten: 2,
    streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: ton('saege', 170, 140), huelle: bogen(0.01, 0.04, 0.5, 0.05, 0.03), filter: tiefpass(800, 2), pegel: 0.5, vibrato: { tiefe: 40, rate: 22 }, koernung: 8 },
      { quelle: ton('dreieck', 900, 500), huelle: schlag(0.0005, 0.035, 3), pegel: 0.6, start: 0.1 },
      { quelle: knistern(1400, 0.002), huelle: schlag(0.0005, 0.03), filter: hochpass(1800), pegel: 0.5, start: 0.1 },
    ],
  },
  {
    // The pounce: a rising snarl, the rush of the leap, the impact.
    id: 'sfx_kreatur_wolf_sprung',
    ...BEDROHUNG,
    lautstaerke: 0.54,
    schichten: [
      { quelle: ton('saege', 140, 210), huelle: bogen(0.02, 0.08, 0.6, 0.08, 0.05), filter: tiefpass(900, 2), pegel: 0.5, koernung: 8 },
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.05, 0.3, 0.05, 0.05), filter: bandpass(1200, 1.2, 2600), pegel: 0.5 },
      { quelle: ton('sinus', 100, 55), huelle: schlag(0.002, 0.14), pegel: 0.6, start: 0.2 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Dornling
  // -------------------------------------------------------------------------------------------
  {
    // The bush wakes: leaves rustle hard, wood creaks, a dry hiss from the hollow – the warning before the thorns.
    id: 'sfx_kreatur_dornling_laut',
    ...BEDROHUNG,
    lautstaerke: 0.5,
    varianten: 2,
    streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.06 },
    untertitel: { de: 'Busch raschelt', en: 'Bush rustles' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.005, 0.05), filter: bandpass(2600, 1.2), pegel: 0.7, wiederholung: { anzahl: 6, abstand: 0.05, abfall: 0.92 } },
      { quelle: fm(95, 1.41, 6, 2), huelle: bogen(0.05, 0.1, 0.5, 0.12, 0.1), filter: bandpass(500, 2), pegel: 0.45 },
      { quelle: rauschen('weiss'), huelle: bogen(0.04, 0.08, 0.5, 0.12, 0.12), filter: hochpass(3500), pegel: 0.35, start: 0.2 },
    ],
  },
  {
    // Hurt: green wood cracks, leaves shake.
    id: 'sfx_kreatur_dornling_treffer',
    ...WILD,
    lautstaerke: 0.46,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: knistern(900, 0.004), huelle: schlag(0.001, 0.08), filter: bandpass(1400, 1.2), pegel: 0.6 },
      { quelle: ton('dreieck', 420, 300), huelle: schlag(0.001, 0.06), pegel: 0.45 },
      { quelle: rauschen('rosa'), huelle: schlag(0.004, 0.04), filter: bandpass(2800, 1.2), pegel: 0.45, wiederholung: { anzahl: 3, abstand: 0.05, abfall: 0.8 } },
    ],
  },
  {
    // Death: the creature creaks, collapses and withers with a long, falling rustle.
    id: 'sfx_kreatur_dornling_tod',
    ...WILD,
    lautstaerke: 0.48,
    schichten: [
      { quelle: fm(110, 1.41, 6, 1, 60), huelle: bogen(0.02, 0.2, 0.5, 0.2, 0.3), filter: bandpass(420, 2, 250), pegel: 0.55 },
      { quelle: rauschen('rosa'), huelle: schlag(0.005, 0.06), filter: bandpass(2400, 1.2, 1200), pegel: 0.6, start: 0.1, wiederholung: { anzahl: 8, abstand: 0.07, abfall: 0.85 } },
      { quelle: knistern(600, 0.005), huelle: schlag(0.002, 0.2), filter: bandpass(1000, 1), pegel: 0.4, start: 0.55 },
    ],
  },
  {
    // The thorn vine whips out: a swish that climbs and a sharp crack.
    id: 'sfx_kreatur_dornling_peitsche',
    ...BEDROHUNG,
    lautstaerke: 0.5,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.06, 0.04, 0, 0, 0.02), filter: bandpass(1200, 1.5, 4200), pegel: 0.6 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.03, 3), filter: hochpass(2500), pegel: 0.6, start: 0.1 },
      { quelle: ton('dreieck', 1600, 900), huelle: schlag(0.0005, 0.03, 3), pegel: 0.4, start: 0.1 },
    ],
  },
  {
    // The ambush: the bush bursts open – a roar of leaves and the snap of the maw.
    id: 'sfx_kreatur_dornling_ueberfall',
    ...BEDROHUNG,
    lautstaerke: 0.6,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.01, 0.1, 0.5, 0.08, 0.12), filter: bandpass(2000, 0.9), pegel: 0.7 },
      { quelle: fm(80, 1.41, 8, 3, 140), huelle: bogen(0.01, 0.08, 0.5, 0.08, 0.1), filter: tiefpass(600, 2), pegel: 0.55 },
      { quelle: knistern(1400, 0.003), huelle: schlag(0.0005, 0.05), filter: hochpass(1500), pegel: 0.55, start: 0.16 },
      { quelle: ton('dreieck', 600, 300), huelle: schlag(0.0005, 0.05, 3), pegel: 0.45, start: 0.16 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Wespenschwarm
  // -------------------------------------------------------------------------------------------
  {
    // The swarm's angry buzz: two detuned drones beating against each other.
    id: 'sfx_kreatur_wespenschwarm_laut',
    ...BEDROHUNG,
    lautstaerke: 0.42,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1.5, klang: 0.06 },
    untertitel: { de: 'Wespen summen', en: 'Wasps buzz' },
    schichten: [
      { quelle: ton('saege', 218, 236), huelle: bogen(0.1, 0.1, 0.8, 0.6, 0.3), filter: bandpass(900, 1.2), pegel: 0.55, vibrato: { tiefe: 40, rate: 9 } },
      { quelle: ton('saege', 231, 248), huelle: bogen(0.1, 0.1, 0.8, 0.6, 0.3), filter: bandpass(1300, 1.2), pegel: 0.45, vibrato: { tiefe: 55, rate: 13 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.1, 0.1, 0.4, 0.6, 0.3), filter: bandpass(2200, 1.5), pegel: 0.25 },
    ],
  },
  {
    // Hurt: the buzz jumps up, scattered.
    id: 'sfx_kreatur_wespenschwarm_treffer',
    ...WILD,
    lautstaerke: 0.4,
    varianten: 2,
    streuung: { tonhoehe: 80, lautstaerke: 1, klang: 0.08 },
    schichten: [
      { quelle: ton('saege', 260, 330), huelle: bogen(0.01, 0.05, 0.6, 0.12, 0.12), filter: bandpass(1200, 1.3), pegel: 0.6, vibrato: { tiefe: 80, rate: 18 } },
      { quelle: rauschen('weiss'), huelle: schlag(0.002, 0.05), filter: bandpass(3000, 1.5), pegel: 0.3 },
    ],
  },
  {
    // Death: the swarm falls apart – the buzz drops and thins out.
    id: 'sfx_kreatur_wespenschwarm_tod',
    ...WILD,
    lautstaerke: 0.4,
    schichten: [
      { quelle: ton('saege', 240, 90), huelle: bogen(0.02, 0.2, 0.6, 0.3, 0.4), filter: bandpass(900, 1.2, 400), pegel: 0.6, vibrato: { tiefe: 90, rate: 12 } },
      { quelle: knistern(200, 0.004, 20), huelle: bogen(0.05, 0.2, 0.5, 0.3, 0.4), filter: hochpass(1800), pegel: 0.35 },
    ],
  },
  {
    // The sting: the buzz swells, then a sharp high prick.
    id: 'sfx_kreatur_wespenschwarm_stechen',
    ...BEDROHUNG,
    lautstaerke: 0.48,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: ton('saege', 230, 300), huelle: bogen(0.05, 0.05, 0.6, 0.05, 0.06), filter: bandpass(1100, 1.3), pegel: 0.55, vibrato: { tiefe: 60, rate: 16 } },
      { quelle: ton('sinus', 5200, 3800), huelle: schlag(0.0005, 0.03, 3), pegel: 0.5, start: 0.12 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: hochpass(4000), pegel: 0.4, start: 0.12 },
    ],
  },
]);
