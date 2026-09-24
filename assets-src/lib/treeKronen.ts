/**
 * Sonderkronen des Baum-Generators (M2-20): Etagen der Nadelbäume, Palmwedel, Stelzwurzeln der
 * Mangrove und Behang der Weide. Alle Formen gehen durch dasselbe Relief (Himmelsöffnung +
 * Verdeckung, `foliageRelief.ts`), damit Licht und Schatten zu den Laubkronen passen.
 */
import type { Rng } from '../../src/engine/rng';
import type { Krone } from './foliage';
import { Relief, despeckle, quantize, shadeRelief, smoothMask, type LightOptions } from './foliageRelief';
import { KRONE_FLAGS, type Ast, type Bild, type RindenFarben, zeichneAeste } from './tree';

// ---------------------------------------------------------------------------------------------
// Nadelbaum-Etagen (Tanne)
// ---------------------------------------------------------------------------------------------

export interface EtagenParameter {
  /** Stammachse (x). */
  readonly x: number;
  /** Oberste Zeile der Spitze. */
  readonly spitze: number;
  /** Unterste Zeile der untersten Etage (ohne hängende Nadelspitzen). */
  readonly unten: number;
  /** Halbe Breite der untersten Etage. */
  readonly breite: number;
  readonly etagen: number;
  /** Tiefe der hängenden Nadelspitzen (px). */
  readonly zacken?: number;
  /** Absinken der Etagenränder nach außen (px). */
  readonly haengen?: number;
  readonly licht?: Partial<LightOptions>;
  readonly schwellen?: readonly number[];
}

/**
 * Tannenkrone aus übereinander hängenden Etagen: jede Etage wird nach unten breiter, ihr Rand hängt
 * außen ab und endet in Nadelspitzen (Zacken im wechselnden Abstand). Die obere Etage liegt mit ihrem
 * Rand vor der unteren – darunter entsteht der Kontaktschatten, der die Etagen trennt.
 */
export function etagenKrone(rng: Rng, w: number, h: number, p: EtagenParameter): Krone {
  const relief = new Relief(w, h);
  const zacken = p.zacken ?? 2;
  const haengen = p.haengen ?? 3;
  const span = p.unten - p.spitze;
  for (let i = 0; i < p.etagen; i++) {
    const t0 = i / p.etagen;
    const t1 = (i + 1) / p.etagen;
    const top = p.spitze + span * Math.pow(t0, 1.1) - (i === 0 ? 0 : span / p.etagen) * 0.55;
    const bottom = p.spitze + span * Math.pow(t1, 1.1);
    const hwTop = i === 0 ? 0.5 : p.breite * Math.pow(t0, 0.9) * 0.45;
    const hwBottom = p.breite * Math.pow(t1, 0.9);
    const base = (p.etagen - i) * 2.2;
    // Zackenmuster der Unterkante: Abstände 3–4 px, Tiefe wechselnd.
    const zackenAt = new Map<number, number>();
    let zx = Math.round(p.x - hwBottom - 1) + rng.int(0, 3);
    while (zx <= p.x + hwBottom + 1) {
      const depth = zacken * rng.float(0.6, 1.2);
      zackenAt.set(zx, depth);
      zackenAt.set(zx + 1, depth * 0.5);
      zx += rng.int(3, 5);
    }
    for (let y = Math.floor(top); y <= Math.ceil(bottom + haengen + zacken); y++) {
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - p.x;
        const v = Math.max(0, Math.min(1, (y + 0.5 - top) / Math.max(1, bottom - top)));
        const hw = hwTop + (hwBottom - hwTop) * Math.pow(v, 0.8);
        const u = Math.abs(dx) / Math.max(0.5, hwBottom);
        const rand = bottom + haengen * u * u + (zackenAt.get(x) ?? 0);
        if (y + 0.5 < top || y + 0.5 > rand || Math.abs(dx) > hw + (y > bottom ? 0 : 0.5)) continue;
        const across = Math.sqrt(Math.max(0, 1 - (dx / Math.max(1, hw + 1)) ** 2));
        const along = Math.sin(Math.PI * Math.min(1, (y + 0.5 - top) / Math.max(1, rand - top)) * 0.85 + 0.25);
        relief.put(x, y, base + 3.5 * across * along, i);
      }
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 2 || y < 1 || x >= w - 2) relief.cut(x, y);
  smoothMask(relief.mask, w, h, 2);
  const values = shadeRelief(relief, { bias: 0.58, up: 0.8, ao: 1.6, aoRadius: 5, vertical: 0.15, ...p.licht });
  const stufen = quantize(values, relief.mask, p.schwellen ?? [0.3, 0.45, 0.62, 0.8]);
  despeckle(stufen, w, h);
  return { relief, stufen, masse: relief.owner };
}

