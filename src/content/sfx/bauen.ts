/**
 * Building (MASTERPROMPT §16.1–§16.6, §2.7 "Jede Aktion hat visuelles und akustisches Feedback"; M4-29): what the
 * build grid sounds like, mapped from the building events in src/audio/eventMap.ts (`BUILD_AUDIO`,
 * src/audio/baseSounds.ts).
 *
 * - `sfx_bau_setzen_<klang>`: a part set on the grid, per sound material – wood (planks and a couple of nail
 *   knocks), straw (a rustling bundle), stone (a heavy block grinding into place), clay (a wet slap), glass (a frame
 *   knock and a clear tink), metal (a clang; the bronze anvil). Palisade and timber frame sound like wood.
 * - `sfx_bau_abbauen_<klang>`: taken down – prised apart, lifted off, crumbled.
 * - `sfx_bau_bersten_<klang>`: destroyed by fire or the Schattenflut (§16.8) – splinters, rubble, shattering glass.
 * - `sfx_bau_schaden_<klang>`: hit points lost (burning timber groans every second, stone chips, glass cracks).
 * - The roof collapse (§16.3 "Staub, 50 % Material"), wall furniture falling off its wall, a blueprint drawn and
 *   discarded (§16.6), a blueprint finished with the hammer, an upgrade in place and the area repair.
 *
 * Build sounds are heard around the site (range 16–26 tiles); several parts set in one tick (a dragged wall) play
 * once (lock-out), a collapse and destruction carry subtitles (§27 "Untertitel für wichtige Laute").
 */
import { bandpass, bogen, defineSfxGroup, fm, hochpass, knistern, puls, rauschen, schlag, tiefpass, ton } from './define';

/** Setting and taking down parts: heard around the site, a dragged line plays once per tick. */
const BAU = {
  bus: 'effekte',
  varianten: 3,
  streuung: { tonhoehe: 90, lautstaerke: 1.5, klang: 0.07 },
  stimmen: 3,
  sperrzeit: 0.06,
  reichweite: 16,
} as const;

/** Destruction and damage: louder, heard farther, never stacked. */
const SCHADEN = {
  bus: 'effekte',
  varianten: 3,
  streuung: { tonhoehe: 120, lautstaerke: 2, klang: 0.08 },
  stimmen: 2,
  reichweite: 22,
} as const;

