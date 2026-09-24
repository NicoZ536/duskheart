/**
 * Kronen-Generator (M2-20, docs/ART.md §2, §10 „Krone“): eine Krone besteht aus wenigen großen
 * Blattmassen, deren Oberfläche aus Blattbündeln aufgebaut ist. Jede Masse ist eine Kuppe im Höhenfeld;
 * tiefer liegende (vordere) Massen überdecken höhere (hintere). Die Bündel sitzen auf der Oberfläche
 * ihrer Masse und ergeben die gebuchteten Lichtkappen und den gelappten Umriss. Schattierung kommt aus
 * `shadeRelief` (Himmelsöffnung + Verdeckung): Oberseiten hell, Kontaktschatten unter vorderen Massen,
 * die Unterseite der Krone dunkel – ohne Richtungslicht.
 *
 * Ergebnis ist eine Stufenkarte 0…4 (D d g l L = `gras.1` … `gras.5` bei Laub); die Kontur (`gras.0`)
 * und die Farben setzt der Baum-Baukasten (`tree.ts`).
 */
import type { Rng } from '../../src/engine/rng';
import { Relief, despeckle, jitterGrid, quantize, shadeRelief, smoothMask, type LightOptions } from './foliageRelief';

/** Eine Blattmasse (Ellipse in Zellkoordinaten). */
export interface Blattmasse {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  /** Zusätzliche Tiefe (px): > 0 holt die Masse nach vorn. */
  readonly z?: number;
}

export interface KronenParameter {
  readonly massen: readonly Blattmasse[];
  /** Radius der Blattbündel in px (0 = glatte Massen). */
  readonly buendel: number;
  /** Abstand der Bündel relativ zum Radius (Standard 1,5). */
  readonly buendelAbstand?: number;
  /** Streckung der Bündel in x (> 1: waagerechte Nadelbüschel). */
  readonly buendelStreckung?: number;
  /** Höhe der Bündel relativ zu ihrem Radius (Standard 0,3: Bündel buchten nur die Lichtkappen, die Massen tragen die Form). */
  readonly buendelHoehe?: number;
  /** Tiefenzuwachs je px nach unten: vordere Massen überdecken hintere (Standard 0,65). */
  readonly tiefe?: number;
  /** Höhe einer Masse relativ zu ihrem kleineren Radius (Standard 0,85). */
  readonly massenHoehe?: number;
  readonly licht?: Partial<LightOptions>;
  /** Vier aufsteigende Schwellen → Stufen 0…4. */
  readonly schwellen?: readonly number[];
  /** Pixel, die frei bleiben (Lücken, durch die Äste scheinen). */
  readonly luecken?: readonly Blattmasse[];
  /** `kristall`: Massen als Rautenpyramiden – ebene Facetten mit geraden Kanten (Lichtbaum). */
  readonly form?: 'rund' | 'kristall';
}

export interface Krone {
  readonly relief: Relief;
  /** Stufe je Pixel: −1 leer, 0 (tiefster Schatten) … 4 (Lichtkappe). */
  readonly stufen: Int8Array;
  /** Nummer der Blattmasse je Pixel (−1 leer). */
  readonly masse: Int32Array;
}

/** Standardschwellen für D | d | g | l | L. */
export const KRONEN_SCHWELLEN: readonly number[] = [0.3, 0.44, 0.6, 0.76];
/** Licht der Kronen: kräftige Himmelsöffnung und Kontaktschatten, damit jede Masse eine Lichtkappe trägt. */
export const KRONEN_LICHT: Partial<LightOptions> = { bias: 0.62, up: 0.7, ao: 1.5, aoRadius: 6 };
/** Mindestabstand der Krone zum Zellrand (Kontur + 1 px Luft für die Interaktions-Outline). */
const RAND = 2;

