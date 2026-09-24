/**
 * Leisten für Leben, Ausdauer & Co. (MASTERPROMPT §26 HUD): ein erhabener Steinrand um eine dunkle
 * Rinne (4 px Innenhöhe) und Füllungen mit Licht oben, Körper, Schatten unten. Die linke Spalte der
 * Füllung ist die Kachel, die rechte eine Stufe hellere Abschlusskante (9-Slice mit nur rechtem
 * Rand), damit das Ende der Füllung lesbar bleibt.
 */
import type { UiGrafikQuelle } from './format';

export const LEISTE: UiGrafikQuelle = {
  id: 'leiste',
  vorschau: [[40, 8]],
  beschreibung: 'Rahmen einer Leiste (Innenfläche 4 px hoch)',
  slice: 2,
  kanten: 'dehnen',
  legende: { '.': null, o: 'nacht.1', R: 'stein.2', r: 'stein.1', e: 'nacht.0' },
  raster: `
    .oooooooooo.
    oRRRRRRRRRRo
    oReeeeeeeero
    oReeeeeeeero
    oReeeeeeeero
    oReeeeeeeero
    orrrrrrrrrro
    .oooooooooo.
  `,
};

/** Füllungen: nur der rechte Rand (Abschlusskante) ist ein Slice, die Kachel wiederholt sich. */
const FUELLUNG_SLICE = [0, 1, 0, 0] as const;

export const LEISTE_LEBEN: UiGrafikQuelle = {
  id: 'leiste_leben',
  vorschau: [[30, 4]],
  beschreibung: 'Füllung der Lebensleiste',
  slice: FUELLUNG_SLICE,
  legende: { '0': 'feuer.0', '1': 'feuer.1', '2': 'feuer.2', '3': 'feuer.3' },
  raster: `
    23
    12
    12
    01
  `,
};

/** Sättigung (HUD, M3-27): Brotkruste – Holzbraun mit sandhellem Licht, klar getrennt von Leben (Glut) und Ausdauer (Grün). */
export const LEISTE_SAETTIGUNG: UiGrafikQuelle = {
  id: 'leiste_saettigung',
  vorschau: [[30, 4]],
  beschreibung: 'Füllung der Sättigungsleiste',
  slice: FUELLUNG_SLICE,
  legende: { '1': 'holz.2', '2': 'holz.3', '3': 'holz.4', '4': 'sand.3' },
  raster: `
    34
    23
    23
    12
  `,
};

/** Durst (HUD, M3-27): Wasser – Blaugrün mit Schaumlicht. */
export const LEISTE_DURST: UiGrafikQuelle = {
  id: 'leiste_durst',
  vorschau: [[30, 4]],
  beschreibung: 'Füllung der Durstleiste',
  slice: FUELLUNG_SLICE,
  legende: { '2': 'wasser.2', '3': 'wasser.3', '4': 'wasser.4', '5': 'wasser.5' },
  raster: `
    45
    34
    34
    23
  `,
};

export const LEISTE_AUSDAUER: UiGrafikQuelle = {
  id: 'leiste_ausdauer',
  vorschau: [[30, 4]],
  beschreibung: 'Füllung der Ausdauerleiste',
  slice: FUELLUNG_SLICE,
  legende: { '2': 'gras.2', '3': 'gras.3', '4': 'gras.4', '5': 'gras.5' },
  raster: `
    45
    34
    34
    23
  `,
};
