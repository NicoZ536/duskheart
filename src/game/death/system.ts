/**
 * Death and respawn (MASTERPROMPT §11.6, §29; M3-26).
 *
 * - **Death** (checked last in every tick, after everything that can hurt): when the player's health is 0
 *   the light goes out (`playerDied` with the cause – the lethal damage of this tick). A grave appears at
 *   the place of death with what the difficulty's penalty puts in (§29: Normal the carried bags,
 *   equipment stays on; Hart everything; Entspannt nothing) – on the map until emptied. Conditions end,
 *   fear and the Nachtmahr are gone, every skill loses its penalty's share of the progress within its level.
 *   The body lies still (speed 0, no stamina) while the death screen shows.
 * - **Respawn** (`death.respawn`): at the bed that last set the respawn point, a lit beacon (beacon
 *   providers, M5) or the start beach, on the nearest free tile; full health and stamina within
 *   "Erschüttert" (3 min, −15 % max. health), satiety and thirst at least half. Unbarmherzig: no respawn.
 * - **Graves** (`death.lootGrave`, the interaction "E"): what fits goes into the bags; an empty grave
 *   disappears. Listeners of `onDying` run first (the crafting queue gives its reserved ingredients back,
 *   so they end up in the grave with the bags).
 * - `death.kill` (debug) ends the player's life at once. The difficulty is a parameter of the world
 *   (`difficulty`, default Normal; §29 "Schwierigkeit jederzeit änderbar (außer Unbarmherzig)").
 * Global. Save participant `death`.
 */
import { BALANCE } from '../../content/balance';
import type { Difficulty } from '../../content/balance/death';
import { NULL_ENTITY, type Entity } from '../../engine/ecs';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { CommandOfType } from '../commands';
import type { ConditionsSystem } from '../conditions/system';
import type { PlayerHarm } from '../conditions/harm';
import type { FearSystem } from '../fear/system';
import type { BagsState, Slot } from '../inventory/bags';
import type { InventorySystem } from '../inventory/system';
import type { BagArea } from '../items/slots';
import type { ItemStack } from '../items/stack';
import type { SaveParticipant } from '../participant';
import { SPAWN_SEARCH_RADIUS, findFreeTile, type FreeTile } from '../player/cliffs';
import type { WorldCollision } from '../player/collision';
import type { PlayerComponents } from '../player/components';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { SkillsSystem } from '../skills/system';
import type { SleepPlace } from '../sleep/state';
import { maxHealth, maxStamina } from '../survival/formulas';
import type { PlayerInfluences, PlayerModifierSource } from '../survival/modifiers';
import type { MotionSystem } from '../systems/motion';
import type { DeathRejectReason, RespawnSpot } from './events';
import { graveAreas, penaltyOf, respawnVitals } from './formulas';
import { copyDeathState, createDeathState, deathStateSchema, type DeathState, type Grave } from './state';

/** Id of the death system and its save participant. */
export const DEATH_SYSTEM_ID = 'death';
/** Data version of the `death` participant. */
export const DEATH_SAVE_VERSION = 1;
/** Cause of a death nobody claimed (no lethal damage recorded in its tick). */
export const UNKNOWN_DEATH_CAUSE = 'unbekannt';
/** Cause of `death.kill`. */
export const DEBUG_DEATH_CAUSE = 'debug';

const D = BALANCE.death;
const GRAVE_REACH_PX = D.graveReachTiles * TILE_PX;
/** Areas of the worn pieces: their changes raise `equipmentChanged`. */
const WORN: ReadonlySet<BagArea> = new Set(['ausruestung', 'guertel', 'rucksack']);

/** A lit beacon to respawn at (the beacon system, M5). */
export interface BeaconSpot {
  readonly x: number;
  readonly y: number;
  readonly layer: number;
}
/** Lists the lit beacons. */
export type BeaconProvider = (sim: Simulation) => readonly BeaconSpot[];

/** Dependencies of the death system. */
export interface DeathSystemDeps {
  readonly components: PlayerComponents;
  readonly motion: MotionSystem;
  readonly collision: WorldCollision;
  readonly influences: PlayerInfluences;
  readonly inventory: InventorySystem;
  readonly conditions: ConditionsSystem;
  readonly fear: FearSystem;
  readonly skills: SkillsSystem;
  readonly harm: PlayerHarm;
  /** Puts the player at world px (x, y) on `layer` (the player system's teleport). */
  readonly teleport: (sim: Simulation, x: number, y: number, layer: Layer) => void;
  /** Tile of the start beach (§11.6 "am Startstrand"). */
  readonly beach: (sim: Simulation) => { readonly tx: number; readonly ty: number };
}

