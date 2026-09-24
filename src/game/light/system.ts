/**
 * The light system (MASTERPROMPT §12.1, §12.2, §10, §15.4; M3-21, M3-22; docs/SPIEL.md §4): the light
 * sources of the simulation and the gameplay light map on top of them.
 *
 * - **Light source list** (`sources`): every burning light of the active zone plus the carried torch, as
 *   canonical lights (src/engine/lightFalloff.ts) with layer, colour and remaining burn time. The gameplay
 *   light map (`map`, src/world/lightmap) and the renderer (src/render/game/lights.ts) read this one list.
 * - **Carried light** (§12.2 Nebenhand-Regel, `findCarriedLight`): the torch in the off hand – on the belt
 *   (−40 % radius) with a two-handed weapon in the main hand (`addTwoHandedRule`), or from the hotbar with
 *   a shield in the off hand. F (`light.toggle`) lights and snuffs it; it burns 4 game hours, twice as fast
 *   in rain, may go out in heavy rain (5 % per minute), goes out in deep water, and is used up when burned
 *   down. Its remaining time travels with the item (`BURN_REST_KEY`) when it leaves the hand.
 * - **Placed lights** (`light.place`): torches on a stake or on the wall face north of their tile (burning
 *   when set up), camp fires on the ground (cold until fuelled and lit, `light.fuel`, `light.ignite`); a
 *   fire burns its fuel (§15.4, ≤ 6 min), glows as embers, then is ash; it warms (a heat source of the
 *   player's influences, §11.2), which also calms fear and makes sitting restful. `light.douse`,
 *   `light.take` (torches). A torch burned down leaves the world.
 * - **Active zone** (docs/ARCHITEKTUR.md "Aktive Zone"): lights in active chunks burn tick by tick; lights
 *   in frozen chunks catch up analytically when their chunk activates (`catchUp`, the registry). The rain
 *   over a frozen torch – its only input from outside – is sampled at the world ticks like that of a
 *   ticking one; when it changes, the torch is brought to that moment first (without events), so catching
 *   up never needs the weather's past and gives exactly the state of a torch that kept ticking.
 * - **Hooks**: `addFlammables` (a burning torch sets flammable things alight, `light.ignite` – buildings,
 *   M4), `addShelter` (roofs keep the rain off, M4), `addTwoHandedRule` (weapons, M6); `invalidateTile`/
 *   `invalidateChunk` for everything that changes walls (the occlusion cache of the light map);
 *   `heatSources` (the survival influences), `sampler` (fear), `cookingFireNear` (cooking at a fire).
 * Save participant `light` (version 1).
 */
import { BALANCE } from '../../content/balance';
import { lightKind, lightKindOfItem, type LightKind } from '../../content/lights';
import type { ItemDef } from '../../content/schema/item';
import { LIGHT_FULL_CIRCLE } from '../../engine/lightFalloff';
import { hashCombine, hashString, normalizeSeed } from '../../engine/rng';
import { BLOCK_DEEP_WATER, BLOCK_HAZARD, BLOCK_OBJECT, BLOCK_SOLID, BLOCK_VOID, BLOCK_WALL } from '../../world/collision/tiles';
import { GameplayLightMap, type MapLight } from '../../world/lightmap/lightmap';
import type { LightStage } from '../../world/lightmap/stages';
import { WATER_DEPTH_MASK } from '../../world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import type { CommandOfType, GameCommandType } from '../commands';
import { isValidRef, slotAt, withSlot, type BagsState } from '../inventory/bags';
import { discard } from '../inventory/ops';
import type { InventoryRejectReason } from '../inventory/events';
import type { InventorySystem } from '../inventory/system';
import { BAG_AREAS, sameSlot, type SlotRef } from '../items/slots';
import { newStack, type ItemStack } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { WorldCollision } from '../player/collision';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { HeatSource, HeatSourceProvider } from '../survival/modifiers';
import { worldLightEnvironment, type LightEnvironment } from './environment';
import type { LightOutReason, LightRejectReason } from './events';
import {
  advanceFire,
  advanceTorch,
  burnRestOf,
  carriedRadiusPx,
  findCarriedLight,
  fireClip,
  fireLight,
  fuelItemsThatFit,
  fuelTicks,
  handLightOffset,
  heavyRainPutsOut,
  rainClass,
  tileInReach,
  torchBurnTicks,
  withBurnRest,
  type BurnEnd,
  type CarriedSlot,
} from './formulas';
import { copyLightState, createLightState, lightStateSchema, type CarriedLight, type FireBurn, type LightState, type PlacedLight, type PlacedMount, type TorchBurn } from './state';

/** Id of the light system and its save participant. */
export const LIGHT_SYSTEM_ID = 'light';
/** Data version of the `light` participant. */
export const LIGHT_SAVE_VERSION = 1;
/** Light id of the carried light (placed lights count from 1). */
export const CARRIED_LIGHT_ID = 0;
/** Roll number of a placed torch (its id already makes it unique; carried torches count their serial). */
const PLACED_SERIAL = 1;

