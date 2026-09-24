/**
 * Kleinformen für Pflanzen und Streudeko (M2-19, M2-21): Halmbüschel (Gras, Schilf, Strandhafer),
 * Kiesel und flache Polster (Moos, Flechten, Asche). Alles zeichnet in ein `Bild` (tree.ts) mit weicher
 * Form-Schattierung nach Himmelsöffnung (oben hell, unten dunkel) und ohne verwaiste Einzelpixel:
 * Halmspitzen sind zwei Pixel lang, Kiesel haben eine geschlossene Kontur.
 */
import type { Rng } from '../../src/engine/rng';
import { outlineOf } from './foliageRelief';
import type { Bild } from './tree';

/** Ein Halm: Versatz am Fuß, Höhe, Neigung der Spitze (px), Krümmung (0 = gerade). */
export interface Halm {
  readonly dx: number;
  readonly hoehe: number;
  readonly neigung: number;
  readonly kruemmung?: number;
}

/** Halmfarben: Fuß (dunkel), Mitte, Licht, Spitze. */
export type HalmFarben = readonly [string, string, string, string];

/**
 * Halmbüschel: jeder Halm als 1-px-Linie vom Fuß zur Spitze, die sich zur Spitze hin neigt (quadratisch);
 * unten dunkel, oben hell, die obersten zwei Pixel in der Spitzenfarbe. Hohe Halme zuerst (hinten).
 */
export function halme(b: Bild, x: number, fuss: number, liste: readonly Halm[], f: HalmFarben, material = 0, kontur?: string): void {
  const vorher = kontur === undefined ? null : Uint8Array.from(b.index);
  const sortiert = [...liste].sort((a, c) => c.hoehe - a.hoehe);
  for (const h of sortiert) {
    let prevX = Math.round(x + h.dx);
    for (let i = 0; i <= h.hoehe; i++) {
      const t = i / Math.max(1, h.hoehe);
      const bend = h.kruemmung ?? 1;
      const px = Math.round(x + h.dx + h.neigung * Math.pow(t, 1 + bend));
      const py = fuss - i;
      const c = i >= h.hoehe - 1 ? f[3] : t < 0.3 ? f[0] : t < 0.7 ? f[1] : f[2];
      // Lücken bei schrägen Stücken schließen (4er-Zusammenhang, keine Treppenlücken).
      if (Math.abs(px - prevX) > 1) b.set(Math.round((px + prevX) / 2), py, c, material, 1 + i * 0.3);
      b.set(px, py, c, material, 1 + i * 0.3);
      prevX = px;
    }
  }
  if (kontur === undefined || vorher === null) return;
  // Kontur um die neuen Halme: trennt das Büschel vom gleichfarbigen Boden.
  const neu = Uint8Array.from(b.index, (v, q) => (v !== 0 && v !== vorher[q] ? 1 : 0));
  outlineOf(neu, b.w, b.h).forEach((v, q) => {
    if (v > 0 && (b.index[q] ?? 0) === 0) b.set(q % b.w, Math.floor(q / b.w), kontur, material, 0.5);
  });
}

/** Kiesel: Ellipse mit Kontur; oben hell, unten dunkel, Bodenkontakt darunter. `f` = [Kontur, dunkel, mitte, hell]. */
export function kiesel(b: Bild, cx: number, cy: number, rx: number, ry: number, f: readonly [string, string, string, string], kontakt = 'nacht.1'): void {
  const mask = new Uint8Array(b.w * b.h);
  let top = b.h;
  let bottom = -1;
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      if (!b.inside(x, y)) continue;
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      mask[y * b.w + x] = 1;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const span = Math.max(1, bottom - top);
  mask.forEach((v, q) => {
    if (v === 0) return;
    const y = Math.floor(q / b.w);
    const t = (y - top) / span;
    b.set(q % b.w, y, t < 0.34 ? f[3] : t < 0.75 ? f[2] : f[1], 0, 2 + (1 - t) * 2);
  });
  outlineOf(mask, b.w, b.h).forEach((v, q) => {
    if (v === 0 || (b.index[q] ?? 0) !== 0) return;
    const y = Math.floor(q / b.w);
    b.set(q % b.w, y, y > bottom ? kontakt : f[0], 0, 0);
  });
}

/**
 * Flaches Polster (Moos, Flechten, Asche, Schwefel): verformte Ellipse; Rand dunkel nur unten
 * (Kontaktschatten), oben Lichtflecken als kleine Kappen. `f` = [dunkel, mitte, hell].
 */
