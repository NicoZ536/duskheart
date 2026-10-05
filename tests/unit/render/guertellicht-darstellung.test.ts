/**
 * M6-Gate (kreatur-betaeubt-nacht.png: "Das Punktlicht am Gürtel sitzt direkt im Sprite … als halte die Figur eine Fackel
 * senkrecht"; MASTERPROMPT §12.2 „Mit Schild oder Zweihandwaffe hängt sie am Gürtel (−40 % Radius)“, ADR-0154, ADR-0172;
 * src/render/game/lights.ts `BELT_LIGHT`, `carriedLightAt`): a light hanging on the belt shines from the hip on the off
 * hand's side – beside the body facing the viewer or away, behind it in profile (the off hand is the far one) – at the belt's
 * height, not from the hand's place at the chest the simulation gives the carried light (3 px ahead, 14 px up): there it lit
 * the bowstring as a glowing line and burnt out the hair. A light in the hand keeps the simulation's place and flame height.
 */
import { describe, expect, it } from 'vitest';
import { parseGameCommand } from '../../../src/game/commands';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { BAG_AREAS, equipmentRef, type SlotRef } from '../../../src/game/items/slots';
import { handLightOffset } from '../../../src/game/light/formulas';
import { CARRIED_LIGHT_ID, type LightSystem } from '../../../src/game/light/system';
import type { Facing } from '../../../src/game/player/state';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import { BELT_LIGHT, beltLightOffset, createLightFrame, LightBridge } from '../../../src/render/game/lights';
import { RenderScene } from '../../../src/render/scene';

/** A generated world: more than the default limit on a loaded machine. */
const TIMEOUT_MS = 120_000;

function run(sim: Simulation, commands: readonly unknown[] = [], ticks = 1): void {
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
    sim.events.drain(() => undefined);
  }
}

function slotOf(sim: Simulation, item: string): SlotRef {
  const state = (sim.system('inventory') as unknown as InventorySystem).state;
  for (const area of BAG_AREAS) {
    const index = state[area].findIndex((s) => s !== null && s.item === item);
    if (index >= 0) return { bereich: area, index };
  }
  throw new Error(`no ${item} in the bags`);
}

describe('Licht am Gürtel in der Darstellung (M6-Gate)', () => {
  it('an der Hüfte der Nebenhand: neben dem Körper von vorn und hinten, hinter ihm im Profil – nie vor Brust und Gesicht', () => {
    const o = { dx: 0, dy: 0 };
    const expected: Readonly<Record<Facing, readonly [number, number]>> = {
      // Facing the viewer the off hand hangs on the right of the picture, facing away on the left.
      down: [BELT_LIGHT.sidePx, 0],
      up: [-BELT_LIGHT.sidePx, 0],
      // In profile the far hip: north of the feet (behind the body) and towards the back.
      right: [-BELT_LIGHT.backPx, -BELT_LIGHT.depthPx],
      left: [BELT_LIGHT.backPx, -BELT_LIGHT.depthPx],
    };
    for (const facing of ['down', 'up', 'right', 'left'] as const) {
      const hand = handLightOffset(facing, { dx: 0, dy: 0 });
      beltLightOffset(handLightOffset(facing, o));
      expect([o.dx, o.dy], facing).toEqual(expected[facing]);
      // Never ahead along the facing, where the hand holds the light.
      expect(o.dx * hand.dx + o.dy * hand.dy, facing).toBeLessThanOrEqual(0);
    }
    // At the belt of the 24-px figure, below the chest and the face (a torch in the hand burns at 14 px).
    expect(BELT_LIGHT.heightPx).toBeGreaterThanOrEqual(6);
    expect(BELT_LIGHT.heightPx).toBeLessThanOrEqual(9);
    // Beside the body facing the viewer: past the 10-px body's half width; behind it in profile.
    expect(BELT_LIGHT.sidePx).toBeGreaterThanOrEqual(5);
    expect(BELT_LIGHT.depthPx).toBeGreaterThan(0);
  });

  it(
    'der Lichtpass zeichnet die Fackel am Gürtel (Bogen) an der Hüfte in Gürtelhöhe, in der Hand (Schleuder) wie die Simulation',
    () => {
      const sim = createSimulation({ seed: 3, worldSize: 'small', dayLengthMinutes: 24 });
      run(sim, [{ type: 'player.spawn' }], 2);
      run(sim, [{ type: 'inventory.give', item: 'fackel', count: 1 }, { type: 'inventory.give', item: 'kurzbogen', count: 1 }, { type: 'inventory.give', item: 'schleuder', count: 1 }]);
      run(sim, [{ type: 'inventory.move', from: slotOf(sim, 'fackel'), to: equipmentRef('nebenhand') }]);
      run(sim, [{ type: 'light.toggle' }]);
      const light = sim.system('light') as unknown as LightSystem;
      const bridge = new LightBridge();
      const frame = createLightFrame();
      frame.layer = 0;
      frame.hasFigure = true;
      frame.figureX = 400;
      frame.figureY = 300;
      const carried = (): { x: number; y: number; height: number; simHeight: number } => {
        const scene = new RenderScene();
        scene.beginFrame(0);
        bridge.fill(scene, null, sim, frame);
        const sources = light.sources(sim);
        const i = sources.findIndex((s) => s.id === CARRIED_LIGHT_ID);
        expect(i).toBeGreaterThanOrEqual(0);
        return { x: scene.lights.x[i] ?? NaN, y: scene.lights.y[i] ?? NaN, height: scene.lights.height[i] ?? NaN, simHeight: sources[i]?.height ?? NaN };
      };
      const hand = light.carriedOffset(sim, { dx: 0, dy: 0 });
      const belt = beltLightOffset(light.carriedOffset(sim, { dx: 0, dy: 0 }));

      run(sim, [{ type: 'player.selectHotbar', index: slotOf(sim, 'kurzbogen').index }]);
      expect(light.carried?.mode).toBe('guertel');
      const onBelt = carried();
      expect([onBelt.x, onBelt.y, onBelt.height]).toEqual([400 + belt.dx, 300 + belt.dy, BELT_LIGHT.heightPx].map((v) => Math.fround(v)));
      expect(onBelt.height).toBeLessThan(onBelt.simHeight);

      run(sim, [{ type: 'player.selectHotbar', index: slotOf(sim, 'schleuder').index }]);
      expect(light.carried?.mode).toBe('hand');
      const inHand = carried();
      expect([inHand.x, inHand.y, inHand.height]).toEqual([400 + hand.dx, 300 + hand.dy, inHand.simHeight].map((v) => Math.fround(v)));
    },
    TIMEOUT_MS,
  );
});
