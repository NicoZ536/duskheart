/**
 * M0-16 UI-Schicht: Die Signals-Brücke (src/ui/bridge.ts) liest den Sim-Zustand einmal je Frame
 * (Snapshot + Events) und schreibt ausschließlich Commands; das Theme (src/ui/theme.ts) setzt die
 * Farb-Tokens aus der Master-Palette und wählt die ganzzahlige UI-Skalierung.
 * Browserbeleg: tests/e2e/ui-overlay.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { effect } from '@preact/signals';
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { CommandRecorder } from '../../../src/engine/commands';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import { UI_SCALES } from '../../../src/engine/settings';
import type { GameCommand } from '../../../src/game/commands';
import { BOOT_SESSION_SEED, GameSession, type SessionStatus } from '../../../src/game/session';
import { UI_HEX } from '../../../src/generated/palette';
import { createI18n } from '../../../src/i18n/index';
import { StatusLine } from '../../../src/ui/App';
import { createUiBridge, type UiBridgeSession } from '../../../src/ui/bridge';
import {
  MAX_UI_SCALE,
  MIN_UI_SCALE,
  THEME_VARS,
  UI_SCALE_VAR,
  autoUiScale,
  createTheme,
  resolveUiScale,
  themeColorVar,
  type StyleTarget,
  type UiColorName,
} from '../../../src/ui/theme';

/** Ticks per game minute at the default 24 minute day (60 Hz × 24 · 60 s / 1440 min). */
const TICKS_PER_GAME_MINUTE = 60;
/** The world starts at 06:00. */
const DAWN_MINUTE = 6 * 60;

function newSession(): GameSession {
  return new GameSession({ config: { seed: BOOT_SESSION_SEED } });
}

function stepN(session: GameSession, n: number): void {
  for (let i = 0; i < n; i++) session.step();
}

/** Counts how often `read` notifies (the first run of the effect is not counted). */
function countChanges(read: () => unknown): { readonly count: number; stop(): void } {
  let runs = -1;
  const stop = effect(() => {
    read();
    runs++;
  });
  return {
    get count() {
      return runs;
    },
    stop,
  };
}

describe('Signals-Brücke: lesen', () => {
  it('zeigt den Startzustand sofort und folgt Zustandsänderungen erst mit dem nächsten Frame', () => {
    const session = newSession();
    const bridge = createUiBridge(session);
    const s = bridge.state;
    expect([s.tick.value, s.day.value, s.minuteOfDay.value, s.entities.value, s.controlled.value]).toEqual([0, 1, DAWN_MINUTE, 0, null]);

    session.command({ type: 'spawnDebugMover', x: 400, y: 300, vx: 0, vy: 0, controlled: true });
    session.step();
    // Ticks alone do not touch the signals: the bridge publishes once per rendered frame.
    expect(s.tick.value).toBe(0);
    expect(s.entities.value).toBe(0);

    bridge.frame();
    expect(s.tick.value).toBe(1);
    expect(s.entities.value).toBe(1);
    expect(s.controlled.value).toEqual({ entity: session.debugState().controlled?.entity, x: 400, y: 300 });
  });

  it('meldet jede Änderung höchstens einmal je Frame, egal wie viele Ticks dazwischen liefen', () => {
    const session = newSession();
    const bridge = createUiBridge(session);
    const minute = countChanges(() => bridge.state.minuteOfDay.value);
    const tick = countChanges(() => bridge.state.tick.value);

    stepN(session, TICKS_PER_GAME_MINUTE - 1);
    bridge.frame();
    expect(bridge.state.minuteOfDay.value).toBe(DAWN_MINUTE);
    expect(minute.count).toBe(0);
    expect(tick.count).toBe(1);

    session.step();
    bridge.frame();
    expect(bridge.state.minuteOfDay.value).toBe(DAWN_MINUTE + 1);
    expect(minute.count).toBe(1);
    expect(tick.count).toBe(2);

    // Nothing changed since the last frame: no notification.
    bridge.frame();
    expect(tick.count).toBe(2);
    minute.stop();
    tick.stop();
  });

  it('behält das Positionsobjekt, solange die gesteuerte Entität steht, und meldet null, wenn sie verschwindet', () => {
    const session = newSession();
    const bridge = createUiBridge(session);
    session.command({ type: 'spawnDebugMover', x: 64, y: 64, vx: 0, vy: 0, controlled: true });
    session.step();
    bridge.frame();
    const standing = bridge.state.controlled.value;
    session.step();
    bridge.frame();
    expect(bridge.state.controlled.value).toBe(standing);

    const entity = standing?.entity ?? NULL_ENTITY;
    session.command({ type: 'despawn', entity });
    session.step();
    bridge.frame();
    expect(bridge.state.controlled.value).toBeNull();
    expect(bridge.state.entities.value).toBe(0);
  });

  it('übernimmt abgelehnte Commands aus den Sim-Events und hört nach dispose() auf', () => {
    const session = newSession();
    const bridge = createUiBridge(session);
    bridge.actions.move(0, 1);
    session.step();
    expect(bridge.state.lastRejection.value).toBeNull();
    bridge.frame();
    expect(bridge.state.lastRejection.value).toEqual({ type: 'move', reason: 'noControlledEntity', tick: 0 });

    bridge.dispose();
    bridge.actions.despawn(12345);
    session.step();
    bridge.frame();
    expect(bridge.state.lastRejection.value).toEqual({ type: 'move', reason: 'noControlledEntity', tick: 0 });
    expect(session.debugState().events.commandRejected).toBe(2);
  });
});

