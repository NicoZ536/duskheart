/**
 * Kompositionswurzel: Einstellungen, Sprache, Theme, WebGL2, Spielsitzung (Simulation + Eingabe),
 * Loop, Debug-API und UI werden hier verbunden. Simulationsschichten bleiben headless; die
 * Präsentation liest den Zustand über die Signals-Brücke (`src/ui/bridge.ts`, einmal je Frame) und
 * verändert ihn nur über Commands (docs/ARCHITEKTUR.md „Datenfluss“).
 */
import './ui/base.css';
import { BALANCE } from './content/balance';
import { isDebugEnabled } from './debug/api';
import { startDebug, type DebugHandle } from './debug/boot';
import { BindingSet, DEFAULT_BINDINGS } from './engine/input/bindings';
import { attachDomInput, createKeyFilter } from './engine/input/dom';
import { FixedStepLoop, animationFrameClock } from './engine/loop';
import { createSettingsStore, type SettingsStorage } from './engine/settings';
import { BOOT_SESSION_SEED, GameSession } from './game/session';
import { createI18n, type I18n } from './i18n';
import { createGlContext, watchContextLoss } from './render/gl/context';
import { PixelProbe } from './render/gl/pixelProbe';
import { TestScene } from './render/testScene';
import { createTheme, createUiBridge, mountApp } from './ui';

/** Loop pause reason while the tab is hidden (independent of debug freezing and menus). */
const HIDDEN_PAUSE_REASON = 'hidden';

function safeLocalStorage(): SettingsStorage | null {
  try {
    const s = window.localStorage;
    const probe = '__dh_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** Session seed: fixed at boot; in debug mode `?seed=<u32>` selects another world. */
function sessionSeed(debug: boolean): number {
  if (!debug) return BOOT_SESSION_SEED;
  const raw = new URLSearchParams(location.search).get('seed');
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isSafeInteger(n) ? n : BOOT_SESSION_SEED;
}

/** Missing translation keys are reported once each (never silently shown as a key, §31.4). */
function reportMissingTranslations(i18n: I18n): void {
  i18n.onMissing((key, lang) => console.error(`i18n: Schlüssel „${key}“ fehlt (${lang})`));
}

function boot(): void {
  const settings = createSettingsStore(safeLocalStorage(), { navigatorLanguage: navigator.languages });
  const i18n = createI18n(settings.get().language);
  reportMissingTranslations(i18n);
  const canvas = document.getElementById('dh-canvas') as HTMLCanvasElement;
  const uiRoot = document.getElementById('dh-ui') as HTMLElement;
  const theme = createTheme(document.documentElement, {
    setting: settings.get().accessibility.uiScale,
    width: window.innerWidth,
    height: window.innerHeight,
  });
  window.addEventListener('resize', () => theme.setViewport(window.innerWidth, window.innerHeight));
  const applyLang = (): void => {
    document.documentElement.lang = i18n.lang;
    document.title = i18n.t('game.title');
    canvas.setAttribute('aria-label', i18n.t('ui.canvas.label'));
  };
  applyLang();
  settings.subscribe((next, prev) => {
    if (next.language !== prev.language) {
      i18n.setLanguage(next.language);
      applyLang();
    }
    if (next.accessibility.uiScale !== prev.accessibility.uiScale) theme.setUiScaleSetting(next.accessibility.uiScale);
  });
  // The overlay host comes first in #dh-ui, so debug views appended later stay on top of it.
  const appHost = uiRoot.appendChild(document.createElement('div'));

  const ctx = createGlContext(canvas);
  if (!ctx.ok) {
    mountApp(appHost, { i18n, screen: { kind: 'webgl2Missing' } });
    return;
  }
  const { gl, caps } = ctx;
  let scene = new TestScene(gl);
  let probe = new PixelProbe(gl);
  let contextLost = false;
  watchContextLoss(
    canvas,
    () => {
      contextLost = true;
      probe.abort('Grafikkontext verloren');
    },
    () => {
      scene = new TestScene(gl);
      probe = new PixelProbe(gl);
      contextLost = false;
    },
  );

  const debugEnabled = isDebugEnabled(location.href, settings.get().game.developerMode);
  const session = new GameSession({
    config: { seed: sessionSeed(debugEnabled) },
    getGamepads: () => (typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : []),
  });
  session.applyControls(settings.get().controls);
  const bridge = createUiBridge(session);
  let keyFilter = createKeyFilter(new BindingSet(DEFAULT_BINDINGS, settings.get().controls.bindings));
  attachDomInput(canvas, session.input, { windowTarget: window, preventKey: (code, ctrlOrMeta) => keyFilter(code, ctrlOrMeta) });

  let presentationTime = 0;
  let frozenAt: number | null = null;
  let lastRenderPrepMs = 0;
  const resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  let debug: DebugHandle | null = null;
  const loop = new FixedStepLoop({
    ...animationFrameClock(window),
    stepHz: BALANCE.time.tickHz,
    maxCatchUp: BALANCE.time.maxCatchUpSteps,
    beginFrame: () => session.beginFrame(),
    update: (step) => {
      session.step();
      presentationTime += step;
    },
    render: () => {
      // UI signals follow the simulation once per rendered frame, also while the GL context is lost.
      bridge.frame();
      if (contextLost) return;
      const t0 = performance.now();
      resize();
      scene.render(canvas.width, canvas.height, frozenAt ?? presentationTime, settings.get().graphics.scaleMode);
      lastRenderPrepMs = performance.now() - t0;
      probe.afterFrame(canvas.width, canvas.height);
      debug?.onFrame();
    },
  });
  loop.setTimeScale(settings.get().accessibility.gameSpeed);
  settings.subscribe((next, prev) => {
    if (next.controls !== prev.controls) {
      session.applyControls(next.controls);
      keyFilter = createKeyFilter(new BindingSet(DEFAULT_BINDINGS, next.controls.bindings));
    }
    if (next.accessibility.gameSpeed !== prev.accessibility.gameSpeed) loop.setTimeScale(next.accessibility.gameSpeed);
  });

  debug = startDebug({
    settings,
    i18n,
    uiRoot,
    caps,
    session,
    loop,
    getSceneStats: () => scene.stats,
    getRenderPrepMs: () => lastRenderPrepMs,
    freezeAt: (s) => (frozenAt = s),
    readPixel: (x, y) => probe.request(x, y),
  });

  mountApp(appHost, { i18n, screen: { kind: 'game', bridge } });
  loop.start();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loop.pause(HIDDEN_PAUSE_REASON);
    else loop.resume(HIDDEN_PAUSE_REASON);
  });
  debug?.setReady();
}

boot();
