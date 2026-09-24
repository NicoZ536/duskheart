/**
 * Birke (Grünhain, Übergänge zum Frostkamm): schlanker weißer Stamm mit schwarzen Querflecken, lichte,
 * hohe Krone aus kleinen Massen mit Lücken, durch die die Äste scheinen; 40×72. Laubbaum: Herbst
 * goldgelb (`herbst_birke`), Winter kahl mit feinen, leicht hängenden Zweigen.
 */
import { LAUBWECHSEL, baumArt, type BaumArt } from './_baukasten';

const RINDE = { kontur: 'stein.1', schatten: 'stein.4', mitte: 'stein.5', licht: 'eis.4', akzent: 'nacht.1' } as const;

export const BIRKE: BaumArt = {
  art: 'birke',
  seed: 102,
  w: 40,
  h: 72,
  fussX: 20,
  fussY: 69,
  stamm: { oben: 30, breiteFuss: 6, breiteOben: 4, wurzel: 2, wurzelZeilen: 3, rinde: 'birke', farben: RINDE },
  krone: {
    buendel: 2.5,
    massen: [
      { x: 20, y: 9, rx: 7, ry: 7 },
      { x: 14, y: 17, rx: 7, ry: 7 },
      { x: 27, y: 16, rx: 7, ry: 7 },
      { x: 10, y: 28, rx: 6, ry: 7 },
      { x: 30, y: 27, rx: 6, ry: 7 },
      { x: 20, y: 24, rx: 7, ry: 8 },
      { x: 14, y: 38, rx: 6, ry: 6 },
      { x: 27, y: 37, rx: 6, ry: 6 },
      { x: 20, y: 44, rx: 5, ry: 4 },
    ],
    luecken: [
      { x: 20, y: 33, rx: 2, ry: 2.5 },
      { x: 11, y: 21, rx: 1.5, ry: 2 },
    ],
  },
  kroneUnten: 48,
  geruest: { punkte: 110, punktAbstand: 2.5, einfluss: 9, erreicht: 2.5, auftrieb: -0.1 },
  sichtbareAeste: 1.5,
  kahl: { schnee: ['eis.4', 'eis.2'] },
  jahreszeiten: LAUBWECHSEL,
  stumpf: { form: 'schmal', schnitt: { rand: 'stein.4', ring: 'sand.2', holz: 'sand.3', kern: 'sand.2' } },
  setzling: { w: 16, h: 24, stammHoehe: 10, massen: [{ x: 8, y: 7, rx: 3.5, ry: 4.5 }, { x: 6, y: 12, rx: 3, ry: 3 }, { x: 10, y: 11, rx: 3, ry: 3 }] },
};

export default baumArt(BIRKE);
