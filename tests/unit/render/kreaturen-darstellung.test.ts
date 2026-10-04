/**
 * Kreaturen in der Spielansicht (M6-13 … M6-32; MASTERPROMPT §4.5, §6.2, §19.4, docs/ART.md §15): jede Kreatur ist ihr
 * Sprite `kreatur_<id>` mit dem Clip ihrer Handlung und Blickrichtung (links gespiegelt), y-sortiert an den Füßen und
 * interpoliert; ein Treffer blitzt genau zwei Frames – im Hitstop steht der Blitz mit der Simulation still (ADR-0116,
 * Nachtrag; M6-Gate `hitstop.png`); der Angriffs-Clip trifft sein `schlag`-Ereignis auf den Tick des Schlags; die Augen der Nachtjäger glühen im Dunkeln; verblassende Schattenbrut löst sich auf; ein Kadaver spielt den
 * Tod und bleibt liegen (als Nutzziel mit Umriss); wer ohne Kadaver stirbt, fällt und löst sich auf; eine Falle zeigt ihr
 * Icon und ihren Fang.
 */
import { describe, expect, it } from 'vitest';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import { attackClipAction } from '../../../src/content/creatures/schema';
import { hitstopTicks } from '../../../src/game/combat/formulas';
import { createCombatAttack, type CombatSystem } from '../../../src/game/combat/system';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import type { TrapSystem } from '../../../src/game/creatures/traps';
import type { CreatureEventMap } from '../../../src/game/creatures/events';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import { clipDuration, clipFrameAt, type AnimationClip } from '../../../src/render/anim/animation';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { attackClipSeconds, createCreatureFrame, CreatureSprites, directionOfFacing, type CreatureFrame } from '../../../src/render/game/creatures';
import type { RenderScene } from '../../../src/render/scene';

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const TILE = 16;

interface Pushed {
  sprite: string;
  frame: number;
  x: number;
  y: number;
  depth: number;
  mirror: boolean;
  flash: boolean;
  fade: number;
  glow: number;
  outline: boolean;
  tint: number;
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
        pushed.push({ sprite: o?.id ?? '?', frame: o?.index ?? -1, x: d.x, y: d.y, depth: d.depth, mirror: d.mirror, flash: d.flash, fade: d.fade, glow: d.emissiveBoost, outline: d.outline, tint: d.tintStrength });
        return pushed.length - 1;
      },
    },
  } as unknown as RenderScene;
  return { scene, pushed };
}

function frameAround(over: Partial<CreatureFrame> = {}): CreatureFrame {
  return Object.assign(createCreatureFrame(), { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9, alpha: 1, time: 0 }, over);
}

/** A world with a player and one creature `id` 3 tiles east of it (the newest entry of the store). */
function world(id: string): { sim: Simulation; creatures: CreatureSystem; index: number; x: number; y: number } {
  const sim = createSimulation({ seed: 20260930, worldSize: 'small' });
  sim.step([{ type: 'player.spawn' } as never]);
  sim.step([{ type: 'debug.god', on: true } as never]);
  const pos = sim.ecs.component('position') as unknown as { get(e: number, c: 'x' | 'y'): number };
  const x = pos.get(sim.player, 'x') + 3 * TILE;
  const y = pos.get(sim.player, 'y');
  sim.step([{ type: 'creature.spawn', creature: id, count: 1, x, y, layer: 0 } as never]);
  const creatures = sim.system('creatures') as CreatureSystem;
  return { sim, creatures, index: creatures.store.size - 1, x, y };
}

function clipOf(sprite: string, clip: string): AnimationClip {
  const c = MANIFEST.sprites[sprite]?.clips[clip];
  if (c === undefined) throw new Error(`${sprite}: kein Clip ${clip}`);
  return c;
}

function drawn(view: CreatureSprites, sim: Simulation, frame: CreatureFrame, sprite: string): Pushed[] {
  const r = recordingScene();
  view.draw(r.scene, ATLAS, sim, frame);
  return r.pushed.filter((p) => p.sprite === sprite);
}

