/**
 * Eiche (Grünhain, §14): breite, gelappte Krone aus zehn Blattmassen auf einem kräftigen, gefurchten
 * Stamm mit ausgestelltem Wurzelansatz; 64×80. Laubbaum: Herbst rot-golden, Winter kahl mit Schnee auf
 * den knorrigen Ästen.
 */
import { LAUBWECHSEL, baumArt, type BaumArt } from './_baukasten';

const RINDE = { kontur: 'holz.0', schatten: 'holz.1', mitte: 'holz.2', licht: 'holz.3' } as const;

export const EICHE: BaumArt = {
  art: 'eiche',
  seed: 101,
  w: 64,
  h: 80,
  fussX: 32,
  fussY: 77,
  stamm: { oben: 44, breiteFuss: 10, breiteOben: 8, wurzel: 4, wurzelZeilen: 5, rinde: 'furchen', farben: RINDE },
  krone: {
    buendel: 3,
    massen: [
      { x: 32, y: 13, rx: 12, ry: 10 },
      { x: 19, y: 18, rx: 11, ry: 9 },
      { x: 45, y: 17, rx: 11, ry: 9 },
      { x: 12, y: 30, rx: 9, ry: 9 },
      { x: 52, y: 29, rx: 9, ry: 9 },
      { x: 25, y: 28, rx: 12, ry: 10 },
      { x: 40, y: 29, rx: 12, ry: 10 },
      { x: 17, y: 41, rx: 11, ry: 7 },
      { x: 47, y: 41, rx: 11, ry: 7 },
      { x: 32, y: 42, rx: 11, ry: 7 },
    ],
  },
  kroneUnten: 49,
  geruest: { punkte: 120, punktAbstand: 3, einfluss: 10, erreicht: 3, auftrieb: 0.05 },
  kahl: { schnee: ['eis.4', 'eis.2'] },
  jahreszeiten: LAUBWECHSEL,
  stumpf: { form: 'breit', schnitt: { rand: 'holz.1', ring: 'holz.3', holz: 'holz.4', kern: 'holz.2' } },
  setzling: {
    w: 16,
    h: 24,
    stammHoehe: 9,
    massen: [
      { x: 8, y: 8, rx: 5, ry: 4 },
      { x: 5, y: 11, rx: 3.5, ry: 3 },
      { x: 11, y: 11, rx: 3.5, ry: 3 },
    ],
  },
};

export default baumArt(EICHE);
