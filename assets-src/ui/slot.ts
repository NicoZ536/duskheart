/**
 * Inventar-Slot (MASTERPROMPT §26): vertiefte Mulde für ein 16-px-Icon (M1-32: Fase und Glanzkante
 * statt flachem Rechteck). Umriss mit 1 px Eckfase, darin eine 2 px breite, nach innen fallende Fase:
 * oben und links im Schatten (außen tiefste, innen mittlere Stufe), unten und rechts die angeleuchtete
 * Innenwand; die Unterkante des Rahmens ist die Glanzkante mit einem Glanzpunkt in der Ecke unten
 * rechts, Gehrung oben rechts und unten links. Der kühle, dunkle Boden (14 × 14 px, so groß wie das
 * Motiv eines Icons, §4.4) lässt Icons auf dem warmen Holz hervortreten.
 * Zustände: normal, unter dem Zeiger (heller, Rand aufgehellt), aktiv/ausgewählt (Glut, Rand in
 * Akzentfarbe). Slots erscheinen in Originalgröße; die Ränder sind trotzdem quer zur Dehnrichtung
 * einfarbig, Gehrung und Glanzpunkt liegen in den Ecken.
 */
import type { UiGrafikQuelle } from './format';

const SLOT_RASTER = `
  .oooooooooooooooooo.
  oSSSSSSSSSSSSSSSSSMo
  oSsssssssssssssssmLo
  oSsffffffffffffffwLo
  oSsffffffffffffffwLo
  oSsffffffffffffffwLo
  oSsffffffffffffffwLo
  oSsffffffffffffffwLo
  oSsffffffffffffffwLo
  oSsffffffffffffffwLo
  oSsffffffffffffffwLo
  oSsffffffffffffffwLo
  oSsffffffffffffffwLo
  oSsffffffffffffffwLo
  oSsffffffffffffffwLo
  oSsffffffffffffffwLo
  oSsffffffffffffffwLo
  oSmwwwwwwwwwwwwwwwWo
  oMGGGGGGGGGGGGGGGWWo
  .oooooooooooooooooo.
`;

/** Ränder: Umriss + zwei Stufen Fase; die Mitte ist der einfarbige Boden. */
const SLOT_SLICE = 3;

export const SLOT: UiGrafikQuelle = {
  id: 'slot',
  vorschau: [[26, 26]],
  beschreibung: 'Slot (Inventar, Schnellleiste, Stationen)',
  slice: SLOT_SLICE,
  kanten: 'dehnen',
  legende: { '.': null, o: 'nacht.1', S: 'nacht.0', s: 'nacht.1', f: 'nacht.2', w: 'nacht.3', m: 'nacht.2', M: 'holz.0', L: 'holz.2', G: 'holz.3', W: 'holz.4' },
  raster: SLOT_RASTER,
};

export const SLOT_HOVER: UiGrafikQuelle = {
  id: 'slot_hover',
  vorschau: [[26, 26]],
  beschreibung: 'Slot unter dem Zeiger oder Fokus',
  slice: SLOT_SLICE,
  kanten: 'dehnen',
  legende: { '.': null, o: 'ui.rahmenHell', S: 'nacht.1', s: 'nacht.2', f: 'nacht.3', w: 'nacht.4', m: 'nacht.3', M: 'holz.1', L: 'holz.3', G: 'holz.4', W: 'sand.4' },
  raster: SLOT_RASTER,
};

export const SLOT_AKTIV: UiGrafikQuelle = {
  id: 'slot_aktiv',
  vorschau: [[26, 26]],
  beschreibung: 'Ausgewählter Slot (aktive Schnellleisten-Position)',
  slice: SLOT_SLICE,
  kanten: 'dehnen',
  legende: { '.': null, o: 'ui.akzent', S: 'laub.0', s: 'feuer.0', f: 'nacht.2', w: 'feuer.1', m: 'feuer.1', M: 'feuer.2', L: 'feuer.3', G: 'feuer.4', W: 'feuer.5' },
  raster: SLOT_RASTER,
};
