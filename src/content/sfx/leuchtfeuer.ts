/**
 * The beacon's and the Lumen's sounds (MASTERPROMPT §8, §12.2, §25, §27; docs/SPIEL.md §22; strand F, M7-35 … M7-37): the
 * ignition sequence (embers taking the flame), the beacon flaring up (the stinger `leuchtfeuer` is strand A's and plays over
 * it), a granted unlock, the Lumen lantern (switched on, off, its hum, a shard charging it), the Lumen workbench at work and
 * finished, and the jump of fast travel.
 *
 * Lumen sounds glassy and cold – sine and triangle partials in fifths, a soft shimmer – where fire crackles: the cold light of
 * the beacons against the warm fire of the camp (ART.md "kalt-verdorben → warm" is the beacon's own flame, the Lumen stays cool).
 */
import { bandpass, bogen, dauerton, defineSfxGroup, fm, hochpass, knistern, rauschen, schlag, tiefpass, ton } from './define';

/** The beacon: heard across its clearing. */
const FEUER = { bus: 'effekte', reichweite: 40, stimmen: 1, sperrzeit: 0.5 } as const;
/** The lantern in the hand: close and quiet. */
const LATERNE = { bus: 'effekte', reichweite: 10, stimmen: 2, sperrzeit: 0.1 } as const;
/** A hand station at work (src/content/sfx/stationen.ts `HANDWERK`). */
const HANDWERK = { bus: 'effekte', varianten: 2, stimmen: 2, sperrzeit: 0, reichweite: 14 } as const;

