/**
 * M3-16 Crafting-Kern + Grundlagen ohne Station (MASTERPROMPT §15.1, §23.2; docs/SPIEL.md §6):
 * - Rezepte der Grundlagen (Faserseil, Steinwerkzeuge, Holzeimer, Fackel, Lagerfeuer, Werkbank, Verband,
 *   Grasbett, Steinspeer) ohne Station; der Validator zählt ≥ 12 Rezepte.
 * - Sichtbarkeit: jede Zutat einmal besessen und die Station bekannt; Baupläne schalten frei.
 * - Herstellen aus dem Inventar (und über den Haken aus Kisten im Umkreis von 8 Tiles, abschaltbar),
 *   Mengenwahl, Warteschlange (10), Abbrechen erstattet vollständig (Frische, Haltbarkeit), Handwerk-EP und
 *   -Bonus, Station und Wasser in Reichweite, volle Taschen, Tod.
 * - Die reinen Formeln des Crafting-Kerns.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { ITEMS } from '../../../src/content/items/index';
import { RECIPES } from '../../../src/content/recipes/index';
import { defineRecipeGroup, RecipeGroupError } from '../../../src/content/recipes/define';
import { isRecipeIdFor, recipeIdFor, recipeSchema, type RecipeDef, type RecipeInput } from '../../../src/content/recipes/schema';
import { CRAFT_SKILL, CRAFT_XP_SOURCE, CraftingSystem } from '../../../src/game/crafting/system';
import { CRAFTING_SFX, craftCompletedSound } from '../../../src/game/crafting/events';
import { RecipeBook, RecipeBookError, contentRecipeBook } from '../../../src/game/crafting/recipes';
import {
  affordablePieces,
  craftSeconds,
  craftTicks,
  freshWaterWithin,
  keptState,
  ownedItems,
  pieceShare,
  recipeVisible,
  splitReservation,
  takeUsable,
  usableCount,
} from '../../../src/game/crafting/formulas';
import type { CraftingStore } from '../../../src/game/crafting/sources';
import { emptyBags, withSlot } from '../../../src/game/inventory/bags';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { newStack, type ItemStack } from '../../../src/game/items/stack';
import type { GameCommand } from '../../../src/game/commands';
import { ToolsSystem } from '../../../src/game/tools/system';
import { WATER_DEPTH_DEEP, WATER_FROZEN, WATER_SEA } from '../../../src/world/model/chunk';
import { TILE_PX } from '../../../src/world/model/coords';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { meadow } from './spieler-testwelt';

const TICK_HZ = BALANCE.time.tickHz;
const catalog = contentItemCatalog();

/** The basics of docs/SPIEL.md §6 "Grundlagen ohne Station" and the T0 tools. */
function canonical(label: string): string[] {
  const doc = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');
  const line = doc.split('\n').find((l) => l.includes(label));
  if (line === undefined) throw new Error(`docs/SPIEL.md §6 has no line ${label}`);
  return [...line.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1] as string);
}

/** A crafting world: the life test world plus crafting and item use, the player on drawn tile (2, 2). */
interface CraftWorld extends LifeWorld {
  readonly crafting: CraftingSystem;
  readonly tools: ToolsSystem;
  readonly spilled: { stack: ItemStack; x: number; y: number }[];
  give(item: string, count: number, frische?: number): void;
  has(item: string): number;
}

function craftWorld(rows: readonly string[] = meadow(12, 8), recipes?: RecipeBook): CraftWorld {
  const w = lifeWorld(rows);
  const spilled: CraftWorld['spilled'] = [];
  const crafting = w.sim.addSystem(
    new CraftingSystem({
      player: w.player,
      inventory: w.inventory,
      collision: w.collision,
      spill: (_s, stack, _layer, x, y) => spilled.push({ stack, x, y }),
      ...(recipes === undefined ? {} : { recipes }),
    }),
  );
  const tools = w.sim.addSystem(new ToolsSystem({ player: w.player, inventory: w.inventory }));
  crafting.useSkills(w.life.skills);
  tools.useLife(w.life);
  w.spawn(2, 2);
  return {
    ...w,
    crafting,
    tools,
    spilled,
    give(item, count, frische) {
      w.inventory.give(w.sim, item, count, frische === undefined ? {} : { frische });
    },
    has(item) {
      return w.inventory.count(item);
    },
  };
}

