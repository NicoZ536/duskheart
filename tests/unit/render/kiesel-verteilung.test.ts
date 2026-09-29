/**
 * M5-62 (pebbles): the seabed's motifs – a stone with its contact shadow, a tuft of seagrass (full-tile variants 2 and
 * 3 of `tileset_meeresgrund`) – no longer stand on every third water tile at the same spot of the tile, rows of stones
 * in the 16-px grid across the lake (`gruenhain-tag`, `wasser-ufer`, `biom-glutsand-tag`). A block of 4 × 4 tiles holds
 * at most one, on a hashed tile of its first 3 × 3 (`SEABED_MOTIFS`, `seabedMotifAt`): sparse, at least two tiles
 * apart, at irregular spacings and in-block places – no lattice; the terrain mesh draws exactly those.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { BLOB_FRAMES, TERRAIN_FRAME_SLOTS, WorldRenderTables } from '../../../src/render/world/tables';
import { SEABED_MOTIFS, seabedMotifAt, TERRAIN_FLAG, TERRAIN_INSTANCE_STRIDE, TERRAIN_KIND, TERRAIN_OFFSET, TerrainMeshBuilder } from '../../../src/render/world/terrainMesh';
import type { ChunkLookup } from '../../../src/render/world/window';
import { ChunkData, WATER_DEPTH_DEEP, WATER_RIVER } from '../../../src/world/model/chunk';
import type { Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { TERRAIN } from '../../../src/content/terrain';

const ids = contentWorldIdTables();
const CS = 32;
/** The area the distribution is measured on [tiles]. */
const AREA = 256;

let tables: WorldRenderTables;
let builder: TerrainMeshBuilder;

beforeAll(() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  tables = new WorldRenderTables(manifestFromGenerated(mod));
  builder = new TerrainMeshBuilder(tables);
});

/** 3×3 chunks of deep water around chunk (cx0, cy0). */
class Lake implements ChunkLookup {
  readonly chunks = new Map<string, ChunkData>();
  constructor(readonly cx0: number, readonly cy0: number) {
    for (let cy = cy0 - 1; cy <= cy0 + 1; cy++) {
      for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
        const c = new ChunkData(0, cx, cy);
        for (let i = 0; i < CS * CS; i++) {
          c.ground[i] = ids.terrain.runtimeId('gras');
          c.biome[i] = ids.biomes.runtimeId('gruenhain');
          c.water[i] = WATER_RIVER | WATER_DEPTH_DEEP;
        }
        this.chunks.set(`${cx},${cy}`, c);
      }
    }
  }
  get(layer: Layer, cx: number, cy: number): ChunkData | undefined {
    return layer === 0 ? this.chunks.get(`${cx},${cy}`) : undefined;
  }
  centre(): ChunkData {
    return this.chunks.get(`${this.cx0},${this.cy0}`) as ChunkData;
  }
}

function motifs(): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (let ty = 0; ty < AREA; ty++) for (let tx = 0; tx < AREA; tx++) if (seabedMotifAt(tx, ty)) out.push([tx, ty]);
  return out;
}

