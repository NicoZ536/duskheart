/**
 * M3-35 entity inspector (src/debug/inspector.ts): a click picks the entity whose figure box contains the
 * world point – the player at their feet or torso, a dropped item where it lies –, nothing on another layer
 * or in empty space; the description lists every component the entity is in with its fields, numbers
 * rounded, nested values as short JSON; a dead entity has none.
 */
import { describe, expect, it } from 'vitest';
import { describeEntity, formatValue, MAX_VALUE_CHARS, pickEntity, PICK_BOX } from '../../../src/debug/inspector';
import type { DropSystem } from '../../../src/game/drops/system';
import { createSimulation } from '../../../src/game/setup';

function world() {
  const sim = createSimulation({ seed: 20260923, worldSize: 'small' });
  sim.step([{ type: 'player.spawn' } as never]);
  sim.step([{ type: 'inventory.give', item: 'feuerstein', count: 2 } as never]);
  const pos = sim.ecs.component('position') as unknown as { get(e: number, c: 'x' | 'y'): number };
  const px = pos.get(sim.player, 'x');
  const py = pos.get(sim.player, 'y');
  sim.step([{ type: 'action.throw', from: { bereich: 'inventar', index: 0 }, x: px + 4 * 16, y: py } as never]);
  for (let i = 0; i < 100; i++) sim.step();
  const drops = sim.system('drops') as DropSystem;
  const drop = drops.store.entityAt(0);
  const d = drops.store.valueAt(0);
  return { sim, px, py, drop, dx: d.x, dy: d.y };
}

describe('Entitäts-Inspektor (M3-35)', () => {
  it('Klick auf Füße oder Rumpf wählt den Spieler, Klick auf den Drop den Drop, ins Leere nichts, andere Ebene nichts', () => {
    const { sim, px, py, drop, dx, dy } = world();
    expect(pickEntity(sim.ecs, px, py, 0)).toBe(sim.player);
    expect(pickEntity(sim.ecs, px + 2, py - 12, 0)).toBe(sim.player);
    expect(pickEntity(sim.ecs, px, py - PICK_BOX.up - 2, 0)).toBeNull();
    expect(pickEntity(sim.ecs, dx, dy - 4, 0)).toBe(drop);
    expect(pickEntity(sim.ecs, px + 200, py + 200, 0)).toBeNull();
    expect(pickEntity(sim.ecs, px, py, -1)).toBeNull();
  });

  it('beschreibt jede Komponente der Entität mit ihren Feldern', () => {
    const { sim, drop } = world();
    const player = describeEntity(sim.ecs, sim.player);
    expect(player?.entity).toBe(sim.player);
    const names = player?.components.map((c) => c.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(['position', 'player', 'vitals']));
    expect(names).not.toContain('drop');
    const position = player?.components.find((c) => c.name === 'position');
    expect(position?.fields.map(([k]) => k)).toEqual(['x', 'y']);
    const vitals = player?.components.find((c) => c.name === 'vitals');
    expect(vitals?.fields.find(([k]) => k === 'health')?.[1]).toBe('100');
    const d = describeEntity(sim.ecs, drop);
    expect(d?.components.map((c) => c.name)).toEqual(['drop']);
    expect(d?.components.find((c) => c.name === 'drop')?.fields.find(([k]) => k === 'stack')?.[1]).toContain('feuerstein');
    sim.ecs.destroy(drop);
    expect(describeEntity(sim.ecs, drop)).toBeNull();
  });

  it('Werte: Zahlen gerundet, Verschachteltes als kurzes JSON', () => {
    expect(formatValue(3)).toBe('3');
    expect(formatValue(36.98765)).toBe('36.99');
    expect(formatValue('down')).toBe('down');
    expect(formatValue(false)).toBe('false');
    expect(formatValue(null)).toBe('null');
    expect(formatValue({ item: 'holz', count: 2, frische: 99.456 })).toBe('{"item":"holz","count":2,"frische":99.46}');
    const long = formatValue(Array.from({ length: 40 }, (_, i) => i));
    expect(long.length).toBe(MAX_VALUE_CHARS);
    expect(long.endsWith('…')).toBe(true);
  });
});
