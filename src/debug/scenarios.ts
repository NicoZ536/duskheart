/**
 * Screenshot-/Bench-Szenarien (MASTERPROMPT §31.5): deterministisch (fester Seed, eingefrorene Zeit, festes Wetter).
 * Jedes Szenario stellt den Zustand her und meldet, ab wann das Bild stabil ist.
 */
import type { ScenarioRender } from '../render/runtime';
import { VIEWPORT_EXAMPLES, type ViewportExample } from '../render/viewport';
import { NORMALMAP_LIGHT_TIME, POST_BASE_TIME } from '../render/light/lightScenes';
import { createI18n, FALLBACK_LANG, isLang, type I18n } from '../i18n';
import { mountGallery, type GalleryKind } from '../ui/kit';

export interface ScenarioContext {
  /** Freeze presentation time at `seconds` (the frame is then fully deterministic). */
  freezeAt(seconds: number): void;
  /**
   * Renderer control (scene, render debugger). The browser page provides it; scenarios that need it
   * throw when it is missing instead of showing a wrong image.
   */
  readonly render?: ScenarioRender;
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
  galleryScenario('schrift', 'M1-20: Pixelschrift im DOM und per WebGL-Glyphenatlas nebeneinander (4×, 2×, 1×; „Größe Übermäßig Ärger“, ÄÖÜäöüß, Schatten, Kontur)'),
  galleryScenario('ui-kit', 'M1-21: UI-Kit (Holz, Eisen, Pergament, Slots, Schaltflächen in allen Zuständen, Leisten, Pixel-Scrollbar) bei 1×–4×'),
];

export function findScenario(name: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.name === name);
}
