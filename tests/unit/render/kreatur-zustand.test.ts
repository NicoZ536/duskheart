/**
 * Zustände auf Kreaturen sichtbar (M6-80; MASTERPROMPT §4.6 Lesbarkeit, §11.3 „sichtbare Wirkung“, §19.3; ADR-0151):
 * - Betäubt (`aktionstempo` 0): die Taumelpose – der Trefferclip vom betäubenden Treffer an, dann sein eingesacktes letztes
 *   Bild, einen Pixel hin und her schwankend – und drei kreisende Sterne über dem Kopf dieser Pose, genau in den Ticks, in
 *   denen die Simulation die Kreatur hält (bis einschließlich `untilTick`), nicht einen Tick länger;
 * - Verlangsamt (Frost, `zeitlupe`): eisige Tönung, wo der Körper zu sehen ist, und die Schleifen laufen mit dem
 *   Aktionstempo, der Gang mit dem Tempo – zum Ende des Zustands ohne Sprung wieder in der Präsentationszeit;
 * - Geblendet (`blendung`): zwei schräge Blendfunken am Kopf;
 * - die Zeichen sind emissiv (auch nachts lesbar) und kosten im Frame-Pfad keine Allokation (ADR-0142, ADR-0167).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { decodePng } from '../../../tools/lib/png';
import { CONTENT } from '../../../src/content/index';
import type { Entity } from '../../../src/engine/ecs';
import { createCombatAttack, type CombatSystem } from '../../../src/game/combat/system';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import { clipDuration, clipFrameAt, type AnimationClip } from '../../../src/render/anim/animation';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { createCreatureFrame, CreatureSprites, directionOfFacing, hitstopOverlap, type CreatureFrame } from '../../../src/render/game/creatures';
import {
  COND_ACTION_LEAD,
  COND_LAST_TICK,
  COND_NOW,
  COND_PACE_LEAD,
  COND_REGISTERS,
  CreatureConditionTable,
  FROST,
  MARK_DAZZLE,
  MARK_FROST,
  MARK_FRONT,
  MARK_HELD,
  MARK_REGISTERS,
  MARK_RX,
  MARK_RY,
  MARK_SERIAL,
  MARK_STARS,
  MARK_SWAY,
  MARK_TIME,
  MARK_X,
  MARK_Y,
  STATUS_SPRITE,
  STUN,
  conditionMarksInto,
  orbitHeight,
  orbitRadius,
  starInto,
  swayInto,
} from '../../../src/render/game/statusMarks';
import { RenderScene } from '../../../src/render/scene';
import { CombatFeedback } from '../../../src/render/game/combatFeedback';
import { ProjectileView } from '../../../src/render/game/projectiles';
import { BALANCE } from '../../../src/content/balance';

const MOD = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return mod;
})();
const MANIFEST = manifestFromGenerated(MOD);
/** The real albedo: the heads of the poses are read from its coverage. */
const ALBEDO = decodePng(readFileSync(join(process.cwd(), 'public', MOD.ATLAS.albedoUrl)));
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: ALBEDO.rgba }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const TILE = 16;
const HZ = 60;
const CONDITIONS = CONTENT.collection('conditions');

interface Pushed {
  sprite: string;
  frame: number;
  x: number;
  y: number;
  depth: number;
  height: number;
  glow: number;
  tint: number;
  tintRgb: [number, number, number];
}

/** Sprite and frame index of every atlas frame (built once: the manifest is read only; ≈ 18 000 frames, M6-93). */
const OWNER = (() => {
  const owner = new Map<unknown, { id: string; index: number }>();
  for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f, index) => owner.set(f, { id: s.id, index }));
  return owner;
})();

function recordingScene(): { scene: RenderScene; pushed: Pushed[] } {
  const owner = OWNER;
  const pushed: Pushed[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        const o = owner.get(d.frame);
        pushed.push({ sprite: o?.id ?? '?', frame: o?.index ?? -1, x: d.x, y: d.y, depth: d.depth, height: d.heightBase, glow: d.emissiveBoost, tint: d.tintStrength, tintRgb: [d.tintR, d.tintG, d.tintB] });
        return pushed.length - 1;
      },
    },
  } as unknown as RenderScene;
  return { scene, pushed };
}

function frameAround(over: Partial<CreatureFrame> = {}): CreatureFrame {
  return Object.assign(createCreatureFrame(), { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9, alpha: 0, time: 0 }, over);
}

