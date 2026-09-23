/**
 * Kompositionswurzel: Einstellungen, Sprache, WebGL2, Loop, Debug-API und UI werden hier verbunden.
 * Simulationsschichten bleiben headless; die Präsentation verändert den Zustand nur über Commands.
 */
import './ui/base.css';
import { render } from 'preact';
import { FixedStepLoop, animationFrameClock } from './engine/loop';
import { createSettingsStore, type SettingsStorage } from './engine/settings';
import { createI18n } from './i18n';
import { createGlContext, watchContextLoss } from './render/gl/context';
import { TestScene } from './render/testScene';
import { NoWebGl2 } from './ui/NoWebGl2';
import { TitleCard } from './ui/TitleCard';
import { startDebug } from './debug/boot';

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

function boot(): void {
  const settings = createSettingsStore(safeLocalStorage(), { navigatorLanguage: navigator.languages });
  const i18n = createI18n(settings.get().language);
  const applyLang = (): void => {
    document.documentElement.lang = i18n.lang;
    document.title = i18n.t('game.title');
  };
  applyLang();
  settings.subscribe((next, prev) => {
    if (next.language !== prev.language) {
      i18n.setLanguage(next.language);
      applyLang();
    }
  });

  const canvas = document.getElementById('dh-canvas') as HTMLCanvasElement;
  const uiRoot = document.getElementById('dh-ui') as HTMLElement;
  const ctx = createGlContext(canvas);
  if (!ctx.ok) {
    render(<NoWebGl2 i18n={i18n} />, uiRoot);
    return;
  }
  const { gl, caps } = ctx;
  let scene = new TestScene(gl);
  let contextLost = false;
  watchContextLoss(
    canvas,
    () => {
      contextLost = true;
    },
    () => {
      scene = new TestScene(gl);
      contextLost = false;
    },
  );

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

  const debug = startDebug({ settings, i18n, uiRoot, caps, getSceneStats: () => scene.stats, getRenderPrepMs: () => lastRenderPrepMs, freezeAt: (s) => (frozenAt = s) });

  const loop = new FixedStepLoop({
    ...animationFrameClock(window),
    update: (step) => {
      presentationTime += step;
    },
    render: () => {
      if (contextLost) return;
      const t0 = performance.now();
      resize();
      scene.render(canvas.width, canvas.height, frozenAt ?? presentationTime, settings.get().graphics.scaleMode);
      lastRenderPrepMs = performance.now() - t0;
      debug?.onFrame();
    },
  });
  debug?.attachLoop(loop);

  render(<TitleCard i18n={i18n} />, uiRoot.appendChild(document.createElement('div')));
  loop.start();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loop.pause();
    else loop.resume();
  });
  debug?.setReady();
}

boot();
