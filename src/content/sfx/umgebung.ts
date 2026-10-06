/**
 * The ambience (M7-06; MASTERPROMPT §27 "Biom-Klangbetten (Vögel tags, Grillen nachts, Wind, positionale Flüsse …),
 * Wetterschichten, Donner mit entfernungsabhängiger Verzögerung"; docs/SPIEL.md §24 "Umgebung"). Played by the ambience
 * director (src/audio/ambience) on the bus `umgebung`:
 *
 * - **Beds** (loops at the listener): leaves rustling (Grünhain by day), the crickets' chorus (Grünhain by night), the surf of
 *   the coast, the wind (every biome, stronger in storms), the drip and rumble of the caves.
 * - **Calls** (one-shots at random places around the listener, drawn by the director): three Grünhain birds by day, the owl
 *   at night, gulls at the coast, drips in caves.
 * - **Water** (positional loops): a river's babble at its nearest tiles, the waves at the nearest shore.
 * - **Weather** (loops at the listener): rain, heavy rain; thunder near (a crack, then the boom) and far (a long low roll),
 *   delayed by distance / 343 m/s.
 */
import { bandpass, bogen, dauerton, defineSfxGroup, fm, hochpass, knistern, rauschen, schlag, tiefpass, ton } from './define';

/** Ambience calls: several voices, never machine-gunned. */
const RUF = { bus: 'umgebung', stimmen: 3, sperrzeit: 0.4, reichweite: 40 } as const;

