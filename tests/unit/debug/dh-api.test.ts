/**
 * M0-10 `window.__dh`: only with `?debug=1` or developer mode; reads state, executes game commands,
 * runs console lines, freezes the simulation time (a real FixedStepLoop driving a real game session),
 * sets the speed, screenshot mode, pixel probe, extensions.
 */
import { describe, expect, it } from 'vitest';
import {
  DEBUG_FREEZE_REASON,
  MAX_DEBUG_SPEED,
  installDebugApi,
  installDebugApiIfEnabled,
  isDebugEnabled,
  loopTimeControl,
  type DebugApi,
  type DebugApiDeps,
  type DebugApiHost,
  type DebugExtension,
} from '../../../src/debug/api';
import { createDebugConsole } from '../../../src/debug/console';
import { emptyDebugStats } from '../../../src/debug/stats';
import { FixedStepLoop, MAX_TIME_SCALE } from '../../../src/engine/loop';
import { GameSession } from '../../../src/game/session';
import { createI18n } from '../../../src/i18n/index';

/** Frame length of a 60 Hz display in milliseconds. */
const FRAME_MS = 1000 / 60;

function baseDeps(overrides: Partial<DebugApiDeps> = {}): DebugApiDeps {
  const con = createDebugConsole({ t: createI18n('en').t });
  con.register('echo', [{ name: 'text', type: 'string', rest: true }], ({ text }) => text, 'debug.console.help.help');
  return {
    version: '0.1.0',
    getState: () => ({ tick: 42 }),
    exec: (line) => con.exec(line),
    command: (raw) => raw,
    readPixel: () => Promise.resolve([1, 2, 3, 255] as const),
    freezeTime: () => undefined,
    setSpeed: () => undefined,
    setScreenshotMode: () => undefined,
    getStats: () => ({ ...emptyDebugStats(), fps: 60 }),
    ...overrides,
  };
}

function requireApi(host: DebugApiHost): DebugApi {
  const api = host.__dh;
  if (api === undefined) throw new Error('__dh missing');
  return api;
}

/** A browser-like setup: a game session driven by a fixed step loop, with `__dh` on a fake window. */
function running() {
  const session = new GameSession({ config: { seed: 11 } });
  let now = 0;
  const loop = new FixedStepLoop({
    now: () => now,
    schedule: () => 0,
    cancel: () => undefined,
    beginFrame: () => session.beginFrame(),
    update: () => session.step(),
    render: () => undefined,
  });
  const host: DebugApiHost = {};
  installDebugApi(host, baseDeps({ ...loopTimeControl(loop), getState: () => ({ sim: session.debugState() }), command: (raw) => session.command(raw) }));
  const frames = (n: number): void => {
    for (let i = 0; i < n; i++) {
      now += FRAME_MS;
      loop.advance(now);
    }
  };
  loop.advance(now);
  return { session, loop, api: requireApi(host), frames };
}

describe('debug flag', () => {
  it('requires ?debug=1 or developer mode', () => {
    expect(isDebugEnabled('https://example.org/game/?debug=1', false)).toBe(true);
    expect(isDebugEnabled('https://example.org/?seed=4&debug=true#x', false)).toBe(true);
    expect(isDebugEnabled('https://example.org/?debug=0', false)).toBe(false);
    expect(isDebugEnabled('https://example.org/', false)).toBe(false);
    expect(isDebugEnabled('https://example.org/', true)).toBe(true);
    expect(isDebugEnabled('/index.html?debug=1', false)).toBe(true);
    expect(isDebugEnabled('?debug=1', false)).toBe(true);
  });

  it('without the flag __dh stays undefined and no dependency is built', () => {
    const host: DebugApiHost = {};
    let built = 0;
    const deps = (): DebugApiDeps => {
      built++;
      return baseDeps();
    };
    expect(installDebugApiIfEnabled(host, 'https://example.org/', false, deps)).toBeNull();
    expect(installDebugApiIfEnabled(host, 'https://example.org/?debug=0', false, deps)).toBeNull();
    expect(host.__dh).toBeUndefined();
    expect('__dh' in host).toBe(false);
    expect(built).toBe(0);
    const handle = installDebugApiIfEnabled(host, 'https://example.org/?debug=1', false, deps);
    expect(handle).not.toBeNull();
    expect(host.__dh).toBe(handle?.api);
    expect(built).toBe(1);
  });

  it('developer mode enables __dh without the URL flag', () => {
    const host: DebugApiHost = {};
    expect(installDebugApiIfEnabled(host, 'https://example.org/', true, () => baseDeps())).not.toBeNull();
    expect(host.__dh).toBeDefined();
  });
});