export function polster(b: Bild, rng: Rng, cx: number, cy: number, rx: number, ry: number, f: readonly [string, string, string], material = 0): Uint8Array {
  const mask = new Uint8Array(b.w * b.h);
  const knoten = Array.from({ length: 8 }, () => rng.float(0.75, 1.15));
  for (let y = Math.floor(cy - ry - 2); y <= Math.ceil(cy + ry + 2); y++) {
    for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
      if (!b.inside(x, y)) continue;
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const a = ((Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
      const i0 = Math.floor(a * 8) % 8;
      const t = a * 8 - Math.floor(a * 8);
      const r = (knoten[i0] ?? 1) * (1 - t) + (knoten[(i0 + 1) % 8] ?? 1) * t;
      if (dx * dx + dy * dy <= r * r) mask[y * b.w + x] = 1;
    }
  }
  mask.forEach((v, q) => {
    if (v === 0) return;
    const x = q % b.w;
    const y = Math.floor(q / b.w);
    const unten = (mask[q + b.w] ?? 0) === 0;
    const oben = (mask[q - b.w] ?? 0) === 0;
    b.set(x, y, unten ? f[0] : oben ? f[2] : f[1], material, 1);
  });
  // Lichtkappen im Inneren: kurze helle Striche (2–3 px) über einem dunklen Pixel darunter.
  const innen: number[] = [];
  mask.forEach((v, q) => {
    if (v > 0 && (mask[q - b.w] ?? 0) > 0 && (mask[q + 2 * b.w] ?? 0) > 0 && (mask[q + 2] ?? 0) > 0 && (mask[q - 1] ?? 0) > 0) innen.push(q);
  });
  rng.shuffle(innen);
  for (const q of innen.slice(0, Math.max(1, Math.round(innen.length / 14)))) {
    const x = q % b.w;
    const y = Math.floor(q / b.w);
    const len = rng.int(2, 4);
    for (let i = 0; i < len; i++) if ((mask[q + i] ?? 0) > 0) b.set(x + i, y, f[2], material, 1.5);
    for (let i = 0; i < len; i++) if ((mask[q + i + b.w] ?? 0) > 0 && (mask[q + i + 2 * b.w] ?? 0) > 0) b.set(x + i, y + 1, f[0], material, 1);
  }
  return mask;
}

/** Pilzfarben: Kontur, Hut dunkel/mitte/hell, Stiel dunkel/hell. */
export interface PilzFarben {
  readonly kontur: string;
  readonly hut: readonly [string, string, string];
  readonly stiel: readonly [string, string];
}

/**
 * Pilz: Stiel (1–2 px) vom Fuß nach oben, darauf ein Hut als halbe Ellipse – oben hell, die Unterkante
 * (Lamellen im Schatten) dunkel; Kontur außen, Bodenkontakt unter dem Stiel.
 */
export function pilz(b: Bild, x: number, fuss: number, stielH: number, hutB: number, hutH: number, f: PilzFarben, material = 0): void {
  const mask = new Uint8Array(b.w * b.h);
  const farbe = new Map<number, string>();
  const sw = hutB >= 6 ? 2 : 1;
  const sx = Math.round(x - sw / 2);
  for (let i = 0; i < stielH; i++) {
    for (let k = 0; k < sw; k++) {
      const q = (fuss - i) * b.w + sx + k;
      mask[q] = 1;
      farbe.set(q, k === 0 ? f.stiel[1] : f.stiel[0]);
    }
  }
  const capY = fuss - stielH + 0.5;
  const rx = hutB / 2;
  for (let y = Math.floor(capY - hutH); y <= Math.floor(capY); y++) {
    for (let xx = Math.floor(x - rx - 1); xx <= Math.ceil(x + rx); xx++) {
      const dx = (xx + 0.5 - x) / rx;
      const dy = (y + 0.5 - capY) / hutH;
      if (dy > 0.2 || dx * dx + dy * dy > 1) continue;
      const q = y * b.w + xx;
      if (!b.inside(xx, y)) continue;
      mask[q] = 1;
      const t = (y + 0.5 - (capY - hutH)) / hutH;
      farbe.set(q, t > 0.85 ? f.hut[0] : t < 0.45 ? f.hut[2] : f.hut[1]);
    }
  }
  outlineOf(mask, b.w, b.h).forEach((v, q) => {
    if (v === 0) return;
    const y = Math.floor(q / b.w);
    b.set(q % b.w, y, y > fuss ? 'nacht.1' : f.kontur, material, 1);
  });
  farbe.forEach((c, q) => b.set(q % b.w, Math.floor(q / b.w), c, material, 2 + (fuss - Math.floor(q / b.w)) * 0.4));
}
