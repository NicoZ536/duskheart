/**
 * Tanne (Frostkamm): kegelförmig aus sechs hängenden Etagen, deren Nadelspitzen über die nächste
 * Etage fallen; kurzer Stamm; 48×88. Immergrün: Herbst wie gezeichnet (`herbst_tanne`), Winter Schnee
 * auf den Etagen (`winter_tanne`).
 */
import { IMMERGRUEN, baumArt, type BaumArt } from './_baukasten';
import { nadelSetzling } from './_setzlinge';
import { LAUB_GRAS, maleKrone } from '../../lib/tree';
import { etagenKrone } from '../../lib/treeKronen';

const RINDE = { kontur: 'holz.0', schatten: 'holz.1', mitte: 'holz.2', licht: 'holz.2' } as const;
const W = 48;
const H = 88;

export const TANNE: BaumArt = {
  art: 'tanne',
  seed: 105,
  w: W,
  h: H,
  fussX: 24,
  fussY: 85,
  stamm: { oben: 70, breiteFuss: 6, breiteOben: 5, wurzel: 2, wurzelZeilen: 3, rinde: 'furchen', farben: RINDE },
  eigeneKrone: (b, rng) => {
    const k = etagenKrone(rng, W, H, { x: 24, spitze: 2, unten: 74, breite: 21, etagen: 6, zacken: 2.5, haengen: 3, licht: { bias: 0.66 } });
    maleKrone(b, k, LAUB_GRAS);
  },
  jahreszeiten: IMMERGRUEN,
  stumpf: { form: 'schmal', schnitt: { rand: 'holz.1', ring: 'holz.3', holz: 'holz.4', kern: 'holz.3' } },
  setzling: { w: 16, h: 24, zeichne: nadelSetzling(RINDE, LAUB_GRAS) },
};

export default baumArt(TANNE);