export const SFX_LEUCHTFEUER = defineSfxGroup('leuchtfeuer', [
  {
    // The ignition: the embers breathe in, the flame climbs the pillar with a rising roar.
    id: 'sfx_leuchtfeuer_entzuenden',
    ...FEUER,
    lautstaerke: 0.62,
    varianten: 1,
    untertitel: { de: 'Das Leuchtfeuer fängt Feuer', en: 'The beacon catches fire' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(1.2, 0.4, 0.8, 1.6, 0.6), filter: bandpass(300, 0.9, 1500), pegel: 0.8 },
      { quelle: knistern(6, 0.006, 40), huelle: bogen(0.6, 0.6, 0.7, 2, 0.6), filter: hochpass(1500), pegel: 0.6 },
      { quelle: ton('sinus', 110, 220), huelle: bogen(1.6, 0.6, 0.6, 1, 0.6), pegel: 0.45 },
      { quelle: ton('dreieck', 330, 660), huelle: bogen(1.6, 0.4, 0.4, 0.8, 0.6), filter: tiefpass(1800), pegel: 0.25, start: 0.4 },
    ],
  },
  {
    // The beacon blazes: a deep whoomph, then a warm, open chord ringing out over the land.
    id: 'sfx_leuchtfeuer_brennt',
    ...FEUER,
    lautstaerke: 0.72,
    varianten: 1,
    untertitel: { de: 'Das Leuchtfeuer brennt', en: 'The beacon blazes' },
    schichten: [
      { quelle: ton('sinus', 80, 50), huelle: schlag(0.01, 0.8, 2), pegel: 0.9 },
      { quelle: rauschen('braun'), huelle: schlag(0.01, 0.9, 2), filter: tiefpass(400), pegel: 0.7 },
      { quelle: ton('dreieck', 262), huelle: bogen(0.15, 0.6, 0.5, 1.2, 1.2), pegel: 0.4, start: 0.2 },
      { quelle: ton('dreieck', 392), huelle: bogen(0.15, 0.6, 0.5, 1.2, 1.2), pegel: 0.35, start: 0.3 },
      { quelle: ton('sinus', 523), huelle: bogen(0.2, 0.6, 0.4, 1.2, 1.2), pegel: 0.3, start: 0.4, vibrato: { tiefe: 12, rate: 5 } },
      { quelle: knistern(20, 0.006), huelle: bogen(0.05, 0.5, 0.5, 1.6, 1), filter: hochpass(1800), pegel: 0.45 },
    ],
  },
  {
    // A new piece of knowledge: three clear, ascending glass notes.
    id: 'sfx_leuchtfeuer_wissen',
    bus: 'ui',
    reichweite: 4,
    stimmen: 1,
    sperrzeit: 0.25,
    lautstaerke: 0.42,
    varianten: 1,
    untertitel: { de: 'Freigeschaltet', en: 'Unlocked' },
    schichten: [
      { quelle: ton('sinus', 880), huelle: bogen(0.005, 0.25, 0.3, 0.1, 0.4), pegel: 0.7, wiederholung: { anzahl: 3, abstand: 0.11, abfall: 0.95, tonhoehe: 1.335 } },
      { quelle: ton('dreieck', 1760), huelle: schlag(0.004, 0.2, 2), pegel: 0.25, wiederholung: { anzahl: 3, abstand: 0.11, abfall: 0.9, tonhoehe: 1.335 } },
    ],
  },
  {
    // The Lumen lantern lights: a soft glassy "ting" and a rising shimmer.
    id: 'sfx_lumen_an',
    ...LATERNE,
    lautstaerke: 0.38,
    varianten: 2,
    streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.04 },
    schichten: [
      { quelle: ton('sinus', 1320), huelle: schlag(0.003, 0.35, 2), pegel: 0.6 },
      { quelle: ton('sinus', 660, 990), huelle: bogen(0.05, 0.2, 0.4, 0.1, 0.25), pegel: 0.45 },
      { quelle: rauschen('weiss'), huelle: bogen(0.05, 0.2, 0.2, 0.1, 0.2), filter: hochpass(5000), pegel: 0.15 },
    ],
  },
  {
    // It goes dark: the shimmer sinks away.
    id: 'sfx_lumen_aus',
    ...LATERNE,
    lautstaerke: 0.34,
    varianten: 2,
    streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.04 },
    schichten: [
      { quelle: ton('sinus', 990, 440), huelle: bogen(0.01, 0.25, 0.3, 0.05, 0.25), pegel: 0.6 },
      { quelle: ton('dreieck', 660, 330), huelle: schlag(0.01, 0.4, 2), filter: tiefpass(1500), pegel: 0.3 },
    ],
  },
  {
    // In the hand: a faint, steady hum of cold light (loop).
    id: 'sfx_lumen_summen',
    bus: 'umgebung',
    reichweite: 6,
    stimmen: 2,
    sperrzeit: 0,
    lautstaerke: 0.16,
    varianten: 1,
    schleife: { dauer: 2 },
    schichten: [
      { quelle: ton('sinus', 220), huelle: dauerton(), pegel: 0.5, vibrato: { tiefe: 6, rate: 1 } },
      { quelle: ton('sinus', 330), huelle: dauerton(), pegel: 0.3, vibrato: { tiefe: 8, rate: 1.5 } },
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: bandpass(3200, 2), pegel: 0.12 },
    ],
  },
  {
    // A shard charges the lantern: the shard cracks, the light swells.
    id: 'sfx_lumen_laden',
    ...LATERNE,
    lautstaerke: 0.42,
    varianten: 2,
    streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 },
    untertitel: { de: 'Lumen geladen', en: 'Lumen charged' },
    schichten: [
      { quelle: knistern(200, 0.003), huelle: schlag(0.002, 0.08, 3), filter: hochpass(3000), pegel: 0.6 },
      { quelle: ton('sinus', 440, 880), huelle: bogen(0.05, 0.3, 0.5, 0.2, 0.4), pegel: 0.55, start: 0.06 },
      { quelle: ton('sinus', 660, 1320), huelle: bogen(0.08, 0.3, 0.4, 0.2, 0.4), pegel: 0.3, start: 0.1 },
    ],
  },
  {
    // The Lumen workbench at work (loop): fine filing, a glass tap, the shard humming as it is set in resin.
    id: 'sfx_station_lumen',
    ...HANDWERK,
    lautstaerke: 0.34,
    schleife: { dauer: 2.4 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.03, 0.06, 0.6, 0.3, 0.06), filter: bandpass(3000, 1.4), pegel: 0.5, start: 0.15, wiederholung: { anzahl: 2, abstand: 0.9, abfall: 0.9 } },
      { quelle: ton('sinus', 1760), huelle: schlag(0.002, 0.25, 2), pegel: 0.35, start: 0.7, wiederholung: { anzahl: 2, abstand: 0.9, abfall: 0.85, tonhoehe: 1.122 } },
      { quelle: ton('sinus', 330), huelle: dauerton(), pegel: 0.18, vibrato: { tiefe: 10, rate: 2 } },
    ],
  },
  {
    // Finished at the Lumen workbench: a wooden knock and a clear glass chord.
    id: 'sfx_station_lumen_fertig',
    bus: 'effekte',
    varianten: 2,
    streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.04 },
    stimmen: 2,
    sperrzeit: 0.1,
    reichweite: 16,
    lautstaerke: 0.46,
    untertitel: { de: 'Hergestellt', en: 'Crafted' },
    schichten: [
      { quelle: ton('sinus', 250, 190), huelle: schlag(0.001, 0.08, 3), pegel: 0.7 },
      { quelle: ton('sinus', 880), huelle: bogen(0.004, 0.3, 0.3, 0.1, 0.4), pegel: 0.45, start: 0.08, wiederholung: { anzahl: 2, abstand: 0.09, abfall: 0.95, tonhoehe: 1.498 } },
      { quelle: fm(1320, 2, 1.5, 0), huelle: schlag(0.004, 0.4, 2), pegel: 0.15, start: 0.08 },
    ],
  },
  {
    // Fast travel: the light folds around the traveller – a falling then rising glassy sweep and a soft landing.
    id: 'sfx_reise_sprung',
    bus: 'effekte',
    reichweite: 8,
    stimmen: 1,
    sperrzeit: 0.3,
    lautstaerke: 0.5,
    varianten: 1,
    untertitel: { de: 'Reise durch das Licht', en: 'Travel through the light' },
    schichten: [
      { quelle: ton('sinus', 1320, 330), huelle: bogen(0.02, 0.3, 0.5, 0.2, 0.3), pegel: 0.5 },
      { quelle: ton('sinus', 330, 1320), huelle: bogen(0.1, 0.3, 0.5, 0.2, 0.4), pegel: 0.5, start: 0.5 },
      { quelle: rauschen('rosa'), huelle: bogen(0.3, 0.3, 0.4, 0.3, 0.4), filter: bandpass(2400, 1, 600), pegel: 0.35 },
      { quelle: ton('sinus', 90, 60), huelle: schlag(0.01, 0.3, 2), pegel: 0.5, start: 1.1 },
    ],
  },
]);
