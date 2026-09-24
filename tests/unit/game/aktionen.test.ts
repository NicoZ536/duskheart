/**
 * M3-25: the player's actions (MASTERPROMPT §11.4 "Aktionen", §18): eating and drinking take time and are
 * interrupted by hits, rolls, sprints and the player; nutrition by freshness (fresh, old −25 %, rotten −50 %
 * with poisoning risk), raw food frightens; drinking from rivers and lakes (unfiltered: 10 % fever,
 * Nebelmoor 50 %), springs are clean, the sea salty; sitting on seats (resting at a fire), throwing.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import {
  consumeTicks,
  dishComfort,
  drinkable,
  eatenNutrition,
  eatingFright,
  feverChance,
  foodPoisonChance,
  freshnessStage,
  isRawFood,
  nutritionFactor,
  sipTicks,
  throwArcPx,
  throwFlightTicks,
  waterSource,
} from '../../../src/game/actions/formulas';
import { beltCommand } from '../../../src/game/actions/input';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { newStack } from '../../../src/game/items/stack';
import { WATER_DEPTH_DEEP, WATER_DEPTH_SHALLOW, WATER_FROZEN, WATER_LAKE, WATER_RIVER, WATER_SEA, WATER_SPRING } from '../../../src/world/model/chunk';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { OFFSET, T, meadow } from './spieler-testwelt';

const TICK = BALANCE.time.tickHz;
const A = BALANCE.actions;
const items = contentItemCatalog();
const INV0 = { bereich: 'inventar', index: 0 } as const;

function world(rows: readonly string[] = meadow(30, 30), seed = 1): LifeWorld {
  const w = lifeWorld(rows, seed);
  w.spawn(10, 10);
  return w;
}

function rejected(ev: Map<string, unknown[]>): string[] {
  return ((ev.get('commandRejected') ?? []) as Array<{ reason: string }>).map((r) => r.reason);
}

/** Sets the water byte (and biome) of drawn tile (x, y). */
function water(w: LifeWorld, x: number, y: number, bits: number, biome?: string): void {
  const { chunk, i } = w.chunks.at(OFFSET + x, OFFSET + y);
  chunk.water[i] = bits;
  if (biome !== undefined) chunk.biome[i] = contentWorldIdTables().biomes.runtimeId(biome);
}

describe('Aktionen (reine Funktionen)', () => {
  it('freshness stages of §18: fresh ≥ 60, old 20–60 (×0,75), rotten < 20 (×0,5, 40 % poisoning)', () => {
    expect([undefined, 100, 60, 59.9, 20, 19.9, 0].map(freshnessStage)).toEqual([null, 'frisch', 'frisch', 'alt', 'alt', 'faulig', 'faulig']);
    expect([nutritionFactor(null), nutritionFactor('frisch'), nutritionFactor('alt'), nutritionFactor('faulig')]).toEqual([1, 1, 0.75, 0.5]);
    expect([foodPoisonChance('frisch'), foodPoisonChance('alt'), foodPoisonChance('faulig')]).toEqual([0, 0, 0.4]);
    const apfel = items.get('apfel');
    expect(eatenNutrition(apfel, 'frisch')).toEqual({ satiety: 8, thirst: 5 });
    expect(eatenNutrition(apfel, 'alt')).toEqual({ satiety: 6, thirst: 3.75 });
    expect(eatenNutrition(items.get('tang'), 'frisch')).toEqual({ satiety: 3, thirst: -3 });
  });

  it('raw or rotten food frightens once (+5); a piece takes 1,5 s raw, 2,5 s dish, 1 s potion; a sip 2 s', () => {
    expect(isRawFood(items.get('himbeeren'))).toBe(true);
    expect(isRawFood(items.get('stein'))).toBe(false);
    expect([eatingFright(true, 'frisch'), eatingFright(false, 'faulig'), eatingFright(true, 'faulig'), eatingFright(false, 'alt')]).toEqual([5, 5, 5, 0]);
    expect([consumeTicks('nahrung'), consumeTicks('gericht'), consumeTicks('trank'), consumeTicks('medizin')]).toEqual([90, 150, 60, 90]);
    expect(dishComfort(items.get('apfel'))).toBe(0);
    expect(dishComfort({ ...items.get('apfel'), kategorie: 'gericht' })).toBe(10);
    expect(sipTicks()).toBe(2 * TICK);
  });

  it('water: rivers, lakes and springs are drinkable, the sea and ice not; fever 10 %, Nebelmoor 50 %, springs 0 %', () => {
    expect(waterSource(0)).toBeNull();
    expect(waterSource(WATER_DEPTH_SHALLOW | WATER_RIVER)).toBe('fluss');
    expect(waterSource(WATER_DEPTH_DEEP | WATER_LAKE)).toBe('see');
    expect(waterSource(WATER_DEPTH_SHALLOW | WATER_SPRING)).toBe('quelle');
    expect(waterSource(WATER_DEPTH_DEEP | WATER_SEA)).toBe('meer');
    expect(waterSource(WATER_DEPTH_SHALLOW | WATER_LAKE | WATER_FROZEN)).toBe('eis');
    expect(['fluss', 'see', 'quelle', 'meer', 'eis'].map((s) => drinkable(s as Parameters<typeof drinkable>[0]))).toEqual([true, true, true, false, false]);
    expect(feverChance('fluss', 'gruenhain')).toBe(0.1);
    expect(feverChance('see', 'nebelmoor')).toBe(0.5);
    expect(feverChance('quelle', 'nebelmoor')).toBe(0);
  });

  it('a throw flies at 10 tiles/s along a parabola', () => {
    expect(throwFlightTicks(5 * T)).toBe(Math.round(0.5 * TICK));
    expect(throwArcPx(0, 8 * T)).toBe(0);
    expect(throwArcPx(0.5, 8 * T)).toBe(A.throw.arcPxPerTile * 8);
    expect(throwArcPx(1, 8 * T)).toBe(0);
  });
});

