/**
 * M7-51 Ressourcendichte (MASTERPROMPT §29 "Ressourcendichte", docs/SPIEL.md §25: unveränderlich in der `SimConfig`, wirkt im
 * Weltgenerator-Schritt `ressourcen`, Teil des Welt-Cache-Schlüssels): Gering legt weniger, Reich mehr Vorkommen aus als
 * Normal; die Mindestmenge je Stufe hält jede Dichte; Normal erzeugt dieselbe Welt wie ohne Angabe (Hash bitgleich); die
 * Simulation bekommt die Welt ihrer Dichte aus dem Welt-Cache, eine fremde Dichte wird abgewiesen.
 * Im Integrationsprojekt: erzeugt ganze Welten (Klein) – ein Sweep, kein Unit-Test (ADR-0192).
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../src/game/setup';
import { cachedWorld, worldFor } from '../../src/game/worldCache';
import { generateWorld, worldHash, type GeneratedWorld } from '../../src/world/gen/world';

const SEED = 4711;
/** Generation of a Klein world under parallel test load [ms]. */
const TIMEOUT_MS = 120_000;

function deposits(world: GeneratedWorld): number {
  return world.resources.deposits.length;
}

describe('Ressourcendichte im Weltgenerator', () => {
  it(
    'Gering < Normal < Reich; Mindestmengen je Stufe auf jeder Dichte; Normal = die Welt vor M7',
    () => {
      const plain = generateWorld(SEED, 'small');
      const normal = generateWorld(SEED, 'small', undefined, undefined, 'normal');
      expect(worldHash(normal)).toBe(worldHash(plain));
      expect(normal.resourceDensity).toBeUndefined();
      const gering = generateWorld(SEED, 'small', undefined, undefined, 'gering');
      const reich = generateWorld(SEED, 'small', undefined, undefined, 'reich');
      expect(gering.resourceDensity).toBe('gering');
      expect(deposits(gering)).toBeLessThan(deposits(normal));
      expect(deposits(reich)).toBeGreaterThan(deposits(normal));
      for (const w of [gering, normal, reich]) {
        expect(w.report.problems, w.resourceDensity ?? 'normal').toEqual([]);
        for (const t of w.report.resources.tallies) expect(t.after, `${t.object}@${t.tier}`).toBeGreaterThanOrEqual(t.min);
      }
      // Everything but the deposits is the same world (plan, places, roads).
      expect(gering.spawn).toEqual(normal.spawn);
      expect(gering.locations.length).toBe(normal.locations.length);
      expect(new Set([worldHash(gering), worldHash(normal), worldHash(reich)]).size).toBe(3);
    },
    TIMEOUT_MS,
  );

  it(
    'die Dichte ist Teil des Welt-Cache-Schlüssels; die Simulation bekommt die Welt ihrer Dichte',
    () => {
      const reich = worldFor(SEED, 'small', 'reich');
      expect(cachedWorld(SEED, 'small', 'reich')).toBe(reich);
      expect(cachedWorld(SEED, 'small', 'gering')).toBeUndefined();
      const sim = createSimulation({ seed: SEED, worldSize: 'small', resourceDensity: 'reich' });
      expect(sim.config.resourceDensity).toBe('reich');
      // A Normal config carries no field: its state hash stays the one before M7.
      expect(createSimulation({ seed: SEED, worldSize: 'small', resourceDensity: 'normal' }).config).not.toHaveProperty('resourceDensity');
      // The world handed in must belong to the config (another density is refused).
      const other = createSimulation({ seed: SEED, worldSize: 'small' });
      expect(() => other.world.provide(reich)).toThrow(/reich/);
      sim.world.provide(reich);
      expect(sim.world.chunks).toBeDefined();
    },
    TIMEOUT_MS,
  );
});
