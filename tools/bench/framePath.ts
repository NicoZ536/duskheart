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
import { BOOT_SESSION_SEED, GameSession } from '../../src/game/session';
import { equipmentRef } from '../../src/game/items/slots';
import type { PlayerSystem } from '../../src/game/player/system';
import type { GameWorldBinding } from '../../src/render/world/gameScene';
import { WorldHost } from '../../src/render/world/worldHost';
import { TILE_PX } from '../../src/world/model/coords';
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
  readonly scenes: readonly FramePathSceneId[];
  /**
   * Warm-up per scene before the measurement (pools and arrays at their size, the JIT settled): at
   * least `frames` frames and at least `ms` milliseconds, at most `maxFrames` frames.
   */
  readonly warmup: { readonly frames: number; readonly ms: number; readonly maxFrames: number };
  readonly frames: number;
  readonly profile: HeapProfiler;
}

export interface FramePathMeasurement {
  readonly scene: FramePathSceneId;
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

/** Longest wait for a scene's data (the world scenes generate their world in this thread first) [ms]. */
const SCENE_READY_TIMEOUT_MS = 120_000;

/**
 * The game view in a fight (M6 gate, ADR-0167): the scene `spiel` with a player in the middle of creatures – a wolf pack,
 * boars, badgers, a wasp swarm, shadow brood with the Nachtmahr, grazing and fleeing animals, birds and crabs – at night,
 * the player with a sword and a lit torch swinging around itself. While the scene warms up every frame runs one
 * simulation tick first (outside the measured driver: the tick has its own budgets, `sim:kreaturen-50`), so the fight is
 * under way: walking, winding-up, hit and dying bodies, carcasses, telegraphs, glints, smears, projectiles, damage
 * numbers, bodies sinking into the dark and eyes glowing in it. After `FIGHT_SETUP_FRAMES` such frames the scene is that
 * moment of the fight: warmed up and sampled like every scene, without a further tick – a frame between two ticks, as the
 * scene `spiel` measures its figure (frame-path semantics of ADR-0142): the presentation's clocks run on (idle loops,
 * flicker, smoke), the simulation's state stands. What a new tick derives (the surface's weathering, the sky, the light
 * list) runs once per tick in code V8 keeps in its baseline tier for thousands of ticks, where every floating-point step
 * is a new number – measured apart from the frame (M6-05j).
 */
export const FIGHT_SCENE = 'spiel-kampf';
/** A scene of the frame-path bench: a render scene, or the game view in a fight (`FIGHT_SCENE`). */
export type FramePathSceneId = RenderSceneId | typeof FIGHT_SCENE;

/** Clock time of the fight [h]: deep night – the brood is out, the eyes of the night hunters glow, bodies sink into the dark. */
const FIGHT_HOUR = 22;
/**
 * The creatures of the fight [id, count, dx, dy]: `count` of them appear `dx`, `dy` tiles from the player (one command
 * each: a group of wolves is one pack), all within the view (480 × 270 px = 30 × 17 tiles) – 53 in all.
 */
export const FIGHT_GROUPS: readonly (readonly [creature: string, count: number, dx: number, dy: number])[] = [
  ['wolf', 5, 0, -5],
  ['keiler', 3, 6, 0],
  ['dachs', 3, -6, 0],
  ['wespenschwarm', 2, -3, -5],
  ['schleicher', 4, -4, 4],
  ['kriecher', 3, 3, -3],
  ['speier', 3, 5, 5],
  ['schleicher', 2, -7, -3],
  ['nachtmahr', 1, 8, -4],
  ['reh', 5, 9, 4],
  ['hase', 8, -9, 5],
  ['wachtel', 4, 2, 6],
  ['moewe', 4, -2, 6],
  ['krabbe', 6, 10, -1],
];
/** What the player holds: the sword in the hand, a lit torch in the off hand (its light decides which body is seen). */
const FIGHT_KIT: readonly unknown[] = [
  { type: 'inventory.give', item: 'fackel', count: 1 },
  { type: 'inventory.move', from: { bereich: 'schnellleiste', index: 0 }, to: equipmentRef('nebenhand') },
  { type: 'light.toggle' },
  { type: 'inventory.give', item: 'bronzeschwert', count: 1 },
  { type: 'player.selectHotbar', index: 0 },
];
/** Ticks the player stands before the creatures come (spawned, the kit in hand). */
const FIGHT_SETTLE_TICKS = 30;
/** The player swings every this many frames, the button held for `FIGHT_SWING_HOLD` frames, at the next of eight aims. */
const FIGHT_SWING_EVERY = 40;
const FIGHT_SWING_HOLD = 5;
/** The aims of the swings around the player [tiles]: the eight directions, two tiles out. */
const FIGHT_AIMS: readonly (readonly [number, number])[] = [
  [2, 0],
  [1, 1],
  [0, 2],
  [-1, 1],
  [-2, 0],
  [-1, -1],
  [0, -2],
  [1, -1],
];
/** The frames' place between two ticks (`GameSession.setFrameAlpha`): fractional, as on any display that is not exactly at 60 Hz. */
const FIGHT_ALPHA = 0.5;
/** Fight frames the discovery renders once the world is ready (the creatures arrived, the first blows and deaths). */
const FIGHT_DISCOVERY_FRAMES = 300;
/** Fight frames, one tick each, before the scene's warm-up: ten seconds of the fight at 60 Hz (blows, deaths, carcasses). */
const FIGHT_SETUP_FRAMES = 600;

/** Nothing to do before a frame (the render scenes without a session; the fight's sampled frames). */
const NO_PREPARATION = (): void => undefined;

/**
 * A game view of the bench: the session behind it, what runs before each frame of the discovery and the warm-up and before
 * each sampled frame (outside the measured driver).
 */
interface BenchGame {
  readonly binding: GameWorldBinding;
  /** Before each frame of the discovery and of the scene's setup. */
  readonly beforeFrame: () => void;
  /** Before each frame of the warm-up and of the sampling. */
  readonly beforeSample: () => void;
  /** Frames the discovery renders after the scene is ready (they touch the GL members only these frames use). */
  readonly discoveryFrames: number;
  /** Frames rendered (with `beforeFrame`) before the warm-up: they bring the scene to the state that is measured. */
  readonly setupFrames: number;
}

/** The boot session's world, generated in this thread and handed to a `GameSession`. */
function benchSession(): { readonly binding: GameWorldBinding; readonly session: GameSession; readonly host: WorldHost } {
  let host: WorldHost | null = null;
  const session = new GameSession({ config: { seed: BOOT_SESSION_SEED }, simulation: { chunkJobs: () => (host as WorldHost).createJobQueue() } });
  host = new WorldHost({
    seed: session.sim.config.seed,
    preset: session.sim.config.worldSize,
    now: () => performance.now(),
    adopt: (world) => {
      session.sim.world.provide(world);
      return session.sim.world.chunks;
    },
  });
  host.start();
  return { binding: { session, host }, session, host };
}

/**
 * The game view's session (`spiel`): a figure standing on the start beach (spawned, one simulation step: the active zone
 * and the canopy fade are part of the frame path).
 */
function gameWorld(): BenchGame {
  const { binding, session, host } = benchSession();
  let spawned = false;
  const spawn = (): void => {
    const world = host.world;
    if (spawned || world === null || host.state !== 'bereit') return;
    session.command({ type: 'spawnDebugMover', x: world.spawn.x * TILE_PX + TILE_PX / 2, y: world.spawn.y * TILE_PX + TILE_PX / 2, controlled: true });
    session.step();
    spawned = true;
  };
  return { binding, discoveryFrames: 0, setupFrames: 0, beforeFrame: spawn, beforeSample: spawn };
}

/** The game view in a fight (`FIGHT_SCENE`): the player, god mode, the kit, the creatures of `FIGHT_GROUPS`; then a tick per frame. */
function fightWorld(): BenchGame {
  const { binding, session, host } = benchSession();
  let ready = false;
  let frame = 0;
  const at = { x: 0, y: 0 };
  const setUp = (): void => {
    const world = host.world;
    if (world === null) return;
    session.command({ type: 'setTime', hour: FIGHT_HOUR, minute: 0 });
    session.command({ type: 'player.spawn' });
    session.step();
    session.command({ type: 'debug.god', on: true });
    for (const c of FIGHT_KIT) session.command(c);
    for (let i = 0; i < FIGHT_SETTLE_TICKS; i++) session.step();
    const player = session.sim.system('player') as unknown as PlayerSystem;
    if (!player.position(session.sim, at)) throw new Error(`Frame-Pfad: ${FIGHT_SCENE} ohne Spieler`);
    for (const [creature, count, dx, dy] of FIGHT_GROUPS) {
      session.command({ type: 'creature.spawn', creature, count, x: Math.round(at.x + dx * TILE_PX), y: Math.round(at.y + dy * TILE_PX), layer: 0 });
    }
    session.step();
    ready = true;
  };
  return {
    binding,
    discoveryFrames: FIGHT_DISCOVERY_FRAMES,
    setupFrames: FIGHT_SETUP_FRAMES,
    // Warm-up and sampling show the fight's moment at the end of the setup (see `FIGHT_SCENE`).
    beforeSample: NO_PREPARATION,
    beforeFrame: () => {
      if (!ready) {
        if (host.state === 'bereit') setUp();
        return;
      }
      const k = frame++ % FIGHT_SWING_EVERY;
      if (k === 0) {
        const a = FIGHT_AIMS[Math.floor(frame / FIGHT_SWING_EVERY) % FIGHT_AIMS.length] as readonly [number, number];
        session.command({ type: 'player.aim', x: Math.round(at.x + a[0] * TILE_PX), y: Math.round(at.y + a[1] * TILE_PX) });
        session.command({ type: 'combat.attack', on: true });
      } else if (k === FIGHT_SWING_HOLD) session.command({ type: 'combat.attack', on: false });
      session.step();
      session.setFrameAlpha(FIGHT_ALPHA);
    },
  };
}

/**
 * Renders frames of `source` until it reports ready, yielding between frames (in-thread world generation runs in a
 * microtask), then `extra` + 1 more frames.
 */
async function settle(renderer: Renderer, source: SceneSource, id: FramePathSceneId, onFrame: () => void, extra: number): Promise<void> {
  const scene = new RenderScene();
  const start = performance.now();
  let t = START_TIME;
  while (source.ready?.() === false) {
    if (performance.now() - start > SCENE_READY_TIMEOUT_MS) throw new Error(`Frame-Pfad: Szene ${id} wird nicht bereit (Spielatlas fehlt? npm run assets)`);
    onFrame();
    framePathFrame(renderer, scene, source, (t += FRAME_SECONDS));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  for (let i = 0; i <= extra; i++) {
    onFrame();
    framePathFrame(renderer, scene, source, (t += FRAME_SECONDS));
  }
}

/** Measures the frame path of each scene; throws when a scene misses its atlas or font. */
export async function measureFramePath(options: FramePathOptions): Promise<FramePathMeasurement[]> {
  const atlas = gameAtlas(options.root);
  const i18n = createI18n('de');
  const games = new Map<FramePathSceneId, BenchGame>();
  if (options.scenes.includes('spiel')) games.set('spiel', gameWorld());
  if (options.scenes.includes(FIGHT_SCENE)) games.set(FIGHT_SCENE, fightWorld());
  const t = (key: string): string => i18n.t(key);
  const sourceOf = (id: FramePathSceneId): SceneSource => {
    const game = games.get(id) ?? null;
    return createSceneSource(id === FIGHT_SCENE ? 'spiel' : id, { gameAtlas: () => atlas, t, gameWorld: () => game?.binding ?? null });
  };
  const glyphs = new GlyphAtlas(PIXEL_FONT, blockRasterizer, { preload: WORLD_UI_PRELOAD });
  const build = (gl: WebGL2RenderingContext): Renderer => {
    const r = new Renderer(gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
    r.worldUi.setGlyphs(glyphs);
    return r;
  };
  // Discovery: every scene until it has its data (the world scenes generate their world here), then
  // one more frame (a fight its first seconds) – together they touch every GL member the measurement will use.
  const nullGl = createNullGl();
  const discovery = build(nullGl.discovery);
  for (const id of options.scenes) {
    const source = sourceOf(id);
    const game = games.get(id);
    source.activate?.(discovery);
    await settle(discovery, source, id, game?.beforeFrame ?? NO_PREPARATION, game?.discoveryFrames ?? 0);
    source.deactivate?.(discovery);
  }
  const renderer = build(nullGl.freeze());
  const inPath = (f: HeapCallFrame): boolean => f.functionName === FRAME_DRIVER;
  const out: FramePathMeasurement[] = [];
  for (const id of options.scenes) {
    const scene = new RenderScene();
    const source = sourceOf(id);
    const game = games.get(id);
    const beforeSample = game?.beforeSample ?? NO_PREPARATION;
    source.activate?.(renderer);
    let time = START_TIME;
    for (let i = 0; i < (game?.setupFrames ?? 0); i++) {
      game?.beforeFrame();
      framePathFrame(renderer, scene, source, (time += FRAME_SECONDS));
    }
    const w = options.warmup;
    const warmStart = performance.now();
    for (let i = 0; i < w.maxFrames && (i < w.frames || performance.now() - warmStart < w.ms); i++) {
      beforeSample();
      framePathFrame(renderer, scene, source, (time += FRAME_SECONDS));
    }
    if (source.ready?.() === false) throw new Error(`Frame-Pfad: Szene ${id} ist nach dem Aufwärmen nicht bereit`);
    if (!renderer.worldUi.complete) throw new Error(`Frame-Pfad: Szene ${id} zeichnet ihre Welt-UI nicht`);
    const profile = await options.profile(() => {
      for (let i = 0; i < options.frames; i++) {
        beforeSample();
        framePathFrame(renderer, scene, source, (time += FRAME_SECONDS));
      }
    });
    const alloc = pathAllocation(profile, inPath);
    out.push({ scene: id, frames: options.frames, sprites: scene.sprites.count, lights: scene.lights.count, worldUi: scene.worldUi.count, bytesPerFrame: alloc.inPath / options.frames, top: alloc.top });
    source.deactivate?.(renderer);
  }
  return out;
}
