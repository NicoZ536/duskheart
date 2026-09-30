/**
 * Projectiles in flight (docs/SPIEL.md §10 "Projektile (M6-07, M6-08)"; MASTERPROMPT §3.3 "Swept-Tests für schnelle
 * Projektile", §19.2): ECS entities with the column store `projectile` (src/game/combat/state.ts), owned by the combat
 * system.
 *
 * - **Launch** (`fire`): from the shooter's feet along the aim, turned by a random spread (stream `combat`; aiming with
 *   the block button narrows it); a flat shot flies at its speed (a bow's × its tension) until it hit something or its
 *   range ran out, an arc (a bursting throwable, §19.2 "Wurfbogen") flies exactly to its landing point with a parabola
 *   of height (`z`).
 * - **Every tick**: the wind of the weather pushes it (`CombatEnvironment.wind`, the fire's wind direction and the
 *   region's wind strength); the step is swept against the tiles (`sweepCircle`, `PROJECTILE_RULES`, its flight level)
 *   and – for flat shots – against the bodies of every provider hostile to its owner on its level (`BodyGrid.sweep`,
 *   built each tick from the bodies near the step; rolling bodies are passed through). The earlier contact wins.
 * - **A body hit** resolves through `CombatSystem.resolve` (kind `fernkampf`, cause `projektil` on the player); the
 *   arrow stays in the body (`projectileStuck` `ziel`).
 * - **At rest** (`projectileStuck`): in a wall or on the ground; in deep water it sinks (no drop – the presentation
 *   ripples the water). Spent arrows, bolts and stones can be picked up with `recoverChance`; a thrown spear or knife
 *   always lands as its item (with its durability). A glowing arrow (`munition.licht`) lights up where it stuck – or
 *   follows the body it stuck in – for its seconds (`lightProvider`).
 * - **A burst** (thrown weapons with a radius): every hostile body in the radius is hit (no block), with the throwable's
 *   condition; the fire flask sets every flammable tile in it alight (`FireSystem.ignite`).
 * - **Creature shots** (M6-15b, `addShot`): what a creature's ranged attack throws is no item but a shot `geschoss_<name>`
 *   (its sprite); it flies and hits like an arrow with the condition registered for it, and leaves nothing where it stops.
 */
import { BALANCE } from '../../content/balance';
import type { ThrowEffect } from '../../content/balance/combat';
import type { HitCondition } from '../../content/schema/item';
import type { WeaponClass } from '../../content/balance/tools';
import { NULL_ENTITY, type Entity } from '../../engine/ecs';
import { normalizeSeed } from '../../engine/rng';
import { BodyGrid, createBodyHit } from '../../world/collision/bodies';
import { createSweepHit, sweepCircle } from '../../world/collision/sweep';
import { BLOCK_DEEP_WATER, PROJECTILE_RULES } from '../../world/collision/tiles';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import { createWeatherSample } from '../../world/climate/weather';
import { TILE_PX, type Layer } from '../../world/model/coords';
import { DIR_DX, DIR_DY, windDirection } from '../fire/formulas';
import type { FireSystem } from '../fire/system';
import type { DropSystem } from '../drops/system';
import type { InventorySystem } from '../inventory/system';
import { checkStack, newStack, type ItemStack } from '../items/stack';
import type { ExtraLightProvider } from '../light/system';
import type { Simulation } from '../sim';
import { degToRad, hostile, secondsToTicks, shotSpeedShare, throwArcHeight, throwPeakPx } from './formulas';
import { FLIGHT_ARC, FLIGHT_FLAT, createProjectileStore, type CombatState, type ProjectileStore, type SavedProjectile } from './state';
import { COMBAT_TEAMS, DAMAGE_TYPES, type CombatTargetProvider, type CombatTeam, type CombatantView, type DamageType, type HitResult } from './targets';
import type { CombatAttack } from './system';