/** Types of the events of `events` (a map by type) that belong to crafting, in no particular order. */
function count(events: Map<string, unknown[]>, type: string): number {
  return events.get(type)?.length ?? 0;
}

function start(recipe: string, n = 1): GameCommand {
  return { type: 'craft.start', recipe, count: n };
}

function rejections(events: Map<string, unknown[]>): string[] {
  return (events.get('commandRejected') ?? []).map((e) => (e as { reason: string }).reason);
}

/** Ticks of one piece of `recipe` for the world's current Handwerk bonus. */
function pieceTicks(w: CraftWorld, recipe: string): number {
  return craftTicks(craftSeconds(w.crafting.recipes.get(recipe)), w.life.skills.bonus(CRAFT_SKILL));
}

/** Fixture recipes on the game's items: one at the workbench, one from a blueprint, one from berries (freshness). */
function fixtureBook(): RecipeBook {
  const extra = defineRecipeGroup('proben', [
    { id: 'rezept_fackel_werkbank', ergebnis: { item: 'fackel', anzahl: 1 }, zutaten: [{ item: 'zweig', anzahl: 1 }], station: 'werkbank', dauer: 'handgriff' },
    { id: 'rezept_verband_bauplan', ergebnis: { item: 'verband', anzahl: 2 }, zutaten: [{ item: 'laub', anzahl: 1 }], station: null, dauer: 'handgriff', bauplan: { quellen: ['haendlerin'] } },
    { id: 'rezept_faserseil_beeren', ergebnis: { item: 'faserseil', anzahl: 1 }, zutaten: [{ item: 'himbeeren', anzahl: 2 }], station: null, dauer: 'handgriff' },
  ]);
  return new RecipeBook([...RECIPES, ...extra], catalog);
}

