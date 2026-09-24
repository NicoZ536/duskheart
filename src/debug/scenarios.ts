/**
 * Screenshot-/Bench-Szenarien (MASTERPROMPT §31.5): deterministisch (fester Seed, eingefrorene Zeit, festes Wetter).
 * Jedes Szenario stellt den Zustand her und meldet, ab wann das Bild stabil ist.
 */
import type { ScenarioRender } from '../render/runtime';
import { WORLD_OVERLAYS, type WorldOverlay } from '../render/debugOverlay';
import type { GameCameraStart } from '../render/world/gameScene';
import { TILE_PX } from '../world/model/coords';
import { VIEWPORT_EXAMPLES, type ViewportExample } from '../render/viewport';
import { NORMALMAP_LIGHT_TIME, POST_BASE_TIME } from '../render/light/lightScenes';
import { createI18n, FALLBACK_LANG, isLang, type I18n } from '../i18n';
import { mountGallery, type GalleryKind } from '../ui/kit';
import { activeGameScreens } from '../ui/focus/GameScreens';
import { atlasImagesVersion } from '../ui/screens/inventar/itemIcons';
import { mountHudSzenario, type HudSzenario, type HudSzenarioArt } from '../ui/hud/minimap/szenario';
import { deathScreenScenario } from '../ui/screens/tod/szenario';
import { BALANCE } from '../content/balance';
import { FEEDBACK_SCENARIO, FEEDBACK_TICKS, feedbackScript, feedbackSetup } from '../render/game/effectsScenario';
import { hudModusSzenario } from '../ui/hud/szenario';
import { lightScenarios } from '../render/game/lightsSzenario';
import type { SessionDebugState } from '../game/session';
import { conditionScenarios } from './zustandScenarios';
import { swimScenario } from './schwimmenScenario';

export interface ScenarioContext {
  /** Freeze presentation time at `seconds` (the frame is then fully deterministic). */
  freezeAt(seconds: number): void;
  /**
   * Renderer control (scene, render debugger). The browser page provides it; scenarios that need it
   * throw when it is missing instead of showing a wrong image.
   */
  readonly render?: ScenarioRender;
  /**
   * The running session: game commands and single simulation steps while the scenario's time is
   * frozen (a scenario that needs a figure spawns it and steps exactly once – deterministic).
   */
  readonly session?: ScenarioSession;
  /** The entity inspector (M3-35): pick at a canvas point [CSS px]; the canvas size [CSS px]. */
  readonly inspector?: { at(cssX: number, cssY: number): boolean; canvas(): { width: number; height: number } };
}

/** What a scenario may do with the session. */
export interface ScenarioSession {
  command(raw: unknown): unknown;
  step(): void;
  /** Reads the session's state (`GameSession.debugState`), e.g. to wait until the player reached a condition. */
  state(): SessionDebugState;
}

/** A browser viewport (CSS px at device pixel ratio 1) and the internal image size §4.2 expects for it. */
export type ScenarioViewport = ViewportExample;

export interface Scenario {
  readonly name: string;
  readonly description: string;
  /** Frames to render after setup before the image counts as stable. */
  readonly settleFrames: number;
  /**
   * Viewports to shoot (`npm run shot` writes `<name>-<w>x<h>.png` each and checks the internal size
   * and the sharpness of the scaled pixels); absent = one shot at the default viewport.
   */
  readonly viewports?: readonly ScenarioViewport[];
  setup(ctx: ScenarioContext): void;
  /**
   * Optional: false while the scenario still prepares asynchronously (fonts, decoded images). The
   * image counts as stable once `settleFrames` have passed and this returns true.
   */
  ready?(): boolean;
}

function renderOf(ctx: ScenarioContext, scenario: string): ScenarioRender {
  if (!ctx.render) throw new Error(`Szenario ${scenario} braucht den Renderer (ScenarioContext.render fehlt)`);
  return ctx.render;
}

