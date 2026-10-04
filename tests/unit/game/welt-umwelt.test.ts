/**
 * Review M6 im echten Spiel (`createSimulation`) – die Umwelt der echten Welt erreicht Kreaturen und Geschosse (Befund
 * tests:world-environment-wiring-untested; bisher nur mit eingespeisten Testumwelten geprüft):
 * - M6-14, MASTERPROMPT §19.4 „Sichtweite … Wetter“, „Gehör … Regen dämpft“: Nebel, per `setWeather` gesetzt, verkürzt die
 *   Entfernung, auf die ein Wolf den Spieler bemerkt; im Gewitter überhört er dessen Sprint auf eine Entfernung, auf die er
 *   ihn bei klarem Wetter hört.
 * - M6-27, §12.4 „Finstermond +50 %, stärkere Varianten“: In der Finstermond-Nacht des Kalenders kommt die Schattenbrut
 *   als Finstermond-Brut (`finster`, mehr Leben), in einer gewöhnlichen Nacht nicht.
 * - M6-07 „Projektile mit … Wind-Einfluss“: Im Gewitter treibt ein Pfeil seitlich ab, in die Richtung des Windes der Region
 *   (`windDirection`) und so viel weiter als in der Brise bei klarem Wetter, wie der Wind der Region stärker ist.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CLIMATE_BALANCE } from '../../../src/content/weather';
import { normalizeSeed } from '../../../src/engine/rng';
import type { Entity } from '../../../src/engine/ecs';
import type { EventArgs } from '../../../src/engine/events';
import type { CombatSystem } from '../../../src/game/combat/system';
import { parseGameCommand } from '../../../src/game/commands';
import { worldCreatureEnvironment } from '../../../src/game/creatures/environment';
import { phaseAt } from '../../../src/game/creatures/formulas';
import { maxHealthOf } from '../../../src/game/creatures/population';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import { DIR_DX, DIR_DY, windDirection } from '../../../src/game/fire/formulas';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { BAG_AREAS, type SlotRef } from '../../../src/game/items/slots';
import type { LightSystem } from '../../../src/game/light/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import { createSimulation } from '../../../src/game/setup';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import { isFinstermondPhase, moonPhaseOfNight, type DayPhase } from '../../../src/world/calendar';
import { createWeatherSample } from '../../../src/world/climate/weather';
import { TILE_PX } from '../../../src/world/model/coords';

/** The fixture world (small, seed 3; tools/save/fixture.ts): open meadows behind the start beach. */
const CONFIG = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;
/** Generated worlds and game minutes of weather: more than the default 5 s on a loaded machine. */
const TIMEOUT_MS = 120_000;
/** Game minutes a forced weather needs to blend in fully (`CLIMATE_BALANCE.weatherBlendMinutes` and a margin). */
const BLEND_MINUTES = CLIMATE_BALANCE.weatherBlendMinutes + 5;
/** Ticks after the time jump: the zone comes back, the weather's world tick passes. */
const SETTLE_TICKS = 2 * BALANCE.time.tickHz;
/** Game minutes the dusk scene needs in one phase: half a second of looking and a margin. */
const SCENE_MINUTES = 10;
const MINUTES_PER_HOUR = 60;
/** The night of day 1 (its evening). */
const FIRST_NIGHT = 1;
type Ev = EventArgs<SimEventMap>;

function sys<T>(sim: Simulation, id: string): T {
  return sim.system(id) as unknown as T;
}

function run(sim: Simulation, commands: readonly unknown[] = [], ticks = 1): Ev[] {
  const out: Ev[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
    sim.events.drain((...e) => out.push(e));
  }
  return out;
}

function refused(events: readonly Ev[]): string[] {
  return events.filter((e) => e[0] === 'commandRejected').map((e) => JSON.stringify(e[1]));
}

function slotOf(sim: Simulation, item: string): SlotRef {
  const state = sys<InventorySystem>(sim, 'inventory').state;
  for (const area of BAG_AREAS) {
    const index = state[area].findIndex((s) => s !== null && s.item === item);
    if (index >= 0) return { bereich: area, index };
  }
  throw new Error(`no ${item} in the bags`);
}

