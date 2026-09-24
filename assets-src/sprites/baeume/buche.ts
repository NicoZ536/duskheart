/**
 * Buche (Grünhain): glatter, silbergrauer Stamm, dichte, hohe Kuppel aus Blattmassen; 56×80. Laubbaum:
 * Herbst kupferrot, Winter kahl mit aufstrebenden Ästen.
 */
import { LAUBWECHSEL, baumArt, type BaumArt } from './_baukasten';

const RINDE = { kontur: 'stein.0', schatten: 'stein.1', mitte: 'stein.2', licht: 'stein.3' } as const;

export const BUCHE: BaumArt = {
  art: 'buche',
  seed: 103,
  w: 56,
  h: 80,
  fussX: 28,
  fussY: 77,
  stamm: { oben: 44, breiteFuss: 8, breiteOben: 6, wurzel: 3, wurzelZeilen: 4, rinde: 'glatt', farben: RINDE },
  krone: {
    buendel: 3,
    massen: [
      { x: 28, y: 11, rx: 10, ry: 9 },
      { x: 18, y: 19, rx: 10, ry: 9 },
      { x: 38, y: 19, rx: 10, ry: 9 },
      { x: 11, y: 31, rx: 8, ry: 9 },
      { x: 45, y: 31, rx: 8, ry: 9 },
      { x: 28, y: 26, rx: 11, ry: 10 },
      { x: 20, y: 38, rx: 10, ry: 8 },
      { x: 37, y: 38, rx: 10, ry: 8 },
      { x: 28, y: 45, rx: 9, ry: 5 },
    ],
  },
  kroneUnten: 49,
  geruest: { punkte: 110, punktAbstand: 3, einfluss: 10, erreicht: 3, auftrieb: 0.25 },
  kahl: { schnee: ['eis.4', 'eis.2'] },
  jahreszeiten: LAUBWECHSEL,
  stumpf: { form: 'breit', schnitt: { rand: 'stein.1', ring: 'holz.3', holz: 'holz.4', kern: 'holz.3' } },
  setzling: { w: 16, h: 24, stammHoehe: 9, massen: [{ x: 8, y: 8, rx: 4.5, ry: 4.5 }, { x: 5, y: 12, rx: 3, ry: 3 }, { x: 11, y: 12, rx: 3, ry: 3 }] },
};

export default baumArt(BUCHE);