/** Frames until a render scene is stable (scene switch, first upload, one presented frame). */
const RENDER_SETTLE_FRAMES = 3;

/** A scenario that shows a render scene, optionally through the render debugger. */
function renderScenario(name: string, description: string, scene: Parameters<ScenarioRender['showScene']>[0], time: number, debugView = 'off'): Scenario {
  return {
    name,
    description,
    settleFrames: RENDER_SETTLE_FRAMES,
    setup(ctx) {
      const r = renderOf(ctx, name);
      r.showScene(scene);
      r.setDebugView(debugView);
      ctx.freezeAt(time);
    },
  };
}

/** A render scenario whose scene loads data first (the game atlas): stable once the scene reports ready. */
function loadingRenderScenario(name: string, description: string, scene: Parameters<ScenarioRender['showScene']>[0], time: number, debugView = 'off'): Scenario {
  const base = renderScenario(name, description, scene, time, debugView);
  let render: ScenarioRender | null = null;
  return {
    ...base,
    setup(ctx) {
      render = renderOf(ctx, name);
      base.setup(ctx);
    },
    ready: () => render?.sceneReady() ?? false,
  };
}

/**
 * Frames a gallery scenario waits before it counts as stable – long enough for loading the web font,
 * baking the glyph atlas and decoding the UI graphics also where `ready()` is not consulted.
 */
const GALLERY_SETTLE_FRAMES = 45;

/** UI texts of the gallery in the page language; missing keys are console errors (never silent). */
function galleryI18n(doc: Document): I18n {
  const lang = doc.documentElement.lang;
  const i18n = createI18n(isLang(lang) ? lang : FALLBACK_LANG);
  i18n.onMissing((key, l) => console.error(`i18n: Schlüssel „${key}“ fehlt (${l})`));
  return i18n;
}

/** A scenario that shows a UI kit gallery (src/ui/kit/gallery.tsx) over the page. */
function galleryScenario(kind: GalleryKind, description: string): Scenario {
  let ready = (): boolean => false;
  return {
    name: kind,
    description,
    settleFrames: GALLERY_SETTLE_FRAMES,
    setup(ctx) {
      const gallery = mountGallery(kind, document, galleryI18n(document));
      ready = () => gallery.ready;
      ctx.freezeAt(0);
    },
    ready: () => ready(),
  };
}

/** Presentation time of the Grünhain clearing in its screenshots (torch flames mid-flicker). */
const GRUENHAIN_TIME = 2.6;
/** Presentation time of the world-UI scenario: damage and healing numbers mid-rise. */
const WORLD_UI_TIME = 0.5;
/** Presentation time of the world scenes (M2-28): trees mid-sway, torch flames mid-flicker. */
const WORLD_TIME = 1.3;

/**
 * A scenario of the game view (the session's world, M2-29): where its free camera starts, which debug
 * overlays are on and whether a figure stands in the picture's centre (spawned once the view is
 * complete, followed by exactly one simulation step: the active zone forms around it). Stable once the
 * world streamed in and the figure stands.
 */
function gameScenario(name: string, description: string, start: GameCameraStart, overlays: readonly WorldOverlay[], figure: boolean): Scenario {
  let render: ScenarioRender | null = null;
  let session: ScenarioSession | null = null;
  let placed = !figure;
  return {
    name,
    description,
    settleFrames: RENDER_SETTLE_FRAMES,
    setup(ctx) {
      render = renderOf(ctx, name);
      if (figure && ctx.session === undefined) throw new Error(`Szenario ${name} braucht die Sitzung (ScenarioContext.session fehlt)`);
      session = ctx.session ?? null;
      render.startGameCamera(start);
      for (const o of WORLD_OVERLAYS) render.setOverlay(o, overlays.includes(o));
      render.showScene('spiel');
      render.setDebugView('off');
      ctx.freezeAt(WORLD_TIME);
    },
    ready() {
      const r = render;
      if (r === null || !r.sceneReady()) return false;
      if (!placed) {
        const at = r.gameCamera();
        if (at === null || session === null) return false;
        session.command({ type: 'spawnDebugMover', x: at.tx * TILE_PX + TILE_PX / 2, y: at.ty * TILE_PX + TILE_PX / 2, controlled: true });
        session.step();
        placed = true;
        return false;
      }
      return true;
    },
  };
}

