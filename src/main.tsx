/// <reference types="vite-plugin-pwa/vanillajs" />
/**
 * Kompositionswurzel: Einstellungen, Sprache, Theme, WebGL2, Spielsitzung (Simulation + Eingabe),
 * Welt der Sitzung, Loop, Speichern, Debug-API und UI werden hier verbunden. Simulationsschichten bleiben
 * headless; die Präsentation liest den Zustand über die Signals-Brücke (`src/ui/bridge.ts`, einmal je
 * Frame) und verändert ihn nur über Commands (docs/ARCHITEKTUR.md „Datenfluss“).
 *
 * Boot-Ablauf (docs/SPIEL.md §25, M7-50; `bootArt` in src/ui/menu/start.ts):
 * - **Hauptmenü** (jede Seite ohne Debug, `?debug=1&menue=1`, die Menü-Szenarien): eine eigene kleine Sitzung auf der
 *   festen Menüwelt mit dem Küstenlager im Zeitraffer (src/render/world/menuScene.ts), darüber Hauptmenü, Weltauswahl,
 *   Neue Welt und Einstellungen. Startet der Spieler eine Welt, schreibt das Menü einen Startauftrag in den
 *   Sitzungsspeicher des Tabs und lädt die Seite neu.
 * - **Spiel** (ein Startauftrag liegt vor): eine neue Welt (Konfiguration und erste Befehle des Auftrags, dann
 *   `player.spawn`; nach dem ersten Speichern wird der Auftrag zum Laden derselben Welt) oder eine gespeicherte (ihr
 *   jüngster intakter Slot). Bis die Welt steht, zeigt der Ladebildschirm Fortschritt, Tipp und Lore. Autosave alle
 *   `game.autosaveMinutes`, beim Schlafen, beim Verbergen des Tabs und beim Verlassen (src/save/autosave.ts, Schreiben
 *   im Speicher-Worker); „Zum Titel“ löscht den Auftrag und lädt das Menü.
 * - **Direkt** (Debug-Seiten wie bisher: `?debug=1`, `&seed=`, `&spieler=1`, Szenarien, `&laden=<Welt>`): die
 *   Welt-Werkzeuge ohne Menü, die Titelzeile über der Welt; gespeichert wird nur auf Wunsch (Pausemenü, `__dh`), mit
 *   `&autosave=1` auch automatisch.
 *
 * Die Welt der Sitzung entsteht beim Start im Welt-Worker (`WorldHost`); derselbe Worker lädt danach die Chunks. Bis sie
 * da ist, ruht die Simulation (Pausengrund `welt`), damit sie Weltplan und Welt nie im Hauptthread erzeugt. Der Loop
 * läuft im Takt der Bildwiederholrate oder darunter (`graphics.fpsLimit`, src/engine/frameLimit.ts, M7-55); der Renderer
 * bekommt je Frame das Alpha der Interpolation zwischen den letzten beiden Ticks (`session.setFrameAlpha`).
 */
