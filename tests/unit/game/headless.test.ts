import { describe, expect, it } from 'vitest';
import { demoScript, runHeadless } from '../../../src/game/headless';
import { createSimulation } from '../../../src/game/setup';
import type { MotionSystem } from '../../../src/game/systems/motion';

describe('runHeadless', () => {
  it('runs N ticks and reports hash and event counts', () => {
    const res = runHeadless({ seed: 1, ticks: 600, config: { dayLengthMinutes: 12 } });
    expect(res.sim.tick).toBe(600);
    expect(res.hash).toBe(res.sim.hashState());
    expect(res.events.worldTick).toBe(10);
    expect(res.events.dailyTick).toBe(0);
    expect(res.sim.config.dayLengthMinutes).toBe(12);
    expect(res.sim.events.size).toBe(0);
  });

  it('is deterministic and seed dependent', () => {
    const script = demoScript({ ticks: 1200, seed: 3 });
    const a = runHeadless({ seed: 10, ticks: 1200, commands: script });
    const b = runHeadless({ seed: 10, ticks: 1200, commands: script });
    const c = runHeadless({ seed: 11, ticks: 1200, commands: script });
    expect(a.hash).toBe(b.hash);
    expect(c.hash).not.toBe(a.hash);
  });

  it('continues an existing simulation and skips commands before its tick', () => {
    const script = demoScript({ ticks: 900, seed: 4 });
    const whole = runHeadless({ seed: 2, ticks: 900, commands: script });
    const first = runHeadless({ seed: 2, ticks: 400, commands: script });
    const rest = runHeadless({ sim: first.sim, ticks: 500, commands: script });
    expect(rest.sim).toBe(first.sim);
    expect(rest.hash).toBe(whole.hash);
  });

  it('validates its options', () => {
    expect(() => runHeadless({ ticks: 1 })).toThrow(/seed is required/);
    expect(() => runHeadless({ seed: 1, ticks: -1 })).toThrow(RangeError);
    expect(() => runHeadless({ seed: 1, ticks: 1.5 })).toThrow(RangeError);
    expect(() => runHeadless({ seed: 1, sim: createSimulation({ seed: 1 }), ticks: 1 })).toThrow(/either sim or seed/);
  });
});

describe('demoScript', () => {
  it('exercises every command type deterministically', () => {
    const a = demoScript({ ticks: 2000, seed: 8 });
    expect(demoScript({ ticks: 2000, seed: 8 })).toEqual(a);
    expect(demoScript({ ticks: 2000, seed: 9 })).not.toEqual(a);
    const types = new Set(a.map((e) => e.cmd.type));
    expect([...types].sort()).toEqual(['despawn', 'move', 'spawnDebugMover']);
    expect(a.every((e, i) => i === 0 || e.tick >= (a[i - 1]?.tick ?? 0))).toBe(true);
    expect(a.every((e) => e.tick < 2000)).toBe(true);
    expect(demoScript({ ticks: 0, seed: 1 })).toEqual([]);
  });

  it('predicts entity handles correctly: despawns hit live movers, stale ones are rejected', () => {
    const script = demoScript({ ticks: 2000, seed: 8 });
    const res = runHeadless({ seed: 5, ticks: 2000, commands: script });
    const despawns = script.filter((e) => e.cmd.type === 'despawn').length;
    const stale = Math.floor(Math.floor(1999 / 250) / 4);
    expect(res.events.entityDespawned).toBe(despawns - stale);
    expect(res.events.commandRejected).toBe(stale);
    const motion = res.sim.system('motion') as MotionSystem;
    expect(res.sim.ecs.alive(motion.controlled)).toBe(true);
    expect(res.sim.ecs.count).toBe(1 + 48);
  });
});