/**
 * Items of the `ui-inventar` scenario (M3-30): gathered T0 resources and food in the inventory, some on
 * the hotbar and in the belt – every one from the game's content, given through `inventory.give`.
 */
const MENU_SCENARIO_ITEMS: ReadonlyArray<readonly [string, number]> = [
  ['holz', 64],
  ['zweig', 23],
  ['stein', 41],
  ['feuerstein', 7],
  ['fasern', 38],
  ['himbeeren', 14],
  ['harz', 5],
  ['lehm', 12],
  ['leuchtpilz', 4],
  ['steinpilz', 3],
  ['apfel', 6],
  ['setzling_eiche', 2],
  ['muschel', 9],
  ['salpeter', 2],
  ['walnuss', 11],
];
/** Moves after giving: inventory slot → hotbar/belt slot. */
const MENU_SCENARIO_MOVES: ReadonlyArray<readonly [number, 'schnellleiste' | 'guertel', number]> = [
  [0, 'schnellleiste', 0],
  [3, 'schnellleiste', 1],
  [4, 'schnellleiste', 2],
  [10, 'guertel', 0],
];

/**
 * A scenario of a menu screen over the game view (M3-30, M3-31): the player stands on the start beach
 * (spawned once the view is complete, one simulation step), the scenario opens the screen through the
 * page's screen stack and puts the keyboard focus frame on `focusSelector`. `prepare` runs once the
 * screen is open (e.g. switching to a sub-view). Stable once the item icons are decoded.
 */
function menuScenario(name: string, description: string, screen: string, focusSelector: string, withItems: boolean, prepare?: () => void): Scenario {
  let render: ScenarioRender | null = null;
  let session: ScenarioSession | null = null;
  let phase: 'welt' | 'spieler' | 'offen' | 'fokus' | 'fertig' = 'welt';
  return {
    name,
    description,
    settleFrames: GALLERY_SETTLE_FRAMES,
    setup(ctx) {
      render = renderOf(ctx, name);
      if (ctx.session === undefined) throw new Error(`Szenario ${name} braucht die Sitzung (ScenarioContext.session fehlt)`);
      session = ctx.session;
      render.startGameCamera({ kind: 'titel' });
      for (const o of WORLD_OVERLAYS) render.setOverlay(o, false);
      render.showScene('spiel');
      render.setDebugView('off');
      ctx.freezeAt(WORLD_TIME);
    },
    ready() {
      if (render === null || session === null || !render.sceneReady()) return false;
      const ui = activeGameScreens();
      if (ui === null) return false;
      switch (phase) {
        case 'welt':
          session.command({ type: 'player.spawn' });
          if (withItems) {
            for (const [item, count] of MENU_SCENARIO_ITEMS) session.command({ type: 'inventory.give', item, count });
            for (const [from, bereich, index] of MENU_SCENARIO_MOVES) session.command({ type: 'inventory.move', from: { bereich: 'inventar', index: from }, to: { bereich, index } });
          }
          session.step();
          phase = 'spieler';
          return false;
        case 'spieler':
          if (!ui.controller.open(screen)) return false;
          phase = 'offen';
          return false;
        case 'offen':
          prepare?.();
          phase = 'fokus';
          return false;
        case 'fokus': {
          const el = document.querySelector(focusSelector);
          if (!(el instanceof HTMLElement)) return false;
          ui.focus.keysUsed();
          ui.focus.focus(el);
          phase = 'fertig';
          return false;
        }
        case 'fertig':
          // Item icons and the figure come from the decoded game atlas.
          return !withItems || atlasImagesVersion.value > 0;
      }
    },
  };
}

