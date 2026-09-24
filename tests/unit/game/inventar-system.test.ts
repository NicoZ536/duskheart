/**
 * M3-02 Inventar-System: Commands wirken im nächsten Tick, abgelehnte Commands melden ihren Grund,
 * jede Änderung hat ein Feedback-Ereignis (UI + Sound), Tasten 1–0 und das Mausrad werden zu Commands.
 */
import { describe, expect, it } from 'vitest';
import type { EventArgs } from '../../../src/engine/events';
import { parseGameCommand, GAME_COMMAND_TYPES } from '../../../src/game/commands';
import { EquipmentSystem } from '../../../src/game/equipment/system';
import { PlayerBags } from '../../../src/game/inventory/bags';
import { INVENTORY_CHANGES, INVENTORY_EVENT_TYPES, INVENTORY_FEEDBACK_SFX } from '../../../src/game/inventory/events';
import { hotbarCommand, type HotbarActionSource } from '../../../src/game/inventory/input';
import { InventorySystem } from '../../../src/game/inventory/system';
import { INVENTORY_COMMAND_SCHEMAS } from '../../../src/game/inventory/commands';
import { SFX_ID_PATTERN } from '../../../src/content/schema/item';
import { createSimulation } from '../../../src/game/setup';
import { SIM_EVENT_TYPES, Simulation, type SimEventMap } from '../../../src/game/sim';
import { EQUIPMENT_EVENT_TYPES } from '../../../src/game/equipment/events';
import { testCatalog } from './items-fixtures';

function setup(): { sim: Simulation; inventory: InventorySystem; equipment: EquipmentSystem } {
  const sim = new Simulation({ seed: 7 });
  const bags = new PlayerBags(testCatalog());
  const inventory = sim.addSystem(new InventorySystem(bags));
  const equipment = sim.addSystem(new EquipmentSystem(bags));
  return { sim, inventory, equipment };
}

function drain(sim: Simulation): Array<EventArgs<SimEventMap>> {
  const out: Array<EventArgs<SimEventMap>> = [];
  sim.events.drain((type, payload) => out.push([type, payload] as EventArgs<SimEventMap>));
  return out;
}

