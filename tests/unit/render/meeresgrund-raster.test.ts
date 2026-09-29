/**
 * M5-67: the seabed shows no 16-px grid. Its calm ground was two variants picked by weight – light-wave dashes on every
 * tile, a dark hollow on a third of them – each at the same spot of the tile: dark spots and dashes in rows across the
 * open water (`biom-salzkueste-tag`: autocorrelation 66 % at 16 px against 51 % at 15 and 17 px; the Oase of
 * `biom-glutsand-tag`). Now the variant that fills the water is plain (assets-src/sprites/terrain/meeresgrund.ts
 * variant 0), and the features – the hollow with its waves (`SEABED_HOLLOWS`), a stone, seagrass (`SEABED_MOTIFS`) –
 * stand loosely: never two in one row or column two tiles or closer, nor diagonally touching.
 *
 * Measured on the seabed as the terrain mesh draws it (its instances, their atlas frames from the generated albedo,
 * mirrored where flagged, in the palette's luminance) over 128 × 128 tiles of open water: the autocorrelation at 16 and
 * 32 px (one and two tiles) is not higher than at the neighbouring shifts, in rows, columns and on the diagonal.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { BLOB_FRAMES, TERRAIN_FRAME_SLOTS, WorldRenderTables } from '../../../src/render/world/tables';
import { SEABED_HOLLOWS, SEABED_MOTIFS, seabedHollowAt, seabedMotifAt, TERRAIN_FLAG, TERRAIN_INSTANCE_STRIDE, TERRAIN_KIND, TERRAIN_OFFSET, TerrainMeshBuilder } from '../../../src/render/world/terrainMesh';
import type { ChunkLookup } from '../../../src/render/world/window';
import { ChunkData, WATER_DEPTH_DEEP, WATER_RIVER } from '../../../src/world/model/chunk';
import type { Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { decodePng } from '../../../tools/lib/png';

const ids = contentWorldIdTables();
const CS = 32;
const TILE = 16;
/** Chunks per side of the measured sea (128 × 128 tiles, 2048 × 2048 px). */
const CHUNKS = 4;
const W = CHUNKS * CS * TILE;
/**
 * Slack of the comparisons [share of the variance]: the field is a finite sample. Before M5-67 the excess at 16 px was
 * 0.108 in rows and 0.249 in columns; now it is 0 to four decimals.
 */
const SLACK = 0.001;

let tables: WorldRenderTables;
let builder: TerrainMeshBuilder;
let albedo: { width: number; height: number; rgba: Uint8Array };
/** Luminance of the seabed [palette colour], row-major W × W, and its mean and variance. */
let field: Float64Array;
let mean = 0;
let variance = 0;