/**
 * A scenario of the world HUD (M3-28 minimap, day disc and compass bar; M3-29 notifications) over the game
 * view at the start beach: the player stands at the camera tile facing north, 17:20 on a clear spring day
 * (src/ui/hud/minimap/szenario.tsx). Stable once the view is complete and the HUD has drawn with its
 * symbols and font.
 */
/** Simulation ticks the gathering scenario runs per rendered frame (the presentation clock moves as far). */
const FEEDBACK_TICKS_PER_FRAME = 4;
/** Frames the gathering scenario waits after moving the player before it trusts that the new place streamed in. */
const FEEDBACK_MOVE_FRAMES = 10;

/**
 * The gathering feedback (M3-15, src/render/game/effectsScenario.ts): after one setup tick (player, 11:00,
 * stone axe, the tile west of the birch) and once the view at that place is complete, the script runs a few
 * simulation ticks per frame and moves the frozen presentation clock by as much – so the felled birch
 * tips over, lands and throws out its pieces in the same rhythm as in the game – and stops at the picture.
 */
function feedbackScenario(): Scenario {
  let render: ScenarioRender | null = null;
  let session: ScenarioSession | null = null;
  let freezeAt: ((seconds: number) => void) | null = null;
  let phase: 'welt' | 'ort' | 'spiel' | 'fertig' = 'welt';
  let waited = 0;
  let tick = 0;
  const script = feedbackScript();
  return {
    name: FEEDBACK_SCENARIO,
    description:
      'M3-15: Sammel-Feedback – die Figur fällt mit der Steinaxt eine Birke nahe dem Startstrand (fünf Hiebe, Splitter von der Schlagseite weg), die Birke ist nach Osten gefallen: Holz, Zweige, Rinde und Laub fliegen in Bögen aus dem Stamm, Staub steigt auf, Blätter wirbeln; über dem Stumpf steht der Fortschrittsring nach dem ersten von zwei Hieben auf halb',
    settleFrames: RENDER_SETTLE_FRAMES,
    setup(ctx) {
      render = renderOf(ctx, FEEDBACK_SCENARIO);
      if (ctx.session === undefined) throw new Error(`Szenario ${FEEDBACK_SCENARIO} braucht die Sitzung (ScenarioContext.session fehlt)`);
      session = ctx.session;
      freezeAt = (seconds) => ctx.freezeAt(seconds);
      render.startGameCamera({ kind: 'titel' });
      for (const o of WORLD_OVERLAYS) render.setOverlay(o, false);
      render.showScene('spiel');
      render.setDebugView('off');
      ctx.freezeAt(WORLD_TIME);
    },
    ready() {
      if (render === null || session === null || freezeAt === null) return false;
      switch (phase) {
        case 'welt':
          if (!render.sceneReady()) return false;
          for (const cmd of feedbackSetup()) session.command(cmd);
          session.step();
          phase = 'ort';
          return false;
        case 'ort':
          if (++waited < FEEDBACK_MOVE_FRAMES || !render.sceneReady()) return false;
          phase = 'spiel';
          return false;
        case 'spiel':
          for (let k = 0; k < FEEDBACK_TICKS_PER_FRAME && tick < FEEDBACK_TICKS.end; k++, tick++) {
            for (const s of script) if (s.at === tick) session.command(s.command);
            session.step();
          }
          freezeAt(WORLD_TIME + tick / BALANCE.time.tickHz);
          if (tick >= FEEDBACK_TICKS.end) phase = 'fertig';
          return false;
        case 'fertig':
          return render.sceneReady();
      }
    },
  };
}

/** Internal render height (§4.2): the canvas's CSS px per internal pixel is its height over this. */
const INTERNAL_HEIGHT = 270;
/** Where the inspector scenario clicks: this many internal px above the player's feet (the torso). */
const INSPECT_ABOVE_FEET = 10;

