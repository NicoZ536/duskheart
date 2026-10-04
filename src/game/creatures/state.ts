/**
 * State of the creatures (docs/SPIEL.md §11, §15; ADR-0080): the component `creature` of every creature entity (a
 * `SparseSet<CreatureState>`), the creatures written into the stock of their home chunk while it is frozen, the carcasses
 * (entities with the component `carcass`) and the nightmare's bookkeeping – all of it saved by the participant
 * `creatures` (src/game/creatures/system.ts), together with the pending requests of the path service.
 *
 * Times are absolute ticks (like `PlayerCombat`): hitstop is `hitstopFromTick` + `hitstopTicks` (frozen for
 * `from < t ≤ from + n`), stagger lasts up to and including `staggerUntilTick`, cooldowns end at their tick. Positions
 * live in the shared `position` component (Motion); the state holds everything else.
 */
import { z } from 'zod';
import { NULL_ENTITY, isEntityHandle, type Entity } from '../../engine/ecs';
import { isLayer, type Layer } from '../../world/model/coords';
import { pathServiceSnapshotSchema } from '../../world/path/service';

// ---------------------------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------------------------

/**
 * States of the utility AI (docs/SPIEL.md §11 "KI (M6-13)"): resting, roaming, grazing, fleeing, investigating a noise
 * or a lost trail, hunting a target, attacking it, circling it (packs), retreating, returning home along the leash,
 * sleeping outside its hours.
 */
export const AI_STATES = ['ruhen', 'umherstreifen', 'grasen', 'fliehen', 'untersuchen', 'jagen', 'angreifen', 'umkreisen', 'rueckzug', 'heimkehr', 'schlafen'] as const;
/** One AI state. */
export type AiState = (typeof AI_STATES)[number];

/** Phases of a creature's attack: none, winding up (the telegraph), the blow landing, recovering. */
export const CREATURE_ATTACK_PHASES = ['keine', 'ausholen', 'erholen'] as const;
/** One attack phase. */
export type CreatureAttackPhase = (typeof CREATURE_ATTACK_PHASES)[number];

/** Why a creature leaves the world without dying: faded at sunrise, the Nachtmahr banished by light or the player's death. */
export const FADE_REASONS = ['sonnenaufgang', 'licht', 'tod'] as const;
/** One reason to fade. */
export type FadeReason = (typeof FADE_REASONS)[number];

// ---------------------------------------------------------------------------------------------
// Live creatures
// ---------------------------------------------------------------------------------------------

/** A creature's own condition (§19.3 "Zustände über Waffen und Munition"): condition id and the tick it ends at. */
export interface CreatureCondition {
  id: string;
  untilTick: number;
}

