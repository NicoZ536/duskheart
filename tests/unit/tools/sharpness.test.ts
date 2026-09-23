/**
 * M1-14/M1-25: Schärfeprüfung der Auflösungs-Screenshots (tools/lib/sharpness.ts) und das Lesen von
 * RGB-PNGs, wie Browser-Screenshots sie schreiben (tools/lib/png.ts). Synthetische Bilder: ein
 * internes Bild, ganzzahlig per Nearest bzw. mit einem gemischten Randpixel skaliert, gilt als
 * scharf; lineares Hochskalieren ohne Vorskalierung (Matsch) und helle Balken fallen auf.
 */
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, encodePng } from '../../../tools/lib/png';
import { checkSharpness, type PresentedLayout, type RgbaFrame } from '../../../tools/lib/sharpness';

const IW = 12;
const IH = 6;

/** Internal test image: a checker of distinct colours (every neighbour differs). */
function internalColour(i: number, j: number): [number, number, number] {
  return [(i * 37 + j * 11) % 256, (i * 5 + j * 71) % 256, ((i + j) % 2) * 200 + 20];
}

/**
 * Presents the internal image into a `w`×`h` frame at `layout`: nearest (optionally with one
 * blended screen pixel at every block edge, like the linear step after the integer pre-scale) or
 * plain bilinear (blur).
 */
function present(w: number, h: number, layout: PresentedLayout, mode: 'nearest' | 'edgeBlend' | 'bilinear'): RgbaFrame {
  const rgba = new Uint8Array(w * h * 4);
  const sx = layout.outWidth / layout.internalWidth;
  const sy = layout.outHeight / layout.internalHeight;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      rgba[o + 3] = 255;
      const lx = x - layout.outX;
      const ly = y - layout.outY;
      if (lx < 0 || ly < 0 || lx >= layout.outWidth || ly >= layout.outHeight) continue;
      let c: number[];
      const u = (lx + 0.5) / sx;
      const v = (ly + 0.5) / sy;
      if (mode === 'bilinear') {
        const fx = Math.max(0, u - 0.5);
        const fy = Math.max(0, v - 0.5);
        const i0 = Math.min(IW - 1, Math.floor(fx));
        const j0 = Math.min(IH - 1, Math.floor(fy));
        const i1 = Math.min(IW - 1, i0 + 1);
        const j1 = Math.min(IH - 1, j0 + 1);
        const ax = fx - i0;
        const ay = fy - j0;
        c = [0, 1, 2].map((k) => {
          const a = internalColour(i0, j0)[k] ?? 0;
          const b = internalColour(i1, j0)[k] ?? 0;
          const cc = internalColour(i0, j1)[k] ?? 0;
          const d = internalColour(i1, j1)[k] ?? 0;
          return Math.round((a * (1 - ax) + b * ax) * (1 - ay) + (cc * (1 - ax) + d * ax) * ay);
        });
      } else {
        const i = Math.min(IW - 1, Math.floor(lx / sx));
        const j = Math.min(IH - 1, Math.floor(ly / sy));
        c = internalColour(i, j);
        // A screen pixel straddling a block edge mixes both blocks.
        const straddlesX = Math.floor(lx / sx) !== Math.floor((lx + 1) / sx - 1e-9) && i + 1 < IW;
        if (mode === 'edgeBlend' && straddlesX) c = c.map((v, k) => Math.round((v + (internalColour(i + 1, j)[k] ?? 0)) / 2));
      }
      rgba[o] = c[0] ?? 0;
      rgba[o + 1] = c[1] ?? 0;
      rgba[o + 2] = c[2] ?? 0;
    }
  }
  return { width: w, height: h, rgba };
}

