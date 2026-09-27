/**
 * Stations at work (MASTERPROMPT §15.1, §15.2, §27 "Crafting"; M4-29): the loop while a station works and the sound
 * of its finished piece or batch, per station line (named by the station's `sounds`, src/content/stations.ts); fuel
 * laid on a fire or into a fired station, a station standing still, a fired station cooling down, and mending a piece
 * (§13.1 repair).
 *
 * - **Hand stations** work while the player's crafting queue runs at them (bus `effekte`, at the station): the bench
 *   (planing and nailing), the saw horse (saw strokes), the mason's bench (chisel taps), the bronze anvil (hammer
 *   blows ringing), the grindstone (the wheel turning, steel hissing on stone), the spinning wheel (a whirr and the
 *   treadle), the camp fire as a cooking station (sizzling).
 * - **Processing stations** run on their own (bus `umgebung`, positioned, quieter): the drying rack (a breeze in
 *   hanging hides and herbs), the charcoal mound (smouldering), the clay kiln (a roaring draught), the smelting
 *   furnace (fire and the bellows breathing).
 * - `…_fertig`: a finished piece (a pleased chime in the timbre of the station) or batch (processing, with subtitles –
 *   the player is often elsewhere when it comes out).
 *
 * Loops follow src/content/sfx/schema.ts: sustained layers run through the seam (`dauerton`), pulsed layers start
 * after the crossfade (≥ 0,12 s) and repeat at a fraction of the loop length, so the rhythm closes seamlessly.
 */
import { bandpass, bogen, dauerton, defineSfxGroup, digital, fm, hochpass, knistern, puls, rauschen, schlag, tiefpass, ton } from './define';

/** A hand station at work: the player's own action, heard around the station. */
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

