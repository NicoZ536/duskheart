/**
 * Kompositionswurzel: Einstellungen, Sprache, Theme, WebGL2, Spielsitzung (Simulation + Eingabe),
 * Welt der Sitzung, Loop, Debug-API und UI werden hier verbunden. Simulationsschichten bleiben
 * headless; die Präsentation liest den Zustand über die Signals-Brücke (`src/ui/bridge.ts`, einmal je
 * Frame) und verändert ihn nur über Commands (docs/ARCHITEKTUR.md „Datenfluss“).
 *
 * Die Welt der Sitzung entsteht beim Start im Welt-Worker (`WorldHost`, Fortschritt als Zeile unter dem
 * Titel); derselbe Worker lädt danach die Chunks. Bis sie da ist, ruht die Simulation (Pausengrund
 * `welt`), damit sie Weltplan und Welt nie im Hauptthread erzeugt; der Titel steht sofort. Steht die
 * Welt, erscheint der Spieler am Startstrand (`player.spawn`, M3-08); die Kamera folgt ihm, WASD/Stick,
 * Shift, Strg und Leertaste steuern ihn über Commands. Der Renderer bekommt je Frame das Alpha der
 * Interpolation zwischen den letzten beiden Ticks (`session.setFrameAlpha`).
 */
import './ui/base.css';
import { attachAudio } from './audio';
import { BALANCE } from './content/balance';
import { isDebugEnabled } from './debug/api';
import { startDebug, type DebugHandle } from './debug/boot';
import { BindingSet, DEFAULT_BINDINGS } from './engine/input/bindings';
import { attachDomInput, createKeyFilter } from './engine/input/dom';
import { FixedStepLoop, MAX_TIME_SCALE, animationFrameClock } from './engine/loop';
import { createSettingsStore, type SettingsStorage } from './engine/settings';
import { BOOT_SESSION_SEED, GameSession } from './game/session';
import { createI18n, type I18n } from './i18n';
import { createGlContext, parseRenderFlags } from './render/gl/context';
import { createRenderRuntime } from './render/runtime';
import { lightSettingsFrom } from './render/light/settings';
import { createTheme, createUiBridge, createWorldLoadingStatus, mountApp, type MenuHooks } from './ui';
import { hudWeltdienste, hudZeigtHinweis } from './ui/hud';
import { createDeathScreenModel } from './ui/screens/tod';
import { openSaveDb } from './save/db';
import { saveWorld } from './save/world';
import { WorldHost } from './render/world/worldHost';

/** Loop pause reason while the tab is hidden (independent of debug freezing and menus). */
const HIDDEN_PAUSE_REASON = 'hidden';
/** Loop pause reason while the pause menu is open (M3-31). */
const MENU_PAUSE_REASON = 'menue';
/** Loop pause reason until the session's world is generated (the simulation must not build it on the main thread). */
const WORLD_PAUSE_REASON = 'welt';
/** The gamepad list while no gamepad is connected (shared: polling it every frame allocates nothing). */
const NO_GAMEPADS: readonly Gamepad[] = [];

/**
 * Gamepad source of the session. `navigator.getGamepads()` builds a new array on every call, so it
 * is only polled while a gamepad is connected; browsers expose a pad (and fire `gamepadconnected`)
 * only after its first input anyway (§30 no allocation per frame).
 */
function gamepadSource(target: Window): () => readonly (Gamepad | null)[] {
  let connected = 0;
  target.addEventListener('gamepadconnected', () => connected++);
  target.addEventListener('gamepaddisconnected', () => (connected = Math.max(0, connected - 1)));
  return () => (connected > 0 && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : NO_GAMEPADS);
}

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

/**
 * Whether the player appears on the start beach once the world is there: always in the game. In debug
 * mode only with `?spieler=1` – the screenshot scenarios and the M2 world tools (`tp`, debug figure,
 * free title camera) and their E2E tests work on the world without a player.
 */
function spawnsPlayer(debug: boolean): boolean {
  return !debug || new URLSearchParams(location.search).get('spieler') === '1';
}