const L = BALANCE.light;
const TICK_HZ = BALANCE.time.tickHz;
const FIRE_HEAT = BALANCE.survival.temperature.fire;
/** Salt of the heavy-rain rolls (combined with the world seed). */
const ROLL_SALT = hashString('light');
/** Bag areas searched for a torch that left the hand, in order. */
const SEARCH_AREAS = BAG_AREAS;
/** Collision categories no light can be set up on. */
const PLACE_BLOCKERS = BLOCK_SOLID | BLOCK_OBJECT | BLOCK_HAZARD | BLOCK_DEEP_WATER | BLOCK_WALL | BLOCK_VOID;
/** Categories of the tile north of a torch that make it a wall torch. */
const WALL_BEHIND = BLOCK_SOLID | BLOCK_WALL;
/** Offset of a wall torch's light from the wall line into its tile [px]: the flame hangs just in front of the face. */
const WALL_LIGHT_INSET_PX = 1;
/** Bits per axis of a tile key (tile coordinates of every world size stay below 2^16). */
const TILE_KEY_BITS = 16;
/** Tile keys: span per axis and the bias that makes layers non-negative. */
const TILE_KEY_SPAN = 1 << TILE_KEY_BITS;
const LAYER_BIAS = 3;

/** A light of the source list (the canonical light with layer, colour, kind and remaining burn time). */
export interface SimLightSource extends MapLight {
  /** Light kind (src/content/lights.ts). */
  readonly kind: string;
  /** Colour: palette reference of the flame (docs/RENDER.md §1). */
  readonly farbe: string;
  /** Where the light is: carried (`hand`, `guertel`) or placed (`stand`, `wand`, `boden`). */
  readonly mount: PlacedMount | 'hand' | 'guertel';
  /** Remaining burn time [s]: a torch at normal speed, a fire its fuel, embers their glow. */
  readonly brenndauer: number;
}

class SourceRecord implements SimLightSource {
  id = 0;
  layer: Layer = 0;
  kind = '';
  farbe = '';
  mount: SimLightSource['mount'] = 'hand';
  brenndauer = 0;
  windowTiles = 0;
  x = 0;
  y = 0;
  height = 0;
  radius = 0;
  intensity = 0;
  flicker = 0;
  seed = 0;
  coneDirection = 0;
  coneAngle = LIGHT_FULL_CIRCLE;
}

class HeatRecord implements HeatSource {
  x = 0;
  y = 0;
  layer: Layer = 0;
  coreHeatC = FIRE_HEAT.coreHeatC;
  coreRadiusPx = FIRE_HEAT.coreRadiusTiles * TILE_PX;
  radiusPx = FIRE_HEAT.radiusTiles * TILE_PX;
}

/** Something flammable on a tile catches fire from a burning torch (returns whether it did). */
export type FlammableProvider = (sim: Simulation, layer: Layer, tx: number, ty: number) => boolean;
/** Whether a tile is under a roof (no rain reaches a torch there). */
export type ShelterProvider = (sim: Simulation, layer: Layer, tx: number, ty: number) => boolean;
/** Whether an item in the main hand is a two-handed weapon (§12.2: the light then hangs on the belt). */
export type TwoHandedRule = (def: ItemDef) => boolean;
/** Light level at a point (fear, spawning, perception). */
export type LightLevelSampler = (sim: Simulation, layer: Layer, x: number, y: number) => number;

/** Dependencies of the light system. */
export interface LightSystemDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  readonly collision: WorldCollision;
  /** Default: `worldLightEnvironment()`. */
  readonly environment?: LightEnvironment;
}

/** Tile key of (layer, tx, ty). */
function tileKey(layer: Layer, tx: number, ty: number): number {
  return ((layer + LAYER_BIAS) * TILE_KEY_SPAN + ty) * TILE_KEY_SPAN + tx;
}

/** Centre of tile `t` [px]. */
function centre(t: number): number {
  return (t + 0.5) * TILE_PX;
}

export class LightSystem implements SimSystem {
  readonly id = LIGHT_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  /** The gameplay light map over the source list (§12.1). */
  readonly map: GameplayLightMap;
  private readonly player: PlayerSystem;
  private readonly inventory: InventorySystem;
  private readonly collision: WorldCollision;
  private readonly env: LightEnvironment;
  private readonly seed: number;
  private readonly fullTorch: number;
  private stateValue: LightState = createLightState();
  private readonly byTile = new Map<number, PlacedLight>();
  private readonly flammables: FlammableProvider[] = [];
  private readonly shelters: ShelterProvider[] = [];
  private readonly twoHandedRules: TwoHandedRule[] = [];
  private readonly twoHanded = (def: ItemDef): boolean => {
    for (let i = 0; i < this.twoHandedRules.length; i++) if ((this.twoHandedRules[i] as TwoHandedRule)(def)) return true;
    return false;
  };
  // Source list and heat sources, rebuilt when the tick or the state changed.
  private readonly records: SourceRecord[] = [];
  private readonly list: SourceRecord[] = [];
  private readonly heatRecords: HeatRecord[] = [];
  private readonly heatList: HeatRecord[] = [];
  private builtTick = -1;
  private dirty = true;
  private version = 0;
  private sim: Simulation;
  private readonly position = { x: 0, y: 0 };
  private readonly offset = { dx: 0, dy: 0 };
  // The heavy-rain roll of the torch being advanced (no closure per advance).
  private rollKey = 0;
  private rollSerial = 0;
  private readonly roll = (k: number): boolean => heavyRainPutsOut(this.seed, this.rollKey, this.rollSerial, k);