/** A world at `hour` (midday) with the player (god mode) and a wolf 3 tiles east of it. */
function wolfWorld(hour = 12): { sim: Simulation; creatures: CreatureSystem; wolf: Entity } {
  const sim = createSimulation({ seed: 20261004, worldSize: 'small' });
  sim.step([{ type: 'setTime', hour, minute: 0 } as never]);
  sim.step([{ type: 'player.spawn' } as never]);
  sim.step([{ type: 'debug.god', on: true } as never]);
  const pos = sim.ecs.component('position') as unknown as { get(e: number, c: 'x' | 'y'): number };
  const x = pos.get(sim.player, 'x') + 3 * TILE;
  const y = pos.get(sim.player, 'y');
  sim.step([{ type: 'creature.spawn', creature: 'wolf', count: 1, x, y, layer: 0 } as never]);
  const creatures = sim.system('creatures') as CreatureSystem;
  const wolf = creatures.store.entityAt(creatures.store.size - 1);
  return { sim, creatures, wolf };
}

/** The player's blow lays condition `id` for `seconds` on `target` (chance 1, no damage, no stagger) through `CombatSystem.resolve`. */
function strike(sim: Simulation, target: Entity, id: string, seconds: number): void {
  const combat = sim.system('combat') as CombatSystem;
  const a = { ...createCombatAttack(), team: 'spieler' as const, damage: 0, wucht: 0, staggerSeconds: 0, critChance: 0, condition: { id, chance: 1, sekunden: seconds } };
  expect(combat.resolve(sim, sim.player, target, a)?.condition).toBe(id);
}

function clipOf(sprite: string, clip: string): AnimationClip {
  const c = MANIFEST.sprites[sprite]?.clips[clip];
  if (c === undefined) throw new Error(`${sprite}: kein Clip ${clip}`);
  return c;
}

/** The highest opaque row of frame `index` of `sprite` [px above its anchor] and the span of its opaque columns [px from the anchor]. */
function opaque(sprite: string, index: number): { up: number; left: number; right: number } {
  const f = MANIFEST.sprites[sprite]?.frames[index];
  if (f === undefined) throw new Error(`${sprite}: kein Frame ${index}`);
  let top = -1;
  let left = f.w;
  let right = -1;
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      if ((ALBEDO.rgba[((f.y + y) * ALBEDO.width + f.x + x) * 4 + 3] as number) === 0) continue;
      if (top < 0) top = y;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  return { up: f.ay - top, left: left - f.ax, right: right - f.ax };
}

function draw(view: CreatureSprites, sim: Simulation, frame: CreatureFrame): Pushed[] {
  const r = recordingScene();
  view.draw(r.scene, ATLAS, sim, frame);
  return r.pushed;
}

/** Holds the wolf still facing east (it would turn to the player): the pose is read for one direction. */
function hold(creatures: CreatureSystem, wolf: Entity): void {
  const s = creatures.store.get(wolf);
  if (s === undefined) throw new Error('der Wolf ist fort');
  s.facing = 0;
  s.vx = 0;
  s.vy = 0;
}

