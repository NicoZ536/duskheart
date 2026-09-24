/**
 * Fixture saves (MASTERPROMPT §28 "Versioniert mit Migrationen (Tests mit Fixture-Spielständen jeder
 * Version)"; M3-34): `npm run fixture:save` plays a fixed scenario through game commands, saves it like the
 * pause menu does (`saveWorld` into a store) and writes the reference save of the **current** save version
 * (src/save/versions.ts) to `tests/fixtures/saves/v<n>.json`. Fixtures of older versions are frozen: the
 * script refuses to touch them, and `tests/unit/save/migrationen.test.ts` loads every one of them into the
 * current build.
 *
 * A fixture holds the world dump (src/save/dump.ts) and the *facts* of the saved player – position,
 * survival values, conditions, bags and equipment, skills, grave, respawn point, fear, lights, drops,
 * crafting queue – read through the systems' public API (`saveFacts`), not from the snapshot layout. A
 * later build that loads the fixture must read the same facts from it, whatever its migrations did to the
 * data.
 *
 * The scenario (`playFixtureScenario`) uses debug commands where they save time (`inventory.give`,
 * `death.kill`, `conditions.apply`, `fear.set`): the fixture is reference data, not a play test (that is
 * tests/integration/tag1.test.ts). It covers everything M3-34 names: a death with a grave and a respawn,
 * then new bags with worn and belt items and a lit torch, a crafted piece plus an order in progress, a dug
 * tile (a chunk diff), a burning camp fire, a thrown stone on the ground, a condition and fear.
 *
 * CLI: `tsx tools/save/fixture.ts` (writes the fixture of the current save version, overwriting it). ADR-0030.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ConditionsSystem } from '../../src/game/conditions/system';
import type { CraftingSystem } from '../../src/game/crafting/system';
import type { DeathSystem } from '../../src/game/death/system';
import type { DropSystem } from '../../src/game/drops/system';
import type { FearSystem } from '../../src/game/fear/system';
import { createHarvestPlan, type GatheringSystem, type HeldTool } from '../../src/game/gathering/system';
import { parseGameCommand, type GameCommand } from '../../src/game/commands';
import type { InventorySystem } from '../../src/game/inventory/system';
import { BAG_AREAS, equipmentRef, type SlotRef } from '../../src/game/items/slots';
import type { LightSystem } from '../../src/game/light/system';
import type { WorldCollision } from '../../src/game/player/collision';
import type { PlayerSystem } from '../../src/game/player/system';
import { createSimulation } from '../../src/game/setup';
import type { SimEventMap, Simulation } from '../../src/game/sim';
import type { SkillsSystem } from '../../src/game/skills/system';
import type { EventArgs } from '../../src/engine/events';
import { canonicalJson, parseCanonical } from '../../src/save/canonical';
import { exportWorld, importWorld, parseWorldDump, type WorldDump } from '../../src/save/dump';
import { MemorySaveStore } from '../../src/save/memoryStore';
import type { SaveStore } from '../../src/save/store';
import { CURRENT_SAVE_VERSION, SAVE_VERSIONS } from '../../src/save/versions';
import { loadWorld, saveWorld } from '../../src/save/world';
import { TILE_PX } from '../../src/world/model/coords';

/** Directory of the fixture saves (relative to the repository root). */
export const SAVE_FIXTURE_DIR = 'tests/fixtures/saves';
/** Format version of a fixture file. */
export const SAVE_FIXTURE_FORMAT = 1;

/** The fixture file of save version `version`. */
export function fixtureFile(version: number): string {
  return `${SAVE_FIXTURE_DIR}/v${version}.json`;
}

/** World of the fixture scenario: a small world (quick to rebuild in tests), start beach with sand. */
export const FIXTURE_WORLD = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;
/** Id and name of the fixture world in the store. */
const FIXTURE_WORLD_ID = 'fixture';
const FIXTURE_WORLD_NAME = 'Referenzspielstand';
/** Wall-clock time written into the fixture (fixed, so the script writes the same file every run) [epoch ms]. */
const FIXTURE_SAVED_AT = Date.UTC(2026, 8, 24);
/** Build written into the world record (the package version when the fixture was made). */
const FIXTURE_GAME_VERSION = (JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string }).version;

