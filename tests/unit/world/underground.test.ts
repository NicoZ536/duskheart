/**
 * M2-13 underground layers: plan contract (entrance selection, determinism, structured clone),
 * chunk contract (pure, order-independent, seamless across chunk borders, surface rejected, outside
 * the world solid) and content (every id exists, belongs to the layer biome, every underground
 * object and vein ore of the content is placed; blocking/non-blocking split as the connectivity
 * guarantee assumes).
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { ORES } from '../../../src/content/ores';
import { chunkHash, TILE_FLAG_RAMP, TILE_FLAG_STAIRS, type ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_SIZE } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { worldDimensions } from '../../../src/world/model/worldSize';
import {
  CARVE_OVERLAP,
  LAYER_PARAMS,
  LINKS,
  UNDERGROUND_LAYERS,
  carveRect,
  createUndergroundPlan,
  generateUndergroundChunk,
  generateUndergroundChunkFor,
  layerPlanOf,
  proposeEntranceCandidates,
  selectCaveEntrances,
  undergroundPlanHash,
  type TilePoint,
  type UndergroundInput,
  type UndergroundPlan,
} from '../../../src/world/gen/underground/index';

const SEED = 20260924;

function inputFor(seed: number): UndergroundInput {
  return { seed, preset: 'small', entranceCandidates: proposeEntranceCandidates(seed, 'small') };
}

const PLAN: UndergroundPlan = createUndergroundPlan(inputFor(SEED));

/** A chunk of `layer` that contains carved cave (the chunk of the first link of the layer). */
function caveChunk(plan: UndergroundPlan, layer: -1 | -2 | -3): { cx: number; cy: number } {
  const link = plan.links.find((l) => l.lower === layer);
  if (link === undefined) throw new Error(`no link into layer ${layer}`);
  return { cx: Math.floor(link.tx / CHUNK_SIZE), cy: Math.floor(link.ty / CHUNK_SIZE) };
}

