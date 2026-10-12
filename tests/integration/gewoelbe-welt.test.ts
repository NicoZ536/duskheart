/**
 * The vaults in a generated world (M7-10, M7-11, M7-16; docs/SPIEL.md §19, ADR-0207): in medium worlds of the acceptance seeds
 * every world has at least three planned Grünhain vaults (§32 "≥ 3 Grünhain-Gewölbe je Mittel"), each solvable on its tiles
 * (`planReachable`: every room, every key before its lock, the end behind its gates), the twelve ember shard slots are reserved
 * over the vault slots of all biomes and the Grünhain vaults hold their share; the nearest Grünhain vault shows four puzzle
 * types; the plans are the step's pure function. On the tiles: layer −1 carries exactly the vault's raster in its box, no cave
 * touches the box (a ring of rock around it), no cave entrance lies near it, the surface entrance leads down
 * (`TILE_FLAG_STAIRS`, a link of kind `gewoelbe`) onto the open way up of the start room (`TILE_FLAG_RAMP`); the box carries the
 * biome of the entrance.
 * M7-97: over the vaults of the three worlds every kind of guard (mini-boss, construct, trap spirit, mimic) stands in at least
 * its share of the vaults (`BALANCE.vaults.guardShareMin`), and in every world each biome's vaults together show every kind.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/content/balance';
import { generateChunk } from '../../src/world/gen/chunk';
import { planReachable, planVaults, shardSlots, VAULT_GUARDS, vaultPlansHash, vaultRaster } from '../../src/world/gen/vaults/index';
import { generateWorld, type GeneratedWorld } from '../../src/world/gen/world';
import { TILE_FLAG_PLACE, TILE_FLAG_RAMP, TILE_FLAG_STAIRS, type ChunkData } from '../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, type Layer } from '../../src/world/model/coords';
import { contentWorldIdTables } from '../../src/world/model/runtimeIds';
import { WORLD_TIMEOUT_MS } from '../unit/world/weltgen-hilfen';
import { createSimulation } from '../../src/game/setup';
import type { PlayerSystem } from '../../src/game/player/system';
import { EMPTY_GEWOELBE_FACTS, gewoelbeFacts, gewoelbeFactsSchema, playGewoelbe } from '../../tools/save/fixtureM7/gewoelbe';

/** The first three seeds of the acceptance (tests/integration/weltgen-validierung.test.ts). */
const SEEDS = [20260924, 20260924 + 7_368_787, 20260924 + 2 * 7_368_787];

/** The worlds of the seeds, generated once per file (the step's checks and the guard shares read the same worlds). */
const WORLDS = new Map<number, GeneratedWorld>();
function world(seed: number): GeneratedWorld {
  let w = WORLDS.get(seed);
  if (w === undefined) {
    w = generateWorld(seed, 'medium');
    WORLDS.set(seed, w);
  }
  return w;
}

function tiles(world: GeneratedWorld): (layer: Layer, tx: number, ty: number) => { chunk: ChunkData; i: number } {
  const cache = new Map<string, ChunkData>();
  return (layer, tx, ty) => {
    const key = `${layer},${tx >> CHUNK_SHIFT},${ty >> CHUNK_SHIFT}`;
    let chunk = cache.get(key);
    if (chunk === undefined) {
      chunk = generateChunk(world, layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
      cache.set(key, chunk);
    }
    return { chunk, i: ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK) };
  };
}