describe('M5-62: Kiesel und Seegras im Seegrund locker, ohne Rasterlage', () => {
  const B = SEABED_MOTIFS.blockTiles;
  const S = SEABED_MOTIFS.spreadTiles;

  it('die Motive des Seegrunds sind Stein und Seegras (Varianten 2 und 3 von vier)', () => {
    const seabed = TERRAIN.find((t) => t.id === 'meeresgrund');
    expect(seabed?.tileset?.variantWeights).toHaveLength(4);
    expect(SEABED_MOTIFS.variants).toEqual([2, 3]);
    expect(S).toBeLessThan(B);
  });

  it('locker: höchstens ein Motiv je Block, etwa 4 % der Kacheln (vorher 40 %), mindestens zwei Kacheln Abstand', () => {
    const list = motifs();
    const share = list.length / (AREA * AREA);
    expect(share).toBeGreaterThan((SEABED_MOTIFS.chance / (B * B)) * 0.8);
    expect(share).toBeLessThan((SEABED_MOTIFS.chance / (B * B)) * 1.2);
    expect(share).toBeLessThan(0.06);
    const blocks = new Set<string>();
    for (const [tx, ty] of list) {
      const key = `${Math.floor(tx / B)},${Math.floor(ty / B)}`;
      expect(blocks.has(key), key).toBe(false);
      blocks.add(key);
    }
    const at = new Set(list.map(([x, y]) => `${x},${y}`));
    const gap = B - S + 1;
    for (const [tx, ty] of list) {
      for (let dy = -gap + 1; dy < gap; dy++) {
        for (let dx = -gap + 1; dx < gap; dx++) if ((dx !== 0 || dy !== 0) && at.has(`${tx + dx},${ty + dy}`)) throw new Error(`Motive zu nah: ${tx},${ty} und ${tx + dx},${ty + dy}`);
      }
    }
  });

  it('ohne Rasterlage: jede Stelle im Block kommt vor, die Abstände wechseln, die Pixelspalten der Steine streuen', () => {
    const list = motifs();
    const places = new Map<string, number>();
    for (const [tx, ty] of list) {
      const key = `${tx % B},${ty % B}`;
      places.set(key, (places.get(key) ?? 0) + 1);
    }
    expect(places.size).toBe(S * S);
    const mean = list.length / (S * S);
    for (const [k, n] of places) {
      expect(n, k).toBeGreaterThan(mean * 0.6);
      expect(n, k).toBeLessThan(mean * 1.4);
    }
    // Spacings between neighbouring motifs along a row of blocks: many different ones, no single period.
    const gaps = new Map<number, number>();
    for (let by = 0; by < AREA / B; by++) {
      let prev: number | null = null;
      for (let tx = 0; tx < AREA; tx++) {
        for (let ty = by * B; ty < by * B + B; ty++) {
          if (!seabedMotifAt(tx, ty)) continue;
          if (prev !== null) gaps.set(tx - prev, (gaps.get(tx - prev) ?? 0) + 1);
          prev = tx;
        }
      }
    }
    expect(gaps.size).toBeGreaterThanOrEqual(6);
    const top = Math.max(...gaps.values());
    const all = [...gaps.values()].reduce((a, b) => a + b, 0);
    expect(top / all).toBeLessThan(0.35);
  });

  it('das Gelände-Mesh zeichnet genau dort Stein oder Seegras, sonst ruhigen Grund', () => {
    const sea = ids.terrain.runtimeId('meeresgrund');
    const frame = (v: number): string => `${tables.terrainFrameX[sea * TERRAIN_FRAME_SLOTS + BLOB_FRAMES + v]},${tables.terrainFrameY[sea * TERRAIN_FRAME_SLOTS + BLOB_FRAMES + v]}`;
    const motifFrames = new Set(SEABED_MOTIFS.variants.map(frame));
    const calmFrames = new Set([0, 1, 2, 3].filter((v) => !SEABED_MOTIFS.variants.includes(v)).map(frame));
    let drawn = 0;
    let calm = 0;
    // The stone's pixel columns in its tile: 3–7 as painted, 8–12 mirrored (the seabed mirrors at random).
    const mirrored = new Set<boolean>();
    for (const [cx0, cy0] of [[0, 0], [3, 1], [-2, 5]] as const) {
      const lake = new Lake(cx0, cy0);
      const m = builder.build(lake.centre(), lake);
      const u16 = new Uint16Array(m.data.buffer, m.data.byteOffset, m.data.byteLength / 2);
      for (let k = 0; k < m.count; k++) {
        const o = k * TERRAIN_INSTANCE_STRIDE;
        if (((m.data[o + 3] ?? 0) & TERRAIN_FLAG.water) === 0 || ((m.data[o + TERRAIN_OFFSET.shade] ?? 0) >> 3) !== TERRAIN_KIND.ground) continue;
        const tx = cx0 * CS + (m.data[o] ?? 0);
        const ty = cy0 * CS + (m.data[o + 1] ?? 0);
        const f = `${u16[(o + TERRAIN_OFFSET.rect) / 2] ?? 0},${u16[(o + TERRAIN_OFFSET.rect) / 2 + 1] ?? 0}`;
        expect(motifFrames.has(f), `${tx},${ty}`).toBe(seabedMotifAt(tx, ty));
        if (motifFrames.has(f)) {
          drawn++;
          mirrored.add(((m.data[o + 3] ?? 0) & TERRAIN_FLAG.mirror) !== 0);
        }
        else if (calmFrames.has(f)) calm++;
      }
    }
    expect(drawn).toBeGreaterThan(0);
    expect(calm).toBeGreaterThan(drawn * 10);
    expect([...mirrored].sort()).toEqual([false, true]);
  });
});
