/**
 * M2-10 acceptance (MASTERPROMPT §9.2.7, §9.3, §14): resources via blue noise and clusters, ores by
 * tier, height and layer, vegetation and ground scatter per biome – minimum amounts per tier.
 * - Plan level (3 seeds × 3 sizes): every resource of every tier reaches its minimum; ore deposits
 *   lie in the biomes of their ore, at a tier whose tools open them, and prefer high ground; every
 *   deposit is a cluster around its centre on one level, in tiles whose biome grows the object.
 * - Chunk level (all chunks of a Klein world): the chunks contain every deposit node; objects stand
 *   only on free dry tiles; blocking objects never overlap or touch and keep an open ring (never cut
 *   a path) – also across chunk borders; every object grows in the biome of its tile; every surface
 *   biome has its vegetation and scatter; transition strips mix the vegetation (taiga between
 *   Grünhain and Frostkamm); the scatter does not repeat with the blue-noise tile.
 * - Layers: the underground chunks (cave generator) hold ore veins only of ores of their layer.
 */
import { describe, expect, it } from 'vitest';
import { ORES } from '../../../src/content/ores';
import { TERRAIN } from '../../../src/content/terrain';
import { WORLD_OBJECTS } from '../../../src/content/worldObjects';
import { BIOMES } from '../../../src/content/biomes';
import { TILE_FLAG_BRIDGE, TILE_FLAG_FORD, TILE_FLAG_PLACE, TILE_FLAG_RAMP, TILE_FLAG_ROAD, TILE_FLAG_STAIRS, type ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_SIZE, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { BLOCK_ALL, CollisionGrid, infoConnector, infoLevel } from '../../../src/world/collision/tiles';
import { createBiomeSample, createTerrainSample, PLAN_BIOME_IDS } from '../../../src/world/gen/plan/index';
import { generateChunk } from '../../../src/world/gen/chunk';
import { createCellInfo } from '../../../src/world/gen/locations';
import { DEPOSIT_OBJECTS, OBJECTS_BY_ID, RESOURCES, depositKind, resourceRequirements } from '../../../src/world/gen/resources';
import { ambientSpecies, VEGETATION } from '../../../src/world/gen/vegetation';
import { generateWorld, type GeneratedWorld } from '../../../src/world/gen/world';
import { createSurfaceContext } from '../../../src/world/gen/worldContext';

const SEEDS = [101, 202, 303];
const PRESETS = ['small', 'medium', 'large'] as const;
/** Generation of three worlds of one size (Groß ≈ 0,9 s each) under parallel test load. */
const TIMEOUT_MS = 60_000;

/** Ore deposits the height statistic needs at least (3 Klein worlds hold ≈ 200). */
const MIN_ORE_DEPOSITS = 100;
/** Share of the predicted height lift the ore deposits must show at least (sampling noise ≈ ¼ of it). */
const HEIGHT_LIFT_SHARE = 0.5;

const ids = contentWorldIdTables();
const hardnessOf = new Map(ORES.map((o) => [`erz_${o.id}`, o.hardness]));

/** Node count per `object@tier` of a world's deposits. */
function nodesPerTier(world: GeneratedWorld): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of world.resources.deposits) {
    const key = `${world.resources.objects[d.object] as string}@${d.tier}`;
    out.set(key, (out.get(key) ?? 0) + d.count);
  }
  return out;
}

