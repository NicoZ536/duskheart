/**
 * M7-99 Ein Esc schließt jeden pausierenden Bildschirm (MASTERPROMPT §26 „Esc/B: zurück“; ADR-0247): der Fokusbereich eines
 * Bildschirms (`focusScopeOf`, src/ui/focus/useFocusScope.ts) übernimmt `back` nur, wenn der Bildschirm ein `onBack` nennt –
 * sonst schließt der Bildschirmstapel den obersten Bildschirm. Früher trug jeder Bereich ein `onBack`, das nichts tat: Esc
 * verpuffte auf der Karte, der Vision und dem Reisebildschirm.
 *
 * - ohne `onBack`: `back` gilt als nicht behandelt, ein Esc schließt jeden Bildschirm des Spiels – die pausierenden (Pause,
 *   Vision, Perk-Wahl, Tafel) heben die Pause auf, und das Pause-Menü öffnet nicht im selben Bild;
 * - mit `onBack`: der Bildschirm entscheidet (die Vision zählt als gesehen, ein Dialog schließt vor seinem Bildschirm);
 * - die Handler werden bei jeder Aktion gelesen: ein `onBack`, das später dazukommt oder wegfällt, gilt sofort.
 */
import { describe, expect, it } from 'vitest';
import type { Action, InputContext } from '../../../src/engine/input/actions';
import { GAME_SCREENS } from '../../../src/ui/focus/GameScreens';
import { FocusManager, type FocusRoot } from '../../../src/ui/focus/manager';
import { ScreenController, type ScreenInput } from '../../../src/ui/focus/screens';
import { focusScopeOf, type FocusScopeHandlers } from '../../../src/ui/focus/useFocusScope';
import { KARTE_SCREEN } from '../../../src/ui/screens/karte/KarteScreen';
import { REISEN_SCREEN } from '../../../src/ui/screens/reisen/ReisenScreen';
import { VISION_SCREEN } from '../../../src/ui/screens/vision/VisionScreen';

/** Menu input of one frame: the actions that went down. */
class FrameInput implements ScreenInput {
  context: InputContext = 'play';
  private pressed = new Set<Action>();
  wasPressed(a: Action): boolean {
    return this.pressed.has(a);
  }
  wasPressedAnyContext(a: Action): boolean {
    return this.pressed.has(a);
  }
  isDown(): boolean {
    return false;
  }
  pressedTogether(a: Action, b: Action): boolean {
    // Esc is `pause` and `uiBack` through one key.
    return this.pressed.has(a) && this.pressed.has(b) && ((a === 'pause' && b === 'uiBack') || (a === 'uiBack' && b === 'pause'));
  }
  setContext(c: InputContext): void {
    this.context = c;
  }
  frame(...pressed: Action[]): void {
    this.pressed = new Set(pressed);
  }
}

const ROOT: FocusRoot = { querySelectorAll: () => [], contains: () => false };

/** Esc in a frame: in the context `ui` it is `uiBack` (and the pause opener in any context). */
const ESC: readonly Action[] = ['uiBack', 'pause'];

function setup() {
  const input = new FrameInput();
  const focus = new FocusManager();
  const pauses: boolean[] = [];
  const controller = new ScreenController({ screens: GAME_SCREENS, focus, input, setPaused: (p) => pauses.push(p) });
  return { input, focus, controller, pauses };
}

describe('M7-99 Esc schließt den obersten Bildschirm', () => {
  it('ein Bereich ohne `onBack` behandelt `back` nicht; mit `onBack` ruft er es auf', () => {
    const focus = new FocusManager();
    const without: { current: FocusScopeHandlers } = { current: {} };
    const pop = focus.push(focusScopeOf(ROOT, without));
    expect(focus.top()?.onBack).toBeUndefined();
    expect(focus.handle('back')).toBe(false);
    pop();
    let backs = 0;
    focus.push(focusScopeOf(ROOT, { current: { onBack: () => backs++ } }));
    expect(focus.handle('back')).toBe(true);
    expect(backs).toBe(1);
  });

  it('die Handler gelten bei jeder Aktion: ein `onBack`, das dazukommt oder wegfällt, gilt sofort', () => {
    const focus = new FocusManager();
    const latest: { current: FocusScopeHandlers } = { current: {} };
    focus.push(focusScopeOf(ROOT, latest));
    expect(focus.handle('back')).toBe(false);
    let backs = 0;
    latest.current = { onBack: () => backs++ };
    expect(focus.handle('back')).toBe(true);
    expect(backs).toBe(1);
    latest.current = {};
    expect(focus.handle('back')).toBe(false);
    expect(backs).toBe(1);
  });

  it('jeder pausierende Bildschirm ohne eigenes `onBack` schließt mit einem Esc, die Pause endet, das Pause-Menü bleibt zu', () => {
    const pausing = GAME_SCREENS.filter((s) => s.pauses).map((s) => s.id);
    expect(pausing.sort()).toEqual(['pause', 'perkwahl', 'tafel', 'vision']);
    for (const id of pausing) {
      const s = setup();
      expect(s.controller.open(id), id).toBe(true);
      const pop = s.focus.push(focusScopeOf(ROOT, { current: {} }));
      expect(s.pauses, id).toEqual([true]);
      s.input.frame(...ESC);
      s.controller.poll();
      pop();
      expect(s.controller.stack.value, id).toEqual([]);
      expect(s.pauses, id).toEqual([true, false]);
      expect(s.input.context, id).toBe('play');
      // The next frame without a key: nothing opens.
      s.input.frame();
      s.controller.poll();
      expect(s.controller.stack.value, id).toEqual([]);
    }
  });

  it('die Karte und der Reisebildschirm (ohne `onBack` geschrieben) schließen mit einem Esc', () => {
    for (const id of [KARTE_SCREEN, REISEN_SCREEN]) {
      const s = setup();
      s.controller.open(id);
      s.focus.push(focusScopeOf(ROOT, { current: {} }));
      s.input.frame(...ESC);
      s.controller.poll();
      expect(s.controller.stack.value, id).toEqual([]);
    }
  });

  it('mit `onBack` entscheidet der Bildschirm: die Vision endet wie mit ihrem letzten Knopf (gesehen, geschlossen)', () => {
    const s = setup();
    s.controller.open(VISION_SCREEN);
    const seen: string[] = [];
    s.focus.push(
      focusScopeOf(ROOT, {
        current: {
          onBack: () => {
            seen.push('gesehen');
            s.controller.close(VISION_SCREEN);
          },
        },
      }),
    );
    s.input.frame(...ESC);
    s.controller.poll();
    expect(seen).toEqual(['gesehen']);
    expect(s.controller.stack.value).toEqual([]);
    expect(s.pauses).toEqual([true, false]);
  });

  it('ein Dialog mit `onBack` schließt vor seinem Bildschirm; danach schließt das nächste Esc den Bildschirm', () => {
    const s = setup();
    s.controller.open(KARTE_SCREEN);
    s.focus.push(focusScopeOf(ROOT, { current: {} }));
    let dialogOpen = true;
    const popDialog = s.focus.push(
      focusScopeOf(ROOT, {
        current: {
          onBack: () => {
            dialogOpen = false;
            popDialog();
          },
        },
      }),
    );
    s.input.frame(...ESC);
    s.controller.poll();
    expect(dialogOpen).toBe(false);
    expect(s.controller.stack.value).toEqual([KARTE_SCREEN]);
    s.input.frame(...ESC);
    s.controller.poll();
    expect(s.controller.stack.value).toEqual([]);
  });
});
