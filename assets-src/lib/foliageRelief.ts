/**
 * Relief-Werkzeuge für Vegetations- und Gesteinsgeneratoren (MASTERPROMPT §5 „Generatoren“, docs/ART.md
 * §2): ein Höhenfeld aus zusammengesetzten Kuppen (Blattmassen, Blattbündel, Felsblöcke), daraus weiche
 * Form-Schattierung nach Himmelsöffnung (Oberseiten hell, Unterseiten und Fugen dunkel, links und rechts
 * gleich – kein Richtungslicht, kein Pillow-Shading), Quantisierung in Rampenstufen und die
 * Pixel-Handarbeit danach: Silhouette glätten, Einzelpixel und Schachbretter auflösen, Kontur ziehen.
 *
 * Koordinaten wie `PixelCanvas`: +x rechts, +y unten, Höhe +z zum Betrachter (px).
 */
import type { Rng } from '../../src/engine/rng';

/** Höhenfeld mit Deckungsmaske (Maximum-Komposition aus Kuppen). */
export class Relief {
  readonly height: Float32Array;
  readonly mask: Uint8Array;
  /** Welche Form (Nummer der Kuppe/Masse) ein Pixel trägt; −1 = keine. */
  readonly owner: Int32Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.height = new Float32Array(w * h);
    this.mask = new Uint8Array(w * h);
    this.owner = new Int32Array(w * h).fill(-1);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Höhe bei (x, y); außerhalb der Maske `fallback`. */
  at(x: number, y: number, fallback = 0): number {
    if (!this.inside(x, y)) return fallback;
    const p = y * this.w + x;
    return (this.mask[p] ?? 0) > 0 ? (this.height[p] ?? 0) : fallback;
  }

  /** Setzt einen Pixel, wenn `z` höher ist als das, was dort liegt (Maximum-Komposition). */
  put(x: number, y: number, z: number, owner = 0): void {
    if (!this.inside(x, y)) return;
    const p = y * this.w + x;
    if ((this.mask[p] ?? 0) > 0 && (this.height[p] ?? 0) >= z) return;
    this.mask[p] = 1;
    this.height[p] = z;
    this.owner[p] = owner;
  }

  /**
   * Ellipsoid-Kappe: Mittelpunkt (cx, cy), Radien rx/ry, Scheitelhöhe `base + amp`. `power` < 1 macht
   * die Kuppe flacher-breiter (Plateau), > 1 spitzer.
   */
  dome(cx: number, cy: number, rx: number, ry: number, amp: number, base: number, owner = 0, power = 1): void {
    const x0 = Math.max(0, Math.floor(cx - rx - 1));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + ry + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const q = dx * dx + dy * dy;
        if (q > 1) continue;
        const cap = Math.pow(Math.sqrt(1 - q), power);
        this.put(x, y, base + amp * cap, owner);
      }
    }
  }

  /**
   * Rautenpyramide (Kristall): Höhe fällt linear mit |dx|/rx + |dy|/ry – vier ebene Facetten mit
   * geraden Kanten, der Grat oben/unten leicht gestaucht, damit die Spitze nach oben weist.
   */
  facette(cx: number, cy: number, rx: number, ry: number, amp: number, base: number, owner = 0): void {
    for (let y = Math.max(0, Math.floor(cy - ry - 1)); y <= Math.min(this.h - 1, Math.ceil(cy + ry * 1.25 + 1)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx - 1)); x <= Math.min(this.w - 1, Math.ceil(cx + rx + 1)); x++) {
        const dx = Math.abs(x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const q = dx + Math.abs(dy) * (dy < 0 ? 1 : 0.8);
        if (q > 1) continue;
        this.put(x, y, base + amp * (1 - q), owner);
      }
    }
  }

  /** Höhe, die eine Kuppe (cx, cy, rx, ry, amp, base) am Punkt (x, y) hätte; −∞ außerhalb. */
  static domeAt(x: number, y: number, cx: number, cy: number, rx: number, ry: number, amp: number, base: number): number {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    const q = dx * dx + dy * dy;
    return q > 1 ? -Infinity : base + amp * Math.sqrt(1 - q);
  }

  /** Entfernt Pixel aus der Maske (z. B. Lücken in der Krone). */
  cut(x: number, y: number): void {
    if (!this.inside(x, y)) return;
    const p = y * this.w + x;
    this.mask[p] = 0;
    this.height[p] = 0;
    this.owner[p] = -1;
  }
}