describe('entrances', () => {
  it('keeps the minimum spacing, the cap and the world margin', () => {
    const candidates: TilePoint[] = [];
    for (let y = 0; y < 1024; y += 17) for (let x = 0; x < 1024; x += 19) candidates.push({ tx: x, ty: y });
    const taken = selectCaveEntrances(SEED, 'small', candidates);
    expect(taken.length).toBe(LINKS.entranceMaxCount.small);
    for (const a of taken) {
      expect(a.tx).toBeGreaterThanOrEqual(40);
      expect(a.ty).toBeLessThan(1024 - 40);
      for (const b of taken) if (a !== b) expect(Math.hypot(a.tx - b.tx, a.ty - b.ty)).toBeGreaterThanOrEqual(LINKS.entranceMinSpacingTiles);
    }
  });

  it('does not depend on candidate order or duplicates', () => {
    const c = proposeEntranceCandidates(SEED, 'small');
    const shuffled = [...c].reverse().concat(c.slice(0, 5));
    expect(selectCaveEntrances(SEED, 'small', shuffled)).toEqual(selectCaveEntrances(SEED, 'small', c));
    expect(undergroundPlanHash(createUndergroundPlan({ seed: SEED, preset: 'small', entranceCandidates: shuffled }))).toBe(undergroundPlanHash(PLAN));
  });

  it('rejects non-integer candidates and drops those outside the world or the extent', () => {
    expect(() => selectCaveEntrances(SEED, 'small', [{ tx: 10.5, ty: 300 }])).toThrow(RangeError);
    expect(selectCaveEntrances(SEED, 'small', [{ tx: -5, ty: 300 }, { tx: 2000, ty: 300 }, { tx: 10, ty: 10 }])).toEqual([]);
    // Extent: only the left half of the world is land.
    const width = 128;
    const mask = new Uint8Array(width * width);
    for (let y = 0; y < width; y++) for (let x = 0; x < width / 2; x++) mask[y * width + x] = 1;
    const extent = { cellTiles: 8, width, height: width, mask };
    const taken = selectCaveEntrances(SEED, 'small', [{ tx: 200, ty: 500 }, { tx: 900, ty: 500 }], extent);
    expect(taken).toEqual([{ tx: 200, ty: 500 }]);
  });

  it('turns every accepted entrance into a link from the surface into its own or a shared system', () => {
    const entrances = PLAN.links.filter((l) => l.kind === 'eingang');
    expect(entrances.length).toBeGreaterThanOrEqual(4);
    expect(entrances.map((l) => ({ tx: l.tx, ty: l.ty }))).toEqual(selectCaveEntrances(SEED, 'small', inputFor(SEED).entranceCandidates));
    for (const l of entrances) {
      expect(l.upper).toBe(0);
      expect(l.lower).toBe(-1);
      expect(l.lowerSystem).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('plan', () => {
  it('is deterministic and changes with the seed', () => {
    expect(undergroundPlanHash(createUndergroundPlan(inputFor(SEED)))).toBe(undergroundPlanHash(PLAN));
    expect(undergroundPlanHash(createUndergroundPlan(inputFor(SEED + 1)))).not.toBe(undergroundPlanHash(PLAN));
  });

  it('gives every cave system of every layer at least one link from above, and shafts to −2 and −3', () => {
    for (const layer of UNDERGROUND_LAYERS) {
      const lp = layerPlanOf(PLAN, layer);
      expect(lp.systems.length).toBeGreaterThan(0);
      for (const s of lp.systems) {
        expect(s.links.length).toBeGreaterThanOrEqual(1);
        for (const id of s.links) expect(PLAN.links[id]?.lower).toBe(layer);
      }
      if (layer !== -3) expect(PLAN.links.some((l) => l.kind === 'schacht' && l.upper === layer && l.lower === layer - 1)).toBe(true);
    }
    for (const l of PLAN.links) {
      if (l.kind !== 'schacht') continue;
      const upper = layerPlanOf(PLAN, l.upper as -1 | -2);
      expect(upper.nodes.find((n) => n.link === l.id)?.feature).toBe('abstieg');
      expect(l.upperSystem).toBeGreaterThanOrEqual(0);
      expect(l.lowerSystem).toBeGreaterThanOrEqual(0);
    }
  });

  it('has lakes, special caverns and place slots in every layer', () => {
    for (const layer of UNDERGROUND_LAYERS) {
      const nodes = layerPlanOf(PLAN, layer).nodes;
      const lake = layer === -3 ? 'lavasee' : 'see';
      expect(nodes.some((n) => n.feature === lake), `lake in ${layer}`).toBe(true);
      expect(nodes.some((n) => n.feature === LAYER_PARAMS[layer].special.kind), `special in ${layer}`).toBe(true);
      expect(PLAN.slots.filter((s) => s.layer === layer).length).toBe(LAYER_PARAMS[layer].slots.small);
    }
  });

  it('survives a structured clone (worker transfer) with identical chunks', () => {
    const clone = structuredClone(PLAN);
    const { cx, cy } = caveChunk(PLAN, -1);
    expect(chunkHash(generateUndergroundChunk(clone, -1, cx, cy))).toBe(chunkHash(generateUndergroundChunk(PLAN, -1, cx, cy)));
    expect(undergroundPlanHash(clone)).toBe(undergroundPlanHash(PLAN));
  });

  it('without entrances the underground is solid rock', () => {
    const empty = createUndergroundPlan({ seed: SEED, preset: 'small', entranceCandidates: [] });
    expect(empty.links).toEqual([]);
    for (const layer of UNDERGROUND_LAYERS) {
      const c = generateUndergroundChunk(empty, layer, 10, 10);
      expect(c.solid.every((v) => v !== 0)).toBe(true);
      expect(c.object.every((v) => v === 0)).toBe(true);
    }
  });
});

describe('chunks', () => {
  it('reject the surface layer and are solid outside the world', () => {
    expect(() => generateUndergroundChunk(PLAN, 0, 5, 5)).toThrow(RangeError);
    const outside = generateUndergroundChunk(PLAN, -1, -1, 3);
    expect(outside.solid.every((v) => v !== 0)).toBe(true);
    const far = generateUndergroundChunk(PLAN, -2, worldDimensions('small').chunks, 0);
    expect(far.solid.every((v) => v !== 0)).toBe(true);
  });

  it('are pure: order, fresh plans and the input convenience form give identical hashes', () => {
    const addresses: [-1 | -2 | -3, number, number][] = [];
    for (const layer of UNDERGROUND_LAYERS) {
      const { cx, cy } = caveChunk(PLAN, layer);
      addresses.push([layer, cx, cy], [layer, cx + 1, cy], [layer, cx, cy - 1]);
    }
    const forward = addresses.map(([l, x, y]) => chunkHash(generateUndergroundChunk(PLAN, l, x, y)));
    const fresh = createUndergroundPlan(inputFor(SEED));
    const backward = [...addresses].reverse().map(([l, x, y]) => chunkHash(generateUndergroundChunk(fresh, l, x, y)));
    expect(backward.reverse()).toEqual(forward);
    const input = inputFor(SEED);
    expect(addresses.map(([l, x, y]) => chunkHash(generateUndergroundChunkFor(input, l, x, y)))).toEqual(forward);
  });

  it('meet seamlessly: carving a 3 × 3 chunk block in one piece equals the nine chunks', () => {
    for (const layer of UNDERGROUND_LAYERS) {
      const { cx, cy } = caveChunk(PLAN, layer);
      const x0 = (cx - 1) * CHUNK_SIZE;
      const y0 = (cy - 1) * CHUNK_SIZE;
      const size = 3 * CHUNK_SIZE;
      const block = carveRect(PLAN, layer, x0, y0, size, size);
      let open = 0;
      let mismatches = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const c = generateUndergroundChunk(PLAN, layer, cx + dx, cy + dy);
          for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
            const x = (dx + 1) * CHUNK_SIZE + (i % CHUNK_SIZE);
            const y = (dy + 1) * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
            const blockOpen = block.open[y * size + x] === 1;
            if (blockOpen) open++;
            if (blockOpen !== (c.solid[i] === 0)) mismatches++;
          }
        }
      }
      expect(mismatches, `layer ${layer}`).toBe(0);
      expect(open, `layer ${layer} has caves around its link`).toBeGreaterThan(200);
    }
  });

  it('carving is independent of the window: shifted odd rectangles agree tile by tile', () => {
    const { cx, cy } = caveChunk(PLAN, -1);
    const x0 = cx * CHUNK_SIZE - 7;
    const y0 = cy * CHUNK_SIZE + 5;
    const a = carveRect(PLAN, -1, x0, y0, 45, 23);
    const b = carveRect(PLAN, -1, x0 + 11, y0 - 3, 29, 40);
    let compared = 0;
    for (let y = 0; y < 23; y++) {
      for (let x = 0; x < 45; x++) {
        const bx = x - 11;
        const by = y + 3;
        if (bx < 0 || by < 0 || bx >= 29 || by >= 40) continue;
        expect(a.open[y * 45 + x]).toBe(b.open[by * 29 + bx]);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(300);
    expect(CARVE_OVERLAP).toBeGreaterThan(0);
  });

  it('flag links in both layers and keep the tiles around them open, dry and free of objects', () => {
    const tables = contentWorldIdTables();
    const lava = tables.terrain.runtimeId('lava');
    for (const link of PLAN.links) {
      const layers: [-1 | -2 | -3, number][] = [[link.lower, TILE_FLAG_RAMP]];
      if (link.upper !== 0) layers.push([link.upper, TILE_FLAG_STAIRS]);
      for (const [layer, flag] of layers) {
        const cache = new Map<string, ChunkData>();
        const at = (tx: number, ty: number): { c: ChunkData; i: number } => {
          const cx = Math.floor(tx / CHUNK_SIZE);
          const cy = Math.floor(ty / CHUNK_SIZE);
          const key = `${cx}:${cy}`;
          let c = cache.get(key);
          if (c === undefined) {
            c = generateUndergroundChunk(PLAN, layer, cx, cy);
            cache.set(key, c);
          }
          return { c, i: (ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE) };
        };
        const { c, i } = at(link.tx, link.ty);
        expect((c.flags[i] as number) & flag, `link ${link.id} in ${layer}`).toBe(flag);
        for (let dy = -LINKS.reserveRadius; dy <= LINKS.reserveRadius; dy++) {
          for (let dx = -LINKS.reserveRadius; dx <= LINKS.reserveRadius; dx++) {
            const t = at(link.tx + dx, link.ty + dy);
            expect(t.c.solid[t.i]).toBe(0);
            expect(t.c.water[t.i]).toBe(0);
            expect(t.c.ground[t.i]).not.toBe(lava);
            expect(t.c.object[t.i]).toBe(0);
          }
        }
      }
    }
  });
});

describe('content', () => {
  it('uses existing terrain of the right kind and objects of the layer biome', () => {
    for (const layer of UNDERGROUND_LAYERS) {
      const p = LAYER_PARAMS[layer];
      expect(CONTENT.get('biomes', p.biome).layer).toBe(layer);
      expect(CONTENT.get('terrain', p.hostRock).kind).toBe('fest');
      for (const id of [p.floor, p.lakeRim, p.special.floor, ...p.floorPatches.map((f) => f.terrain)]) expect(CONTENT.get('terrain', id).kind).toBe('boden');
      for (const d of [...p.scatter, ...p.blocking]) expect(CONTENT.get('worldObjects', d.id).biomes).toContain(p.biome);
      // The connectivity guarantee: scatter never blocks, lattice objects always do.
      for (const d of p.scatter) expect(CONTENT.get('worldObjects', d.id).blocking, d.id).toBe(false);
      for (const d of p.blocking) expect(CONTENT.get('worldObjects', d.id).blocking, d.id).toBe(true);
    }
  });

  it('places every world object of the underground biomes and a vein of every vein ore', () => {
    for (const layer of UNDERGROUND_LAYERS) {
      const p = LAYER_PARAMS[layer];
      const placed = new Set([...p.scatter, ...p.blocking].map((d) => d.id));
      const expected = CONTENT.collection('worldObjects')
        .values()
        .filter((o) => o.biomes.includes(p.biome))
        .map((o) => o.id);
      expect([...placed].sort()).toEqual([...expected].sort());
      const veinOres = ORES.filter((o) => o.vein && o.biomes.includes(p.biome)).map((o) => o.id);
      expect(p.veins.map((v) => v.ore).sort()).toEqual([...veinOres].sort());
      for (const v of p.veins) expect(CONTENT.get('terrain', `ader_${v.ore}`).ore).toBe(v.ore);
      for (const ore of p.special.oreBoost) expect(veinOres).toContain(ore);
    }
    // Every vein ore of the content has an underground home.
    const all = new Set(UNDERGROUND_LAYERS.flatMap((l) => LAYER_PARAMS[l].veins.map((v) => v.ore)));
    for (const o of ORES) if (o.vein) expect(all.has(o.id), o.id).toBe(true);
  });

  it('keeps object densities within one pick per candidate tile', () => {
    for (const layer of UNDERGROUND_LAYERS) {
      const p = LAYER_PARAMS[layer];
      const dims = p.blocking.map((d) => CONTENT.get('worldObjects', d.id).footprint);
      const lattice = (Math.max(...dims.map((f) => f.w)) + 1) * (Math.max(...dims.map((f) => f.h)) + 1);
      for (const zone of ['wand', 'frei', 'besonders'] as const) {
        expect(p.scatter.reduce((s, d) => s + d[zone], 0)).toBeLessThanOrEqual(1);
        expect(p.blocking.reduce((s, d) => s + d[zone], 0) * lattice).toBeLessThanOrEqual(1);
      }
    }
  });
});
