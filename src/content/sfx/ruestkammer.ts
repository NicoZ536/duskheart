/**
 * Sounds of the armoury (MASTERPROMPT §27 "Crafting", "materialspezifische Sounds"; M6-12, M6-31): the stations loom,
 * tailor's table and tanning frame at work and done (named by their station records, src/content/stations.ts), and the
 * handling of leather and bronze armour (the items' `sounds.aufheben`, src/content/items/ruestung.ts). Loops follow the
 * rules of src/content/sfx/stationen.ts (sustained layers through the seam, pulsed layers after the crossfade).
 */
import { bandpass, bogen, dauerton, defineSfxGroup, fm, knistern, rauschen, schlag, tiefpass, ton } from './define';

/** A hand station at work (the player's crafting queue), heard around the station. */
const HANDWERK = { bus: 'effekte', varianten: 2, stimmen: 2, sperrzeit: 0, reichweite: 14 } as const;
/** A processing station running on its own: a quiet positional bed of the base. */
const VERARBEITUNG = { bus: 'umgebung', varianten: 2, stimmen: 3, sperrzeit: 0 } as const;
/** A finished piece or batch. */
const FERTIG = { bus: 'effekte', varianten: 2, streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.04 }, stimmen: 2, sperrzeit: 0.1, reichweite: 16 } as const;
/** Handling an item in the bags. */
const ITEM = { bus: 'ui', varianten: 3, streuung: { tonhoehe: 80, lautstaerke: 1.5, klang: 0.06 }, stimmen: 2, sperrzeit: 0.05 } as const;

export const SFX_RUESTKAMMER = defineSfxGroup('ruestkammer', [
  {
    // The loom: the shuttle slides through the warp, the beater thumps the weft home – twice per loop.
    id: 'sfx_station_webstuhl',
    ...HANDWERK,
    lautstaerke: 0.32,
    schleife: { dauer: 2 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.08, 0.1, 0.5, 0.2, 0.1), filter: bandpass(1500, 1.3, 2200), pegel: 0.5, start: 0.13, wiederholung: { anzahl: 2, abstand: 1 } },
      { quelle: ton('sinus', 170, 120), huelle: schlag(0.001, 0.08, 3), pegel: 0.9, start: 0.62, wiederholung: { anzahl: 2, abstand: 1 } },
      { quelle: rauschen('braun'), huelle: schlag(0.001, 0.05, 3), filter: tiefpass(900), pegel: 0.5, start: 0.62, wiederholung: { anzahl: 2, abstand: 1 } },
    ],
  },
  {
    // A length of woven fibre cut from the loom: a soft tug and a warm chime.
    id: 'sfx_station_webstuhl_fertig',
    ...FERTIG,
    lautstaerke: 0.4,
    untertitel: { de: 'Gewebt', en: 'Woven' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.3, 1.5), filter: bandpass(1100, 1.2, 500), pegel: 0.6 },
      { quelle: ton('dreieck', 440), huelle: schlag(0.003, 0.3, 2.5), pegel: 0.4, start: 0.15 },
      { quelle: ton('dreieck', 659), huelle: schlag(0.004, 0.35, 2.5), pegel: 0.3, start: 0.27 },
    ],
  },
  {
    // The tailor's table: shears snip, a needle draws the thread through cloth and leather.
    id: 'sfx_station_schneidern',
    ...HANDWERK,
    lautstaerke: 0.3,
    schleife: { dauer: 2.4 },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.001, 0.04, 3), filter: bandpass(3800, 2), pegel: 0.7, start: 0.14, wiederholung: { anzahl: 2, abstand: 0.18, abfall: 0.8 } },
      { quelle: ton('sinus', 2400, 2200), huelle: schlag(0.001, 0.03, 3), pegel: 0.15, start: 0.14, wiederholung: { anzahl: 2, abstand: 0.18, abfall: 0.8 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.1, 0.1, 0.4, 0.25, 0.1), filter: bandpass(1800, 1.6, 900), pegel: 0.45, start: 0.9, wiederholung: { anzahl: 2, abstand: 0.6, abfall: 0.9 } },
    ],
  },
  {
    // A piece sewn at the tailor's table: the last snip and a bright chime.
    id: 'sfx_station_schneidern_fertig',
    ...FERTIG,
    lautstaerke: 0.42,
    untertitel: { de: 'Genäht', en: 'Sewn' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.001, 0.05, 3), filter: bandpass(3800, 2), pegel: 0.6 },
      { quelle: ton('dreieck', 523), huelle: schlag(0.003, 0.3, 2.5), pegel: 0.4, start: 0.12 },
      { quelle: ton('dreieck', 784), huelle: schlag(0.004, 0.35, 2.5), pegel: 0.3, start: 0.24 },
    ],
  },
  {
    // The tanning frame: the stretched hide creaks in the wind, now and then a drip of tannin.
    id: 'sfx_station_gerben',
    ...VERARBEITUNG,
    reichweite: 8,
    lautstaerke: 0.16,
    schleife: { dauer: 3 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: bandpass(1800, 0.8), pegel: 0.3 },
      { quelle: ton('saege', 120, 140), huelle: bogen(0.15, 0.1, 0.5, 0.2, 0.2), filter: bandpass(600, 4), vibrato: { tiefe: 25, rate: 5 }, pegel: 0.25, start: 0.5 },
      { quelle: ton('sinus', 900, 500), huelle: schlag(0.002, 0.06, 3), pegel: 0.2, start: 1.9 },
    ],
  },
  {
    // Leather finished on the frame: the hide slaps free, a low chime.
    id: 'sfx_station_gerben_fertig',
    ...FERTIG,
    lautstaerke: 0.42,
    untertitel: { de: 'Gegerbt', en: 'Tanned' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.002, 0.12, 2), filter: bandpass(700, 1.3), pegel: 0.8 },
      { quelle: ton('sinus', 130, 90), huelle: schlag(0.001, 0.08, 2.5), pegel: 0.6 },
      { quelle: ton('dreieck', 392), huelle: schlag(0.004, 0.35, 2.5), pegel: 0.35, start: 0.14 },
    ],
  },
  {
    // Leather in the bags: a supple flap and a creak.
    id: 'sfx_item_leder',
    ...ITEM,
    lautstaerke: 0.34,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.09, 2), filter: bandpass(900, 1.3), pegel: 0.9 },
      { quelle: knistern(60, 0.003, 20), huelle: schlag(0.01, 0.1), filter: bandpass(1400, 1.4), pegel: 0.4 },
    ],
  },
  {
    // Bronze armour in the bags: plates clinking against each other.
    id: 'sfx_item_ruestung_metall',
    ...ITEM,
    lautstaerke: 0.36,
    schichten: [
      { quelle: fm(980, 2.4, 2.5, 0.3), huelle: schlag(0.0005, 0.18, 3), pegel: 0.6, wiederholung: { anzahl: 2, abstand: 0.07, abfall: 0.6, tonhoehe: 1.12 } },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: bandpass(3200, 1.2), pegel: 0.4, wiederholung: { anzahl: 2, abstand: 0.07, abfall: 0.6 } },
    ],
  },
]);