function playerAt(sim: Simulation): { x: number; y: number } {
  const p = { x: 0, y: 0 };
  if (!sys<PlayerSystem>(sim, 'player').position(sim, p)) throw new Error('no player');
  return p;
}

/** The first minute of the evening (from noon on) that begins `SCENE_MINUTES` in phase `phase` of the season now. */
function eveningMinuteOf(sim: Simulation, phase: DayPhase): { hour: number; minute: number } {
  const season = worldCreatureEnvironment().timeAt(sim, sim.tick, { phase: 'tag', season: 'fruehling' }).season;
  const HOUR = MINUTES_PER_HOUR;
  for (let m = 12 * HOUR; m < 24 * HOUR; m++) {
    if (phaseAt(season, m / HOUR) === phase && phaseAt(season, (m + SCENE_MINUTES) / HOUR) === phase) return { hour: Math.floor(m / HOUR), minute: m % HOUR };
  }
  throw new Error(`no evening minute in phase ${phase}`);
}

/**
 * A player on the fixture world's spawn in the evening's `phase` (or at `hour`), invulnerable, in `weather`: forced
 * `BLEND_MINUTES` game minutes before, so it has blended in fully.
 */
function world(when: DayPhase | number, weather: string): Simulation {
  const sim = createSimulation(CONFIG);
  run(sim, [{ type: 'player.spawn' }], 30);
  const at = typeof when === 'number' ? { hour: when, minute: 0 } : eveningMinuteOf(sim, when);
  const before = at.hour * MINUTES_PER_HOUR + at.minute - BLEND_MINUTES;
  run(sim, [{ type: 'setTime', hour: Math.floor(before / MINUTES_PER_HOUR), minute: before % MINUTES_PER_HOUR }]);
  run(sim, [{ type: 'setWeather', state: weather }, { type: 'debug.god', on: true }]);
  run(sim, [{ type: 'advanceTime', minutes: BLEND_MINUTES }], SETTLE_TICKS);
  if (typeof when !== 'number') expect(worldCreatureEnvironment().timeAt(sim, sim.tick, { phase: 'tag', season: 'fruehling' }).phase).toBe(when);
  return sim;
}

/** Spawns three wolves at (x, y) and returns them. */
function wolvesAt(sim: Simulation, x: number, y: number): Entity[] {
  const events = run(sim, [{ type: 'creature.spawn', creature: 'wolf', count: 3, x: Math.round(x), y: Math.round(y), layer: 0 }]);
  const wolves = events.filter((e) => e[0] === 'creatureSpawned').map((e) => (e[1] as SimEventMap['creatureSpawned']).entity);
  expect(wolves).toHaveLength(3);
  return wolves;
}

/** How many of `wolves` took the player as their target. */
function hunting(sim: Simulation, wolves: readonly Entity[]): number {
  const creatures = sys<CreatureSystem>(sim, 'creatures');
  return wolves.filter((e) => creatures.store.get(e)?.target === sim.player).length;
}

