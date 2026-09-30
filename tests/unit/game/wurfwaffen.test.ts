/**
 * M6-08 Wurfwaffen-Mechanik (docs/SPIEL.md §10 "Wurfwaffen: Wurfbogen, Flächenwirkung mit Radius, Zustände; Brandflasche
 * entzündet (FireSystem), Wurfmesser"; MASTERPROMPT §19.2): all five effect types per test fixture – the throwing knife
 * hits one body and lands as its item, the blast pot, the fire flask, the frost bomb and the blinding bomb fly their arc
 * to the aimed point and burst over their radius (no block), with their conditions; the fire flask sets the tiles in its
 * radius alight.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { THROW_EFFECTS } from '../../../src/content/balance/combat';
import { secondsToTicks, throwArcHeight, throwPeakPx } from '../../../src/game/combat/formulas';
import { TILE_PX } from '../../../src/world/model/coords';
import { eventsOf, kampfCatalog, kampfWelt, meadow, type KampfWelt } from './kampf-testwelt';

const R = BALANCE.combat.ranged;
const WINDUP = secondsToTicks(R.throwDrawSeconds);
const catalog = kampfCatalog();

/** Winds up fully and throws what is in the hand; runs until it landed; returns all events. */
function throwIt(k: KampfWelt, windup = WINDUP): Map<string, unknown[]> {
  const all = new Map<string, unknown[]>();
  const merge = (m: Map<string, unknown[]>) => m.forEach((v, key) => all.set(key, [...(all.get(key) ?? []), ...v]));
  merge(k.run(windup, [{ type: 'combat.attack', on: true }]));
  merge(k.run(1, [{ type: 'combat.attack', on: false }]));
  for (let i = 0; i < 300 && k.combat.projectiles.size > 0; i++) merge(k.run(1));
  return all;
}

describe('Wurfbogen', () => {
  it('ein Wurfkörper steigt in der Parabel und landet am Zielpunkt (höchstens Reichweite × Spannung)', () => {
    const k = kampfWelt();
    k.hold('probe_sprengtopf', 3);
    k.aimBy(80, 0);
    const start = k.pos();
    k.run(WINDUP, [{ type: 'combat.attack', on: true }]);
    const c = k.combat.projectiles.columns;
    let peak = 0;
    let ev = k.run(1, [{ type: 'combat.attack', on: false }]);
    for (let i = 0; i < 120 && k.combat.projectiles.size > 0; i++) {
      peak = Math.max(peak, c.z[0] as number);
      ev = k.run(1);
    }
    expect(peak).toBeCloseTo(throwPeakPx(80), 0);
    const burst = eventsOf<{ x: number; y: number; wirkung: string; target: number }>(ev, 'projectileHit')[0];
    expect(burst).toMatchObject({ wirkung: 'explosion', target: -1 });
    expect(burst?.x).toBeCloseTo(start.x + 80, 0);
    expect(throwArcHeight(0.5, 10)).toBe(10);
    expect(k.inventory.selected()?.count).toBe(2);
  });

  it('kurz geworfen fliegt er nur einen Teil der Reichweite', () => {
    const k = kampfWelt();
    k.hold('probe_sprengtopf');
    k.aimBy(120, 0);
    const start = k.pos();
    const ev = throwIt(k, 1);
    const burst = eventsOf<{ x: number }>(ev, 'projectileHit')[0];
    const range = (catalog.get('probe_sprengtopf').waffe?.reichweite ?? 0) * R.minTension;
    expect(burst?.x).toBeCloseTo(start.x + Math.max(BALANCE.combat.throw.minRangePx, range), 0);
  });

  it('im Bogen fliegt er über Körper hinweg; eine Wand hält ihn auf', () => {
    const k = kampfWelt();
    k.hold('probe_sprengtopf');
    k.aimBy(100, 0);
    const between = k.dummy(40, 0);
    throwIt(k);
    expect(between.hits).toEqual([]);
    const rows = meadow(40, 20).map((row, y) => (y === 10 ? `${row.slice(0, 13)}#${row.slice(14)}` : row));
    const walled = kampfWelt(rows, { x: 10, y: 10 });
    walled.hold('probe_sprengtopf');
    walled.aimBy(100, 0);
    const ev = throwIt(walled);
    const burst = eventsOf<{ x: number }>(ev, 'projectileHit')[0];
    expect(burst?.x).toBeLessThan(walled.pos().x + 4 * TILE_PX);
  });
});

