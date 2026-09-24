/**
 * M3-12 Steine & Erze (MASTERPROMPT §13.2, §14, §D): nodes with hit points, mined with the pickaxe when
 * its power reaches their hardness – otherwise "Zu hart" with sparks and nothing happens; ore veins and
 * host rock under ground are tile material the pickaxe opens (the tile becomes floor, the vein yields
 * what its ore node yields); surface nodes come back after 7 days outside a base radius, cave nodes never –
 * in active chunks by the world tick, in frozen chunks analytically when the zone reaches them again
 * (the "Aufhol-Fall": ticking and caught up give the same chunk, also in the game's own world).
 * Acceptance test of M3-12 (PROGRESS: `erze.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import { chunkHash, NO_REGROW_TICK, TILE_FLAG_DUG } from '../../../src/world/model/chunk';
import { BLOCK_ALL, BLOCK_OBJECT } from '../../../src/world/collision/tiles';
import { CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { createSimulation } from '../../../src/game/setup';
import { powerSuffices } from '../../../src/game/gathering/formulas';
import { createHarvestPlan, createObjectHit, type GatheringSystem } from '../../../src/game/gathering/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import { field, gatherWorld, OFFSET, type GatherWorld } from './interaktion-testwelt';

const IDS = contentWorldIdTables();
const TICK_HZ = BALANCE.time.tickHz;
const NODE_DAYS = BALANCE.gathering.nodeRegrowDays;

function work(w: GatherWorld, commands: { tx?: number; ty?: number } = {}, max = 900): Map<string, unknown[]> {
  const ev = w.runUntil(() => !w.interaction.working, max, [{ type: 'player.interact', on: true, ...commands }]);
  w.run(1, [{ type: 'player.interact', on: false }]);
  return ev;
}

describe('§13.2 Abbaukraft ≥ Härte', () => {
  it('holds for the content: T0 pickaxes open copper, tin and Grünhain rocks, not saltpetre or ice crystals', () => {
    const objects = CONTENT.collection('worldObjects');
    expect(powerSuffices(1, objects.get('erz_kupfer').hardness)).toBe(true);
    expect(powerSuffices(1, objects.get('erz_zinn').hardness)).toBe(true);
    expect(powerSuffices(1, objects.get('fels_gross_gruenhain').hardness)).toBe(true);
    expect(powerSuffices(1, objects.get('erz_salpeter').hardness)).toBe(false);
    expect(powerSuffices(2, objects.get('erz_salpeter').hardness)).toBe(true);
    expect(powerSuffices(1, objects.get('kristall_eis').hardness)).toBe(false);
  });

  it('a too weak pickaxe swings once: sparks, "Zu hart", no damage, the action stops', () => {
    const w = gatherWorld(field(10, 10, ['', '', '', '....X']));
    w.spawn(4, 5);
    w.hold('probe_spitzhacke');
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ kind: 'object', subject: 'kristall_eis', action: 'abbauen', tooWeak: true, block: null });
    const ev = work(w);
    expect(ev.get('harvestHit')).toEqual([expect.objectContaining({ target: 'kristall_eis', tooHard: true, hits: 0, material: 'kristall' })]);
    expect(ev.get('actionStopped')).toEqual([expect.objectContaining({ reason: 'tooHard' })]);
    const { chunk, i } = w.at(4, 3);
    expect(chunk.objectState.get(i)).toBeUndefined();
    expect(w.objectAt(4, 3)).toBe('kristall_eis');
    // A too hard swing does not wear the tool.
    expect(w.inventory.selected()?.haltbarkeit).toBe(60);
  });
});

describe('Knoten mit Treffer-HP', () => {
  it('a Grünhain rock takes 5 hits; its hit points stay when the player stops', () => {
    const w = gatherWorld(field(10, 10, ['', '', '', '....R']));
    w.spawn(4, 5);
    w.hold('probe_spitzhacke');
    // Two hits, then release.
    let hits = 0;
    w.run(1, [{ type: 'player.interact', on: true }]);
    for (let t = 0; t < 200 && hits < 2; t++) hits += (w.run(1).get('harvestHit') ?? []).length;
    w.run(1, [{ type: 'player.interact', on: false }]);
    const { chunk, i } = w.at(4, 3);
    expect(chunk.objectState.get(i)).toMatchObject({ hp: 3 });
    expect(w.interaction.working).toBe(false);
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ hitsTotal: 5, hitsDone: 2 });
    const rest = work(w);
    expect((rest.get('harvestHit') ?? []).length).toBe(3);
    expect(rest.get('harvested')).toEqual([expect.objectContaining({ target: 'fels_klein_gruenhain', skill: 'bergbau', xp: 'gestein_abgebaut', material: 'stein' })]);
    expect(w.objectAt(4, 3)).toBe('');
    expect(w.collision.grid.tileInfo(0, OFFSET + 4, OFFSET + 3) & BLOCK_OBJECT).toBe(0);
    w.collect();
    expect(w.inventory.count('stein')).toBeGreaterThanOrEqual(2);
  });

  it('a copper node yields copper ore and trains mining as ore', () => {
    const w = gatherWorld(field(10, 10, ['', '', '', '....C']));
    w.spawn(4, 5);
    w.hold('probe_spitzhacke');
    const ev = work(w);
    expect(ev.get('harvested')).toEqual([expect.objectContaining({ target: 'erz_kupfer', xp: 'erz_abgebaut', material: 'erz' })]);
    w.collect();
    expect(w.inventory.count('kupfererz')).toBeGreaterThanOrEqual(2);
  });
});

describe('Erzadern im Untergrund als grabbares Tile-Material', () => {
  function cave(): GatherWorld {
    const w = gatherWorld(field(10, 10, ['', '', '', '###', '#..', '#..']));
    const biome = IDS.biomes.runtimeId('wurzelhoehlen');
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) w.at(x, y).chunk.biome[w.at(x, y).i] = biome;
    const vein = w.at(1, 3);
    vein.chunk.solid[vein.i] = IDS.terrain.runtimeId('ader_kupfer');
    const saltpetre = w.at(2, 3);
    saltpetre.chunk.solid[saltpetre.i] = IDS.terrain.runtimeId('ader_salpeter');
    return w;
  }

  it('the pickaxe opens host rock into a tunnel and yields what a small rock of the biome yields', () => {
    const w = cave();
    w.place(1, 4);
    w.body().facing = 'left';
    w.hold('probe_spitzhacke');
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ kind: 'tile', subject: 'fels', action: 'abbauen', dig: 'stollen', hitsTotal: 3 });
    const ev = work(w);
    expect((ev.get('harvestHit') ?? []).length).toBe(3);
    expect(ev.get('tileDug')).toEqual([expect.objectContaining({ from: 'fels', result: 'stollen' })]);
    const { chunk, i } = w.at(0, 4);
    expect(chunk.solid[i]).toBe(0);
    expect((chunk.flags[i] as number) & TILE_FLAG_DUG).toBe(TILE_FLAG_DUG);
    expect(w.collision.grid.tileInfo(0, OFFSET, OFFSET + 4) & BLOCK_ALL).toBe(0);
    w.collect();
    expect(w.inventory.count('stein')).toBeGreaterThanOrEqual(2);
  });

  it('a copper vein yields copper ore (5 hits); a saltpetre vein is too hard for a T0 pickaxe', () => {
    const w = cave();
    w.place(1, 4);
    w.body().facing = 'up';
    w.hold('probe_spitzhacke');
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ kind: 'tile', subject: 'ader_kupfer', hitsTotal: 5 });
    const ev = work(w);
    expect(ev.get('harvested')).toEqual([expect.objectContaining({ target: 'ader_kupfer', xp: 'erz_abgebaut' })]);
    w.collect();
    expect(w.inventory.count('kupfererz')).toBeGreaterThanOrEqual(2);
    const t = w.tile(2, 3);
    const hard = work(w, { tx: t.tx, ty: t.ty });
    expect(hard.get('harvestHit')).toEqual([expect.objectContaining({ target: 'ader_salpeter', tooHard: true })]);
    expect(w.groundAt(2, 3)).toBe('ader_salpeter');
  });
});

describe('Nachwachsen nach 7 Tagen außerhalb des Basisradius', () => {
  function minedRock(): { w: GatherWorld; due: number } {
    const w = gatherWorld(field(10, 10, ['', '', '', '....R']));
    w.spawn(4, 5);
    w.hold('probe_spitzhacke');
    const ev = work(w);
    const tick = (ev.get('harvested') as { tick: number }[])[0]?.tick ?? 0;
    return { w, due: tick + NODE_DAYS * w.sim.clock.ticksPerDay };
  }

  it('the surface rock is remembered and back after 7 days (active chunk)', () => {
    const { w, due } = minedRock();
    const t = w.tile(4, 3);
    expect(w.gathering.regrowAt(0, t.tx, t.ty)).toBe(due);
    w.sim.skipTicks(due - w.sim.tick - TICK_HZ * 3);
    w.run(TICK_HZ);
    expect(w.objectAt(4, 3)).toBe('');
    const ev = w.run(TICK_HZ * 3);
    expect(ev.get('objectRegrown')).toEqual([expect.objectContaining({ object: 'fels_klein_gruenhain' })]);
    expect(w.objectAt(4, 3)).toBe('fels_klein_gruenhain');
    expect(w.gathering.regrowingCount).toBe(0);
    expect(w.collision.grid.tileInfo(0, t.tx, t.ty) & BLOCK_OBJECT).not.toBe(0);
  });

  it('waits while the player stands where it would grow', () => {
    const { w, due } = minedRock();
    const t = w.tile(4, 3);
    w.run(1, [{ type: 'player.teleport', x: t.tx * TILE_PX + 8, y: t.ty * TILE_PX + 8, layer: 0 }]);
    w.sim.skipTicks(due - w.sim.tick + 1);
    w.run(TICK_HZ * 2);
    expect(w.objectAt(4, 3)).toBe('');
    w.run(1, [{ type: 'player.teleport', x: t.tx * TILE_PX + 8, y: (t.ty + 3) * TILE_PX + 8, layer: 0 }]);
    w.run(TICK_HZ * 2);
    expect(w.objectAt(4, 3)).toBe('fels_klein_gruenhain');
  });

  it('inside a base radius it is not remembered at all', () => {
    const w = gatherWorld(field(10, 10, ['', '', '', '....R']));
    w.gathering.addBaseAreas({ inBase: () => true });
    w.spawn(4, 5);
    w.hold('probe_spitzhacke');
    work(w);
    expect(w.gathering.regrowingCount).toBe(0);
  });

  it('cave nodes never regrow (regrow days null)', () => {
    const w = gatherWorld(field(10, 10, ['', '', '', '....R']));
    const { chunk, i } = w.at(4, 3);
    chunk.object[i] = IDS.objects.runtimeId('fels_klein_wurzelhoehlen');
    w.spawn(4, 5);
    w.hold('probe_spitzhacke');
    work(w);
    expect(w.objectAt(4, 3)).toBe('');
    expect(w.gathering.regrowingCount).toBe(0);
  });

  it('Aufhol-Fall: frozen and caught up equals ticking – in one step or two', () => {
    const ticking = minedRock();
    const frozen = minedRock();
    const twice = minedRock();
    expect(frozen.due).toBe(ticking.due);
    const from = frozen.w.sim.tick;
    frozen.w.active = [];
    twice.w.active = [];
    const span = ticking.due - from + TICK_HZ * 5;
    for (const { w } of [ticking, frozen, twice]) w.sim.skipTicks(span);
    ticking.w.run(TICK_HZ);
    const chunkOf = (w: GatherWorld) => w.at(4, 3).chunk;
    frozen.w.gathering.catchUp(chunkOf(frozen.w), from, frozen.w.sim.tick);
    const mid = ticking.due - 1;
    twice.w.gathering.catchUp(chunkOf(twice.w), from, mid);
    expect(twice.w.objectAt(4, 3)).toBe('');
    twice.w.gathering.catchUp(chunkOf(twice.w), mid, twice.w.sim.tick);
    expect(ticking.w.objectAt(4, 3)).toBe('fels_klein_gruenhain');
    expect(chunkHash(chunkOf(frozen.w))).toBe(chunkHash(chunkOf(ticking.w)));
    expect(chunkHash(chunkOf(twice.w))).toBe(chunkHash(chunkOf(ticking.w)));
    expect(frozen.w.gathering.save.serialize()).toEqual(ticking.w.gathering.save.serialize());
  });
});

describe('Aufhol-Fall in der Welt des Spiels', () => {
  it('a mined surface rock is back when the active zone comes back after 8 days away', () => {
    const sim = createSimulation({ seed: 20260923, worldSize: 'small' });
    sim.step([{ type: 'player.spawn' }]);
    const player = sim.system('player') as PlayerSystem;
    const gathering = sim.system('gathering') as GatheringSystem;
    expect(sim.player).not.toBe(NULL_ENTITY);
    const at = { x: 0, y: 0 };
    player.position(sim, at);
    const ptx = Math.floor(at.x / TILE_PX);
    const pty = Math.floor(at.y / TILE_PX);
    // The nearest surface rock or ore node that regrows.
    const hit = createObjectHit();
    let found = false;
    for (let r = 1; r < 90 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = ptx + dx;
          const ty = pty + dy;
          if (sim.world.chunks.get(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT) === undefined) sim.world.chunks.ensure(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
          if (gathering.objectAt(0, tx, ty, hit) && hit.tx === tx && hit.ty === ty && (hit.rule?.def.kind === 'fels' || hit.rule?.def.kind === 'erz') && hit.rule.def.regrowDays !== null && hit.rule.def.hardness === 1) found = true;
        }
      }
    }
    expect(found).toBe(true);
    const id = hit.rule?.id ?? '';
    const node = { tx: hit.tx, ty: hit.ty };
    // Stand next to it and mine it with a T0 pickaxe (the tools arrive with M3-15; the gathering API takes any held tool).
    sim.step([{ type: 'player.teleport', x: node.tx * TILE_PX + 8, y: (node.ty + 1) * TILE_PX + 8, layer: 0 }]);
    const plan = createHarvestPlan();
    const pickaxe = { kind: 'spitzhacke', power: 1, broken: false };
    let outcome = 'hit';
    for (let k = 0; k < 20 && outcome !== 'done'; k++) {
      expect(gathering.objectAt(0, node.tx, node.ty, hit)).toBe(true);
      gathering.planObject(sim, hit, pickaxe, plan);
      outcome = gathering.hitObject(sim, hit, plan, pickaxe, node.tx * TILE_PX + 8, (node.ty + 1) * TILE_PX + 8);
    }
    expect(outcome).toBe('done');
    expect(gathering.objectAt(0, node.tx, node.ty, hit)).toBe(false);
    const due = gathering.regrowAt(0, node.tx, node.ty);
    expect(due).not.toBe(NO_REGROW_TICK);
    // Walk far away (the chunk freezes), jump 8 days, come back: the zone catches the chunk up.
    const far = 12 * 32;
    sim.step([{ type: 'player.teleport', x: (node.tx + far) * TILE_PX, y: node.ty * TILE_PX, layer: 0 }]);
    sim.step();
    expect(sim.world.zone.isTileActive(0, node.tx, node.ty)).toBe(false);
    sim.step([{ type: 'advanceTime', minutes: (NODE_DAYS + 1) * 24 * 60 }]);
    expect(sim.tick).toBeGreaterThan(due);
    expect(gathering.objectAt(0, node.tx, node.ty, hit)).toBe(false);
    sim.step([{ type: 'player.teleport', x: node.tx * TILE_PX + 8, y: (node.ty + 2) * TILE_PX + 8, layer: 0 }]);
    sim.step();
    expect(sim.world.zone.isTileActive(0, node.tx, node.ty)).toBe(true);
    expect(gathering.objectAt(0, node.tx, node.ty, hit)).toBe(true);
    expect(hit.rule?.id).toBe(id);
    expect(gathering.regrowingCount).toBe(0);
  });
});