describe('Rezepte der Grundlagen', () => {
  it('jede Grundlage und jedes T0-Werkzeug aus docs/SPIEL.md §6 hat ihr Rezept rezept_<id> ohne Station', () => {
    const basics = canonical('**Grundlagen ohne Station (M3-16)**');
    const tools = canonical('**Werkzeuge T0 (M3-15)**').filter((id) => id !== 'holzeimer_wasser');
    expect(basics).toEqual(['faserseil', 'fackel', 'lagerfeuer', 'werkbank', 'verband', 'grasbett', 'steinspeer']);
    for (const id of [...basics, ...tools]) {
      const r = CONTENT.collection('recipes').find(recipeIdFor(id));
      expect(r, id).toBeDefined();
      expect(r?.station, id).toBeNull();
      expect(r?.ergebnis.item).toBe(id);
    }
  });

  it('der Validator zählt ≥ 12 Rezepte, und die Zielwerte-Datei verlangt sie', () => {
    expect(CONTENT.countsByCategory().recipes).toBe(RECIPES.length);
    expect(RECIPES.length).toBeGreaterThanOrEqual(12);
    const targets = JSON.parse(readFileSync(join(process.cwd(), 'tools/validator/zielwerte.json'), 'utf8')) as { ziele: { recipes: number } };
    expect(targets.ziele.recipes).toBeGreaterThanOrEqual(12);
    expect(targets.ziele.recipes).toBeLessThanOrEqual(RECIPES.length);
  });

  it('jedes Rezept passt zum Item-Katalog; die ersten Werkzeuge brauchen nur, was am Boden liegt', () => {
    expect(() => contentRecipeBook(catalog)).not.toThrow();
    const byHand = new Set(['zweig', 'stein', 'feuerstein', 'fasern', 'laub', 'faserseil']);
    for (const id of ['rezept_faserseil', 'rezept_steinaxt', 'rezept_steinspitzhacke', 'rezept_steinschaufel', 'rezept_steinmesser', 'rezept_steinspeer']) {
      expect(CONTENT.collection('recipes').get(id).zutaten.every((z) => byHand.has(z.item)), id).toBe(true);
    }
    // Filling the bucket needs water and keeps the bucket's durability.
    const fill = CONTENT.collection('recipes').get('rezept_holzeimer_wasser');
    expect(fill).toMatchObject({ umgebung: 'wasser', behaelt: 'haltbarkeit', zutaten: [{ item: 'holzeimer', anzahl: 1 }], name: { de: 'Eimer füllen', en: 'Fill Bucket' } });
  });

  it('das Schema lehnt falsch benannte, doppelte und widersprüchliche Rezepte ab', () => {
    const base: RecipeInput = { id: 'rezept_faserseil', ergebnis: { item: 'faserseil', anzahl: 1 }, zutaten: [{ item: 'fasern', anzahl: 3 }], station: null, dauer: 'handgriff' };
    const issues = (r: RecipeInput): string[] => {
      const res = recipeSchema.safeParse(r);
      return res.success ? [] : res.error.issues.map((i) => String(i.path[0]));
    };
    expect(issues(base)).toEqual([]);
    expect(issues({ ...base, id: 'rezept_seil' })).toEqual(['id']);
    expect(issues({ ...base, zutaten: [{ item: 'fasern', anzahl: 1 }, { item: 'fasern', anzahl: 2 }] })).toEqual(['zutaten']);
    expect(issues({ ...base, zutaten: [{ item: 'faserseil', anzahl: 1 }] })).toEqual(['zutaten']);
    expect(issues({ ...base, station: 'fasern' })).toEqual(['station']);
    expect(issues({ ...base, behaelt: 'haltbarkeit', zutaten: [{ item: 'fasern', anzahl: 3 }] })).toEqual(['behaelt']);
    expect(issues({ ...base, bauplan: { quellen: ['rezept:rezept_x'] } })).toEqual(['bauplan']);
    expect(isRecipeIdFor('rezept_verband_wegerich', 'verband')).toBe(true);
    expect(isRecipeIdFor('rezept_verbandx', 'verband')).toBe(false);
    expect(() => defineRecipeGroup('doppelt', [base, base])).toThrow(RecipeGroupError);
    // The book checks against the catalog: unknown items, a station that is not placeable, a kept durability without a durable ingredient.
    expect(() => new RecipeBook([{ ...base, zutaten: [{ item: 'mondstaub', anzahl: 1 }] } as RecipeDef], catalog)).toThrow(RecipeBookError);
    expect(() => new RecipeBook([{ ...base, station: 'steinaxt' } as RecipeDef], catalog)).toThrow(/not placeable/);
    expect(() => new RecipeBook([{ ...base, behaelt: 'haltbarkeit', zutaten: [{ item: 'fasern', anzahl: 1 }] } as RecipeDef], catalog)).toThrow(/durability/);
  });
});

