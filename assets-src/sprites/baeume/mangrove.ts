/**
 * Mangrove (Nebelmoor, Salzküste): dichte, dunkle Krone auf einem Stamm, der auf gewölbten
 * Stelzwurzeln über dem Schlamm steht; 56×72. Immergrün (`herbst_mangrove`, `winter_mangrove`).
 */
import { IMMERGRUEN, baumArt, type BaumArt } from './_baukasten';
import { stelzwurzeln } from '../../lib/treeKronen';

const RINDE = { kontur: 'holz.0', schatten: 'holz.1', mitte: 'holz.2', licht: 'holz.3' } as const;

export const MANGROVE: BaumArt = {
  art: 'mangrove',
  seed: 107,
  w: 56,
  h: 72,
  fussX: 28,
  fussY: 69,
  stammFuss: 58,
  amStamm: (b) => stelzwurzeln(b, 28, 55, 68, [-17, -11, -6, 6, 11, 17], RINDE),
  stamm: { oben: 36, breiteFuss: 7, breiteOben: 6, wurzel: 1, wurzelZeilen: 2, rinde: 'furchen', farben: RINDE },
  krone: {
    buendel: 2.5,
    massen: [
      { x: 28, y: 11, rx: 11, ry: 8 },
      { x: 16, y: 17, rx: 10, ry: 8 },
      { x: 40, y: 17, rx: 10, ry: 8 },
      { x: 9, y: 27, rx: 7, ry: 7 },
      { x: 47, y: 27, rx: 7, ry: 7 },
      { x: 22, y: 27, rx: 10, ry: 8 },
      { x: 35, y: 28, rx: 10, ry: 8 },
      { x: 28, y: 36, rx: 12, ry: 6 },
    ],
    licht: { bias: 0.55 },
  },
  kroneUnten: 41,
  geruest: { punkte: 80, punktAbstand: 3, einfluss: 10, erreicht: 3, auftrieb: 0.1 },
  jahreszeiten: IMMERGRUEN,
  stumpf: { form: 'breit', schnitt: { rand: 'holz.1', ring: 'holz.2', holz: 'holz.3', kern: 'holz.2' } },
  setzling: { w: 16, h: 24, stammHoehe: 8, massen: [{ x: 8, y: 9, rx: 5, ry: 4 }, { x: 5, y: 12, rx: 3, ry: 2.5 }, { x: 11, y: 12, rx: 3, ry: 2.5 }] },
};

export default baumArt(MANGROVE);