describe('vaults in a generated world (Mittel)', () => {
  it.each(SEEDS)(
    'seed %i: ≥ 3 solvable Grünhain vaults, 12 ember shard slots, the nearest vault with four puzzle types',
    (seed) => {
      const w = world(seed);
      expect(w.report.problems).toEqual([]);
      const clearing = { ...w.spawn, radius: BALANCE.places.startClearTiles };
      const gruen = w.vaults.filter((v) => v.biome === 'gruenhain');
      expect(gruen.length).toBeGreaterThanOrEqual(3);
      for (const v of w.vaults) {
        expect(planReachable(v), `vault @${v.slot}`).toBe(true);
        const slot = w.locations[v.slot];
        expect(slot?.type).toBe('gewoelbe');
        // Outside the start clearing, the box inside the world.
        expect(Math.hypot((slot?.x ?? 0) - w.spawn.x, (slot?.y ?? 0) - w.spawn.y) - (slot?.radius ?? 0)).toBeGreaterThanOrEqual(clearing.radius);
        expect(v.box.w).toBe(BALANCE.vaults.boxTiles);
        expect(v.traps.length, `traps @${v.slot}`).toBeGreaterThanOrEqual(BALANCE.vaults.trapsMin);
        expect(v.chests.some((c) => c.tier === 3), `end chest @${v.slot}`).toBe(true);
      }
      // §21 "Glutsplitter: 12 in der Welt": reserved over the vault slots of every biome, the Grünhain vaults hold theirs.
      const shards = shardSlots(w.locations, clearing);
      expect(shards.size).toBe(BALANCE.vaults.emberShards);
      const gruenShardSlots = [...shards].filter((id) => w.locations[id]?.biome === 'gruenhain');
      expect(gruenShardSlots.length).toBeGreaterThan(0);
      expect(gruen.filter((v) => v.shard !== null).map((v) => v.slot).sort()).toEqual(gruenShardSlots.filter((id) => gruen.some((v) => v.slot === id)).sort());
      // §32 "1 Gewölbe mit ≥ 4 Rätseltypen": the Grünhain vault nearest the start.
      const nearest = [...gruen].sort((a, b) => Math.hypot(a.entrance.tx - w.spawn.x, a.entrance.ty - w.spawn.y) - Math.hypot(b.entrance.tx - w.spawn.x, b.entrance.ty - w.spawn.y))[0];
      expect(new Set(nearest?.puzzles.map((p) => p.type)).size).toBeGreaterThanOrEqual(BALANCE.vaults.nearestPuzzleTypes);
      // The step is a pure function of seed, slots, layouts and content.
      expect(vaultPlansHash(planVaults(w.seed, w.preset, w.locations, w.placeLayouts, clearing))).toBe(vaultPlansHash(w.vaults));
    },
    WORLD_TIMEOUT_MS,
  );

  it(
    'M7-97: every kind of guard stands in its share of the vaults, and every biome shows every kind',
    () => {
      const vaults = SEEDS.flatMap((seed) => world(seed).vaults);
      const shares: Record<string, number> = {};
      for (const [kind, id] of Object.entries(VAULT_GUARDS)) {
        shares[kind] = vaults.filter((v) => v.guards.some((g) => g.creature === id)).length / vaults.length;
        expect(shares[kind], `${kind} (${id})`).toBeGreaterThanOrEqual(BALANCE.vaults.guardShareMin[kind as keyof typeof VAULT_GUARDS]);
      }
      // The mini-boss stands in the end chamber, marked as such; the others are no bosses.
      for (const v of vaults) for (const g of v.guards) expect(g.boss, `${g.creature} @${v.slot}`).toBe(g.creature === VAULT_GUARDS.boss);
      for (const seed of SEEDS) {
        const w = world(seed);
        for (const biome of new Set(w.vaults.map((v) => v.biome))) {
          const held = new Set(w.vaults.filter((v) => v.biome === biome).flatMap((v) => v.guards.map((g) => g.creature)));
          expect([...held].sort(), `seed ${seed} ${biome}`).toEqual(Object.values(VAULT_GUARDS).sort());
        }
      }
    },
    WORLD_TIMEOUT_MS * 2,
  );

  it(
    'layer −1 carries each vault in its box, the caves keep out of it, the surface entrance leads down onto the way up',
    () => {
      const w = world(SEEDS[0] as number);
      const at = tiles(w);
      const terrain = contentWorldIdTables().terrain;
      const objects = contentWorldIdTables().objects;
      const biomes = contentWorldIdTables().biomes;
      expect(w.underground.reserved).toBe(w.vaults);
      // Every vault's way down is a link of kind `gewoelbe` (surface → −1) at its entrance.
      expect(w.underground.links.filter((l) => l.kind === 'gewoelbe').map((l) => [l.upper, l.lower, l.tx, l.ty])).toEqual(w.vaults.map((v) => [0, -1, v.entrance.tx, v.entrance.ty]));
      for (const v of w.vaults) {
        const r = vaultRaster(v);
        const { x0, y0, w: bw, h: bh } = v.box;
        let ringOpen = 0;
        for (let ty = y0 - 1; ty <= y0 + bh; ty++) {
          for (let tx = x0 - 1; tx <= x0 + bw; tx++) {
            const { chunk, i } = at(-1, tx, ty);
            const inside = tx >= x0 && ty >= y0 && tx < x0 + bw && ty < y0 + bh;
            if (!inside) {
              if (chunk.solid[i] === 0) ringOpen++;
              continue;
            }
            const ri = (ty - y0) * bw + (tx - x0);
            expect(chunk.solid[i] === 0, `open @${tx},${ty}`).toBe(r.solid[ri] === 0);
            if (r.solid[ri] === 1) expect(terrain.stringId(chunk.solid[i] as number)).toBe(r.wallTerrain);
            expect(terrain.stringId(chunk.ground[i] as number)).toBe(r.floorTerrain);
            const o = r.object[ri] ?? null;
            expect(chunk.object[i] === 0 ? null : objects.stringId(chunk.object[i] as number), `object @${tx},${ty}`).toBe(o);
            expect((chunk.flags[i] as number) & TILE_FLAG_PLACE).not.toBe(0);
            expect(biomes.stringId(chunk.biome[i] as number)).toBe(v.biome);
          }
        }
        expect(ringOpen, `cave tiles touching the box of vault @${v.slot}`).toBe(0);
        // No natural cave entrance beside the box (its access chamber would carve into it).
        for (const l of w.underground.links) {
          if (l.kind !== 'eingang') continue;
          expect(l.tx < x0 - 1 || l.ty < y0 - 1 || l.tx > x0 + bw || l.ty > y0 + bh, `entrance ${l.id} in box @${v.slot}`).toBe(true);
        }
        const up = at(0, v.entrance.tx, v.entrance.ty);
        const down = at(-1, v.entrance.tx, v.entrance.ty);
        expect((up.chunk.flags[up.i] as number) & TILE_FLAG_STAIRS).not.toBe(0);
        expect((down.chunk.flags[down.i] as number) & TILE_FLAG_RAMP).not.toBe(0);
        expect([down.chunk.solid[down.i], down.chunk.water[down.i]]).toEqual([0, 0]);
      }
    },
    WORLD_TIMEOUT_MS,
  );
});

describe('the vault part of the reference save (tools/save/fixtureM7/gewoelbe.ts)', () => {
  it(
    'nur über Befehle: ein Gewölbe betreten, ein Rätsel gelöst, seine Tür offen, wieder oben',
    () => {
      const sim = createSimulation({ seed: 3, worldSize: 'small' });
      expect(gewoelbeFacts(sim)).toEqual(EMPTY_GEWOELBE_FACTS);
      sim.step([{ type: 'player.spawn' }]);
      playGewoelbe(sim);
      const facts = gewoelbeFactsSchema.parse(gewoelbeFacts(sim));
      expect(facts.gewoelbe).toHaveLength(1);
      const g = facts.gewoelbe[0];
      expect(g?.solved).toHaveLength(1);
      expect(g?.doorsOpen.length ?? 0).toBeGreaterThanOrEqual(1);
      // The guard kill took the mini-boss too; the end chest stays closed, so the vault is not conquered.
      expect(g).toMatchObject({ completed: false, shardTaken: false, bossDefeated: true });
      // Back on the surface.
      expect((sim.system('player') as PlayerSystem).body(sim)?.layer).toBe(0);
    },
    WORLD_TIMEOUT_MS,
  );
});