const C = BALANCE.combat;
const TICK_HZ = BALANCE.time.tickHz;
/** ECS component name of projectiles. */
export const PROJECTILE_COMPONENT = 'projectile';
/** Random stream of the fight (the combat system's). */
const RNG_STREAM = 'combat';
/** Bits below the glowing arrows' light ids: placed lights count from 1, hearths from 2^20, stations from 2^22, burning tiles from 2^24. */
const GLOW_ID_BITS = 21;
/** Light ids of glowing arrows start at 2^21. */
export const GLOW_LIGHT_ID_BASE = 1 << GLOW_ID_BITS;
/** Light kind of a glowing arrow in the light source list (the renderer reads colour and radius). */
export const GLOW_LIGHT_KIND = 'leuchtpfeil';
const MAX_FLIGHT_TICKS = secondsToTicks(C.projectile.maxFlightSeconds, 1);
const RADIUS = C.projectile.radiusPx;
/** Tangent of each ranged class's spread (a perpendicular offset: no trigonometry per shot). */
const SPREAD_TAN: Readonly<Record<string, number>> = Object.fromEntries(Object.entries(C.ranged.spreadDeg).map(([k, deg]) => [k, Math.tan(degToRad(deg))]));

/** The wind that pushes projectiles. */
export interface CombatEnvironment {
  /** Acceleration of the wind at (x, y) on `layer` [px/s²] into `out` (0 underground and at sea). */
  wind(sim: Simulation, layer: Layer, x: number, y: number, out: { x: number; y: number }): void;
}

/** The wind of the simulation's world: the direction of the fire's wind (`windDirection`), the region's wind strength. */
export function worldCombatEnvironment(): CombatEnvironment {
  const sample = createWeatherSample();
  return {
    wind: (sim, layer, x, y, out) => {
      out.x = 0;
      out.y = 0;
      if (layer !== 0) return;
      const world = sim.world;
      const region = world.regionAt(Math.floor(x / TILE_PX), Math.floor(y / TILE_PX));
      if (region === NO_WEATHER_REGION) return;
      const weather = world.weather;
      const strength = weather.sample(region, sample).wind;
      if (!(strength > 0)) return;
      const dir = windDirection(normalizeSeed(sim.config.seed), region, weather.periodCount(region));
      const dx = DIR_DX[dir] as number;
      const dy = DIR_DY[dir] as number;
      const len = Math.sqrt(dx * dx + dy * dy);
      out.x = (dx / len) * strength * C.projectile.windAccelPxPerSecond2;
      out.y = (dy / len) * strength * C.projectile.windAccelPxPerSecond2;
    },
  };
}

/** A shot or throw about to leave (a held record of the flight, filled by the combat system). */
export interface ProjectileLaunch {
  owner: Entity;
  team: CombatTeam;
  klasse: WeaponClass;
  /** What flies (arrow, bolt, stone, spear, knife, flask …). */
  item: string;
  layer: Layer;
  level: number;
  /** Start [world px] and aim direction (unit). */
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  /** Tension 0–1 (bows and slings shoot slower and weaker half drawn). */
  tension: number;
  /** Speed at full tension [px/s]. */
  speed: number;
  /** Range [px]: a flat shot's farthest, an arc's landing distance. */
  range: number;
  damage: number;
  art: DamageType;
  wucht: number;
  staggerSeconds: number;
  /** Flies an arc and bursts where it lands. */
  arc: boolean;
  /** The shooter aims (block button with a ranged weapon): narrower spread. */
  aiming: boolean;
  /** The piece that lands again where it stops (spear, throwing knife), or `null`. */
  carried: ItemStack | null;
}

/** What the flight needs of the combat system. */
export interface FlightHost {
  readonly providers: readonly CombatTargetProvider[];
  resolve(sim: Simulation, attacker: Entity, target: Entity, attack: Readonly<CombatAttack>): HitResult | null;
  state(): CombatState;
  view(sim: Simulation, entity: Entity, out: CombatantView): boolean;
}

/** Dependencies of the flight. */
export interface ProjectileFlightDeps {
  readonly collision: { readonly grid: Parameters<typeof sweepCircle>[0] };
  readonly inventory: Pick<InventorySystem, 'bags'>;
  readonly drops: Pick<DropSystem, 'spawn'> | null;
  readonly fire: Pick<FireSystem, 'ignite'> | null;
  readonly environment: CombatEnvironment;
  readonly host: FlightHost;
}