export const SFX_BAUEN = defineSfxGroup('bauen', [
  // --- Setting a part, per sound material ----------------------------------------------------
  {
    // Wood (walls, floors, shingles, doors, furniture): a plank laid down, two nail knocks.
    id: 'sfx_bau_setzen_holz',
    ...BAU,
    lautstaerke: 0.5,
    schichten: [
      { quelle: ton('sinus', 170, 120), huelle: schlag(0.002, 0.12, 3), pegel: 0.9 },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.05, 3), filter: bandpass(900, 1.4), pegel: 0.6 },
      { quelle: ton('sinus', 420, 330), huelle: schlag(0.001, 0.05, 3), pegel: 0.4, start: 0.13, wiederholung: { anzahl: 2, abstand: 0.11, abfall: 0.8, tonhoehe: 1.04 } },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.015, 3), filter: bandpass(3200, 1.2), pegel: 0.45, start: 0.13, wiederholung: { anzahl: 2, abstand: 0.11, abfall: 0.8 } },
    ],
  },
  {
    // Straw (roofs, straw beds, the straw mat): a bundle pressed into place.
    id: 'sfx_bau_setzen_stroh',
    ...BAU,
    lautstaerke: 0.42,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.2, 1.5), filter: bandpass(3000, 0.8, 2000), pegel: 0.9 },
      { quelle: knistern(500, 0.002, 120), huelle: schlag(0.015, 0.22), filter: hochpass(2500), pegel: 0.5 },
      { quelle: ton('sinus', 120, 90), huelle: schlag(0.005, 0.08), pegel: 0.4, start: 0.04 },
    ],
  },
  {
    // Stone (walls, flagstones, pillars, the hearth ring): a heavy block grinding onto stone.
    id: 'sfx_bau_setzen_stein',
    ...BAU,
    lautstaerke: 0.55,
    schichten: [
      { quelle: ton('sinus', 110, 70), huelle: schlag(0.002, 0.16, 3), pegel: 1 },
      { quelle: rauschen('weiss'), huelle: bogen(0.01, 0.06, 0.4, 0.04, 0.05), filter: bandpass(2500, 1.2), pegel: 0.45 },
      { quelle: fm(900, 1.4, 2, 0.2), huelle: schlag(0.0008, 0.08, 3), pegel: 0.4, start: 0.01 },
      { quelle: knistern(300, 0.002, 60), huelle: schlag(0.005, 0.18), filter: hochpass(2000), pegel: 0.35, start: 0.03 },
    ],
  },
  {
    // Clay (rammed clay floors, clay ovens, the charcoal mound): a wet slap and a smear.
    id: 'sfx_bau_setzen_lehm',
    ...BAU,
    lautstaerke: 0.46,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.003, 0.09, 2.5), filter: tiefpass(1200, 1.2), pegel: 0.9 },
      { quelle: ton('sinus', 150, 90), huelle: schlag(0.003, 0.07), pegel: 0.6 },
      { quelle: rauschen('braun'), huelle: bogen(0.03, 0.08, 0.4, 0.08, 0.1), filter: bandpass(700, 1.2, 450), pegel: 0.5, start: 0.06 },
    ],
  },
  {
    // Glass (panes, glass roofs): the frame knocks, the pane tinks.
    id: 'sfx_bau_setzen_glas',
    ...BAU,
    lautstaerke: 0.46,
    schichten: [
      { quelle: ton('sinus', 220, 170), huelle: schlag(0.002, 0.06, 3), pegel: 0.7 },
      { quelle: fm(2600, 1.41, 1.2, 0.1), huelle: schlag(0.001, 0.35, 3), pegel: 0.55, start: 0.01 },
      { quelle: fm(3700, 1.5, 0.6, 0), huelle: schlag(0.001, 0.2, 3), pegel: 0.3, start: 0.02 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.012, 3), filter: hochpass(4000), pegel: 0.4 },
    ],
  },
  {
    // Metal (the bronze anvil): a heavy clang with inharmonic partials and a thud.
    id: 'sfx_bau_setzen_metall',
    ...BAU,
    lautstaerke: 0.55,
    schichten: [
      { quelle: fm(420, 2.76, 3, 0.5), huelle: schlag(0.001, 0.6, 3), pegel: 0.6 },
      { quelle: fm(1130, 1.73, 1.5, 0.1), huelle: schlag(0.001, 0.35, 3), pegel: 0.35 },
      { quelle: ton('sinus', 90, 60), huelle: schlag(0.002, 0.15, 3), pegel: 0.8 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: bandpass(3000, 1), pegel: 0.4 },
    ],
  },
  // --- Taking a part down, per sound material ------------------------------------------------
  {
    // Wood: a board prised off (creak, a nail squeaking out), the pieces clattering down.
    id: 'sfx_bau_abbauen_holz',
    ...BAU,
    lautstaerke: 0.48,
    schichten: [
      { quelle: ton('saege', 140, 110), huelle: bogen(0.05, 0.1, 0.6, 0.1, 0.1), filter: bandpass(900, 3), vibrato: { tiefe: 40, rate: 12 }, pegel: 0.6 },
      { quelle: ton('sinus', 1800, 2400), huelle: schlag(0.01, 0.08, 2), pegel: 0.18, start: 0.12 },
      { quelle: ton('sinus', 300, 220), huelle: schlag(0.001, 0.05, 3), pegel: 0.7, start: 0.28, wiederholung: { anzahl: 3, abstand: 0.07, abfall: 0.7, tonhoehe: 0.94 } },
      { quelle: rauschen('rosa'), huelle: schlag(0.001, 0.03, 3), filter: bandpass(1500, 1.5), pegel: 0.5, start: 0.28, wiederholung: { anzahl: 3, abstand: 0.07, abfall: 0.7 } },
    ],
  },
  {
    // Straw: a bundle pulled loose.
    id: 'sfx_bau_abbauen_stroh',
    ...BAU,
    lautstaerke: 0.4,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.03, 0.12, 0.5, 0.1, 0.15), filter: bandpass(2500, 0.8, 1500), pegel: 0.9 },
      { quelle: knistern(600, 0.002, 200), huelle: bogen(0.02, 0.1, 0.5, 0.1, 0.15), filter: hochpass(2600), pegel: 0.5 },
      { quelle: ton('sinus', 110, 80), huelle: schlag(0.004, 0.07), pegel: 0.35, start: 0.3 },
    ],
  },
  {
    // Stone: a block scraped loose, lifted and set down.
    id: 'sfx_bau_abbauen_stein',
    ...BAU,
    lautstaerke: 0.5,
    schichten: [
      { quelle: rauschen('weiss'), huelle: bogen(0.02, 0.1, 0.5, 0.12, 0.1), filter: bandpass(1800, 1.2), pegel: 0.6 },
      { quelle: fm(780, 1.4, 2, 0.2), huelle: schlag(0.0008, 0.07, 3), pegel: 0.4, start: 0.05, wiederholung: { anzahl: 2, abstand: 0.09, abfall: 0.6, tonhoehe: 0.9 } },
      { quelle: ton('sinus', 100, 65), huelle: schlag(0.002, 0.14, 3), pegel: 0.9, start: 0.3 },
      { quelle: knistern(200, 0.002, 40), huelle: schlag(0.005, 0.12), filter: hochpass(2200), pegel: 0.3, start: 0.3 },
    ],
  },
  {
    // Clay: rammed clay crumbling apart.
    id: 'sfx_bau_abbauen_lehm',
    ...BAU,
    lautstaerke: 0.45,
    schichten: [
      { quelle: rauschen('braun'), huelle: schlag(0.01, 0.3, 1.5), filter: tiefpass(900), pegel: 0.8 },
      { quelle: knistern(250, 0.004, 40), huelle: schlag(0.02, 0.35), filter: bandpass(1500, 1.2), pegel: 0.6 },
      { quelle: ton('sinus', 120, 80), huelle: schlag(0.003, 0.08), pegel: 0.5, start: 0.05 },
    ],
  },
  {
    // Glass: a pane lifted out of its frame – a rub, a careful tink.
    id: 'sfx_bau_abbauen_glas',
    ...BAU,
    lautstaerke: 0.42,
    schichten: [
      { quelle: ton('sinus', 1400, 1500), huelle: bogen(0.03, 0.06, 0.4, 0.1, 0.06), vibrato: { tiefe: 30, rate: 9 }, pegel: 0.3 },
      { quelle: fm(2900, 1.41, 1, 0.1), huelle: schlag(0.001, 0.3, 3), pegel: 0.5, start: 0.2 },
      { quelle: ton('sinus', 200, 150), huelle: schlag(0.002, 0.06, 3), pegel: 0.5, start: 0.2 },
    ],
  },
  {
    // Metal: a heavy piece of bronze clanking as it is lifted and dragged.
    id: 'sfx_bau_abbauen_metall',
    ...BAU,
    lautstaerke: 0.5,
    schichten: [
      { quelle: fm(520, 2.1, 2.5, 0.3), huelle: schlag(0.001, 0.3, 3), pegel: 0.6 },
      { quelle: rauschen('weiss'), huelle: bogen(0.02, 0.08, 0.4, 0.1, 0.1), filter: bandpass(3000, 1.2), pegel: 0.4, start: 0.05 },
      { quelle: fm(640, 2.3, 2, 0.2), huelle: schlag(0.001, 0.25, 3), pegel: 0.45, start: 0.22 },
      { quelle: ton('sinus', 95, 65), huelle: schlag(0.002, 0.12, 3), pegel: 0.7, start: 0.22 },
    ],
  },
  // --- Destroyed ------------------------------------------------------------------------------
  {
    // Wood, straw, palisade, timber frame destroyed: a splintering crash.
    id: 'sfx_bau_bersten_holz',
    ...SCHADEN,
    sperrzeit: 0.2,
    lautstaerke: 0.66,
    untertitel: { de: 'Holz birst', en: 'Timber breaks' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.001, 0.2, 3), filter: hochpass(1200), pegel: 0.8 },
      { quelle: knistern(800, 0.004, 50), huelle: schlag(0.005, 0.5, 1.5), filter: bandpass(2000, 1.2), pegel: 0.7 },
      { quelle: ton('sinus', 130, 60), huelle: schlag(0.002, 0.25, 2), pegel: 0.8 },
      { quelle: ton('saege', 180, 90), huelle: schlag(0.002, 0.12, 2), filter: bandpass(800, 2), pegel: 0.35 },
    ],
  },
  {
    // Stone and clay destroyed: rubble crumbling down.
    id: 'sfx_bau_bersten_stein',
    ...SCHADEN,
    sperrzeit: 0.2,
    lautstaerke: 0.68,
    untertitel: { de: 'Mauerwerk bricht', en: 'Masonry crumbles' },
    schichten: [
      { quelle: rauschen('braun'), huelle: schlag(0.005, 0.6, 1.5), filter: tiefpass(700), pegel: 0.8 },
      { quelle: knistern(300, 0.006, 20), huelle: schlag(0.01, 0.7, 1.5), filter: bandpass(1500, 1.1), pegel: 0.7 },
      { quelle: ton('sinus', 80, 45), huelle: schlag(0.003, 0.4, 2), pegel: 0.9 },
      { quelle: fm(700, 1.4, 1.8, 0.2), huelle: schlag(0.0008, 0.06, 3), pegel: 0.4, start: 0.1, wiederholung: { anzahl: 4, abstand: 0.09, abfall: 0.7, tonhoehe: 0.9 } },
    ],
  },
  {
    // Glass destroyed: a pane shattering, shards tinkling down.
    id: 'sfx_bau_bersten_glas',
    ...SCHADEN,
    sperrzeit: 0.2,
    lautstaerke: 0.6,
    untertitel: { de: 'Glas zerspringt', en: 'Glass shatters' },
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.15, 3), filter: hochpass(3000), pegel: 0.8 },
      { quelle: fm(3100, 1.47, 1.5, 0.1), huelle: schlag(0.0005, 0.4, 3), pegel: 0.5 },
      { quelle: knistern(1500, 0.002, 60), huelle: schlag(0.005, 0.6, 1.5), filter: hochpass(3500), pegel: 0.6 },
      { quelle: fm(4200, 1.3, 0.8, 0), huelle: schlag(0.0005, 0.07, 3), pegel: 0.35, start: 0.08, wiederholung: { anzahl: 5, abstand: 0.07, abfall: 0.7, tonhoehe: 0.93 } },
    ],
  },
  // --- Damage -------------------------------------------------------------------------------
  {
    // Timber losing hit points (burning, struck): the beams groan and crack.
    id: 'sfx_bau_schaden_holz',
    ...SCHADEN,
    sperrzeit: 0.7,
    lautstaerke: 0.4,
    schichten: [
      { quelle: ton('saege', 95, 80), huelle: bogen(0.08, 0.2, 0.5, 0.1, 0.2), filter: bandpass(600, 3), vibrato: { tiefe: 60, rate: 7 }, pegel: 0.7 },
      { quelle: knistern(40, 0.01), huelle: schlag(0.02, 0.3), filter: hochpass(1500), pegel: 0.6 },
    ],
  },
  {
    // Stone losing hit points: a chip flying off.
    id: 'sfx_bau_schaden_stein',
    ...SCHADEN,
    sperrzeit: 0.5,
    lautstaerke: 0.42,
    schichten: [
      { quelle: fm(1200, 1.3, 1.5, 0.1), huelle: schlag(0.0008, 0.06, 3), pegel: 0.6 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.03, 3), filter: bandpass(2600, 1.2), pegel: 0.6 },
      { quelle: knistern(200, 0.002, 30), huelle: schlag(0.003, 0.12), filter: hochpass(2500), pegel: 0.4, start: 0.03 },
      { quelle: ton('sinus', 140, 90), huelle: schlag(0.002, 0.06), pegel: 0.4 },
    ],
  },
  {
    // Glass losing hit points: a sharp crack running through the pane.
    id: 'sfx_bau_schaden_glas',
    ...SCHADEN,
    sperrzeit: 0.5,
    lautstaerke: 0.38,
    schichten: [
      { quelle: rauschen('weiss'), huelle: schlag(0.0003, 0.02, 3), filter: hochpass(4000), pegel: 0.7 },
      { quelle: ton('sinus', 3300, 2800), huelle: schlag(0.0005, 0.08, 3), pegel: 0.4 },
      { quelle: knistern(600, 0.0015, 100), huelle: schlag(0.005, 0.1), filter: hochpass(4500), pegel: 0.4, start: 0.01 },
      { quelle: ton('sinus', 240, 180), huelle: schlag(0.001, 0.04, 3), pegel: 0.4 },
    ],
  },
  // --- Statics, wall furniture ----------------------------------------------------------------
  {
    // Roof tiles without support come down (§16.3): a rumble, the crash, falling pieces and settling dust.
    id: 'sfx_bau_einsturz',
    bus: 'effekte',
    varianten: 2,
    streuung: { tonhoehe: 80, lautstaerke: 1, klang: 0.06 },
    stimmen: 1,
    sperrzeit: 0.5,
    reichweite: 26,
    lautstaerke: 0.72,
    untertitel: { de: 'Dach stürzt ein', en: 'Roof collapses' },
    schichten: [
      { quelle: rauschen('braun'), huelle: bogen(0.05, 0.4, 0.5, 0.3, 0.8), filter: tiefpass(400), pegel: 0.8 },
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.9, 1.5), filter: bandpass(1200, 0.9), pegel: 0.6, start: 0.12 },
      { quelle: knistern(400, 0.005, 30), huelle: schlag(0.02, 1.2, 1.5), filter: bandpass(2200, 1.1), pegel: 0.6, start: 0.12 },
      { quelle: ton('sinus', 90, 50), huelle: schlag(0.002, 0.2, 2), pegel: 0.8, start: 0.12, wiederholung: { anzahl: 4, abstand: 0.13, abfall: 0.75, tonhoehe: 0.92 } },
      { quelle: rauschen('weiss'), huelle: bogen(0.2, 0.4, 0.3, 0.3, 0.6), filter: hochpass(3000), pegel: 0.18, start: 0.5 },
    ],
  },
  {
    // Wall furniture falls off its removed wall: a short drop, a thud and a clatter.
    id: 'sfx_bau_herabfallen',
    ...BAU,
    lautstaerke: 0.48,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.02, 0.1, 1.5), filter: bandpass(1000, 1.2, 600), pegel: 0.5 },
      { quelle: ton('sinus', 160, 100), huelle: schlag(0.002, 0.1, 3), pegel: 0.9, start: 0.15 },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.03, 3), filter: bandpass(2500, 1.2), pegel: 0.5, start: 0.16, wiederholung: { anzahl: 3, abstand: 0.06, abfall: 0.6, tonhoehe: 0.9 } },
    ],
  },
  // --- Blueprints, finishing, upgrading, repairing (§16.6) ------------------------------------
  {
    // A blueprint drawn on the ground: a charcoal stroke and a soft, airy tone – a plan, not yet material.
    id: 'sfx_bau_blaupause',
    ...BAU,
    varianten: 2,
    reichweite: 10,
    lautstaerke: 0.3,
    schichten: [
      { quelle: rauschen('rosa'), huelle: bogen(0.01, 0.05, 0.4, 0.06, 0.05), filter: bandpass(3500, 1.5), pegel: 0.7 },
      { quelle: ton('sinus', 1320), huelle: schlag(0.005, 0.25, 2), pegel: 0.35, start: 0.05 },
      { quelle: ton('sinus', 1760), huelle: schlag(0.005, 0.2, 2), pegel: 0.22, start: 0.1 },
    ],
  },
  {
    // A blueprint rubbed out: a smudge and the airy tone sinking.
    id: 'sfx_bau_blaupause_verwerfen',
    ...BAU,
    varianten: 2,
    reichweite: 10,
    lautstaerke: 0.28,
    schichten: [
      { quelle: rauschen('rosa'), huelle: schlag(0.01, 0.1, 1.5), filter: bandpass(2800, 1.2, 1800), pegel: 0.7, wiederholung: { anzahl: 2, abstand: 0.09, abfall: 0.8 } },
      { quelle: ton('sinus', 1320, 990), huelle: schlag(0.005, 0.18, 2), pegel: 0.3, start: 0.04 },
    ],
  },
  {
    // A blueprint finished with the hammer: three firm strikes (the part's own material sounds with it).
    id: 'sfx_bau_fertigstellen',
    ...BAU,
    lautstaerke: 0.5,
    schichten: [
      { quelle: ton('sinus', 300, 230), huelle: schlag(0.001, 0.07, 3), pegel: 0.9, wiederholung: { anzahl: 3, abstand: 0.14, abfall: 0.95, tonhoehe: 0.97 } },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.02, 3), filter: bandpass(3000, 1.2), pegel: 0.6, wiederholung: { anzahl: 3, abstand: 0.14, abfall: 0.95 } },
      { quelle: ton('dreieck', 988), huelle: schlag(0.004, 0.3, 2.5), pegel: 0.2, start: 0.34 },
    ],
  },
  {
    // An upgrade in place (wood → stone): knocks and a rising chime as the part changes.
    id: 'sfx_bau_aufwerten',
    ...BAU,
    stimmen: 2,
    sperrzeit: 0.12,
    lautstaerke: 0.5,
    schichten: [
      { quelle: ton('sinus', 260, 200), huelle: schlag(0.001, 0.06, 3), pegel: 0.7, wiederholung: { anzahl: 2, abstand: 0.1, abfall: 0.9 } },
      { quelle: puls(392, 0.25), huelle: schlag(0.004, 0.2, 2), filter: tiefpass(3600), pegel: 0.45, start: 0.18, wiederholung: { anzahl: 3, abstand: 0.08, abfall: 0.95, tonhoehe: 1.26 } },
      { quelle: knistern(120, 0.003, 20), huelle: schlag(0.02, 0.4), filter: hochpass(5000), pegel: 0.3, start: 0.2 },
    ],
  },
  {
    // A damaged part mended (area repair): quick hammer taps and a nail driven home.
    id: 'sfx_bau_reparieren',
    ...BAU,
    lautstaerke: 0.44,
    schichten: [
      { quelle: ton('sinus', 520, 420), huelle: schlag(0.001, 0.04, 3), pegel: 0.8, wiederholung: { anzahl: 4, abstand: 0.09, abfall: 0.85, tonhoehe: 1.02 } },
      { quelle: rauschen('weiss'), huelle: schlag(0.0005, 0.015, 3), filter: bandpass(3200, 1.2), pegel: 0.5, wiederholung: { anzahl: 4, abstand: 0.09, abfall: 0.85 } },
      { quelle: ton('sinus', 200, 150), huelle: schlag(0.002, 0.06, 3), pegel: 0.5, start: 0.38 },
    ],
  },
]);
