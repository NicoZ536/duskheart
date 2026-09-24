/**
 * Schaltfläche (MASTERPROMPT §26) in vier Zuständen, alle mit denselben 9-Slice-Rändern, damit
 * ein Zustandswechsel das Layout nicht verschiebt (M1-32: Fase und Glanzkante statt flacher Fläche):
 * - normal: gewölbtes Holz mit 2 px breiter Fase – außen Glanzkante oben (hellste Stufe, fängt den
 *   Himmel), Lichtkante links, Schattenkante rechts und unten, innen je eine Mittelstufe –, Gehrung
 *   an den Ecken oben rechts und unten links, Glanzpunkt in der Ecke oben links, 1 px Eckfase im Umriss;
 * - hover (Zeiger, Controller-Fokus): dieselbe Form eine Stufe heller, Umriss in Akzentfarbe;
 * - gedrückt: die Fase kehrt sich um – Schatten oben und links, die Unterkante fängt als Glanzkante
 *   Licht, die Fläche ist dunkler; der Inhalt rückt 1 px nach unten;
 * - gesperrt: kaltes Grau (Stein), gleicher Aufbau wie normal, ohne Glanz.
 * Die Kanten werden gedehnt: jeder Rand ist quer zur Dehnrichtung einfarbig, Gehrung und Glanzpunkt
 * liegen in den Ecken.
 */
import type { UiGrafikQuelle } from './format';

const ERHABEN = `
  .oooooooooooooo.
  oGGGGGGGGGGGGGmo
  oGhhhhhhhhhhhmDo
  oLhFFFFFFFFFFsDo
  oLhFFFFFFFFFFsDo
  oLhFFFFFFFFFFsDo
  oLhFFFFFFFFFFsDo
  oLhFFFFFFFFFFsDo
  oLhFFFFFFFFFFsDo
  oLhFFFFFFFFFFsDo
  oLhFFFFFFFFFFsDo
  oLhFFFFFFFFFFsDo
  oLhFFFFFFFFFFsDo
  oLmsssssssssssDo
  omDDDDDDDDDDDDDo
  .oooooooooooooo.
`;

const GEDRUECKT = `
  .oooooooooooooo.
  oDDDDDDDDDDDDDmo
  oDsssssssssssmlo
  oDsFFFFFFFFFFFlo
  oDsFFFFFFFFFFFlo
  oDsFFFFFFFFFFFlo
  oDsFFFFFFFFFFFlo
  oDsFFFFFFFFFFFlo
  oDsFFFFFFFFFFFlo
  oDsFFFFFFFFFFFlo
  oDsFFFFFFFFFFFlo
  oDsFFFFFFFFFFFlo
  oDsFFFFFFFFFFFlo
  oDFFFFFFFFFFFFlo
  omGGGGGGGGGGGGGo
  .oooooooooooooo.
`;

/** Ränder [oben, rechts, unten, links]: Umriss + zwei Stufen Fase auf jeder Seite. */
export const KNOPF_SLICE = [3, 3, 3, 3] as const;

export const KNOPF: UiGrafikQuelle = {
  id: 'knopf',
  vorschau: [[44, 18]],
  beschreibung: 'Schaltfläche',
  slice: KNOPF_SLICE,
  kanten: 'dehnen',
  legende: { '.': null, o: 'nacht.1', G: 'sand.4', L: 'holz.4', h: 'holz.3', F: 'holz.2', m: 'holz.2', s: 'holz.1', D: 'holz.0' },
  raster: ERHABEN,
};

export const KNOPF_HOVER: UiGrafikQuelle = {
  id: 'knopf_hover',
  vorschau: [[44, 18]],
  beschreibung: 'Schaltfläche unter dem Zeiger oder Fokus',
  slice: KNOPF_SLICE,
  kanten: 'dehnen',
  legende: { '.': null, o: 'ui.akzent', G: 'feuer.5', L: 'sand.4', h: 'holz.4', F: 'holz.3', m: 'holz.3', s: 'holz.2', D: 'holz.1' },
  raster: ERHABEN,
};

export const KNOPF_GEDRUECKT: UiGrafikQuelle = {
  id: 'knopf_gedrueckt',
  vorschau: [[44, 18]],
  beschreibung: 'Gedrückte Schaltfläche',
  slice: KNOPF_SLICE,
  kanten: 'dehnen',
  legende: { '.': null, o: 'nacht.1', D: 'nacht.2', s: 'holz.0', F: 'holz.1', m: 'holz.1', l: 'holz.2', G: 'holz.3' },
  raster: GEDRUECKT,
};

export const KNOPF_GESPERRT: UiGrafikQuelle = {
  id: 'knopf_gesperrt',
  vorschau: [[44, 18]],
  beschreibung: 'Gesperrte Schaltfläche',
  slice: KNOPF_SLICE,
  kanten: 'dehnen',
  legende: { '.': null, o: 'nacht.1', G: 'stein.3', L: 'stein.3', h: 'stein.2', F: 'stein.1', m: 'stein.1', s: 'stein.0', D: 'nacht.2' },
  raster: ERHABEN,
};
