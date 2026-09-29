/**
 * M4-20 and M4-07/M4-21 in the screen stack (src/ui/focus/screens.ts, src/ui/focus/GameScreens.tsx): the hearth
 * screen is a screen of the game, opened by the simulation's `hearthOpened` after E, with E as its opener. E is
 * read as the opener of the hearth, chest and station screens in the very frame the simulation opened them – that
 * press must not shut them again; a later E (or Esc) closes them as before, and screens the controller opens itself
 * keep their old behaviour.
 */
import { describe, expect, it } from 'vitest';
import type { Action, InputContext } from '../../../src/engine/input/actions';
import { BindingSet } from '../../../src/engine/input/bindings';
import { InputState } from '../../../src/engine/input/state';
import { GAME_SCREENS } from '../../../src/ui/focus/GameScreens';
import { FocusManager } from '../../../src/ui/focus/manager';
import { ScreenController, type ScreenInput } from '../../../src/ui/focus/screens';
import { HERD_SCREEN } from '../../../src/ui/screens/herdfeuer/HerdfeuerScreen';

class FakeInput implements ScreenInput {
  readonly bindings = new BindingSet();
  /** Nothing is held: an opener press is never a navigation press of the same input. */
  readonly state = new InputState();
  context: InputContext = 'play';
  pressed = new Set<Action>();
  anyContext = new Set<Action>();
  wasPressed(a: Action): boolean {
    return this.pressed.has(a);
  }
  wasPressedAnyContext(a: Action): boolean {
    return this.pressed.has(a) || this.anyContext.has(a);
  }
  isDown(): boolean {
    return false;
  }
  setContext(c: InputContext): void {
    this.context = c;
  }
  /** The frame's presses: `pressed` in the current context, `anyContext` only outside it. */
  frame(pressed: Action[], anyContext: Action[] = []): void {
    this.pressed = new Set(pressed);
    this.anyContext = new Set(anyContext);
  }
}

function setup() {
  const input = new FakeInput();
  const controller = new ScreenController({ screens: GAME_SCREENS, focus: new FocusManager(), input, canOpen: () => true, now: () => 0 });
  return { input, controller };
}

describe('Herdfeuer im Bildschirmstapel', () => {
  it('ist ein Bildschirm des Spiels mit E als Öffner, ohne Pause, im Kontext ui', () => {
    const spec = GAME_SCREENS.find((s) => s.id === HERD_SCREEN);
    expect(spec).toMatchObject({ opener: 'interact', pauses: false });
    expect(spec?.context).toBeUndefined();
  });

  for (const id of [HERD_SCREEN, 'kiste', 'station']) {
    it(`E, das ${id} im selben Frame geöffnet hat, schließt es nicht wieder; ein späteres E schon`, () => {
      const { input, controller } = setup();
      // Frame 1: E pressed in play (the interaction sends the use); the tick opens the screen before the poll.
      input.frame(['interact']);
      expect(controller.open(id)).toBe(true);
      expect(input.context).toBe('ui');
      controller.poll();
      expect(controller.top()).toBe(id);
      // Frame 2: nothing pressed.
      input.frame([]);
      controller.poll();
      expect(controller.top()).toBe(id);
      // Frame 3: E again (only outside the ui context: it is no menu action there) closes it.
      input.frame([], ['interact']);
      controller.poll();
      expect(controller.top()).toBeNull();
      expect(input.context).toBe('play');
    });
  }

  it('ein Bildschirm, den die Abfrage selbst öffnet, schließt beim nächsten Druck seines Öffners wie bisher', () => {
    const { input, controller } = setup();
    input.frame(['inventory']);
    controller.poll();
    expect(controller.top()).toBe('inventar');
    input.frame([], ['inventory']);
    controller.poll();
    expect(controller.top()).toBeNull();
  });

  it('das Frische-Merkmal gilt nur bis zur nächsten Abfrage', () => {
    const { input, controller } = setup();
    input.frame([]);
    controller.open(HERD_SCREEN);
    controller.poll();
    input.frame([], ['interact']);
    controller.poll();
    expect(controller.top()).toBeNull();
  });
});
