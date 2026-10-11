/**
 * The kitchen (MASTERPROMPT §18 "Kochen, Ernährung", §27 "Crafting"; docs/SPIEL.md §21; M7-25 … M7-30, strand E):
 *
 * - **Cooking stations** (`sounds` of src/content/stations.ts): the cauldron bubbling over its fire (a hand station, bus
 *   `effekte`), the oven's quiet roar, the smokehouse's smoulder, the hand mill grinding, the fermenting barrel's slow
 *   bubbles, the herb table's mortar (hand); each with the chime of its finished piece or batch (`…_fertig`, subtitled –
 *   a batch is often done while the player is elsewhere).
 * - **Food and drink in the bags** (`ITEM_SFX` of src/content/items/define.ts): a bowl set down (dishes), a glass vial
 *   (potions), the sloshing water skin.
 * - **The salve** (`sounds.benutzen` of the salve): a lid twisted off and a dab rubbed in.
 * - **Spoilage** (`SPOILAGE_SFX`): a stack in the bags gone bad – a wet squelch and a fly (subtitled: the player should know).
 * - **Water** (`WATER_SFX`): the skin gurgling full at a bank, a scoop from the rain collector.
 * - **Meal and potion conditions** (`sound` of src/content/conditions_m7.ts): a short onset in the timbre of the effect –
 *   warmth (low and round), cool (airy), strength (a firm low pulse), stamina (a light rising run), refreshment (a bright
 *   sparkle), healing (a soft swell), a wound dressed (a calm chord).
 *
 * Loops follow src/content/sfx/schema.ts: sustained layers run through the seam (`dauerton`), pulsed layers start after the
 * crossfade (≥ 0,12 s) and repeat at a fraction of the loop length, so the rhythm closes seamlessly.
 */
import { bandpass, bogen, dauerton, defineSfxGroup, digital, fm, hochpass, knistern, rauschen, schlag, tiefpass, ton } from './define';

/** A hand station at work (the cauldron, the herb table): the player's own action, heard around the station. */
const HANDWERK = {
  bus: 'effekte',
  varianten: 2,
  stimmen: 2,
  sperrzeit: 0,
  reichweite: 14,
} as const;

/** A processing station running on its own: a quiet positional bed of the base. */
const VERARBEITUNG = {
  bus: 'umgebung',
  varianten: 2,
  stimmen: 3,
  sperrzeit: 0,
} as const;

/** A finished piece or batch. */
const FERTIG = {
  bus: 'effekte',
  varianten: 2,
  streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.04 },
  stimmen: 2,
  sperrzeit: 0.1,
  reichweite: 16,
} as const;

/** Handling of food and drink in the bags. */
const ITEM = {
  bus: 'effekte',
  varianten: 3,
  streuung: { tonhoehe: 100, lautstaerke: 2, klang: 0.08 },
  stimmen: 3,
  sperrzeit: 0.05,
  reichweite: 12,
} as const;

/** The onset of a condition. */
const ONSET = {
  bus: 'effekte',
  stimmen: 1,
  sperrzeit: 0.5,
  reichweite: 10,
} as const;

