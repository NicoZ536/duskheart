/**
 * M3-14 Graben mit Schaufel (MASTERPROMPT §14 "Graben (Schaufel): Erde, Lehm, Sand, Kies, Torf, Schnee;
 * begrenztes Terraforming (Gräben, Wassergräben, Pfade, Felder); versteckte Buddelstellen"): the shovel
 * turns meadow into a path and digs pits in bare ground (yielding the dug material), next to water a dug
 * tile becomes a water ditch, the hoe prepares fields; roads, ramps, water and anything standing are not
 * dug; the first stroke into a hidden dig spot brings up its find. Every change is chunk data and survives
 * saving and loading the world (chunk diffs, M2-27).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { DIG_SPOT_LOOT } from '../../../src/content/digSpots';
import { TILE_FLAG_DUG, TILE_FLAG_ROAD, WATER_DEPTH_MASK, WATER_DEPTH_SHALLOW, chunkHash } from '../../../src/world/model/chunk';
import { BLOCK_ALL } from '../../../src/world/collision/tiles';
import { CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { MemorySaveStore } from '../../../src/save/memoryStore';
import { loadWorld, saveWorld } from '../../../src/save/world';
import { createSimulation } from '../../../src/game/setup';
import { isDigSpot } from '../../../src/game/gathering/formulas';
import { contentGatheringRules } from '../../../src/game/gathering/rules';
import { createHarvestPlan, type GatheringSystem } from '../../../src/game/gathering/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import { field, gatherWorld, OFFSET, type GatherWorld } from './interaktion-testwelt';

const IDS = contentWorldIdTables();

function work(w: GatherWorld, tile?: { tx: number; ty: number }, max = 300): Map<string, unknown[]> {
  const ev = w.runUntil(() => !w.interaction.working, max, [{ type: 'player.interact', on: true, ...(tile ?? {}) }]);
  w.run(1, [{ type: 'player.interact', on: false }]);
  return ev;
}

/** A meadow, the player at map (4, 4) looking up at (4, 3) with `tool` in the hand. */
function digWorld(tool: string, rows: readonly string[] = []): GatherWorld {
  const w = gatherWorld(field(10, 10, rows));
  w.place(4, 4);
  w.body().facing = 'up';
  w.hold(tool);
  w.run(1);
  return w;
}

function flagsAt(w: GatherWorld, x: number, y: number): number {
  const { chunk, i } = w.at(x, y);
  return chunk.flags[i] as number;
}

describe('Graben: Pfade und Gruben', () => {
  it('the dug material comes from the items that declare `graben:<terrain>`', () => {
    const rules = contentGatheringRules();
    const tile = (id: string) => rules.tiles[IDS.terrain.runtimeId(id)];
    expect(tile('gras')).toMatchObject({ tool: 'schaufel', hardness: 1, yieldItem: 'erde', hp: 2 });
    expect(tile('erde')?.yieldItem).toBe('erde');
    expect(tile('sand')?.yieldItem).toBe('sand');
    expect(tile('duenengras')?.yieldItem).toBe('sand');
    expect(tile('lehm')?.yieldItem).toBe('lehm');
    expect(tile('torf')).toMatchObject({ hardness: 2 });
    expect(tile('schnee')?.becomes).toBe(IDS.terrain.runtimeId('erde'));
    expect(tile('strasse')).toBeNull();
  });

  it('the shovel turns meadow into a path in 2 strokes and yields earth', () => {
    const w = digWorld('probe_schaufel');
    expect(w.interaction.focus).toMatchObject({ kind: 'tile', subject: 'gras', action: 'graben', dig: 'pfad', hitsTotal: 2, block: null });
    const ev = work(w);
    expect((ev.get('harvestHit') ?? []).length).toBe(2);
    expect(ev.get('tileDug')).toEqual([expect.objectContaining({ from: 'gras', to: 'erde', result: 'pfad' })]);
    expect(ev.get('harvested')).toEqual([expect.objectContaining({ skill: 'sammeln', xp: 'boden_gegraben', material: 'erde' })]);
    expect(w.groundAt(4, 3)).toBe('erde');
    expect(flagsAt(w, 4, 3) & TILE_FLAG_DUG).toBe(TILE_FLAG_DUG);
    w.collect();
    const earth = w.inventory.count('erde');
    expect(earth).toBeGreaterThanOrEqual(BALANCE.harvest.dig.yieldMin);
    expect(earth).toBeLessThanOrEqual(BALANCE.harvest.dig.yieldMax + 4);
  });

  it('sand gives a pit of sand; dug ground far from water cannot be dug again', () => {
    const w = digWorld('probe_schaufel', ['', '', '', '....S']);
    expect(w.interaction.focus).toMatchObject({ subject: 'sand', dig: 'grube' });
    work(w);
    expect(w.groundAt(4, 3)).toBe('sand');
    w.collect();
    expect(w.inventory.count('sand')).toBeGreaterThanOrEqual(1);
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ kind: 'tile', block: 'alreadyDug' });
    const again = w.run(2, [{ type: 'player.interact', on: true }]);
    expect(again.get('commandRejected')).toEqual([expect.objectContaining({ reason: 'alreadyDug' })]);
  });

  it('peat needs a T1 shovel: "Zu hart" with a stone shovel', () => {
    const w = digWorld('probe_schaufel');
    const { chunk, i } = w.at(4, 3);
    chunk.ground[i] = IDS.terrain.runtimeId('torf');
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ subject: 'torf', tooWeak: true });
    const ev = work(w);
    expect(ev.get('harvestHit')).toEqual([expect.objectContaining({ tooHard: true })]);
    expect(w.groundAt(4, 3)).toBe('torf');
  });

  it('roads, ramps, water and whatever stands on a tile are not dug; loose scatter goes with the soil', () => {
    const road = digWorld('probe_schaufel');
    const r = road.at(4, 3);
    r.chunk.flags[r.i] = TILE_FLAG_ROAD;
    road.run(1);
    expect(road.interaction.focus).toMatchObject({ kind: 'tile', block: 'notDiggable' });
    const water = digWorld('probe_schaufel', ['', '', '', '....s']);
    expect(water.interaction.focus.block).toBe('notDiggable');
    const tree = digWorld('probe_schaufel', ['', '', '', '....E']);
    expect(tree.interaction.focus).toMatchObject({ kind: 'object', subject: 'baum_eiche', block: 'needsTool' });
    const moss = digWorld('probe_schaufel', ['', '', '', '....M']);
    expect(moss.interaction.focus).toMatchObject({ kind: 'tile', dig: 'pfad', block: null });
    work(moss);
    expect(moss.objectAt(4, 3)).toBe('');
    expect(moss.groundAt(4, 3)).toBe('erde');
  });
});