/** Scenario timing [ticks]. */
const SETTLE_TICKS = 30;
const WALK_TICKS = 40;
const CRAFT_LIMIT_TICKS = 3_600;
const WORK_LIMIT_TICKS = 300;
const THROW_LIMIT_TICKS = 240;
const AFTER_TICKS = 600;
/** Fire fuel of the scenario [logs] and the burning time left at the save. */
const FIRE_LOGS = 3;
/** Distance of the throw [tiles]. */
const THROW_TILES = 3;

// ---------------------------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------------------------

const num = z.number();
const stackFact = z.object({ at: z.string(), item: z.string(), count: z.number().int(), haltbarkeit: num.optional(), qualitaet: num.optional(), frische: num.optional() }).strict();

/** What a build must read from a loaded save (through the systems' API). */
export const saveFactsSchema = z
  .object({
    tick: z.number().int(),
    day: z.number().int(),
    player: z.object({ x: num, y: num, layer: z.number().int(), facing: z.string() }).strict(),
    vitals: z.object({ health: num, stamina: num, satiety: num, thirst: num, wetness: num, exhaustion: num, coreC: num }).strict(),
    conditions: z.array(z.object({ id: z.string(), stacks: z.number().int() }).strict()),
    bags: z.array(stackFact),
    selectedHotbar: z.number().int(),
    carriedLight: z.object({ item: z.string(), lit: z.boolean() }).strict().nullable(),
    skills: z.array(z.object({ id: z.string(), level: z.number().int(), xp: num }).strict()),
    graves: z.array(z.object({ x: num, y: num, layer: z.number().int(), items: z.array(z.object({ item: z.string(), count: z.number().int() }).strict()) }).strict()),
    respawn: z.object({ x: num, y: num, layer: z.number().int(), kind: z.string() }).strict().nullable(),
    dead: z.boolean(),
    fear: num,
    lights: z.array(z.object({ kind: z.string(), layer: z.number().int(), tx: z.number().int(), ty: z.number().int(), lit: z.boolean() }).strict()),
    drops: z.number().int(),
    craftOrders: z.array(z.object({ recipe: z.string(), count: z.number().int() }).strict()),
  })
  .strict();

/** The facts of a saved player. */
export type SaveFacts = z.output<typeof saveFactsSchema>;

function sys<T>(sim: Simulation, id: string): T {
  return sim.system(id) as unknown as T;
}

/** Reads the facts of `sim` through the systems' public API (never from the snapshot layout). */
export function saveFacts(sim: Simulation): SaveFacts {
  const player = sys<PlayerSystem>(sim, 'player');
  const inventory = sys<InventorySystem>(sim, 'inventory');
  const conditions = sys<ConditionsSystem>(sim, 'conditions');
  const skills = sys<SkillsSystem>(sim, 'skills');
  const death = sys<DeathSystem>(sim, 'death');
  const fear = sys<FearSystem>(sim, 'fear');
  const light = sys<LightSystem>(sim, 'light');
  const drops = sys<DropSystem>(sim, 'drops');
  const crafting = sys<CraftingSystem>(sim, 'crafting');
  const body = player.body(sim);
  const at = { x: 0, y: 0 };
  if (body === undefined || !player.position(sim, at)) throw new Error('saveFacts: the save has no player');
  const v = player.vitalsOf(sim.player);
  if (v === undefined) throw new Error('saveFacts: the player has no vitals');
  const bags = inventory.state;
  const stacks: SaveFacts['bags'] = [];
  for (const bereich of BAG_AREAS) {
    bags[bereich].forEach((s, index) => {
      if (s === null) return;
      stacks.push({
        at: `${bereich}:${index}`,
        item: s.item,
        count: s.count,
        ...(s.haltbarkeit === undefined ? {} : { haltbarkeit: s.haltbarkeit }),
        ...(s.qualitaet === undefined ? {} : { qualitaet: s.qualitaet }),
        ...(s.frische === undefined ? {} : { frische: s.frische }),
      });
    });
  }
  const carried = light.carried;
  const respawn = death.state.respawn;
  return {
    tick: sim.tick,
    day: sim.clock.day,
    player: { x: at.x, y: at.y, layer: body.layer, facing: body.facing },
    vitals: { health: v.health, stamina: v.stamina, satiety: v.satiety, thirst: v.thirst, wetness: v.wetness, exhaustion: v.exhaustion, coreC: v.coreC },
    conditions: conditions.active().map((c) => ({ id: c.id, stacks: c.stacks })),
    bags: stacks,
    selectedHotbar: bags.auswahl,
    carriedLight: carried === null ? null : { item: carried.item, lit: carried.burn.lit },
    skills: skills.defs.map((d) => ({ id: d.id, level: skills.skill(d.id).level, xp: skills.skill(d.id).xp })).filter((s) => s.level > 1 || s.xp > 0),
    graves: death.state.graves.map((g) => ({ x: g.x, y: g.y, layer: g.layer, items: g.items.map((s) => ({ item: s.item, count: s.count })) })),
    respawn: respawn === null ? null : { x: respawn.x, y: respawn.y, layer: respawn.layer, kind: respawn.kind },
    dead: death.dead,
    fear: fear.state.value,
    lights: light.state.placed.map((l) => ({ kind: l.kind, layer: l.layer, tx: l.tx, ty: l.ty, lit: (l.torch?.lit ?? false) || (l.fire?.lit ?? false) })),
    drops: drops.count,
    craftOrders: crafting.orders.map((o) => ({ recipe: o.rezept, count: o.anzahl })),
  };
}