/** The component `creature`. */
export interface CreatureState {
  /** Creature id (content `creatures`). */
  creature: string;
  /** Index of its variant (`varianten`), −1 for the base form. */
  variant: number;
  /** Serial number (stable identity across stock and restore; pack membership, trap catches). */
  serial: number;
  layer: Layer;
  /** Height level of the tile under it. */
  level: number;
  health: number;
  maxHealth: number;
  /** Where it faces [rad, 0 = east, y down]. */
  facing: number;
  /** Movement of the last tick [px] (the presentation's walk clip, the separation). */
  vx: number;
  vy: number;
  /** Home chunk (it belongs to the stock of this chunk) and home point [px]. */
  homeCx: number;
  homeCy: number;
  homeX: number;
  homeY: number;
  /** Pack number (0 = none): members share their target and take slots around it. */
  pack: number;
  // --- AI ---
  state: AiState;
  /** Tick the state began, and the tick it ends at by itself (idle states; −1 = open). */
  stateTick: number;
  stateUntilTick: number;
  /** The body it hunts, flees from or circles (`NULL_ENTITY`: none). */
  target: Entity;
  /** Last seen or heard place of the target and when [px, tick]. */
  targetX: number;
  targetY: number;
  targetTick: number;
  /** Where it walks to [px] (NaN: nowhere). */
  goalX: number;
  goalY: number;
  /** Last noise it heard [px, tick; tick −1: none]. */
  noiseX: number;
  noiseY: number;
  noiseTick: number;
  /** It was hit and knows its attacker until this tick (−1: not alarmed). */
  alarmedUntilTick: number;
  // --- attack ---
  /** Index of the attack in progress (−1: none) and its phase. */
  attack: number;
  attackPhase: CreatureAttackPhase;
  /** Tick the phase began and the tick it ends. */
  attackTick: number;
  attackEndTick: number;
  /** Where the attack aims [px] (locked when the wind-up begins: a roll gets out of it). */
  aimX: number;
  aimY: number;
  /** Tick each attack is ready again (per attack index). */
  cooldowns: number[];
  // --- hits ---
  hitstopFromTick: number;
  hitstopTicks: number;
  staggerUntilTick: number;
  knockX: number;
  knockY: number;
  knockTicks: number;
  /** Tick of the last hit taken (the presentation's flash), −1 none. */
  hurtTick: number;
  conditions: CreatureCondition[];
  /** Armour broken by the axe's heavy blow [R points] until `armorBreakUntilTick` (§19.2 "Rüstungsbruch"). */
  armorBreak: number;
  armorBreakUntilTick: number;
  // --- movement ---
  /** Path: tile pairs (tx, ty, …), the step it walks to, the goal it was asked for, the pending ticket (0: none). */
  path: number[];
  pathIndex: number;
  pathGoalTx: number;
  pathGoalTy: number;
  pathTicket: number;
  pathTick: number;
  /** Ticks it barely moved while it wanted to (stuck detection). */
  stuckTicks: number;
  /** It flutters (ground birds fleeing): flies until this tick (−1: walks). */
  flyUntilTick: number;
  /** Last trap tile it was checked on (a trap rolls once per entry), packed or −1. */
  trapTile: number;
  /** Tick of its last blow against a closed door (door breakers, §19.4), −1 never. */
  doorTick: number;
  // --- shadow brood, the Nachtmahr ---
  /** Fading: the tick it began (−1: not fading) and why. */
  fadeTick: number;
  fadeReason: FadeReason;
  /** Tick it last took light damage (the burning sound once per second), −1 never. */
  burnTick: number;
  /** Tick it appeared. */
  bornTick: number;
  // --- camouflage (the profile's `tarnung`, the Dornling) ---
  /** It waits hidden (a bush): it neither moves nor thinks until its ambush or a hit reveals it. */
  hidden: boolean;
  /** Tick it last hid or revealed itself (−1 never): the reveal takes `tarnung.erwachen`, the presentation plays it. */
  tarnTick: number;
  // --- the leash (M6-13b) ---
  /** It gave up its target beyond its leash and takes it up again only well within (`BALANCE.ai.leash.reengageShare`). */
  leashed: boolean;
  /** Shadow brood of a Finstermond night: stronger by `BALANCE.spawn.shadowBrood.finstermond` (M6-27). */
  finster: boolean;
}

// ---------------------------------------------------------------------------------------------
// Stock of frozen chunks, carcasses
// ---------------------------------------------------------------------------------------------

/** A creature in the stock of its frozen home chunk (docs/SPIEL.md §11 "Bestand und Spawn"). */
export interface StoredCreature {
  creature: string;
  variant: number;
  serial: number;
  /** Health [HP] (it heals while the chunk is frozen). */
  health: number;
  /** Position and home [px]. */
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  pack: number;
  /** Tick it entered the stock (it heals from then on, `healedHealth`). */
  storedTick: number;
}

/** The creature bookkeeping of one chunk that was ever active. */
export interface ChunkStock {
  /** The chunk was populated (its first activation). */
  seeded: boolean;
  /** Tick the next animal grows back (the regrowth clock runs whether the chunk is active or frozen). */
  regrowTick: number;
  /** The creatures of the chunk while it is frozen (empty while it is active: they are entities then). */
  members: StoredCreature[];
}

