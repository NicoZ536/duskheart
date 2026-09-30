/**
 * The creature system (docs/SPIEL.md §11; MASTERPROMPT §19.4, §20, §12.3, §12.4; ADR-0080; M6-13 … M6-18, M6-27 …
 * M6-30): wild animals, foes and shadow brood as ECS entities – `position` (Motion) and `creature` (`CreatureState`) –
 * that perceive, decide, move, attack and die in the simulation.
 *
 * - **Thinking** (M6-13): every `BALANCE.ai.thinkHz` a creature decides with the utility AI (src/game/creatures/ai/
 *   brain.ts), staggered by entity (a tick of its own among `60 / thinkHz`), at once after a hit. The random parts come
 *   from the stream `creatures`, in the order of the component – the game is deterministic.
 * - **Senses** (M6-14): sight in a cone of 120° (a dot product), its range scaled by the light at the player (the light
 *   map; a carried light × 2), fog and heavy rain, blocked by rock, walls and objects (`sweepCircle`); hearing of the
 *   noises of the tick (src/game/creatures/noise.ts) every tick, rain muffling them. A heard player is a known target;
 *   another noise is investigated. Pack members alert each other within `packAlertTiles`.
 * - **Moving** (M6-17): every tick towards its goal – straight within `directTiles` or when the path service has no
 *   answer yet, else along its path (`PathService`, asked with a snapshot and answered `pathLatencyTicks` later, the
 *   worker only saving time) – with separation from the other bodies and the player, turning at `turnRadPerSecond`,
 *   through `moveCircle` with the rules of its locomotion (`moverRules`: walkers, swimmers stay in water, fliers and
 *   fluttering ground birds over bushes and water). Door breakers batter a closed door in their way
 *   (`BuildingSystem.damage`). Movement never leaves the zone margin (src/game/creatures/zone.ts, M6-16e); light
 *   avoiders never step from a tile at or below their threshold onto a brighter one – not even thrown back.
 * - **Attacks** (M6-15): a weighted choice among the attacks that are ready and in reach; the wind-up (`ausholzeit`
 *   + `anlauf`, × the difficulty's factor) is announced (`creatureTelegraph`: the glint, the sound, the ground mark of an
 *   area) and the blow lands at its end through `CombatSystem.resolve` (damage × the difficulty's factor) – melee in its
 *   arc, a leap on contact after its run-up, an area around its centre. Recovery, then the cooldown.
 * - **Being hit** (the provider `kreaturen`, `CombatTargetProvider`): health, knockback over `knockbackTicks`, stagger
 *   (a wind-up breaks off), hitstop 2–6 ticks (the creature and its clocks stand still), conditions of the weapon
 *   (damage per second, pace), the axe's armour break, alarm (it knows its attacker), the pack joins in. At 0 it dies:
 *   loot (`drawLoot` at its effective tier → `DropSystem.spawn`), a carcass for animals with carving yields, the
 *   bestiary's count, the Nachtmahr banished (`FearSystem.banishNightmare('besiegt')`).
 * - **Carcasses** (M6-30): entities with the component `carcass`; E with a knife carves one (`carcass.carve`: its
 *   `zerlegen` yields as drops, experience `tier_zerlegt`, the knife wears); nobody's rots after `carcassGameHours`.
 * - **Populations** (M6-27, src/game/creatures/population.ts): creatures belong to their home chunk; the zone listener
 *   seeds a chunk on its first activation, writes its animals into the chunk's stock when it freezes and brings them back
 *   (healed) when it wakes; `catchUp` grows the stock and springs its traps meanwhile; active chunks grow back on the world
 *   tick. Shadow brood leaves with its chunk.
 * - **Shadow brood** (M6-28, §12.4): the night spawner puts it 16–40 tiles from the player on dark tiles (< 0,15)
 *   outside hearth zones, at night or underground, up to the density of the biome's tier, the Finstermond and the
 *   difficulty; it avoids light above its threshold (paths and steps), burns in glaring light (5 HP/s) and fades at
 *   sunrise without loot.
 * - **The Nachtmahr** (M6-29, §12.3): `FearSystem.onNightmare` brings it at the darkest of eight directions 14 tiles
 *   from the player; it hunts relentlessly until the pursuit ends (glaring light: it fades; the player's death) or it
 *   is defeated. A blow of the player dissolves the hallucinations it reaches (`strikeHallucination`).
 * - **Commands:** `creature.spawn`, `creature.kill` (debug console), `carcass.carve`.
 * Chunk-bound (catch-up of stocks and traps). Save participant `creatures` (version 1): live creatures in the order of the
 * component, the stocks, carcasses, the Nachtmahr's bookkeeping, the spawner's clock and the path service's pending
 * requests.
 */
import { BALANCE } from '../../content/balance';
import type { Difficulty } from '../../content/balance/death';
import { CONTENT } from '../../content/index';
import type { CreatureAttack } from '../../content/creatures/schema';
import { ENTITY_INDEX_MASK, NULL_ENTITY, SparseSet, type Entity } from '../../engine/ecs';
import type { Rng } from '../../engine/rng';
import { BLOCK_OBJECT, BLOCK_SOLID, BLOCK_VOID, BLOCK_WALL, infoLevel, type MoverRules } from '../../world/collision/tiles';
import { BodyGrid } from '../../world/collision/bodies';
import { createMoveResult, moveCircle } from '../../world/collision/move';
import { createSweepHit, sweepCircle } from '../../world/collision/sweep';
import { WATER_DEPTH_MASK, WATER_FROZEN, type ChunkData } from '../../world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import { lightStage } from '../../world/lightmap/stages';
import type { PathDoorSource } from '../../world/path/doors';
import { PathService } from '../../world/path/service';
import type { PathRequest, PathTicket } from '../../world/path/types';
import type { PathJobs } from '../../world/path/worker';
import type { BuildingSystem } from '../building/system';
import type { CommandOfType, GameCommandType } from '../commands';
import { createCombatAttack, type CombatAttack, type CombatSystem } from '../combat/system';
import { DAMAGE_TYPES, type CombatTargetProvider, type CombatantView, type HitResult } from '../combat/targets';
import { degToRad, inSwing, secondsToTicks } from '../combat/formulas';
import type { DeathSystem } from '../death/system';
import type { DropSystem } from '../drops/system';
import type { EquipmentSystem } from '../equipment/system';
import type { FearSystem } from '../fear/system';
import type { HearthSystem } from '../hearth/system';
import type { InventorySystem } from '../inventory/system';
import { newStack } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { WorldCollision } from '../player/collision';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { SkillsSystem } from '../skills/system';
import type { MotionSystem } from '../systems/motion';
import { createBrainInput, decide, type BrainInput } from './ai/brain';
import { contentCreatureCatalog, type CreatureCatalog, type CreatureKind } from './catalog';
import { worldCreatureEnvironment, type CreatureEnvironment, type CreatureTime, type CreatureWeather } from './environment';
import type { CreatureRejectReason } from './events';
import { MAX_DEBUG_KILL_RADIUS } from './commands';
import {
  TURN_PER_TICK,
  awakeIn,
  carveYield,
  creatureDamage,
  drawLoot,
  effectiveTier,
  healedHealth,
  hearingRadiusTiles,
  inSightCone,
  packSlotAngle,
  shadowBroodMax,
  sightRangeTiles,
  turnTowards,
  windupPoseTicks,
  windupTicks,
  type LootDrop,
} from './formulas';
import type { CreatureLight } from './light';
import { NoiseBus } from './noise';
import { CreaturePopulation, maxHealthOf, variantFor, type PlayerSpot, type PopulationTraps, type SpawnPlan } from './population';
import { createCreatureState, creaturesSnapshotSchema, type AiState, type Carcass, type CreatureState, type FadeReason, type StoredCreature } from './state';
import { coreChunk, insideZone, type CreatureZone } from './zone';

/** Id of the creature system and its save participant. */
export const CREATURES_SYSTEM_ID = 'creatures';
/** Data version of the `creatures` participant. */
export const CREATURES_SAVE_VERSION = 1;
/** ECS component of the creatures and of the carcasses. */
export const CREATURE_COMPONENT = 'creature';
export const CARCASS_COMPONENT = 'carcass';
/** Random stream of the creatures (idle choices, attack patterns, loot, spawns around the player, trap rolls). */
export const CREATURES_RNG_STREAM = 'creatures';
/** Experience source of carving (src/content/skills.ts: `sammeln`). */
export const CARVE_XP = 'tier_zerlegt';

const TICK_HZ = BALANCE.time.tickHz;
const CR = BALANCE.creatures;
const MV = CR.movement;
const AI = BALANCE.ai;
const SB = BALANCE.spawn.shadowBrood;
const THINK_TICKS = Math.max(1, Math.round(TICK_HZ / AI.thinkHz));
const ALARMED_TICKS = secondsToTicks(CR.alarmedSeconds);
const RECOVERY_TICKS = secondsToTicks(CR.attack.recoverySeconds, 1);
const REPATH_TICKS = secondsToTicks(MV.repathSeconds, 1);
const STUCK_TICKS = secondsToTicks(MV.stuckSeconds, 1);
const FADE_TICKS = secondsToTicks(CR.shadowBrood.fadeSeconds, 1);
const DOOR_BLOW_TICKS = Math.max(1, Math.round(TICK_HZ / CR.doors.blowsPerSecond));
const SPAWNER_TICKS = secondsToTicks(SB.intervalSeconds, 1);
const IDLE_MIN_TICKS = secondsToTicks(AI.idleSeconds.min, 1);
const IDLE_MAX_TICKS = secondsToTicks(AI.idleSeconds.max, 1);
const ARRIVE_PX = MV.arriveTiles * TILE_PX;
/** A chasing body stops this close to its point [px]: one pixel (the wind-up needs the target in reach). */
const CHASE_ARRIVE_PX = 1;
/** A step turns the body only when it is at least this share of its walking pace (separation jitter does not). */
const TURN_MIN_SHARE = 0.25;
/** Body id of the player in the body grid (creatures carry their dense index). */
const PLAYER_BODY_ID = -1;
const DIRECT_PX = MV.directTiles * TILE_PX;
const REPATH_MOVED_TILES = MV.repathMovedTiles;
const BURN_PER_TICK = CR.shadowBrood.burnPerSecond / TICK_HZ;
const APPROACH_SHARE = AI.attackApproach;
/** Largest body radius [px] (the separation query reaches the widest neighbour). */
const MAX_BODY_PX = 16;
/** Bodies a separation query reports at most (a pile-up beyond that pushes no harder). */
const NEAR_BODIES = 32;
/** Trap tile key: rows of this many tiles (worlds have at most 2048 tiles per edge, §9.1). */
const TILE_KEY_ROW = 8192;
/** Placement search of a debug spawn [tiles]. */
const SPAWN_SEARCH_TILES = 6;
/** Distance in front of the player a debug spawn without a place lands at [tiles]. */
const SPAWN_AHEAD_TILES = 3;
/** The Nachtmahr's place is tried at its distance and this many tiles closer each time, this many times. */
const NIGHTMARE_STEP_TILES = 2;
const NIGHTMARE_TRIES = 4;
/** Tries for a roaming goal. */
const WANDER_TRIES = 4;
/** A whole turn [°]: an arc this wide reaches all around. */
const FULL_CIRCLE_DEG = 360;
/** Below this displacement [px] a body does not move at all. */
const STILL_PX = 1e-6;
/** Pause before the Nachtmahr tries to come again [ticks]: once a second. */
const NIGHTMARE_RETRY_TICKS = TICK_HZ;
/** A hallucination is struck where the blow's reach meets a circle of half a tile around it (its drawn size). */
const HALLUCINATION_RADIUS_PX = TILE_PX / 2;
/** Eight compass directions (unit vectors, no trigonometry). */
const S2 = Math.SQRT1_2;
const COMPASS: readonly (readonly [number, number])[] = [
  [1, 0],
  [S2, S2],
  [0, 1],
  [-S2, S2],
  [-1, 0],
  [-S2, -S2],
  [0, -1],
  [S2, -S2],
];
/** Flight directions tried, relative to straight away from the threat: 0°, ±45°, ±90°, ±135° (cos, sin). */
const FLEE_TURNS: readonly (readonly [number, number])[] = [
  [1, 0],
  [S2, S2],
  [S2, -S2],
  [0, 1],
  [0, -1],
  [-S2, S2],
  [-S2, -S2],
];
/** What blocks sight: rock, walls, objects and the void, at the higher of both levels. */
const SIGHT_RULES: MoverRules = Object.freeze({ blockMask: BLOCK_SOLID | BLOCK_OBJECT | BLOCK_WALL | BLOCK_VOID, mode: 'fly', dropDown: false });
/** States in which a creature runs. */
const RUNNING: ReadonlySet<AiState> = new Set<AiState>(['fliehen', 'jagen', 'angreifen', 'rueckzug']);
/** Idle states. */
const IDLE: ReadonlySet<AiState> = new Set<AiState>(['ruhen', 'grasen', 'umherstreifen']);

