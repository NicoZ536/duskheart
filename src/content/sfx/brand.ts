/**
 * Fires on the build grid and in the trees, and the hearth fire (MASTERPROMPT §16.2 "Brennbar", §16.5 Herdfeuer,
 * §10 "Regen löscht"; M4-29): `FIRE_AUDIO` and `HEARTH_AUDIO` in src/audio/baseSounds.ts.
 *
 * - `sfx_brand_*`: a blaze burning on a tile (a loop: heavier than the camp fire – a roar, timber cracking; the
 *   nearest few burning tiles sound, src/audio/loopSources.ts), a fire breaking out (a whoomp) and catching the next
 *   tile, rain hissing it out, a tile burning down to embers, a burning tree crashing.
 * - `sfx_herd_*`: the hearth's deep crackle (loop), lighting it (a whoosh and a warm low swell – the base is
 *   protected), it going out (the swell falling – the protection is gone, §16.5) or being smothered, an ember core
 *   set into its niche or taken out (a crystal ring rising or falling).
 *
 * Fires breaking out, a burning tree and the hearth's state carry subtitles (§27): they matter even out of sight.
 */
import { bandpass, bogen, dauerton, defineSfxGroup, fm, hochpass, knistern, rauschen, schlag, tiefpass, ton } from './define';

/** One-shots of fire in the world. */
const BRAND = {
  bus: 'effekte',
  varianten: 2,
  streuung: { tonhoehe: 80, lautstaerke: 1.5, klang: 0.06 },
  stimmen: 2,
  reichweite: 20,
} as const;

/** The hearth: the heart of the base, heard across it. */
const HERD = {
  bus: 'effekte',
  stimmen: 1,
  sperrzeit: 0.5,
  reichweite: 24,
} as const;