/** Baut das Relief einer Krone (ohne Schattierung). */
export function kronenRelief(rng: Rng, w: number, h: number, p: KronenParameter): Relief {
  const relief = new Relief(w, h);
  const tiefe = p.tiefe ?? 0.65;
  const massenHoehe = p.massenHoehe ?? 0.85;
  const top = Math.min(...p.massen.map((m) => m.y - m.ry));
  const stretch = p.buendelStreckung ?? 1;
  const bh = p.buendelHoehe ?? 0.3;
  p.massen.forEach((m, i) => {
    const base = tiefe * (m.y - top) + (m.z ?? 0);
    const amp = Math.min(m.rx, m.ry) * massenHoehe;
    if (p.form === 'kristall') {
      relief.facette(m.x, m.y, m.rx, m.ry, amp, base, i);
      return;
    }
    relief.dome(m.x, m.y, m.rx * 0.9, m.ry * 0.9, amp, base, i);
    if (p.buendel <= 0) return;
    const r = p.buendel;
    for (const [bx, by] of jitterGrid(rng, m.x, m.y, m.rx * 0.95, m.ry * 0.95, r * (p.buendelAbstand ?? 1.5))) {
      const surface = Relief.domeAt(bx, by, m.x, m.y, m.rx, m.ry, amp, base);
      const z = Number.isFinite(surface) ? surface : base;
      const rr = r * rng.float(0.85, 1.15);
      relief.dome(bx, by, rr * stretch, rr, rr * bh, z - rr * 0.25, i);
    }
  });
  for (const l of p.luecken ?? []) {
    for (let y = Math.floor(l.y - l.ry); y <= Math.ceil(l.y + l.ry); y++) {
      for (let x = Math.floor(l.x - l.rx); x <= Math.ceil(l.x + l.rx); x++) {
        const dx = (x + 0.5 - l.x) / l.rx;
        const dy = (y + 0.5 - l.y) / l.ry;
        if (dx * dx + dy * dy <= 1) relief.cut(x, y);
      }
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < RAND || y < RAND || x >= w - RAND || y >= h - RAND) relief.cut(x, y);
  smoothMask(relief.mask, w, h);
  // Geglättete Maske: neu hinzugekommene Pixel bekommen die Höhe ihrer Nachbarn.
  relief.mask.forEach((v, q) => {
    if (v === 0) {
      relief.height[q] = 0;
      relief.owner[q] = -1;
      return;
    }
    if (relief.owner[q] !== -1) return;
    const x = q % w;
    const y = Math.floor(q / w);
    let sum = 0;
    let n = 0;
    let owner = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const xx = x + dx;
      const yy = y + dy;
      if (!relief.inside(xx, yy)) continue;
      const o = relief.owner[yy * w + xx] ?? -1;
      if (o < 0) continue;
      sum += relief.height[yy * w + xx] ?? 0;
      owner = o;
      n++;
    }
    relief.height[q] = n > 0 ? sum / n : 0;
    relief.owner[q] = owner;
  });
  return relief;
}

/** Krone: Relief → Form-Schattierung → Stufen 0…4 → Einzelpixel aufgelöst. */
export function krone(rng: Rng, w: number, h: number, p: KronenParameter): Krone {
  const relief = kronenRelief(rng, w, h, p);
  const values = shadeRelief(relief, { ...KRONEN_LICHT, ...p.licht });
  const stufen = quantize(values, relief.mask, p.schwellen ?? KRONEN_SCHWELLEN);
  despeckle(stufen, w, h);
  return { relief, stufen, masse: relief.owner };
}

/**
 * Verteilt Punkte (Früchte, Blüten, Beeren) auf gut sichtbaren Kronenpixeln: nur auf Stufen ≥ `minStufe`,
 * mit Mindestabstand `abstand`, mindestens `rand` px von der Kontur entfernt. Deterministisch aus `rng`.
 */
export function kronenPunkte(rng: Rng, k: Krone, w: number, h: number, anzahl: number, abstand: number, minStufe = 2, rand = 2): Array<[number, number]> {
  const kandidaten: Array<[number, number]> = [];
  for (let y = rand; y < h - rand; y++) {
    for (let x = rand; x < w - rand; x++) {
      if ((k.stufen[y * w + x] ?? -1) < minStufe) continue;
      let innen = true;
      for (let dy = -rand; dy <= rand && innen; dy++) for (let dx = -rand; dx <= rand && innen; dx++) if ((k.relief.mask[(y + dy) * w + x + dx] ?? 0) === 0) innen = false;
      if (innen) kandidaten.push([x, y]);
    }
  }
  rng.shuffle(kandidaten);
  const out: Array<[number, number]> = [];
  for (const [x, y] of kandidaten) {
    if (out.length >= anzahl) break;
    if (out.every(([ox, oy]) => Math.hypot(ox - x, oy - y) >= abstand)) out.push([x, y]);
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