describe('Essen', () => {
  it('eating a raw apple takes 1,5 s, then satiety +8, thirst +5, fear +5 and one apple fewer', () => {
    const w = world();
    w.vit().satiety = 50;
    w.vit().thirst = 50;
    w.run(1, [{ type: 'inventory.give', item: 'apfel', count: 3 }]);
    const start = w.run(1, [{ type: 'action.eat', from: INV0 }]);
    expect(start.get('activityStarted')).toEqual([expect.objectContaining({ action: 'essen', item: 'apfel', ticks: 90 })]);
    const s0 = w.vit().satiety;
    expect(w.run(88).get('itemEaten')).toBeUndefined();
    const done = w.run(1);
    expect(done.get('itemEaten')).toEqual([expect.objectContaining({ item: 'apfel', satiety: 8, thirst: 5, freshness: 'frisch', poisoned: false })]);
    expect(done.get('activityFinished')).toEqual([expect.objectContaining({ action: 'essen' })]);
    expect(done.get('fearChanged')).toEqual([expect.objectContaining({ amount: 5, reason: 'nahrung' })]);
    expect(w.vit().satiety - s0).toBeCloseTo(8, 0);
    expect(w.inventory.count('apfel')).toBe(2);
  });

  it('a hit interrupts eating – nothing is eaten (a 2-level fall while walking on)', () => {
    const w = lifeWorld(['..2222', '..2222', '..2222', '..2222', '..2222']);
    w.spawn(3, 2);
    w.run(1, [{ type: 'inventory.give', item: 'apfel', count: 1 }]);
    w.run(1, [{ type: 'action.eat', from: INV0 }]);
    const ev = w.run(TICK, [{ type: 'player.move', dx: -1, dy: 0 }]);
    expect(ev.get('playerDamaged')).toEqual([expect.objectContaining({ cause: 'sturz', amount: 15 })]);
    expect(ev.get('activityInterrupted')).toEqual([expect.objectContaining({ action: 'essen', item: 'apfel', reason: 'treffer' })]);
    expect(ev.get('itemEaten')).toBeUndefined();
    expect(w.inventory.count('apfel')).toBe(1);
  });

  it('a roll, a sprint or cancelling interrupts; eating while eating is busy; stones are not edible', () => {
    const w = world();
    w.run(1, [{ type: 'inventory.give', item: 'apfel', count: 5 }]);
    w.run(1, [{ type: 'action.eat', from: INV0 }]);
    expect(rejected(w.run(1, [{ type: 'action.eat', from: INV0 }]))).toEqual(['busy']);
    expect(w.run(1, [{ type: 'player.roll', dx: 1, dy: 0 }]).get('activityInterrupted')).toEqual([expect.objectContaining({ reason: 'rolle' })]);
    w.run(TICK);
    w.run(1, [{ type: 'action.eat', from: INV0 }]);
    const sprint = w.run(3, [{ type: 'player.move', dx: 1, dy: 0 }, { type: 'player.sprint', on: true }]);
    expect(sprint.get('activityInterrupted')).toEqual([expect.objectContaining({ reason: 'sprint' })]);
    w.run(1, [{ type: 'player.sprint', on: false }, { type: 'player.move', dx: 0, dy: 0 }]);
    w.run(1, [{ type: 'action.eat', from: INV0 }]);
    expect(w.run(1, [{ type: 'action.cancel' }]).get('activityInterrupted')).toEqual([expect.objectContaining({ reason: 'abgebrochen' })]);
    expect(rejected(w.run(1, [{ type: 'action.cancel' }]))).toEqual(['idle']);
    expect(w.inventory.count('apfel')).toBe(5);
    w.run(1, [{ type: 'inventory.give', item: 'stein', count: 1 }]);
    const stone = w.inventory.state.inventar.findIndex((s) => s?.item === 'stein');
    expect(rejected(w.run(1, [{ type: 'action.eat', from: { bereich: 'inventar', index: stone } }]))).toEqual(['notEdible']);
    expect(rejected(w.run(1, [{ type: 'action.eat', from: { bereich: 'inventar', index: 20 } }]))).toEqual(['slotEmpty']);
  });

  it('walking on while eating goes at half speed', () => {
    const eating = world();
    const walking = world();
    eating.run(1, [{ type: 'inventory.give', item: 'apfel', count: 1 }]);
    walking.run(1);
    eating.run(1, [{ type: 'action.eat', from: INV0 }, { type: 'player.move', dx: 1, dy: 0 }]);
    walking.run(1, [{ type: 'player.move', dx: 1, dy: 0 }]);
    const e0 = eating.pos().x;
    const w0 = walking.pos().x;
    eating.run(30);
    walking.run(30);
    expect((eating.pos().x - e0) / (walking.pos().x - w0)).toBeCloseTo(A.busyMoveFactor, 6);
  });

  it('old food gives 75 %, rotten 50 % and may poison (Lebensmittelvergiftung)', () => {
    const w = world();
    w.vit().satiety = 20;
    w.inventory.giveStack(w.sim, newStack(items.get('apfel'), 1, { frische: 40 }));
    w.run(1, [{ type: 'action.eat', from: INV0 }]);
    const old = w.run(90).get('itemEaten') as Array<{ satiety: number; freshness: string }>;
    expect(old).toEqual([expect.objectContaining({ satiety: 6, freshness: 'alt' })]);
    let poisoned = 0;
    let healthy = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const r = world(meadow(30, 30), seed);
      r.inventory.giveStack(r.sim, newStack(items.get('apfel'), 1, { frische: 10 }));
      r.run(1, [{ type: 'action.eat', from: INV0 }]);
      const [eaten] = r.run(90).get('itemEaten') as Array<{ satiety: number; freshness: string; poisoned: boolean }>;
      expect(eaten).toMatchObject({ satiety: 4, freshness: 'faulig' });
      expect(r.life.conditions.has('lebensmittelvergiftung')).toBe(eaten?.poisoned === true);
      if (eaten?.poisoned === true) poisoned++;
      else healthy++;
    }
    expect(poisoned).toBeGreaterThan(0);
    expect(healthy).toBeGreaterThan(0);
  });

  it('key Q (action belt) becomes action.useBelt in the frame it is pressed', () => {
    expect(beltCommand({ wasPressed: (a) => a === 'belt' })).toEqual({ type: 'action.useBelt' });
    expect(beltCommand({ wasPressed: () => false })).toBeNull();
  });

  it('key Q eats from the first filled belt slot', () => {
    const w = world();
    w.run(1, [{ type: 'inventory.give', item: 'birne', count: 2 }]);
    w.run(1, [{ type: 'inventory.move', from: INV0, to: { bereich: 'guertel', index: 1 } }]);
    expect(rejected(w.run(1, [{ type: 'action.useBelt', index: 0 }]))).toEqual(['slotEmpty']);
    const start = w.run(1, [{ type: 'action.useBelt' }]);
    expect(start.get('activityStarted')).toEqual([expect.objectContaining({ item: 'birne' })]);
    w.run(90);
    expect(w.inventory.state.guertel[1]?.count).toBe(1);
  });
});