describe('Wetter → Sicht und Gehör der Kreaturen (M6-14)', () => {
  /**
   * At dusk (wolves awake) beside a burning camp fire (full light at the player), three wolves appear `tiles` north of the
   * standing player – facing south, towards him – and look for half a second.
   */
  function wolvesNorth(weather: string, tiles: number): { sim: Simulation; hunters: number } {
    const sim = world('abenddaemmerung', weather);
    run(sim, [
      { type: 'inventory.give', item: 'lagerfeuer', count: 1 },
      { type: 'inventory.give', item: 'holz', count: 4 },
    ]);
    const p = playerAt(sim);
    const light = sys<LightSystem>(sim, 'light');
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
    ] as const) {
      if (light.state.placed.length > 0) break;
      run(sim, [{ type: 'light.place', from: slotOf(sim, 'lagerfeuer'), tx: Math.floor(p.x / TILE_PX) + dx, ty: Math.floor(p.y / TILE_PX) + dy }]);
    }
    const fire = light.state.placed[0];
    if (fire === undefined) throw new Error('no free tile for the camp fire');
    expect(refused(run(sim, [{ type: 'light.fuel', light: fire.id, from: slotOf(sim, 'holz'), count: 4 }]))).toEqual([]);
    expect(refused(run(sim, [{ type: 'light.ignite', tx: fire.tx, ty: fire.ty }]))).toEqual([]);
    const wolves = wolvesAt(sim, p.x, p.y - tiles * TILE_PX);
    run(sim, [], 30);
    return { sim, hunters: hunting(sim, wolves) };
  }

  it('Nebel verkürzt die Sichtweite: bei klarem Wetter bemerken die Wölfe den Spieler auf 10 Kacheln, im Nebel nicht', () => {
    const clear = wolvesNorth('klar', 10);
    const fog = wolvesNorth('nebel', 10);
    expect(clear.hunters).toBeGreaterThan(0);
    expect(fog.hunters).toBe(0);
    // Up close the fog hides nothing.
    expect(wolvesNorth('nebel', 4).hunters).toBeGreaterThan(0);
    // It was the fog of the world over the player.
    const p = playerAt(fog.sim);
    expect(worldCreatureEnvironment().weather(fog.sim, 0, Math.floor(p.x / TILE_PX), Math.floor(p.y / TILE_PX), { haze: 0, precipitation: 0 }).haze).toBeGreaterThan(0.9);
  }, TIMEOUT_MS);

  it('Regen dämpft das Gehör: abgewandte Wölfe hören den Sprint auf 9 Kacheln bei klarem Wetter, im Gewitter nicht', () => {
    const heard = (weather: string): number => {
      const sim = world('abenddaemmerung', weather);
      const p = playerAt(sim);
      // South of the player, facing south (away from him): they can only hear him.
      const wolves = wolvesAt(sim, p.x, p.y + 9 * TILE_PX);
      run(sim, [], 2);
      expect(hunting(sim, wolves)).toBe(0);
      run(sim, [
        { type: 'player.sprint', on: true },
        { type: 'player.move', dx: 1, dy: 0 },
      ], 20);
      return hunting(sim, wolves);
    };
    expect(heard('klar')).toBeGreaterThan(0);
    expect(heard('gewitter')).toBe(0);
  }, TIMEOUT_MS);
});

describe('Kalender → Nacht-Spawner: Finstermond (M6-27)', () => {
  /** Shadow brood spawned around the standing player in the night of the day `nights` days on, at 23:00. */
  function broodOfNight(nights: number): { finstermond: boolean; brood: Array<{ finster: boolean; health: number; max: number }> } {
    const sim = createSimulation(CONFIG);
    run(sim, [{ type: 'player.spawn' }], 30);
    for (let d = 0; d < nights; d++) run(sim, [{ type: 'advanceTime', minutes: 24 * 60 }]);
    run(sim, [{ type: 'setTime', hour: 23, minute: 0 }]);
    run(sim, [{ type: 'setWeather', state: 'klar' }, { type: 'debug.god', on: true }]);
    const creatures = sys<CreatureSystem>(sim, 'creatures');
    const brood: Array<{ finster: boolean; health: number; max: number }> = [];
    const seconds = 4 * BALANCE.spawn.shadowBrood.intervalSeconds;
    for (const e of run(sim, [], seconds * BALANCE.time.tickHz)) {
      if (e[0] !== 'creatureSpawned') continue;
      const ev = e[1] as SimEventMap['creatureSpawned'];
      const kind = creatures.catalog.get(ev.creature);
      const s = creatures.store.get(ev.entity);
      if (!kind.shadow || s === undefined) continue;
      brood.push({ finster: s.finster, health: s.health, max: maxHealthOf(kind, s.variant) });
    }
    return { finstermond: sim.world.calendar.isFinstermond, brood };
  }

  it('in der Finstermond-Nacht des Kalenders kommt Finstermond-Brut mit mehr Leben, in einer gewöhnlichen Nacht nicht', () => {
    const ordinary = broodOfNight(0);
    expect(ordinary.finstermond).toBe(false);
    expect(ordinary.brood.length).toBeGreaterThan(0);
    for (const b of ordinary.brood) {
      expect(b.finster).toBe(false);
      expect(b.health).toBe(b.max);
    }
    // The calendar's Finstermond (§10 "Mond: 8-Tage-Zyklus"): the first night whose moon phase is the new moon. `nights`
    // days on from day 1, 23:00 is the night of day 1 + `nights`.
    let night = FIRST_NIGHT;
    while (!isFinstermondPhase(moonPhaseOfNight(night))) night++;
    expect(night).toBeLessThanOrEqual(FIRST_NIGHT + BALANCE.calendar.moonCycleDays);
    const dark = broodOfNight(night - FIRST_NIGHT);
    expect(dark.finstermond).toBe(true);
    expect(dark.brood.length).toBeGreaterThan(0);
    for (const b of dark.brood) {
      expect(b.finster).toBe(true);
      expect(b.health).toBeCloseTo(b.max * BALANCE.spawn.shadowBrood.finstermond.leben, 9);
    }
  }, TIMEOUT_MS);
});

