/**
 * Save roundtrip of the participant `crafting` (M3-16): owned items, met stations, learned blueprints,
 * the chest switch and the queue – orders with their progress and their reserved ingredients (freshness
 * included) – survive save → load; a loaded world finishes the order on the same tick as an uninterrupted
 * one, and a cancel after loading refunds exactly what was reserved.
 */
import { describe, expect, it } from 'vitest';
import { RECIPES } from '../../../../src/content/recipes/index';
import { defineRecipeGroup } from '../../../../src/content/recipes/define';
import { CraftingSystem } from '../../../../src/game/crafting/system';
import { RecipeBook } from '../../../../src/game/crafting/recipes';
import { contentItemCatalog } from '../../../../src/game/items/catalog';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { lifeWorld, type LifeWorld } from '../../game/leben-testwelt';
import { meadow } from '../../game/spieler-testwelt';

const catalog = contentItemCatalog();
/** The game's recipes plus one from berries (freshness) and one from a blueprint. */
const BOOK = new RecipeBook(
  [
    ...RECIPES,
    ...defineRecipeGroup('proben', [
      { id: 'rezept_faserseil_beeren', ergebnis: { item: 'faserseil', anzahl: 1 }, zutaten: [{ item: 'himbeeren', anzahl: 2 }], station: null, dauer: 'werkzeug' },
      { id: 'rezept_verband_bauplan', ergebnis: { item: 'verband', anzahl: 1 }, zutaten: [{ item: 'laub', anzahl: 1 }], station: null, dauer: 'handgriff', bauplan: { quellen: ['haendlerin'] } },
    ]),
  ],
  catalog,
);

interface World extends LifeWorld {
  readonly crafting: CraftingSystem;
}

function world(): World {
  const w = lifeWorld(meadow(10, 8));
  const crafting = w.sim.addSystem(new CraftingSystem({ player: w.player, inventory: w.inventory, collision: w.collision, spill: () => undefined, recipes: BOOK }));
  crafting.useSkills(w.life.skills);
  w.spawn(2, 2);
  return { ...w, crafting };
}

/** Three pieces of berry rope queued, the first one done and the second halfway; a blueprint learned, a station met, chests off. */
function busy(w: World): void {
  w.inventory.give(w.sim, 'himbeeren', 6, { frische: 55 });
  w.inventory.give(w.sim, 'fasern', 4);
  w.run(1, [{ type: 'craft.useChests', on: false }]);
  w.crafting.meetStation(w.sim, 'werkbank');
  w.crafting.learnBlueprint(w.sim, 'rezept_verband_bauplan');
  w.run(180 + 90, [{ type: 'craft.start', recipe: 'rezept_faserseil_beeren', count: 3 }]);
  w.run(1, [{ type: 'craft.start', recipe: 'rezept_faserseil', count: 1 }]);
}

describe('save roundtrip: crafting', () => {
  it('restores owned items, stations, blueprints, the chest switch and the queue with its reservations', () => {
    const report = expectRoundtrip(world, busy, (w) => w.crafting.save);
    expect(report.id).toBe('crafting');
    const data = JSON.parse(report.canonical) as {
      besessen: string[];
      stationen: string[];
      bauplaene: string[];
      kisten: boolean;
      auftraege: { rezept: string; anzahl: number; fortschritt: number; dauer: number; reserviert: { item: string; count: number; frische?: number }[] }[];
    };
    expect(data.besessen).toEqual(['fasern', 'faserseil', 'himbeeren']);
    expect(data.stationen).toEqual(['werkbank']);
    expect(data.bauplaene).toEqual(['rezept_verband_bauplan']);
    expect(data.kisten).toBe(false);
    expect(data.auftraege.map((o) => [o.rezept, o.anzahl])).toEqual([
      ['rezept_faserseil_beeren', 2],
      ['rezept_faserseil', 1],
    ]);
    expect(data.auftraege[0]?.reserviert).toEqual([{ item: 'himbeeren', count: 4, frische: 55 }]);
    expect(data.auftraege[0]?.fortschritt).toBeGreaterThan(0);
  });

  it('the game simulation has the participant (nothing owned, chests on, empty queue)', () => {
    expect(createSimulation({ seed: 3 }).participant('crafting').serialize()).toEqual({ besessen: [], stationen: [], bauplaene: [], kisten: true, auftraege: [] });
  });

  it('save → load → continue finishes every piece on the same tick; a cancel refunds the same stacks', () => {
    const a = world();
    busy(a);
    const b = world();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    expect(b.crafting.isVisible('rezept_verband_bauplan')).toBe(true);
    // The berry rope: the second piece is done after 90 more ticks, the third 180 later.
    const ea = a.run(300);
    const eb = b.run(300);
    expect(eb.get('craftCompleted')).toEqual(ea.get('craftCompleted'));
    expect(ea.get('craftCompleted')).toHaveLength(2);
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    const ca = a.run(1, [{ type: 'craft.cancel', index: 0 }]);
    const cb = b.run(1, [{ type: 'craft.cancel', index: 0 }]);
    expect(cb.get('craftCancelled')).toEqual(ca.get('craftCancelled'));
    expect(b.inventory.count('fasern')).toBe(a.inventory.count('fasern'));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
  });

  it('rejects malformed snapshots, unknown recipes and reservations that do not match their order', () => {
    const w = world();
    busy(w);
    const good = w.crafting.save.serialize() as Record<string, unknown> & { auftraege: Record<string, unknown>[] };
    const order = good.auftraege[0] as Record<string, unknown>;
    const bad: unknown[] = [
      null,
      { ...good, kisten: 'ja' },
      { ...good, besessen: ['stein', 'holz'] },
      { ...good, bauplaene: ['rezept_faserseil'] },
      { ...good, auftraege: [{ ...order, rezept: 'rezept_mondstaub' }] },
      { ...good, auftraege: [{ ...order, anzahl: 3 }] },
      { ...good, auftraege: [{ ...order, fortschritt: 500 }] },
      { ...good, auftraege: [{ ...order, reserviert: [{ item: 'himbeeren', count: 4 }] }] },
      { ...good, auftraege: [{ ...order, reserviert: [{ item: 'mondstaub', count: 4 }] }] },
      { ...good, auftraege: Array.from({ length: 11 }, () => order) },
    ];
    for (const data of bad) expect(() => world().crafting.save.deserialize(data), JSON.stringify(data).slice(0, 80)).toThrow(TypeError);
  });
});
