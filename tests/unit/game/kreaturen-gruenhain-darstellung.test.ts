/**
 * Die Darstellung der Grünhain-Kreaturen M6-20 … M6-22 (MASTERPROMPT §4.6, §6.2 „Nacht: … Glühwürmchen“, §19.4; docs/ART.md
 * §15.3):
 * - der Dornling zeigt getarnt seinen Clip `tarnung`, nach einem Treffer `erwachen` (so lange, wie die Simulation ihn
 *   nicht handeln lässt), sein Überfall den Angriffs-Clip ab dem Busch;
 * - Glühwürmchen leuchten nachts so hell wie die schwebenden Glühwürmchen der Oberfläche (M5-23), und diese halten Abstand
 *   von jeder Glühwürmchen-Kreatur – ein Schwarm, kein doppeltes Leuchten;
 * - die Lichter des Schwarms tragen den Look der schwebenden Glühwürmchen (M6-Gate `kreaturen-gruenhain-klein`): auf jedem
 *   Licht des gezeichneten Frames das helle Kreuz der Oberfläche (blasser Kern, gelbgrünes Kreuz, Schein aus dem Bloom) statt
 *   eines harten blassen Strichs, und zwei Lichter nebeneinander stehen nie wie ein Augenpaar (das Zeichen eines Gegners im
 *   Dunkeln, ADR-0120) – das zweite zeigt den dunklen Leib;
 * - der fliegende Wespenschwarm schwebt über dem weichen Kontaktschatten der Dinge in der Luft (M6-Gate
 *   `kreaturen-gruenhain-lauer`: nicht aufs Pflaster geklebt); der leuchtende Schwarm ist ein Licht und wirft keinen.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { HitResult } from '../../../src/game/combat/targets';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { BODY_LIGHTS, createCreatureFrame, CreatureSprites, FLIER_SHADOW, type CreatureFrame } from '../../../src/render/game/creatures';
import type { RenderScene } from '../../../src/render/scene';
import { Fireflies } from '../../../src/render/surface/fireflies';
import { SURFACE_PARAMS } from '../../../src/render/surface/params';
import { CHUNK_TILES, TILE_PX } from '../../../src/render/tilemap/chunk';
import type { ChunkData } from '../../../src/world/model/chunk';
import { decodePng } from '../../../tools/lib/png';
import { kreaturWelt, meadow, type KreaturWelt } from './kreatur-testwelt';

const MOD = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return mod;
})();
const MANIFEST = manifestFromGenerated(MOD);
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
/** The real albedo: where a frame's lights are is read from it. */
const ALBEDO = decodePng(readFileSync(join(process.cwd(), 'public', MOD.ATLAS.albedoUrl)));
const ATLAS_PIXELS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: ALBEDO.rgba }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const HZ = BALANCE.time.tickHz;

