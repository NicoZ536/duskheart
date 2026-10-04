/**
 * M6-79 Licht am Gürtel auch bei Bogen und Armbrust (MASTERPROMPT §12.2 „Fackel in der Nebenhand … Mit Schild oder
 * Zweihandwaffe hängt sie am Gürtel (−40 % Radius)“; ADR-0154: Zweihänder, Bogen und Armbrust lassen keine Hand für den
 * Schild – die Nebenhand des Bogens zieht die Sehne, die Armbrust liegt in beiden Händen; die Figur zeigt bei ihnen keine
 * Fackel in der Hand, ADR-0148): im echten Spiel (`createSimulation`, src/game/setup.ts verbindet
 * `LightSystem.addTwoHandedRule(combat.twoHandedRule)`) hängt die Fackel der Nebenhand bei diesen Waffen am Gürtel, ihr
 * Licht hat 60 % des Radius; Schleuder und Einhandwaffen lassen die Nebenhand frei. Vorher galt das nur für den Zweihänder.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { EventArgs } from '../../../src/engine/events';
import { parseGameCommand } from '../../../src/game/commands';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { BAG_AREAS, equipmentRef, type SlotRef } from '../../../src/game/items/slots';
import { CARRIED_LIGHT_ID, type LightSystem } from '../../../src/game/light/system';
import { createSimulation } from '../../../src/game/setup';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import { TILE_PX } from '../../../src/world/model/coords';

/** The fixture world (small, seed 3; tools/save/fixture.ts). */
const CONFIG = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;
/** A generated world: more than the default limit on a loaded machine. */
const TIMEOUT_MS = 120_000;
/** Radius of a carried torch in the hand [px] (§12.2: 6 tiles). */
const HAND_PX = BALANCE.light.torch.radiusTiles * TILE_PX;
type Ev = EventArgs<SimEventMap>;

function run(sim: Simulation, commands: readonly unknown[] = [], ticks = 1): Ev[] {
  const out: Ev[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
    sim.events.drain((...e) => out.push(e));
  }
  return out;
}

function slotOf(sim: Simulation, item: string): SlotRef {
  const state = (sim.system('inventory') as unknown as InventorySystem).state;
  for (const area of BAG_AREAS) {
    const index = state[area].findIndex((s) => s !== null && s.item === item);
    if (index >= 0) return { bereich: area, index };
  }
  throw new Error(`no ${item} in the bags`);
}

describe('Fackel in der Nebenhand mit Fernwaffen im echten Spiel (M6-79)', () => {
  it(
    'Bogen und Armbrust hängen die brennende Fackel an den Gürtel (−40 % Radius), Schleuder und Schwert lassen sie in der Hand',
    () => {
      const sim = createSimulation(CONFIG);
      run(sim, [{ type: 'player.spawn' }], 2);
      run(sim, [{ type: 'setWeather', state: 'klar' }]);
      const weapons = ['kurzbogen', 'armbrust', 'schleuder', 'feuersteinklinge', 'felsbrecher'] as const;
      run(sim, [{ type: 'inventory.give', item: 'fackel', count: 1 }, ...weapons.map((item) => ({ type: 'inventory.give', item, count: 1 }))]);
      run(sim, [{ type: 'inventory.move', from: slotOf(sim, 'fackel'), to: equipmentRef('nebenhand') }]);
      run(sim, [{ type: 'light.toggle' }]);
      const light = sim.system('light') as unknown as LightSystem;
      const radius = (): number | undefined => light.sources(sim).find((s) => s.id === CARRIED_LIGHT_ID)?.radius;
      const expected = { kurzbogen: 'guertel', armbrust: 'guertel', felsbrecher: 'guertel', schleuder: 'hand', feuersteinklinge: 'hand' } as const;
      for (const item of weapons) {
        const at = slotOf(sim, item);
        expect(at.bereich).toBe('schnellleiste');
        run(sim, [{ type: 'player.selectHotbar', index: at.index }]);
        const mode = expected[item];
        expect(light.carried, item).toMatchObject({ ref: equipmentRef('nebenhand'), mode, burn: { lit: true } });
        expect(radius(), item).toBeCloseTo(mode === 'guertel' ? HAND_PX * BALANCE.light.offhand.beltRadiusFactor : HAND_PX, 9);
      }
    },
    TIMEOUT_MS,
  );
});
