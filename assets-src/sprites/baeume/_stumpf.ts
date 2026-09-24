/**
 * Baumstümpfe (M2-20, §14 „Der Stumpf bleibt“): zwei handgezeichnete Formvorlagen – breit (20×16) für
 * kräftige Stämme, schmal (16×16) für schlanke – mit Schnittfläche (Jahresring, Kern, Rindenrand),
 * Seitenwand und Wurzelansatz mit Bodenkontakt. Die Wand trägt das Rindenmuster der Art.
 *
 * Vorlagenzeichen: `o` Rindenkontur · `W` Wand (Rindenmuster) · `R` Rindenrand der Schnittfläche ·
 * `H` Holz · `h` Jahresring · `K` Kern · `n` Bodenkontakt (`nacht.1`).
 */
import { rasterRows, spriteFromPixels, type Sprite } from '../../lib/sprite';
import { Bild, type Rinde, type RindenFarben, type SchnittFarben } from '../../lib/tree';

export type StumpfForm = 'breit' | 'schmal';

const VORLAGEN: Readonly<Record<StumpfForm, string>> = {
  breit: `
    ....................
    ....................
    ....................
    ......oooooooo......
    ....ooHHHHHHHHoo....
    ...oHHHhhhhhhHHHo...
    ...oHHhHHKKHHhHHo...
    ...oRHHhhhhhhHHRo...
    ...oWRRHHHHHHRRWo...
    ...oWWWRRRRRRWWWo...
    ...oWWWWWWWWWWWWo...
    ...oWWWWWWWWWWWWo...
    ..ooWWWWWWWWWWWWoo..
    .oWWWWWWWWWWWWWWWWo.
    .nnoooooooooooooonn.
    ....................`,
  schmal: `
    ................
    ................
    ................
    ................
    ......oooo......
    ....ooHHHHoo....
    ...oHHhhhhHHo...
    ...oHhHKKHhHo...
    ...oRHhhhhHRo...
    ...oWRRRRRRWo...
    ...oWWWWWWWWo...
    ...oWWWWWWWWo...
    ..ooWWWWWWWWoo..
    .oWWWWWWWWWWWWo.
    .nnoooooooooonn.
    ................`,
};

/** Rindenfarbe eines Wandpixels: `u` ∈ [−1, 1] quer über die Wand, `zeile` ab Wandoberkante. */
function wandFarbe(rinde: Rinde, f: RindenFarben, u: number, spalte: number, zeile: number, rand: boolean, unten: boolean): string {
  if (rand) return f.schatten;
  // Die ausgestellte Fußzeile liegt im Bodenschatten: keine Lichtgrate.
  if (unten) return spalte % 3 === 1 ? f.schatten : f.mitte;
  const akzent = f.akzent ?? f.schatten;
  switch (rinde) {
    case 'furchen':
      // Zwei Lichtgrate und eine Furche, leicht versetzt – nie im gleichen Abstand.
      if (spalte % 5 === 2) return f.licht;
      if (spalte % 5 === 4 && zeile > 0) return f.schatten;
      return f.mitte;
    case 'glatt':
      return Math.abs(u) < 0.45 ? f.licht : f.mitte;
    case 'birke':
      if ((zeile === 1 && u > -0.6 && u < -0.1) || (zeile === 3 && u > 0.15 && u < 0.6)) return akzent;
      return Math.abs(u) < 0.7 ? f.licht : f.mitte;
    case 'ringel':
      if ((zeile === 1 || zeile === 3) && Math.abs(u) < 0.5) return f.licht;
      return f.mitte;
    case 'schuppen':
      return (zeile + Math.round(Math.abs(u) * 2)) % 3 === 0 ? f.schatten : Math.abs(u) < 0.4 ? f.licht : f.mitte;
    case 'glut':
      if (spalte % 4 === 1 && zeile >= 1 && zeile <= 3) return akzent;
      return f.mitte;
    case 'kristall':
      if (spalte % 4 === 2) return akzent;
      return Math.abs(u) < 0.5 ? f.licht : f.mitte;
  }
}

export interface StumpfArt {
  readonly id: string;
  readonly group: string;
  readonly form: StumpfForm;
  readonly rinde: Rinde;
  readonly farben: RindenFarben;
  readonly schnitt: SchnittFarben;
}

/** Stumpf aus der Formvorlage mit dem Rindenmuster der Art. */
export function stumpfSprite(a: StumpfArt): Sprite {
  const rows = rasterRows(VORLAGEN[a.form]);
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const b = new Bild(w, h);
  const wandOben = rows.findIndex((r) => r.includes('W'));
  const wandUnten = rows.length - 1 - [...rows].reverse().findIndex((r) => r.includes('W'));
  rows.forEach((row, y) => {
    const first = row.indexOf('W');
    const last = row.lastIndexOf('W');
    for (let x = 0; x < w; x++) {
      const c = row.charAt(x);
      const hoehe = y < wandOben + 2 ? 5 : 3;
      switch (c) {
        case 'o':
          b.set(x, y, a.farben.kontur, 0, 2);
          break;
        case 'W': {
          const u = last > first ? ((x - first) / (last - first)) * 2 - 1 : 0;
          b.set(x, y, wandFarbe(a.rinde, a.farben, u, x - first, y - wandOben, x === first || x === last, y === wandUnten), 0, 4 * Math.sqrt(Math.max(0, 1 - u * u)));
          break;
        }
        case 'R':
          b.set(x, y, a.schnitt.rand, 0, hoehe);
          break;
        case 'H':
          b.set(x, y, a.schnitt.holz, 0, 6);
          break;
        case 'h':
          b.set(x, y, a.schnitt.ring, 0, 6);
          break;
        case 'K':
          b.set(x, y, a.schnitt.kern, 0, 6);
          break;
        case 'n':
          b.set(x, y, 'nacht.1', 0, 0);
          break;
        default:
          break;
      }
    }
  });
  const fussY = h - 2;
  const cx = Math.floor(w / 2);
  const halb = a.form === 'breit' ? 7 : 5;
  return spriteFromPixels(
    {
      id: a.id,
      group: a.group,
      size: [w, h],
      anchor: [cx, fussY],
      hoehe: 'zylinder',
      hitbox: [cx - halb, fussY - 6, halb * 2, 6],
      occluder: { kind: 'ellipse', x: cx, y: fussY - 1, rx: halb, ry: 2 },
    },
    [b.frame()],
  );
}