interface Pushed {
  readonly sprite: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  readonly glow: number;
  readonly mirror: boolean;
  readonly layer: string;
  readonly fade: number;
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
        pushed.push({ sprite: o?.id ?? '?', frame: o?.index ?? -1, x: d.x, y: d.y, depth: d.depth, glow: d.emissiveBoost, mirror: d.mirror, layer: d.layer, fade: d.fade });
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

/** The frame of clip `clip` of `sprite` (its first) – an atlas index. */
function firstFrame(sprite: string, clip: string): number {
  const f = MANIFEST.sprites[sprite]?.clips[clip]?.frames[0];
  if (f === undefined) throw new Error(`${sprite}: kein Clip ${clip}`);
  return f;
}

/** Whether pixel (col, row) of frame `index` of `sprite` glows (emissive and opaque in the albedo). */
function glowsAt(sprite: string, index: number, col: number, row: number): boolean {
  const f = MANIFEST.sprites[sprite]?.frames[index];
  if (f === undefined || col < 0 || row < 0 || col >= f.w || row >= f.h) return false;
  const i = ((f.y + row) * ALBEDO.width + f.x + col) * 4;
  return (ALBEDO.rgba[i + 3] as number) > 0 && (ALBEDO.rgba[i + 1] as number) > 0;
}

describe('Die Lichter des Glühwürmchen-Schwarms im Look der Oberfläche (M6-Gate kreaturen-gruenhain-klein)', () => {
  it('auf jedem Licht das helle Kreuz der schwebenden Glühwürmchen mit deren Leuchtkraft; zwei Lichter nebeneinander nie als Augenpaar', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.cenv.phase = 'nacht';
    w.creature('gluehwuermchen', 20, 11);
    const view = new CreatureSprites();
    const bright = firstFrame(BODY_LIGHTS.sprite, BODY_LIGHTS.bright);
    const dark = firstFrame(BODY_LIGHTS.sprite, BODY_LIGHTS.dark);
    let crosses = 0;
    let hidden = 0;
    const framesSeen = new Set<number>();
    for (let k = 0; k < 60; k++) {
      w.run(2);
      const r = recordingScene();
      // The idle clip runs on the view's clock: a moment every 1/20 s goes through all its frames.
      view.draw(r.scene, ATLAS_PIXELS, w.sim, frameAround({ ambient: 0, time: k / 20 }));
      const bodies = r.pushed.filter((p) => p.sprite === 'kreatur_gluehwuermchen');
      expect(bodies).toHaveLength(1);
      const body = bodies[0] as Pushed;
      framesSeen.add(body.frame);
      const ref = MANIFEST.sprites['kreatur_gluehwuermchen']?.frames[body.frame];
      if (ref === undefined) throw new Error('Frame fehlt');
      const lit = r.pushed.filter((p) => p.sprite === BODY_LIGHTS.sprite && p.frame === bright);
      const shut = r.pushed.filter((p) => p.sprite === BODY_LIGHTS.sprite && p.frame === dark);
      for (const p of [...lit, ...shut]) {
        // In front of the body, on a glowing pixel of the drawn frame (the cross's centre: 1 px above its anchor).
        expect(p.depth).toBeGreaterThan(body.depth);
        const dx = Math.round(p.x - body.x);
        const col = body.mirror ? ref.ax - 1 - dx : ref.ax + dx;
        const row = Math.round(p.y - 1 - body.y) + ref.ay;
        expect(glowsAt('kreatur_gluehwuermchen', body.frame, col, row), `Licht bei ${col},${row}`).toBe(true);
      }
      // The bright cross glows like the drifting fireflies' bright frame at night; the dark body does not glow.
      for (const p of lit) expect(p.glow).toBeCloseTo(BODY_LIGHTS.glow, 12);
      for (const p of shut) expect(p.glow).toBe(0);
      // Never two bright crosses side by side like a pair of eyes.
      for (let i = 0; i < lit.length; i++) {
        for (let j = i + 1; j < lit.length; j++) {
          const a = lit[i] as Pushed;
          const b = lit[j] as Pushed;
          const pair = Math.abs(a.x - b.x) <= BODY_LIGHTS.pairDx && Math.abs(a.y - b.y) <= BODY_LIGHTS.pairDy;
          expect(pair, `Augenpaar ${a.x},${a.y} / ${b.x},${b.y}`).toBe(false);
        }
      }
      crosses += lit.length;
      hidden += shut.length;
    }
    // The swarm's clip went through several frames; lights were lit, and lights beside a lit one were shut.
    expect(framesSeen.size).toBeGreaterThan(4);
    expect(crosses).toBeGreaterThan(0);
    expect(hidden).toBeGreaterThan(0);
  });

  it('am Tag ohne Verstärkung, in der Dämmerung steigend, ab der Dunkelheit der Oberfläche voll', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.cenv.phase = 'nacht';
    w.creature('gluehwuermchen', 20, 11);
    w.run(2);
    const view = new CreatureSprites();
    const bright = firstFrame(BODY_LIGHTS.sprite, BODY_LIGHTS.bright);
    const glowAt = (ambient: number): number[] => {
      const r = recordingScene();
      view.draw(r.scene, ATLAS_PIXELS, w.sim, frameAround({ ambient }));
      return r.pushed.filter((p) => p.sprite === BODY_LIGHTS.sprite && p.frame === bright).map((p) => p.glow);
    };
    const day = glowAt(1);
    const dusk = glowAt((0.5 + BODY_LIGHTS.fullBelow) / 2);
    const full = glowAt(BODY_LIGHTS.fullBelow);
    expect(day.length).toBeGreaterThan(0);
    for (const g of day) expect(g).toBe(0);
    for (const g of dusk) {
      expect(g).toBeGreaterThan(0);
      expect(g).toBeLessThan(BODY_LIGHTS.glow);
    }
    for (const g of full) expect(g).toBeCloseTo(BODY_LIGHTS.glow, 12);
  });
});

describe('Fliegende Schwärme über ihrem Kontaktschatten (M6-Gate kreaturen-gruenhain-lauer)', () => {
  it('der Wespenschwarm schwebt über dem weichen Schatten der Dinge in der Luft, unter ihm auf dem Boden; das leuchtende Glühwürmchen wirft keinen', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    const wasps = w.creature('wespenschwarm', 26, 15);
    w.creature('gluehwuermchen', 12, 11);
    w.run(2);
    const view = new CreatureSprites();
    const r = recordingScene();
    view.draw(r.scene, ATLAS_PIXELS, w.sim, frameAround({ ambient: 1 }));
    const swarm = r.pushed.filter((p) => p.sprite === 'kreatur_wespenschwarm');
    expect(swarm).toHaveLength(1);
    const shadows = r.pushed.filter((p) => p.sprite === FLIER_SHADOW.sprite);
    // One shadow – the swarm's, none for the fireflies.
    expect(shadows).toHaveLength(1);
    const shadow = shadows[0] as Pushed;
    const at = w.where(wasps);
    const sprite = MANIFEST.sprites['kreatur_wespenschwarm'];
    if (sprite === undefined) throw new Error('Sprite fehlt');
    // The large oval under a 32-px cell, dithered like a drop's shadow, on the ground layer.
    expect(sprite.size[0]).toBeGreaterThan(FLIER_SHADOW.smallCellPx);
    expect(shadow.frame).toBe(FLIER_SHADOW.large);
    expect(shadow.layer).toBe('ground');
    expect(shadow.fade).toBe(FLIER_SHADOW.fade);
    expect(shadow.x).toBeCloseTo(at.x, 9);
    // Under the lowest pixel the swarm's sprite ever draws – shown below it, not hidden behind it.
    const lowest = (sprite.bounds?.y ?? 0) + (sprite.bounds?.h ?? 0) - (sprite.frames[0]?.ay ?? 0);
    expect(shadow.y - at.y).toBeCloseTo(Math.max(0, lowest) + FLIER_SHADOW.belowPx, 9);
    expect(shadow.y).toBeGreaterThan(at.y);
  });
});
