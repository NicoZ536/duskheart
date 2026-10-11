/**
 * Scenario `sprites-5000` (M1-12, bench M1-24, §32 M1 "5 000 animierte Sprites bei 60 FPS"): exactly
 * 5 000 animated sprites – figures walking in all directions, burning torches, grass swaying in the
 * wind and glow mushrooms pulsing in hard steps – in one instanced draw call, on the static chunk
 * ground of the tile map (as in the game world: the ground is no sprite), at night under 32
 * flickering point lights (the first 32 torches carry one): the §30 quality level "Niedrig" draws
 * exactly 32 lights. Everything comes from the in-memory scene atlas, so the bench does not depend on
 * `npm run assets`.
 */
import { DOUBLE_FIELD } from '../../engine/heldRecords';
import { clipFrameIn, DIRECTIONS } from '../anim/animation';
import { defaultFigureState, type FigureRig, type FigureState } from '../anim/figure';
import { atlasSprite, spriteClip, spriteFrame, type AtlasData, type AtlasSprite } from '../assets/atlas';
import type { AnimationClip } from '../anim/animation';
import { sceneAtlas } from '../assets/sceneSprites';
import type { RenderScene } from '../scene';
import { KitScene, type ChunkRange } from '../tilemap/kitScene';
import { TERRAIN, type SceneKit } from '../tilemap/sceneKit';
import { bareWanderer } from './figures';
import { FIRE, MOONLIGHT } from '../light/lightColors';
import { PlacedLight, pushPlacedLight, setAmbient, type LightSpec } from './kitTools';
import { STRESS_LIGHTS, STRESS_SPRITES } from './ids';
import { hash01 } from './layout';

export { STRESS_LIGHTS, STRESS_SPRITES };

/** Share of the animated sprites per kind (walking figures, torches, swaying grass; the rest glow mushrooms). */
const MIX = { figures: 0.4, torches: 0.25, grass: 0.2 } as const;
/** Scatter area around the camera (world px), and its spans: walking figures wrap around it. */
const HALF_W = 232;
const HALF_H = 124;
const SPAN_W = 2 * HALF_W;
const SPAN_H = 2 * HALF_H;
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
/** `GLOW_STEPS` as doubles for the frame: read from here, an emission is stored without a number object. */
const GLOW_LEVELS = Float64Array.from(GLOW_STEPS);

/** Per-sprite scatter values (x, y, direction, phase), computed once – the frame path only reads them. */
const SCATTER_FIELDS = 4;
/** Torch light: flame height above the foot, radius, flicker; the seed is the torch's phase. */
const TORCH_LIGHT: Omit<LightSpec, 'seed'> = { height: 10, radius: 56, color: FIRE, intensity: 1.6, flicker: 0.3 };
/** Night: dim moonlight, so the light pools of the torches carry the picture. */
const NIGHT_AMBIENT_INTENSITY = 0.3;

/**
 * Registers of the frame (M7-87): the times a call reads from a typed array instead of taking them as arguments, so no
 * fractional number crosses a call in the loop over 5 000 sprites – whatever V8 inlines (ADR-0222). The bench measured this
 * scene at 53–136 KB per frame in one run of three: `compose` optimised with `clipFrameAt` and `glowStep` left as calls, each
 * argument and result a new number object.
 */
const REG_CLIP_TIME = 0;
const REG_GLOW_TIME = 1;
const REG_GLOW_PHASE = 2;
const REGISTERS = 3;

/** Index into `GLOW_STEPS` of a glow mushroom with the phase `regs[REG_GLOW_PHASE]` (0…1) at the time `regs[REG_GLOW_TIME]`. */
function glowIndexIn(regs: Float64Array): number {
  const n = GLOW_STEPS.length;
  const step = Math.floor((regs[REG_GLOW_TIME] as number) * GLOW_STEPS_PER_SECOND + (regs[REG_GLOW_PHASE] as number) * n);
  return ((step % n) + n) % n;
}

const glowRegisters = new Float64Array(REGISTERS);