describe('Signals-Brücke: schreiben nur über Commands', () => {
  it('eine UI-Aktion legt einen Command in die Queue; der Zustand ändert sich erst im nächsten Tick', () => {
    const session = newSession();
    const recorder = new CommandRecorder<GameCommand>();
    session.sim.commands.setSink(recorder);
    const bridge = createUiBridge(session);
    session.command({ type: 'spawnDebugMover', x: 200, y: 200, vx: 0, vy: 0, controlled: true });
    session.step();
    bridge.frame();
    const before = session.sim.hashState();
    const startX = bridge.state.controlled.value?.x;

    bridge.actions.move(1, 0);
    expect(session.sim.commands.size).toBe(1);
    expect(session.sim.hashState()).toBe(before);
    bridge.frame();
    expect(bridge.state.controlled.value?.x).toBe(startX);

    stepN(session, TICKS_PER_GAME_MINUTE);
    bridge.frame();
    expect(recorder.entries.at(-1)).toEqual({ tick: 1, cmd: { type: 'move', dx: 1, dy: 0 } });
    expect(bridge.state.controlled.value?.x).toBeGreaterThan(startX ?? Number.POSITIVE_INFINITY);
    expect(session.sim.hashState()).not.toBe(before);
  });

  it('arbeitet gegen eine Sitzung ohne Simulation: lesen, abonnieren und Commands einreihen ist alles', () => {
    const queued: unknown[] = [];
    const subscribed: string[] = [];
    const fake: UiBridgeSession = {
      sampleStatus(out: SessionStatus) {
        out.tick = 7;
        out.day = 3;
        out.minuteOfDay = 725;
        out.entities = 2;
        out.controlled = NULL_ENTITY;
        return out;
      },
      onEvent(type) {
        subscribed.push(type);
        return () => undefined;
      },
      command(raw) {
        queued.push(raw);
        return raw as GameCommand;
      },
    };
    const bridge = createUiBridge(fake);
    expect([bridge.state.tick.value, bridge.state.day.value, bridge.state.minuteOfDay.value, bridge.state.entities.value]).toEqual([7, 3, 725, 2]);
    expect(subscribed).toEqual(['commandRejected']);

    bridge.actions.move(3, -2);
    bridge.actions.move(Number.NaN, 0.5);
    bridge.actions.despawn(42);
    expect(queued).toEqual([
      { type: 'move', dx: 1, dy: -1 },
      { type: 'move', dx: 0, dy: 0.5 },
      { type: 'despawn', entity: 42 },
    ]);
  });

  it('die Statuszeile zeigt Tag und Uhrzeit aus den Signalen in DE und EN', () => {
    const session = newSession();
    const bridge = createUiBridge(session);
    stepN(session, TICKS_PER_GAME_MINUTE * 5);
    bridge.frame();
    const text = (lang: 'de' | 'en'): unknown => (StatusLine({ i18n: createI18n(lang, { strict: true }), lang, bridge }) as VNode<{ children?: unknown }>).props.children;
    expect(text('de')).toBe('Tag 1 · 06:05');
    expect(text('en')).toBe('Day 1 · 06:05');
  });
});

