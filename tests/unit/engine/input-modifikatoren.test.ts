/**
 * Chords tapped between two frames (M4-23 "Rückgängig innerhalb von 10 s (Strg+Z)", MASTERPROMPT §26 "Alles
 * umbelegbar"): the modifiers of a chord count as they were when its key went down, not only when the frame reads
 * the input. A quick Ctrl+Z – Ctrl down, Z down, Z up, Ctrl up before the next frame – is one undo; so is a chord
 * whose modifier the page only knows from the key event's flags (pressed before the page had the focus).
 */
import { describe, expect, it } from 'vitest';
import { BindingSet, key } from '../../../src/engine/input/bindings';
import { attachDomInput, type DomEventSource } from '../../../src/engine/input/dom';
import { ActionReader } from '../../../src/engine/input/reader';
import { InputState } from '../../../src/engine/input/state';

function setup(): { state: InputState; reader: ActionReader } {
  const state = new InputState();
  const reader = new ActionReader(state, new BindingSet());
  reader.setContext('build');
  return { state, reader };
}

/** One frame: evaluate, then clear the edges (the session's `beginFrame`). */
function frame(state: InputState, reader: ActionReader): void {
  reader.update();
  state.endFrame();
}

class FakeWindow implements DomEventSource {
  readonly listeners = new Map<string, Array<(e: Event) => void>>();
  style = { touchAction: 'auto' };
  addEventListener(type: string, l: (e: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }
  removeEventListener(type: string, l: (e: Event) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((x) => x !== l),
    );
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 640, height: 360 };
  }
  key(type: 'keydown' | 'keyup', code: string, flags: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}): void {
    const ev = { code, repeat: false, ctrlKey: flags.ctrlKey ?? false, metaKey: flags.metaKey ?? false, shiftKey: flags.shiftKey ?? false, altKey: flags.altKey ?? false, target: null, preventDefault: () => undefined };
    for (const l of this.listeners.get(type) ?? []) l(ev as unknown as Event);
  }
}

describe('Tastenkürzel zwischen zwei Frames', () => {
  it('ein schnell getipptes Strg+Z (beides losgelassen, bevor der Frame liest) ist ein Rückgängig', () => {
    const { state, reader } = setup();
    state.keyDown('ControlLeft');
    state.keyDown('KeyZ');
    state.keyUp('KeyZ');
    state.keyUp('ControlLeft');
    reader.update();
    expect(reader.wasPressed('undo')).toBe(true);
    // The tap is over within the frame: not held, released.
    expect(reader.isDown('undo')).toBe(false);
    expect(reader.wasReleased('undo')).toBe(true);
    state.endFrame();
    // The next frame knows nothing of it any more.
    frame(state, reader);
    expect(reader.wasPressed('undo')).toBe(false);
  });

  it('Strg nur noch beim Lesen gedrückt, Z schon los: zählt ebenfalls (wie bisher)', () => {
    const { state, reader } = setup();
    state.keyDown('ControlLeft');
    state.keyDown('KeyZ');
    state.keyUp('KeyZ');
    reader.update();
    expect(reader.wasPressed('undo')).toBe(true);
  });

  it('Z allein ist kein Rückgängig – auch nicht, wenn Strg erst nach dem Loslassen von Z kommt', () => {
    const { state, reader } = setup();
    state.keyDown('KeyZ');
    state.keyUp('KeyZ');
    state.keyDown('ControlLeft');
    state.keyUp('ControlLeft');
    reader.update();
    expect(reader.wasPressed('undo')).toBe(false);
    state.endFrame();
    // A plain Z in the frame after a chord frame is no chord either: the recorded modifiers were cleared.
    state.keyDown('ControlLeft');
    state.keyDown('KeyZ');
    state.keyUp('KeyZ');
    state.keyUp('ControlLeft');
    frame(state, reader);
    state.keyDown('KeyZ');
    reader.update();
    expect(reader.wasPressed('undo')).toBe(false);
  });

  it('gehaltenes Strg+Z bleibt gehalten, solange beide unten sind, und endet mit Strg', () => {
    const { state, reader } = setup();
    state.keyDown('ControlLeft');
    state.keyDown('KeyZ');
    frame(state, reader);
    expect(reader.isDown('undo')).toBe(true);
    reader.update();
    expect(reader.wasPressed('undo')).toBe(false);
    state.keyUp('ControlLeft');
    reader.update();
    expect(reader.isDown('undo')).toBe(false);
  });

  it('Umschalt- und Alt-Akkorde merken ihre Modifikatoren ebenso (umbelegte Tasten)', () => {
    const state = new InputState();
    const bindings = new BindingSet();
    bindings.set('undo', [key('KeyU', { shift: true, alt: true })]);
    const reader = new ActionReader(state, bindings, { context: 'build' });
    state.keyDown('ShiftLeft');
    state.keyDown('AltLeft');
    state.keyDown('KeyU');
    state.keyUp('KeyU');
    state.keyUp('AltLeft');
    state.keyUp('ShiftLeft');
    reader.update();
    expect(reader.wasPressed('undo')).toBe(true);
    state.endFrame();
    // Only Shift of Shift+Alt: no chord.
    state.keyDown('ShiftLeft');
    state.keyDown('KeyU');
    state.keyUp('KeyU');
    state.keyUp('ShiftLeft');
    reader.update();
    expect(reader.wasPressed('undo')).toBe(false);
  });

  it('der DOM-Adapter gibt die Modifikator-Flags des Ereignisses mit (Strg vor dem Fokus gedrückt, Cmd auf dem Mac)', () => {
    const win = new FakeWindow();
    const state = new InputState();
    const reader = new ActionReader(state, new BindingSet(), { context: 'build' });
    const detach = attachDomInput(win, state, { windowTarget: win });
    // No keydown of Ctrl reached the page; the Z event says Ctrl is held.
    win.key('keydown', 'KeyZ', { ctrlKey: true });
    win.key('keyup', 'KeyZ', { ctrlKey: true });
    reader.update();
    expect(reader.wasPressed('undo')).toBe(true);
    state.endFrame();
    // Cmd+Z (Meta) counts as Ctrl+Z.
    win.key('keydown', 'KeyZ', { metaKey: true });
    win.key('keyup', 'KeyZ', { metaKey: true });
    reader.update();
    expect(reader.wasPressed('undo')).toBe(true);
    state.endFrame();
    // Without flags and without Ctrl: plain Z.
    win.key('keydown', 'KeyZ');
    win.key('keyup', 'KeyZ');
    reader.update();
    expect(reader.wasPressed('undo')).toBe(false);
    detach();
  });
});
