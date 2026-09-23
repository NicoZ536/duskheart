/**
 * Pixel-Scrollbar (MASTERPROMPT §26 "Keine Standard-Web-Widgets, eigene Pixel-Scrollbars"),
 * 7 px breit: vertiefte Bahn, gewölbter Holzgriff mit mittig aufgelegten Rillen, Pfeilknöpfe oben
 * und unten mit Pergament-Pfeil.
 */
import type { UiGrafikQuelle } from './format';

const HOLZ = { '.': null, o: 'nacht.1', L: 'holz.4', h: 'holz.3', F: 'holz.2', s: 'holz.1', a: 'ui.pergament' } as const;

export const SCROLL_BAHN: UiGrafikQuelle = {
  id: 'scroll_bahn',
  vorschau: [[7, 40]],
  beschreibung: 'Bahn der Scrollbar (senkrecht gedehnt)',
  slice: 3,
  kanten: 'dehnen',
  legende: { '.': null, o: 'nacht.1', S: 'nacht.0', g: 'nacht.2', l: 'nacht.3' },
  raster: `
    .ooooo.
    oSSSSSo
    oSggglo
    oSggglo
    oSggglo
    oSggglo
    oSggglo
    oSggglo
    oSggglo
    oSggglo
    oSllllo
    .ooooo.
  `,
};

export const SCROLL_GRIFF: UiGrafikQuelle = {
  id: 'scroll_griff',
  vorschau: [[7, 24]],
  beschreibung: 'Griff der Scrollbar (senkrecht gedehnt)',
  slice: 2,
  kanten: 'dehnen',
  legende: HOLZ,
  raster: `
    .ooooo.
    oLhhhFo
    ohFFFso
    ohFFFso
    ohFFFso
    ohFFFso
    ohFFFso
    ohFFFso
    ohFFFso
    ohFFFso
    oFsssso
    .ooooo.
  `,
};

export const SCROLL_RILLEN: UiGrafikQuelle = {
  id: 'scroll_rillen',
  beschreibung: 'Griffrillen, mittig auf dem Scrollbar-Griff',
  legende: { D: 'holz.0', h: 'holz.3' },
  raster: `
    DDD
    hhh
    DDD
    hhh
    DDD
    hhh
  `,
};

export const SCROLL_HOCH: UiGrafikQuelle = {
  id: 'scroll_hoch',
  beschreibung: 'Pfeilknopf „nach oben“ der Scrollbar',
  legende: HOLZ,
  raster: `
    .ooooo.
    oLhhhFo
    ohFFFso
    ohFaFso
    ohaaaso
    oFsssso
    .ooooo.
  `,
};

export const SCROLL_RUNTER: UiGrafikQuelle = {
  id: 'scroll_runter',
  beschreibung: 'Pfeilknopf „nach unten“ der Scrollbar',
  legende: HOLZ,
  raster: `
    .ooooo.
    oLhhhFo
    ohFFFso
    ohaaaso
    ohFaFso
    oFsssso
    .ooooo.
  `,
};
