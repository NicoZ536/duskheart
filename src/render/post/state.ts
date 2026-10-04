/**
 * Picture-wide state effects of the post pass (MASTERPROMPT §6.1 pass 9 "Zustandseffekte (Furcht,
 * niedrige HP, Kälte, Hitze, Erschöpfung, Gift, Rausch), Vignette, feines Pixelkorn, Bayer-Dither-
 * Übergänge", §12.3 "ab 40 Flüstern und Schatten am Bildrand · ab 60 … Entsättigung", M5-15; the
 * eyelids and the frost rim of M3-20): `RenderScene.post`, filled by the game view each frame from the
 * player (`src/render/world/atmosphereScene.ts`) and reset with every frame – scenes that fill nothing
 * show the picture untouched.
 *
 * How each effect looks (post.glsl, post_tonemap.frag):
 * - **Fear** (0…1 = fear points / 100): from 40 dark tendrils creep in from the picture's edges and
 *   breathe slowly; from 60 the colours drain (up to `FEAR_DESATURATION` at 100).
 * - **Low health** (`hurt`, 0…1 below `LOW_HEALTH_SHARE` of max health): a dark red rim that beats with
 *   a slow double heartbeat (`heartbeat`); below a quarter of that the colours drain. With flash
 *   reduction the rim holds still.
 * - **Heat** (Erhitzt … Hitzschlag): a warm cast and heat haze at the edges; from Hitzschlag the whole
 *   picture shimmers.
 * - **Cold** (Frierend … Erfrierend): a cold cast and drained colours; Unterkühlt adds the frost rim.
 * - **Exhaustion** (Müde, Erschöpft): the eyelids of the blink; exhausted also dims the edges.
 * - **Poison** (Vergiftung, Lebensmittelvergiftung, Fieber): a sickly green rim that swells slowly and a
 *   queasy sway of the picture.
 * - **Intoxication** (Beschwipst, Betäubt): the picture swims in slow waves and a faint double image
 *   drifts beside it.
 * - **Vignette** (the grade's plus the scene's), **grain** (fine, strongest in the dark, still while
 *   motion or flicker are reduced) and **transitions** (a Bayer-dithered cover, e.g. when the view
 *   changes layer).
 */
import type { PostEffects } from '../scene';
import { DistortionList } from './distortion';
import { PostOverrides } from './overrides';
import { zeroAt } from '../uniformBits';

/** Share of max health below which the low-health rim appears. */
export const LOW_HEALTH_SHARE = 0.35;
/** Fear (0…1) from which the tendrils creep in, and from which the colours drain (§12.3: 40 and 60). */
export const FEAR_TENDRILS_FROM = 0.4;
export const FEAR_DRAIN_FROM = 0.6;
/** Share of the colour fear drains at 100. */
export const FEAR_DESATURATION = 0.65;
/** Heartbeat period at the first sign of low health and at death's door [s] (never faster: no strobing). */
export const HEARTBEAT_SECONDS = { calm: 1.25, racing: 0.8 } as const;
/** Share of the rim's strength the beat moves (the rest holds steady), and its value with flash reduction. */
export const HEARTBEAT_DEPTH = 0.35;
export const HEARTBEAT_STEADY = 0.5;
/** Duration of a Bayer transition when the view changes layer [s]. */
export const LAYER_TRANSITION_SECONDS = 0.6;
/** Scale of every wobble, shimmer and wave with "Bewegungsreduktion" (§29). */
export const REDUCED_MOTION_SCALE = 0.25;
/** Colour of a transition's cover: `nacht.0`. */
export const TRANSITION_COLOR: readonly [number, number, number] = [13 / 255, 10 / 255, 20 / 255];
/** Its channels as module constants (the frame's reset reads no array element, §30). */
const TRANSITION_R = TRANSITION_COLOR[0];
const TRANSITION_G = TRANSITION_COLOR[1];
const TRANSITION_B = TRANSITION_COLOR[2];

/** What an active condition adds to the state effects (strongest value per effect wins). */
export interface ConditionPostEffect {
  readonly heat?: number;
  readonly cold?: number;
  readonly poison?: number;
  readonly drunk?: number;
  readonly tired?: number;
}

/**
 * Condition id → state effect (src/content/conditions.ts). Conditions not listed have no picture-wide
 * effect (their look is at the figure, M3-20, or they carry a symbol and a sound).
 */