describe('Zustände auf Kreaturen: Tabelle aus dem Inhalt', () => {
  it('betäubt hält (Taumelpose) und zeigt Sterne, verlangsamt tönt eisig und bremst die Uhren, geblendet zeigt Funken', () => {
    const table = new CreatureConditionTable();
    const at = (id: string): number => {
      const k = table.indexOf(id);
      expect(k, id).toBeGreaterThanOrEqual(0);
      return k;
    };
    const stun = at('betaeubt');
    expect(CONDITIONS.get('betaeubt').wirkung.aktionstempo).toBe(0);
    expect(table.marks[stun]).toBe(MARK_HELD | MARK_STARS);
    expect(table.actionLead[stun]).toBe(0);
    const slow = at('verlangsamt');
    const w = CONDITIONS.get('verlangsamt').wirkung;
    expect(table.marks[slow]).toBe(MARK_FROST);
    expect(table.actionLead[slow]).toBeCloseTo(1 - (w.aktionstempo ?? 1), 12);
    expect(table.paceLead[slow]).toBeCloseTo(1 - (w.tempo ?? 1), 12);
    expect(table.marks[at('geblendet')]).toBe(MARK_DAZZLE);
    expect(table.marks[at('blutung')]).toBe(0);
    expect(table.indexOf('gibt_es_nicht')).toBe(-1);
  });

  it('ein Zustand zeigt sich bis einschließlich seines `untilTick`; die Uhren laufen um (1 − Faktor) × Restzeit voraus', () => {
    const table = new CreatureConditionTable();
    const r = new Float64Array(COND_REGISTERS);
    const list = [
      { id: 'betaeubt', untilTick: 200 },
      { id: 'verlangsamt', untilTick: 300 },
    ];
    r[COND_LAST_TICK] = 200;
    r[COND_NOW] = 200.5;
    expect(conditionMarksInto(list, table, r)).toBe(MARK_HELD | MARK_STARS | MARK_FROST);
    expect(r[COND_ACTION_LEAD]).toBeCloseTo(0.15 * (301 - 200.5), 9);
    expect(r[COND_PACE_LEAD]).toBeCloseTo(0.3 * (301 - 200.5), 9);
    r[COND_LAST_TICK] = 201;
    r[COND_NOW] = 201;
    expect(conditionMarksInto(list, table, r)).toBe(MARK_FROST);
    // Zum Ende des Frosts läuft die Uhr wieder in der Präsentationszeit: kein Sprung.
    r[COND_LAST_TICK] = 300;
    r[COND_NOW] = 301;
    expect(conditionMarksInto(list, table, r)).toBe(MARK_FROST);
    expect(r[COND_ACTION_LEAD]).toBe(0);
    r[COND_LAST_TICK] = 301;
    expect(conditionMarksInto(list, table, r)).toBe(0);
    expect(r[COND_ACTION_LEAD]).toBe(0);
  });

  it('Sterne kreisen auf einer flachen Ellipse (vorn die untere Hälfte), die Pose schwankt um höchstens einen Pixel', () => {
    const r = new Float64Array(MARK_REGISTERS);
    const rx = orbitRadius(32);
    const ry = orbitHeight(rx);
    r[MARK_RX] = rx;
    r[MARK_RY] = ry;
    expect(rx).toBe(Math.round(32 * STUN.radiusShare));
    expect(ry).toBe(Math.round(rx * STUN.tilt));
    // Drei Sterne von 5 px Breite liegen auf der Bahn eines 32-px-Wesens nie aufeinander: Abstand ≥ 5 px zwischen zwei Nachbarn.
    expect(rx * Math.sqrt(3)).toBeGreaterThanOrEqual(2 * 5);
    expect(orbitRadius(16)).toBe(STUN.minRadiusPx);
    expect(orbitRadius(64)).toBe(STUN.maxRadiusPx);
    const sways = new Set<number>();
    for (let k = 0; k < 120; k++) {
      r[MARK_TIME] = k / 60;
      r[MARK_SERIAL] = 3;
      let front = 0;
      for (let i = 0; i < STUN.stars; i++) {
        starInto(r, i);
        expect(Math.abs(r[MARK_X] as number)).toBeLessThanOrEqual(rx);
        expect(Math.abs(r[MARK_Y] as number)).toBeLessThanOrEqual(ry);
        expect(Number.isInteger(r[MARK_X])).toBe(true);
        expect(r[MARK_FRONT]).toBe((r[MARK_Y] as number) > 0 ? 1 : (r[MARK_Y] as number) < 0 ? 0 : r[MARK_FRONT]);
        front += r[MARK_FRONT] as number;
      }
      // Drei Sterne im Abstand von 120°: einer oder zwei vorn.
      expect(front).toBeGreaterThanOrEqual(1);
      expect(front).toBeLessThanOrEqual(2);
      swayInto(r);
      sways.add(r[MARK_SWAY] as number);
    }
    expect([...sways].sort()).toEqual([-1, 0, 1]);
  });
});