describe('Wassergräben', () => {
  it('a dug tile beside water becomes a water ditch, and the ditch carries the water on', () => {
    const w = digWorld('probe_schaufel', ['', '', '....s', '.....']);
    work(w);
    expect(w.groundAt(4, 3)).toBe('erde');
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ kind: 'tile', dig: 'wassergraben', block: null });
    const ev = work(w);
    expect(ev.get('tileDug')).toEqual([expect.objectContaining({ result: 'wassergraben' })]);
    const { chunk, i } = w.at(4, 3);
    expect((chunk.water[i] as number) & WATER_DEPTH_MASK).toBe(WATER_DEPTH_SHALLOW);
    // Shallow water: the ditch is wadeable.
    expect(w.collision.grid.tileInfo(0, OFFSET + 4, OFFSET + 3) & BLOCK_ALL).toBe(0);
    // The next tile, dug and beside the ditch, becomes a ditch too.
    w.place(5, 4);
    w.body().facing = 'up';
    work(w);
    w.run(1);
    expect(w.interaction.focus.dig).toBe('wassergraben');
    work(w);
    const next = w.at(5, 3);
    expect((next.chunk.water[next.i] as number) & WATER_DEPTH_MASK).toBe(WATER_DEPTH_SHALLOW);
  });
});

describe('Felder', () => {
  it('the hoe turns meadow into a field without yield; a field is not hoed twice', () => {
    const w = digWorld('probe_hacke');
    expect(w.interaction.focus).toMatchObject({ kind: 'tile', action: 'hacken', dig: 'feld', hitsTotal: 2 });
    const ev = work(w);
    expect(ev.get('tileDug')).toEqual([expect.objectContaining({ from: 'gras', to: 'erde', result: 'feld' })]);
    expect(flagsAt(w, 4, 3) & TILE_FLAG_DUG).toBe(TILE_FLAG_DUG);
    w.run(TICK);
    expect(w.dropList()).toEqual([]);
    w.run(1);
    expect(w.interaction.focus.block).toBe('alreadyDug');
    // Tools that do not dig find no tile target at all.
    const axe = digWorld('probe_steinaxt');
    expect(axe.interaction.focus.kind).toBe('none');
  });
});

const TICK = BALANCE.time.tickHz;

