/**
 * M3-14 Graben mit Schaufel (MASTERPROMPT §14 "Graben (Schaufel): Erde, Lehm, Sand, Kies, Torf, Schnee;
 * begrenztes Terraforming (Gräben, Wassergräben, Pfade, Felder); versteckte Buddelstellen"): the shovel
 * turns meadow into a path and digs pits in bare ground (yielding the dug material), next to water a dug
 * tile becomes a water ditch, the hoe prepares fields; roads, ramps, water and anything standing are not
 * dug; the first stroke into a hidden dig spot brings up its find. Every change is chunk data and survives
 * saving and loading the world (chunk diffs, M2-27).
 *
 * M4-36 (ADR-0032 "trockene Gräben … kommen mit ihren Tilesets"): dug earth beside other dug ground deepens
 * into a dry trench (terrain `graben`, its own tileset) – a trench runs as a line, a lone hole stays a pit,
 * sand and ash run back; a water ditch is a trench the water runs into, and its water runs on along the
 * connected dry trenches inside the active zone. Gravel banks at rivers: tests/unit/game/graeben.test.ts.
 *
 * M4-40 (ADR-0042 "Zuschütten eines Grabens mit Erde folgt"): earth in the hand fills a pit, a path, a dry trench or a
 * water ditch back in – E on it ("Zuschütten: Trockengraben" / "Fill: Trench") or `player.useItem` – and uses up one
 * piece: the tile is as generated again (chunk diff against the generated state). A filled ditch takes the water from
 * the ditches it fed that reach no open water any more, inside the active zone only; a filled dig spot stays spent.
 * Without earth in the hand nothing is filled. Everything survives saving and loading (state hash).
 */
import { describe, expect, it } from 'vitest';
import de from '../../../src/i18n/de.json';
import en from '../../../src/i18n/en.json';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { DIG_SPOT_LOOT } from '../../../src/content/digSpots';
import { DIG_REFILL_ITEM } from '../../../src/content/terrain';
import { USE_SUBJECTS, USE_VERBS } from '../../../src/content/uses';
import type { EventArgs } from '../../../src/engine/events';
import { TILE_FLAG_DUG, TILE_FLAG_ROAD, WATER_DEPTH_MASK, WATER_DEPTH_SHALLOW, chunkHash, type ChunkData } from '../../../src/world/model/chunk';
import { BLOCK_ALL } from '../../../src/world/collision/tiles';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { MemorySaveStore } from '../../../src/save/memoryStore';
import { loadWorld, saveWorld } from '../../../src/save/world';
import { createSimulation } from '../../../src/game/setup';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import { DIG_RESULTS, FILL_KINDS } from '../../../src/game/gathering/events';
import { isDigSpot } from '../../../src/game/gathering/formulas';
import { contentGatheringRules } from '../../../src/game/gathering/rules';
import { createHarvestPlan, type GatheringSystem, type GeneratedChunks } from '../../../src/game/gathering/system';
import { hintText, interactionHint } from '../../../src/game/interaction/hint';
import type { InteractionSystem } from '../../../src/game/interaction/system';
import type { InventorySystem } from '../../../src/game/inventory/system';
import type { WorldCollision } from '../../../src/game/player/collision';
import type { PlayerSystem } from '../../../src/game/player/system';
import { createI18n } from '../../../src/i18n/index';
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

/** Digs map tile (x, y), aimed at and with the drops of earlier strokes picked up (E picks up a drop first), standing on the tile below it (shovel in the hand); returns the events. */
function digAt(w: GatherWorld, x: number, y: number): Map<string, unknown[]> {
  if (w.dropList().length > 0) w.collect();
  w.place(x, y + 1);
  w.body().facing = 'up';
  w.run(1);
  return work(w, w.tile(x, y));
}

/** Stands below map tile (x, y) facing it, with the drops picked up: the focus is that tile. */
function faceTile(w: GatherWorld, x: number, y: number): void {
  w.collect();
  w.place(x, y + 1);
  w.body().facing = 'up';
  w.run(1);
}

/** Water depth bits of map tile (x, y). */
function waterAt(w: GatherWorld, x: number, y: number): number {
  const { chunk, i } = w.at(x, y);
  return (chunk.water[i] as number) & WATER_DEPTH_MASK;
}

