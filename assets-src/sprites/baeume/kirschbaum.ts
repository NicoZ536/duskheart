/**
 * Kirschbaum (Grünhain, Obst): breite, ausladende Krone, rotbrauner Stamm mit hellen Korkporen-Bändern,
 * Kirschen in dichten Grüppchen; 56×64. Frühling rosa Blütenwolke, Sommer dunkelrote Kirschen, Herbst
 * abgeerntet mit orangerotem Laub, Winter kahl.
 */
import { LAUBWECHSEL, baumArt, type BaumArt } from './_baukasten';

const RINDE = { kontur: 'haut.0', schatten: 'haut.0', mitte: 'haut.1', licht: 'haut.1', akzent: 'haut.3' } as const;

export const KIRSCHBAUM: BaumArt = {
  art: 'kirschbaum',
  seed: 112,
  w: 56,
  h: 64,
  fussX: 28,
  fussY: 61,
  stamm: { oben: 30, breiteFuss: 7, breiteOben: 6, wurzel: 3, wurzelZeilen: 3, rinde: 'ringel', farben: RINDE },
  krone: {
    buendel: 2.5,
    massen: [
      { x: 28, y: 11, rx: 11, ry: 7 },
      { x: 15, y: 16, rx: 10, ry: 7 },
      { x: 41, y: 16, rx: 10, ry: 7 },
      { x: 8, y: 25, rx: 6, ry: 6 },
      { x: 48, y: 25, rx: 6, ry: 6 },
      { x: 21, y: 24, rx: 11, ry: 7 },
      { x: 36, y: 24, rx: 11, ry: 7 },
      { x: 28, y: 32, rx: 11, ry: 5 },
    ],
  },
  kroneUnten: 36,
  geruest: { punkte: 100, punktAbstand: 3, einfluss: 10, erreicht: 3, auftrieb: -0.05 },
  sichtbareAeste: 2,
  kahl: { schnee: ['eis.4', 'eis.4'] },
  jahreszeiten: LAUBWECHSEL,
  fruechte: {
    anzahl: 14,
    abstand: 5,
    form: [
      [0, 0, 'laub.3'],
      [1, 0, 'laub.2'],
      [0, 1, 'laub.2'],
      [1, 1, 'laub.2'],
    ],
  },
  stumpf: { form: 'breit', schnitt: { rand: 'haut.0', ring: 'haut.2', holz: 'haut.3', kern: 'haut.1' } },
  setzling: { w: 16, h: 24, stammHoehe: 9, massen: [{ x: 8, y: 9, rx: 5.5, ry: 3.5 }, { x: 4.5, y: 12, rx: 3, ry: 2.5 }, { x: 11.5, y: 12, rx: 3, ry: 2.5 }] },
};

export default baumArt(KIRSCHBAUM);
