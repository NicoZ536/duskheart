/**
 * M4-01 Rezept-System voll (MASTERPROMPT §15.1 "Ein Rezept wird sichtbar, sobald jede Zutat einmal besessen
 * wurde und die Station bekannt ist. Zusätzlich: Baupläne", "Zutaten konkret oder als Kategorie
 * (Gemüse/Fleisch/Fisch …)"; docs/SPIEL.md §8):
 * - Sichtbarkeit: jede Zutat einmal besessen (verbrauchte zählen weiter), eine Gruppen-Zutat mit einem ihrer
 *   Mitglieder; die Station bekannt – besessen, in der Welt getroffen (8 Tiles) oder eine höhere Stufe ihrer Linie.
 * - Baupläne als Freischaltquelle: ein Rezept mit Bauplan bleibt verborgen, bis sein Bauplan gelernt ist.
 * - Zutaten als Kategorie: Gruppen-Zutaten nehmen ihre Mitglieder in Reihenfolge, mischen sie und erstatten beim
 *   Abbrechen genau die genommenen Stapel.
 * - Das Rezeptbuch prüft Gruppen, Stationen, Zeitklassen und Aufwertungen; Verarbeitungsrezepte laufen nicht über
 *   die Warteschlange; `unlockAll` zeigt alles.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { INGREDIENT_GROUPS, defineIngredientGroups } from '../../../src/content/recipes/gruppen';
import { RECIPES } from '../../../src/content/recipes/index';
import { defineRecipeGroup, recipe } from '../../../src/content/recipes/define';
import { recipeSchema, type RecipeDef, type RecipeInput } from '../../../src/content/recipes/schema';
import { recipeVisible } from '../../../src/game/crafting/formulas';
import { RecipeBook, contentRecipeBook } from '../../../src/game/crafting/recipes';
import { OFFSET } from './spieler-testwelt';
import { catalog, eventsOf, rejections, stationWorld } from './stationen-testwelt';

const T = BALANCE.stations.discoverTiles;

/** Fixture groups on the game's items: berries and mushrooms (a "category" like vegetables or fish in §15.1). */
const PROBE_GROUPS = defineIngredientGroups([
  ...INGREDIENT_GROUPS,
  { id: 'beeren', name: { de: 'Beeren', en: 'Berries' }, items: ['himbeeren', 'blaubeeren', 'walderdbeeren'] },
]);

/** The game's recipes plus a berry recipe (group ingredient with freshness) and one from a blueprint. */
function probeBook(): RecipeBook {
  const extra = defineRecipeGroup('proben', [
    recipe({ item: 'faserseil', gruppen: { beeren: 3 }, station: null, dauer: 'handgriff', suffix: 'beeren' }),
    recipe({ item: 'verband', zutaten: { laub: 1 }, station: null, dauer: 'handgriff', suffix: 'bauplan' }, { bauplan: { quellen: ['haendlerin'] } }),
  ]);
  return new RecipeBook([...RECIPES, ...extra], catalog, PROBE_GROUPS);
}

