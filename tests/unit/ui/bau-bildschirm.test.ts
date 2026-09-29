/**
 * M4-22 (MASTERPROMPT §16.6 "Baumodus (B)", §26 "B Bauen"): the build mode is a screen of the stack that lies over
 * the world in input context `build` – walking and placing stay, the simulation keeps running, the HUD stays –;
 * B (its opener) or Esc leave it; the pause menu opens over it (tab switch) and returns to it.
 */
import { describe, expect, it } from 'vitest';
import type { Action, InputContext } from '../../../src/engine/input/actions';
import { BindingSet } from '../../../src/engine/input/bindings';
import { InputState } from '../../../src/engine/input/state';
import { GAME_SCREENS } from '../../../src/ui/focus/GameScreens';
import { FocusManager } from '../../../src/ui/focus/manager';
import { ScreenController, type ScreenInput } from '../../../src/ui/focus/screens';
import { BAU_SCREEN } from '../../../src/ui/screens/bau/BauModus';

class Eingabe implements ScreenInput {
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
  frame(pressed: Action[], anyContext: Action[] = []): void {
    this.pressed = new Set(pressed);
    this.anyContext = new Set(anyContext);
  }
}

function aufbau(spieler = true) {
  const input = new Eingabe();
  const pauses: boolean[] = [];
  const controller = new ScreenController({
    screens: GAME_SCREENS,
    focus: new FocusManager(),
    input,
    setPaused: (p) => pauses.push(p),
    canOpen: (id) => id !== BAU_SCREEN || spieler,
    autoPause: () => true,
    now: () => 0,
  });
  return { input, pauses, controller };
}

describe('Baumodus im Bildschirmstapel (M4-22)', () => {
  it('B öffnet den Baumodus im Kontext build, ohne Pause, und der HUD bleibt; B schließt ihn wieder', () => {
    const { input, pauses, controller } = aufbau();
    expect(GAME_SCREENS.find((s) => s.id === BAU_SCREEN)).toMatchObject({ opener: 'build', pauses: false, context: 'build' });
    input.frame(['build']);
    controller.poll();
    expect(controller.stack.value).toEqual([BAU_SCREEN]);
    expect(input.context).toBe('build');
    expect(pauses).toEqual([]);
    expect(controller.coversHud()).toBe(false);
    input.frame(['build']);
    controller.poll();
    expect(controller.stack.value).toEqual([]);
    expect(input.context).toBe('play');
  });

  it('Esc verlässt den Baumodus (und öffnet nicht im selben Druck das Pausemenü)', () => {
    const { input, pauses, controller } = aufbau();
    controller.open(BAU_SCREEN);
    input.frame(['pause']);
    controller.poll();
    expect(controller.stack.value).toEqual([]);
    expect(pauses).toEqual([]);
    expect(input.context).toBe('play');
    input.frame([]);
    controller.poll();
    expect(controller.stack.value).toEqual([]);
  });

  it('ein Tab-Wechsel legt das Pausemenü darüber (Kontext ui, HUD verdeckt); Schließen kehrt in den Baumodus zurück', () => {
    const { input, pauses, controller } = aufbau();
    controller.open(BAU_SCREEN);
    controller.tabHidden();
    expect(controller.stack.value).toEqual([BAU_SCREEN, 'pause']);
    expect(input.context).toBe('ui');
    expect(pauses).toEqual([true]);
    expect(controller.coversHud()).toBe(true);
    controller.close('pause');
    expect(controller.stack.value).toEqual([BAU_SCREEN]);
    expect(input.context).toBe('build');
    expect(pauses).toEqual([true, false]);
    expect(controller.coversHud()).toBe(false);
  });

  it('ohne lebende Spielfigur öffnet er nicht', () => {
    const { input, controller } = aufbau(false);
    input.frame(['build']);
    controller.poll();
    expect(controller.stack.value).toEqual([]);
    expect(input.context).toBe('play');
  });
});
