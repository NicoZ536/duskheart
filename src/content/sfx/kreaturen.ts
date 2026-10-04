/**
 * Creatures (MASTERPROMPT §20.1 "Jede Kreatur: … Sounds", §19.4 "Telegraphs … klar sichtbar und hörbar", §27; docs/SPIEL.md
 * §11, §13; M6-19, M6-15, M6-28, M6-29, M6-30): the calls, hurt cries, death sounds and attack sounds each creature
 * names in its `sounds` and `angriffe[].sound` (src/content/creatures/kreaturen.ts), and the shared sounds of the
 * creature system – the telegraph glint of every wind-up, carving a carcass, setting and springing a trap, shadow brood
 * fading at sunrise and burning in glaring light.
 *
 * Every creature sounds like its body: small animals high and short, the deer's alarm bark hoarse, the quail's call three
 * bright notes, the Nachtmahr a low, detuned growl that sits under everything. Calls of peaceful animals are quiet and
 * carry little (they are ambience); what warns of danger – a telegraph, a foe's call – is louder, subtitled and heard from
 * further away (§27 "Untertitel für wichtige Laute", §2.8 Lesbarkeit).
 *
 * Mixing (M6-33, §27 "Varianten gegen Wiederholung"): the death sound of every creature that comes in numbers has two takes
 * and a little spread (only the unique Nachtmahr keeps its one), as do the signature leaps of pack and charge (wolf, boar);
 * the telegraph is one cold ping for every wind-up – the player learns one warning – as loud as the hits around it, with an
 * underlayer telling what winds up (`sfx_kreatur_telegraph_brut` for the shadow brood, `_flaeche` for area attacks with
 * their ground mark), and a lock only against doubles in one tick, so no wind-up of a pack goes unheard.
 */
import { bandpass, bogen, defineSfxGroup, fm, hochpass, knistern, puls, rauschen, schlag, tiefpass, ton } from './define';

/** Small animals: quiet, heard only nearby, several at once. */
const KLEINTIER = { bus: 'effekte', reichweite: 14, stimmen: 3, sperrzeit: 0.25 } as const;
/** Bigger animals: a little further. */
const WILD = { bus: 'effekte', reichweite: 20, stimmen: 3, sperrzeit: 0.25 } as const;
/** Threats: heard from afar, one voice at a time. */
const BEDROHUNG = { bus: 'effekte', reichweite: 32, stimmen: 2, sperrzeit: 0.4 } as const;
/**
 * Telegraphs (§19.4 "klar sichtbar und hörbar", M6-33): heard from afar like a threat, but every wind-up must sound – a
 * pack takes turns within fractions of a second, a Speier spits while a wolf leaps – so four voices and a lock only
 * against doubles in one tick (0,015 s, under the 16,7 ms of a tick; the threats' 0,4 s swallowed the second wind-up);
 * two takes with a little spread, the ping itself always the same warning.
 */
const TELEGRAPH = { bus: 'effekte', reichweite: 32, stimmen: 4, sperrzeit: 0.015, varianten: 2 } as const;

/** Handling of the hunting goods (`ITEM_SFX.fleisch` … `lumen`, src/content/items/define.ts): like the other `sfx_item_*` sounds, near and short. */
const ITEM = { bus: 'effekte', varianten: 2, streuung: { tonhoehe: 100, lautstaerke: 2, klang: 0.08 }, stimmen: 3, sperrzeit: 0.05, reichweite: 12 } as const;