export const SFX_UMGEBUNG = defineSfxGroup('umgebung', [
  // --- beds -------------------------------------------------------------------------------------
  {
    // Leaves in a light breeze: soft pink noise in the treble, slowly swelling gusts of rustle.
    id: 'sfx_umgebung_laub',
    bus: 'umgebung',
    varianten: 2,
    stimmen: 1,
    sperrzeit: 0,
    reichweite: 64,
    lautstaerke: 0.2,
    schleife: { dauer: 6 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: bandpass(2600, 0.7), pegel: 0.55 },
      { quelle: knistern(140, 0.003), huelle: dauerton(), filter: hochpass(3200), pegel: 0.35 },
      { quelle: rauschen('rosa'), huelle: bogen(1.2, 0.6, 0.5, 0.8, 1.2), filter: bandpass(1800, 0.9, 3200), pegel: 0.5, start: 0.6 },
      { quelle: rauschen('rosa'), huelle: bogen(0.9, 0.5, 0.4, 0.6, 1), filter: bandpass(2200, 0.9, 1500), pegel: 0.4, start: 3.4 },
    ],
  },
  {
    // Crickets at night (§27 "Grillen nachts"): chirping trills of a high FM carrier in short bursts, a second, slower field behind.
    id: 'sfx_umgebung_grillen',
    bus: 'umgebung',
    varianten: 2,
    stimmen: 1,
    sperrzeit: 0,
    reichweite: 64,
    lautstaerke: 0.18,
    schleife: { dauer: 4 },
    schichten: [
      { quelle: fm(4300, 0.5, 0.6), huelle: bogen(0.004, 0.01, 0.8, 0.03, 0.01), pegel: 0.5, start: 0.15, wiederholung: { anzahl: 12, abstand: 0.33, abfall: 0.97 } },
      { quelle: fm(4300, 0.5, 0.6), huelle: bogen(0.004, 0.01, 0.8, 0.03, 0.01), pegel: 0.4, start: 0.19, wiederholung: { anzahl: 12, abstand: 0.33, abfall: 0.97 } },
      { quelle: fm(3900, 0.5, 0.5), huelle: bogen(0.004, 0.01, 0.7, 0.025, 0.01), pegel: 0.3, start: 0.6, wiederholung: { anzahl: 7, abstand: 0.5, abfall: 0.95 } },
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: bandpass(600, 0.6), pegel: 0.08 },
    ],
  },
  {
    // Surf (Salzküste): brown noise swelling up the beach and drawing back, twice in the loop, a hiss of foam on top.
    id: 'sfx_umgebung_brandung',
    bus: 'umgebung',
    varianten: 2,
    stimmen: 1,
    sperrzeit: 0,
    reichweite: 64,
    lautstaerke: 0.3,
    schleife: { dauer: 6 },
    schichten: [
      { quelle: rauschen('braun'), huelle: bogen(1.1, 0.6, 0.55, 0.3, 1), filter: tiefpass(900, 0.7, 400), pegel: 0.9, start: 0.1 },
      { quelle: rauschen('braun'), huelle: bogen(1.1, 0.6, 0.55, 0.3, 1), filter: tiefpass(850, 0.7, 420), pegel: 0.8, start: 3.1 },
      { quelle: rauschen('rosa'), huelle: bogen(0.6, 0.8, 0.3, 0.3, 0.8), filter: hochpass(2500), pegel: 0.35, start: 0.8 },
      { quelle: rauschen('rosa'), huelle: bogen(0.6, 0.8, 0.3, 0.3, 0.8), filter: hochpass(2400), pegel: 0.3, start: 3.8 },
      { quelle: rauschen('braun'), huelle: dauerton(), filter: tiefpass(220), pegel: 0.3 },
    ],
  },
  {
    // Wind over open land: a band of noise breathing slowly up and down (every biome; storms raise it).
    id: 'sfx_umgebung_wind',
    bus: 'umgebung',
    varianten: 2,
    stimmen: 1,
    sperrzeit: 0,
    reichweite: 64,
    lautstaerke: 0.22,
    schleife: { dauer: 6 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: bandpass(420, 1.6), pegel: 0.6 },
      { quelle: rauschen('rosa'), huelle: bogen(1.5, 0.6, 0.6, 0.6, 1.5), filter: bandpass(700, 2.2, 1100), pegel: 0.6, start: 0.4 },
      { quelle: rauschen('rosa'), huelle: bogen(1.2, 0.5, 0.5, 0.5, 1.2), filter: bandpass(900, 2.5, 600), pegel: 0.45, start: 3 },
      { quelle: ton('sinus', 210, 240), huelle: bogen(1.2, 0.8, 0.3, 0.5, 1.5), pegel: 0.05, start: 1.5, vibrato: { tiefe: 30, rate: 0.7 } },
    ],
  },
  {
    // A cave: a low rumble of the deep, faraway air moving.
    id: 'sfx_umgebung_hoehle',
    bus: 'umgebung',
    stimmen: 1,
    sperrzeit: 0,
    reichweite: 64,
    lautstaerke: 0.18,
    schleife: { dauer: 6 },
    schichten: [
      { quelle: rauschen('braun'), huelle: dauerton(), filter: tiefpass(160, 0.9), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: bogen(2, 0.5, 0.5, 1, 2), filter: bandpass(320, 3, 260), pegel: 0.3, start: 0.5 },
      { quelle: ton('sinus', 55, 50), huelle: dauerton(), pegel: 0.15, vibrato: { tiefe: 25, rate: 0.15 } },
    ],
  },
  // --- calls ------------------------------------------------------------------------------------
  {
    // Blackbird: a fluting phrase of four notes, sliding.
    id: 'sfx_umgebung_vogel_amsel',
    ...RUF,
    varianten: 3,
    streuung: { tonhoehe: 120, lautstaerke: 3, klang: 0.08 },
    lautstaerke: 0.24,
    schichten: [
      { quelle: ton('sinus', 1900, 2300), huelle: bogen(0.01, 0.05, 0.6, 0.06, 0.05), pegel: 0.8 },
      { quelle: ton('sinus', 2500, 2100), huelle: bogen(0.01, 0.04, 0.6, 0.05, 0.05), pegel: 0.75, start: 0.18 },
      { quelle: ton('sinus', 1700, 1600), huelle: bogen(0.01, 0.06, 0.5, 0.08, 0.08), pegel: 0.7, start: 0.34, vibrato: { tiefe: 60, rate: 22 } },
      { quelle: ton('sinus', 2800, 3200), huelle: bogen(0.005, 0.03, 0.5, 0.04, 0.05), pegel: 0.5, start: 0.58 },
    ],
  },
  {
    // Great tit: "zi-zi-dah", bright and repeated.
    id: 'sfx_umgebung_vogel_meise',
    ...RUF,
    varianten: 2,
    streuung: { tonhoehe: 100, lautstaerke: 3, klang: 0.06 },
    lautstaerke: 0.2,
    schichten: [
      { quelle: ton('sinus', 4200, 4100), huelle: schlag(0.004, 0.06), pegel: 0.7, wiederholung: { anzahl: 3, abstand: 0.22, abfall: 0.95 } },
      { quelle: ton('sinus', 3100, 2900), huelle: schlag(0.006, 0.09), pegel: 0.7, start: 0.09, wiederholung: { anzahl: 3, abstand: 0.22, abfall: 0.95 } },
    ],
  },
  {
    // Finch: a quick descending trill ending in a flourish.
    id: 'sfx_umgebung_vogel_fink',
    ...RUF,
    varianten: 3,
    streuung: { tonhoehe: 120, lautstaerke: 3, klang: 0.08 },
    lautstaerke: 0.2,
    schichten: [
      { quelle: ton('sinus', 3800, 3500), huelle: schlag(0.003, 0.035), pegel: 0.7, wiederholung: { anzahl: 7, abstand: 0.06, abfall: 0.97, tonhoehe: 0.96 } },
      { quelle: ton('sinus', 2600, 4200), huelle: bogen(0.005, 0.04, 0.5, 0.06, 0.05), pegel: 0.6, start: 0.46 },
    ],
  },
  {
    // Tawny owl at night: a low hoot, a pause, the quavering second hoot.
    id: 'sfx_umgebung_eule',
    ...RUF,
    reichweite: 48,
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 2, klang: 0.04 },
    lautstaerke: 0.24,
    schichten: [
      { quelle: ton('sinus', 470, 440), huelle: bogen(0.04, 0.1, 0.7, 0.2, 0.15), filter: tiefpass(1200), pegel: 0.8 },
      { quelle: ton('sinus', 480, 420), huelle: bogen(0.05, 0.1, 0.6, 0.55, 0.3), filter: tiefpass(1200), pegel: 0.75, start: 0.75, vibrato: { tiefe: 45, rate: 9 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.1, 0.3, 0.3, 0.2), filter: bandpass(900, 2), pegel: 0.1, start: 0.75 },
    ],
  },
  {
    // Gull: a raucous "kyow", falling, with the rasp of a gull's throat.
    id: 'sfx_umgebung_moewe',
    ...RUF,
    varianten: 3,
    streuung: { tonhoehe: 120, lautstaerke: 3, klang: 0.08 },
    lautstaerke: 0.26,
    schichten: [
      { quelle: fm(1400, 1.5, 2.2, 1.2, 900), huelle: bogen(0.02, 0.12, 0.6, 0.12, 0.12), filter: bandpass(1600, 1.2), pegel: 0.75 },
      { quelle: fm(1300, 1.5, 2, 1, 800), huelle: bogen(0.02, 0.1, 0.5, 0.1, 0.1), filter: bandpass(1500, 1.2), pegel: 0.5, start: 0.38 },
      { quelle: rauschen('weiss'), huelle: bogen(0.02, 0.1, 0.4, 0.1, 0.1), filter: bandpass(2500, 2), pegel: 0.15 },
    ],
  },
  {
    // A drop in a cave: a hollow plink and its ring.
    id: 'sfx_umgebung_tropfen',
    ...RUF,
    reichweite: 24,
    varianten: 3,
    streuung: { tonhoehe: 250, lautstaerke: 3, klang: 0.1 },
    lautstaerke: 0.22,
    schichten: [
      { quelle: ton('sinus', 900, 1800), huelle: schlag(0.001, 0.08, 2.5), pegel: 0.9 },
      { quelle: ton('sinus', 1750, 1700), huelle: schlag(0.002, 0.35, 2), pegel: 0.25, start: 0.02 },
    ],
  },
  // --- water ------------------------------------------------------------------------------------
  {
    // A river's babble: water over stones – a band of noise with quick bubbling and slow surges (positional).
    id: 'sfx_umgebung_fluss',
    bus: 'umgebung',
    varianten: 2,
    stimmen: 3,
    sperrzeit: 0,
    reichweite: 14,
    lautstaerke: 0.3,
    schleife: { dauer: 4 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: bandpass(1100, 0.8), pegel: 0.6 },
      { quelle: knistern(260, 0.004), huelle: dauerton(), filter: bandpass(2400, 1.3), pegel: 0.5 },
      { quelle: ton('sinus', 520, 900), huelle: schlag(0.004, 0.05), pegel: 0.12, start: 0.3, wiederholung: { anzahl: 6, abstand: 0.55, abfall: 0.9, tonhoehe: 1.1 } },
      { quelle: rauschen('braun'), huelle: bogen(0.8, 0.4, 0.6, 0.6, 0.8), filter: tiefpass(500), pegel: 0.4, start: 1 },
    ],
  },
  {
    // Waves at the shore (positional): the wash coming in and the hiss of its retreat.
    id: 'sfx_umgebung_meer',
    bus: 'umgebung',
    varianten: 2,
    stimmen: 1,
    sperrzeit: 0,
    reichweite: 22,
    lautstaerke: 0.32,
    schleife: { dauer: 5 },
    schichten: [
      { quelle: rauschen('braun'), huelle: bogen(0.9, 0.6, 0.5, 0.4, 1.2), filter: tiefpass(1100, 0.7, 500), pegel: 0.9, start: 0.2 },
      { quelle: rauschen('rosa'), huelle: bogen(0.5, 0.9, 0.3, 0.2, 0.9), filter: hochpass(2200), pegel: 0.4, start: 1.2 },
      { quelle: knistern(180, 0.004, 40), huelle: bogen(0.5, 0.8, 0.3, 0.2, 0.8), filter: hochpass(3000), pegel: 0.3, start: 1.3 },
    ],
  },
  // --- weather ----------------------------------------------------------------------------------
  {
    // Rain: an even hiss and the patter of drops on leaves.
    id: 'sfx_umgebung_regen',
    bus: 'umgebung',
    varianten: 2,
    stimmen: 1,
    sperrzeit: 0,
    reichweite: 64,
    lautstaerke: 0.3,
    schleife: { dauer: 4 },
    untertitel: { de: 'Regen', en: 'Rain' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: hochpass(1400), pegel: 0.55 },
      { quelle: knistern(420, 0.0025), huelle: dauerton(), filter: bandpass(3200, 1), pegel: 0.6 },
      { quelle: knistern(60, 0.008), huelle: dauerton(), filter: bandpass(1500, 1.4), pegel: 0.35 },
    ],
  },
  {
    // Heavy rain (thunderstorms): a roar of water, low rush beneath the hiss, drops drumming.
    id: 'sfx_umgebung_starkregen',
    bus: 'umgebung',
    varianten: 2,
    stimmen: 1,
    sperrzeit: 0,
    reichweite: 64,
    lautstaerke: 0.42,
    schleife: { dauer: 4 },
    untertitel: { de: 'Starkregen', en: 'Heavy rain' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: hochpass(900), pegel: 0.7 },
      { quelle: rauschen('braun'), huelle: dauerton(), filter: tiefpass(500), pegel: 0.4 },
      { quelle: knistern(1100, 0.002), huelle: dauerton(), filter: bandpass(2800, 0.9), pegel: 0.6 },
      { quelle: knistern(140, 0.008), huelle: dauerton(), filter: bandpass(1200, 1.2), pegel: 0.4 },
    ],
  },
  {
    // Thunder close by: the crack of the strike, then the boom rolling off.
    id: 'sfx_umgebung_donner_nah',
    bus: 'umgebung',
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1.5, klang: 0.06 },
    stimmen: 2,
    sperrzeit: 0.5,
    reichweite: 64,
    lautstaerke: 0.85,
    untertitel: { de: 'Donnerschlag', en: 'Thunderclap' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.002, 0.25, 3), filter: hochpass(1200), pegel: 0.9 },
      { quelle: knistern(900, 0.004, 60), huelle: schlag(0.004, 0.6, 2), filter: bandpass(2600, 0.8), pegel: 0.6 },
      { quelle: rauschen('braun'), huelle: bogen(0.03, 0.6, 0.45, 0.6, 1.8, 2), filter: tiefpass(420, 0.9, 150), pegel: 1, start: 0.05 },
      { quelle: ton('sinus', 62, 38), huelle: bogen(0.02, 0.5, 0.4, 0.4, 1.5), pegel: 0.5, start: 0.05 },
    ],
  },
  {
    // Thunder far away: no crack, a long low roll that swells and fades.
    id: 'sfx_umgebung_donner_fern',
    bus: 'umgebung',
    varianten: 3,
    streuung: { tonhoehe: 80, lautstaerke: 3, klang: 0.08 },
    stimmen: 2,
    sperrzeit: 0.8,
    reichweite: 64,
    lautstaerke: 0.5,
    untertitel: { de: 'Donnergrollen', en: 'Distant thunder' },
    schichten: [
      { quelle: rauschen('braun'), huelle: bogen(0.4, 0.8, 0.55, 0.8, 1.6, 1.5), filter: tiefpass(260, 0.8, 120), pegel: 1 },
      { quelle: rauschen('braun'), huelle: bogen(0.3, 0.5, 0.4, 0.4, 1), filter: tiefpass(300, 1, 160), pegel: 0.6, start: 0.9 },
      { quelle: ton('sinus', 48, 36), huelle: bogen(0.4, 0.6, 0.4, 0.6, 1.5), pegel: 0.4 },
    ],
  },
]);