// ---------------------------------------------------------------------------------------------
// Palmwedel
// ---------------------------------------------------------------------------------------------

export interface Wedel {
  /** Richtung (Bogenmaß, 0 = rechts, −π/2 = oben). */
  readonly winkel: number;
  readonly laenge: number;
  /** Durchhängen (px am Ende). */
  readonly haengen: number;
  /** Größte Breite der Fiederung unter der Mittelrippe (px). */
  readonly breite: number;
}

export interface PalmParameter {
  readonly x: number;
  readonly y: number;
  readonly wedel: readonly Wedel[];
  /** Farben: Kontur, dann 5 Stufen dunkel → hell. */
  readonly farben: { readonly kontur: string; readonly stufen: readonly [string, string, string, string, string] };
}

/**
 * Palmkrone: Wedel als gebogene Mittelrippe mit hängender Fiederung. Oberhalb der Rippe liegt ein
 * schmaler, heller Saum (Himmelsseite), darunter die Fiedern, deren Spitzen im Wechsel 2–3 px
 * auseinanderstehen (gesägte Unterkante). Hintere, aufrechte Wedel zuerst, vordere hängende zuletzt.
 */
export function palmKrone(b: Bild, rng: Rng, p: PalmParameter): Uint8Array {
  const all = new Uint8Array(b.w * b.h);
  const order = [...p.wedel].sort((a, c) => Math.sin(a.winkel) - Math.sin(c.winkel));
  for (const wd of order) {
    const mask = new Uint8Array(b.w * b.h);
    const stufe = new Int8Array(b.w * b.h).fill(-1);
    const steps = Math.ceil(wd.laenge * 2);
    const zahn = new Array<number>(steps + 1);
    let phase = 0;
    let period = rng.int(2, 4);
    for (let i = 0; i <= steps; i++) {
      zahn[i] = phase < period / 2 ? 1 : 0.35;
      phase++;
      if (phase >= period) {
        phase = 0;
        period = rng.int(2, 4);
      }
    }
    const aufrecht = Math.max(0, -Math.sin(wd.winkel));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const sx = p.x + Math.cos(wd.winkel) * wd.laenge * t;
      const sy = p.y + Math.sin(wd.winkel) * wd.laenge * t + wd.haengen * t * t;
      const breite = wd.breite * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.7) * (zahn[i] ?? 1);
      const saum = Math.max(0.6, breite * 0.3);
      // Normale der Rippe (nach „unten“ in Bildrichtung gedreht).
      const dx = Math.cos(wd.winkel);
      const dy = Math.sin(wd.winkel) + (2 * wd.haengen * t) / Math.max(1, wd.laenge);
      const len = Math.hypot(dx, dy);
      let nx = -dy / len;
      let ny = dx / len;
      if (ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      for (let o = -saum; o <= breite; o += 0.5) {
        const x = Math.round(sx + nx * o);
        const y = Math.round(sy + ny * o);
        if (!b.inside(x, y) || x < 1 || x >= b.w - 1 || y < 1) continue;
        const q = y * b.w + x;
        mask[q] = 1;
        // Stufe: Saum oben hell, zur Fiederspitze dunkler; aufrechte (hintere) Wedel dunkler.
        const rel = o <= 0 ? 0 : o / Math.max(1, breite);
        let s = o <= 0 ? 4 : rel < 0.35 ? 3 : rel < 0.75 ? 2 : 1;
        if (aufrecht > 0.5 && s > 1) s -= 1;
        if (t > 0.85 && s > 2) s = 2;
        stufe[q] = Math.max(stufe[q] ?? -1, s);
      }
    }
    // Wedel über die bisherigen legen: Kontur zuerst, dann die Stufen.
    const kontur = new Uint8Array(b.w * b.h);
    mask.forEach((v, q) => {
      if (v === 0) return;
      const x = q % b.w;
      const y = Math.floor(q / b.w);
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const r = (y + oy) * b.w + x + ox;
        if (b.inside(x + ox, y + oy) && (mask[r] ?? 0) === 0) kontur[r] = 1;
      }
    });
    kontur.forEach((v, q) => {
      if (v > 0 && x0ok(b, q)) b.set(q % b.w, Math.floor(q / b.w), p.farben.kontur, KRONE_FLAGS, 10);
    });
    despeckle(stufe, b.w, b.h, 2);
    stufe.forEach((s, q) => {
      if (s < 0) return;
      b.set(q % b.w, Math.floor(q / b.w), p.farben.stufen[s] ?? p.farben.stufen[2], KRONE_FLAGS, 12);
      all[q] = 1;
    });
  }
  return all;
}

function x0ok(b: Bild, q: number): boolean {
  const x = q % b.w;
  const y = Math.floor(q / b.w);
  return x >= 1 && x < b.w - 1 && y >= 1;
}