describe('Betäubte, verlangsamte und geblendete Kreaturen in der Spielansicht', () => {
  it('ein betäubter Wolf: Taumelpose und drei Sterne über dem Kopf genau so lange, wie die Simulation ihn hält', () => {
    const { sim, creatures, wolf } = wolfWorld();
    hold(creatures, wolf);
    const view = new CreatureSprites();
    const before = draw(view, sim, frameAround());
    expect(before.filter((p) => p.sprite === STATUS_SPRITE)).toEqual([]);
    expect(view.stats.stunned).toBe(0);
    const struckAt = sim.tick;
    strike(sim, wolf, 'betaeubt', 1.5);
    const until = creatures.store.get(wolf)?.conditions.find((c) => c.id === 'betaeubt')?.untilTick as number;
    expect(until).toBe(struckAt + Math.round(1.5 * HZ));
    const hit = clipOf('kreatur_wolf', 'hit_right');
    const sagged = hit.frames[hit.frames.length - 1] as number;
    const head = opaque('kreatur_wolf', sagged);
    const hitTicks = Math.ceil(clipDuration(hit) * HZ);
    let stunnedFrames = 0;
    for (let k = 0; sim.tick - 1 <= until + 2; k++) {
      sim.step();
      hold(creatures, wolf);
      const s = creatures.store.get(wolf);
      if (s === undefined) throw new Error('der Wolf ist fort');
      for (const alpha of [0, 0.5, 0.999]) {
        const pushed = draw(view, sim, frameAround({ alpha, time: k / HZ }));
        const body = pushed.find((p) => p.sprite === 'kreatur_wolf');
        const stars = pushed.filter((p) => p.sprite === STATUS_SPRITE);
        const stunned = sim.tick - 1 <= until;
        expect(view.stats.stunned, `Tick ${sim.tick - 1}`).toBe(stunned ? 1 : 0);
        expect(stars.length, `Tick ${sim.tick - 1}`).toBe(stunned ? STUN.stars : 0);
        if (!stunned || body === undefined) continue;
        stunnedFrames++;
        // Der Trefferclip vom betäubenden Treffer an (im Hitstop steht seine Uhr), danach sein letztes Bild gehalten.
        const now = sim.tick - 1 + alpha;
        const since = now - struckAt - hitstopOverlap(s.hitstopFromTick, s.hitstopTicks, s.hurtTick, now);
        if (since >= hitTicks) expect(body.frame).toBe(sagged);
        else expect(body.frame).toBe(clipFrameAt(hit, since / HZ));
        // Schwanken um höchstens einen Pixel, ganzzahlig.
        const at = { x: 0, y: 0 };
        creatures.positionOf(wolf, at);
        expect(Math.abs(body.x - at.x)).toBeLessThanOrEqual(STUN.swayPx);
        expect(Number.isInteger(body.x - at.x)).toBe(true);
        // Über dem Kopf der Pose: jeder Stern höher als ihr höchstes Pixel, innerhalb der Kreisbahn um den Kopf.
        for (const st of stars) {
          // Der unterste Punkt eines Sterns (2 px unter seiner Mitte) bleibt über dem Kopf.
          expect(st.y + 2).toBeLessThan(body.y - head.up);
          expect(st.y).toBeGreaterThanOrEqual(body.y - head.up - STUN.liftPx - 2 * orbitHeight(orbitRadius(32)));
          expect(st.x - body.x).toBeGreaterThanOrEqual(head.left - orbitRadius(32));
          expect(st.x - body.x).toBeLessThanOrEqual(head.right + orbitRadius(32));
          expect(st.glow).toBe(STUN.glow);
          expect(Math.abs(st.depth - body.depth)).toBeLessThan(0.1);
        }
      }
    }
    // Ticks struckAt … until (einschließlich) mit je drei Bildern.
    expect(stunnedFrames).toBe((until - struckAt + 1) * 3);
    // Danach handelt er wieder: ein neuer Treffer ohne Zustand zeigt nur den Trefferclip, keine Sterne.
    expect(draw(view, sim, frameAround()).some((p) => p.sprite === STATUS_SPRITE)).toBe(false);
  });

  it('verlangsamt: eisig getönt; die Leerlaufschleife läuft mit dem Aktionstempo und trifft zum Ende die Präsentationszeit', () => {
    const { sim, creatures, wolf } = wolfWorld();
    hold(creatures, wolf);
    strike(sim, wolf, 'verlangsamt', 5);
    const s = creatures.store.get(wolf);
    if (s === undefined) throw new Error('der Wolf ist fort');
    const until = s.conditions.find((c) => c.id === 'verlangsamt')?.untilTick as number;
    for (let i = 0; i < 30; i++) sim.step();
    hold(creatures, wolf);
    s.hurtTick = -1;
    const view = new CreatureSprites();
    const idle = clipOf('kreatur_wolf', `idle_${(['down', 'right', 'up', 'right'] as const)[directionOfFacing(0)]}`);
    const now = sim.tick - 1;
    const time = 2;
    const body = draw(view, sim, frameAround({ time })).find((p) => p.sprite === 'kreatur_wolf');
    expect(body?.tint).toBe(FROST.strength);
    expect(body?.tintRgb).toEqual([FROST.r, FROST.g, FROST.b]);
    expect(view.stats.frosted).toBe(1);
    const lead = (1 - (CONDITIONS.get('verlangsamt').wirkung.aktionstempo ?? 1)) * (until + 1 - now);
    // Der Hitstop des Treffers hält die Schleifen an (wie jede Uhr des Körpers).
    const still = hitstopOverlap(s.hitstopFromTick, s.hitstopTicks, Number.NEGATIVE_INFINITY, now) / HZ;
    expect(body?.frame).toBe(clipFrameAt(idle, time + s.serial * 0.37 - still + lead / HZ));
    // Die Uhr läuft mit 0,85: zwei Bilder im Abstand Δ rücken den Clip um 0,85·Δ vor (bei festem Tick: Δ der Präsentationszeit, Restzeit gleich).
    const later = draw(view, sim, frameAround({ time: time + 0.5 })).find((p) => p.sprite === 'kreatur_wolf');
    expect(later?.frame).toBe(clipFrameAt(idle, time + 0.5 + s.serial * 0.37 - still + lead / HZ));
    // Am Ende: kein Vorlauf mehr, keine Tönung.
    while (sim.tick - 1 <= until) sim.step();
    hold(creatures, wolf);
    const after = draw(view, sim, frameAround({ time })).find((p) => p.sprite === 'kreatur_wolf');
    expect(after?.tint).toBe(0);
    expect(after?.frame).toBe(clipFrameAt(idle, time + s.serial * 0.37 - still));
    expect(view.stats.frosted).toBe(0);
  });

  it('geblendet: zwei Blendfunken am Kopf, emissiv; betäubt und geblendet zugleich: Sterne und Funken', () => {
    const { sim, creatures, wolf } = wolfWorld();
    hold(creatures, wolf);
    strike(sim, wolf, 'geblendet', 4);
    sim.step();
    hold(creatures, wolf);
    const view = new CreatureSprites();
    const pushed = draw(view, sim, frameAround({ time: 1 }));
    const sparks = pushed.filter((p) => p.sprite === STATUS_SPRITE);
    const body = pushed.find((p) => p.sprite === 'kreatur_wolf');
    expect(sparks).toHaveLength(2);
    expect(view.stats.dazzled).toBe(1);
    expect(view.stats.stunned).toBe(0);
    const idle = opaque('kreatur_wolf', clipOf('kreatur_wolf', 'idle_right').frames[0] as number);
    for (const sp of sparks) {
      expect(sp.glow).toBeGreaterThan(0);
      expect(sp.y).toBeLessThan((body?.y ?? 0) - idle.up + 1);
      expect(MANIFEST.sprites[STATUS_SPRITE]?.clips.blendung?.frames).toContain(sp.frame);
    }
    strike(sim, wolf, 'betaeubt', 1.5);
    sim.step();
    hold(creatures, wolf);
    const both = draw(view, sim, frameAround({ time: 1 })).filter((p) => p.sprite === STATUS_SPRITE);
    expect(both).toHaveLength(STUN.stars + 2);
  });

  it('nachts: die Sterne bleiben (emissiv); der Körper mit geschlossenen Augen ist so dunkel wie der Boden, kein schwarzes Loch', () => {
    const { sim, creatures, wolf } = wolfWorld(23);
    hold(creatures, wolf);
    strike(sim, wolf, 'betaeubt', 1.5);
    sim.step();
    hold(creatures, wolf);
    const view = new CreatureSprites();
    const pushed = draw(view, sim, frameAround({ ambient: 0.05, time: 1 }));
    const at = { x: 0, y: 0 };
    creatures.positionOf(wolf, at);
    // The night brings creatures of its own: the stunned wolf is the one at its place.
    const body = pushed.find((p) => p.sprite === 'kreatur_wolf' && Math.abs(p.x - at.x) <= STUN.swayPx && p.y === at.y);
    const stars = pushed.filter((p) => p.sprite === STATUS_SPRITE);
    expect(view.stats.stunned).toBe(1);
    // The stagger pose shuts its eyes (`augenZu`): nothing of it glows, so the dark's tint leaves it – the night's light
    // darkens it like the ground beside it (M6 gate: a body sunk to black without its eyes was a hole in the picture).
    expect(clipOf('kreatur_wolf', 'hit_right').frames).toContain(body?.frame);
    expect(body?.tint).toBe(0);
    expect(stars).toHaveLength(STUN.stars);
    for (const st of stars) {
      expect(st.glow).toBe(STUN.glow);
      expect(st.tint).toBe(0);
    }
  });
});

