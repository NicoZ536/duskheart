/**
 * The light system (MASTERPROMPT §12.1, §12.2, §10, §15.4; M3-21, M3-22; docs/SPIEL.md §4): the light
 * sources of the simulation and the gameplay light map on top of them.
 *
 * - **Light source list** (`sources`): every burning light of the active zone plus the carried torch, as
 *   canonical lights (src/engine/lightFalloff.ts) with layer, colour and remaining burn time. The gameplay
 *   light map (`map`, src/world/lightmap) and the renderer (src/render/game/lights.ts) read this one list.
 * - **Carried light** (§12.2 Nebenhand-Regel, `findCarriedLight`): the torch in the off hand – on the belt
 *   (−40 % radius) with a weapon in the main hand that keeps the off hand busy (`addTwoHandedRule`: the two-hander, and
 *   bow and crossbow, M6-79/ADR-0154), or from the hotbar with a shield in the off hand. F (`light.toggle`) lights and snuffs it; it burns 4 game hours, twice as fast
 *   in rain, may go out in heavy rain (5 % per minute), goes out in deep water, and is used up when burned
 *   down. Its remaining time travels with the item (`BURN_REST_KEY`) when it leaves the hand.
 * - **Placed lights** (`light.place`): torches on a stake or on the wall face north of their tile (burning
 *   when set up), camp fires on the ground (cold until fuelled and lit, `light.fuel`, `light.ignite`); a
 *   fire burns its fuel (§15.4, ≤ 6 min), glows as embers, then is ash; it warms (a heat source of the
 *   player's influences, §11.2), which also calms fear and makes sitting restful. `light.douse`,
 *   `light.take` (torches). A torch burned down leaves the world. A camp fire stands in the way (collision
 *   overlay, `collisionOverlay`) and is not set up where the player stands; nothing is set up where another system
 *   placed something (`addOccupancy`: build parts).
 * - **Furniture lights** (M4-19, §12.2 "Kerzen, Wandlampen …", §16.4 "Heizquellen (Kamin …)"): lamps and the stone
 *   fireplace are build parts; the building system's part listener reports them (`placeFurniture`,
 *   `removeFurniture`). A lamp is fuelled with whole pieces of its own fuel (`light.fuel`) up to its stock, lit by
 *   hand, burns like a torch whose remaining time is its stock – an open flame twice as fast in rain and with the
 *   heavy-rain roll, a lantern behind glass untouched by the weather – and stays when it burned down. The fireplace
 *   is a fire with its own stock, light and heat (a heat source of the player and of rooms). Taken down (or swapped by
 *   an upgrade), a lamp gives its whole unburned pieces back into the bags; destroyed or fallen off its wall, they drop
 *   at the lamp like everything else that spills there.
 * - **Rain puts fires out** (§10 "Feuer löschen", M4-28): at every world tick a burning or glowing fire (camp fire,
 *   fireplace) that rain – not a drizzle, the fire system's threshold – falls on goes out; a roof over it keeps it
 *   burning (`addShelter`), and a fire in the rain does not light (`raining`). Frozen fires are brought to that
 *   world tick first, so catching up stays exact.
 * - **Active zone** (docs/ARCHITEKTUR.md "Aktive Zone"): lights in active chunks burn tick by tick; lights
 *   in frozen chunks catch up analytically when their chunk activates (`catchUp`, the registry). The rain
 *   over a frozen torch – its only input from outside – is sampled at the world ticks like that of a
 *   ticking one; when it changes, the torch is brought to that moment first (without events), so catching
 *   up never needs the weather's past and gives exactly the state of a torch that kept ticking. The source
 *   list follows the active set also within a tick (`LightEnvironment.activeVersion`).
 * - **Hooks**: `addFlammables` (a burning torch sets flammable things alight, `light.ignite` – buildings,
 *   M4), `addShelter` (roofs and closed rooms keep the rain off, M4), `addOccupancy` (build parts keep lights off), `addTwoHandedRule` (weapons, M6), `addLightProviders` (lights
 *   other systems keep in the list: burning hearths, burning buildings, M4-20, M4-28); `invalidateTile`/
 *   `invalidateChunk` for everything that changes walls (the occlusion cache of the light map);
 *   `heatSources` (the survival influences), `sampler` (fear), `cookingFireNear` (cooking at a fire), `putOutNear` (the
 *   light eater of the shadow brood puts out torches and lanterns around it, §12.4, M6-26).
 * - **Lumen lantern** (M7-36, strand F; behaviour `lumen`, docs/SPIEL.md §22): carried like a torch but no flame – rain and
 *   water leave it alone; its burn time is a charge of `BALANCE.light.lumen.hoursPerShard` per Lumen shard (the stack keeps
 *   what is left like a torch, a fresh lantern holds one charge). F on an empty one loads a shard from the bags (`lumenCharged`),
 *   a lit one that runs dry loads the next by itself or goes dark; it is never used up. The light eater does not put it out
 *   but drains its charges (`drainLumenNear`); its aura burns shadow brood around the bearer once per world second
 *   (`useLumenAura`, src/game/light/lumen.ts).
 * Save participant `light` (version 1).
 */