/** Open water on every chunk from −1 to `CHUNKS` (the measured ones and their neighbours). */
class Sea implements ChunkLookup {
  readonly chunks = new Map<string, ChunkData>();
  constructor() {
    for (let cy = -1; cy <= CHUNKS; cy++) {
      for (let cx = -1; cx <= CHUNKS; cx++) {
        const c = new ChunkData(0, cx, cy);
        for (let i = 0; i < CS * CS; i++) {
          c.ground[i] = ids.terrain.runtimeId('sand');
          c.biome[i] = ids.biomes.runtimeId('salzkueste');
          c.water[i] = WATER_RIVER | WATER_DEPTH_DEEP;
        }
        this.chunks.set(`${cx},${cy}`, c);
      }
    }
  }
  get(layer: Layer, cx: number, cy: number): ChunkData | undefined {
    return layer === 0 ? this.chunks.get(`${cx},${cy}`) : undefined;
  }
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

/** Palette index of albedo pixel (x, y) (R channel, 0 = transparent). */
function indexAt(x: number, y: number): number {
  return albedo.rgba[(y * albedo.width + x) * 4] ?? 0;
}

beforeAll(() => {
  const mod = generatedAtlasModule();
  const path = join(process.cwd(), 'public/generated/atlas-albedo.png');
  if (mod === null || !existsSync(path)) throw new Error('Spielatlas fehlt – npm run assets');
  tables = new WorldRenderTables(manifestFromGenerated(mod));
  builder = new TerrainMeshBuilder(tables);
  albedo = decodePng(readFileSync(path));
  const lum = PALETTE_HEX.map(luminance);
  const sea = new Sea();
  field = new Float64Array(W * W);
  for (let cy = 0; cy < CHUNKS; cy++) {
    for (let cx = 0; cx < CHUNKS; cx++) {
      const m = builder.build(sea.get(0, cx, cy) as ChunkData, sea);
      const u16 = new Uint16Array(m.data.buffer, m.data.byteOffset, m.data.byteLength / 2);
      for (let k = 0; k < m.count; k++) {
        const o = k * TERRAIN_INSTANCE_STRIDE;
        const flags = m.data[o + 3] ?? 0;
        if ((flags & TERRAIN_FLAG.water) === 0 || ((m.data[o + TERRAIN_OFFSET.shade] ?? 0) >> 3) !== TERRAIN_KIND.ground) continue;
        const ax = u16[(o + TERRAIN_OFFSET.rect) / 2] ?? 0;
        const ay = u16[(o + TERRAIN_OFFSET.rect) / 2 + 1] ?? 0;
        const mirror = (flags & TERRAIN_FLAG.mirror) !== 0;
        const x0 = (cx * CS + (m.data[o] ?? 0)) * TILE;
        const y0 = (cy * CS + (m.data[o + 1] ?? 0)) * TILE;
        for (let y = 0; y < TILE; y++) {
          for (let x = 0; x < TILE; x++) {
            const p = indexAt(ax + (mirror ? TILE - 1 - x : x), ay + y);
            if (p > 0) field[(y0 + y) * W + x0 + x] = lum[p - 1] ?? 0;
          }
        }
      }
    }
  }
  for (const v of field) mean += v;
  mean /= field.length;
  for (const v of field) variance += (v - mean) ** 2;
  variance /= field.length;
});

/** Normalised autocorrelation of the field at shift (dx, dy) [px]. */
function acf(dx: number, dy: number): number {
  let s = 0;
  let n = 0;
  for (let y = 0; y + dy < W; y++) {
    const row = y * W;
    const shifted = (y + dy) * W + dx;
    for (let x = 0; x + dx < W; x++) {
      s += ((field[row + x] as number) - mean) * ((field[shifted + x] as number) - mean);
      n++;
    }
  }
  return s / n / variance;
}

describe('M5-67: der Meeresgrund ohne 16-px-Raster', () => {
  it('die Variante, die das offene Wasser füllt, ist schlichter Tiefgrund (ein Motiv darin stünde in jeder Kachel an derselben Stelle)', () => {
    const sea = ids.terrain.runtimeId('meeresgrund');
    const plain = [0, 1, 2, 3].filter((v) => !SEABED_MOTIFS.variants.includes(v) && !SEABED_HOLLOWS.variants.includes(v));
    expect(plain).toEqual([0]);
    const fx = tables.terrainFrameX[sea * TERRAIN_FRAME_SLOTS + BLOB_FRAMES] ?? 0;
    const fy = tables.terrainFrameY[sea * TERRAIN_FRAME_SLOTS + BLOB_FRAMES] ?? 0;
    const colours = new Set<number>();
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) colours.add(indexAt(fx + x, fy + y));
    expect(colours.size).toBe(1);
    // The hollow keeps its dark trough and its light waves.
    const hx = tables.terrainFrameX[sea * TERRAIN_FRAME_SLOTS + BLOB_FRAMES + (SEABED_HOLLOWS.variants[0] ?? 0)] ?? 0;
    const hy = tables.terrainFrameY[sea * TERRAIN_FRAME_SLOTS + BLOB_FRAMES + (SEABED_HOLLOWS.variants[0] ?? 0)] ?? 0;
    const hollow = new Set<number>();
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) hollow.add(indexAt(hx + x, hy + y));
    expect(hollow.size).toBeGreaterThanOrEqual(3);
  });