let inspector: Session;
beforeAll(async () => {
  inspector = new Session();
  inspector.connect();
  await inspector.post('HeapProfiler.enable');
});
afterAll(() => inspector.disconnect());

/**
 * Frames per window and windows (the method of `kampf-ruhe.test.ts`, ADR-0140): after a warm-up window, the median of the
 * windows is the steady state – a tier-up or a deoptimisation shows up once, in one window.
 */
const FRAMES = 3000;
const WINDOWS = 5;
const SAMPLING_INTERVAL = 16;
/** Limit [B per frame] of what the marks add: one number formed every frame (16 B) would exceed it eight times. */
const MAX_EXTRA_BYTES_PER_FRAME = 2;

/**
 * Bytes per frame the creature view allocates in steady state (median of `WINDOWS` windows of `FRAMES` frames, presentation
 * time running, the simulation's tick standing – the frame path's semantics, ADR-0142) in a world with two wolves next to
 * the player at midday – `withConditions`: one stunned, the other slowed and blinded.
 */
async function bytesPerFrame(withConditions: boolean): Promise<{ median: number; windows: string }> {
  const { sim, creatures, wolf } = wolfWorld();
  const pos = sim.ecs.component('position') as unknown as { get(e: number, c: 'x' | 'y'): number };
  sim.step([{ type: 'creature.spawn', creature: 'wolf', count: 1, x: pos.get(sim.player, 'x'), y: pos.get(sim.player, 'y') + 3 * TILE, layer: 0 } as never]);
  const second = creatures.store.entityAt(creatures.store.size - 1);
  if (withConditions) {
    strike(sim, wolf, 'betaeubt', 1.5);
    strike(sim, second, 'verlangsamt', 5);
    strike(sim, second, 'geblendet', 4);
  }
  // Past the hitstop of the blows (at most 6 ticks): the bodies' clocks run.
  for (let i = 0; i < 10; i++) sim.step();
  const view = new CreatureSprites();
  const scene = new RenderScene();
  const frame = frameAround({ alpha: 0.37 });
  const frames = (n: number, from: number): void => {
    for (let i = 0; i < n; i++) {
      scene.beginFrame(0);
      // Whole seconds: the harness forms no number of its own (the stars turn 0,9 times a second – a new place every frame).
      frame.time = from + i;
      view.draw(scene, ATLAS, sim, frame);
    }
  };
  frames(FRAMES, 0);
  expect(view.stats.stunned).toBe(withConditions ? 1 : 0);
  expect(view.stats.frosted).toBe(withConditions ? 1 : 0);
  expect(view.stats.dazzled).toBe(withConditions ? 1 : 0);
  expect(view.stats.marks).toBe(withConditions ? STUN.stars + 2 : 0);
  const perFrame: number[] = [];
  const tops: string[] = [];
  for (let w = 1; w <= WINDOWS; w++) {
    await inspector.post('HeapProfiler.collectGarbage');
    await inspector.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    frames(FRAMES, w * FRAMES);
    const profile = heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
    const alloc = pathAllocation(profile, (f) => f.functionName === 'frames' && /kreatur-zustand\.test/.test(f.url));
    perFrame.push(alloc.inPath / FRAMES);
    tops.push(JSON.stringify(alloc.top));
  }
  const median = [...perFrame].sort((a, b) => a - b)[Math.floor(WINDOWS / 2)] as number;
  return { median, windows: `${perFrame.map((b) => b.toFixed(2)).join(' / ')}: ${tops.join(' | ')}` };
}