// ---------------------------------------------------------------------------------------------
// Stelzwurzeln (Mangrove)
// ---------------------------------------------------------------------------------------------

/** Bogen als Aststücke: quadratische Bézierkurve von a über c nach e, Dicke d0 → d1. */
export function bogen(a: readonly [number, number], c: readonly [number, number], e: readonly [number, number], d0: number, d1: number, stuecke = 8): Ast[] {
  const out: Ast[] = [];
  let px = a[0];
  let py = a[1];
  for (let i = 1; i <= stuecke; i++) {
    const t = i / stuecke;
    const x = (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * e[0];
    const y = (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * e[1];
    const d = d0 + (d1 - d0) * t;
    out.push({ x0: px, y0: py, x1: x, y1: y, d0: d, d1: d });
    px = x;
    py = y;
  }
  return out;
}

/**
 * Stelzwurzeln: vom Stammfuß (x, y) wölben sich Wurzeln bogenförmig nach außen und unten zum Boden
 * (`boden`); die Enden bekommen Bodenkontakt. Hintere Wurzeln (kleines |Versatz|) zuerst.
 */
export function stelzwurzeln(b: Bild, x: number, y: number, boden: number, versaetze: readonly number[], f: RindenFarben): void {
  const sorted = [...versaetze].sort((a, c) => Math.abs(a) - Math.abs(c));
  for (const v of sorted) {
    const start: [number, number] = [x + Math.sign(v) * 1.5, y];
    const ende: [number, number] = [x + v, boden];
    const kontroll: [number, number] = [x + v * 0.75, y - 3];
    zeichneAeste(b, bogen(start, kontroll, ende, 3, 2.2), f);
    b.set(Math.round(ende[0]), boden + 1, 'nacht.1');
    b.set(Math.round(ende[0]) + (v > 0 ? 1 : -1), boden + 1, 'nacht.1');
  }
}

// ---------------------------------------------------------------------------------------------
// Behang (Weide)
// ---------------------------------------------------------------------------------------------

export interface Straehne {
  readonly x: number;
  /** Oberste Zeile (unter der Kronenkante). */
  readonly y: number;
  readonly laenge: number;
}

/**
 * Hängende Laubsträhnen: je Strähne zwei Pixel breit, links die Lichtseite, rechts die Schattenseite,
 * oben im Schatten der Krone, zur Spitze hin heller und mit einzelnen Blattspitzen, die wechselseitig
 * 1 px abstehen; Kontur in der dunkelsten Laubstufe. `farben`: Kontur + 5 Stufen dunkel → hell.
 */
export function behang(b: Bild, rng: Rng, straehnen: readonly Straehne[], farben: { readonly kontur: string; readonly stufen: readonly [string, string, string, string, string] }): void {
  const mask = new Uint8Array(b.w * b.h);
  const farbe = new Map<number, string>();
  for (const s of straehnen) {
    let seite = rng.bool() ? 1 : -1;
    let naechste = rng.int(2, 4);
    for (let i = 0; i < s.laenge; i++) {
      const y = s.y + i;
      const t = i / Math.max(1, s.laenge - 1);
      // Im Schatten der Krone dunkel, dann Lichtseite links heller als rechts.
      const links = t < 0.15 ? farben.stufen[1] : t < 0.8 ? farben.stufen[3] : farben.stufen[2];
      const rechts = t < 0.15 ? farben.stufen[0] : t < 0.8 ? farben.stufen[2] : farben.stufen[1];
      for (const [dx, c] of [
        [0, links],
        [1, rechts],
      ] as const) {
        const q = y * b.w + s.x + dx;
        if (!b.inside(s.x + dx, y)) continue;
        mask[q] = 1;
        farbe.set(q, c);
      }
      if (i === naechste && i < s.laenge - 2) {
        const bx = seite < 0 ? s.x - 1 : s.x + 2;
        const q = y * b.w + bx;
        if (b.inside(bx, y)) {
          mask[q] = 1;
          farbe.set(q, seite < 0 ? links : rechts);
          const q2 = (y + 1) * b.w + bx;
          mask[q2] = 1;
          farbe.set(q2, seite < 0 ? links : rechts);
        }
        seite = -seite;
        naechste += rng.int(3, 5);
      }
    }
  }
  mask.forEach((v, q) => {
    if (v === 0) return;
    const x = q % b.w;
    const y = Math.floor(q / b.w);
    for (const [ox, oy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
    ] as const) {
      const r = (y + oy) * b.w + x + ox;
      if (b.inside(x + ox, y + oy) && (mask[r] ?? 0) === 0 && x + ox >= 1 && x + ox < b.w - 1) b.set(x + ox, y + oy, farben.kontur, KRONE_FLAGS, 8);
    }
  });
  farbe.forEach((c, q) => b.set(q % b.w, Math.floor(q / b.w), c, KRONE_FLAGS, 9));
}
