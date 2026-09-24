/**
 * M3-30/M3-31: screen stack of the game (src/ui/focus/screens.ts) – openers (Tab/I, Esc), input
 * context ui/play, pause only for the pause menu, closing with the opener (not when the same input
 * navigates, D-pad up), back through the screen's scope, automatic pause on tab switch, the
 * inventory only with a player, hotbar keys and key repeat.
 */
import { describe, expect, it } from 'vitest';
import type { Action, InputContext } from '../../../src/engine/input/actions';
import { GAME_SCREENS } from '../../../src/ui/focus/GameScreens';
import { FocusManager, type FocusElement, type FocusRoot, type NavAction } from '../../../src/ui/focus/manager';
import { REPEAT_DELAY_MS, REPEAT_INTERVAL_MS, ScreenController, type ScreenInput } from '../../../src/ui/focus/screens';

/** Input of one frame: pressed (edge) and held actions; `anyContext` also reports actions inactive in the context. */
class FakeInput implements ScreenInput {
  context: InputContext = 'play';
  pressed = new Set<Action>();
  anyContext = new Set<Action>();
  held = new Set<Action>();
  readonly contexts: InputContext[] = [];
  wasPressed(a: Action): boolean {
    return this.pressed.has(a);
  }
  wasPressedAnyContext(a: Action): boolean {
    return this.pressed.has(a) || this.anyContext.has(a);
  }
  isDown(a: Action): boolean {
    return this.held.has(a);
  }
  setContext(c: InputContext): void {
    this.context = c;
    this.contexts.push(c);
  }
  frame(pressed: Action[], anyContext: Action[] = [], held: Action[] = []): void {
    this.pressed = new Set(pressed);
    this.anyContext = new Set(anyContext);
    this.held = new Set(held);
  }
}

const EMPTY_ROOT: FocusRoot = { querySelectorAll: () => [], contains: () => false };

function setup(player = true, running = true) {
  const input = new FakeInput();
  const focus = new FocusManager();
  const pauses: boolean[] = [];
  let now = 0;
  const controller = new ScreenController({
    screens: GAME_SCREENS,
    focus,
    input,
    setPaused: (p) => pauses.push(p),
    canOpen: (id) => id !== 'inventar' || player,
    autoPause: () => running,
    now: () => now,
  });
  return {
    input,
    focus,
    controller,
    pauses,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('Bildschirmstapel', () => {
  it('Tab öffnet das Inventar (Kontext ui, keine Pause) und schließt es wieder (Kontext play)', () => {
    const s = setup();
    s.input.frame(['inventory']);
    s.controller.poll();
    expect(s.controller.stack.value).toEqual(['inventar']);
    expect(s.input.context).toBe('ui');
    expect(s.pauses).toEqual([]);
    expect(s.focus.keys.value).toBe(true);
    // In the ui context the inventory action is only seen "in any context".
    s.input.frame([], ['inventory']);
    s.controller.poll();
    expect(s.controller.stack.value).toEqual([]);
    expect(s.input.context).toBe('play');
  });

  it('D-Pad oben öffnet das Inventar, schließt es aber nicht (es navigiert dort nach oben)', () => {
    const s = setup();
    s.input.frame(['inventory']);
    s.controller.poll();
    s.input.frame(['uiUp'], ['inventory']);
    s.controller.poll();
    expect(s.controller.stack.value).toEqual(['inventar']);
  });

  it('Esc öffnet das Pausemenü (pausiert), Zurück ohne eigenen Bereich schließt es (setzt fort)', () => {
    const s = setup();
    s.input.frame(['pause']);
    s.controller.poll();
    expect(s.controller.stack.value).toEqual(['pause']);
    expect(s.pauses).toEqual([true]);
    s.input.frame(['uiBack'], ['pause']);
    s.controller.poll();
    expect(s.controller.stack.value).toEqual([]);
    expect(s.pauses).toEqual([true, false]);
  });

  it('Zurück geht an den Fokusbereich des Bildschirms (Unteransicht statt Schließen)', () => {
    const s = setup();
    s.controller.open('pause');
    let back = 0;
    s.focus.push({ root: EMPTY_ROOT, onBack: () => back++ });
    s.input.frame(['uiBack']);
    s.controller.poll();
    expect(back).toBe(1);
    expect(s.controller.stack.value).toEqual(['pause']);
  });

  it('Tab-Wechsel öffnet das Pausemenü über dem Inventar; Schließen kehrt zum Inventar zurück', () => {
    const s = setup();
    s.controller.open('inventar');
    s.controller.tabHidden();
    expect(s.controller.stack.value).toEqual(['inventar', 'pause']);
    expect(s.pauses).toEqual([true]);
    s.controller.tabHidden();
    expect(s.controller.stack.value).toEqual(['inventar', 'pause']);
    s.controller.close('pause');
    expect(s.controller.stack.value).toEqual(['inventar']);
    expect(s.pauses).toEqual([true, false]);
    expect(s.input.context).toBe('ui');
    s.controller.closeAll();
    expect(s.input.context).toBe('play');
  });

  it('ohne laufendes Spiel öffnet ein Tab-Wechsel kein Menü (die Schleife ruht dann von selbst)', () => {
    const s = setup(false, false);
    s.controller.tabHidden();
    expect(s.controller.stack.value).toEqual([]);
    expect(s.pauses).toEqual([]);
  });

  it('ohne Spieler öffnet das Inventar nicht, das Pausemenü schon', () => {
    const s = setup(false);
    s.input.frame(['inventory']);
    s.controller.poll();
    expect(s.controller.stack.value).toEqual([]);
    expect(s.controller.open('pause')).toBe(true);
    expect(s.controller.open('unbekannt')).toBe(false);
  });

  it('Menüaktionen gehen an den Fokus: Richtungen, Bestätigen, Weiter/Zurück-Reiter, Schnellleisten-Tasten mit Index', () => {
    const s = setup();
    s.controller.open('inventar');
    const seen: string[] = [];
    s.focus.push({
      root: EMPTY_ROOT,
      onAction: (a: NavAction, _f: FocusElement | null, i: number) => {
        seen.push(a === 'hotbar' ? `hotbar${i}` : a);
        return true;
      },
    });
    s.input.frame(['uiDown', 'uiConfirm', 'uiTabNext', 'uiTabPrev', 'hotbar3', 'hotbar10']);
    s.controller.poll();
    expect(seen).toEqual(['down', 'confirm', 'next', 'prev', 'hotbar2', 'hotbar9']);
  });

  it('eine gehaltene Richtung wiederholt sich nach der Verzögerung im festen Takt', () => {
    const s = setup();
    s.controller.open('pause');
    const seen: string[] = [];
    s.focus.push({ root: EMPTY_ROOT, onAction: (a) => (seen.push(a), true) });
    s.input.frame(['uiDown'], [], ['uiDown']);
    s.controller.poll();
    expect(seen).toEqual(['down']);
    s.input.frame([], [], ['uiDown']);
    s.advance(REPEAT_DELAY_MS - 1);
    s.controller.poll();
    expect(seen).toHaveLength(1);
    s.advance(1);
    s.controller.poll();
    expect(seen).toHaveLength(2);
    s.advance(REPEAT_INTERVAL_MS);
    s.controller.poll();
    expect(seen).toHaveLength(3);
    s.input.frame([], [], []);
    s.advance(REPEAT_INTERVAL_MS);
    s.controller.poll();
    expect(seen).toHaveLength(3);
  });
});