export const CONDITION_POST_EFFECTS: Readonly<Record<string, ConditionPostEffect>> = {
  vergiftung: { poison: 1 },
  lebensmittelvergiftung: { poison: 0.55 },
  fieber: { heat: 0.3, poison: 0.25 },
  beschwipst: { drunk: 0.8 },
  betaeubt: { drunk: 0.5 },
  erhitzt: { heat: 0.35 },
  ueberhitzt: { heat: 0.65 },
  hitzschlag: { heat: 1 },
  frierend: { cold: 0.35 },
  unterkuehlt: { cold: 0.65 },
  erfrierend: { cold: 1 },
  muede: { tired: 0.3 },
  erschoepft: { tired: 0.75 },
};

/** How much the low-health rim shows at `health` of `maxHealth` (0 above `LOW_HEALTH_SHARE`, 1 at 0). */
export function hurtFromHealth(health: number, maxHealth: number): number {
  if (!(maxHealth > 0)) return 0;
  const share = Math.max(0, health) / maxHealth;
  return share >= LOW_HEALTH_SHARE ? 0 : Math.min(1, 1 - share / LOW_HEALTH_SHARE);
}

/** One beat of the heart at phase x (0…1 of the period): a quick rise and a slower fall. */
function beat(x: number): number {
  const width = 0.09;
  const d = x / width;
  return x < 0 ? 0 : Math.exp(-d * d);
}

/**
 * The heartbeat of the low-health rim at `time` for `hurt` (0…1): 0…1, a double beat ("lub-dub") per
 * period, the period shortening from `HEARTBEAT_SECONDS.calm` to `.racing`. `steady` (flash reduction)
 * holds it at `HEARTBEAT_STEADY`.
 */
export function heartbeat(time: number, hurt: number, steady: boolean): number {
  if (steady || hurt <= 0) return HEARTBEAT_STEADY;
  const h = Math.min(1, hurt);
  const period = HEARTBEAT_SECONDS.calm + (HEARTBEAT_SECONDS.racing - HEARTBEAT_SECONDS.calm) * h;
  const phase = (Math.max(0, time) % period) / period;
  const second = 0.22;
  return Math.max(beat(phase), 0.65 * beat(phase - second), beat(phase - 1));
}

/** Tendril reach 0…1 of fear `fear` (0…1). */
export function fearTendrils(fear: number): number {
  return fear <= FEAR_TENDRILS_FROM ? 0 : Math.min(1, (fear - FEAR_TENDRILS_FROM) / (1 - FEAR_TENDRILS_FROM));
}

/** Share of the colour fear `fear` (0…1) drains. */
export function fearDrain(fear: number): number {
  return fear <= FEAR_DRAIN_FROM ? 0 : (Math.min(1, (fear - FEAR_DRAIN_FROM) / (1 - FEAR_DRAIN_FROM)) * FEAR_DESATURATION);
}

/** Cover 0…1 of a layer transition `since` seconds after the change (1 at the change, 0 when done). */
export function layerTransition(since: number): number {
  if (!(since >= 0)) return 0;
  return Math.max(0, 1 - since / LAYER_TRANSITION_SECONDS);
}

/** `PostState.layerShown` before the game view showed a layer (no world layer is 1: the surface is 0, caves below). */
export const LAYER_NOT_SHOWN = 1;

/** Slots of `PostState.values`: the effects of the frame (see the accessors of the same names). */
export const POST_SLOT = { lid: 0, frost: 1, fear: 2, hurt: 3, heat: 4, cold: 5, poison: 6, drunk: 7, tired: 8, underwater: 9, vignette: 10, grain: 11, transition: 12, transitionR: 13, transitionG: 14, transitionB: 15 } as const;
/** Length of `PostState.values`. */
const POST_VALUES = 16;
/** Every effect off, the transition's colour (the start of each frame). */
const NEUTRAL_POST = new Float64Array(POST_VALUES);
NEUTRAL_POST[POST_SLOT.transitionR] = TRANSITION_R;
NEUTRAL_POST[POST_SLOT.transitionG] = TRANSITION_G;
NEUTRAL_POST[POST_SLOT.transitionB] = TRANSITION_B;

