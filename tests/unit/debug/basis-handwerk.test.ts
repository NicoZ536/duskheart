/**
 * Die Bilder, die handwerken, öffnen die Perkwahl nicht selbst (M7-104; src/debug/basisScenarios.ts, Phase `aufstellen`):
 * `kueche-innen` (Wasser abkochen am Kessel), `kueche-hof` (Fisch am Lagerfeuer) und `stationen-nacht` (Garn am Spinnrad)
 * machten ihr Rezept mit `debug.unlock` sichtbar – das schaltete jede Fertigkeit frei und öffnete die Perkwahl über dem Bild.
 * Jetzt finden sie es wie ein Spieler: die Station wird einen Tick getragen, bevor sie steht (Handwerk kennt eine Station, die
 * man besaß), die Zutat liegt in den Taschen. Ohne die getragene Station bliebe das Rezept verborgen.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGameCommand } from '../../../src/game/commands';
import type { CraftingSystem } from '../../../src/game/crafting/system';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { BAG_AREAS, type SlotRef } from '../../../src/game/items/slots';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';

/** The pictures' crafting (`Bild.handwerk`) and the station item its recipe needs. */
const BILDER = [
  { bild: 'stationen-nacht', rezept: 'rezept_garn', zutat: 'fasern', anzahl: 8, station: 'spinnrad' },
  { bild: 'kueche-innen', rezept: 'rezept_wasser_abgekocht_kessel', zutat: 'holzeimer_wasser', anzahl: 2, station: 'kessel' },
  { bild: 'kueche-hof', rezept: 'rezept_gebratener_fisch', zutat: 'forelle', anzahl: 2, station: 'lagerfeuer' },
] as const;

function run(sim: Simulation, commands: readonly unknown[], seen: string[]): void {
  sim.step(commands.map((c) => parseGameCommand(c)));
  sim.events.drain((...e) => {
    seen.push(e[0]);
  });
}

function slotOf(sim: Simulation, item: string): SlotRef {
  const state = (sim.system('inventory') as unknown as InventorySystem).state;
  for (const area of BAG_AREAS) {
    const index = state[area].findIndex((s) => s !== null && s.item === item);
    if (index >= 0) return { bereich: area, index };
  }
  throw new Error(`kein ${item} im Gepäck`);
}

describe('Bilder mit Handwerk ohne debug.unlock (M7-104)', () => {
  it('die Szenarien schalten nichts frei: kein debug.unlock in den Basis- und Küchenbildern', () => {
    for (const file of ['basisScenarios.ts', 'kuecheScenarios.ts']) {
      const src = readFileSync(new URL(`../../../src/debug/${file}`, import.meta.url), 'utf8');
      expect(src, file).not.toMatch(/type:\s*'debug\.unlock'/);
    }
  });

  for (const b of BILDER) {
    it(`${b.bild}: ${b.rezept} wird sichtbar, sobald ${b.station} einen Tick getragen war – ohne Perkwahl`, () => {
      const sim = createSimulation({ seed: 20261004, worldSize: 'small' });
      const seen: string[] = [];
      run(sim, [{ type: 'player.spawn' }], seen);
      const crafting = sim.system('crafting') as unknown as CraftingSystem;
      // The ingredient alone: the station is unknown, the recipe stays hidden.
      run(sim, [{ type: 'inventory.give', item: b.zutat, count: b.anzahl }], seen);
      expect(crafting.isVisible(b.rezept)).toBe(false);
      // The station carried for a tick (then set down elsewhere – here dropped): known for good.
      run(sim, [{ type: 'inventory.give', item: b.station, count: 1 }], seen);
      run(sim, [{ type: 'inventory.discard', from: slotOf(sim, b.station) }], seen);
      expect(crafting.isVisible(b.rezept)).toBe(true);
      expect(seen).not.toContain('perkChoiceOpened');
      expect(seen).not.toContain('commandRejected');
    });
  }
});
