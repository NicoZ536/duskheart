/**
 * The vaults (MASTERPROMPT §21 "Gewölbe", §2.7, §27; docs/SPIEL.md §19; M7-10 … M7-18, M7-46, strand C): what going down, the
 * Builders' doors, chests, keys, tablets and a conquered vault sound like (`VAULT_SFX`, src/game/vaults/events.ts), the ember
 * shard used, and the research desk and the map table with their blueprints and maps (src/content/stations.ts, items).
 *
 * - The stairs: footfalls on stone stepping down an echoing shaft (a low resonant thud, a long dark tail).
 * - A puzzle's door: heavy stone grinding sideways, a dull stop. A lock: a key turning, two wards clicking, a bolt sliding.
 *   A cracked wall: plaster cracking, stones tumbling inward.
 * - A key or the shard taken from its pedestal: a bright metal ring on stone. A vault chest: a stone lid sliding, a soft chime of
 *   the Builders' make. A conquered vault: a slow rising chord of glass and bells settling.
 * - A tablet: stone dust brushed away, a low hum of the inscription. The ember shard used: a warm swell, embers crackling.
 * - The research desk: pages turned, a stylus scratching, a lens set down; done – a satisfied tap on wood. The map table: a quill
 *   on parchment, compass legs clicking; done – parchment rolled up.
 * - A blueprint read: parchment unrolled, a short rising tone. A map unrolled: parchment, a soft wind of open land.
 * - The vault creatures (M7-15): the mimic – wood creaking, a lid snapping, teeth; the trap spirit – a glassy whisper, a cold
 *   swell; the construct – stone grinding, a bronze clank, a heavy fist; the root warden – a deep wooden groan, a lash of roots,
 *   the stamp with roots bursting from the floor.
 */
import { bandpass, bogen, defineSfxGroup, fm, hochpass, knistern, rauschen, schlag, tiefpass, ton } from './define';

/** Sounds at the player (stairs, conquered vault, tablet, items used). */
const SPIELER = { bus: 'effekte', stimmen: 1, sperrzeit: 0.4, reichweite: 10 } as const;
/** Sounds at a thing of the vault (doors, chests, pedestals): echoing stone halls. */
const GEWOELBE = { bus: 'effekte', varianten: 2, streuung: { tonhoehe: 50, lautstaerke: 1, klang: 0.05 }, stimmen: 2, sperrzeit: 0.15, reichweite: 16 } as const;
/** Stations at work (loops) and done. */
const STATION = { bus: 'effekte', varianten: 2, stimmen: 2, sperrzeit: 0, reichweite: 14 } as const;
const FERTIG = { bus: 'effekte', varianten: 2, streuung: { tonhoehe: 40, lautstaerke: 1, klang: 0.04 }, stimmen: 2, sperrzeit: 0.1, reichweite: 16 } as const;
/** The vault creatures' voices and blows: positioned, varied. */
const KREATUR = { bus: 'effekte', varianten: 2, streuung: { tonhoehe: 60, lautstaerke: 1, klang: 0.05 }, stimmen: 3, sperrzeit: 0.1, reichweite: 16 } as const;