import { registerSW } from 'virtual:pwa-register';
import './ui/base.css';
import { attachAudio } from './audio';
import { BALANCE } from './content/balance';
import { isDebugEnabled } from './debug/api';
import { startDebug, type DebugHandle } from './debug/boot';
import { isMenuScenario } from './debug/menueScenarios';
import { readWorldForBoot, setDebugPageHooks } from './debug/saveLoad';
import { limitedAnimationFrameClock } from './engine/frameLimit';
import { BindingSet, DEFAULT_BINDINGS } from './engine/input/bindings';
import { attachDomInput, createKeyFilter } from './engine/input/dom';
import { FixedStepLoop, MAX_TIME_SCALE } from './engine/loop';
import { createSettingsStore, type SettingsStorage, type SettingsStore } from './engine/settings';
import { BOOT_SESSION_SEED, GameSession } from './game/session';
import { CreatureSystem } from './game/creatures/system';
import type { SimConfigInput } from './game/sim';
import { createPathJobs } from './world/path/worker';
import { createI18n, type I18n } from './i18n';
import { createGlContext, parseRenderFlags } from './render/gl/context';
import { createRenderRuntime } from './render/runtime';
import { startRenderQuality } from './render/quality/boot';
import { MENU_WORLD, menuAudioView, menuRenderView, startMenuScene } from './render/world/menuScene';
import { createTheme, createUiBridge, createWorldLoadingStatus, mountApp, type MenuHooks } from './ui';
import { hudWeltdienste, hudZeigtHinweis } from './ui/hud';
import { createDeathScreenModel } from './ui/screens/tod';
import type { HauptmenueHooks, WeltEintrag, WeltQuelle } from './ui/menu/hooks';
import { bootArt, clearStartRequest, newWorldId, readStartRequest, writeStartRequest, type BootArt, type RequestStorage, type StartRequest } from './ui/menu/start';
import { createBereitFlagge, festerHinweis, type LadeQuelle } from './ui/screens/laden/Ladebildschirm';
import { openSaveDb } from './save/db';
import { exportDhsave, importDhsave } from './save/dhsave';
import type { WorldMeta } from './save/store';
import { restoreInto, type RecoveredWorldSave } from './save/world';
import { Autosaver } from './save/autosave';
import { SaveService } from './save/saveService';
import { openPerUse } from './save/writer';
import { WorldHost } from './render/world/worldHost';
import { BuildGhost } from './render/game/ghost';

/** Loop pause reason while the tab is hidden (independent of debug freezing and menus). */
const HIDDEN_PAUSE_REASON = 'hidden';
/** Loop pause reason while the pause menu is open (M3-31). */
const MENU_PAUSE_REASON = 'menue';
/** Loop pause reason until the session's world is generated (the simulation must not build it on the main thread). */
const WORLD_PAUSE_REASON = 'welt';
/** The gamepad list while no gamepad is connected (shared: polling it every frame allocates nothing). */
const NO_GAMEPADS: readonly Gamepad[] = [];
/** Largest seed a new world is suggested (the u32 range, §28 "Seed"). */
const SEED_RANGE = 2 ** 32;
/** Milliseconds per second. */
const MS_PER_SECOND = 1000;
/** The seed a new world suggests in the screenshot scenarios (deterministic pictures). */
const SCENARIO_SEED = 4_711_042;

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

/** The tab's session storage (the start request), or null where the browser refuses it. */
function safeSessionStorage(): RequestStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Session seed of a direct boot: fixed; in debug mode `?seed=<u32>` selects another world. */
function sessionSeed(debug: boolean): number {
  if (!debug) return BOOT_SESSION_SEED;
  const raw = new URLSearchParams(location.search).get('seed');
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isSafeInteger(n) ? n : BOOT_SESSION_SEED;
}

/**
 * Whether the player appears on the start beach once the world is there in a direct boot: only with `?spieler=1` – the
 * screenshot scenarios and the M2 world tools (`tp`, debug figure, free title camera) and their E2E tests work on the
 * world without a player.
 */
function spawnsPlayer(): boolean {
  return new URLSearchParams(location.search).get('spieler') === '1';
}

/** Whether a screenshot scenario runs (debug mode with `?scenario=`). */
function runsScenario(debug: boolean): boolean {
  return debug && new URLSearchParams(location.search).get('scenario') !== null;
}

/** Missing translation keys are reported once each (never silently shown as a key, §31.4). */
function reportMissingTranslations(i18n: I18n): void {
  i18n.onMissing((key, lang) => console.error(`i18n: Schlüssel „${key}“ fehlt (${lang})`));
}

/** The menu's row of a stored world. */
function weltEintrag(m: WorldMeta): WeltEintrag {
  return { id: m.id, name: m.name, seed: m.seed, groesse: m.config.worldSize, tag: m.day, ticks: m.tick, gespeichert: m.savedAt };
}