describe('Trockengräben (M4-36)', () => {
  it('earth deepens into the trench, loose ground does not; the trench has nothing left to yield', () => {
    const rules = contentGatheringRules();
    const tile = (id: string) => rules.tiles[IDS.terrain.runtimeId(id)];
    const graben = IDS.terrain.runtimeId('graben');
    expect(tile('erde')?.trench).toBe(graben);
    for (const id of ['gras', 'sand', 'duenengras', 'asche', 'schnee', 'torf', 'lehm']) expect(tile(id)?.trench, id).toBe(0);
    expect(tile('graben')).toMatchObject({ tool: 'schaufel', hardness: 1, becomes: graben, trench: 0, yieldItem: null, material: 'erde' });
    expect([...rules.trenchGround.keys()].filter((id) => rules.trenchGround[id] === 1)).toEqual([graben]);
  });

  it('two paths side by side: each deepens into a dry trench in 2 strokes, yields earth and stays walkable', () => {
    const w = digWorld('probe_schaufel');
    digAt(w, 4, 3);
    digAt(w, 5, 3);
    expect([w.groundAt(4, 3), w.groundAt(5, 3)]).toEqual(['erde', 'erde']);
    faceTile(w, 4, 3);
    const before = w.inventory.count('erde');
    expect(w.interaction.focus).toMatchObject({ kind: 'tile', subject: 'erde', action: 'graben', dig: 'graben', hitsTotal: 2, block: null });
    const ev = work(w);
    expect((ev.get('harvestHit') ?? []).length).toBe(2);
    expect(ev.get('tileDug')).toEqual([expect.objectContaining({ from: 'erde', to: 'graben', result: 'graben' })]);
    expect(ev.get('harvested')).toEqual([expect.objectContaining({ skill: 'sammeln', xp: 'boden_gegraben', material: 'erde' })]);
    expect(w.groundAt(4, 3)).toBe('graben');
    expect(flagsAt(w, 4, 3) & TILE_FLAG_DUG).toBe(TILE_FLAG_DUG);
    w.collect();
    expect(w.inventory.count('erde') - before).toBeGreaterThanOrEqual(BALANCE.harvest.dig.yieldMin);
    // The trench continues the line: the path beside it deepens too.
    digAt(w, 5, 3);
    expect(w.groundAt(5, 3)).toBe('graben');
    // Walkable: the collision grid lets a body in (no blocking category), the terrain is a little slow.
    expect(w.collision.grid.tileInfo(0, OFFSET + 4, OFFSET + 3) & BLOCK_ALL).toBe(0);
    expect(CONTENT.collection('terrain').get('graben').speedFactor).toBeLessThan(1);
    // A dry trench far from water is dug as far as it goes: it names the water ditch it could become.
    faceTile(w, 4, 3);
    expect(w.interaction.focus).toMatchObject({ kind: 'tile', subject: 'graben', dig: 'wassergraben', block: 'alreadyDug' });
    const again = w.run(2, [{ type: 'player.interact', on: true }]);
    expect(again.get('commandRejected')).toEqual([expect.objectContaining({ reason: 'alreadyDug' })]);
    expect(w.groundAt(4, 3)).toBe('graben');
  });

  it('a lone path stays a path; pits in sand beside each other run back and stay pits', () => {
    const lone = digWorld('probe_schaufel');
    digAt(lone, 4, 3);
    faceTile(lone, 4, 3);
    expect(lone.interaction.focus).toMatchObject({ kind: 'tile', subject: 'erde', dig: 'graben', block: 'alreadyDug' });
    const sand = digWorld('probe_schaufel', ['', '', '', '....SS']);
    digAt(sand, 4, 3);
    digAt(sand, 5, 3);
    faceTile(sand, 4, 3);
    expect(sand.interaction.focus).toMatchObject({ kind: 'tile', subject: 'sand', dig: 'wassergraben', block: 'alreadyDug' });
    expect([sand.groundAt(4, 3), sand.groundAt(5, 3)]).toEqual(['sand', 'sand']);
  });

  it('the hint names the trench and every dig result has its DE/EN text', () => {
    for (const r of DIG_RESULTS.filter((d) => d !== 'stollen')) {
      expect((de as Record<string, string>)[`ui.interaction.dig.${r}`], r).toBeTruthy();
      expect((en as Record<string, string>)[`ui.interaction.dig.${r}`], r).toBeTruthy();
    }
    expect([(de as Record<string, string>)['ui.interaction.dig.graben'], (en as Record<string, string>)['ui.interaction.dig.graben']]).toEqual(['Trockengraben', 'Trench']);
  });
});

describe('Wassergräben in Trockengräben (M4-36)', () => {
  /** A meadow with shallow water at map (2, 3) and a dry trench along row 3 from column 4 to 6. */
  function trenchWorld(width = 10, from = 4, to = 6): GatherWorld {
    const w = digWorld('probe_schaufel', ['', '', '', '..s']);
    for (let x = from; x <= to; x++) digAt(w, x, 3);
    for (let x = from; x <= to; x++) digAt(w, x, 3);
    for (let x = from; x <= to; x++) expect([w.groundAt(x, 3), waterAt(w, x, 3)], `(${x}, 3)`).toEqual(['graben', 0]);
    expect(width).toBeGreaterThan(to);
    return w;
  }

  it('opening the trench to the water: the ditch is a trench full of water, and the water runs along the dry trench', () => {
    const w = trenchWorld();
    // (3, 3) lies between the water and the trench: the first stroke makes a path, the second opens it.
    digAt(w, 3, 3);
    expect([w.groundAt(3, 3), waterAt(w, 3, 3)]).toEqual(['erde', 0]);
    faceTile(w, 3, 3);
    expect(w.interaction.focus).toMatchObject({ kind: 'tile', dig: 'wassergraben', block: null });
    const ev = work(w, w.tile(3, 3));
    expect(ev.get('tileDug')).toEqual([expect.objectContaining({ from: 'erde', to: 'graben', result: 'wassergraben' })]);
    for (let x = 3; x <= 6; x++) expect([w.groundAt(x, 3), waterAt(w, x, 3)], `(${x}, 3)`).toEqual(['graben', WATER_DEPTH_SHALLOW]);
    // Only trenches carry the water: the meadow and the path around stay dry; the ditch stays wadeable.
    for (const [x, y] of [[7, 3], [4, 2], [4, 4]] as const) expect(waterAt(w, x, y), `(${x}, ${y})`).toBe(0);
    for (let x = 3; x <= 6; x++) expect(w.collision.grid.tileInfo(0, OFFSET + x, OFFSET + 3) & BLOCK_ALL).toBe(0);
    // A trench dug on beside the ditch fills at once: it lies beside water.
    digAt(w, 7, 3);
    faceTile(w, 7, 3);
    expect(w.interaction.focus).toMatchObject({ dig: 'wassergraben', block: null });
    work(w, w.tile(7, 3));
    expect([w.groundAt(7, 3), waterAt(w, 7, 3)]).toEqual(['graben', WATER_DEPTH_SHALLOW]);
  });

  it('the water runs no further than the active zone; the dry rest opens with the next stroke once it is active', () => {
    // The trench crosses from chunk (2, 2) into chunk (3, 2) between map columns 31 and 32.
    const w = gatherWorld(field(36, 6, ['', '', '', '..........................s']));
    w.hold('probe_schaufel');
    for (let x = 28; x <= 34; x++) digAt(w, x, 3);
    for (let x = 28; x <= 34; x++) digAt(w, x, 3);
    const east = w.at(32, 3).chunk;
    expect(w.at(31, 3).chunk).not.toBe(east);
    w.active = w.active.filter((c) => c !== east);
    digAt(w, 27, 3);
    digAt(w, 27, 3);
    for (let x = 27; x <= 31; x++) expect(waterAt(w, x, 3), `(${x}, 3)`).toBe(WATER_DEPTH_SHALLOW);
    for (let x = 32; x <= 34; x++) expect([w.groundAt(x, 3), waterAt(w, x, 3)], `(${x}, 3)`).toEqual(['graben', 0]);
    // Active again: the first dry trench tile beside the water opens, and the rest fills from it.
    w.active = [...w.chunks.map.values()];
    digAt(w, 32, 3);
    for (let x = 32; x <= 34; x++) expect(waterAt(w, x, 3), `(${x}, 3)`).toBe(WATER_DEPTH_SHALLOW);
  });
});