// ---------------------------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------------------------

type TickEvent = EventArgs<SimEventMap>;

/** Steps the simulation with validated commands and keeps the events of the last run. */
class Driver {
  events: TickEvent[] = [];

  constructor(readonly sim: Simulation) {}

  /** Runs one tick with `commands`, then `ticks − 1` more; returns the events of all of them. */
  run(commands: readonly GameCommand[], ticks = 1): TickEvent[] {
    const out: TickEvent[] = [];
    for (let i = 0; i < ticks; i++) {
      this.sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
      this.sim.events.drain((...e) => out.push(e));
    }
    this.events = out;
    return out;
  }

  /** Runs ticks until `until(events of the tick)` holds; throws after `limit` ticks naming `what`. */
  until(what: string, commands: readonly GameCommand[], until: (events: readonly TickEvent[]) => boolean, limit: number): TickEvent[] {
    let first = true;
    for (let i = 0; i < limit; i++) {
      const events = this.run(first ? commands : []);
      first = false;
      if (until(events)) return events;
    }
    throw new Error(`Fixture-Szenario: ${what} gelang nicht in ${limit} Ticks`);
  }

  /** Rejections of the last run. */
  rejections(): string[] {
    return this.events.filter((e) => e[0] === 'commandRejected').map((e) => JSON.stringify(e[1]));
  }

  /** Runs `commands` and throws if any of them was refused. */
  expectOk(what: string, commands: readonly GameCommand[], ticks = 1): TickEvent[] {
    const events = this.run(commands, ticks);
    const refused = this.rejections();
    if (refused.length > 0) throw new Error(`Fixture-Szenario: ${what} abgelehnt: ${refused.join(', ')}`);
    return events;
  }

  get inventory(): InventorySystem {
    return sys<InventorySystem>(this.sim, 'inventory');
  }

  /** The first carried slot (hotbar, inventory, backpack compartment) holding `item`. */
  slotOf(item: string): SlotRef {
    const bags = this.inventory.state;
    for (const bereich of ['schnellleiste', 'inventar', 'rucksackfach'] as const) {
      const index = bags[bereich].findIndex((s) => s?.item === item);
      if (index >= 0) return { bereich, index };
    }
    throw new Error(`Fixture-Szenario: ${item} ist nicht in den Taschen`);
  }

  /** The player's tile. */
  tile(): { tx: number; ty: number } {
    const at = { x: 0, y: 0 };
    if (!sys<PlayerSystem>(this.sim, 'player').position(this.sim, at)) throw new Error('Fixture-Szenario: kein Spieler');
    return { tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) };
  }
}

const has = (events: readonly TickEvent[], type: keyof SimEventMap): boolean => events.some((e) => e[0] === type);
const refusedInteract = (events: readonly TickEvent[]): boolean => events.some((e) => e[0] === 'commandRejected' && (e[1] as { type: string }).type === 'player.interact');
const NEIGHBOURS = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
] as const;

