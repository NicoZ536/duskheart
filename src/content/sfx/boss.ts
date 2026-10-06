/**
 * The boss fight's sounds (MASTERPROMPT §20.2, §19.4 "Telegraphs … klar sichtbar und hörbar", §27; docs/SPIEL.md §22; strand
 * F, M7-32 … M7-34): the Borkenvater waking with a groan of old wood, its phase change cracking the bark, the roots bursting
 * out of the ground where a telegraphed area lands, the cast of a summon, the leaf storm, the arena catching fire, the fall
 * of the tree; its servants, the Zweiglinge (calls, hurt, death, their scratch); the heart shard taken into the body. The
 * telegraph before an area attack is the creatures' area rumble (`sfx_kreatur_telegraph_flaeche`, src/content/sfx/kreaturen.ts);
 * hits on the bark are the fight's hits on wood (`KAMPF_MATERIAL_SFX.holz`). The boss music and the victory stinger are
 * strand A's (`borkenvater`, `boss_besiegt`).
 *
 * Everything of the boss is heard across its arena (radius 9 tiles plus the margin): range 32–48, one voice, subtitled.
 */
import { bandpass, bogen, defineSfxGroup, fm, hochpass, knistern, puls, rauschen, schlag, tiefpass, ton } from './define';

/** The boss: heard across the arena and beyond, one voice at a time. */
const BOSS = { bus: 'effekte', reichweite: 48, stimmen: 1, sperrzeit: 0.3 } as const;
/** Its attacks landing: across the arena, two at once (a fan of roots). */
const WURZEL = { bus: 'effekte', reichweite: 36, stimmen: 2, sperrzeit: 0.08 } as const;
/** The servants' threats: like the foes of the Grünhain (src/content/sfx/kreaturen_gruenhain.ts `BEDROHUNG`). */
const DIENER = { bus: 'effekte', reichweite: 32, stimmen: 2, sperrzeit: 0.4 } as const;
/** The servants' hurt and death: a little closer. */
const DIENER_NAH = { bus: 'effekte', reichweite: 20, stimmen: 3, sperrzeit: 0.25 } as const;

