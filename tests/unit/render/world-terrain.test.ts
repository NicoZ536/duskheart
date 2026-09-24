/**
 * M2-28: world terrain – render tables from the game atlas and the content, the static chunk mesh
 * (ground stack after the transition rule, full-tile variants, cliffs 16 px per level, ramps,
 * water depth and shore, waterfalls, cave rock, ambient occlusion, biome crossfade, seamless chunk
 * borders), the palette ramp shifts of the shading and the content signatures that decide rebuilds.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { AtlasManifest } from '../../../src/render/assets/atlas';
import { darkerIndices, lighterIndices } from '../../../src/render/world/shading';
import { ChunkSignatures, chunkSignature } from '../../../src/render/world/signature';
import { BLOB_FRAMES, CLIFF_FRAMES, TERRAIN_FRAME_SLOTS, WorldRenderTables } from '../../../src/render/world/tables';
import { AO_BIT, decodeShade, TERRAIN_FLAG, TERRAIN_INSTANCE_STRIDE, TERRAIN_KIND, TERRAIN_OFFSET, TerrainMeshBuilder, type TerrainMeshData } from '../../../src/render/world/terrainMesh';
import type { ChunkLookup } from '../../../src/render/world/window';
import { BLOB_VOLL, KLIPPE_FRAME, KLIPPEN_GRUPPEN, TERRAIN_REIHENFOLGE, wandAn, type KlippenUmgebung } from '../../../src/world/autotile';
import { ChunkData, TILE_FLAG_RAMP, WATER_DEPTH_DEEP, WATER_DEPTH_SHALLOW, WATER_RIVER } from '../../../src/world/model/chunk';
import type { Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { TERRAIN } from '../../../src/content/terrain';
import { generateWorld, type GeneratedWorld } from '../../../src/world/gen/world';
import { generateChunk } from '../../../src/world/gen/chunk';
import { WORLD_SCENE_PRESET, WORLD_SCENE_SEED } from '../../../src/render/world/worldHost';
import { surfaceShowcase } from '../../../src/render/world/showcase';

const ids = contentWorldIdTables();
const T = (id: string): number => ids.terrain.runtimeId(id);
const B = (id: string): number => ids.biomes.runtimeId(id);
const O = (id: string): number => ids.objects.runtimeId(id);
const CS = 32;

function manifest(): AtlasManifest {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
}

/** A 3×3 block of surface chunks around (0, 0) filled by `tile(tx, ty, chunk, i)`. */
class Fixture implements ChunkLookup {
  readonly chunks = new Map<string, ChunkData>();

  constructor(
    readonly layer: Layer,
    fill: (tx: number, ty: number, c: ChunkData, i: number) => void,
    readonly radius = 1,
  ) {
    for (let cy = -radius; cy <= radius; cy++) {
      for (let cx = -radius; cx <= radius; cx++) {
        const c = new ChunkData(layer, cx, cy);
        for (let i = 0; i < CS * CS; i++) {
          c.ground[i] = T(layer === 0 ? 'gras' : 'hoehlenboden');
          c.biome[i] = B(layer === 0 ? 'gruenhain' : 'wurzelhoehlen');
          fill(cx * CS + (i % CS), cy * CS + Math.floor(i / CS), c, i);
        }
        this.chunks.set(`${cx},${cy}`, c);
      }
    }
  }

  get(layer: Layer, cx: number, cy: number): ChunkData | undefined {
    return layer === this.layer ? this.chunks.get(`${cx},${cy}`) : undefined;
  }

  centre(): ChunkData {
    return this.chunks.get('0,0') as ChunkData;
  }
}

interface Inst {
  x: number;
  y: number;
  row: number;
  flags: number;
  ax: number;
  ay: number;
  shade: ReturnType<typeof decodeShade>;
  blendRow: number;
  blendMask: number;
}

