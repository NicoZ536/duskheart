/**
 * `window.__dh` debug API (MASTERPROMPT §3.3, §31.6; docs/ARCHITEKTUR.md):
 * read state, execute game commands, run console commands, freeze time, change
 * speed, screenshot mode, pixel probes, performance stats. Used by E2E tests and
 * the screenshot tool.
 *
 * Fully dependency-injected: every capability is a callback, so this module
 * imports no game code and can be tested with a plain object as "window".
 */
import { MAX_TIME_SCALE, type FixedStepLoop } from '../engine/loop';
import type { DebugStatsSnapshot } from './stats';

/**
 * Highest simulation speed factor accepted by `setSpeed` (fast-forwarding in tests). Equal to the
 * loop's limit, so every accepted value can actually be applied by `FixedStepLoop.setTimeScale`.
 */
export const MAX_DEBUG_SPEED = MAX_TIME_SCALE;

/** Loop pause reason of `__dh.freezeTime` (independent of tab visibility and menus). */
export const DEBUG_FREEZE_REASON = 'debugFreeze';

/** One canvas pixel as `[r, g, b, a]`, each 0–255. */
export type PixelRgba = readonly [number, number, number, number];

/** Extension function added by other debug modules (e.g. scenario loading). */
export type DebugExtension = (...args: never[]) => unknown;

export interface DebugApiDeps {
  readonly version: string;
  /** Serializable snapshot of the game state. */
  getState(): unknown;
  /** Run one console line and return its output (see `DebugConsole.exec`). */
  exec(line: string): string;
  /** Validate and queue a game command for the next tick; returns the queued command. Throws on invalid data. */
  command(raw: unknown): unknown;
  /** Read one pixel of the next rendered frame (canvas device pixels, origin top left). */
  readPixel(x: number, y: number): Promise<PixelRgba>;
  freezeTime(on: boolean): void;
  setSpeed(factor: number): void;
  /** HUD hidden (time freezing is handled by the API). */
  setScreenshotMode(on: boolean): void;
  getStats(): DebugStatsSnapshot;
}

export interface DebugApi {
  /** True once the game finished booting (E2E waits for this). */
  readonly ready: boolean;
  readonly version: string;
  readonly timeFrozen: boolean;
  readonly speed: number;
  readonly screenshot: boolean;
  state(): unknown;
  exec(cmd: string): string;
  /** Executes a game command (validated like a replay file) in the next simulation tick. */
  command(cmd: unknown): unknown;
  /** Pixel probe: `[r, g, b, a]` of canvas pixel (x, y) in the next rendered frame. */
  readPixel(x: number, y: number): Promise<PixelRgba>;
  freezeTime(on: boolean): void;
  setSpeed(factor: number): void;
  /** HUD off + time frozen; leaving restores the previous freeze state. */
  screenshotMode(on: boolean): void;
  stats(): DebugStatsSnapshot;
  /** Names of registered extensions. */
  extensions(): string[];
  /** Call an extension by name, e.g. `__dh.call('scenario', 'forest-night')`. */
  call(name: string, ...args: unknown[]): unknown;
}

/** Object that receives `__dh` (the browser `window`, or a fake in tests). */
export interface DebugApiHost {
  __dh?: DebugApi;
}

declare global {
  interface Window {
    __dh?: DebugApi;
  }
}

export interface DebugApiHandle {
  readonly api: DebugApi;
  setReady(ready: boolean): void;
  /** Register an extension callable through `__dh.call(name, …)`. Returns an unregister function. */
  extend(name: string, fn: DebugExtension): () => void;
  /** Remove `__dh` from the host. */
  uninstall(): void;
}

/**
 * Debug tools are available with `?debug=1` in the URL or when the
 * "developer mode" setting is on.
 */
export function isDebugEnabled(url: string, developerMode: boolean): boolean {
  if (developerMode) return true;
  let search: string;
  try {
    search = new URL(url, 'http://localhost/').search;
  } catch {
    const q = url.indexOf('?');
    search = q >= 0 ? url.slice(q).split('#')[0] ?? '' : '';
  }
  const value = new URLSearchParams(search).get('debug');
  return value === '1' || value === 'true';
}

