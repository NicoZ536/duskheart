/**
 * Light debug scenes (M1-18/M1-19):
 * - `normalmap-licht`: a Grünhain clearing at night – rocks, tree, player, metal axes on a tile-map
 *   meadow with a road – lit by a wandering warm point light, a flickering torch and the cold glow of
 *   a lumenite axe. The relief of every sprite comes from its normal map: the side facing a light is
 *   bright, the far side falls into the blue night.
 * - `post-grundlage`: the same clearing at dusk under a blazing light close to the big rock – HDR
 *   values far above 1 reach the tonemapping shoulder, the light bands with Bayer dither show, the
 *   outline pass runs after post, and the camera sits on a fractional position (subpixel offset of
 *   the presentation).
 * - `licht-probe`: empty flat ground with the probe lights of `probeLayout.ts` (E2E falloff check).
 */
import { clipFrameAt, type Direction } from '../anim/animation';
import type { AtlasData } from '../assets/atlas';
import type { RenderScene } from '../scene';
import { FIRE, LUMEN, placeSprite, pushLight, WARM, type LightSpec, type Rgb } from '../scenes/kitTools';
import type { SceneSource } from '../scenes/sceneSource';
import { KitScene, meadowWithRoad } from '../tilemap/kitScene';
import type { SceneKit } from '../tilemap/sceneKit';
import { LIGHT_PROBE_CAMERA, LIGHT_PROBE_LIGHTS } from './probeLayout';

/** A point light moving on an ellipse around (cx, cy) with radii (rx, ry) at `speed` rad/s. */
interface WanderSpec extends LightSpec {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly speed: number;
}

/** Mood of a showcase variant. */
interface Mood {
  readonly ambient: Rgb;
  readonly ambientIntensity: number;
  readonly camera: readonly [number, number];
  readonly wander: WanderSpec;
  readonly torch: LightSpec;
  readonly glow: LightSpec;
  /** The player carries the interaction outline (outline pass after post). */
  readonly outline: boolean;
}

/** World tile row of the road's north edge. */
const ROAD_ROW = 3;
/** Anchors (world px) of the scene's things. */
const ROCK_BIG: readonly [number, number] = [-30, 30];
const ROCKS_SMALL: readonly (readonly [number, number])[] = [
  [74, 18],
  [-156, 98],
  [168, 112],
];
const TREE: readonly [number, number] = [150, 12];
const TORCH: readonly [number, number] = [-120, -40];
const GLOWING: readonly [number, number] = [-196, 58];
const METAL: readonly (readonly [number, number])[] = [
  [96, 44],
  [112, 47],
];
const FIGURES: readonly (readonly [number, number, Direction])[] = [
  [36, 66, 'down'],
  [-104, 22, 'right'],
  [200, 60, 'left'],
];
/** Height of the torch flame and of the axe blade's glow above their anchors (px). */
const TORCH_FLAME_HEIGHT = 12;
const GLOW_HEIGHT = 9;

/** Path of the wandering light: an ellipse around the big rock. */
const WANDER_PATH = { cx: -30, cy: 24, rx: 56, ry: 30, speed: 0.6 } as const;

const NIGHT: Mood = {
  ambient: [0.45, 0.55, 1],
  ambientIntensity: 0.24,
  camera: [0, 0],
  wander: { ...WANDER_PATH, height: 16, radius: 110, color: WARM, intensity: 1.3, flicker: 0, seed: 0 },
  torch: { height: TORCH_FLAME_HEIGHT, radius: 96, color: FIRE, intensity: 1.25, flicker: 0.3, seed: 1.7 },
  glow: { height: GLOW_HEIGHT, radius: 72, color: LUMEN, intensity: 1, flicker: 0.04, seed: 4.2 },
  outline: false,
};

const DUSK: Mood = {
  ambient: [1, 0.7, 0.5],
  ambientIntensity: 0.45,
  camera: [0.37, 0.61],
  wander: { ...WANDER_PATH, height: 14, radius: 110, color: WARM, intensity: 1.9, flicker: 0, seed: 0 },
  torch: { height: TORCH_FLAME_HEIGHT, radius: 96, color: FIRE, intensity: 1.3, flicker: 0.3, seed: 1.7 },
  glow: { height: GLOW_HEIGHT, radius: 72, color: LUMEN, intensity: 1.1, flicker: 0.04, seed: 4.2 },
  outline: true,
};

/** Position of the wandering light at time `t` (world px). */
export function wanderingLightAt(t: number, out: [number, number], w: Pick<WanderSpec, 'cx' | 'cy' | 'rx' | 'ry' | 'speed'> = NIGHT.wander): [number, number] {
  out[0] = w.cx + w.rx * Math.cos(t * w.speed);
  out[1] = w.cy + w.ry * Math.sin(t * w.speed);
  return out;
}

