/**
 * Debug-Modus (MASTERPROMPT §31.6): nur mit `?debug=1` oder Einstellung „Entwicklermodus“.
 * Installiert `window.__dh` (Zustand der Sitzung lesen, Commands ausführen, Zeit einfrieren,
 * Pixelprobe), die Konsole (Aktion `debugConsole`, Standard ^ / Backquote), das F3-Overlay
 * (Aktion `debugOverlay`) sowie Szenario-, Tick- und Bench-Erweiterungen.
 */
import { signal } from '@preact/signals';
import { render } from 'preact';
import { BindingSet, DEFAULT_BINDINGS, type Binding, type SerializedBindings } from '../engine/input/bindings';
import { isEditableTarget } from '../engine/input/dom';
import type { FixedStepLoop } from '../engine/loop';
import type { SettingsStore } from '../engine/settings';
import type { GameSession } from '../game/session';
import type { I18n } from '../i18n';
import type { GlCaps } from '../render/gl/context';
import { MAX_DEBUG_SPEED, installDebugApiIfEnabled, loopTimeControl, type DebugApi, type DebugApiHost, type PixelRgba } from './api';
import { createDebugConsole, type DebugConsole, type Translate } from './console';
import { DebugConsoleView } from './consoleView';
import { DebugOverlay } from './overlay';
import { findScenario, SCENARIOS } from './scenarios';
import { createDebugStats, FrameMeter, snapshotDebugStats, updateDebugStats } from './stats';
import { injectDebugStyles } from './styles';

export interface DebugBootDeps {
  settings: SettingsStore;
  i18n: I18n;
  uiRoot: HTMLElement;
  caps: GlCaps;
  /** The running game session (simulation + input chain). */
  session: GameSession;
  /** The frame loop driving the session (created, not necessarily started). */
  loop: FixedStepLoop;
  getSceneStats(): { drawCalls: number; frames: number };
  getRenderPrepMs(): number;
  freezeAt(seconds: number | null): void;
  /** Pixel probe of the next rendered frame (see `DebugApi.readPixel`). */
  readPixel(x: number, y: number): Promise<PixelRgba>;
}

export interface DebugHandle {
  onFrame(): void;
  setReady(): void;
}

interface BenchRenderResult {
  frames: number;
  drawCallsMax: number;
  spritesMax: number;
  lightsMax: number;
  particlesMax: number;
  prepMsP95: number;
  heapMb: number;
}

const BYTES_PER_MB = 1024 * 1024;
/** Slowest speed the `speed` console command accepts (slow motion for inspecting animations). */
export const MIN_CONSOLE_SPEED = 0.1;

function heapMb(): number | null {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize / BYTES_PER_MB : null;
}

/** Turn `a.b.c` + value into a nested patch object. */
function pathPatch(path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.');
  const root: Record<string, unknown> = {};
  let cur = root;
  parts.forEach((p, i) => {
    if (i === parts.length - 1) cur[p] = value;
    else {
      const next: Record<string, unknown> = {};
      cur[p] = next;
      cur = next;
    }
  });
  return root;
}

function parseValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) ? n : raw;
}