  constructor(sim: Simulation, deps: LightSystemDeps) {
    this.sim = sim;
    this.player = deps.player;
    this.inventory = deps.inventory;
    this.collision = deps.collision;
    this.env = deps.environment ?? worldLightEnvironment();
    this.seed = hashCombine(normalizeSeed(sim.config.seed), ROLL_SALT);
    this.fullTorch = torchBurnTicks(sim.clock.ticksPerGameHour);
    const collision = this.collision;
    this.map = new GameplayLightMap(
      {
        lights: () => this.sources(this.sim),
        ambient: (layer, tx, ty) => this.env.ambient(this.sim, layer, tx, ty),
        occluders: { beginQuery: () => collision.grid.beginQuery(), info: (layer, tx, ty) => collision.grid.info(layer, tx, ty) },
      },
      L.map.movingCacheEntries,
    );
    // A dead or sleeping player (§11.5, §11.6) handles no light: every command is refused with the reason.
    this.commands = {
      'light.toggle': (s, cmd, tick) => {
        if (this.able(s, cmd.type, tick)) this.handleToggle(s, cmd.type, tick);
      },
      'light.place': (s, cmd, tick) => {
        if (this.able(s, cmd.type, tick)) this.handlePlace(s, cmd, tick);
      },
      'light.fuel': (s, cmd, tick) => {
        if (this.able(s, cmd.type, tick)) this.handleFuel(s, cmd, tick);
      },
      'light.ignite': (s, cmd, tick) => {
        if (this.able(s, cmd.type, tick)) this.handleIgnite(s, cmd, tick);
      },
      'light.douse': (s, cmd, tick) => {
        if (this.able(s, cmd.type, tick)) this.handleDouse(s, cmd, tick);
      },
      'light.take': (s, cmd, tick) => {
        if (this.able(s, cmd.type, tick)) this.handleTake(s, cmd, tick);
      },
    };
    this.save = {
      id: LIGHT_SYSTEM_ID,
      version: LIGHT_SAVE_VERSION,
      serialize: () => copyLightState(this.stateValue),
      deserialize: (data) => this.restore(data),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------

  /** The state (read-only for callers: placed lights, the carried light). */
  get state(): Readonly<LightState> {
    return this.stateValue;
  }

  /** The carried light, or `null`. */
  get carried(): Readonly<CarriedLight> | null {
    return this.stateValue.carried;
  }

  /** The placed light on tile (tx, ty) of `layer`, or `undefined`. */
  lightAt(layer: Layer, tx: number, ty: number): Readonly<PlacedLight> | undefined {
    return this.byTile.get(tileKey(layer, tx, ty));
  }

  /** The placed light `id`, or `undefined`. */
  placed(id: number): Readonly<PlacedLight> | undefined {
    return this.stateValue.placed.find((l) => l.id === id);
  }

  /**
   * The light source list of this tick: every burning light of the active zone and the carried torch
   * (docs/SPIEL.md §4 – the list the light map and the renderer read). Rebuilt at most once per tick and
   * after changes; the records are reused (read them before the next tick).
   */
  sources(sim: Simulation): readonly SimLightSource[] {
    this.sim = sim;
    if (this.dirty || this.builtTick !== sim.tick) this.rebuild(sim);
    return this.list;
  }

  /** Light level at world px (x, y) on `layer` (§12.1): ambient plus the sources, bilinear per tile. */
  levelAt(sim: Simulation, layer: Layer, x: number, y: number): number {
    this.sources(sim);
    this.map.setStamp(this.version);
    return this.map.levelAt(layer, x, y);
  }

  /** Light stage at world px (x, y) on `layer`. */
  stageAt(sim: Simulation, layer: Layer, x: number, y: number): LightStage {
    this.sources(sim);
    this.map.setStamp(this.version);
    return this.map.stageAt(layer, x, y);
  }

  /** The light map of this tick, ready for batch reads (`fillTiles`, debug views). */
  mapFor(sim: Simulation): GameplayLightMap {
    this.sources(sim);
    this.map.setStamp(this.version);
    return this.map;
  }

  /** Offset of the carried light from the player's feet [px] by the body's facing (the view adds it to the drawn figure). */
  carriedOffset(sim: Simulation, out: { dx: number; dy: number }): { dx: number; dy: number } {
    return handLightOffset(this.player.body(sim)?.facing ?? 'down', out);
  }

  /** The light level as a sampler (the fear system's `useLight`). */
  sampler(): LightLevelSampler {
    return (sim, layer, x, y) => this.levelAt(sim, layer, x, y);
  }

  /** Burning fires of the active zone as heat sources (§11.2 "Feuer +15 °C im Kern"). */
  heatSources(): HeatSourceProvider {
    return (sim) => {
      this.sources(sim);
      return this.heatList;
    };
  }

  /** Id of the nearest burning fire within `radiusTiles` of world px (x, y) on `layer` (cooking, §12.2 "Kochen"), 0 if none. */
  cookingFireNear(layer: Layer, x: number, y: number, radiusTiles: number): number {
    let best = 0;
    let bestD2 = (radiusTiles * TILE_PX) ** 2;
    for (const l of this.stateValue.placed) {
      if (l.layer !== layer || l.fire === null || !l.fire.lit) continue;
      const dx = centre(l.tx) - x;
      const dy = centre(l.ty) - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = l.id;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------------------------

  /** Adds something flammable a burning torch can set alight (`light.ignite` on its tile). */
  addFlammables(provider: FlammableProvider): void {
    this.flammables.push(provider);
  }

  /** Adds roofs: torches under them stay dry. */
  addShelter(provider: ShelterProvider): void {
    this.shelters.push(provider);
  }

  /** Adds a rule naming two-handed weapons (the carried light then hangs on the belt). */
  addTwoHandedRule(rule: TwoHandedRule): void {
    this.twoHandedRules.push(rule);
  }

  /** A tile that can block light changed (mining, building, terraforming): the light map traces again around it. */
  invalidateTile(layer: Layer, tx: number, ty: number): void {
    this.map.invalidateTile(layer, tx, ty);
  }

  /** Something anywhere in a chunk changed. */
  invalidateChunk(layer: Layer, cx: number, cy: number): void {
    this.map.invalidateChunk(layer, cx, cy);
  }

  // -------------------------------------------------------------------------------------------
  // Ticks
  // -------------------------------------------------------------------------------------------

  update(sim: Simulation): void {
    this.sim = sim;
    const to = sim.tick + 1;
    this.syncCarried(sim);
    this.burnCarried(sim, to);
    const placed = this.stateValue.placed;
    for (let i = placed.length - 1; i >= 0; i--) {
      const l = placed[i] as PlacedLight;
      if (!this.env.active(sim, l.layer, l.tx >> CHUNK_SHIFT, l.ty >> CHUNK_SHIFT)) continue;
      this.advancePlaced(sim, l, to, true);
    }
  }

  /** World tick: the rain over every torch; a frozen torch whose rain changes is brought to this moment first. */
  worldTick(sim: Simulation): void {
    this.sim = sim;
    const now = sim.tick;
    const c = this.stateValue.carried;
    const body = this.player.body(sim);
    if (c !== null && body !== undefined && this.player.position(sim, this.position)) {
      c.burn.rain = this.rainAt(sim, body.layer, Math.floor(this.position.x / TILE_PX), Math.floor(this.position.y / TILE_PX));
    }
    const placed = this.stateValue.placed;
    for (let i = placed.length - 1; i >= 0; i--) {
      const l = placed[i] as PlacedLight;
      const t = l.torch;
      if (t === null || !t.lit) continue;
      const rain = this.rainAt(sim, l.layer, l.tx, l.ty);
      if (rain === t.rain) continue;
      if (!this.env.active(sim, l.layer, l.tx >> CHUNK_SHIFT, l.ty >> CHUNK_SHIFT)) this.advancePlaced(sim, l, now, false);
      if (l.torch !== null) l.torch.rain = rain;
    }
  }

  /** A frozen chunk activates: its lights burn from where they stopped to `toTick` (analytic, no events). */
  catchUp(chunk: { readonly layer: Layer; readonly cx: number; readonly cy: number }, _fromTick: number, toTick: number): void {
    const placed = this.stateValue.placed;
    for (let i = placed.length - 1; i >= 0; i--) {
      const l = placed[i] as PlacedLight;
      if (l.layer !== chunk.layer || l.tx >> CHUNK_SHIFT !== chunk.cx || l.ty >> CHUNK_SHIFT !== chunk.cy) continue;
      this.advancePlaced(null, l, toTick, false);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------------------------

  private reject(sim: Simulation, type: GameCommandType, reason: LightRejectReason | InventoryRejectReason, tick: number): void {
    sim.events.push('commandRejected', { type, reason, tick });
  }

  /** Whether the player may handle lights now; refuses command `type` with `dead` or `asleep` otherwise. */
  private able(sim: Simulation, type: GameCommandType, tick: number): boolean {
    const unable = this.player.incapacity(sim);
    if (unable === null) return true;
    this.reject(sim, type, unable, tick);
    return false;
  }

  private handleToggle(sim: Simulation, type: GameCommandType, tick: number): void {
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.position)) return this.reject(sim, type, 'noPlayer', tick);
    this.syncCarried(sim);
    const c = this.stateValue.carried;
    if (c === null) return this.reject(sim, type, 'noLight', tick);
    if (c.burn.lit) {
      c.burn.lit = false;
      this.carriedEvent(sim, 'lightExtinguished', c, 'schalter');
    } else {
      if (body.swimming) return this.reject(sim, type, 'inWater', tick);
      c.burn.lit = true;
      c.burn.at = sim.tick;
      c.burn.rain = this.rainAt(sim, body.layer, Math.floor(this.position.x / TILE_PX), Math.floor(this.position.y / TILE_PX));
      this.carriedEvent(sim, 'lightIgnited', c, null);
    }
    this.carriedChanged(sim);
  }

  private handlePlace(sim: Simulation, cmd: CommandOfType<'light.place'>, tick: number): void {
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.position)) return this.reject(sim, cmd.type, 'noPlayer', tick);
    this.syncCarried(sim);
    const bags = this.inventory.state;
    if (!isValidRef(bags, cmd.from)) return this.reject(sim, cmd.type, 'invalidSlot', tick);
    const stack = slotAt(bags, cmd.from);
    if (stack === null) return this.reject(sim, cmd.type, 'slotEmpty', tick);
    const kind = lightKindOfItem(stack.item);
    if (kind === undefined) return this.reject(sim, cmd.type, 'notPlaceable', tick);
    const layer = body.layer;
    if (!tileInReach(this.position.x, this.position.y, cmd.tx, cmd.ty, L.placement.reachTiles)) return this.reject(sim, cmd.type, 'outOfReach', tick);
    if (this.byTile.has(tileKey(layer, cmd.tx, cmd.ty))) return this.reject(sim, cmd.type, 'tileTaken', tick);
    if (!this.placeable(layer, cmd.tx, cmd.ty)) return this.reject(sim, cmd.type, 'tileBlocked', tick);
    const consumed = discard(bags, this.inventory.bags.catalog, cmd.from, 1);
    if (!consumed.ok) return this.reject(sim, cmd.type, consumed.reason, tick);
    const carried = this.stateValue.carried;
    const fromHand = carried !== null && sameSlot(carried.ref, cmd.from);
    this.replaceBags(sim, consumed.state, cmd.from);
    const id = this.stateValue.nextId++;
    let torch: TorchBurn | null = null;
    let fire: FireBurn | null = null;
    let mount: PlacedMount;
    if (kind.verhalten === 'fackel') {
      mount = this.wallBehind(layer, cmd.tx, cmd.ty) ? 'wand' : 'stand';
      const rest = fromHand ? (carried as CarriedLight).burn.rest : (burnRestOf(stack) ?? this.fullTorch);
      torch = { lit: true, rest, at: sim.tick, rain: this.rainAt(sim, layer, cmd.tx, cmd.ty), heavyTicks: 0 };
    } else {
      mount = 'boden';
      fire = { lit: false, fuel: 0, embers: 0, burned: false, at: sim.tick };
    }
    const light: PlacedLight = { id, kind: kind.id, layer, tx: cmd.tx, ty: cmd.ty, mount, torch, fire };
    this.insert(light);
    sim.events.push('lightPlaced', { light: id, kind: kind.id, mount, layer, tx: cmd.tx, ty: cmd.ty, lit: torch !== null, tick });
    if (fromHand) {
      const wasLit = (carried as CarriedLight).burn.lit;
      this.stateValue.carried = null;
      this.carriedChanged(sim);
      if (!wasLit) this.placedEvent(sim, 'lightIgnited', light, null);
    } else if (torch !== null) this.placedEvent(sim, 'lightIgnited', light, null);
    this.touch();
  }

  private handleFuel(sim: Simulation, cmd: CommandOfType<'light.fuel'>, tick: number): void {
    const l = this.reachable(sim, cmd.type, cmd.light, tick);
    if (l === null) return;
    const fire = l.fire;
    if (fire === null) return this.reject(sim, cmd.type, 'notAFire', tick);
    const bags = this.inventory.state;
    if (!isValidRef(bags, cmd.from)) return this.reject(sim, cmd.type, 'invalidSlot', tick);
    const stack = slotAt(bags, cmd.from);
    if (stack === null) return this.reject(sim, cmd.type, 'slotEmpty', tick);
    const seconds = this.inventory.bags.catalog.get(stack.item).brennwert;
    if (seconds === undefined) return this.reject(sim, cmd.type, 'notFuel', tick);
    const per = fuelTicks(seconds);
    const n = fuelItemsThatFit(fire.fuel, per, Math.min(cmd.count ?? stack.count, stack.count));
    if (n < 1) return this.reject(sim, cmd.type, 'fireFull', tick);
    const consumed = discard(bags, this.inventory.bags.catalog, cmd.from, n);
    if (!consumed.ok) return this.reject(sim, cmd.type, consumed.reason, tick);
    this.replaceBags(sim, consumed.state, cmd.from);
    fire.fuel += n * per;
    sim.events.push('fireFueled', { light: l.id, item: stack.item, count: n, fuelSeconds: fire.fuel / TICK_HZ, x: centre(l.tx), y: centre(l.ty), layer: l.layer, tick });
    if (!fire.lit && fire.embers > 0) {
      // Embers rekindle the fresh fuel (§12.2: a fire kept alive needs no new light).
      fire.lit = true;
      fire.embers = 0;
      this.placedEvent(sim, 'lightIgnited', l, null);
    }
    this.touch();
  }

  private handleIgnite(sim: Simulation, cmd: CommandOfType<'light.ignite'>, tick: number): void {
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.position)) return this.reject(sim, cmd.type, 'noPlayer', tick);
    if (!tileInReach(this.position.x, this.position.y, cmd.tx, cmd.ty, BALANCE.interaction.reachTiles)) return this.reject(sim, cmd.type, 'outOfReach', tick);
    const l = this.byTile.get(tileKey(body.layer, cmd.tx, cmd.ty));
    if (l !== undefined) {
      if (l.torch !== null) {
        if (l.torch.lit) return this.reject(sim, cmd.type, 'burning', tick);
        l.torch.lit = true;
        l.torch.at = sim.tick;
        l.torch.rain = this.rainAt(sim, l.layer, l.tx, l.ty);
      } else if (l.fire !== null) {
        if (l.fire.lit) return this.reject(sim, cmd.type, 'burning', tick);
        if (l.fire.fuel <= 0) return this.reject(sim, cmd.type, 'noFuel', tick);
        l.fire.lit = true;
        l.fire.embers = 0;
        l.fire.burned = true;
        l.fire.at = sim.tick;
      }
      this.placedEvent(sim, 'lightIgnited', l, null);
      this.touch();
      return;
    }
    this.syncCarried(sim);
    const c = this.stateValue.carried;
    if (c === null || !c.burn.lit) return this.reject(sim, cmd.type, 'nothingToIgnite', tick);
    for (let i = 0; i < this.flammables.length; i++) {
      if ((this.flammables[i] as FlammableProvider)(sim, body.layer, cmd.tx, cmd.ty)) {
        sim.events.push('flammableIgnited', { layer: body.layer, tx: cmd.tx, ty: cmd.ty, tick });
        return;
      }
    }
    this.reject(sim, cmd.type, 'nothingToIgnite', tick);
  }

