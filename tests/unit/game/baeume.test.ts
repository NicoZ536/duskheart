/**
 * M3-11 Bäume fällen (MASTERPROMPT §14, §D): E held with an axe strikes a tree once per swing, the ring
 * counts the hits of §D's formula (Grünhain tree: 5 with the stone axe, 3 with the bronze axe), the tree
 * falls away from the player, lands after its fall time with its drops along the trunk and a hook for
 * the creatures under it; the stump stays (it blocks), clearing it yields wood (and resin) and 40 % a
 * sapling; fruit trees are picked by hand in their season. Outside bases the stump grows back into a tree
 * after its regrow days – ticking or caught up after freezing, with the same result.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { Rng } from '../../../src/engine/rng';
import { chunkHash, NO_REGROW_TICK } from '../../../src/world/model/chunk';
import { BLOCK_OBJECT } from '../../../src/world/collision/tiles';
import { fallDirection, hitsNeeded, rollDrops, stumpHp } from '../../../src/game/gathering/formulas';
import { STAGE_HARVESTED, STAGE_STUMP } from '../../../src/game/gathering/objectState';
import { contentGatheringRules } from '../../../src/game/gathering/rules';
import type { TreeFall } from '../../../src/game/gathering/system';
import { field, gatherWorld, OFFSET, type GatherWorld } from './interaktion-testwelt';

const TICK_HZ = BALANCE.time.tickHz;
const H = BALANCE.harvest;

/** A meadow with an oak (2 tiles wide) at map (5, 5). */
function oakWorld(): GatherWorld {
  return gatherWorld(field(14, 12, ['', '', '', '', '', '.....E']));
}

function stateAt(w: GatherWorld, x: number, y: number): { hp: number; growth: number; regrowAtTick: number } | undefined {
  const { chunk, i } = w.at(x, y);
  return chunk.objectState.get(i);
}

/** Holds E until the running action stops; returns the events. */
function work(w: GatherWorld, max = 600): Map<string, unknown[]> {
  const ev = w.runUntil(() => !w.interaction.working, max, [{ type: 'player.interact', on: true }]);
  w.run(1, [{ type: 'player.interact', on: false }]);
  return ev;
}

describe('§D: Treffer = ⌈HP / (Abbaukraft × (1 + Skillbonus))⌉', () => {
  it('Grünhain tree: 5 hits with the stone axe, 3 with the bronze axe; the skill bonus shortens it', () => {
    const oak = contentGatheringRules().object('baum_eiche');
    expect(oak?.standing?.hp).toBe(5);
    expect(hitsNeeded(5, 1)).toBe(5);
    expect(hitsNeeded(5, 2)).toBe(3);
    expect(hitsNeeded(5, 1, 0.25)).toBe(4);
    expect(hitsNeeded(0, 1)).toBe(0);
    expect(() => hitsNeeded(5, 0)).toThrow(RangeError);
    expect(stumpHp(5)).toBe(2);
  });

  it('the stone axe fells the oak in 5 swings, the ring counting each hit', () => {
    const w = oakWorld();
    w.spawn(5, 7);
    w.hold('probe_steinaxt');
    const progress: number[] = [];
    w.run(1, [{ type: 'player.interact', on: true }]);
    expect(w.interaction.focus).toMatchObject({ kind: 'object', subject: 'baum_eiche', action: 'faellen', working: true, hitsTotal: 5 });
    for (let t = 0; t < 200 && w.interaction.working; t++) {
      w.run(1);
      progress.push(w.interaction.focus.progress);
    }
    w.run(1, [{ type: 'player.interact', on: false }]);
    const steps = [...new Set(progress.filter((p) => p < 1))];
    expect(steps).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    expect(stateAt(w, 5, 5)?.growth).toBe(STAGE_STUMP);
  });

  it('the bronze axe needs 3 swings; every hit wears the axe by one use', () => {
    const w = oakWorld();
    w.spawn(5, 7);
    w.hold('probe_bronzeaxt');
    const ev = work(w);
    expect((ev.get('harvestHit') ?? []).length).toBe(3);
    expect(ev.get('treeFelled')).toHaveLength(1);
    expect(w.inventory.selected()?.haltbarkeit).toBe(60 - 3);
    // First hit after 1/3 s, then one per 0,5 s swing.
    const hits = (ev.get('harvestHit') as { tick: number; hits: number; xp: string }[]).map((h) => [h.hits, h.xp]);
    expect(hits).toEqual([
      [1, 'baum_treffer'],
      [2, 'baum_treffer'],
      [3, 'baum_treffer'],
    ]);
    expect(ev.get('harvested')).toEqual([expect.objectContaining({ target: 'baum_eiche', action: 'faellen', skill: 'holzfaellen', xp: 'baum_gefaellt' })]);
  });
});