describe('Sichtbarkeit (§15.1)', () => {
  it('ein Rezept wird sichtbar, sobald jede Zutat einmal besessen wurde – und bleibt es', () => {
    const w = craftWorld();
    expect(w.crafting.visibleRecipes()).toEqual([]);
    expect(rejections(w.run(1, [start('rezept_faserseil')]))).toEqual(['recipeHidden']);
    w.give('fasern', 3);
    const found = w.run(1);
    expect(found.get('recipeDiscovered')).toEqual([{ recipe: 'rezept_faserseil', tick: expect.any(Number) }]);
    w.give('zweig', 2);
    w.give('stein', 2);
    w.run(1);
    expect(w.crafting.isVisible('rezept_steinaxt')).toBe(false);
    // Making the rope: now every ingredient of the stone axe was owned – the fibres are used up, the recipe stays.
    w.run(1, [start('rezept_faserseil')]);
    const made = w.run(pieceTicks(w, 'rezept_faserseil') + 1);
    expect(made.get('recipeDiscovered')).toEqual(expect.arrayContaining([expect.objectContaining({ recipe: 'rezept_steinaxt' }), expect.objectContaining({ recipe: 'rezept_steinschaufel' })]));
    expect(w.has('fasern')).toBe(0);
    expect(w.crafting.isVisible('rezept_faserseil')).toBe(true);
    expect(w.crafting.hasOwned('fasern')).toBe(true);
    expect(rejections(w.run(1, [{ type: 'craft.start', recipe: 'rezept_mondstaub', count: 1 }]))).toEqual(['unknownRecipe']);
  });

  it('ein Rezept an einer Station wird erst sichtbar, wenn die Station bekannt ist; herstellbar nur an ihr', () => {
    const w = craftWorld(meadow(12, 8), fixtureBook());
    w.give('zweig', 3);
    w.run(1);
    expect(w.crafting.isVisible('rezept_fackel_werkbank')).toBe(false);
    w.crafting.meetStation(w.sim, 'werkbank');
    expect(w.crafting.isVisible('rezept_fackel_werkbank')).toBe(true);
    expect(rejections(w.run(1, [start('rezept_fackel_werkbank')]))).toEqual(['noStation']);
    const asked: { radius: number; station: string }[] = [];
    w.crafting.addStations((_s, _layer, _x, _y, radius, station) => {
      asked.push({ radius, station });
      return true;
    });
    const ok = w.run(pieceTicks(w, 'rezept_fackel_werkbank') + 1, [start('rezept_fackel_werkbank')]);
    expect(count(ok, 'craftCompleted')).toBe(1);
    expect(w.has('fackel')).toBe(1);
    expect(asked[0]).toEqual({ radius: BALANCE.crafting.stationRadiusTiles * TILE_PX, station: 'werkbank' });
    // Owning the station item counts as knowing it.
    const v = craftWorld(meadow(12, 8), fixtureBook());
    v.give('zweig', 1);
    v.give('werkbank', 1);
    v.run(1);
    expect(v.crafting.isVisible('rezept_fackel_werkbank')).toBe(true);
  });

  it('ein Rezept mit Bauplan bleibt verborgen, bis der Bauplan gelernt ist', () => {
    const w = craftWorld(meadow(12, 8), fixtureBook());
    w.give('laub', 2);
    w.run(1);
    expect(w.crafting.isVisible('rezept_verband_bauplan')).toBe(false);
    expect(w.crafting.learnBlueprint(w.sim, 'rezept_faserseil')).toBe(false);
    expect(w.crafting.learnBlueprint(w.sim, 'rezept_verband_bauplan')).toBe(true);
    expect(w.crafting.learnBlueprint(w.sim, 'rezept_verband_bauplan')).toBe(false);
    expect(w.crafting.isVisible('rezept_verband_bauplan')).toBe(true);
    w.run(pieceTicks(w, 'rezept_verband_bauplan') + 1, [start('rezept_verband_bauplan')]);
    expect(w.has('verband')).toBe(2);
  });
});

