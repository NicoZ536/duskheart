/**
 * Allocation of the renderer's frame path (M1-12 „Heap-Profil zeigt keine Allokation im
 * Frame-Pfad“, §30 „Keine Allokationen in Hot-Loops“), measured in Node: the real `Renderer` with
 * its passes, the real scene sources (sprites, figures, tile map, lights, world UI) and the game atlas
 * of `npm run assets`, drawing into a WebGL stand-in without side effects (`nullGl.ts`). Each scene
 * first runs until the JIT has settled; then a sampling heap profile records every allocation of
 * `N` animated frames (presentation time at 60 Hz) – scene fill, y-sort, instance packing, light
 * culling and flicker, pass uniforms, world-UI layout – attributed to the frame driver's call stack,
 * so compiler work and the harness itself do not count.
 *
 * WebGL itself is not part of the measurement (a browser boxes some call arguments on its side), nor
 * are input, UI signals and the debug overlay – they have their own budgets (§30 UI ≤ 1 ms).
 *
 * Loaded through Vite's SSR loader (`render.ts`), because the renderer's modules use
 * `import.meta.glob` (shaders, generated manifest).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PALETTE_HEX } from '../../src/generated/palette';
import { createI18n } from '../../src/i18n';
import type { AtlasData } from '../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../src/render/assets/generated';
import { ShaderSourceStore } from '../../src/render/gl/shaders';
import { Renderer } from '../../src/render/renderer';
import { WORLD_UI_PRELOAD } from '../../src/render/runtime';
import { RenderScene } from '../../src/render/scene';
import { createSceneSource, type RenderSceneId } from '../../src/render/scenes';
import type { SceneSource } from '../../src/render/scenes/sceneSource';
import { SHADERS } from '../../src/render/shaderLib';
import { GlyphAtlas, INK, type CellWindow, type GlyphRasterizer } from '../../src/render/text/glyphAtlas';
import { PIXEL_FONT } from '../../src/render/text/pixelFont';
import { decodePng } from '../lib/png';
import { pathAllocation, type HeapCallFrame, type HeapProfile, type PathAllocation } from './heap';
import { createNullGl } from './nullGl';

/** Canvas of the measured frames (device px): the §4.2 reference size, internal 480 × 270. */
const CANVAS = { width: 1920, height: 1080 } as const;
/** Presentation clock of the measured frames (60 Hz). */
const FRAME_SECONDS = 1 / 60;
/** Start time of every scene (torches mid-flicker, figures mid-step). */
const START_TIME = 1;
/** Ink rectangle of every glyph of the stand-in rasterizer (design px) and its advances. */
const BLOCK_W = 4;
const BLOCK_H = 7;
const BLOCK_ADVANCE = 5;
const SPACE_ADVANCE = 3;

/**
 * Rasterizer without Canvas2D: every glyph is an ink block on the baseline. Layout, atlas and
 * batching run exactly as with the real font; only the glyph shapes differ.
 */
const blockRasterizer: GlyphRasterizer = {
  advance: (ch) => (ch === ' ' ? SPACE_ADVANCE : BLOCK_ADVANCE),
  sample(ch: string, w: CellWindow) {
    const out = new Uint8Array(w.cols * w.rows);
    if (ch === ' ') return out;
    for (let y = 0; y < w.rows; y++) {
      const row = w.rowMax - y;
      for (let x = 0; x < w.cols; x++) {
        const col = w.colMin + x;
        if (col >= 0 && col < BLOCK_W && row >= 0 && row < BLOCK_H) out[y * w.cols + x] = INK;
      }
    }
    return out;
  },
};

/** The game atlas of `npm run assets` with the PNGs decoded in Node; null before the first build. */
function gameAtlas(root: string): AtlasData | null {
  const mod = generatedAtlasModule();
  if (mod === null) return null;
  const read = (url: string): Uint8Array => decodePng(readFileSync(join(root, 'public', url))).rgba;
  return { manifest: manifestFromGenerated(mod), albedo: { kind: 'pixels', pixels: read(mod.ATLAS.albedoUrl) }, normal: { kind: 'pixels', pixels: read(mod.ATLAS.normalUrl) } };
}