describe('Fall vom Spieler weg', () => {
  it('fallDirection points away from the player along the larger axis', () => {
    expect(fallDirection(16, 0)).toBe('rechts');
    expect(fallDirection(-16, 4)).toBe('links');
    expect(fallDirection(3, -20)).toBe('nord');
    expect(fallDirection(-2, 30)).toBe('sued');
    expect(fallDirection(8, 8)).toBe('rechts');
  });

  it('the felled tree falls away, lands after 1 s with its logs along the trunk and hurts what lies under it', () => {
    const w = oakWorld();
    w.spawn(3, 5);
    w.hold('probe_steinaxt');
    const landed: { fall: TreeFall; trunk: { x0: number; y0: number; x1: number; y1: number }; damage: number }[] = [];
    w.gathering.onTreeLanded((_sim, fall, trunk, damage) => landed.push({ fall, trunk: { ...trunk }, damage }));
    const ev = work(w);
    const felled = (ev.get('treeFelled') as { direction: string; landsAtTick: number; tick: number }[])[0];
    expect(felled?.direction).toBe('rechts');
    expect((felled?.landsAtTick ?? 0) - (felled?.tick ?? 0)).toBe(H.tree.fallSeconds * TICK_HZ);
    expect(w.gathering.fallingTrees).toHaveLength(1);
    expect(w.dropList()).toEqual([]);
    const after = w.runUntil(() => w.gathering.fallingTrees.length === 0, 120);
    expect(after.get('treeLanded')).toHaveLength(1);
    expect(landed).toHaveLength(1);
    expect(landed[0]?.damage).toBe(H.tree.creatureDamage);
    const t = landed[0]?.trunk ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
    expect(t.x1 - t.x0).toBe(H.tree.fallLengthTiles * 16);
    expect(t.y1).toBe(t.y0);
    // Logs, twigs, bark and leaves fly out of the middle of the trunk, east of the stump.
    const items = new Set(w.dropList().map((d) => d.item));
    expect(items.has('holz')).toBe(true);
    for (const item of items) expect(['holz', 'zweig', 'rinde', 'laub']).toContain(item);
    for (const d of w.dropList()) expect(d.x).toBeGreaterThan((OFFSET + 5) * 16);
  });
});

describe('Stumpf', () => {
  it('stays after felling, still blocks, and is cleared with the axe for wood (2 hits)', () => {
    const w = oakWorld();
    w.spawn(5, 7);
    w.hold('probe_steinaxt');
    work(w);
    w.run(90);
    expect(w.objectAt(5, 5)).toBe('baum_eiche');
    expect(stateAt(w, 5, 5)).toMatchObject({ growth: STAGE_STUMP, hp: 2 });
    expect(w.collision.grid.tileInfo(0, OFFSET + 5, OFFSET + 5) & BLOCK_OBJECT).not.toBe(0);
    // The magnet collects the logs where they lie; the stump is the next target.
    w.collect();
    const logs = w.inventory.count('holz');
    expect(logs).toBeGreaterThanOrEqual(3);
    w.run(2);
    expect(w.interaction.focus).toMatchObject({ kind: 'object', action: 'roden', subject: 'baum_eiche', hitsTotal: 2 });
    const ev = work(w);
    expect((ev.get('harvestHit') ?? []).length).toBe(2);
    expect(ev.get('harvested')).toEqual([expect.objectContaining({ action: 'roden', xp: 'stumpf_gerodet' })]);
    expect(w.objectAt(5, 5)).toBe('');
    expect(w.collision.grid.tileInfo(0, OFFSET + 5, OFFSET + 5) & BLOCK_OBJECT).toBe(0);
    w.collect();
    expect(w.inventory.count('holz')).toBeGreaterThan(logs);
    // A cleared stump never comes back.
    expect(w.gathering.regrowAt(0, OFFSET + 5, OFFSET + 5)).toBe(NO_REGROW_TICK);
  });

  it('clearing yields a sapling of its species with 40 % (resin from conifers)', () => {
    const oak = CONTENT.collection('worldObjects').get('baum_eiche').drops ?? [];
    const pine = CONTENT.collection('worldObjects').get('baum_kiefer').drops ?? [];
    const rng = new Rng(7);
    const n = 4000;
    let saplings = 0;
    for (let k = 0; k < n; k++) if (rollDrops(oak, 'roden', 'sommer', () => rng.next()).some((d) => d.item === 'setzling_eiche')) saplings++;
    expect(saplings / n).toBeGreaterThan(BALANCE.items.drops.saplingChance - 0.03);
    expect(saplings / n).toBeLessThan(BALANCE.items.drops.saplingChance + 0.03);
    const pineStump = rollDrops(pine, 'roden', 'winter', () => rng.next()).map((d) => d.item);
    expect(pineStump).toEqual(expect.arrayContaining(['holz', 'harz']));
  });
});

