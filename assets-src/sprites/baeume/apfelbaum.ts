/**
 * Apfelbaum (Grünhain, Obst): runde, etwas unregelmäßige Krone auf kurzem, gegabeltem Stamm, Äpfel
 * als 2×2-Früchte (hell oben, dunkel unten); 48×64. Frühling rosa-weiße Blüte, Sommer gelbgrüne Äpfel
 * mit roter Backe, Herbst rote Äpfel vor olivgoldenem Laub, Winter kahl.
 */
import { LAUBWECHSEL, baumArt, type BaumArt } from './_baukasten';
import { OBST_LAUB } from './_obst';

const RINDE = { kontur: 'holz.0', schatten: 'holz.1', mitte: 'holz.2', licht: 'holz.3' } as const;

export const APFELBAUM: BaumArt = {
  art: 'apfelbaum',
  seed: 111,
  w: 48,
  h: 64,
  fussX: 24,
  fussY: 61,
  stamm: { oben: 32, breiteFuss: 7, breiteOben: 6, wurzel: 3, wurzelZeilen: 3, rinde: 'furchen', farben: RINDE },
  krone: {
    buendel: 2.5,
    massen: [
      { x: 23, y: 11, rx: 10, ry: 8 },
      { x: 13, y: 18, rx: 9, ry: 8 },
      { x: 34, y: 17, rx: 9, ry: 8 },
      { x: 9, y: 28, rx: 6, ry: 6 },
      { x: 39, y: 27, rx: 6, ry: 6 },
      { x: 24, y: 24, rx: 11, ry: 9 },
      { x: 16, y: 32, rx: 9, ry: 6 },
      { x: 32, y: 32, rx: 9, ry: 6 },
    ],
  },
  kroneFarben: OBST_LAUB,
  kroneUnten: 38,
  geruest: { punkte: 90, punktAbstand: 3, einfluss: 10, erreicht: 3, auftrieb: 0.05 },
  kahl: { schnee: ['eis.4', 'eis.4'] },
  jahreszeiten: LAUBWECHSEL,
  fruechte: {
    anzahl: 16,
    abstand: 5,
    minStufe: 1,
    form: [
      [0, 0, 'laub.3'],
      [1, 0, 'laub.3'],
      [0, 1, 'laub.2'],
      [1, 1, 'laub.2'],
    ],
  },
  stumpf: { form: 'breit', schnitt: { rand: 'holz.1', ring: 'holz.3', holz: 'holz.4', kern: 'holz.2' } },
  setzling: { w: 16, h: 24, stammHoehe: 9, massen: [{ x: 8, y: 8, rx: 5, ry: 4 }, { x: 5, y: 12, rx: 3, ry: 3 }, { x: 11, y: 12, rx: 3, ry: 3 }] },
};

export default baumArt(APFELBAUM);
