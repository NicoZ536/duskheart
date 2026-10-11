/**
 * The tablet screen (M7-46, strand C; docs/SPIEL.md §19 "Erbauer-Tafeln", §30 "`tafel` (Tafel lesen) – Öffner `tabletRead`"):
 * its model shows a Builder tablet in the player's language – its number of the sixty, its title, its text one sentence a line,
 * where such tablets lie (a vault: none, a place: the place type's name); the screen opens only on `tabletRead` – E alone, the
 * opener it shares with the other screens of E, opens nothing –, pauses the game, keeps the last tablet for its key and closes
 * on its opener read outside the menu context (in the browser Esc and its button close it: tests/e2e/gewoelbe.spec.ts).
 */
import { signal } from '@preact/signals';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import type { Action, InputContext } from '../../../src/engine/input/actions';
import type { SimEventMap } from '../../../src/game/sim';
import { GAME_SCREENS } from '../../../src/ui/focus/GameScreens';
import { createGameScreenControl, type GameScreenBridge } from '../../../src/ui/focus/gameScreenControl';
import { FocusManager } from '../../../src/ui/focus/manager';
import { tafelSeite, tafelZeilen, TABLETS_TOTAL } from '../../../src/ui/screens/tafel/modell';
import { TAFEL_SCREEN } from '../../../src/ui/screens/tafel/TafelScreen';

describe('the tablet model', () => {
  it('cuts a text after each sentence; nothing empty, nothing lost', () => {
    expect(tafelZeilen('Wir fanden das Urfeuer. Es brannte ohne Ende!  Wer es sah …  vergaß? Ja')).toEqual(['Wir fanden das Urfeuer.', 'Es brannte ohne Ende!', 'Wer es sah …', 'vergaß?', 'Ja']);
    expect(tafelZeilen('')).toEqual([]);
    expect(tafelZeilen('Kein Punkt')).toEqual(['Kein Punkt']);
  });

  it('a page per tablet in both languages: number, title, the lines joined give the text; a vault tablet names no place', () => {
    expect(TABLETS_TOTAL).toBe(60);
    for (const t of CONTENT.collection('tablets').values()) {
      for (const lang of ['de', 'en'] as const) {
        const page = tafelSeite(t.id, lang);
        expect(page, `${t.id} ${lang}`).not.toBeNull();
        expect(page?.nummer).toBe(t.nummer);
        expect(page?.titel).toBe(t.titel[lang]);
        expect(page?.zeilen.join(' ')).toBe(t.text[lang].replace(/\s+/gu, ' ').trim());
        expect(page?.zeilen.length, `${t.id} ${lang}`).toBeGreaterThanOrEqual(2);
        if (t.fundort.art === 'gewoelbe') expect(page?.ort).toBeNull();
        else expect(page?.ort).toBe(CONTENT.collection('locationTypes').get(t.fundort.ortstyp).name[lang]);
      }
    }
    expect(tafelSeite('tafel_01', 'de')).toEqual(expect.objectContaining({ id: 'tafel_01', nummer: 1, titel: 'Die erste Flamme', ort: null }));
    expect(tafelSeite('tafel_08', 'en')?.ort).toBe(CONTENT.collection('locationTypes').get('friedhof').name.en);
    expect(tafelSeite('tafel_99', 'de')).toBeNull();
  });
});

/** Menu input of one frame (as in bildschirm-anfragen.test.ts): `pressed` in the current context, `anyContext` only outside it. */
class Eingabe {
  context: InputContext = 'play';
  private pressed = new Set<Action>();
  private anyContext = new Set<Action>();
  wasPressed(a: Action): boolean {
    return this.pressed.has(a);
  }
  wasPressedAnyContext(a: Action): boolean {
    return this.pressed.has(a) || this.anyContext.has(a);
  }
  isDown(): boolean {
    return false;
  }
  pressedTogether(): boolean {
    return false;
  }
  setContext(c: InputContext): void {
    this.context = c;
  }
  promptBinding(): null {
    return null;
  }
  gamepadFamily(): 'xbox' {
    return 'xbox';
  }
  lastDevice(): 'keyboard' {
    return 'keyboard';
  }
  frame(pressed: Action[], anyContext: Action[] = []): void {
    this.pressed = new Set(pressed);
    this.anyContext = new Set(anyContext);
  }
}