/**
 * `freezeTime`/`setSpeed` acting on the fixed step loop: freezing pauses the simulation ticks with
 * its own pause reason, so hiding and showing the tab cannot unfreeze it; rendering continues.
 */
export function loopTimeControl(loop: FixedStepLoop): Pick<DebugApiDeps, 'freezeTime' | 'setSpeed'> {
  return {
    freezeTime: (on) => {
      if (on) loop.pause(DEBUG_FREEZE_REASON);
      else loop.resume(DEBUG_FREEZE_REASON);
    },
    setSpeed: (factor) => loop.setTimeScale(factor),
  };
}

/**
 * Installs `__dh` on `host` only when debug tools are enabled (see `isDebugEnabled`); otherwise the
 * host stays untouched and `null` is returned, so production pages never expose the API.
 */
export function installDebugApiIfEnabled(host: DebugApiHost, url: string, developerMode: boolean, deps: () => DebugApiDeps): DebugApiHandle | null {
  if (!isDebugEnabled(url, developerMode)) return null;
  return installDebugApi(host, deps());
}

export function installDebugApi(host: DebugApiHost, deps: DebugApiDeps): DebugApiHandle {
  const extensions = new Map<string, DebugExtension>();
  let ready = false;
  let timeFrozen = false;
  let speed = 1;
  let screenshot = false;
  let frozenBeforeScreenshot = false;

  function freeze(on: boolean): void {
    deps.freezeTime(on);
    timeFrozen = on;
  }

  const api: DebugApi = {
    get ready() {
      return ready;
    },
    get version() {
      return deps.version;
    },
    get timeFrozen() {
      return timeFrozen;
    },
    get speed() {
      return speed;
    },
    get screenshot() {
      return screenshot;
    },
    state: () => deps.getState(),
    exec: (cmd) => {
      if (typeof cmd !== 'string') throw new TypeError('__dh.exec expects a command string');
      return deps.exec(cmd);
    },
    command: (cmd) => deps.command(cmd),
    readPixel: (x, y) => {
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
        return Promise.reject(new RangeError(`__dh.readPixel expects non-negative integer coordinates, got (${String(x)}, ${String(y)})`));
      }
      return deps.readPixel(x, y);
    },
    freezeTime: (on) => freeze(on === true),
    setSpeed: (factor) => {
      if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0 || factor > MAX_DEBUG_SPEED) {
        throw new RangeError(`__dh.setSpeed expects a number in (0, ${MAX_DEBUG_SPEED}]`);
      }
      // Apply first: if the dependency rejects the value, the reported speed stays unchanged.
      deps.setSpeed(factor);
      speed = factor;
    },
    screenshotMode: (on) => {
      const next = on === true;
      if (next === screenshot) return;
      screenshot = next;
      if (next) {
        frozenBeforeScreenshot = timeFrozen;
        freeze(true);
      } else {
        freeze(frozenBeforeScreenshot);
      }
      deps.setScreenshotMode(next);
    },
    stats: () => deps.getStats(),
    extensions: () => [...extensions.keys()].sort(),
    call: (name, ...args) => {
      const fn = extensions.get(name);
      if (!fn) throw new Error(`__dh: unknown extension "${name}" (available: ${api.extensions().join(', ') || 'none'})`);
      // Extensions are called from untyped contexts (E2E scripts); they validate their own arguments.
      return (fn as (...a: unknown[]) => unknown)(...args);
    },
  };

  Object.defineProperty(host, '__dh', { value: api, configurable: true, enumerable: false, writable: false });

  return {
    api,
    setReady(value) {
      ready = value;
    },
    extend(name, fn) {
      if (extensions.has(name)) throw new Error(`__dh extension already registered: ${name}`);
      extensions.set(name, fn);
      return () => {
        extensions.delete(name);
      };
    },
    uninstall() {
      if (host.__dh === api) delete host.__dh;
    },
  };
}