describe('Vorkommen im Weltplan (3 Seeds × 3 Größen)', () => {
  for (const preset of PRESETS) {
    describe(preset, () => {
      const worlds = SEEDS.map((seed) => generateWorld(seed, preset));

      it('erreicht die Mindestmenge jeder Ressource auf jeder Stufe', () => {
        for (const w of worlds) {
          const have = nodesPerTier(w);
          const reqs = resourceRequirements(w.plan);
          // Every tier of the world and every deposit object of its biomes is required.
          for (const region of w.plan.regions) {
            for (const id of DEPOSIT_OBJECTS) {
              if (!(OBJECTS_BY_ID.get(id)?.biomes ?? []).includes(region.biome)) continue;
              expect(reqs.some((r) => r.object === id && r.tier === region.tier)).toBe(true);
            }
          }
          for (const r of reqs) expect(have.get(`${r.object}@${r.tier}`) ?? 0, `${r.object} Stufe ${r.tier}`).toBeGreaterThanOrEqual(r.min);
        }
      }, TIMEOUT_MS);

      it('legt Erze nach Stufe an: im Biom des Erzes, auf einer Stufe, deren Werkzeuge es öffnen', () => {
        for (const w of worlds) {
          for (const d of w.resources.deposits) {
            const id = w.resources.objects[d.object] as string;
            const hardness = hardnessOf.get(id);
            if (hardness === undefined) continue;
            const region = w.plan.regions[d.region];
            expect(ORES.find((o) => `erz_${o.id}` === id)?.biomes).toContain(region?.biome);
            expect(d.tier).toBe(region?.tier);
            // Tools of tier t mine hardness ≤ t + 1 (§13.2), and no ore is below its tier.
            expect(d.tier, id).toBeGreaterThanOrEqual(hardness - 1);
            expect(d.tier, id).toBeLessThanOrEqual(hardness);
          }
        }
      }, TIMEOUT_MS);

      it('bevorzugt für Erze die Höhen ihrer Region (so stark wie die Gewichtung)', () => {
        // Observed lift of the ore deposits over the mean level of their region vs the lift the
        // weighting 1 + bias × (level − lowest level) predicts.
        const bias = RESOURCES.kinds.erz.heightBias;
        let observed = 0;
        let expected = 0;
        let n = 0;
        for (const w of worlds) {
          const cells = createCellInfo(createSurfaceContext(w.plan));
          const regions = w.plan.regions.length;
          const low = new Float64Array(regions).fill(Infinity);
          const count = new Float64Array(regions);
          const sum = new Float64Array(regions);
          const weight = new Float64Array(regions);
          const weighted = new Float64Array(regions);
          const walkCells: number[] = [];
          for (let c = 0; c < w.plan.grid.count; c++) {
            const r = w.plan.region[c] as number;
            if (r < 0 || cells.walk[c] !== 1) continue;
            walkCells.push(c);
            low[r] = Math.min(low[r] as number, w.plan.level[c] as number);
          }
          for (const c of walkCells) {
            const r = w.plan.region[c] as number;
            const l = w.plan.level[c] as number;
            const wt = 1 + bias * (l - (low[r] as number));
            count[r] = (count[r] as number) + 1;
            sum[r] = (sum[r] as number) + l;
            weight[r] = (weight[r] as number) + wt;
            weighted[r] = (weighted[r] as number) + wt * l;
          }
          for (const d of w.resources.deposits) {
            if (!hardnessOf.has(w.resources.objects[d.object] as string) || d.rescatter) continue;
            const mean = (sum[d.region] as number) / (count[d.region] as number);
            observed += d.level - mean;
            expected += (weighted[d.region] as number) / (weight[d.region] as number) - mean;
            n++;
          }
        }
        expect(n).toBeGreaterThan(MIN_ORE_DEPOSITS);
        expect(expected / n).toBeGreaterThan(0);
        expect(observed / n).toBeGreaterThan(HEIGHT_LIFT_SHARE * (expected / n));
      }, TIMEOUT_MS);

      it('bildet Cluster: Knoten um das Zentrum, auf einer Höhe, im Biom des Objekts', () => {
        for (const w of worlds) {
          const ctx = createSurfaceContext(w.plan);
          const s = createTerrainSample();
          const res = w.resources;
          for (const d of res.deposits) {
            const id = res.objects[d.object] as string;
            const o = OBJECTS_BY_ID.get(id);
            const kind = o === undefined ? null : depositKind(o);
            expect(kind).not.toBeNull();
            const rule = RESOURCES.kinds[kind ?? 'erz'];
            expect(d.count).toBeGreaterThanOrEqual(rule.nodesMin);
            expect(d.count).toBeLessThanOrEqual(rule.nodesMax);
            for (let k = d.first; k < d.first + d.count; k++) {
              const x = res.nodeX[k] as number;
              const y = res.nodeY[k] as number;
              expect(res.nodeObject[k]).toBe(d.object);
              expect((x - d.x) ** 2 + (y - d.y) ** 2).toBeLessThanOrEqual(rule.radius * rule.radius);
              const t = ctx.terrain.sample(x, y, s);
              expect(t.land && t.water === 0 && t.flags === 0 && t.level === d.level).toBe(true);
              expect(o?.biomes).toContain(PLAN_BIOME_IDS[ctx.biomeAt(x, y)]);
            }
          }
        }
      }, TIMEOUT_MS);
    });
  }
});

