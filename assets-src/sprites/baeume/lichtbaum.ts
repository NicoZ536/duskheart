/**
 * Lichtbaum (Scherbenhain, Lichtholz): heller, kristalliner Stamm mit leuchtenden Adern, Krone aus
 * facettierten Kristallblättern, die selbst leuchten – Kern heller als der Rand; 48×80. Keine
 * Jahreszeiten (Krone in `wasser`/`eis`).
 */
import { IMMERGRUEN, baumArt, type BaumArt } from './_baukasten';
import { kristallSetzling } from './_setzlinge';
import type { KronenFarben } from '../../lib/tree';
import type { Blattmasse } from '../../lib/foliage';
import { Rng } from '../../../src/engine/rng';

const RINDE = { kontur: 'wasser.1', schatten: 'eis.0', mitte: 'eis.1', licht: 'eis.3', akzent: 'wasser.5*' } as const;
/**
 * Kristallblätter: 19 Facettenkörper verschiedener Größe, locker in einer runden Krone verteilt
 * (fester Seed – die Anordnung ist Teil der Zeichnung, nicht des Zufalls je Build).
 */
function kristallMassen(): Blattmasse[] {
  const rng = new Rng(0x11c47);
  const out: Blattmasse[] = [{ x: 24, y: 9, rx: 5, ry: 7 }];
  for (let i = 0; out.length < 19 && i < 600; i++) {
    const a = rng.float(0, Math.PI * 2);
    const r = Math.sqrt(rng.next());
    const x = 24 + Math.cos(a) * r * 17;
    const y = 30 + Math.sin(a) * r * 20;
    const rx = rng.float(3.5, 6);
    const m = { x, y, rx, ry: rx * rng.float(1.2, 1.6) };
    if (out.every((o) => Math.hypot(o.x - m.x, (o.y - m.y) * 0.8) > (o.rx + m.rx) * 0.8)) out.push(m);
  }
  return out;
}

const KRISTALL: KronenFarben = { kontur: 'wasser.1', stufen: ['wasser.2', 'wasser.3', 'wasser.4*', 'wasser.5*', 'eis.4*'] };

export const LICHTBAUM: BaumArt = {
  art: 'lichtbaum',
  seed: 110,
  w: 48,
  h: 80,
  fussX: 24,
  fussY: 77,
  stamm: { oben: 46, breiteFuss: 9, breiteOben: 6, wurzel: 3, wurzelZeilen: 4, rinde: 'kristall', farben: RINDE },
  krone: {
    form: 'kristall',
    buendel: 0,
    massen: kristallMassen(),
    schwellen: [0.3, 0.46, 0.62, 0.8],
  },
  kroneFarben: KRISTALL,
  kroneUnten: 54,
  geruest: { punkte: 70, punktAbstand: 3, einfluss: 10, erreicht: 3, auftrieb: 0.2 },
  sichtbareAeste: 2,
  jahreszeiten: IMMERGRUEN,
  stumpf: { form: 'schmal', schnitt: { rand: 'eis.0', ring: 'wasser.4*', holz: 'eis.3', kern: 'wasser.5*' } },
  setzling: { w: 16, h: 24, zeichne: kristallSetzling(RINDE, KRISTALL) },
};

export default baumArt(LICHTBAUM);