export const SFX_GEWOELBE = defineSfxGroup('gewoelbe', [
  {
    // Down or up the stairs: three footfalls on stone, the shaft's dark echo.
    id: 'sfx_gewoelbe_treppe',
    ...SPIELER,
    lautstaerke: 0.42,
    untertitel: { de: 'Schritte auf Steinstufen', en: 'Steps on stone stairs' },
    schichten: [
      { quelle: ton('sinus', 120, 80), huelle: schlag(0.002, 0.18, 3), pegel: 0.8, wiederholung: { anzahl: 3, abstand: 0.32, abfall: 0.8, tonhoehe: 0.94 } },
      { quelle: rauschen('braun'), huelle: schlag(0.004, 0.12, 2), filter: tiefpass(900), pegel: 0.45, wiederholung: { anzahl: 3, abstand: 0.32, abfall: 0.8 } },
      { quelle: rauschen('rosa'), huelle: bogen(0.2, 0.3, 0.3, 0.6, 1.2), filter: bandpass(420, 1.4), pegel: 0.22, start: 0.1 },
    ],
  },
  {
    // A puzzle's door grinds open: stone on stone, then a dull stop.
    id: 'sfx_gewoelbe_tuer',
    ...GEWOELBE,
    lautstaerke: 0.5,
    untertitel: { de: 'Steintür öffnet sich', en: 'Stone door opens' },
    schichten: [
      { quelle: rauschen('braun'), huelle: bogen(0.15, 0.2, 0.8, 1.1, 0.3), filter: bandpass(260, 1.6, 340), pegel: 0.9 },
      { quelle: knistern(120, 0.006, 60), huelle: bogen(0.1, 0.2, 0.6, 1.0, 0.3), filter: bandpass(1100, 1), pegel: 0.35 },
      { quelle: ton('sinus', 70, 50), huelle: schlag(0.004, 0.4, 3), pegel: 0.8, start: 1.45 },
    ],
  },
  {
    // A lock opened with the vault's key: the key turns, two wards click, a bolt slides.
    id: 'sfx_gewoelbe_aufschliessen',
    ...GEWOELBE,
    lautstaerke: 0.44,
    untertitel: { de: 'Schloss springt auf', en: 'Lock clicks open' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.02, 0.05, 0.4, 0.18, 0.05), filter: bandpass(3200, 2), pegel: 0.35 },
      { quelle: fm(2100, 1.5, 1.2, 0.2), huelle: schlag(0.0006, 0.05, 3), pegel: 0.6, start: 0.2, wiederholung: { anzahl: 2, abstand: 0.12, abfall: 0.85, tonhoehe: 0.9 } },
      { quelle: rauschen('braun'), huelle: bogen(0.02, 0.05, 0.7, 0.25, 0.1), filter: bandpass(500, 1.4), pegel: 0.7, start: 0.48 },
      { quelle: ton('sinus', 140, 100), huelle: schlag(0.002, 0.2, 3), pegel: 0.6, start: 0.78 },
    ],
  },
  {
    // A cracked wall gives way: plaster cracking, stones tumbling inward.
    id: 'sfx_gewoelbe_risswand',
    ...GEWOELBE,
    lautstaerke: 0.5,
    untertitel: { de: 'Wand bricht ein', en: 'Wall crumbles' },
    schichten: [
      { quelle: knistern(400, 0.004, 120), huelle: schlag(0.002, 0.5, 1.6), filter: hochpass(1200), pegel: 0.55 },
      { quelle: rauschen('braun'), huelle: schlag(0.01, 0.7, 2), filter: tiefpass(700), pegel: 0.85, start: 0.1 },
      { quelle: ton('sinus', 90, 60), huelle: schlag(0.003, 0.25, 3), pegel: 0.6, start: 0.25, wiederholung: { anzahl: 3, abstand: 0.17, abfall: 0.7, tonhoehe: 1.1 } },
    ],
  },
  {
    // A key or the ember shard taken from its pedestal: metal rings on stone.
    id: 'sfx_gewoelbe_aufnehmen',
    ...GEWOELBE,
    lautstaerke: 0.4,
    schichten: [
      { quelle: fm(1760, 2.76, 1.4, 0.3), huelle: schlag(0.001, 0.5, 3), pegel: 0.7 },
      { quelle: ton('sinus', 220, 200), huelle: schlag(0.002, 0.12, 3), pegel: 0.4 },
    ],
  },
  {
    // A vault chest: the stone lid slides, a soft Builder chime.
    id: 'sfx_gewoelbe_truhe',
    ...GEWOELBE,
    lautstaerke: 0.46,
    untertitel: { de: 'Steintruhe geöffnet', en: 'Stone chest opened' },
    schichten: [
      { quelle: rauschen('braun'), huelle: bogen(0.05, 0.1, 0.7, 0.5, 0.15), filter: bandpass(380, 1.4), pegel: 0.8 },
      { quelle: fm(1318, 2, 0.6, 0.1), huelle: schlag(0.003, 1.2, 2.5), pegel: 0.4, start: 0.6 },
      { quelle: fm(1975, 2, 0.6, 0.1), huelle: schlag(0.003, 1.0, 2.5), pegel: 0.3, start: 0.72 },
    ],
  },
  {
    // A conquered vault: a slow rising chord of glass and bells settling over the halls.
    id: 'sfx_gewoelbe_bezwungen',
    ...SPIELER,
    lautstaerke: 0.42,
    untertitel: { de: 'Gewölbe bezwungen', en: 'Vault conquered' },
    schichten: [
      { quelle: fm(392, 2, 0.7, 0.1), huelle: schlag(0.01, 2.2, 2), pegel: 0.6 },
      { quelle: fm(494, 2, 0.7, 0.1), huelle: schlag(0.01, 2.0, 2), pegel: 0.5, start: 0.25 },
      { quelle: fm(587, 2, 0.7, 0.1), huelle: schlag(0.01, 1.9, 2), pegel: 0.5, start: 0.5 },
      { quelle: fm(784, 3, 0.5, 0.1), huelle: schlag(0.01, 1.8, 2), pegel: 0.4, start: 0.75 },
      { quelle: rauschen('rosa'), huelle: bogen(0.6, 0.4, 0.3, 0.8, 1.2), filter: bandpass(2600, 0.8), pegel: 0.1 },
    ],
  },
  {
    // A tablet read: stone dust brushed away, the inscription hums.
    id: 'sfx_gewoelbe_tafel',
    ...SPIELER,
    lautstaerke: 0.34,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.1, 0.5, 0.35, 0.2), filter: bandpass(3000, 0.9), pegel: 0.45 },
      { quelle: ton('sinus', 110, 112), huelle: bogen(0.3, 0.3, 0.5, 0.6, 0.6), vibrato: { tiefe: 8, rate: 4 }, pegel: 0.5, start: 0.2 },
    ],
  },
  {
    // The ember shard used: a warm swell, embers crackling.
    id: 'sfx_gewoelbe_glutsplitter',
    ...SPIELER,
    lautstaerke: 0.4,
    untertitel: { de: 'Glutsplitter erglüht', en: 'Ember shard glows' },
    schichten: [
      { quelle: fm(220, 1.5, 1.2, 0.3, 330), huelle: bogen(0.3, 0.3, 0.5, 0.4, 0.7), pegel: 0.6 },
      { quelle: knistern(260, 0.003, 80), huelle: bogen(0.1, 0.2, 0.5, 0.6, 0.4), filter: hochpass(1800), pegel: 0.35 },
    ],
  },
  {
    // The research desk at work: a page turned, a stylus scratching, a lens set down.
    id: 'sfx_station_forschen',
    ...STATION,
    lautstaerke: 0.3,
    schleife: { dauer: 3.2 },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.1, 0.4, 0.25, 0.1), filter: bandpass(2800, 1), pegel: 0.5, start: 0.2 },
      { quelle: knistern(700, 0.002, 400), huelle: bogen(0.05, 0.05, 0.6, 0.9, 0.1), filter: bandpass(4200, 1.4), pegel: 0.35, start: 0.9 },
      { quelle: ton('sinus', 900, 860), huelle: schlag(0.001, 0.08, 3), pegel: 0.4, start: 2.3 },
    ],
  },
  {
    // A relic understood: a satisfied tap on the wood, the blueprint laid aside.
    id: 'sfx_station_forschen_fertig',
    ...FERTIG,
    lautstaerke: 0.4,
    untertitel: { de: 'Forschung abgeschlossen', en: 'Research finished' },
    schichten: [
      { quelle: ton('sinus', 260, 220), huelle: schlag(0.001, 0.1, 3), pegel: 0.7, wiederholung: { anzahl: 2, abstand: 0.14, abfall: 0.8 } },
      { quelle: fm(988, 2, 0.5, 0.1), huelle: schlag(0.003, 0.7, 2.5), pegel: 0.35, start: 0.3 },
    ],
  },
  {
    // The map table at work: a quill on parchment, compass legs clicking.
    id: 'sfx_station_kartenzeichnen',
    ...STATION,
    lautstaerke: 0.3,
    schleife: { dauer: 2.8 },
    schichten: [
      { quelle: knistern(900, 0.002, 500), huelle: bogen(0.05, 0.05, 0.7, 1.4, 0.1), filter: bandpass(3800, 1.2), pegel: 0.45, start: 0.1 },
      { quelle: fm(2400, 1.5, 0.8, 0.1), huelle: schlag(0.0005, 0.03, 3), pegel: 0.4, start: 1.9, wiederholung: { anzahl: 2, abstand: 0.2, abfall: 0.8 } },
    ],
  },
  {
    // A map drawn: parchment rolled up and tied.
    id: 'sfx_station_kartenzeichnen_fertig',
    ...FERTIG,
    lautstaerke: 0.38,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.02, 0.05, 0.5, 0.3, 0.1), filter: bandpass(2200, 1), pegel: 0.6 },
      { quelle: ton('sinus', 300, 260), huelle: schlag(0.001, 0.08, 3), pegel: 0.4, start: 0.4 },
    ],
  },
  {
    // A blueprint read: parchment unrolled, a short rising tone of understanding.
    id: 'sfx_forschung_bauplan',
    ...SPIELER,
    lautstaerke: 0.36,
    untertitel: { de: 'Bauplan gelernt', en: 'Blueprint learnt' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.03, 0.08, 0.5, 0.25, 0.1), filter: bandpass(2600, 1), pegel: 0.5 },
      { quelle: fm(523, 2, 0.6, 0.1, 784), huelle: schlag(0.01, 0.6, 2), pegel: 0.45, start: 0.25 },
    ],
  },
  {
    // A map unrolled: parchment, a soft wind of the open land it shows.
    id: 'sfx_forschung_karte',
    ...SPIELER,
    lautstaerke: 0.36,
    untertitel: { de: 'Karte entrollt', en: 'Map unrolled' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.03, 0.08, 0.5, 0.25, 0.1), filter: bandpass(2600, 1), pegel: 0.5 },
      { quelle: rauschen('rosa'), huelle: bogen(0.3, 0.3, 0.4, 0.4, 0.6), filter: bandpass(600, 1.2, 900), pegel: 0.35, start: 0.2 },
    ],
  },
  // --- The vault creatures (M7-15) -------------------------------------------------------------
  {
    id: 'sfx_gewoelbe_mimik_laut',
    ...KREATUR,
    lautstaerke: 0.4,
    untertitel: { de: 'Holz knarrt', en: 'Wood creaks' },
    schichten: [{ quelle: ton('saege', 120, 90), huelle: bogen(0.05, 0.1, 0.6, 0.3, 0.1), filter: bandpass(700, 5), vibrato: { tiefe: 25, rate: 9 }, pegel: 0.8 }],
  },
  {
    id: 'sfx_gewoelbe_mimik_biss',
    ...KREATUR,
    lautstaerke: 0.5,
    untertitel: { de: 'Truhe schnappt zu', en: 'Chest snaps shut' },
    schichten: [
      { quelle: ton('sinus', 180, 90), huelle: schlag(0.001, 0.12, 3), pegel: 0.8 },
      { quelle: rauschen('weiss'), huelle: schlag(0.001, 0.06, 3), filter: bandpass(2500, 1.5), pegel: 0.5 },
      { quelle: fm(1600, 1.41, 2, 0.3), huelle: schlag(0.0008, 0.08, 3), pegel: 0.35, start: 0.02 },
    ],
  },
  {
    id: 'sfx_gewoelbe_mimik_treffer',
    ...KREATUR,
    lautstaerke: 0.42,
    schichten: [
      { quelle: ton('sinus', 160, 110), huelle: schlag(0.001, 0.15, 3), pegel: 0.8 },
      { quelle: knistern(200, 0.003, 60), huelle: schlag(0.005, 0.2, 2), filter: bandpass(1500, 1), pegel: 0.4 },
    ],
  },
  {
    id: 'sfx_gewoelbe_mimik_tod',
    ...KREATUR,
    lautstaerke: 0.46,
    schichten: [
      { quelle: knistern(400, 0.004, 100), huelle: schlag(0.005, 0.6, 1.8), filter: bandpass(1200, 1), pegel: 0.6 },
      { quelle: ton('sinus', 120, 60), huelle: schlag(0.004, 0.5, 2), pegel: 0.7, start: 0.15 },
    ],
  },
  {
    id: 'sfx_gewoelbe_geist_laut',
    ...KREATUR,
    lautstaerke: 0.34,
    untertitel: { de: 'Geisterhaftes Flüstern', en: 'Ghostly whisper' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.3, 0.2, 0.5, 0.5, 0.5), filter: bandpass(2200, 3, 1400), pegel: 0.6 },
      { quelle: fm(880, 1.5, 0.6, 0.1, 660), huelle: bogen(0.3, 0.2, 0.4, 0.4, 0.5), pegel: 0.25 },
    ],
  },
  {
    id: 'sfx_gewoelbe_geist_kaelte',
    ...KREATUR,
    lautstaerke: 0.42,
    untertitel: { de: 'Eisiger Hauch', en: 'Icy breath' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.05, 0.1, 0.5, 0.2, 0.3), filter: bandpass(4200, 1.2, 2400), pegel: 0.6 },
      { quelle: fm(1320, 2.76, 1.2, 0.2), huelle: schlag(0.002, 0.5, 2.5), pegel: 0.3, start: 0.05 },
    ],
  },
  {
    id: 'sfx_gewoelbe_geist_treffer',
    ...KREATUR,
    lautstaerke: 0.36,
    schichten: [{ quelle: fm(1046, 2, 1.4, 0.2, 784), huelle: schlag(0.002, 0.3, 2.5), pegel: 0.6 }],
  },
  {
    id: 'sfx_gewoelbe_geist_tod',
    ...KREATUR,
    lautstaerke: 0.4,
    schichten: [
      { quelle: fm(1318, 2, 1, 0.1, 440), huelle: schlag(0.005, 1.0, 2), pegel: 0.5 },
      { quelle: rauschen('rosa'), huelle: bogen(0.05, 0.2, 0.3, 0.3, 0.6), filter: bandpass(3000, 1.5, 1200), pegel: 0.3 },
    ],
  },
  {
    id: 'sfx_gewoelbe_konstrukt_laut',
    ...KREATUR,
    lautstaerke: 0.44,
    untertitel: { de: 'Stein mahlt', en: 'Stone grinds' },
    schichten: [
      { quelle: rauschen('braun'), huelle: bogen(0.05, 0.1, 0.7, 0.4, 0.1), filter: bandpass(300, 1.6), pegel: 0.8 },
      { quelle: fm(320, 1.41, 1.5, 0.3), huelle: schlag(0.002, 0.2, 3), pegel: 0.4, start: 0.3 },
    ],
  },
  {
    id: 'sfx_gewoelbe_konstrukt_faust',
    ...KREATUR,
    lautstaerke: 0.54,
    untertitel: { de: 'Steinfaust schlägt zu', en: 'Stone fist strikes' },
    schichten: [
      { quelle: ton('sinus', 90, 50), huelle: schlag(0.002, 0.3, 3), pegel: 0.9 },
      { quelle: rauschen('braun'), huelle: schlag(0.003, 0.25, 2), filter: tiefpass(600), pegel: 0.6 },
    ],
  },
  {
    id: 'sfx_gewoelbe_konstrukt_treffer',
    ...KREATUR,
    lautstaerke: 0.42,
    schichten: [
      { quelle: fm(700, 1.41, 2.5, 0.5), huelle: schlag(0.0008, 0.15, 3), pegel: 0.6 },
      { quelle: knistern(250, 0.003, 60), huelle: schlag(0.004, 0.2, 2), filter: hochpass(1500), pegel: 0.35 },
    ],
  },
  {
    id: 'sfx_gewoelbe_konstrukt_tod',
    ...KREATUR,
    lautstaerke: 0.5,
    schichten: [
      { quelle: rauschen('braun'), huelle: schlag(0.01, 0.8, 2), filter: tiefpass(700), pegel: 0.9 },
      { quelle: ton('sinus', 100, 50), huelle: schlag(0.003, 0.3, 3), pegel: 0.6, start: 0.2, wiederholung: { anzahl: 3, abstand: 0.18, abfall: 0.7 } },
    ],
  },
  {
    id: 'sfx_gewoelbe_hueter_laut',
    ...KREATUR,
    reichweite: 22,
    lautstaerke: 0.5,
    untertitel: { de: 'Hölzernes Stöhnen', en: 'Wooden groan' },
    schichten: [
      { quelle: ton('saege', 70, 55), huelle: bogen(0.2, 0.2, 0.7, 0.6, 0.4), filter: bandpass(400, 3), vibrato: { tiefe: 20, rate: 5 }, pegel: 0.9 },
      { quelle: rauschen('braun'), huelle: bogen(0.2, 0.2, 0.5, 0.6, 0.4), filter: tiefpass(500), pegel: 0.4 },
    ],
  },
  {
    id: 'sfx_gewoelbe_hueter_peitsche',
    ...KREATUR,
    reichweite: 22,
    lautstaerke: 0.52,
    untertitel: { de: 'Wurzel peitscht', en: 'Root lashes' },
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.1, 0.05, 0.6, 0.1, 0.15), filter: bandpass(900, 1.4, 2200), pegel: 0.8 },
      { quelle: knistern(300, 0.003, 100), huelle: schlag(0.003, 0.2, 2), filter: bandpass(1800, 1), pegel: 0.4, start: 0.18 },
    ],
  },
  {
    id: 'sfx_gewoelbe_hueter_stampfen',
    ...KREATUR,
    reichweite: 22,
    lautstaerke: 0.58,
    untertitel: { de: 'Wurzeln brechen aus dem Boden', en: 'Roots burst from the floor' },
    schichten: [
      { quelle: ton('sinus', 60, 35), huelle: schlag(0.003, 0.6, 2.5), pegel: 1 },
      { quelle: knistern(500, 0.004, 150), huelle: schlag(0.01, 0.5, 1.6), filter: bandpass(1400, 1), pegel: 0.5, start: 0.1 },
      { quelle: rauschen('braun'), huelle: schlag(0.01, 0.5, 2), filter: tiefpass(400), pegel: 0.6 },
    ],
  },
  {
    id: 'sfx_gewoelbe_hueter_treffer',
    ...KREATUR,
    lautstaerke: 0.46,
    schichten: [
      { quelle: ton('sinus', 130, 90), huelle: schlag(0.001, 0.15, 3), pegel: 0.8 },
      { quelle: knistern(300, 0.003, 80), huelle: schlag(0.004, 0.2, 2), filter: bandpass(1600, 1), pegel: 0.4 },
    ],
  },
  {
    id: 'sfx_gewoelbe_hueter_tod',
    ...KREATUR,
    reichweite: 22,
    lautstaerke: 0.56,
    untertitel: { de: 'Der Wurzelhüter zerfällt', en: 'The Root Warden crumbles' },
    schichten: [
      { quelle: ton('saege', 80, 40), huelle: bogen(0.05, 0.2, 0.6, 0.8, 0.6), filter: bandpass(350, 3), pegel: 0.8 },
      { quelle: knistern(600, 0.004, 100), huelle: schlag(0.02, 1.2, 1.6), filter: bandpass(1300, 1), pegel: 0.5, start: 0.3 },
      { quelle: ton('sinus', 70, 40), huelle: schlag(0.004, 0.6, 2), pegel: 0.7, start: 0.9 },
    ],
  },
]);