/** Farthest the scenario looks for a diggable tile from the start beach [tiles]. */
const DIG_SEARCH_TILES = 64;
/** A stone shovel as the gathering rules see it in the hand. */
const SHOVEL: HeldTool = { kind: 'schaufel', power: 1, broken: false };

/** The nearest tile the shovel can dig (open ground, no place) with a free tile beside it to stand on. */
function diggableSpot(sim: Simulation, from: { tx: number; ty: number }): { dig: { tx: number; ty: number }; stand: { tx: number; ty: number } } {
  const gathering = sys<GatheringSystem>(sim, 'gathering');
  const grid = sys<WorldCollision>(sim, 'world-collision').grid;
  const plan = createHarvestPlan();
  for (let r = 1; r <= DIG_SEARCH_TILES; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = from.tx + dx;
        const ty = from.ty + dy;
        if (!gathering.planTile(sim, 0, tx, ty, SHOVEL, plan) || plan.block !== null || plan.dig !== 'pfad') continue;
        for (const [nx, ny] of NEIGHBOURS) {
          if (grid.tileInfo(0, tx + nx, ty + ny) === 0 && grid.tileInfo(0, tx - nx, ty - ny) === 0) return { dig: { tx, ty }, stand: { tx: tx + nx, ty: ty + ny } };
        }
      }
    }
  }
  throw new Error('Fixture-Szenario: kein grabbarer Boden in der Nähe des Startstrands');
}