/** Picture-wide state effects of the frame (`RenderScene.post`). */
export class PostState implements PostEffects {
  /**
   * The effects of the frame (slots `POST_SLOT`) behind the accessors below. The post pass asks `off` before it reads
   * one: a quiet frame's effects are exactly 0, and telling that from the words of the value reads no float (a float
   * read from a record makes a new number in V8's baseline tier, §30).
   */
  readonly values = new Float64Array(POST_VALUES);
  /** The same memory as 32-bit words (`off`). */
  private readonly words = new Int32Array(this.values.buffer);
  /** Shock waves and heat areas of the frame (particles, fire, combat push here). */
  readonly distortion = new DistortionList();
  /** Pinned values of the debug tools (held across frames; the game view applies them last). */
  readonly overrides = new PostOverrides();
  /**
   * Held across frames by the game view: the layer it showed (`LAYER_NOT_SHOWN` before the first frame – an integer, so
   * the field reads without a new number per frame, §30) and when it changed (presentation s).
   */
  layerShown: number = LAYER_NOT_SHOWN;
  layerChangedAt = Number.NaN;

  constructor() {
    this.values.set(NEUTRAL_POST);
  }

  /** Eyelids of a blink: 0 open … 1 shut (M3-20). */
  get lid(): number {
    return this.values[POST_SLOT.lid] as number;
  }
  set lid(v: number) {
    this.values[POST_SLOT.lid] = v;
  }
  /** Icy rim of a freezing player (M3-20). */
  get frost(): number {
    return this.values[POST_SLOT.frost] as number;
  }
  set frost(v: number) {
    this.values[POST_SLOT.frost] = v;
  }
  get fear(): number {
    return this.values[POST_SLOT.fear] as number;
  }
  set fear(v: number) {
    this.values[POST_SLOT.fear] = v;
  }
  get hurt(): number {
    return this.values[POST_SLOT.hurt] as number;
  }
  set hurt(v: number) {
    this.values[POST_SLOT.hurt] = v;
  }
  get heat(): number {
    return this.values[POST_SLOT.heat] as number;
  }
  set heat(v: number) {
    this.values[POST_SLOT.heat] = v;
  }
  get cold(): number {
    return this.values[POST_SLOT.cold] as number;
  }
  set cold(v: number) {
    this.values[POST_SLOT.cold] = v;
  }
  get poison(): number {
    return this.values[POST_SLOT.poison] as number;
  }
  set poison(v: number) {
    this.values[POST_SLOT.poison] = v;
  }
  get drunk(): number {
    return this.values[POST_SLOT.drunk] as number;
  }
  set drunk(v: number) {
    this.values[POST_SLOT.drunk] = v;
  }
  get tired(): number {
    return this.values[POST_SLOT.tired] as number;
  }
  set tired(v: number) {
    this.values[POST_SLOT.tired] = v;
  }
  /** Under water: the picture sways in slow waves (0…1). */
  get underwater(): number {
    return this.values[POST_SLOT.underwater] as number;
  }
  set underwater(v: number) {
    this.values[POST_SLOT.underwater] = v;
  }
  /** Extra vignette of the scene on top of the grade's (0…1). */
  get vignette(): number {
    return this.values[POST_SLOT.vignette] as number;
  }
  set vignette(v: number) {
    this.values[POST_SLOT.vignette] = v;
  }
  /** Fine pixel grain (0…1). */
  get grain(): number {
    return this.values[POST_SLOT.grain] as number;
  }
  set grain(v: number) {
    this.values[POST_SLOT.grain] = v;
  }
  /** Bayer-dithered cover of a transition (0 none … 1 fully covered) and its colour. */
  get transition(): number {
    return this.values[POST_SLOT.transition] as number;
  }
  set transition(v: number) {
    this.values[POST_SLOT.transition] = v;
  }
  get transitionR(): number {
    return this.values[POST_SLOT.transitionR] as number;
  }
  set transitionR(v: number) {
    this.values[POST_SLOT.transitionR] = v;
  }
  get transitionG(): number {
    return this.values[POST_SLOT.transitionG] as number;
  }
  set transitionG(v: number) {
    this.values[POST_SLOT.transitionG] = v;
  }
  get transitionB(): number {
    return this.values[POST_SLOT.transitionB] as number;
  }
  set transitionB(v: number) {
    this.values[POST_SLOT.transitionB] = v;
  }

  /** Whether the effect in `slot` (`POST_SLOT`) is exactly +0 – off – told from its bits (no float is read, §30). */
  off(slot: number): boolean {
    return zeroAt(this.words, slot);
  }

  /** Every effect off (the start of each frame). */
  beginFrame(): void {
    this.values.set(NEUTRAL_POST);
    this.distortion.clear();
  }
}