describe('Herstellen aus dem Inventar', () => {
  it('Mengenwahl: die Zutaten aller Stücke werden sofort genommen, die Stücke entstehen nacheinander, je Stück Handwerk-EP', () => {
    const w = craftWorld();
    w.give('fasern', 10);
    w.run(1);
    const ticks = pieceTicks(w, 'rezept_faserseil');
    expect(ticks).toBe(Math.ceil((BALANCE.crafting.durationSeconds.handgriff * TICK_HZ) / (1 + w.life.skills.bonus(CRAFT_SKILL))));
    const queued = w.run(1, [start('rezept_faserseil', 3)]);
    expect(queued.get('craftQueued')).toEqual([expect.objectContaining({ recipe: 'rezept_faserseil', count: 3, index: 0 })]);
    expect(queued.get('craftStarted')).toEqual([expect.objectContaining({ recipe: 'rezept_faserseil', ticks })]);
    expect(w.has('fasern')).toBe(1);
    expect(w.crafting.orders[0]?.reserviert.reduce((n, s) => n + s.count, 0)).toBe(9);
    const first = w.run(ticks - 1);
    expect(count(first, 'craftCompleted')).toBe(1);
    expect(w.has('faserseil')).toBe(1);
    expect(w.crafting.orders[0]).toMatchObject({ anzahl: 2, fortschritt: 0, dauer: 0 });
    const rest = w.run(2 * ticks);
    expect(count(rest, 'craftCompleted')).toBe(2);
    expect(w.has('faserseil')).toBe(3);
    expect(w.crafting.orders).toEqual([]);
    const xp = [...(first.get('xpGained') ?? []), ...(rest.get('xpGained') ?? [])].filter((e) => (e as { source: string }).source === CRAFT_XP_SOURCE);
    expect(xp).toHaveLength(3);
    expect(w.life.skills.skill(CRAFT_SKILL).xp).toBeGreaterThan(0);
  });

  it('zu wenig Zutaten, volle Warteschlange (10), unbekannter Auftrag ⇒ abgelehnt, nichts genommen', () => {
    const w = craftWorld();
    w.give('fasern', 40);
    w.run(1);
    expect(rejections(w.run(1, [start('rezept_faserseil', 14)]))).toEqual(['notEnough']);
    expect(w.has('fasern')).toBe(40);
    const ten = Array.from({ length: BALANCE.crafting.queueLength }, () => start('rezept_faserseil'));
    expect(rejections(w.run(1, ten))).toEqual([]);
    expect(w.crafting.orders).toHaveLength(10);
    expect(rejections(w.run(1, [start('rezept_faserseil')]))).toEqual(['queueFull']);
    expect(w.has('fasern')).toBe(10);
    expect(rejections(w.run(1, [{ type: 'craft.cancel', index: 9 }, { type: 'craft.cancel', index: 9 }]))).toEqual(['noOrder']);
  });

  it('Abbrechen erstattet vollständig: die Zutaten der restlichen Stücke samt Frische kommen zurück', () => {
    const w = craftWorld(meadow(12, 8), fixtureBook());
    w.give('himbeeren', 6, 40);
    w.run(1);
    const ticks = pieceTicks(w, 'rezept_faserseil_beeren');
    w.run(ticks, [start('rezept_faserseil_beeren', 3)]);
    expect(w.has('faserseil')).toBe(1);
    expect(w.has('himbeeren')).toBe(0);
    // Halfway through the second piece: its berries and those of the third come back, freshness kept.
    w.run(Math.floor(ticks / 2));
    const cancelled = w.run(1, [{ type: 'craft.cancel', index: 0 }]);
    expect(cancelled.get('craftCancelled')).toEqual([expect.objectContaining({ recipe: 'rezept_faserseil_beeren', pieces: 2, reason: 'abgebrochen' })]);
    expect(w.has('himbeeren')).toBe(4);
    const berries = w.inventory.state.inventar.find((s) => s?.item === 'himbeeren');
    expect(berries?.frische).toBe(40);
    expect(w.crafting.orders).toEqual([]);
    expect(count(w.run(ticks + 1), 'craftCompleted')).toBe(0);
  });

  it('volle Taschen: das fertige Stück und Erstattungen landen vor den Füßen, nie verloren', () => {
    const w = craftWorld();
    const store = fakeStore({ fasern: 6 });
    w.crafting.addStores(() => [store]);
    // The fibres were owned once and thrown away; 40 stone axes fill the inventory and the hotbar; the fibres come from a chest.
    w.give('fasern', 1);
    w.run(1);
    w.run(1, [{ type: 'inventory.discard', from: { bereich: 'inventar', index: 0 } }]);
    w.give('steinaxt', BALANCE.items.bags.inventorySlots + BALANCE.items.bags.hotbarSlots);
    expect(w.inventory.roomFor(newStack(catalog.get('faserseil'), 1))).toBe(0);
    const pos = w.pos();
    w.run(1 + pieceTicks(w, 'rezept_faserseil'), [start('rezept_faserseil', 2)]);
    expect(w.spilled.map((s) => s.stack)).toEqual([{ item: 'faserseil', count: 1 }]);
    expect(w.spilled[0]).toMatchObject({ x: pos.x, y: pos.y });
    w.run(1, [{ type: 'craft.cancel', index: 0 }]);
    expect(w.spilled.slice(1).reduce((n, s) => n + (s.stack.item === 'fasern' ? s.stack.count : 0), 0)).toBe(3);
  });

  it('Kisten im Umkreis (Haken, 8 Tiles): was die Taschen nicht haben, kommt aus der Kiste – abschaltbar', () => {
    const w = craftWorld();
    const store = fakeStore({ fasern: 5 });
    const radii: number[] = [];
    w.crafting.addStores((_s, _layer, _x, _y, radius) => {
      radii.push(radius);
      return [store];
    });
    w.give('fasern', 1);
    w.run(1);
    expect(w.crafting.available(w.sim, 'fasern')).toBe(6);
    expect(w.crafting.affordable(w.sim, 'rezept_faserseil')).toBe(2);
    expect(rejections(w.run(1, [start('rezept_faserseil', 2)]))).toEqual([]);
    expect(w.has('fasern')).toBe(0);
    expect(store.left.fasern).toBe(0);
    expect(radii).toContain(BALANCE.crafting.chestRadiusTiles * TILE_PX);
    const off = craftWorld();
    off.crafting.addStores(() => [fakeStore({ fasern: 5 })]);
    off.give('fasern', 1);
    off.run(1, [{ type: 'craft.useChests', on: false }]);
    expect(off.crafting.usesChests).toBe(false);
    expect(rejections(off.run(1, [start('rezept_faserseil')]))).toEqual(['notEnough']);
  });

  it('Eimer füllen: nur mit Wasser in Reichweite und nur ein heiler Eimer; der volle Eimer ist derselbe (Haltbarkeit, Qualität)', () => {
    // Water two tiles east of the player (drawn tile 2, 2): the edge of tile 3 lies half a tile away.
    const rows = ['........', '........', '...ww...', '...ww...', '........'];
    const w = craftWorld(rows);
    w.inventory.giveStack(w.sim, { ...newStack(catalog.get('holzeimer'), 1, { qualitaet: 2 }), haltbarkeit: 37 });
    w.run(1);
    const filled = w.run(1 + pieceTicks(w, 'rezept_holzeimer_wasser'), [start('rezept_holzeimer_wasser')]);
    expect(count(filled, 'craftCompleted')).toBe(1);
    const full = w.inventory.state.schnellleiste.find((s) => s?.item === 'holzeimer_wasser');
    expect(full).toEqual({ item: 'holzeimer_wasser', count: 1, haltbarkeit: 37, qualitaet: 2 });
    expect(w.has('holzeimer')).toBe(0);
    // Away from the water: refused.
    const far = craftWorld(['........', '........', '........', '.......w']);
    far.give('holzeimer', 1);
    far.run(1);
    expect(rejections(far.run(1, [start('rezept_holzeimer_wasser')]))).toEqual(['noWater']);
    // A broken bucket is no ingredient.
    const broken = craftWorld(rows);
    broken.inventory.giveStack(broken.sim, { ...newStack(catalog.get('holzeimer'), 1), haltbarkeit: 0 });
    broken.run(1);
    expect(broken.crafting.isVisible('rezept_holzeimer_wasser')).toBe(true);
    expect(rejections(broken.run(1, [start('rezept_holzeimer_wasser')]))).toEqual(['notEnough']);
  });

  it('der Handwerk-Bonus verkürzt die Herstellzeit (+0,5 % Wirkung je Stufe)', () => {
    const w = craftWorld();
    w.crafting.useSkills({ bonus: () => 0.1, award: () => 0, hasSource: () => true });
    w.give('fasern', 3);
    w.run(1);
    const started = w.run(1, [start('rezept_faserseil')]);
    expect(started.get('craftStarted')).toEqual([expect.objectContaining({ ticks: Math.ceil((BALANCE.crafting.durationSeconds.handgriff * TICK_HZ) / 1.1) })]);
    expect(() => w.crafting.useSkills({ bonus: () => 0, award: () => 0, hasSource: () => false })).toThrow(/gegenstand_hergestellt/);
  });

  it('ohne Leben kein Handwerk: der Auftrag wartet; cancelAll erstattet alles', () => {
    const w = craftWorld();
    w.give('fasern', 6);
    w.run(1);
    w.run(5, [start('rezept_faserseil', 2)]);
    const before = w.crafting.orders[0]?.fortschritt ?? 0;
    w.vit().health = 0;
    w.run(3);
    expect(w.crafting.blocked).toBe('dead');
    expect(w.crafting.orders[0]?.fortschritt).toBe(before);
    expect(rejections(w.run(1, [start('rezept_faserseil')]))).toEqual(['dead']);
    w.crafting.cancelAll(w.sim, 'tod');
    expect(w.crafting.orders).toEqual([]);
    expect(w.has('fasern')).toBe(6);
  });
});

