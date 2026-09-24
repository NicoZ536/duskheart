/**
 * M3-38 Validator-Regeln Erreichbarkeitsgraph und Stufenreihenfolge: Weltquellen (mit dem Werkzeug, das sie
 * verlangen), Drops, Händlerin und Baupläne → Rezepte → Items; eine Waise (von keiner Weltquelle erreichbar)
 * ist ein Fehler, ebenso ein nie herstellbares Rezept; kein Rezept braucht Material oder eine Station einer
 * höheren Stufe als sein Produkt. Beide Regeln laufen in `runChecks()` (npm run check); der echte Content
 * ist fehlerfrei.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTENT } from '../../../src/content/index';
import { ContentRegistry, type ContentRegistryView } from '../../../src/content/registry';
import { recipeSchema, type RecipeInput } from '../../../src/content/recipes/schema';
import { idSchema, ref, refSchema } from '../../../src/content/schema/common';
import { itemSchema, type ItemInput } from '../../../src/content/schema/item';
import { runChecks } from '../../../tools/validator/checks';
import { checkReachability } from '../../../tools/validator/reachability';
import { GEPLANTE_ERREICHBARKEIT } from '../../../tools/validator/reachability-geplant';
import { checkTierOrder } from '../../../tools/validator/tiers';

const PROGRESS = ['- [ ] M7-34 Borkenvater', '- [x] M4-10 Bronze'].join('\n');

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

function tool(id: string, art: 'axt' | 'spitzhacke' | 'schaufel', abbaukraft: number, stufe = 0): ItemInput {
  return item(id, { kategorie: 'werkzeug', stapel: 1, haltbarkeit: 60, werkzeug: { art, abbaukraft }, stufe });
}

function recipe(product: string, zutaten: Record<string, number>, extra: Partial<RecipeInput> = {}): RecipeInput {
  return { id: `rezept_${product}`, ergebnis: { item: product, anzahl: 1 }, zutaten: Object.entries(zutaten).map(([i, anzahl]) => ({ item: i, anzahl })), station: null, dauer: 'werkzeug', ...extra };
}

const objectSchema = z
  .object({
    id: idSchema,
    tool: z.string(),
    hardness: z.number(),
    drops: z.array(z.object({ item: refSchema, anlass: z.string().optional() }).strict()),
  })
  .strict();
const terrainSchema = z.object({ id: idSchema, dig: z.object({ tool: z.string(), hardness: z.number() }).strict().nullable() }).strict();
const creatureSchema = z.object({ id: idSchema }).strict();

/**
 * A small world: pebbles and twigs by hand, a tree for the axe (logs; fruit picked by hand), a rock for
 * the pickaxe (stone), a hard ore for a bronze pickaxe (hardness 2), sand for the shovel.
 */
function registry(items: ItemInput[], recipes: RecipeInput[], options: { creatures?: boolean } = {}): ContentRegistryView {
  let reg = new ContentRegistry()
    .defineCollection('terrain', terrainSchema, [
      { id: 'sand', dig: { tool: 'schaufel', hardness: 1 } },
      { id: 'strasse', dig: null },
    ])
    .defineCollection(
      'worldObjects',
      objectSchema,
      [
        { id: 'deko_steinchen', tool: 'hand', hardness: 0, drops: [{ item: 'kiesel' }, { item: 'zweig' }] },
        { id: 'baum_apfel', tool: 'axt', hardness: 1, drops: [{ item: 'holz' }, { item: 'apfel', anlass: 'ernte' }] },
        { id: 'fels', tool: 'spitzhacke', hardness: 1, drops: [{ item: 'stein' }] },
        { id: 'erz_hart', tool: 'spitzhacke', hardness: 2, drops: [{ item: 'harterz' }] },
      ],
      { refs: [ref('drops[].item', 'items')] },
    );
  if (options.creatures === true) reg = reg.defineCollection('creatures', creatureSchema, [{ id: 'wolf' }]);
  return reg
    .defineCollection('items', itemSchema, items, { refs: [] })
    .defineCollection('recipes', recipeSchema, recipes, { category: 'recipes', refs: [ref('ergebnis.item', 'items'), ref('zutaten[].item', 'items'), ref('station', 'items')] });
}