function instances(m: TerrainMeshData): Inst[] {
  const u16 = new Uint16Array(m.data.buffer, m.data.byteOffset, m.data.byteLength / 2);
  const out: Inst[] = [];
  for (let k = 0; k < m.count; k++) {
    const o = k * TERRAIN_INSTANCE_STRIDE;
    out.push({
      x: m.data[o] ?? 0,
      y: m.data[o + 1] ?? 0,
      row: m.data[o + 2] ?? 0,
      flags: m.data[o + 3] ?? 0,
      ax: u16[(o + TERRAIN_OFFSET.rect) / 2] ?? 0,
      ay: u16[(o + TERRAIN_OFFSET.rect) / 2 + 1] ?? 0,
      shade: decodeShade(m.data.subarray(o + TERRAIN_OFFSET.shade, o + TERRAIN_OFFSET.shade + 4)),
      blendRow: m.data[o + TERRAIN_OFFSET.blend] ?? 0,
      blendMask: m.data[o + TERRAIN_OFFSET.blend + 1] ?? 0,
    });
  }
  return out;
}

const at = (list: Inst[], x: number, y: number): Inst[] => list.filter((i) => i.x === x && i.y === y);

let tables: WorldRenderTables;
let builder: TerrainMeshBuilder;

beforeAll(() => {
  tables = new WorldRenderTables(manifest());
  builder = new TerrainMeshBuilder(tables);
});

describe('Palettenrampen-Schritte der Schattierung', () => {
  it('moves each index one step along its own ramp; the ends stay', () => {
    const ramps = [{ size: 3 }, { size: 2 }];
    expect(darkerIndices(ramps)).toEqual([1, 1, 2, 4, 4]);
    expect(lighterIndices(ramps)).toEqual([2, 3, 3, 5, 5]);
    const d = darkerIndices();
    expect(d).toHaveLength(64);
    d.forEach((v, i) => expect(v).toBeLessThanOrEqual(i + 1));
  });
});

describe('Welt-Darstellungstabellen', () => {
  it('draws every ground type of the content (tileset in the atlas, transition rank) with its variant weights', () => {
    expect(tables.missingTilesets).toEqual([]);
    for (const t of TERRAIN) {
      if (t.tileset === null || t.tileset === undefined) continue;
      const rid = T(t.id);
      expect(tables.hasTileset[rid], t.id).toBe(1);
      expect(tables.variantCount[rid], t.id).toBe(t.tileset.variantWeights.length);
      expect(tables.variantMirror[rid], t.id).toBe(t.tileset.mirror ? 1 : 0);
    }
    for (const id of TERRAIN_REIHENFOLGE) expect(tables.hasTileset[T(id)], id).toBe(1);
    expect(tables.hasTileset[T('fels')]).toBe(0);
  });

  it('maps biomes to their palette row and cliff group, objects to sprites with rules', () => {
    const m = tables.manifest;
    expect(m.paletteRows[tables.biomeRow[B('frostkamm')] ?? 0]?.name).toBe('biom_frostkamm');
    expect(KLIPPEN_GRUPPEN[tables.biomeCliff[B('frostkamm')] ?? 0]).toBe('stein');
    expect(KLIPPEN_GRUPPEN[tables.biomeCliff[B('glutsand')] ?? 0]).toBe('sand');
    for (const id of ids.objects.ids()) expect(tables.objects[O(id)]?.sprite.id, id).toBe(id);
    const oak = tables.objects[O('baum_eiche')];
    expect(oak?.canopy).toBe(true);
    expect(oak?.wind).toBeGreaterThan(0);
    expect(oak?.footprintW).toBe(2);
    expect(oak?.seasonFrames[3]).not.toBe(oak?.seasonFrames[1]);
    expect(m.paletteRows[tables.objectRow(oak as NonNullable<typeof oak>, 1, B('gruenhain'))]?.name).toBe('sommer');
    const moss = tables.objects[O('deko_moos')];
    expect(moss?.layer).toBe('ground');
    expect(moss?.variants).toBeGreaterThan(1);
    expect(m.paletteRows[tables.objectRow(moss as NonNullable<typeof moss>, 1, B('nebelmoor'))]?.name).toBe('biom_nebelmoor');
    const rock = tables.objects[O('fels_klein_glutsand')];
    expect(tables.objectRow(rock as NonNullable<typeof rock>, 0, B('glutsand'))).toBe(0);
  });
});

