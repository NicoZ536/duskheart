/**
 * M5 review M2 (occluder ring beyond the view): the terrain's occluders are cached per chunk as ready occluder records –
 * `TerrainOccluders.collect` copies a chunk's runs in one block, no arithmetic per frame (§30) – and each record equals
 * what `OccluderList.rect` packs for the same prism run. The chunk cache keeps layers and chunk coordinates apart (its
 * key is a small integer) and rebuilds a chunk only when its content or that of its northern neighbour changes.
 */
import { describe, expect, it } from 'vitest';
import { OCCLUDER_FLOATS, OccluderList } from '../../../src/render/light/occluders';
import { OCCLUDER_CLASS, type OccluderClass } from '../../../src/render/light/params';
import { TerrainOccluders } from '../../../src/render/light/terrainOccluders';
import type { ChunkLookup } from '../../../src/render/world/window';
import { ChunkSignatures } from '../../../src/render/world/signature';
import { WAND_PX_JE_STUFE } from '../../../src/world/autotile';
import { ChunkData } from '../../../src/world/model/chunk';
import type { Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

const ids = contentWorldIdTables();
const GRAS = ids.terrain.runtimeId('gras');
const CS = 32;
const TILE = 16;
const WORLD_TILES = 2 * CS;

/** Layers 0 and −1 of a 2 × 2-chunk world on plain grass. */
function world(): { lookup: ChunkLookup; chunk: (layer: Layer, cx: number, cy: number) => ChunkData } {
  const chunks = new Map<string, ChunkData>();
  for (const layer of [0, -1] as const) {
    for (let cy = 0; cy < 2; cy++) {
      for (let cx = 0; cx < 2; cx++) {
        const c = new ChunkData(layer, cx, cy);
        c.ground.fill(GRAS);
        chunks.set(`${layer}:${cx}:${cy}`, c);
      }
    }
  }
  const chunk = (layer: Layer, cx: number, cy: number): ChunkData => {
    const c = chunks.get(`${layer}:${cx}:${cy}`);
    if (c === undefined) throw new Error(`Chunk ${layer}:${cx}:${cy} fehlt`);
    return c;
  };
  return { lookup: { get: (layer, cx, cy) => chunks.get(`${layer}:${cx}:${cy}`) }, chunk };
}

/** Marks local tiles [col0, col1) of `row` in `c` as solid rock. */
function rock(c: ChunkData, row: number, col0: number, col1: number): void {
  for (let col = col0; col < col1; col++) c.solid[row * CS + col] = 1;
}

/** The records of `list` as arrays of `OCCLUDER_FLOATS` numbers. */
function recordsOf(list: OccluderList): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < list.count; i++) out.push(Array.from(list.records.subarray(i * OCCLUDER_FLOATS, (i + 1) * OCCLUDER_FLOATS)));
  return out;
}

/** The record `OccluderList.rect` packs for a prism run of tiles [tx0, tx1) in tile row `ty`. */
function runRecord(tx0: number, tx1: number, ty: number, top: number, cls: OccluderClass, ground: number): number[] {
  const ref = new OccluderList();
  ref.rect(tx0 * TILE, ty * TILE, tx1 * TILE, (ty + 1) * TILE, top, cls, true, ground);
  return recordsOf(ref)[0] ?? [];
}

function collect(occ: TerrainOccluders, lookup: ChunkLookup, sigs: ChunkSignatures, layer: Layer): number[][] {
  sigs.beginFrame();
  const out = new OccluderList();
  occ.collect(lookup, sigs, WORLD_TILES, layer, 0, 0, WORLD_TILES - 1, WORLD_TILES - 1, out);
  return recordsOf(out);
}