const RAW: ItemInput[] = [item('kiesel'), item('zweig'), item('holz'), item('apfel', { kategorie: 'nahrung', stapel: 20, frische: 3, essbar: { saettigung: 4, durst: 3 } }), item('stein'), item('sand', { quellen: ['graben:sand'] })];
const TOOLS: ItemInput[] = [tool('steinaxt', 'axt', 1), tool('steinspitzhacke', 'spitzhacke', 1), tool('steinschaufel', 'schaufel', 1)];
const TOOL_RECIPES: RecipeInput[] = [recipe('steinaxt', { zweig: 1, kiesel: 2 }), recipe('steinspitzhacke', { holz: 2, kiesel: 2 }), recipe('steinschaufel', { holz: 1, stein: 1 })];

describe('Erreichbarkeitsgraph', () => {
  it('eine stimmige Welt: alles über Handsammeln → Axt → Holz → Spitzhacke → Stein → Schaufel → Sand erreichbar', () => {
    const res = checkReachability(registry([...RAW, ...TOOLS], TOOL_RECIPES));
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect([...res.items].sort()).toEqual(['apfel', 'holz', 'kiesel', 'sand', 'stein', 'steinaxt', 'steinschaufel', 'steinspitzhacke', 'zweig']);
    expect([...res.recipes].sort()).toEqual(['rezept_steinaxt', 'rezept_steinschaufel', 'rezept_steinspitzhacke']);
  });

  it('Waise ⇒ Fehler: ein Item ohne erreichbare Quelle, samt Grund', () => {
    const res = checkReachability(registry([...RAW, ...TOOLS, item('mondstein', { quellen: ['graben:strasse'] })], TOOL_RECIPES));
    expect(res.errors).toEqual(['Item mondstein ist von keiner Weltquelle aus erreichbar (Waise): graben:strasse: liefert mondstein nicht']);
  });

  it('Werkzeug-Gating: ohne Spitzhacke ist Stein eine Waise, und alles, was nur an ihm hängt', () => {
    const res = checkReachability(registry([...RAW, ...TOOLS], [TOOL_RECIPES[0] as RecipeInput, TOOL_RECIPES[2] as RecipeInput]));
    expect(res.errors).toEqual([
      'Item stein ist von keiner Weltquelle aus erreichbar (Waise): welt:fels: braucht spitzhacke mit Abbaukraft ≥ 1 – kein solches Werkzeug erreichbar',
      'Item sand ist von keiner Weltquelle aus erreichbar (Waise): graben:sand: braucht schaufel mit Abbaukraft ≥ 1 – kein solches Werkzeug erreichbar',
      'Item steinspitzhacke ist von keiner Weltquelle aus erreichbar (Waise): keine Quelle',
      'Item steinschaufel ist von keiner Weltquelle aus erreichbar (Waise): rezept:rezept_steinschaufel: Zutaten nicht erreichbar: stein',
      'Rezept rezept_steinschaufel ist nie herstellbar: Zutaten nicht erreichbar: stein',
    ]);
  });

  it('Abbaukraft zählt: ein Erz der Härte 2 bleibt mit Werkzeugen der Kraft 1 eine Waise', () => {
    const res = checkReachability(registry([...RAW, ...TOOLS, item('harterz', { stufe: 1 })], TOOL_RECIPES));
    expect(res.errors).toEqual(['Item harterz ist von keiner Weltquelle aus erreichbar (Waise): welt:erz_hart: braucht spitzhacke mit Abbaukraft ≥ 2 – kein solches Werkzeug erreichbar']);
    const bronze = tool('bronzespitzhacke', 'spitzhacke', 2, 1);
    const ok = checkReachability(registry([...RAW, ...TOOLS, item('harterz', { stufe: 1 }), bronze, item('kernholz', { quellen: ['haendlerin'], stufe: 1 })], [...TOOL_RECIPES, recipe('bronzespitzhacke', { kernholz: 1, holz: 2 })]));
    expect(ok.errors).toEqual([]);
    expect(ok.items.has('harterz')).toBe(true);
  });

  it('Obst am Baum wird von Hand geerntet (Anlass „ernte“), das Holz desselben Baums braucht die Axt', () => {
    const res = checkReachability(registry([...RAW, tool('steinaxt', 'axt', 1)], []));
    expect(res.items.has('apfel')).toBe(true);
    expect(res.items.has('holz')).toBe(false);
  });

  it('ein Kreislauf ohne Weltquelle bleibt verwaist', () => {
    const res = checkReachability(registry([...RAW, ...TOOLS, item('ei'), item('huhn')], [...TOOL_RECIPES, recipe('ei', { huhn: 1 }), recipe('huhn', { ei: 1 })]));
    expect(res.errors.filter((e) => e.startsWith('Item'))).toEqual([
      'Item ei ist von keiner Weltquelle aus erreichbar (Waise): rezept:rezept_ei: Zutaten nicht erreichbar: huhn',
      'Item huhn ist von keiner Weltquelle aus erreichbar (Waise): rezept:rezept_huhn: Zutaten nicht erreichbar: ei',
    ]);
  });

  it('Stationen sind Items: ein Rezept an einer unerreichbaren Station ist nie herstellbar', () => {
    const bench = item('werkbank', { kategorie: 'platzierbar', stapel: 10, endprodukt: true, quellen: ['graben:strasse'] });
    const res = checkReachability(registry([...RAW, ...TOOLS, bench, item('brett')], [...TOOL_RECIPES, recipe('brett', { holz: 1 }, { station: 'werkbank' })]));
    expect(res.errors).toContain('Rezept rezept_brett ist nie herstellbar: Station werkbank nicht erreichbar');
    const built = checkReachability(registry([...RAW, ...TOOLS, { ...bench, quellen: undefined }, item('brett')], [...TOOL_RECIPES, recipe('werkbank', { holz: 4 }), recipe('brett', { holz: 1 }, { station: 'werkbank' })]));
    expect(built.errors).toEqual([]);
  });

  it('Händlerin und Beute sind Wurzeln; Baupläne schalten Rezepte nur über gefundene Fundstellen frei', () => {
    const withTrader = checkReachability(registry([...RAW, ...TOOLS, item('gewuerz', { quellen: ['haendlerin'] }), item('fell', { quellen: ['drop:wolf'] })], TOOL_RECIPES, { creatures: true }));
    expect(withTrader.errors).toEqual([]);
    const plan = (quellen: string[]): RecipeInput => recipe('laterne', { holz: 1 }, { bauplan: { quellen } });
    expect(checkReachability(registry([...RAW, ...TOOLS, item('laterne')], [...TOOL_RECIPES, plan(['haendlerin'])])).errors).toEqual([]);
    expect(checkReachability(registry([...RAW, ...TOOLS, item('laterne')], [...TOOL_RECIPES, plan(['drop:wolf'])], { creatures: true })).errors).toEqual([]);
    const lost = checkReachability(registry([...RAW, ...TOOLS, item('laterne')], [...TOOL_RECIPES, plan(['drop:drache'])], { creatures: true }));
    expect(lost.errors).toEqual([
      'Item laterne ist von keiner Weltquelle aus erreichbar (Waise): rezept:rezept_laterne: Bauplan an keiner Fundstelle (drop:drache)',
      'Rezept rezept_laterne ist nie herstellbar: Bauplan an keiner Fundstelle (drop:drache)',
    ]);
  });

  it('geplante Erreichbarkeit: offener Task ⇒ Warnung (auch für Abhängiges), erledigter Task ⇒ Fehler, veraltet ⇒ Warnung', () => {
    const items = [...RAW, ...TOOLS, item('harterz', { stufe: 1 }), item('sprengtopf', { stufe: 1 })];
    const recipes = [...TOOL_RECIPES, recipe('sprengtopf', { harterz: 1, stein: 1 })];
    const reg = registry(items, recipes);
    const open = checkReachability(reg, { geplant: { harterz: { task: 'M7-34', grund: 'Bronzespitzhacke' } }, progress: PROGRESS });
    expect(open.errors).toEqual([]);
    expect(open.warnings).toEqual(['Erst mit geplanter Erreichbarkeit (harterz → M7-34) erreichbar (3): harterz, sprengtopf, rezept_sprengtopf']);
    const done = checkReachability(reg, { geplant: { harterz: { task: 'M4-10', grund: 'x' } }, progress: PROGRESS });
    expect(done.errors).toContain('Item harterz: Erreichbarkeit war mit M4-10 geplant (x), der Task ist erledigt – das Item ist aber noch nicht erreichbar');
    expect(done.errors).toContain('Item harterz ist von keiner Weltquelle aus erreichbar (Waise): welt:erz_hart: braucht spitzhacke mit Abbaukraft ≥ 2 – kein solches Werkzeug erreichbar');
    const unknown = checkReachability(reg, { geplant: { harterz: { task: 'M99-1', grund: 'x' }, geist: { task: 'M7-34', grund: 'x' } }, progress: PROGRESS });
    expect(unknown.errors).toContain('Item harterz: geplante Erreichbarkeit nennt unbekannten Task M99-1');
    expect(unknown.errors).toContain('Geplante Erreichbarkeit für unbekanntes Item geist');
    const stale = checkReachability(reg, { geplant: { harterz: { task: 'M7-34', grund: 'x' }, stein: { task: 'M7-34', grund: 'x' } }, progress: PROGRESS });
    expect(stale.warnings).toContain('Geplante Erreichbarkeit für stein (M7-34) ist veraltet: das Item ist erreichbar – Eintrag in tools/validator/reachability-geplant.ts streichen');
  });

  it('der Content des Spiels: alles erreichbar bis auf die geplanten Einträge; die Grundlagen samt Steinwerkzeugen sind herstellbar', () => {
    const res = checkReachability(CONTENT, { geplant: GEPLANTE_ERREICHBARKEIT, progress: '- [ ] M7-34 Borkenvater' });
    expect(res.errors).toEqual([]);
    for (const id of ['rezept_faserseil', 'rezept_steinaxt', 'rezept_steinspitzhacke', 'rezept_holzeimer', 'rezept_holzeimer_wasser', 'rezept_lagerfeuer', 'rezept_werkbank', 'rezept_verband', 'rezept_grasbett', 'rezept_steinspeer']) {
      expect(res.recipes.has(id), id).toBe(true);
    }
    for (const id of Object.keys(GEPLANTE_ERREICHBARKEIT)) expect(res.items.has(id), id).toBe(false);
  });
});