describe('Schärfeprüfung', () => {
  it('ganzzahlig per Nearest (×4): jeder Block einfarbig, Balken schwarz', () => {
    const layout: PresentedLayout = { internalWidth: IW, internalHeight: IH, outX: 5, outY: 0, outWidth: IW * 4, outHeight: IH * 4 };
    const r = checkSharpness(present(58, 24, layout, 'nearest'), layout);
    expect(r).toMatchObject({ scale: 4, integerScale: true, blocks: IW * IH, uniformBlocks: IW * IH, litBarPixels: 0, firstBlur: null });
    expect(r.contrastEdges).toBe((IW - 1) * IH + IW * (IH - 1));
  });

  it('gebrochener Faktor: ein gemischtes Randpixel je Blockkante ist scharf, lineares Hochskalieren nicht', () => {
    const layout: PresentedLayout = { internalWidth: IW, internalHeight: IH, outX: 0, outY: 0, outWidth: 64, outHeight: 32 };
    const sharp = checkSharpness(present(64, 32, layout, 'edgeBlend'), layout);
    expect(sharp.integerScale).toBe(false);
    expect(sharp.uniformBlocks).toBe(sharp.blocks);
    const blurred = checkSharpness(present(64, 32, layout, 'bilinear'), layout);
    expect(blurred.uniformBlocks).toBeLessThan(blurred.blocks / 2);
    expect(blurred.firstBlur).not.toBeNull();
  });

  it('bei ganzzahligem Faktor zählt schon ein gemischtes Randpixel als unscharf', () => {
    const layout: PresentedLayout = { internalWidth: IW, internalHeight: IH, outX: 0, outY: 0, outWidth: IW * 4, outHeight: IH * 4 };
    const frame = present(IW * 4, IH * 4, layout, 'nearest');
    frame.rgba[(1 * frame.width + 3) * 4] = 255 - (frame.rgba[(1 * frame.width + 3) * 4] ?? 0);
    const r = checkSharpness(frame, layout);
    expect(r.uniformBlocks).toBe(r.blocks - 1);
    expect(r.firstBlur).toEqual({ x: 0, y: 0 });
  });

  it('helle Pixel in den Balken und verzerrte Seitenverhältnisse fallen auf', () => {
    const layout: PresentedLayout = { internalWidth: IW, internalHeight: IH, outX: 5, outY: 0, outWidth: IW * 4, outHeight: IH * 4 };
    const frame = present(58, 24, layout, 'nearest');
    frame.rgba[(3 * 58 + 1) * 4 + 1] = 90;
    expect(checkSharpness(frame, layout).litBarPixels).toBe(1);
    expect(() => checkSharpness(frame, { ...layout, outWidth: IW * 3 })).toThrow(/verzerrt/);
    expect(() => checkSharpness(frame, { ...layout, outX: 20 })).toThrow(/außerhalb/);
  });
});

/** Minimal RGB PNG writer with a given filter per row (what browsers write). */
function rgbPng(width: number, height: number, rgb: Uint8Array, filters: readonly number[]): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const f = filters[y % filters.length] ?? 0;
    raw[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i++) {
      const x = rgb[y * stride + i] ?? 0;
      const a = i >= 3 ? (rgb[y * stride + i - 3] ?? 0) : 0;
      const b = y > 0 ? (rgb[(y - 1) * stride + i] ?? 0) : 0;
      const c = y > 0 && i >= 3 ? (rgb[(y - 1) * stride + i - 3] ?? 0) : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? Math.floor((a + b) / 2) : f === 4 ? pr : 0;
      raw[y * (stride + 1) + 1 + i] = (x - pred) & 0xff;
    }
  }
  // Reuse the RGBA encoder's chunk layout: patch colour type 2 into a copy of its IHDR.
  const template = encodePng(width, height, new Uint8Array(width * height * 4));
  const ihdrEnd = 8 + 8 + 13 + 4;
  const ihdr = template.slice(0, ihdrEnd);
  ihdr[8 + 8 + 9] = 2;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Uint8Array): number => {
    let c = 0xffffffff;
    for (const v of buf) c = (crcTable[(c ^ v) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  new DataView(ihdr.buffer).setUint32(8 + 8 + 13, crc(ihdr.subarray(12, 8 + 8 + 13)));
  const data = deflateSync(raw);
  const idat = new Uint8Array(12 + data.length);
  new DataView(idat.buffer).setUint32(0, data.length);
  idat.set([73, 68, 65, 84], 4);
  idat.set(data, 8);
  new DataView(idat.buffer).setUint32(8 + data.length, crc(idat.subarray(4, 8 + data.length)));
  const iend = template.slice(template.length - 12);
  const out = new Uint8Array(ihdr.length + idat.length + iend.length);
  out.set(ihdr, 0);
  out.set(idat, ihdr.length);
  out.set(iend, ihdr.length + idat.length);
  return out;
}

describe('PNG lesen', () => {
  it('liest RGB-PNGs mit allen Zeilenfiltern als RGBA mit voller Deckung', () => {
    const w = 7;
    const h = 5;
    const rgb = new Uint8Array(w * h * 3).map((_, i) => (i * 53 + 17) % 256);
    const img = decodePng(rgbPng(w, h, rgb, [0, 1, 2, 3, 4]));
    expect(img.width).toBe(w);
    expect(img.height).toBe(h);
    for (let p = 0; p < w * h; p++) {
      expect([...img.rgba.subarray(p * 4, p * 4 + 4)]).toEqual([rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2], 255]);
    }
  });

  it('RGBA bleibt unverändert (Roundtrip mit dem Encoder)', () => {
    const rgba = new Uint8Array(3 * 2 * 4).map((_, i) => (i * 29) % 256);
    expect(decodePng(encodePng(3, 2, rgba)).rgba).toEqual(rgba);
  });
});
