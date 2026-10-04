/**
 * "Gegner im Dunkeln nur als Augen" (MASTERPROMPT §12.2, §19.4, §6.2; docs/ART.md §15): the presentation reads the
 * gameplay light at every creature – below the stage "Dunkel" the body of a foe sinks towards black (fully in full
 * darkness), so a night hunter shows only its emissive eyes, which glow brighter – as long as the frame it is drawn with
 * shows them (or another glow). Seen from behind, eyes shut, or without eyes at all, nothing of it glows: then it is not
 * tinted – only the scene's light darkens it, as much as the ground it stands on, no black hole darker than the night
 * (the M6-gate defect of `kreaturen-gruenhain-gegner-nacht`). A peaceful animal is no foe: only the scene's light darkens
 * it, like the ground it stands on (docs/ART.md §15.4 "verschwinden nachts im Dunkel", ADR-0168); by day or in the torch's
 * light nothing is tinted. The frames are read from the real albedo of the game atlas.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../../../tools/lib/png';
import { BALANCE } from '../../../src/content/balance';
import type { CreatureState } from '../../../src/game/creatures/state';
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

const MOD = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return mod;
})();
const MANIFEST = manifestFromGenerated(MOD);
/** The real albedo: whether a drawn frame shows something that glows is read from it. */
const ALBEDO = decodePng(readFileSync(join(process.cwd(), 'public', MOD.ATLAS.albedoUrl)));
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: ALBEDO.rgba }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const TILE = 16;
const DARK_BELOW = BALANCE.light.map.stages.darkBelow;

interface Pushed {
  sprite: string;
  x: number;
  y: number;
  tint: number;
  tintRgb: [number, number, number];
  glow: number;
  /** Glowing (emissive) pixels of the drawn frame in the albedo. */
  glowing: number;
}

/** Emissive pixels of frame `f` in the atlas's albedo. */
function glowingPixels(f: { x: number; y: number; w: number; h: number }): number {
  let n = 0;
  for (let y = f.y; y < f.y + f.h; y++) {
    for (let x = f.x; x < f.x + f.w; x++) {
      const i = (y * ALBEDO.width + x) * 4;
      if ((ALBEDO.rgba[i + 3] as number) > 0 && (ALBEDO.rgba[i + 1] as number) > 0) n++;
    }
  }
  return n;
}

function draw(sim: Simulation, ambient: number): Pushed[] {
  const owner = new Map<unknown, string>();
  for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f) => owner.set(f, s.id));
  const pushed: Pushed[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        const f = d.frame;
        pushed.push({ sprite: owner.get(f) ?? '?', x: d.x, y: d.y, tint: d.tintStrength, tintRgb: [d.tintR, d.tintG, d.tintB], glow: d.emissiveBoost, glowing: f === null ? 0 : glowingPixels(f) });
        return pushed.length - 1;
      },
    },
  } as unknown as RenderScene;
  const view = new CreatureSprites();
  view.draw(scene, ATLAS, sim, Object.assign(createCreatureFrame(), { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9, alpha: 1, time: 0, ambient }));
  return pushed;
}

/** A world at `hour` with the player, a Nachtmahr `far` tiles, a roe deer `far + 1` and a wasp swarm `far + 2` tiles east of it. */
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
    { type: 'creature.spawn', creature: 'wespenschwarm', count: 1, x: x + (far + 2) * TILE, y, layer: 0 } as never,
  ]);
  sim.step([]);
  return { sim, x, y };
}

