/**
 * Validator-Regeln Erreichbarkeit und Stufenreihenfolge mit Zutatengruppen (M4-01, §15.1 „Zutaten konkret oder
 * als Kategorie“; tools/validator/reachability.ts, tiers.ts): Eine Gruppe `{ gruppe, anzahl }` ist erfüllt,
 * sobald eines ihrer Mitglieder erreichbar ist – ohne erreichbares Mitglied ist das Rezept nie herstellbar; ihre
 * Stufe ist die niedrigste ihrer Mitglieder. Der echte Content (Bretter, Balken, Holzkohle und Holzstapel aus
 * `bauholz`) besteht beide Regeln.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTENT } from '../../../src/content/index';
import { ContentRegistry, type ContentRegistryView } from '../../../src/content/registry';
import { ingredientGroupSchema, type IngredientGroupInput } from '../../../src/content/recipes/gruppen';
import { recipeSchema, type RecipeInput } from '../../../src/content/recipes/schema';
import { idSchema, ref, refSchema } from '../../../src/content/schema/common';
import { itemSchema, type ItemInput } from '../../../src/content/schema/item';
import { checkReachability, ingredientGroupMembers } from '../../../tools/validator/reachability';
import { GEPLANTE_ERREICHBARKEIT } from '../../../tools/validator/reachability-geplant';
import { checkTierOrder } from '../../../tools/validator/tiers';

function item(id: string, overrides: Partial<ItemInput> = {}): ItemInput {
  return {
    id,
    name: { de: `Name ${id}`, en: `Name ${id}` },
    beschreibung: { de: 'Beschreibung.', en: 'Description.' },
    kategorie: 'rohstoff',
    stufe: 0,
    raritaet: 'gewoehnlich',
    stapel: 100,
    tauschwert: 1,
    sounds: { aufheben: 'sfx_item_holz' },
    ...overrides,
  };
}

/** A recipe of `product` from the groups `gruppen` (and optional concrete items). */
function recipe(product: string, gruppen: Record<string, number>, zutaten: Record<string, number> = {}): RecipeInput {
  return {
    id: `rezept_${product}`,
    ergebnis: { item: product, anzahl: 1 },
    zutaten: [...Object.entries(zutaten).map(([i, anzahl]) => ({ item: i, anzahl })), ...Object.entries(gruppen).map(([gruppe, anzahl]) => ({ gruppe, anzahl }))],
    station: null,
    dauer: 'werkzeug',
  };
}

const objectSchema = z
  .object({ id: idSchema, tool: z.string(), hardness: z.number(), drops: z.array(z.object({ item: refSchema }).strict()) })
  .strict();

/** A beach that gives driftwood by hand; logs come from a tree that needs an axe nobody can make. */
function registry(items: ItemInput[], groups: IngredientGroupInput[], recipes: RecipeInput[]): ContentRegistryView {
  return new ContentRegistry()
    .defineCollection(
      'worldObjects',
      objectSchema,
      [
        { id: 'strandgut', tool: 'hand', hardness: 0, drops: [{ item: 'treibholz' }] },
        { id: 'baum', tool: 'axt', hardness: 1, drops: [{ item: 'holz' }] },
      ],
      { refs: [ref('drops[].item', 'items')] },
    )
    .defineCollection('items', itemSchema, items, { refs: [] })
    .defineCollection('ingredientGroups', ingredientGroupSchema, groups, { refs: [ref('items[]', 'items')] })
    .defineCollection('recipes', recipeSchema, recipes, { category: 'recipes', refs: [ref('ergebnis.item', 'items'), ref('zutaten[].item', 'items'), ref('zutaten[].gruppe', 'ingredientGroups'), ref('station', 'items')] });
}

const BAUHOLZ: IngredientGroupInput = { id: 'bauholz', name: { de: 'Bauholz', en: 'Timber' }, items: ['holz', 'treibholz'] };
const WOOD: ItemInput[] = [item('holz'), item('treibholz'), item('brett')];
/** Logs need the axe, which this world lacks. */
const NO_AXE = 'Item holz ist von keiner Weltquelle aus erreichbar (Waise): welt:baum: braucht axt mit Abbaukraft ≥ 1 – kein solches Werkzeug erreichbar';