describe('Zustandszeichen ohne Allokation (§30, ADR-0142)', { timeout: 60_000 }, () => {
  it('betäubt, verlangsamt und geblendet: die Zeichen fügen dem Frame-Pfad der Kreaturen keine Allokation hinzu', async () => {
    const without = await bytesPerFrame(false);
    const marked = await bytesPerFrame(true);
    expect(marked.median - without.median, `mit Zuständen ${marked.windows} – ohne ${without.windows}`).toBeLessThan(MAX_EXTRA_BYTES_PER_FRAME);
  });
});

describe('Pfeile im Körper folgen der gezeichneten Pose (M6-Gate `kreatur-betaeubt`)', () => {
  /** The highest pixel of column `dx` (px right of the anchor) of frame `index` of `sprite` [px above its feet], −1 none. */
  const upAt = (sprite: string, index: number, dx: number): number => {
    const f = MANIFEST.sprites[sprite]?.frames[index];
    if (f === undefined) throw new Error(`${sprite}: kein Frame ${index}`);
    const col = f.ax + dx;
    if (col < 0 || col >= f.w) return -1;
    for (let y = 0; y < f.h; y++) if ((ALBEDO.rgba[((f.y + y) * ALBEDO.width + f.x + col) * 4 + 3] as number) !== 0) return f.ay - y;
    return -1;
  };

  /** The span [left, right) of screen columns [px right of the anchor] whose standing outline (`standingAt`) reaches `z`. */
  const spanAt = (standingAt: (dx: number) => number, z: number): { left: number; right: number } => {
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    for (let dx = -64; dx <= 64; dx++) {
      if (standingAt(dx) < z) continue;
      left = Math.min(left, dx);
      right = Math.max(right, dx + 1);
    }
    return { left, right };
  };

  it('ein Pfeil im betäubten Wolf steckt am Rand seiner Zeichnung, sinkt mit der Taumelpose an seiner Spalte und schwankt mit ihr; steht der Wolf wieder, steckt er wieder in Flughöhe', () => {
    const Z = BALANCE.combat.projectile.flightHeightPx;
    const r = CONTENT.collection('creatures').get('wolf').radius;
    const { sim, creatures, wolf } = wolfWorld();
    hold(creatures, wolf);
    const view = new CreatureSprites();
    const arrows = new ProjectileView();
    // The game view runs: the arrows' view knows the bodies before the arrow sticks (it asks for the body's pose then).
    const warm = recordingScene();
    view.draw(warm.scene, ATLAS, sim, frameAround());
    arrows.draw(warm.scene, MANIFEST, null, 0, sim.tick - 1, 0, HZ, creatures);
    const at = { x: 0, y: 0 };
    creatures.positionOf(wolf, at);
    // Its standing pose facing east: per column the highest pixel of any idle frame there.
    const idle = clipOf('kreatur_wolf', 'idle_right');
    const standingAt = (dx: number): number => Math.max(...idle.frames.map((f) => upAt('kreatur_wolf', f, dx)));
    // From the west, caught in the middle of the body: it enters the drawing at its west edge at the flight height (wider
    // than the body's circle, `radius`) and sits tip in, drawn back 3 px from there – the head just inside the outline.
    const span = spanAt(standingAt, Z);
    expect(span.left).toBeLessThan(-r);
    const column = span.left;
    const t = sim.tick;
    arrows.fired({ entity: 9001, owner: 0, item: 'pfeil_feuerstein', klasse: 'bogen', vx: 200, vy: 0, tension: 1, layer: 0, x: at.x - 50, y: at.y, tick: t - 5 });
    arrows.hit({ entity: 9001, owner: 0, item: 'pfeil_feuerstein', target: wolf, wirkung: null, radius: 0, layer: 0, x: at.x, y: at.y, tick: t });
    arrows.stuck({ entity: 9001, item: 'pfeil_feuerstein', wo: 'ziel', drop: false, layer: 0, x: at.x, y: at.y, tick: t }, MANIFEST, new CombatFeedback());
    const standing = standingAt(column);
    expect(standing).toBeGreaterThanOrEqual(Z);
    /** One frame of the game view: the creatures first, then the arrows in their bodies (as gameScene draws them). */
    const frame = (time: number): { body: Pushed; arrow: Pushed; feetX: number; feetY: number } => {
      const rec = recordingScene();
      view.draw(rec.scene, ATLAS, sim, frameAround({ time }));
      arrows.draw(rec.scene, MANIFEST, null, 0, sim.tick - 1, 0, HZ, creatures);
      const feet = { x: 0, y: 0 };
      creatures.positionOf(wolf, feet);
      const body = rec.pushed.find((p) => p.sprite === 'kreatur_wolf' && Math.abs(p.y - feet.y) < 1e-9);
      const arrow = rec.pushed.find((p) => p.sprite === 'geschoss_pfeil');
      if (body === undefined || arrow === undefined) throw new Error('Wolf oder Pfeil fehlt im Bild');
      return { body, arrow, feetX: feet.x, feetY: feet.y };
    };
    /** The arrow on a body drawn with `f.body`'s frame: as far below the flight height as that pose lies below standing. */
    const expectOn = (f: { body: Pushed; arrow: Pushed; feetX: number; feetY: number }, label: string): number => {
      const drop = standing - upAt('kreatur_wolf', f.body.frame, column);
      expect(f.arrow.height, label).toBeCloseTo(Z - drop, 9);
      expect(f.arrow.y, label).toBeCloseTo(f.feetY - (Z - drop), 9);
      // At the drawing's west edge, drawn back 3 px; moved along with the pose's sway (the body drawn off its position).
      expect(f.arrow.x, label).toBeCloseTo(f.feetX + column - 3 + (f.body.x - f.feetX), 5);
      return f.arrow.height;
    };
    // From the first frame on the arrow rides the body's pose (asked for when it stuck).
    const stand = expectOn(frame(0), 'stehend');
    expect(stand).toBeGreaterThan(Z - 2);
    // Stunned: the hit clip runs into its sagging last frame and holds it – the arrow sinks with the pose.
    const struckAt = sim.tick;
    strike(sim, wolf, 'betaeubt', 1.5);
    const hit = clipOf('kreatur_wolf', 'hit_right');
    const sagged = hit.frames[hit.frames.length - 1] as number;
    expect(upAt('kreatur_wolf', sagged, column)).toBeLessThan(standing);
    const hitTicks = Math.ceil(clipDuration(hit) * HZ);
    let swayed = false;
    let low = Number.POSITIVE_INFINITY;
    for (let k = 0; sim.tick - 1 < struckAt + hitTicks + 30; k++) {
      sim.step();
      hold(creatures, wolf);
      const f = frame(k / HZ);
      const h = expectOn(f, `Tick ${sim.tick - 1}`);
      if (f.body.frame === sagged) low = Math.min(low, h);
      swayed ||= f.body.x !== f.feetX;
    }
    expect(low).toBeLessThan(Z);
    expect(swayed).toBe(true);
    // Up again once the stun is over: back on its standing pose.
    const until = creatures.store.get(wolf)?.conditions.find((c) => c.id === 'betaeubt')?.untilTick ?? struckAt + 90;
    while (sim.tick - 1 <= until + hitTicks) {
      sim.step();
      hold(creatures, wolf);
    }
    const after = frame(0);
    expect(idle.frames).toContain(after.body.frame);
    expect(expectOn(after, 'wieder stehend')).toBeGreaterThan(Z - 2);
  });
  it('gespiegelt (nach Westen, ein Pfeil von Osten): der Pfeil reitet dieselbe Spalte der gespiegelten Pose', () => {
    const Z = BALANCE.combat.projectile.flightHeightPx;
    const r = CONTENT.collection('creatures').get('wolf').radius;
    const { sim, creatures, wolf } = wolfWorld();
    const west = (): void => {
      const s = creatures.store.get(wolf);
      if (s === undefined) throw new Error('der Wolf ist fort');
      s.facing = Math.PI;
      s.vx = 0;
      s.vy = 0;
    };
    west();
    const view = new CreatureSprites();
    const arrows = new ProjectileView();
    const warm = recordingScene();
    view.draw(warm.scene, ATLAS, sim, frameAround());
    arrows.draw(warm.scene, MANIFEST, null, 0, sim.tick - 1, 0, HZ, creatures);
    const at = { x: 0, y: 0 };
    creatures.positionOf(wolf, at);
    const t = sim.tick;
    arrows.fired({ entity: 9002, owner: 0, item: 'pfeil_feuerstein', klasse: 'bogen', vx: -200, vy: 0, tension: 1, layer: 0, x: at.x + 50, y: at.y, tick: t - 5 });
    arrows.hit({ entity: 9002, owner: 0, item: 'pfeil_feuerstein', target: wolf, wirkung: null, radius: 0, layer: 0, x: at.x, y: at.y, tick: t });
    arrows.stuck({ entity: 9002, item: 'pfeil_feuerstein', wo: 'ziel', drop: false, layer: 0, x: at.x, y: at.y, tick: t }, MANIFEST, new CombatFeedback());
    // The west clip is the mirrored east one: screen column dx shows frame column −1 − dx. The arrow enters at the east
    // edge of the mirrored drawing at the flight height – its last column there.
    expect(MANIFEST.sprites.kreatur_wolf?.clips.idle_left).toBeUndefined();
    const idle = clipOf('kreatur_wolf', 'idle_right');
    const standingAt = (dx: number): number => Math.max(...idle.frames.map((f) => upAt('kreatur_wolf', f, -1 - dx)));
    const span = spanAt(standingAt, Z);
    expect(span.right).toBeGreaterThan(r);
    const mirroredColumn = -1 - (span.right - 1);
    const standing = standingAt(span.right - 1);
    const hit = clipOf('kreatur_wolf', 'hit_right');
    const sagged = hit.frames[hit.frames.length - 1] as number;
    const drawn = (): { body: Pushed; arrow: Pushed } => {
      const rec = recordingScene();
      view.draw(rec.scene, ATLAS, sim, frameAround());
      arrows.draw(rec.scene, MANIFEST, null, 0, sim.tick - 1, 0, HZ, creatures);
      const body = rec.pushed.find((p) => p.sprite === 'kreatur_wolf');
      const arrow = rec.pushed.find((p) => p.sprite === 'geschoss_pfeil');
      if (body === undefined || arrow === undefined) throw new Error('Wolf oder Pfeil fehlt im Bild');
      return { body, arrow };
    };
    const standingFrame = drawn();
    // At the drawing's east edge, drawn back 3 px (towards the shooter).
    expect(standingFrame.arrow.x).toBeCloseTo(at.x + span.right + 3 + (standingFrame.body.x - at.x), 5);
    expect(standingFrame.arrow.height).toBeCloseTo(Z - (standing - upAt('kreatur_wolf', standingFrame.body.frame, mirroredColumn)), 9);
    const struckAt = sim.tick;
    strike(sim, wolf, 'betaeubt', 1.5);
    const hitTicks = Math.ceil(clipDuration(hit) * HZ);
    let seen = false;
    while (sim.tick - 1 < struckAt + hitTicks + 10) {
      sim.step();
      west();
      const f = drawn();
      expect(f.arrow.height).toBeCloseTo(Z - (standing - upAt('kreatur_wolf', f.body.frame, mirroredColumn)), 9);
      seen ||= f.body.frame === sagged;
    }
    expect(seen).toBe(true);
    expect(upAt('kreatur_wolf', sagged, mirroredColumn)).toBeLessThan(standing);
  });
});
