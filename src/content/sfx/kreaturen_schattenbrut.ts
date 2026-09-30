/**
 * The shadow brood's base family (MASTERPROMPT §20.1 "Jede Kreatur: … Sounds", §12.4, §19.4 "Telegraphs … hörbar", §27;
 * M6-25, M6-26): call, hurt cry, death and one sound per attack of Schleicher, Kriecher, Speier and Lichtfresser – the ids
 * their records name (src/content/creatures/schattenbrut.ts).
 *
 * The brood is made of ink smoke, so it sounds of breath and air rather than of throats: the Schleicher whispers and
 * hisses, the Kriecher gurgles wetly, the Speier's sac bubbles before it hawks, and the light eater draws a long, hollow
 * breath that rises as it sucks the flames in. A hit tears the smoke (a hiss), a death disperses it into sparks (a fading
 * crackle). Everything that warns – a call, a heavy wind-up – is subtitled and heard from afar (§27).
 */
import { bandpass, bogen, defineSfxGroup, fm, hochpass, knistern, rauschen, schlag, tiefpass, ton } from './define';

/** Threats: heard from afar, one voice at a time. */
const BEDROHUNG = { bus: 'effekte', reichweite: 32, stimmen: 2, sperrzeit: 0.4 } as const;
/** Blows and bites of the brood: near, a few at once. */
const SCHLAG = { bus: 'effekte', reichweite: 24, stimmen: 3, sperrzeit: 0.1 } as const;