export const SFX_KREATUREN = defineSfxGroup('kreaturen', [
  // -------------------------------------------------------------------------------------------
  // Hunting goods
  // -------------------------------------------------------------------------------------------
  {
    // Raw meat and fat: a soft, wet slap.
    id: 'sfx_item_fleisch',
    ...ITEM,
    lautstaerke: 0.34,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.05, 3), filter: bandpass(900, 1.2), pegel: 0.8 },
      { quelle: ton('sinus', 150, 90), huelle: schlag(0.001, 0.05, 3), pegel: 0.4 },
    ],
  },
  {
    // Hide and sinew: a dry, furry rustle.
    id: 'sfx_item_fell',
    ...ITEM,
    lautstaerke: 0.3,
    schichten: [{ quelle: rauschen('rosa'), huelle: bogen(0.01, 0.05, 0.3, 0.02, 0.05), filter: bandpass(2600, 0.9, 1600), pegel: 0.8 }],
  },
  {
    // Bones and antlers: a hollow, dry clack.
    id: 'sfx_item_knochen',
    ...ITEM,
    lautstaerke: 0.36,
    schichten: [
      { quelle: ton('dreieck', 980, 820), huelle: schlag(0.0005, 0.03, 3), pegel: 0.6, wiederholung: { anzahl: 2, abstand: 0.05, abfall: 0.6, tonhoehe: 0.9 } },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.015, 3), filter: bandpass(4200, 1.5), pegel: 0.5, wiederholung: { anzahl: 2, abstand: 0.05, abfall: 0.6 } },
    ],
  },
  {
    // Feathers: the softest brush of air.
    id: 'sfx_item_federn',
    ...ITEM,
    lautstaerke: 0.22,
    schichten: [{ quelle: rauschen('weiss'), huelle: bogen(0.02, 0.06, 0.2, 0.02, 0.06), filter: bandpass(5200, 0.8, 3600), pegel: 0.7 }],
  },
  {
    // A Lumen shard: a cold, glassy chime.
    id: 'sfx_item_lumen',
    ...ITEM,
    lautstaerke: 0.3,
    schichten: [
      { quelle: ton('sinus', 1568), huelle: schlag(0.001, 0.4, 2), pegel: 0.5 },
      { quelle: ton('sinus', 2349), huelle: schlag(0.001, 0.3, 2), pegel: 0.3 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: bandpass(6000, 2), pegel: 0.3 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Hase
  // -------------------------------------------------------------------------------------------
  {
    // Warning: the hare drums the ground with its hind legs – two soft, dull thumps.
    id: 'sfx_kreatur_hase_laut',
    ...KLEINTIER,
    lautstaerke: 0.28,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1.5, klang: 0.05 },
    schichten: [
      { quelle: ton('sinus', 120, 70), huelle: schlag(0.002, 0.07), pegel: 0.9, wiederholung: { anzahl: 2, abstand: 0.11, abfall: 0.8 } },
      { quelle: rauschen('braun'), huelle: schlag(0.002, 0.05), filter: tiefpass(500), pegel: 0.5, wiederholung: { anzahl: 2, abstand: 0.11, abfall: 0.8 } },
    ],
  },
  {
    // Hurt: a thin, high squeal.
    id: 'sfx_kreatur_hase_treffer',
    ...KLEINTIER,
    lautstaerke: 0.4,
    varianten: 2,
    streuung: { tonhoehe: 80, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: puls(1480, 0.25, 1180), huelle: bogen(0.004, 0.05, 0.5, 0.05, 0.07), filter: bandpass(2400, 2), pegel: 0.7, vibrato: { tiefe: 60, rate: 22 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.06), filter: bandpass(3200, 2), pegel: 0.3 },
    ],
  },
  {
    // Death: the squeal once more, longer, falling away.
    id: 'sfx_kreatur_hase_tod',
    ...KLEINTIER,
    lautstaerke: 0.4,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: puls(1400, 0.25, 700), huelle: bogen(0.005, 0.1, 0.5, 0.18, 0.25), filter: bandpass(2000, 2, 1100), pegel: 0.7, vibrato: { tiefe: 80, rate: 18 } },
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.12), filter: tiefpass(400), pegel: 0.4, start: 0.42 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Reh
  // -------------------------------------------------------------------------------------------
  {
    // The roe deer's alarm bark ("Schrecken"): a hoarse, short, dog-like "böh", twice.
    id: 'sfx_kreatur_reh_laut',
    ...WILD,
    lautstaerke: 0.42,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1.5, klang: 0.06 },
    untertitel: { de: 'Reh schreckt', en: 'Deer barks' },
    schichten: [
      { quelle: fm(310, 1.5, 3, 1, 240), huelle: bogen(0.01, 0.06, 0.45, 0.05, 0.08), filter: bandpass(900, 1.4), pegel: 0.7, wiederholung: { anzahl: 2, abstand: 0.42, abfall: 0.85 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.01, 0.05, 0.4, 0.05, 0.07), filter: bandpass(1400, 1.2), pegel: 0.5, wiederholung: { anzahl: 2, abstand: 0.42, abfall: 0.85 } },
    ],
  },
  {
    // Hurt: a short bleat.
    id: 'sfx_kreatur_reh_treffer',
    ...WILD,
    lautstaerke: 0.44,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: puls(620, 0.3, 520), huelle: bogen(0.006, 0.06, 0.55, 0.08, 0.1), filter: bandpass(1300, 1.6), pegel: 0.7, vibrato: { tiefe: 90, rate: 11 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.003, 0.08), filter: bandpass(2200, 1.5), pegel: 0.35 },
    ],
  },
  {
    // Death: a long bleat breaking off, the body falling.
    id: 'sfx_kreatur_reh_tod',
    ...WILD,
    lautstaerke: 0.46,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: puls(600, 0.3, 380), huelle: bogen(0.008, 0.12, 0.5, 0.25, 0.3), filter: bandpass(1100, 1.5, 700), pegel: 0.7, vibrato: { tiefe: 110, rate: 9 } },
      { quelle: ton('sinus', 90, 55), huelle: schlag(0.004, 0.18), pegel: 0.6, start: 0.6 },
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.2), filter: tiefpass(500), pegel: 0.5, start: 0.6 },
    ],
  },
  {
    // The kick: a swish of the forelegs and the hard knock of the hooves.
    id: 'sfx_kreatur_reh_tritt',
    ...WILD,
    lautstaerke: 0.5,
    varianten: 2,
    streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.03, 0.06, 0, 0, 0.02), filter: bandpass(1800, 1.5, 900), pegel: 0.5 },
      { quelle: ton('dreieck', 240, 120), huelle: schlag(0.001, 0.06), pegel: 0.7, start: 0.08 },
      { quelle: knistern(900, 0.004), huelle: schlag(0.001, 0.05), filter: hochpass(1200), pegel: 0.4, start: 0.08 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Wachtel
  // -------------------------------------------------------------------------------------------
  {
    // The quail's call "pick-wer-wick": three bright notes, the first short and loud.
    id: 'sfx_kreatur_wachtel_laut',
    ...KLEINTIER,
    lautstaerke: 0.3,
    varianten: 2,
    streuung: { tonhoehe: 40, lautstaerke: 1.5, klang: 0.04 },
    schichten: [
      { quelle: ton('sinus', 2300, 2600), huelle: bogen(0.004, 0.03, 0.5, 0.02, 0.03), pegel: 0.8 },
      { quelle: ton('sinus', 1900, 2400), huelle: bogen(0.004, 0.03, 0.5, 0.03, 0.04), pegel: 0.6, start: 0.2 },
      { quelle: ton('sinus', 2200, 2700), huelle: bogen(0.004, 0.03, 0.5, 0.03, 0.04), pegel: 0.7, start: 0.34 },
    ],
  },
  {
    // Hurt: a scratchy squawk.
    id: 'sfx_kreatur_wachtel_treffer',
    ...KLEINTIER,
    lautstaerke: 0.36,
    varianten: 2,
    streuung: { tonhoehe: 70, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: puls(1700, 0.2, 1300), huelle: bogen(0.003, 0.04, 0.4, 0.04, 0.05), filter: bandpass(2600, 2.5), pegel: 0.6, koernung: 8 },
      { quelle: rauschen('weiss'), huelle: schlag(0.002, 0.05), filter: bandpass(3800, 2), pegel: 0.3 },
    ],
  },
  {
    // Death: the squawk, a last flutter of wings.
    id: 'sfx_kreatur_wachtel_tod',
    ...KLEINTIER,
    lautstaerke: 0.36,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: puls(1600, 0.2, 900), huelle: bogen(0.004, 0.06, 0.4, 0.08, 0.12), filter: bandpass(2200, 2.5, 1400), pegel: 0.6, koernung: 8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.004, 0.03), filter: bandpass(1600, 1.2), pegel: 0.35, start: 0.2, wiederholung: { anzahl: 4, abstand: 0.06, abfall: 0.7 } },
    ],
  },
  {
    // Flushed: a burst of whirring wing beats.
    id: 'sfx_kreatur_wachtel_auffliegen',
    ...KLEINTIER,
    lautstaerke: 0.4,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1.5, klang: 0.08 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.003, 0.035), filter: bandpass(1400, 1.1), pegel: 0.7, wiederholung: { anzahl: 8, abstand: 0.045, abfall: 0.88 } },
      { quelle: ton('sinus', 160, 120), huelle: schlag(0.002, 0.03), pegel: 0.3, wiederholung: { anzahl: 8, abstand: 0.045, abfall: 0.85 } },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Nachtmahr
  // -------------------------------------------------------------------------------------------
  {
    // The Nachtmahr's growl: a low, detuned breath under everything.
    id: 'sfx_kreatur_nachtmahr_laut',
    ...BEDROHUNG,
    lautstaerke: 0.62,
    untertitel: { de: 'Nachtmahr knurrt', en: 'Nightmare growls' },
    schichten: [
      { quelle: ton('saege', 58, 46), huelle: bogen(0.2, 0.3, 0.7, 0.4, 0.5), filter: tiefpass(420, 2), pegel: 0.7, vibrato: { tiefe: 30, rate: 5 } },
      { quelle: ton('saege', 61, 49), huelle: bogen(0.2, 0.3, 0.7, 0.4, 0.5), filter: tiefpass(420, 2), pegel: 0.6, vibrato: { tiefe: 30, rate: 4 } },
      { quelle: rauschen('braun'), huelle: bogen(0.15, 0.3, 0.6, 0.4, 0.5), filter: bandpass(260, 1.5), pegel: 0.6 },
    ],
  },
  {
    // Hurt: a hiss of torn shadow.
    id: 'sfx_kreatur_nachtmahr_treffer',
    ...BEDROHUNG,
    lautstaerke: 0.52,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.004, 0.08, 0.3, 0.05, 0.12), filter: hochpass(2400, 1, 900), pegel: 0.6 },
      { quelle: ton('saege', 84, 62), huelle: schlag(0.004, 0.2), filter: tiefpass(500), pegel: 0.6 },
    ],
  },
  {
    // Death: the growl collapses into a long, falling hiss.
    id: 'sfx_kreatur_nachtmahr_tod',
    ...BEDROHUNG,
    lautstaerke: 0.6,
    untertitel: { de: 'Nachtmahr zerfällt', en: 'Nightmare dissolves' },
    schichten: [
      { quelle: ton('saege', 70, 32), huelle: bogen(0.02, 0.4, 0.5, 0.6, 1), filter: tiefpass(600, 2, 180), pegel: 0.7 },
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.4, 0.4, 0.6, 1.1), filter: hochpass(3000, 1, 600), pegel: 0.45 },
      { quelle: knistern(120, 0.01, 10), huelle: bogen(0.1, 0.6, 0.5, 0.6, 0.8), filter: hochpass(1600), pegel: 0.35 },
    ],
  },
  {
    // Stamping: the ground shakes under its forefeet.
    id: 'sfx_kreatur_nachtmahr_stampfen',
    ...BEDROHUNG,
    lautstaerke: 0.66,
    schichten: [
      { quelle: ton('sinus', 64, 34), huelle: schlag(0.003, 0.5), pegel: 0.9 },
      { quelle: rauschen('braun'), huelle: schlag(0.003, 0.4), filter: tiefpass(320), pegel: 0.7 },
      { quelle: knistern(300, 0.006, 40), huelle: schlag(0.01, 0.35), filter: bandpass(900, 1), pegel: 0.3 },
    ],
  },
  {
    // The charge: a rushing roar that swells towards the player.
    id: 'sfx_kreatur_nachtmahr_ansturm',
    ...BEDROHUNG,
    lautstaerke: 0.62,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.25, 0.1, 0.8, 0.2, 0.2), filter: bandpass(500, 1.2, 1600), pegel: 0.6 },
      { quelle: ton('saege', 52, 78), huelle: bogen(0.25, 0.1, 0.7, 0.2, 0.2), filter: tiefpass(380, 2), pegel: 0.6 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Shared sounds of the creature system
  // -------------------------------------------------------------------------------------------
  {
    // The telegraph glint of every wind-up (§19.4, docs/ART.md §8): a short, cold ping that cuts through anything – as loud
    // as the hits around it (0,46), so it is heard in the thick of a fight. Animals and foes striking at one target.
    id: 'sfx_kreatur_telegraph',
    ...TELEGRAPH,
    lautstaerke: 0.46,
    streuung: { tonhoehe: 20, lautstaerke: 0.5, klang: 0.02 },
    untertitel: { de: 'Angriff droht', en: 'Attack coming' },
    schichten: [
      { quelle: ton('sinus', 3136), huelle: schlag(0.001, 0.16), pegel: 0.6 },
      { quelle: ton('sinus', 4186), huelle: schlag(0.001, 0.1), pegel: 0.3 },
    ],
  },
  {
    // The shadow brood winds up: the same cold ping over an ink-dark hiss that swells from below – the brood's wind-up is
    // told apart in the dark, where the pose is hard to see.
    id: 'sfx_kreatur_telegraph_brut',
    ...TELEGRAPH,
    lautstaerke: 0.46,
    streuung: { tonhoehe: 20, lautstaerke: 0.5, klang: 0.04 },
    untertitel: { de: 'Schattenbrut holt aus', en: 'Shadow brood winds up' },
    schichten: [
      { quelle: ton('sinus', 3136), huelle: schlag(0.001, 0.16), pegel: 0.5 },
      { quelle: ton('sinus', 4186), huelle: schlag(0.001, 0.1), pegel: 0.25 },
      { quelle: rauschen('rosa'), huelle: bogen(0.22, 0.05, 0.6, 0.05, 0.08, 1.5), filter: bandpass(600, 2.5, 1900), pegel: 0.55 },
      { quelle: fm(110, 1.5, 2, 0.5, 150), huelle: bogen(0.2, 0.05, 0.5, 0.05, 0.08, 1.5), pegel: 0.25 },
    ],
  },
  {
    // An area attack with its ground mark (the Nachtmahr's stamp, the light eater's pull): the ping and a low rumble that
    // swells until the blow lands – step out of the ring before it peaks.
    id: 'sfx_kreatur_telegraph_flaeche',
    ...TELEGRAPH,
    lautstaerke: 0.5,
    streuung: { tonhoehe: 15, lautstaerke: 0.5, klang: 0.04 },
    untertitel: { de: 'Flächenangriff droht', en: 'Area attack coming' },
    schichten: [
      { quelle: ton('sinus', 3136), huelle: schlag(0.001, 0.16), pegel: 0.45 },
      { quelle: rauschen('braun'), huelle: bogen(0.45, 0.05, 0.7, 0.1, 0.12, 1.5), filter: tiefpass(160, 1.5, 420), pegel: 0.9 },
      { quelle: ton('sinus', 48, 70), huelle: bogen(0.45, 0.05, 0.7, 0.1, 0.12, 1.5), pegel: 0.6 },
      { quelle: knistern(60, 0.003, 260), huelle: bogen(0.4, 0.05, 0.5, 0.1, 0.12), filter: bandpass(1200, 1), pegel: 0.25, start: 0.1 },
    ],
  },
  {
    // Carving a carcass with the knife: short wet cuts.
    id: 'sfx_kreatur_zerlegen',
    bus: 'effekte',
    reichweite: 12,
    lautstaerke: 0.4,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1.5, klang: 0.08 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.01, 0.06, 0.3, 0.04, 0.06), filter: bandpass(2300, 2, 1400), pegel: 0.6, wiederholung: { anzahl: 3, abstand: 0.16, abfall: 0.85 } },
      { quelle: knistern(700, 0.003), huelle: schlag(0.004, 0.08), filter: bandpass(1000, 1), pegel: 0.3, wiederholung: { anzahl: 3, abstand: 0.16, abfall: 0.85 } },
    ],
  },
  {
    // Setting a trap: fibre drawn tight, a wooden peg driven in.
    id: 'sfx_kreatur_falle_stellen',
    bus: 'effekte',
    reichweite: 10,
    lautstaerke: 0.34,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.08, 0.3, 0.05, 0.05), filter: bandpass(1800, 3, 3000), pegel: 0.5 },
      { quelle: ton('dreieck', 330, 220), huelle: schlag(0.001, 0.05), pegel: 0.6, start: 0.24 },
      { quelle: knistern(600, 0.003), huelle: schlag(0.001, 0.04), filter: hochpass(900), pegel: 0.3, start: 0.24 },
    ],
  },
  {
    // A trap springs: the snare whips shut, the box's door claps down.
    id: 'sfx_kreatur_falle_zu',
    bus: 'effekte',
    reichweite: 18,
    lautstaerke: 0.46,
    untertitel: { de: 'Falle schnappt zu', en: 'Trap springs' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.001, 0.05), filter: bandpass(3000, 1.5, 1500), pegel: 0.6 },
      { quelle: ton('dreieck', 280, 160), huelle: schlag(0.001, 0.08), pegel: 0.7, start: 0.03 },
      { quelle: rauschen('braun'), huelle: schlag(0.002, 0.1), filter: tiefpass(700), pegel: 0.45, start: 0.03 },
    ],
  },
  {
    // Shadow brood fades at sunrise: ink thinning into a sigh.
    id: 'sfx_kreatur_verblassen',
    ...BEDROHUNG,
    lautstaerke: 0.36,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.1, 0.4, 0.4, 0.3, 0.6), filter: bandpass(2400, 2, 600), pegel: 0.6 },
      { quelle: ton('sinus', 440, 220), huelle: bogen(0.1, 0.3, 0.3, 0.3, 0.5), pegel: 0.25, vibrato: { tiefe: 50, rate: 6 } },
    ],
  },
  {
    // Shadow brood burns in glaring light: a searing crackle.
    id: 'sfx_kreatur_brennen',
    ...BEDROHUNG,
    lautstaerke: 0.4,
    varianten: 2,
    sperrzeit: 0.9,
    streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.08 },
    schichten: [
      { quelle: knistern(260, 0.004, 80), huelle: bogen(0.01, 0.2, 0.4, 0.1, 0.2), filter: hochpass(1800), pegel: 0.6 },
      { quelle: rauschen('weiss'), huelle: bogen(0.01, 0.2, 0.3, 0.1, 0.2), filter: bandpass(4200, 1.5), pegel: 0.35 },
    ],
  },
]);
