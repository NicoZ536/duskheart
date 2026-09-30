/**
 * Sounds of the fight (MASTERPROMPT §19.1 "gestaffelte Sounds", §27 "Kampf"; docs/SPIEL.md §10, §13 "Audio"; M6-33 – the
 * weapons' part): what the player's weapons make heard, by damage type and by what they do. The combat events play them
 * (src/audio/eventMap.ts: `attackStarted`, `attackWindup`, `hitLanded`, `blocked`, `parried`, `projectileFired`,
 * `projectileStuck`); the creatures' own voices and the hits per material follow in src/content/sfx/kreaturen.ts.
 *
 * - **Swings** (`attackStarted`, the weapon's `sounds.benutzen`): `hieb` a bright cut through the air, `stich` a short
 *   whip, `wucht` a low swish; the heavy attack a longer, lower sweep with a grunt of effort.
 * - **Hits** (`hitLanded` by damage type): cut, pierce and blunt as body sounds; fire whooshes and sizzles, frost cracks
 *   like ice, poison splashes and hisses, light zaps bright, shadow thuds hollow; a critical hit adds a ringing accent.
 * - **Ranged** (`attackWindup` / `projectileFired`): the bow creaks while drawn and twangs on release, the crossbow
 *   ratchets while reloading and thunks, the sling whirs and snaps, a throw swishes; an arrow thuds into ground or wood.
 * - **Defence** (`blocked`, `parried`): a block on wood, on metal, on bare arms; the guard breaking; the parry rings with
 *   sparks (subtitled – it matters to hear it).
 *
 * Which preset answers which event stands in src/audio/kampfKlaenge.ts.
 */
import { bandpass, bogen, defineSfxGroup, digital, fm, hochpass, knistern, puls, rauschen, schlag, tiefpass, ton } from './define';

/** The player's weapons: close to the listener, several takes, a little spread every time. */
const WAFFE = {
  bus: 'effekte',
  varianten: 3,
  streuung: { tonhoehe: 90, lautstaerke: 1.5, klang: 0.06 },
  stimmen: 3,
  sperrzeit: 0.04,
  reichweite: 18,
} as const;

/** Hits: heard a little farther (the fight of others), more voices (a burst hits many). */
const TREFFER = {
  bus: 'effekte',
  varianten: 3,
  streuung: { tonhoehe: 70, lautstaerke: 1.5, klang: 0.08 },
  stimmen: 6,
  sperrzeit: 0.02,
  reichweite: 22,
} as const;

/** Blocks and parries: one at a time, clear. */
const ABWEHR = {
  bus: 'effekte',
  varianten: 2,
  streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 },
  stimmen: 2,
  sperrzeit: 0.05,
  reichweite: 20,
} as const;

