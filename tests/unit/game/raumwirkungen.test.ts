/**
 * M7-30: the effects of the kitchen's rooms (MASTERPROMPT §16.4 "Küche (Kessel + Vorrat + Tisch): +20 % Kochtempo, +10 %
 * Mahlzeitwirkung", "Speisesaal (Tisch + 2 Stühle): Essen senkt Furcht zusätzlich", "Lager (≥ 4 Kisten): Verderb −10 %",
 * "Eiskeller (< 4 °C): Verderb ×0,2"; docs/SPIEL.md §21): real huts of the building test world with the real rooms system and
 * the game's adapters (src/game/meals/kitchen.ts, src/game/spoilage/world.ts) – the cauldron as the kitchen's cooking place,
 * the kitchen's tempo and mark, the dining hall's comfort, the store room's and ice cellar's spoilage.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { consumeTicks } from '../../../src/game/actions/formulas';
import { CraftingSystem } from '../../../src/game/crafting/system';
import { cookingPlaceFurniture, diningHallCheck, kitchenFireCheck, kitchenProductMark, kitchenRoomTypeAt, MealsSystem } from '../../../src/game/meals/index';
import { gameSpoilageWorld, lossPerHour, SpoilageSystem } from '../../../src/game/spoilage/index';
import type { PerishableContainerSource } from '../../../src/game/spoilage/types';
import { StationSystem } from '../../../src/game/stations/system';
import { withSlot } from '../../../src/game/inventory/bags';
import { newStack, type ItemStack } from '../../../src/game/items/stack';
import { Calendar } from '../../../src/world/calendar';
import { CHUNK_SHIFT } from '../../../src/world/model/coords';
import { bauWelt, hut, type BauWelt } from './bau-testwelt';
import { OFFSET, meadow } from './spieler-testwelt';

const INV0 = { bereich: 'inventar', index: 0 } as const;
const M = BALANCE.meals;

interface Haus extends BauWelt {
  readonly crafting: CraftingSystem;
  readonly stations: StationSystem;
  readonly spoilage: SpoilageSystem;
  readonly meals: MealsSystem;
  /** Perishable slots on drawn tiles (`x,y`), spoiling like a chest standing there. */
  readonly vorrat: Map<string, (ItemStack | null)[]>;
  stack(item: string, count?: number): ItemStack;
  put(stack: ItemStack): void;
}

/** A hut around the inner tiles (8, 8)–(12, 11) with the kitchen's systems wired as in src/game/setup.ts; the player at (10, 9). */
function haus(air = 20, wall = 'wand_holz', roof = 'dach_stroh'): Haus {
  const w = bauWelt(meadow(24, 24));
  w.env.air = air;
  w.spawn(10, 9);
  hut(w, 8, 8, 12, 11, wall, 'tuer_holz', roof);
  const sim = w.sim;
  const catalog = w.inventory.bags.catalog;
  const spill = (): void => undefined;
  const crafting = sim.addSystem(new CraftingSystem({ player: w.player, inventory: w.inventory, collision: w.collision, spill }));
  const stations = sim.addSystem(new StationSystem({ player: w.player, inventory: w.inventory, collision: w.collision, crafting, spill, environment: { active: () => true } }));
  crafting.addStations((_s, layer, x, y, r, station, exact) => stations.stationAtHand(layer, x, y, r, station, exact));
  crafting.useSkills(w.life.skills);
  crafting.useWorkshops((s, layer, tx, ty, station) => w.rooms.craftTempoAt(s, layer, tx, ty, station));
  crafting.useProductMark(kitchenProductMark(catalog, kitchenRoomTypeAt(w.rooms)));
  // The fire beside the cauldron and the water of the house's rain collector are stand-ins: the kitchen is what is tested.
  crafting.useFire(kitchenFireCheck({ fireLit: () => true, hearthLit: () => false }));
  crafting.addWaterSource({ near: () => true, draw: () => undefined });
  w.rooms.addFurniture(cookingPlaceFurniture(stations));
  const world = gameSpoilageWorld(w.rooms);
  const spoilage = sim.addSystem(
    new SpoilageSystem(sim, {
      catalog,
      seasons: new Calendar(sim.clock),
      world: { active: () => true, roomAt: world.roomAt, chunkAt: (_s, layer, tx, ty) => w.chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT), biomeName: world.biomeName },
    }),
  );
  const vorrat = new Map<string, (ItemStack | null)[]>();
  const source: PerishableContainerSource = {
    id: 'kiste',
    forEachPerishable(_s, chunk, visit) {
      if (chunk !== null) return;
      for (const [k, slots] of vorrat) {
        const [x, y] = k.split(',').map(Number) as [number, number];
        for (let i = 0; i < slots.length; i++) {
          const st = slots[i] ?? null;
          if (st !== null) visit({ container: 'kiste', key: `vorrat:${k}:${i}`, layer: 0, tx: OFFSET + x, ty: OFFSET + y, stack: st }, (next) => (slots[i] = next));
        }
      }
    },
  };
  spoilage.addSource(source);
  const meals = sim.addSystem(new MealsSystem({ components: w.components, inventory: w.inventory, player: w.player, diningHall: diningHallCheck(w.rooms) }));
  meals.useLife({ conditions: w.life.conditions, fear: w.life.fear });
  w.life.actions.addEatHook(meals.eatHook);
  return {
    ...w,
    crafting,
    stations,
    spoilage,
    meals,
    vorrat,
    stack: (item, count = 1) => newStack(catalog.get(item), count),
    put: (stack) => w.inventory.bags.replace(withSlot(w.inventory.state, INV0, stack)),
  };
}

