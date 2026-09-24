/**
 * Kiefer (Grünhain/Frostkamm-Übergang, Taiga): hoher, oben rotbrauner Stamm, flache Nadelschirme hoch
 * oben, durch die die Äste laufen; 48×88. Immergrün: Herbst wie gezeichnet (`herbst_kiefer`), Winter
 * Schnee auf den Nadelkappen (`winter_kiefer`).
 */
import { IMMERGRUEN, baumArt, type BaumArt } from './_baukasten';
import { nadelSetzling } from './_setzlinge';
import { LAUB_GRAS } from '../../lib/tree';

const RINDE = { kontur: 'holz.0', schatten: 'haut.0', mitte: 'haut.1', licht: 'haut.2' } as const;

export const KIEFER: BaumArt = {
  art: 'kiefer',
  seed: 104,
  w: 48,
  h: 88,
  fussX: 24,
  fussY: 85,
  stamm: { oben: 20, breiteFuss: 7, breiteOben: 4, wurzel: 2, wurzelZeilen: 3, neigung: 2, rinde: 'furchen', farben: RINDE },
  krone: {
    buendel: 2.5,
    buendelStreckung: 1.8,
    tiefe: 0.4,
    massen: [
      { x: 26, y: 8, rx: 8, ry: 5 },
      { x: 17, y: 14, rx: 8, ry: 4.5 },
      { x: 35, y: 16, rx: 9, ry: 4.5 },
      { x: 25, y: 20, rx: 9, ry: 5 },
      { x: 12, y: 26, rx: 8, ry: 4 },
      { x: 38, y: 30, rx: 7, ry: 4 },
      { x: 23, y: 33, rx: 7, ry: 4 },
      { x: 16, y: 44, rx: 6, ry: 3.5 },
    ],
    schwellen: [0.32, 0.47, 0.64, 0.8],
  },
  geruest: { punkte: 70, punktAbstand: 3, einfluss: 10, erreicht: 3, auftrieb: 0.1 },
  sichtbareAeste: 1.5,
  jahreszeiten: IMMERGRUEN,
  stumpf: { form: 'schmal', schnitt: { rand: 'haut.1', ring: 'sand.1', holz: 'sand.3', kern: 'sand.1' } },
  setzling: { w: 16, h: 24, zeichne: nadelSetzling(RINDE, LAUB_GRAS) },
};

export default baumArt(KIEFER);