/** The parts of a `KeyboardEvent` that decide whether a key binding fires. */
export interface KeyEventLike {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * Whether a key event triggers one of `bindings`. Chord modifiers of a binding must be held; a
 * binding without modifiers fires regardless of held modifiers (same rule as the input system).
 */
export function keyMatches(bindings: readonly Binding[], e: KeyEventLike): boolean {
  return bindings.some((b) => b.kind === 'key' && b.code === e.code && (!b.ctrl || e.ctrlKey) && (!b.shift || e.shiftKey) && (!b.alt || e.altKey));
}

export interface CoreCommandDeps {
  readonly t: Translate;
  readonly settings: SettingsStore;
  readonly api: Pick<DebugApi, 'setSpeed' | 'freezeTime'>;
}

/** Console commands available from M0 on: `set <path> <value>`, `speed <factor>`, `freeze <on|off>`. */
export function registerCoreCommands(con: DebugConsole, { t, settings, api }: CoreCommandDeps): void {
  con.register(
    'set',
    [
      { name: 'path', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    ({ path, value }) => {
      settings.update(pathPatch(path, parseValue(value)));
      const issues = settings.issues;
      return issues.length > 0 ? t('debug.cmd.set.invalid', { path }) : t('debug.cmd.set.done', { path, value });
    },
    'debug.cmd.set.help',
  );
  con.register(
    'speed',
    [{ name: 'factor', type: 'float', min: MIN_CONSOLE_SPEED, max: MAX_DEBUG_SPEED }],
    ({ factor }) => {
      api.setSpeed(factor);
      return t('debug.speed', { factor });
    },
    'debug.cmd.speed.help',
  );
  con.register(
    'freeze',
    [{ name: 'state', type: 'enum', options: ['on', 'off'] }],
    ({ state }) => {
      const on = state === 'on';
      api.freezeTime(on);
      return t(on ? 'debug.timeFrozen' : 'debug.timeRunning');
    },
    'debug.cmd.freeze.help',
  );
}

export function startDebug(deps: DebugBootDeps): DebugHandle | null {
  const { i18n, settings, session, loop } = deps;
  const t: Translate = (k, p) => i18n.t(k, p);
  const stats = createDebugStats(false);
  const con = createDebugConsole({ t });
  const handle = installDebugApiIfEnabled(window as unknown as DebugApiHost, location.href, settings.get().game.developerMode, () => ({
    version: __DH_VERSION__,
    getState: () => ({ settings: settings.get(), language: i18n.lang, sim: session.debugState() }),
    exec: (line) => con.exec(line),
    command: (raw) => session.command(raw),
    readPixel: (x, y) => deps.readPixel(x, y),
    ...loopTimeControl(loop),
    setScreenshotMode: (on) => {
      deps.uiRoot.style.visibility = on ? 'hidden' : 'visible';
    },
    getStats: () => snapshotDebugStats(stats),
  }));
  if (handle === null) return null;
  injectDebugStyles(document);
  const meter = new FrameMeter();
  const consoleOpen = signal(false);
  let lastFrameAt = performance.now();
  const frameWaiters: Array<() => void> = [];
  let scenarioReady = false;

  registerCoreCommands(con, { t, settings, api: handle.api });

  const nextFrame = (): Promise<void> => new Promise((resolve) => frameWaiters.push(resolve));
  handle.extend('scenarios', () => SCENARIOS.map((s) => s.name));
  handle.extend('scenarioReady', () => scenarioReady);
  handle.extend('gl', () => ({ webgl2: true, ...deps.caps }));
  handle.extend('frames', () => deps.getSceneStats().frames);
  handle.extend('tick', () => session.sim.tick);
  handle.extend('benchRender', async (frames: number): Promise<BenchRenderResult> => {
    const prep: number[] = [];
    let drawCallsMax = 0;
    for (let i = 0; i < frames; i++) {
      await nextFrame();
      prep.push(deps.getRenderPrepMs());
      drawCallsMax = Math.max(drawCallsMax, deps.getSceneStats().drawCalls);
    }
    prep.sort((a, b) => a - b);
    const p95 = prep[Math.min(prep.length - 1, Math.floor(prep.length * 0.95))] ?? 0;
    return { frames, drawCallsMax, spritesMax: 0, lightsMax: 0, particlesMax: 0, prepMsP95: p95, heapMb: heapMb() ?? 0 };
  });

  const scenarioName = new URLSearchParams(location.search).get('scenario');
  let settleFrames = -1;
  if (scenarioName) {
    const sc = findScenario(scenarioName);
    if (sc) {
      sc.setup({ freezeAt: (s) => deps.freezeAt(s) });
      // Screenshot mode (§31.6): HUD and overlays hidden, simulation time frozen.
      handle.api.screenshotMode(true);
      settleFrames = sc.settleFrames;
    } else console.error(`Unbekanntes Szenario: ${scenarioName}`);
  }

  // Keys follow the (rebindable) actions `debugOverlay` and `debugConsole`; rebuilt when the overrides change.
  let bindingOverrides: SerializedBindings | null = null;
  let bindings = new BindingSet(DEFAULT_BINDINGS);
  const currentBindings = (): BindingSet => {
    const overrides = settings.get().controls.bindings;
    if (overrides !== bindingOverrides) {
      bindingOverrides = overrides;
      bindings = new BindingSet(DEFAULT_BINDINGS, overrides);
    }
    return bindings;
  };
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const b = currentBindings();
    if (keyMatches(b.get('debugOverlay'), e)) {
      e.preventDefault();
      stats.visible.value = !stats.visible.value;
    } else if (keyMatches(b.get('debugConsole'), e) && !isEditableTarget(e.target)) {
      // Inside the console input the view itself closes on the toggle key.
      e.preventDefault();
      consoleOpen.value = !consoleOpen.value;
    }
  });
  const host = deps.uiRoot.appendChild(document.createElement('div'));
  render(
    <>
      <DebugOverlay stats={stats} t={t} lang={i18n.lang} />
      <DebugConsoleView console={con} t={t} open={consoleOpen} />
    </>,
    host,
  );

  return {
    onFrame() {
      const now = performance.now();
      meter.push(now - lastFrameAt);
      lastFrameAt = now;
      updateDebugStats(stats, {
        fps: meter.fps,
        frameMs: meter.averageMs,
        renderMs: deps.getRenderPrepMs(),
        drawCalls: deps.getSceneStats().drawCalls,
        heapMb: heapMb(),
      });
      if (settleFrames > 0) settleFrames--;
      else if (settleFrames === 0) scenarioReady = true;
      if (frameWaiters.length > 0) for (const w of frameWaiters.splice(0)) w();
    },
    setReady() {
      handle.setReady(true);
    },
  };
}