/** Name of the function that renders one measured frame: the profile attributes allocations below it to the frame path. */
export const FRAME_DRIVER = 'framePathFrame';

/** Sampling heap profile of `run` (objects collected meanwhile included). */
export type HeapProfiler = (run: () => void) => Promise<HeapProfile>;

export interface FramePathOptions {
  /** Project root (for the atlas images). */
  readonly root: string;
  readonly scenes: readonly RenderSceneId[];
  /**
   * Warm-up per scene before the measurement (pools and arrays at their size, the JIT settled): at
   * least `frames` frames and at least `ms` milliseconds, at most `maxFrames` frames.
   */
  readonly warmup: { readonly frames: number; readonly ms: number; readonly maxFrames: number };
  readonly frames: number;
  readonly profile: HeapProfiler;
}

export interface FramePathMeasurement {
  readonly scene: RenderSceneId;
  readonly frames: number;
  /** Content of the last frame. */
  readonly sprites: number;
  readonly lights: number;
  readonly worldUi: number;
  /** Bytes the frame path allocated per measured frame (sampled), and where. */
  readonly bytesPerFrame: number;
  readonly top: PathAllocation['top'];
}

/** Renders one frame of `source` at `time` (the driver the profile looks for, see `FRAME_DRIVER`). */
function framePathFrame(renderer: Renderer, scene: RenderScene, source: SceneSource, time: number): void {
  scene.beginFrame(time);
  source.fill(scene, time);
  renderer.render(scene, CANVAS.width, CANVAS.height, 'sharp');
}

/** Measures the frame path of each scene; throws when a scene misses its atlas or font. */
export async function measureFramePath(options: FramePathOptions): Promise<FramePathMeasurement[]> {
  const atlas = gameAtlas(options.root);
  const i18n = createI18n('de');
  const deps = { gameAtlas: () => atlas, t: (key: string) => i18n.t(key) };
  const glyphs = new GlyphAtlas(PIXEL_FONT, blockRasterizer, { preload: WORLD_UI_PRELOAD });
  const build = (gl: WebGL2RenderingContext): Renderer => {
    const r = new Renderer(gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
    r.worldUi.setGlyphs(glyphs);
    return r;
  };
  // Discovery: one frame of every scene touches every GL member the measurement will use.
  const nullGl = createNullGl();
  const discovery = build(nullGl.discovery);
  for (const id of options.scenes) {
    const source = createSceneSource(id, deps);
    source.activate?.(discovery);
    framePathFrame(discovery, new RenderScene(), source, START_TIME);
    source.deactivate?.(discovery);
  }
  const renderer = build(nullGl.freeze());
  const inPath = (f: HeapCallFrame): boolean => f.functionName === FRAME_DRIVER;
  const out: FramePathMeasurement[] = [];
  for (const id of options.scenes) {
    const scene = new RenderScene();
    const source = createSceneSource(id, deps);
    source.activate?.(renderer);
    if (source.ready?.() === false) throw new Error(`Frame-Pfad: Szene ${id} ist nicht bereit (Spielatlas fehlt? npm run assets)`);
    let t = START_TIME;
    const w = options.warmup;
    const warmStart = performance.now();
    for (let i = 0; i < w.maxFrames && (i < w.frames || performance.now() - warmStart < w.ms); i++) framePathFrame(renderer, scene, source, (t += FRAME_SECONDS));
    if (!renderer.worldUi.complete) throw new Error(`Frame-Pfad: Szene ${id} zeichnet ihre Welt-UI nicht`);
    const profile = await options.profile(() => {
      for (let i = 0; i < options.frames; i++) framePathFrame(renderer, scene, source, (t += FRAME_SECONDS));
    });
    const alloc = pathAllocation(profile, inPath);
    out.push({ scene: id, frames: options.frames, sprites: scene.sprites.count, lights: scene.lights.count, worldUi: scene.worldUi.count, bytesPerFrame: alloc.inPath / options.frames, top: alloc.top });
    source.deactivate?.(renderer);
  }
  return out;
}