/** The state of the newest creature `id` (the one the test spawned last). */
function newest(sim: Simulation, id: string): CreatureState {
  const creatures = sim.system('creatures') as CreatureSystem;
  for (let i = creatures.store.size - 1; i >= 0; i--) {
    const s = creatures.store.valueAt(i);
    if (s.creature === id) return s;
  }
  throw new Error(`keine Kreatur ${id}`);
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
  it('Dunkelheit aus dem Licht: hell keine, unter der Stufe Dunkel steigend, ganz dunkel schwarz – nur wo etwas glüht', () => {
    expect(darknessOf(1, true)).toBe(0);
    expect(darknessOf(DARK_BELOW, true)).toBe(0);
    expect(darknessOf(DARK_BELOW * 0.99, true)).toBeGreaterThan(0);
    expect(darknessOf(0, true)).toBe(1);
    expect(darknessOf(0.05, true)).toBe(1);
    let last = 0;
    for (let l = DARK_BELOW; l >= 0; l -= 0.01) {
      const d = darknessOf(l, true);
      expect(d).toBeGreaterThanOrEqual(last);
      // Nothing of it glows (seen from behind, eyes shut, no eyes): no black over it in any light.
      expect(darknessOf(l, false)).toBe(0);
      last = d;
    }
  });

  it('in der Nacht fern vom Licht: der Nachtmahr schwarz bis auf seine glühenden Augen, Wespenschwarm und Reh nur so dunkel wie der Boden', () => {
    const { sim } = night(23, 12, false);
    // The Nachtmahr looks towards the viewer: its eyes are in the frame.
    const nightmare = newest(sim, 'nachtmahr');
    nightmare.facing = Math.PI / 2;
    nightmare.vx = 0;
    nightmare.vy = 0;
    const lNm = levelAt(sim, 'nachtmahr');
    const lReh = levelAt(sim, 'reh');
    const lWespen = levelAt(sim, 'wespenschwarm');
    expect(lNm).toBeLessThan(DARK_BELOW);
    expect(lReh).toBeLessThan(DARK_BELOW);
    expect(lWespen).toBeLessThan(DARK_BELOW);
    const pushed = draw(sim, 0.02);
    const nm = pushed.filter((p) => p.sprite === 'kreatur_nachtmahr');
    const reh = pushed.filter((p) => p.sprite === 'kreatur_reh');
    const wespen = pushed.filter((p) => p.sprite === 'kreatur_wespenschwarm');
    expect(nm.length).toBeGreaterThan(0);
    expect(reh.length).toBeGreaterThan(0);
    expect(wespen.length).toBeGreaterThan(0);
    for (const p of nm) {
      expect(p.glowing).toBeGreaterThan(0);
      expect(p.tint).toBeCloseTo(darknessOf(lNm, true), 9);
      expect(p.tint).toBeGreaterThan(0.5);
      expect(p.tintRgb).toEqual([0, 0, 0]);
      // Its eyes glow brighter in the dark.
      expect(p.glow).toBeGreaterThan(0);
    }
    // A foe without eyes shows nothing that glows: no tint – as dark as the ground, not a black blot on it.
    for (const p of wespen) {
      expect(p.glowing).toBe(0);
      expect(p.tint).toBe(0);
    }
    // A peaceful animal: no tint – the night's light alone darkens it, as much as the ground beside it.
    for (const p of reh) expect(p.tint).toBe(0);
  });

  it('von hinten kein schwarzes Loch: ein Wolf in der Nacht, der wegsieht, bleibt ungetönt; dreht er sich um, bleiben nur seine Augen', () => {
    const { sim, x, y } = night(23, 12, false);
    sim.step([{ type: 'creature.spawn', creature: 'wolf', count: 1, x: x - 12 * TILE, y, layer: 0 } as never]);
    const creatures = sim.system('creatures') as CreatureSystem;
    const entity = creatures.store.entityAt(creatures.store.size - 1);
    const wolf = newest(sim, 'wolf');
    expect(creatures.store.get(entity)).toBe(wolf);
    expect(levelAt(sim, 'wolf')).toBeLessThan(DARK_BELOW);
    const drawnWolf = (facing: number): Pushed => {
      wolf.facing = facing;
      wolf.vx = 0;
      wolf.vy = 0;
      wolf.hurtTick = -1;
      wolf.attackPhase = 'keine';
      wolf.attack = -1;
      const at = { x: 0, y: 0 };
      creatures.positionOf(entity, at);
      const mine = draw(sim, 0.02).find((p) => p.sprite === 'kreatur_wolf' && Math.abs(p.x - at.x) < 1e-6 && Math.abs(p.y - at.y) < 1e-6);
      if (mine === undefined) throw new Error('der Wolf fehlt im Bild');
      return mine;
    };
    // Facing away (north): its frame shows no eye – it is as dark as the ground, not darker.
    const away = drawnWolf(-Math.PI / 2);
    expect(away.glowing).toBe(0);
    expect(away.tint).toBe(0);
    // Facing the viewer and sideways: the eyes are in the frame – only they stay, the body sinks into black.
    for (const facing of [Math.PI / 2, 0, Math.PI]) {
      const seen = drawnWolf(facing);
      expect(seen.glowing).toBeGreaterThan(0);
      expect(seen.tint).toBeGreaterThan(0.5);
    }
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