describe('Sichtbarkeit mit Zutaten-Gruppen und Stationslinien', () => {
  it('eine Gruppen-Zutat gilt als besessen, sobald eines ihrer Mitglieder besessen wurde', () => {
    const book = contentRecipeBook(catalog);
    const brett = CONTENT.collection('recipes').get('rezept_brett');
    const ings = book.ingredients('rezept_brett');
    expect(ings).toEqual([{ key: 'bauholz', gruppe: true, items: ['holz', 'treibholz'], anzahl: 1 }]);
    const known = (s: string): boolean => s === 'saegebock';
    expect(recipeVisible(brett, ings, new Set(), known, new Set())).toBe(false);
    expect(recipeVisible(brett, ings, new Set(['treibholz']), known, new Set())).toBe(true);
    expect(recipeVisible(brett, ings, new Set(['holz']), known, new Set())).toBe(true);
    // Without the sawbuck known the planks stay hidden.
    expect(recipeVisible(brett, ings, new Set(['holz']), () => false, new Set())).toBe(false);
  });

  it('im Spiel: Treibholz besessen und Sägebock in der Welt getroffen (≤ 8 Tiles) ⇒ Bretter und Balken werden sichtbar', () => {
    const w = stationWorld();
    w.give('treibholz', 1);
    w.run(1);
    expect(w.crafting.isVisible('rezept_brett')).toBe(false);
    // Stations someone else set up (a loaded world): one sawbuck beyond 8 tiles of the player on (4, 4) …
    const far = { id: 1, station: 'saegebock', layer: 0, tx: OFFSET + 4 + T + 2, ty: OFFSET + 4, proc: null, bis: 0 };
    w.stations.save.deserialize({ placed: [far], nextId: 2 });
    w.run(BALANCE.time.tickHz);
    expect(w.crafting.knowsStation('saegebock')).toBe(false);
    expect(w.crafting.isVisible('rezept_brett')).toBe(false);
    // … and one within 8 tiles: met at the next world tick.
    const near = { id: 2, station: 'saegebock', layer: 0, tx: OFFSET + 4 + T - 2, ty: OFFSET + 6, proc: null, bis: 0 };
    w.stations.save.deserialize({ placed: [far, near], nextId: 3 });
    const met = w.run(BALANCE.time.tickHz);
    expect(w.crafting.knowsStation('saegebock')).toBe(true);
    expect(eventsOf<{ recipe: string }>(met, 'recipeDiscovered').map((e) => e.recipe)).toEqual(expect.arrayContaining(['rezept_brett', 'rezept_balken']));
    // Setting up a station oneself meets it at once.
    const v = stationWorld();
    v.place('steinmetzbank', 6, 4);
    expect(v.crafting.knowsStation('steinmetzbank')).toBe(true);
  });

  it('eine höhere Stufe der Linie macht die Rezepte der niedrigeren sichtbar, nicht umgekehrt', () => {
    const w = stationWorld();
    w.give('stein', 4);
    w.give('bronzebarren', 1);
    w.give('holz', 1);
    w.run(1);
    w.crafting.meetStation(w.sim, 'werkbank');
    expect(w.crafting.knowsStation('werkbank')).toBe(true);
    expect(w.crafting.knowsStation('werkbank_2')).toBe(false);
    const v = stationWorld();
    v.crafting.meetStation(v.sim, 'werkbank_2');
    expect(v.crafting.knowsStation('werkbank')).toBe(true);
    expect(v.crafting.knowsStation('werkbank_2')).toBe(true);
    expect(v.crafting.knowsStation('saegebock')).toBe(false);
    // Owning a station item counts as knowing its line up to its stage.
    const u = stationWorld();
    u.give('werkbank_2', 1);
    u.give('fasern', 6);
    u.give('zweig', 4);
    u.give('harz', 2);
    u.run(1);
    expect(u.crafting.isVisible('rezept_fackel_werkbank')).toBe(true);
  });

  it('jede Zutat einmal besessen genügt – auch wenn sie längst verbraucht ist', () => {
    const w = stationWorld();
    w.give('lehm', 2);
    w.give('sand', 1);
    w.run(1);
    w.inventory.take(w.sim, 'lehm', 2);
    w.inventory.take(w.sim, 'sand', 1);
    w.give('strohbuendel', 1);
    w.crafting.meetStation(w.sim, 'werkbank');
    w.run(1);
    expect(w.has('lehm')).toBe(0);
    expect(w.crafting.isVisible('rezept_lehmputz')).toBe(true);
  });
});

