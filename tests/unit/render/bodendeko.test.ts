/**
 * M3-40: the dune grass of the Salzküste in clumps across tile borders instead of a uniform 16-px field –
 * the object layer scatters the tufts of `bodendeko_duenengras` in clusters (`groundDecor.ts`): the same
 * tufts for every build and every chunk order; each tuft in exactly one chunk (the one its anchor lies in);
 * only on dune grass, on dry land, on tiles without a world object; anchors off the tile grid, clusters
 * spanning tiles; dense clumps with bare sand between them (the density of 3×3-tile blocks varies a lot).
 */
import { describe, expect, it } from 'vitest';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { RenderScene } from '../../../src/render/scene';
import { DECOR_SIZES, GROUND_DECOR_RULES, tuftsOfCell, type DecorTuft } from '../../../src/render/world/groundDecor';
import { WorldObjectLayer } from '../../../src/render/world/objects';
import { ChunkSignatures } from '../../../src/render/world/signature';
import { WorldRenderTables } from '../../../src/render/world/tables';
import { ChunkData } from '../../../src/world/model/chunk';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

const ids = contentWorldIdTables();
const T = (id: string): number => ids.terrain.runtimeId(id);
const B = (id: string): number => ids.biomes.runtimeId(id);
const O = (id: string): number => ids.objects.runtimeId(id);
const CS = 32;
const TILE = 16;
const CHUNK_PX = CS * TILE;
const RULE = GROUND_DECOR_RULES.find((r) => r.terrain === 'duenengras');
if (RULE === undefined) throw new Error('Regel für Dünengras fehlt');

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const tables = new WorldRenderTables(MANIFEST);

function duneChunk(cx: number, cy: number, fill?: (c: ChunkData) => void): ChunkData {
  const c = new ChunkData(0, cx, cy);
  c.ground.fill(T('duenengras'));
  c.biome.fill(B('salzkueste'));
  fill?.(c);
  return c;
}

/** The decor of `chunk` as world px anchors. */
function decorOf(chunk: ChunkData, layer = new WorldObjectLayer(tables)): { x: number; y: number; frame: number }[] {
  const sigs = new ChunkSignatures();
  sigs.beginFrame();
  const list = layer.listOf(chunk, sigs);
  return Array.from({ length: list.decorCount }, (_, k) => ({ x: list.decorX[k] ?? 0, y: list.decorY[k] ?? 0, frame: list.decorFrame[k] ?? 0 }));
}

