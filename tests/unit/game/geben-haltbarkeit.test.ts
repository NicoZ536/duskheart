/**
 * M5-38: `inventory.give {…, haltbarkeit?}` gives worn pieces for tests and scenarios (M4-Gate, fix report of the station
 * screen): only items with durability, 0 (broken) … the full durability of the asked quality; every piece of the count
 * worn alike (pieces with durability never stack). An item without durability or a durability beyond the full one is
 * refused with its reason (a text in DE and EN), and nothing arrives. The schema takes whole uses from 0 only.
 */
import { describe, expect, it } from 'vitest';
import type { EventArgs } from '../../../src/engine/events';
import { parseGameCommand } from '../../../src/game/commands';
import { PlayerBags } from '../../../src/game/inventory/bags';
import { giveDurabilityProblem } from '../../../src/game/inventory/commands';
import { INVENTORY_GIVE_REJECT_REASONS } from '../../../src/game/inventory/events';
import { InventorySystem } from '../../../src/game/inventory/system';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { maxDurability, QUALITY_MAX } from '../../../src/game/items/formulas';
import type { ItemStack } from '../../../src/game/items/stack';
import { Simulation, type SimEventMap } from '../../../src/game/sim';
import de from '../../../src/i18n/de.json';
import en from '../../../src/i18n/en.json';

const CATALOG = contentItemCatalog();
/** The stone axe: 60 uses new at one star. */
const AXE = 'steinaxt';
const AXE_FULL = maxDurability(CATALOG.get(AXE).haltbarkeit as number, 1);

function setup(): { sim: Simulation; inventory: InventorySystem } {
  const sim = new Simulation({ seed: 3 });
  const inventory = sim.addSystem(new InventorySystem(new PlayerBags(CATALOG)));
  return { sim, inventory };
}

/** Sends `raw` through the command schema, steps one tick and returns the events. */
function give(sim: Simulation, raw: Record<string, unknown>): Array<EventArgs<SimEventMap>> {
  sim.step([parseGameCommand({ type: 'inventory.give', ...raw })]);
  const out: Array<EventArgs<SimEventMap>> = [];
  sim.events.drain((type, payload) => out.push([type, payload] as EventArgs<SimEventMap>));
  return out;
}

function refused(events: Array<EventArgs<SimEventMap>>): string[] {
  return events.filter((e) => e[0] === 'commandRejected').map((e) => (e[1] as SimEventMap['commandRejected']).reason);
}

/** Every carried stack of `item`. */
function stacks(inventory: InventorySystem, item: string): ItemStack[] {
  const s = inventory.state;
  return [...s.schnellleiste, ...s.inventar, ...s.rucksackfach].filter((x): x is ItemStack => x !== null && x.item === item);
}

describe('inventory.give mit Haltbarkeit (M5-38)', () => {
  it('gibt abgenutzte Stücke: jedes der Anzahl mit derselben Haltbarkeit, einzeln (sie stapeln nie)', () => {
    const { sim, inventory } = setup();
    expect(refused(give(sim, { item: AXE, count: 2, haltbarkeit: 12 }))).toEqual([]);
    expect(stacks(inventory, AXE)).toEqual([
      { item: AXE, count: 1, haltbarkeit: 12 },
      { item: AXE, count: 1, haltbarkeit: 12 },
    ]);
    // Without it a new piece has its full durability, as before.
    give(sim, { item: AXE, count: 1 });
    expect(stacks(inventory, AXE).map((s) => s.haltbarkeit)).toEqual([12, 12, AXE_FULL]);
  });

  it('Grenzen: 0 (kaputt) und die volle Haltbarkeit der Güte gehen, eins darüber nicht; höhere Güte hat mehr', () => {
    const { sim, inventory } = setup();
    expect(refused(give(sim, { item: AXE, count: 1, haltbarkeit: 0 }))).toEqual([]);
    expect(refused(give(sim, { item: AXE, count: 1, haltbarkeit: AXE_FULL }))).toEqual([]);
    expect(stacks(inventory, AXE).map((s) => s.haltbarkeit)).toEqual([0, AXE_FULL]);
    const before = inventory.state;
    expect(refused(give(sim, { item: AXE, count: 1, haltbarkeit: AXE_FULL + 1 }))).toEqual(['durabilityTooHigh']);
    expect(inventory.state).toBe(before);
    const best = maxDurability(CATALOG.get(AXE).haltbarkeit as number, QUALITY_MAX);
    expect(best).toBeGreaterThan(AXE_FULL);
    expect(refused(give(sim, { item: AXE, count: 1, qualitaet: QUALITY_MAX, haltbarkeit: best }))).toEqual([]);
    expect(stacks(inventory, AXE).at(-1)).toEqual({ item: AXE, count: 1, haltbarkeit: best, qualitaet: QUALITY_MAX });
    expect(refused(give(sim, { item: AXE, count: 1, qualitaet: QUALITY_MAX, haltbarkeit: best + 1 }))).toEqual(['durabilityTooHigh']);
    // The schema takes whole uses from 0 only.
    expect(() => parseGameCommand({ type: 'inventory.give', item: AXE, count: 1, haltbarkeit: -1 })).toThrow();
    expect(() => parseGameCommand({ type: 'inventory.give', item: AXE, count: 1, haltbarkeit: 1.5 })).toThrow();
  });

  it('lehnt Gegenstände ohne Haltbarkeit ab (noDurability) – es kommt nichts an; ohne haltbarkeit wie immer', () => {
    const { sim, inventory } = setup();
    const before = inventory.state;
    const ev = give(sim, { item: 'holz', count: 3, haltbarkeit: 5 });
    expect(refused(ev)).toEqual(['noDurability']);
    expect(ev.filter((e) => e[0] === 'itemsAdded')).toEqual([]);
    expect(inventory.state).toBe(before);
    expect(refused(give(sim, { item: 'holz', count: 3 }))).toEqual([]);
    expect(inventory.count('holz')).toBe(3);
    // An unknown item stays `unknownItem`, durability or not.
    expect(refused(give(sim, { item: 'gibtsnicht', count: 1, haltbarkeit: 1 }))).toEqual(['unknownItem']);
  });

  it('die Prüfung der Konsole ist dieselbe Regel', () => {
    const axe = CATALOG.get(AXE);
    expect(giveDurabilityProblem(axe, 0)).toBeNull();
    expect(giveDurabilityProblem(axe, AXE_FULL)).toBeNull();
    expect(giveDurabilityProblem(axe, AXE_FULL + 1)).toBe('durabilityTooHigh');
    expect(giveDurabilityProblem(CATALOG.get('holz'), 0)).toBe('noDurability');
  });

  it('jeder Grund der Ablehnung hat einen Text in DE und EN', () => {
    for (const reason of INVENTORY_GIVE_REJECT_REASONS) {
      const key = `ui.inventory.reject.${reason}`;
      expect((de as Record<string, string>)[key], `de:${key}`).toBeTruthy();
      expect((en as Record<string, string>)[key], `en:${key}`).toBeTruthy();
    }
  });
});
