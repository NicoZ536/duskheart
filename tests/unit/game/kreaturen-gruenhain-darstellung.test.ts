/**
 * Die Darstellung der Grünhain-Kreaturen M6-20 … M6-22 (MASTERPROMPT §4.6, §6.2 „Nacht: … Glühwürmchen“, §19.4; docs/ART.md
 * §15.3):
 * - der Dornling zeigt getarnt seinen Clip `tarnung`, nach einem Treffer `erwachen` (so lange, wie die Simulation ihn
 *   nicht handeln lässt), sein Überfall den Angriffs-Clip ab dem Busch;
 * - Glühwürmchen leuchten nachts so hell wie die schwebenden Glühwürmchen der Oberfläche (M5-23), und diese halten Abstand
 *   von jeder Glühwürmchen-Kreatur – ein Schwarm, kein doppeltes Leuchten.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { HitResult } from '../../../src/game/combat/targets';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { createCreatureFrame, CreatureSprites, type CreatureFrame } from '../../../src/render/game/creatures';
import type { RenderScene } from '../../../src/render/scene';
import { Fireflies } from '../../../src/render/surface/fireflies';
import { SURFACE_PARAMS } from '../../../src/render/surface/params';
import { CHUNK_TILES, TILE_PX } from '../../../src/render/tilemap/chunk';
import type { ChunkData } from '../../../src/world/model/chunk';
import { kreaturWelt, meadow, type KreaturWelt } from './kreatur-testwelt';

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const HZ = BALANCE.time.tickHz;

interface Pushed {
  readonly sprite: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  readonly glow: number;
}

function recordingScene(): { scene: RenderScene; pushed: Pushed[] } {
  const owner = new Map<unknown, { id: string; index: number }>();
  for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f, index) => owner.set(f, { id: s.id, index }));
  const pushed: Pushed[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        const o = owner.get(d.frame);
        pushed.push({ sprite: o?.id ?? '?', frame: o?.index ?? -1, x: d.x, y: d.y, depth: d.depth, glow: d.emissiveBoost });
        return pushed.length - 1;
      },
    },
  } as unknown as RenderScene;
  return { scene, pushed };
}

function frameAround(over: Partial<CreatureFrame> = {}): CreatureFrame {
  return Object.assign(createCreatureFrame(), { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9, alpha: 1, time: 0 }, over);
}

/** The frames (atlas indices) of clip `clip` of `sprite`. */
function framesOf(sprite: string, clip: string): Set<number> {
  const c = MANIFEST.sprites[sprite]?.clips[clip];
  if (c === undefined) throw new Error(`${sprite}: kein Clip ${clip}`);
  return new Set(c.frames);
}

/** The sprite frame drawn for creature `id` (the only one of its kind in the world). */
function drawnFrame(view: CreatureSprites, w: KreaturWelt, id: string, frame = frameAround()): Pushed {
  const r = recordingScene();
  view.draw(r.scene, ATLAS, w.sim, frame);
  const p = r.pushed.filter((x) => x.sprite === `kreatur_${id}`);
  expect(p).toHaveLength(1);
  return p[0] as Pushed;
}

function hitOn(w: KreaturWelt, e: number): void {
  const hit: HitResult = { attacker: w.sim.player, attackerTeam: 'spieler', amount: 1, type: 'hieb', crit: false, parried: false, blocked: false, blockStamina: 0, knockback: 0, dirX: 0, dirY: 0, hitstopTicks: 0, staggerTicks: 0, condition: null, conditionSeconds: 0, armorBreak: 0, armorBreakSeconds: 0 };
  w.creatures.targets.applyHit(w.sim, e, hit);
}