describe('Kreaturen-Sprites', () => {
  it('Blickrichtung: die dominante Achse entscheidet', () => {
    expect(directionOfFacing(0)).toBe(3);
    expect(directionOfFacing(Math.PI)).toBe(1);
    expect(directionOfFacing(Math.PI / 2)).toBe(0);
    expect(directionOfFacing(-Math.PI / 2)).toBe(2);
    expect(directionOfFacing(0.7)).toBe(3);
  });

  it('der Hase steht als `kreatur_hase` an seinem Ort, nur auf seiner Ebene; nach links gespiegelt, beim Laufen im Gehclip', () => {
    const { sim, creatures, index } = world('hase');
    const s = creatures.store.valueAt(index);
    const at = { x: 0, y: 0 };
    creatures.positionOf(creatures.store.entityAt(index), at);
    s.vx = 0;
    s.vy = 0;
    s.facing = Math.PI;
    s.hurtTick = -1;
    s.attackPhase = 'keine';
    s.attack = -1;
    const view = new CreatureSprites();
    const mine = (list: Pushed[]): Pushed | undefined => list.find((p) => Math.abs(p.x - at.x) < 1e-6 && Math.abs(p.y - at.y) < 1e-6);
    const idle = mine(drawn(view, sim, frameAround({ time: 0 }), 'kreatur_hase'));
    expect(idle).toBeDefined();
    expect(idle?.mirror).toBe(true);
    expect(idle?.depth).toBe(at.y);
    const idleClip = clipOf('kreatur_hase', 'idle_right');
    expect(idle?.frame).toBe(clipFrameAt(idleClip, s.serial * 0.37));
    expect(drawn(view, sim, frameAround({ layer: -1 }), 'kreatur_hase')).toEqual([]);
    // Laufen nach unten: der Gehclip, interpoliert um den Rest des letzten Schritts.
    s.facing = Math.PI / 2;
    s.vx = 0;
    s.vy = 2;
    const walking = drawn(view, sim, frameAround({ alpha: 0.25, time: 0 }), 'kreatur_hase').find((p) => Math.abs(p.x - at.x) < 1e-6 && Math.abs(p.y - (at.y - 2 * 0.75)) < 1e-6);
    expect(walking).toBeDefined();
    expect(walking?.mirror).toBe(false);
    expect(walking?.frame).toBe(clipFrameAt(clipOf('kreatur_hase', 'move_down'), s.serial * 0.37));
  });

  it('ein Treffer blitzt genau zwei Frames (60 Hz) und spielt den Trefferclip', () => {
    const { sim, creatures, index } = world('hase');
    const s = creatures.store.valueAt(index);
    s.vx = 0;
    s.vy = 0;
    s.facing = 0;
    s.hurtTick = sim.tick - 1;
    const view = new CreatureSprites();
    const hitClip = clipOf('kreatur_hase', 'hit_right');
    const flashes = [0, 0.5, 0.99].map((alpha) => drawn(view, sim, frameAround({ alpha }), 'kreatur_hase').some((p) => p.flash));
    expect(flashes).toEqual([true, true, true]);
    s.hurtTick = sim.tick - 2;
    const second = drawn(view, sim, frameAround({ alpha: 0.5 }), 'kreatur_hase').filter((p) => p.flash);
    expect(second).toHaveLength(1);
    expect(second[0]?.frame).toBe(clipFrameAt(hitClip, 1.5 / sim.clock.tickHz));
    s.hurtTick = sim.tick - 3;
    expect(drawn(view, sim, frameAround({ alpha: 0 }), 'kreatur_hase').some((p) => p.flash)).toBe(false);
  });

  it('im Hitstop steht der Trefferblitz mit der Simulation still (ADR-0116, Nachtrag): ein echter Wucht-5-Treffer blitzt über alle eingefrorenen Ticks und erlischt zwei Ticks danach', () => {
    const { sim, creatures, index } = world('reh');
    const e = creatures.store.entityAt(index);
    const s = creatures.store.valueAt(index);
    const at = { x: 0, y: 0 };
    creatures.positionOf(e, at);
    const attack = createCombatAttack();
    attack.team = 'spieler';
    attack.damage = 1;
    attack.type = 'wucht';
    attack.wucht = 5;
    attack.critChance = 0;
    attack.fromX = at.x - TILE;
    attack.fromY = at.y;
    const n = hitstopTicks(5);
    expect((sim.system('combat') as CombatSystem).resolve(sim, sim.player, e, attack)?.hitstopTicks).toBe(n);
    // The hit and the freeze start on the same tick; the simulation holds the body still for the n ticks after it.
    expect(s.hurtTick).toBe(s.hitstopFromTick);
    expect(s.hitstopTicks).toBe(n);
    const view = new CreatureSprites();
    const lit: number[] = [];
    let inStop = false;
    // Every frame (three per tick) from the hit to well past the freeze: the shown moment, `now`, in ticks after the hit.
    for (let k = 0; k < n + 6; k++) {
      sim.step([]);
      for (const alpha of [0, 0.4, 0.8]) {
        const since = sim.tick - 1 + alpha - s.hurtTick;
        const flash = drawn(view, sim, frameAround({ alpha }), 'kreatur_reh').some((p) => p.flash);
        if (flash) lit.push(since);
        if (since > 2 && since <= n) inStop ||= flash;
      }
    }
    // Deep in the freeze – where a clock of raw ticks would have put the flash out long ago – the body stays white.
    expect(inStop).toBe(true);
    // It flashes through the frozen ticks and then exactly the two ticks (`FLASH_TICKS`) of running time: n + 2 in all.
    expect(Math.min(...lit)).toBe(0);
    expect(Math.max(...lit)).toBeLessThan(n + 2);
    expect(Math.max(...lit)).toBeGreaterThanOrEqual(n + 1);
    expect(lit).toHaveLength(3 * (n + 2));
  });

  it('der Angriffs-Clip trifft sein `schlag`-Ereignis auf den Tick des Schlags', () => {
    const tickHz = 60;
    expect(attackClipSeconds('ausholen', 0, 30, 0.5, tickHz)).toBe(0);
    expect(attackClipSeconds('ausholen', 15, 30, 0.5, tickHz)).toBeCloseTo(0.25, 12);
    expect(attackClipSeconds('ausholen', 30, 30, 0.5, tickHz)).toBeCloseTo(0.5, 12);
    expect(attackClipSeconds('erholen', 6, 0, 0.5, tickHz)).toBeCloseTo(0.6, 12);
    const { sim, creatures, index } = world('reh');
    const s = creatures.store.valueAt(index);
    const clip = clipOf('kreatur_reh', `${attackClipAction('tritt')}_right`);
    const strike = clip.events?.find((e) => e.name === 'schlag');
    if (strike === undefined) throw new Error('kein Schlag im Clip');
    s.facing = 0;
    s.vx = 0;
    s.vy = 0;
    s.hurtTick = -1;
    s.attack = 0;
    s.attackPhase = 'ausholen';
    // Der Schlag fällt auf den gezeigten Moment: die Ausholzeit ist genau vorbei.
    const windup = 40;
    s.attackEndTick = sim.tick - 1;
    s.attackTick = s.attackEndTick - windup;
    const atStrike = drawn(new CreatureSprites(), sim, frameAround({ alpha: 0 }), 'kreatur_reh');
    expect(atStrike.map((p) => p.frame)).toContain(clip.frames[strike.frame]);
    // Halb ausgeholt: die Hälfte der Ausholpositionen.
    s.attackTick = sim.tick - 1 - windup / 2;
    s.attackEndTick = s.attackTick + windup;
    const half = drawn(new CreatureSprites(), sim, frameAround({ alpha: 0 }), 'kreatur_reh');
    expect(half.map((p) => p.frame)).toContain(clipFrameAt(clip, (strike.frame / clip.fps) * 0.5));
  });

  it('Nachtjäger: die Augen glühen im Dunkeln, nicht am Tag; verblassende Schattenbrut löst sich auf', () => {
    const { sim, creatures, index } = world('nachtmahr');
    const s = creatures.store.valueAt(index);
    s.hurtTick = -1;
    s.fadeTick = -1;
    const view = new CreatureSprites();
    const night = drawn(view, sim, frameAround({ ambient: 0.05 }), 'kreatur_nachtmahr');
    const day = drawn(view, sim, frameAround({ ambient: 1 }), 'kreatur_nachtmahr');
    expect(night[0]?.glow).toBeGreaterThan(0.5);
    expect(day[0]?.glow).toBe(0);
    // Am Tag verblasst er (Sonnenaufgang): halb durch die Blende halb aufgelöst.
    const mare = creatures.store.entityAt(index);
    for (let i = 0; i < 50; i++) sim.step();
    const later = creatures.store.get(mare);
    if (later === undefined) throw new Error('der Nachtmahr ist schon fort');
    later.fadeTick = sim.tick - 1 - 45;
    const fading = drawn(view, sim, frameAround({ alpha: 0 }), 'kreatur_nachtmahr');
    expect(fading[0]?.fade).toBeCloseTo(0.5, 6);
    // Brennend im gleißenden Licht: warm überlagert.
    later.fadeTick = -1;
    later.burnTick = sim.tick - 1;
    expect(drawn(view, sim, frameAround({ alpha: 0 }), 'kreatur_nachtmahr')[0]?.tint).toBeGreaterThan(0);
  });

  it('ein Kadaver spielt den Tod und bleibt liegen, als Nutzziel mit Umriss; kurz vor dem Verrotten löst er sich auf', () => {
    const { sim, creatures, x, y } = world('hase');
    sim.step([{ type: 'creature.kill', radius: 8 } as never]);
    expect(creatures.carcasses.size).toBeGreaterThan(0);
    const c = creatures.carcasses.valueAt(creatures.carcasses.size - 1);
    const view = new CreatureSprites();
    // Links liegt der gespiegelte rechte Clip.
    const facing = (['down', 'right', 'up', 'right'] as const)[directionOfFacing(c.facing)];
    const death = clipOf('kreatur_hase', `death_${facing ?? 'down'}`);
    const fresh = drawn(view, sim, frameAround({ alpha: 0 }), 'kreatur_hase').find((p) => p.x === c.x && p.y === c.y);
    expect(fresh?.frame).toBe(death.frames[0]);
    for (let i = 0; i < Math.ceil(clipDuration(death) * sim.clock.tickHz) + 2; i++) sim.step();
    const lying = drawn(view, sim, frameAround({ alpha: 0, focusTx: Math.floor(c.x / TILE), focusTy: Math.floor(c.y / TILE) }), 'kreatur_hase').find((p) => p.x === c.x && p.y === c.y);
    expect(lying?.frame).toBe(death.frames[death.frames.length - 1]);
    expect(lying?.outline).toBe(true);
    expect(lying?.fade).toBe(0);
    // Eine Sekunde vor dem Verrotten: halb aufgelöst.
    c.untilTick = sim.tick - 1 + sim.clock.tickHz;
    expect(drawn(view, sim, frameAround({ alpha: 0 }), 'kreatur_hase').find((p) => p.x === c.x && p.y === c.y)?.fade).toBeCloseTo(0.5, 6);
    expect(Math.hypot(c.x - x, c.y - y)).toBeLessThan(8 * TILE);
  });

  it('wer ohne Kadaver stirbt, fällt am Ort und löst sich danach auf (`creatureDied`)', () => {
    const { sim } = world('nachtmahr');
    let handler: ((e: CreatureEventMap['creatureDied']) => void) | null = null;
    const session = {
      onEvent: (type: string, h: (e: CreatureEventMap['creatureDied']) => void) => {
        if (type === 'creatureDied') handler = h;
        return () => {
          handler = null;
        };
      },
    } as never;
    const view = new CreatureSprites();
    view.follow(session);
    const died = handler as ((e: CreatureEventMap['creatureDied']) => void) | null;
    if (died === null) throw new Error('kein Abonnement');
    const tick = sim.tick - 1;
    died({ entity: 999, creature: 'nachtmahr', by: NULL_ENTITY, carcass: NULL_ENTITY, loot: false, facing: 0, variant: -1, layer: 0, x: 100, y: 200, tick });
    // Der Hase mit Kadaver braucht keinen Platz im Ring.
    died({ entity: 998, creature: 'hase', by: NULL_ENTITY, carcass: 5, loot: false, facing: 0, variant: -1, layer: 0, x: 300, y: 200, tick });
    const death = clipOf('kreatur_nachtmahr', 'death_right');
    const first = drawn(view, sim, frameAround({ alpha: 0 }), 'kreatur_nachtmahr').find((p) => p.x === 100 && p.y === 200);
    expect(first?.frame).toBe(death.frames[0]);
    expect(first?.fade).toBe(0);
    expect(view.stats.dying).toBe(1);
    const ticks = Math.ceil((clipDuration(death) + 0.3) * sim.clock.tickHz);
    for (let i = 0; i < ticks; i++) sim.step();
    const dissolving = drawn(view, sim, frameAround({ alpha: 0 }), 'kreatur_nachtmahr').find((p) => p.x === 100 && p.y === 200);
    expect(dissolving?.frame).toBe(death.frames[death.frames.length - 1]);
    expect(dissolving?.fade).toBeGreaterThan(0.3);
    expect(dissolving?.fade).toBeLessThan(1);
    for (let i = 0; i < sim.clock.tickHz; i++) sim.step();
    expect(drawn(view, sim, frameAround({ alpha: 0 }), 'kreatur_nachtmahr').find((p) => p.x === 100 && p.y === 200)).toBeUndefined();
    view.dispose();
    expect(handler).toBeNull();
  });

  it('eine Falle zeigt ihr Icon (als Nutzziel mit Umriss) und ihren Fang', () => {
    const sim = createSimulation({ seed: 20260930, worldSize: 'small' });
    sim.step([{ type: 'player.spawn' } as never]);
    sim.step([{ type: 'inventory.give', item: 'schlinge', count: 1 } as never]);
    const pos = sim.ecs.component('position') as unknown as { get(e: number, c: 'x' | 'y'): number };
    const tx = Math.floor(pos.get(sim.player, 'x') / TILE) + 1;
    const ty = Math.floor(pos.get(sim.player, 'y') / TILE);
    sim.step([{ type: 'trap.place', from: { bereich: 'inventar', index: 0 }, tx, ty } as never]);
    const traps = sim.system('traps') as TrapSystem;
    const trap = traps.traps[0];
    if (trap === undefined) throw new Error('keine Falle');
    const view = new CreatureSprites();
    const r = recordingScene();
    view.draw(r.scene, ATLAS, sim, frameAround({ focusTx: trap.tx, focusTy: trap.ty }));
    const icon = r.pushed.find((p) => p.sprite === 'icon_schlinge');
    expect(icon).toMatchObject({ x: (trap.tx + 0.5) * TILE, y: (trap.ty + 0.5) * TILE, outline: true });
    (trap as { caught: string | null }).caught = 'hase';
    const caught = recordingScene();
    view.draw(caught.scene, ATLAS, sim, frameAround());
    expect(caught.pushed.find((p) => p.sprite === 'kreatur_hase' && p.x === (trap.tx + 0.5) * TILE)).toBeDefined();
  });
});
