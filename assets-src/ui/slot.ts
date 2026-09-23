/**
 * Inventar-Slot (MASTERPROMPT §26): 16-px-Icon + 2 px Rand, vertieft (Schatten oben/links, Licht
 * unten/rechts), kühle dunkle Füllung, damit Icons auf dem warmen Holz hervortreten.
 * Zustände: normal, unter dem Zeiger (Rand aufgehellt), aktiv/ausgewählt (Rand in Akzentfarbe).
 */
import type { UiGrafikQuelle } from './format';

const SLOT_RASTER = `
  .oooooooooooooooooo.
  oSSSSSSSSSSSSSSSSSfo
  oSfffffffffffffffflo
  oSfffffffffffffffflo
  oSfffffffffffffffflo
  oSfffffffffffffffflo
  oSfffffffffffffffflo
  oSfffffffffffffffflo
  oSfffffffffffffffflo
  oSfffffffffffffffflo
  oSfffffffffffffffflo
  oSfffffffffffffffflo
  oSfffffffffffffffflo
  oSfffffffffffffffflo
  oSfffffffffffffffflo
  oSfffffffffffffffflo
  oSfffffffffffffffflo
  oSfffffffffffffffflo
  oflllllllllllllllllo
  .oooooooooooooooooo.
`;

/** Ränder: Umriss + Schatten- bzw. Lichtkante; der Rest ist einfarbig und wird gedehnt. */
const SLOT_SLICE = 2;

export const SLOT: UiGrafikQuelle = {
  id: 'slot',
  vorschau: [[26, 26]],
  beschreibung: 'Slot (Inventar, Schnellleiste, Stationen)',
  slice: SLOT_SLICE,
  kanten: 'dehnen',
  legende: { '.': null, o: 'nacht.1', S: 'nacht.0', f: 'nacht.2', l: 'holz.2' },
  raster: SLOT_RASTER,
};

export const SLOT_HOVER: UiGrafikQuelle = {
  id: 'slot_hover',
  vorschau: [[26, 26]],
  beschreibung: 'Slot unter dem Zeiger oder Fokus',
  slice: SLOT_SLICE,
  kanten: 'dehnen',
  legende: { '.': null, o: 'ui.rahmenHell', S: 'nacht.0', f: 'nacht.3', l: 'holz.3' },
  raster: SLOT_RASTER,
};

export const SLOT_AKTIV: UiGrafikQuelle = {
  id: 'slot_aktiv',
  vorschau: [[26, 26]],
  beschreibung: 'Ausgewählter Slot (aktive Schnellleisten-Position)',
  slice: SLOT_SLICE,
  kanten: 'dehnen',
  legende: { '.': null, o: 'ui.akzent', S: 'feuer.1', f: 'nacht.2', l: 'feuer.4' },
  raster: SLOT_RASTER,
};