export const SFX_KREATUREN_SCHATTENBRUT = defineSfxGroup('kreaturen_schattenbrut', [
  // -------------------------------------------------------------------------------------------
  // Schleicher
  // -------------------------------------------------------------------------------------------
  {
    // Its call: a dry whisper of air that rises into a hiss.
    id: 'sfx_kreatur_schleicher_laut',
    ...BEDROHUNG,
    lautstaerke: 0.42,
    varianten: 3,
    streuung: { tonhoehe: 80, lautstaerke: 1.5, klang: 0.08 },
    untertitel: { de: 'Schleicher zischt', en: 'Stalker hisses' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.15, 0.2, 0.6, 0.2, 0.25), filter: bandpass(2400, 2.5, 4200), pegel: 0.6 },
      { quelle: rauschen('rosa'), huelle: bogen(0.1, 0.2, 0.4, 0.2, 0.2), filter: bandpass(900, 2), pegel: 0.35, vibrato: { tiefe: 60, rate: 7 } },
    ],
  },
  {
    // Hurt: the smoke tears – a sharp hiss.
    id: 'sfx_kreatur_schleicher_treffer',
    ...SCHLAG,
    lautstaerke: 0.46,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.003, 0.08, 0.3, 0.04, 0.1), filter: hochpass(2600, 1, 1100), pegel: 0.6 },
      { quelle: ton('saege', 160, 110), huelle: schlag(0.003, 0.12), filter: tiefpass(700), pegel: 0.4 },
    ],
  },
  {
    // Death: the smoke disperses into sparks – a falling hiss and a fading crackle.
    id: 'sfx_kreatur_schleicher_tod',
    ...BEDROHUNG,
    lautstaerke: 0.46,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.02, 0.3, 0.4, 0.3, 0.5), filter: hochpass(3200, 1, 700), pegel: 0.55 },
      { quelle: knistern(180, 0.006, 20), huelle: bogen(0.05, 0.4, 0.5, 0.2, 0.4), filter: hochpass(1800), pegel: 0.4 },
    ],
  },
  {
    // The claw: a quick rake through the air.
    id: 'sfx_kreatur_schleicher_klaue',
    ...SCHLAG,
    lautstaerke: 0.44,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
    schichten: [{ quelle: rauschen('weiss'), huelle: bogen(0.03, 0.05, 0, 0, 0.02), filter: bandpass(2200, 1.4, 5200), pegel: 0.6, wiederholung: { anzahl: 2, abstand: 0.05, abfall: 0.7 } }],
  },
  {
    // The leap: a rush of smoke towards the player.
    id: 'sfx_kreatur_schleicher_sprung',
    ...SCHLAG,
    lautstaerke: 0.5,
    varianten: 2,
    streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.08, 0.06, 0.5, 0.02, 0.05), filter: bandpass(700, 1.2, 2600), pegel: 0.6 },
      { quelle: rauschen('weiss'), huelle: schlag(0.002, 0.06), filter: hochpass(3000), pegel: 0.35, start: 0.14 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Creature shots (M6-15b)
  // -------------------------------------------------------------------------------------------
  {
    // A glob of venom lands (the Speier's shot, `projectileStuck`): a wet splat and a short fizz.
    id: 'sfx_kreatur_geschoss_aufprall',
    ...SCHLAG,
    lautstaerke: 0.4,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.08), filter: bandpass(700, 1.3, 300), pegel: 0.6 },
      { quelle: rauschen('weiss'), huelle: bogen(0.01, 0.12, 0.2, 0.05, 0.12), filter: hochpass(3400), pegel: 0.3 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Kriecher
  // -------------------------------------------------------------------------------------------
  {
    // Its call: a wet, slow gurgle out of the dark.
    id: 'sfx_kreatur_kriecher_laut',
    ...BEDROHUNG,
    lautstaerke: 0.44,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1.5, klang: 0.08 },
    untertitel: { de: 'Kriecher gurgelt', en: 'Crawler gurgles' },
    schichten: [
      { quelle: ton('sinus', 150, 260), huelle: schlag(0.01, 0.07), pegel: 0.5, wiederholung: { anzahl: 6, abstand: 0.09, abfall: 0.85, tonhoehe: 0.94 } },
      { quelle: rauschen('braun'), huelle: bogen(0.1, 0.3, 0.5, 0.2, 0.3), filter: bandpass(420, 1.5), pegel: 0.5 },
    ],
  },
  {
    // Hurt: a torn, wet hiss.
    id: 'sfx_kreatur_kriecher_treffer',
    ...SCHLAG,
    lautstaerke: 0.46,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.003, 0.08, 0.3, 0.04, 0.08), filter: bandpass(1400, 1.2, 600), pegel: 0.6 },
      { quelle: ton('sinus', 220, 120), huelle: schlag(0.003, 0.1), pegel: 0.4 },
    ],
  },
  {
    // Death: the gurgle drains away, the smoke sinks and sparks.
    id: 'sfx_kreatur_kriecher_tod',
    ...BEDROHUNG,
    lautstaerke: 0.46,
    schichten: [
      { quelle: ton('sinus', 240, 90), huelle: schlag(0.01, 0.08), pegel: 0.45, wiederholung: { anzahl: 6, abstand: 0.11, abfall: 0.75, tonhoehe: 0.9 } },
      { quelle: knistern(150, 0.006, 20), huelle: bogen(0.1, 0.4, 0.5, 0.2, 0.4), filter: hochpass(1600), pegel: 0.35 },
    ],
  },
  {
    // The grab: the maw snaps shut and holds – a wet crunch; its bites while it holds sound the same, softer.
    id: 'sfx_kreatur_kriecher_packen',
    ...SCHLAG,
    lautstaerke: 0.5,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1.5, klang: 0.06 },
    untertitel: { de: 'Kriecher packt zu', en: 'Crawler grabs' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.02, 0.04, 0, 0, 0.02), filter: bandpass(900, 1.2, 1800), pegel: 0.45 },
      { quelle: ton('dreieck', 260, 120), huelle: schlag(0.001, 0.07), pegel: 0.6, start: 0.05 },
      { quelle: rauschen('braun'), huelle: schlag(0.002, 0.1), filter: tiefpass(800), pegel: 0.5, start: 0.05 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Speier
  // -------------------------------------------------------------------------------------------
  {
    // Its call: the venom sac bubbles.
    id: 'sfx_kreatur_speier_laut',
    ...BEDROHUNG,
    lautstaerke: 0.42,
    varianten: 2,
    streuung: { tonhoehe: 70, lautstaerke: 1.5, klang: 0.08 },
    untertitel: { de: 'Speier blubbert', en: 'Spitter bubbles' },
    schichten: [
      { quelle: ton('sinus', 380, 620), huelle: schlag(0.005, 0.05), pegel: 0.5, wiederholung: { anzahl: 7, abstand: 0.06, abfall: 0.85, tonhoehe: 1.05 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.2, 0.4, 0.1, 0.2), filter: bandpass(1100, 1.5), pegel: 0.35 },
    ],
  },
  {
    // Hurt: a hiss, the sac sloshes.
    id: 'sfx_kreatur_speier_treffer',
    ...SCHLAG,
    lautstaerke: 0.44,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.003, 0.07, 0.3, 0.04, 0.08), filter: hochpass(2400, 1, 1000), pegel: 0.5 },
      { quelle: ton('sinus', 500, 260), huelle: schlag(0.003, 0.07), pegel: 0.4, wiederholung: { anzahl: 2, abstand: 0.06, abfall: 0.7 } },
    ],
  },
  {
    // Death: the sac bursts, the smoke sparks away.
    id: 'sfx_kreatur_speier_tod',
    ...BEDROHUNG,
    lautstaerke: 0.46,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.2), filter: bandpass(900, 1.1, 300), pegel: 0.6 },
      { quelle: knistern(200, 0.006, 20), huelle: bogen(0.05, 0.4, 0.5, 0.2, 0.4), filter: hochpass(1800), pegel: 0.4, start: 0.1 },
    ],
  },
  {
    // The spit: a hawk in the throat, then the glob hisses off.
    id: 'sfx_kreatur_speier_spucken',
    ...SCHLAG,
    lautstaerke: 0.48,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: rauschen('braun'), huelle: bogen(0.03, 0.06, 0.3, 0.02, 0.04), filter: bandpass(600, 2), pegel: 0.5 },
      { quelle: fm(300, 1.5, 3, 0.5, 900), huelle: schlag(0.002, 0.1), filter: bandpass(1400, 1.5), pegel: 0.4, start: 0.08 },
      { quelle: rauschen('weiss'), huelle: bogen(0.01, 0.1, 0.2, 0.05, 0.1), filter: hochpass(3200), pegel: 0.3, start: 0.1 },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // Lichtfresser
  // -------------------------------------------------------------------------------------------
  {
    // Its call: a hollow, drawn-out breath like wind in a flue.
    id: 'sfx_kreatur_lichtfresser_laut',
    ...BEDROHUNG,
    lautstaerke: 0.44,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1.5, klang: 0.06 },
    untertitel: { de: 'Lichtfresser atmet', en: 'Light eater breathes' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.3, 0.2, 0.6, 0.3, 0.4), filter: bandpass(500, 4, 800), pegel: 0.6 },
      { quelle: ton('sinus', 180, 150), huelle: bogen(0.3, 0.2, 0.5, 0.3, 0.4), pegel: 0.3, vibrato: { tiefe: 30, rate: 3 } },
    ],
  },
  {
    // Hurt: the smoke tears, a flicker of stolen light crackles.
    id: 'sfx_kreatur_lichtfresser_treffer',
    ...SCHLAG,
    lautstaerke: 0.46,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.06 },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.003, 0.08, 0.3, 0.04, 0.1), filter: hochpass(2400, 1, 1000), pegel: 0.5 },
      { quelle: knistern(400, 0.004), huelle: schlag(0.004, 0.12), filter: hochpass(2000), pegel: 0.4 },
    ],
  },
  {
    // Death: the stolen light breaks free – a bright shower of crackling sparks over a falling breath.
    id: 'sfx_kreatur_lichtfresser_tod',
    ...BEDROHUNG,
    lautstaerke: 0.5,
    untertitel: { de: 'Lichtfresser zerfällt', en: 'Light eater bursts' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.02, 0.3, 0.4, 0.3, 0.5), filter: bandpass(700, 2, 250), pegel: 0.5 },
      { quelle: knistern(500, 0.004, 40), huelle: bogen(0.01, 0.4, 0.5, 0.2, 0.5), filter: hochpass(2200), pegel: 0.5 },
      { quelle: ton('sinus', 1568, 2093), huelle: schlag(0.002, 0.5), pegel: 0.2 },
    ],
  },
  {
    // The feeding: a long breath drawn in, rising as the flames stream into the maw (it warns: subtitled, far).
    id: 'sfx_kreatur_lichtfresser_saugen',
    ...BEDROHUNG,
    lautstaerke: 0.56,
    untertitel: { de: 'Lichtfresser saugt das Licht ein', en: 'Light eater draws in the light' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.4, 0.05, 0.9, 0.2, 0.15, 1), filter: bandpass(300, 3, 2400), pegel: 0.6 },
      { quelle: ton('sinus', 120, 480), huelle: bogen(0.4, 0.05, 0.7, 0.2, 0.15, 1), pegel: 0.35 },
      { quelle: knistern(60, 0.005, 400), huelle: bogen(0.3, 0.1, 0.6, 0.2, 0.2), filter: hochpass(2000), pegel: 0.3 },
    ],
  },
  {
    // The blow: a tentacle whips.
    id: 'sfx_kreatur_lichtfresser_schlag',
    ...SCHLAG,
    lautstaerke: 0.44,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.04, 0.04, 0, 0, 0.02), filter: bandpass(1400, 1.4, 4000), pegel: 0.55 },
      { quelle: ton('dreieck', 300, 160), huelle: schlag(0.001, 0.05), pegel: 0.4, start: 0.08 },
    ],
  },
]);
