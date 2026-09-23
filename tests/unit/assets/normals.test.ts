/**
 * M1-06: Normal-/Höhengenerator je Höhen-Hinweis (Distanzfeld → Höhe → Sobel → geglättete Normale),
 * manuelle Höhen-Overrides und die Kodierung im Normal-Atlas.
 */
import { describe, expect, it } from 'vitest';
import { distanceToEdge, components } from '../../../assets-src/lib/distance';
import { HEIGHT_AUTO_VALUE, sprite, type HeightHint } from '../../../assets-src/lib/sprite';
import { encodeHeight, encodeUnit, heightField, normalFrameRgba, normalsFromHeight } from '../../../tools/assets/normals';

const N = 17;
const C = N / 2;

function disc(r: number): Uint8Array {
  const m = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.hypot(x + 0.5 - C, y + 0.5 - C) <= r) m[y * N + x] = 1;
  return m;
}

function rect(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
  return m;
}

function normals(mask: Uint8Array, w: number, h: number, hint: HeightHint, override: Int8Array | null = null): { n: Float32Array; hgt: Float32Array } {
  const hgt = heightField(mask, w, h, hint, override);
  return { n: normalsFromHeight(hgt, mask, w, h), hgt };
}

describe('Distanzfeld', () => {
  it('misst den Abstand zum nächsten transparenten Pixel (Zellrand zählt als transparent)', () => {
    expect(Array.from(distanceToEdge(Uint8Array.of(1), 1, 1))).toEqual([1]);
    const d = distanceToEdge(rect(5, 5, 0, 0, 5, 5), 5, 5);
    expect(d[2 * 5 + 2]).toBe(3);
    expect(d[0]).toBe(1);
    expect(d[1 * 5 + 1]).toBe(2);
    const gap = distanceToEdge(Uint8Array.of(1, 1, 0, 1, 1), 5, 1);
    expect(Array.from(gap)).toEqual([1, 1, 0, 1, 1]);
    expect(components(Uint8Array.of(1, 1, 0, 1, 1), 5, 1).count).toBe(2);
  });
});