/** Extra emission of a glow mushroom with phase `phase` (0…1) at `time` (what the frame stores, `glowIndexIn`). */
export function glowStep(time: number, phase: number): number {
  glowRegisters[REG_GLOW_TIME] = time;
  glowRegisters[REG_GLOW_PHASE] = phase;
  return GLOW_STEPS[glowIndexIn(glowRegisters)] ?? 0;
}

/** The walkers' fractional fields: doubles from the start (ADR-0222), so a store updates them in place. */
class WalkerFields {
  x = DOUBLE_FIELD;
  y = DOUBLE_FIELD;
  time = DOUBLE_FIELD;
}

/** The figure state the walkers share: `defaultFigureState` over fields that start as doubles. */
function walkerState(): FigureState {
  return Object.assign(new WalkerFields(), defaultFigureState());
}

/** Ground chunks (32 × 32 tiles each) around the camera: −512…511 px on both axes covers every §4.2 view. */
const GROUND_CHUNKS: ChunkRange = { first: -1, last: 0 };

export class Sprites5000Scene extends KitScene {
  readonly id = 'sprites-5000';
  private readonly atlas: AtlasData = sceneAtlas();
  private readonly rig: FigureRig = bareWanderer(this.atlas);
  private readonly figure = walkerState();
  private readonly registers = new Float64Array(REGISTERS);
  private readonly torch: AtlasSprite;
  private readonly burn: AnimationClip;
  private readonly grass: AtlasSprite;
  private readonly mushroom: AtlasSprite;
  private readonly scatter = new Float32Array(STRESS_SPRITES * SCATTER_FIELDS);
  /** Reused light record: position and seed change per torch, nothing fractional goes through a call (M7-87). */
  private readonly light = new PlacedLight(TORCH_LIGHT);

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

  /** Night: dim moonlight, a light wind for the grass. */
  protected environment(scene: RenderScene): void {
    scene.env.wind = 1;
    setAmbient(scene.env, MOONLIGHT, NIGHT_AMBIENT_INTENSITY);
  }

  protected compose(scene: RenderScene, _kit: SceneKit, time: number): void {
    scene.camera.set(0, 0).unfollow();
    // Loop bounds as locals: the loop runs 5 000 times per frame (render preparation, M1-28).
    const total = STRESS_SPRITES;
    const lit = STRESS_LIGHTS;
    const figures = Math.floor(total * MIX.figures);
    const torches = figures + Math.floor(total * MIX.torches);
    const grass = torches + Math.floor(total * MIX.grass);
    const d = scene.sprite;
    const f = this.figure;
    const sc = this.scatter;
    const regs = this.registers;
    regs[REG_GLOW_TIME] = time;
    for (let i = 0; i < total; i++) {
      const o = i * SCATTER_FIELDS;
      const x = sc[o] ?? 0;
      const y = sc[o + 1] ?? 0;
      const phase = sc[o + 3] ?? 0;
      if (i < figures) {
        const dir = DIRECTIONS[sc[o + 2] ?? 0] ?? 'down';
        const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
        const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
        // Wrapped into [−half, half): walking figures leave the area on one side and come back on the other.
        const vx = x + dx * WALK_SPEED * time;
        const vy = y + dy * WALK_SPEED * time;
        f.x = ((((vx + HALF_W) % SPAN_W) + SPAN_W) % SPAN_W) - HALF_W;
        f.y = ((((vy + HALF_H) % SPAN_H) + SPAN_H) % SPAN_H) - HALF_H;
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
        regs[REG_CLIP_TIME] = time + phase;
        d.frame = spriteFrame(this.torch, clipFrameIn(this.burn, regs, REG_CLIP_TIME));
        if (i - figures < lit) {
          const l = this.light;
          l.x = x;
          l.y = y;
          l.seed = phase;
          pushPlacedLight(scene, l);
        }
      } else if (i < grass) {
        d.frame = spriteFrame(this.grass, 0);
        d.windAmplitude = GRASS_SWAY;
        d.windPhase = phase * TAU;
      } else {
        d.frame = spriteFrame(this.mushroom, 0);
        regs[REG_GLOW_PHASE] = phase;
        d.emissiveBoost = GLOW_LEVELS[glowIndexIn(regs)] as number;
      }
      scene.sprites.push(d);
    }
  }
}