export const SFX_KAMPF = defineSfxGroup('kampf', [
  // --- Swings ----------------------------------------------------------------------------------
  {
    // A blade cuts the air: a bright whoosh rising and falling, a thin metallic edge.
    id: 'sfx_kampf_schwung_hieb',
    ...WAFFE,
    lautstaerke: 0.34,
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.05, 0.08, 0.4, 0.02, 0.06, 2), filter: bandpass(1800, 2.2, 4200), pegel: 1 },
      { quelle: rauschen('rosa'), huelle: schlag(0.04, 0.1, 2), filter: bandpass(900, 1.2, 1600), pegel: 0.5 },
      { quelle: ton('sinus', 2600, 3200), huelle: schlag(0.03, 0.06, 3), pegel: 0.06, start: 0.03 },
    ],
  },
  {
    // A point is thrust: a short, tight whip.
    id: 'sfx_kampf_schwung_stich',
    ...WAFFE,
    lautstaerke: 0.3,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.015, 0.06, 3), filter: bandpass(2600, 2.5, 3600), pegel: 1 },
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.05, 2), filter: bandpass(1200, 1.5), pegel: 0.4 },
    ],
  },
  {
    // A club or a fist swings: a low, heavy swish.
    id: 'sfx_kampf_schwung_wucht',
    ...WAFFE,
    lautstaerke: 0.34,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.06, 0.1, 0.4, 0.03, 0.08, 2), filter: bandpass(500, 1.6, 1100), pegel: 1 },
      { quelle: rauschen('braun'), huelle: schlag(0.05, 0.12, 2), filter: tiefpass(400), pegel: 0.6 },
    ],
  },
  {
    // The heavy attack: a long, low sweep with a short grunt of effort before it.
    id: 'sfx_kampf_schwung_schwer',
    ...WAFFE,
    lautstaerke: 0.42,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.12, 0.12, 0.5, 0.05, 0.12, 2), filter: bandpass(600, 1.4, 1800), pegel: 1, start: 0.04 },
      { quelle: rauschen('braun'), huelle: schlag(0.1, 0.2, 2), filter: tiefpass(350), pegel: 0.7, start: 0.04 },
      { quelle: puls(140, 0.35, 110), huelle: schlag(0.01, 0.08, 2), filter: bandpass(600, 2.5), vibrato: { tiefe: 40, rate: 18 }, pegel: 0.25 },
    ],
  },
  // --- Hits by damage type ---------------------------------------------------------------------
  {
    // Cut: a sharp slice and a soft body thud.
    id: 'sfx_kampf_treffer_hieb',
    ...TREFFER,
    lautstaerke: 0.5,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.001, 0.05, 3), filter: bandpass(3200, 1.6), pegel: 0.8 },
      { quelle: ton('sinus', 160, 90), huelle: schlag(0.001, 0.08, 2.5), pegel: 0.9 },
      { quelle: rauschen('rosa'), huelle: schlag(0.004, 0.09, 2), filter: tiefpass(1400), pegel: 0.5, start: 0.01 },
    ],
  },
  {
    // Pierce: a quick, wet puncture.
    id: 'sfx_kampf_treffer_stich',
    ...TREFFER,
    lautstaerke: 0.46,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.025, 3), filter: bandpass(2400, 2), pegel: 0.7 },
      { quelle: ton('sinus', 220, 120), huelle: schlag(0.001, 0.05, 3), pegel: 0.8 },
      { quelle: knistern(300, 0.002, 60), huelle: schlag(0.005, 0.07), filter: bandpass(1500, 1.4), pegel: 0.35, start: 0.01 },
    ],
  },
  {
    // Blunt: a heavy bonk.
    id: 'sfx_kampf_treffer_wucht',
    ...TREFFER,
    lautstaerke: 0.54,
    schichten: [
      { quelle: ton('sinus', 120, 55), huelle: schlag(0.001, 0.12, 2.5), pegel: 1 },
      { quelle: rauschen('braun'), huelle: schlag(0.001, 0.08, 3), filter: tiefpass(900), pegel: 0.7 },
      { quelle: rauschen('rosa'), huelle: schlag(0.0005, 0.03, 3), filter: bandpass(1300, 1.2), pegel: 0.4 },
    ],
  },
  {
    // Fire: a whoosh of flame and a sizzle.
    id: 'sfx_kampf_treffer_feuer',
    ...TREFFER,
    lautstaerke: 0.5,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.25, 2), filter: bandpass(700, 1, 2400), pegel: 0.9 },
      { quelle: knistern(160, 0.002, 40), huelle: schlag(0.01, 0.35), filter: hochpass(3500), pegel: 0.6, start: 0.03 },
      { quelle: ton('sinus', 110, 70), huelle: schlag(0.001, 0.08), pegel: 0.5 },
    ],
  },
  {
    // Frost: ice cracking, a cold glassy ring.
    id: 'sfx_kampf_treffer_frost',
    ...TREFFER,
    lautstaerke: 0.48,
    schichten: [
      { quelle: knistern(900, 0.0015, 120), huelle: schlag(0.001, 0.18, 2), filter: hochpass(2500), pegel: 0.7 },
      { quelle: fm(1200, 2.76, 2, 0.4), huelle: schlag(0.001, 0.35, 3), pegel: 0.35 },
      { quelle: ton('sinus', 140, 80), huelle: schlag(0.001, 0.06), pegel: 0.5 },
    ],
  },
  {
    // Poison: a wet splash and a hiss.
    id: 'sfx_kampf_treffer_gift',
    ...TREFFER,
    lautstaerke: 0.46,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.1, 2), filter: bandpass(900, 1.5, 500), pegel: 0.8 },
      { quelle: ton('sinus', 420, 180), huelle: schlag(0.004, 0.08), filter: bandpass(500, 3), pegel: 0.5, wiederholung: { anzahl: 2, abstand: 0.06, abfall: 0.6, tonhoehe: 1.2 } },
      { quelle: rauschen('weiss'), huelle: bogen(0.05, 0.1, 0.3, 0.1, 0.2), filter: hochpass(4500), pegel: 0.35, start: 0.05 },
    ],
  },
  {
    // Light: a bright zap and a shimmering tail.
    id: 'sfx_kampf_treffer_licht',
    ...TREFFER,
    lautstaerke: 0.46,
    schichten: [
      { quelle: puls(1320, 0.25, 660), huelle: schlag(0.001, 0.12, 2.5), filter: tiefpass(6000), pegel: 0.5 },
      { quelle: ton('sinus', 1760, 2640), huelle: schlag(0.002, 0.3, 2), vibrato: { tiefe: 30, rate: 14 }, pegel: 0.35, start: 0.02 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.03, 3), filter: hochpass(5000), pegel: 0.4 },
    ],
  },
  {
    // Shadow: a hollow, swallowed thud.
    id: 'sfx_kampf_treffer_schatten',
    ...TREFFER,
    lautstaerke: 0.5,
    schichten: [
      { quelle: ton('sinus', 90, 45), huelle: schlag(0.002, 0.2, 2), pegel: 0.9 },
      { quelle: rauschen('braun'), huelle: schlag(0.02, 0.2, 2), filter: tiefpass(500, 2, 200), pegel: 0.6 },
      { quelle: fm(220, 0.5, 3, 0.5, 160), huelle: schlag(0.01, 0.25, 2), pegel: 0.25, start: 0.02 },
    ],
  },
  {
    // A critical hit: a bright ringing accent over the hit.
    id: 'sfx_kampf_kritisch',
    ...TREFFER,
    stimmen: 2,
    lautstaerke: 0.4,
    schichten: [
      { quelle: fm(1560, 2, 2.4, 0.2), huelle: schlag(0.0005, 0.35, 3), pegel: 0.6 },
      { quelle: puls(2093, 0.25), huelle: schlag(0.001, 0.12, 3), filter: tiefpass(7000), pegel: 0.3, start: 0.02 },
    ],
  },
  // --- Ranged ----------------------------------------------------------------------------------
  {
    // The bow is drawn: the wood creaks under tension.
    id: 'sfx_kampf_bogen_spannen',
    ...WAFFE,
    lautstaerke: 0.28,
    schichten: [
      { quelle: ton('saege', 180, 240), huelle: bogen(0.1, 0.1, 0.6, 0.35, 0.1), filter: bandpass(900, 5, 1300), vibrato: { tiefe: 25, rate: 9 }, pegel: 0.6 },
      { quelle: knistern(40, 0.003, 90), huelle: bogen(0.05, 0.1, 0.5, 0.4, 0.1), filter: bandpass(1600, 1.5), pegel: 0.4 },
    ],
  },
  {
    // The bow looses: the string twangs, the arrow hisses away.
    id: 'sfx_kampf_bogen_sehne',
    ...WAFFE,
    lautstaerke: 0.4,
    schichten: [
      { quelle: puls(196, 0.4, 150), huelle: schlag(0.001, 0.18, 3), filter: tiefpass(2000), vibrato: { tiefe: 60, rate: 30 }, pegel: 0.7 },
      { quelle: rauschen('weiss'), huelle: schlag(0.005, 0.12, 2), filter: bandpass(3000, 2, 5000), pegel: 0.5, start: 0.01 },
    ],
  },
  {
    // The crossbow reloads: the ratchet clicks, the string locks.
    id: 'sfx_kampf_armbrust_laden',
    ...WAFFE,
    lautstaerke: 0.34,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: bandpass(2800, 2), pegel: 0.8, wiederholung: { anzahl: 6, abstand: 0.16, abfall: 0.95, tonhoehe: 1.03 } },
      { quelle: ton('rechteck', 330), huelle: schlag(0.0005, 0.03, 3), filter: bandpass(1200, 3), pegel: 0.3, wiederholung: { anzahl: 6, abstand: 0.16, abfall: 0.95 } },
      { quelle: fm(620, 3.1, 3, 0.3), huelle: schlag(0.001, 0.15, 3), pegel: 0.4, start: 1 },
    ],
  },
  {
    // The crossbow shoots: a hard thunk and a whirring bolt.
    id: 'sfx_kampf_armbrust_schuss',
    ...WAFFE,
    lautstaerke: 0.46,
    schichten: [
      { quelle: ton('sinus', 150, 70), huelle: schlag(0.001, 0.09, 3), pegel: 0.9 },
      { quelle: rauschen('rosa'), huelle: schlag(0.0005, 0.04, 3), filter: bandpass(1500, 1.4), pegel: 0.6 },
      { quelle: rauschen('weiss'), huelle: schlag(0.01, 0.15, 2), filter: bandpass(2500, 2.5, 4200), pegel: 0.35, start: 0.02 },
    ],
  },
  {
    // The sling whirs round the head.
    id: 'sfx_kampf_schleuder_wirbel',
    ...WAFFE,
    lautstaerke: 0.28,
    schichten: [{ quelle: rauschen('rosa'), huelle: schlag(0.08, 0.1, 1.5), filter: bandpass(800, 1.6, 1500), pegel: 1, wiederholung: { anzahl: 3, abstand: 0.17, abfall: 0.9, tonhoehe: 1.08 } }],
  },
  {
    // The sling lets go: a snap of the cord.
    id: 'sfx_kampf_schleuder_wurf',
    ...WAFFE,
    lautstaerke: 0.36,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.03, 3), filter: bandpass(2200, 1.8), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.12, 2), filter: bandpass(900, 1.4, 1800), pegel: 0.6, start: 0.01 },
    ],
  },
  {
    // A throw: the arm swishes, the piece spins away.
    id: 'sfx_kampf_wurf',
    ...WAFFE,
    lautstaerke: 0.34,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.03, 0.12, 1.5), filter: bandpass(700, 1.3, 2400), pegel: 1 },
      { quelle: rauschen('weiss'), huelle: schlag(0.02, 0.05, 2), filter: bandpass(3000, 3), pegel: 0.3, start: 0.05, wiederholung: { anzahl: 3, abstand: 0.07, abfall: 0.6 } },
    ],
  },
  {
    // An arrow or bolt thuds into ground or wood and quivers.
    id: 'sfx_kampf_pfeil_steckt',
    ...TREFFER,
    lautstaerke: 0.4,
    schichten: [
      { quelle: ton('sinus', 240, 120), huelle: schlag(0.0005, 0.05, 3), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.0005, 0.03, 3), filter: bandpass(1800, 1.4), pegel: 0.6 },
      { quelle: ton('dreieck', 320), huelle: schlag(0.002, 0.2, 2), vibrato: { tiefe: 80, rate: 28 }, filter: bandpass(600, 3), pegel: 0.3, start: 0.01 },
    ],
  },
  // --- Defence ---------------------------------------------------------------------------------
  {
    // A blow on a wooden shield: a hollow knock of boards.
    id: 'sfx_kampf_block_holz',
    ...ABWEHR,
    lautstaerke: 0.52,
    schichten: [
      { quelle: ton('sinus', 210, 150), huelle: schlag(0.0005, 0.12, 2.5), pegel: 0.9 },
      { quelle: rauschen('rosa'), huelle: schlag(0.0005, 0.06, 3), filter: bandpass(900, 2), pegel: 0.7 },
      { quelle: ton('dreieck', 420, 380), huelle: schlag(0.001, 0.08, 3), filter: bandpass(800, 4), pegel: 0.25 },
    ],
  },
  {
    // A blow on bronze – shield boss or blade: a ringing clang.
    id: 'sfx_kampf_block_metall',
    ...ABWEHR,
    lautstaerke: 0.54,
    schichten: [
      { quelle: fm(780, 2.7, 3.2, 0.4), huelle: schlag(0.0005, 0.4, 3), pegel: 0.8 },
      { quelle: ton('sinus', 390, 370), huelle: schlag(0.0005, 0.25, 2.5), pegel: 0.35 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.03, 3), filter: bandpass(3500, 1.2), pegel: 0.5 },
    ],
  },
  {
    // A blow on bare arms or a haft: a dull smack.
    id: 'sfx_kampf_block_faust',
    ...ABWEHR,
    lautstaerke: 0.42,
    schichten: [
      { quelle: ton('sinus', 150, 90), huelle: schlag(0.0005, 0.07, 3), pegel: 0.9 },
      { quelle: rauschen('rosa'), huelle: schlag(0.0005, 0.05, 3), filter: bandpass(1100, 1.3), pegel: 0.6 },
    ],
  },
  {
    // The guard breaks: a jarring crunch and a falling sweep.
    id: 'sfx_kampf_deckung_bricht',
    ...ABWEHR,
    lautstaerke: 0.56,
    untertitel: { de: 'Deckung gebrochen', en: 'Guard broken' },
    schichten: [
      { quelle: rauschen('braun'), huelle: schlag(0.001, 0.2, 2), filter: tiefpass(1200, 1.5, 300), pegel: 0.9 },
      { quelle: digital(900, 120), huelle: schlag(0.002, 0.3, 2), filter: tiefpass(3000), pegel: 0.35 },
      { quelle: ton('saege', 300, 90), huelle: schlag(0.01, 0.3, 2), filter: tiefpass(1600), pegel: 0.3 },
    ],
  },
  {
    // A parry: blade meets blade at the right moment – a bright ring with sparks.
    id: 'sfx_kampf_parade',
    ...ABWEHR,
    lautstaerke: 0.62,
    untertitel: { de: 'Pariert', en: 'Parried' },
    schichten: [
      { quelle: fm(1040, 3.01, 3, 0.5), huelle: schlag(0.0005, 0.5, 3), pegel: 0.8 },
      { quelle: ton('sinus', 2080, 2060), huelle: schlag(0.0005, 0.4, 2.5), pegel: 0.25 },
      { quelle: knistern(700, 0.0015, 50), huelle: schlag(0.004, 0.25), filter: hochpass(4500), pegel: 0.4, start: 0.01 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.025, 3), filter: bandpass(4000, 1), pegel: 0.5 },
    ],
  },
]);