describe('Chunk-Mesh des Terrains', () => {
  it('a flat meadow: one full-tile variant per tile, no occlusion, weighted variants spread', () => {
    const f = new Fixture(0, () => undefined);
    const list = instances(builder.build(f.centre(), f));
    expect(list).toHaveLength(CS * CS);
    const variants = new Set(list.map((i) => `${i.ax},${i.ay}`));
    expect(variants.size).toBe(tables.variantCount[T('gras')]);
    for (const i of list) {
      expect(i.shade.kind).toBe(TERRAIN_KIND.ground);
      expect(i.shade.ao).toBe(0);
      expect(i.row).toBe(tables.biomeRow[B('gruenhain')]);
    }
    // The same data gives the same mesh (the variants come from the world tile position).
    const again = builder.build(f.centre(), f);
    expect(Array.from(again.data)).toEqual(Array.from(builder.build(f.centre(), f).data));
  });

  it('a plateau: rim frames on its edge, 16 px wall pieces below its south edge, occlusion at the foot', () => {
    // Level 2 on tiles 10…19 × 5…12: the south edge (row 12) drops two levels onto rows 13 and 14.
    const f = new Fixture(0, (tx, ty, c, i) => {
      if (tx >= 10 && tx < 20 && ty >= 5 && ty < 13) c.height[i] = 2;
    });
    const list = instances(builder.build(f.centre(), f));
    const walls = list.filter((i) => i.shade.kind === TERRAIN_KIND.wall);
    // Two rows of wall under ten columns.
    expect(walls).toHaveLength(20);
    for (const w of walls) {
      expect(w.y === 13 || w.y === 14).toBe(true);
      expect(w.shade.wallRow).toBe(w.y - 12);
      expect(w.shade.wallHeight).toBe(2);
      expect(w.shade.level).toBe(0);
    }
    // The rim sits on the plateau's edge tiles (not in its interior).
    const rims = list.filter((i) => i.shade.kind === TERRAIN_KIND.rim);
    expect(rims.length).toBeGreaterThanOrEqual(2 * 10 + 2 * 8 - 4);
    expect(rims.every((r) => r.x >= 10 && r.x < 20 && r.y >= 5 && r.y < 13 && (r.x === 10 || r.x === 19 || r.y === 5 || r.y === 12))).toBe(true);
    expect(at(list, 15, 8).every((i) => i.shade.level === 2 && i.shade.kind === TERRAIN_KIND.ground)).toBe(true);
    // Wall frames come from the Grünhain cliff group; the foot below and the ground beside the plateau are shaded.
    const group = KLIPPEN_GRUPPEN.indexOf('gruen');
    const f0 = walls[0] as Inst;
    const cliffFrames = new Set(Array.from({ length: CLIFF_FRAMES }, (_, k) => `${tables.cliffFrameX[group * CLIFF_FRAMES + k]},${tables.cliffFrameY[group * CLIFF_FRAMES + k]}`));
    expect(cliffFrames.has(`${f0.ax},${f0.ay}`)).toBe(true);
    expect((at(list, 15, 15)[0]?.shade.ao ?? 0) & AO_BIT.n).toBe(AO_BIT.n);
    expect((at(list, 9, 8)[0]?.shade.ao ?? 0) & AO_BIT.e).toBe(AO_BIT.e);
    expect((at(list, 15, 4)[0]?.shade.ao ?? 0) & AO_BIT.s).toBe(AO_BIT.s);
    expect(at(list, 15, 20)[0]?.shade.ao).toBe(0);
  });

  it('matches the autotiler: a tile is a wall piece exactly where wandAn finds one', () => {
    const f = new Fixture(0, (tx, ty, c, i) => {
      c.height[i] = Math.max(0, Math.min(4, Math.floor(((tx * 7 + ty * 3) % 23) / 6) - (ty % 5 === 0 ? 1 : 0)));
    });
    const list = instances(builder.build(f.centre(), f));
    const c = f.centre();
    for (let y = 0; y < CS; y++) {
      for (let x = 0; x < CS; x++) {
        const u: KlippenUmgebung = {
          hoehe: (dx, dy) => {
            const cx = Math.floor((x + dx) / CS);
            const cy = Math.floor((y + dy) / CS);
            const ch = f.get(0, cx, cy) ?? c;
            return ch.height[((y + dy) - cy * CS) * CS + ((x + dx) - cx * CS)] ?? 0;
          },
          uebergang: () => 0,
        };
        const expected = wandAn(u) !== null;
        const got = at(list, x, y).some((i) => i.shade.kind === TERRAIN_KIND.wall);
        expect(got, `(${x}, ${y})`).toBe(expected);
      }
    }
  });

  it('ramps: the flagged edge turns its wall column into a ramp', () => {
    const f = new Fixture(0, (tx, ty, c, i) => {
      if (ty < 10) c.height[i] = 1;
      if (ty === 9 && tx === 16) c.flags[i] = TILE_FLAG_RAMP;
    });
    const list = instances(builder.build(f.centre(), f));
    expect(at(list, 16, 10).some((i) => i.shade.kind === TERRAIN_KIND.ramp)).toBe(true);
    expect(at(list, 15, 10).some((i) => i.shade.kind === TERRAIN_KIND.wall)).toBe(true);
  });

  it('water: sea floor frames with the water flag, depth growing away from the shore; a river over a wall falls', () => {
    const f = new Fixture(0, (tx, ty, c, i) => {
      if (tx >= 4 && tx < 15 && ty >= 4 && ty < 15) c.water[i] = WATER_RIVER | (tx >= 6 && tx < 13 && ty >= 6 && ty < 13 ? WATER_DEPTH_DEEP : WATER_DEPTH_SHALLOW);
      // A plateau with a river running south over its edge (column 25) into a pool.
      if (ty < 20 && tx >= 20) c.height[i] = 1;
      if (tx === 25 && ty >= 15 && ty < 24) c.water[i] = WATER_RIVER | WATER_DEPTH_SHALLOW;
    });
    const list = instances(builder.build(f.centre(), f));
    const water = list.filter((i) => (i.flags & TERRAIN_FLAG.water) !== 0 && i.shade.kind === TERRAIN_KIND.ground);
    expect(water.length).toBeGreaterThan(0);
    const sea = new Set<string>();
    for (let v = 0; v < TERRAIN_FRAME_SLOTS; v++) sea.add(`${tables.terrainFrameX[T('meeresgrund') * TERRAIN_FRAME_SLOTS + v]},${tables.terrainFrameY[T('meeresgrund') * TERRAIN_FRAME_SLOTS + v]}`);
    expect(water.every((i) => sea.has(`${i.ax},${i.ay}`))).toBe(true);
    const deep = at(list, 9, 9).find((i) => (i.flags & TERRAIN_FLAG.water) !== 0);
    const shore = at(list, 4, 9).find((i) => (i.flags & TERRAIN_FLAG.water) !== 0);
    expect(Math.min(...(deep?.shade.corners ?? [0]))).toBeGreaterThanOrEqual(2);
    expect(Math.min(...(shore?.shade.corners ?? [9]))).toBeLessThanOrEqual(1);
    // The land tile beside the lake shows the shallow bank under its grass edge.
    const bank = at(list, 3, 9);
    expect(bank.length).toBeGreaterThanOrEqual(2);
    expect(bank[0]?.flags ?? 0).toBe(TERRAIN_FLAG.water);
    expect(at(list, 25, 20).some((i) => i.shade.kind === TERRAIN_KIND.waterfall && (i.flags & TERRAIN_FLAG.water) !== 0)).toBe(true);
    expect(at(list, 24, 20).some((i) => i.shade.kind === TERRAIN_KIND.wall)).toBe(true);
  });

  it('caves: rock over rock shows its top with a rim, rock over open floor its 16 px face; the floor beside rock is shaded', () => {
    const f = new Fixture(-1, (tx, ty, c, i) => {
      if (tx >= 8 && tx < 16 && ty >= 8 && ty < 14) c.solid[i] = T('fels');
    });
    const list = instances(builder.build(f.centre(), f));
    expect(at(list, 10, 10).some((i) => i.shade.kind === TERRAIN_KIND.rockTop && i.shade.level === 1)).toBe(true);
    expect(at(list, 10, 13).some((i) => i.shade.kind === TERRAIN_KIND.wall && i.shade.wallRow === 1 && i.shade.wallHeight === 1)).toBe(true);
    expect(at(list, 10, 12).some((i) => i.shade.kind === TERRAIN_KIND.rim)).toBe(true);
    expect(at(list, 10, 10).some((i) => i.shade.kind === TERRAIN_KIND.rim)).toBe(false);
    expect((at(list, 10, 14)[0]?.shade.ao ?? 0) & AO_BIT.n).toBe(AO_BIT.n);
    expect((at(list, 7, 10)[0]?.shade.ao ?? 0) & AO_BIT.e).toBe(AO_BIT.e);
    // The cave biome's cliff group.
    const face = at(list, 10, 13).find((i) => i.shade.kind === TERRAIN_KIND.wall) as Inst;
    const g = KLIPPEN_GRUPPEN.indexOf('hoehle');
    const frames = new Set(Array.from({ length: CLIFF_FRAMES }, (_, k) => `${tables.cliffFrameX[g * CLIFF_FRAMES + k]},${tables.cliffFrameY[g * CLIFF_FRAMES + k]}`));
    expect(frames.has(`${face.ax},${face.ay}`)).toBe(true);
  });

  it('is seamless across chunk borders: a transition next door shows on both sides once the neighbour is there', () => {
    const f = new Fixture(0, (tx, _ty, c, i) => {
      if (tx >= CS && tx < CS + 3) c.ground[i] = T('erde');
    });
    const centre = f.centre();
    const withNeighbour = instances(builder.build(centre, f));
    // Grass ranks above dirt: the grass edge of column 31 overlays dirt from the east neighbour.
    expect(at(withNeighbour, 31, 5).length).toBe(2);
    expect(at(withNeighbour, 31, 5)[1]?.shade.kind).toBe(TERRAIN_KIND.ground);
    const alone = instances(builder.build(centre, { get: (_l, cx, cy) => (cx === 0 && cy === 0 ? centre : undefined) }));
    expect(at(alone, 31, 5).length).toBe(1);
    expect(builder.window.neighbours.filter((n) => n !== null)).toHaveLength(1);
  });

  it('dissolves biome borders: tiles next to another biome carry its row and the edges that touch it', () => {
    const f = new Fixture(0, (tx, _ty, c, i) => {
      if (tx >= 16) c.biome[i] = B('frostkamm');
    });
    const list = instances(builder.build(f.centre(), f));
    const west = at(list, 15, 5)[0] as Inst;
    expect(west.row).toBe(tables.biomeRow[B('gruenhain')]);
    expect(west.blendRow).toBe(tables.biomeRow[B('frostkamm')]);
    expect(west.blendMask & AO_BIT.e).toBe(AO_BIT.e);
    expect(west.blendMask & AO_BIT.w).toBe(0);
    const inner = at(list, 5, 5)[0] as Inst;
    expect(inner.blendMask).toBe(0);
  });

  it('skips layers hidden under a full tile and stacks the rest bottom-up', () => {
    const f = new Fixture(0, (tx, ty, c, i) => {
      if (tx === 10 && ty === 10) c.ground[i] = T('sand');
    });
    const list = instances(builder.build(f.centre(), f));
    // The higher terrain draws the edge (docs/ART.md §3): the sand tile is a plain full sand tile, each
    // grass neighbour stacks a sand base and its grass edge over it; far away one grass tile suffices.
    const sandVariants = new Set(Array.from({ length: tables.variantCount[T('sand')] ?? 0 }, (_, v) => `${tables.terrainFrameX[T('sand') * TERRAIN_FRAME_SLOTS + BLOB_FRAMES + v]},${tables.terrainFrameY[T('sand') * TERRAIN_FRAME_SLOTS + BLOB_FRAMES + v]}`));
    const centre = at(list, 10, 10);
    expect(centre).toHaveLength(1);
    expect(sandVariants.has(`${centre[0]?.ax},${centre[0]?.ay}`)).toBe(true);
    for (const [x, y] of [
      [9, 9],
      [11, 10],
      [10, 11],
    ] as const) {
      const stack = at(list, x, y);
      expect(stack, `(${x}, ${y})`).toHaveLength(2);
      expect(sandVariants.has(`${stack[0]?.ax},${stack[0]?.ay}`)).toBe(true);
    }
    expect(at(list, 20, 20)).toHaveLength(1);
  });
});