/** A chest stand-in holding `items` [item → pieces]. */
function fakeStore(items: Record<string, number>): CraftingStore & { left: Record<string, number> } {
  const left = { ...items };
  return {
    left,
    count: (item) => left[item] ?? 0,
    take: (_sim, item, n) => {
      left[item] = (left[item] ?? 0) - n;
      return [newStack(catalog.get(item), n)];
    },
  };
}

describe('Formeln des Crafting-Kerns', () => {
  const axe = CONTENT.collection('recipes').get('rezept_steinaxt');

  it('recipeVisible: Zutaten besessen, Station bekannt oder besessen, Bauplan gelernt', () => {
    const none = new Set<string>();
    expect(recipeVisible(axe, new Set(['zweig', 'stein']), none, none)).toBe(false);
    expect(recipeVisible(axe, new Set(['zweig', 'stein', 'faserseil']), none, none)).toBe(true);
    const bench = { ...axe, station: 'werkbank' };
    expect(recipeVisible(bench, new Set(['zweig', 'stein', 'faserseil']), none, none)).toBe(false);
    expect(recipeVisible(bench, new Set(['zweig', 'stein', 'faserseil']), new Set(['werkbank']), none)).toBe(true);
    expect(recipeVisible(bench, new Set(['zweig', 'stein', 'faserseil', 'werkbank']), none, none)).toBe(true);
    const plan = { ...axe, bauplan: { quellen: ['haendlerin'] } };
    expect(recipeVisible(plan, new Set(['zweig', 'stein', 'faserseil']), none, none)).toBe(false);
    expect(recipeVisible(plan, none, none, new Set([axe.id]))).toBe(true);
  });

  it('affordablePieces, craftSeconds, craftTicks', () => {
    const have: Record<string, number> = { zweig: 7, stein: 5, faserseil: 9 };
    expect(affordablePieces(axe, (i) => have[i] ?? 0)).toBe(2);
    expect(affordablePieces(axe, () => 0)).toBe(0);
    expect(craftSeconds(axe)).toBe(BALANCE.crafting.durationSeconds.werkzeug);
    expect(craftTicks(3, 0, 60)).toBe(180);
    expect(craftTicks(3, 0.05, 60)).toBe(172);
    expect(craftTicks(0.001, 0, 60)).toBe(1);
    expect(craftTicks(3, -1, 60)).toBe(180);
  });

  it('usableCount und takeUsable überspringen kaputte Stücke und nehmen die Schnellleiste zuletzt', () => {
    let bags = emptyBags();
    const bucket = newStack(catalog.get('holzeimer'), 1);
    bags = withSlot(bags, { bereich: 'schnellleiste', index: 0 }, bucket);
    bags = withSlot(bags, { bereich: 'inventar', index: 0 }, { ...bucket, haltbarkeit: 0 });
    bags = withSlot(bags, { bereich: 'inventar', index: 1 }, newStack(catalog.get('stein'), 4));
    bags = withSlot(bags, { bereich: 'schnellleiste', index: 1 }, newStack(catalog.get('stein'), 3));
    expect(usableCount(bags, 'holzeimer')).toBe(1);
    expect(usableCount(bags, 'stein')).toBe(7);
    const taken = takeUsable(bags, 'stein', 5);
    expect(taken?.taken).toEqual([{ item: 'stein', count: 4 }, { item: 'stein', count: 1 }]);
    expect(taken?.state.schnellleiste[1]).toEqual({ item: 'stein', count: 2 });
    expect(takeUsable(bags, 'holzeimer', 2)).toBeNull();
    expect(takeUsable(bags, 'holzeimer', 1)?.taken).toEqual([bucket]);
    expect([...ownedItems(bags, new Set())].sort()).toEqual(['holzeimer', 'stein']);
  });

  it('splitReservation und pieceShare teilen eine Reservierung in der Nehmreihenfolge', () => {
    const reserved: ItemStack[] = [
      { item: 'zweig', count: 3 },
      { item: 'stein', count: 1 },
      { item: 'zweig', count: 1 },
      { item: 'stein', count: 3 },
      { item: 'faserseil', count: 2 },
    ];
    expect(splitReservation(reserved, 'zweig', 2)).toEqual({ taken: [{ item: 'zweig', count: 2 }], rest: [{ item: 'zweig', count: 1 }, { item: 'stein', count: 1 }, { item: 'zweig', count: 1 }, { item: 'stein', count: 3 }, { item: 'faserseil', count: 2 }] });
    expect(() => splitReservation(reserved, 'harz', 1)).toThrow(RangeError);
    const share = pieceShare(axe, reserved);
    expect(share.consumed).toEqual([{ item: 'zweig', count: 2 }, { item: 'stein', count: 1 }, { item: 'stein', count: 1 }, { item: 'faserseil', count: 1 }]);
    expect(share.rest).toEqual([{ item: 'zweig', count: 1 }, { item: 'zweig', count: 1 }, { item: 'stein', count: 2 }, { item: 'faserseil', count: 1 }]);
  });

  it('keptState: der gefüllte Eimer übernimmt Haltbarkeit und Qualität, gedeckelt auf sein Maximum', () => {
    const fill = CONTENT.collection('recipes').get('rezept_holzeimer_wasser');
    const full = catalog.get('holzeimer_wasser');
    expect(keptState(fill, full, [{ item: 'holzeimer', count: 1, haltbarkeit: 12, qualitaet: 3 }])).toEqual({ haltbarkeit: 12, qualitaet: 3 });
    expect(keptState(fill, full, [{ item: 'holzeimer', count: 1, haltbarkeit: 999 }])).toEqual({ haltbarkeit: full.haltbarkeit, qualitaet: 1 });
    expect(keptState(axe, catalog.get('steinaxt'), [{ item: 'zweig', count: 2 }])).toBeNull();
  });

  it('freshWaterWithin: Fluss, See und Quelle zählen, Meer und Eis nicht; Abstand bis zur Kachelkante', () => {
    const at = (map: Record<string, number>) => (tx: number, ty: number) => map[`${tx},${ty}`] ?? 0;
    const x = 2.5 * TILE_PX;
    const y = 2.5 * TILE_PX;
    const reach = BALANCE.crafting.waterReachTiles * TILE_PX;
    expect(freshWaterWithin(x, y, reach, at({ '4,2': WATER_DEPTH_DEEP }))).toBe(true);
    expect(freshWaterWithin(x, y, reach, at({ '5,2': WATER_DEPTH_DEEP }))).toBe(false);
    expect(freshWaterWithin(x, y, reach, at({ '4,2': WATER_DEPTH_DEEP | WATER_SEA }))).toBe(false);
    expect(freshWaterWithin(x, y, reach, at({ '4,2': WATER_DEPTH_DEEP | WATER_FROZEN }))).toBe(false);
    expect(freshWaterWithin(x, y, reach, at({}))).toBe(false);
  });

  it('der Klang eines fertigen Stücks: der eigene des Rezepts (Wasser schöpfen) oder das Handwerk-Glöckchen', () => {
    expect(craftCompletedSound(CONTENT.collection('recipes').get('rezept_holzeimer_wasser'))).toBe('sfx_wasser_schoepfen');
    expect(craftCompletedSound(axe)).toBe(CRAFTING_SFX.done);
    expect(craftCompletedSound(undefined)).toBe(CRAFTING_SFX.done);
    for (const id of [...Object.values(CRAFTING_SFX), 'sfx_wasser_schoepfen']) expect(CONTENT.has('sfx', id), id).toBe(true);
  });

  it('die Grundlagen-Items sind Teil der T0-Items (Zählung)', () => {
    for (const id of ['faserseil', 'fackel', 'lagerfeuer', 'werkbank', 'verband', 'grasbett', 'steinspeer']) expect(ITEMS.some((i) => i.id === id), id).toBe(true);
  });
});