describe('Stufenreihenfolge', () => {
  it('Stufenverstoß ⇒ Fehler: eine Zutat oder Station höherer Stufe als das Produkt', () => {
    const items = [...RAW, ...TOOLS, item('bronze', { stufe: 1, quellen: ['haendlerin'] }), item('werkbank2', { kategorie: 'platzierbar', stapel: 10, endprodukt: true, stufe: 1, quellen: ['haendlerin'] }), item('nagel'), item('brett')];
    const recipes = [...TOOL_RECIPES, recipe('nagel', { bronze: 1 }), recipe('brett', { holz: 1 }, { station: 'werkbank2' })];
    expect(checkTierOrder(registry(items, recipes))).toEqual([
      'Stufenreihenfolge: Rezept rezept_nagel (T0) braucht die Zutat bronze der Stufe T1',
      'Stufenreihenfolge: Rezept rezept_brett (T0) braucht die Station werkbank2 der Stufe T1',
    ]);
  });

  it('gleiche oder niedrigere Stufen sind erlaubt; der Content des Spiels hält die Reihenfolge ein', () => {
    const items = [...RAW, ...TOOLS, item('bronze', { stufe: 1, quellen: ['haendlerin'] }), item('bronzenagel', { stufe: 1 })];
    expect(checkTierOrder(registry(items, [...TOOL_RECIPES, recipe('bronzenagel', { bronze: 1, holz: 1 })]))).toEqual([]);
    expect(checkTierOrder(CONTENT)).toEqual([]);
  });
});

describe('beide Regeln laufen im Content-Validator (npm run check)', () => {
  it('runChecks meldet für den Content keine Waisen und keinen Stufenverstoß, aber die geplante Erreichbarkeit', async () => {
    const res = await runChecks();
    expect(res.errors.filter((e) => e.includes('Waise') || e.includes('nie herstellbar') || e.startsWith('Stufenreihenfolge'))).toEqual([]);
    expect(res.warnings).toContain('Erst mit geplanter Erreichbarkeit (salpeter → M7-34) erreichbar (1): salpeter');
    expect(res.counts.recipes).toBeGreaterThanOrEqual(12);
  }, 60_000);
});
