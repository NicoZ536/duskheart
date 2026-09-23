/**
 * Debug-Modus (MASTERPROMPT §31.6): nur mit `?debug=1` oder Einstellung „Entwicklermodus“.
 * Installiert `window.__dh`, die Konsole, das F3-Overlay sowie Szenario- und Bench-Erweiterungen.
 */
import { render } from 'preact';
import type { FixedStepLoop } from '../engine/loop';
import type { SettingsStore } from '../engine/settings';
import type { I18n } from '../i18n';
import type { GlCaps } from '../render/gl/context';
import { installDebugApi, isDebugEnabled, type DebugApiHost } from './api';
import { createDebugConsole } from './console';
import { DebugOverlay } from './overlay';
import { findScenario, SCENARIOS } from './scenarios';
import { createDebugStats, FrameMeter, snapshotDebugStats, updateDebugStats } from './stats';
import { injectDebugStyles } from './styles';

export interface DebugBootDeps {
  settings: SettingsStore;
  i18n: I18n;
  uiRoot: HTMLElement;
  caps: GlCaps;
  getSceneStats(): { drawCalls: number; frames: number };
  getRenderPrepMs(): number;
  freezeAt(seconds: number | null): void;
}

export interface DebugHandle {
  onFrame(): void;
  attachLoop(loop: FixedStepLoop): void;
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

export function startDebug(deps: DebugBootDeps): DebugHandle | null {
  if (!isDebugEnabled(location.href, deps.settings.get().game.developerMode)) return null;
  injectDebugStyles(document);
  const { i18n, settings } = deps;
  const stats = createDebugStats(false);
  const meter = new FrameMeter();
  const con = createDebugConsole({ t: (k, p) => i18n.t(k, p) });
  let loop: FixedStepLoop | null = null;
  let lastFrameAt = performance.now();
  const frameWaiters: Array<() => void> = [];
  let scenarioReady = false;

  con.register(
    'set',
    [
      { name: 'path', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    ({ path, value }) => {
      settings.update(pathPatch(path, parseValue(value)));
      const issues = settings.issues;
      return issues.length > 0 ? i18n.t('debug.cmd.set.invalid', { path }) : i18n.t('debug.cmd.set.done', { path, value });
    },
    'debug.cmd.set.help',
  );

  const handle = installDebugApi(window as unknown as DebugApiHost, {
    version: __DH_VERSION__,
    getState: () => ({ settings: settings.get(), language: i18n.lang }),
    exec: (line) => con.exec(line),
    freezeTime: (on) => {
      if (on) loop?.pause();
      else loop?.resume();
    },
    setSpeed: (f) => loop?.setTimeScale(f),
    setScreenshotMode: (on) => {
      deps.uiRoot.style.visibility = on ? 'hidden' : 'visible';
    },
    getStats: () => snapshotDebugStats(stats),
  });

  const nextFrame = (): Promise<void> => new Promise((resolve) => frameWaiters.push(resolve));
  handle.extend('scenarios', () => SCENARIOS.map((s) => s.name));
  handle.extend('scenarioReady', () => scenarioReady);
  handle.extend('gl', () => ({ webgl2: true, ...deps.caps }));
  handle.extend('frames', () => deps.getSceneStats().frames);
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
      deps.uiRoot.style.visibility = 'hidden';
      settleFrames = sc.settleFrames;
    } else console.error(`Unbekanntes Szenario: ${scenarioName}`);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault();
      stats.visible.value = !stats.visible.value;
    }
  });
  const host = deps.uiRoot.appendChild(document.createElement('div'));
  render(<DebugOverlay stats={stats} t={(k, p) => i18n.t(k, p)} lang={i18n.lang} />, host);

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
      const waiters = frameWaiters.splice(0);
      for (const w of waiters) w();
    },
    attachLoop(l) {
      loop = l;
    },
    setReady() {
      handle.setReady(true);
    },
  };
}