/** The life systems the creatures reach (bound after they exist). */
export interface CreatureLife {
  readonly fear: Pick<FearSystem, 'onNightmare' | 'banishNightmare' | 'pursued' | 'state' | 'strikeHallucination'>;
  readonly death: Pick<DeathSystem, 'difficulty'>;
  readonly skills: Pick<SkillsSystem, 'award'>;
}

/** Traps as the creatures read them (src/game/creatures/traps.ts). */
export interface CreatureTrapHost extends PopulationTraps {
  /** The armed trap (nothing caught) on tile (tx, ty) of `layer`, or `null`. */
  armedAt(layer: Layer, tx: number, ty: number): { readonly id: number; readonly item: string } | null;
  /** A creature walked into trap `id` and was caught. */
  spring(sim: Simulation, id: number, creature: string, tick: number): void;
}

/** Dependencies of the creature system (built in `createSimulation`). */
export interface CreatureSystemDeps {
  readonly player: PlayerSystem;
  readonly motion: MotionSystem;
  readonly collision: WorldCollision;
  readonly combat: Pick<CombatSystem, 'resolve' | 'addTargetProvider'>;
  readonly inventory: InventorySystem;
  readonly equipment: Pick<EquipmentSystem, 'wear'>;
  readonly drops: Pick<DropSystem, 'spawn'>;
  /** The active zone (the game: the world's, `worldCreatureZone`). */
  readonly zone: CreatureZone;
  /** Creatures, profiles, loot, spawn tables and traps (default: the content's). */
  readonly catalog?: CreatureCatalog;
  /** Time, weather and biomes (default: the simulation's world). */
  readonly environment?: CreatureEnvironment;
  /** The light map (absent: everything counts as fully lit, nothing avoids or burns). */
  readonly light?: CreatureLight | null;
  /** The path worker's job queue (browser); without it the paths are computed in this thread at their ready tick. */
  readonly pathJobs?: PathJobs | null;
}

/** What a creature knows of the player in this tick. */
interface PlayerSense extends PlayerSpot {
  entity: Entity;
  alive: boolean;
  level: number;
  /** Light level at the player's feet. */
  light: number;
  /** The player carries a burning light. */
  lit: boolean;
}

/** A pack as one of its members sees it at a decision. */
interface PackView {
  /** Members with the same target (the one deciding included). */
  count: number;
  /** Rank of the one deciding among them (by serial). */
  rank: number;
  /**
   * Place of the one deciding in the pack's turn order: the members whose last blow lies longest back go first (ties by
   * serial) – after its blow a wolf falls back onto the ring and the next one goes in.
   */
  turn: number;
  /** Position of the member of the lowest serial [px]. */
  firstX: number;
  firstY: number;
}

/** A condition's effect on a creature: damage per second and pace factor. */
interface ConditionEffect {
  readonly dps: number;
  readonly tempo: number;
}

/** When a creature struck last, as the latest end of its cooldowns (−1 when it never struck): the later, the more recent. */
function lastBlow(s: CreatureState): number {
  let t = -1;
  for (let i = 0; i < s.cooldowns.length; i++) if ((s.cooldowns[i] as number) > t) t = s.cooldowns[i] as number;
  return t;
}

/** The creature system (see module comment). */
export class CreatureSystem implements SimSystem {
  readonly id = CREATURES_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  /** The creatures (read by the bestiary, the presentation and tests; written only here). */
  readonly store: SparseSet<CreatureState>;
  /** The carcasses. */
  readonly carcasses: SparseSet<Carcass>;
  /** Combatant provider of the creatures (registered with the combat system). */
  readonly targets: CombatTargetProvider;
  /** The deterministic path service (its pending requests are saved with this participant). */
  readonly paths: PathService;
  /** The noises of the tick. */
  readonly noise = new NoiseBus();
  /** Stocks, first populations and regrowth. */
  readonly population: CreaturePopulation;
  readonly catalog: CreatureCatalog;
  /** Chunks entering and leaving the active zone (`SimWorld.addZoneListener`). */
  readonly zoneListener: { onActivate(chunk: ChunkData, tick: number): void; onDeactivate(chunk: ChunkData, tick: number): void };

  private readonly sim: Simulation;
  private readonly player: PlayerSystem;
  private readonly motion: MotionSystem;
  private readonly collision: WorldCollision;
  private readonly combat: Pick<CombatSystem, 'resolve' | 'addTargetProvider'>;
  private readonly inventory: InventorySystem;
  private readonly equipment: Pick<EquipmentSystem, 'wear'>;
  private readonly drops: Pick<DropSystem, 'spawn'>;
  private readonly zone: CreatureZone;
  private readonly environment: CreatureEnvironment;
  private readonly light: CreatureLight | null;
  private life: CreatureLife | null = null;
  private traps: CreatureTrapHost | null = null;
  private hearth: Pick<HearthSystem, 'spawnBlocked'> | null = null;
  private building: Pick<BuildingSystem, 'damage'> | null = null;
  private doors: PathDoorSource | null = null;
  private readonly deathListeners: ((sim: Simulation, creature: string) => void)[] = [];
  /** Pending path tickets by owner (the ids are in the creature state; tickets are found again after loading). */
  private readonly tickets = new Map<Entity, PathTicket>();
  /** Creatures whose health reached 0 in this tick (removed at the next flush). */
  private readonly dying: Entity[] = [];
  private nightmare: Entity = NULL_ENTITY;
  private nightmareRetryTick = -1;
  private spawnerTick = 0;
  // Held records (no allocation per tick).
  private readonly bodies = new BodyGrid();
  private readonly near = new Int32Array(NEAR_BODIES);
  private readonly circle = { x: 0, y: 0, r: 0 };
  private readonly moveOut = createMoveResult();
  private readonly sweepOut = createSweepHit();
  /** The decision's input record (made with the first creature that thinks). */
  private brain: BrainInput | null = null;
  private readonly pl: PlayerSense = { entity: NULL_ENTITY, alive: false, layer: 0, level: 0, x: 0, y: 0, light: 1, lit: false };
  private readonly time: CreatureTime = { phase: 'tag', season: 'fruehling' };
  private readonly weather: CreatureWeather = { haze: 0, precipitation: 0 };
  private readonly pack: PackView = { count: 0, rank: 0, turn: 0, firstX: 0, firstY: 0 };
  private readonly attack: CombatAttack = createCombatAttack();
  private readonly request: PathRequest = { owner: NULL_ENTITY, layer: 0, fromTx: 0, fromTy: 0, toTx: 0, toTy: 0, mover: 'land', opensDoors: false, avoidLightAbove: null, maxNodes: MV.pathMaxNodes };
  private readonly loot: LootDrop[] = [];
  private readonly weights: number[] = [];
  private readonly ready: number[] = [];
  private readonly doomed: Entity[] = [];
  private readonly struck: number[] = [];
  private readonly spot = { x: 0, y: 0 };
  private readonly conditionEffects = new Map<string, ConditionEffect>();
  private readonly onBlow = (p: { readonly entity: Entity; readonly angle: number; readonly reichweite: number; readonly bogen: number; readonly layer: Layer; readonly x: number; readonly y: number; readonly tick: number }): void => {
    if (p.tick === this.sim.eventTick && p.entity === this.sim.player) this.strikeHallucinations(p.layer, p.x, p.y, p.angle, p.reichweite, p.bogen);
  };