describe('Obstbäume', () => {
  it('carry fruit only in their season, picked by hand; the bare tree carries again after its days', () => {
    const w = gatherWorld(field(12, 12, ['', '', '', '', '', '.....A']));
    w.spawn(5, 7);
    // Spring: no apples – by hand the tree offers only felling, which needs an axe.
    const spring = w.run(2, [{ type: 'player.interact', on: true }]);
    expect(spring.get('commandRejected')).toEqual([expect.objectContaining({ type: 'player.interact', reason: 'needsTool' })]);
    w.run(1, [{ type: 'player.interact', on: false }]);
    w.season('herbst');
    w.run(2);
    expect(w.interaction.focus).toMatchObject({ kind: 'object', action: 'ernten', byHand: true, block: null });
    const ev = work(w);
    expect(ev.get('harvested')).toEqual([expect.objectContaining({ action: 'ernten', skill: 'sammeln' })]);
    const s = stateAt(w, 5, 5);
    expect(s?.growth).toBe(STAGE_HARVESTED);
    expect(s?.regrowAtTick).toBe((ev.get('harvested') as { tick: number }[])[0]!.tick + H.fruitRegrowDays * w.sim.clock.ticksPerDay);
    w.collect();
    expect(w.inventory.count('apfel')).toBeGreaterThanOrEqual(2);
    // Bare: the hand finds nothing more to pick.
    w.run(2);
    expect(w.interaction.focus.action).toBe('faellen');
    w.sim.skipTicks(H.fruitRegrowDays * w.sim.clock.ticksPerDay);
    const back = w.run(TICK_HZ);
    expect(back.get('objectRegrown')).toEqual([expect.objectContaining({ object: 'baum_apfelbaum' })]);
    expect(stateAt(w, 5, 5)).toBeUndefined();
  });
});

describe('Nachwachsen außerhalb von Basen', () => {
  /** Fells the oak and returns the tick the stump grows back. */
  function felled(w: GatherWorld): number {
    w.spawn(5, 7);
    w.hold('probe_steinaxt');
    work(w);
    w.run(90);
    return stateAt(w, 5, 5)?.regrowAtTick ?? NO_REGROW_TICK;
  }

  it('the stump grows back into the tree after the regrow days (active chunk, world tick)', () => {
    const w = oakWorld();
    const due = felled(w);
    expect(due).toBeGreaterThan(w.sim.tick + (BALANCE.gathering.treeRegrowDays - 1) * w.sim.clock.ticksPerDay);
    w.sim.skipTicks(due - w.sim.tick - TICK_HZ * 2);
    w.run(TICK_HZ);
    expect(stateAt(w, 5, 5)?.growth).toBe(STAGE_STUMP);
    const ev = w.run(TICK_HZ * 3);
    expect(ev.get('objectRegrown')).toEqual([expect.objectContaining({ object: 'baum_eiche' })]);
    expect(stateAt(w, 5, 5)).toBeUndefined();
    expect(w.objectAt(5, 5)).toBe('baum_eiche');
  });

  it('inside a base the stump stays a stump', () => {
    const w = oakWorld();
    w.gathering.addBaseAreas({ inBase: (layer, tx, ty) => layer === 0 && Math.abs(tx - (OFFSET + 5)) < 8 && Math.abs(ty - (OFFSET + 5)) < 8 });
    expect(felled(w)).toBe(NO_REGROW_TICK);
    w.sim.skipTicks(BALANCE.gathering.treeRegrowDays * 2 * w.sim.clock.ticksPerDay);
    w.run(TICK_HZ);
    expect(stateAt(w, 5, 5)?.growth).toBe(STAGE_STUMP);
  });

  it('a frozen chunk catches up to the same state as a ticking one, in one or two steps', () => {
    const ticking = oakWorld();
    const frozen = oakWorld();
    const twice = oakWorld();
    const due = felled(ticking);
    expect(felled(frozen)).toBe(due);
    expect(felled(twice)).toBe(due);
    const from = frozen.sim.tick;
    for (const w of [frozen, twice]) w.active = [];
    const span = due - from + TICK_HZ * 10;
    for (const w of [ticking, frozen, twice]) w.sim.skipTicks(span);
    ticking.run(TICK_HZ);
    const chunkOf = (w: GatherWorld) => w.at(5, 5).chunk;
    frozen.gathering.catchUp(chunkOf(frozen), from, frozen.sim.tick);
    const mid = from + Math.floor(span / 2);
    twice.gathering.catchUp(chunkOf(twice), from, mid);
    expect(stateAt(twice, 5, 5)?.growth).toBe(STAGE_STUMP);
    twice.gathering.catchUp(chunkOf(twice), mid, twice.sim.tick);
    expect(chunkHash(chunkOf(frozen))).toBe(chunkHash(chunkOf(ticking)));
    expect(chunkHash(chunkOf(twice))).toBe(chunkHash(chunkOf(ticking)));
    expect(ticking.objectAt(5, 5)).toBe('baum_eiche');
  });
});