/** The component `carcass`: what a defeated animal leaves until it is carved or rots (§14 "Jagen & Zerlegen"). */
export interface Carcass {
  creature: string;
  layer: Layer;
  x: number;
  y: number;
  /** Where the body faced (the presentation lies it down in that direction). */
  facing: number;
  /** Tick it rots away. */
  untilTick: number;
  /** Tier the loot is drawn at (the creature's effective tier). */
  tier: number;
}

// ---------------------------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------------------------

/** A fresh creature state (resting at its home, full health). */
export function createCreatureState(creature: string, layer: Layer, x: number, y: number, maxHealth: number, attacks: number, tick: number, serial: number, homeCx: number, homeCy: number): CreatureState {
  return {
    creature,
    variant: -1,
    serial,
    layer,
    level: 0,
    health: maxHealth,
    maxHealth,
    facing: Math.PI / 2,
    vx: 0,
    vy: 0,
    homeCx,
    homeCy,
    homeX: x,
    homeY: y,
    pack: 0,
    state: 'ruhen',
    stateTick: tick,
    stateUntilTick: -1,
    target: NULL_ENTITY,
    targetX: 0,
    targetY: 0,
    targetTick: -1,
    goalX: Number.NaN,
    goalY: Number.NaN,
    noiseX: 0,
    noiseY: 0,
    noiseTick: -1,
    alarmedUntilTick: -1,
    attack: -1,
    attackPhase: 'keine',
    attackTick: -1,
    attackEndTick: -1,
    aimX: 0,
    aimY: 0,
    cooldowns: new Array<number>(attacks).fill(-1),
    hitstopFromTick: -1,
    hitstopTicks: 0,
    staggerUntilTick: -1,
    knockX: 0,
    knockY: 0,
    knockTicks: 0,
    hurtTick: -1,
    conditions: [],
    armorBreak: 0,
    armorBreakUntilTick: -1,
    path: [],
    pathIndex: 0,
    pathGoalTx: 0,
    pathGoalTy: 0,
    pathTicket: 0,
    pathTick: -1,
    stuckTicks: 0,
    flyUntilTick: -1,
    trapTile: -1,
    doorTick: -1,
    fadeTick: -1,
    fadeReason: 'sonnenaufgang',
    burnTick: -1,
    bornTick: tick,
    hidden: false,
    tarnTick: -1,
    leashed: false,
    finster: false,
  };
}

// ---------------------------------------------------------------------------------------------
// Save schemas
// ---------------------------------------------------------------------------------------------

const safeInt = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const tick = safeInt.min(-1);
const entity = z.number().int().refine((e) => e === NULL_ENTITY || isEntityHandle(e), { message: 'must be an entity handle or -1' });
const layer = z.number().int().refine(isLayer, { message: 'unknown layer' });
const finite = z.number().finite();
/** NaN is saved as null (JSON has no NaN). */
const maybeNaN = z.number().finite().nullable();

