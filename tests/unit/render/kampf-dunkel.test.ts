/**
 * "Gegner im Dunkeln nur als Augen" (MASTERPROMPT §12.2, §19.4, §6.2; docs/ART.md §15): the presentation reads the
 * gameplay light at every creature – below the stage "Dunkel" its body sinks towards black (fully in full darkness), so a
 * night hunter shows only its emissive eyes, which glow brighter; a creature without eyes keeps a faint silhouette; by
 * day or in the torch's light nothing is tinted.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import { equipmentRef } from '../../../src/game/items/slots';
import type { LightSystem } from '../../../src/game/light/system';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { createCreatureFrame, CreatureSprites, darknessOf } from '../../../src/render/game/creatures';
import type { RenderScene } from '../../../src/render/scene';

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const TILE = 16;
const DARK_BELOW = BALANCE.light.map.stages.darkBelow;

interface Pushed {
  sprite: string;
  x: number;
  tint: number;
  tintRgb: [number, number, number];
  glow: number;
}

function draw(sim: Simulation, ambient: number): Pushed[] {
  const owner = new Map<unknown, string>();
  for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f) => owner.set(f, s.id));
  const pushed: Pushed[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        pushed.push({ sprite: owner.get(d.frame) ?? '?', x: d.x, tint: d.tintStrength, tintRgb: [d.tintR, d.tintG, d.tintB], glow: d.emissiveBoost });
        return pushed.length - 1;
      },
    },
  } as unknown as RenderScene;
  const view = new CreatureSprites();
  view.draw(scene, ATLAS, sim, Object.assign(createCreatureFrame(), { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9, alpha: 1, time: 0, ambient }));
  return pushed;
}

/** A world at `hour` with the player, a Nachtmahr `far` tiles and a roe deer `far + 1` tiles east of it. */
function night(hour: number, far: number, torch: boolean): { sim: Simulation; x: number; y: number } {
  const sim = createSimulation({ seed: 20260930, worldSize: 'small' });
  sim.step([{ type: 'player.spawn' } as never]);
  sim.step([{ type: 'debug.god', on: true } as never, { type: 'setTime', hour, minute: 0 } as never, { type: 'setWeather', state: 'klar' } as never]);
  if (torch) {
    sim.step([{ type: 'inventory.give', item: 'fackel', count: 1 } as never]);
    sim.step([{ type: 'inventory.move', from: { bereich: 'schnellleiste', index: 0 }, to: equipmentRef('nebenhand') } as never, { type: 'light.toggle' } as never]);
  }
  const pos = sim.ecs.component('position') as unknown as { get(e: number, c: 'x' | 'y'): number };
  const x = pos.get(sim.player, 'x');
  const y = pos.get(sim.player, 'y');
  sim.step([
    { type: 'creature.spawn', creature: 'nachtmahr', count: 1, x: x + far * TILE, y, layer: 0 } as never,
    { type: 'creature.spawn', creature: 'reh', count: 1, x: x + (far + 1) * TILE, y, layer: 0 } as never,
  ]);
  sim.step([]);
  return { sim, x, y };
}

function levelAt(sim: Simulation, id: string): number {
  const creatures = sim.system('creatures') as CreatureSystem;
  const light = sim.system('light') as LightSystem;
  const at = { x: 0, y: 0 };
  for (let i = creatures.store.size - 1; i >= 0; i--) {
    const s = creatures.store.valueAt(i);
    if (s.creature !== id || !creatures.positionOf(creatures.store.entityAt(i), at)) continue;
    return light.levelAt(sim, s.layer, at.x, at.y);
  }
  throw new Error(`keine Kreatur ${id}`);
}

describe('Gegner im Dunkeln nur als Augen', () => {
  it('Dunkelheit aus dem Licht: hell keine, unter der Stufe Dunkel steigend, ganz dunkel schwarz (ohne Augen eine Silhouette)', () => {
    expect(darknessOf(1, true)).toBe(0);
    expect(darknessOf(DARK_BELOW, true)).toBe(0);
    expect(darknessOf(DARK_BELOW * 0.99, true)).toBeGreaterThan(0);
    expect(darknessOf(0, true)).toBe(1);
    expect(darknessOf(0.05, true)).toBe(1);
    expect(darknessOf(0, false)).toBeCloseTo(0.7, 12);
    let last = 0;
    for (let l = DARK_BELOW; l >= 0; l -= 0.01) {
      const d = darknessOf(l, true);
      expect(d).toBeGreaterThanOrEqual(last);
      expect(darknessOf(l, false)).toBeLessThan(d + 1e-12);
      last = d;
    }
  });

  it('in der Nacht fern vom Licht: der Nachtmahr schwarz bis auf seine glühenden Augen, das Reh eine Silhouette', () => {
    const { sim } = night(23, 12, false);
    const lNm = levelAt(sim, 'nachtmahr');
    const lReh = levelAt(sim, 'reh');
    expect(lNm).toBeLessThan(DARK_BELOW);
    const pushed = draw(sim, 0.02);
    const nm = pushed.filter((p) => p.sprite === 'kreatur_nachtmahr');
    const reh = pushed.filter((p) => p.sprite === 'kreatur_reh');
    expect(nm.length).toBeGreaterThan(0);
    expect(reh.length).toBeGreaterThan(0);
    for (const p of nm) {
      expect(p.tint).toBeCloseTo(darknessOf(lNm, true), 9);
      expect(p.tint).toBeGreaterThan(0.5);
      expect(p.tintRgb).toEqual([0, 0, 0]);
      // Its eyes glow brighter in the dark.
      expect(p.glow).toBeGreaterThan(0);
    }
    for (const p of reh) expect(p.tint).toBeCloseTo(darknessOf(lReh, false), 9);
  });

  it('am Mittag und im Schein der Fackel bleibt jeder Körper ungetönt', () => {
    const noon = night(12, 12, false);
    for (const p of draw(noon.sim, 1).filter((q) => q.sprite.startsWith('kreatur_'))) expect(p.tint).toBe(0);
    const lit = night(23, 1, true);
    expect(levelAt(lit.sim, 'nachtmahr')).toBeGreaterThanOrEqual(DARK_BELOW);
    const near = draw(lit.sim, 0.02).filter((q) => q.sprite === 'kreatur_nachtmahr');
    expect(near.length).toBeGreaterThan(0);
    for (const p of near) expect(p.tint).toBe(0);
  });
});