describe('Erreichbarkeit mit Zutatengruppen', () => {
  it('ein erreichbares Mitglied genügt: Bretter aus Treibholz, auch ohne Axt für Holz', () => {
    const res = checkReachability(registry(WOOD, [BAUHOLZ], [recipe('brett', { bauholz: 1 })]));
    expect(res.errors).toEqual([NO_AXE]);
    expect([...res.items].sort()).toEqual(['brett', 'treibholz']);
    expect([...res.recipes]).toEqual(['rezept_brett']);
  });

  it('ohne erreichbares Mitglied ist das Rezept nie herstellbar und sein Produkt eine Waise', () => {
    const noBeach = registry(WOOD, [{ ...BAUHOLZ, items: ['holz', 'brett'] }], [recipe('treibholz', { bauholz: 1 })]);
    const res = checkReachability(noBeach);
    expect(res.recipes.has('rezept_treibholz')).toBe(false);
    expect(res.errors).toContain('Rezept rezept_treibholz ist nie herstellbar: Zutatengruppe bauholz: kein Mitglied erreichbar (holz, brett)');
    expect(res.errors).toContain('Item brett ist von keiner Weltquelle aus erreichbar (Waise): keine Quelle');
  });

  it('Gruppe und konkrete Zutat zusammen: beide müssen erreichbar sein', () => {
    const res = checkReachability(registry([item('holz'), item('treibholz'), item('kiste')], [BAUHOLZ], [recipe('kiste', { bauholz: 4 }, { holz: 1 })]));
    expect(res.errors).toEqual([NO_AXE, 'Item kiste ist von keiner Weltquelle aus erreichbar (Waise): rezept:rezept_kiste: Zutaten nicht erreichbar: holz', 'Rezept rezept_kiste ist nie herstellbar: Zutaten nicht erreichbar: holz']);
  });

  it('eine unbekannte Gruppe hat keine Mitglieder – das Rezept ist nie herstellbar', () => {
    const reg = registry(WOOD, [BAUHOLZ], [recipe('brett', { edelholz: 1 })]);
    expect(ingredientGroupMembers(reg, 'edelholz')).toEqual([]);
    expect(ingredientGroupMembers(reg, 'bauholz')).toEqual(['holz', 'treibholz']);
    expect(checkReachability(reg).errors).toContain('Rezept rezept_brett ist nie herstellbar: Zutatengruppe edelholz fehlt oder hat keine Mitglieder');
  });
});

describe('Stufenreihenfolge mit Zutatengruppen', () => {
  it('die Stufe einer Gruppe ist die ihres frühesten Mitglieds', () => {
    const mixed = [item('holz'), item('treibholz', { stufe: 1 }), item('brett')];
    expect(checkTierOrder(registry(mixed, [BAUHOLZ], [recipe('brett', { bauholz: 1 })]))).toEqual([]);
  });

  it('haben alle Mitglieder eine höhere Stufe als das Produkt ⇒ Fehler', () => {
    const late = [item('holz', { stufe: 2 }), item('treibholz', { stufe: 1 }), item('brett')];
    expect(checkTierOrder(registry(late, [BAUHOLZ], [recipe('brett', { bauholz: 1 })]))).toEqual(['Stufenreihenfolge: Rezept rezept_brett (T0) braucht die Zutatengruppe bauholz, deren frühestes Mitglied Stufe T1 hat']);
  });
});

describe('echter Content', () => {
  it('Rezepte aus Bauholz sind herstellbar, ihre Stufen stimmen', () => {
    const res = checkReachability(CONTENT, { geplant: GEPLANTE_ERREICHBARKEIT, progress: readFileSync(join(process.cwd(), 'PROGRESS.md'), 'utf8') });
    for (const id of ['rezept_brett', 'rezept_balken', 'rezept_holzkohle', 'rezept_holzstapel']) {
      expect(CONTENT.get('recipes', id).zutaten, id).toContainEqual(expect.objectContaining({ gruppe: 'bauholz' }));
      expect(res.recipes.has(id), id).toBe(true);
    }
    expect(res.errors).toEqual([]);
    expect(checkTierOrder(CONTENT)).toEqual([]);
  });
});
