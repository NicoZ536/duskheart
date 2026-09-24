/**
 * M3-37 Szenario `schwimmen` (src/debug/schwimmenScenario.ts): die Suchreihenfolge nach tiefem Wasser ist
 * fest (Ring für Ring, im Ring die nächsten Kacheln zuerst), deckt jeden Ring genau einmal ab und lässt die
 * Mitte aus – dasselbe Bild bei jedem Lauf.
 */
import { describe, expect, it } from 'vitest';
import { probeOrder, SWIM_SCENARIO } from '../../../src/debug/schwimmenScenario';
import { findScenario } from '../../../src/debug/scenarios';

describe('Szenario schwimmen', () => {
  it('ist registriert', () => {
    expect(findScenario(SWIM_SCENARIO)?.name).toBe(SWIM_SCENARIO);
  });

  it('Suchreihenfolge: Ring für Ring, jede Kachel einmal, die Mitte nie, im Ring die nächsten zuerst', () => {
    const order = probeOrder(3);
    expect(order).toHaveLength(7 * 7 - 1);
    const keys = order.map(([x, y]) => `${x},${y}`);
    expect(new Set(keys).size).toBe(order.length);
    expect(keys).not.toContain('0,0');
    const ring = (o: readonly [number, number]): number => Math.max(Math.abs(o[0]), Math.abs(o[1]));
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1] as readonly [number, number];
      const b = order[i] as readonly [number, number];
      expect(ring(b)).toBeGreaterThanOrEqual(ring(a));
      if (ring(a) === ring(b)) expect(b[0] ** 2 + b[1] ** 2).toBeGreaterThanOrEqual(a[0] ** 2 + a[1] ** 2);
    }
    // The four direct neighbours come first.
    expect(keys.slice(0, 4).sort()).toEqual(['-1,0', '0,-1', '0,1', '1,0']);
    expect(probeOrder(3)).toEqual(order);
  });
});