describe('Dornling im Bild (M6-22)', () => {
  it('getarnt der Busch (`tarnung`), geweckt `erwachen` für die Dauer der Enthüllung, danach wieder Ruhe', () => {
    const w = kreaturWelt(meadow(64, 30), { x: 44, y: 15 });
    w.cheats.god = true;
    const d = w.creature('dornling', 10, 15);
    const view = new CreatureSprites();
    expect(framesOf('kreatur_dornling', 'tarnung_down').has(drawnFrame(view, w, 'dornling').frame)).toBe(true);
    hitOn(w, d);
    // After the hit clip (2 frames at 8 fps), within the reveal (0,5 s).
    w.run(Math.round(0.35 * HZ));
    const waking = drawnFrame(view, w, 'dornling');
    expect(framesOf('kreatur_dornling', 'erwachen_down').has(waking.frame) || framesOf('kreatur_dornling', 'erwachen_right').has(waking.frame) || framesOf('kreatur_dornling', 'erwachen_up').has(waking.frame)).toBe(true);
    expect(framesOf('kreatur_dornling', 'tarnung_down').has(waking.frame)).toBe(false);
    w.run(Math.round(0.3 * HZ));
    const awake = drawnFrame(view, w, 'dornling');
    for (const dir of ['down', 'up', 'right']) expect(framesOf('kreatur_dornling', `tarnung_${dir}`).has(awake.frame)).toBe(false);
  });

  it('sein Überfall ist der Angriffs-Clip `ueberfall` ab dem Busch', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.creature('dornling', 21, 15);
    w.run(2);
    const view = new CreatureSprites();
    const f = drawnFrame(view, w, 'dornling');
    const ambush = new Set([...framesOf('kreatur_dornling', 'attack_ueberfall_down'), ...framesOf('kreatur_dornling', 'attack_ueberfall_right'), ...framesOf('kreatur_dornling', 'attack_ueberfall_up')]);
    expect(ambush.has(f.frame)).toBe(true);
  });
});

describe('Glühwürmchen und die schwebenden Glühwürmchen der Oberfläche (M6-20, M5-23)', () => {
  it('leuchten nachts wie die Oberfläche (emissiveBoost 1 im Dunkeln), am Tag nicht verstärkt', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.cenv.phase = 'nacht';
    w.creature('gluehwuermchen', 20, 11);
    const view = new CreatureSprites();
    expect(drawnFrame(view, w, 'gluehwuermchen', frameAround({ ambient: 0 })).glow).toBeCloseTo(1, 6);
    expect(drawnFrame(view, w, 'gluehwuermchen', frameAround({ ambient: 1 })).glow).toBe(0);
  });

  it('die schwebenden Glühwürmchen halten `creatureClearPx` Abstand von jeder Glühwürmchen-Kreatur', () => {
    const sim: Simulation = createSimulation({ seed: 20260930, worldSize: 'small' });
    sim.step([{ type: 'player.spawn' } as never]);
    sim.step([{ type: 'setTime', hour: 23, minute: 0 } as never, { type: 'setWeather', state: 'klar' } as never, { type: 'debug.god', on: true } as never]);
    const fireflies = new Fireflies();
    expect(Fireflies.active(sim, 0, 0)).toBe(true);
    // A resident chunk of the surface with drifting fireflies.
    const chunks: ChunkData[] = [];
    sim.world.chunks.forEachResident((c) => {
      if (c.layer === 0) chunks.push(c);
    });
    const size = CHUNK_TILES * TILE_PX;
    let view = { layer: 0, time: 1, left: 0, top: 0, right: 0, bottom: 0 };
    let before: Pushed[] = [];
    for (const c of chunks) {
      view = { layer: 0, time: 1, left: c.cx * size, top: c.cy * size, right: (c.cx + 1) * size, bottom: (c.cy + 1) * size };
      const r = recordingScene();
      fireflies.emit(r.scene, ATLAS, sim, view);
      before = r.pushed.filter((p) => p.sprite === 'gluehwuermchen');
      if (before.length >= 3) break;
    }
    expect(before.length).toBeGreaterThanOrEqual(3);
    // A firefly creature where the first of them drifts.
    const target = before[0] as Pushed;
    sim.step([{ type: 'creature.spawn', creature: 'gluehwuermchen', count: 1, x: target.x, y: target.depth, layer: 0 } as never]);
    const creatures = sim.system('creatures') as CreatureSystem;
    const at = { x: 0, y: 0 };
    let found = false;
    for (let i = 0; i < creatures.store.size && !found; i++) {
      if (creatures.store.valueAt(i).creature !== 'gluehwuermchen') continue;
      found = creatures.positionOf(creatures.store.entityAt(i), at);
    }
    expect(found).toBe(true);
    const r = recordingScene();
    fireflies.emit(r.scene, ATLAS, sim, view);
    const after = r.pushed.filter((p) => p.sprite === 'gluehwuermchen');
    expect(after.length).toBeLessThan(before.length);
    // Their drifting base keeps clear; the drift itself (`driftPx`) is all that may come nearer.
    const clear = SURFACE_PARAMS.fireflies.creatureClearPx - SURFACE_PARAMS.fireflies.driftPx;
    for (const p of after) expect(Math.hypot(p.x - at.x, p.depth - at.y)).toBeGreaterThanOrEqual(clear);
  });
});