export const SFX_BRAND = defineSfxGroup('brand', [
  // --- Blazes -----------------------------------------------------------------------------------
  {
    // A burning tile (loop): roar, rumble, crackle, timber cracking.
    id: 'sfx_brand_lodern',
    bus: 'umgebung',
    varianten: 2,
    stimmen: 4,
    sperrzeit: 0,
    reichweite: 18,
    lautstaerke: 0.42,
    schleife: { dauer: 3 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: tiefpass(900, 0.8), pegel: 0.5 },
      { quelle: rauschen('braun'), huelle: dauerton(), filter: bandpass(180, 1.2), pegel: 0.4 },
      { quelle: knistern(30, 0.006), huelle: dauerton(), filter: hochpass(1500), pegel: 1 },
      { quelle: knistern(4, 0.03), huelle: dauerton(), filter: bandpass(1500, 1.1), pegel: 0.8 },
      { quelle: knistern(80, 0.0015), huelle: dauerton(), filter: hochpass(5000), pegel: 0.3 },
    ],
  },
  {
    // A fire breaks out (a torch, the console): a deep whoomp swelling into crackles.
    id: 'sfx_brand_entflammen',
    ...BRAND,
    sperrzeit: 0.4,
    reichweite: 24,
    lautstaerke: 0.62,
    untertitel: { de: 'Feuer bricht aus', en: 'Fire breaks out' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.08, 0.3, 0.4, 0.2, 0.4), filter: bandpass(250, 1, 1200), pegel: 0.9 },
      { quelle: rauschen('braun'), huelle: schlag(0.05, 0.4, 1.5), filter: tiefpass(300), pegel: 0.7 },
      { quelle: knistern(100, 0.005, 30), huelle: bogen(0.1, 0.2, 0.5, 0.3, 0.4), filter: hochpass(1600), pegel: 0.7, start: 0.1 },
    ],
  },
  {
    // The fire catches the next tile: a smaller flare.
    id: 'sfx_brand_ausbreiten',
    ...BRAND,
    stimmen: 3,
    sperrzeit: 0.25,
    lautstaerke: 0.46,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.06, 0.35, 1.5), filter: bandpass(400, 1, 1000), pegel: 0.8 },
      { quelle: knistern(160, 0.004, 40), huelle: schlag(0.05, 0.4), filter: hochpass(1800), pegel: 0.6, start: 0.04 },
    ],
  },
  {
    // Rain puts a burning tile out: steam hissing, embers sizzling.
    id: 'sfx_brand_zischen',
    ...BRAND,
    sperrzeit: 0.3,
    lautstaerke: 0.44,
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.01, 0.2, 0.5, 0.4, 0.6), filter: hochpass(3000, 0.7, 5000), pegel: 0.7 },
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.4, 1.5), filter: tiefpass(600), pegel: 0.4 },
      { quelle: knistern(200, 0.002, 20), huelle: schlag(0.02, 0.9, 1.5), filter: hochpass(3500), pegel: 0.4 },
    ],
  },
  {
    // A tile burned down: the embers slumping, the last crackles.
    id: 'sfx_brand_verglimmen',
    ...BRAND,
    sperrzeit: 0.3,
    lautstaerke: 0.38,
    schichten: [
      { quelle: knistern(40, 0.01, 3), huelle: schlag(0.02, 0.9, 1.5), filter: bandpass(1500, 1.1), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.5, 1.5), filter: tiefpass(500), pegel: 0.5 },
      { quelle: ton('sinus', 90, 60), huelle: schlag(0.003, 0.1, 3), pegel: 0.5 },
    ],
  },
  {
    // A burning tree gives way: a long groan, the crash, a burst of embers.
    id: 'sfx_brand_baum',
    ...BRAND,
    stimmen: 1,
    sperrzeit: 0.5,
    reichweite: 30,
    lautstaerke: 0.7,
    untertitel: { de: 'Brennender Baum stürzt', en: 'Burning tree falls' },
    schichten: [
      { quelle: ton('saege', 90, 60), huelle: bogen(0.1, 0.3, 0.6, 0.3, 0.2), filter: bandpass(500, 3), vibrato: { tiefe: 50, rate: 6 }, pegel: 0.6 },
      { quelle: rauschen('braun'), huelle: schlag(0.005, 0.9, 1.5), filter: tiefpass(400), pegel: 0.9, start: 0.8 },
      { quelle: knistern(600, 0.003, 40), huelle: schlag(0.01, 1.1, 1.5), filter: hochpass(2000), pegel: 0.7, start: 0.8 },
      { quelle: ton('sinus', 70, 40), huelle: schlag(0.003, 0.4, 2), pegel: 0.9, start: 0.8 },
    ],
  },
  // --- The hearth -------------------------------------------------------------------------------
  {
    // The hearth burning (loop): a deep, steady fire in its stone ring.
    id: 'sfx_herd_knistern',
    bus: 'umgebung',
    varianten: 2,
    stimmen: 3,
    sperrzeit: 0,
    reichweite: 16,
    lautstaerke: 0.38,
    schleife: { dauer: 4 },
    schichten: [
      { quelle: rauschen('braun'), huelle: dauerton(), filter: bandpass(160, 1.2), pegel: 0.35 },
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: tiefpass(600, 0.8), pegel: 0.3 },
      { quelle: knistern(14, 0.007), huelle: dauerton(), filter: hochpass(1200), pegel: 1 },
      { quelle: knistern(3, 0.02), huelle: dauerton(), filter: bandpass(1800, 1.1), pegel: 0.8 },
      { quelle: knistern(40, 0.0015), huelle: dauerton(), filter: hochpass(4500), pegel: 0.25 },
    ],
  },
  {
    // The hearth is lit (§16.5 protection): a whoosh and a warm low fifth swelling up.
    id: 'sfx_herd_entzuenden',
    ...HERD,
    lautstaerke: 0.6,
    untertitel: { de: 'Herdfeuer brennt', en: 'Hearth fire burns' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.15, 0.3, 0.5, 0.2, 0.4), filter: bandpass(300, 1, 1400), pegel: 0.8 },
      { quelle: knistern(90, 0.006, 20), huelle: bogen(0.2, 0.3, 0.5, 0.3, 0.4), filter: hochpass(1500), pegel: 0.6, start: 0.15 },
      { quelle: ton('sinus', 110), huelle: bogen(0.4, 0.3, 0.6, 0.3, 0.8), pegel: 0.35, start: 0.2 },
      { quelle: ton('dreieck', 165), huelle: bogen(0.5, 0.3, 0.5, 0.2, 0.8), filter: tiefpass(900), pegel: 0.25, start: 0.35 },
    ],
  },
  {
    // The hearth goes out (§16.5 "Erlischt es, entfällt der Schutz"): a hiss and the warm fifth sinking away.
    id: 'sfx_herd_erloeschen',
    ...HERD,
    lautstaerke: 0.56,
    untertitel: { de: 'Herdfeuer erlischt', en: 'Hearth fire dies' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.02, 0.2, 0.4, 0.2, 0.5), filter: hochpass(2800, 0.8, 4800), pegel: 0.5 },
      { quelle: knistern(20, 0.01, 2), huelle: schlag(0.05, 1, 1.5), filter: bandpass(1800, 1.1), pegel: 0.5 },
      { quelle: ton('sinus', 165, 110), huelle: bogen(0.1, 0.4, 0.5, 0.2, 0.8), pegel: 0.35 },
      { quelle: ton('dreieck', 110, 73), huelle: bogen(0.2, 0.4, 0.5, 0.2, 0.9), filter: tiefpass(700), pegel: 0.25, start: 0.1 },
    ],
  },
  {
    // The hearth is put out by hand: ash smothering the embers, a hiss, the fifth sinking.
    id: 'sfx_herd_loeschen',
    ...HERD,
    lautstaerke: 0.54,
    untertitel: { de: 'Herdfeuer gelöscht', en: 'Hearth fire put out' },
    schichten: [
      { quelle: rauschen('braun'), huelle: schlag(0.005, 0.3, 2), filter: tiefpass(500), pegel: 0.8 },
      { quelle: rauschen('weiss'), huelle: bogen(0.02, 0.2, 0.4, 0.3, 0.4), filter: hochpass(3000), pegel: 0.45, start: 0.05 },
      { quelle: ton('sinus', 165, 110), huelle: bogen(0.05, 0.3, 0.4, 0.2, 0.6), pegel: 0.3, start: 0.1 },
    ],
  },
  {
    // An ember core set into its niche (§16.5 radius grows): a crystal ring rising over a warm hum.
    id: 'sfx_herd_glutkern',
    ...HERD,
    sperrzeit: 0.3,
    lautstaerke: 0.5,
    untertitel: { de: 'Glutkern eingesetzt', en: 'Ember core set' },
    schichten: [
      { quelle: fm(660, 2, 2, 0.5), huelle: schlag(0.005, 1.2, 2.5), pegel: 0.5 },
      { quelle: ton('sinus', 330, 440), huelle: bogen(0.2, 0.3, 0.5, 0.2, 0.6), pegel: 0.35 },
      { quelle: knistern(80, 0.003, 10), huelle: schlag(0.05, 0.9), filter: hochpass(5000), pegel: 0.35, start: 0.05 },
    ],
  },
  {
    // An ember core taken out: the ring falling, stone scraping.
    id: 'sfx_herd_glutkern_nehmen',
    ...HERD,
    sperrzeit: 0.3,
    lautstaerke: 0.46,
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.02, 0.08, 0.4, 0.08, 0.08), filter: bandpass(1800, 1.2), pegel: 0.45 },
      { quelle: fm(660, 2, 1.5, 0.2), huelle: schlag(0.005, 0.8, 2.5), pegel: 0.45, start: 0.08 },
      { quelle: ton('sinus', 440, 330), huelle: bogen(0.1, 0.3, 0.4, 0.2, 0.5), pegel: 0.3, start: 0.08 },
    ],
  },
]);
