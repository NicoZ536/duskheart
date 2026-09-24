/**
 * Weide (Grünhain an Bächen, Nebelmoor): kurzer, dicker, leicht schiefer Stamm, flache Kuppel und
 * langer Behang aus hängenden Laubsträhnen im wechselnden Abstand; 64×72. Laubbaum: Herbst gelb
 * (`herbst_weide`), Winter kahl mit hängenden Zweigen.
 */
import { LAUBWECHSEL, baumArt, type BaumArt } from './_baukasten';
import { LAUB_GRAS, type KronenFarben } from '../../lib/tree';
import { behang, type Straehne } from '../../lib/treeKronen';

const RINDE = { kontur: 'holz.0', schatten: 'holz.1', mitte: 'holz.2', licht: 'holz.3' } as const;

/** Behang: zwei Lagen Strähnen im wechselnden Abstand (3–5 px) und wechselnder Länge, außen kürzer. */
function straehnen(start: number, abstaende: readonly number[], laengen: readonly number[], oben: number): Straehne[] {
  const out: Straehne[] = [];
  let x = start;
  abstaende.forEach((d, i) => {
    const rand = Math.abs(x - 32) / 26;
    out.push({ x, y: oben + Math.round(rand * rand * 9), laenge: Math.round((laengen[i] ?? 14) * (1 - rand * 0.45)) });
    x += d;
  });
  return out;
}
const HINTEN = straehnen(9, [5, 4, 5, 4, 5, 4, 5, 4, 5, 4], [18, 24, 28, 22, 30, 26, 29, 23, 27, 20, 17], 22);
const VORN = straehnen(7, [4, 3, 5, 3, 4, 4, 3, 5, 3, 4, 3, 5], [14, 20, 26, 18, 30, 24, 17, 31, 22, 28, 18, 24, 15], 25);
/** Hintere Lage eine Stufe dunkler. */
const LAUB_HINTEN: KronenFarben = { kontur: 'gras.0', stufen: ['gras.1', 'gras.1', 'gras.2', 'gras.3', 'gras.4'] };

export const WEIDE: BaumArt = {
  art: 'weide',
  seed: 106,
  w: 64,
  h: 72,
  fussX: 30,
  fussY: 69,
  stamm: { oben: 30, breiteFuss: 11, breiteOben: 8, wurzel: 4, wurzelZeilen: 4, neigung: 3, rinde: 'furchen', farben: RINDE },
  krone: {
    buendel: 2.5,
    massen: [
      { x: 32, y: 10, rx: 13, ry: 7 },
      { x: 19, y: 16, rx: 11, ry: 7 },
      { x: 45, y: 16, rx: 11, ry: 7 },
      { x: 10, y: 23, rx: 7, ry: 6 },
      { x: 54, y: 23, rx: 7, ry: 6 },
      { x: 32, y: 21, rx: 15, ry: 7 },
    ],
  },
  kroneUnten: 29,
  eigeneKrone: (b, rng) => {
    behang(b, rng, HINTEN, LAUB_HINTEN);
    behang(b, rng, VORN, LAUB_GRAS);
  },
  geruest: { punkte: 100, punktAbstand: 3, einfluss: 10, erreicht: 3, auftrieb: -0.35 },
  kahl: { schnee: ['eis.4', 'eis.2'], haengen: 22 },
  jahreszeiten: LAUBWECHSEL,
  stumpf: { form: 'breit', schnitt: { rand: 'holz.1', ring: 'holz.3', holz: 'holz.4', kern: 'holz.2' } },
  setzling: { w: 16, h: 24, stammHoehe: 9, massen: [{ x: 8, y: 8, rx: 5, ry: 3.5 }, { x: 5, y: 12, rx: 2, ry: 4 }, { x: 11, y: 12, rx: 2, ry: 4 }] },
};

export default baumArt(WEIDE);