/** Gewichte der Form-Schattierung (alle Werte dimensionslos, Ergebnis 0 = dunkel … 1 = hell). */
export interface LightOptions {
  /** Anteil nach oben weisender Flächen (Himmelsöffnung). */
  readonly up: number;
  /** Anteil zum Betrachter weisender Flächen. */
  readonly front: number;
  /** Stärke der Umgebungsverdeckung (Fugen, Kontaktstellen). */
  readonly ao: number;
  /** Suchradius der Umgebungsverdeckung in px. */
  readonly aoRadius: number;
  /** Verlauf über die ganze Form: oben hell, unten dunkel. */
  readonly vertical: number;
  /** Grundhelligkeit. */
  readonly bias: number;
  /** Höhenabfall am Rand (px), bestimmt, wie stark Randpixel nach außen kippen. */
  readonly edgeDrop: number;
}

export const DEFAULT_LIGHT: LightOptions = { up: 0.55, front: 0.15, ao: 0.9, aoRadius: 4, vertical: 0.25, bias: 0.5, edgeDrop: 2.5 };

/** Richtungen der Umgebungsverdeckung (8 Himmelsrichtungen). */
const AO_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.7071, 0.7071],
  [-0.7071, 0.7071],
  [0.7071, -0.7071],
  [-0.7071, -0.7071],
];

/**
 * Weiche Form-Schattierung eines Reliefs: Normale aus dem Höhenfeld (Randpixel kippen um `edgeDrop`
 * nach außen), Helligkeit aus Himmelsöffnung (−ny) und Frontanteil (nz) – seitliche Flächen bleiben
 * mittel statt dunkel (kein Pillow) –, minus Horizont-Verdeckung durch höhere Nachbarn, plus ein
 * Verlauf von oben nach unten. Liefert je Pixel 0…1 (außerhalb der Maske 0).
 */
export function shadeRelief(r: Relief, opts: Partial<LightOptions> = {}): Float32Array {
  const o = { ...DEFAULT_LIGHT, ...opts };
  const { w, h } = r;
  const out = new Float32Array(w * h);
  let top = h;
  let bottom = -1;
  r.mask.forEach((v, p) => {
    if (v === 0) return;
    const y = Math.floor(p / w);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  });
  const span = Math.max(1, bottom - top);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if ((r.mask[p] ?? 0) === 0) continue;
      const z = r.height[p] ?? 0;
      const drop = Math.max(0, z - o.edgeDrop);
      const hl = r.at(x - 1, y, drop);
      const hr = r.at(x + 1, y, drop);
      const hu = r.at(x, y - 1, drop);
      const hd = r.at(x, y + 1, drop);
      const nx = -(hr - hl) / 2;
      const ny = -(hd - hu) / 2;
      const len = Math.hypot(nx, ny, 1);
      const nyN = ny / len;
      const nzN = 1 / len;
      let v = o.bias + o.up * -nyN + o.front * (nzN - 0.7);
      // Horizont-Verdeckung: wie weit ragen Nachbarn über diesen Pixel?
      let occ = 0;
      for (const [dx, dy] of AO_DIRS) {
        let worst = 0;
        for (let s = 1; s <= o.aoRadius; s++) {
          const q = r.at(Math.round(x + dx * s), Math.round(y + dy * s), -1);
          if (q < 0) continue;
          worst = Math.max(worst, (q - z) / (s + 1));
        }
        occ += Math.min(1, worst);
      }
      v -= o.ao * (occ / AO_DIRS.length);
      v += o.vertical * (0.5 - (y - top) / span);
      out[p] = Math.max(0, Math.min(1, v));
    }
  }
  return out;
}

/** Quantisiert Werte 0…1 an aufsteigenden Schwellen in Stufen 0…n (−1 außerhalb der Maske). */
export function quantize(values: Float32Array, mask: Uint8Array, thresholds: readonly number[]): Int8Array {
  const out = new Int8Array(values.length).fill(-1);
  values.forEach((v, p) => {
    if ((mask[p] ?? 0) === 0) return;
    let s = 0;
    while (s < thresholds.length && v >= (thresholds[s] ?? 1)) s++;
    out[p] = s;
  });
  return out;
}

/** 8er-Nachbarschaft. */
const N8: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];
/** 4er-Nachbarschaft. */
const N4: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

/**
 * Glättet eine Silhouette: Pixel mit höchstens einem 4er-Nachbarn fallen weg (Stacheln), Lücken mit
 * mindestens drei 4er-Nachbarn werden gefüllt (Kerben). Wiederholt bis stabil (höchstens `passes`).
 */