describe('window.__dh', () => {
  function install() {
    const calls: string[] = [];
    const host: DebugApiHost = {};
    const handle = installDebugApi(
      host,
      baseDeps({
        freezeTime: (on) => calls.push(`freeze:${on}`),
        setSpeed: (x) => calls.push(`speed:${x}`),
        setScreenshotMode: (on) => calls.push(`shot:${on}`),
      }),
    );
    return { host, handle, calls };
  }

  it('exposes the documented shape', () => {
    const { host, handle } = install();
    const api = requireApi(host);
    expect(api.ready).toBe(false);
    handle.setReady(true);
    expect(api.ready).toBe(true);
    expect(api.version).toBe('0.1.0');
    expect(api.state()).toEqual({ tick: 42 });
    expect(api.exec('echo hallo welt')).toBe('hallo welt');
    expect(api.stats().fps).toBe(60);
    for (const fn of ['state', 'exec', 'command', 'readPixel', 'freezeTime', 'setSpeed', 'screenshotMode', 'stats', 'call', 'extensions'] as const) {
      expect(typeof api[fn]).toBe('function');
    }
  });

  it('freezes time, sets speed and handles screenshot mode', () => {
    const { host, calls } = install();
    const api = requireApi(host);
    api.freezeTime(true);
    expect(api.timeFrozen).toBe(true);
    api.freezeTime(false);
    api.setSpeed(4);
    expect(api.speed).toBe(4);
    expect(() => api.setSpeed(0)).toThrow(RangeError);
    expect(() => api.setSpeed(MAX_DEBUG_SPEED + 1)).toThrow(RangeError);
    expect(() => api.setSpeed(Number.NaN)).toThrow(RangeError);
    api.screenshotMode(true);
    expect(api.screenshot).toBe(true);
    expect(api.timeFrozen).toBe(true);
    api.screenshotMode(true);
    api.screenshotMode(false);
    expect(api.timeFrozen).toBe(false);
    expect(calls).toEqual(['freeze:true', 'freeze:false', 'speed:4', 'freeze:true', 'shot:true', 'freeze:false', 'shot:false']);
  });

  it('accepts exactly the speeds the loop can apply and keeps state when the dependency rejects', () => {
    expect(MAX_DEBUG_SPEED).toBe(MAX_TIME_SCALE);
    const host: DebugApiHost = {};
    const loop = new FixedStepLoop({ now: () => 0, schedule: () => 0, cancel: () => undefined, update: () => undefined, render: () => undefined });
    let frozenCalls = 0;
    installDebugApi(
      host,
      baseDeps({
        freezeTime: () => {
          frozenCalls++;
          throw new Error('freeze failed');
        },
        setSpeed: (f) => loop.setTimeScale(f),
      }),
    );
    const api = requireApi(host);
    api.setSpeed(MAX_DEBUG_SPEED);
    expect(loop.timeScale).toBe(MAX_DEBUG_SPEED);
    expect(api.speed).toBe(MAX_DEBUG_SPEED);
    expect(() => api.freezeTime(true)).toThrow('freeze failed');
    expect(frozenCalls).toBe(1);
    expect(api.timeFrozen).toBe(false);
  });

  it('validates pixel probe coordinates before asking the renderer', async () => {
    const asked: Array<[number, number]> = [];
    const host: DebugApiHost = {};
    installDebugApi(
      host,
      baseDeps({
        readPixel: (x, y) => {
          asked.push([x, y]);
          return Promise.resolve([9, 8, 7, 255] as const);
        },
      }),
    );
    const api = requireApi(host);
    await expect(api.readPixel(3, 4)).resolves.toEqual([9, 8, 7, 255]);
    await expect(api.readPixel(-1, 0)).rejects.toThrow(RangeError);
    await expect(api.readPixel(1.5, 0)).rejects.toThrow(RangeError);
    expect(asked).toEqual([[3, 4]]);
  });

  it('supports extensions and uninstall', () => {
    const { host, handle } = install();
    const scenario: DebugExtension = (name: string) => `loaded ${name}`;
    const off = handle.extend('scenario', scenario);
    expect(() => handle.extend('scenario', scenario)).toThrow(/already/);
    expect(host.__dh?.extensions()).toEqual(['scenario']);
    expect(host.__dh?.call('scenario', 'night')).toBe('loaded night');
    off();
    expect(() => host.__dh?.call('scenario')).toThrow(/unknown extension/);
    handle.uninstall();
    expect(host.__dh).toBeUndefined();
  });
});

describe('__dh drives the simulation', () => {
  it('freezeTime stops the simulation time while frames keep rendering; unfreezing resumes it', () => {
    const { session, loop, api, frames } = running();
    frames(30);
    const before = session.sim.tick;
    expect(before).toBe(30);
    api.freezeTime(true);
    expect(loop.pausedFor(DEBUG_FREEZE_REASON)).toBe(true);
    frames(120);
    expect(session.sim.tick).toBe(before);
    expect(session.sim.clock.tick).toBe(before);
    expect(loop.stats.frames).toBe(151);
    api.freezeTime(false);
    frames(10);
    expect(session.sim.tick).toBe(before + 10);
  });

  it('a hidden tab ending its pause does not unfreeze a debug freeze', () => {
    const { session, loop, api, frames } = running();
    api.freezeTime(true);
    loop.pause('hidden');
    loop.resume('hidden');
    frames(60);
    expect(session.sim.tick).toBe(0);
    expect(api.timeFrozen).toBe(true);
  });

  it('command() executes game commands in the next tick and state() reads the result', () => {
    const { api, frames } = running();
    expect(api.command({ type: 'spawnDebugMover', x: 320, y: 320, controlled: true })).toEqual({ type: 'spawnDebugMover', x: 320, y: 320, controlled: true });
    api.command({ type: 'move', dx: 1, dy: 0 });
    frames(60);
    const state = api.state() as { sim: { tick: number; entities: number; controlled: { x: number; y: number } | null } };
    expect(state.sim.tick).toBe(60);
    expect(state.sim.entities).toBe(1);
    expect(state.sim.controlled?.x).toBeGreaterThan(320);
    expect(() => api.command({ type: 'move', dx: 5, dy: 0 })).toThrow(TypeError);
  });
});