describe('Inhaltssignatur der Chunks', () => {
  it('changes with tile data and object states and is memoised per frame', () => {
    const c = new ChunkData(0, 0, 0);
    const s0 = chunkSignature(c);
    c.ground[7] = T('sand');
    const s1 = chunkSignature(c);
    expect(s1).not.toBe(s0);
    c.setObject(3, O('baum_eiche'));
    const s2 = chunkSignature(c);
    c.setObjectState(3, 5, 0, 120);
    expect(chunkSignature(c)).not.toBe(s2);
    const sigs = new ChunkSignatures();
    sigs.beginFrame();
    const a = sigs.of(c);
    c.ground[8] = T('sand');
    expect(sigs.of(c)).toBe(a);
    expect(sigs.hashedThisFrame).toBe(1);
    sigs.beginFrame();
    expect(sigs.of(c)).not.toBe(a);
  });
});

describe('Generierte Welt (Seed der Debug-Szenen)', () => {
  let world: GeneratedWorld;
  beforeAll(() => {
    world = generateWorld(WORLD_SCENE_SEED, WORLD_SCENE_PRESET);
  });

  it('meshes the showcase chunks completely: every tile drawn, walls where the height field drops, builds within budget', () => {
    const spot = surfaceShowcase(world, 'gruenhain');
    const cache = new Map<string, ChunkData>();
    const lookup: ChunkLookup = {
      get: (layer, cx, cy) => {
        const k = `${layer}:${cx}:${cy}`;
        let c = cache.get(k);
        if (c === undefined) {
          c = generateChunk(world, layer, cx, cy);
          cache.set(k, c);
        }
        return c;
      },
    };
    const cx = Math.floor(spot.tx / CS);
    const cy = Math.floor(spot.ty / CS);
    let walls = 0;
    const times: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const chunk = lookup.get(0, cx + dx, cy + dy) as ChunkData;
        for (let k = 0; k < 3; k++) builder.build(chunk, lookup);
        const t0 = performance.now();
        const m = builder.build(chunk, lookup);
        times.push(performance.now() - t0);
        const list = instances(m);
        const covered = new Set(list.map((i) => i.y * CS + i.x));
        expect(covered.size).toBe(CS * CS);
        walls += list.filter((i) => i.shade.kind === TERRAIN_KIND.wall).length;
        expect(list.every((i) => i.shade.level <= 4)).toBe(true);
      }
    }
    expect(walls).toBeGreaterThan(0);
    // §30 render preparation: a chunk mesh (≈ 1 300 instances) builds in a few milliseconds (≈ 1 ms warm).
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(8);
  });

  it('uses blob frames only below the variants and full tiles only as variants', () => {
    const chunk = generateChunk(world, 0, 20, 17);
    const list = instances(builder.build(chunk, { get: (l, x, y) => (l === 0 && x === 20 && y === 17 ? chunk : generateChunk(world, l, x, y)) }));
    const full = new Set<string>();
    for (const id of TERRAIN_REIHENFOLGE) {
      const t = T(id);
      full.add(`${tables.terrainFrameX[t * TERRAIN_FRAME_SLOTS + BLOB_VOLL]},${tables.terrainFrameY[t * TERRAIN_FRAME_SLOTS + BLOB_VOLL]}`);
    }
    // Frame 46 (the plain full blob) is replaced by a variant (frames 47+) wherever a full tile shows.
    const variantFrames = new Set<string>();
    for (const id of TERRAIN_REIHENFOLGE) {
      const t = T(id);
      for (let v = 0; v < (tables.variantCount[t] ?? 0); v++) variantFrames.add(`${tables.terrainFrameX[t * TERRAIN_FRAME_SLOTS + BLOB_FRAMES + v]},${tables.terrainFrameY[t * TERRAIN_FRAME_SLOTS + BLOB_FRAMES + v]}`);
    }
    const ground = list.filter((i) => i.shade.kind === TERRAIN_KIND.ground);
    expect(ground.some((i) => variantFrames.has(`${i.ax},${i.ay}`))).toBe(true);
    expect(ground.filter((i) => full.has(`${i.ax},${i.ay}`) && !variantFrames.has(`${i.ax},${i.ay}`))).toHaveLength(0);
    expect(KLIPPE_FRAME.anzahl).toBe(CLIFF_FRAMES);
  });
});