import { BALANCE } from '../../content/balance';
import { MOEBEL_WANDHOEHE_PX } from '../../content/items/moebel_deko';
import { lightKind, lightKindOfItem, type LightKind } from '../../content/lights';
import type { ItemDef } from '../../content/schema/item';
import { LIGHT_FULL_CIRCLE } from '../../engine/lightFalloff';
import { hashCombine, hashString, normalizeSeed } from '../../engine/rng';
import { BLOCK_DEEP_WATER, BLOCK_HAZARD, BLOCK_OBJECT, BLOCK_SOLID, BLOCK_VOID, BLOCK_WALL, type CollisionOverlay } from '../../world/collision/tiles';
import { GameplayLightMap, type LightMapInputs, type MapLight } from '../../world/lightmap/lightmap';
import type { OccluderSource } from '../../world/lightmap/occlusion';
import type { LightStage } from '../../world/lightmap/stages';
import { WATER_DEPTH_MASK } from '../../world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import type { PartRemoveReason } from '../building/events';
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
import { lumenChargeTicks, type LumenAura } from './lumen';
import type { LightOutReason, LightRejectReason } from './events';
import {
  advanceFire,
  advanceTorch,
  burnRestOf,
  carriedRadiusPx,
  findCarriedLight,
  fireClip,
  fireLightOf,
  fireMaxFuelTicks,
  fuelItemsThatFit,
  fuelTicks,
  handLightOffset,
  heavyRainPutsOut,
  lampMaxTicks,
  lampPieceTicks,
  rainClass,
  rainPutsOutFire,
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
/**
 * Bits per axis of a tile key: the largest world is 2 048 tiles wide (`BALANCE.world.sizeTiles`), 13 bits hold 8 192. With
 * the layer every key stays below 2^30, a small integer – a larger key is a heap number on every lookup (the collision
 * overlay is asked per tile, M6-16g).
 */
const TILE_KEY_BITS = 13;
/** Tile keys: span per axis and the bias that makes layers non-negative. */
const TILE_KEY_SPAN = 1 << TILE_KEY_BITS;
const LAYER_BIAS = 3;
/** Radius of the player's body [px]: a camp fire is not set up onto it (it stands in the way). */
const BODY_RADIUS_PX = BALANCE.player.movement.colliderRadiusPx;
/** Height of a wall lamp's anchor above its ground point [px] before its hanging height: the ground point lies `WALL_LIGHT_INSET_PX` into the lamp's tile, the wall face's foot line `wallFaceFootPx` into the wall's tile north of it. */
const WALL_FACE_ABOVE_PX = WALL_LIGHT_INSET_PX + TILE_PX - L.furniture.wallFaceFootPx;

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
/**
 * Whether an item in the main hand keeps the off hand busy – a two-handed weapon (§12.2: the light then hangs on the belt),
 * and bow and crossbow (M6-79: the bow's off hand draws the string, the crossbow lies in both hands; ADR-0154).
 */
export type TwoHandedRule = (def: ItemDef) => boolean;
/** Light level at a point (fear, spawning, perception). */
export type LightLevelSampler = (sim: Simulation, layer: Layer, x: number, y: number) => number;
/**
 * Puts one light another system keeps into the source list: its id (unique among all lights), kind and colour
 * (palette reference), layer, position [world px], flame height [px], radius [px], brightness, flicker, remaining burn
 * time [s] and the tile window of the light map [tiles]; it stands on the ground (`boden`).
 */
export type ExtraLightSink = (id: number, kind: string, farbe: string, layer: Layer, x: number, y: number, height: number, radiusPx: number, intensity: number, flicker: number, seconds: number, windowTiles: number) => void;
/** Visits the lights another system keeps in the active zone (burning hearths, burning buildings). */
export type ExtraLightProvider = (sim: Simulation, emit: ExtraLightSink) => void;
/** Whether another system placed something on a tile that keeps lights off it (build parts). */
export type LightOccupancy = (sim: Simulation, layer: Layer, tx: number, ty: number) => boolean;
/** Puts a stack that found no room in the bags into the world at (x, y) on `layer` (the drop system). */
export type LightSpill = (sim: Simulation, stack: ItemStack, layer: Layer, x: number, y: number) => void;

/** Dependencies of the light system. */
export interface LightSystemDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  readonly collision: WorldCollision;
  /** Default: `worldLightEnvironment()`. */
  readonly environment?: LightEnvironment;
  /**
   * Where the fuel of a lamp goes that burned or fell off its wall, and what of a dismantled lamp's fuel the bags cannot
   * take (the drop system); without it that fuel is lost.
   */
  readonly spill?: LightSpill;
}

/** Tile key of (layer, tx, ty). */
function tileKey(layer: Layer, tx: number, ty: number): number {
  // A tile beyond the span has no key of its own (−1: nothing stands there) – it would alias a tile of another row.
  if (tx < 0 || ty < 0 || tx >= TILE_KEY_SPAN || ty >= TILE_KEY_SPAN) return -1;
  return ((layer + LAYER_BIAS) * TILE_KEY_SPAN + ty) * TILE_KEY_SPAN + tx;
}

/** Centre of tile `t` [px]. */
function centre(t: number): number {
  return (t + 0.5) * TILE_PX;
}

/** Whether a placed light is furniture of the build grid (a lamp, the fireplace; M4-19). */
function isFurniture(l: Readonly<PlacedLight>): boolean {
  return lightKind(l.kind).moebel !== undefined;
}

/**
 * The camp fires as a collision overlay (`LightSystem.collisionOverlay`): a class over the system's tile index rather than a
 * closure made per system – the path tile cache asks it for every tile of a chunk it builds, and one code for every world
 * keeps that call optimised (M6-16g).
 */
class CampFireOverlay implements CollisionOverlay {
  constructor(private readonly byTile: ReadonlyMap<number, PlacedLight>) {}

  overlayAt(layer: Layer, tx: number, ty: number): number {
    const l = this.byTile.get(tileKey(layer, tx, ty));
    return l !== undefined && l.fire !== null && !isFurniture(l) ? BLOCK_OBJECT : 0;
  }
}

/** What blocks light: the collision grid's tile infos (methods, not closures – see `LightMapSource`). */
class CollisionOccluders implements OccluderSource {
  constructor(private readonly collision: WorldCollision) {}

  beginQuery(): void {
    this.collision.grid.beginQuery();
  }