/** Whether a screenshot scenario runs (debug mode with `?scenario=`). */
function runsScenario(debug: boolean): boolean {
  return debug && new URLSearchParams(location.search).get('scenario') !== null;
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
    devicePixelRatio: window.devicePixelRatio,
  });
  // Browser zoom changes the device pixel ratio and fires `resize` as well.
  window.addEventListener('resize', () => theme.setViewport(window.innerWidth, window.innerHeight, window.devicePixelRatio));
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
  // Renderer, scenes, pixel probe, shader error overlay and context-loss handling (src/render/runtime.ts).
  const debugEnabled = isDebugEnabled(location.href, settings.get().game.developerMode);
  const gfx = createRenderRuntime({ canvas, gl, caps, flags: parseRenderFlags(location.search), overlayHost: document.body, t: (key, params) => i18n.t(key, params), debugCamera: debugEnabled });
  i18n.onChange(() => gfx.refreshTexts());
  // Light bands, dither, light cap (quality level) and flicker reduction follow the settings.
  gfx.configureLighting(lightSettingsFrom(settings.get()));
  settings.subscribe((next, prev) => {
    if (next.graphics !== prev.graphics || next.accessibility !== prev.accessibility) gfx.configureLighting(lightSettingsFrom(next));
  });

  // The session's world: generated in the world worker, handed to the simulation, streamed from the
  // simulation's chunk store by the game view (the default scene, behind the title the start beach).
  const worldLoading = createWorldLoadingStatus();
  const spawnPlayer = spawnsPlayer(debugEnabled);
  let worldHost: WorldHost | null = null;
  const session = new GameSession({
    config: { seed: sessionSeed(debugEnabled) },
    getGamepads: gamepadSource(window),
    simulation: {
      chunkJobs: () => {
        if (worldHost === null) throw new Error('Welt der Sitzung: kein Welt-Worker');
        return worldHost.createJobQueue();
      },
    },
  });
  const host = new WorldHost({
    seed: session.sim.config.seed,
    preset: session.sim.config.worldSize,
    spawnWorker: () => new Worker(new URL('./world/gen/world.worker.ts', import.meta.url), { type: 'module' }),
    now: () => performance.now(),
    adopt: (world) => {
      session.sim.world.provide(world);
      return session.sim.world.chunks;
    },
    onProgress: (p) => worldLoading.step(p.step, p.index, p.count),
    onReady: () => {
      worldLoading.done();
      // The player appears on the start beach in the first tick (the world is there now).
      if (spawnPlayer) session.command({ type: 'player.spawn' });
      loop.resume(WORLD_PAUSE_REASON);
    },
    // Without its world the session cannot start: the title names the reason, the simulation keeps resting.
    onError: (message) => worldLoading.fail(message),
  });
  worldHost = host;
  // Audio kernel (M3-33, src/audio/runtime.ts): simulation events → sounds, mixer on the audio settings;
  // the AudioContext starts with the first input (autoplay policy) and pauses with a hidden tab.
  const audio = attachAudio({ session, settings, gestureTarget: window, visibility: document });
  // Content names in world texts (the interaction hint) follow the language setting; the frame events of
  // the player's body clips (bites, gulps, the body falling) sound through the audio kernel.
  // While the HUD shows the interaction hint (modes Voll and Kontextuell; HUD not hidden for screenshots, or
  // kept by a HUD scenario), the marker over the target shows only the key cap – the text is not drawn twice.
  gfx.attachGame({
    session,
    host,
    lang: () => i18n.lang,
    onClipEvent: (event, _x, _y, _layer, cycle) => audio.clipEvent(event, cycle),
    hudShowsHint: () => hudZeigtHinweis(uiRoot.style.visibility !== 'hidden', settings.get().game.hudMode),
  });
  session.applyControls(settings.get().controls);
  const bridge = createUiBridge(session);
  let keyFilter = createKeyFilter(new BindingSet(DEFAULT_BINDINGS, settings.get().controls.bindings));
  attachDomInput(canvas, session.input, { windowTarget: window, preventKey: (code, ctrlOrMeta) => keyFilter(code, ctrlOrMeta) });

  let presentationTime = 0;
  let frozenAt: number | null = null;
  let lastRenderPrepMs = 0;
  // CPU time of the whole frame (input → ticks → UI signals → render), §30 "CPU pro Frame ≤ 8 ms".
  let frameStartMs = 0;
  let lastFrameCpuMs = 0;
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
  // Speed of time: the game speed of the settings (§29) × what the simulation asks for (×30 while the player
  // sleeps, §11.5), within the loop's limit. Set only when either changes, so the debug `speed` stays.
  let appliedTimeScale = Number.NaN;
  const applyTimeScale = (): void => {
    const scale = Math.min(MAX_TIME_SCALE, settings.get().accessibility.gameSpeed * session.timeScale);
    if (scale === appliedTimeScale) return;
    appliedTimeScale = scale;
    loop.setTimeScale(scale);
  };
  const loop = new FixedStepLoop({
    ...animationFrameClock(window),
    stepHz: BALANCE.time.tickHz,
    maxCatchUp: BALANCE.time.maxCatchUpSteps,
    beginFrame: () => {
      frameStartMs = performance.now();
      session.beginFrame();
      applyTimeScale();
    },
    update: (step) => {
      session.step();
      presentationTime += step;
    },
    render: (alpha) => {
      // The figure and camera lie `alpha` between the last two ticks (interpolation before pixel snapping).
      session.setFrameAlpha(alpha);
      // UI signals follow the simulation once per rendered frame, also while the GL context is lost.
      bridge.frame();
      // The listener follows the interpolated figure; positioned voices follow the listener.
      audio.frame();
      const t0 = performance.now();
      resize();
      // While the GL context is lost nothing is drawn; the simulation keeps ticking.
      if (!gfx.render(canvas.width, canvas.height, frozenAt ?? presentationTime, settings.get().graphics.scaleMode)) return;
      const t1 = performance.now();
      lastRenderPrepMs = t1 - t0;
      lastFrameCpuMs = t1 - frameStartMs;
      debug?.onFrame();
    },
  });
  applyTimeScale();
  loop.pause(WORLD_PAUSE_REASON);
  host.start();
  settings.subscribe((next, prev) => {
    if (next.controls !== prev.controls) {
      session.applyControls(next.controls);
      keyFilter = createKeyFilter(new BindingSet(DEFAULT_BINDINGS, next.controls.bindings));
    }
    if (next.accessibility.gameSpeed !== prev.accessibility.gameSpeed) applyTimeScale();
  });

  debug = startDebug({
    settings,
    i18n,
    uiRoot,
    caps,
    session,
    loop,
    getSceneStats: () => gfx.stats,
    render: gfx,
    getRenderPrepMs: () => lastRenderPrepMs,
    getFrameCpuMs: () => lastFrameCpuMs,
    freezeAt: (s) => (frozenAt = s),
    getFrozenAt: () => frozenAt,
    readPixel: (x, y) => gfx.readPixel(x, y),
    worldSpawn: () => host.world?.spawn ?? null,
    canvas,
  });

  // Menus (M3-31): settings that take effect live, the pause menu's own pause reason, a manual save of
  // the running world into IndexedDB (between two ticks: the menu has paused the loop), back to the title,
  // the screens' sounds.
  const menus: MenuHooks = {
    settings,
    setPaused: (on) => {
      if (on) loop.pause(MENU_PAUSE_REASON);
      else loop.resume(MENU_PAUSE_REASON);
      // The world falls silent while paused (loops keep their place).
      audio.setPaused(on);
    },
    save: async () => {
      const { day, minuteOfDay } = session.sim.clock;
      try {
        const store = await openSaveDb(indexedDB);
        try {
          const seed = session.sim.config.seed;
          await saveWorld(store, session.sim, { worldId: `welt-${seed}`, name: i18n.t('ui.pause.weltName', { seed: String(seed) }), now: Date.now(), gameVersion: __DH_VERSION__ });
        } finally {
          store.close();
        }
        return { ok: true, day, minuteOfDay };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    toTitle: () => location.reload(),
    klang: audio,
  };
  // HUD world displays (M3-28/M3-29): minimap source and notification queue of the session, new warnings and discoveries sound.
  const hudWelt = hudWeltdienste(session, { klang: audio });
  // The death screen (M3-26) shows over everything while the player's light is out – not in screenshot
  // scenarios, which compose their screens themselves (`todesbildschirm` shows a representative death).
  const death = runsScenario(debugEnabled) ? undefined : createDeathScreenModel(session);
  mountApp(appHost, { i18n, screen: { kind: 'game', bridge, worldLoading: worldLoading.view, menus, hudWelt, death, untertitel: audio } });
  loop.start();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loop.pause(HIDDEN_PAUSE_REASON);
    else loop.resume(HIDDEN_PAUSE_REASON);
  });
  debug?.setReady();
}

boot();
