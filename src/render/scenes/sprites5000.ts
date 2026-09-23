/**
 * Scenario `sprites-5000` (M1-12, bench M1-24, §32 M1 "5 000 animierte Sprites bei 60 FPS"): exactly
 * 5 000 animated sprites – figures walking in all directions, burning torches, grass swaying in the
 * wind and glow mushrooms pulsing in hard steps – in one instanced draw call, on the static chunk
 * ground of the tile map (as in the game world: the ground is no sprite), at night under 32
 * flickering point lights (the first 32 torches carry one): the §30 quality level "Niedrig" draws
 * exactly 32 lights. Everything comes from the in-memory scene atlas, so the bench does not depend on
 * `npm run assets`.
 */
import { clipFrameAt, DIRECTIONS } from '../anim/animation';
import { defaultFigureState, type FigureRig } from '../anim/figure';
import { atlasSprite, spriteClip, spriteFrame, type AtlasData, type AtlasSprite } from '../assets/atlas';
import type { AnimationClip } from '../anim/animation';
import { sceneAtlas } from '../assets/sceneSprites';
import type { RenderScene } from '../scene';
import { KitScene, type ChunkRange } from '../tilemap/kitScene';
import { TERRAIN, type SceneKit } from '../tilemap/sceneKit';
import { bareWanderer } from './figures';
import { FIRE, pushLight, type LightSpec } from './kitTools';
import { STRESS_LIGHTS, STRESS_SPRITES } from './ids';
import { hash01 } from './layout';

export { STRESS_LIGHTS, STRESS_SPRITES };

/** Share of the animated sprites per kind (walking figures, torches, swaying grass; the rest glow mushrooms). */
const MIX = { figures: 0.4, torches: 0.25, grass: 0.2 } as const;
/** Scatter area around the camera (world px). */
const HALF_W = 232;
const HALF_H = 124;
/** Walking speed of the figures (px/s) and wind sway of the grass. */
const WALK_SPEED = 18;
const GRASS_SWAY = 1.5;
const TAU = Math.PI * 2;
const SALT = { x: 1, y: 2, dir: 3, phase: 4 } as const;
/**
 * Glow of the mushrooms: extra emission in hard steps (pixel-art pulse, no smooth ramp), stepping
 * `GLOW_STEPS_PER_SECOND` times a second; neighbouring steps always differ.
 */
export const GLOW_STEPS: readonly number[] = [0, 0.2, 0.4, 0.2];
export const GLOW_STEPS_PER_SECOND = 4;

/** Per-sprite scatter values (x, y, direction, phase), computed once – the frame path only reads them. */
const SCATTER_FIELDS = 4;
/** Torch light: flame height above the foot, radius, flicker; the seed is the torch's phase. */
const TORCH_LIGHT: Omit<LightSpec, 'seed'> = { height: 10, radius: 56, color: FIRE, intensity: 1.3, flicker: 0.3 };
/** Night: dim cold ambient, so the light pools of the torches carry the picture. */
const NIGHT_AMBIENT = { r: 0.45, g: 0.55, b: 1, intensity: 0.3 } as const;

/** `v` wrapped into [−half, half): walking figures leave the area on one side and come back on the other. */
function wrap(v: number, half: number): number {
  const span = 2 * half;
  return ((((v + half) % span) + span) % span) - half;
}

/** Extra emission of a glow mushroom with phase `phase` (0…1) at `time`. */
export function glowStep(time: number, phase: number): number {
  const step = Math.floor(time * GLOW_STEPS_PER_SECOND + phase * GLOW_STEPS.length);
  return GLOW_STEPS[((step % GLOW_STEPS.length) + GLOW_STEPS.length) % GLOW_STEPS.length] ?? 0;
}

/** Ground chunks (32 × 32 tiles each) around the camera: −512…511 px on both axes covers every §4.2 view. */
const GROUND_CHUNKS: ChunkRange = { first: -1, last: 0 };

