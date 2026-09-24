/**
 * Dattelpalme (Glutsand, Oasen): hoher, leicht gebogener Schuppenstamm, Wedelkrone aus zwölf Wedeln
 * mit gesägter Fiederung, darunter Dattelrispen; 48×88. Immergrün (`herbst_dattelpalme`,
 * `winter_dattelpalme`).
 */
import { IMMERGRUEN, baumArt, type BaumArt } from './_baukasten';
import { palmSetzling } from './_setzlinge';
import { LAUB_GRAS } from '../../lib/tree';
import { palmKrone } from '../../lib/treeKronen';

const RINDE = { kontur: 'holz.0', schatten: 'holz.1', mitte: 'holz.2', licht: 'holz.3' } as const;
/** Krone sitzt auf der Stammspitze (Fuß 26 + Neigung 3). */
const KX = 29;
const KY = 26;

export const DATTELPALME: BaumArt = {
  art: 'dattelpalme',
  seed: 108,
  w: 56,
  h: 88,
  fussX: 26,
  fussY: 85,
  stamm: { oben: KY, breiteFuss: 7, breiteOben: 5, wurzel: 2, wurzelZeilen: 3, neigung: KX - 26, rinde: 'schuppen', farben: RINDE },
  eigeneKrone: (b, rng) => {
    // Dattelrispen unter dem Kronenknoten (hinter den vorderen Wedeln).
    for (const [dx, dy] of [
      [-4, 5],
      [-3, 6],
      [-4, 7],
      [-3, 8],
      [-5, 6],
      [-4, 9],
      [3, 6],
      [4, 7],
      [3, 8],
      [4, 9],
      [5, 8],
    ] as const) {
      b.set(KX + dx, KY + dy, dy % 2 === 0 ? 'laub.3' : 'laub.2', 8, 6);
    }
    palmKrone(b, rng, {
      x: KX,
      y: KY,
      farben: { kontur: LAUB_GRAS.kontur, stufen: LAUB_GRAS.stufen },
      wedel: [
        { winkel: -Math.PI / 2 - 0.25, laenge: 15, haengen: 3, breite: 3 },
        { winkel: -Math.PI / 2 + 0.3, laenge: 14, haengen: 3, breite: 3 },
        { winkel: -Math.PI + 0.75, laenge: 21, haengen: 8, breite: 4 },
        { winkel: -0.8, laenge: 20, haengen: 8, breite: 4 },
        { winkel: Math.PI - 0.12, laenge: 24, haengen: 13, breite: 4.5 },
        { winkel: 0.1, laenge: 24, haengen: 13, breite: 4.5 },
        { winkel: Math.PI - 0.75, laenge: 18, haengen: 9, breite: 3.5 },
        { winkel: 0.8, laenge: 17, haengen: 9, breite: 3.5 },
        { winkel: Math.PI / 2 + 0.2, laenge: 11, haengen: 3, breite: 3 },
        { winkel: -Math.PI / 2 - 0.85, laenge: 17, haengen: 5, breite: 3.5 },
        { winkel: -Math.PI / 2 + 0.95, laenge: 17, haengen: 5, breite: 3.5 },
        { winkel: Math.PI / 2 - 0.45, laenge: 13, haengen: 4, breite: 3 },
      ],
    });
  },
  jahreszeiten: IMMERGRUEN,
  stumpf: { form: 'schmal', schnitt: { rand: 'holz.1', ring: 'sand.1', holz: 'sand.2', kern: 'sand.1' } },
  setzling: { w: 16, h: 24, zeichne: palmSetzling(RINDE, LAUB_GRAS) },
};

export default baumArt(DATTELPALME);
