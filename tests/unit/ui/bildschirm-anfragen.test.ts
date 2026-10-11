/**
 * M7-90 (ADR-0235; MASTERPROMPT §26 "Bildschirme"): the station's, chest's and hearth's screens – like the vision and the
 * travel screen – open only on their simulation event (`stationOpened`, `chestOpened`, `hearthOpened`), through a one-shot
 * request of `createGameScreenControl` (src/ui/focus/gameScreenControl.ts, the DOM-free part of `GameScreens`). Their
 * signals keep the id of the last station, chest and hearth for the screen's key, so E (their opener) pressed anywhere
 * later must not open the screen used last; E only closes them. A tab switch opens only the pause menu.
 */
import { signal } from '@preact/signals';
import { describe, expect, it } from 'vitest';
import type { Action, InputContext } from '../../../src/engine/input/actions';
import type { SimEventMap } from '../../../src/game/sim';
import { GAME_SCREENS } from '../../../src/ui/focus/GameScreens';
import { createGameScreenControl, type GameScreenBridge } from '../../../src/ui/focus/gameScreenControl';
import { FocusManager } from '../../../src/ui/focus/manager';
import { HERD_SCREEN } from '../../../src/ui/screens/herdfeuer/HerdfeuerScreen';
import { REISEN_SCREEN } from '../../../src/ui/screens/reisen/ReisenScreen';
import { VISION_SCREEN } from '../../../src/ui/screens/vision/VisionScreen';

/** Menu input of one frame: `pressed` in the current context, `anyContext` only outside it (E is no menu action in `ui`). */
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

function aufbau() {
  const input = new Eingabe();
  const handlers = new Map<string, Set<Handler>>();
  const bridge: GameScreenBridge = {
    state: { player: { present: signal(true), health: signal(100) }, bags: signal({}) },
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
  const stop = control.connect();
  /** The simulation drained one event (the bridge hands it to the screens after the tick, before the frame's poll). */
  const emit = <K extends keyof SimEventMap>(type: K, payload: Partial<SimEventMap[K]>): void => {
    for (const h of handlers.get(type) ?? []) (h as (p: SimEventMap[K]) => void)(payload as SimEventMap[K]);
  };
  /** One rendered frame: the frame's presses, then the screens' poll. */
  const frame = (pressed: Action[], anyContext: Action[] = []): void => {
    input.frame(pressed, anyContext);
    control.controller.poll();
  };
  return { control, emit, frame, stop, handlers, input, pauses };
}

/** The three screens of M7-90: the event that opens each, its payload for one id, and the signal holding that id. */
const BILDSCHIRME = [
  { id: 'station', ereignis: 'stationOpened', nutzlast: (n: number) => ({ id: n, station: 'werkbank' }), signal: 'station' },
  { id: 'kiste', ereignis: 'chestOpened', nutzlast: (n: number) => ({ chest: n }), signal: 'kiste' },
  { id: HERD_SCREEN, ereignis: 'hearthOpened', nutzlast: (n: number) => ({ hearth: n }), signal: 'herd' },
] as const;

describe('Bildschirme auf Ereignis: Station, Kiste, Herd (M7-90, ADR-0235)', () => {
  for (const b of BILDSCHIRME) {
    it(`${b.id}: E an anderer Stelle öffnet den zuletzt benutzten Bildschirm nicht`, () => {
      const s = aufbau();
      // Frame 1: E at the station/chest/hearth – the tick drains the event, then the frame polls.
      s.input.frame(['interact']);
      s.emit(b.ereignis, b.nutzlast(7) as never);
      s.control.controller.poll();
      expect(s.control.controller.stack.value).toEqual([b.id]);
      expect(s.control[b.signal].value).toBe(7);
      // Frame 2: E again (outside the ui context) closes it.
      s.frame([], ['interact']);
      expect(s.control.controller.stack.value).toEqual([]);
      expect(s.input.context).toBe('play');
      // Frames 3–5: E pressed anywhere else – no event – opens nothing, although the signal still holds the last id.
      for (let i = 0; i < 3; i++) {
        s.frame(['interact']);
        expect(s.control.controller.stack.value).toEqual([]);
        s.frame([]);
      }
      expect(s.control[b.signal].value).toBe(7);
      expect(s.input.context).toBe('play');
      // A new use opens the screen again, for the new id.
      s.input.frame(['interact']);
      s.emit(b.ereignis, b.nutzlast(9) as never);
      s.control.controller.poll();
      expect(s.control.controller.stack.value).toEqual([b.id]);
      expect(s.control[b.signal].value).toBe(9);
      expect(s.pauses).toEqual([]);
    });
  }

  it('ohne Werkstatt- bzw. Herd-Proben öffnet auch das Ereignis nichts (Seiten ohne Spiel)', () => {
    const input = new Eingabe();
    const handlers = new Map<string, Handler>();
    const bridge: GameScreenBridge = {
      state: { player: { present: signal(true), health: signal(100) }, bags: signal({}) },
      input: input as unknown as GameScreenBridge['input'],
      werkstatt: null,
      basis: null,
      leuchtfeuer: null,
      orte: null,
      onEvent(type, handler) {
        handlers.set(type, handler as Handler);
        return () => handlers.delete(type);
      },
    };
    const control = createGameScreenControl({ screens: GAME_SCREENS, bridge, focus: new FocusManager(), hasBuild: false, now: () => 0 });
    control.connect();
    (handlers.get('stationOpened') as (p: Partial<SimEventMap['stationOpened']>) => void)({ id: 1 });
    (handlers.get('chestOpened') as (p: Partial<SimEventMap['chestOpened']>) => void)({ chest: 1 });
    (handlers.get('hearthOpened') as (p: Partial<SimEventMap['hearthOpened']>) => void)({ hearth: 1 });
    expect(control.controller.stack.value).toEqual([]);
  });

  it('Vision und Reisebildschirm: nur auf ihr Ereignis, E schließt die Reise nur; ein Tab-Wechsel öffnet nur das Pausemenü', () => {
    const s = aufbau();
    s.emit('beaconLit', { beacon: 1 });
    expect(s.control.controller.stack.value).toEqual([VISION_SCREEN]);
    expect(s.pauses).toEqual([true]);
    s.control.controller.close(VISION_SCREEN);
    // E at a travel point: the tick drains `travelOpened`, then the frame polls – that press does not close it.
    s.input.frame(['interact']);
    s.emit('travelOpened', {});
    s.control.controller.poll();
    expect(s.control.controller.stack.value).toEqual([REISEN_SCREEN]);
    s.frame([], ['interact']);
    expect(s.control.controller.stack.value).toEqual([]);
    s.frame(['interact']);
    expect(s.control.controller.stack.value).toEqual([]);
    s.control.controller.tabHidden();
    expect(s.control.controller.stack.value).toEqual(['pause']);
  });

  it('connect meldet sich bei allen fünf Ereignissen an und gibt die Anmeldungen wieder frei', () => {
    const s = aufbau();
    const angemeldet = (): number => [...s.handlers.values()].reduce((n, set) => n + set.size, 0);
    expect(angemeldet()).toBe(5);
    s.stop();
    expect(angemeldet()).toBe(0);
    s.emit('stationOpened', { id: 2 });
    expect(s.control.controller.stack.value).toEqual([]);
  });
});