describe('Trinken', () => {
  it('a sip from a river quenches 20 thirst in 2 s; the sea is salty, ice frozen, dry ground no water, far water out of reach', () => {
    const w = world();
    water(w, 11, 10, WATER_DEPTH_SHALLOW | WATER_RIVER);
    water(w, 9, 10, WATER_DEPTH_DEEP | WATER_SEA);
    water(w, 10, 11, WATER_DEPTH_SHALLOW | WATER_LAKE | WATER_FROZEN);
    water(w, 20, 10, WATER_DEPTH_SHALLOW | WATER_RIVER);
    w.vit().thirst = 40;
    const t = (x: number, y: number): { tx: number; ty: number } => w.tile(x, y);
    expect(rejected(w.run(1, [{ type: 'action.drink', ...t(9, 10) }]))).toEqual(['saltWater']);
    expect(rejected(w.run(1, [{ type: 'action.drink', ...t(10, 11) }]))).toEqual(['frozen']);
    expect(rejected(w.run(1, [{ type: 'action.drink', ...t(10, 9) }]))).toEqual(['noWater']);
    expect(rejected(w.run(1, [{ type: 'action.drink', ...t(20, 10) }]))).toEqual(['outOfReach']);
    w.run(1, [{ type: 'action.drink', ...t(11, 10) }]);
    const t0 = w.vit().thirst;
    const ev = w.run(2 * TICK);
    expect(ev.get('waterDrunk')).toEqual([expect.objectContaining({ source: 'fluss', thirst: 20 })]);
    expect(w.vit().thirst - t0).toBeCloseTo(20, 0);
  });

  it('a swimmer may drink the lake it swims in – deep water refuses and interrupts eating only', () => {
    const lake = meadow(30, 30).map((row, y) => (y >= 8 && y <= 12 ? `${row.slice(0, 8)}wwwww${row.slice(13)}` : row));
    const w = world(lake);
    w.inventory.give(w.sim, 'apfel', 2);
    const c = w.centre(10, 10);
    w.run(1, [{ type: 'player.teleport', x: c.x, y: c.y, layer: 0 }]);
    w.run(2);
    expect(w.body().swimming).toBe(true);
    w.vit().thirst = 40;
    expect(rejected(w.run(1, [{ type: 'action.eat', from: INV0 }]))).toEqual(['busy']);
    w.run(1, [{ type: 'action.drink', ...w.tile(11, 10) }]);
    const t0 = w.vit().thirst;
    const ev = w.run(2 * TICK);
    expect(ev.get('activityInterrupted')).toBeUndefined();
    expect(ev.get('waterDrunk')).toEqual([expect.objectContaining({ source: 'see', thirst: 20 })]);
    expect(w.vit().thirst - t0).toBeCloseTo(20, 0);
  });

  it('unfiltered water brings fever about one sip in ten, in the Nebelmoor one in two; springs never', () => {
    const count = (bits: number, biome: string): number => {
      let fevers = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const w = world(meadow(30, 30), seed);
        water(w, 11, 10, bits, biome);
        w.run(1, [{ type: 'action.drink', ...w.tile(11, 10) }]);
        const [sip] = w.run(2 * TICK).get('waterDrunk') as Array<{ fever: boolean }>;
        expect(w.life.conditions.has('fieber')).toBe(sip?.fever === true);
        if (sip?.fever === true) fevers++;
      }
      return fevers;
    };
    const river = count(WATER_DEPTH_SHALLOW | WATER_RIVER, 'gruenhain');
    const moor = count(WATER_DEPTH_SHALLOW | WATER_LAKE, 'nebelmoor');
    const spring = count(WATER_DEPTH_SHALLOW | WATER_SPRING, 'nebelmoor');
    expect(river).toBeGreaterThan(0);
    expect(river).toBeLessThan(12);
    expect(moor).toBeGreaterThan(river);
    expect(moor).toBeGreaterThan(10);
    expect(spring).toBe(0);
  });
});