describe('Wetter → Geschosse: Wind (M6-07)', () => {
  /**
   * A short bow drawn and loosed east at noon in `weather`; after `flight` ticks the arrow's drift across its starting line
   * [px, + to the left of the flight] and the wind across that line the region's weather makes [px/s²]: its wind strength
   * (`WeatherSample.wind`) × `windAccelPxPerSecond2` in the fire's wind direction (`windDirection`).
   */
  function arrowDrift(weather: string, flight: number): { drift: number; windAcross: number } {
    const sim = world(12, weather);
    run(sim, [
      { type: 'inventory.give', item: 'kurzbogen', count: 1 },
      { type: 'inventory.give', item: 'pfeil_feuerstein', count: 4 },
    ]);
    const bow = slotOf(sim, 'kurzbogen');
    if (bow.bereich !== 'schnellleiste') run(sim, [{ type: 'inventory.move', from: bow, to: { bereich: 'schnellleiste', index: 2 } }]);
    expect(refused(run(sim, [{ type: 'player.selectHotbar', index: slotOf(sim, 'kurzbogen').index }]))).toEqual([]);
    const p = playerAt(sim);
    run(sim, [{ type: 'player.aim', x: Math.round(p.x + 400), y: Math.round(p.y) }, { type: 'combat.attack', on: true }], 50);
    const fired = run(sim, [{ type: 'combat.attack', on: false }])
      .filter((e) => e[0] === 'projectileFired' && (e[1] as SimEventMap['projectileFired']).owner === sim.player)
      .map((e) => e[1] as SimEventMap['projectileFired']);
    const shot = fired[0];
    if (shot === undefined) throw new Error('the arrow did not fly');
    run(sim, [], flight);
    const combat = sys<CombatSystem>(sim, 'combat');
    const row = combat.projectiles.indexOf(shot.entity);
    expect(row).toBeGreaterThanOrEqual(0);
    const speed = Math.hypot(shot.vx, shot.vy);
    const ux = shot.vx / speed;
    const uy = shot.vy / speed;
    const mx = (combat.projectiles.columns.x[row] as number) - shot.x;
    const my = (combat.projectiles.columns.y[row] as number) - shot.y;
    const region = sim.world.regionAt(Math.floor(shot.x / TILE_PX), Math.floor(shot.y / TILE_PX));
    const strength = sim.world.weather.sample(region, createWeatherSample()).wind * BALANCE.combat.projectile.windAccelPxPerSecond2;
    const dir = windDirection(normalizeSeed(sim.config.seed), region, sim.world.weather.periodCount(region));
    const len = Math.hypot(DIR_DX[dir] as number, DIR_DY[dir] as number);
    const wx = ((DIR_DX[dir] as number) / len) * strength;
    const wy = ((DIR_DY[dir] as number) / len) * strength;
    return { drift: ux * my - uy * mx, windAcross: ux * wy - uy * wx };
  }

  it('im Sturm treibt der Pfeil seitlich in Windrichtung ab – so weit, wie der Wind der Region stärker weht als bei klarem Wetter', () => {
    const clear = arrowDrift('klar', 12);
    const storm = arrowDrift('gewitter', 12);
    // The storm's wind blows across the line, several times the clear weather's breeze.
    expect(Math.abs(storm.windAcross)).toBeGreaterThan(3 * Math.abs(clear.windAcross));
    expect(Math.sign(storm.drift)).toBe(Math.sign(storm.windAcross));
    expect(Math.abs(storm.drift)).toBeGreaterThan(0.3);
    // Same flight time: the drift is the wind across the line times the same factor in both.
    expect(storm.drift / storm.windAcross).toBeCloseTo(clear.drift / clear.windAcross, 4);
  }, TIMEOUT_MS);
});