describe('Trockengräben im Spielstand (M4-36)', () => {
  it('trench and flooded trench are chunk diffs: save → load keeps ground, water and the state hash', async () => {
    const sim = createSimulation({ seed: 20260923, worldSize: 'small' });
    sim.step([{ type: 'player.spawn' }]);
    const player = sim.system('player') as PlayerSystem;
    const gathering = sim.system('gathering') as GatheringSystem;
    const at = { x: 0, y: 0 };
    player.position(sim, at);
    const shovel = { kind: 'schaufel', power: 1, broken: false };
    const plan = createHarvestPlan();
    const damage = { value: 0 };
    const chunkOf = (s: typeof sim, tx: number, ty: number) => s.world.chunks.ensure(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    const index = (tx: number, ty: number) => ((ty & 31) << CHUNK_SHIFT) | (tx & 31);
    // Three tiles in a row near the player that the shovel may dig (A, B, C) and the tile north of A: laid out as a
    // meadow with a pool north of A.
    const ptx = Math.floor(at.x / TILE_PX);
    const pty = Math.floor(at.y / TILE_PX);
    const gras = IDS.terrain.runtimeId('gras');
    let row: { tx: number; ty: number } | null = null;
    for (let r = 2; r < 12 && row === null; r++) {
      for (let dy = -r; dy <= r && row === null; dy++) {
        for (let dx = -r; dx <= r && row === null; dx++) {
          const tx = ptx + dx;
          const ty = pty + dy;
          const ok = [0, 1, 2].every((k) => gathering.planTile(sim, 0, tx + k, ty, shovel, plan) && plan.block === null && !plan.tooWeak) && gathering.planTile(sim, 0, tx, ty - 1, shovel, plan) && plan.block === null;
          if (ok) row = { tx, ty };
        }
      }
    }
    expect(row).not.toBeNull();
    const { tx, ty } = row ?? { tx: 0, ty: 0 };
    for (const [x, y] of [[tx, ty], [tx + 1, ty], [tx + 2, ty], [tx, ty - 1]] as const) {
      const c = chunkOf(sim, x, y);
      c.ground[index(x, y)] = gras;
      if ((c.object[index(x, y)] as number) !== 0) c.setObject(index(x, y), 0);
    }
    const dig = (x: number, y: number): void => {
      let dealt = 0;
      for (let k = 0; k < 10; k++) {
        expect(gathering.planTile(sim, 0, x, y, shovel, plan) && plan.block === null, `(${x}, ${y})`).toBe(true);
        const outcome = gathering.hitTile(sim, 0, x, y, plan, shovel, dealt, damage, at.x, at.y);
        dealt = damage.value;
        if (outcome === 'done') return;
      }
      throw new Error(`(${x}, ${y}) not dug`);
    };
    for (let k = 0; k < 3; k++) dig(tx + k, ty);
    dig(tx + 1, ty);
    dig(tx + 2, ty);
    expect([0, 1, 2].map((k) => IDS.terrain.stringId(chunkOf(sim, tx + k, ty).ground[index(tx + k, ty)] as number))).toEqual(['erde', 'graben', 'graben']);
    // The pool north of A: A opens into a ditch, and the water runs on through B and C.
    const pool = chunkOf(sim, tx, ty - 1);
    pool.water[index(tx, ty - 1)] = WATER_DEPTH_SHALLOW;
    dig(tx, ty);
    for (let k = 0; k < 3; k++) {
      const c = chunkOf(sim, tx + k, ty);
      expect([IDS.terrain.stringId(c.ground[index(tx + k, ty)] as number), (c.water[index(tx + k, ty)] as number) & WATER_DEPTH_MASK]).toEqual(['graben', WATER_DEPTH_SHALLOW]);
    }
    for (let k = 0; k < 90; k++) sim.step();
    const store = new MemorySaveStore();
    await saveWorld(store, sim, { worldId: 'graben-m4', name: 'Graben', now: 1, gameVersion: '0.1.0' });
    const loaded = await loadWorld(store, 'graben-m4');
    expect(loaded.hashState()).toBe(sim.hashState());
    for (const [x, y] of [[tx, ty], [tx + 1, ty], [tx + 2, ty], [tx, ty - 1]] as const) {
      const a = chunkOf(sim, x, y);
      const b = chunkOf(loaded, x, y);
      expect([b.ground[index(x, y)], b.water[index(x, y)], b.flags[index(x, y)]], `(${x}, ${y})`).toEqual([a.ground[index(x, y)], a.water[index(x, y)], a.flags[index(x, y)]]);
      expect(chunkHash(b)).toBe(chunkHash(a));
    }
    expect(IDS.terrain.stringId(chunkOf(loaded, tx + 2, ty).ground[index(tx + 2, ty)] as number)).toBe('graben');
  });
});

// ---------------------------------------------------------------------------------------------
// M4-40 Zuschütten
// ---------------------------------------------------------------------------------------------

const DE = createI18n('de');
const EN = createI18n('en');
/** A generated world and many ticks: more than the default 5 s on a loaded machine. */
const FULL_SIM_TIMEOUT_MS = 60_000;
/** Ticks for drops to land and the magnet to take what lies in reach (2 s). */
const SETTLE_TICKS = 2 * TICK;
const SHOVEL = { kind: 'schaufel', power: 1, broken: false } as const;
type Ev = EventArgs<SimEventMap>;

function eventsOf<K extends keyof SimEventMap>(events: readonly Ev[], type: K): SimEventMap[K][] {
  return events.filter((e) => e[0] === type).map((e) => e[1] as SimEventMap[K]);
}

function rejections(events: readonly Ev[]): string[] {
  return eventsOf(events, 'commandRejected').map((r) => r.reason);
}

/** Ground (terrain id), water and flags of a tile. */
interface TileState {
  readonly ground: string;
  readonly water: number;
  readonly flags: number;
}

function stateOf(chunk: ChunkData, i: number): TileState {
  return { ground: IDS.terrain.stringId(chunk.ground[i] as number), water: chunk.water[i] as number, flags: chunk.flags[i] as number };
}

/** The real game (`createSimulation`) for filling in: its chunks keep their generated state in the chunk store. */
interface FillGame {
  readonly sim: Simulation;
  readonly gathering: GatheringSystem;
  readonly inventory: InventorySystem;
  readonly interaction: InteractionSystem;
  /**
   * A row of four tiles of open soil west to east on row `y` – meadow or earth as generated, no scatter, no dig spot, no
   * water beside them – with open ground south of it: the pool P = (x0, y), then A, B and C.
   */
  readonly x0: number;
  readonly y: number;
  run(commands?: readonly GameCommand[], ticks?: number): Ev[];
  cell(tx: number, ty: number): { chunk: ChunkData; i: number };
  /** The tile now. */
  now(tx: number, ty: number): TileState;
  /** The tile as generated. */
  generated(tx: number, ty: number): TileState;
  /** Digs tile (tx, ty) once with a T0 shovel through the gathering system's plan and hits; returns the events. */
  dig(tx: number, ty: number): Ev[];
  /** Puts `count` of `item` into the hand (`null`: an empty hotbar slot in the hand). */
  hold(item: string | null, count?: number): void;
  /** Stands on the tile south of (tx, ty), facing it, until drops landed and the magnet took what lies in reach. */
  standBelow(tx: number, ty: number): void;
  /** Aims at tile (tx, ty) and returns the hint line of the focus in `lang` ('' without one). */
  hint(tx: number, ty: number, lang?: 'de' | 'en'): string;
  /** Presses and releases E on tile (tx, ty); returns the events. */
  press(tx: number, ty: number): Ev[];
}

function fillGame(seed = 20260923): FillGame {
  const sim = createSimulation({ seed, worldSize: 'small' });
  const run = (commands: readonly GameCommand[] = [], ticks = 1): Ev[] => {
    const out: Ev[] = [];
    for (let k = 0; k < ticks; k++) {
      sim.step(k === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
      sim.events.drain((...e) => out.push(e));
    }
    return out;
  };
  run([{ type: 'player.spawn' }], 2);
  const player = sim.system('player') as PlayerSystem;
  const gathering = sim.system('gathering') as GatheringSystem;
  const inventory = sim.system('inventory') as InventorySystem;
  const interaction = sim.system('interaction') as InteractionSystem;
  const collision = sim.system('world-collision') as WorldCollision;
  const at = { x: 0, y: 0 };
  if (!player.position(sim, at)) throw new Error('no player');
  const ptx = Math.floor(at.x / TILE_PX);
  const pty = Math.floor(at.y / TILE_PX);
  collision.ensureTiles(0, ptx - 48, pty - 48, ptx + 48, pty + 48);
  const cell = (tx: number, ty: number): { chunk: ChunkData; i: number } => {
    const chunk = sim.world.chunks.get(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (chunk === undefined) throw new Error(`tile ${tx}, ${ty} is not resident`);
    return { chunk, i: ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK) };
  };
  const plan = createHarvestPlan();
  const soil = new Set(['gras', 'erde'].map((t) => IDS.terrain.runtimeId(t)));
  const open = (tx: number, ty: number): boolean => gathering.planTile(sim, 0, tx, ty, SHOVEL, plan) && plan.block === null && !plan.tooWeak && !isDigSpot(seed, 0, tx, ty) && cell(tx, ty).chunk.object[cell(tx, ty).i] === 0;
  const dry = (tx: number, ty: number): boolean => ((cell(tx, ty).chunk.water[cell(tx, ty).i] as number) & WATER_DEPTH_MASK) === 0;
  const fits = (x0: number, y: number): boolean => {
    for (let k = 0; k < 4; k++) {
      const { chunk, i } = cell(x0 + k, y);
      if (!soil.has(chunk.ground[i] as number) || !open(x0 + k, y) || !open(x0 + k, y + 1) || !dry(x0 + k, y - 1)) return false;
    }
    return dry(x0 - 1, y) && dry(x0 + 4, y);
  };
  let row: { x0: number; y: number } | null = null;
  for (let r = 2; r <= 40 && row === null; r++) {
    for (let dy = -r; dy <= r && row === null; dy++) {
      for (let dx = -r; dx <= r && row === null; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && fits(ptx + dx, pty + dy)) row = { x0: ptx + dx, y: pty + dy };
      }
    }
  }
  if (row === null) throw new Error('no row of open soil near the spawn');
  const generatedOf = (tx: number, ty: number): ChunkData => {
    const g = sim.world.chunks.generatedOf(cell(tx, ty).chunk);
    if (g === undefined) throw new Error(`no generated state of tile ${tx}, ${ty}`);
    return g;
  };
  const g: FillGame = {
    sim,
    gathering,
    inventory,
    interaction,
    x0: row.x0,
    y: row.y,
    run,
    cell,
    now: (tx, ty) => stateOf(cell(tx, ty).chunk, cell(tx, ty).i),
    generated: (tx, ty) => stateOf(generatedOf(tx, ty), cell(tx, ty).i),
    dig(tx, ty) {
      const damage = { value: 0 };
      let dealt = 0;
      for (let k = 0; k < 10; k++) {
        expect(gathering.planTile(sim, 0, tx, ty, SHOVEL, plan) && plan.block === null, `dig ${tx}, ${ty}`).toBe(true);
        const outcome = gathering.hitTile(sim, 0, tx, ty, plan, SHOVEL, dealt, damage, at.x, at.y);
        dealt = damage.value;
        if (outcome === 'done') {
          const out: Ev[] = [];
          sim.events.drain((...e) => out.push(e));
          return out;
        }
      }
      throw new Error(`tile ${tx}, ${ty} not dug`);
    },
    hold(item, count = 1) {
      const hotbar = (): readonly ({ item: string } | null)[] => inventory.state.schnellleiste;
      if (item === null) {
        const empty = hotbar().findIndex((s) => s === null);
        run([{ type: 'player.selectHotbar', index: empty }]);
        expect(inventory.selected()).toBeNull();
        return;
      }
      run([{ type: 'inventory.give', item, count }]);
      let index = hotbar().findIndex((s) => s?.item === item);
      if (index < 0) {
        index = hotbar().findIndex((s) => s === null);
        const from = inventory.state.inventar.findIndex((s) => s?.item === item);
        run([{ type: 'inventory.move', from: { bereich: 'inventar', index: from }, to: { bereich: 'schnellleiste', index } }]);
      }
      run([{ type: 'player.selectHotbar', index }]);
      expect(inventory.selected()?.item).toBe(item);
    },
    standBelow(tx, ty) {
      run([{ type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 1.5) * TILE_PX, layer: 0 }]);
      const body = player.body(sim);
      if (body === undefined) throw new Error('no player');
      body.facing = 'up';
      run([], SETTLE_TICKS);
      player.position(sim, at);
    },
    hint(tx, ty, lang = 'de') {
      run([{ type: 'player.aim', x: (tx + 0.5) * TILE_PX, y: (ty + 0.5) * TILE_PX }], 2);
      const h = interactionHint(interaction.focus);
      const i18n = lang === 'de' ? DE : EN;
      return h === null ? '' : hintText(h, lang, (k, params) => i18n.t(k, params));
    },
    press(tx, ty) {
      const ev = run([{ type: 'player.interact', on: true, tx, ty }]);
      return [...ev, ...run([{ type: 'player.interact', on: false }])];
    },
  };
  return g;
}