export const SFX_STATIONEN = defineSfxGroup('stationen', [
  // --- Hand stations at work (loops) -----------------------------------------------------------
  {
    // Werkbank I–II: a plane stroke, three nail knocks, a plane stroke, two knocks.
    id: 'sfx_station_werkbank',
    ...HANDWERK,
    lautstaerke: 0.36,
    schleife: { dauer: 2.4 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.04, 0.08, 0.6, 0.22, 0.08), filter: bandpass(2400, 1.2, 1600), pegel: 0.55, start: 0.15, wiederholung: { anzahl: 2, abstand: 1.2, abfall: 0.9, tonhoehe: 1.05 } },
      { quelle: ton('sinus', 300, 240), huelle: schlag(0.001, 0.07, 3), pegel: 0.8, start: 0.62, wiederholung: { anzahl: 3, abstand: 0.16, abfall: 0.85 } },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: bandpass(2800, 1.2), pegel: 0.5, start: 0.62, wiederholung: { anzahl: 3, abstand: 0.16, abfall: 0.85 } },
      { quelle: ton('sinus', 280, 220), huelle: schlag(0.001, 0.08, 3), pegel: 0.7, start: 1.95, wiederholung: { anzahl: 2, abstand: 0.2, abfall: 0.8 } },
    ],
  },
  {
    // Sägebock: push and pull of a saw, teeth rasping, the log resonating.
    id: 'sfx_station_saege',
    ...HANDWERK,
    lautstaerke: 0.38,
    schleife: { dauer: 1.6 },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.06, 0.1, 0.7, 0.3, 0.1), filter: bandpass(3200, 2, 2400), pegel: 0.8, start: 0.14, wiederholung: { anzahl: 2, abstand: 0.72, abfall: 0.9, tonhoehe: 0.8 } },
      { quelle: digital(900, 700), huelle: bogen(0.06, 0.1, 0.7, 0.3, 0.1), filter: bandpass(2000, 1.5), pegel: 0.35, start: 0.14, wiederholung: { anzahl: 2, abstand: 0.72, abfall: 0.9, tonhoehe: 0.85 } },
      { quelle: ton('saege', 120, 110), huelle: bogen(0.06, 0.1, 0.7, 0.3, 0.1), filter: tiefpass(600), pegel: 0.15, start: 0.14, wiederholung: { anzahl: 2, abstand: 0.72, abfall: 0.9 } },
    ],
  },
  {
    // Steinmetzbank: the mallet drives the chisel, chips fly.
    id: 'sfx_station_meissel',
    ...HANDWERK,
    lautstaerke: 0.36,
    schleife: { dauer: 1.8 },
    schichten: [
      { quelle: fm(1500, 1.41, 2, 0.2), huelle: schlag(0.0008, 0.07, 3), pegel: 0.6, start: 0.13, wiederholung: { anzahl: 4, abstand: 0.42, abfall: 0.9, tonhoehe: 0.97 } },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: bandpass(3500, 1.2), pegel: 0.6, start: 0.13, wiederholung: { anzahl: 4, abstand: 0.42, abfall: 0.9 } },
      { quelle: knistern(200, 0.002, 30), huelle: schlag(0.003, 0.1), filter: hochpass(2500), pegel: 0.4, start: 0.14, wiederholung: { anzahl: 4, abstand: 0.42, abfall: 0.9 } },
      { quelle: ton('sinus', 260, 200), huelle: schlag(0.001, 0.05, 3), pegel: 0.5, start: 0.13, wiederholung: { anzahl: 4, abstand: 0.42, abfall: 0.9 } },
    ],
  },
  {
    // Amboss (Bronze): three hammer blows ringing on the anvil, then two light taps on its face.
    id: 'sfx_station_amboss',
    ...HANDWERK,
    lautstaerke: 0.4,
    schleife: { dauer: 2 },
    schichten: [
      { quelle: fm(880, 3.5, 3, 0.4), huelle: schlag(0.0008, 0.3, 3), pegel: 0.6, start: 0.13, wiederholung: { anzahl: 3, abstand: 0.38, abfall: 0.9 } },
      { quelle: fm(2350, 1.41, 1.2, 0.1), huelle: schlag(0.0008, 0.18, 3), pegel: 0.35, start: 0.13, wiederholung: { anzahl: 3, abstand: 0.38, abfall: 0.9 } },
      { quelle: rauschen('weiss'), huelle: schlag(0.0003, 0.015, 3), filter: hochpass(3000), pegel: 0.5, start: 0.13, wiederholung: { anzahl: 3, abstand: 0.38, abfall: 0.9 } },
      { quelle: fm(880, 3.5, 1.5, 0.2), huelle: schlag(0.0008, 0.25, 3), pegel: 0.35, start: 1.4, wiederholung: { anzahl: 2, abstand: 0.12, abfall: 0.5 } },
    ],
  },
  {
    // Schleifstein: the wheel rumbling round, the treadle, steel hissing on stone in swells.
    id: 'sfx_station_schleifstein',
    ...HANDWERK,
    lautstaerke: 0.34,
    schleife: { dauer: 2 },
    schichten: [
      { quelle: rauschen('braun'), huelle: dauerton(), filter: tiefpass(250), pegel: 0.35 },
      { quelle: rauschen('weiss'), huelle: dauerton(), filter: bandpass(4200, 1.5), pegel: 0.2 },
      { quelle: rauschen('weiss'), huelle: bogen(0.2, 0.2, 0.7, 0.3, 0.2), filter: bandpass(2600, 1.2), pegel: 0.6, start: 0.2, wiederholung: { anzahl: 2, abstand: 1, abfall: 0.9 } },
      { quelle: ton('sinus', 90, 70), huelle: schlag(0.005, 0.08), pegel: 0.4, start: 0.13, wiederholung: { anzahl: 4, abstand: 0.5 } },
    ],
  },
  {
    // Spinnrad: the wheel whirring round in swells (four turns per loop), the click-clack of the treadle.
    id: 'sfx_station_spinnrad',
    ...HANDWERK,
    lautstaerke: 0.3,
    schleife: { dauer: 1.5 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: bandpass(900, 1.2), pegel: 0.12 },
      { quelle: rauschen('rosa'), huelle: bogen(0.12, 0.1, 0.6, 0.05, 0.1), filter: bandpass(1100, 1.5), pegel: 0.4, start: 0.13, wiederholung: { anzahl: 4, abstand: 0.375 } },
      { quelle: rauschen('braun'), huelle: dauerton(), filter: tiefpass(180), pegel: 0.2 },
      { quelle: ton('sinus', 180, 150), huelle: schlag(0.001, 0.05, 3), pegel: 0.7, start: 0.13, wiederholung: { anzahl: 2, abstand: 0.75 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.025, 3), filter: bandpass(1600, 1.4), pegel: 0.5, start: 0.45, wiederholung: { anzahl: 2, abstand: 0.75 } },
    ],
  },
  {
    // Lagerfeuer as a cooking station: fat sizzling, the odd pop.
    id: 'sfx_station_brutzeln',
    ...HANDWERK,
    lautstaerke: 0.3,
    schleife: { dauer: 2 },
    schichten: [
      { quelle: rauschen('weiss'), huelle: dauerton(), filter: hochpass(3500), pegel: 0.3 },
      { quelle: knistern(120, 0.002), huelle: dauerton(), filter: hochpass(4000), pegel: 0.8 },
      { quelle: knistern(6, 0.01), huelle: dauerton(), filter: bandpass(1800, 1.2), pegel: 0.5 },
    ],
  },
  // --- Processing stations running (loops) -----------------------------------------------------
  {
    // Trockengestell: a breeze in the hanging hides and herbs, the frame creaking now and then.
    id: 'sfx_station_trocknen',
    ...VERARBEITUNG,
    reichweite: 8,
    lautstaerke: 0.16,
    schleife: { dauer: 3 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: bandpass(2500, 0.8), pegel: 0.35 },
      { quelle: knistern(15, 0.004), huelle: dauerton(), filter: bandpass(3000, 1), pegel: 0.6 },
      { quelle: ton('saege', 150, 170), huelle: bogen(0.1, 0.1, 0.5, 0.15, 0.15), filter: bandpass(700, 4), vibrato: { tiefe: 20, rate: 6 }, pegel: 0.2, start: 1.2 },
    ],
  },
  {
    // Köhlermeiler: the mound smouldering – a low rumble, hissing vents, deep cracks.
    id: 'sfx_station_meiler',
    ...VERARBEITUNG,
    reichweite: 14,
    lautstaerke: 0.26,
    schleife: { dauer: 3 },
    schichten: [
      { quelle: rauschen('braun'), huelle: dauerton(), filter: tiefpass(300), pegel: 0.5 },
      { quelle: rauschen('weiss'), huelle: dauerton(), filter: bandpass(5000, 1), pegel: 0.1 },
      { quelle: knistern(3, 0.03), huelle: dauerton(), filter: tiefpass(900), pegel: 0.6 },
      { quelle: knistern(12, 0.004), huelle: dauerton(), filter: hochpass(2000), pegel: 0.3 },
    ],
  },
  {
    // Lehmofen: the draught roaring through the kiln, embers crackling.
    id: 'sfx_station_ofen',
    ...VERARBEITUNG,
    reichweite: 16,
    lautstaerke: 0.3,
    schleife: { dauer: 3 },
    schichten: [
      { quelle: rauschen('braun'), huelle: dauerton(), filter: tiefpass(200), pegel: 0.5 },
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: bandpass(450, 0.8), pegel: 0.5 },
      { quelle: knistern(8, 0.008), huelle: dauerton(), filter: bandpass(1800, 1.1), pegel: 0.6 },
      { quelle: knistern(30, 0.0015), huelle: dauerton(), filter: hochpass(4000), pegel: 0.2 },
    ],
  },
  {
    // Schmelzofen: the fire roaring, the bellows breathing into it twice per loop, each breath flaring the fire.
    id: 'sfx_station_blasebalg',
    ...VERARBEITUNG,
    reichweite: 18,
    lautstaerke: 0.34,
    schleife: { dauer: 2.4 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: dauerton(), filter: bandpass(500, 0.8), pegel: 0.35 },
      { quelle: rauschen('braun'), huelle: dauerton(), filter: tiefpass(200), pegel: 0.35 },
      { quelle: rauschen('rosa'), huelle: bogen(0.25, 0.1, 0.6, 0.2, 0.3), filter: bandpass(700, 1, 1400), pegel: 0.8, start: 0.15, wiederholung: { anzahl: 2, abstand: 1.2 } },
      { quelle: ton('saege', 120, 100), huelle: schlag(0.02, 0.2, 2), filter: bandpass(500, 3), pegel: 0.15, start: 0.15, wiederholung: { anzahl: 2, abstand: 1.2 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.1, 0.3, 0.3, 0.2, 0.4), filter: tiefpass(900), pegel: 0.4, start: 0.4, wiederholung: { anzahl: 2, abstand: 1.2 } },
    ],
  },
  // --- Finished pieces and batches ------------------------------------------------------------
  {
    // Piece finished at the bench: a last knock, a woody two-note chime.
    id: 'sfx_station_werkbank_fertig',
    ...FERTIG,
    lautstaerke: 0.46,
    untertitel: { de: 'Hergestellt', en: 'Crafted' },
    schichten: [
      { quelle: ton('sinus', 250, 190), huelle: schlag(0.001, 0.08, 3), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.04, 3), filter: bandpass(1100, 1.4), pegel: 0.5 },
      { quelle: ton('dreieck', 587), huelle: schlag(0.004, 0.3, 2), pegel: 0.45, start: 0.08, wiederholung: { anzahl: 2, abstand: 0.09, abfall: 0.95, tonhoehe: 1.498 } },
    ],
  },
  {
    // Sawn through: the last stroke, the offcut dropping, a chime.
    id: 'sfx_station_saege_fertig',
    ...FERTIG,
    lautstaerke: 0.46,
    untertitel: { de: 'Zugesägt', en: 'Sawn' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.02, 0.12, 2), filter: bandpass(3000, 2), pegel: 0.6 },
      { quelle: ton('sinus', 320, 240), huelle: schlag(0.001, 0.06, 3), pegel: 0.7, start: 0.15, wiederholung: { anzahl: 2, abstand: 0.07, abfall: 0.7, tonhoehe: 0.9 } },
      { quelle: ton('dreieck', 1047), huelle: schlag(0.004, 0.35, 2.5), pegel: 0.3, start: 0.25 },
    ],
  },
  {
    // Stone dressed: the block set down with a clack, a stony chime.
    id: 'sfx_station_meissel_fertig',
    ...FERTIG,
    lautstaerke: 0.48,
    untertitel: { de: 'Behauen', en: 'Dressed' },
    schichten: [
      { quelle: ton('sinus', 120, 70), huelle: schlag(0.002, 0.14, 3), pegel: 0.9 },
      { quelle: fm(900, 1.4, 2, 0.2), huelle: schlag(0.0008, 0.08, 3), pegel: 0.45 },
      { quelle: fm(784, 2, 1.2, 0.1), huelle: schlag(0.004, 0.4, 2.5), pegel: 0.3, start: 0.12 },
    ],
  },
  {
    // Forged: the last blow rings out, the piece hisses in the quench.
    id: 'sfx_station_amboss_fertig',
    ...FERTIG,
    lautstaerke: 0.52,
    untertitel: { de: 'Geschmiedet', en: 'Forged' },
    schichten: [
      { quelle: fm(880, 3.5, 3, 0.2), huelle: schlag(0.0008, 0.6, 3), pegel: 0.6 },
      { quelle: fm(2350, 1.41, 1.2, 0), huelle: schlag(0.0008, 0.4, 3), pegel: 0.3 },
      { quelle: rauschen('weiss'), huelle: bogen(0.02, 0.2, 0.5, 0.3, 0.5), filter: hochpass(2500, 0.7, 4500), pegel: 0.5, start: 0.3 },
      { quelle: knistern(300, 0.002, 30), huelle: schlag(0.02, 0.6), filter: hochpass(3000), pegel: 0.3, start: 0.3 },
    ],
  },
  {
    // Sharpened: a bright "shing" and the blade ringing.
    id: 'sfx_station_schleifstein_fertig',
    ...FERTIG,
    lautstaerke: 0.46,
    untertitel: { de: 'Geschliffen', en: 'Sharpened' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.01, 0.12, 2), filter: hochpass(5000), pegel: 0.6 },
      { quelle: fm(1760, 2.4, 1.5, 0.1), huelle: schlag(0.001, 0.8, 3), pegel: 0.5, start: 0.06 },
      { quelle: ton('sinus', 3520), huelle: schlag(0.001, 0.4, 3), pegel: 0.15, start: 0.06 },
    ],
  },
  {
    // Spun: the wheel slowing down, the thread plucked taut.
    id: 'sfx_station_spinnrad_fertig',
    ...FERTIG,
    lautstaerke: 0.42,
    untertitel: { de: 'Gesponnen', en: 'Spun' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.4, 1.5), filter: bandpass(900, 1.2, 300), pegel: 0.6 },
      { quelle: ton('dreieck', 523, 520), huelle: schlag(0.002, 0.3, 2.5), vibrato: { tiefe: 15, rate: 12 }, pegel: 0.45, start: 0.2 },
      { quelle: ton('dreieck', 784), huelle: schlag(0.004, 0.35, 2.5), pegel: 0.3, start: 0.32 },
    ],
  },
  {
    // Cooked at the camp fire: a sizzle bursting as it is pulled from the flames, a warm chime.
    id: 'sfx_station_brutzeln_fertig',
    ...FERTIG,
    lautstaerke: 0.44,
    untertitel: { de: 'Gegart', en: 'Cooked' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.005, 0.3, 2), filter: hochpass(3000), pegel: 0.5 },
      { quelle: knistern(200, 0.002, 30), huelle: schlag(0.01, 0.35), filter: hochpass(3500), pegel: 0.5 },
      { quelle: puls(523, 0.25), huelle: schlag(0.004, 0.3, 2), filter: tiefpass(3000), pegel: 0.4, start: 0.12, wiederholung: { anzahl: 2, abstand: 0.09, abfall: 0.95, tonhoehe: 1.26 } },
    ],
  },
  {
    // Batch dried: the rack rustling as it is shaken out, a soft chime.
    id: 'sfx_station_trocknen_fertig',
    ...FERTIG,
    lautstaerke: 0.36,
    untertitel: { de: 'Getrocknet', en: 'Dried' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.25, 1.5), filter: bandpass(2800, 0.8), pegel: 0.6 },
      { quelle: knistern(300, 0.002, 60), huelle: schlag(0.02, 0.25), filter: hochpass(3000), pegel: 0.4 },
      { quelle: ton('dreieck', 880), huelle: schlag(0.004, 0.4, 2.5), pegel: 0.35, start: 0.15 },
    ],
  },
  {
    // Charcoal done: glassy lumps of charcoal clinking out of the mound.
    id: 'sfx_station_meiler_fertig',
    ...FERTIG,
    lautstaerke: 0.44,
    untertitel: { de: 'Holzkohle fertig', en: 'Charcoal done' },
    schichten: [
      { quelle: knistern(400, 0.004, 60), huelle: schlag(0.01, 0.4, 1.5), filter: bandpass(2500, 1), pegel: 0.5 },
      { quelle: fm(2200, 1.5, 1, 0.1), huelle: schlag(0.0008, 0.08, 3), pegel: 0.45, start: 0.04, wiederholung: { anzahl: 3, abstand: 0.09, abfall: 0.75, tonhoehe: 0.92 } },
      { quelle: ton('dreieck', 698), huelle: schlag(0.004, 0.35, 2.5), pegel: 0.3, start: 0.3 },
    ],
  },
  {
    // Kiln batch fired: ceramic tinking as it cools, a clear chime.
    id: 'sfx_station_ofen_fertig',
    ...FERTIG,
    lautstaerke: 0.44,
    untertitel: { de: 'Gebrannt', en: 'Fired' },
    schichten: [
      { quelle: fm(1900, 2.1, 1.2, 0.1), huelle: schlag(0.0008, 0.25, 3), pegel: 0.5, wiederholung: { anzahl: 2, abstand: 0.11, abfall: 0.7, tonhoehe: 1.12 } },
      { quelle: ton('sinus', 180, 130), huelle: schlag(0.002, 0.06, 3), pegel: 0.5 },
      { quelle: ton('dreieck', 1047), huelle: schlag(0.004, 0.4, 2.5), pegel: 0.3, start: 0.24 },
    ],
  },
  {
    // Metal smelted: the melt pouring into the mould, a hiss, the ingot clinking.
    id: 'sfx_station_schmelzen_fertig',
    ...FERTIG,
    lautstaerke: 0.5,
    untertitel: { de: 'Barren gegossen', en: 'Ingot cast' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.2, 0.5, 0.3, 0.3), filter: bandpass(900, 2, 600), pegel: 0.6 },
      { quelle: rauschen('weiss'), huelle: bogen(0.02, 0.2, 0.4, 0.3, 0.4), filter: hochpass(3000), pegel: 0.4, start: 0.35 },
      { quelle: fm(1200, 2.7, 1.5, 0.1), huelle: schlag(0.0008, 0.3, 3), pegel: 0.45, start: 0.85 },
      { quelle: ton('sinus', 150, 110), huelle: schlag(0.002, 0.08, 3), pegel: 0.5, start: 0.85 },
    ],
  },
  // --- Fuel, standstill, cooling, repair --------------------------------------------------------
  {
    // Fuel laid into a fired station, the hearth or a fire (camp fire, fireplace): a log thunking onto the embers, sparks,
    // a breath of flame.
    id: 'sfx_feuer_nachlegen',
    bus: 'effekte',
    varianten: 3,
    streuung: { tonhoehe: 80, lautstaerke: 1.5, klang: 0.06 },
    stimmen: 2,
    sperrzeit: 0.08,
    reichweite: 14,
    lautstaerke: 0.44,
    schichten: [
      { quelle: ton('sinus', 200, 140), huelle: schlag(0.002, 0.08, 3), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.04, 3), filter: bandpass(1000, 1.3), pegel: 0.5 },
      { quelle: knistern(300, 0.002, 40), huelle: schlag(0.01, 0.4), filter: hochpass(3000), pegel: 0.5, start: 0.03 },
      { quelle: rauschen('rosa'), huelle: schlag(0.03, 0.25, 1.5), filter: bandpass(600, 1), pegel: 0.4, start: 0.05 },
    ],
  },
  {
    // A processing station stands still with its output full: two dull knocks.
    id: 'sfx_station_stillstand',
    bus: 'effekte',
    stimmen: 1,
    sperrzeit: 0.5,
    reichweite: 16,
    lautstaerke: 0.4,
    untertitel: { de: 'Station steht still', en: 'Station stopped' },
    schichten: [
      { quelle: puls(196, 0.5), huelle: schlag(0.004, 0.14, 2), filter: tiefpass(900, 1.3), pegel: 0.7, wiederholung: { anzahl: 2, abstand: 0.14, abfall: 0.85, tonhoehe: 0.89 } },
      { quelle: ton('sinus', 150, 110), huelle: schlag(0.002, 0.08, 3), pegel: 0.6, wiederholung: { anzahl: 2, abstand: 0.14, abfall: 0.85 } },
    ],
  },
  {
    // A fired station runs out of work: the kiln or furnace ticking as it cools.
    id: 'sfx_station_abkuehlen',
    bus: 'effekte',
    varianten: 2,
    stimmen: 2,
    sperrzeit: 0.5,
    reichweite: 12,
    lautstaerke: 0.3,
    schichten: [
      { quelle: fm(2500, 1.4, 0.8, 0), huelle: schlag(0.0005, 0.03, 3), pegel: 0.6, wiederholung: { anzahl: 5, abstand: 0.18, abfall: 0.8, tonhoehe: 0.95 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.1, 0.3, 0.3, 0.3, 0.4), filter: bandpass(700, 1), pegel: 0.3 },
    ],
  },
  {
    // A piece mended at the bench, anvil or grindstone (§13.1): whetstone strokes, hammer taps, a chime.
    id: 'sfx_handwerk_reparieren',
    ...FERTIG,
    lautstaerke: 0.46,
    untertitel: { de: 'Repariert', en: 'Repaired' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.03, 0.05, 0.6, 0.12, 0.05), filter: bandpass(4000, 1.5), pegel: 0.5, wiederholung: { anzahl: 2, abstand: 0.22, abfall: 0.9, tonhoehe: 0.9 } },
      { quelle: ton('sinus', 500, 400), huelle: schlag(0.001, 0.05, 3), pegel: 0.7, start: 0.45, wiederholung: { anzahl: 3, abstand: 0.1, abfall: 0.9 } },
      { quelle: ton('dreieck', 1175), huelle: schlag(0.004, 0.4, 2.5), pegel: 0.3, start: 0.8 },
    ],
  },
]);
