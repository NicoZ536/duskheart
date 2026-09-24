import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { NULL_ENTITY, makeEntity, type Entity } from '../../../src/engine/ecs';
import type { EventArgs } from '../../../src/engine/events';
import { createSimulation } from '../../../src/game/setup';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import { MOTION_RNG_STREAM, worldBoundsPx, type MotionSystem } from '../../../src/game/systems/motion';

function motion(sim: Simulation): MotionSystem {
  return sim.system('motion') as MotionSystem;
}

function pos(sim: Simulation, e: Entity): [number, number] {
  const m = motion(sim);
  return [m.position.get(e, 'x'), m.position.get(e, 'y')];
}

function vel(sim: Simulation, e: Entity): [number, number] {
  const m = motion(sim);
  return [m.velocity.get(e, 'vx'), m.velocity.get(e, 'vy')];
}

function drain(sim: Simulation): Array<EventArgs<SimEventMap>> {
  const out: Array<EventArgs<SimEventMap>> = [];
  sim.events.drain((...e) => out.push(e));
  return out;
}

const TILE = BALANCE.world.tilePx;

describe('MotionSystem', () => {
  it('derives the world rectangle from the config', () => {
    expect(worldBoundsPx(createSimulation({ seed: 1 }).config)).toEqual({ minX: 0, minY: 0, maxX: 1536 * TILE, maxY: 1536 * TILE });
    expect(motion(createSimulation({ seed: 1, worldSize: 'small' })).bounds.maxX).toBe(1024 * TILE);
    expect(motion(createSimulation({ seed: 1, worldSize: 'large' })).bounds.maxY).toBe(2048 * TILE);
  });

  it('integrates velocity with the fixed step', () => {
    const sim = createSimulation({ seed: 1 });
    sim.step([{ type: 'spawnDebugMover', x: 100, y: 200, vx: 60, vy: -30 }]);
    const e = makeEntity(0, 0);
    // The spawn tick already integrates once.
    expect(pos(sim, e)).toEqual([101, 199.5]);
    for (let i = 0; i < 59; i++) sim.step();
    expect(pos(sim, e)[0]).toBeCloseTo(160, 3);
    expect(pos(sim, e)[1]).toBeCloseTo(170, 3);
    expect(drain(sim)[0]).toEqual(['entitySpawned', { entity: e, tick: 0 }]);
  });

  it('bounces off the world border', () => {
    const sim = createSimulation({ seed: 1, worldSize: 'small' });
    const max = motion(sim).bounds.maxX;
    sim.step([{ type: 'spawnDebugMover', x: max - 0.5, y: 1, vx: 60, vy: -120 }]);
    const e = makeEntity(0, 0);
    expect(pos(sim, e)).toEqual([max - 0.5, 1]);
    expect(vel(sim, e)).toEqual([-60, 120]);
    sim.step();
    expect(pos(sim, e)).toEqual([max - 1.5, 3]);
  });

  it('clamps extreme overshoots into the world', () => {
    const sim = createSimulation({ seed: 1, worldSize: 'small' });
    const { maxX } = motion(sim).bounds;
    sim.step([{ type: 'spawnDebugMover', x: 0, y: 0, vx: maxX * 600, vy: 0 }]);
    const [x] = pos(sim, makeEntity(0, 0));
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(maxX);
  });

  it('draws missing velocities from the motion stream deterministically', () => {
    const a = createSimulation({ seed: 11 });
    const b = createSimulation({ seed: 11 });
    const c = createSimulation({ seed: 12 });
    for (const sim of [a, b, c]) sim.step([{ type: 'spawnDebugMover', x: 50, y: 50 }]);
    const e = makeEntity(0, 0);
    expect(vel(a, e)).toEqual(vel(b, e));
    expect(vel(a, e)).not.toEqual(vel(c, e));
    const limit = BALANCE.motion.debugMoverMaxAxisSpeedTilesPerSecond * TILE;
    for (const v of vel(a, e)) expect(Math.abs(v)).toBeLessThanOrEqual(limit);
    expect(a.rng.has(MOTION_RNG_STREAM)).toBe(true);
    // A partially given velocity keeps the given axis and still advances the stream by two draws.
    a.step([{ type: 'spawnDebugMover', x: 1, y: 1, vx: 5 }]);
    b.step([{ type: 'spawnDebugMover', x: 1, y: 1 }]);
    const e2 = makeEntity(1, 0);
    expect(vel(a, e2)[0]).toBe(5);
    expect(vel(a, e2)[1]).toBe(vel(b, e2)[1]);
    expect(a.rng.stream(MOTION_RNG_STREAM).getState()).toEqual(b.rng.stream(MOTION_RNG_STREAM).getState());
  });

  it('steers the controlled entity at walking speed and normalizes diagonals', () => {
    const sim = createSimulation({ seed: 2 });
    const m = motion(sim);
    expect(m.controlled).toBe(NULL_ENTITY);
    sim.step([{ type: 'spawnDebugMover', x: 500, y: 500, controlled: true }]);
    const e = makeEntity(0, 0);
    expect(m.controlled).toBe(e);
    expect(vel(sim, e)).toEqual([0, 0]);
    expect(sim.rng.has(MOTION_RNG_STREAM)).toBe(false);
    const walk = BALANCE.motion.walkSpeedTilesPerSecond * TILE;
    sim.step([{ type: 'move', dx: 1, dy: 0 }]);
    expect(vel(sim, e)).toEqual([walk, 0]);
    sim.step([{ type: 'move', dx: 1, dy: 1 }]);
    const [vx, vy] = vel(sim, e);
    expect(Math.hypot(vx, vy)).toBeCloseTo(walk, 3);
    sim.step([{ type: 'move', dx: 0.5, dy: 0 }]);
    expect(vel(sim, e)).toEqual([walk / 2, 0]);
    sim.step([{ type: 'move', dx: 0, dy: 0 }]);
    expect(vel(sim, e)).toEqual([0, 0]);
  });

  it('rejects move without controlled entity and spawns outside the world', () => {
    const sim = createSimulation({ seed: 2 });
    sim.step([{ type: 'move', dx: 1, dy: 0 }]);
    sim.step([{ type: 'spawnDebugMover', x: -1, y: 5 }]);
    sim.step([{ type: 'spawnDebugMover', x: 5, y: 5, controlled: true }]);
    const e = makeEntity(0, 0);
    sim.step([{ type: 'despawn', entity: e }]);
    expect(motion(sim).controlled).toBe(NULL_ENTITY);
    sim.step([{ type: 'move', dx: 0, dy: 1 }]);
    const events = drain(sim).filter(([type]) => type === 'commandRejected');
    expect(events).toEqual([
      ['commandRejected', { type: 'move', reason: 'noControlledEntity', tick: 0 }],
      ['commandRejected', { type: 'spawnDebugMover', reason: 'outOfBounds', tick: 1 }],
      ['commandRejected', { type: 'move', reason: 'noControlledEntity', tick: 4 }],
    ]);
  });

  it('validates its save data', () => {
    const m = motion(createSimulation({ seed: 1 }));
    expect(m.save.serialize()).toEqual({ controlled: NULL_ENTITY, layer: 0 });
    m.save.deserialize({ controlled: 7, layer: -1 });
    expect(m.controlled).toBe(7);
    expect(m.controlledLayer).toBe(-1);
    expect(() => m.save.deserialize({ controlled: 1.5, layer: 0 })).toThrow(TypeError);
    expect(() => m.save.deserialize({ controlled: -2, layer: 0 })).toThrow(TypeError);
    expect(() => m.save.deserialize({ controlled: 7, layer: -4 })).toThrow(TypeError);
    expect(() => m.save.deserialize({ controlled: 7 })).toThrow(TypeError);
    expect(() => m.save.deserialize({})).toThrow(TypeError);
  });
});