/** Earth in the bags after `events`, counted from `before` (pieces the magnet brought in during them included). */
function earthAfter(before: number, events: readonly Ev[]): number {
  return before + eventsOf(events, 'itemsAdded').filter((e) => e.item === DIG_REFILL_ITEM).reduce((n, e) => n + e.count, 0);
}

/** A hand-drawn world whose drawn state stands in for the generated one (snapshot by `keep`). */
function drawnGeneration(): GeneratedChunks & { keep(chunks: Iterable<ChunkData>): void } {
  const base = new Map<ChunkData, ChunkData>();
  return {
    generatedOf: (chunk) => base.get(chunk),
    keep(chunks) {
      for (const c of chunks) base.set(c, c.clone());
    },
  };
}

describe('Zuschütten (M4-40)', { timeout: FULL_SIM_TIMEOUT_MS }, () => {
  it('earth fills; the dug ground has hint names in DE/EN like digging names it', () => {
    expect(CONTENT.collection('items').has(DIG_REFILL_ITEM)).toBe(true);
    expect(USE_VERBS.zuschuetten).toEqual({ de: 'Zuschütten', en: 'Fill' });
    for (const kind of FILL_KINDS) {
      expect(USE_SUBJECTS[kind], kind).toEqual({ de: (de as Record<string, string>)[`ui.interaction.dig.${kind}`], en: (en as Record<string, string>)[`ui.interaction.dig.${kind}`] });
    }
    expect(USE_SUBJECTS.graben).toEqual(CONTENT.collection('terrain').get('graben').name);
    for (const key of ['ui.tools.reject.nothingToFill', 'ui.tools.reject.outOfReach', 'ui.tools.used.zuschuetten']) {
      expect((de as Record<string, string>)[key], key).toBeTruthy();
      expect((en as Record<string, string>)[key], key).toBeTruthy();
    }
  });

  it('E with earth in the hand fills a pit or path: the tile is as generated again, one earth is used up', () => {
    const g = fillGame();
    const ax = g.x0 + 1;
    const { chunk } = g.cell(ax, g.y);
    const untouched = chunkHash(chunk);
    g.dig(ax, g.y);
    expect(g.now(ax, g.y).flags & TILE_FLAG_DUG).toBe(TILE_FLAG_DUG);
    g.hold(DIG_REFILL_ITEM, 3);
    g.standBelow(ax, g.y);
    const name = g.generated(ax, g.y).ground === 'gras' ? 'pfad' : 'grube';
    expect(g.hint(ax, g.y)).toBe(`Zuschütten: ${USE_SUBJECTS[name].de}`);
    expect(g.interaction.focus).toMatchObject({ kind: 'use', action: 'zuschuetten', subject: name, block: null });
    expect(g.hint(ax, g.y, 'en')).toBe(`Fill: ${USE_SUBJECTS[name].en}`);
    const before = g.inventory.count(DIG_REFILL_ITEM);
    const ev = g.press(ax, g.y);
    expect(rejections(ev)).toEqual([]);
    expect(eventsOf(ev, 'itemUsed')).toEqual([expect.objectContaining({ item: DIG_REFILL_ITEM, use: 'zuschuetten', layer: 0, x: (ax + 0.5) * TILE_PX, y: (g.y + 0.5) * TILE_PX })]);
    expect(g.inventory.count(DIG_REFILL_ITEM)).toBe(earthAfter(before, ev) - 1);
    expect(g.now(ax, g.y)).toEqual(g.generated(ax, g.y));
    expect(chunkHash(chunk)).toBe(untouched);
    // Nothing dug there any more: no use target, and the shovel digs it like untouched ground.
    g.hint(ax, g.y);
    expect(g.interaction.focus.kind).not.toBe('use');
    expect(g.gathering.planTile(g.sim, 0, ax, g.y, SHOVEL, createHarvestPlan())).toBe(true);
  });

  it('a dry trench: "Zuschütten: Trockengraben" / "Fill: Trench"; the path beside it stays dug', () => {
    const g = fillGame();
    const [ax, bx] = [g.x0 + 1, g.x0 + 2];
    g.dig(ax, g.y);
    g.dig(bx, g.y);
    const trench = g.dig(ax, g.y);
    expect(eventsOf(trench, 'tileDug')).toEqual([expect.objectContaining({ to: 'graben', result: 'graben' })]);
    g.hold(DIG_REFILL_ITEM, 2);
    g.standBelow(ax, g.y);
    expect(g.hint(ax, g.y)).toBe('Zuschütten: Trockengraben');
    expect(g.hint(ax, g.y, 'en')).toBe('Fill: Trench');
    const before = g.inventory.count(DIG_REFILL_ITEM);
    const ev = g.press(ax, g.y);
    expect(g.inventory.count(DIG_REFILL_ITEM)).toBe(earthAfter(before, ev) - 1);
    expect(g.now(ax, g.y)).toEqual(g.generated(ax, g.y));
    expect(g.now(bx, g.y).flags & TILE_FLAG_DUG).toBe(TILE_FLAG_DUG);
    expect(g.gathering.refillable(g.sim, 0, bx, g.y)).toBe(g.generated(bx, g.y).ground === 'gras' ? 'pfad' : 'grube');
  });

  it('a water ditch: filling wins over drinking with earth in the hand; ditches cut off from the water run dry', () => {
    const g = fillGame();
    const [px, ax, bx, cx] = [g.x0, g.x0 + 1, g.x0 + 2, g.x0 + 3];
    // A pool at P; A, B and C dug, B and C deepened into a trench, A opened to the pool: the water runs to C.
    const pool = g.cell(px, g.y);
    pool.chunk.water[pool.i] = WATER_DEPTH_SHALLOW;
    (g.sim.system('world-collision') as WorldCollision).invalidateTile(0, px, g.y);
    for (const x of [ax, bx, cx]) g.dig(x, g.y);
    g.dig(bx, g.y);
    g.dig(cx, g.y);
    expect(eventsOf(g.dig(ax, g.y), 'tileDug')).toEqual([expect.objectContaining({ result: 'wassergraben' })]);
    for (const x of [ax, bx, cx]) expect([g.now(x, g.y).ground, g.now(x, g.y).water & WATER_DEPTH_MASK], `${x}`).toEqual(['graben', WATER_DEPTH_SHALLOW]);
    // Empty hand: the ditch is water to drink; earth in the hand: it is filled.
    g.hold(null);
    g.standBelow(cx, g.y);
    expect(g.hint(cx, g.y)).toBe(`${USE_VERBS.trinken.de}: ${USE_SUBJECTS.suesswasser.de}`);
    expect(g.interaction.focus).toMatchObject({ kind: 'use', action: 'trinken' });
    g.hold(DIG_REFILL_ITEM, 3);
    expect(g.hint(cx, g.y)).toBe('Zuschütten: Wassergraben');
    expect(g.hint(cx, g.y, 'en')).toBe('Fill: Water Ditch');
    let before = g.inventory.count(DIG_REFILL_ITEM);
    let ev = g.press(cx, g.y);
    expect(g.inventory.count(DIG_REFILL_ITEM)).toBe(earthAfter(before, ev) - 1);
    expect(g.now(cx, g.y)).toEqual(g.generated(cx, g.y));
    // A and B still reach the pool: they keep their water.
    for (const x of [ax, bx]) expect(g.now(x, g.y).water & WATER_DEPTH_MASK, `${x}`).toBe(WATER_DEPTH_SHALLOW);
    // Filling A cuts B off from the pool: B runs dry and is a dry trench again.
    g.standBelow(ax, g.y);
    expect(g.hint(ax, g.y)).toBe('Zuschütten: Wassergraben');
    before = g.inventory.count(DIG_REFILL_ITEM);
    ev = g.press(ax, g.y);
    expect(rejections(ev)).toEqual([]);
    expect(g.inventory.count(DIG_REFILL_ITEM)).toBe(earthAfter(before, ev) - 1);
    expect(g.now(ax, g.y)).toEqual(g.generated(ax, g.y));
    expect(g.now(bx, g.y)).toMatchObject({ ground: 'graben', water: 0 });
    expect(g.now(bx, g.y).flags & TILE_FLAG_DUG).toBe(TILE_FLAG_DUG);
    expect(g.hint(bx, g.y)).toBe('Zuschütten: Trockengraben');
    // The pool itself is natural water: nothing to fill.
    expect(g.gathering.refillable(g.sim, 0, px, g.y)).toBeNull();
  });

  it('without earth in the hand nothing is filled; earth on undug or far tiles is refused, the primary button stays silent', () => {
    const g = fillGame();
    const [ax, bx] = [g.x0 + 1, g.x0 + 2];
    g.dig(ax, g.y);
    const dug = g.now(ax, g.y);
    g.hold(null);
    g.standBelow(ax, g.y);
    // Empty hand: no use target on the pit; E finds nothing, `player.useItem` on it has nothing to use.
    g.hint(ax, g.y);
    expect(g.interaction.focus.kind).not.toBe('use');
    expect(rejections(g.press(ax, g.y))).toEqual(['nothingToInteract']);
    expect(rejections(g.run([{ type: 'player.useItem', tx: ax, ty: g.y }]))).toEqual(['slotEmpty']);
    // Another item in the hand: it does not fill.
    g.hold('stein', 1);
    g.hint(ax, g.y);
    expect(g.interaction.focus.kind).not.toBe('use');
    expect(rejections(g.run([{ type: 'player.useItem', tx: ax, ty: g.y }]))).toEqual(['notUsable']);
    expect(g.now(ax, g.y)).toEqual(dug);
    // Earth: an undug tile has nothing to fill; a tile beyond reach is refused; neither uses up earth.
    g.hold(DIG_REFILL_ITEM, 2);
    const before = g.inventory.count(DIG_REFILL_ITEM);
    expect(rejections(g.run([{ type: 'player.useItem', tx: bx, ty: g.y }]))).toEqual(['nothingToFill']);
    expect(rejections(g.run([{ type: 'player.useItem', tx: ax + 4, ty: g.y }]))).toEqual(['outOfReach']);
    // The primary button (no target of its own) on undug ground ahead: nothing happens, no refusal.
    g.run([{ type: 'player.aim', x: (bx + 0.5) * TILE_PX, y: (g.y + 0.5) * TILE_PX }]);
    const click = g.run([{ type: 'player.useItem' }]);
    expect(rejections(click)).toEqual([]);
    expect(eventsOf(click, 'itemUsed')).toEqual([]);
    expect(g.inventory.count(DIG_REFILL_ITEM)).toBe(before);
    expect(g.now(ax, g.y)).toEqual(dug);
    // The primary button aimed at the pit fills it (`player.useItem` with earth in the hand).
    g.run([{ type: 'player.aim', x: (ax + 0.5) * TILE_PX, y: (g.y + 0.5) * TILE_PX }]);
    const fill = g.run([{ type: 'player.useItem' }]);
    expect(eventsOf(fill, 'itemUsed')).toEqual([expect.objectContaining({ use: 'zuschuetten' })]);
    expect(g.inventory.count(DIG_REFILL_ITEM)).toBe(earthAfter(before, fill) - 1);
    expect(g.now(ax, g.y)).toEqual(g.generated(ax, g.y));
  });

  it('what has no soil left or has something standing on it is not filled', () => {
    const drawn = drawnGeneration();
    const w = gatherWorld(field(10, 10, ['', '', '', '....R']), 1, drawn);
    drawn.keep(w.chunks.map.values());
    const cave = w.at(5, 3);
    // A clay pocket dug out down to the bare cave floor: nothing to fill.
    cave.chunk.ground[cave.i] = IDS.terrain.runtimeId('hoehlenboden');
    cave.chunk.flags[cave.i] = TILE_FLAG_DUG;
    const rock = w.at(4, 3);
    rock.chunk.flags[rock.i] = TILE_FLAG_DUG;
    w.run(1);
    expect(w.gathering.refillable(w.sim, 0, OFFSET + 5, OFFSET + 3)).toBeNull();
    expect(w.gathering.refillable(w.sim, 0, OFFSET + 4, OFFSET + 3)).toBeNull();
    expect(w.gathering.refillable(w.sim, 0, OFFSET + 6, OFFSET + 3)).toBeNull();
    expect(w.gathering.refill(w.sim, 0, OFFSET + 6, OFFSET + 3)).toBeNull();
  });

  it('a filled ditch drains only inside the active zone: a stretch running on into a frozen chunk keeps its water', () => {
    // The trench of M4-36 crosses from chunk (2, 2) into chunk (3, 2) between map columns 31 and 32; water at column 26.
    const drawn = drawnGeneration();
    const w = gatherWorld(field(36, 6, ['', '', '', '..........................s']), 1, drawn);
    drawn.keep(w.chunks.map.values());
    w.hold('probe_schaufel');
    for (let x = 28; x <= 34; x++) digAt(w, x, 3);
    for (let x = 28; x <= 34; x++) digAt(w, x, 3);
    digAt(w, 27, 3);
    digAt(w, 27, 3);
    for (let x = 27; x <= 34; x++) expect(waterAt(w, x, 3), `(${x}, 3)`).toBe(WATER_DEPTH_SHALLOW);
    const east = w.at(32, 3).chunk;
    w.active = w.active.filter((c) => c !== east);
    // Filling the opening (27) cuts the trench off from the water – but it runs on into the frozen east chunk.
    expect(w.gathering.refill(w.sim, 0, OFFSET + 27, OFFSET + 3)).toBe('wassergraben');
    expect([w.groundAt(27, 3), waterAt(w, 27, 3), flagsAt(w, 27, 3) & TILE_FLAG_DUG]).toEqual(['gras', 0, 0]);
    for (let x = 28; x <= 34; x++) expect(waterAt(w, x, 3), `(${x}, 3)`).toBe(WATER_DEPTH_SHALLOW);
    // Everything active again: filling the next tile drains the whole cut-off trench, which stays a dry trench.
    w.active = [...w.chunks.map.values()];
    expect(w.gathering.refill(w.sim, 0, OFFSET + 28, OFFSET + 3)).toBe('wassergraben');
    for (let x = 29; x <= 34; x++) expect([w.groundAt(x, 3), waterAt(w, x, 3), flagsAt(w, x, 3) & TILE_FLAG_DUG], `(${x}, 3)`).toEqual(['graben', 0, TILE_FLAG_DUG]);
    // A stretch still fed by open water keeps it: a second opening at 33 beside a pool at (33, 2).
    const pond = w.at(33, 2);
    pond.chunk.water[pond.i] = WATER_DEPTH_SHALLOW;
    digAt(w, 33, 3);
    for (let x = 29; x <= 34; x++) expect(waterAt(w, x, 3), `(${x}, 3)`).toBe(WATER_DEPTH_SHALLOW);
    expect(w.gathering.refill(w.sim, 0, OFFSET + 30, OFFSET + 3)).toBe('wassergraben');
    expect(waterAt(w, 29, 3)).toBe(0);
    for (let x = 31; x <= 34; x++) expect(waterAt(w, x, 3), `(${x}, 3)`).toBe(WATER_DEPTH_SHALLOW);
  });

  it('a filled dig spot stays spent; fills, drained ditches and the spent spot survive save → load (state hash)', async () => {
    const g = fillGame();
    const seed = g.sim.config.seed;
    // A hidden dig spot of open soil near the row.
    const plan = createHarvestPlan();
    let spot: { tx: number; ty: number } | null = null;
    for (let r = 0; r <= 40 && spot === null; r++) {
      for (let dy = -r; dy <= r && spot === null; dy++) {
        for (let dx = -r; dx <= r && spot === null; dx++) {
          const tx = g.x0 + dx;
          const ty = g.y + dy;
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !isDigSpot(seed, 0, tx, ty)) continue;
          const { chunk, i } = g.cell(tx, ty);
          if (chunk.object[i] === 0 && g.gathering.planTile(g.sim, 0, tx, ty, SHOVEL, plan) && plan.block === null && !plan.tooWeak && plan.dig !== 'wassergraben') spot = { tx, ty };
        }
      }
    }
    expect(spot).not.toBeNull();
    const { tx, ty } = spot ?? { tx: 0, ty: 0 };
    expect(eventsOf(g.dig(tx, ty), 'digSpotFound')).toHaveLength(1);
    g.hold(DIG_REFILL_ITEM, 5);
    g.run([{ type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 0.5) * TILE_PX, layer: 0 }], 2);
    expect(eventsOf(g.run([{ type: 'player.useItem', tx, ty }]), 'itemUsed')).toHaveLength(1);
    expect(g.gathering.spotSpent(0, tx, ty)).toBe(true);
    expect(g.now(tx, ty).flags & TILE_FLAG_DUG).toBe(0);
    // Dug again: the find does not come back.
    expect(eventsOf(g.dig(tx, ty), 'digSpotFound')).toEqual([]);
    expect(g.sim.participant('gathering').serialize()).toMatchObject({ spentDigSpots: [{ layer: 0, cx: tx >> CHUNK_SHIFT, cy: ty >> CHUNK_SHIFT, i: ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK) }] });
    // The row: A opened to the pool fed the trench B–C; A filled in, B and C are cut off and run dry.
    const [px, ax, bx, cx] = [g.x0, g.x0 + 1, g.x0 + 2, g.x0 + 3];
    const pool = g.cell(px, g.y);
    pool.chunk.water[pool.i] = WATER_DEPTH_SHALLOW;
    (g.sim.system('world-collision') as WorldCollision).invalidateTile(0, px, g.y);
    for (const x of [ax, bx, cx]) g.dig(x, g.y);
    g.dig(bx, g.y);
    g.dig(cx, g.y);
    g.dig(ax, g.y);
    g.standBelow(ax, g.y);
    expect(rejections(g.run([{ type: 'player.useItem', tx: ax, ty: g.y }]))).toEqual([]);
    expect(g.now(bx, g.y)).toMatchObject({ ground: 'graben', water: 0 });
    expect(g.now(cx, g.y)).toMatchObject({ ground: 'graben', water: 0 });
    g.run([], 90);
    const store = new MemorySaveStore();
    await saveWorld(store, g.sim, { worldId: 'zuschuetten', name: 'Zuschütten', now: 1, gameVersion: '0.1.0' });
    const loaded = await loadWorld(store, 'zuschuetten');
    expect(loaded.hashState()).toBe(g.sim.hashState());
    for (const [x, y] of [[px, g.y], [ax, g.y], [bx, g.y], [cx, g.y], [tx, ty]] as const) {
      const a = g.cell(x, y);
      const b = loaded.world.chunks.ensure(0, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
      expect(stateOf(b, a.i), `(${x}, ${y})`).toEqual(stateOf(a.chunk, a.i));
      expect(chunkHash(b)).toBe(chunkHash(a.chunk));
    }
    expect((loaded.system('gathering') as GatheringSystem).spotSpent(0, tx, ty)).toBe(true);
  });
});
