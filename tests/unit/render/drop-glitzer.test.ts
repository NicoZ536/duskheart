/**
 * M3-39 readability of pick-ups outside the light islands (MASTERPROMPT §4.6): a drop lying where the
 * gameplay light map is dark glints – a glimmer point, and in each drop's own rhythm a small star –, a drop
 * in the light or in flight does not. The glint is emissive and is no light source (the light list stays
 * the simulation's).
 */
import { describe, expect, it } from 'vitest';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import type { DropSystem } from '../../../src/game/drops/system';
import type { LightSystem } from '../../../src/game/light/system';
import { createSimulation } from '../../../src/game/setup';
import type { AtlasData, AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { DROP_GLINT, DropSprites, glintFrame, iconSprite, type DarkQuery } from '../../../src/render/game/drops';
import type { RenderScene } from '../../../src/render/scene';
import { lightStageIndex } from '../../../src/world/lightmap/stages';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const TILE = 16;

function recordingScene(): { scene: RenderScene; pushed: { sprite: string; frame: number; x: number; y: number }[] } {
  const owner = new Map<unknown, [string, number]>();
  for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f, i) => owner.set(f, [s.id, i]));
  const pushed: { sprite: string; frame: number; x: number; y: number }[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        const o = owner.get(d.frame);
        pushed.push({ sprite: o?.[0] ?? '?', frame: o?.[1] ?? -1, x: d.x, y: d.y });
        return pushed.length - 1;
      },
    },
  } as unknown as RenderScene;
  return { scene, pushed };
}

/** A simulation with an axe thrown 6 tiles east of the player, landed and lying, at `hour`:00. */
function axeOnTheGround(hour: number): { drops: DropSystem; dark: DarkQuery } {
  const sim = createSimulation({ seed: 20260923, worldSize: 'small' });
  sim.step([{ type: 'player.spawn' } as never]);
  sim.step([{ type: 'setTime', hour, minute: 0 } as never, { type: 'inventory.give', item: 'steinaxt', count: 1 } as never]);
  const pos = sim.ecs.component('position') as unknown as { get(e: number, c: 'x' | 'y'): number };
  const x = pos.get(sim.player, 'x');
  const y = pos.get(sim.player, 'y');
  sim.step([{ type: 'action.throw', from: { bereich: 'schnellleiste', index: 0 }, x: x + 6 * TILE, y } as never]);
  for (let i = 0; i < 120; i++) sim.step();
  const drops = sim.system('drops') as DropSystem;
  const light = sim.system('light') as LightSystem;
  const dark: DarkQuery = (layer, px, py) => lightStageIndex(light.stageAt(sim, layer, px, py)) <= lightStageIndex('daemmrig');
  return { drops, dark };
}

describe('M3-39: Glitzern liegender Gegenstände im Dunkeln', () => {
  it('das Glitzer-Sprite ist emissiv und hat Glimmpunkt und Sternclip', () => {
    const g = MANIFEST.sprites[DROP_GLINT.sprite];
    expect(g?.emissive).toBe(true);
    expect(g?.clips[DROP_GLINT.glimmer]).toBeDefined();
    expect(g?.clips[DROP_GLINT.flash]).toBeDefined();
  });

  it('der Stern blitzt einmal je Periode auf, sonst glimmt der Punkt; jeder Drop im eigenen Takt', () => {
    const g = MANIFEST.sprites[DROP_GLINT.sprite];
    const glimmer = g?.clips[DROP_GLINT.glimmer];
    const flash = g?.clips[DROP_GLINT.flash];
    if (glimmer === undefined || flash === undefined) throw new Error('Clips fehlen');
    const at = (phase: number): number[] => Array.from({ length: 132 }, (_, i) => glintFrame(i / 60, phase, glimmer, flash));
    const a = at(0);
    const glimmerFrame = glimmer.frames[0];
    expect(a.filter((f) => f === glimmerFrame).length).toBeGreaterThan(a.length / 2);
    expect(new Set(a).size).toBeGreaterThan(2);
    // Another phase flashes at another time.
    expect(at(0.5)).not.toEqual(a);
    expect(glintFrame(1.234, 0.3, glimmer, flash)).toBe(glintFrame(1.234, 0.3, glimmer, flash));
  });

  it('nachts im Dunkeln glitzert die Axt am Boden, am Mittag nicht; in der Luft nie', () => {
    const night = axeOnTheGround(23);
    const r = recordingScene();
    const d = new DropSprites();
    d.draw(r.scene, ATLAS, night.drops, 0, 1, NULL_ENTITY, NULL_ENTITY, night.dark);
    expect(r.pushed.map((p) => p.sprite)).toEqual([expect.stringMatching(/^drop_schatten$/), iconSprite('steinaxt'), DROP_GLINT.sprite]);
    expect(d.glinting).toBe(1);
    const icon = r.pushed[1];
    const glint = r.pushed[2];
    expect((glint?.x ?? 0) - (icon?.x ?? 0)).toBe(DROP_GLINT.offsetX);
    expect((icon?.y ?? 0) - (glint?.y ?? 0)).toBe(DROP_GLINT.offsetY);

    const noon = axeOnTheGround(12);
    const r2 = recordingScene();
    d.draw(r2.scene, ATLAS, noon.drops, 0, 1, NULL_ENTITY, NULL_ENTITY, noon.dark);
    expect(r2.pushed.map((p) => p.sprite)).toEqual(['drop_schatten', iconSprite('steinaxt')]);
    expect(d.glinting).toBe(0);

    // Without a darkness query (views without a light system) nothing glints.
    const r3 = recordingScene();
    d.draw(r3.scene, ATLAS, night.drops, 0, 1, NULL_ENTITY, NULL_ENTITY, null);
    expect(r3.pushed.some((p) => p.sprite === DROP_GLINT.sprite)).toBe(false);
  });
});
