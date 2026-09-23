/**
 * Deterministisches Rechteck-Packing für den Atlas: Skyline-Bottom-Left (eine Regal-Variante, bei der
 * jedes Regal seine eigene Höhenlinie hat). Sortierung Höhe ↓, Breite ↓, Schlüssel ↑; Gleichstand
 * beim Platz entscheidet die kleinere x-Position. 1 px Abstand zwischen allen Rechtecken (kein
 * Ausbluten beim Filtern). Atlasgröße: kleinste Zweierpotenz, beginnend quadratisch, abwechselnd
 * Breite und Höhe verdoppelt; die Höhe wird danach auf die benutzte Zweierpotenz gekürzt.
 */

export interface PackInput {
  readonly key: string;
  readonly w: number;
  readonly h: number;
}

export interface PackedRect extends PackInput {
  readonly x: number;
  readonly y: number;
}

export interface PackResult {
  readonly width: number;
  readonly height: number;
  readonly rects: readonly PackedRect[];
}

export interface PackOptions {
  /** Abstand zwischen Rechtecken in px. */
  readonly padding?: number;
  /** Kleinste Atlaskante (Zweierpotenz). */
  readonly minSize?: number;
  /** Größte Atlaskante (WebGL2 garantiert 2048; 4096 auf allen Zielgeräten). */
  readonly maxSize?: number;
}

/** Standardabstand zwischen Frames im Atlas. */
export const ATLAS_PADDING = 1;
/** Kleinste Atlaskante. */
export const ATLAS_MIN_SIZE = 64;
/** Größte Atlaskante. */
export const ATLAS_MAX_SIZE = 4096;

interface SkyNode {
  x: number;
  y: number;
  w: number;
}

/** Packt `items` in genau `width`×`height`; `null`, wenn nicht alles passt. */
function packInto(items: readonly PackInput[], width: number, height: number, padding: number): PackedRect[] | null {
  const sky: SkyNode[] = [{ x: 0, y: 0, w: width }];
  const out: PackedRect[] = [];
  for (const it of items) {
    const pw = it.w + padding;
    const ph = it.h + padding;
    let bestY = Number.POSITIVE_INFINITY;
    let bestX = 0;
    let bestI = -1;
    for (let i = 0; i < sky.length; i++) {
      const node = sky[i];
      if (node === undefined || node.x + it.w > width) continue;
      // Höchste Kante unter der Breite pw ab node.x (Abstand darf über den rechten Rand ragen).
      let y = 0;
      let covered = 0;
      for (let j = i; j < sky.length && covered < pw; j++) {
        const n = sky[j];
        if (n === undefined) break;
        y = Math.max(y, n.y);
        covered += n.w;
      }
      if (covered < Math.min(pw, width - node.x)) continue;
      if (y + it.h > height) continue;
      if (y < bestY || (y === bestY && node.x < bestX)) {
        bestY = y;
        bestX = node.x;
        bestI = i;
      }
    }
    if (bestI < 0) return null;
    out.push({ ...it, x: bestX, y: bestY });
    // Neue Kante einfügen und überdeckte Knoten kürzen/entfernen.
    const newNode: SkyNode = { x: bestX, y: bestY + ph, w: Math.min(pw, width - bestX) };
    sky.splice(bestI, 0, newNode);
    const end = newNode.x + newNode.w;
    const k = bestI + 1;
    while (k < sky.length) {
      const n = sky[k];
      if (n === undefined || n.x >= end) break;
      const overlap = end - n.x;
      if (overlap >= n.w) sky.splice(k, 1);
      else {
        n.x += overlap;
        n.w -= overlap;
        break;
      }
    }
    // Nachbarn gleicher Höhe verschmelzen.
    for (let m = 0; m < sky.length - 1; ) {
      const a = sky[m];
      const b = sky[m + 1];
      if (a !== undefined && b !== undefined && a.y === b.y) {
        a.w += b.w;
        sky.splice(m + 1, 1);
      } else m++;
    }
  }
  return out;
}

function nextPow2(v: number): number {
  let p = 1;
  while (p < v) p *= 2;
  return p;
}

/** Packt alle Rechtecke deterministisch; wirft, wenn sie nicht in `maxSize`² passen. */
export function packRects(items: readonly PackInput[], opts: PackOptions = {}): PackResult {
  const padding = opts.padding ?? ATLAS_PADDING;
  const minSize = opts.minSize ?? ATLAS_MIN_SIZE;
  const maxSize = opts.maxSize ?? ATLAS_MAX_SIZE;
  const keys = new Set<string>();
  for (const it of items) {
    if (keys.has(it.key)) throw new Error(`Packing: Schlüssel ${it.key} doppelt`);
    keys.add(it.key);
    if (it.w > maxSize || it.h > maxSize) throw new Error(`Packing: ${it.key} (${it.w}×${it.h}) ist größer als ${maxSize}`);
  }
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let width = minSize;
  let height = minSize;
  for (;;) {
    const rects = packInto(sorted, width, height, padding);
    if (rects !== null) {
      const used = rects.reduce((m, r) => Math.max(m, r.y + r.h), 0);
      return { width, height: Math.max(minSize, nextPow2(used)), rects };
    }
    if (width === maxSize && height === maxSize) throw new Error(`Packing: ${items.length} Rechtecke passen nicht in ${maxSize}×${maxSize}`);
    if (width <= height) width = Math.min(maxSize, width * 2);
    else height = Math.min(maxSize, height * 2);
  }
}
