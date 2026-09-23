/**
 * Schaltfläche (MASTERPROMPT §26) in vier Zuständen, alle mit denselben 9-Slice-Rändern, damit
 * ein Zustandswechsel das Layout nicht verschiebt:
 * - normal: gewölbtes Holz mit Lichtkante oben/links, Schattenkante und 1 px Lippe unten;
 * - hover (Zeiger, Controller-Fokus): helleres Holz, Umriss in Akzentfarbe;
 * - gedrückt: dunkles Holz, Schatten oben/links, die Lippe fehlt – der Inhalt rückt 1 px nach unten;
 * - gesperrt: kaltes Grau (Stein), gleicher Aufbau wie normal.
 */
import type { UiGrafikQuelle } from './format';

const ERHABEN = `
  .oooooooooooooo.
  oLhhhhhhhhhhhhFo
  ohFFFFFFFFFFFFso
  ohFFFFFFFFFFFFso
  ohFFFFFFFFFFFFso
  ohFFFFFFFFFFFFso
  ohFFFFFFFFFFFFso
  ohFFFFFFFFFFFFso
  ohFFFFFFFFFFFFso
  ohFFFFFFFFFFFFso
  ohFFFFFFFFFFFFso
  ohFFFFFFFFFFFFso
  ohFFFFFFFFFFFFso
  oFssssssssssssso
  oDDDDDDDDDDDDDDo
  .oooooooooooooo.
`;

const GEDRUECKT = `
  .oooooooooooooo.
  oDDDDDDDDDDDDDDo
  oDFFFFFFFFFFFFFo
  oDFFFFFFFFFFFFFo
  oDFFFFFFFFFFFFFo
  oDFFFFFFFFFFFFFo
  oDFFFFFFFFFFFFFo
  oDFFFFFFFFFFFFFo
  oDFFFFFFFFFFFFFo
  oDFFFFFFFFFFFFFo
  oDFFFFFFFFFFFFFo
  oDFFFFFFFFFFFFFo
  oDFFFFFFFFFFFFFo
  oDFFFFFFFFFFFFFo
  oFFFFFFFFFFFFFFo
  .oooooooooooooo.
`;

/** Ränder [oben, rechts, unten, links]: Umriss + Lichtkante oben, Schatten + Lippe + Umriss unten. */
export const KNOPF_SLICE = [2, 2, 3, 2] as const;

export const KNOPF: UiGrafikQuelle = {
  id: 'knopf',
  vorschau: [[44, 18]],
  beschreibung: 'Schaltfläche',
  slice: KNOPF_SLICE,
  kanten: 'dehnen',
  legende: { '.': null, o: 'nacht.1', L: 'holz.4', h: 'holz.3', F: 'holz.2', s: 'holz.1', D: 'holz.0' },
  raster: ERHABEN,
};

export const KNOPF_HOVER: UiGrafikQuelle = {
  id: 'knopf_hover',
  vorschau: [[44, 18]],
  beschreibung: 'Schaltfläche unter dem Zeiger oder Fokus',
  slice: KNOPF_SLICE,
  kanten: 'dehnen',
  legende: { '.': null, o: 'ui.akzent', L: 'sand.4', h: 'holz.4', F: 'holz.3', s: 'holz.2', D: 'holz.1' },
  raster: ERHABEN,
};

export const KNOPF_GEDRUECKT: UiGrafikQuelle = {
  id: 'knopf_gedrueckt',
  vorschau: [[44, 18]],
  beschreibung: 'Gedrückte Schaltfläche',
  slice: KNOPF_SLICE,
  kanten: 'dehnen',
  legende: { '.': null, o: 'nacht.1', D: 'holz.0', F: 'holz.1' },
  raster: GEDRUECKT,
};

export const KNOPF_GESPERRT: UiGrafikQuelle = {
  id: 'knopf_gesperrt',
  vorschau: [[44, 18]],
  beschreibung: 'Gesperrte Schaltfläche',
  slice: KNOPF_SLICE,
  kanten: 'dehnen',
  legende: { '.': null, o: 'nacht.1', L: 'stein.3', h: 'stein.2', F: 'stein.1', s: 'stein.0', D: 'nacht.2' },
  raster: ERHABEN,
};
