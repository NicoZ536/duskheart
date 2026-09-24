/**
 * Dropped items (M3-10; MASTERPROMPT §11.4 "Aufheben: Kleinteile im Radius 1,5 Tiles automatisch
 * (Magnet), sonst E; volle Taschen → klarer Hinweis", §14 "fliegende Drops mit Magnet"): a drop flies out
 * to a free spot nearby, settles, the magnet pulls small items within its radius – only what the bags
 * can take – and collects them at the feet; single pieces need E; drops of one item landing together
 * join; forgotten drops disappear after their lifetime.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { flightArc, flightPoint, isSmallItem, landingDistancePx, magnetRadiusPx, magnetStep } from '../../../src/game/drops/formulas';
import { newStack } from '../../../src/game/items/stack';
import { BLOCK_ALL, infoLevel } from '../../../src/world/collision/tiles';
import { TILE_PX } from '../../../src/world/model/coords';
import { centre, field, gatherCatalog, gatherWorld, type GatherWorld } from './interaktion-testwelt';

const TICK_HZ = BALANCE.time.tickHz;
const I = BALANCE.interaction;
const catalog = gatherCatalog();

function drop(w: GatherWorld, item: string, count: number, x: number, y: number): number {
  const c = centre(x, y);
  return w.drops.spawn(w.sim, newStack(catalog.get(item), count), 0, c.x, c.y);
}

describe('Formeln', () => {
  it('flight arc, flight track, landing distance, magnet radius and step', () => {
    expect([flightArc(0), flightArc(0.5), flightArc(1), flightArc(2)]).toEqual([0, 1, 0, 0]);
    const p = { x: 0, y: 0 };
    expect(flightPoint(0, 0, 10, 20, 0.5, p)).toEqual({ x: 5, y: 10 });
    expect(landingDistancePx(0)).toBe(I.drops.landingMinTiles * TILE_PX);
    expect(landingDistancePx(0.999999)).toBeCloseTo(I.drops.landingMaxTiles * TILE_PX, 3);
    expect(magnetRadiusPx(0)).toBe(1.5 * TILE_PX);
    expect(magnetRadiusPx(1)).toBe(2.5 * TILE_PX);
    expect(magnetRadiusPx(-3)).toBe(1.5 * TILE_PX);
    const q = { x: 0, y: 0 };
    expect(magnetStep(q, 30, 40, 10)).toBeCloseTo(40, 9);
    expect(q).toEqual({ x: 6, y: 8 });
    expect(magnetStep(q, 6, 9, 10)).toBe(0);
    expect(q).toEqual({ x: 6, y: 9 });
    expect(isSmallItem(CONTENT.collection('items').get('feuerstein'))).toBe(true);
    expect(isSmallItem(catalog.get('probe_speer'))).toBe(false);
  });
});

describe('Flug', () => {
  it('a drop flies 0,45 s to a free spot 0,5–1,25 tiles away on the same level', () => {
    const w = gatherWorld(field(12, 12));
    const from = centre(6, 6);
    for (let k = 0; k < 12; k++) {
      const e = drop(w, 'stein', 2, 6, 6);
      const d = w.drops.get(e);
      if (d === undefined) throw new Error('no drop');
      const dist = Math.hypot(d.toX - from.x, d.toY - from.y);
      expect(dist).toBeGreaterThanOrEqual(I.drops.landingMinTiles * TILE_PX - 1e-9);
      expect(dist).toBeLessThanOrEqual(I.drops.landingMaxTiles * TILE_PX + 1e-9);
      const info = w.collision.grid.tileInfo(0, Math.floor(d.toX / TILE_PX), Math.floor(d.toY / TILE_PX));
      expect(info & BLOCK_ALL).toBe(0);
      expect(infoLevel(info)).toBe(0);
    }
    const ev = w.run(Math.round(I.drops.flightSeconds * TICK_HZ));
    expect((ev.get('dropLanded') ?? []).length).toBeGreaterThan(0);
    expect(w.dropList().every((d) => !d.flying)).toBe(true);
  });

  it('never lands in trees, rocks or deep water; with no free spot it lands at the fallback', () => {
    const w = gatherWorld(['wwwwwwwww', 'wwwwwwwww', 'wwwwwwwww', 'wwwwwwwww', 'wwww.wwww', 'wwwwwwwww', 'wwwwwwwww', 'wwwwwwwww', 'wwwwwwwww']);
    const c = centre(4, 4);
    const e = w.drops.spawn(w.sim, newStack(catalog.get('stein'), 1), 0, c.x, c.y, c.x + 3, c.y);
    expect(w.drops.get(e)).toMatchObject({ toX: c.x + 3, toY: c.y });
  });

  it('is deterministic: the same seed throws the same way', () => {
    const a = gatherWorld(field(10, 10), 5);
    const b = gatherWorld(field(10, 10), 5);
    const c = gatherWorld(field(10, 10), 6);
    const spots = (w: GatherWorld) => [0, 1, 2].map(() => w.drops.get(drop(w, 'holz', 1, 5, 5))).map((d) => [d?.toX, d?.toY]);
    expect(spots(a)).toEqual(spots(b));
    expect(spots(a)).not.toEqual(spots(c));
  });
});

describe('Magnet', () => {
  it('pulls small items within 1,5 tiles after they settled and collects them at the feet', () => {
    const w = gatherWorld(field(12, 12));
    w.place(6, 6);
    const e = w.drops.spawn(w.sim, newStack(catalog.get('feuerstein'), 3), 0, centre(6, 6).x + 20, centre(6, 6).y, centre(6, 6).x + 20, centre(6, 6).y);
    const ev = w.runUntil(() => w.drops.get(e) === undefined, TICK_HZ * 2);
    expect(ev.get('dropPickedUp')).toEqual([expect.objectContaining({ item: 'feuerstein', count: 3, magnet: true })]);
    expect(ev.get('itemsAdded')).toEqual([expect.objectContaining({ item: 'feuerstein', count: 3 })]);
    expect(w.inventory.count('feuerstein')).toBe(3);
    expect(w.sim.ecs.alive(e)).toBe(false);
  });

  it('leaves drops beyond the radius, and single pieces (tools, weapons) for E', () => {
    const w = gatherWorld(field(14, 12));
    w.place(3, 6);
    const far = drop(w, 'stein', 1, 8, 6);
    const spear = w.drops.spawn(w.sim, newStack(catalog.get('probe_speer'), 1), 0, centre(3, 6).x + 12, centre(3, 6).y, centre(3, 6).x + 12, centre(3, 6).y);
    w.run(TICK_HZ * 2);
    expect(w.drops.get(far)).toBeDefined();
    expect(w.drops.get(spear)).toBeDefined();
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ kind: 'drop', entity: spear, action: 'aufheben', subject: 'probe_speer', count: 1 });
    const ev = w.run(2, [{ type: 'player.interact', on: true }]);
    expect(ev.get('dropPickedUp')).toEqual([expect.objectContaining({ item: 'probe_speer', magnet: false })]);
    expect(w.inventory.count('probe_speer')).toBe(1);
  });

  it('worn jewellery with a magnet radius reaches farther', () => {
    const w = gatherWorld(field(14, 12));
    w.place(3, 6);
    w.inventory.give(w.sim, 'probe_ring', 1);
    const slot = w.inventory.state.inventar.findIndex((s) => s?.item === 'probe_ring');
    w.run(1, [{ type: 'inventory.quickMove', from: { bereich: slot >= 0 ? 'inventar' : 'schnellleiste', index: Math.max(slot, 0) } }]);
    expect(w.equipment.stats().werte.magnetradius).toBe(1);
    const c = centre(3, 6);
    const e = w.drops.spawn(w.sim, newStack(catalog.get('stein'), 1), 0, c.x + 2.2 * TILE_PX, c.y, c.x + 2.2 * TILE_PX, c.y);
    w.run(TICK_HZ * 2);
    expect(w.drops.get(e)).toBeUndefined();
  });

  it('with full bags it reports once, keeps the drop, and takes it once there is room', () => {
    const w = gatherWorld(field(12, 12));
    w.place(6, 6);
    for (let k = 0; k < 40; k++) w.inventory.give(w.sim, 'stein', 100);
    expect(w.inventory.roomFor(newStack(catalog.get('holz'), 1))).toBe(0);
    const c = centre(6, 6);
    const e = w.drops.spawn(w.sim, newStack(catalog.get('holz'), 2), 0, c.x + 12, c.y, c.x + 12, c.y);
    const ev = w.run(TICK_HZ * 2);
    expect(ev.get('dropBlocked')).toEqual([expect.objectContaining({ entity: e, item: 'holz', count: 2 })]);
    expect(w.drops.get(e)).toBeDefined();
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ kind: 'drop', block: 'bagsFull' });
    // E tries once: the inventory reports the full bags.
    const press = w.run(TICK_HZ, [{ type: 'player.interact', on: true }]);
    expect((press.get('inventoryFull') ?? []).length).toBe(1);
    w.run(1, [{ type: 'player.interact', on: false }]);
    // Room again: the magnet takes it.
    w.run(1, [{ type: 'inventory.discard', from: { bereich: 'inventar', index: 0 } }]);
    const after = w.run(TICK_HZ);
    expect(after.get('dropPickedUp')).toEqual([expect.objectContaining({ item: 'holz', count: 2, magnet: true })]);
  });
});

describe('Zusammenlegen und Lebensdauer', () => {
  it('drops of one item landing close together join one stack', () => {
    const w = gatherWorld(field(12, 12));
    const c = centre(6, 6);
    w.drops.spawn(w.sim, newStack(catalog.get('holz'), 2), 0, c.x, c.y, c.x, c.y);
    w.run(TICK_HZ);
    const first = w.dropList();
    expect(first).toHaveLength(1);
    const at = first[0] ?? { x: 0, y: 0 };
    w.drops.spawn(w.sim, newStack(catalog.get('holz'), 3), 0, at.x + 30, at.y, at.x + 2, at.y);
    w.drops.spawn(w.sim, newStack(catalog.get('stein'), 1), 0, at.x + 30, at.y, at.x + 2, at.y);
    // The landing spots are random: force both next to the first drop.
    for (const d of w.dropList().slice(1)) {
      const s = w.drops.get(d.entity);
      if (s !== undefined) {
        s.toX = at.x + 3;
        s.toY = at.y;
      }
    }
    w.run(TICK_HZ);
    const list = w.dropList();
    expect(list.map((d) => [d.item, d.count])).toEqual([
      ['holz', 5],
      ['stein', 1],
    ]);
  });

  it('a drop nobody picks up disappears after its lifetime', () => {
    const w = gatherWorld(field(12, 12));
    const e = drop(w, 'laub', 1, 6, 6);
    w.run(2);
    const lifetime = I.drops.lifetimeGameMinutes * w.sim.clock.ticksPerGameMinute;
    w.sim.skipTicks(lifetime - 10);
    w.run(1);
    expect(w.drops.get(e)).toBeDefined();
    const ev = w.run(20);
    expect(ev.get('dropExpired')).toEqual([expect.objectContaining({ entity: e, item: 'laub' })]);
    expect(w.sim.ecs.alive(e)).toBe(false);
  });
});