describe('Sitzen', () => {
  it('sitting on a seat within reach; at a fire it counts as resting (health regeneration ×2); a movement key gets up', () => {
    const w = world();
    const standing = world();
    w.seat(11, 10);
    expect(rejected(w.run(1, [{ type: 'action.sit', ...w.tile(15, 15) }]))).toEqual(['noSeat']);
    w.seat(20, 20);
    expect(rejected(w.run(1, [{ type: 'action.sit', ...w.tile(20, 20) }]))).toEqual(['outOfReach']);
    w.fire(12, 10);
    standing.fire(12, 10);
    expect(w.run(1, [{ type: 'action.sit', ...w.tile(11, 10) }]).get('activityStarted')).toEqual([expect.objectContaining({ action: 'sitzen' })]);
    for (const x of [w, standing]) {
      x.vit().health = 50;
      x.vit().damageFreeTicks = 10 * TICK;
    }
    w.run(TICK);
    standing.run(TICK);
    const regen = BALANCE.survival.health.regenPerSecond;
    expect(standing.vit().health - 50).toBeCloseTo(regen * 1.5, 6);
    expect(w.vit().health - 50).toBeCloseTo(regen * 2 * 1.5, 6);
    const x0 = w.pos().x;
    const up = w.run(1, [{ type: 'player.move', dx: 1, dy: 0 }]);
    expect(up.get('activityFinished')).toEqual([expect.objectContaining({ action: 'sitzen' })]);
    expect(w.pos().x).toBe(x0);
    expect(rejected(w.run(1, [{ type: 'action.stand' }]))).toEqual(['idle']);
  });
});