  info(layer: Layer, tx: number, ty: number): number {
    return this.collision.grid.info(layer, tx, ty);
  }
}

/**
 * What the light map reads from the light system: its source list of the simulation it last worked for and the ambient of
 * its environment (M6-16f). Methods of one class instead of closures made per system: every world runs the same code, so
 * a tile query stays optimised – with the ambient written into the map's memo – when a new world (a load, the next bench
 * round) comes up.
 */
class LightMapSource implements LightMapInputs {
  readonly occluders: OccluderSource;

  constructor(
    private readonly system: LightSystem,
    private readonly env: LightEnvironment,
    collision: WorldCollision,
    /** The simulation the light system works for (the last one it was handed). */
    public sim: Simulation,
  ) {
    this.occluders = new CollisionOccluders(collision);
  }

  lights(): readonly MapLight[] {
    return this.system.sources(this.sim);
  }

  ambient(layer: Layer, tx: number, ty: number, out: Float64Array, index: number): undefined {
    return this.env.ambient(this.sim, layer, tx, ty, out, index);
  }
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
  /** A full charge of the Lumen lantern [ticks] (one shard, M7-36). */
  private readonly fullLumen: number;
  /** The Lumen lantern's aura on the creatures (wired in src/game/setup.ts), or null. */
  private lumenAura: LumenAura | null = null;
  private stateValue: LightState = createLightState();
  private readonly byTile = new Map<number, PlacedLight>();
  private readonly flammables: FlammableProvider[] = [];
  private readonly shelters: ShelterProvider[] = [];
  private readonly twoHandedRules: TwoHandedRule[] = [];
  private readonly occupancy: LightOccupancy[] = [];
  private readonly spill: LightSpill | null;
  private readonly extraProviders: ExtraLightProvider[] = [];
  private extraCount = 0;
  private readonly emitExtra: ExtraLightSink = (id, kind, farbe, layer, x, y, height, radiusPx, intensity, flicker, seconds, windowTiles) => {
    const r = this.record(this.extraCount++);
    r.id = id;
    r.kind = kind;
    r.farbe = farbe;
    r.layer = layer;
    r.x = x;
    r.y = y;
    r.height = height;
    r.radius = radiusPx;
    r.intensity = intensity;
    r.flicker = flicker;
    r.seed = id;
    r.coneDirection = 0;
    r.coneAngle = LIGHT_FULL_CIRCLE;
    r.mount = 'boden';
    r.brenndauer = seconds;
    r.windowTiles = windowTiles;
    this.list.push(r);
  };
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
  /** Version of the active set the list was built for (`LightEnvironment.activeVersion`). */
  private builtZone = 0;
  private dirty = true;
  private version = 0;
  /** The light map's inputs; they hold the simulation the system works for (`sim`). */
  private readonly source: LightMapSource;
  private readonly position = { x: 0, y: 0 };
  private readonly offset = { dx: 0, dy: 0 };
  // The heavy-rain roll of the torch being advanced (no closure per advance).
  private rollKey = 0;
  private rollSerial = 0;
  private readonly roll = (k: number): boolean => heavyRainPutsOut(this.seed, this.rollKey, this.rollSerial, k);

