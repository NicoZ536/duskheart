/**
 * Birnbaum (Grünhain, Obst): aufrechte, schmale, oben spitzere Krone, Birnen als Tropfen (schmal oben,
 * bauchig unten); 44×72. Frühling weiße Blüte, Sommer grüne Birnen, Herbst gelbe Birnen vor rotem
 * Laub, Winter kahl.
 */
import { LAUBWECHSEL, baumArt, type BaumArt } from './_baukasten';
import { OBST_LAUB } from './_obst';

const RINDE = { kontur: 'holz.0', schatten: 'holz.1', mitte: 'holz.2', licht: 'holz.3' } as const;

export const BIRNBAUM: BaumArt = {
  art: 'birnbaum',
  seed: 113,
  w: 44,
  h: 72,
  fussX: 22,
  fussY: 69,
  stamm: { oben: 38, breiteFuss: 7, breiteOben: 5, wurzel: 3, wurzelZeilen: 3, rinde: 'furchen', farben: RINDE },
  krone: {
    buendel: 2.5,
    massen: [
      { x: 22, y: 9, rx: 6, ry: 7 },
      { x: 17, y: 17, rx: 8, ry: 8 },
      { x: 28, y: 17, rx: 8, ry: 8 },
      { x: 12, y: 28, rx: 7, ry: 8 },
      { x: 32, y: 28, rx: 7, ry: 8 },
      { x: 22, y: 26, rx: 9, ry: 9 },
      { x: 16, y: 39, rx: 8, ry: 6 },
      { x: 29, y: 39, rx: 8, ry: 6 },
      { x: 22, y: 43, rx: 7, ry: 4 },
    ],
  },
  kroneFarben: OBST_LAUB,
  kroneUnten: 46,
  geruest: { punkte: 90, punktAbstand: 3, einfluss: 10, erreicht: 3, auftrieb: 0.35 },
  kahl: { schnee: ['eis.4', 'eis.4'] },
  jahreszeiten: LAUBWECHSEL,
  fruechte: {
    anzahl: 10,
    abstand: 6,
    form: [
      [0, 0, 'laub.4'],
      [0, 1, 'laub.4'],
      [1, 1, 'laub.3'],
      [0, 2, 'laub.3'],
      [1, 2, 'laub.3'],
    ],
  },
  stumpf: { form: 'breit', schnitt: { rand: 'holz.1', ring: 'holz.3', holz: 'holz.4', kern: 'holz.2' } },
  setzling: { w: 16, h: 24, stammHoehe: 9, massen: [{ x: 8, y: 7, rx: 3.5, ry: 5 }, { x: 5.5, y: 12, rx: 2.5, ry: 3 }, { x: 10.5, y: 12, rx: 2.5, ry: 3 }] },
};

export default baumArt(BIRNBAUM);