describe('Baupläne als Freischaltquelle', () => {
  it('ein Rezept mit Bauplan bleibt trotz aller Zutaten verborgen, bis der Bauplan gelernt ist', () => {
    const w = stationWorld(undefined, probeBook());
    w.give('laub', 2);
    w.run(1);
    expect(w.crafting.isVisible('rezept_verband_bauplan')).toBe(false);
    expect(rejections(w.run(1, [{ type: 'craft.start', recipe: 'rezept_verband_bauplan', count: 1 }]))).toEqual(['recipeHidden']);
    expect(w.crafting.learnBlueprint(w.sim, 'rezept_verband')).toBe(false);
    expect(w.crafting.learnBlueprint(w.sim, 'rezept_verband_bauplan')).toBe(true);
    expect(w.crafting.learnBlueprint(w.sim, 'rezept_verband_bauplan')).toBe(false);
    expect(w.crafting.isVisible('rezept_verband_bauplan')).toBe(true);
    const made = w.run(200, [{ type: 'craft.start', recipe: 'rezept_verband_bauplan', count: 1 }]);
    expect(eventsOf(made, 'craftCompleted')).toHaveLength(1);
  });

  it('Baupläne werden gefunden, nie hergestellt: das Schema lehnt rezept:-Fundstellen ab', () => {
    const r: RecipeInput = recipe({ item: 'verband', zutaten: { laub: 1 }, station: null, dauer: 'handgriff', suffix: 'x' }, { bauplan: { quellen: ['rezept:rezept_verband'] } });
    expect(recipeSchema.safeParse(r).success).toBe(false);
    expect(recipeSchema.safeParse({ ...r, bauplan: { quellen: ['ort:gewoelbe', 'haendlerin'] } }).success).toBe(true);
  });
});

describe('Zutaten als Kategorie', () => {
  it('eine Gruppen-Zutat nimmt ihre Mitglieder in Reihenfolge, mischt sie und erstattet beim Abbrechen genau', () => {
    const w = stationWorld(undefined, probeBook());
    w.give('blaubeeren', 2, { frische: 40 });
    w.give('himbeeren', 2, { frische: 90 });
    w.give('walderdbeeren', 5, { frische: 70 });
    w.run(1);
    expect(w.crafting.isVisible('rezept_faserseil_beeren')).toBe(true);
    // 2 pieces = 6 berries: raspberries first (group order), then blueberries, then 2 wild strawberries.
    expect(w.crafting.affordable(w.sim, 'rezept_faserseil_beeren')).toBe(3);
    w.run(1, [{ type: 'craft.start', recipe: 'rezept_faserseil_beeren', count: 2 }]);
    const order = w.crafting.orders[0];
    expect(order?.reserviert.map((s) => [s.item, s.count, s.frische])).toEqual([
      ['himbeeren', 2, 90],
      ['blaubeeren', 2, 40],
      ['walderdbeeren', 2, 70],
    ]);
    expect(w.has('walderdbeeren')).toBe(3);
    w.run(1, [{ type: 'craft.cancel', index: 0 }]);
    expect([w.has('himbeeren'), w.has('blaubeeren'), w.has('walderdbeeren')]).toEqual([2, 2, 5]);
    // Made: one piece consumes three berries of the reservation in order.
    w.run(1, [{ type: 'craft.start', recipe: 'rezept_faserseil_beeren', count: 1 }]);
    const done = w.run(200);
    expect(eventsOf(done, 'craftCompleted')).toHaveLength(1);
    expect(w.has('faserseil')).toBe(1);
    expect([w.has('himbeeren'), w.has('blaubeeren'), w.has('walderdbeeren')]).toEqual([0, 1, 5]);
  });

  it('im Content: jede Gruppe wird von einem Rezept verwendet; Bauholz verbindet Holz und Treibholz', () => {
    const recipes = CONTENT.collection('recipes').values();
    for (const g of CONTENT.collection('ingredientGroups').values()) {
      expect(
        recipes.some((r) => r.zutaten.some((z) => 'gruppe' in z && z.gruppe === g.id)),
        g.id,
      ).toBe(true);
    }
    expect(CONTENT.collection('ingredientGroups').get('bauholz').items).toEqual(['holz', 'treibholz']);
  });
});