  constructor(sim: Simulation, deps: LightSystemDeps) {
    this.player = deps.player;
    this.inventory = deps.inventory;
    this.collision = deps.collision;
    this.env = deps.environment ?? worldLightEnvironment();
    this.spill = deps.spill ?? null;
    this.seed = hashCombine(normalizeSeed(sim.config.seed), ROLL_SALT);
    this.fullTorch = torchBurnTicks(sim.clock.ticksPerGameHour);
    this.fullLumen = lumenChargeTicks(sim.clock.ticksPerGameHour);
    this.source = new LightMapSource(this, this.env, this.collision, sim);
    this.map = new GameplayLightMap(this.source, L.map.movingCacheEntries);
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
    this.source.sim = sim;
    // The active set changes within a tick too (chunks activate one by one, a zone listener may read the light between them).
    const zone = this.env.activeVersion?.(sim) ?? 0;
    if (this.dirty || this.builtTick !== sim.tick || this.builtZone !== zone) this.rebuild(sim, zone);
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

  /**
   * Id of the nearest burning camp fire within `radiusTiles` of world px (x, y) on `layer` (cooking, §12.2 "Lagerfeuer …
   * Kochen"; the fireplace heats a room, it is no cooking spot), 0 if none.
   */
  cookingFireNear(layer: Layer, x: number, y: number, radiusTiles: number): number {
    let best = 0;
    let bestD2 = (radiusTiles * TILE_PX) ** 2;
    for (const l of this.stateValue.placed) {
      if (l.layer !== layer || l.fire === null || !l.fire.lit || isFurniture(l)) continue;
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

  /**
   * Whether rain that puts fires out falls on the placed fire `l` now (§10 "Feuer löschen"): not a drizzle, not under a
   * roof or in a closed room (the shelters), never underground. False for torches and lamps.
   */
  rainsOnFire(sim: Simulation, l: Readonly<PlacedLight>): boolean {
    if (l.fire === null) return false;
    for (let i = 0; i < this.shelters.length; i++) if ((this.shelters[i] as ShelterProvider)(sim, l.layer, l.tx, l.ty)) return false;
    return rainPutsOutFire(this.env.rain(sim, l.layer, l.tx, l.ty));
  }

  /** Burn time of one piece of the lamp kind `kind`'s fuel [ticks] in this world (a game hour's ticks). */
  lampPieceTicks(kind: LightKind): number {
    return lampPieceTicks(kind, this.source.sim.clock.ticksPerGameHour);
  }

  /** Most fuel the lamp kind `kind` holds [ticks]. */
  lampMaxTicks(kind: LightKind): number {
    return lampMaxTicks(kind, this.source.sim.clock.ticksPerGameHour);
  }

  /**
   * The camp fires as a collision overlay of the world (§16.1 "Objekte"): a camp fire stands in the way like a piece
   * of furniture (one tile, where the light system placed it). Torches on stakes are passed; furniture lights collide
   * as build parts.
   */
  collisionOverlay(): CollisionOverlay {
    return new CampFireOverlay(this.byTile);
  }

  // -------------------------------------------------------------------------------------------
  // Furniture lights (build grid, M4-19)
  // -------------------------------------------------------------------------------------------

  /**
   * A furniture light came onto the build grid (the building system's part listener): the part `item` anchored on
   * (tx, ty) of `layer`, its footprint `w` × `h` tiles as it stands. A lamp starts cold and empty, the fireplace cold
   * without fuel. Returns the new light's id, or `null` when `item` is no furniture light or one is anchored there.
   */
  placeFurniture(sim: Simulation, item: string, layer: Layer, tx: number, ty: number, w = 1, h = 1): number | null {
    const kind = lightKindOfItem(item);
    const m = kind?.moebel;
    if (kind === undefined || m === undefined) return null;
    const there = this.byTile.get(tileKey(layer, tx, ty));
    if (there !== undefined) return null;
    const id = this.stateValue.nextId++;
    const lamp = kind.verhalten === 'lampe';
    const mount: PlacedMount = lamp ? (m.montage === 'wand' ? 'wand' : 'stand') : 'boden';
    const light: PlacedLight = {
      id,
      kind: kind.id,
      layer,
      tx,
      ty,
      ...(w === 1 && h === 1 ? {} : { groesse: { b: w, t: h } }),
      mount,
      torch: lamp ? { lit: false, rest: 0, at: sim.tick, rain: 'trocken', heavyTicks: 0 } : null,
      fire: lamp ? null : { lit: false, fuel: 0, embers: 0, burned: false, at: sim.tick },
    };
    this.insert(light);
    sim.events.push('lightPlaced', { light: id, kind: kind.id, mount, layer, tx, ty, lit: false, tick: sim.eventTick });
    this.touch();
    return id;
  }

  /**
   * The furniture light anchored on (tx, ty) of `layer` left the build grid for `reason` (the building system's part
   * listener): it goes out and leaves. A lamp's whole unburned pieces of fuel go into the bags when the player took it
   * down or swapped it (`abgebaut`, `aufgewertet`; what does not fit lands at the lamp) – when it burned or fell off its
   * wall (`zerstoert`, `abgefallen`, also during a frozen chunk's catch-up far from the player) they drop at the lamp.
   * False when no furniture light is anchored there.
   */
  removeFurniture(sim: Simulation, layer: Layer, tx: number, ty: number, reason: PartRemoveReason = 'abgebaut'): boolean {
    const l = this.byTile.get(tileKey(layer, tx, ty));
    if (l === undefined || l.tx !== tx || l.ty !== ty || !isFurniture(l)) return false;
    const kind = lightKind(l.kind);
    // Brought to now first (a frozen lamp taken by a fire's catch-up burned on until this moment).
    this.advancePlaced(null, l, sim.tick, false);
    const torch = l.torch;
    const pieces = torch === null ? 0 : Math.floor(torch.rest / this.lampPieceTicks(kind));
    const fuel = kind.moebel?.brennstoff;
    if ((torch?.lit ?? false) || (l.fire?.lit ?? false)) this.placedEvent(sim, 'lightExtinguished', l, 'schalter');
    this.remove(l);
    sim.events.push('lightRemoved', { light: l.id, kind: l.kind, layer, tx, ty, reason: 'abgebaut', tick: sim.eventTick });
    if (pieces > 0 && fuel !== undefined) {
      const stack = newStack(this.inventory.bags.catalog.get(fuel), pieces);
      const byPlayer = reason === 'abgebaut' || reason === 'aufgewertet';
      const rest = byPlayer ? this.inventory.giveStack(sim, stack).rest : pieces;
      if (rest > 0) this.spill?.(sim, { ...stack, count: rest }, layer, this.groundX(l, kind), this.groundY(l, kind));
    }
    this.touch();
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------------------------

  /** Adds something other systems placed that keeps lights off a tile (build parts). */
  addOccupancy(o: LightOccupancy): void {
    this.occupancy.push(o);
  }

  /** Adds something flammable a burning torch can set alight (`light.ignite` on its tile). */
  addFlammables(provider: FlammableProvider): void {
    this.flammables.push(provider);
  }

  /** Adds roofs and closed rooms: torches and open lamps under them stay dry, fires keep burning in the rain. */
  addShelter(provider: ShelterProvider): void {
    this.shelters.push(provider);
  }

  /** Adds a rule naming weapons that keep the off hand busy (the carried light then hangs on the belt). */
  addTwoHandedRule(rule: TwoHandedRule): void {
    this.twoHandedRules.push(rule);
  }

  /** Adds lights another system keeps (visited whenever the source list is rebuilt, at most once per tick). */
  addLightProviders(provider: ExtraLightProvider): void {
    this.extraProviders.push(provider);
    this.dirty = true;
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
    this.source.sim = sim;
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
    this.source.sim = sim;
    const now = sim.tick;
    const c = this.stateValue.carried;
    const body = this.player.body(sim);
    if (c !== null && body !== undefined && this.player.position(sim, this.position)) {
      if (this.isLumen(c)) {
        // No flame, no rain (M7-36); a lit lantern burns the shadow brood around its bearer once a second.
        if (c.burn.lit && this.lumenAura !== null) this.lumenAura(sim, body.layer, this.position.x, this.position.y, L.lumen.auraRadiusTiles * TILE_PX, L.lumen.auraDamagePerSecond);
      } else c.burn.rain = this.rainAt(sim, body.layer, Math.floor(this.position.x / TILE_PX), Math.floor(this.position.y / TILE_PX));
    }
    const placed = this.stateValue.placed;
    for (let i = placed.length - 1; i >= 0; i--) {
      const l = placed[i] as PlacedLight;
      if (l.fire !== null) {
        this.rainOnFire(sim, l, now);
        continue;
      }
      const t = l.torch;
      if (t === null || !t.lit) continue;
      const rain = this.torchRain(sim, l);
      if (rain === t.rain) continue;
      if (!this.env.active(sim, l.layer, l.tx >> CHUNK_SHIFT, l.ty >> CHUNK_SHIFT)) this.advancePlaced(sim, l, now, false);
      if (l.torch !== null) l.torch.rain = rain;
    }
  }

  /**
   * Rain on a burning or glowing fire at world tick `now` puts it out (§10 "Feuer löschen"): a frozen fire is first
   * brought to `now` without events, then flames and embers go out – with events only in the active zone. The fuel left
   * stays (it lights again when dry).
   */
  private rainOnFire(sim: Simulation, l: PlacedLight, now: number): void {
    const f = l.fire;
    if (f === null || (!f.lit && f.embers === 0) || !this.rainsOnFire(sim, l)) return;
    const active = this.env.active(sim, l.layer, l.tx >> CHUNK_SHIFT, l.ty >> CHUNK_SHIFT);
    if (!active) this.advancePlaced(null, l, now, false);
    if (!f.lit && f.embers === 0) return;
    const wasLit = f.lit;
    f.lit = false;
    f.embers = 0;
    this.touch();
    if (!active) return;
    if (wasLit) this.placedEvent(sim, 'lightExtinguished', l, 'regen');
    else sim.events.push('fireCooled', { light: l.id, layer: l.layer, x: this.groundX(l, lightKind(l.kind)), y: this.groundY(l, lightKind(l.kind)), tick: sim.eventTick });
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
    } else if (this.isLumen(c)) {
      // The Lumen lantern (M7-36): an empty one loads a shard from the bags first; water does not reach it.
      if (c.burn.rest <= 0 && !this.chargeLumen(sim, c)) return this.reject(sim, type, 'noLumen', tick);
      c.burn.lit = true;
      c.burn.at = sim.tick;
      c.burn.rain = 'trocken';
      this.carriedEvent(sim, 'lightIgnited', c, null);
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
    // Lamps and the fireplace are furniture: they go onto the build grid (build mode, `build.place`).
    if (kind.moebel !== undefined) return this.reject(sim, cmd.type, 'onGrid', tick);
    // The Lumen lantern is carried only (M7-36).
    if (kind.verhalten === 'lumen') return this.reject(sim, cmd.type, 'notPlaceable', tick);
    const layer = body.layer;
    if (!tileInReach(this.position.x, this.position.y, cmd.tx, cmd.ty, L.placement.reachTiles)) return this.reject(sim, cmd.type, 'outOfReach', tick);
    if (this.byTile.has(tileKey(layer, cmd.tx, cmd.ty)) || this.occupied(sim, layer, cmd.tx, cmd.ty)) return this.reject(sim, cmd.type, 'tileTaken', tick);
    if (!this.placeable(layer, cmd.tx, cmd.ty)) return this.reject(sim, cmd.type, 'tileBlocked', tick);
    // A camp fire stands in the way: not onto the player's own body.
    if (kind.verhalten === 'feuer' && this.bodyOnTile(cmd.tx, cmd.ty)) return this.reject(sim, cmd.type, 'standingThere', tick);
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
    const kind = lightKind(l.kind);
    if (kind.verhalten === 'lampe') return this.fuelLamp(sim, cmd, l, kind, tick);
    const fire = l.fire;
    if (fire === null) return this.reject(sim, cmd.type, 'notAFire', tick);
    const bags = this.inventory.state;
    if (!isValidRef(bags, cmd.from)) return this.reject(sim, cmd.type, 'invalidSlot', tick);
    const stack = slotAt(bags, cmd.from);
    if (stack === null) return this.reject(sim, cmd.type, 'slotEmpty', tick);
    const seconds = this.inventory.bags.catalog.get(stack.item).brennwert;
    if (seconds === undefined) return this.reject(sim, cmd.type, 'notFuel', tick);
    const per = fuelTicks(seconds);
    const n = fuelItemsThatFit(fire.fuel, per, Math.min(cmd.count ?? stack.count, stack.count), fireMaxFuelTicks(kind));
    if (n < 1) return this.reject(sim, cmd.type, 'fireFull', tick);
    const consumed = discard(bags, this.inventory.bags.catalog, cmd.from, n);
    if (!consumed.ok) return this.reject(sim, cmd.type, consumed.reason, tick);
    this.replaceBags(sim, consumed.state, cmd.from);
    fire.fuel += n * per;
    sim.events.push('fireFueled', { light: l.id, item: stack.item, count: n, fuelSeconds: fire.fuel / TICK_HZ, x: this.groundX(l, kind), y: this.groundY(l, kind), layer: l.layer, tick });
    if (!fire.lit && fire.embers > 0) {
      // Embers rekindle the fresh fuel (§12.2: a fire kept alive needs no new light).
      fire.lit = true;
      fire.embers = 0;
      this.placedEvent(sim, 'lightIgnited', l, null);
    }
    this.touch();
  }

  /** `light.fuel` on a lamp: whole pieces of its own fuel, as many as its stock still takes. */
  private fuelLamp(sim: Simulation, cmd: CommandOfType<'light.fuel'>, l: PlacedLight, kind: LightKind, tick: number): void {
    const torch = l.torch;
    if (torch === null) return this.reject(sim, cmd.type, 'notAFire', tick);
    const bags = this.inventory.state;
    if (!isValidRef(bags, cmd.from)) return this.reject(sim, cmd.type, 'invalidSlot', tick);
    const stack = slotAt(bags, cmd.from);
    if (stack === null) return this.reject(sim, cmd.type, 'slotEmpty', tick);
    if (stack.item !== kind.moebel?.brennstoff) return this.reject(sim, cmd.type, 'wrongFuel', tick);
    const per = this.lampPieceTicks(kind);
    const n = fuelItemsThatFit(torch.rest, per, Math.min(cmd.count ?? stack.count, stack.count), this.lampMaxTicks(kind));
    if (n < 1) return this.reject(sim, cmd.type, 'lampFull', tick);
    const consumed = discard(bags, this.inventory.bags.catalog, cmd.from, n);
    if (!consumed.ok) return this.reject(sim, cmd.type, consumed.reason, tick);
    this.replaceBags(sim, consumed.state, cmd.from);
    torch.rest += n * per;
    sim.events.push('fireFueled', { light: l.id, item: stack.item, count: n, fuelSeconds: torch.rest / TICK_HZ, x: this.groundX(l, kind), y: this.groundY(l, kind), layer: l.layer, tick });
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
        // An empty lamp has nothing to burn (a torch always has: burned down, it is gone).
        if (l.torch.rest <= 0) return this.reject(sim, cmd.type, 'noFuel', tick);
        l.torch.lit = true;
        l.torch.at = sim.tick;
        l.torch.rain = this.torchRain(sim, l);
      } else if (l.fire !== null) {
        if (l.fire.lit) return this.reject(sim, cmd.type, 'burning', tick);
        if (l.fire.fuel <= 0) return this.reject(sim, cmd.type, 'noFuel', tick);
        if (this.rainsOnFire(sim, l)) return this.reject(sim, cmd.type, 'raining', tick);
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

  /**
   * Puts out every burning torch and lantern within `radiusPx` of (x, y) on `layer` (§12.4 "Der Lichtfresser löscht Fackeln
   * und Laternen im Umkreis von 4 Tiles", M6-26): the carried torch when the player stands in the circle, placed torches
   * and lamps whose tile centre lies in it (`lightExtinguished` with `reason`); fires, hearths and glowing arrows keep
   * burning. They light again like any light put out. Returns how many went out.
   */
  putOutNear(sim: Simulation, layer: Layer, x: number, y: number, radiusPx: number, reason: LightOutReason): number {
    const r2 = radiusPx * radiusPx;
    let n = 0;
    this.syncCarried(sim);
    const c = this.stateValue.carried;
    const body = this.player.body(sim);
    // A Lumen lantern has no flame to put out: the light eater drains its charge instead (`drainLumenNear`, M7-36).
    if (c !== null && c.burn.lit && !this.isLumen(c) && body !== undefined && body.layer === layer && this.player.position(sim, this.position)) {
      const dx = this.position.x - x;
      const dy = this.position.y - y;
      if (dx * dx + dy * dy <= r2) {
        c.burn.lit = false;
        this.carriedEvent(sim, 'lightExtinguished', c, reason);
        this.carriedChanged(sim);
        n++;
      }
    }
    const placed = this.stateValue.placed;
    for (let i = 0; i < placed.length; i++) {
      const l = placed[i] as PlacedLight;
      const t = l.torch;
      if (l.layer !== layer || t === null || !t.lit) continue;
      const dx = centre(l.tx) - x;
      const dy = centre(l.ty) - y;
      if (dx * dx + dy * dy > r2) continue;
      t.lit = false;
      this.placedEvent(sim, 'lightExtinguished', l, reason);
      this.touch();
      n++;
    }
    return n;
  }

  /**
   * The light eater drains Lumen charges (§12.4 "saugt Lumen-Ladungen ab", M7-36): the carried Lumen lantern of a player
   * standing within `radiusPx` of (x, y) on `layer` loses `charges` charges (a shard's worth each); drained empty it goes dark
   * (`lightExtinguished`, reason `lichtfresser`) and stays dark until F loads a new shard. Returns how many lanterns it reached.
   */
  drainLumenNear(sim: Simulation, layer: Layer, x: number, y: number, radiusPx: number, charges: number): number {
    if (charges <= 0) return 0;
    this.syncCarried(sim);
    const c = this.stateValue.carried;
    const body = this.player.body(sim);
    if (c === null || !this.isLumen(c) || body === undefined || body.layer !== layer || !this.player.position(sim, this.position)) return 0;
    const dx = this.position.x - x;
    const dy = this.position.y - y;
    if (dx * dx + dy * dy > radiusPx * radiusPx) return 0;
    this.burnCarried(sim, sim.tick);
    const b = c.burn;
    b.rest = Math.max(0, b.rest - charges * this.fullLumen);
    if (b.rest <= 0 && b.lit) {
      b.lit = false;
      this.carriedEvent(sim, 'lightExtinguished', c, 'lichtfresser');
    }
    this.carriedChanged(sim);
    return 1;
  }

  /** Binds the Lumen lantern's aura on the creatures (src/game/light/lumen.ts `creatureLumenAura`, src/game/setup.ts). */
  useLumenAura(aura: LumenAura): void {
    this.lumenAura = aura;
  }

  /** A full charge of the carried light [ticks]: a torch's burn time, a Lumen lantern's shard. */
  carriedFullTicks(): number {
    const c = this.stateValue.carried;
    return c === null ? this.fullTorch : this.fullOf(c.kind);
  }

  /** Whether the carried light is a Lumen light. */
  private isLumen(c: Readonly<CarriedLight>): boolean {
    return lightKind(c.kind).verhalten === 'lumen';
  }

  /** Full burn time of a light kind [ticks]: one Lumen shard for a Lumen light, else a fresh torch. */
  private fullOf(kind: string): number {
    return lightKind(kind).verhalten === 'lumen' ? this.fullLumen : this.fullTorch;
  }

  /** Loads one Lumen shard from the bags into the carried lantern (a full charge); false without a shard. */
  private chargeLumen(sim: Simulation, c: CarriedLight): boolean {
    const shard = L.lumen.shard;
    const bags = this.inventory.state;
    for (const area of SEARCH_AREAS) {
      const slots = bags[area];
      for (let index = 0; index < slots.length; index++) {
        if (slots[index]?.item !== shard) continue;
        const ref: SlotRef = { bereich: area, index };
        const consumed = discard(bags, this.inventory.bags.catalog, ref, 1);
        if (!consumed.ok) return false;
        this.replaceBags(sim, consumed.state, ref);
        c.burn.rest = this.fullLumen;
        sim.events.push('lumenCharged', { item: c.item, charges: 1, tick: sim.eventTick });
        this.touch();
        return true;
      }
    }
    return false;
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
    // Fires stay where they burn; a lamp is furniture – it comes down with its part in build mode.
    if (torch === null || isFurniture(l)) return this.reject(sim, cmd.type, 'notTakeable', tick);
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
    if (l.layer !== body.layer || !this.inReach(l, BALANCE.interaction.reachTiles)) {
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
      burn: { lit: false, rest: start ?? this.fullOf(found.kind.id), at: sim.tick, rain: 'trocken', heavyTicks: 0 },
    };
    this.touch();
  }

  /** The torch left the hand: its remaining time goes into its stack wherever it went; a lit one goes out. */
  private release(sim: Simulation, c: CarriedLight): void {
    const bags = this.inventory.state;
    const at = this.findStack(bags, c);
    if (at !== null) {
      const stack = slotAt(bags, at) as ItemStack;
      this.inventory.bags.replace(withSlot(bags, at, withBurnRest(stack, c.burn.rest, this.fullOf(c.kind))));
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
    if (this.isLumen(c)) {
      // No flame (M7-36): rain and water leave it; run dry, it loads the next shard from the bags or goes dark – never used up.
      b.rain = 'trocken';
      const out = advanceTorch(b, to, this.roll);
      if (out === null) return;
      if (this.chargeLumen(sim, c)) {
        b.lit = true;
        return;
      }
      this.carriedEvent(sim, 'lightExtinguished', c, out.reason);
      this.carriedChanged(sim);
      return;
    }
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
      // A torch burned down leaves the world; a lamp stays empty on its part.
      if (end.reason === 'abgebrannt' && !isFurniture(l)) {
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
    this.index(l);
    this.collides(l);
  }

  private remove(l: PlacedLight): void {
    const i = this.stateValue.placed.indexOf(l);
    if (i >= 0) this.stateValue.placed.splice(i, 1);
    const w = l.groesse?.b ?? 1;
    const h = l.groesse?.t ?? 1;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.byTile.delete(tileKey(l.layer, l.tx + dx, l.ty + dy));
    this.map.occlusion.forget(l.id);
    this.collides(l);
  }

  /** Enters every tile of `l`'s footprint into the tile index. */
  private index(l: PlacedLight): void {
    const w = l.groesse?.b ?? 1;
    const h = l.groesse?.t ?? 1;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.byTile.set(tileKey(l.layer, l.tx + dx, l.ty + dy), l);
  }

  /** A camp fire came or went: its tile collides differently (the collision grid and its listeners hear it). */
  private collides(l: PlacedLight): void {
    if (l.fire !== null && !isFurniture(l)) this.collision.invalidateTile(l.layer, l.tx, l.ty);
  }

  /** Whether another system placed something on the tile (build parts). */
  private occupied(sim: Simulation, layer: Layer, tx: number, ty: number): boolean {
    for (let i = 0; i < this.occupancy.length; i++) if ((this.occupancy[i] as LightOccupancy)(sim, layer, tx, ty)) return true;
    return false;
  }

  /** Whether a tile of `l`'s footprint lies within `reachTiles` of the player (at `this.position`). */
  private inReach(l: Readonly<PlacedLight>, reachTiles: number): boolean {
    for (let dy = 0; dy < (l.groesse?.t ?? 1); dy++) for (let dx = 0; dx < (l.groesse?.b ?? 1); dx++) if (tileInReach(this.position.x, this.position.y, l.tx + dx, l.ty + dy, reachTiles)) return true;
    return false;
  }

  /** Whether the player's body (at `this.position`) overlaps tile (tx, ty). */
  private bodyOnTile(tx: number, ty: number): boolean {
    const nx = Math.max(tx * TILE_PX, Math.min(this.position.x, (tx + 1) * TILE_PX));
    const ny = Math.max(ty * TILE_PX, Math.min(this.position.y, (ty + 1) * TILE_PX));
    return Math.hypot(this.position.x - nx, this.position.y - ny) < BODY_RADIUS_PX;
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

  /** Rain class over a placed torch or lamp: a lantern behind glass stays dry (§12.2 "wetterfest"), an open flame gets the rain of its tile. */
  private torchRain(sim: Simulation, l: PlacedLight): TorchBurn['rain'] {
    return lightKind(l.kind).moebel?.wetterfest === true ? 'trocken' : this.rainAt(sim, l.layer, l.tx, l.ty);
  }

  /** Ground point of a placed light [world px], x: a furniture light at the middle of its footprint's front edge (where its sprite stands), the others at their tile's centre. */
  private groundX(l: Readonly<PlacedLight>, kind: LightKind): number {
    return kind.moebel === undefined || l.mount === 'wand' ? centre(l.tx) : (l.tx + (l.groesse?.b ?? 1) / 2) * TILE_PX;
  }

  /** Ground point y [world px]: a wall light just in front of its wall's face, a furniture light on its footprint's front row, the others at the tile's centre. */
  private groundY(l: Readonly<PlacedLight>, kind: LightKind): number {
    if (l.mount === 'wand') return l.ty * TILE_PX + WALL_LIGHT_INSET_PX;
    return kind.moebel === undefined ? centre(l.ty) : (l.ty + (l.groesse?.t ?? 1)) * TILE_PX - 1;
  }

  /** Height of a furniture light's flame above its ground point [px]: its socket, for a wall lamp plus the wall face and the height it hangs at. */
  private furnitureFlameHeight(l: Readonly<PlacedLight>, kind: LightKind): number {
    const flame = kind.moebel?.flammeHoehePx ?? 0;
    return l.mount === 'wand' ? WALL_FACE_ABOVE_PX + (MOEBEL_WANDHOEHE_PX[kind.id] ?? 0) + flame : flame;
  }

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

  /** Rebuilds the source list and the heat sources for this tick and the active set `zone`. */
  private rebuild(sim: Simulation, zone: number): void {
    this.dirty = false;
    this.builtTick = sim.tick;
    this.builtZone = zone;
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
      if (kind.verhalten === 'lumen') {
        // The Lumen lantern (M7-36): its own reach, a cold steady glow; on the belt like a torch −40 %.
        const belt = c.mode === 'guertel' ? L.offhand.beltRadiusFactor : 1;
        this.fill(r, CARRIED_LIGHT_ID, kind, body.layer, this.position.x + this.offset.dx, this.position.y + this.offset.dy, L.lumen.heightPx, L.lumen.radiusTiles * TILE_PX * belt, L.lumen.intensity, L.lumen.flicker, c.mode, c.burn.rest / TICK_HZ);
        r.windowTiles = L.lumen.radiusTiles;
      } else {
        this.fill(r, CARRIED_LIGHT_ID, kind, body.layer, this.position.x + this.offset.dx, this.position.y + this.offset.dy, L.torch.flameHeightPx.hand, carriedRadiusPx(c.mode), L.torch.intensity, L.torch.flicker, c.mode, c.burn.rest / TICK_HZ);
        r.windowTiles = L.torch.radiusTiles;
      }
      this.list.push(r);
    }
    const placed = this.stateValue.placed;
    let h = 0;
    for (let i = 0; i < placed.length; i++) {
      const l = placed[i] as PlacedLight;
      if (!this.env.active(sim, l.layer, l.tx >> CHUNK_SHIFT, l.ty >> CHUNK_SHIFT)) continue;
      const kind = lightKind(l.kind);
      const m = kind.moebel;
      if (l.torch !== null && m !== undefined) {
        // A lamp (§12.2 "Kerzen, Wandlampen …"): its own radius, brightness and flicker.
        if (!l.torch.lit) continue;
        const r = this.record(n++);
        this.fill(r, l.id, kind, l.layer, this.groundX(l, kind), this.groundY(l, kind), this.furnitureFlameHeight(l, kind), m.radius * TILE_PX, m.intensitaet, m.flackern, l.mount, l.torch.rest / TICK_HZ);
        r.windowTiles = Math.ceil(m.radius);
        this.list.push(r);
        continue;
      }
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
      const params = fireLightOf(kind, fireClip(f));
      if (params === null) continue;
      const r = this.record(n++);
      const gx = this.groundX(l, kind);
      const gy = this.groundY(l, kind);
      this.fill(r, l.id, kind, l.layer, gx, gy, m === undefined ? L.campfire.flameHeightPx : this.furnitureFlameHeight(l, kind), params.radiusPx, params.intensity, params.flicker, l.mount, (f.lit ? f.fuel : f.embers) / TICK_HZ);
      r.windowTiles = m === undefined ? L.campfire.radiusTiles : Math.ceil(m.radius);
      this.list.push(r);
      if (!f.lit) continue;
      let heat = this.heatRecords[h];
      if (heat === undefined) {
        heat = new HeatRecord();
        this.heatRecords.push(heat);
      }
      h++;
      heat.x = gx;
      heat.y = gy;
      heat.layer = l.layer;
      // §11.2 "Feuer +15 °C im Kern"; a fireplace names its own heat (§16.4 "Heizquellen (Kamin …)").
      heat.coreHeatC = m?.waermeC ?? FIRE_HEAT.coreHeatC;
      this.heatList.push(heat);
    }
    this.extraCount = n;
    for (let k = 0; k < this.extraProviders.length; k++) (this.extraProviders[k] as ExtraLightProvider)(sim, this.emitExtra);
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
    const tiles = new Set<number>();
    for (const l of next.placed) {
      const kind = lightKind(l.kind);
      if ((kind.verhalten === 'feuer') !== (l.fire !== null)) throw new TypeError(`light snapshot invalid: light ${l.id} ("${l.kind}") ${l.fire === null ? 'needs' : 'has'} a fire`);
      if (l.groesse !== undefined && kind.moebel === undefined) throw new TypeError(`light snapshot invalid: light ${l.id} ("${l.kind}") is no furniture and covers one tile`);
      for (let dy = 0; dy < (l.groesse?.t ?? 1); dy++) {
        for (let dx = 0; dx < (l.groesse?.b ?? 1); dx++) {
          const key = tileKey(l.layer as Layer, l.tx + dx, l.ty + dy);
          if (tiles.has(key)) throw new TypeError(`light snapshot invalid: two lights on tile ${l.layer}:${l.tx + dx}:${l.ty + dy}`);
          tiles.add(key);
        }
      }
    }
    // The camp fires of the old state and of the new one collide differently now.
    for (const l of this.stateValue.placed) this.collides(l);
    this.byTile.clear();
    for (const l of next.placed) this.index(l);
    this.stateValue = next;
    for (const l of next.placed) this.collides(l);
    this.map.occlusion.invalidateAll();
    this.touch();
  }
}
