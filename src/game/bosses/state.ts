/**
 * State of the bosses (docs/SPIEL.md §27 "`bosses` 1 | je Boss Zustand, Phase, Leben, Muster-Cursor, Arena versiegelt,
 * Sieg-Tick, Beute ausgegeben"; participant `bosses`, version 1): one record per boss of the content – asleep with full
 * health in a new world. The pattern's randomness is the stream `bosses` of the simulation (saved with the streams); the
 * cooldowns of the running phase's attacks, the running attack with its locked aim and the arena effects are saved here.
 * A save without the participant (versions 1–3) loads with every boss asleep.
 */
import { z } from 'zod';
import { NULL_ENTITY } from '../../engine/ecs';
import { idSchema } from '../../content/schema/common';
import { BOSS_STATES, type BossState } from './types';

/** No tick (an effect that does not run, an attack that is not running). */
export const NO_TICK = -1;

/** The runtime record of one boss: the contract's `BossState` and what the fight needs besides. */
export interface BossRuntime extends BossState {
  /** Index of the running attack in its phase, −1 none (`attack` is its id). */
  attackIndex: number;
  attackStartTick: number;
  /** Locked aim of the running attack [world px] and its direction [rad]. */
  aimX: number;
  aimY: number;
  aimAngle: number;
  /** Tick from which each attack of the running phase may come again (index = attack of the phase). */
  readyAt: number[];
  /** The leaf storm lowers the sight until this tick (exclusive), else `NO_TICK`. */
  stormUntilTick: number;
  /** The arena's patches burn until this tick (exclusive), else `NO_TICK`. */
  burnUntilTick: number;
  /** The weak points' bodies (entities while awake, else empty). */
  weakPoints: number[];
}

/** A boss of a new world: asleep, full health. */
export function createBossRuntime(boss: string, health: number): BossRuntime {
  return {
    boss,
    entity: NULL_ENTITY,
    state: 'schlafend',
    phase: 0,
    health,
    sealed: false,
    awakenedTick: NO_TICK,
    defeatedTick: NO_TICK,
    transitionUntilTick: NO_TICK,
    nextAttackTick: NO_TICK,
    attack: '',
    attackEndTick: NO_TICK,
    lootGiven: false,
    attackIndex: -1,
    attackStartTick: NO_TICK,
    aimX: 0,
    aimY: 0,
    aimAngle: 0,
    readyAt: [],
    stormUntilTick: NO_TICK,
    burnUntilTick: NO_TICK,
    weakPoints: [],
  };
}

const tick = z.number().int().min(NO_TICK);
const entity = z.number().int().min(0);
/** The boss's body: an entity while it is awake, `NULL_ENTITY` (−1) while it sleeps or after its fall. */
const body = z.number().int().min(NULL_ENTITY);

/** One boss as saved. */
export const bossRecordSchema = z
  .object({
    boss: idSchema,
    entity: body,
    state: z.enum(BOSS_STATES),
    phase: z.number().int().min(0),
    health: z.number().min(0),
    sealed: z.boolean(),
    awakenedTick: tick,
    defeatedTick: tick,
    transitionUntilTick: tick,
    nextAttackTick: tick,
    attack: z.string(),
    attackEndTick: tick,
    lootGiven: z.boolean(),
    attackIndex: z.number().int().min(-1),
    attackStartTick: tick,
    aimX: z.number(),
    aimY: z.number(),
    aimAngle: z.number(),
    readyAt: z.array(tick),
    stormUntilTick: tick,
    burnUntilTick: tick,
    weakPoints: z.array(entity),
  })
  .strict()
  .refine((b) => (b.state === 'erwacht') === (b.entity !== NULL_ENTITY), { message: 'exactly an awake boss has a body', path: ['entity'] })
  .refine((b) => b.state === 'erwacht' || b.weakPoints.length === 0, { message: 'only an awake boss has weak points', path: ['weakPoints'] }) satisfies z.ZodType<BossRuntime>;

/** The saved form of the bosses (one record per boss of the content, in content order). */
export const bossesSnapshotSchema = z.object({ bosses: z.array(bossRecordSchema) }).strict();
/** The saved form. */
export type BossesSnapshot = z.output<typeof bossesSnapshotSchema>;

/** A plain copy of a runtime record (saves never share the live arrays). */
export function copyBossRuntime(b: Readonly<BossRuntime>): BossRuntime {
  return { ...b, readyAt: b.readyAt.slice(), weakPoints: b.weakPoints.slice() };
}
