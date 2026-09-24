/**
 * Gesteins-Generator (M2-21, docs/ART.md §2.7 „Felsen“, §10 „Felsen“): Felsen, Kristalle und
 * Erzknoten aus einem Relief. Ein Fels ist ein Block mit Oberseite (hell, sieht den Himmel), Front
 * (mittel) und Fuß (dunkel, Umgebungsverdeckung); Kontur in der dunkelsten Steinstufe, Bodenkontakt in
 * `nacht.1` an den Fußecken. Formen: `rund` (Kuppen) oder `kantig` (Facetten mit geraden Kanten).
 * Dazu Deckschichten auf der Oberseite (Moos, Schnee, Asche, Sand), Risse, Schichtung, Einschlüsse
 * (Erz, Kristall) und leuchtende Adern.
 *
 * Gezeichnet wird in Grünhain-Rampen (`stein`, `gras`, `erde`); die Biomzeile `biom_<id>` tönt sie
 * in die Farbidentität des Bioms (docs/ART.md §5). Was seine Farbe in jedem Biom behalten soll (Erz,
 * Kristall, Glut, Schnee), steht in Rampen, die keine Biomzeile ändert (`sand`, `feuer`, `wasser`,
 * `eis`, `verderb`, `haut`, `nacht`).
 */
import type { Rng } from '../../src/engine/rng';
import { Relief, despeckle, outlineOf, quantize, shadeRelief, smoothMask, type LightOptions } from './foliageRelief';
import { type Bild } from './tree';
import { MATERIAL_BITS, spriteFromPixels, type Sprite } from './sprite';
import { paletteIndex } from '../palette';

/** Ein Block des Felsens (Ellipse in Zellkoordinaten). */
export interface Block {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  /** Höhe über dem Boden (px): größere Blöcke ragen höher auf. */
  readonly hoch: number;
}

/** Steinfarben: Kontur, dann Stufen dunkel → hell (4–5 Stufen). */
export interface SteinFarben {
  readonly kontur: string;
  readonly stufen: readonly string[];
}

export const STEIN: SteinFarben = { kontur: 'stein.0', stufen: ['stein.1', 'stein.2', 'stein.3', 'stein.4', 'stein.5'] };
/** Sparsamer Stein (4 Farben) für Knoten mit vielen Einschlussfarben (Edelstein, Prismen). */
export const STEIN_SCHLICHT: SteinFarben = { kontur: 'stein.0', stufen: ['stein.1', 'stein.2', 'stein.3'] };

export interface FelsParameter {
  readonly w: number;
  readonly h: number;
  readonly bloecke: readonly Block[];
  readonly form: 'rund' | 'kantig';
  readonly farben?: SteinFarben;
  readonly licht?: Partial<LightOptions>;
  readonly schwellen?: readonly number[];
}

/** Ein gezeichneter Fels: Relief, Stufen, Maske (für Deckschichten und Einschlüsse). */
export interface Fels {
  readonly relief: Relief;
  readonly stufen: Int8Array;
  /** Nach oben weisende Pixel (Oberseite): 1. */
  readonly oben: Uint8Array;
}

/**
 * Felsrelief: jeder Block ist eine Kuppe (`rund`) oder eine Facettenpyramide (`kantig`) auf der Höhe
 * `hoch`; vordere (tiefere) Blöcke liegen vor hinteren. Die Oberseite ist abgeflacht (Plateau), damit
 * sie als Fläche liest und nicht als Kugel.
 */