export const SFX_KUECHE = defineSfxGroup('kueche', [
  // --- Cooking stations (loops) ----------------------------------------------------------------
  {
    // The cauldron over its fire: a slow bubbling, a pop now and then, the fire's crackle underneath.
    id: 'sfx_station_kessel',
    ...HANDWERK,
    lautstaerke: 0.32,
    schleife: { dauer: 2.4 },
    schichten: [
      { quelle: rauschen('braun'), huelle: dauerton(), filter: tiefpass(500, 1.2), pegel: 0.35 },
      { quelle: ton('sinus', 180, 320), huelle: schlag(0.004, 0.07, 2), filter: bandpass(420, 2), pegel: 0.6, start: 0.2, wiederholung: { anzahl: 4, abstand: 0.55, abfall: 0.9, tonhoehe: 1.12 } },
      { quelle: ton('sinus', 260, 470), huelle: schlag(0.003, 0.05, 2), pegel: 0.35, start: 0.45, wiederholung: { anzahl: 3, abstand: 0.62, abfall: 0.85, tonhoehe: 0.9 } },
      { quelle: knistern(14, 0.004), huelle: dauerton(), filter: hochpass(2500), pegel: 0.35 },
    ],
  },
  {
    // The oven: a low, steady roar of the fire behind the stone, an ember ticking.
    id: 'sfx_station_backofen',
    ...VERARBEITUNG,
    reichweite: 10,
    lautstaerke: 0.2,
    schleife: { dauer: 3 },
    schichten: [
      { quelle: rauschen('braun'), huelle: dauerton(), filter: tiefpass(320, 1.4), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: bandpass(900, 0.8), pegel: 0.2 },
      { quelle: knistern(5, 0.008), huelle: dauerton(), filter: bandpass(2200, 1.2), pegel: 0.45 },
    ],
  },
  {
    // The smokehouse: smouldering wood, the soft hiss of smoke through the slats.
    id: 'sfx_station_raeuchern',
    ...VERARBEITUNG,
    reichweite: 9,
    lautstaerke: 0.16,
    schleife: { dauer: 3 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: bandpass(1600, 0.7), pegel: 0.45 },
      { quelle: knistern(9, 0.006), huelle: dauerton(), filter: bandpass(1400, 1.1), pegel: 0.55 },
      { quelle: rauschen('braun'), huelle: dauerton(), filter: tiefpass(260), pegel: 0.4 },
    ],
  },
  {
    // The hand mill: stone grinding on stone, a turn of the crank every second.
    id: 'sfx_station_muehle',
    ...VERARBEITUNG,
    reichweite: 10,
    lautstaerke: 0.2,
    schleife: { dauer: 2 },
    schichten: [
      { quelle: digital(180, 260), huelle: bogen(0.1, 0.1, 0.7, 0.55, 0.15), filter: bandpass(600, 1.4), pegel: 0.6, start: 0.15, wiederholung: { anzahl: 2, abstand: 1, abfall: 0.95, tonhoehe: 0.95 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.1, 0.1, 0.7, 0.55, 0.15), filter: bandpass(1300, 1), pegel: 0.4, start: 0.15, wiederholung: { anzahl: 2, abstand: 1, abfall: 0.95 } },
      { quelle: ton('sinus', 95, 80), huelle: schlag(0.004, 0.08, 3), pegel: 0.35, start: 0.95 },
    ],
  },
  {
    // The fermenting barrel: slow, deep bubbles rising through the mash.
    id: 'sfx_station_gaeren',
    ...VERARBEITUNG,
    reichweite: 7,
    lautstaerke: 0.14,
    schleife: { dauer: 4 },
    schichten: [
      { quelle: ton('sinus', 140, 260), huelle: schlag(0.006, 0.09, 2), filter: bandpass(300, 2), pegel: 0.7, start: 0.4, wiederholung: { anzahl: 3, abstand: 1.3, abfall: 0.9, tonhoehe: 1.18 } },
      { quelle: ton('sinus', 110, 190), huelle: schlag(0.006, 0.12, 2), pegel: 0.4, start: 1.1, wiederholung: { anzahl: 2, abstand: 1.7, abfall: 0.85 } },
      { quelle: rauschen('braun'), huelle: dauerton(), filter: tiefpass(200), pegel: 0.2 },
    ],
  },
  {
    // The herb table: a pestle grinding in the mortar, a knock against its rim.
    id: 'sfx_station_moerser',
    ...HANDWERK,
    lautstaerke: 0.3,
    schleife: { dauer: 1.6 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.08, 0.6, 0.35, 0.1), filter: bandpass(1900, 1.3, 1400), pegel: 0.6, start: 0.15, wiederholung: { anzahl: 2, abstand: 0.6, abfall: 0.9, tonhoehe: 1.06 } },
      { quelle: fm(620, 2.4, 1.4, 0.2), huelle: schlag(0.001, 0.06, 3), pegel: 0.4, start: 1.35 },
      { quelle: knistern(60, 0.003), huelle: bogen(0.05, 0.08, 0.6, 0.35, 0.1), filter: hochpass(3000), pegel: 0.3, start: 0.15, wiederholung: { anzahl: 2, abstand: 0.6, abfall: 0.9 } },
    ],
  },
  // --- Finished pieces and batches -------------------------------------------------------------
  {
    // Ladled out: a wet slop into the bowl, a warm chime.
    id: 'sfx_station_kessel_fertig',
    ...FERTIG,
    lautstaerke: 0.46,
    untertitel: { de: 'Gekocht', en: 'Cooked' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.16, 2), filter: bandpass(800, 1.5, 500), pegel: 0.7 },
      { quelle: ton('sinus', 210, 150), huelle: schlag(0.002, 0.09, 3), pegel: 0.6, start: 0.05 },
      { quelle: ton('dreieck', 523), huelle: schlag(0.004, 0.35, 2), pegel: 0.4, start: 0.14, wiederholung: { anzahl: 2, abstand: 0.1, abfall: 0.9, tonhoehe: 1.26 } },
    ],
  },
  {
    // Out of the oven: the stone door scraping open, the bread knocked hollow, a chime.
    id: 'sfx_station_backofen_fertig',
    ...FERTIG,
    lautstaerke: 0.48,
    untertitel: { de: 'Fertig gebacken', en: 'Baked' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.02, 0.18, 2), filter: bandpass(1500, 1.6, 900), pegel: 0.5 },
      { quelle: ton('sinus', 170, 140), huelle: schlag(0.001, 0.06, 3), pegel: 0.7, start: 0.24, wiederholung: { anzahl: 2, abstand: 0.11, abfall: 0.85 } },
      { quelle: ton('dreieck', 659), huelle: schlag(0.004, 0.35, 2), pegel: 0.35, start: 0.45 },
    ],
  },
  {
    // Smoked through: the hatch opening, a waft of smoke, a low chime.
    id: 'sfx_station_raeuchern_fertig',
    ...FERTIG,
    lautstaerke: 0.44,
    untertitel: { de: 'Geräuchert', en: 'Smoked' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.08, 0.1, 0.5, 0.2, 0.3), filter: bandpass(1100, 0.8, 700), pegel: 0.6 },
      { quelle: ton('sinus', 130, 110), huelle: schlag(0.002, 0.08, 3), pegel: 0.5, start: 0.1 },
      { quelle: ton('dreieck', 440), huelle: schlag(0.005, 0.4, 2), pegel: 0.35, start: 0.3, wiederholung: { anzahl: 2, abstand: 0.12, abfall: 0.9, tonhoehe: 1.335 } },
    ],
  },
  {
    // Ground: the last turn of the stone, flour poured into a sack.
    id: 'sfx_station_muehle_fertig',
    ...FERTIG,
    lautstaerke: 0.44,
    untertitel: { de: 'Gemahlen', en: 'Ground' },
    schichten: [
      { quelle: digital(160, 120), huelle: schlag(0.02, 0.2, 2), filter: bandpass(550, 1.4), pegel: 0.6 },
      { quelle: rauschen('weiss'), huelle: bogen(0.05, 0.05, 0.5, 0.25, 0.2), filter: bandpass(3000, 0.9, 1800), pegel: 0.4, start: 0.2 },
      { quelle: ton('dreieck', 587), huelle: schlag(0.004, 0.32, 2), pegel: 0.35, start: 0.5 },
    ],
  },
  {
    // Fermented: the bung pulled with a pop, a last bubble, a mellow chime.
    id: 'sfx_station_gaeren_fertig',
    ...FERTIG,
    lautstaerke: 0.46,
    untertitel: { de: 'Ausgegoren', en: 'Fermented' },
    schichten: [
      { quelle: ton('sinus', 520, 260), huelle: schlag(0.001, 0.05, 3), pegel: 0.7 },
      { quelle: ton('sinus', 160, 280), huelle: schlag(0.006, 0.1, 2), pegel: 0.45, start: 0.12 },
      { quelle: ton('dreieck', 392), huelle: schlag(0.005, 0.45, 2), pegel: 0.35, start: 0.25, wiederholung: { anzahl: 2, abstand: 0.12, abfall: 0.9, tonhoehe: 1.26 } },
    ],
  },
  {
    // Brewed: the potion poured into its vial – a glassy glug and a bright chime.
    id: 'sfx_station_moerser_fertig',
    ...FERTIG,
    lautstaerke: 0.46,
    untertitel: { de: 'Zubereitet', en: 'Brewed' },
    schichten: [
      { quelle: ton('sinus', 380, 720), huelle: schlag(0.004, 0.06, 2), filter: bandpass(700, 2), pegel: 0.5, wiederholung: { anzahl: 3, abstand: 0.08, abfall: 0.85, tonhoehe: 1.1 } },
      { quelle: fm(1568, 3.5, 1.2, 0.1), huelle: schlag(0.001, 0.12, 3), pegel: 0.25, start: 0.28 },
      { quelle: ton('dreieck', 784), huelle: schlag(0.004, 0.35, 2), pegel: 0.35, start: 0.32 },
    ],
  },
  // --- Food and drink in the bags ---------------------------------------------------------------
  {
    // A dish: a wooden bowl set down, a spoon's clink.
    id: 'sfx_item_gericht',
    ...ITEM,
    lautstaerke: 0.3,
    schichten: [
      { quelle: ton('sinus', 240, 190), huelle: schlag(0.001, 0.05, 3), pegel: 0.7 },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.03, 3), filter: bandpass(1300, 1.3), pegel: 0.4 },
      { quelle: fm(2100, 2.8, 1, 0.1), huelle: schlag(0.0005, 0.05, 3), pegel: 0.15, start: 0.04 },
    ],
  },
  {
    // A potion: a glass vial clinking, the liquid sloshing.
    id: 'sfx_item_trank',
    ...ITEM,
    lautstaerke: 0.3,
    schichten: [
      { quelle: fm(2600, 2.76, 0.8, 0.1), huelle: schlag(0.0005, 0.08, 3), pegel: 0.4 },
      { quelle: ton('sinus', 420, 640), huelle: schlag(0.005, 0.07, 2), filter: bandpass(600, 2), pegel: 0.4, start: 0.03 },
    ],
  },
  {
    // The water skin: leather creaking, water sloshing inside.
    id: 'sfx_item_schlauch',
    ...ITEM,
    lautstaerke: 0.3,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.12, 2), filter: bandpass(700, 1.6, 450), pegel: 0.7 },
      { quelle: ton('saege', 120, 135), huelle: schlag(0.01, 0.06, 2), filter: bandpass(600, 3), pegel: 0.2 },
    ],
  },
  {
    // The salve: a lid twisted off, a dab rubbed in.
    id: 'sfx_heilen_salbe',
    bus: 'effekte',
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 },
    stimmen: 1,
    sperrzeit: 0.2,
    reichweite: 10,
    lautstaerke: 0.38,
    untertitel: { de: 'Salbe aufgetragen', en: 'Salve applied' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.01, 0.08, 2), filter: bandpass(2600, 1.5), pegel: 0.5 },
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.1, 0.5, 0.3, 0.15), filter: bandpass(1100, 1.2, 1500), pegel: 0.6, start: 0.18, wiederholung: { anzahl: 2, abstand: 0.42, abfall: 0.85 } },
    ],
  },
  // --- Spoilage and water ------------------------------------------------------------------------
  {
    // Gone bad in the bags: a wet squelch, a fly buzzing off.
    id: 'sfx_kueche_verdorben',
    bus: 'effekte',
    varianten: 2,
    streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.06 },
    stimmen: 1,
    sperrzeit: 1,
    reichweite: 8,
    lautstaerke: 0.34,
    untertitel: { de: 'Etwas ist verdorben', en: 'Something spoiled' },
    schichten: [
      { quelle: rauschen('braun'), huelle: schlag(0.01, 0.14, 2), filter: tiefpass(600, 2, 250), pegel: 0.8 },
      { quelle: ton('sinus', 150, 90), huelle: schlag(0.004, 0.1, 2), pegel: 0.4 },
      { quelle: ton('saege', 210, 240), huelle: bogen(0.05, 0.05, 0.5, 0.35, 0.25), filter: bandpass(420, 3), vibrato: { tiefe: 40, rate: 18 }, pegel: 0.25, start: 0.2 },
    ],
  },
  {
    // The water skin filling at a bank: a gurgling rush rising in pitch as it fills.
    id: 'sfx_wasser_schlauch_fuellen',
    bus: 'effekte',
    stimmen: 1,
    sperrzeit: 0.3,
    reichweite: 14,
    lautstaerke: 0.42,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.1, 0.7, 0.4, 0.2), filter: bandpass(800, 1.3, 1500), pegel: 0.8 },
      { quelle: ton('sinus', 200, 480), huelle: bogen(0.1, 0.1, 0.5, 0.35, 0.2), filter: bandpass(380, 3, 820), pegel: 0.35 },
      { quelle: knistern(70, 0.006), huelle: bogen(0.05, 0.1, 0.6, 0.4, 0.2), filter: bandpass(2300, 1.4), pegel: 0.3 },
    ],
  },
  {
    // A scoop from the rain collector: the vessel dipped into the barrel, water pouring off it.
    id: 'sfx_wasser_sammler_schoepfen',
    bus: 'effekte',
    stimmen: 1,
    sperrzeit: 0.3,
    reichweite: 14,
    lautstaerke: 0.42,
    schichten: [
      { quelle: ton('sinus', 300, 140), huelle: schlag(0.003, 0.12, 2), filter: bandpass(420, 1.6), pegel: 0.6 },
      { quelle: rauschen('rosa'), huelle: bogen(0.04, 0.1, 0.6, 0.25, 0.25), filter: bandpass(1100, 1.2, 1700), pegel: 0.7, start: 0.08 },
      { quelle: ton('sinus', 820, 1500), huelle: schlag(0.001, 0.04, 2), pegel: 0.15, start: 0.4, wiederholung: { anzahl: 3, abstand: 0.11, abfall: 0.7, tonhoehe: 0.9 } },
    ],
  },
  // --- Meal and potion conditions (onsets) --------------------------------------------------------
  {
    // Warmed (a hot meal): a low, round swell.
    id: 'sfx_zustand_gewaermt',
    ...ONSET,
    lautstaerke: 0.3,
    schichten: [
      { quelle: ton('dreieck', 196), huelle: bogen(0.15, 0.3, 0.6, 0.2, 0.5), filter: tiefpass(900), pegel: 0.7 },
      { quelle: ton('dreieck', 247), huelle: bogen(0.2, 0.3, 0.5, 0.2, 0.5), filter: tiefpass(1000), pegel: 0.45, start: 0.06 },
      { quelle: rauschen('braun'), huelle: bogen(0.2, 0.2, 0.4, 0.2, 0.4), filter: tiefpass(300), pegel: 0.25 },
    ],
  },
  {
    // Cooled (a cooling drink): an airy breath falling, a glassy shimmer.
    id: 'sfx_zustand_gekuehlt',
    ...ONSET,
    lautstaerke: 0.3,
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.1, 0.2, 0.5, 0.2, 0.4), filter: bandpass(4200, 1, 2400), pegel: 0.5 },
      { quelle: fm(1760, 3.01, 0.8, 0.05), huelle: schlag(0.01, 0.6, 2), pegel: 0.25, start: 0.05 },
      { quelle: ton('sinus', 1318), huelle: schlag(0.01, 0.5, 2), pegel: 0.2, start: 0.15 },
    ],
  },
  {
    // Strengthened (a hearty stew): a firm low pulse, twice.
    id: 'sfx_zustand_gestaerkt',
    ...ONSET,
    lautstaerke: 0.34,
    schichten: [
      { quelle: ton('sinus', 98, 82), huelle: schlag(0.004, 0.18, 2), pegel: 0.8, wiederholung: { anzahl: 2, abstand: 0.22, abfall: 0.9, tonhoehe: 1.5 } },
      { quelle: ton('dreieck', 196), huelle: bogen(0.05, 0.2, 0.5, 0.15, 0.3), filter: tiefpass(800), pegel: 0.4, start: 0.2 },
    ],
  },
  {
    // Enduring (fish soup): a light run rising.
    id: 'sfx_zustand_ausdauernd',
    ...ONSET,
    lautstaerke: 0.3,
    schichten: [
      { quelle: ton('dreieck', 392), huelle: schlag(0.004, 0.14, 2), filter: tiefpass(2200), pegel: 0.6, wiederholung: { anzahl: 4, abstand: 0.08, abfall: 0.92, tonhoehe: 1.122 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.1, 0.4, 0.25, 0.2), filter: bandpass(1600, 1), pegel: 0.2 },
    ],
  },
  {
    // Refreshed (a light soup, a salad, a tea): a bright sparkle.
    id: 'sfx_zustand_erquickt',
    ...ONSET,
    lautstaerke: 0.3,
    schichten: [
      { quelle: fm(1047, 2, 1.2, 0.1), huelle: schlag(0.004, 0.3, 2), pegel: 0.4, wiederholung: { anzahl: 3, abstand: 0.07, abfall: 0.85, tonhoehe: 1.335 } },
      { quelle: knistern(80, 0.002, 20), huelle: bogen(0.02, 0.1, 0.4, 0.2, 0.2), filter: hochpass(5000), pegel: 0.3 },
    ],
  },
  {
    // Healing (a healing potion): a soft swell of a chord, slowly.
    id: 'sfx_zustand_heilend',
    ...ONSET,
    lautstaerke: 0.32,
    schichten: [
      { quelle: ton('sinus', 330), huelle: bogen(0.3, 0.3, 0.6, 0.3, 0.6), pegel: 0.5 },
      { quelle: ton('sinus', 415), huelle: bogen(0.35, 0.3, 0.5, 0.3, 0.6), pegel: 0.4, start: 0.08 },
      { quelle: ton('sinus', 494), huelle: bogen(0.4, 0.3, 0.45, 0.3, 0.6), pegel: 0.35, start: 0.16 },
    ],
  },
  {
    // Wound dressed (the salve): a calm, low chord settling.
    id: 'sfx_zustand_wundversorgt',
    ...ONSET,
    lautstaerke: 0.3,
    schichten: [
      { quelle: ton('dreieck', 220), huelle: bogen(0.1, 0.3, 0.5, 0.25, 0.5), filter: tiefpass(1100), pegel: 0.6 },
      { quelle: ton('dreieck', 277), huelle: bogen(0.15, 0.3, 0.45, 0.25, 0.5), filter: tiefpass(1200), pegel: 0.45, start: 0.05 },
      { quelle: ton('dreieck', 330), huelle: bogen(0.2, 0.3, 0.4, 0.25, 0.5), filter: tiefpass(1300), pegel: 0.35, start: 0.1 },
    ],
  },
]);