/** Plays the fixture scenario on a fresh simulation and returns it (between two ticks, ready to save). */
export function playFixtureScenario(): Simulation {
  const d = new Driver(createSimulation(FIXTURE_WORLD));
  d.expectOk('Spieler erscheint', [{ type: 'player.spawn' }], SETTLE_TICKS);
  // A first life: a few finds, then death on the beach – the grave keeps them (Normal, §11.6), respawn there.
  d.expectOk('erste Funde', [
    { type: 'inventory.give', item: 'walnuss', count: 5 },
    { type: 'inventory.give', item: 'muschel', count: 2 },
  ]);
  d.until('Tod', [{ type: 'death.kill' }], (e) => has(e, 'playerDied'), SETTLE_TICKS);
  d.until('Wiedereinstieg', [{ type: 'death.respawn', at: 'strand' }], (e) => has(e, 'playerRespawned'), SETTLE_TICKS);
  // The second life's bags: tools, food, torch, camp fire, fuel, rope fibres, a stone to throw.
  d.expectOk('neue Taschen', [
    { type: 'inventory.give', item: 'steinschaufel', count: 1, qualitaet: 2 },
    { type: 'inventory.give', item: 'apfel', count: 3, frische: 60 },
    { type: 'inventory.give', item: 'fackel', count: 2 },
    { type: 'inventory.give', item: 'lagerfeuer', count: 1 },
    { type: 'inventory.give', item: 'holz', count: 12 },
    { type: 'inventory.give', item: 'fasern', count: 9 },
    { type: 'inventory.give', item: 'feuerstein', count: 4 },
    { type: 'inventory.give', item: 'verband', count: 1 },
  ]);
  // Torch in the off hand, lit; an apple on the belt.
  d.expectOk('Fackel in die Nebenhand', [{ type: 'inventory.move', from: d.slotOf('fackel'), to: equipmentRef('nebenhand'), count: 1 }]);
  d.expectOk('Fackel anzünden', [{ type: 'light.toggle' }]);
  d.expectOk('Apfel an den Gürtel', [{ type: 'inventory.move', from: d.slotOf('apfel'), to: { bereich: 'guertel', index: 0 }, count: 1 }]);
  // Crafting: one fibre rope done (Handwerk XP); two more are queued right before the save (below).
  d.until('Faserseil', [{ type: 'craft.start', recipe: 'rezept_faserseil', count: 1 }], (e) => has(e, 'craftCompleted'), CRAFT_LIMIT_TICKS);
  // Off the start beach (a place: no digging there, §14) to the nearest diggable tile; the player stands beside it.
  const spot = diggableSpot(d.sim, d.tile());
  d.expectOk('zum Grabeplatz', [{ type: 'player.teleport', x: spot.stand.tx * TILE_PX + TILE_PX / 2, y: spot.stand.ty * TILE_PX + TILE_PX / 2, layer: 0 }], SETTLE_TICKS);
  const me = d.tile();
  // The camp fire on a free tile next to the player: hotbar, aim, primary button; then fuel and light it.
  const fireSlot = { bereich: 'schnellleiste', index: 1 } as const;
  d.expectOk('Lagerfeuer in die Schnellleiste', [{ type: 'inventory.move', from: d.slotOf('lagerfeuer'), to: fireSlot }]);
  d.expectOk('Lagerfeuer wählen', [{ type: 'player.selectHotbar', index: fireSlot.index }]);
  let placed: { light: number; tx: number; ty: number } | null = null;
  for (const [dx, dy] of NEIGHBOURS) {
    const tx = me.tx + dx;
    const ty = me.ty + dy;
    if (tx === spot.dig.tx && ty === spot.dig.ty) continue;
    const events = d.run([
      { type: 'player.aim', x: tx * TILE_PX + TILE_PX / 2, y: ty * TILE_PX + TILE_PX / 2 },
      { type: 'player.useItem' },
    ]);
    const e = events.find((x) => x[0] === 'lightPlaced');
    if (e !== undefined) {
      placed = e[1] as { light: number; tx: number; ty: number };
      break;
    }
  }
  if (placed === null) throw new Error('Fixture-Szenario: das Lagerfeuer ließ sich nirgends aufstellen');
  d.expectOk('Feuer füttern', [{ type: 'light.fuel', light: placed.light, from: d.slotOf('holz'), count: FIRE_LOGS }]);
  d.expectOk('Feuer entzünden', [{ type: 'light.ignite', tx: placed.tx, ty: placed.ty }]);
  // A dug tile on another side of the player (a chunk diff): shovel in the hand, E on the tile until it is dug.
  const shovel = d.slotOf('steinschaufel');
  const hand = shovel.bereich === 'schnellleiste' ? shovel.index : 0;
  if (shovel.bereich !== 'schnellleiste') d.expectOk('Schaufel in die Schnellleiste', [{ type: 'inventory.move', from: shovel, to: { bereich: 'schnellleiste', index: hand } }]);
  d.expectOk('Schaufel wählen', [{ type: 'player.selectHotbar', index: hand }]);
  let events = d.run([{ type: 'player.interact', on: true, tx: spot.dig.tx, ty: spot.dig.ty }]);
  for (let i = 0; i < WORK_LIMIT_TICKS && !has(events, 'tileDug') && !refusedInteract(events); i++) events = d.run([]);
  const dug = has(events, 'tileDug');
  d.run([{ type: 'player.interact', on: false }]);
  if (!dug) throw new Error(`Fixture-Szenario: Graben bei ${spot.dig.tx},${spot.dig.ty} misslang`);
  // A stone thrown a few tiles away onto land: a drop on the ground.
  let landed = false;
  for (const [dx, dy] of NEIGHBOURS) {
    const here = d.tile();
    const events = d.until(
      'Wurf',
      [{ type: 'action.throw', from: d.slotOf('feuerstein'), x: (here.tx + dx * THROW_TILES) * TILE_PX + TILE_PX / 2, y: (here.ty + dy * THROW_TILES) * TILE_PX + TILE_PX / 2 }],
      (e) => has(e, 'thrownItemLanded'),
      THROW_LIMIT_TICKS,
    );
    const landing = events.find((e) => e[0] === 'thrownItemLanded');
    if (landing !== undefined && !(landing[1] as { sunk: boolean }).sunk) {
      landed = true;
      break;
    }
  }
  if (!landed) throw new Error('Fixture-Szenario: jeder Wurf landete im Wasser');
  // A condition with a timer and some fear; a few steps; then a while of game time.
  d.expectOk('Zustand', [{ type: 'conditions.apply', id: 'ausgeruht' }]);
  d.expectOk('Furcht', [{ type: 'fear.set', value: 30 }]);
  d.expectOk('ein paar Schritte', [{ type: 'player.move', dx: 1, dy: 0 }], WALK_TICKS);
  d.expectOk('stehen bleiben', [{ type: 'player.move', dx: 0, dy: 0 }], AFTER_TICKS);
  // An order in progress at the save: its reserved fibres travel with the crafting queue.
  d.expectOk('Faserseile in Auftrag', [{ type: 'craft.start', recipe: 'rezept_faserseil', count: 2 }], SETTLE_TICKS);
  return d.sim;
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

/** A fixture save: the dump plus the facts a build must read from it. */
export interface SaveFixture {
  readonly format: typeof SAVE_FIXTURE_FORMAT;
  readonly saveVersion: number;
  readonly milestone: string;
  readonly world: { readonly seed: number; readonly worldSize: string; readonly dayLengthMinutes: number };
  readonly facts: SaveFacts;
  readonly dump: WorldDump;
}

const fixtureEnvelopeSchema = z
  .object({
    format: z.literal(SAVE_FIXTURE_FORMAT),
    saveVersion: z.number().int().min(1),
    milestone: z.string().min(1),
    world: z.object({ seed: z.number().int(), worldSize: z.string(), dayLengthMinutes: z.number().int() }).strict(),
    facts: saveFactsSchema,
    dump: z.unknown(),
  })
  .strict();

/** Plays the scenario, saves it into a store and returns the fixture of the current save version. */
export async function buildFixture(): Promise<SaveFixture> {
  const sim = playFixtureScenario();
  const store = new MemorySaveStore();
  await saveWorld(store, sim, { worldId: FIXTURE_WORLD_ID, name: FIXTURE_WORLD_NAME, now: FIXTURE_SAVED_AT, gameVersion: FIXTURE_GAME_VERSION });
  const dump = await exportWorld(store, FIXTURE_WORLD_ID);
  if (dump.saveVersion !== CURRENT_SAVE_VERSION.version) throw new Error(`Fixture: the save has version ${dump.saveVersion}, the build writes ${CURRENT_SAVE_VERSION.version}`);
  return {
    format: SAVE_FIXTURE_FORMAT,
    saveVersion: dump.saveVersion,
    milestone: CURRENT_SAVE_VERSION.milestone,
    world: { ...FIXTURE_WORLD },
    facts: saveFacts(sim),
    dump,
  };
}

/** The fixture as text (canonical JSON with tagged typed arrays, indented; see `worldDumpText`). */
export function fixtureText(fixture: SaveFixture): string {
  return `${JSON.stringify(JSON.parse(canonicalJson(fixture)), null, 1)}\n`;
}

/** Parses and validates a fixture text. */
export function parseFixtureText(text: string): SaveFixture {
  const raw = fixtureEnvelopeSchema.parse(parseCanonical(text));
  return { ...raw, format: SAVE_FIXTURE_FORMAT, dump: parseWorldDump(raw.dump) };
}

/** Reads the fixture file of save version `version`. */
export function readFixture(version: number, root = process.cwd()): SaveFixture {
  return parseFixtureText(readFileSync(resolve(root, fixtureFile(version)), 'utf8'));
}

/** Loads a fixture the way a player's save loads: into a store (`store`, default a fresh one), then `loadWorld` (migrations included). */
export async function loadFixture(fixture: SaveFixture, store: SaveStore = new MemorySaveStore()): Promise<Simulation> {
  const meta = await importWorld(store, fixture.dump);
  return loadWorld(store, meta.id);
}

/** Writes the fixture of the current save version; returns its path. Older versions' fixtures are never written. */
export async function writeCurrentFixture(root = process.cwd()): Promise<string> {
  const fixture = await buildFixture();
  const newest = SAVE_VERSIONS[SAVE_VERSIONS.length - 1];
  if (newest === undefined || fixture.saveVersion !== newest.version) throw new Error('Fixture: only the current save version gets a new fixture');
  const file = resolve(root, fixtureFile(fixture.saveVersion));
  writeFileSync(file, fixtureText(fixture));
  return file;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const file = await writeCurrentFixture();
  const f = readFixture(CURRENT_SAVE_VERSION.version);
  console.log(
    `fixture:save: ${file} – Save-Version ${f.saveVersion} (${f.milestone}), Tick ${f.facts.tick}, ${f.facts.bags.length} Stapel, ${f.facts.graves.length} Grab, ${f.dump.chunks.length} geänderte Chunks`,
  );
}