/** Sprite options of the figure with the interaction outline. */
const OUTLINED = { outline: true } as const;

class LightShowcaseScene extends KitScene {
  private readonly at: [number, number] = [0, 0];

  constructor(
    readonly id: string,
    gameAtlas: () => AtlasData | null,
    private readonly mood: Mood,
  ) {
    super(gameAtlas, { first: -1, last: 0 }, { first: -1, last: 0 });
  }

  protected terrain(kit: SceneKit): (wx: number, wy: number) => number {
    return meadowWithRoad(kit, ROAD_ROW);
  }

  protected environment(scene: RenderScene): void {
    const env = scene.env;
    const m = this.mood;
    env.ambientR = m.ambient[0];
    env.ambientG = m.ambient[1];
    env.ambientB = m.ambient[2];
    env.ambientIntensity = m.ambientIntensity;
    env.wind = 0;
  }

  protected compose(scene: RenderScene, kit: SceneKit, time: number): void {
    const m = this.mood;
    scene.camera.set(m.camera[0], m.camera[1]).unfollow();
    placeSprite(scene, kit.rockBig, 0, ROCK_BIG[0], ROCK_BIG[1]);
    for (let i = 0; i < ROCKS_SMALL.length; i++) placeSprite(scene, kit.rockSmall, 0, ROCKS_SMALL[i]?.[0] ?? 0, ROCKS_SMALL[i]?.[1] ?? 0);
    placeSprite(scene, kit.tree, 0, TREE[0], TREE[1]);
    placeSprite(scene, kit.torch, clipFrameAt(kit.torchClip, time), TORCH[0], TORCH[1]);
    placeSprite(scene, kit.glowing, 0, GLOWING[0], GLOWING[1]);
    for (let i = 0; i < METAL.length; i++) {
      const sprite = kit.metal[i % kit.metal.length];
      if (sprite) placeSprite(scene, sprite, 0, METAL[i]?.[0] ?? 0, METAL[i]?.[1] ?? 0);
    }
    for (let i = 0; i < FIGURES.length; i++) {
      const f = FIGURES[i];
      if (!f) continue;
      placeSprite(scene, kit.figure, clipFrameAt(kit.idle[f[2]], time + i), f[0], f[1], m.outline && i === 0 ? OUTLINED : undefined);
    }
    wanderingLightAt(time, this.at, m.wander);
    pushLight(scene, this.at[0], this.at[1], m.wander);
    pushLight(scene, TORCH[0], TORCH[1], m.torch);
    pushLight(scene, GLOWING[0], GLOWING[1], m.glow);
  }
}

/** Scenario `normalmap-licht`: frozen where the wandering light stands left in front of the big rock. */
export const NORMALMAP_LIGHT_TIME = 4.2;
/** Scenario `post-grundlage`: frozen where the blazing light stands right in front of the big rock. */
export const POST_BASE_TIME = 1.7;

export function normalmapLightScene(gameAtlas: () => AtlasData | null): KitScene {
  return new LightShowcaseScene('normalmap-licht', gameAtlas, NIGHT);
}

export function postBaseScene(gameAtlas: () => AtlasData | null): KitScene {
  return new LightShowcaseScene('post-grundlage', gameAtlas, DUSK);
}

/** Scene `licht-probe`: nothing drawn, no ambient, the probe lights (E2E reads the `light` buffer). */
export class LightProbeScene implements SceneSource {
  readonly id = 'licht-probe';
  private scene: RenderScene | null = null;
  private ambient = 0;

  fill(scene: RenderScene): void {
    if (this.scene !== scene) {
      this.scene = scene;
      this.ambient = scene.env.ambientIntensity;
    }
    scene.atlas = null;
    scene.env.ambientIntensity = 0;
    scene.camera.set(LIGHT_PROBE_CAMERA[0], LIGHT_PROBE_CAMERA[1]).unfollow();
    for (const s of LIGHT_PROBE_LIGHTS) {
      const l = scene.light.reset();
      l.x = s.x;
      l.y = s.y;
      l.height = s.height;
      l.radius = s.radius;
      l.intensity = s.intensity;
      l.flicker = s.flicker;
      l.seed = s.seed;
      l.coneDirection = s.coneDirection;
      l.coneAngle = s.coneAngle;
      scene.lights.push(l);
    }
  }

  deactivate(): void {
    if (this.scene !== null) this.scene.env.ambientIntensity = this.ambient;
    this.scene = null;
  }
}