export class ProjectileFlight {
  readonly store: ProjectileStore;
  /** The launch record the combat system fills before `fire`. */
  readonly launch: ProjectileLaunch;
  private readonly deps: ProjectileFlightDeps;
  /** Ids of the `item` column: the catalogue's items, then the creature shots (`addShot`). */
  private readonly ids: string[];
  private readonly index = new Map<string, number>();
  /** Creature shots and the condition their hit may cause. */
  private readonly shots = new Map<string, HitCondition | null>();
  private readonly bodies = new BodyGrid();
  private readonly tileHit = createSweepHit();
  private readonly bodyHit = createBodyHit();
  private readonly wind = { x: 0, y: 0 };
  private readonly found: Entity[] = [];
  private readonly view: CombatantView;
  private readonly attack: CombatAttack;

  constructor(sim: Simulation, deps: ProjectileFlightDeps) {
    this.deps = deps;
    this.store = sim.ecs.registerComponent(PROJECTILE_COMPONENT, createProjectileStore());
    this.ids = [...deps.inventory.bags.catalog.ids()];
    this.ids.forEach((id, i) => this.index.set(id, i));
    this.launch = {
      owner: NULL_ENTITY,
      team: 'spieler',
      klasse: 'bogen',
      item: '',
      layer: 0,
      level: 0,
      x: 0,
      y: 0,
      dirX: 1,
      dirY: 0,
      tension: 1,
      speed: 0,
      range: 0,
      damage: 0,
      art: 'stich',
      wucht: 1,
      staggerSeconds: 0,
      arc: false,
      aiming: false,
      carried: null,
    };
    this.view = {
      entity: NULL_ENTITY,
      team: 'feind',
      layer: 0,
      level: 0,
      x: 0,
      y: 0,
      radius: 0,
      facing: 0,
      health: 0,
      maxHealth: 0,
      armor: 0,
      resist: { hieb: 0, stich: 0, wucht: 0, feuer: 0, frost: 0, gift: 0, licht: 0, schatten: 0 },
      invulnerable: false,
      blockSinceTick: -1,
      blockPower: 0,
    };
    this.attack = {
      team: 'spieler',
      damage: 0,
      type: 'stich',
      wucht: 1,
      staggerSeconds: 0,
      critChance: C.damage.critChance,
      condition: null,
      armorBreak: 0,
      armorBreakSeconds: 0,
      backstab: 1,
      blockable: true,
      kind: 'fernkampf',
      projectile: true,
      fromX: 0,
      fromY: 0,
    };
  }

  /**
   * Registers a creature shot (M6-15b): a projectile that is no item – the sprite `geschoss_<name>` of a creature's ranged
   * attack – with the condition its hit may cause. Registering the same shot again with the same condition changes nothing.
   */
  addShot(id: string, condition: HitCondition | null): void {
    const known = this.shots.get(id);
    if (known !== undefined) {
      if (JSON.stringify(known) !== JSON.stringify(condition)) throw new Error(`ProjectileFlight: shot "${id}" registered with two conditions`);
      return;
    }
    if (this.index.has(id)) throw new Error(`ProjectileFlight: shot "${id}" is an item`);
    this.index.set(id, this.ids.length);
    this.ids.push(id);
    this.shots.set(id, condition);
  }

  /** Whether `id` is a registered creature shot. */
  isShot(id: string): boolean {
    return this.shots.has(id);
  }

  /** Item (or creature shot) id of the projectile in row `row`. */
  itemAt(row: number): string {
    return this.ids[this.store.columns.item[row] as number] as string;
  }