/** Style target that records the custom properties written to it. */
function fakeRoot(): StyleTarget & { readonly props: Map<string, string> } {
  const props = new Map<string, string>();
  return { props, style: { setProperty: (name, value) => void props.set(name, value) } };
}

describe('Theme', () => {
  it('wählt die UI-Skalierung automatisch ganzzahlig aus dem Viewport (1–4)', () => {
    const cases: Array<[number, number, number]> = [
      [1280, 720, 2],
      [1920, 1080, 4],
      [1440, 810, 3],
      [1439, 810, 2],
      [800, 600, 1],
      [400, 200, 1],
      [3840, 2160, 4],
      [3440, 1440, 4],
      [2560, 1080, 4],
      [1920, 700, 2],
      [0, 0, 1],
    ];
    for (const [w, h, expected] of cases) expect(autoUiScale(w, h), `${w}×${h}`).toBe(expected);
    expect(MIN_UI_SCALE).toBe(1);
    expect(MAX_UI_SCALE).toBe(4);
  });

  it('eine feste Einstellung schlägt die Automatik', () => {
    for (const setting of UI_SCALES) {
      const expected = setting === 'auto' ? 2 : setting;
      expect(resolveUiScale(setting, 1280, 720), String(setting)).toBe(expected);
    }
    expect(resolveUiScale(1, 3840, 2160)).toBe(1);
  });

  it('setzt Farb-Tokens aus der Palette und hält --dh-ui-scale aktuell', () => {
    const root = fakeRoot();
    const theme = createTheme(root, { setting: 'auto', width: 1280, height: 720 });
    for (const name of Object.keys(UI_HEX) as UiColorName[]) expect(root.props.get(themeColorVar(name)), name).toBe(UI_HEX[name]);
    expect(themeColorVar('rahmenHell')).toBe('--dh-rahmen-hell');
    expect(root.props.get(UI_SCALE_VAR)).toBe('2');

    theme.setViewport(1920, 1080);
    expect(theme.uiScale.value).toBe(4);
    expect(root.props.get(UI_SCALE_VAR)).toBe('4');
    theme.setUiScaleSetting(1);
    expect(root.props.get(UI_SCALE_VAR)).toBe('1');
    theme.setViewport(800, 600);
    expect(root.props.get(UI_SCALE_VAR)).toBe('1');
    theme.setUiScaleSetting('auto');
    expect(root.props.get(UI_SCALE_VAR)).toBe('1');
    theme.setViewport(1440, 900);
    expect(root.props.get(UI_SCALE_VAR)).toBe('3');

    theme.dispose();
    theme.setViewport(1920, 1080);
    expect(root.props.get(UI_SCALE_VAR)).toBe('3');
  });

  it('base.css verweist nur auf Tokens, die das Theme setzt, und definiert keine eigenen Farben', () => {
    const css = readFileSync(join(process.cwd(), 'src/ui/base.css'), 'utf8');
    const used = new Set([...css.matchAll(/var\((--dh-[a-z-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(3);
    for (const name of used) expect(THEME_VARS, name).toContain(name);
    expect(css).not.toMatch(/--dh-[a-z-]+\s*:/);
    // No colour literals in declarations either: every colour comes from the palette tokens.
    const declarations = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\{([^{}]*)\}/g)].map((m) => m[1] ?? '');
    expect(declarations.length).toBeGreaterThan(3);
    for (const body of declarations) expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i);
  });

  it('Browser-Themefarbe und PWA-Manifest nutzen die UI-Farbe „dunkel“ der Palette', () => {
    const colours = (file: string): string[] => [...readFileSync(join(process.cwd(), file), 'utf8').matchAll(/['"](#[0-9a-f]{6})['"]/gi)].map((m) => (m[1] ?? '').toLowerCase());
    expect(colours('index.html')).toEqual([UI_HEX.dunkel]);
    expect(colours('vite.config.ts')).toEqual([UI_HEX.dunkel, UI_HEX.dunkel]);
  });
});
