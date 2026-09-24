/**
 * M3-26 in the game view: a grave stands where the player died (sprite `grab`, waving cloth), on its layer
 * only; the grave the interaction offers to salvage carries the outline (§4.6), and so does a placed light
 * that is the use target (a fire to feed) – the target in reach is marked for every kind of target.
 */
import { describe, expect, it } from 'vitest';
import type { DeathSystem } from '../../../src/game/death/system';
import type { LightSystem } from '../../../src/game/light/system';
import { createSimulation } from '../../../src/game/setup';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { GRAVE_SPRITE, GraveSprites } from '../../../src/render/game/graves';
import { createLightFrame, LightBridge } from '../../../src/render/game/lights';
import type { RenderScene } from '../../../src/render/scene';

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const TILE = 16;

function recordingScene(): { scene: RenderScene; pushed: { sprite: string; x: number; y: number; outline: boolean }[] } {
  const owner = new Map<unknown, string>();
  for (const s of Object.values(MANIFEST.sprites)) for (const f of s.frames) owner.set(f, s.id);
  const pushed: { sprite: string; x: number; y: number; outline: boolean }[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        pushed.push({ sprite: owner.get(d.frame) ?? '?', x: d.x, y: d.y, outline: d.outline });
        return pushed.length - 1;
      },
    },
    light: { reset: () => ({}) },
    lights: { push: () => 0 },
  } as unknown as RenderScene;
  return { scene, pushed };
}

describe('Grab und Nutzungsziele in der Spielansicht', () => {
  it('das Grab steht am Todesort, nur auf seiner Ebene; als Ziel in Reichweite mit Umriss', () => {
    const sim = createSimulation({ seed: 20260923, worldSize: 'small' });
    sim.step([{ type: 'player.spawn' } as never]);
    sim.step([{ type: 'inventory.give', item: 'feuerstein', count: 4 } as never]);
    sim.step([{ type: 'death.kill' } as never]);
    const death = sim.system('death') as DeathSystem;
    const grave = death.state.graves[0];
    if (grave === undefined) throw new Error('kein Grab');
    const graves = new GraveSprites();
    const r = recordingScene();
    graves.draw(r.scene, ATLAS, death, 0, 1, -1, -1);
    expect(r.pushed).toEqual([{ sprite: GRAVE_SPRITE, x: Math.round(grave.x), y: Math.round(grave.y), outline: false }]);
    const lit = recordingScene();
    graves.draw(lit.scene, ATLAS, death, 0, 1, Math.floor(grave.x / TILE), Math.floor(grave.y / TILE));
    expect(lit.pushed[0]?.outline).toBe(true);
    const below = recordingScene();
    graves.draw(below.scene, ATLAS, death, -1, 1, -1, -1);
    expect(below.pushed).toEqual([]);
  });

  it('ein aufgestelltes Lagerfeuer als Nutzungsziel trägt den Umriss', () => {
    const sim = createSimulation({ seed: 20260923, worldSize: 'small' });
    sim.step([{ type: 'player.spawn' } as never]);
    const pos = sim.ecs.component('position') as unknown as { get(e: number, c: 'x' | 'y'): number };
    const tx = Math.floor(pos.get(sim.player, 'x') / TILE);
    const ty = Math.floor(pos.get(sim.player, 'y') / TILE);
    sim.step([{ type: 'inventory.give', item: 'lagerfeuer', count: 1 } as never]);
    const fireSpots = [[1, 1], [1, 0], [-1, 1], [0, 1], [-1, 0]] as const;
    for (const [dx, dy] of fireSpots) sim.step([{ type: 'light.place', from: { bereich: 'inventar', index: 0 }, tx: tx + dx, ty: ty + dy } as never]);
    const light = sim.system('light') as LightSystem;
    const fire = light.state.placed[0];
    if (fire === undefined) throw new Error('kein Lagerfeuer');
    const bridge = new LightBridge();
    const frame = Object.assign(createLightFrame(), { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 });
    const plain = recordingScene();
    bridge.fill(plain.scene, ATLAS, sim, frame);
    expect(plain.pushed).toHaveLength(1);
    expect(plain.pushed[0]?.outline).toBe(false);
    const focused = recordingScene();
    bridge.fill(focused.scene, ATLAS, sim, Object.assign(frame, { focusTx: fire.tx, focusTy: fire.ty }));
    expect(focused.pushed[0]?.outline).toBe(true);
  });
});