/**
 * The entity inspector (M3-35, `inspector.ts`): the player on the start beach at midday with a thrown
 * flint lying beside them; the scenario clicks the player's torso in the middle of the view, and the
 * inspector lists the player's components (position, player, vitals) with their fields.
 */
function inspectorScenario(): Scenario {
  let render: ScenarioRender | null = null;
  let session: ScenarioSession | null = null;
  let inspector: NonNullable<ScenarioContext['inspector']> | null = null;
  let phase: 'welt' | 'wurf' | 'klick' | 'fertig' = 'welt';
  return {
    name: 'debug-inspektor',
    description: 'M3-35: Entitäts-Inspektor – Klick auf den Spieler am Startstrand um 11:00 (ein geworfener Feuerstein liegt daneben): das Feld rechts listet die Komponenten position, player und vitals mit allen Feldern',
    settleFrames: RENDER_SETTLE_FRAMES,
    setup(ctx) {
      render = renderOf(ctx, 'debug-inspektor');
      if (ctx.session === undefined || ctx.inspector === undefined) throw new Error('Szenario debug-inspektor braucht Sitzung und Inspektor');
      session = ctx.session;
      inspector = ctx.inspector;
      render.startGameCamera({ kind: 'titel' });
      for (const o of WORLD_OVERLAYS) render.setOverlay(o, false);
      render.showScene('spiel');
      render.setDebugView('off');
      ctx.freezeAt(WORLD_TIME);
    },
    ready() {
      if (render === null || session === null || inspector === null || !render.sceneReady()) return false;
      switch (phase) {
        case 'welt': {
          session.command({ type: 'setTime', hour: 11, minute: 0 });
          session.command({ type: 'player.spawn' });
          session.step();
          const at = session.state().player;
          if (at === null) return false;
          session.command({ type: 'inventory.give', item: 'feuerstein', count: 1 });
          session.command({ type: 'action.throw', from: { bereich: 'inventar', index: 0 }, x: at.x + 3 * 16, y: at.y + 16 });
          for (let i = 0; i < INSPECT_SETTLE_TICKS; i++) session.step();
          phase = 'wurf';
          return false;
        }
        case 'wurf':
          phase = 'klick';
          return false;
        case 'klick': {
          const c = inspector.canvas();
          const scale = c.height / INTERNAL_HEIGHT;
          if (!inspector.at(c.width / 2, c.height / 2 - INSPECT_ABOVE_FEET * scale)) return false;
          phase = 'fertig';
          return false;
        }
        case 'fertig':
          return render.sceneReady();
      }
    },
  };
}
/** Ticks the inspector scenario lets the thrown flint fly and land (48 ticks of flight, then it settles). */
const INSPECT_SETTLE_TICKS = 90;

function hudScenario(name: string, description: string, art: HudSzenarioArt): Scenario {
  let render: ScenarioRender | null = null;
  let hud: HudSzenario | null = null;
  return {
    name,
    description,
    settleFrames: RENDER_SETTLE_FRAMES,
    setup(ctx) {
      const r = renderOf(ctx, name);
      render = r;
      r.startGameCamera({ kind: 'titel' });
      for (const o of WORLD_OVERLAYS) r.setOverlay(o, false);
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(WORLD_TIME);
      hud = mountHudSzenario(document, { art, kachel: () => (r.sceneReady() ? r.gameCamera() : null), ...(ctx.session === undefined ? {} : { seite: ctx.session }) });
    },
    ready: () => (render?.sceneReady() ?? false) && (hud?.bereit ?? false),
  };
}

