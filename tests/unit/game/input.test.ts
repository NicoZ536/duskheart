/**
 * M0-08 "Tastatur, Maus, Gamepad, Touch → Aktionen → Commands": the whole chain from raw input
 * through the ActionReader into game commands, applied by the simulation and replayable.
 */
import { describe, expect, it } from 'vitest';
import { CommandQueue, CommandRecorder } from '../../../src/engine/commands';
import { BindingSet } from '../../../src/engine/input/bindings';
import { ActionReader } from '../../../src/engine/input/reader';
import { InputState, type GamepadLike } from '../../../src/engine/input/state';
import type { GameCommand } from '../../../src/game/commands';
import { runHeadless } from '../../../src/game/headless';
import { InputCommandTranslator } from '../../../src/game/input';
import { createSimulation } from '../../../src/game/setup';
import type { MotionSystem } from '../../../src/game/systems/motion';

function chain() {
  const state = new InputState();
  const reader = new ActionReader(state, new BindingSet());
  const translator = new InputCommandTranslator();
  const queue = new CommandQueue<GameCommand>();
  /** One presentation frame: evaluate actions, translate, clear per-frame edges. */
  const frame = (): GameCommand[] => {
    reader.update();
    translator.translate(reader, queue);
    state.endFrame();
    const out: GameCommand[] = [];
    queue.drainForTick(0, (cmd) => out.push(cmd));
    return out;
  };
  return { state, reader, translator, frame };
}

function stick(x: number, y: number): GamepadLike {
  return {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD)',
    index: 0,
    connected: true,
    mapping: 'standard',
    axes: [x, y, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
}

describe('InputCommandTranslator', () => {
  it('keyboard: WASD becomes a move command only when the direction changes', () => {
    const { state, frame } = chain();
    expect(frame()).toEqual([]);
    state.keyDown('KeyD');
    expect(frame()).toEqual([{ type: 'move', dx: 1, dy: 0 }]);
    expect(frame()).toEqual([]);
    state.keyDown('KeyW');
    const [diag] = frame();
    expect(diag?.type).toBe('move');
    if (diag?.type !== 'move') throw new Error('expected move');
    expect(diag.dx).toBeCloseTo(Math.SQRT1_2, 6);
    expect(diag.dy).toBeCloseTo(-Math.SQRT1_2, 6);
    state.keyUp('KeyD');
    state.keyUp('KeyW');
    expect(frame()).toEqual([{ type: 'move', dx: 0, dy: 0 }]);
  });

  it('gamepad: the left stick keeps its analog magnitude, the deadzone suppresses drift', () => {
    const { state, frame } = chain();
    state.applyGamepad(stick(0.1, 0.05));
    expect(frame()).toEqual([]);
    state.applyGamepad(stick(0, 0.8));
    const [cmd] = frame();
    if (cmd?.type !== 'move') throw new Error('expected move');
    expect(cmd.dx).toBe(0);
    expect(cmd.dy).toBeGreaterThan(0.5);
    expect(cmd.dy).toBeLessThanOrEqual(1);
  });

  it('touch: the virtual movement stick steers like a gamepad stick', () => {
    const { state, frame } = chain();
    state.setTouchStick('move', -1, 0);
    expect(frame()).toEqual([{ type: 'move', dx: -1, dy: 0 }]);
    state.setTouchStick('move', 0, 0);
    expect(frame()).toEqual([{ type: 'move', dx: 0, dy: 0 }]);
  });

  it('menus stop movement: the ui context sends a stop command', () => {
    const { state, reader, frame } = chain();
    state.keyDown('KeyA');
    expect(frame()).toEqual([{ type: 'move', dx: -1, dy: 0 }]);
    reader.setContext('ui');
    expect(frame()).toEqual([{ type: 'move', dx: 0, dy: 0 }]);
  });

  it('resync sends the held direction again', () => {
    const { state, translator, frame } = chain();
    state.keyDown('KeyS');
    expect(frame()).toHaveLength(1);
    expect(frame()).toHaveLength(0);
    translator.resync();
    expect(frame()).toEqual([{ type: 'move', dx: 0, dy: 1 }]);
  });

  it('commands from input move the controlled entity and replay to the same hash', () => {
    const sim = createSimulation({ seed: 3 });
    const recorder = new CommandRecorder<GameCommand>();
    sim.commands.setSink(recorder);
    const state = new InputState();
    const reader = new ActionReader(state, new BindingSet());
    const translator = new InputCommandTranslator();
    sim.step([{ type: 'spawnDebugMover', x: 1000, y: 1000, controlled: true }]);
    const motion = sim.system('motion') as MotionSystem;
    const x0 = motion.position.get(motion.controlled, 'x');
    for (let f = 0; f < 120; f++) {
      if (f === 10) state.keyDown('KeyD');
      if (f === 70) state.keyUp('KeyD');
      reader.update();
      translator.translate(reader, sim.commands);
      state.endFrame();
      sim.step();
      sim.events.clear();
    }
    expect(motion.position.get(motion.controlled, 'x')).toBeGreaterThan(x0);
    expect(recorder.entries.map((e) => e.cmd.type)).toEqual(['spawnDebugMover', 'move', 'move']);
    const replay = runHeadless({ seed: 3, ticks: sim.tick, commands: recorder.toJSON() });
    expect(replay.hash).toBe(sim.hashState());
  });
});