type Handler = (payload: never) => void;

describe('the tablet screen opens on tabletRead (one-shot request)', () => {
  function aufbau(present = true) {
    const input = new Eingabe();
    const handlers = new Map<string, Set<Handler>>();
    const bridge: GameScreenBridge = {
      state: { player: { present: signal(present), health: signal(100) }, bags: signal({}) },
      input: input as unknown as GameScreenBridge['input'],
      werkstatt: {},
      basis: {},
      leuchtfeuer: {},
      orte: null,
      onEvent(type, handler) {
        const set = handlers.get(type) ?? new Set<Handler>();
        handlers.set(type, set);
        set.add(handler as Handler);
        return () => set.delete(handler as Handler);
      },
    };
    const pauses: boolean[] = [];
    const control = createGameScreenControl({ screens: GAME_SCREENS, bridge, focus: new FocusManager(), setPaused: (p) => pauses.push(p), hasBuild: true, now: () => 0 });
    const stop = control.connectTafel();
    const emit = (payload: SimEventMap['tabletRead']): void => {
      for (const h of handlers.get('tabletRead') ?? []) (h as (p: SimEventMap['tabletRead']) => void)(payload);
    };
    return { control, input, pauses, emit, stop, handlers };
  }

  it('E at a tablet opens it, pausing; its opener closes it; E elsewhere opens nothing; the next tablet opens with its id', () => {
    const s = aufbau();
    // E anywhere before any tablet: nothing.
    s.input.frame(['interact']);
    s.control.controller.poll();
    expect(s.control.controller.stack.value).toEqual([]);
    // E at a tablet: the tick drains `tabletRead`, the frame polls.
    s.input.frame(['interact']);
    s.emit({ tablet: 'tafel_03', quelle: 'gewoelbe', ort: 7, tick: 100 });
    s.control.controller.poll();
    expect(s.control.controller.stack.value).toEqual([TAFEL_SCREEN]);
    expect(s.control.tafel.value).toBe('tafel_03');
    expect(s.pauses).toEqual([true]);
    // E again (outside the ui context) closes it, unpausing.
    s.input.frame([], ['interact']);
    s.control.controller.poll();
    expect(s.control.controller.stack.value).toEqual([]);
    expect(s.pauses).toEqual([true, false]);
    // E elsewhere: the signal keeps the last tablet, the screen stays shut.
    for (let i = 0; i < 3; i++) {
      s.input.frame(['interact']);
      s.control.controller.poll();
      expect(s.control.controller.stack.value).toEqual([]);
      s.input.frame([]);
      s.control.controller.poll();
    }
    expect(s.control.tafel.value).toBe('tafel_03');
    s.emit({ tablet: 'tafel_08', quelle: 'ort', ort: 2, tick: 400 });
    s.control.controller.poll();
    expect(s.control.controller.stack.value).toEqual([TAFEL_SCREEN]);
    expect(s.control.tafel.value).toBe('tafel_08');
    // Stopped listening: a tablet read no longer opens the screen.
    s.input.frame([], ['interact']);
    s.control.controller.poll();
    s.stop();
    expect(s.handlers.get('tabletRead')?.size ?? 0).toBe(0);
  });

  it('without a player (title, debug worlds) the event opens nothing', () => {
    const s = aufbau(false);
    s.emit({ tablet: 'tafel_01', quelle: 'gewoelbe', ort: 0, tick: 1 });
    s.control.controller.poll();
    expect(s.control.controller.stack.value).toEqual([]);
    expect(s.pauses).toEqual([]);
  });
});