export const SFX_BOSS = defineSfxGroup('boss', [
  // -------------------------------------------------------------------------------------------
  // Borkenvater
  // -------------------------------------------------------------------------------------------
  {
    // It wakes: a long groan of a trunk bending, low wooden creaks, the earth rumbling as the roots pull free.
    id: 'sfx_boss_erwachen',
    ...BOSS,
    lautstaerke: 0.72,
    varianten: 1,
    untertitel: { de: 'Der Borkenvater erwacht', en: 'The Barkfather awakens' },
    schichten: [
      { quelle: fm(55, 1.5, 5, 2, 42), huelle: bogen(0.4, 0.6, 0.8, 1.2, 1.2), filter: tiefpass(700), pegel: 0.8, vibrato: { tiefe: 30, rate: 3 } },
      { quelle: knistern(14, 0.02, 5), huelle: bogen(0.2, 0.4, 0.7, 1.4, 1), filter: bandpass(900, 1.4), pegel: 0.55 },
      { quelle: rauschen('braun'), huelle: bogen(0.6, 0.5, 0.7, 1.2, 1), filter: tiefpass(220), pegel: 0.7 },
      { quelle: ton('saege', 110, 82), huelle: bogen(0.5, 0.6, 0.5, 1, 1), filter: bandpass(420, 3), pegel: 0.3, start: 0.3 },
    ],
  },
  {
    // A new phase: the bark cracks open, a deep crack and splinters.
    id: 'sfx_boss_phase',
    ...BOSS,
    lautstaerke: 0.7,
    varianten: 2,
    streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.05 },
    untertitel: { de: 'Borke birst', en: 'Bark bursts' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.001, 0.12, 3), filter: bandpass(1600, 1.2), pegel: 0.8 },
      { quelle: ton('sinus', 90, 45), huelle: schlag(0.002, 0.5, 2), pegel: 0.85 },
      { quelle: knistern(60, 0.01, 8), huelle: bogen(0.01, 0.3, 0.4, 0.4, 0.5), filter: hochpass(1400), pegel: 0.5, start: 0.05 },
      { quelle: fm(70, 1.41, 4, 1, 50), huelle: bogen(0.1, 0.4, 0.5, 0.5, 0.6), filter: tiefpass(500), pegel: 0.5, start: 0.15 },
    ],
  },
  {
    // A telegraphed area lands: roots burst out of the ground – a thump, earth thrown up, wood splintering.
    id: 'sfx_boss_wurzel',
    ...WURZEL,
    lautstaerke: 0.66,
    varianten: 3,
    streuung: { tonhoehe: 120, lautstaerke: 1.5, klang: 0.08 },
    untertitel: { de: 'Wurzeln brechen hervor', en: 'Roots burst out' },
    schichten: [
      { quelle: ton('sinus', 110, 48), huelle: schlag(0.002, 0.28, 3), pegel: 0.9 },
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.35, 2), filter: tiefpass(600), pegel: 0.7 },
      { quelle: knistern(80, 0.008, 10), huelle: schlag(0.002, 0.3, 2), filter: bandpass(2200, 1), pegel: 0.55, start: 0.02 },
    ],
  },
  {
    // The cast of a summon: a creaking whisper rising through the roots.
    id: 'sfx_boss_beschwoeren',
    ...BOSS,
    lautstaerke: 0.5,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.06 },
    untertitel: { de: 'Zweige regen sich', en: 'Twigs stir' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.2, 0.2, 0.6, 0.3, 0.3), filter: bandpass(1200, 2, 2600), pegel: 0.6 },
      { quelle: knistern(30, 0.012, 70), huelle: bogen(0.1, 0.2, 0.6, 0.4, 0.3), filter: bandpass(1800, 1.2), pegel: 0.6 },
      { quelle: fm(130, 2, 3, 1, 200), huelle: bogen(0.3, 0.2, 0.5, 0.3, 0.3), filter: tiefpass(900), pegel: 0.35 },
    ],
  },
  {
    // The leaf storm: a gust tearing through the crown, thousands of leaves.
    id: 'sfx_boss_sturm',
    ...BOSS,
    lautstaerke: 0.6,
    varianten: 1,
    untertitel: { de: 'Blättersturm', en: 'Leaf storm' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.6, 0.5, 0.7, 1.4, 1), filter: bandpass(700, 0.8, 1600), pegel: 0.8 },
      { quelle: knistern(400, 0.004, 900), huelle: bogen(0.4, 0.5, 0.6, 1.6, 0.9), filter: hochpass(2600), pegel: 0.45 },
      { quelle: rauschen('braun'), huelle: bogen(0.5, 0.6, 0.6, 1.2, 1), filter: tiefpass(180), pegel: 0.5 },
    ],
  },
  {
    // The arena catches fire: a whoosh of dry wood going up, crackling.
    id: 'sfx_boss_brand',
    ...BOSS,
    lautstaerke: 0.64,
    varianten: 1,
    untertitel: { de: 'Die Arena brennt', en: 'The arena burns' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.15, 0.6, 0.5, 0.8, 0.9), filter: bandpass(500, 0.9, 1400), pegel: 0.8 },
      { quelle: knistern(40, 0.006, 90), huelle: bogen(0.05, 0.5, 0.6, 1.2, 0.8), filter: hochpass(1600), pegel: 0.7 },
      { quelle: ton('sinus', 70, 50), huelle: schlag(0.01, 0.6, 2), pegel: 0.5 },
    ],
  },
  {
    // The fall: the trunk splits and crashes down, the earth shakes, a last creak.
    id: 'sfx_boss_fall',
    ...BOSS,
    lautstaerke: 0.8,
    varianten: 1,
    untertitel: { de: 'Der Borkenvater fällt', en: 'The Barkfather falls' },
    schichten: [
      { quelle: fm(60, 1.5, 6, 1, 38), huelle: bogen(0.05, 0.4, 0.6, 0.6, 0.8), filter: tiefpass(800), pegel: 0.7 },
      { quelle: rauschen('weiss'), huelle: schlag(0.002, 0.2, 3), filter: bandpass(1800, 1), pegel: 0.6, start: 0.4 },
      { quelle: ton('sinus', 70, 30), huelle: schlag(0.004, 1.2, 2), pegel: 0.95, start: 0.9 },
      { quelle: rauschen('braun'), huelle: bogen(0.01, 0.8, 0.4, 0.6, 1), filter: tiefpass(260), pegel: 0.8, start: 0.9 },
      { quelle: knistern(50, 0.01, 6), huelle: bogen(0.01, 0.6, 0.4, 0.6, 0.8), filter: bandpass(1600, 1), pegel: 0.5, start: 0.92 },
    ],
  },
  {
    // The heart shard passes into the body: a warm double beat and a bright chime.
    id: 'sfx_boss_herzsplitter',
    bus: 'effekte',
    reichweite: 8,
    stimmen: 1,
    sperrzeit: 0.2,
    lautstaerke: 0.5,
    varianten: 1,
    untertitel: { de: 'Herzsplitter', en: 'Heart shard' },
    schichten: [
      { quelle: ton('sinus', 70, 55), huelle: schlag(0.004, 0.16, 3), pegel: 0.9, wiederholung: { anzahl: 2, abstand: 0.22, abfall: 0.8 } },
      { quelle: ton('dreieck', 784), huelle: bogen(0.02, 0.3, 0.4, 0.3, 0.6), pegel: 0.4, start: 0.45, wiederholung: { anzahl: 3, abstand: 0.12, abfall: 0.9, tonhoehe: 1.26 } },
      { quelle: ton('sinus', 1568), huelle: bogen(0.05, 0.4, 0.3, 0.3, 0.6), pegel: 0.2, start: 0.5 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Zweigling (the Borkenvater's servants)
  // -------------------------------------------------------------------------------------------
  {
    // The call: a dry rattle of twigs and a hollow, rising creak – it hunts.
    id: 'sfx_boss_zweigling_laut',
    ...DIENER,
    lautstaerke: 0.5,
    varianten: 2,
    streuung: { tonhoehe: 70, lautstaerke: 1.5, klang: 0.06 },
    untertitel: { de: 'Zweigling knarrt', en: 'Twigling creaks' },
    schichten: [
      { quelle: knistern(70, 0.01, 30), huelle: bogen(0.02, 0.1, 0.6, 0.2, 0.15), filter: bandpass(2200, 1.2), pegel: 0.7 },
      { quelle: fm(180, 1.5, 4, 1, 260), huelle: bogen(0.05, 0.1, 0.6, 0.15, 0.15), filter: bandpass(700, 2), pegel: 0.5 },
    ],
  },
  {
    // Hurt: green wood cracking.
    id: 'sfx_boss_zweigling_treffer',
    ...DIENER_NAH,
    lautstaerke: 0.44,
    varianten: 2,
    streuung: { tonhoehe: 80, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.001, 0.06, 3), filter: bandpass(2000, 1.4), pegel: 0.7 },
      { quelle: puls(420, 0.3, 300), huelle: schlag(0.002, 0.08, 2), filter: tiefpass(1400), pegel: 0.5 },
    ],
  },
  {
    // Death: it falls apart into a heap of twigs.
    id: 'sfx_boss_zweigling_tod',
    ...DIENER_NAH,
    lautstaerke: 0.46,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.08 },
    schichten: [
      { quelle: knistern(120, 0.008, 20), huelle: bogen(0.005, 0.2, 0.4, 0.2, 0.3), filter: bandpass(1800, 1), pegel: 0.75 },
      { quelle: rauschen('rosa'), huelle: schlag(0.004, 0.25, 2), filter: bandpass(900, 1), pegel: 0.5, start: 0.1 },
      { quelle: fm(160, 1.41, 3, 0, 90), huelle: schlag(0.01, 0.3, 2), filter: tiefpass(800), pegel: 0.4 },
    ],
  },
  {
    // Its scratch: twig claws whip across.
    id: 'sfx_boss_zweigling_kratzer',
    ...DIENER,
    lautstaerke: 0.46,
    varianten: 2,
    streuung: { tonhoehe: 90, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.01, 0.06, 0.4, 0.05, 0.08), filter: bandpass(3200, 1.2, 1800), pegel: 0.7 },
      { quelle: knistern(160, 0.004), huelle: schlag(0.004, 0.12, 2), filter: hochpass(2000), pegel: 0.5 },
    ],
  },
]);