/** Called when the player's light goes out, before the grave is filled (the crafting queue returns its reserved ingredients). */
export type DyingListener = (sim: Simulation) => void;

/** Why a respawn target is refused, or where it is. */
type Target = { readonly x: number; readonly y: number; readonly layer: Layer; readonly at: RespawnSpot } | DeathRejectReason;

export class DeathSystem implements SimSystem {
  readonly id = DEATH_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  private readonly deps: DeathSystemDeps;
  private readonly beacons: BeaconProvider[] = [];
  private readonly dyingListeners: DyingListener[] = [];
  private stateValue: DeathState = createDeathState();
  private readonly free: FreeTile = { tx: 0, ty: 0, level: 0 };
  private readonly pos = { x: 0, y: 0 };

  constructor(deps: DeathSystemDeps) {
    this.deps = deps;
    this.commands = {
      'death.respawn': (sim, cmd, tick) => {
        const reason = this.respawn(sim, cmd, tick);
        if (reason !== null) sim.events.push('commandRejected', { type: cmd.type, reason, tick });
      },
      'death.lootGrave': (sim, cmd, tick) => {
        const reason = this.loot(sim, cmd.grave, tick);
        if (reason !== null) sim.events.push('commandRejected', { type: cmd.type, reason, tick });
      },
      'death.kill': (sim, cmd, tick) => {
        const v = sim.player === NULL_ENTITY ? undefined : deps.components.vitals.get(sim.player);
        if (v === undefined) sim.events.push('commandRejected', { type: cmd.type, reason: 'noPlayer', tick });
        else if (v.health <= 0) sim.events.push('commandRejected', { type: cmd.type, reason: 'dead', tick });
        else {
          v.health = 0;
          deps.harm.markLethal(sim, DEBUG_DEATH_CAUSE);
        }
      },
    };
    this.save = {
      id: DEATH_SYSTEM_ID,
      version: DEATH_SAVE_VERSION,
      serialize: () => copyDeathState(this.stateValue),
      deserialize: (data) => {
        const parsed = deathStateSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`death snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        const s = parsed.data;
        const ids = new Set(s.graves.map((g) => g.id));
        if (ids.size !== s.graves.length || s.graves.some((g) => g.id >= s.nextGraveId)) throw new TypeError('death snapshot invalid: grave ids must be unique and below nextGraveId');
        this.stateValue = copyDeathState(s as DeathState);
      },
    };
  }

  /** The death state (read-only for callers: graves for the map and the world, the death for the death screen). */
  get state(): Readonly<DeathState> {
    return this.stateValue;
  }

  /** Whether the player is dead (the death screen shows). */
  get dead(): boolean {
    return this.stateValue.death !== null;
  }

  /** Difficulty whose penalties apply. */
  get difficulty(): Difficulty {
    return this.stateValue.difficulty;
  }

  /** Sets the difficulty (§29: any time, but never away from Unbarmherzig). Returns whether it changed. */
  setDifficulty(difficulty: Difficulty): boolean {
    if (this.stateValue.difficulty === 'unbarmherzig' || difficulty === this.stateValue.difficulty) return false;
    this.stateValue.difficulty = difficulty;
    return true;
  }

  /** Adds a provider of lit beacons (M5). */
  addBeacons(provider: BeaconProvider): void {
    this.beacons.push(provider);
  }

  /** Adds a listener called when the player dies, before the grave is filled. */
  onDying(listener: DyingListener): void {
    this.dyingListeners.push(listener);
  }

  /** A bed was slept in: it becomes the respawn point (§11.5). */
  setRespawnPoint(sim: Simulation, place: SleepPlace): void {
    this.stateValue.respawn = { x: place.x, y: place.y, layer: place.layer, kind: place.kind };
    sim.events.push('respawnPointSet', { x: place.x, y: place.y, layer: place.layer, kind: place.kind, tick: sim.eventTick });
  }

  /** The bed is gone (the building system tore it down): respawn on the beach again. */
  clearRespawnPoint(): void {
    this.stateValue.respawn = null;
  }

  /** Modifier source of the dead body: it lies still. */
  modifierSource(): PlayerModifierSource {
    return (_sim, _player, out) => {
      if (this.stateValue.death !== null) out.moveSpeedFactor = 0;
    };
  }

  update(sim: Simulation): void {
    const e = sim.player;
    if (e === NULL_ENTITY) return;
    const v = this.deps.components.vitals.get(e);
    if (v === undefined) return;
    if (this.stateValue.death !== null) {
      // The dead body has no strength: no sprint, no roll until the respawn.
      v.stamina = 0;
      v.sprintLocked = true;
      return;
    }
    if (v.health <= 0) this.die(sim, e);
  }

  // -------------------------------------------------------------------------------------------

  /** The player's light goes out (§11.6). */
  private die(sim: Simulation, e: Entity): void {
    const d = this.deps;
    const body = d.components.body.get(e);
    const v = d.components.vitals.get(e);
    if (body === undefined || v === undefined || !this.position(e)) return;
    const penalty = penaltyOf(this.stateValue.difficulty);
    const cause = d.harm.lethalCause(sim) ?? UNKNOWN_DEATH_CAUSE;
    for (const listener of this.dyingListeners) listener(sim);
    const grave = this.bury(sim, graveAreas(penalty.grave), body.layer);
    d.conditions.clearAll(sim, 'tod');
    d.fear.reset(sim);
    if (penalty.skillLoss > 0) d.skills.loseProgress(sim, penalty.skillLoss);
    v.stamina = 0;
    v.sprintLocked = true;
    this.stateValue.death = { tick: sim.eventTick, x: this.pos.x, y: this.pos.y, layer: body.layer, cause, grave, permadeath: penalty.permadeath };
    const graveItems = grave === null ? 0 : (this.stateValue.graves.find((g) => g.id === grave)?.items.length ?? 0);
    sim.events.push('playerDied', { entity: e, x: this.pos.x, y: this.pos.y, layer: body.layer, cause, grave, graveItems, penalty, spots: this.spots(sim), permadeath: penalty.permadeath, tick: sim.eventTick });
  }

  /** Moves the items of `areas` into a new grave at the player's position; returns its id, or `null` when there was nothing. */
  private bury(sim: Simulation, areas: readonly BagArea[], layer: number): number | null {
    const inv = this.deps.inventory;
    const before = inv.state;
    const items: ItemStack[] = [];
    const next: { -readonly [K in keyof BagsState]: BagsState[K] } = { ...before };
    for (const area of areas) {
      const slots = before[area];
      for (const s of slots) if (s !== null) items.push(s);
      // Without its backpack the compartment has no slots (§13.1); otherwise it stays, emptied.
      const size = area === 'rucksackfach' && areas.includes('rucksack') ? 0 : slots.length;
      next[area] = Object.freeze(new Array<Slot>(size).fill(null));
    }
    if (items.length === 0) return null;
    inv.bags.replace(next);
    const tick = sim.eventTick;
    sim.events.push('inventoryChanged', { change: 'remove', tick });
    for (const area of areas) {
      if (!WORN.has(area)) continue;
      before[area].forEach((s, index) => {
        if (s !== null) sim.events.push('equipmentChanged', { at: { bereich: area, index }, item: null, tick });
      });
    }
    const id = this.stateValue.nextGraveId++;
    const grave: Grave = { id, x: this.pos.x, y: this.pos.y, layer, items, tick };
    this.stateValue.graves.push(grave);
    sim.events.push('graveCreated', { grave: id, x: grave.x, y: grave.y, layer, items: items.length, tick });
    return id;
  }

  /** Where the player can respawn now (the death screen's choices): bed if set, lit beacons, the beach; none on Unbarmherzig. */
  spots(sim: Simulation): RespawnSpot[] {
    if (penaltyOf(this.stateValue.difficulty).permadeath) return [];
    const out: RespawnSpot[] = [];
    if (this.stateValue.respawn !== null) out.push('bett');
    if (this.beacons.some((b) => b(sim).length > 0)) out.push('leuchtfeuer');
    out.push('strand');
    return out;
  }

  /** Where to respawn for `at` (default: the bed if set, else the beach). */
  private target(sim: Simulation, at: RespawnSpot | undefined): Target {
    const s = this.stateValue;
    const spot = at ?? (s.respawn !== null ? 'bett' : 'strand');
    if (spot === 'bett') return s.respawn === null ? 'noRespawnPoint' : { x: s.respawn.x, y: s.respawn.y, layer: s.respawn.layer as Layer, at: 'bett' };
    if (spot === 'strand') {
      const b = this.deps.beach(sim);
      return { x: (b.tx + 1 / 2) * TILE_PX, y: (b.ty + 1 / 2) * TILE_PX, layer: 0, at: 'strand' };
    }
    const from = s.death;
    let best: { x: number; y: number; layer: Layer } | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const provider of this.beacons) {
      for (const b of provider(sim)) {
        const dx = from === null ? 0 : b.x - from.x;
        const dy = from === null ? 0 : b.y - from.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) {
          bestD = d2;
          best = { x: b.x, y: b.y, layer: b.layer as Layer };
        }
      }
    }
    return best === null ? 'noRespawnPoint' : { ...best, at: 'leuchtfeuer' };
  }

  /** Back to life (§11.6). */
  private respawn(sim: Simulation, cmd: CommandOfType<'death.respawn'>, tick: number): DeathRejectReason | 'noPlayer' | 'noFreeTile' | null {
    const d = this.deps;
    const e = sim.player;
    const death = this.stateValue.death;
    if (e === NULL_ENTITY) return 'noPlayer';
    const v = d.components.vitals.get(e);
    if (v === undefined) return 'noPlayer';
    if (death === null) return 'notDead';
    if (death.permadeath) return 'permadeath';
    const t = this.target(sim, cmd.at);
    if (typeof t === 'string') return t;
    const tx = Math.floor(t.x / TILE_PX);
    const ty = Math.floor(t.y / TILE_PX);
    d.collision.ensureTiles(t.layer, tx - SPAWN_SEARCH_RADIUS - 1, ty - SPAWN_SEARCH_RADIUS - 1, tx + SPAWN_SEARCH_RADIUS + 1, ty + SPAWN_SEARCH_RADIUS + 1);
    if (!findFreeTile(d.collision.grid, t.layer, tx, ty, SPAWN_SEARCH_RADIUS, this.free)) return 'noFreeTile';
    const x = (this.free.tx + 1 / 2) * TILE_PX;
    const y = (this.free.ty + 1 / 2) * TILE_PX;
    d.teleport(sim, x, y, t.layer);
    this.stateValue.death = null;
    d.conditions.apply(sim, D.respawnCondition);
    const mods = d.influences.refresh(sim, e);
    respawnVitals(v, maxHealth(mods.maxHealthBonus, mods.maxHealthFactor), maxStamina(mods.maxStaminaBonus, mods.maxStaminaFactor, 'normal'));
    sim.events.push('playerRespawned', { entity: e, x, y, layer: t.layer, at: t.at, tick });
    return null;
  }

  /** Takes what fits out of grave `id` (§11.6 "bleibt bis geleert"). */
  private loot(sim: Simulation, id: number, tick: number): DeathRejectReason | 'noPlayer' | 'outOfReach' | 'noSpace' | null {
    const d = this.deps;
    const e = sim.player;
    const v = e === NULL_ENTITY ? undefined : d.components.vitals.get(e);
    const body = e === NULL_ENTITY ? undefined : d.components.body.get(e);
    if (v === undefined || body === undefined || !this.position(e)) return 'noPlayer';
    if (v.health <= 0 || this.stateValue.death !== null) return 'dead';
    const graves = this.stateValue.graves;
    const g = graves.find((x) => x.id === id);
    if (g === undefined) return 'noGrave';
    const dx = g.x - this.pos.x;
    const dy = g.y - this.pos.y;
    if (g.layer !== body.layer || dx * dx + dy * dy > GRAVE_REACH_PX * GRAVE_REACH_PX) return 'outOfReach';
    let taken = 0;
    const left: ItemStack[] = [];
    for (const stack of g.items) {
      const r = d.inventory.giveStack(sim, stack);
      taken += r.added;
      if (r.rest > 0) left.push({ ...stack, count: r.rest });
    }
    if (taken === 0) return 'noSpace';
    g.items = left;
    const remaining = left.reduce((n, s) => n + s.count, 0);
    sim.events.push('graveLooted', { grave: id, taken, remaining, tick });
    if (left.length === 0) {
      graves.splice(graves.indexOf(g), 1);
      sim.events.push('graveEmptied', { grave: id, tick });
    }
    return null;
  }

  private position(e: Entity): boolean {
    const row = this.deps.motion.position.indexOf(e);
    if (row < 0) return false;
    this.pos.x = this.deps.motion.position.columns.x[row] as number;
    this.pos.y = this.deps.motion.position.columns.y[row] as number;
    return true;
  }
}