export function smoothMask(mask: Uint8Array, w: number, h: number, passes = 4): void {
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    const src = Uint8Array.from(mask);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        let n = 0;
        for (const [dx, dy] of N4) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && (src[yy * w + xx] ?? 0) > 0) n++;
        }
        if ((src[p] ?? 0) > 0 && n <= 1) {
          mask[p] = 0;
          changed = true;
        } else if ((src[p] ?? 0) === 0 && n >= 3) {
          mask[p] = 1;
          changed = true;
        }
      }
    }
    if (!changed) return;
  }
}

/**
 * Löst Einzelpixel in einer Stufenkarte auf (docs/ART.md §2.2): ein Pixel ohne gleichstufigen
 * 8er-Nachbarn nimmt die häufigste Stufe seiner Nachbarn an (bei Gleichstand die nähere Stufe).
 * Dazu werden 2×2-Schachbretter auf die Mehrheit ihrer Umgebung gesetzt. `locked` (optional) schützt
 * gezielt gesetzte Pixel (Früchte, Glanzpunkte).
 */
export function despeckle(steps: Int8Array, w: number, h: number, passes = 3, locked?: Uint8Array): void {
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? -1 : (steps[y * w + x] ?? -1));
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const v = steps[p] ?? -1;
        if (v < 0 || (locked?.[p] ?? 0) > 0) continue;
        const counts = new Map<number, number>();
        let same = 0;
        for (const [dx, dy] of N8) {
          const n = at(x + dx, y + dy);
          if (n < 0) continue;
          if (n === v) same++;
          else counts.set(n, (counts.get(n) ?? 0) + 1);
        }
        if (same > 0 || counts.size === 0) continue;
        let best = v;
        let bestCount = -1;
        for (const [n, c] of counts) {
          if (c > bestCount || (c === bestCount && Math.abs(n - v) < Math.abs(best - v))) {
            best = n;
            bestCount = c;
          }
        }
        steps[p] = best;
        changed = true;
      }
    }
    // Schachbretter: ab/ba in einem 2×2-Block → Mehrheit der 12 umgebenden Pixel.
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const a = at(x, y);
        const b = at(x + 1, y);
        const c = at(x, y + 1);
        const d = at(x + 1, y + 1);
        if (a < 0 || b < 0 || c < 0 || d < 0 || a === b || a !== d || b !== c) continue;
        if ((locked?.[y * w + x] ?? 0) + (locked?.[y * w + x + 1] ?? 0) + (locked?.[(y + 1) * w + x] ?? 0) + (locked?.[(y + 1) * w + x + 1] ?? 0) > 0) continue;
        let ca = 0;
        let cb = 0;
        for (let yy = y - 1; yy <= y + 2; yy++) {
          for (let xx = x - 1; xx <= x + 2; xx++) {
            const n = at(xx, yy);
            if (n === a) ca++;
            else if (n === b) cb++;
          }
        }
        const win = ca >= cb ? a : b;
        steps[y * w + x] = win;
        steps[y * w + x + 1] = win;
        steps[(y + 1) * w + x] = win;
        steps[(y + 1) * w + x + 1] = win;
        changed = true;
      }
    }
    if (!changed) return;
  }
}

/** Außenkontur einer Maske: transparente Pixel mit deckendem 4er-Nachbarn. */
export function outlineOf(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((mask[y * w + x] ?? 0) > 0) continue;
      for (const [dx, dy] of N4) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && (mask[yy * w + xx] ?? 0) > 0) {
          out[y * w + x] = 1;
          break;
        }
      }
    }
  }
  return out;
}

/** Jitter-Raster: Punkte mit Abstand ≈ `spacing` in der Ellipse (cx, cy, rx, ry), zufällig versetzt. */
export function jitterGrid(rng: Rng, cx: number, cy: number, rx: number, ry: number, spacing: number, jitter = 0.45): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const rowH = spacing * 0.87;
  let row = 0;
  for (let y = cy - ry; y <= cy + ry; y += rowH, row++) {
    const offset = row % 2 === 0 ? 0 : spacing / 2;
    for (let x = cx - rx + offset; x <= cx + rx; x += spacing) {
      const jx = x + rng.float(-jitter, jitter) * spacing;
      const jy = y + rng.float(-jitter, jitter) * spacing;
      const dx = (jx - cx) / rx;
      const dy = (jy - cy) / ry;
      if (dx * dx + dy * dy <= 1) pts.push([jx, jy]);
    }
  }
  return pts;
}
