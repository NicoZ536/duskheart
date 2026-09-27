/**
 * M4-22 (MASTERPROMPT §26 "Standardbelegung … R Drehen, B Bauen", §16.6 "Pipette (Mittelklick), Rückgängig … (Strg+Z)"):
 * the input context `build` of the build mode. The player keeps walking and interacting, but the primary button is
 * the build mode's (it places the ghost – no `player.useItem`), and R, F, the middle button and Ctrl+Z are the build
 * mode's actions: F does not toggle the light, Ctrl does not sneak, the digit keys do not choose the hand. G (pad RB)
 * switches blueprint mode (M4-24) – only while building: in play G is nothing and RB turns the hotbar.
 */
import { describe, expect, it } from 'vitest';
import { CommandQueue } from '../../../src/engine/commands';
import { BindingSet, PAD } from '../../../src/engine/input/bindings';
import { ActionReader } from '../../../src/engine/input/reader';
import { InputState } from '../../../src/engine/input/state';
import type { GameCommand } from '../../../src/game/commands';
import { InputCommandTranslator } from '../../../src/game/input';

function chain() {
  const state = new InputState();
  const reader = new ActionReader(state, new BindingSet());
  const translator = new InputCommandTranslator();
  const queue = new CommandQueue<GameCommand>();
  /** One presentation frame: the actions of the frame, the commands they became. */
  const frame = (): { commands: GameCommand[]; pressed: (a: Parameters<ActionReader['wasPressed']>[0]) => boolean } => {
    reader.update();
    translator.translate(reader, queue, 'player');
    const seen = new Set(['attack', 'rotate', 'mirror', 'pipette', 'undo', 'blueprint', 'toggleLight', 'build', 'hotbarNext'].filter((a) => reader.wasPressed(a as Parameters<ActionReader['wasPressed']>[0])));
    state.endFrame();
    const commands: GameCommand[] = [];
    queue.drainForTick(0, (cmd) => commands.push(cmd));
    return { commands, pressed: (a) => seen.has(a) };
  };
  return { state, reader, frame };
}

describe('Eingabekontext build (M4-22)', () => {
  it('die Primärtaste benutzt im Baumodus keinen Gegenstand – beim Spielen schon', () => {
    const { state, reader, frame } = chain();
    state.mouseButtonDown(0);
    expect(frame().commands).toEqual([{ type: 'player.useItem' }]);
    state.mouseButtonUp(0);
    frame();
    reader.setContext('build');
    state.mouseButtonDown(0);
    const f = frame();
    expect(f.pressed('attack')).toBe(true);
    expect(f.commands).toEqual([]);
  });

  it('gehen und interagieren bleiben; R, F, Mittelklick und Strg+Z sind Bauaktionen, kein Licht, kein Schleichen', () => {
    const { state, reader, frame } = chain();
    reader.setContext('build');
    state.keyDown('KeyD');
    expect(frame().commands).toEqual([{ type: 'player.move', dx: 1, dy: 0 }]);
    state.keyUp('KeyD');
    frame();
    state.keyDown('KeyF');
    let f = frame();
    expect(f.pressed('mirror')).toBe(true);
    expect(f.pressed('toggleLight')).toBe(false);
    expect(f.commands.some((c) => c.type === 'light.toggle')).toBe(false);
    state.keyUp('KeyF');
    state.keyDown('KeyR');
    expect(frame().pressed('rotate')).toBe(true);
    state.keyUp('KeyR');
    state.mouseButtonDown(1);
    expect(frame().pressed('pipette')).toBe(true);
    state.mouseButtonUp(1);
    state.keyDown('ControlLeft');
    f = frame();
    expect(f.commands.some((c) => c.type === 'player.sneak')).toBe(false);
    state.keyDown('KeyZ');
    expect(frame().pressed('undo')).toBe(true);
    state.keyUp('KeyZ');
    state.keyUp('ControlLeft');
    frame();
    // The digit keys do not choose the hand while building (the build panel is where pieces are chosen).
    state.keyDown('Digit3');
    expect(frame().commands.some((c) => c.type === 'player.selectHotbar')).toBe(false);
    state.keyUp('Digit3');
    // B leaves the build mode (its opener is read in the build context too).
    state.keyDown('KeyB');
    expect(frame().pressed('build')).toBe(true);
  });

  it('G und RB schalten im Baumodus die Blaupause – beim Spielen ist G nichts und RB blättert die Schnellleiste', () => {
    const { state, reader, frame } = chain();
    /** A standard-mapping pad with the buttons `down` held. */
    const pad = (...down: number[]) => ({ id: 'pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 })) });
    state.keyDown('KeyG');
    let f = frame();
    expect(f.pressed('blueprint')).toBe(false);
    expect(f.commands).toEqual([]);
    state.keyUp('KeyG');
    frame();
    reader.setContext('build');
    state.keyDown('KeyG');
    f = frame();
    expect(f.pressed('blueprint')).toBe(true);
    expect(f.commands).toEqual([]);
    state.keyUp('KeyG');
    frame();
    state.applyGamepad(pad(PAD.RB));
    f = frame();
    expect(f.pressed('blueprint')).toBe(true);
    expect(f.pressed('hotbarNext')).toBe(false);
    expect(f.commands.some((c) => c.type === 'player.scrollHotbar')).toBe(false);
    state.applyGamepad(pad());
    frame();
    reader.setContext('play');
    state.applyGamepad(pad(PAD.RB));
    f = frame();
    expect(f.pressed('blueprint')).toBe(false);
    expect(f.pressed('hotbarNext')).toBe(true);
  });

  it('beim Spielen schaltet F das Licht (dieselbe Taste, anderer Kontext)', () => {
    const { state, frame } = chain();
    state.keyDown('KeyF');
    const f = frame();
    expect(f.pressed('toggleLight')).toBe(true);
    expect(f.pressed('mirror')).toBe(false);
    expect(f.commands.some((c) => c.type === 'light.toggle')).toBe(true);
  });
});