  constructor(sim: Simulation, deps: CreatureSystemDeps) {
    this.sim = sim;
    this.player = deps.player;
    this.motion = deps.motion;
    this.collision = deps.collision;
    this.combat = deps.combat;
    this.inventory = deps.inventory;
    this.equipment = deps.equipment;
    this.drops = deps.drops;
    this.zone = deps.zone;
    this.catalog = deps.catalog ?? contentCreatureCatalog();
    this.environment = deps.environment ?? worldCreatureEnvironment();
    this.light = deps.light ?? null;
    for (const kind of this.catalog.kinds) {
      for (const a of kind.attacks) {
        // Ranged creature attacks need a projectile launch of the combat system for creatures (PROGRESS M6-15b).
        if (a.art === 'fernkampf') throw new Error(`CreatureSystem: ${kind.id} has the ranged attack "${a.name}"; ranged creature attacks are not wired yet (M6-15b)`);
      }
    }
    this.store = sim.ecs.registerComponent(CREATURE_COMPONENT, new SparseSet<CreatureState>());
    this.carcasses = sim.ecs.registerComponent(CARCASS_COMPONENT, new SparseSet<Carcass>());
    this.population = new CreaturePopulation({ sim, catalog: this.catalog, environment: this.environment, placeable: (kind, layer, tx, ty) => this.placeable(kind, layer, tx, ty) });
    this.paths = new PathService({
      grid: () => this.collision.grid,
      chunkAllowed: (layer, cx, cy) => coreChunk(this.zone, layer, cx, cy),
      light: this.light?.paths ?? null,
      jobs: deps.pathJobs ?? null,
    });
    this.noise.usePlayerPosition((s, out) => {
      const body = this.player.body(s);
      if (body === undefined || !this.player.position(s, out)) return false;
      out.layer = body.layer;
      return true;
    });
    this.targets = {
      id: 'kreaturen',
      queryCircle: (_s, layer, x, y, r, out) => this.queryCircle(layer, x, y, r, out),
      view: (_s, e, out) => this.view(e, out),
      aware: (s, e, attacker) => this.aware(s, e, attacker),
      applyHit: (s, e, hit) => this.applyHit(s, e, hit),
    };
    deps.combat.addTargetProvider(this.targets);
    this.zoneListener = {
      onActivate: (chunk, tick) => this.activated(chunk, tick),
      onDeactivate: (chunk, tick) => this.deactivated(chunk, tick),
    };
    this.commands = {
      'creature.spawn': (s, cmd, tick) => this.handleSpawn(s, cmd, tick),
      'creature.kill': (s, cmd, tick) => this.handleKill(s, cmd, tick),
      'carcass.carve': (s, cmd, tick) => this.handleCarve(s, cmd, tick),
    };
    this.save = {
      id: CREATURES_SYSTEM_ID,
      version: CREATURES_SAVE_VERSION,
      // A save from before M6 has no creatures: every chunk is populated on its next activation.
      migrations: [{ from: 0, migrate: () => this.emptySnapshot() }],
      serialize: () => this.serialize(),
      deserialize: (data) => this.deserialize(data),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------------------------

  /** Binds the life systems: the Nachtmahr (fear), the difficulty (death), the experience of carving (skills). */
  useLife(life: CreatureLife): void {
    this.life = life;
    life.fear.onNightmare((s) => this.summonNightmare(s));
  }

  /** Binds the traps: creatures walk into them; frozen chunks catch through them. */
  useTraps(traps: CreatureTrapHost): void {
    this.traps = traps;
    this.population.useTraps(traps);
  }

  /** Binds the hearth fires: no shadow brood appears in their zones (§12.4). */
  useHearth(hearth: Pick<HearthSystem, 'spawnBlocked'>): void {
    this.hearth = hearth;
  }

  /** Binds the building grid: closed doors are planned through by door breakers and battered (§19.4). */
  useBuilding(building: Pick<BuildingSystem, 'damage'>, doors: PathDoorSource): void {
    this.building = building;
    this.doors = doors;
    this.paths.useDoors(doors);
  }

  /** Adds a listener for creatures that die (the bestiary counts defeats). */
  onDeath(listener: (sim: Simulation, creature: string) => void): void {
    this.deathListeners.push(listener);
  }

  /** The difficulty (Normal without the life systems). */
  get difficulty(): Difficulty {
    return this.life?.death.difficulty ?? 'normal';
  }

  /** The Nachtmahr hunting the player, or `NULL_ENTITY`. */
  get nightmareEntity(): Entity {
    return this.nightmare;
  }

  /** Writes the position of creature `e` into `out`; false if it has none. */
  positionOf(e: Entity, out: { x: number; y: number }): boolean {
    const row = this.motion.position.indexOf(e);
    if (row < 0) return false;
    out.x = this.motion.position.columns.x[row] as number;
    out.y = this.motion.position.columns.y[row] as number;
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------------------------

  update(sim: Simulation): void {
    const tick = sim.eventTick;
    this.flushDying(sim);
    this.paths.update(tick);
    this.noise.collect(sim);
    sim.events.forEachOfType('attackStarted', this.onBlow);
    this.readPlayer(sim);
    this.upkeepNightmare(sim, tick);
    if (this.store.size === 0) return;
    this.environment.timeAt(sim, tick, this.time);
    const pl = this.pl;
    this.environment.weather(sim, pl.layer, Math.floor(pl.x / TILE_PX), Math.floor(pl.y / TILE_PX), this.weather);
    this.buildBodies();
    for (let i = 0; i < this.store.size; i++) this.step(sim, i, tick);
    this.flushDying(sim);
  }

  worldTick(sim: Simulation): void {
    const tick = sim.eventTick;
    this.flushDying(sim);
    this.readPlayer(sim);
    this.regrowActive(tick);
    this.rotCarcasses(sim, tick);
    this.nightSpawner(sim, tick);
    if (this.nightmare === NULL_ENTITY && this.life?.fear.pursued === true && this.pl.alive && tick >= this.nightmareRetryTick) this.summonNightmare(sim);
    this.flushDying(sim);
  }

  /** Frozen chunk from `fromTick` to `toTick`: its stock grows back, its traps catch (src/game/creatures/population.ts). */
  catchUp(chunk: ChunkData, fromTick: number, toTick: number): void {
    this.population.catchUp(chunk, fromTick, toTick);
  }

  private readPlayer(sim: Simulation): void {
    const pl = this.pl;
    pl.alive = false;
    pl.entity = sim.player;
    if (pl.entity === NULL_ENTITY) return;
    const body = this.player.body(sim);
    const v = this.player.vitalsOf(pl.entity);
    if (body === undefined || v === undefined || !this.player.position(sim, pl)) return;
    pl.alive = v.health > 0;
    pl.layer = body.layer;
    pl.level = body.level;
    pl.light = this.light === null ? 1 : this.light.levelAt(sim, pl.layer, pl.x, pl.y);
    pl.lit = this.light !== null && this.light.playerLit(sim);
  }

  /** The bodies of this tick: every creature at its dense index, the player behind them. */
  private buildBodies(): void {
    const b = this.bodies;
    b.clear();
    const pos = this.motion.position;
    for (let i = 0; i < this.store.size; i++) {
      const e = this.store.entityAt(i);
      const s = this.store.valueAt(i);
      const row = pos.indexOf(e);
      b.add(i, s.layer, row < 0 ? 0 : (pos.columns.x[row] as number), row < 0 ? 0 : (pos.columns.y[row] as number), this.catalog.get(s.creature).def.radius);
    }
    if (this.pl.alive) b.add(PLAYER_BODY_ID, this.pl.layer, this.pl.x, this.pl.y, BALANCE.combat.body.playerRadiusPx);
    b.build();
  }

  /** One creature's tick (see module comment). */
  private step(sim: Simulation, i: number, tick: number): void {
    const e = this.store.entityAt(i);
    const s = this.store.valueAt(i);
    if (s.health <= 0) return;
    const row = this.motion.position.indexOf(e);
    if (row < 0) return;
    const pos = this.motion.position.columns;
    const x = pos.x[row] as number;
    const y = pos.y[row] as number;
    const kind = this.catalog.get(s.creature);
    if (s.fadeTick >= 0) {
      if (tick - s.fadeTick >= FADE_TICKS) this.doom(e);
      return;
    }
    // Outside the zone margin a body stands still (src/game/creatures/zone.ts).
    if (!insideZone(this.zone, s.layer, x, y)) {
      s.vx = 0;
      s.vy = 0;
      return;
    }
    if (kind.shadow && s.layer === 0 && this.time.phase === 'tag') {
      this.fade(sim, e, s, x, y, 'sonnenaufgang');
      return;
    }
    const level = this.light === null ? 0 : this.light.tileLevel(sim, s.layer, Math.floor(x / TILE_PX), Math.floor(y / TILE_PX));
    if (kind.shadow && this.light !== null && lightStage(level) === 'gleissend') {
      this.hurt(sim, e, s, x, y, BURN_PER_TICK, NULL_ENTITY);
      if (s.burnTick < 0 || tick - s.burnTick >= TICK_HZ) {
        s.burnTick = tick;
        sim.events.push('creatureBurning', { entity: e, creature: s.creature, layer: s.layer, x, y, tick });
      }
      if (s.health <= 0) return;
    }
    const tempo = this.conditions(sim, e, s, x, y, tick);
    if (s.health <= 0) return;
    this.hear(s, kind, x, y, tick, e);
    // Hitstop: the body and its clocks stand still (`from < t ≤ from + n`).
    if (s.hitstopTicks > 0 && tick > s.hitstopFromTick && tick <= s.hitstopFromTick + s.hitstopTicks) {
      if (s.attackPhase !== 'keine') s.attackEndTick++;
      s.vx = 0;
      s.vy = 0;
      return;
    }
    if (s.knockTicks > 0) {
      s.knockTicks--;
      this.moveBody(sim, s, kind, row, x, y, s.knockX, s.knockY, false);
    }
    if (tick <= s.staggerUntilTick) {
      if (s.attackPhase === 'ausholen') this.cancelAttack(s);
      if (s.knockTicks === 0) {
        s.vx = 0;
        s.vy = 0;
      }
      return;
    }
    const cx = pos.x[row] as number;
    const cy = pos.y[row] as number;
    if ((tick + (e & ENTITY_INDEX_MASK)) % THINK_TICKS === 0 || s.hurtTick === tick) this.think(sim, e, s, kind, cx, cy, level, tick);
    if (s.attackPhase !== 'keine') {
      this.attackStep(sim, e, s, kind, row, cx, cy, tick);
      return;
    }
    this.moveStep(sim, e, s, kind, i, row, cx, cy, tempo, tick);
    this.checkTrap(sim, e, s, kind, row, tick);
  }

  // -------------------------------------------------------------------------------------------
  // Senses (M6-14)
  // -------------------------------------------------------------------------------------------

  /** The noises of this tick the creature hears (every tick: a noise lasts one). */
  private hear(s: CreatureState, kind: CreatureKind, x: number, y: number, tick: number, self: Entity): void {
    const n = this.noise;
    if (n.count === 0 || n.tick !== tick) return;
    const hearing = kind.profile.gehoer;
    if (!(hearing > 0)) return;
    const precipitation = this.weather.precipitation;
    for (let k = 0; k < n.count; k++) {
      if (n.layer(k) !== s.layer || n.source(k) === self) continue;
      const r = hearingRadiusTiles(n.radius(k), hearing, precipitation) * TILE_PX;
      const dx = n.x(k) - x;
      const dy = n.y(k) - y;
      if (dx * dx + dy * dy > r * r) continue;
      if (n.source(k) === this.pl.entity && this.pl.alive) {
        s.target = this.pl.entity;
        s.targetX = n.x(k);
        s.targetY = n.y(k);
        s.targetTick = tick;
      } else {
        s.noiseX = n.x(k);
        s.noiseY = n.y(k);
        s.noiseTick = tick;
      }
    }
  }

  /** Whether the creature at (x, y) sees the player now (cone, range by light and weather, line of sight). */
  private sees(s: CreatureState, kind: CreatureKind, x: number, y: number, awake: boolean): boolean {
    const pl = this.pl;
    if (!pl.alive || pl.layer !== s.layer || !awake) return false;
    const dx = pl.x - x;
    const dy = pl.y - y;
    const d2 = dx * dx + dy * dy;
    const near = AI.perception.nearTiles * TILE_PX;
    if (d2 <= near * near) return true;
    const range = sightRangeTiles(kind.profile.sicht, pl.light, pl.lit, this.weather.haze, this.weather.precipitation) * TILE_PX;
    if (d2 > range * range || !inSightCone(s.facing, dx, dy)) return false;
    return this.lineOfSight(s.layer, Math.max(s.level, pl.level), x, y, pl.x, pl.y);
  }

  private lineOfSight(layer: Layer, level: number, x0: number, y0: number, x1: number, y1: number): boolean {
    return !sweepCircle(this.collision.grid, layer, x0, y0, x1, y1, 0, SIGHT_RULES, level, this.sweepOut).hit;
  }

  // -------------------------------------------------------------------------------------------
  // Thinking (M6-13, M6-18)
  // -------------------------------------------------------------------------------------------

  private think(sim: Simulation, e: Entity, s: CreatureState, kind: CreatureKind, x: number, y: number, light: number, tick: number): void {
    const p = kind.profile;
    const pl = this.pl;
    const awake = awakeIn(kind.def.aktiv, this.time.phase);
    const hadTarget = s.target !== NULL_ENTITY && tick - s.targetTick <= secondsToTicks(p.gedaechtnis);
    const sees = this.sees(s, kind, x, y, awake);
    if (sees) {
      s.target = pl.entity;
      s.targetX = pl.x;
      s.targetY = pl.y;
      s.targetTick = tick;
    }
    // A dead player is no target (the respawned one is found anew).
    if (s.target !== NULL_ENTITY && (!pl.alive || s.target !== pl.entity || pl.layer !== s.layer)) s.target = NULL_ENTITY;
    const memory = secondsToTicks(p.gedaechtnis);
    const investigate = secondsToTicks(p.untersuchen);
    const hasTarget = s.target !== NULL_ENTITY && tick - s.targetTick <= memory;
    if (hasTarget && !hadTarget) {
      sim.events.push('creatureCall', { entity: e, creature: s.creature, reason: 'alarm', layer: s.layer, x, y, tick });
      this.alertPack(e, s, x, y, tick);
    }
    const b = (this.brain ??= createBrainInput(p));
    b.profile = p;
    b.awake = awake;
    b.hasTarget = hasTarget;
    b.seesTarget = sees;
    const tdx = s.targetX - x;
    const tdy = s.targetY - y;
    const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
    b.targetTiles = hasTarget ? tdist / TILE_PX : Number.POSITIVE_INFINITY;
    b.heardNoise = !hasTarget && s.noiseTick >= 0 && tick - s.noiseTick <= investigate;
    b.lostTrail = !hasTarget && s.targetTick >= 0 && tick - s.targetTick <= memory + investigate;
    b.health = s.maxHealth > 0 ? s.health / s.maxHealth : 0;
    b.alarmed = tick <= s.alarmedUntilTick;
    const choice = hasTarget && sees ? this.readyAttack(s, kind, x, y, tick) : -1;
    b.attackReady = choice >= 0;
    this.packView(e, s);
    b.inPack = p.rudel !== undefined && this.pack.count > 1;
    b.attackTurn = !b.inPack || this.pack.turn < (p.rudel?.angreiferZugleich ?? 1) || s.attackPhase !== 'keine';
    const hdx = s.homeX - x;
    const hdy = s.homeY - y;
    b.homeTiles = Math.sqrt(hdx * hdx + hdy * hdy) / TILE_PX;
    const invX = s.targetX - s.homeX;
    const invY = s.targetY - s.homeY;
    b.homeInvaded = hasTarget && invX * invX + invY * invY <= (p.fluchtDistanz * TILE_PX) ** 2;
    b.inAvoidedLight = p.meidetLicht !== null && this.light !== null && light > p.meidetLicht;
    b.justStruck = s.attackPhase === 'erholen';
    // A fresh creature has no idle clock yet: its first decision draws one.
    b.idleExpired = s.stateUntilTick < 0 || tick >= s.stateUntilTick;
    b.current = s.state;
    const rng = sim.rng.stream(CREATURES_RNG_STREAM);
    const next = decide(b, rng);
    const renewed = next !== s.state || (IDLE.has(next) && b.idleExpired);
    if (renewed) this.enter(sim, e, s, kind, next, x, y, tick);
    this.aim(sim, e, s, kind, x, y, tick, choice);
    if (awake && IDLE.has(s.state) && rng.next() < CR.idleCallChance) sim.events.push('creatureCall', { entity: e, creature: s.creature, reason: 'ruf', layer: s.layer, x, y, tick });
  }

  /** Enters AI state `state`: its clock, an idle state's length, a roaming goal, a ground bird's flutter. */
  private enter(sim: Simulation, e: Entity, s: CreatureState, kind: CreatureKind, state: AiState, x: number, y: number, tick: number): void {
    const was = s.state;
    s.state = state;
    s.stateTick = tick;
    s.stateUntilTick = -1;
    s.stuckTicks = 0;
    if (IDLE.has(state)) {
      const rng = sim.rng.stream(CREATURES_RNG_STREAM);
      s.stateUntilTick = tick + rng.int(IDLE_MIN_TICKS, IDLE_MAX_TICKS + 1);
      if (state === 'umherstreifen') this.wanderGoal(s, kind, rng);
      else this.clearGoal(s);
    }
    if (state === 'fliehen' && was !== 'fliehen' && kind.profile.fluchtFlug !== undefined) {
      s.flyUntilTick = tick + secondsToTicks(kind.profile.fluchtFlug, 1);
      sim.events.push('creatureFlushed', { entity: e, creature: s.creature, layer: s.layer, x, y, tick });
    }
  }

  /** The goal of the state now (hunting follows the target, fleeing looks for a way out) and the start of an attack. */
  private aim(sim: Simulation, e: Entity, s: CreatureState, kind: CreatureKind, x: number, y: number, tick: number, attack: number): void {
    switch (s.state) {
      case 'ruhen':
      case 'grasen':
      case 'schlafen':
        this.clearGoal(s);
        return;
      case 'umherstreifen':
        return;
      case 'heimkehr':
        this.setGoal(s, s.homeX, s.homeY);
        return;
      case 'jagen':
        this.approachGoal(s, kind, x, y);
        return;
      case 'untersuchen':
        if (s.target === NULL_ENTITY && s.noiseTick > s.targetTick) this.setGoal(s, s.noiseX, s.noiseY);
        else this.setGoal(s, s.targetX, s.targetY);
        return;
      case 'fliehen':
        this.fleeGoal(sim, s, kind, x, y);
        return;
      case 'rueckzug':
        this.retreatGoal(s, kind, x, y);
        return;
      case 'umkreisen':
        this.circleGoal(s, kind);
        return;
      case 'angreifen':
        if (attack >= 0 && s.attackPhase === 'keine') this.startAttack(sim, e, s, kind, attack, x, y, tick);
        else if (s.attackPhase === 'keine') this.approachGoal(s, kind, x, y);
        return;
    }
  }

  private setGoal(s: CreatureState, x: number, y: number): void {
    s.goalX = x;
    s.goalY = y;
  }

  private clearGoal(s: CreatureState): void {
    s.goalX = Number.NaN;
    s.goalY = Number.NaN;
    s.path.length = 0;
    s.pathIndex = 0;
  }

  /** A point within `streifen` of home the creature may stand on (a few tries; none: it rests where it is). */
  private wanderGoal(s: CreatureState, kind: CreatureKind, rng: Rng): void {
    const r = kind.profile.streifen;
    for (let t = 0; t < WANDER_TRIES; t++) {
      const dx = rng.float(-r, r);
      const dy = rng.float(-r, r);
      if (dx * dx + dy * dy > r * r) continue;
      const gx = s.homeX + dx * TILE_PX;
      const gy = s.homeY + dy * TILE_PX;
      if (!insideZone(this.zone, s.layer, gx, gy) || !this.standable(kind, s.layer, Math.floor(gx / TILE_PX), Math.floor(gy / TILE_PX))) continue;
      this.setGoal(s, gx, gy);
      return;
    }
    this.clearGoal(s);
  }

  /**
   * Away from the threat (the target, or the light for shadow brood): the first free direction of straight away, ±45°,
   * ±90°, ±135° at `fleeLookTiles`; shadow brood in light the darkest of eight directions at `escapeLookTiles`.
   */
  private fleeGoal(sim: Simulation, s: CreatureState, kind: CreatureKind, x: number, y: number): void {
    const p = kind.profile;
    if (p.meidetLicht !== null && this.light !== null) {
      const here = this.light.tileLevel(sim, s.layer, Math.floor(x / TILE_PX), Math.floor(y / TILE_PX));
      if (here > p.meidetLicht) {
        this.escapeGoal(sim, s, kind, x, y);
        return;
      }
    }
    let ax = x - s.targetX;
    let ay = y - s.targetY;
    if (s.target === NULL_ENTITY && s.noiseTick > s.targetTick) {
      ax = x - s.noiseX;
      ay = y - s.noiseY;
    }
    let len = Math.sqrt(ax * ax + ay * ay);
    if (len === 0) {
      ax = -Math.cos(s.facing);
      ay = -Math.sin(s.facing);
      len = 1;
    }
    ax /= len;
    ay /= len;
    const look = MV.fleeLookTiles * TILE_PX;
    const flying = s.flyUntilTick >= this.sim.eventTick;
    const rules = flying ? kind.flyRules : kind.rules;
    for (const [c, sn] of FLEE_TURNS) {
      const dx = ax * c - ay * sn;
      const dy = ax * sn + ay * c;
      const gx = x + dx * look;
      const gy = y + dy * look;
      if (!insideZone(this.zone, s.layer, gx, gy)) continue;
      if (sweepCircle(this.collision.grid, s.layer, x, y, gx, gy, kind.def.radius, rules, s.level, this.sweepOut).hit) continue;
      this.setGoal(s, gx, gy);
      s.path.length = 0;
      return;
    }
    this.clearGoal(s);
  }

  /** Shadow brood in light: the darkest reachable point of eight directions at `escapeLookTiles`. */
  private escapeGoal(sim: Simulation, s: CreatureState, kind: CreatureKind, x: number, y: number): void {
    const look = CR.shadowBrood.escapeLookTiles * TILE_PX;
    let best = Number.POSITIVE_INFINITY;
    let bx = Number.NaN;
    let by = Number.NaN;
    for (const [dx, dy] of COMPASS) {
      const gx = x + dx * look;
      const gy = y + dy * look;
      if (!insideZone(this.zone, s.layer, gx, gy)) continue;
      const tx = Math.floor(gx / TILE_PX);
      const ty = Math.floor(gy / TILE_PX);
      if (!this.standable(kind, s.layer, tx, ty)) continue;
      const lv = (this.light as CreatureLight).tileLevel(sim, s.layer, tx, ty);
      if (lv < best) {
        best = lv;
        bx = gx;
        by = gy;
      }
    }
    if (Number.isNaN(bx)) this.clearGoal(s);
    else this.setGoal(s, bx, by);
  }

  /** A ranged fighter backs off to its distance; others step back from their blow. */
  private retreatGoal(s: CreatureState, kind: CreatureKind, x: number, y: number): void {
    let ax = x - s.targetX;
    let ay = y - s.targetY;
    const len = Math.sqrt(ax * ax + ay * ay);
    if (len === 0) {
      this.clearGoal(s);
      return;
    }
    ax /= len;
    ay /= len;
    const keep = (kind.profile.fernkampfAbstand ?? MV.fleeLookTiles) * TILE_PX;
    this.setGoal(s, s.targetX + ax * keep, s.targetY + ay * keep);
  }

  /** Pack tactics (M6-18): the slot of this member on the ring around the target. */
  private circleGoal(s: CreatureState, kind: CreatureKind): void {
    const ring = (kind.profile.rudel?.ringTiles ?? MV.fleeLookTiles) * TILE_PX;
    const pk = this.pack;
    const base = Math.atan2(pk.firstY - s.targetY, pk.firstX - s.targetX);
    const angle = packSlotAngle(pk.rank, pk.count, base);
    this.setGoal(s, s.targetX + Math.cos(angle) * ring, s.targetY + Math.sin(angle) * ring);
  }

  /** Closing in on the target until its reach (`attackApproach` × the shortest reach). */
  private approachGoal(s: CreatureState, kind: CreatureKind, x: number, y: number): void {
    let reach = Number.POSITIVE_INFINITY;
    for (const a of kind.attacks) reach = Math.min(reach, a.reichweite);
    if (!Number.isFinite(reach)) {
      this.setGoal(s, s.targetX, s.targetY);
      return;
    }
    const dx = x - s.targetX;
    const dy = y - s.targetY;
    const len = Math.sqrt(dx * dx + dy * dy);
    const stop = reach * APPROACH_SHARE + BALANCE.combat.body.playerRadiusPx;
    if (len <= stop || len === 0) this.setGoal(s, x, y);
    else this.setGoal(s, s.targetX + (dx / len) * stop, s.targetY + (dy / len) * stop);
  }

  /** The members of `s`'s pack with the same target: count, rank of `s` by serial, its place in the turn order, the first one's place. */
  private packView(e: Entity, s: CreatureState): void {
    const pk = this.pack;
    pk.count = 1;
    pk.rank = 0;
    pk.turn = 0;
    const last = lastBlow(s);
    const pos = this.motion.position;
    const own = pos.indexOf(e);
    pk.firstX = own < 0 ? 0 : (pos.columns.x[own] as number);
    pk.firstY = own < 0 ? 0 : (pos.columns.y[own] as number);
    if (s.pack === 0) return;
    let firstSerial = s.serial;
    for (let j = 0; j < this.store.size; j++) {
      const o = this.store.valueAt(j);
      if (o === s || o.pack !== s.pack || o.health <= 0 || o.target !== s.target || s.target === NULL_ENTITY) continue;
      pk.count++;
      if (o.serial < s.serial) pk.rank++;
      const ol = lastBlow(o);
      if (ol < last || (ol === last && o.serial < s.serial)) pk.turn++;
      if (o.serial < firstSerial) {
        firstSerial = o.serial;
        const row = pos.indexOf(this.store.entityAt(j));
        if (row >= 0) {
          pk.firstX = pos.columns.x[row] as number;
          pk.firstY = pos.columns.y[row] as number;
        }
      }
    }
  }

  /** Pack members within `packAlertTiles` learn the target of `s`. */
  private alertPack(e: Entity, s: CreatureState, x: number, y: number, tick: number): void {
    if (s.pack === 0) return;
    const reach = AI.packAlertTiles * TILE_PX;
    const pos = this.motion.position;
    for (let j = 0; j < this.store.size; j++) {
      const o = this.store.valueAt(j);
      const oe = this.store.entityAt(j);
      if (oe === e || o.pack !== s.pack || o.health <= 0) continue;
      const row = pos.indexOf(oe);
      if (row < 0) continue;
      const dx = (pos.columns.x[row] as number) - x;
      const dy = (pos.columns.y[row] as number) - y;
      if (dx * dx + dy * dy > reach * reach) continue;
      o.target = s.target;
      o.targetX = s.targetX;
      o.targetY = s.targetY;
      o.targetTick = tick;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Attacks (M6-15)
  // -------------------------------------------------------------------------------------------

  /** A weighted choice among the attacks off cooldown with the target in reach (stream `creatures`), or −1. */
  private readyAttack(s: CreatureState, kind: CreatureKind, x: number, y: number, tick: number): number {
    const pl = this.pl;
    if (!pl.alive || pl.layer !== s.layer || pl.level !== s.level) return -1;
    const dx = pl.x - x;
    const dy = pl.y - y;
    const edge = Math.sqrt(dx * dx + dy * dy) - BALANCE.combat.body.playerRadiusPx;
    const ready = this.ready;
    const weights = this.weights;
    ready.length = 0;
    weights.length = 0;
    for (let i = 0; i < kind.attacks.length; i++) {
      const a = kind.attacks[i] as CreatureAttack;
      if ((s.cooldowns[i] ?? -1) > tick) continue;
      const reach = a.art === 'flaeche' ? a.reichweite + (a.flaeche?.radius ?? 0) : a.reichweite;
      if (edge > reach) continue;
      ready.push(i);
      weights.push(a.gewicht);
    }
    if (ready.length === 0) return -1;
    if (ready.length === 1) return ready[0] as number;
    return ready[this.sim.rng.stream(CREATURES_RNG_STREAM).weightedIndex(weights)] as number;
  }

  /** Winds up attack `index` at the target: the telegraph (`creatureTelegraph`), aim locked. */
  private startAttack(sim: Simulation, e: Entity, s: CreatureState, kind: CreatureKind, index: number, x: number, y: number, tick: number): void {
    const a = kind.attacks[index] as CreatureAttack;
    const difficulty = this.difficulty;
    const ticks = windupTicks(a, difficulty);
    s.attack = index;
    s.attackPhase = 'ausholen';
    s.attackTick = tick;
    s.attackEndTick = tick + ticks;
    s.aimX = s.targetX;
    s.aimY = s.targetY;
    const dx = s.aimX - x;
    const dy = s.aimY - y;
    const angle = dx === 0 && dy === 0 ? s.facing : Math.atan2(dy, dx);
    s.facing = angle;
    let flaeche: { x: number; y: number; radius: number } | null = null;
    if (a.art === 'flaeche' && a.flaeche !== undefined) {
      // The area lands on the target when it is within reach, else at the reach towards it.
      const len = Math.sqrt(dx * dx + dy * dy);
      const d = Math.min(len, a.reichweite);
      s.aimX = len === 0 ? x : x + (dx / len) * d;
      s.aimY = len === 0 ? y : y + (dy / len) * d;
      flaeche = { x: s.aimX, y: s.aimY, radius: a.flaeche.radius };
    }
    this.clearGoal(s);
    s.vx = 0;
    s.vy = 0;
    sim.events.push('creatureTelegraph', { entity: e, creature: s.creature, angriff: a.name, ticks, poseTicks: windupPoseTicks(a, difficulty), angle, flaeche, layer: s.layer, x, y, tick });
  }

  private cancelAttack(s: CreatureState): void {
    s.attack = -1;
    s.attackPhase = 'keine';
    s.attackTick = -1;
    s.attackEndTick = -1;
  }

  /** A tick of an attack: the wind-up (a leap runs up after its pose), the blow at its end, the recovery. */
  private attackStep(sim: Simulation, e: Entity, s: CreatureState, kind: CreatureKind, row: number, x: number, y: number, tick: number): void {
    const a = kind.attacks[s.attack];
    if (a === undefined) {
      this.cancelAttack(s);
      return;
    }
    if (s.attackPhase === 'erholen') {
      s.vx = 0;
      s.vy = 0;
      if (tick >= s.attackEndTick) this.cancelAttack(s);
      return;
    }
    const dx = s.aimX - x;
    const dy = s.aimY - y;
    if (dx !== 0 || dy !== 0) s.facing = turnTowards(s.facing, Math.atan2(dy, dx), TURN_PER_TICK);
    if (a.art === 'sprung' && tick >= s.attackTick + windupPoseTicks(a, this.difficulty) && !this.touching(s, kind, x, y)) {
      // The run-up: straight at the locked aim, arriving at the blow.
      const left = Math.max(1, s.attackEndTick - tick + 1);
      this.moveBody(sim, s, kind, row, x, y, dx / left, dy / left, false);
    } else {
      s.vx = 0;
      s.vy = 0;
    }
    if (tick < s.attackEndTick) return;
    const pos = this.motion.position.columns;
    this.strike(sim, e, s, kind, a, pos.x[row] as number, pos.y[row] as number, tick);
    s.cooldowns[s.attack] = tick + secondsToTicks(a.abklingzeit, 1);
    s.attackPhase = 'erholen';
    s.attackTick = tick;
    s.attackEndTick = tick + RECOVERY_TICKS;
  }

  /** Whether a leaping body touches the player (`leapContactPx` beyond both bodies). */
  private touching(s: CreatureState, kind: CreatureKind, x: number, y: number): boolean {
    const pl = this.pl;
    if (!pl.alive || pl.layer !== s.layer) return false;
    const dx = pl.x - x;
    const dy = pl.y - y;
    const reach = kind.def.radius + BALANCE.combat.body.playerRadiusPx + CR.attack.leapContactPx;
    return dx * dx + dy * dy <= reach * reach;
  }

  /** The blow lands (`creatureAttack`) and hits the player where the attack's geometry reaches it. */
  private strike(sim: Simulation, e: Entity, s: CreatureState, kind: CreatureKind, a: CreatureAttack, x: number, y: number, tick: number): void {
    const dx = s.aimX - x;
    const dy = s.aimY - y;
    const angle = dx === 0 && dy === 0 ? s.facing : Math.atan2(dy, dx);
    sim.events.push('creatureAttack', { entity: e, creature: s.creature, angriff: a.name, angle, layer: s.layer, x, y, tick });
    const pl = this.pl;
    if (!pl.alive || pl.layer !== s.layer || pl.level !== s.level) return;
    const px = pl.x - x;
    const py = pl.y - y;
    const pr = BALANCE.combat.body.playerRadiusPx;
    let hit = false;
    if (a.art === 'flaeche') {
      const ax = pl.x - s.aimX;
      const ay = pl.y - s.aimY;
      const r = (a.flaeche?.radius ?? 0) + pr;
      hit = ax * ax + ay * ay <= r * r;
    } else if (a.art === 'sprung') {
      hit = this.touching(s, kind, x, y);
    } else {
      const len = Math.sqrt(dx * dx + dy * dy);
      const fx = len === 0 ? Math.cos(s.facing) : dx / len;
      const fy = len === 0 ? Math.sin(s.facing) : dy / len;
      hit = inSwing(fx, fy, px, py, pr, a.reichweite, a.bogen >= FULL_CIRCLE_DEG ? -1 : Math.cos(degToRad(a.bogen / 2)));
    }
    if (!hit) return;
    const variant = s.variant >= 0 ? kind.def.varianten?.[s.variant] : undefined;
    const at = this.attack;
    at.team = kind.def.team;
    at.damage = creatureDamage(a.schaden * (variant?.schaden ?? 1), this.difficulty);
    at.type = a.schadensart;
    at.wucht = a.wucht;
    at.staggerSeconds = a.stagger;
    at.critChance = BALANCE.combat.damage.critChance;
    at.condition = a.zustand ?? null;
    at.armorBreak = 0;
    at.armorBreakSeconds = 0;
    at.backstab = 1;
    // An area on the ground cannot be blocked: one rolls out of it (§19.4 "Boden-Markierung").
    at.blockable = a.art !== 'flaeche';
    at.kind = 'nahkampf';
    at.projectile = false;
    at.fromX = x;
    at.fromY = y;
    const h = this.combat.resolve(sim, e, pl.entity, at);
    if (h !== null && h.hitstopTicks > 0 && s.hitstopFromTick + s.hitstopTicks < tick + h.hitstopTicks) {
      s.hitstopFromTick = tick;
      s.hitstopTicks = h.hitstopTicks;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Movement (M6-17)
  // -------------------------------------------------------------------------------------------

  private moveStep(sim: Simulation, e: Entity, s: CreatureState, kind: CreatureKind, index: number, row: number, x: number, y: number, tempo: number, tick: number): void {
    const variant = s.variant >= 0 ? kind.def.varianten?.[s.variant] : undefined;
    const chasing = RUNNING.has(s.state);
    const pace = (chasing ? kind.runPx : kind.walkPx) * (variant?.tempo ?? 1) * tempo;
    let dvx = 0;
    let dvy = 0;
    let heading = false;
    if (!Number.isNaN(s.goalX)) {
      this.pollPath(e, s, tick);
      let wx = s.goalX;
      let wy = s.goalY;
      const steps = s.path.length >> 1;
      while (s.pathIndex < steps) {
        const px = ((s.path[s.pathIndex * 2] as number) + 1 / 2) * TILE_PX;
        const py = ((s.path[s.pathIndex * 2 + 1] as number) + 1 / 2) * TILE_PX;
        const ddx = px - x;
        const ddy = py - y;
        if (ddx * ddx + ddy * ddy > ARRIVE_PX * ARRIVE_PX) {
          wx = px;
          wy = py;
          break;
        }
        s.pathIndex++;
      }
      // The path is walked: the last stretch goes to the goal itself.
      if (steps > 0 && s.pathIndex >= steps) {
        s.path.length = 0;
        s.pathIndex = 0;
      }
      const gdx = s.goalX - x;
      const gdy = s.goalY - y;
      const goalDist = Math.sqrt(gdx * gdx + gdy * gdy);
      // A chasing body walks right up to its point (its reach depends on it); the others arrive on the tile.
      if (goalDist <= (chasing ? CHASE_ARRIVE_PX : ARRIVE_PX)) {
        // Arrived: a roaming or homeward creature stops; a chasing one waits for its next decision.
        if (!chasing) this.clearGoal(s);
      } else {
        heading = true;
        const dx = wx - x;
        const dy = wy - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0) {
          const v = Math.min(pace, d);
          dvx = (dx / d) * v;
          dvy = (dy / d) * v;
        }
        this.requestPath(e, s, kind, x, y, goalDist, tick);
      }
    }
    // Separation (§19.4 "lokales Ausweichen"): bodies closer than `separationRadii` × both radii push apart – but not from
    // the body a creature hunts (its approach keeps the distance of its reach).
    const r = kind.def.radius;
    const sep = MV.separationRadii;
    const n = Math.min(NEAR_BODIES, this.bodies.queryCircle(s.layer, x, y, sep * (r + MAX_BODY_PX), this.near, index));
    const huntsPlayer = s.target !== NULL_ENTITY && s.target === this.pl.entity;
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < n; k++) {
      const j = this.near[k] as number;
      if (huntsPlayer && this.bodies.idOf(j) === PLAYER_BODY_ID) continue;
      this.bodies.circleOf(j, this.circle);
      const range = sep * (r + this.circle.r);
      const dx = x - this.circle.x;
      const dy = y - this.circle.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= range) continue;
      const w = (range - d) / range;
      if (d > 0) {
        sx += (dx / d) * w;
        sy += (dy / d) * w;
      } else sx += j < index ? w : -w;
    }
    const push = MV.separationWeight * kind.walkPx;
    dvx += sx * push;
    dvy += sy * push;
    const top = Math.max(pace, push);
    const len = Math.sqrt(dvx * dvx + dvy * dvy);
    if (len > top) {
      dvx = (dvx / len) * top;
      dvy = (dvy / len) * top;
    }
    if (len < STILL_PX) {
      s.vx = 0;
      s.vy = 0;
      s.stuckTicks = 0;
      this.faceTarget(s, x, y);
      return;
    }
    const flying = s.flyUntilTick >= tick;
    const moved = this.moveBody(sim, s, kind, row, x, y, dvx, dvy, flying);
    if (!heading) this.faceTarget(s, x, y);
    const pos = this.motion.position.columns;
    const mx = (pos.x[row] as number) - x;
    const my = (pos.y[row] as number) - y;
    if (heading && pace > 0 && (!moved || mx * mx + my * my < (MV.stuckShare * pace) ** 2)) {
      if (this.moveOut.hit) this.batterDoor(sim, e, s, kind, x, y, dvx, dvy, tick);
      if (++s.stuckTicks >= STUCK_TICKS) {
        // Stuck: give the goal up and decide again.
        this.clearGoal(s);
        s.stuckTicks = 0;
        s.stateUntilTick = tick;
      }
    } else s.stuckTicks = 0;
  }

  /** A hunting, attacking or circling body that stands turns to face its target. */
  private faceTarget(s: CreatureState, x: number, y: number): void {
    if (s.target === NULL_ENTITY || (s.state !== 'jagen' && s.state !== 'angreifen' && s.state !== 'umkreisen')) return;
    const dx = s.targetX - x;
    const dy = s.targetY - y;
    if (dx !== 0 || dy !== 0) s.facing = turnTowards(s.facing, Math.atan2(dy, dx), TURN_PER_TICK);
  }


  /**
   * Moves a body by (dx, dy) with its rules; false (and it stays) when the end lies outside the zone margin, a swimmer
   * would leave the water, or a light avoider would step from the dark into light above its threshold.
   */
  private moveBody(sim: Simulation, s: CreatureState, kind: CreatureKind, row: number, x: number, y: number, dx: number, dy: number, flying: boolean): boolean {
    const out = this.moveOut;
    const grid = this.collision.grid;
    moveCircle(grid, s.layer, x, y, kind.def.radius, dx, dy, flying ? kind.flyRules : kind.rules, out);
    s.vx = 0;
    s.vy = 0;
    if (!insideZone(this.zone, s.layer, out.x, out.y)) return false;
    const tx0 = Math.floor(x / TILE_PX);
    const ty0 = Math.floor(y / TILE_PX);
    const tx1 = Math.floor(out.x / TILE_PX);
    const ty1 = Math.floor(out.y / TILE_PX);
    if (tx0 !== tx1 || ty0 !== ty1) {
      if (kind.mover === 'schwimmer' && !flying && !this.water(s.layer, tx1, ty1)) return false;
      const avoid = kind.profile.meidetLicht;
      if (avoid !== null && this.light !== null && this.light.tileLevel(sim, s.layer, tx1, ty1) > avoid && this.light.tileLevel(sim, s.layer, tx0, ty0) <= avoid) return false;
    }
    const pos = this.motion.position.columns;
    pos.x[row] = out.x;
    pos.y[row] = out.y;
    const fx = (pos.x[row] as number) - x;
    const fy = (pos.y[row] as number) - y;
    s.vx = fx;
    s.vy = fy;
    if (!flying) s.level = out.level;
    // Only a real step turns the body (a push of the separation does not make it look back).
    if (fx * fx + fy * fy > (TURN_MIN_SHARE * kind.walkPx) ** 2 && s.attackPhase === 'keine') s.facing = turnTowards(s.facing, Math.atan2(fy, fx), TURN_PER_TICK);
    return true;
  }

  /** A door breaker pushing against a closed door strikes it (`doorBattered`, `BuildingSystem.damage`). */
  private batterDoor(sim: Simulation, e: Entity, s: CreatureState, kind: CreatureKind, x: number, y: number, dx: number, dy: number, tick: number): void {
    if (!kind.profile.brichtTueren || this.doors === null || this.building === null) return;
    if (s.doorTick >= 0 && tick - s.doorTick < DOOR_BLOW_TICKS) return;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const ahead = kind.def.radius + TILE_PX / 2;
    const tx = Math.floor((x + (dx / len) * ahead) / TILE_PX);
    const ty = Math.floor((y + (dy / len) * ahead) / TILE_PX);
    if (!this.doors.closedDoorAt(s.layer, tx, ty)) return;
    s.doorTick = tick;
    this.building.damage(sim, s.layer, 'struktur', tx, ty, CR.doors.damagePerBlow);
    sim.events.push('doorBattered', { entity: e, layer: s.layer, tx, ty, tick });
  }

  /** Asks for a path when the goal is far or the straight way is blocked (at most every `repathSeconds`, again when the goal moved). */
  private requestPath(e: Entity, s: CreatureState, kind: CreatureKind, x: number, y: number, goalDist: number, tick: number): void {
    if (s.pathTicket !== 0) return;
    const gtx = Math.floor(s.goalX / TILE_PX);
    const gty = Math.floor(s.goalY / TILE_PX);
    const far = goalDist > DIRECT_PX || s.stuckTicks > 0;
    if (!far) return;
    const due = s.pathTick < 0 || tick - s.pathTick >= REPATH_TICKS;
    const moved = Math.abs(gtx - s.pathGoalTx) + Math.abs(gty - s.pathGoalTy) > REPATH_MOVED_TILES;
    if (!due || (s.path.length > 0 && !moved)) return;
    const req = this.request;
    req.owner = e;
    req.layer = s.layer;
    req.fromTx = Math.floor(x / TILE_PX);
    req.fromTy = Math.floor(y / TILE_PX);
    req.toTx = gtx;
    req.toTy = gty;
    req.mover = kind.mover;
    req.opensDoors = kind.profile.brichtTueren;
    req.avoidLightAbove = this.light === null ? null : kind.profile.meidetLicht;
    req.maxNodes = MV.pathMaxNodes;
    const ticket = this.paths.request(req, tick);
    this.tickets.set(e, ticket);
    s.pathTicket = ticket.id;
    s.pathTick = tick;
    s.pathGoalTx = gtx;
    s.pathGoalTy = gty;
  }

  /** Takes the answer of a pending path request once it is due. */
  private pollPath(e: Entity, s: CreatureState, tick: number): void {
    if (s.pathTicket === 0) return;
    let ticket = this.tickets.get(e);
    if (ticket === undefined || ticket.id !== s.pathTicket) {
      ticket = this.paths.ticket(s.pathTicket);
      if (ticket === undefined) {
        s.pathTicket = 0;
        return;
      }
      this.tickets.set(e, ticket);
    }
    const result = this.paths.poll(ticket, tick);
    if (result === null) return;
    this.tickets.delete(e);
    s.pathTicket = 0;
    s.path.length = 0;
    s.pathIndex = 0;
    if (result.status === 'none') return;
    const tiles = result.tiles;
    for (let k = 0; k < result.steps * 2; k++) s.path.push(tiles[k] as number);
  }

  private cancelPath(e: Entity, s: CreatureState | undefined): void {
    const ticket = this.tickets.get(e) ?? (s !== undefined && s.pathTicket !== 0 ? this.paths.ticket(s.pathTicket) : undefined);
    if (ticket !== undefined) this.paths.cancel(ticket);
    this.tickets.delete(e);
    if (s !== undefined) s.pathTicket = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Ground
  // -------------------------------------------------------------------------------------------

  /** Whether tile (tx, ty) holds unfrozen water. */
  private water(layer: Layer, tx: number, ty: number): boolean {
    const chunk = this.collision.chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (chunk === undefined) return false;
    const w = chunk.water[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number;
    return (w & WATER_DEPTH_MASK) !== 0 && (w & WATER_FROZEN) === 0;
  }

  /** Whether a body of `kind` may stand on tile (tx, ty): nothing of its block mask there (swimmers: in water). */
  private standable(kind: CreatureKind, layer: Layer, tx: number, ty: number): boolean {
    const grid = this.collision.grid;
    grid.beginQuery();
    if ((grid.info(layer, tx, ty) & kind.rules.blockMask) !== 0) return false;
    return kind.mover !== 'schwimmer' || this.water(layer, tx, ty);
  }

  /** Whether a creature may appear on tile (tx, ty): open ground around it (swimmers: water around it). */
  private placeable(kind: CreatureKind, layer: Layer, tx: number, ty: number): boolean {
    const grid = this.collision.grid;
    grid.beginQuery();
    if (kind.mover === 'schwimmer') {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!this.standable(kind, layer, tx + dx, ty + dy)) return false;
      return true;
    }
    return grid.openAt(layer, tx, ty);
  }

  // -------------------------------------------------------------------------------------------
  // Conditions, damage, death
  // -------------------------------------------------------------------------------------------

  /** Runs the creature's conditions: expired ones end, damage per second is dealt; returns the pace factor. */
  private conditions(sim: Simulation, e: Entity, s: CreatureState, x: number, y: number, tick: number): number {
    if (s.armorBreakUntilTick >= 0 && tick > s.armorBreakUntilTick) {
      s.armorBreak = 0;
      s.armorBreakUntilTick = -1;
    }
    const list = s.conditions;
    if (list.length === 0) return 1;
    let tempo = 1;
    let dps = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i] as { id: string; untilTick: number };
      if (tick > c.untilTick) {
        list.splice(i, 1);
        continue;
      }
      const fx = this.effect(c.id);
      tempo *= fx.tempo;
      dps += fx.dps;
    }
    if (dps > 0) this.hurt(sim, e, s, x, y, dps / TICK_HZ, NULL_ENTITY);
    return tempo;
  }

  private effect(id: string): ConditionEffect {
    let fx = this.conditionEffects.get(id);
    if (fx === undefined) {
      const w = CONTENT.collection('conditions').find(id)?.wirkung;
      fx = { dps: w?.schadenProSekunde ?? 0, tempo: w?.tempo ?? 1 };
      this.conditionEffects.set(id, fx);
    }
    return fx;
  }

  /** Damage without a hit (light, conditions): health falls; at 0 the creature dies. */
  private hurt(sim: Simulation, e: Entity, s: CreatureState, x: number, y: number, amount: number, by: Entity): void {
    if (s.health <= 0 || !(amount > 0)) return;
    s.health = Math.max(0, s.health - amount);
    if (s.health <= 0) this.die(sim, e, s, x, y, by);
  }

  /** The creature dies: loot, carcass, events, the bestiary's count, the Nachtmahr banished; removed at the next flush. */
  private die(sim: Simulation, e: Entity, s: CreatureState, x: number, y: number, by: Entity): void {
    s.health = 0;
    const kind = this.catalog.get(s.creature);
    const tick = sim.eventTick;
    const tier = effectiveTier(kind.def.stufe, this.environment.biome(sim, s.layer, Math.floor(x / TILE_PX), Math.floor(y / TILE_PX)));
    let dropped = false;
    if (kind.loot !== null && kind.loot.beute.length > 0) {
      const drops = drawLoot(kind.loot, tier, sim.rng.stream(CREATURES_RNG_STREAM), this.lootList());
      const items = this.inventory.bags.catalog;
      for (const d of drops) {
        this.drops.spawn(sim, newStack(items.get(d.item), d.count), s.layer, x, y);
        dropped = true;
      }
    }
    const carcass = kind.carcass ? this.leaveCarcass(sim, s.creature, s.layer, x, y, s.facing, tier) : NULL_ENTITY;
    sim.events.push('creatureDied', { entity: e, creature: s.creature, by, carcass, loot: dropped, facing: s.facing, variant: s.variant, layer: s.layer, x, y, tick });
    if (e === this.nightmare) {
      this.nightmare = NULL_ENTITY;
      this.life?.fear.banishNightmare(sim, 'besiegt');
    }
    for (const l of this.deathListeners) l(sim, s.creature);
    this.doom(e);
  }

  /** A carcass of `creature` at (x, y) (a death, a trap's catch taken back); rots after `carcassGameHours`. */
  leaveCarcass(sim: Simulation, creature: string, layer: Layer, x: number, y: number, facing: number, tier: number): Entity {
    const c = sim.ecs.create();
    this.carcasses.add(c, { creature, layer, x, y, facing, tier, untilTick: sim.eventTick + Math.round(CR.hunting.carcassGameHours * sim.clock.ticksPerGameHour) });
    return c;
  }

  private lootList(): LootDrop[] {
    this.loot.length = 0;
    return this.loot;
  }

  /** Fades a shadow brood (sunrise, the Nachtmahr's pursuit over): no loot, gone after `fadeSeconds`. */
  private fade(sim: Simulation, e: Entity, s: CreatureState, x: number, y: number, reason: FadeReason): void {
    if (s.fadeTick >= 0) return;
    s.fadeTick = sim.eventTick;
    s.fadeReason = reason;
    this.cancelAttack(s);
    this.clearGoal(s);
    s.vx = 0;
    s.vy = 0;
    sim.events.push('creatureFaded', { entity: e, creature: s.creature, reason, layer: s.layer, x, y, tick: sim.eventTick });
    if (e === this.nightmare) this.nightmare = NULL_ENTITY;
  }

  /** Marks `e` for removal at the next flush. */
  private doom(e: Entity): void {
    if (!this.dying.includes(e)) this.dying.push(e);
  }

  /** Removes the creatures marked for removal (their paths cancelled, their entities destroyed at the end of the tick). */
  private flushDying(sim: Simulation): void {
    const list = this.dying;
    for (let i = 0; i < list.length; i++) this.remove(sim, list[i] as Entity);
    list.length = 0;
  }

  private remove(sim: Simulation, e: Entity): void {
    const s = this.store.get(e);
    this.cancelPath(e, s);
    this.store.remove(e);
    if (this.nightmare === e) this.nightmare = NULL_ENTITY;
    if (sim.ecs.alive(e)) sim.ecs.queueDestroy(e);
  }

  // -------------------------------------------------------------------------------------------
  // Combatants (the provider `kreaturen`)
  // -------------------------------------------------------------------------------------------

  private queryCircle(layer: number, x: number, y: number, r: number, out: Entity[]): void {
    const pos = this.motion.position;
    for (let i = 0; i < this.store.size; i++) {
      const s = this.store.valueAt(i);
      if (s.layer !== layer) continue;
      const e = this.store.entityAt(i);
      const row = pos.indexOf(e);
      if (row < 0) continue;
      const reach = r + this.catalog.get(s.creature).def.radius;
      const dx = (pos.columns.x[row] as number) - x;
      const dy = (pos.columns.y[row] as number) - y;
      if (dx * dx + dy * dy <= reach * reach) out.push(e);
    }
  }

  private view(e: Entity, out: CombatantView): boolean {
    const s = this.store.get(e);
    if (s === undefined) return false;
    const row = this.motion.position.indexOf(e);
    if (row < 0) return false;
    const def = this.catalog.get(s.creature).def;
    out.entity = e;
    out.team = def.team;
    out.layer = s.layer;
    out.level = s.level;
    out.x = this.motion.position.columns.x[row] as number;
    out.y = this.motion.position.columns.y[row] as number;
    out.radius = def.radius;
    out.facing = s.facing;
    out.health = s.health;
    out.maxHealth = s.maxHealth;
    out.armor = Math.max(0, def.ruestung - s.armorBreak);
    for (const t of DAMAGE_TYPES) out.resist[t] = def.resistenzen[t] ?? 0;
    out.invulnerable = s.fadeTick >= 0;
    out.blockSinceTick = -1;
    out.blockPower = 0;
    out.material = def.material;
    return true;
  }

  private aware(sim: Simulation, e: Entity, attacker: Entity): boolean {
    const s = this.store.get(e);
    if (s === undefined) return true;
    const tick = sim.eventTick;
    if (tick <= s.alarmedUntilTick) return true;
    return s.target === attacker && tick - s.targetTick <= secondsToTicks(this.catalog.get(s.creature).profile.gedaechtnis);
  }

  private applyHit(sim: Simulation, e: Entity, h: HitResult): void {
    const s = this.store.get(e);
    if (s === undefined || s.health <= 0) return;
    const tick = sim.eventTick;
    if (h.hitstopTicks > 0) {
      s.hitstopFromTick = tick;
      s.hitstopTicks = h.hitstopTicks;
    }
    if (h.parried) {
      // Its own blow was parried: it staggers (the combat system marks it for the riposte).
      if (h.staggerTicks > 0) s.staggerUntilTick = Math.max(s.staggerUntilTick, tick + h.staggerTicks);
      this.cancelAttack(s);
      return;
    }
    const row = this.motion.position.indexOf(e);
    const x = row < 0 ? 0 : (this.motion.position.columns.x[row] as number);
    const y = row < 0 ? 0 : (this.motion.position.columns.y[row] as number);
    s.hurtTick = tick;
    if (h.attacker !== NULL_ENTITY && h.attacker === sim.player && this.player.position(sim, this.spot)) {
      s.target = h.attacker;
      s.targetX = this.spot.x;
      s.targetY = this.spot.y;
      s.targetTick = tick;
      s.alarmedUntilTick = tick + ALARMED_TICKS;
      this.alertPack(e, s, x, y, tick);
    }
    if (h.knockback > 0) {
      s.knockX = (h.dirX * h.knockback) / CR.knockbackTicks;
      s.knockY = (h.dirY * h.knockback) / CR.knockbackTicks;
      s.knockTicks = CR.knockbackTicks;
    }
    if (h.staggerTicks > 0) {
      s.staggerUntilTick = Math.max(s.staggerUntilTick, tick + h.staggerTicks);
      if (s.attackPhase === 'ausholen') this.cancelAttack(s);
    }
    if (h.condition !== null && h.conditionSeconds > 0) {
      const until = tick + secondsToTicks(h.conditionSeconds, 1);
      const have = s.conditions.find((c) => c.id === h.condition);
      if (have === undefined) s.conditions.push({ id: h.condition, untilTick: until });
      else have.untilTick = Math.max(have.untilTick, until);
    }
    if (h.armorBreak > 0) {
      s.armorBreak = h.armorBreak;
      s.armorBreakUntilTick = tick + secondsToTicks(h.armorBreakSeconds, 1);
    }
    if (h.amount > 0) {
      s.health = Math.max(0, s.health - h.amount);
      sim.events.push('creatureHurt', { entity: e, creature: s.creature, amount: h.amount, health: s.health, layer: s.layer, x, y, tick });
    }
    if (s.health <= 0) this.die(sim, e, s, x, y, h.attacker);
  }

  // -------------------------------------------------------------------------------------------
  // Traps
  // -------------------------------------------------------------------------------------------

  /** A catchable creature entering an armed trap's tile is caught with the trap's chance (once per entry). */
  private checkTrap(sim: Simulation, e: Entity, s: CreatureState, kind: CreatureKind, row: number, tick: number): void {
    if (this.traps === null || !kind.def.fangbar || s.health <= 0) return;
    const tx = Math.floor((this.motion.position.columns.x[row] as number) / TILE_PX);
    const ty = Math.floor((this.motion.position.columns.y[row] as number) / TILE_PX);
    const key = ty * TILE_KEY_ROW + tx;
    if (key === s.trapTile) return;
    s.trapTile = key;
    const trap = this.traps.armedAt(s.layer, tx, ty);
    if (trap === null) return;
    const def = this.catalog.trap(trap.item);
    if (def === undefined || kind.def.groesse > def.groesseMax) return;
    if (sim.rng.stream(CREATURES_RNG_STREAM).next() >= def.chance) return;
    this.traps.spring(sim, trap.id, s.creature, tick);
    this.doom(e);
    s.health = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Populations (M6-27)
  // -------------------------------------------------------------------------------------------

  private playerSpot(): PlayerSpot | null {
    return this.pl.alive ? this.pl : null;
  }

  /**
   * A chunk became active: first population, or its stock comes back to life (healed for the time it lay frozen). A world
   * without a player (a zone following a debug mover) stays empty until one appears (`seedWaiting`).
   */
  private activated(chunk: ChunkData, tick: number): void {
    const stock = this.population.stockOf(chunk.layer, chunk.cx, chunk.cy, tick);
    this.readPlayer(this.sim);
    if (!stock.seeded) {
      if (this.pl.alive) this.seed(chunk, tick);
      return;
    }
    if (stock.members.length === 0) return;
    const tph = this.sim.clock.ticksPerGameHour;
    for (const m of stock.members) {
      const kind = this.catalog.find(m.creature);
      if (kind === undefined) continue;
      const max = maxHealthOf(kind, m.variant);
      const health = healedHealth(m.health, max, tick - m.storedTick, tph);
      const e = this.spawn(kind, m.variant, chunk.layer, m.x, m.y, chunk.cx, chunk.cy, m.pack, max, m.serial, tick);
      const s = this.store.get(e) as CreatureState;
      s.health = health;
      s.homeX = m.homeX;
      s.homeY = m.homeY;
    }
    stock.members.length = 0;
  }

  /**
   * A chunk froze: its animals go into its stock, shadow brood standing in it leaves (§12.4: it is never stored), and
   * its armed traps get their first frozen attempt.
   */
  private deactivated(chunk: ChunkData, tick: number): void {
    const stock = this.population.stockOf(chunk.layer, chunk.cx, chunk.cy, tick);
    // A chunk that was active holds its population (whoever came into it meanwhile).
    stock.seeded = true;
    const doomed = this.doomed;
    doomed.length = 0;
    const pos = this.motion.position;
    for (let i = 0; i < this.store.size; i++) {
      const s = this.store.valueAt(i);
      const e = this.store.entityAt(i);
      if (s.layer !== chunk.layer || s.health <= 0) continue;
      const kind = this.catalog.get(s.creature);
      const row = pos.indexOf(e);
      const x = row < 0 ? s.homeX : (pos.columns.x[row] as number);
      const y = row < 0 ? s.homeY : (pos.columns.y[row] as number);
      if (kind.shadow || s.fadeTick >= 0) {
        if (Math.floor(x / TILE_PX) >> CHUNK_SHIFT === chunk.cx && Math.floor(y / TILE_PX) >> CHUNK_SHIFT === chunk.cy) {
          doomed.push(e);
          if (e === this.nightmare) this.nightmareRetryTick = tick;
        }
        continue;
      }
      if (s.homeCx !== chunk.cx || s.homeCy !== chunk.cy) continue;
      const stored: StoredCreature = { creature: s.creature, variant: s.variant, serial: s.serial, health: s.health, x, y, homeX: s.homeX, homeY: s.homeY, pack: s.pack, storedTick: tick };
      stock.members.push(stored);
      doomed.push(e);
    }
    for (const e of doomed) this.remove(this.sim, e);
    if (this.traps !== null) {
      const list = this.traps.armedIn(chunk.layer, chunk.cx, chunk.cy, []);
      for (const t of list) this.population.scheduleTrap(chunk.layer, chunk.cx, chunk.cy, t, tick);
    }
  }

  /** The first population of `chunk` now. */
  private seed(chunk: ChunkData, tick: number): void {
    const stock = this.population.stockOf(chunk.layer, chunk.cx, chunk.cy, tick);
    stock.seeded = true;
    stock.regrowTick = tick + this.population.regrowTicks;
    this.spawnPlans(this.population.planSeed(chunk, tick, this.playerSpot()), chunk.layer, chunk.cx, chunk.cy, tick);
  }

  /**
   * Active chunks grow back on the world tick (the frozen ones in `catchUp`); active chunks that came up without a
   * player are populated once there is one.
   */
  private regrowActive(tick: number): void {
    const chunks = this.zone.chunks();
    if (chunks.length === 0) return;
    const interval = this.population.regrowTicks;
    for (const chunk of chunks) {
      const stock = this.population.find(chunk.layer, chunk.cx, chunk.cy);
      if (stock === undefined || !stock.seeded) {
        if (this.pl.alive) this.seed(chunk, tick);
        continue;
      }
      while (stock.regrowTick <= tick) {
        const plans = this.population.planRegrow(chunk, stock.regrowTick, this.homedIn(chunk.layer, chunk.cx, chunk.cy), this.playerSpot());
        this.spawnPlans(plans, chunk.layer, chunk.cx, chunk.cy, tick);
        stock.regrowTick += interval;
      }
    }
  }

  /** Animals living in chunk (cx, cy) of `layer` now. */
  private homedIn(layer: Layer, cx: number, cy: number): number {
    let n = 0;
    for (let i = 0; i < this.store.size; i++) {
      const s = this.store.valueAt(i);
      if (s.layer === layer && s.homeCx === cx && s.homeCy === cy && s.health > 0 && !this.catalog.get(s.creature).shadow) n++;
    }
    return n;
  }

  /** Creates the planned creatures at home in chunk (cx, cy); members of one group of a pack animal share a pack. */
  private spawnPlans(plans: readonly SpawnPlan[], layer: Layer, cx: number, cy: number, tick: number): void {
    let group = -1;
    let pack = 0;
    for (let i = 0; i < plans.length; i++) {
      const p = plans[i] as SpawnPlan;
      if (p.group !== group) {
        group = p.group;
        const size = plans.filter((q) => q.group === group).length;
        pack = p.kind.profile.rudel !== undefined && size > 1 ? this.population.pack++ : 0;
      }
      this.spawn(p.kind, p.variant, layer, p.x, p.y, cx, cy, pack, maxHealthOf(p.kind, p.variant), this.population.serial++, tick);
    }
  }

  /** Creates a creature entity (`creatureSpawned`). */
  private spawn(kind: CreatureKind, variant: number, layer: Layer, x: number, y: number, homeCx: number, homeCy: number, pack: number, maxHealth: number, serial: number, tick: number): Entity {
    const sim = this.sim;
    const e = sim.ecs.create();
    const row = this.motion.position.add(e);
    this.motion.position.columns.x[row] = x;
    this.motion.position.columns.y[row] = y;
    // The position is stored as f32: the state starts from the stored value.
    const fx = this.motion.position.columns.x[row] as number;
    const fy = this.motion.position.columns.y[row] as number;
    const s = createCreatureState(kind.id, layer, fx, fy, maxHealth, kind.attacks.length, tick, serial, homeCx, homeCy);
    s.variant = variant;
    s.pack = pack;
    const grid = this.collision.grid;
    grid.beginQuery();
    s.level = infoLevel(grid.info(layer, Math.floor(fx / TILE_PX), Math.floor(fy / TILE_PX)));
    this.store.add(e, s);
    sim.events.push('creatureSpawned', { entity: e, creature: kind.id, layer, x: fx, y: fy, tick });
    return e;
  }

  // -------------------------------------------------------------------------------------------
  // Shadow brood and the Nachtmahr (M6-28, M6-29)
  // -------------------------------------------------------------------------------------------

  /** The night spawner (§12.4): every `intervalSeconds` a group of shadow brood on a dark tile 16–40 tiles from the player. */
  private nightSpawner(sim: Simulation, tick: number): void {
    if (tick < this.spawnerTick) return;
    this.spawnerTick = tick + SPAWNER_TICKS;
    const pl = this.pl;
    if (!pl.alive || this.light === null) return;
    this.environment.timeAt(sim, tick, this.time);
    if (pl.layer === 0 && this.time.phase !== 'nacht') return;
    const ptx = Math.floor(pl.x / TILE_PX);
    const pty = Math.floor(pl.y / TILE_PX);
    const biome = this.environment.biome(sim, pl.layer, ptx, pty);
    const table = biome === null ? undefined : this.catalog.spawnTable(biome);
    if (table === undefined || biome === null) return;
    const entries = table.nacht.filter((en) => this.catalog.get(en.kreatur).shadow && (en.jahreszeiten === undefined || en.jahreszeiten.includes(this.time.season)));
    if (entries.length === 0) return;
    const tier = BALANCE.spawn.biomeTier[biome] ?? 0;
    const max = shadowBroodMax(tier, this.environment.finstermond(sim), this.difficulty);
    let alive = 0;
    for (let i = 0; i < this.store.size; i++) {
      const s = this.store.valueAt(i);
      if (s.health > 0 && s.fadeTick < 0 && this.store.entityAt(i) !== this.nightmare && this.catalog.get(s.creature).shadow) alive++;
    }
    if (alive >= max) return;
    const rng = sim.rng.stream(CREATURES_RNG_STREAM);
    const entry = entries[rng.weightedIndex(entries.map((en) => en.gewicht))] as (typeof entries)[number];
    const kind = this.catalog.get(entry.kreatur);
    const lo = SB.minTiles * TILE_PX;
    const hi = SB.maxTiles * TILE_PX;
    for (let t = 0; t < SB.placeTries; t++) {
      // A point in the ring by rejection from the square (no trigonometry).
      const dx = rng.float(-hi, hi);
      const dy = rng.float(-hi, hi);
      const d2 = dx * dx + dy * dy;
      if (d2 < lo * lo || d2 > hi * hi) continue;
      const tx = Math.floor((pl.x + dx) / TILE_PX);
      const ty = Math.floor((pl.y + dy) / TILE_PX);
      const x = (tx + 1 / 2) * TILE_PX;
      const y = (ty + 1 / 2) * TILE_PX;
      if (!insideZone(this.zone, pl.layer, x, y) || !this.placeable(kind, pl.layer, tx, ty)) continue;
      if (this.light.tileLevel(sim, pl.layer, tx, ty) >= SB.maxLight) continue;
      if (this.hearth !== null && this.hearth.spawnBlocked(sim, pl.layer, x, y)) continue;
      const size = Math.min(max - alive, entry.gruppe[0] === entry.gruppe[1] ? entry.gruppe[0] : rng.int(entry.gruppe[0], entry.gruppe[1] + 1));
      const variant = variantFor(kind, this.environment.biome(sim, pl.layer, tx, ty));
      const pack = kind.profile.rudel !== undefined && size > 1 ? this.population.pack++ : 0;
      for (let k = 0; k < size; k++) this.spawn(kind, variant, pl.layer, x, y, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, pack, maxHealthOf(kind, variant), this.population.serial++, tick);
      return;
    }
  }

  /** `FearSystem.onNightmare`: the Nachtmahr appears at the darkest of eight directions 14 tiles from the player. */
  private summonNightmare(sim: Simulation): void {
    if (this.nightmare !== NULL_ENTITY) return;
    this.readPlayer(sim);
    const pl = this.pl;
    const tick = sim.eventTick;
    this.nightmareRetryTick = tick + NIGHTMARE_RETRY_TICKS;
    const kind = this.catalog.find(CR.nightmare.creature);
    if (!pl.alive || kind === undefined) return;
    // By day on the surface it would fade at once; the pursuit ends in daylight anyway (glaring light, §12.3).
    this.environment.timeAt(sim, tick, this.time);
    if (pl.layer === 0 && this.time.phase === 'tag') return;
    let best = Number.POSITIVE_INFINITY;
    let bx = Number.NaN;
    let by = Number.NaN;
    const dirs = Math.min(COMPASS.length, CR.nightmare.spawnDirections);
    for (let k = 0; k < dirs; k++) {
      const [ux, uy] = COMPASS[k] as readonly [number, number];
      for (let k = 0; k < NIGHTMARE_TRIES; k++) {
        const d = (CR.nightmare.spawnDistanceTiles - k * NIGHTMARE_STEP_TILES) * TILE_PX;
        const tx = Math.floor((pl.x + ux * d) / TILE_PX);
        const ty = Math.floor((pl.y + uy * d) / TILE_PX);
        const x = (tx + 1 / 2) * TILE_PX;
        const y = (ty + 1 / 2) * TILE_PX;
        if (!insideZone(this.zone, pl.layer, x, y) || !this.placeable(kind, pl.layer, tx, ty)) continue;
        const lv = this.light === null ? 0 : this.light.tileLevel(sim, pl.layer, tx, ty);
        if (lv < best) {
          best = lv;
          bx = x;
          by = y;
        }
        break;
      }
    }
    if (Number.isNaN(bx)) return;
    const tx = Math.floor(bx / TILE_PX);
    const ty = Math.floor(by / TILE_PX);
    const e = this.spawn(kind, -1, pl.layer, bx, by, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, 0, maxHealthOf(kind, -1), this.population.serial++, tick);
    const s = this.store.get(e) as CreatureState;
    // It knows its prey from the start.
    s.target = pl.entity;
    s.targetX = pl.x;
    s.targetY = pl.y;
    s.targetTick = tick;
    this.nightmare = e;
  }

  /** The Nachtmahr fades when the pursuit ended without its defeat (glaring light, the player's death). */
  private upkeepNightmare(sim: Simulation, tick: number): void {
    const e = this.nightmare;
    if (e === NULL_ENTITY) return;
    const s = this.store.get(e);
    if (s === undefined) {
      this.nightmare = NULL_ENTITY;
      return;
    }
    const pursued = this.life === null || this.life.fear.pursued;
    if (pursued && this.pl.alive) {
      // The pursuit renews its knowledge of the prey: it always knows where the player is.
      s.target = this.pl.entity;
      s.targetX = this.pl.x;
      s.targetY = this.pl.y;
      s.targetTick = tick;
      return;
    }
    if (this.positionOf(e, this.spot)) this.fade(sim, e, s, this.spot.x, this.spot.y, this.pl.alive ? 'licht' : 'tod');
  }

  /** The player's blow dissolves the hallucinations it reaches (§12.3 "verschwinden bei Treffer"). */
  private strikeHallucinations(layer: Layer, x: number, y: number, angle: number, reach: number, arcDeg: number): void {
    const fear = this.life?.fear;
    if (fear === undefined) return;
    const list = fear.state.hallucinations;
    if (list.length === 0) return;
    const fx = Math.cos(angle);
    const fy = Math.sin(angle);
    const cosHalf = arcDeg >= FULL_CIRCLE_DEG ? -1 : Math.cos(degToRad(arcDeg / 2));
    const struck = this.struck;
    struck.length = 0;
    for (const h of list) if (h.layer === layer && inSwing(fx, fy, h.x - x, h.y - y, HALLUCINATION_RADIUS_PX, reach, cosHalf)) struck.push(h.id);
    for (const id of struck) fear.strikeHallucination(this.sim, id);
  }

  // -------------------------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------------------------

  private reject(sim: Simulation, type: GameCommandType, reason: CreatureRejectReason, tick: number): void {
    sim.events.push('commandRejected', { type, reason, tick });
  }

  /** `creature.spawn`: `count` creatures around the place (or a few tiles in front of the player) on free tiles; pack animals as one pack. */
  private handleSpawn(sim: Simulation, cmd: CommandOfType<'creature.spawn'>, tick: number): void {
    const kind = this.catalog.find(cmd.creature);
    if (kind === undefined) {
      this.reject(sim, cmd.type, 'unknownCreature', tick);
      return;
    }
    this.readPlayer(sim);
    const pl = this.pl;
    let layer: Layer;
    let x: number;
    let y: number;
    if (cmd.x !== undefined && cmd.y !== undefined) {
      layer = (cmd.layer ?? (pl.alive ? pl.layer : 0)) as Layer;
      x = cmd.x;
      y = cmd.y;
    } else {
      if (sim.player === NULL_ENTITY) {
        this.reject(sim, cmd.type, 'noPlayer', tick);
        return;
      }
      const body = this.player.body(sim);
      const facing = body?.facing ?? 'down';
      const ahead = SPAWN_AHEAD_TILES * TILE_PX;
      layer = pl.layer;
      x = pl.x + (facing === 'right' ? ahead : facing === 'left' ? -ahead : 0);
      y = pl.y + (facing === 'down' ? ahead : facing === 'up' ? -ahead : 0);
    }
    const ctx = Math.floor(x / TILE_PX);
    const cty = Math.floor(y / TILE_PX);
    // Pack animals spawned together are one pack (`spawn wolf 3`).
    const pack = kind.profile.rudel !== undefined && cmd.count > 1 ? this.population.pack++ : 0;
    let placed = 0;
    for (let r = 0; r <= SPAWN_SEARCH_TILES && placed < cmd.count; r++) {
      for (let dy = -r; dy <= r && placed < cmd.count; dy++) {
        for (let dx = -r; dx <= r && placed < cmd.count; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = ctx + dx;
          const ty = cty + dy;
          const px = (tx + 1 / 2) * TILE_PX;
          const py = (ty + 1 / 2) * TILE_PX;
          if (!insideZone(this.zone, layer, px, py) || !this.standable(kind, layer, tx, ty)) continue;
          const variant = variantFor(kind, this.environment.biome(sim, layer, tx, ty));
          this.spawn(kind, variant, layer, px, py, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, pack, maxHealthOf(kind, variant), this.population.serial++, tick);
          placed++;
        }
      }
    }
    if (placed === 0) this.reject(sim, cmd.type, 'blocked', tick);
  }

  /** `creature.kill`: every creature within `radius` tiles of the player dies by the player's hand. */
  private handleKill(sim: Simulation, cmd: CommandOfType<'creature.kill'>, tick: number): void {
    this.readPlayer(sim);
    const pl = this.pl;
    if (sim.player === NULL_ENTITY || !this.player.position(sim, this.spot)) {
      this.reject(sim, cmd.type, 'noPlayer', tick);
      return;
    }
    const r = Math.min(cmd.radius, MAX_DEBUG_KILL_RADIUS) * TILE_PX;
    const pos = this.motion.position;
    const doomed = this.doomed;
    doomed.length = 0;
    for (let i = 0; i < this.store.size; i++) {
      const s = this.store.valueAt(i);
      const e = this.store.entityAt(i);
      const row = pos.indexOf(e);
      if (row < 0 || s.layer !== pl.layer || s.health <= 0) continue;
      const dx = (pos.columns.x[row] as number) - this.spot.x;
      const dy = (pos.columns.y[row] as number) - this.spot.y;
      if (dx * dx + dy * dy <= r * r) doomed.push(e);
    }
    for (const e of doomed) {
      const s = this.store.get(e);
      const row = pos.indexOf(e);
      if (s === undefined || row < 0) continue;
      this.die(sim, e, s, pos.columns.x[row] as number, pos.columns.y[row] as number, sim.player);
    }
  }

  /** `carcass.carve`: a knife in the hand carves a carcass within reach into its yields (§14 "Jagen & Zerlegen"). */
  private handleCarve(sim: Simulation, cmd: CommandOfType<'carcass.carve'>, tick: number): void {
    const v = sim.player === NULL_ENTITY ? undefined : this.player.vitalsOf(sim.player);
    if (v === undefined || !this.player.position(sim, this.spot)) {
      this.reject(sim, cmd.type, 'noPlayer', tick);
      return;
    }
    if (v.health <= 0) {
      this.reject(sim, cmd.type, 'dead', tick);
      return;
    }
    const c = this.carcasses.get(cmd.carcass);
    if (c === undefined) {
      this.reject(sim, cmd.type, 'noCarcass', tick);
      return;
    }
    if (!this.knifeInHand()) {
      this.reject(sim, cmd.type, 'noKnife', tick);
      return;
    }
    const reach = CR.hunting.carveReachTiles * TILE_PX;
    const dx = c.x - this.spot.x;
    const dy = c.y - this.spot.y;
    if (dx * dx + dy * dy > reach * reach || this.player.body(sim)?.layer !== c.layer) {
      this.reject(sim, cmd.type, 'tooFar', tick);
      return;
    }
    const table = this.catalog.find(c.creature)?.loot ?? null;
    const items = this.inventory.bags.catalog;
    let pieces = 0;
    if (table !== null) {
      for (const d of carveYield(table, sim.rng.stream(CREATURES_RNG_STREAM), this.lootList())) {
        this.drops.spawn(sim, newStack(items.get(d.item), d.count), c.layer, c.x, c.y);
        pieces += d.count;
      }
    }
    this.equipment.wear(sim, { bereich: 'schnellleiste', index: this.inventory.state.auswahl }, 1);
    this.life?.skills.award(sim, CARVE_XP);
    sim.events.push('carcassCarved', { carcass: cmd.carcass, creature: c.creature, pieces, layer: c.layer, x: c.x, y: c.y, tick });
    this.carcasses.remove(cmd.carcass);
    if (sim.ecs.alive(cmd.carcass)) sim.ecs.queueDestroy(cmd.carcass);
  }

  /** Whether the item in the hand carves (`BALANCE.creatures.hunting.carveTool`). */
  knifeInHand(): boolean {
    const held = this.inventory.selected();
    if (held === null) return false;
    return this.inventory.bags.catalog.find(held.item)?.werkzeug?.art === CR.hunting.carveTool;
  }

  /** Carcasses whose time ran out rot away (`carcassRotted`). */
  private rotCarcasses(sim: Simulation, tick: number): void {
    for (let i = this.carcasses.size - 1; i >= 0; i--) {
      if (i >= this.carcasses.size) continue;
      const c = this.carcasses.valueAt(i);
      if (c.untilTick > tick) continue;
      const e = this.carcasses.entityAt(i);
      sim.events.push('carcassRotted', { carcass: e, creature: c.creature, layer: c.layer, x: c.x, y: c.y, tick });
      this.carcasses.remove(e);
      if (sim.ecs.alive(e)) sim.ecs.queueDestroy(e);
    }
  }

  /** The carcass on tile (tx, ty) of `layer` (the lowest entity among several), or `NULL_ENTITY`. */
  carcassAt(layer: Layer, tx: number, ty: number): Entity {
    let found = NULL_ENTITY;
    for (let i = 0; i < this.carcasses.size; i++) {
      const c = this.carcasses.valueAt(i);
      if (c.layer !== layer || Math.floor(c.x / TILE_PX) !== tx || Math.floor(c.y / TILE_PX) !== ty) continue;
      const e = this.carcasses.entityAt(i);
      if (found === NULL_ENTITY || e < found) found = e;
    }
    return found;
  }

  // -------------------------------------------------------------------------------------------
  // Saving
  // -------------------------------------------------------------------------------------------

  private emptySnapshot(): unknown {
    return { serial: 1, pack: 1, creatures: [], chunks: [], carcasses: [], nightmare: NULL_ENTITY, nightmareRetryTick: -1, spawnerTick: 0, paths: this.paths.serialize() };
  }

  private serialize(): unknown {
    const creatures: unknown[] = [];
    for (let i = 0; i < this.store.size; i++) {
      const s = this.store.valueAt(i);
      creatures.push({
        ...s,
        entity: this.store.entityAt(i),
        goalX: Number.isNaN(s.goalX) ? null : s.goalX,
        goalY: Number.isNaN(s.goalY) ? null : s.goalY,
        cooldowns: [...s.cooldowns],
        conditions: s.conditions.map((c) => ({ ...c })),
        path: [...s.path],
      });
    }
    const carcasses: unknown[] = [];
    for (let i = 0; i < this.carcasses.size; i++) carcasses.push({ entity: this.carcasses.entityAt(i), ...this.carcasses.valueAt(i) });
    return {
      serial: this.population.serial,
      pack: this.population.pack,
      creatures,
      chunks: this.population.serialize(),
      carcasses,
      nightmare: this.nightmare,
      nightmareRetryTick: this.nightmareRetryTick,
      spawnerTick: this.spawnerTick,
      paths: this.paths.serialize(),
    };
  }

  private deserialize(data: unknown): void {
    const parsed = creaturesSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`creatures snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const d = parsed.data;
    // The entities themselves are the ECS participant's (restored before this one).
    const seen = new Set<number>();
    for (const c of [...d.creatures, ...d.carcasses]) {
      if (!this.catalog.has(c.creature)) throw new TypeError(`creatures snapshot invalid: unknown creature "${c.creature}"`);
      if (seen.has(c.entity)) throw new TypeError(`creatures snapshot invalid: entity ${c.entity} twice`);
      seen.add(c.entity);
    }
    if (d.nightmare !== NULL_ENTITY && !d.creatures.some((c) => c.entity === d.nightmare)) throw new TypeError('creatures snapshot invalid: the Nachtmahr is no creature');
    this.population.restore(d.chunks, d.serial, d.pack);
    this.paths.deserialize(d.paths);
    this.tickets.clear();
    this.dying.length = 0;
    this.store.clear();
    for (const c of d.creatures) {
      const kind = this.catalog.get(c.creature);
      const { entity, goalX, goalY, cooldowns, conditions, path, ...rest } = c;
      // A changed attack list keeps the cooldowns of the attacks that remain.
      const cd = kind.attacks.map((_, i) => cooldowns[i] ?? -1);
      const known = c.attack < kind.attacks.length;
      this.store.add(entity, {
        ...rest,
        layer: c.layer as Layer,
        goalX: goalX ?? Number.NaN,
        goalY: goalY ?? Number.NaN,
        cooldowns: cd,
        conditions: conditions.map((x) => ({ ...x })),
        path: [...path],
        attack: known ? c.attack : -1,
        attackPhase: known ? c.attackPhase : 'keine',
      });
    }
    this.carcasses.clear();
    for (const c of d.carcasses) {
      const { entity, ...rest } = c;
      this.carcasses.add(entity, { ...rest, layer: c.layer as Layer });
    }
    this.nightmare = d.nightmare;
    this.nightmareRetryTick = d.nightmareRetryTick;
    this.spawnerTick = d.spawnerTick;
  }
}