export const SCENARIOS: readonly Scenario[] = [
  {
    name: 'testszene',
    description: 'M0-Testszene: Palettenrampen unter wanderndem Warmlicht mit Licht-Bänderung und Bayer-Dither',
    settleFrames: 3,
    setup(ctx) {
      ctx.render?.showScene('testszene');
      ctx.freezeAt(1.7);
    },
  },
  renderScenario('palette-swap', 'M1-11: derselbe Baum in vier Palettenzeilen (Sommer, Herbst, Winter, Verderbnis), dieselbe Figur in vier Trachten', 'palette-swap', 0.5),
  renderScenario('ysort', 'M1-15: Boden → Wassermaske → y-sortierte Objekte → Kronen; Figur hinter und vor dem Baum, Durchblick-Kreis unter der Krone', 'ysort', 0.3),
  renderScenario('anim-layers', 'M1-16: Figur mit Helm, Schwert und Fackel in vier Richtungen, Ruhe + vier Gehphasen, Ausrüstung an den Sockeln jedes Frames', 'anim-layers', 0.2),
  renderScenario('gbuffer-albedo', 'M1-17: G-Buffer G0 – Albedo aus der Paletten-LUT', 'gbuffer', 0.4, 'albedo'),
  renderScenario('gbuffer-normal', 'M1-17: G-Buffer G1 – Normalen (Relief aus der Silhouette, gespiegelt und rotiert mit dem Sprite)', 'gbuffer', 0.4, 'normal'),
  renderScenario('gbuffer-emissiv', 'M1-17: G-Buffer G2 – emissive Pixel (Fackeln, Leuchtpilze, Interaktions-Outline) in ihrer Farbe', 'gbuffer', 0.4, 'emissive'),
  renderScenario('sprites-5000', 'M1-12: 5 000 animierte Sprites in höchstens vier instanzierten Draw-Calls', 'sprites-5000', 1),
  loadingRenderScenario(
    'gruenhain',
    'M1-26: Grünhain-Lichtung hinter dem Titel bei Einbruch der Nacht – warme Fackelinseln (Gras golden, nicht limettengrün) in kühlem blau-violettem Mondlicht',
    'gruenhain',
    GRUENHAIN_TIME,
  ),
  loadingRenderScenario('tilemap', 'M1-13: vier Boden-Chunks der Kachelkarte treffen sich in der Bildmitte – Wiese mit Varianten und ein Weg über die Chunkgrenze, ohne Nähte', 'tilemap', 0.5),
  {
    ...loadingRenderScenario(
      'aufloesungen',
      'M1-14/M1-25: dieselbe Grünhain-Lichtung (Szene hinter dem Titel) bei 1920×1080, 2560×1440, 3440×1440 und 3840×2160 – interne Größe nach §4.2, scharfe quadratische Pixel',
      'gruenhain',
      GRUENHAIN_TIME,
    ),
    viewports: VIEWPORT_EXAMPLES,
  },
  loadingRenderScenario('palette', 'M1-11/M1-25: dieselben Grünhain-Sprites und Bodenkacheln in vier Palettenzeilen (Sommer, Herbst, Winter, Verderbnis) – nur die Zeile der Paletten-LUT unterscheidet sich', 'palette', 0.5),
  loadingRenderScenario('welt-ui', 'M1-23: weltnahe UI im WebGL-Pass – Namen, Lebens- und Ausdauerleisten, Schadens- und Heilzahlen, Interaktionsmarker mit Taste, Gegenstände in Raritätsfarbe; pixelscharf nach Licht und Post', 'welt-ui', WORLD_UI_TIME),
  loadingRenderScenario('normalmap', 'M1-18: Lichtung bei Nacht – wanderndes Punktlicht, flackernde Fackel und Lumenit-Glühen, Relief aus den Normal-Maps (Lichtseite hell, Schattenseite im Blau der Nacht)', 'normalmap-licht', NORMALMAP_LIGHT_TIME),
  loadingRenderScenario('post-grundlage', 'M1-19: Lichtung in der Dämmerung – HDR-Licht über 1 an der Tonemapping-Schulter, Lichtbänder mit Bayer-Dither, Outline nach der Post-Kette, Kamera auf Subpixel-Position', 'post-grundlage', POST_BASE_TIME),
  loadingRenderScenario('licht-debug', 'M1-17: Render-Debugger – Punktlicht-Puffer („light“) der Nacht-Lichtung', 'normalmap-licht', NORMALMAP_LIGHT_TIME, 'light'),
  loadingRenderScenario(
    'gruenhain-tag',
    'M2-28: generierte Welt (Seed 20260924, Klein) im Grünhain bei Tag – Autotiles, Höhenstufen mit Klippen und Rampen, Wasser, y-sortierte Bäume und Streudeko im Sommer',
    'gruenhain-tag',
    WORLD_TIME,
  ),
  loadingRenderScenario('frostkamm-tag', 'M2-28: generierte Welt im Frostkamm bei Tag – Schnee und Gletschereis auf den Höhen, Steinklippen, verschneite Tannen im Winter', 'frostkamm-tag', WORLD_TIME),
  loadingRenderScenario('glutsand-tag', 'M2-28: generierte Welt im Glutsand bei Tag – Sand mit Hartboden, Sandsteinklippen in Stufen, Palmen, Kakteen und Felsen', 'glutsand-tag', WORLD_TIME),
  loadingRenderScenario('ebene-1-roh', 'M2-28: Ebene −1 (Wurzelhöhlen) roh – Umgebungslicht ≈ 0, ein Pilzhain nur von stehenden Fackeln und Leuchtpilzen erhellt, Fels als Masse mit Wandfront', 'ebene-1-roh', WORLD_TIME),
  gameScenario(
    'spiel-titel',
    'M2-29: Bild hinter dem Titel – die Spielansicht auf der Welt der Sitzung (Seed 20260923, Mittel) am Startstrand, Kamera zum nächsten offenen Meer versetzt: Strand, Brandung, Salzküsten-Vegetation',
    { kind: 'titel' },
    [],
    false,
  ),
  gameScenario(
    'overlay-chunks',
    'M2-29: Overlay Chunks – Figur im Grünhain-Schaufenster, aktive Zone grün, eingefrorene residente Chunks blau, ladende gelb, fehlende rot, Chunk-Koordinaten in der Ecke',
    { kind: 'biom', biome: 'gruenhain' },
    ['chunks'],
    true,
  ),
  gameScenario(
    'overlay-kollision',
    'M2-29: Overlay Kollision – Grünhain-Schaufenster: Klippenwände violett, Bäume und Felsen holzfarben, tiefes Wasser blau, Rampen und Treppen als grüne Marken',
    { kind: 'biom', biome: 'gruenhain' },
    ['kollision'],
    true,
  ),
  gameScenario(
    'overlay-temperatur',
    'M2-29: Overlay Temperaturfeld – Frostkamm-Schaufenster im Frühling um 06:00: 5-°C-Bänder von Blau bis Rot, je Höhenstufe −3 °C, Werte alle acht Kacheln',
    { kind: 'biom', biome: 'frostkamm' },
    ['temperatur'],
    true,
  ),
  galleryScenario('schrift', 'M1-20: Pixelschrift im DOM und per WebGL-Glyphenatlas nebeneinander (4×, 2×, 1×; „Größe Übermäßig Ärger“, ÄÖÜäöüß, Schatten, Kontur)'),
  galleryScenario('ui-kit', 'M1-21: UI-Kit (Holz, Eisen, Pergament, Slots, Schaltflächen in allen Zuständen, Leisten, Pixel-Scrollbar) bei 1×–4×'),
  menuScenario(
    'ui-inventar',
    'M3-30: Inventar-Bildschirm über dem Startstrand – Ausrüstung mit Figur, Gürtel und Rucksack-Platz, 30 Plätze mit gesammelten T0-Rohstoffen und Nahrung, Schnellleiste, Sortieren und Mülleimer, Werte; Fokusrahmen auf den Himbeeren mit Tooltip (Frische, Nährwerte, Herkunft, Verwendung)',
    'inventar',
    '[data-slot="inventar:5"]',
    true,
  ),
  hudScenario(
    'hud-minimap',
    'M3-28: Minimap oben rechts über dem Startstrand – runde Karte aus den Chunkdaten (Strand, Meer, Dünen, Wald), Eisenring mit Tageszeit-Scheibe (Sonne tief im Westen um 17:20), Spielerpfeil nach Norden, Startstrand- und Grab-Marker, Schild mit Wetter, Tag und Jahreszeit, Zoom-Knöpfe; Kompassbalken oben mittig mit Marker',
    'minimap',
  ),
  hudScenario(
    'hud-meldungen',
    'M3-29: Benachrichtigungen unten links – Entdeckung (Goldstreifen), „Die Dunkelheit naht“ (Warnung), gestapelt „Feuerstein ×3“ und „Leuchtpilz ×2“ in Raritätsfarbe; zwei weitere warten (nie mehr als vier sichtbar)',
    'meldungen',
  ),
  menuScenario('ui-pause', 'M3-31: Pausemenü über der Spielwelt – Weiter, Einstellungen, Speichern, Zum Titel; Fokusrahmen auf „Weiter“', 'pause', '[data-testid="pause-weiter"]', false),
  menuScenario(
    'ui-pause-einstellungen',
    'M3-31: Einstellungen im Pausemenü – die bereits wirksamen Einstellungen (Sprache, UI-Skalierung, Spieltempo, Skalierung, Licht, Steuerung) mit Beschreibung der fokussierten Zeile',
    'pause',
    '[data-einstellung="gameSpeed"]',
    false,
    () => {
      const button = document.querySelector('[data-testid="pause-einstellungen"]');
      if (button instanceof HTMLElement) button.click();
    },
  ),
  // M3-26: the death screen over the start beach (src/ui/screens/tod/szenario.ts).
  deathScreenScenario(),
  // M3-21/M3-22: the night camp with torch and camp fire, and its light map comparison (src/render/game/lightsSzenario.ts).
  ...lightScenarios(),
  // M3-15: the gathering feedback (src/render/game/effectsScenario.ts).
  feedbackScenario(),
  // M3-20: visible condition effects at the player (src/debug/zustandScenarios.ts).
  ...conditionScenarios(),
  // M3-09/M3-37: the player swimming in deep water (src/debug/schwimmenScenario.ts).
  swimScenario(),
  // M3-35: the entity inspector on the player.
  inspectorScenario(),
  // M3-27: the HUD in its three modes over one and the same game state (src/ui/hud/szenario.ts).
  hudModusSzenario(
    'hud-voll',
    'M3-27: HUD „Voll“ am Startstrand an einem kalten Regenmorgen – Leben, Ausdauer, Sättigung, Durst mit Symbolen, Thermometer mit fallendem Kern und Trendpfeil, Furcht-Auge (Flüstern), Zustände mit Timern (Blutung ×3, Vergiftung, Übelkeit, Wohlgenährt, Ausgeruht), Nebenhand, Schnellleiste mit Auswahl und Raritätsrand, Gürtel mit Q, Hinweis „[E] Aufheben: Feuerstein“, Minimap',
    'full',
  ),
  hudModusSzenario(
    'hud-kontextuell',
    'M3-27: HUD „Kontextuell“ im selben Zustand – nur Leisten, die nicht ruhen (Leben, Ausdauer nach der Rolle), Thermometer außerhalb des Wohlfühlbereichs; volle Sättigung und Durst ausgeblendet',
    'contextual',
  ),
  hudModusSzenario(
    'hud-minimal',
    'M3-27: HUD „Minimal“ im selben Zustand – nur Warnungen: Leben im Gefahrenbereich, Furcht-Auge, schädliche Zustände; keine Schnellleiste, kein Hinweis, keine Minimap',
    'minimal',
  ),
];

export function findScenario(name: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.name === name);
}
