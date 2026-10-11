/**
 * Contribution of strand E (Küche & Vorrat) to the reference save of save version 4 (docs/SPIEL.md §27 "Kiste mit verderbendem
 * Essen + Vorratsfass, Regensammler halb voll, aktive Mahlzeit-Effekte + Überdruss"; §21; M7-25 … M7-30): made by commands only,
 * and its facts for the migration test – read through the public API of the storage, water, meals and conditions systems
 * (`chests`, `all`, `boredDishes`, `active`), never from the snapshot layout.
 *
 * Three parts, because the rain collector needs a dawn – the field part's (tools/save/fixtureM7/feld.ts `playFeld` jumps a day),
 * so the scenario keeps its timeline – and the meal effects must still last when the save is made:
 * - `playKuecheVorrat(sim)`: a wooden chest with bread and apples and a pantry barrel with smoked fish and bread on the first free
 *   tiles around the player; a rain collector under the open sky in the nearest neighbouring weather region of the home's
 *   biome, and rain forced over that region only – the home region keeps its own weather, so the base's fires later in the
 *   scenario light as they did before. Use (integrator, tools/save/fixture.ts): right after `player.spawn`, before `playFeld`.
 * - `playKuecheWasser(sim)`: after the field part's day: back at the collector, whose chunk wakes and catches the dawn's rain
 *   up; two empty buckets filled there (`water.fill`) leave it at most half full (the buckets of boiled water stay in the
 *   bags); the food has spoiled the day (the barrel's a quarter slower). Use: right after `playFeld`.
 * - `playKuecheMahl(sim)`: two bowls of stew (condition `gestaerkt`, the stew's boredom 2) and a bowl of fish soup
 *   (`ausdauernd`): two meal effects active and one dish bored. Use: right before the fight (the effects last 600 s; the fight
 *   stays the last thing played before the world settings).
 * Every step checks its effect and throws when it is missing (the fixture world is fixed: seed 3, small). `kuecheFacts(sim)`
 * beside `saveFacts`; fixtures of versions 1–3 load with `EMPTY_KUECHE_FACTS` (no collector, no meal effect, no boredom before
 * M7: the participants `spoilage`, `water` and `meals` migrate from 0; the chests of v2/v3 hold no food).
 */
import { z } from 'zod';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { consumeTicks } from '../../../src/game/actions/formulas';
import type { GameCommand } from '../../../src/game/commands';
import type { ConditionsSystem } from '../../../src/game/conditions/system';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { MealsSystem } from '../../../src/game/meals/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import type { Simulation } from '../../../src/game/sim';
import { StorageSystem } from '../../../src/game/storage/system';
import { WaterSystem } from '../../../src/game/water/system';
import { TILE_PX } from '../../../src/world/model/coords';

/** Ticks for the zone to stream the chunks around a teleport target. */
const SETTLE_TICKS = 30;
/** How far around the player a free tile is searched [tiles]. */
const SEARCH_TILES = 12;
/** Hotbar slot the fixture holds its items in. */
const HAND_SLOT = 9;
/** What goes into the chest and the pantry barrel (food with a shelf life of days: spoiling, not rotten, at the save). */
const CHEST_FOOD: ReadonlyArray<readonly [string, number]> = [
  ['brot', 3],
  ['apfel', 4],
];
const BARREL_FOOD: ReadonlyArray<readonly [string, number]> = [
  ['raeucherfisch', 3],
  ['brot', 2],
];
/** Empty buckets filled at the collector (five sips each) – at most half of it stays. */
const BUCKETS = 2;
/** The meals: the stew twice (bored), the fish soup once. */
const MEALS: ReadonlyArray<readonly [string, number]> = [
  ['eintopf', 2],
  ['fischsuppe', 1],
];
/** The condition group of meal effects (`BALANCE.meals.maxMealEffects` of them at once). */
const MEAL_GROUP = 'mahlzeit';

function system<T>(sim: Simulation, id: string, kind: abstract new (...args: never[]) => T): T {
  const s = sim.system(id);
  if (!(s instanceof kind)) throw new Error(`kueche: die Simulation hat kein System ${id}`);
  return s;
}

/** Runs `commands` then `ticks − 1` more ticks; throws if a command was refused. Returns the event types seen. */
function run(sim: Simulation, what: string, commands: readonly GameCommand[], ticks = 1): Set<string> {
  const seen = new Set<string>();
  const refused: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? commands : undefined);
    sim.events.drain((type, payload) => {
      seen.add(type);
      if (type === 'commandRejected') refused.push(JSON.stringify(payload));
    });
  }
  if (refused.length > 0) throw new Error(`Fixture-Szenario (Küche): ${what} abgelehnt: ${refused.join(', ')}`);
  return seen;
}