export function fels(rng: Rng, p: FelsParameter): Fels {
  const relief = new Relief(p.w, p.h);
  const top = Math.min(...p.bloecke.map((b) => b.y - b.ry));
  p.bloecke.forEach((b, i) => {
    const base = 0.5 * (b.y - top);
    if (p.form === 'kantig') {
      // Abgestumpfte Pyramide: Facetten mit leicht versetzten Graten, oben ein Plateau.
      const kx = rng.float(-0.15, 0.15) * b.rx;
      for (let y = Math.floor(b.y - b.ry - 1); y <= Math.ceil(b.y + b.ry + 1); y++) {
        for (let x = Math.floor(b.x - b.rx - 1); x <= Math.ceil(b.x + b.rx + 1); x++) {
          const dx = Math.abs(x + 0.5 - b.x - kx) / b.rx;
          const dy = (y + 0.5 - b.y) / b.ry;
          const q = Math.max(dx * 0.85 + Math.abs(dy) * 0.45, Math.abs(dy), dx);
          if (q > 1) continue;
          relief.put(x, y, base + b.hoch * Math.min(1, (1 - q) * 1.8), i);
        }
      }
    } else relief.dome(b.x, b.y, b.rx, b.ry, b.hoch, base, i, 0.6);
  });
  // Buckel: flache Beulen auf der Oberfläche brechen die Stufenübergänge (kein Banding, docs/ART.md §2.3).
  p.bloecke.forEach((b, i) => {
    const n = Math.max(2, Math.round((b.rx * b.ry) / 10));
    for (let k = 0; k < n; k++) {
      const a = rng.float(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * 0.75;
      const x = b.x + Math.cos(a) * r * b.rx;
      const y = b.y + Math.sin(a) * r * b.ry;
      const q = Math.round(y) * p.w + Math.round(x);
      if ((relief.mask[q] ?? 0) === 0 || relief.owner[q] !== i) continue;
      const rr = rng.float(1.8, Math.max(2, Math.min(b.rx, b.ry) * 0.45));
      relief.dome(x, y, rr * 1.3, rr, Math.max(0.8, b.hoch * 0.12), (relief.height[q] ?? 0) - rr * 0.1, i);
    }
  });
  // Standfläche: der Fels sitzt flach auf dem Boden – was unter der Bodenlinie läge, entfällt.
  const boden = Math.max(...p.bloecke.map((b) => b.y + b.ry)) - 1.5;
  for (let y = Math.ceil(boden); y < p.h; y++) for (let x = 0; x < p.w; x++) relief.cut(x, y);
  // Rand: Kontur und 1 px Luft (Interaktions-Outline) bleiben in der Zelle; unten die Fußzeile.
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (x < 2 || y < 2 || x >= p.w - 2 || y >= p.h - 2) relief.cut(x, y);
  smoothMask(relief.mask, p.w, p.h, 2);
  const values = shadeRelief(relief, { bias: 0.55, up: 0.75, ao: 1.2, aoRadius: 4, vertical: 0.35, edgeDrop: 2, ...p.licht });
  const stufen = quantize(values, relief.mask, p.schwellen ?? [0.3, 0.45, 0.62, 0.78]);
  despeckle(stufen, p.w, p.h);
  // Oberseite: helle Pixel im oberen Teil ihrer Spalte (Plateau, sieht den Himmel).
  const oben = new Uint8Array(p.w * p.h);
  for (let x = 0; x < p.w; x++) {
    let y0 = -1;
    let y1 = -1;
    for (let y = 0; y < p.h; y++) {
      if ((relief.mask[y * p.w + x] ?? 0) === 0) continue;
      if (y0 < 0) y0 = y;
      y1 = y;
    }
    if (y0 < 0) continue;
    const grenze = y0 + Math.max(1, Math.round((y1 - y0 + 1) * 0.45));
    for (let y = y0; y < grenze; y++) {
      const q = y * p.w + x;
      if ((relief.mask[q] ?? 0) > 0 && (stufen[q] ?? 0) >= 2) oben[q] = 1;
    }
  }
  return { relief, stufen, oben };
}

/** Malt den Fels: Stufen → Farben, Kontur, Bodenkontakt `nacht.1` an den Fußecken. Höhe aus dem Relief. */
export function maleFels(b: Bild, f: Fels, farben: SteinFarben = STEIN, kontakt = true): void {
  const { w, h } = b;
  const n = farben.stufen.length;
  f.stufen.forEach((s, q) => {
    if (s < 0) return;
    const i = Math.min(n - 1, Math.round((s * (n - 1)) / 4));
    b.set(q % w, Math.floor(q / w), farben.stufen[i] ?? farben.stufen[0] ?? farben.kontur, 0, Math.min(16, f.relief.height[q] ?? 0));
  });
  const kontur = outlineOf(f.relief.mask, w, h);
  let unten = 0;
  f.relief.mask.forEach((v, q) => {
    if (v > 0) unten = Math.max(unten, Math.floor(q / w));
  });
  kontur.forEach((v, q) => {
    if (v === 0) return;
    b.set(q % w, Math.floor(q / w), farben.kontur, 0, 0);
  });
  if (!kontakt) return;
  // Bodenkontakt: die äußeren zwei Pixel der untersten Konturzeile an jeder Fußecke in `nacht.1`
  // (zwei nebeneinander, damit sie als Cluster stehen, docs/ART.md §2.4).
  const fuss = unten + 1;
  const xs = [...Array(w).keys()].filter((x) => kontur[fuss * w + x] === 1);
  if (xs.length < 4) return;
  const links = xs[0] ?? 0;
  const rechts = xs[xs.length - 1] ?? 0;
  for (const x of [links, links + 1, rechts - 1, rechts]) if (kontur[fuss * w + x] === 1) b.set(x, fuss, 'nacht.1', 0, 0);
}

/**
 * Deckschicht auf der Oberseite (Moos, Schnee, Asche, Salz): `flecken` Polster um zufällige Punkte der
 * Oberseite, Radius `radius` px; die Unterkante jedes Polsters liegt im Schatten (`farben[0]`), der Rest
 * im Licht (`farben[1]`). `flecken` = 0 bedeckt die ganze Oberseite (Schneekappe).
 */
export function deckschicht(b: Bild, f: Fels, farben: readonly [string, string], flecken: number, radius: number, rng: Rng, material = 0): Uint8Array {
  const { w } = b;
  const used = new Uint8Array(b.w * b.h);
  const kandidaten: Array<[number, number]> = [];
  f.oben.forEach((v, q) => {
    if (v > 0) kandidaten.push([q % w, Math.floor(q / w)]);
  });
  if (kandidaten.length === 0) return used;
  const zentren: Array<[number, number, number]> = [];
  if (flecken > 0) {
    rng.shuffle(kandidaten);
    for (const k of kandidaten) {
      if (zentren.length >= flecken) break;
      if (zentren.every(([x, y]) => Math.hypot(x - k[0], y - k[1]) > radius)) zentren.push([k[0], k[1], radius * rng.float(0.7, 1.2)]);
    }
  }
  f.oben.forEach((v, q) => {
    if (v === 0) return;
    const x = q % w;
    const y = Math.floor(q / w);
    if (flecken > 0 && !zentren.some(([cx, cy, r]) => Math.hypot((x - cx) * 0.8, y - cy) <= r)) return;
    used[q] = 1;
  });
  used.forEach((v, q) => {
    if (v === 0) return;
    const x = q % w;
    const y = Math.floor(q / w);
    const unterkante = (used[q + w] ?? 0) === 0 && (f.relief.mask[q + w] ?? 0) > 0;
    b.set(x, y, unterkante ? farben[0] : farben[1], material, (f.relief.height[q] ?? 0) + 1);
  });
  return used;
}

/** Riss: gezackte Linie von (x0, y0) nach unten, 1 px, in `farbe`. */
export function riss(b: Bild, f: Fels, rng: Rng, x0: number, y0: number, laenge: number, farbe: string): void {
  let x = x0;
  for (let i = 0; i < laenge; i++) {
    const y = y0 + i;
    if ((f.relief.mask[y * b.w + x] ?? 0) === 0) break;
    b.set(x, y, farbe, 0, 1);
    if (i % 2 === 1) x += rng.int(-1, 2);
  }
}

/** Standardmeta eines Felsens: Anker Mitte der Standfläche, Hitbox und Occluder aus der Maske. */
export function felsSprite(id: string, group: string, frames: readonly Bild[], opts: { einzelpixel?: string } = {}): Sprite {
  const b = frames[0];
  if (b === undefined) throw new Error(`${id}: kein Frame`);
  let x0 = b.w;
  let x1 = -1;
  let y1 = -1;
  let y0 = b.h;
  b.index.forEach((v, q) => {
    if (v === 0) return;
    const x = q % b.w;
    const y = Math.floor(q / b.w);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  });
  const cx = (x0 + x1 + 1) / 2;
  const fussH = Math.max(2, Math.round((y1 - y0 + 1) * 0.4));
  return spriteFromPixels(
    {
      id,
      group,
      size: [b.w, b.h],
      anchor: [Math.floor(cx), y1],
      hoehe: 'block',
      hitbox: [x0, Math.max(0, y1 - fussH), Math.max(1, x1 - x0 + 1), Math.min(fussH + 1, b.h - Math.max(0, y1 - fussH))],
      occluder: { kind: 'ellipse', x: cx, y: y1 - fussH / 2, rx: Math.max(1, (x1 - x0 + 1) / 2 - 1), ry: Math.max(1, fussH / 2) },
      ...(opts.einzelpixel !== undefined ? { einzelpixel: opts.einzelpixel } : {}),
    },
    frames.map((f) => f.frame()),
  );
}

/** Materialflag Eis/Kristall (Glanz) für Kristall- und Eispixel. */
export const GLANZ = MATERIAL_BITS.eis;
/** Materialflag Metall für Erzpixel. */
export const METALL = MATERIAL_BITS.metall;

/** Farben eines Kristallprismas: Kontur, Schattenfacette, Mitte, Lichtfacette, Grat/Spitze. */
export interface PrismaFarben {
  readonly kontur: string;
  readonly dunkel: string;
  readonly mitte: string;
  readonly licht: string;
  readonly kern: string;
}

/**
 * Kristallprisma: sechskantiger Stab mit Spitze, entlang der Achse von (x, fuss) um `neigung` (Bogenmaß,
 * 0 = senkrecht) geneigt. Linke Facette hell, rechte dunkel, der Grat dazwischen am hellsten (Kern),
 * die Spitze läuft über 1–2 Zeilen zu. Kontur außen, Glanz (Materialflag Eis) auf allen Pixeln.
 * Liefert die Maske des Prismas.
 */
export function prisma(b: Bild, x: number, fuss: number, hoehe: number, breite: number, neigung: number, f: PrismaFarben, material = GLANZ, basisHoehe = -1): Uint8Array {
  const mask = new Uint8Array(b.w * b.h);
  const dx = Math.sin(neigung);
  const dy = -Math.cos(neigung);
  const spitze = Math.max(1.5, breite * 0.9);
  const pixel = new Map<number, { c: string; z: number }>();
  // Fußhöhe: was unter dem Fuß schon liegt (Sockel, Fels) + 1, damit das Prisma aus dem Stein ragt.
  const fq = Math.round(fuss) * b.w + Math.round(x);
  const z0 = basisHoehe >= 0 ? basisHoehe : Math.max(3, (b.hoehe[fq] ?? 0) + 1);
  for (let yy = 0; yy < b.h; yy++) {
    for (let xx = 0; xx < b.w; xx++) {
      const px = xx + 0.5 - x;
      const py = yy + 0.5 - fuss;
      const t = px * dx + py * dy;
      const o = -px * dy + py * dx;
      if (t < 0 || t > hoehe) continue;
      const halb = t > hoehe - spitze ? (breite / 2) * ((hoehe - t) / spitze) : breite / 2;
      if (Math.abs(o) > halb + 0.01) continue;
      const q = yy * b.w + xx;
      mask[q] = 1;
      const rel = halb > 0 ? o / halb : 0;
      let c = rel < -0.25 ? f.licht : rel > 0.35 ? f.dunkel : f.mitte;
      if (Math.abs(rel + 0.05) < 0.3 && t > hoehe * 0.3) c = f.kern;
      if (t > hoehe - spitze) c = rel < 0.2 ? f.kern : f.licht;
      if (t < 1.5) c = f.dunkel;
      pixel.set(q, { c, z: z0 + t * 0.5 });
    }
  }
  const konturIndex = paletteIndex(f.kontur.replace('*', ''));
  outlineOf(mask, b.w, b.h).forEach((v, q) => {
    if (v === 0) return;
    const xx = q % b.w;
    const yy = Math.floor(q / b.w);
    // Unterhalb des Fußes liegt der Sockel: dort keine Kontur über gemalte Pixel.
    if (yy >= fuss && b.get(xx, yy) !== 0 && b.get(xx, yy) !== konturIndex) return;
    b.set(xx, yy, f.kontur, material, 2);
  });
  pixel.forEach(({ c, z }, q) => b.set(q % b.w, Math.floor(q / b.w), c, material, Math.min(32, z)));
  return mask;
}