export class Sprites5000Scene extends KitScene {
  readonly id = 'sprites-5000';
  private readonly atlas: AtlasData = sceneAtlas();
  private readonly rig: FigureRig = bareWanderer(this.atlas);
  private readonly figure = defaultFigureState();
  private readonly torch: AtlasSprite;
  private readonly burn: AnimationClip;
  private readonly grass: AtlasSprite;
  private readonly mushroom: AtlasSprite;
  private readonly scatter = new Float32Array(STRESS_SPRITES * SCATTER_FIELDS);
  /** Reused light description (the seed changes per torch). */
  private readonly light: { -readonly [K in keyof LightSpec]: LightSpec[K] } = { ...TORCH_LIGHT, seed: 0 };

  constructor() {
    super(() => sceneAtlas(), GROUND_CHUNKS, GROUND_CHUNKS);
    const m = this.atlas.manifest;
    this.torch = atlasSprite(m, 'fackel');
    this.burn = spriteClip(this.torch, 'brennen');
    this.grass = atlasSprite(m, 'grasbusch');
    this.mushroom = atlasSprite(m, 'leuchtpilz');
    for (let i = 0; i < STRESS_SPRITES; i++) {
      const o = i * SCATTER_FIELDS;
      this.scatter[o] = (hash01(i, SALT.x) * 2 - 1) * HALF_W;
      this.scatter[o + 1] = (hash01(i, SALT.y) * 2 - 1) * HALF_H;
      this.scatter[o + 2] = Math.floor(hash01(i, SALT.dir) * DIRECTIONS.length);
      this.scatter[o + 3] = hash01(i, SALT.phase);
    }
  }

  /** A meadow everywhere (grass variants chosen per world tile). */
  protected terrain(): (wx: number, wy: number) => number {
    return () => TERRAIN.grass;
  }

  /** Night: dim cold ambient, a light wind for the grass. */
  protected environment(scene: RenderScene): void {
    const env = scene.env;
    env.wind = 1;
    env.ambientR = NIGHT_AMBIENT.r;
    env.ambientG = NIGHT_AMBIENT.g;
    env.ambientB = NIGHT_AMBIENT.b;
    env.ambientIntensity = NIGHT_AMBIENT.intensity;
  }

  protected compose(scene: RenderScene, _kit: SceneKit, time: number): void {
    scene.camera.set(0, 0).unfollow();
    const figures = Math.floor(STRESS_SPRITES * MIX.figures);
    const torches = figures + Math.floor(STRESS_SPRITES * MIX.torches);
    const grass = torches + Math.floor(STRESS_SPRITES * MIX.grass);
    const d = scene.sprite;
    const f = this.figure;
    const sc = this.scatter;
    for (let i = 0; i < STRESS_SPRITES; i++) {
      const o = i * SCATTER_FIELDS;
      const x = sc[o] ?? 0;
      const y = sc[o + 1] ?? 0;
      const phase = sc[o + 3] ?? 0;
      if (i < figures) {
        const dir = DIRECTIONS[sc[o + 2] ?? 0] ?? 'down';
        const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
        const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
        f.x = wrap(x + dx * WALK_SPEED * time, HALF_W);
        f.y = wrap(y + dy * WALK_SPEED * time, HALF_H);
        f.direction = dir;
        f.action = 'walk';
        f.time = time + phase;
        this.rig.emit(scene.sprites, d, f);
        continue;
      }
      d.reset();
      d.x = x;
      d.y = y;
      if (i < torches) {
        d.frame = spriteFrame(this.torch, clipFrameAt(this.burn, time + phase));
        if (i - figures < STRESS_LIGHTS) {
          this.light.seed = phase;
          pushLight(scene, x, y, this.light);
        }
      } else if (i < grass) {
        d.frame = spriteFrame(this.grass, 0);
        d.windAmplitude = GRASS_SWAY;
        d.windPhase = phase * TAU;
      } else {
        d.frame = spriteFrame(this.mushroom, 0);
        d.emissiveBoost = glowStep(time, phase);
      }
      scene.sprites.push(d);
    }
  }
}