/** Runs `commands` once and reports whether none was refused (a try at a candidate tile). */
function attempt(sim: Simulation, commands: readonly GameCommand[]): boolean {
  let refused = false;
  sim.step(commands);
  sim.events.drain((type, _payload) => {
    if (type === 'commandRejected') refused = true;
  });
  return !refused;
}

function teleport(tx: number, ty: number): GameCommand {
  return { type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 0.5) * TILE_PX, layer: 0 };
}

/** Tiles around (tx, ty) in rings outwards, up to `SEARCH_TILES`. */
function* rings(tx: number, ty: number): Generator<readonly [number, number]> {
  for (let r = 1; r <= SEARCH_TILES; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) yield [tx + dx, ty + dy];
  }
}

/** The bag slot holding `item` (inventory first, then hotbar). */
function slotOf(sim: Simulation, item: string): { bereich: 'inventar' | 'schnellleiste'; index: number } {
  const state = (sim.system('inventory') as InventorySystem).state;
  for (const bereich of ['inventar', 'schnellleiste'] as const) {
    const index = state[bereich].findIndex((s) => s?.item === item);
    if (index >= 0) return { bereich, index };
  }
  throw new Error(`Fixture-Szenario (Küche): ${item} fehlt in den Taschen`);
}

/** Moves `item` into the hand (hotbar slot `HAND_SLOT`, selected). */
function hold(sim: Simulation, item: string): void {
  const from = slotOf(sim, item);
  const moves: GameCommand[] = from.bereich === 'schnellleiste' && from.index === HAND_SLOT ? [] : [{ type: 'inventory.move', from, to: { bereich: 'schnellleiste', index: HAND_SLOT } }];
  run(sim, `${item} in die Hand`, [...moves, { type: 'player.selectHotbar', index: HAND_SLOT }]);
}

/**
 * The centre of the plan cell nearest (tx, ty) that lies on land in another weather region of the same biome [tiles]: rain
 * forced there falls on nothing else of the scenario.
 */
function neighbourRegion(sim: Simulation, tx: number, ty: number): { tx: number; ty: number } {
  const plan = sim.world.generated.plan;
  const { width, height, cellTiles } = plan.grid;
  const home = sim.world.regionAt(tx, ty);
  const biome = plan.regions[home]?.biome;
  let best: { tx: number; ty: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let cy = 1; cy < height - 1; cy++) {
    for (let cx = 1; cx < width - 1; cx++) {
      const c = cy * width + cx;
      const r = plan.region[c] as number;
      if (plan.land[c] !== 1 || r < 0 || r === home || plan.regions[r]?.biome !== biome) continue;
      const x = Math.floor((cx + 0.5) * cellTiles);
      const y = Math.floor((cy + 0.5) * cellTiles);
      const d = (x - tx) ** 2 + (y - ty) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { tx: x, ty: y };
      }
    }
  }
  if (best === null) throw new Error(`Fixture-Szenario (Küche): keine Nachbarregion im Biom ${String(biome)}`);
  return best;
}

/** Places build part `part` (given before) on the first free tile around (tx, ty) the player stands south of; returns it. */
function placeNear(sim: Simulation, part: string, tx: number, ty: number): { tx: number; ty: number } {
  for (const [x, y] of rings(tx, ty)) {
    run(sim, 'vor den Platz', [teleport(x, y + 2)]);
    if (attempt(sim, [{ type: 'build.place', part, tx: x, ty: y }])) return { tx: x, ty: y };
  }
  throw new Error(`Fixture-Szenario (Küche): kein Platz für ${part} um ${tx},${ty}`);
}

/** Puts `food` (given first) into the chest at (tx, ty), standing beside it. */
function store(sim: Simulation, at: { tx: number; ty: number }, food: ReadonlyArray<readonly [string, number]>): void {
  const chest = system(sim, 'storage', StorageSystem).chestAt(0, at.tx, at.ty);
  if (chest === undefined) throw new Error(`Fixture-Szenario (Küche): auf ${at.tx},${at.ty} steht kein Behälter`);
  run(sim, 'an den Behälter', [teleport(at.tx, at.ty + 1)]);
  for (const [item, count] of food) {
    run(sim, `${item} holen`, [{ type: 'inventory.give', item, count }]);
    run(sim, `${item} einlagern`, [{ type: 'storage.put', chest: chest.id, from: slotOf(sim, item), count }]);
  }
}

