/**
 * Speichern in jedem Tick (M6-36 „Speichern mitten im Kampf → Laden → Tick für Tick gleich“, docs/ARCHITEKTUR.md
 * „Speichern/Laden“, ADR-0024; Review M6 savedet:save-sweep-test-gap): Ein einzelner Speicherpunkt belegt das nicht – die
 * Fehler des Reviews zeigten sich nur an bestimmten Ticks (Temperaturminute an 4 von 15 Ticks der Sekunde, Lichtliste neben
 * einem brennenden Feuer, Befehle im ersten Tick nach dem Laden). Hier wird nach jedem von 64 aufeinanderfolgenden Ticks
 * gespeichert (über einen Welttick hinweg) und geladen; der geladene Lauf muss danach 60 Ticks lang denselben `hashState()`
 * haben wie der ununterbrochene, mit denselben Befehlen.
 * - Mitten im Kampf: das Referenzszenario des Spielstands (tools/save/fixture.ts) mit Angriffen, Blocken, Ausweichrollen,
 *   Laufen – und Befehlen, die die aktive Zone brauchen, genau im ersten Tick nach einem Speicherpunkt: Wölfe erscheinen
 *   lassen (`creature.spawn`) und eine Falle stellen (`trap.place`).
 * - Am brennenden Lagerfeuer in der kalten Winternacht: das Feuer wärmt den Spieler in jedem Tick.
 * Läuft in `verify` (npm run test:integration), nicht in `check`.
 */
import { describe, expect, it } from 'vitest';
import { parseGameCommand, type GameCommand } from '../../src/game/commands';
import type { CreatureSystem } from '../../src/game/creatures/system';
import type { InventorySystem } from '../../src/game/inventory/system';
import { BAG_AREAS, type SlotRef } from '../../src/game/items/slots';
import type { LightSystem } from '../../src/game/light/system';
import type { PlayerSystem } from '../../src/game/player/system';
import type { Simulation } from '../../src/game/sim';
import { MemorySaveStore } from '../../src/save/memoryStore';
import { loadWorld, saveWorld } from '../../src/save/world';
import { TILE_PX } from '../../src/world/model/coords';
import { playFixtureScenario } from '../../tools/save/fixture';

/** Consecutive save points (the fixture's tick 48 315 + 1 … + 64 spans the world tick at 48 360). */
const SAVE_POINTS = 64;
/** Ticks compared after every load. */
const AFTER_LOAD = 60;
/** Ticks of the fight script at which a command needs the active zone (right after save points 19 and 29). */
const SPAWN_AT = 20;
const TRAP_AT = 30;
/** A whole sweep: thousands of hashed ticks and 64 loads per case. */
const SWEEP_TIMEOUT_MS = 600_000;

function sys<T>(sim: Simulation, id: string): T {
  return sim.system(id) as unknown as T;
}

function position(sim: Simulation): { x: number; y: number } {
  const p = { x: 0, y: 0 };
  if (!sys<PlayerSystem>(sim, 'player').position(sim, p)) throw new Error('no player');
  return p;
}

function slotOf(sim: Simulation, item: string): SlotRef {
  const state = sys<InventorySystem>(sim, 'inventory').state;
  for (const area of BAG_AREAS) {
    const index = state[area].findIndex((s) => s !== null && s.item === item);
    if (index >= 0) return { bereich: area, index };
  }
  throw new Error(`no ${item} in the bags`);
}

async function saveAndLoad(sim: Simulation, id: string): Promise<Simulation> {
  const store = new MemorySaveStore();
  await saveWorld(store, sim, { worldId: id, name: id, now: 1, gameVersion: 'test' });
  return loadWorld(store, id);
}

function step(sim: Simulation, commands: readonly GameCommand[]): void {
  sim.step(commands);
  sim.events.clear();
}

/** The fight script's commands of tick `i`, read from the reference run (and then replayed verbatim). */
function fightCommands(i: number, sim: Simulation): GameCommand[] {
  const out: unknown[] = [];
  const at = position(sim);
  // Aim at the nearest creature.
  const creatures = sys<CreatureSystem>(sim, 'creatures');
  const p = { x: 0, y: 0 };
  let best = -1;
  const aim = { x: 0, y: 0 };
  for (let k = 0; k < creatures.store.size; k++) {
    const s = creatures.store.valueAt(k);
    if (s.health <= 0 || s.hidden || !creatures.positionOf(creatures.store.entityAt(k), p)) continue;
    const d = (p.x - at.x) ** 2 + (p.y - at.y) ** 2;
    if (best < 0 || d < best) {
      best = d;
      aim.x = Math.round(p.x);
      aim.y = Math.round(p.y);
    }
  }
  if (best >= 0) out.push({ type: 'player.aim', x: aim.x, y: aim.y });
  if (i === 0) out.push({ type: 'inventory.give', item: 'kastenfalle', count: 1 }, { type: 'debug.god', on: true });
  const phase = i % 30;
  if (phase === 0 || phase === 12) out.push({ type: 'combat.attack', on: true });
  if (phase === 2 || phase === 14) out.push({ type: 'combat.attack', on: false });
  if (phase === 18) out.push({ type: 'combat.block', on: true });
  if (phase === 26) out.push({ type: 'combat.block', on: false });
  if (i % 45 === 40) out.push({ type: 'player.roll', dx: 1, dy: 0 });
  const dirs = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const;
  const dir = dirs[Math.floor(i / 25) % dirs.length] as readonly [number, number];
  if (i % 25 === 0) out.push({ type: 'player.move', dx: dir[0], dy: dir[1] });
  if (i % 25 === 15) out.push({ type: 'player.move', dx: 0, dy: 0 });
  if (i === SPAWN_AT) out.push({ type: 'creature.spawn', creature: 'wolf', count: 2, x: Math.round(at.x + 160), y: Math.round(at.y - 120), layer: 0 });
  if (i === TRAP_AT) out.push({ type: 'trap.place', from: slotOf(sim, 'kastenfalle'), tx: Math.floor(at.x / TILE_PX) + 1, ty: Math.floor(at.y / TILE_PX) + 1 });
  return out.map((c) => parseGameCommand(c));
}