describe('die fünf Wirkungstypen', () => {
  it('Wurfmesser (einzel): trifft einen Körper mit Stich und liegt danach als Item da', () => {
    const k = kampfWelt();
    k.hold('probe_wurfmesser', 2);
    k.aimBy(100, 0);
    const d = k.dummy(50, 0);
    const other = k.dummy(56, 8);
    const ev = throwIt(k);
    expect(d.hits).toHaveLength(1);
    expect(d.hits[0]?.type).toBe('stich');
    expect(other.hits).toEqual([]);
    expect(eventsOf(ev, 'projectileStuck')).toEqual([expect.objectContaining({ wo: 'ziel', drop: true, item: 'probe_wurfmesser' })]);
    expect(k.landed).toEqual([expect.objectContaining({ stack: { item: 'probe_wurfmesser', count: 1 } })]);
    expect(k.inventory.selected()?.count).toBe(1);
  });

  it('Sprengtopf (explosion): alle im Radius getroffen, ohne Block, mit hoher Wucht; außerhalb nichts', () => {
    const k = kampfWelt();
    k.hold('probe_sprengtopf');
    k.aimBy(80, 0);
    const radius = catalog.get('probe_sprengtopf').waffe?.wurf?.radius ?? 0;
    const inside = [k.dummy(80, 0), k.dummy(80 + radius - 2, 0, { blockSinceTick: 0, blockPower: 1, facing: Math.PI }), k.dummy(80, -radius + 2)];
    const outside = k.dummy(80, radius + 12);
    const ev = throwIt(k);
    for (const d of inside) expect(d.hits).toEqual([expect.objectContaining({ blocked: false, parried: false, hitstopTicks: 6 })]);
    expect(outside.hits).toEqual([]);
    expect(eventsOf(ev, 'projectileHit')).toEqual([expect.objectContaining({ wirkung: 'explosion', radius })]);
  });

  it('Brandflasche (brand): Feuerschaden, „Brennen“ und entzündet die Kacheln im Radius (FireSystem)', () => {
    const k = kampfWelt();
    k.hold('probe_brandflasche');
    k.aimBy(80, 0);
    const d = k.dummy(80, 0);
    throwIt(k);
    expect(d.hits[0]).toMatchObject({ type: 'feuer', condition: 'brennen', conditionSeconds: 6 });
    const radius = catalog.get('probe_brandflasche').waffe?.wurf?.radius ?? 0;
    expect(k.ignited.length).toBeGreaterThan(0);
    const cx = d.x;
    const cy = d.y;
    for (const t of k.ignited) {
      expect(t.cause).toBe('brandflasche');
      expect(Math.hypot((t.tx + 0.5) * TILE_PX - cx, (t.ty + 0.5) * TILE_PX - cy)).toBeLessThanOrEqual(radius + 1);
    }
  });

  it('Frostbombe (frost): Frostschaden und „Verlangsamt“', () => {
    const k = kampfWelt();
    k.hold('probe_frostbombe');
    k.aimBy(80, 0);
    const d = k.dummy(80, 0);
    throwIt(k);
    expect(d.hits[0]).toMatchObject({ type: 'frost', condition: 'verlangsamt', conditionSeconds: 8 });
    expect(k.ignited).toEqual([]);
  });

  it('Blendbombe (blendung): „Geblendet“ im großen Radius', () => {
    const k = kampfWelt();
    k.hold('probe_blendbombe');
    k.aimBy(80, 0);
    const d = k.dummy(80, 28);
    const ev = throwIt(k);
    expect(d.hits[0]).toMatchObject({ type: 'licht', condition: 'geblendet' });
    expect(eventsOf(ev, 'projectileHit')).toEqual([expect.objectContaining({ wirkung: 'blendung', radius: 32 })]);
  });

  it('die Wirkungstypen der Fixtures decken alle fünf ab', () => {
    const effects = new Set(['probe_wurfmesser', 'probe_sprengtopf', 'probe_brandflasche', 'probe_frostbombe', 'probe_blendbombe'].map((id) => catalog.get(id).waffe?.wurf?.wirkung));
    expect([...effects].sort()).toEqual([...THROW_EFFECTS].sort());
  });

  it('der eigene Wurf trifft den Spieler nicht', () => {
    const k = kampfWelt();
    k.hold('probe_sprengtopf');
    k.aimBy(12, 0);
    throwIt(k);
    expect(k.vit().health).toBe(100);
  });
});