describe('Rezeptbuch: Prüfungen', () => {
  const base = (over: Partial<RecipeInput>): RecipeDef => recipeSchema.parse({ ...recipe({ item: 'brett', gruppen: { bauholz: 1 }, station: 'saegebock', dauer: 'werkzeug', suffix: 'probe' }), ...over });

  it('lehnt überlappende Zutaten, unbekannte Gruppen, falsche Zeitklassen und falsche Aufwertungen ab', () => {
    expect(() => new RecipeBook([base({})], catalog)).not.toThrow();
    expect(() => new RecipeBook([base({ zutaten: [{ gruppe: 'bauholz', anzahl: 1 }, { item: 'holz', anzahl: 1 }] })], catalog)).toThrow(/two ingredients/);
    expect(() => new RecipeBook([base({ zutaten: [{ gruppe: 'moos', anzahl: 1 }] })], catalog)).toThrow(/unknown ingredient group/);
    expect(() => new RecipeBook([base({ dauer: 'brennen' })], catalog)).toThrow(/hand work/);
    expect(() => new RecipeBook([base({ station: 'lehmofen', dauer: 'werkzeug' })], catalog)).toThrow(/processing station/);
    expect(() => new RecipeBook([base({ station: 'lehmofen', dauer: 'brennen', bauplan: { quellen: ['haendlerin'] } })], catalog)).toThrow(/blueprint/);
    expect(() => new RecipeBook([base({ station: 'trockengestell', dauer: 'trocknen', zutaten: [{ item: 'lehm', anzahl: 1 }, { item: 'sand', anzahl: 1 }, { item: 'kies', anzahl: 1 }] })], catalog)).toThrow(/input slots/);
    expect(() => new RecipeBook([base({ station: null, dauer: 'schmelzen' })], catalog)).toThrow(/processing stations/);
    expect(() => new RecipeBook([base({ station: 'faserseil' })], catalog)).toThrow(/not placeable/);
    expect(() => new RecipeBook([base({ station: 'grasbett' })], catalog)).toThrow(/no station record/);
    const up = recipeSchema.parse(recipe({ item: 'amboss_bronze', zutaten: { stein: 1 }, station: 'werkbank', dauer: 'gross', suffix: 'probe' }, { aufwerten: true }));
    expect(() => new RecipeBook([up], catalog)).toThrow(/next stage/);
    expect(() => contentRecipeBook(catalog)).not.toThrow();
    expect(() => new RecipeBook(RECIPES, catalog, [...INGREDIENT_GROUPS, { id: 'bauholz', name: { de: 'x', en: 'x' }, items: ['holz', 'rinde'] }])).toThrow(/duplicate ingredient group/);
  });

  it('Verarbeitungsrezepte laufen nicht über die Warteschlange: craft.start lehnt mit processing ab', () => {
    const w = stationWorld();
    w.give('fasern', 6);
    w.give('trockengestell', 1);
    w.run(1);
    expect(w.crafting.isVisible('rezept_strohbuendel')).toBe(true);
    expect(rejections(w.run(1, [{ type: 'craft.start', recipe: 'rezept_strohbuendel', count: 1 }]))).toEqual(['processing']);
  });

  it('unlockAll macht jedes Rezept sichtbar und wird gespeichert', () => {
    const w = stationWorld();
    const ev = new Map<string, unknown[]>();
    w.crafting.unlockAll(w.sim);
    w.sim.events.drain((type, payload) => ev.set(type, [...(ev.get(type) ?? []), payload]));
    expect(w.crafting.visibleRecipes().length).toBe(w.crafting.recipes.list.length);
    expect(eventsOf(ev, 'recipeDiscovered').length).toBe(w.crafting.recipes.list.length);
    const saved = w.crafting.save.serialize() as { alle?: boolean };
    expect(saved.alle).toBe(true);
    const v = stationWorld();
    v.crafting.save.deserialize(saved);
    expect(v.crafting.unlockedAll).toBe(true);
    expect(v.crafting.isVisible('rezept_bronzeaxt')).toBe(true);
  });
});