describe('Inventar-System in der Simulation', () => {
  it('ist in createSimulation registriert (Inventar vor Ausrüstung) und kennt alle Taschen-Commands', () => {
    const sim = createSimulation({ seed: 1 });
    const ids = sim.systems.map((s) => s.id);
    expect(ids.indexOf('inventory')).toBeGreaterThan(-1);
    expect(ids.indexOf('equipment')).toBe(ids.indexOf('inventory') + 1);
    for (const schema of INVENTORY_COMMAND_SCHEMAS) expect(GAME_COMMAND_TYPES).toContain(schema.shape.type.value);
    expect(sim.unhandledCommandTypes()).toEqual([]);
    for (const t of [...INVENTORY_EVENT_TYPES, ...EQUIPMENT_EVENT_TYPES]) expect(SIM_EVENT_TYPES).toContain(t);
  });

  it('give/take: Aufnehmen mit Meldung, volle Taschen mit Hinweis, Entnehmen', () => {
    const { sim, inventory } = setup();
    expect(inventory.give(sim, 'feuerstein', 3)).toEqual({ added: 3, rest: 0 });
    expect(drain(sim)).toEqual([
      ['itemsAdded', { item: 'feuerstein', count: 3, tick: 0 }],
      ['inventoryChanged', { change: 'add', tick: 0 }],
    ]);
    inventory.give(sim, 'stein', 100 * 40);
    drain(sim);
    expect(inventory.roomFor({ item: 'feuerstein', count: 200 })).toBe(97);
    expect(inventory.give(sim, 'holz', 4)).toEqual({ added: 0, rest: 4 });
    expect(drain(sim)).toEqual([['inventoryFull', { item: 'holz', count: 4, tick: 0 }]]);
    expect(inventory.take(sim, 'feuerstein', 2)?.map((s) => s.count)).toEqual([2]);
    expect(inventory.count('feuerstein')).toBe(1);
    expect(inventory.take(sim, 'feuerstein', 2)).toBeNull();
  });

  it('Commands wirken im nächsten Tick; Ablehnungen nennen Command und Grund', () => {
    const { sim, inventory } = setup();
    inventory.give(sim, 'stein', 30);
    drain(sim);
    sim.commands.push({ type: 'inventory.split', from: { bereich: 'inventar', index: 0 } });
    expect(inventory.count('stein')).toBe(30);
    expect(inventory.state.inventar[1]).toBeNull();
    sim.step();
    expect(inventory.state.inventar[1]?.count).toBe(15);
    sim.step([{ type: 'inventory.move', from: { bereich: 'inventar', index: 5 }, to: { bereich: 'inventar', index: 6 } }]);
    sim.step([{ type: 'inventory.collect', at: { bereich: 'inventar', index: 0 } }]);
    sim.step([{ type: 'inventory.sort' }, { type: 'inventory.discard', from: { bereich: 'inventar', index: 0 }, count: 10 }]);
    expect(drain(sim)).toEqual([
      ['inventoryChanged', { change: 'split', tick: 0 }],
      ['commandRejected', { type: 'inventory.move', reason: 'slotEmpty', tick: 1 }],
      ['inventoryChanged', { change: 'collect', tick: 2 }],
      ['inventoryChanged', { change: 'sort', tick: 3 }],
      ['inventoryChanged', { change: 'discard', tick: 3 }],
    ]);
    expect(inventory.count('stein')).toBe(20);
  });

  it('An- und Ablegen melden equipmentChanged je betroffenem Platz', () => {
    const { sim, inventory, equipment } = setup();
    inventory.give(sim, 'probe_helm', 1);
    inventory.give(sim, 'himbeeren', 5);
    drain(sim);
    sim.step([
      { type: 'inventory.quickMove', from: { bereich: 'inventar', index: 0 } },
      { type: 'inventory.move', from: { bereich: 'inventar', index: 1 }, to: { bereich: 'guertel', index: 1 } },
    ]);
    expect(equipment.worn('kopf')?.item).toBe('probe_helm');
    expect(equipment.belt()[1]?.count).toBe(5);
    expect(drain(sim)).toEqual([
      ['inventoryChanged', { change: 'quickMove', tick: 0 }],
      ['equipmentChanged', { at: { bereich: 'ausruestung', index: 0 }, item: 'probe_helm', tick: 0 }],
      ['inventoryChanged', { change: 'move', tick: 0 }],
      ['equipmentChanged', { at: { bereich: 'guertel', index: 1 }, item: 'himbeeren', tick: 0 }],
    ]);
    sim.step([{ type: 'inventory.quickMove', from: { bereich: 'ausruestung', index: 0 } }]);
    expect(drain(sim)).toContainEqual(['equipmentChanged', { at: { bereich: 'ausruestung', index: 0 }, item: null, tick: 1 }]);
  });

  it('Schnellleiste: Taste wählt, Mausrad blättert, gleicher Platz ohne Ereignis, ungültig abgelehnt', () => {
    const { sim, inventory } = setup();
    sim.step([{ type: 'player.selectHotbar', index: 4 }]);
    sim.step([{ type: 'player.selectHotbar', index: 4 }]);
    sim.step([{ type: 'player.scrollHotbar', delta: -6 }]);
    expect(inventory.state.auswahl).toBe(8);
    expect(drain(sim)).toEqual([
      ['hotbarSelected', { index: 4, tick: 0 }],
      ['hotbarSelected', { index: 8, tick: 2 }],
    ]);
    expect(() => parseGameCommand({ type: 'player.selectHotbar', index: 10 })).toThrow(TypeError);
    expect(() => parseGameCommand({ type: 'player.scrollHotbar', delta: 0 })).toThrow(TypeError);
    expect(() => parseGameCommand({ type: 'inventory.move', from: { bereich: 'tasche', index: 0 }, to: { bereich: 'inventar', index: 1 } })).toThrow(TypeError);
    expect(parseGameCommand({ type: 'inventory.move', from: { bereich: 'inventar', index: 0 }, to: { bereich: 'ausruestung', index: 7 }, count: 2 })).toMatchObject({ count: 2 });
  });

  it('Tasten 1–0 und Mausrad werden zu Commands (Taste vor Rad, mehrere Rasten addieren sich)', () => {
    const reader = (pressed: string[], next = 0, prev = 0): HotbarActionSource => ({
      wasPressed: (a) => pressed.includes(a),
      pressCount: (a) => (a === 'hotbarNext' ? next : a === 'hotbarPrev' ? prev : pressed.includes(a) ? 1 : 0),
    });
    expect(hotbarCommand(reader(['hotbar10']))).toEqual({ type: 'player.selectHotbar', index: 9 });
    expect(hotbarCommand(reader(['hotbar3', 'hotbar5'], 2))).toEqual({ type: 'player.selectHotbar', index: 2 });
    expect(hotbarCommand(reader([], 3, 1))).toEqual({ type: 'player.scrollHotbar', delta: 2 });
    expect(hotbarCommand(reader([], 0, 40))).toEqual({ type: 'player.scrollHotbar', delta: -9 });
    expect(hotbarCommand(reader([], 2, 2))).toBeNull();
    const cmd = hotbarCommand(reader([], 1));
    expect(() => parseGameCommand(cmd)).not.toThrow();
  });

  it('jede Taschen-Änderung hat einen Sound (sfx_<bereich>_<name>)', () => {
    for (const change of INVENTORY_CHANGES) {
      const key = change === 'add' ? null : change;
      if (key !== null) expect(Object.keys(INVENTORY_FEEDBACK_SFX)).toContain(key);
    }
    for (const id of Object.values(INVENTORY_FEEDBACK_SFX)) expect(id).toMatch(SFX_ID_PATTERN);
  });
});