  /** Launches `launch` in tick `tick`; returns the projectile entity. */
  fire(sim: Simulation, launch: ProjectileLaunch, tick: number): Entity {
    const rng = sim.rng.stream(RNG_STREAM);
    const spreadTan = (SPREAD_TAN[launch.klasse] ?? SPREAD_TAN['wurf'] ?? 0) * (launch.aiming ? C.aimMode.spreadFactor : 1);
    const u = (rng.next() * 2 - 1) * spreadTan;
    let dx = launch.dirX - launch.dirY * u;
    let dy = launch.dirY + launch.dirX * u;
    const len = Math.sqrt(dx * dx + dy * dy);
    dx /= len;
    dy /= len;
    let speed: number;
    let total: number;
    let peak = 0;
    if (launch.arc) {
      speed = launch.speed;
      total = Math.max(1, Math.round((launch.range / speed) * TICK_HZ));
      speed = (launch.range * TICK_HZ) / total;
      peak = throwPeakPx(launch.range);
    } else {
      speed = launch.speed * (launch.tension < 1 ? shotSpeedShare(launch.tension) : 1);
      total = Math.min(MAX_FLIGHT_TICKS, Math.max(1, Math.ceil((launch.range / speed) * TICK_HZ)));
    }
    const e = sim.ecs.create();
    const s = this.store;
    const row = s.add(e);
    const c = s.columns;
    c.x[row] = launch.x;
    c.y[row] = launch.y;
    c.vx[row] = dx * speed;
    c.vy[row] = dy * speed;
    c.z[row] = launch.arc ? 0 : C.projectile.flightHeightPx;
    c.ticks[row] = 0;
    c.total[row] = total;
    c.peak[row] = peak;
    c.owner[row] = launch.owner;
    c.item[row] = this.itemIndex(launch.item);
    c.layer[row] = launch.layer;
    c.level[row] = launch.level;
    c.damage[row] = launch.damage;
    c.art[row] = DAMAGE_TYPES.indexOf(launch.art);
    c.wucht[row] = launch.wucht;
    c.stagger[row] = launch.staggerSeconds;
    c.tension[row] = launch.tension;
    c.team[row] = COMBAT_TEAMS.indexOf(launch.team);
    c.flight[row] = launch.arc ? FLIGHT_ARC : FLIGHT_FLAT;
    if (launch.carried !== null) this.deps.host.state().carried.set(e, launch.carried);
    sim.events.push('entitySpawned', { entity: e, tick });
    sim.events.push('projectileFired', { entity: e, owner: launch.owner, item: launch.item, klasse: launch.klasse, layer: launch.layer, x: launch.x, y: launch.y, vx: dx * speed, vy: dy * speed, tension: launch.tension, tick });
    return e;
  }

  /** One tick of every projectile in flight (rows backwards: a projectile at rest leaves its row). */
  update(sim: Simulation): void {
    const s = this.store;
    if (s.size === 0) return;
    const c = s.columns;
    const dt = sim.dt;
    const grid = this.deps.collision.grid;
    for (let row = s.size - 1; row >= 0; row--) {
      const e = s.entityAt(row);
      const layer = c.layer[row] as Layer;
      const level = c.level[row] as number;
      const x0 = c.x[row] as number;
      const y0 = c.y[row] as number;
      this.deps.environment.wind(sim, layer, x0, y0, this.wind);
      const vx = (c.vx[row] as number) + this.wind.x * dt;
      const vy = (c.vy[row] as number) + this.wind.y * dt;
      c.vx[row] = vx;
      c.vy[row] = vy;
      const x1 = x0 + vx * dt;
      const y1 = y0 + vy * dt;
      const ticks = (c.ticks[row] as number) + 1;
      const total = c.total[row] as number;
      c.ticks[row] = ticks;
      const arc = c.flight[row] === FLIGHT_ARC;
      const tile = sweepCircle(grid, layer, x0, y0, x1, y1, RADIUS, PROJECTILE_RULES, level, this.tileHit);
      const body = !arc && this.sweepBodies(sim, row, x0, y0, x1, y1);
      if (body && (!tile.hit || this.bodyHit.t <= tile.t)) {
        this.hitBody(sim, row, e, this.bodyHit.id, this.bodyHit.x, this.bodyHit.y, x0, y0);
        continue;
      }
      if (tile.hit) {
        if (arc) this.burst(sim, row, e, tile.x, tile.y);
        else this.rest(sim, row, e, tile.x, tile.y, 'wand', NULL_ENTITY);
        continue;
      }
      c.x[row] = x1;
      c.y[row] = y1;
      if (arc) c.z[row] = throwArcHeight(ticks / total, c.peak[row] as number);
      if (ticks < total) continue;
      if (arc) this.burst(sim, row, e, x1, y1);
      else this.rest(sim, row, e, x1, y1, this.deepWater(layer, x1, y1) ? 'wasser' : 'boden', NULL_ENTITY);
    }
  }

