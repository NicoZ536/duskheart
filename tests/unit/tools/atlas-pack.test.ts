/** M1-05: deterministisches Rechteck-Packing (Skyline) mit 1 px Abstand und Zweierpotenz-Größen. */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/engine/rng';
import { ATLAS_PADDING, packRects, type PackedRect } from '../../../tools/assets/pack';

function overlaps(a: PackedRect, b: PackedRect, pad: number): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

function isPow2(v: number): boolean {
  return v > 0 && (v & (v - 1)) === 0;
}

function randomItems(seed: number, n: number): Array<{ key: string; w: number; h: number }> {
  const rng = new Rng(seed);
  const sizes = [8, 16, 16, 16, 24, 32, 48, 64];
  return Array.from({ length: n }, (_, i) => ({ key: `r${String(i).padStart(4, '0')}`, w: rng.pick(sizes), h: rng.pick(sizes) }));
}

describe('packRects', () => {
  it('keine Überlappung (inkl. 1 px Abstand), alles im Atlas, Größen sind Zweierpotenzen', () => {
    const items = randomItems(3, 400);
    const res = packRects(items);
    expect(isPow2(res.width) && isPow2(res.height)).toBe(true);
    expect(res.rects).toHaveLength(items.length);
    for (const r of res.rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(res.width);
      expect(r.y + r.h).toBeLessThanOrEqual(res.height);
    }
    const collisions: string[] = [];
    for (let i = 0; i < res.rects.length; i++) {
      for (let j = i + 1; j < res.rects.length; j++) {
        const a = res.rects[i];
        const b = res.rects[j];
        if (a !== undefined && b !== undefined && overlaps(a, b, ATLAS_PADDING)) collisions.push(`${a.key} ↔ ${b.key}`);
      }
    }
    expect(collisions).toEqual([]);
    // Dichte: die belegte Höhe ist zu mindestens 80 % gefüllt (Skyline packt dicht; der Rest der
    // Atlashöhe ist Rundung auf die Zweierpotenz).
    const area = items.reduce((s, it) => s + it.w * it.h, 0);
    const usedHeight = Math.max(...res.rects.map((r) => r.y + r.h));
    expect(area / (res.width * usedHeight)).toBeGreaterThan(0.8);
  });

  it('deterministisch und unabhängig von der Eingabereihenfolge', () => {
    const items = randomItems(9, 120);
    const a = packRects(items);
    const b = packRects([...items].reverse());
    const byKey = (r: { rects: readonly PackedRect[] }): PackedRect[] => [...r.rects].sort((x, y) => (x.key < y.key ? -1 : 1));
    expect(byKey(b)).toEqual(byKey(a));
    expect([b.width, b.height]).toEqual([a.width, a.height]);
  });

  it('kleine Mengen bleiben klein; Fehler bei doppelten Schlüsseln und Übergröße', () => {
    expect(packRects([{ key: 'a', w: 16, h: 16 }])).toMatchObject({ width: 64, height: 64 });
    expect(packRects([])).toMatchObject({ width: 64, height: 64, rects: [] });
    expect(() => packRects([{ key: 'a', w: 1, h: 1 }, { key: 'a', w: 1, h: 1 }])).toThrow(/doppelt/);
    expect(() => packRects([{ key: 'riesig', w: 5000, h: 8 }])).toThrow(/größer als 4096/);
    expect(() => packRects(randomItems(1, 200), { maxSize: 64 })).toThrow(/passen nicht/);
  });
});