describe('Versteckte Buddelstellen', () => {
  it('the table names existing items with sane counts', () => {
    const items = CONTENT.collection('items');
    for (const e of DIG_SPOT_LOOT) {
      expect(items.has(e.item), e.item).toBe(true);
      expect(e.min).toBeLessThanOrEqual(e.max);
      expect(e.max).toBeLessThanOrEqual(items.get(e.item).stapel);
    }
  });

  it('about one tile in a hundred hides a spot, only on the surface, fixed by seed and tile', () => {
    let spots = 0;
    const n = 20_000;
    for (let k = 0; k < n; k++) if (isDigSpot(1, 0, k % 200, Math.floor(k / 200))) spots++;
    expect(spots / n).toBeGreaterThan(BALANCE.harvest.dig.spotChance * 0.7);
    expect(spots / n).toBeLessThan(BALANCE.harvest.dig.spotChance * 1.3);
    expect(isDigSpot(1, -1, 5, 5)).toBe(false);
    const spot = [...Array(n).keys()].find((k) => isDigSpot(1, 0, k % 200, Math.floor(k / 200))) ?? 0;
    expect(isDigSpot(1, 0, spot % 200, Math.floor(spot / 200))).toBe(true);
    expect(isDigSpot(2, 0, spot % 200, Math.floor(spot / 200)) && isDigSpot(3, 0, spot % 200, Math.floor(spot / 200))).toBe(false);
  });

  it('the first stroke into a spot brings up its find, once', () => {
    // A spot near the test map (seed 1): search the map area.
    let at: { x: number; y: number } | null = null;
    for (let y = 1; y < 60 && at === null; y++) for (let x = 1; x < 60 && at === null; x++) if (isDigSpot(1, 0, OFFSET + x, OFFSET + y)) at = { x, y };
    expect(at).not.toBeNull();
    const spot = at ?? { x: 0, y: 0 };
    const w = gatherWorld(field(spot.x + 3, spot.y + 3), 1);
    w.place(spot.x, spot.y + 1);
    w.body().facing = 'up';
    w.hold('probe_schaufel');
    const ev = work(w);
    expect(ev.get('digSpotFound')).toEqual([expect.objectContaining({ tx: OFFSET + spot.x, ty: OFFSET + spot.y })]);
    const loot = new Set(DIG_SPOT_LOOT.map((e) => e.item));
    const spawned = (ev.get('dropSpawned') as { item: string }[]).map((d) => d.item);
    expect(spawned.filter((i) => loot.has(i)).length).toBeGreaterThanOrEqual(1);
    // Dug once: the spot is spent (a ditch would need water).
    w.run(1);
    expect(w.interaction.focus.block).toBe('alreadyDug');
  });
});

describe('Terrain im Spielstand', () => {
  it('dug tiles, fields and ditches are chunk diffs: save → load keeps them and the state hash', async () => {
    const sim = createSimulation({ seed: 20260923, worldSize: 'small' });
    sim.step([{ type: 'player.spawn' }]);
    const player = sim.system('player') as PlayerSystem;
    const gathering = sim.system('gathering') as GatheringSystem;
    const at = { x: 0, y: 0 };
    player.position(sim, at);
    const shovel = { kind: 'schaufel', power: 1, broken: false };
    const hoe = { kind: 'hacke', power: 1, broken: false };
    const plan = createHarvestPlan();
    const damage = { value: 0 };
    // Two diggable tiles near the player on the start beach.
    const dug: { tx: number; ty: number; tool: typeof shovel }[] = [];
    const ptx = Math.floor(at.x / TILE_PX);
    const pty = Math.floor(at.y / TILE_PX);
    for (const tool of [shovel, hoe]) {
      let found = false;
      for (let r = 1; r < 40 && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const tx = ptx + dx;
            const ty = pty + dy;
            sim.world.chunks.ensure(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
            found = gathering.planTile(sim, 0, tx, ty, tool, plan) && plan.block === null && !plan.tooWeak && !dug.some((d) => d.tx === tx && d.ty === ty);
            if (found) dug.push({ tx, ty, tool });
          }
        }
      }
    }
    expect(dug).toHaveLength(2);
    for (const d of dug) {
      let dealt = 0;
      for (let k = 0; k < 10; k++) {
        gathering.planTile(sim, 0, d.tx, d.ty, d.tool, plan);
        const outcome = gathering.hitTile(sim, 0, d.tx, d.ty, plan, d.tool, dealt, damage, at.x, at.y);
        dealt = damage.value;
        if (outcome === 'done') break;
      }
    }
    for (let k = 0; k < 90; k++) sim.step();
    const chunkOf = (s: typeof sim, d: { tx: number; ty: number }) => s.world.chunks.ensure(0, d.tx >> CHUNK_SHIFT, d.ty >> CHUNK_SHIFT);
    const index = (d: { tx: number; ty: number }) => ((d.ty & 31) << CHUNK_SHIFT) | (d.tx & 31);
    for (const d of dug) expect((chunkOf(sim, d).flags[index(d)] as number) & TILE_FLAG_DUG).toBe(TILE_FLAG_DUG);
    const store = new MemorySaveStore();
    await saveWorld(store, sim, { worldId: 'graben', name: 'Graben', now: 1, gameVersion: '0.1.0' });
    const loaded = await loadWorld(store, 'graben');
    expect(loaded.hashState()).toBe(sim.hashState());
    for (const d of dug) {
      const a = chunkOf(sim, d);
      const b = chunkOf(loaded, d);
      expect(b.ground[index(d)]).toBe(a.ground[index(d)]);
      expect(b.flags[index(d)]).toBe(a.flags[index(d)]);
      expect(chunkHash(b)).toBe(chunkHash(a));
    }
  });
});