describe('M3-40: Dünengras in Horsten über die Kachelgrenzen', () => {
  it('die Regel nutzt das Horst-Sprite mit drei Größen', () => {
    const def = tables.groundDecor[T('duenengras')];
    expect(def?.sprite.id).toBe(RULE.sprite);
    expect(def?.frames).toHaveLength(DECOR_SIZES.length);
    expect(tables.groundDecor[T('sand')]).toBeNull();
    expect(tables.groundDecor[T('gras')]).toBeNull();
  });

  it('gleiche Horste bei jedem Aufbau; jeder Horst gehört genau dem Chunk, in dem sein Anker liegt', () => {
    const a = decorOf(duneChunk(3, 5));
    expect(a.length).toBeGreaterThan(100);
    expect(decorOf(duneChunk(3, 5))).toEqual(a);
    for (const t of a) {
      expect(Math.floor(t.x / CHUNK_PX)).toBe(3);
      expect(Math.floor(t.y / CHUNK_PX)).toBe(5);
    }
    // The union of four neighbouring chunks is exactly the tufts of the cells, cut by nothing.
    const union = [duneChunk(3, 5), duneChunk(4, 5), duneChunk(3, 6), duneChunk(4, 6)].flatMap((c) => decorOf(c));
    const expected: string[] = [];
    const tufts: DecorTuft[] = [];
    const cell = RULE.cellTiles * TILE;
    for (let gy = Math.floor((5 * CHUNK_PX - 64) / cell); gy <= Math.floor((7 * CHUNK_PX + 64) / cell); gy++) {
      for (let gx = Math.floor((3 * CHUNK_PX - 64) / cell); gx <= Math.floor((5 * CHUNK_PX + 64) / cell); gx++) {
        const n = tuftsOfCell(RULE, gx, gy, tufts);
        for (let k = 0; k < n; k++) {
          const t = tufts[k] as DecorTuft;
          if (t.x >= 3 * CHUNK_PX && t.x < 5 * CHUNK_PX && t.y >= 5 * CHUNK_PX && t.y < 7 * CHUNK_PX) expected.push(`${t.x},${t.y}`);
        }
      }
    }
    expect(union.map((t) => `${t.x},${t.y}`).sort()).toEqual(expected.sort());
  });

  it('nur auf Dünengras, trocken, ohne Welt-Objekt auf der Kachel', () => {
    const tileOf = (t: { x: number; y: number }): number => (Math.floor(t.y / TILE) % CS) * CS + (Math.floor(t.x / TILE) % CS);
    const chunk = duneChunk(0, 0, (c) => {
      for (let i = 0; i < CS * CS; i++) {
        const x = i % CS;
        if (x < 10) c.ground[i] = T('sand');
        else if (x >= 22) c.water[i] = 1;
      }
      c.setObject(15 * CS + 15, O('deko_steinchen'));
    });
    const tufts = decorOf(chunk);
    expect(tufts.length).toBeGreaterThan(0);
    for (const t of tufts) {
      const i = tileOf(t);
      expect(chunk.ground[i]).toBe(T('duenengras'));
      expect(chunk.water[i]).toBe(0);
      expect(i).not.toBe(15 * CS + 15);
    }
    // Other ground carries none.
    const grass = new ChunkData(0, 0, 0);
    grass.ground.fill(T('gras'));
    expect(decorOf(grass)).toEqual([]);
  });

  it('Horste liegen quer über den Kachelgrenzen, dicht beisammen, mit kahlem Sand dazwischen', () => {
    const tufts = decorOf(duneChunk(7, 2));
    // Anchors everywhere inside the tile, not on a grid.
    const inTile = new Set(tufts.map((t) => `${((t.x % TILE) + TILE) % TILE},${((t.y % TILE) + TILE) % TILE}`));
    expect(inTile.size).toBeGreaterThan(60);
    // Clusters span tiles: some cell's tufts stand on several tiles.
    const cells = new Map<string, Set<string>>();
    const cell = RULE.cellTiles * TILE;
    const scratch: DecorTuft[] = [];
    let spanning = 0;
    for (let gy = 2 * 11; gy < 2 * 11 + 8; gy++) {
      for (let gx = 7 * 11; gx < 7 * 11 + 8; gx++) {
        const n = tuftsOfCell(RULE, gx, gy, scratch);
        const tiles = new Set<string>();
        for (let k = 0; k < n; k++) tiles.add(`${Math.floor((scratch[k] as DecorTuft).x / TILE)},${Math.floor((scratch[k] as DecorTuft).y / TILE)}`);
        cells.set(`${gx},${gy}`, tiles);
        if (tiles.size >= 3) spanning++;
      }
    }
    expect(cell).toBe(48);
    expect(spanning).toBeGreaterThan(20);
    expect(cells.size).toBe(64);
    // Density per 4×4-tile block: far more uneven than a uniform random scatter (coefficient of variation
    // ≈ 0,25 at this mean) – sparse blocks next to dense clumps.
    const BLOCK = 4 * TILE;
    const x0 = 7 * CHUNK_PX;
    const y0 = 2 * CHUNK_PX;
    const counts = new Array<number>((CS / 4) ** 2).fill(0);
    for (const t of tufts) {
      const b = Math.floor((t.y - y0) / BLOCK) * (CS / 4) + Math.floor((t.x - x0) / BLOCK);
      counts[b] = (counts[b] ?? 0) + 1;
    }
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const sd = Math.sqrt(counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length);
    expect(sd / mean).toBeGreaterThan(0.38);
    expect(counts.filter((n) => n <= mean / 3).length).toBeGreaterThanOrEqual(3);
    expect(counts.filter((n) => n >= mean * 1.6).length).toBeGreaterThanOrEqual(3);
  });

  it('zeichnet die Horste flach auf den Boden, mit Wind, nur im Blick', () => {
    const chunk = duneChunk(0, 0);
    const layer = new WorldObjectLayer(tables);
    const sigs = new ChunkSignatures();
    sigs.beginFrame();
    const scene = new RenderScene();
    scene.beginFrame(0);
    const view = { layer: 0 as const, chunks: { get: (_l: number, cx: number, cy: number) => (cx === 0 && cy === 0 ? chunk : undefined) }, signatures: sigs, left: 0, top: 0, right: 160, bottom: 100, fadeX: 0, fadeY: 0, fadeRadius: 0 };
    layer.emit(scene, view);
    const all = decorOf(chunk).filter((t) => t.x >= -8 && t.x <= 168 && t.y >= 0 && t.y <= 110);
    expect(layer.stats.decor).toBeGreaterThan(0);
    expect(layer.stats.decor).toBeLessThanOrEqual(all.length);
    expect(layer.stats.decor).toBeGreaterThanOrEqual(decorOf(chunk).filter((t) => t.x >= 8 && t.x <= 152 && t.y >= 8 && t.y <= 100).length);
  });
});