/** Offers `bytes` as a file download named `name`. */
function download(name: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The stored worlds of the save database for the world selection (M7-50, M7-58). */
function weltQuelle(idb: IDBFactory): WeltQuelle {
  const withStore = openPerUse(() => openSaveDb(idb));
  return {
    liste: () => withStore(async (store) => (await store.listWorlds()).map(weltEintrag)),
    loeschen: (id) => withStore((store) => store.deleteWorld(id)),
    exportieren: (id) =>
      withStore(async (store) => {
        const file = await exportDhsave(store, id);
        download(file.fileName, file.bytes, 'application/gzip');
        return file.fileName;
      }),
    importieren: (datei) =>
      withStore(async (store) => weltEintrag(await importDhsave(store, datei.bytes, (w) => ({ worldId: newWorldId(Date.now(), w.seed), name: w.name })))),
  };
}

/** Copies `text` to the clipboard (false where the browser refuses: no permission, no secure context). */
async function kopieren(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** What the boot knows before the session exists. */
interface BootPlan {
  readonly art: BootArt;
  /** The save to start from (`laden`), or null. */
  readonly load: RecoveredWorldSave | null;
  /** Why a world could not be loaded (the main menu says so), or null. */
  readonly fehler: string | null;
}

/** The service worker of the installed game (M7-59, vite-plugin-pwa): caches the build, the game starts offline. */
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  registerSW({ immediate: true, onRegisterError: (err: unknown) => console.warn(`Service Worker: ${err instanceof Error ? err.message : String(err)}`) });
}

/** Boots the page as `plan` says (see the module comment). */
function boot(plan: BootPlan): void {
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
  // The quality level (§6.3) and every graphics and accessibility option reach every render strand – light, particles,
  // water, fog and post, world surface – at boot and on every change; the first start measures the level (M5-25, M5-26).
  startRenderQuality({ settings, quality: gfx.quality, search: location.search, debug: debugEnabled, now: () => performance.now() });

  const art = plan.art;
  const menu = art.art === 'menue';
  const load = plan.load?.save ?? null;
  const storage = safeSessionStorage();
  const config: SimConfigInput =
    art.art === 'menue' ? MENU_WORLD : art.art === 'neu' ? art.request.config : load !== null ? load.meta.config : { seed: sessionSeed(debugEnabled) };

  // The session's world: generated in the world worker, handed to the simulation, streamed from the
  // simulation's chunk store by the game view.
  const worldLoading = createWorldLoadingStatus();
  const worldReady = createBereitFlagge();
  let worldHost: WorldHost | null = null;
  // The path worker (M6-16, §19.4 "Pfadfindung im Worker"): the path service sends its snapshots there, once per frame; a
  // path counts from its ready tick whether the worker answered or the simulation computed it itself (ADR-0087).
  const pathJobs = createPathJobs({ spawn: () => new Worker(new URL('./world/path/path.worker.ts', import.meta.url), { type: 'module' }), now: () => performance.now() });
  const session = new GameSession({
    config,
    getGamepads: gamepadSource(window),
    simulation: {
      chunkJobs: () => {
        if (worldHost === null) throw new Error('Welt der Sitzung: kein Welt-Worker');
        return worldHost.createJobQueue();
      },
      pathJobs: pathJobs.jobs,
    },
  });
  const creatureSystem = session.sim.system('creatures');
  const creaturePaths = creatureSystem instanceof CreatureSystem ? creatureSystem.paths : null;
  // The main menu's scene (M7-50): the coast camp in time-lapse, kept by commands.
  const menuScene = menu ? startMenuScene(session) : null;

  // Saving (M7-57): every game boot saves through the save worker; the menu does not.
  const game = !menu;
  const world = art.art === 'neu' ? { id: art.request.worldId, name: art.request.name } : load !== null ? { id: load.meta.id, name: load.meta.name } : null;
  const target = world ?? { id: `welt-${session.sim.config.seed}`, name: i18n.t('ui.pause.weltName', { seed: String(session.sim.config.seed) }) };
  const service = game
    ? new SaveService({
        spawnWorker: () => new Worker(new URL('./save/save.worker.ts', import.meta.url), { type: 'module' }),
        access: openPerUse(() => openSaveDb(indexedDB)),
        onFallback: (reason) => console.warn(`Speichern im Hauptthread: ${reason}`),
      })
    : null;
  const autosaver =
    service === null
      ? null
      : new Autosaver({
          sim: session.sim,
          service,
          target: { worldId: target.id, name: target.name },
          now: () => Date.now(),
          clock: () => performance.now(),
          gameVersion: __DH_VERSION__,
          intervalMinutes: () => settings.get().game.autosaveMinutes,
          slots: plan.load === null ? [] : [{ slot: plan.load.save.slot, savedAt: plan.load.save.savedAt }, ...plan.load.skipped.map((s) => ({ slot: s.slot, savedAt: s.savedAt }))],
          onError: (err, kind) => console.error(`Speichern (${kind}) fehlgeschlagen: ${err.message}`),
        });
  // The writer starts with the chunk diffs the session starts with (a loaded slot's), so every slot gets what it lacks.
  void service?.begin({ worldId: target.id, diffs: load?.chunkDiffs ?? [] }).catch((err: unknown) => console.error(`Speichern vorbereiten: ${err instanceof Error ? err.message : String(err)}`));
  // Automatic saves: in every game started from the menu; on a direct debug page only with `&autosave=1`.
  const autosaveOn = autosaver !== null && (art.art === 'neu' || (art.art === 'laden' && !art.debug) || new URLSearchParams(location.search).get('autosave') === '1');
  // A new world's first save comes right after its first tick: from then on a reload of the tab resumes it.
  let firstSave = art.art === 'neu';

  const host = new WorldHost({
    seed: session.sim.config.seed,
    preset: session.sim.config.worldSize,
    resourceDensity: session.sim.config.resourceDensity ?? 'normal',
    spawnWorker: () => new Worker(new URL('./world/gen/world.worker.ts', import.meta.url), { type: 'module' }),
    now: () => performance.now(),
    adopt: (generated) => {
      session.sim.world.provide(generated);
      // A loaded save goes in before the first tick and before any chunk is resident.
      if (load !== null) restoreInto(session.sim, load.snapshot, load.chunkDiffs);
      return session.sim.world.chunks;
    },
    onProgress: (p) => worldLoading.step(p.step, p.index, p.count),
    onReady: () => {
      worldLoading.done();
      worldReady.setzen();
      if (menuScene !== null && host.world !== null) menuScene.start(host.world);
      else if (art.art === 'neu') {
        // The world's first commands (the new-world screen's settings, the character), then the player on the start beach.
        for (const raw of art.request.commands) {
          try {
            session.command(raw);
          } catch (err) {
            console.error(`Startbefehl verworfen: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        session.command({ type: 'player.spawn' });
      } else if (load === null && spawnsPlayer()) session.command({ type: 'player.spawn' });
      loop.resume(WORLD_PAUSE_REASON);
    },
    // Without its world the session cannot start: the title or the loading screen names the reason.
    onError: (message) => worldLoading.fail(message),
  });
  worldHost = host;
  // Audio kernel (M3-33, src/audio/runtime.ts): simulation events → sounds, mixer on the audio settings;
  // the AudioContext starts with the first input (autoplay policy) and pauses with a hidden tab. The menu hears its camp.
  const audio = attachAudio({ session: menuScene !== null ? menuAudioView(session, menuScene) : session, settings, gestureTarget: window, visibility: document });
  // The build mode (M4-22): its choice and the ghost's verdicts, shared by the build mode's screen and the game view.
  const bau = new BuildGhost();
  gfx.attachGame({
    session: menuScene !== null ? menuRenderView(session) : session,
    host,
    lang: () => i18n.lang,
    onClipEvent: (event, _x, _y, _layer, cycle) => audio.clipEvent(event, cycle),
    hudShowsHint: () => !menu && !bau.active && hudZeigtHinweis(uiRoot.style.visibility !== 'hidden', settings.get().game.hudMode),
    ...(menu ? {} : { build: bau }),
    reducedMotion: () => settings.get().accessibility.reducedMotion,
    screenshake: () => settings.get().accessibility.screenshake,
    damageNumbers: () => settings.get().game.damageNumbers,
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
  // Speed of time: in the game the game speed of the settings (§29) × what the simulation asks for (×30 while the player
  // sleeps, §11.5); in the menu its time-lapse. Within the loop's limit; set only when it changes (the debug `speed` stays).
  let appliedTimeScale = Number.NaN;
  const applyTimeScale = (): void => {
    const want = menuScene !== null ? menuScene.timeScale(settings.get().accessibility.reducedMotion) : settings.get().accessibility.gameSpeed * session.timeScale;
    const scale = Math.min(MAX_TIME_SCALE, want);
    if (scale === appliedTimeScale) return;
    appliedTimeScale = scale;
    loop.setTimeScale(scale);
  };
  // The frame clock under the FPS limit (M7-55): 0 = every animation frame of the display, else at most that many.
  const clock = limitedAnimationFrameClock(window, () => settings.get().graphics.fpsLimit);
  const loop = new FixedStepLoop({
    ...clock,
    stepHz: BALANCE.time.tickHz,
    maxCatchUp: BALANCE.time.maxCatchUpSteps,
    beginFrame: (frameSeconds) => {
      frameStartMs = performance.now();
      // Answers of the path worker arrive before this frame's ticks poll them; new snapshots go out.
      creaturePaths?.frame();
      session.beginFrame();
      // The menu scene's keeper sends its commands before the frame's ticks.
      menuScene?.frame();
      // Saves are captured between two ticks: here, before this frame's.
      if (autosaver !== null && worldReady.gesetzt) {
        if (firstSave && session.sim.tick > 0) {
          firstSave = false;
          void autosaver.save('main').then((r) => {
            if (r !== null && art.art === 'neu') writeStartRequest(storage, { kind: 'load', worldId: target.id });
          });
        }
        if (autosaveOn) autosaver.frame(frameSeconds * MS_PER_SECOND, !loop.paused);
      }
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
    if (next.accessibility.gameSpeed !== prev.accessibility.gameSpeed || next.accessibility.reducedMotion !== prev.accessibility.reducedMotion) applyTimeScale();
  });
  // Autosave when the player lies down (§28 "beim Schlafen").
  if (autosaveOn) session.onEvent('sleepStarted', () => void autosaver?.save('auto'));

  setDebugPageHooks({
    ...(autosaver === null || service === null
      ? {}
      : {
          saver: {
            save: (kind) => autosaver.save(kind),
            get savedCount() {
              return autosaver.savedCount;
            },
            get failedCount() {
              return autosaver.failedCount;
            },
            get lastCaptureMs() {
              return autosaver.lastCaptureMs;
            },
            get lastHandOffMs() {
              return autosaver.lastHandOffMs;
            },
            get inWorker() {
              return service.inWorker;
            },
          },
        }),
    frameLimit: () => clock.stats,
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
    loadedWorld: art.art === 'laden' && art.debug ? art.worldId : null,
  });

  if (menu) {
    mountApp(appHost, { i18n, screen: { kind: 'menu', bridge, hooks: menuHooks(settings, storage, audio, plan.fehler) } });
  } else {
    // Menus (M3-31): settings that take effect live, the pause menu's own pause reason, saving the running world into the
    // main slot (between two ticks: the menu has paused the loop), the world's settings, back to the title, the sounds.
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
        if (autosaver === null) return { ok: false, error: i18n.t('ui.pause.keinSpeicher') };
        const failed = autosaver.failedCount;
        // Null: a save of the main slot was already waiting – it carries this same paused state; wait for it.
        if ((await autosaver.save('main')) === null) await autosaver.settled();
        return autosaver.failedCount === failed ? { ok: true, day, minuteOfDay } : { ok: false, error: i18n.t('ui.pause.speichernNichtMoeglich') };
      },
      toTitle: () => {
        // A game started from the menu returns to it; a direct debug page boots afresh.
        if (art.art !== 'direkt') clearStartRequest(storage);
        location.reload();
      },
      welt: {
        sample: (out) => session.sampleWorldSettings(out),
        command: (cmd) => {
          session.command(cmd);
        },
      },
      klang: audio,
    };
    // HUD world displays (M3-28/M3-29): minimap source and notification queue of the session, new warnings and discoveries sound.
    const hudWelt = hudWeltdienste(session, { klang: audio });
    // The death screen (M3-26) shows over everything while the player's light is out – not in screenshot
    // scenarios, which compose their screens themselves (`todesbildschirm` shows a representative death).
    const death = runsScenario(debugEnabled) ? undefined : createDeathScreenModel(session);
    // A game started from the menu shows the loading screen until the world stands (with a notice of a recovered save).
    const laden: LadeQuelle | undefined =
      art.art === 'direkt' || (art.art === 'laden' && art.debug)
        ? undefined
        : {
            welt: target.name,
            fortschritt: worldLoading.view,
            bereit: worldReady.signal,
            hinweis: festerHinweis(recoveryNotice(i18n, plan.load)),
            zufall: () => Math.random(),
            zumTitel: () => {
              clearStartRequest(storage);
              location.reload();
            },
          };
    mountApp(appHost, { i18n, screen: { kind: 'game', bridge, worldLoading: worldLoading.view, menus, hudWelt, death, untertitel: audio, bau, ...(laden === undefined ? {} : { laden }) } });
  }
  loop.start();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // §28 "Autosave … bei visibilitychange": the state as the player left it, before the loop rests.
      if (autosaveOn && worldReady.gesetzt) void autosaver?.save('auto');
      loop.pause(HIDDEN_PAUSE_REASON);
    } else loop.resume(HIDDEN_PAUSE_REASON);
  });
  // §28 "beim Verlassen": leaving the page (closing the tab, navigating away) writes an autosave.
  window.addEventListener('pagehide', () => {
    if (autosaveOn && worldReady.gesetzt) void autosaver?.save('auto');
  });
  debug?.setReady();

  /** The main menu's hooks: the settings, the stored worlds, the start of a world (start request + reload). */
  function menuHooks(store: SettingsStore, requests: RequestStorage | null, klang: HauptmenueHooks['klang'], fehler: string | null): HauptmenueHooks {
    return {
      settings: store,
      welten: weltQuelle(indexedDB),
      starten: (request: StartRequest) => {
        if (!writeStartRequest(requests, request)) console.error('Startauftrag: der Sitzungsspeicher des Browsers ist gesperrt.');
        location.reload();
      },
      kopieren,
      jetzt: () => Date.now(),
      zufallsSeed: runsScenario(true) && isDebugEnabled(location.href, false) ? () => SCENARIO_SEED : () => Math.floor(Math.random() * SEED_RANGE),
      ...(klang === undefined ? {} : { klang }),
      version: __DH_VERSION__,
      ...(fehler === null ? {} : { meldung: fehler }),
    };
  }
}

/** The loading screen's notice when the newest save was damaged and an older slot was loaded (§28), or null. */
function recoveryNotice(i18n: I18n, load: RecoveredWorldSave | null): string | null {
  if (load === null || load.skipped.length === 0) return null;
  const zeit = new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'short', timeStyle: 'short' }).format(load.save.savedAt);
  return i18n.t('ui.laden.wiederhergestellt', { slot: i18n.t(`ui.laden.slot.${load.save.slot.startsWith('auto') ? 'auto' : 'main'}`), zeit });
}

/** Reads what the boot needs before the session exists: the request of the tab and, to load a world, its save. */
async function plan(): Promise<BootPlan> {
  const debug = isDebugEnabled(location.href, false);
  const storage = safeSessionStorage();
  const art = bootArt(location.href, debug, readStartRequest(storage), isMenuScenario);
  if (art.art !== 'laden') return { art, load: null, fehler: null };
  try {
    return { art, load: await readWorldForBoot(indexedDB, art.worldId), fehler: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Spielstand „${art.worldId}“ ließ sich nicht laden: ${message}`);
    // A debug load falls back to a fresh direct session (as before M7); a world from the menu back to the menu.
    if (art.debug) return { art: { art: 'direkt' }, load: null, fehler: null };
    clearStartRequest(storage);
    return { art: { art: 'menue' }, load: null, fehler: message };
  }
}

// Debug pages never install the service worker: the tools and E2E tests always see the build they were started with.
if (!isDebugEnabled(location.href, false)) registerServiceWorker();
void plan().then(boot);