  it('Senken, Steine und Seegras stehen locker: nie zwei in einer Reihe oder Spalte zwei Kacheln nah oder weniger, nie diagonal berührend', () => {
    const N = CHUNKS * CS;
    const feature = (tx: number, ty: number): boolean => seabedMotifAt(tx, ty) || seabedHollowAt(tx, ty);
    let hollows = 0;
    let motifs = 0;
    for (let ty = 0; ty < N; ty++) {
      for (let tx = 0; tx < N; tx++) {
        if (seabedHollowAt(tx, ty)) hollows++;
        if (seabedMotifAt(tx, ty)) motifs++;
        if (!feature(tx, ty)) continue;
        for (const [dx, dy] of [[1, 0], [2, 0], [0, 1], [0, 2], [1, 1], [-1, 1]] as const) {
          if (feature(tx + dx, ty + dy)) throw new Error(`zwei Merkmale zu nah: ${tx},${ty} und ${tx + dx},${ty + dy}`);
        }
      }
    }
    // Sparse, but the sea is not bare: hollows on a few percent of the tiles, stones and seagrass besides.
    expect(hollows / (N * N)).toBeGreaterThan(0.03);
    expect(hollows / (N * N)).toBeLessThan(0.1);
    expect(motifs / (N * N)).toBeGreaterThan(0.03);
    // No lattice: the columns of the hollows in their 4-tile block take every value about equally often.
    const columns = [0, 0, 0, 0];
    for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) if (seabedHollowAt(tx, ty)) columns[tx % 4] = (columns[tx % 4] ?? 0) + 1;
    for (const c of columns) expect(c).toBeGreaterThan((hollows / 4) * 0.75);
  });

  it('das Gelände-Mesh zeichnet die Senke genau dort, sonst den schlichten Grund oder ein Motiv', () => {
    const sea = ids.terrain.runtimeId('meeresgrund');
    const frame = (v: number): string => `${tables.terrainFrameX[sea * TERRAIN_FRAME_SLOTS + BLOB_FRAMES + v]},${tables.terrainFrameY[sea * TERRAIN_FRAME_SLOTS + BLOB_FRAMES + v]}`;
    const hollowFrames = new Set(SEABED_HOLLOWS.variants.map(frame));
    const lake = new Sea();
    const m = builder.build(lake.get(0, 1, 2) as ChunkData, lake);
    const u16 = new Uint16Array(m.data.buffer, m.data.byteOffset, m.data.byteLength / 2);
    let drawn = 0;
    for (let k = 0; k < m.count; k++) {
      const o = k * TERRAIN_INSTANCE_STRIDE;
      if (((m.data[o + 3] ?? 0) & TERRAIN_FLAG.water) === 0 || ((m.data[o + TERRAIN_OFFSET.shade] ?? 0) >> 3) !== TERRAIN_KIND.ground) continue;
      const tx = CS + (m.data[o] ?? 0);
      const ty = 2 * CS + (m.data[o + 1] ?? 0);
      const f = `${u16[(o + TERRAIN_OFFSET.rect) / 2] ?? 0},${u16[(o + TERRAIN_OFFSET.rect) / 2 + 1] ?? 0}`;
      expect(hollowFrames.has(f), `${tx},${ty}`).toBe(seabedHollowAt(tx, ty));
      if (hollowFrames.has(f)) drawn++;
    }
    expect(drawn).toBeGreaterThan(0);
  });

  it('Autokorrelation bei 16 und 32 px nicht höher als bei den Nachbarversätzen (Reihen, Spalten, Diagonale)', () => {
    // The seabed is not bare: its features carry a variance of their own.
    expect(variance).toBeGreaterThan(1);
    for (const d of [16, 32]) {
      const rows = [acf(d - 1, 0), acf(d, 0), acf(d + 1, 0)] as const;
      const columns = [acf(0, d - 1), acf(0, d), acf(0, d + 1)] as const;
      expect(rows[1], `Reihe ${d} px: ${rows.join(' / ')}`).toBeLessThanOrEqual(Math.min(rows[0], rows[2]) + SLACK);
      expect(columns[1], `Spalte ${d} px: ${columns.join(' / ')}`).toBeLessThanOrEqual(Math.min(columns[0], columns[2]) + SLACK);
    }
    const diagonal = [acf(15, 15), acf(16, 16), acf(17, 17)] as const;
    expect(diagonal[1], `Diagonale 16 px: ${diagonal.join(' / ')}`).toBeLessThanOrEqual(Math.min(diagonal[0], diagonal[2]) + SLACK);
  });
});