describe('Normalen je Höhen-Hinweis', () => {
  it('flach ⇒ überall (0, 0, 1), Höhe 0, kodiert (128, 128, 0)', () => {
    const m = disc(6);
    const { n, hgt } = normals(m, N, N, 'flach');
    m.forEach((v, p) => {
      if (v === 0) return;
      expect([n[p * 3], n[p * 3 + 1], n[p * 3 + 2]]).toEqual([0, 0, 1]);
      expect(hgt[p]).toBe(0);
    });
    expect(encodeUnit(0)).toBe(128);
  });

  it('kugel ⇒ radiale Normalen, Höhe am Mittelpunkt am größten', () => {
    const m = disc(7);
    const { n, hgt } = normals(m, N, N, 'kugel');
    let checked = 0;
    let maxH = 0;
    let maxAt = -1;
    m.forEach((v, p) => {
      if (v === 0) return;
      const x = p % N;
      const y = (p - x) / N;
      const dx = x + 0.5 - C;
      const dy = y + 0.5 - C;
      const r = Math.hypot(dx, dy);
      const nx = n[p * 3] ?? 0;
      const ny = n[p * 3 + 1] ?? 0;
      const nz = n[p * 3 + 2] ?? 0;
      if ((hgt[p] ?? 0) > maxH) {
        maxH = hgt[p] ?? 0;
        maxAt = p;
      }
      if (r < 1) expect(nz).toBeGreaterThan(0.97);
      if (r >= 2) {
        const len = Math.hypot(nx, ny);
        expect((nx * dx + ny * dy) / (len * r), `(${x}, ${y})`).toBeGreaterThan(0.9);
        checked++;
      }
      // Nach außen kippt die Normale stärker.
      if (r >= 6) expect(nz).toBeLessThan(0.75);
    });
    expect(checked).toBeGreaterThan(100);
    expect(maxH).toBeGreaterThan(6);
    const mx = maxAt % N;
    expect(Math.abs(mx + 0.5 - C)).toBeLessThanOrEqual(1);
  });

  it('zylinder ⇒ Normalen seitlich (links negativ, rechts positiv), in der Mitte keine y-Neigung', () => {
    const w = 12;
    const h = 16;
    const m = rect(w, h, 3, 0, 9, h);
    const { n } = normals(m, w, h, 'zylinder');
    for (let y = 2; y < h - 2; y++) {
      const left = n[(y * w + 3) * 3] ?? 0;
      const right = n[(y * w + 8) * 3] ?? 0;
      expect(left).toBeLessThan(-0.5);
      expect(right).toBeGreaterThan(0.5);
      for (let x = 3; x < 9; x++) expect(Math.abs(n[(y * w + x) * 3 + 1] ?? 1)).toBeLessThan(1e-6);
    }
  });

  it('block ⇒ flaches Plateau, Fase an den Kanten zeigt nach außen', () => {
    const w = 12;
    const m = rect(w, w, 1, 1, 11, 11);
    const { n, hgt } = normals(m, w, w, 'block');
    expect([n[(6 * w + 6) * 3], n[(6 * w + 6) * 3 + 1], n[(6 * w + 6) * 3 + 2]]).toEqual([0, 0, 1]);
    expect(hgt[6 * w + 6]).toBe(2);
    expect(n[(6 * w + 1) * 3] ?? 0).toBeLessThan(-0.3);
    expect(n[(6 * w + 10) * 3] ?? 0).toBeGreaterThan(0.3);
    expect(n[(1 * w + 6) * 3 + 1] ?? 0).toBeLessThan(-0.3);
    expect(n[(10 * w + 6) * 3 + 1] ?? 0).toBeGreaterThan(0.3);
  });

  it('custom/Override: manuelle Höhen ersetzen die erzeugten und kippen die Normalen', () => {
    const w = 8;
    const m = rect(w, 1, 0, 0, w, 1);
    const ramp = Int8Array.from({ length: w }, (_, x) => x);
    const { n, hgt } = normals(m, w, 1, 'custom', ramp);
    expect(Array.from(hgt)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // Höhe steigt nach rechts ⇒ Normale zeigt nach links.
    expect(n[4 * 3] ?? 0).toBeLessThan(-0.3);
    const partial = Int8Array.from({ length: w }, (_, x) => (x === 3 ? 9 : HEIGHT_AUTO_VALUE));
    expect(Array.from(heightField(m, w, 1, 'flach', partial))).toEqual([0, 0, 0, 9, 0, 0, 0, 0]);
  });

  it('Normal-Atlas-Pixel: RG Normale, B Höhe (32 px ≙ 255), A Deckung', () => {
    expect(encodeHeight(32)).toBe(255);
    expect(encodeHeight(0)).toBe(0);
    expect(encodeHeight(64)).toBe(255);
    expect(encodeUnit(1)).toBe(255);
    expect(encodeUnit(-1)).toBe(0);
    const s = sprite({ id: 'n', size: [3, 1], anchor: [1, 1], hoehe: 'flach', legende: { '.': null, a: 'stein.2' }, frames: ['a.a'], hoehenRaster: '4..' });
    const frame = s.frames[0];
    if (frame === undefined) throw new Error('Frame fehlt');
    const rgba = normalFrameRgba(frame, 3, 1, s.hoehe);
    expect(Array.from(rgba.subarray(4, 8))).toEqual([0, 0, 0, 0]);
    expect(rgba[3]).toBe(255);
    expect(rgba[2]).toBe(encodeHeight(4));
    expect(Array.from(rgba.subarray(8, 12))).toEqual([128, 128, 0, 255]);
  });

  it('Kodierung im Bildschirmraum des Renderers: +y zeigt nach oben', () => {
    const rows = Array.from({ length: 9 }, (_, y) => Array.from({ length: 9 }, (_, x) => (Math.hypot(x - 4, y - 4) <= 4 ? 'a' : '.')).join(''));
    const s = sprite({ id: 'kugel', size: [9, 9], anchor: [4, 9], hoehe: 'kugel', legende: { '.': null, a: 'stein.2' }, frames: [rows.join('\n')] });
    const frame = s.frames[0];
    if (frame === undefined) throw new Error('Frame fehlt');
    const rgba = normalFrameRgba(frame, 9, 9, s.hoehe);
    const g = (x: number, y: number): number => rgba[(y * 9 + x) * 4 + 1] ?? 0;
    const r = (x: number, y: number): number => rgba[(y * 9 + x) * 4] ?? 0;
    expect(g(4, 1)).toBeGreaterThan(160); // oberer Rand: Normale nach oben
    expect(g(4, 7)).toBeLessThan(96); // unterer Rand: nach unten
    expect(r(1, 4)).toBeLessThan(96); // links
    expect(r(7, 4)).toBeGreaterThan(160); // rechts
  });
});
