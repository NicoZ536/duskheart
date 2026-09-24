/**
 * Aschebaum (Aschenschlund): verkohlter, schwarzer Stamm mit glühenden Rissen, knorrige, offen
 * sichtbare Äste und schüttere Büschel aus rauchdunklem Laub, dessen Oberseiten wie Glut glimmen (nur
 * die hellste Stufe leuchtet); 48×72. Keine Jahreszeiten (Laub und Rinde in `nacht`, Glut in `feuer` –
 * die Laubzeilen lassen alles unverändert).
 */
import { IMMERGRUEN, baumArt, type BaumArt } from './_baukasten';
import type { KronenFarben } from '../../lib/tree';
import { zweigSetzling } from './_setzlinge';

const RINDE = { kontur: 'nacht.0', schatten: 'nacht.1', mitte: 'nacht.2', licht: 'nacht.3', akzent: 'feuer.3*' } as const;
const ASCHE: KronenFarben = { kontur: 'nacht.0', stufen: ['nacht.2', 'nacht.3', 'nacht.4', 'feuer.2', 'feuer.3*'] };

export const ASCHEBAUM: BaumArt = {
  art: 'aschebaum',
  seed: 109,
  w: 48,
  h: 72,
  fussX: 24,
  fussY: 69,
  stamm: { oben: 34, breiteFuss: 8, breiteOben: 5, wurzel: 3, wurzelZeilen: 4, neigung: -2, rinde: 'glut', farben: RINDE },
  krone: {
    buendel: 2,
    massen: [
      { x: 24, y: 9, rx: 6, ry: 4 },
      { x: 13, y: 13, rx: 6, ry: 4 },
      { x: 35, y: 12, rx: 6, ry: 4 },
      { x: 6, y: 22, rx: 4, ry: 3.5 },
      { x: 42, y: 21, rx: 4, ry: 3.5 },
      { x: 19, y: 20, rx: 5, ry: 3.5 },
      { x: 30, y: 21, rx: 5, ry: 3.5 },
      { x: 11, y: 29, rx: 4, ry: 3 },
      { x: 37, y: 30, rx: 4, ry: 3 },
    ],
    licht: { bias: 0.58 },
  },
  kroneFarben: ASCHE,
  kroneUnten: 40,
  geruest: { punkte: 70, punktAbstand: 3, einfluss: 11, erreicht: 3, auftrieb: 0.05 },
  geruestRand: 0,
  sichtbareAeste: 1,
  jahreszeiten: IMMERGRUEN,
  stumpf: { form: 'schmal', schnitt: { rand: 'nacht.1', ring: 'nacht.2', holz: 'nacht.4', kern: 'feuer.3*' } },
  setzling: { w: 16, h: 24, zeichne: zweigSetzling(RINDE, ASCHE) },
};

export default baumArt(ASCHEBAUM);
