/**
 * Die Standardbelegung des Spielers (MASTERPROMPT §26 "E Interagieren, Q Gürtel, F Licht an/aus, 1–0,
 * LMB/RMB"; src/game/input.ts): jede Taste wird im Frame, in dem sie gedrückt wird, zu genau einem Command –
 * 1–0 und das Mausrad wählen den Schnellleisten-Platz (M3-02), Q benutzt den Gürtel (M3-25), F schaltet das
 * getragene Licht (M3-22), die Primärtaste benutzt das Ding in der Hand (M3-15/16/22), E drückt und lässt
 * los (M3-10). Gehaltene Tasten wiederholen nichts; in Menüs (Kontext `ui`) schweigen sie; der Debug-Mover
 * ohne Spieler bekommt keine davon.
 */
import { describe, expect, it } from 'vitest';
import { CommandQueue } from '../../../src/engine/commands';
import { BindingSet } from '../../../src/engine/input/bindings';
import { ActionReader } from '../../../src/engine/input/reader';
import { InputState } from '../../../src/engine/input/state';
import type { GameCommand } from '../../../src/game/commands';
import { InputCommandTranslator } from '../../../src/game/input';

/** One wheel notch in the DOM's pixel mode. */
const NOTCH = 100;

function chain() {
  const state = new InputState();
  const reader = new ActionReader(state, new BindingSet());
  const translator = new InputCommandTranslator();
  const queue = new CommandQueue<GameCommand>();
  const frame = (target: 'player' | 'mover' = 'player'): GameCommand[] => {
    reader.update();
    translator.translate(reader, queue, target);
    state.endFrame();
    const out: GameCommand[] = [];
    queue.drainForTick(0, (cmd) => out.push(cmd));
    return out;
  };
  return { state, reader, frame };
}

describe('Standardbelegung → Spieler-Commands', () => {
  it('1–0 wählen den Schnellleisten-Platz 0–9, einmal je Druck', () => {
    const { state, frame } = chain();
    const digits = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
    digits.forEach((code, index) => {
      state.keyDown(code);
      expect(frame()).toEqual([{ type: 'player.selectHotbar', index }]);
      expect(frame()).toEqual([]);
      state.keyUp(code);
      frame();
    });
  });

  it('das Mausrad blättert die Schnellleiste (Rasten eines Frames zusammen)', () => {
    const { state, frame } = chain();
    state.wheel(NOTCH);
    expect(frame()).toEqual([{ type: 'player.scrollHotbar', delta: 1 }]);
    state.wheel(-NOTCH);
    state.wheel(-NOTCH);
    expect(frame()).toEqual([{ type: 'player.scrollHotbar', delta: -2 }]);
    expect(frame()).toEqual([]);
  });

  it('Q benutzt den Gürtel, F schaltet das Licht, die Primärtaste benutzt das Ding in der Hand – je einmal', () => {
    const { state, frame } = chain();
    state.keyDown('KeyQ');
    expect(frame()).toEqual([{ type: 'action.useBelt' }]);
    expect(frame()).toEqual([]);
    state.keyUp('KeyQ');
    state.keyDown('KeyF');
    expect(frame()).toEqual([{ type: 'light.toggle' }]);
    expect(frame()).toEqual([]);
    state.keyUp('KeyF');
    state.mouseButtonDown(0);
    expect(frame()).toEqual([{ type: 'player.useItem' }]);
    expect(frame()).toEqual([]);
    state.mouseButtonUp(0);
    expect(frame()).toEqual([]);
  });

  it('E drückt und lässt los (die Interaktion hält, solange E unten ist)', () => {
    const { state, frame } = chain();
    state.keyDown('KeyE');
    expect(frame()).toEqual([{ type: 'player.interact', on: true }]);
    expect(frame()).toEqual([]);
    state.keyUp('KeyE');
    expect(frame()).toEqual([{ type: 'player.interact', on: false }]);
  });

  it('in Menüs und für den Debug-Mover ohne Spieler: keine dieser Tasten', () => {
    const { state, reader, frame } = chain();
    reader.setContext('ui');
    for (const code of ['Digit3', 'KeyQ', 'KeyF']) state.keyDown(code);
    state.mouseButtonDown(0);
    expect(frame()).toEqual([]);
    const mover = chain();
    for (const code of ['Digit3', 'KeyQ', 'KeyF', 'KeyE']) mover.state.keyDown(code);
    mover.state.mouseButtonDown(0);
    expect(mover.frame('mover')).toEqual([]);
  });
});