/** A saved live creature (the entity and its position come from the ECS participant). */
export const savedCreatureSchema = z
  .object({
    entity: entity.refine((e) => e !== NULL_ENTITY, { message: 'a creature is an entity' }),
    creature: z.string().min(1),
    variant: z.number().int().min(-1),
    serial: safeInt.positive(),
    layer,
    level: z.number().int().min(0),
    health: finite.min(0),
    maxHealth: finite.positive(),
    facing: finite,
    vx: finite,
    vy: finite,
    homeCx: safeInt,
    homeCy: safeInt,
    homeX: finite,
    homeY: finite,
    pack: safeInt.min(0),
    state: z.enum(AI_STATES),
    stateTick: tick,
    stateUntilTick: tick,
    target: entity,
    targetX: finite,
    targetY: finite,
    targetTick: tick,
    goalX: maybeNaN,
    goalY: maybeNaN,
    noiseX: finite,
    noiseY: finite,
    noiseTick: tick,
    alarmedUntilTick: tick,
    attack: z.number().int().min(-1),
    attackPhase: z.enum(CREATURE_ATTACK_PHASES),
    attackTick: tick,
    attackEndTick: tick,
    aimX: finite,
    aimY: finite,
    cooldowns: z.array(tick),
    hitstopFromTick: tick,
    hitstopTicks: z.number().int().min(0),
    staggerUntilTick: tick,
    knockX: finite,
    knockY: finite,
    knockTicks: z.number().int().min(0),
    hurtTick: tick,
    conditions: z.array(z.object({ id: z.string().min(1), untilTick: tick }).strict()),
    armorBreak: finite.min(0),
    armorBreakUntilTick: tick,
    path: z.array(safeInt),
    pathIndex: z.number().int().min(0),
    pathGoalTx: safeInt,
    pathGoalTy: safeInt,
    pathTicket: safeInt.min(0),
    pathTick: tick,
    stuckTicks: z.number().int().min(0),
    flyUntilTick: tick,
    trapTile: safeInt.min(-1),
    doorTick: tick,
    fadeTick: tick,
    fadeReason: z.enum(FADE_REASONS),
    burnTick: tick,
    bornTick: tick,
    // Camouflage came with the Grünhain foes (M6-22); a save without it holds no hidden creature.
    hidden: z.boolean().default(false),
    tarnTick: tick.default(-1),
    // The leash's hysteresis came with M6-13b; a save without it holds no creature that gave its prey up.
    leashed: z.boolean().default(false),
    // The Finstermond's stronger brood came with M6-27; a save without it holds none.
    finster: z.boolean().default(false),
  })
  .strict();
/** A saved live creature. */
export type SavedCreature = z.output<typeof savedCreatureSchema>;

/** A creature in a chunk's stock. */
export const storedCreatureSchema = z
  .object({
    creature: z.string().min(1),
    variant: z.number().int().min(-1),
    serial: safeInt.positive(),
    health: finite.min(0),
    x: finite,
    y: finite,
    homeX: finite,
    homeY: finite,
    pack: safeInt.min(0),
    storedTick: safeInt,
  })
  .strict();

/** The bookkeeping of one chunk. */
export const savedChunkStockSchema = z
  .object({
    layer,
    cx: safeInt,
    cy: safeInt,
    seeded: z.boolean(),
    regrowTick: safeInt,
    members: z.array(storedCreatureSchema),
  })
  .strict();

/** A saved carcass. */
export const savedCarcassSchema = z
  .object({
    entity: entity.refine((e) => e !== NULL_ENTITY, { message: 'a carcass is an entity' }),
    creature: z.string().min(1),
    layer,
    x: finite,
    y: finite,
    facing: finite,
    untilTick: safeInt,
    tier: z.number().int().min(0),
  })
  .strict();

/** Data of the participant `creatures` (version 1). */
export const creaturesSnapshotSchema = z
  .object({
    /** Next serial number. */
    serial: safeInt.positive(),
    /** Next pack number. */
    pack: safeInt.positive(),
    /** Live creatures in the order of the component (the order they update in). */
    creatures: z.array(savedCreatureSchema),
    /** Chunks ever active, by ascending packed chunk id. */
    chunks: z.array(savedChunkStockSchema),
    carcasses: z.array(savedCarcassSchema),
    /** The Nachtmahr hunting the player (`NULL_ENTITY`: none) and the tick it may come again after it was lost. */
    nightmare: entity,
    nightmareRetryTick: tick,
    /** Tick of the next attempt of the night spawner. */
    spawnerTick: safeInt,
    /** The path service's pending requests (`PATH_SERVICE_SAVE_VERSION` 1, ADR-0087). */
    paths: pathServiceSnapshotSchema,
  })
  .strict();
/** Data of the participant `creatures`. */
export type CreaturesSnapshot = z.output<typeof creaturesSnapshotSchema>;