/** Plays the store part of the reference save (see module comment); throws if a step does not have its effect. */
export function playKuecheVorrat(sim: Simulation): void {
  const player = sim.system('player') as PlayerSystem;
  const inventory = sim.system('inventory') as InventorySystem;
  const water = system(sim, 'water', WaterSystem);
  const at = { x: 0, y: 0 };
  if (!player.position(sim, at)) throw new Error('Fixture-Szenario (Küche): kein Spieler');
  const home = { tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) };
  const selected = inventory.state.auswahl;
  run(sim, 'Bauteile', [
    { type: 'inventory.give', item: 'kiste_holz', count: 1 },
    { type: 'inventory.give', item: 'vorratsfass', count: 1 },
    { type: 'inventory.give', item: 'regensammler', count: 1 },
  ]);
  const chest = placeNear(sim, 'kiste_holz', home.tx, home.ty);
  const barrel = placeNear(sim, 'vorratsfass', home.tx, home.ty);
  store(sim, chest, CHEST_FOOD);
  store(sim, barrel, BARREL_FOOD);
  const field = neighbourRegion(sim, home.tx, home.ty);
  run(sim, 'in die Nachbarregion', [teleport(field.tx, field.ty)], SETTLE_TICKS);
  const collector = placeNear(sim, 'regensammler', field.tx, field.ty);
  if (water.collectorAt(0, collector.tx, collector.ty) === undefined) throw new Error('Fixture-Szenario (Küche): der Regensammler fehlt');
  // Rain over the collector's region: the forced weather begins at the next world tick (the climate log hears it there).
  run(sim, 'Regen', [{ type: 'setWeather', state: 'regen', tx: collector.tx, ty: collector.ty }], 2 * sim.clock.worldTickInterval);
  run(sim, 'zurück', [teleport(home.tx, home.ty), { type: 'player.selectHotbar', index: selected }], SETTLE_TICKS);
}

/** The rain collector of the scenario (the only one; placed by `playKuecheVorrat`). */
function theCollector(water: WaterSystem): { tx: number; ty: number } {
  const all = [...water.all];
  const c = all[0];
  if (all.length !== 1 || c === undefined) throw new Error(`Fixture-Szenario (Küche): ${all.length} Regensammler statt einem`);
  return { tx: c.tx, ty: c.ty };
}

/** Plays the water part of the reference save after a dawn (see module comment); throws if a step does not have its effect. */
export function playKuecheWasser(sim: Simulation): void {
  const player = sim.system('player') as PlayerSystem;
  const inventory = sim.system('inventory') as InventorySystem;
  const water = system(sim, 'water', WaterSystem);
  const at = { x: 0, y: 0 };
  if (!player.position(sim, at)) throw new Error('Fixture-Szenario (Küche): kein Spieler');
  const home = { tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) };
  const selected = inventory.state.auswahl;
  const collector = theCollector(water);
  // Back at the collector: its chunk wakes and catches the dawn's rain up.
  run(sim, 'zum Regensammler', [{ type: 'inventory.give', item: 'holzeimer', count: BUCKETS }, teleport(collector.tx, collector.ty + 1)], SETTLE_TICKS);
  const full = water.collectorAt(0, collector.tx, collector.ty)?.fill ?? 0;
  if (full <= 0) throw new Error('Fixture-Szenario (Küche): kein Regen im Sammler');
  // Two empty buckets filled at the collector: at most half of it stays.
  const half = BALANCE.water.collector.capacityMinutes / 2;
  for (let i = 0; i < BUCKETS && (water.collectorAt(0, collector.tx, collector.ty)?.fill ?? 0) > half; i++) {
    hold(sim, 'holzeimer');
    run(sim, 'Eimer füllen', [{ type: 'water.fill', tx: collector.tx, ty: collector.ty }]);
  }
  const left = water.collectorAt(0, collector.tx, collector.ty)?.fill ?? 0;
  if (left <= 0 || left > half) throw new Error(`Fixture-Szenario (Küche): der Regensammler ist nicht halb voll (${left} von ${BALANCE.water.collector.capacityMinutes})`);
  const facts = kuecheFacts(sim);
  if (!facts.vorrat.some((v) => v.behaelter === 'kiste' && v.stapel.some((s) => s.frische < 100))) throw new Error('Fixture-Szenario (Küche): in der Kiste verdirbt nichts');
  run(sim, 'zurück', [teleport(home.tx, home.ty), { type: 'player.selectHotbar', index: selected }], SETTLE_TICKS);
}

