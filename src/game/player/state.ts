/**
 * The `player` component: the state of the player's body besides its position (the shared `position`
 * component of the motion system, docs/SPIEL.md §3). Saved by the participant `player`.
 */
import { z } from 'zod';
import { PLAYER_MOVE_STATES, type PlayerMoveState } from '../../content/balance/player';
import type { Layer } from '../../world/model/coords';

/** The four sprite directions (docs/SPIEL.md §5 `<aktion>_<richtung>`). */
export const FACINGS = ['down', 'up', 'left', 'right'] as const;
/** One sprite direction. */
export type Facing = (typeof FACINGS)[number];

/** Scripted movements that ignore collision: a jump down a cliff face, a climb up a placed ladder. */
export const TRANSIT_KINDS = ['none', 'jump', 'climb'] as const;
export type TransitKind = (typeof TRANSIT_KINDS)[number];

/** The body of the player. */
export interface PlayerBody {
  /** World layer (0 surface, −1 … −3 caves). */
  layer: Layer;
  /** Height level of the tile under the player (surface 0–4). */
  level: number;
  /** Position at the start of the last tick [px] (the presentation interpolates towards the current one). */
  prevX: number;
  prevY: number;
  /** Velocity of the last tick [px/s]. */
  vx: number;
  vy: number;
  /** Requested movement direction (length ≤ 1). */
  inputX: number;
  inputY: number;
  sprintHeld: boolean;
  sneakHeld: boolean;
  facing: Facing;
  state: PlayerMoveState;
  /** Ticks spent in `state` (animation clocks and "since when" for the presentation). */
  stateTicks: number;
  /** Remaining ticks of a roll, its unit direction and the remaining invulnerable ticks. */
  rollTicks: number;
  rollDx: number;
  rollDy: number;
  invulnerableTicks: number;
  /** Ticks the player has pushed against the cliff face in front (jump down, ladder). */
  pushTicks: number;
  /** A jump or climb in progress: start and end [px], elapsed and total ticks, levels, level and water at the end. */
  transit: TransitKind;
  transitFromX: number;
  transitFromY: number;
  transitToX: number;
  transitToY: number;
  transitTicks: number;
  transitTotal: number;
  transitLevels: number;
  transitToLevel: number;
  transitIntoWater: boolean;
  /** In deep water (§11.4 swimming). */
  swimming: boolean;
  /** Distance since the last footstep event [px]. */
  stepDistancePx: number;
  /** Noise of the current movement relative to walking (§11.4, creature perception). */
  noise: number;
}

/** Body of a player standing at (x, y) on `layer` and height `level`. */
export function createPlayerBody(x: number, y: number, layer: Layer, level: number): PlayerBody {
  return {
    layer,
    level,
    prevX: x,
    prevY: y,
    vx: 0,
    vy: 0,
    inputX: 0,
    inputY: 0,
    sprintHeld: false,
    sneakHeld: false,
    facing: 'down',
    state: 'idle',
    stateTicks: 0,
    rollTicks: 0,
    rollDx: 0,
    rollDy: 0,
    invulnerableTicks: 0,
    pushTicks: 0,
    transit: 'none',
    transitFromX: 0,
    transitFromY: 0,
    transitToX: 0,
    transitToY: 0,
    transitTicks: 0,
    transitTotal: 0,
    transitLevels: 0,
    transitToLevel: 0,
    transitIntoWater: false,
    swimming: false,
    stepDistancePx: 0,
    noise: 0,
  };
}

/** Deepest world layer (docs/WORLD.md §1). */
const LAYER_MIN = -3;
const ticks = z.number().int().min(0);

/** Saved body (participant `player`, version 1). */
export const playerBodySchema = z
  .object({
    layer: z.number().int().min(LAYER_MIN).max(0),
    level: z.number().int().min(0),
    prevX: z.number(),
    prevY: z.number(),
    vx: z.number(),
    vy: z.number(),
    inputX: z.number(),
    inputY: z.number(),
    sprintHeld: z.boolean(),
    sneakHeld: z.boolean(),
    facing: z.enum(FACINGS),
    state: z.enum(PLAYER_MOVE_STATES),
    stateTicks: ticks,
    rollTicks: ticks,
    rollDx: z.number(),
    rollDy: z.number(),
    invulnerableTicks: ticks,
    pushTicks: ticks,
    transit: z.enum(TRANSIT_KINDS),
    transitFromX: z.number(),
    transitFromY: z.number(),
    transitToX: z.number(),
    transitToY: z.number(),
    transitTicks: ticks,
    transitTotal: ticks,
    transitLevels: z.number().int().min(0),
    transitToLevel: z.number().int().min(0),
    transitIntoWater: z.boolean(),
    swimming: z.boolean(),
    stepDistancePx: z.number().min(0),
    noise: z.number().min(0),
  })
  .strict();
