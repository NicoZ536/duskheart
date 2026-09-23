import { describe, expect, it } from 'vitest';
import { createSettingsStore } from '../../../src/engine/settings';
import type { GamepadLike } from '../../../src/engine/input/state';
import { BOOT_SESSION_SEED, GameSession } from '../../../src/game/session';

function pad(x: number): GamepadLike {
  return {
    id: 'Wireless Controller (STANDARD GAMEPAD)',
    index: 0,
    connected: true,
    mapping: 'standard',
    axes: [x, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
}

describe('GameSession', () => {
  it('turns held keys into commands once per frame and applies them in the next tick', () => {
    const session = new GameSession({ config: { seed: BOOT_SESSION_SEED } });
    session.command({ type: 'spawnDebugMover', x: 400, y: 400, controlled: true });
    session.step();
    const start = session.debugState().controlled;
    expect(start).not.toBeNull();
    session.input.keyDown('KeyD');
    session.beginFrame();
    expect(session.sim.commands.size).toBe(1);
    for (let i = 0; i < 60; i++) session.step();
    const moved = session.debugState();
    expect(moved.controlled?.x).toBeGreaterThan(start?.x ?? Number.POSITIVE_INFINITY);
    expect(moved.tick).toBe(61);
    expect(moved.events.entitySpawned).toBe(1);
    expect(moved.events.worldTick).toBe(1);
  });

  it('re-sends a held direction to a newly controlled entity', () => {
    const session = new GameSession({ config: { seed: 1 } });
    session.input.keyDown('KeyS');
    session.beginFrame();
    session.step();
    expect(session.debugState().events.commandRejected).toBe(1);
    session.command({ type: 'spawnDebugMover', x: 10, y: 10, controlled: true });
    session.beginFrame();
    expect(session.sim.commands.size).toBe(2);
    session.step();
    session.step();
    expect(session.debugState().controlled?.y).toBeGreaterThan(10);
  });

  it('validates commands from debug tools', () => {
    const session = new GameSession({ config: { seed: 1 } });
    expect(() => session.command({ type: 'teleport' })).toThrow(TypeError);
    expect(() => session.command({ type: 'move', dx: 2, dy: 0 })).toThrow(/dx/);
    expect(session.sim.commands.size).toBe(0);
  });

  it('polls gamepads and applies the control settings (deadzone, bindings)', () => {
    let x = 0.3;
    const session = new GameSession({ config: { seed: 1 }, getGamepads: () => [pad(x)] });
    session.beginFrame();
    expect(session.sim.commands.size).toBe(1);
    const settings = createSettingsStore(null, { navigatorLanguage: 'de' });
    session.applyControls({ ...settings.get().controls, stickDeadzone: 0.5, bindings: { moveRight: [{ kind: 'key', code: 'KeyL' }] } });
    session.sim.commands.clear();
    x = 0.4;
    session.beginFrame();
    // 0.4 is inside the new deadzone: the stick stops.
    const drained: unknown[] = [];
    session.sim.commands.drainForTick(0, (c) => drained.push(c));
    expect(drained).toEqual([{ type: 'move', dx: 0, dy: 0 }]);
    session.input.keyDown('KeyL');
    session.beginFrame();
    session.sim.commands.drainForTick(0, (c) => drained.push(c));
    expect(drained[1]).toEqual({ type: 'move', dx: 1, dy: 0 });
  });

  it('reports a plain debug state', () => {
    const state = new GameSession({ config: { seed: 7, worldSize: 'small' } }).debugState();
    expect(state).toMatchObject({ seed: 7, worldSize: 'small', tick: 0, day: 1, time: '06:00', entities: 0, controlled: null, queuedCommands: 0 });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