/** Plays the meal part of the reference save (see module comment); throws if a step does not have its effect. */
export function playKuecheMahl(sim: Simulation): void {
  const inventory = sim.system('inventory') as InventorySystem;
  const selected = inventory.state.auswahl;
  for (const [item, count] of MEALS) {
    run(sim, `${item} holen`, [{ type: 'inventory.give', item, count }]);
    const ticks = consumeTicks(CONTENT.collection('items').get(item).kategorie as Parameters<typeof consumeTicks>[0]) + 2;
    for (let n = 0; n < count; n++) {
      const seen = run(sim, `${item} essen`, [{ type: 'action.eat', from: slotOf(sim, item) }], ticks);
      if (!seen.has('mealEaten')) throw new Error(`Fixture-Szenario (Küche): ${item} nicht gegessen`);
    }
  }
  run(sim, 'Auswahl', [{ type: 'player.selectHotbar', index: selected }]);
  const facts = kuecheFacts(sim);
  if (facts.mahlzeit.length !== BALANCE.meals.maxMealEffects) throw new Error(`Fixture-Szenario (Küche): ${facts.mahlzeit.length} Mahlzeit-Effekte statt ${BALANCE.meals.maxMealEffects}`);
  if (!facts.ueberdruss.some(([item, n]) => item === 'eintopf' && n >= BALANCE.meals.boredom.from)) throw new Error('Fixture-Szenario (Küche): kein Überdruss am Eintopf');
}

/** Facts of the kitchen: the food in chests and pantry barrels, the rain collectors, the active meal effects, boredom. */
export const kuecheFactsSchema = z
  .object({
    vorrat: z.array(
      z
        .object({
          behaelter: z.enum(['kiste', 'vorratsfass']),
          layer: z.number().int(),
          tx: z.number().int(),
          ty: z.number().int(),
          stapel: z.array(z.object({ item: z.string(), anzahl: z.number().int().min(1), frische: z.number().min(0).max(100) }).strict()),
        })
        .strict(),
    ),
    sammler: z.array(z.object({ layer: z.number().int(), tx: z.number().int(), ty: z.number().int(), fuellung: z.number().int().min(0), ueberdacht: z.boolean() }).strict()),
    mahlzeit: z.array(z.object({ zustand: z.string(), sekunden: z.number().min(0) }).strict()),
    ueberdruss: z.array(z.tuple([z.string(), z.number().min(0)])),
  })
  .strict();
export type KuecheFacts = z.output<typeof kuecheFactsSchema>;

/** A world before M7: no food in store (the chests of v2/v3 hold none), no collector, no meal effect, no boredom. */
export const EMPTY_KUECHE_FACTS: KuecheFacts = { vorrat: [], sammler: [], mahlzeit: [], ueberdruss: [] };

/** The kitchen's facts of `sim`, read through the storage, water, meals and conditions systems. */
export function kuecheFacts(sim: Simulation): KuecheFacts {
  const vorrat: KuecheFacts['vorrat'] = [];
  for (const c of system(sim, 'storage', StorageSystem).chests) {
    const stapel: KuecheFacts['vorrat'][number]['stapel'] = [];
    for (const s of c.slots) if (s !== null && s.frische !== undefined) stapel.push({ item: s.item, anzahl: s.count, frische: s.frische });
    if (stapel.length > 0) vorrat.push({ behaelter: c.item === 'vorratsfass' ? 'vorratsfass' : 'kiste', layer: c.layer, tx: c.tx, ty: c.ty, stapel });
  }
  const sammler: KuecheFacts['sammler'] = [];
  for (const c of system(sim, 'water', WaterSystem).all) sammler.push({ layer: c.layer, tx: c.tx, ty: c.ty, fuellung: c.fill, ueberdacht: c.sheltered });
  const conditions = sim.system('conditions') as ConditionsSystem;
  const defs = CONTENT.collection('conditions');
  const mahlzeit: KuecheFacts['mahlzeit'] = [];
  for (const c of conditions.active()) {
    if (defs.get(c.id).gruppe !== MEAL_GROUP) continue;
    mahlzeit.push({ zustand: c.id, sekunden: conditions.remainingSeconds(c.id, sim.clock.tickHz) ?? 0 });
  }
  const ueberdruss = system(sim, 'meals', MealsSystem).boredDishes();
  return { vorrat, sammler, mahlzeit, ueberdruss };
}