describe('Werfen', () => {
  it('a thrown stone flies to the aimed point and lands there as a dropped item; one fewer in the bags', () => {
    const w = world();
    w.run(1, [{ type: 'inventory.give', item: 'stein', count: 3 }]);
    const p = w.pos();
    const ev = w.run(1, [{ type: 'action.throw', from: INV0, x: p.x + 5 * T, y: p.y }]);
    const [thrown] = ev.get('itemThrown') as Array<{ entity: number; toX: number; toY: number; ticks: number }>;
    expect(thrown).toMatchObject({ toX: p.x + 5 * T, toY: p.y, ticks: 30 });
    expect(w.inventory.count('stein')).toBe(2);
    expect(w.sim.ecs.alive(thrown?.entity ?? -1)).toBe(true);
    const flight = w.run(30);
    expect(flight.get('thrownItemLanded')).toEqual([expect.objectContaining({ item: 'stein', sunk: false })]);
    expect(w.landings).toEqual([{ stack: { item: 'stein', count: 1 }, layer: 0, x: p.x + 5 * T, y: p.y }]);
    expect(w.sim.ecs.alive(thrown?.entity ?? -1)).toBe(false);
  });

  it('at most 8 tiles; a rock stops the throw; deep water swallows it; equipment cannot be thrown', () => {
    const rows = meadow(30, 30);
    rows[10] = `${'.'.repeat(14)}#${'.'.repeat(15)}`;
    rows[12] = `${'.'.repeat(12)}www${'.'.repeat(15)}`;
    const w = world(rows);
    w.run(1, [{ type: 'inventory.give', item: 'stein', count: 5 }]);
    const p = w.pos();
    const far = w.run(1, [{ type: 'action.throw', from: INV0, x: p.x, y: p.y - 20 * T }]);
    expect((far.get('itemThrown') as Array<{ toY: number }>)[0]?.toY).toBeCloseTo(p.y - 8 * T, 6);
    const rock = w.run(1, [{ type: 'action.throw', from: INV0, x: p.x + 7 * T, y: p.y }]);
    const toX = (rock.get('itemThrown') as Array<{ toX: number }>)[0]?.toX ?? 0;
    expect(toX).toBeLessThan((OFFSET + 14) * T);
    const splash = w.run(1, [{ type: 'action.throw', from: INV0, x: p.x + 3 * T, y: p.y + 2 * T }]);
    expect(splash.get('itemThrown')).toBeDefined();
    const landed = w.run(TICK).get('thrownItemLanded') as Array<{ sunk: boolean }>;
    expect(landed.map((l) => l.sunk).sort()).toEqual([false, false, true]);
    expect(w.landings.length).toBe(2);
    expect(rejected(w.run(1, [{ type: 'action.throw', from: { bereich: 'ausruestung', index: 0 }, x: p.x, y: p.y }]))).toEqual(['notThrowable']);
    expect(rejected(w.run(1, [{ type: 'inventory.give', item: 'kein_ding', count: 1 }]))).toEqual(['unknownItem']);
  });
});