  private handleDouse(sim: Simulation, cmd: CommandOfType<'light.douse'>, tick: number): void {
    const l = this.reachable(sim, cmd.type, cmd.light, tick);
    if (l === null) return;
    if (l.torch !== null) {
      if (!l.torch.lit) return this.reject(sim, cmd.type, 'notBurning', tick);
      l.torch.lit = false;
    } else if (l.fire !== null) {
      if (!l.fire.lit && l.fire.embers === 0) return this.reject(sim, cmd.type, 'notBurning', tick);
      l.fire.lit = false;
      l.fire.embers = 0;
    }
    this.placedEvent(sim, 'lightExtinguished', l, 'schalter');
    this.touch();
  }

  private handleTake(sim: Simulation, cmd: CommandOfType<'light.take'>, tick: number): void {
    const l = this.reachable(sim, cmd.type, cmd.light, tick);
    if (l === null) return;
    const torch = l.torch;
    if (torch === null) return this.reject(sim, cmd.type, 'notTakeable', tick);
    const kind = lightKind(l.kind);
    const stack = withBurnRest(newStack(this.inventory.bags.catalog.get(kind.gegenstand), 1), torch.rest, this.fullTorch);
    if (this.inventory.roomFor(stack) < 1) return this.reject(sim, cmd.type, 'noSpace', tick);
    this.inventory.giveStack(sim, stack);
    if (torch.lit) this.placedEvent(sim, 'lightExtinguished', l, 'verstaut');
    this.remove(l);
    sim.events.push('lightRemoved', { light: l.id, kind: l.kind, layer: l.layer, tx: l.tx, ty: l.ty, reason: 'genommen', tick });
    this.touch();
  }