function furnish(w: Haus, ...parts: ReadonlyArray<readonly [string, number, number]>): void {
  for (const [part, x, y] of parts) {
    const r = w.build(part, x, y);
    if (r !== null) throw new Error(`${part} at ${x},${y}: ${r}`);
  }
}

const typeOf = (w: Haus): string | null => w.roomAt(10, 9)?.type?.id ?? null;

/** Skips `n` whole game hours and steps one tick. */
function hours(w: Haus, n: number): void {
  const per = w.sim.clock.ticksPerGameHour;
  w.sim.skipTicks(n * per - (w.sim.tick % per));
  w.run(1);
}

/** Eats `stack` from inventar 0 and returns the fear the meal calmed (`fearChanged` of the comfort food). */
function calmed(w: Haus, stack: ItemStack): number {
  w.life.fear.spike(w.sim, 60, 'nahrung');
  w.put(stack);
  const def = w.inventory.bags.catalog.get(stack.item);
  const ev = w.run(consumeTicks(def.kategorie as Parameters<typeof consumeTicks>[0]) + 2, [{ type: 'action.eat', from: INV0 }]);
  const c = ((ev.get('fearChanged') ?? []) as Array<{ amount: number; reason: string }>).filter((e) => e.reason === 'wohlfuehlessen');
  return c.length === 1 ? -(c[0] as { amount: number }).amount : 0;
}

describe('Küche', () => {
  it('Kessel (Kochstelle), Kiste und Tisch machen die Küche; ohne Kessel ist der Raum keine Küche', () => {
    const w = haus();
    furnish(w, ['probe_moebel_kiste', 8, 8], ['probe_moebel_tisch', 11, 8]);
    expect(typeOf(w)).not.toBe('kueche');
    expect(w.stations.placeAt(w.sim, 'kessel', 0, OFFSET + 9, OFFSET + 11)).toBeTypeOf('number');
    w.run(1);
    expect(typeOf(w)).toBe('kueche');
  });

  it('am Kessel einer Küche: 20 % schneller; der Tee trägt daten.kueche und tröstet 10 % mehr', () => {
    const brew = (kitchen: boolean): { w: Haus; ticks: number } => {
      const w = haus();
      if (kitchen) furnish(w, ['probe_moebel_kiste', 8, 8], ['probe_moebel_tisch', 11, 8]);
      w.stations.placeAt(w.sim, 'kessel', 0, OFFSET + 9, OFFSET + 11);
      w.crafting.unlockAll(w.sim);
      w.run(1);
      expect(typeOf(w) === 'kueche').toBe(kitchen);
      w.put(w.stack('kamille', 2));
      const ev = w.run(1, [{ type: 'craft.start', recipe: 'rezept_kamillentee', count: 1 }]);
      const started = (ev.get('craftStarted') ?? []) as Array<{ ticks: number }>;
      const ticks = started[0]?.ticks ?? 0;
      w.run(ticks + 2);
      return { w, ticks };
    };
    const plain = brew(false);
    const kitchen = brew(true);
    expect(kitchen.ticks / plain.ticks).toBeCloseTo(1 / (1 + M.kitchen.tempo), 1);
    const tee = kitchen.w.inventory.state.inventar.find((s) => s?.item === 'kamillentee');
    expect(tee?.daten).toEqual({ kueche: true });
    expect(plain.w.inventory.state.inventar.find((s) => s?.item === 'kamillentee')?.daten).toBeUndefined();
    expect(calmed(kitchen.w, tee as ItemStack)).toBeCloseTo(12 * M.kitchen.effect, 9);
  });
});

describe('Speisesaal', () => {
  it('Tisch und zwei Stühle: Essen dort lindert die Furcht um 5 mehr', () => {
    const w = haus();
    furnish(w, ['probe_moebel_tisch', 9, 8], ['probe_moebel_stuhl', 9, 10], ['probe_moebel_stuhl', 11, 10]);
    expect(typeOf(w)).toBe('speisesaal');
    expect(calmed(w, w.stack('beerenkuchen'))).toBe(20 + M.diningHallComfort);
    const draussen = haus();
    expect(calmed(draussen, draussen.stack('beerenkuchen'))).toBe(20);
  });
});

describe('Lager und Eiskeller', () => {
  it('Lager (vier Kisten): Vorräte verderben ×0,9', () => {
    const w = haus();
    furnish(w, ['probe_moebel_kiste', 8, 8], ['probe_moebel_kiste', 9, 8], ['probe_moebel_kiste', 11, 8], ['probe_moebel_kiste', 12, 8]);
    expect(typeOf(w)).toBe('lager');
    w.vorrat.set('10,10', [w.stack('eintopf')]);
    w.vorrat.set('20,20', [w.stack('eintopf')]);
    hours(w, 10);
    expect(w.vorrat.get('10,10')?.[0]?.frische).toBe(100 - 10 * lossPerHour(2, 0.9));
    expect(w.vorrat.get('20,20')?.[0]?.frische).toBe(100 - 10 * lossPerHour(2, 1));
  });

  it('Eiskeller (unter 4 °C): ×0,2 – gemessen, wo der Vorrat steht', () => {
    const w = haus(-10, 'wand_palisade', 'dach_glas');
    furnish(w, ['probe_moebel_kiste', 8, 8], ['probe_moebel_kiste', 9, 8], ['probe_moebel_kiste', 11, 8], ['probe_moebel_kiste', 12, 8]);
    expect(typeOf(w)).toBe('eiskeller');
    w.vorrat.set('10,10', [w.stack('eintopf')]);
    hours(w, 10);
    expect(w.vorrat.get('10,10')?.[0]?.frische).toBe(100 - 10 * lossPerHour(2, 0.2));
  });
});
