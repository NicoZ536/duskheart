/**
 * Walnussbaum (Grünhain, Obst): große, breite Krone aus schweren Massen auf hellgrauem Stamm mit
 * rautigen Furchen, Nüsse als runde Fruchthüllen; 64×80. Frühling frisches Laub mit Kätzchen, Sommer
 * grüne Hüllen, Herbst braune Nüsse vor goldgelbem Laub, Winter kahl.
 */
import { LAUBWECHSEL, baumArt, type BaumArt } from './_baukasten';
import { OBST_LAUB } from './_obst';

const RINDE = { kontur: 'stein.0', schatten: 'stein.1', mitte: 'stein.2', licht: 'stein.3' } as const;

export const WALNUSSBAUM: BaumArt = {
  art: 'walnussbaum',
  seed: 114,
  w: 64,
  h: 80,
  fussX: 32,
  fussY: 77,
  stamm: { oben: 42, breiteFuss: 10, breiteOben: 8, wurzel: 4, wurzelZeilen: 4, rinde: 'furchen', farben: RINDE },
  krone: {
    buendel: 3.5,
    massen: [
      { x: 30, y: 12, rx: 13, ry: 9 },
      { x: 16, y: 19, rx: 12, ry: 9 },
      { x: 46, y: 19, rx: 12, ry: 9 },
      { x: 9, y: 31, rx: 7, ry: 8 },
      { x: 55, y: 31, rx: 7, ry: 8 },
      { x: 31, y: 27, rx: 14, ry: 10 },
      { x: 19, y: 38, rx: 11, ry: 7 },
      { x: 44, y: 38, rx: 11, ry: 7 },
      { x: 32, y: 43, rx: 10, ry: 5 },
    ],
  },
  kroneFarben: OBST_LAUB,
  kroneUnten: 47,
  geruest: { punkte: 120, punktAbstand: 3, einfluss: 11, erreicht: 3, auftrieb: 0.05 },
  kahl: { schnee: ['eis.4', 'eis.4'] },
  jahreszeiten: LAUBWECHSEL,
  fruechte: {
    anzahl: 12,
    abstand: 7,
    form: [
      [0, 0, 'laub.4'],
      [1, 0, 'laub.4'],
      [0, 1, 'laub.3'],
      [1, 1, 'laub.3'],
    ],
  },
  stumpf: { form: 'breit', schnitt: { rand: 'stein.1', ring: 'holz.2', holz: 'holz.3', kern: 'holz.1' } },
  setzling: { w: 16, h: 24, stammHoehe: 9, massen: [{ x: 8, y: 8, rx: 5.5, ry: 4 }, { x: 4.5, y: 12, rx: 3, ry: 3 }, { x: 11.5, y: 12, rx: 3, ry: 3 }] },
};

export default baumArt(WALNUSSBAUM);