  /** The placed light `id` if the player reaches it; otherwise rejects and returns `null`. */
  private reachable(sim: Simulation, type: GameCommandType, id: number, tick: number): PlacedLight | null {
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.position)) {
      this.reject(sim, type, 'noPlayer', tick);
      return null;
    }
    const l = this.stateValue.placed.find((p) => p.id === id);
    if (l === undefined) {
      this.reject(sim, type, 'noSuchLight', tick);
      return null;
    }
    if (l.layer !== body.layer || !tileInReach(this.position.x, this.position.y, l.tx, l.ty, BALANCE.interaction.reachTiles)) {
      this.reject(sim, type, 'outOfReach', tick);
      return null;
    }
    return l;
  }

  // -------------------------------------------------------------------------------------------
  // The carried light
  // -------------------------------------------------------------------------------------------

  /**
   * Brings the carried light in line with the bags: a torch that left the hand takes its remaining burn
   * time along (and goes out); a torch that came into the hand (or onto the belt) is carried unlit; the
   * same torch in another slot or mode stays as it is.
   */
  private syncCarried(sim: Simulation): void {
    const bags = this.inventory.state;
    const found = this.player.body(sim) === undefined ? null : findCarriedLight(bags, this.inventory.bags.catalog, this.twoHanded);
    const c = this.stateValue.carried;
    if (c !== null && found !== null && found.stack.item === c.item && burnRestOf(found.stack) === c.startRest) {
      if (c.mode !== found.mode || !sameSlot(c.ref, found.ref)) {
        c.mode = found.mode;
        c.ref = found.ref;
        this.carriedChanged(sim);
      }
      return;
    }
    if (c !== null) {
      this.release(sim, c);
      this.stateValue.carried = null;
    }
    if (found !== null) this.adopt(sim, found);
    if (c !== null || found !== null) this.carriedChanged(sim);
  }

  private adopt(sim: Simulation, found: CarriedSlot): void {
    const start = burnRestOf(found.stack);
    this.stateValue.handSerial++;
    this.stateValue.carried = {
      ref: found.ref,
      item: found.stack.item,
      kind: found.kind.id,
      startRest: start,
      serial: this.stateValue.handSerial,
      mode: found.mode,
      burn: { lit: false, rest: start ?? this.fullTorch, at: sim.tick, rain: 'trocken', heavyTicks: 0 },
    };
    this.touch();
  }

  /** The torch left the hand: its remaining time goes into its stack wherever it went; a lit one goes out. */
  private release(sim: Simulation, c: CarriedLight): void {
    const bags = this.inventory.state;
    const at = this.findStack(bags, c);
    if (at !== null) {
      const stack = slotAt(bags, at) as ItemStack;
      this.inventory.bags.replace(withSlot(bags, at, withBurnRest(stack, c.burn.rest, this.fullTorch)));
    }
    if (c.burn.lit) this.carriedEvent(sim, 'lightExtinguished', c, 'verstaut');
    this.touch();
  }

  /** Slot of the stack a carried torch came from (its old slot first, then every area). */
  private findStack(bags: BagsState, c: CarriedLight): SlotRef | null {
    const matches = (s: ItemStack | null): boolean => s !== null && s.item === c.item && burnRestOf(s) === c.startRest;
    if (isValidRef(bags, c.ref) && matches(slotAt(bags, c.ref))) return c.ref;
    for (const area of SEARCH_AREAS) {
      const slots = bags[area];
      for (let index = 0; index < slots.length; index++) if (matches(slots[index] ?? null)) return { bereich: area, index };
    }
    return null;
  }

  /** Burns the carried torch to tick `to`: deep water puts it out, burned down it is used up. */
  private burnCarried(sim: Simulation, to: number): void {
    const c = this.stateValue.carried;
    if (c === null) return;
    const b = c.burn;
    if (!b.lit) {
      b.at = to;
      return;
    }
    this.rollFor(CARRIED_LIGHT_ID, c.serial);
    const swimming = this.player.body(sim)?.swimming === true;
    const end = advanceTorch(b, swimming ? sim.tick : to, this.roll);
    if (end === null && swimming) {
      // Deep water douses the flame at once (it went into the water with the player).
      b.lit = false;
      b.at = to;
      this.carriedEvent(sim, 'lightExtinguished', c, 'wasser');
      this.carriedChanged(sim);
      return;
    }
    if (end === null) return;
    b.at = to;
    this.carriedEvent(sim, 'lightExtinguished', c, end.reason);
    if (end.reason === 'abgebrannt') this.useUp(sim, c);
    this.carriedChanged(sim);
  }

  /** A carried torch burned down: the item is gone. */
  private useUp(sim: Simulation, c: CarriedLight): void {
    const bags = this.inventory.state;
    const at = this.findStack(bags, c);
    if (at !== null) this.replaceBags(sim, withSlot(bags, at, null), at);
    this.stateValue.carried = null;
    this.touch();
  }

  // -------------------------------------------------------------------------------------------
  // Placed lights
  // -------------------------------------------------------------------------------------------

  /**
   * Brings placed light `l` to tick `to`. With `sim` (active chunk) the changes raise events; without
   * (frozen: catch-up, rain changes) they happen silently. A torch burned down leaves the world.
   */
  private advancePlaced(sim: Simulation | null, l: PlacedLight, to: number, events: boolean): void {
    if (l.torch !== null) {
      this.rollFor(l.id, PLACED_SERIAL);
      const end: BurnEnd | null = advanceTorch(l.torch, to, this.roll);
      if (end === null) return;
      if (events && sim !== null) this.placedEvent(sim, 'lightExtinguished', l, end.reason);
      if (end.reason === 'abgebrannt') {
        this.remove(l);
        if (events && sim !== null) sim.events.push('lightRemoved', { light: l.id, kind: l.kind, layer: l.layer, tx: l.tx, ty: l.ty, reason: 'abgebrannt', tick: sim.eventTick });
      }
      this.touch();
      return;
    }
    const f = l.fire;
    if (f === null) return;
    const before = f.lit || f.embers > 0;
    const wasLit = f.lit;
    const change = advanceFire(f, to);
    if (change === 'none') return;
    this.touch();
    if (!events || sim === null) return;
    if (wasLit) this.placedEvent(sim, 'lightExtinguished', l, 'abgebrannt');
    if (change === 'ash' && before) sim.events.push('fireCooled', { light: l.id, layer: l.layer, x: centre(l.tx), y: centre(l.ty), tick: sim.eventTick });
  }

  private insert(l: PlacedLight): void {
    this.stateValue.placed.push(l);
    this.byTile.set(tileKey(l.layer, l.tx, l.ty), l);
  }

  private remove(l: PlacedLight): void {
    const i = this.stateValue.placed.indexOf(l);
    if (i >= 0) this.stateValue.placed.splice(i, 1);
    this.byTile.delete(tileKey(l.layer, l.tx, l.ty));
    this.map.occlusion.forget(l.id);
  }

  /** Whether a light can be set up on tile (tx, ty): open ground without water, a tree or a wall. */
  private placeable(layer: Layer, tx: number, ty: number): boolean {
    const info = this.collision.grid.tileInfo(layer, tx, ty);
    if ((info & PLACE_BLOCKERS) !== 0) return false;
    const chunk = this.collision.chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (chunk === undefined) return false;
    return ((chunk.water[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number) & WATER_DEPTH_MASK) === 0;
  }

  /** Whether the tile north of (tx, ty) is a wall a torch can hang on (rock or a cliff face). */
  private wallBehind(layer: Layer, tx: number, ty: number): boolean {
    return (this.collision.grid.tileInfo(layer, tx, ty - 1) & WALL_BEHIND) !== 0;
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  /** Rain class over tile (tx, ty): the falling rain unless a roof covers it. */
  private rainAt(sim: Simulation, layer: Layer, tx: number, ty: number): TorchBurn['rain'] {
    for (let i = 0; i < this.shelters.length; i++) if ((this.shelters[i] as ShelterProvider)(sim, layer, tx, ty)) return 'trocken';
    return rainClass(this.env.rain(sim, layer, tx, ty));
  }

  /** Points the heavy-rain roll (`roll`) at torch `key` (a placed light's id, 0 for the carried one) with number `serial`. */
  private rollFor(key: number, serial: number): void {
    this.rollKey = key;
    this.rollSerial = serial;
  }

  private replaceBags(sim: Simulation, next: BagsState, touched: SlotRef): void {
    this.inventory.bags.replace(next);
    sim.events.push('inventoryChanged', { change: 'remove', tick: sim.eventTick });
    if (touched.bereich === 'ausruestung' || touched.bereich === 'guertel') {
      const slot = slotAt(next, touched);
      sim.events.push('equipmentChanged', { at: { ...touched }, item: slot === null ? null : slot.item, tick: sim.eventTick });
    }
  }

  private carriedEvent(sim: Simulation, type: 'lightIgnited' | 'lightExtinguished', c: CarriedLight, reason: LightOutReason | null): void {
    const body = this.player.body(sim);
    const layer = body?.layer ?? 0;
    const p = this.position;
    if (!this.player.position(sim, p)) {
      p.x = 0;
      p.y = 0;
    }
    if (type === 'lightIgnited') sim.events.push('lightIgnited', { light: CARRIED_LIGHT_ID, kind: c.kind, layer, x: p.x, y: p.y, tick: sim.eventTick });
    else sim.events.push('lightExtinguished', { light: CARRIED_LIGHT_ID, kind: c.kind, layer, x: p.x, y: p.y, reason: reason ?? 'schalter', tick: sim.eventTick });
    this.touch();
  }

  private placedEvent(sim: Simulation, type: 'lightIgnited' | 'lightExtinguished', l: PlacedLight, reason: LightOutReason | null): void {
    if (type === 'lightIgnited') sim.events.push('lightIgnited', { light: l.id, kind: l.kind, layer: l.layer, x: centre(l.tx), y: centre(l.ty), tick: sim.eventTick });
    else sim.events.push('lightExtinguished', { light: l.id, kind: l.kind, layer: l.layer, x: centre(l.tx), y: centre(l.ty), reason: reason ?? 'schalter', tick: sim.eventTick });
  }

  private carriedChanged(sim: Simulation): void {
    const c = this.stateValue.carried;
    sim.events.push('carriedLightChanged', { item: c?.item ?? null, mode: c?.mode ?? null, lit: c?.burn.lit ?? false, tick: sim.eventTick });
    this.touch();
  }

  private touch(): void {
    this.dirty = true;
  }

  /** Rebuilds the source list and the heat sources for this tick. */
  private rebuild(sim: Simulation): void {
    this.dirty = false;
    this.builtTick = sim.tick;
    this.version++;
    this.list.length = 0;
    this.heatList.length = 0;
    let n = 0;
    const c = this.stateValue.carried;
    const body = this.player.body(sim);
    if (c !== null && c.burn.lit && body !== undefined && this.player.position(sim, this.position)) {
      const kind = lightKind(c.kind);
      const r = this.record(n++);
      handLightOffset(body.facing, this.offset);
      this.fill(r, CARRIED_LIGHT_ID, kind, body.layer, this.position.x + this.offset.dx, this.position.y + this.offset.dy, L.torch.flameHeightPx.hand, carriedRadiusPx(c.mode), L.torch.intensity, L.torch.flicker, c.mode, c.burn.rest / TICK_HZ);
      r.windowTiles = L.torch.radiusTiles;
      this.list.push(r);
    }
    const placed = this.stateValue.placed;
    let h = 0;
    for (let i = 0; i < placed.length; i++) {
      const l = placed[i] as PlacedLight;
      if (!this.env.active(sim, l.layer, l.tx >> CHUNK_SHIFT, l.ty >> CHUNK_SHIFT)) continue;
      const kind = lightKind(l.kind);
      if (l.torch !== null) {
        if (!l.torch.lit) continue;
        const wall = l.mount === 'wand';
        const r = this.record(n++);
        this.fill(
          r,
          l.id,
          kind,
          l.layer,
          centre(l.tx),
          wall ? l.ty * TILE_PX + WALL_LIGHT_INSET_PX : centre(l.ty),
          wall ? L.torch.flameHeightPx.wand : L.torch.flameHeightPx.stand,
          L.torch.radiusTiles * TILE_PX,
          L.torch.intensity,
          L.torch.flicker,
          l.mount,
          l.torch.rest / TICK_HZ,
        );
        r.windowTiles = L.torch.radiusTiles;
        this.list.push(r);
        continue;
      }
      const f = l.fire;
      if (f === null) continue;
      const params = fireLight(fireClip(f));
      if (params === null) continue;
      const r = this.record(n++);
      this.fill(r, l.id, kind, l.layer, centre(l.tx), centre(l.ty), L.campfire.flameHeightPx, params.radiusPx, params.intensity, params.flicker, l.mount, (f.lit ? f.fuel : f.embers) / TICK_HZ);
      r.windowTiles = L.campfire.radiusTiles;
      this.list.push(r);
      if (!f.lit) continue;
      let heat = this.heatRecords[h];
      if (heat === undefined) {
        heat = new HeatRecord();
        this.heatRecords.push(heat);
      }
      h++;
      heat.x = centre(l.tx);
      heat.y = centre(l.ty);
      heat.layer = l.layer;
      this.heatList.push(heat);
    }
  }

  private record(i: number): SourceRecord {
    let r = this.records[i];
    if (r === undefined) {
      r = new SourceRecord();
      this.records.push(r);
    }
    return r;
  }

  private fill(r: SourceRecord, id: number, kind: LightKind, layer: Layer, x: number, y: number, height: number, radius: number, intensity: number, flicker: number, mount: SimLightSource['mount'], seconds: number): void {
    r.id = id;
    r.kind = kind.id;
    r.farbe = kind.farbe;
    r.layer = layer;
    r.x = x;
    r.y = y;
    r.height = height;
    r.radius = radius;
    r.intensity = intensity;
    r.flicker = flicker;
    r.seed = id;
    r.coneDirection = 0;
    r.coneAngle = LIGHT_FULL_CIRCLE;
    r.mount = mount;
    r.brenndauer = seconds;
  }

  private restore(data: unknown): void {
    const parsed = lightStateSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`light snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const d = parsed.data;
    for (const l of d.placed) lightKind(l.kind);
    if (d.carried !== null) lightKind(d.carried.kind);
    const next = copyLightState(d as LightState);
    this.byTile.clear();
    for (const l of next.placed) {
      const key = tileKey(l.layer as Layer, l.tx, l.ty);
      if (this.byTile.has(key)) throw new TypeError(`light snapshot invalid: two lights on tile ${l.layer}:${l.tx}:${l.ty}`);
      this.byTile.set(key, l);
    }
    this.stateValue = next;
    this.map.occlusion.invalidateAll();
    this.touch();
  }
}