describe('M5-Review M2: Gelände-Verdecker als fertige Datensätze je Chunk', () => {
  it('jeder Lauf ist der Datensatz, den OccluderList.rect für ihn packt (Fels: strukturell, Plateau: Gelände auf seiner Höhe)', () => {
    const w = world();
    rock(w.chunk(0, 1, 0), 3, 4, 8);
    const plateau = w.chunk(0, 0, 1);
    for (let row = 10; row < 13; row++) for (let col = 0; col < 6; col++) plateau.height[row * CS + col] = 1;
    const records = collect(new TerrainOccluders(), w.lookup, new ChunkSignatures(), 0);
    expect(records).toContainEqual(runRecord(CS + 4, CS + 8, 3, WAND_PX_JE_STUFE, OCCLUDER_CLASS.structural, 0));
    for (let row = 10; row < 13; row++) expect(records).toContainEqual(runRecord(0, 6, CS + row, WAND_PX_JE_STUFE, OCCLUDER_CLASS.terrain, WAND_PX_JE_STUFE));
  });

  it('ein unveränderter Chunk wird nicht neu gebaut; eine Änderung baut ihn und seinen südlichen Nachbarn neu', () => {
    const w = world();
    const occ = new TerrainOccluders();
    const sigs = new ChunkSignatures();
    const first = collect(occ, w.lookup, sigs, 0);
    expect(occ.rebuilt).toBe(4);
    expect(collect(occ, w.lookup, sigs, 0)).toEqual(first);
    expect(occ.rebuilt).toBe(0);
    rock(w.chunk(0, 1, 0), 20, 0, 3);
    const changed = collect(occ, w.lookup, sigs, 0);
    // The chunk itself and (1, 1), whose northern neighbour it is.
    expect(occ.rebuilt).toBe(2);
    expect(changed).toContainEqual(runRecord(CS, CS + 3, 20, WAND_PX_JE_STUFE, OCCLUDER_CLASS.structural, 0));
  });

  it('eine Änderung im nördlichen Nachbarn außerhalb des gesammelten Rechtecks baut die Chunks darunter neu', () => {
    const w = world();
    const occ = new TerrainOccluders();
    const sigs = new ChunkSignatures();
    const southRow = (): void => {
      sigs.beginFrame();
      occ.collect(w.lookup, sigs, WORLD_TILES, 0, 0, CS, WORLD_TILES - 1, WORLD_TILES - 1, new OccluderList());
    };
    southRow();
    expect(occ.rebuilt).toBe(2);
    southRow();
    expect(occ.rebuilt).toBe(0);
    // A plateau at the northern chunk's southern edge: the cliff face below it lies in the chunk south of it.
    const north = w.chunk(0, 0, 0);
    for (let col = 0; col < 4; col++) north.height[(CS - 1) * CS + col] = 2;
    southRow();
    expect(occ.rebuilt).toBe(1);
  });

  it('Ebenen mit gleichen Chunk-Koordinaten teilen keinen Cache-Eintrag', () => {
    const w = world();
    rock(w.chunk(0, 0, 0), 5, 2, 4);
    rock(w.chunk(-1, 0, 0), 9, 10, 16);
    const occ = new TerrainOccluders();
    const sigs = new ChunkSignatures();
    const surface = collect(occ, w.lookup, sigs, 0);
    const cave = collect(occ, w.lookup, sigs, -1);
    expect(occ.rebuilt).toBe(4);
    const surfaceRun = runRecord(2, 4, 5, WAND_PX_JE_STUFE, OCCLUDER_CLASS.structural, 0);
    const caveRun = runRecord(10, 16, 9, WAND_PX_JE_STUFE, OCCLUDER_CLASS.structural, 0);
    expect(surface).toContainEqual(surfaceRun);
    expect(surface).not.toContainEqual(caveRun);
    expect(cave).toContainEqual(caveRun);
    expect(cave).not.toContainEqual(surfaceRun);
    // Both layers stay cached side by side.
    expect(collect(occ, w.lookup, sigs, 0)).toEqual(surface);
    expect(occ.rebuilt).toBe(0);
    expect(collect(occ, w.lookup, sigs, -1)).toEqual(cave);
    expect(occ.rebuilt).toBe(0);
  });
});