interface Reference {
  readonly commands: GameCommand[][];
  /** `hashState()` after each tick of the script. */
  readonly hashes: string[];
  /** Events of the reference run that show the zone-bound commands worked. */
  readonly spawned: number;
  readonly trapsPlaced: number;
}

/** Runs the uninterrupted reference (never saved) for `ticks` ticks with the script, recording commands and hashes. */
function reference(sim: Simulation, ticks: number, script: (i: number, sim: Simulation) => GameCommand[]): Reference {
  const commands: GameCommand[][] = [];
  const hashes: string[] = [];
  let spawned = 0;
  let trapsPlaced = 0;
  for (let i = 0; i < ticks; i++) {
    const c = script(i, sim);
    commands.push(c);
    sim.step(c);
    sim.events.drain((...e) => {
      if (e[0] === 'creatureSpawned') spawned++;
      if (e[0] === 'trapPlaced') trapsPlaced++;
    });
    hashes.push(sim.hashState());
  }
  return { commands, hashes, spawned, trapsPlaced };
}

/**
 * Steps `run` (the reference's start, saved and loaded once) through the script, saves after each of the first
 * `SAVE_POINTS` ticks, loads and compares `AFTER_LOAD` ticks with the reference. Returns the divergent save points.
 */
async function sweep(run: Simulation, ref: Reference): Promise<string[]> {
  const bad: string[] = [];
  for (let k = 0; k < SAVE_POINTS; k++) {
    step(run, ref.commands[k] as GameCommand[]);
    expect(run.hashState(), `durchgehender Lauf nach Tick ${k}`).toBe(ref.hashes[k]);
    const loaded = await saveAndLoad(run, `k${k}`);
    if (loaded.hashState() !== ref.hashes[k]) {
      bad.push(`Speicherpunkt ${k} (Tick ${run.tick}): gleich nach dem Laden verschieden`);
      continue;
    }
    for (let j = k + 1; j <= k + AFTER_LOAD; j++) {
      step(loaded, ref.commands[j] as GameCommand[]);
      if (loaded.hashState() !== ref.hashes[j]) {
        bad.push(`Speicherpunkt ${k} (Tick ${run.tick}): verschieden ${j - k} Ticks nach dem Laden`);
        break;
      }
    }
  }
  return bad;
}

describe('Speichern in jedem Tick: geladen läuft es Tick für Tick weiter wie ohne Speichern', () => {
  it(
    'mitten im Kampf: 64 Speicherpunkte über einen Welttick, Wölfe und Falle im ersten Tick nach dem Laden',
    async () => {
      const uninterrupted = playFixtureScenario();
      const start = await saveAndLoad(uninterrupted, 'start');
      const ref = reference(uninterrupted, SAVE_POINTS + AFTER_LOAD, fightCommands);
      // The zone-bound commands worked in the reference: both wolves came, the trap stands.
      expect(ref.spawned).toBeGreaterThanOrEqual(2);
      expect(ref.trapsPlaced).toBe(1);
      expect(await sweep(start, ref)).toEqual([]);
    },
    SWEEP_TIMEOUT_MS,
  );

  it(
    'am brennenden Lagerfeuer in der kalten Winternacht: 64 Speicherpunkte, das Feuer wärmt in jedem Tick',
    async () => {
      const sim = playFixtureScenario();
      const light = sys<LightSystem>(sim, 'light');
      const fire = light.state.placed.find((l) => l.fire !== null);
      if (fire === undefined) throw new Error('the fixture scenario has no camp fire');
      const setup: unknown[][] = [
        [{ type: 'setSeason', season: 'winter' }],
        [{ type: 'setTime', hour: 23, minute: 0 }],
        [{ type: 'setWeather', state: 'klar' }, { type: 'debug.god', on: true }, { type: 'creature.kill', radius: 60 }],
        [{ type: 'player.teleport', x: (fire.tx + 1) * TILE_PX + TILE_PX / 2 + TILE_PX, y: fire.ty * TILE_PX + TILE_PX / 2, layer: 0 }],
        [{ type: 'inventory.give', item: 'holz', count: 6 }],
      ];
      for (const c of setup) step(sim, c.map((x) => parseGameCommand(x)));
      step(sim, [parseGameCommand({ type: 'light.fuel', light: fire.id, from: slotOf(sim, 'holz'), count: 6 })]);
      step(sim, [parseGameCommand({ type: 'light.ignite', tx: fire.tx, ty: fire.ty })]);
      for (let i = 0; i < 120; i++) step(sim, []);
      expect(fire.fire?.lit).toBe(true);
      const heat = (s: Simulation): number => sys<{ vitalsOf(x: Simulation): { heatC: number } | undefined }>(s, 'vitals').vitalsOf(s)?.heatC ?? 0;
      expect(heat(sim)).toBeGreaterThan(0);
      const start = await saveAndLoad(sim, 'start');
      const still = (): GameCommand[] => [];
      const ref = reference(sim, SAVE_POINTS + AFTER_LOAD, still);
      expect(heat(sim)).toBeGreaterThan(0);
      expect(await sweep(start, ref)).toEqual([]);
    },
    SWEEP_TIMEOUT_MS,
  );
});