/** Every surface chunk of a world, keyed by `cy × n + cx`. */
function allChunks(world: GeneratedWorld): { chunks: Map<number, ChunkData>; n: number } {
  const n = world.plan.grid.tiles / CHUNK_SIZE;
  const chunks = new Map<number, ChunkData>();
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) chunks.set(cy * n + cx, generateChunk(world, 0, cx, cy));
  return { chunks, n };
}

/** Flags that forbid any object on a tile. */
const NO_OBJECT_FLAGS = TILE_FLAG_PLACE | TILE_FLAG_ROAD | TILE_FLAG_BRIDGE | TILE_FLAG_RAMP | TILE_FLAG_STAIRS | TILE_FLAG_FORD;
/** Objects per tile of the whole Klein map (sea included) at least [share]. Land is ≈ 40 %, a tenth of it carries objects. */
const MIN_OBJECT_SHARE = 0.02;
/** Share of blocking anchors that an anchor one blue-noise tile (64 tiles) to the east may share at most, relative to the base rate [factor]. */
const MAX_REPEAT_FACTOR = 2;
/** Blue-noise tile edge [tiles] (src/world/gen/worldContext.ts `CONTEXT.blueNoiseSize`). */
const BLUE_TILE = 64;

describe('Chunks einer Klein-Welt', () => {
  const world = generateWorld(20260924, 'small');
  const { chunks, n } = allChunks(world);
  const tiles = world.plan.grid.tiles;
  const tileOf = (tx: number, ty: number): { chunk: ChunkData; i: number } => ({ chunk: chunks.get(Math.floor(ty / CHUNK_SIZE) * n + Math.floor(tx / CHUNK_SIZE)) as ChunkData, i: (ty % CHUNK_SIZE) * CHUNK_SIZE + (tx % CHUNK_SIZE) });
  const objectAt = (tx: number, ty: number): number => {
    if (tx < 0 || ty < 0 || tx >= tiles || ty >= tiles) return 0;
    const { chunk, i } = tileOf(tx, ty);
    return chunk.object[i] as number;
  };
  const byRuntime = new Map(WORLD_OBJECTS.map((o) => [ids.objects.runtimeId(o.id), o]));

  it('enthält jeden Knoten der Vorkommen; die Mindestmengen gelten auch in den Chunks', () => {
    const res = world.resources;
    const perTier = new Map<string, number>();
    for (const d of res.deposits) {
      const rid = ids.objects.runtimeId(res.objects[d.object] as string);
      for (let k = d.first; k < d.first + d.count; k++) {
        expect(objectAt(res.nodeX[k] as number, res.nodeY[k] as number)).toBe(rid);
        const key = `${res.objects[d.object] as string}@${d.tier}`;
        perTier.set(key, (perTier.get(key) ?? 0) + 1);
      }
    }
    for (const r of resourceRequirements(world.plan)) expect(perTier.get(`${r.object}@${r.tier}`) ?? 0).toBeGreaterThanOrEqual(r.min);
  });

  it('stellt Objekte nur auf freie, trockene Kacheln im Biom des Objekts', () => {
    let objects = 0;
    const lava = ids.terrain.runtimeId('lava');
    const bad: string[] = [];
    for (const chunk of chunks.values()) {
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        const o = chunk.object[i] as number;
        if (o === 0) continue;
        objects++;
        const where = `${chunk.key}#${i} ${ids.objects.stringId(o)}`;
        if (chunk.water[i] !== 0 || ((chunk.flags[i] as number) & NO_OBJECT_FLAGS) !== 0 || chunk.ground[i] === lava) bad.push(`${where}: nicht frei`);
        if (!(byRuntime.get(o)?.biomes ?? []).includes(ids.biomes.stringId(chunk.biome[i] as number))) bad.push(`${where}: fremdes Biom`);
      }
    }
    expect(bad).toEqual([]);
    expect(objects).toBeGreaterThan(tiles * tiles * MIN_OBJECT_SHARE);
  });

  it('blockierende Objekte überlappen und berühren sich nie und lassen einen offenen Ring (auch über Chunkgrenzen)', () => {
    const grid = new CollisionGrid({ chunks: { get: (_l: Layer, cx: number, cy: number) => chunks.get(cy * n + cx) }, worldTiles: tiles });
    const info = new Uint16Array(tiles * tiles);
    grid.fillInfo(0, 0, 0, tiles, tiles, info);
    // Footprint owner per tile (anchor index + 1).
    const owner = new Int32Array(tiles * tiles);
    const anchors: [number, number, number, number][] = [];
    const overlaps: string[] = [];
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        const o = byRuntime.get(objectAt(tx, ty));
        if (o === undefined || !o.blocking) continue;
        anchors.push([tx, ty, o.footprint.w, o.footprint.h]);
        for (let y = ty - o.footprint.h + 1; y <= ty; y++) {
          for (let x = tx; x < tx + o.footprint.w; x++) {
            if (owner[y * tiles + x] !== 0 || ((x !== tx || y !== ty) && objectAt(x, y) !== 0)) overlaps.push(`${x},${y}`);
            owner[y * tiles + x] = anchors.length;
          }
        }
      }
    }
    expect(anchors.length).toBeGreaterThan(0);
    expect(overlaps).toEqual([]);
    let crossings = 0;
    const violations: string[] = [];
    anchors.forEach(([tx, ty, fw, fh], k) => {
      const level = infoLevel(info[ty * tiles + tx] as number);
      if (Math.floor(tx / CHUNK_SIZE) !== Math.floor((tx + fw) / CHUNK_SIZE) || Math.floor((ty - fh) / CHUNK_SIZE) !== Math.floor((ty + 1) / CHUNK_SIZE)) crossings++;
      for (let y = ty - fh; y <= ty + 1; y++) {
        for (let x = tx - 1; x <= tx + fw; x++) {
          if (x >= tx && x < tx + fw && y > ty - fh && y <= ty) continue;
          const j = y * tiles + x;
          // The ring: no other blocking footprint, open ground of the same level (no wall, water, lava, ramp).
          const ringInfo = info[j] as number;
          const { chunk, i } = tileOf(x, y);
          const other = owner[j] !== 0 && owner[j] !== k + 1;
          if (other || (ringInfo & BLOCK_ALL) !== 0 || infoLevel(ringInfo) !== level || infoConnector(ringInfo) || chunk.water[i] !== 0) violations.push(`${tx},${ty}: Ring ${x},${y}`);
        }
      }
    });
    expect(violations).toEqual([]);
    // Rings across chunk borders were checked, too.
    expect(crossings).toBeGreaterThan(0);
  });

  it('jedes Oberflächenbiom hat seine Vegetation und Streudeko', () => {
    const perBiome = new Map<string, Map<string, number>>();
    for (const chunk of chunks.values()) {
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        const o = chunk.object[i] as number;
        if (o === 0) continue;
        const biome = ids.biomes.stringId(chunk.biome[i] as number);
        const kind = byRuntime.get(o)?.kind ?? '';
        const m = perBiome.get(biome) ?? new Map<string, number>();
        m.set(kind, (m.get(kind) ?? 0) + 1);
        perBiome.set(biome, m);
      }
    }
    for (const biome of BIOMES.filter((b) => b.layer === 0).map((b) => b.id)) {
      const density = VEGETATION[biome];
      expect(density, biome).toBeDefined();
      const sp = ambientSpecies(biome);
      const m = perBiome.get(biome);
      expect(m, biome).toBeDefined();
      if ((density?.trees ?? 0) > 0 && sp.trees.length > 0) expect(m?.get('baum') ?? 0, `${biome} Bäume`).toBeGreaterThan(0);
      expect(m?.get('fels') ?? 0, `${biome} Felsen`).toBeGreaterThan(0);
      expect(m?.get('deko') ?? 0, `${biome} Streudeko`).toBeGreaterThan(0);
      if ((density?.plants ?? 0) > 0 && sp.plants.length > 0) expect(m?.get('pflanze') ?? 0, `${biome} Pflanzen`).toBeGreaterThan(0);
    }
  });

  it('mischt die Vegetation in Übergangsstreifen (Taiga zwischen Grünhain und Frostkamm)', () => {
    const ctx = createSurfaceContext(world.plan);
    const sample = createBiomeSample();
    const green = PLAN_BIOME_IDS.indexOf('gruenhain');
    const frost = PLAN_BIOME_IDS.indexOf('frostkamm');
    const trees = new Map<string, number>();
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        const o = byRuntime.get(objectAt(tx, ty));
        if (o?.kind !== 'baum') continue;
        ctx.biomes.sample(tx, ty, sample);
        if (sample.blend <= 0) continue;
        const pair = (sample.primary === green && sample.secondary === frost) || (sample.primary === frost && sample.secondary === green);
        if (pair) trees.set(o.id, (trees.get(o.id) ?? 0) + 1);
      }
    }
    // Broad-leaved trees of the Grünhain next to the firs of the Frostkamm.
    const broadleaf = (trees.get('baum_eiche') ?? 0) + (trees.get('baum_buche') ?? 0) + (trees.get('baum_birke') ?? 0);
    expect(broadleaf).toBeGreaterThan(0);
    expect(trees.get('baum_tanne') ?? 0).toBeGreaterThan(0);
  });

  it('wiederholt die Streuung nicht mit der Blue-Noise-Kachel', () => {
    let anchors = 0;
    let repeated = 0;
    let land = 0;
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx + BLUE_TILE < tiles; tx++) {
        const { chunk, i } = tileOf(tx, ty);
        if (chunk.water[i] !== 0) continue;
        land++;
        const o = byRuntime.get(objectAt(tx, ty));
        if (o === undefined || !o.blocking) continue;
        anchors++;
        if (objectAt(tx + BLUE_TILE, ty) === objectAt(tx, ty)) repeated++;
      }
    }
    const base = anchors / land;
    expect(repeated / anchors).toBeLessThan(MAX_REPEAT_FACTOR * base);
  });
});

describe('Erze nach Ebene', () => {
  it('Untergrund-Chunks führen nur Erzadern der Erze ihrer Ebene', () => {
    const world = generateWorld(4242, 'small');
    const layerBiome: Record<number, string> = { [-1]: 'wurzelhoehlen', [-2]: 'tiefgrund', [-3]: 'glutadern' };
    const veinOre = new Map(TERRAIN.filter((t) => t.id.startsWith('ader_')).map((t) => [ids.terrain.runtimeId(t.id), t.id.slice('ader_'.length)]));
    const n = world.plan.grid.tiles / CHUNK_SIZE;
    for (const layer of [-1, -2, -3] as const) {
      const found = new Set<string>();
      for (let k = 0; k < n * n; k += 7) {
        const chunk = generateChunk(world, layer, k % n, Math.floor(k / n));
        for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
          const ore = veinOre.get(chunk.solid[i] as number);
          if (ore !== undefined) found.add(ore);
        }
      }
      expect(found.size, `Ebene ${layer}`).toBeGreaterThan(0);
      for (const ore of found) expect(ORES.find((o) => o.id === ore)?.biomes, `${ore} auf Ebene ${layer}`).toContain(layerBiome[layer]);
    }
  }, TIMEOUT_MS);
});