  /** Whether tile under (x, y) is deep water. */
  private deepWater(layer: Layer, x: number, y: number): boolean {
    return (this.deps.collision.grid.tileInfo(layer, Math.floor(x / TILE_PX), Math.floor(y / TILE_PX)) & BLOCK_DEEP_WATER) !== 0;
  }

  /** Sweeps the step against the bodies hostile to the projectile's owner on its layer and level; the hit in `bodyHit`. */
  private sweepBodies(sim: Simulation, row: number, x0: number, y0: number, x1: number, y1: number): boolean {
    const c = this.store.columns;
    const layer = c.layer[row] as Layer;
    const level = c.level[row] as number;
    const owner = c.owner[row] as number;
    const team = COMBAT_TEAMS[c.team[row] as number] ?? 'feind';
    const grid = this.bodies;
    grid.clear();
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const half = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)) / 2 + RADIUS;
    const found = this.found;
    const v = this.view;
    const providers = this.deps.host.providers;
    for (let k = 0; k < providers.length; k++) {
      const provider = providers[k] as CombatTargetProvider;
      found.length = 0;
      provider.queryCircle(sim, layer, mx, my, half, found);
      for (let i = 0; i < found.length; i++) {
        const e = found[i] as Entity;
        if (e === owner || !provider.view(sim, e, v)) continue;
        if (v.layer !== layer || v.level !== level || v.health <= 0 || v.invulnerable || !hostile(team, v.team)) continue;
        grid.add(e, layer, v.x, v.y, v.radius);
      }
    }
    if (grid.size === 0) return false;
    grid.build();
    return grid.sweep(layer, x0, y0, x1, y1, RADIUS, this.bodyHit).hit;
  }

  /** The projectile of `row` hits body `target` at (x, y), coming from (fromX, fromY). */
  private hitBody(sim: Simulation, row: number, e: Entity, target: Entity, x: number, y: number, fromX: number, fromY: number): void {
    const c = this.store.columns;
    const item = this.itemAt(row);
    const def = this.deps.inventory.bags.catalog.find(item);
    const a = this.attack;
    a.team = COMBAT_TEAMS[c.team[row] as number] ?? 'feind';
    a.damage = c.damage[row] as number;
    a.type = DAMAGE_TYPES[c.art[row] as number] ?? 'stich';
    a.wucht = c.wucht[row] as number;
    a.staggerSeconds = c.stagger[row] as number;
    a.critChance = C.damage.critChance;
    a.condition = def === undefined ? (this.shots.get(item) ?? null) : (def.munition?.zustand ?? def.waffe?.zustand ?? null);
    a.armorBreak = 0;
    a.armorBreakSeconds = 0;
    a.backstab = 1;
    a.blockable = true;
    a.kind = 'fernkampf';
    a.projectile = true;
    a.fromX = fromX;
    a.fromY = fromY;
    const owner = c.owner[row] as number;
    const layer = c.layer[row] as Layer;
    sim.events.push('projectileHit', { entity: e, owner, item, target, wirkung: def?.waffe?.wurf?.wirkung ?? null, radius: 0, layer, x, y, tick: sim.eventTick });
    this.deps.host.resolve(sim, owner, target, a);
    this.rest(sim, row, e, x, y, 'ziel', target);
  }

  /** A bursting throwable lands at (x, y): every hostile body in its radius is hit; the fire flask sets the ground alight. */
  private burst(sim: Simulation, row: number, e: Entity, x: number, y: number): void {
    const c = this.store.columns;
    const item = this.itemAt(row);
    const def = this.deps.inventory.bags.catalog.find(item);
    const effect: ThrowEffect = def?.waffe?.wurf?.wirkung ?? 'explosion';
    const radius = def?.waffe?.wurf?.radius ?? 0;
    const layer = c.layer[row] as Layer;
    const level = c.level[row] as number;
    const owner = c.owner[row] as number;
    const team = COMBAT_TEAMS[c.team[row] as number] ?? 'feind';
    sim.events.push('projectileHit', { entity: e, owner, item, target: NULL_ENTITY, wirkung: effect, radius, layer, x, y, tick: sim.eventTick });
    const a = this.attack;
    a.team = team;
    a.damage = c.damage[row] as number;
    a.type = DAMAGE_TYPES[c.art[row] as number] ?? 'wucht';
    a.wucht = c.wucht[row] as number;
    a.staggerSeconds = c.stagger[row] as number;
    a.critChance = C.damage.critChance;
    a.condition = def === undefined ? (this.shots.get(item) ?? null) : (def.waffe?.zustand ?? null);
    a.armorBreak = 0;
    a.armorBreakSeconds = 0;
    a.backstab = 1;
    a.blockable = false;
    a.kind = 'fernkampf';
    a.projectile = true;
    a.fromX = x;
    a.fromY = y;
    const found = this.found;
    const v = this.view;
    const providers = this.deps.host.providers;
    for (let k = 0; k < providers.length; k++) {
      const provider = providers[k] as CombatTargetProvider;
      found.length = 0;
      provider.queryCircle(sim, layer, x, y, radius, found);
      for (let i = 0; i < found.length; i++) {
        const target = found[i] as Entity;
        if (!provider.view(sim, target, v) || v.layer !== layer || v.level !== level || !hostile(team, v.team)) continue;
        this.deps.host.resolve(sim, owner, target, a);
      }
    }
    const fire = this.deps.fire;
    if (effect === 'brand' && fire !== null && !this.deepWater(layer, x, y)) {
      const t0x = Math.floor((x - radius) / TILE_PX);
      const t1x = Math.floor((x + radius) / TILE_PX);
      const t0y = Math.floor((y - radius) / TILE_PX);
      const t1y = Math.floor((y + radius) / TILE_PX);
      for (let ty = t0y; ty <= t1y; ty++) {
        for (let tx = t0x; tx <= t1x; tx++) {
          const cx = (tx + 1 / 2) * TILE_PX - x;
          const cy = (ty + 1 / 2) * TILE_PX - y;
          if (cx * cx + cy * cy <= radius * radius) fire.ignite(sim, layer, tx, ty, 'brandflasche');
        }
      }
    }
    this.remove(sim, e);
  }

  /** The projectile of `row` comes to rest at (x, y): drop, glow, event, gone. */
  private rest(sim: Simulation, row: number, e: Entity, x: number, y: number, wo: 'boden' | 'wand' | 'wasser' | 'ziel', target: Entity): void {
    const c = this.store.columns;
    const item = this.itemAt(row);
    const def = this.deps.inventory.bags.catalog.find(item);
    const layer = c.layer[row] as Layer;
    const state = this.deps.host.state();
    const carried = state.carried.get(e) ?? null;
    let drop = false;
    if (wo !== 'wasser' && this.deps.drops !== null) {
      if (carried !== null) {
        this.deps.drops.spawn(sim, carried, layer, x, y);
        drop = true;
      } else if (def?.munition !== undefined && sim.rng.stream(RNG_STREAM).next() < C.projectile.recoverChance) {
        this.deps.drops.spawn(sim, newStack(def, 1), layer, x, y);
        drop = true;
      }
    }
    const light = def?.munition?.licht;
    if (light !== undefined && wo !== 'wasser') {
      const id = GLOW_LIGHT_ID_BASE + (state.serial % GLOW_LIGHT_ID_BASE);
      state.serial++;
      state.glows.push({ id, layer, x, y, target, radiusTiles: light.radius, untilTick: sim.eventTick + secondsToTicks(light.sekunden, 1) });
    }
    sim.events.push('projectileStuck', { entity: e, item, wo, drop, layer, x, y, tick: sim.eventTick });
    this.remove(sim, e);
  }

  private remove(sim: Simulation, e: Entity): void {
    this.store.remove(e);
    this.deps.host.state().carried.delete(e);
    sim.ecs.queueDestroy(e);
  }

  /** Glows follow the body they stuck in (a body gone leaves them where it was) and go out after their time. */
  expireGlows(sim: Simulation, tick: number): void {
    const glows = this.deps.host.state().glows;
    for (let i = glows.length - 1; i >= 0; i--) {
      const g = glows[i];
      if (g === undefined) continue;
      if (g.untilTick < tick) {
        glows.splice(i, 1);
        continue;
      }
      if (g.target === NULL_ENTITY) continue;
      if (this.deps.host.view(sim, g.target, this.view) && this.view.health > 0) {
        g.x = this.view.x;
        g.y = this.view.y;
        g.layer = this.view.layer as Layer;
      } else g.target = NULL_ENTITY;
    }
  }

  /** The light of the glows (the light system's extra lights). */
  lightProvider(): ExtraLightProvider {
    const G = C.glow;
    return (sim, emit) => {
      const glows = this.deps.host.state().glows;
      for (let i = 0; i < glows.length; i++) {
        const g = glows[i];
        if (g === undefined) continue;
        emit(g.id, GLOW_LIGHT_KIND, G.farbe, g.layer, g.x, g.y, G.heightPx, g.radiusTiles * TILE_PX, G.intensity, G.flicker, Math.max(0, g.untilTick - sim.tick) / TICK_HZ, Math.ceil(g.radiusTiles));
      }
    };
  }

  private itemIndex(item: string): number {
    const i = this.index.get(item);
    if (i === undefined) throw new RangeError(`ProjectileFlight: unknown item "${item}"`);
    return i;
  }

  /** Saved projectiles in row order. */
  serialize(): SavedProjectile[] {
    const s = this.store;
    const c = s.columns;
    const carried = this.deps.host.state().carried;
    const out: SavedProjectile[] = [];
    for (let row = 0; row < s.size; row++) {
      const e = s.entityAt(row);
      const piece = carried.get(e);
      out.push({
        entity: e,
        item: this.itemAt(row),
        x: c.x[row] as number,
        y: c.y[row] as number,
        vx: c.vx[row] as number,
        vy: c.vy[row] as number,
        z: c.z[row] as number,
        ticks: c.ticks[row] as number,
        total: c.total[row] as number,
        peak: c.peak[row] as number,
        owner: c.owner[row] as number,
        layer: c.layer[row] as Layer,
        level: c.level[row] as number,
        damage: c.damage[row] as number,
        art: c.art[row] as number,
        wucht: c.wucht[row] as number,
        stagger: c.stagger[row] as number,
        tension: c.tension[row] as number,
        team: c.team[row] as number,
        flight: c.flight[row] === FLIGHT_ARC ? FLIGHT_ARC : FLIGHT_FLAT,
        carried: piece === undefined ? null : { ...piece },
      });
    }
    return out;
  }

  /** Throws `TypeError` for a saved projectile this build cannot restore (unknown item, index out of range, bad piece). */
  validate(saved: readonly SavedProjectile[]): void {
    const catalog = this.deps.inventory.bags.catalog;
    for (const p of saved) {
      if (!catalog.has(p.item) && !this.shots.has(p.item)) throw new TypeError(`combat snapshot invalid: unknown projectile item "${p.item}"`);
      if (p.art >= DAMAGE_TYPES.length || p.team >= COMBAT_TEAMS.length) throw new TypeError('combat snapshot invalid: projectile damage type or team out of range');
      if (p.carried !== null) {
        const def = catalog.find(p.carried.item);
        const problem = def === undefined ? `unknown item "${p.carried.item}"` : checkStack(def, p.carried, def.stapel);
        if (problem !== null) throw new TypeError(`combat snapshot invalid: carried piece ${problem}`);
      }
    }
  }

  /**
   * Restores saved projectiles (checked with `validate`) into the store – the ECS participant, restored before, owns their
   * entities – and their pieces into `state`.
   */
  deserialize(saved: readonly SavedProjectile[], state: CombatState): void {
    const s = this.store;
    s.clear();
    for (const p of saved) {
      const row = s.add(p.entity);
      const c = s.columns;
      c.x[row] = p.x;
      c.y[row] = p.y;
      c.vx[row] = p.vx;
      c.vy[row] = p.vy;
      c.z[row] = p.z;
      c.ticks[row] = p.ticks;
      c.total[row] = p.total;
      c.peak[row] = p.peak;
      c.owner[row] = p.owner;
      c.item[row] = this.itemIndex(p.item);
      c.layer[row] = p.layer;
      c.level[row] = p.level;
      c.damage[row] = p.damage;
      c.art[row] = p.art;
      c.wucht[row] = p.wucht;
      c.stagger[row] = p.stagger;
      c.tension[row] = p.tension;
      c.team[row] = p.team;
      c.flight[row] = p.flight;
      if (p.carried !== null) state.carried.set(p.entity, { ...p.carried });
    }
  }
}

