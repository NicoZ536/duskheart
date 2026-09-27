/**
 * M4-33 Gating-Regeln §13.2 als Content (MASTERPROMPT §13.2 "Abbaukraft des Werkzeugs muss ≥ Härte der Ressource
 * sein. Die Spitzhacke jeder Stufe ab T1 braucht den Schlüssel-Drop des Bosses dieser Stufe … Waffen und Rüstung
 * einer Stufe brauchen keinen Boss-Drop."):
 * - Tabellenwerte: Abbaukraft T0–T7 = 1–8, Schlüssel-Drops und Bosse, Härte je Ressource.
 * - Validator-Regel `gating`: Spitzhacke Tn ohne Schlüssel-Drop ⇒ Fehler (auch über Zwischenprodukte geprüft);
 *   Waffe oder Rüstung mit Boss-Drop ⇒ Fehler; Stufe mit Werkzeugen ohne Waffe bzw. Rüstungsset ohne Boss-Drop ⇒
 *   Fehler (außer mit offenem geplanten Task); falsche Abbaukraft oder Härte ⇒ Fehler. Der echte Content ist grün.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { GATING_TIERS, GEPLANTE_STUFENAUSRUESTUNG, RESOURCE_HARDNESS, defineGatingTiers, parseResourceKey, type GatingTier } from '../../../src/content/gating';
import { ContentRegistry, type ContentRegistryView } from '../../../src/content/registry';
import { recipeSchema, type RecipeInput } from '../../../src/content/recipes/schema';
import { idSchema, ref } from '../../../src/content/schema/common';
import { itemSchema, type ItemInput } from '../../../src/content/schema/item';
import { checkGating, type GatingOptions } from '../../../tools/validator/gating';

const PROGRESS = readFileSync(join(process.cwd(), 'PROGRESS.md'), 'utf8');

describe('Tabellenwerte §13.2', () => {
  it('Abbaukraft je Stufe T0–T7 = 1–8, gleich BALANCE.tools', () => {
    expect(GATING_TIERS.map((t) => t.abbaukraft)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(BALANCE.tools.miningPowerByTier).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('Spitzhacke T1–T7 braucht Kernholz / Sumpfherz / Wyrmhorn / Sonnenchitin / Glutamboss-Kern / Prismenherz / Herz der Nacht', () => {
    expect(GATING_TIERS.map((t) => t.schluessel)).toEqual([
      null,
      { item: 'kernholz', boss: 'borkenvater' },
      { item: 'sumpfherz', boss: 'sumpfmutter' },
      { item: 'wyrmhorn', boss: 'hrimgar' },
      { item: 'sonnenchitin', boss: 'skarabaeus_koloss' },
      { item: 'glutamboss_kern', boss: 'aschenschmied' },
      { item: 'prismenherz', boss: 'gefallene_hueterin' },
      { item: 'herz_der_nacht', boss: 'verschlinger' },
    ]);
    expect(() => defineGatingTiers([{ ...GATING_TIERS[0], schluessel: { item: 'x', boss: 'y' } } as GatingTier])).toThrow(/T0 needs no key/);
    expect(() => defineGatingTiers([GATING_TIERS[0] as GatingTier, { ...GATING_TIERS[1], schluessel: null } as GatingTier])).toThrow(/needs a key drop/);
  });

  it('Härte je Ressource: Kupfer/Zinn 1 · Raseneisen/Eisenerz/Torf 2 · Steinkohle/Silber 3 · Gold/Klarquarz 4 · Obsidian/Magmit/Schwefel 5 · Lumenit/Prismenquarz 6 · Nachtstahl-Erz 7', () => {
    const byHardness = new Map<number, string[]>();
    for (const [k, h] of Object.entries(RESOURCE_HARDNESS)) byHardness.set(h, [...(byHardness.get(h) ?? []), parseResourceKey(k)?.id ?? k]);
    expect(Object.fromEntries(byHardness)).toEqual({
      1: ['kupfer', 'zinn'],
      2: ['raseneisen', 'eisen', 'torf'],
      3: ['kohle', 'silber'],
      4: ['gold', 'klarquarz'],
      5: ['obsidian', 'magmit', 'schwefel'],
      6: ['lumenit', 'prismenquarz'],
      7: ['nachtstahl'],
    });
    expect(parseResourceKey('boden:torf')).toEqual({ art: 'boden', id: 'torf' });
    expect(parseResourceKey('holz')).toBeNull();
  });

  it('der echte Content ist grün: keine Fehler, keine veralteten Planungen', () => {
    expect(checkGating(CONTENT, { progress: PROGRESS })).toEqual({ errors: [], warnings: [] });
    // T0 and T1 have tools; their armour sets and the bronze weapons are planned.
    expect(GEPLANTE_STUFENAUSRUESTUNG).toEqual({ 0: { ruestung: 'M6-12' }, 1: { waffe: 'M6-11', ruestung: 'M6-12' } });
  });
});

// ---------------------------------------------------------------------------------------------
// Fixture world: two tiers, copper for stone, iron and peat for bronze.
// ---------------------------------------------------------------------------------------------

const TIERS = defineGatingTiers([
  { ...(GATING_TIERS[0] as GatingTier), erschliesst: ['erz:kupfer'] },
  { ...(GATING_TIERS[1] as GatingTier), erschliesst: ['erz:eisen', 'boden:torf'] },
]);
const HARDNESS = { 'erz:kupfer': 1, 'erz:eisen': 2, 'boden:torf': 2 };

function item(id: string, over: Partial<ItemInput> = {}): ItemInput {
  return { id, name: { de: id, en: id }, beschreibung: { de: 'B.', en: 'D.' }, kategorie: 'rohstoff', stufe: 0, raritaet: 'gewoehnlich', stapel: 100, tauschwert: 1, sounds: { aufheben: 'sfx_item_holz' }, ...over };
}
function tool(id: string, art: 'axt' | 'spitzhacke', stufe: number, abbaukraft = stufe + 1): ItemInput {
  return item(id, { kategorie: 'werkzeug', stapel: 1, haltbarkeit: 60, werkzeug: { art, abbaukraft }, stufe });
}
function weapon(id: string, stufe: number): ItemInput {
  return item(id, { kategorie: 'waffe', stapel: 1, haltbarkeit: 60, stufe, werte: { schaden: 8 } });
}
function armour(id: string, slot: 'kopf' | 'brust' | 'beine' | 'fuesse', stufe: number): ItemInput {
  return item(id, { kategorie: 'ruestung', stapel: 1, haltbarkeit: 60, stufe, ausruestung: slot, ruestungsgewicht: 'leicht', werte: { ruestung: 2 } });
}
function recipe(product: string, zutaten: Record<string, number>, suffix?: string): RecipeInput {
  return { id: suffix === undefined ? `rezept_${product}` : `rezept_${product}_${suffix}`, ergebnis: { item: product, anzahl: 1 }, zutaten: Object.entries(zutaten).map(([i, anzahl]) => ({ item: i, anzahl })), station: null, dauer: 'werkzeug' };
}

const loose = z.object({ id: idSchema }).passthrough();

/** Raw materials, a boss key and a boss scale, T0 and T1 tools with a full kit of weapons and armour. */
const RAW = [item('holz', { quellen: ['haendlerin'] }), item('kupfer', { quellen: ['haendlerin'] }), item('bronze', { stufe: 1, quellen: ['haendlerin'] }), item('kernholz', { stufe: 1, quellen: ['drop:borkenvater'] }), item('schuppe', { stufe: 1, quellen: ['drop:borkenvater'] })];
/** A weapon and a full armour set of tier `stufe` (made from its material by `kitRecipes`). */
function kit(stufe: number): ItemInput[] {
  return [weapon(`speer_${stufe}`, stufe), armour(`helm_${stufe}`, 'kopf', stufe), armour(`brust_${stufe}`, 'brust', stufe), armour(`hose_${stufe}`, 'beine', stufe), armour(`stiefel_${stufe}`, 'fuesse', stufe)];
}
function kitRecipes(stufe: number, mat: string): RecipeInput[] {
  return [`speer_${stufe}`, `helm_${stufe}`, `brust_${stufe}`, `hose_${stufe}`, `stiefel_${stufe}`].map((id) => recipe(id, { [mat]: 2 }));
}

function registry(items: ItemInput[], recipes: RecipeInput[], over: { oreHardness?: number; torf?: number } = {}): ContentRegistryView {
  return new ContentRegistry()
    .defineCollection('ores', loose, [
      { id: 'kupfer', hardness: 1 },
      { id: 'eisen', hardness: over.oreHardness ?? 2 },
    ])
    .defineCollection('terrain', loose, [{ id: 'torf', dig: { tool: 'schaufel', hardness: over.torf ?? 2 } }])
    .defineCollection('worldObjects', loose, [{ id: 'erz_kupfer', hardness: 1 }])
    .defineCollection('creatures', loose, [{ id: 'borkenvater' }])
    .defineCollection('items', itemSchema, items, { refs: [] })
    .defineCollection('recipes', recipeSchema, recipes, { category: 'recipes', refs: [ref('ergebnis.item', 'items'), ref('zutaten[].item', 'items')] });
}

const OPTIONS: GatingOptions = { tiers: TIERS, hardness: HARDNESS, geplant: {}, progress: '- [ ] M6-11 Waffen\n- [x] M4-10 Bronze' };
const BASE_ITEMS = [...RAW, tool('steinaxt', 'axt', 0), tool('steinhacke', 'spitzhacke', 0), tool('bronzeaxt', 'axt', 1), ...kit(0), ...kit(1)];
const BASE_RECIPES = [recipe('steinaxt', { holz: 1 }), recipe('steinhacke', { holz: 1 }), recipe('bronzeaxt', { bronze: 2 }), ...kitRecipes(0, 'holz'), ...kitRecipes(1, 'bronze')];

function check(items: ItemInput[] = BASE_ITEMS, recipes: RecipeInput[] = BASE_RECIPES, options: GatingOptions = OPTIONS, over: { oreHardness?: number; torf?: number } = {}): ReturnType<typeof checkGating> {
  return checkGating(registry(items, recipes, over), options);
}

describe('Validator-Regel gating an Fixtures', () => {
  it('eine stimmige Welt ist grün – die Bronzespitzhacke mit Kernholz, auch über ein Zwischenprodukt', () => {
    expect(check()).toEqual({ errors: [], warnings: [] });
    const direct = check([...BASE_ITEMS, tool('bronzehacke', 'spitzhacke', 1)], [...BASE_RECIPES, recipe('bronzehacke', { bronze: 3, kernholz: 1 })]);
    expect(direct.errors).toEqual([]);
    const via = check([...BASE_ITEMS, item('kernstiel', { stufe: 1 }), tool('bronzehacke', 'spitzhacke', 1)], [...BASE_RECIPES, recipe('kernstiel', { kernholz: 1 }), recipe('bronzehacke', { bronze: 3, kernstiel: 1 })]);
    expect(via.errors).toEqual([]);
  });

  it('Spitzhacke Tn ohne Schlüssel-Drop ⇒ Fehler – auch wenn nur eines ihrer Rezepte ihn umgeht', () => {
    const res = check([...BASE_ITEMS, tool('bronzehacke', 'spitzhacke', 1)], [...BASE_RECIPES, recipe('bronzehacke', { bronze: 3 })]);
    expect(res.errors).toEqual(['Gating: Spitzhacke bronzehacke (T1) ohne Schlüssel-Drop kernholz (borkenvater) herstellbar oder zu finden']);
    const twoWays = check([...BASE_ITEMS, tool('bronzehacke', 'spitzhacke', 1)], [...BASE_RECIPES, recipe('bronzehacke', { bronze: 3, kernholz: 1 }), recipe('bronzehacke', { bronze: 5 }, 'billig')]);
    expect(twoWays.errors).toHaveLength(1);
    // A T0 pickaxe needs no key.
    expect(check().errors).toEqual([]);
  });

  it('Waffe oder Rüstung mit Boss-Drop ⇒ Fehler (auch über ein Zwischenprodukt)', () => {
    const items = [...BASE_ITEMS, weapon('kernspeer', 1), item('schuppenplatte', { stufe: 1 }), armour('schuppenhelm', 'kopf', 1)];
    const recipes = [...BASE_RECIPES, recipe('kernspeer', { bronze: 1, kernholz: 1 }), recipe('schuppenplatte', { schuppe: 2 }), recipe('schuppenhelm', { schuppenplatte: 1 })];
    expect(check(items, recipes).errors).toEqual([
      'Gating: Waffe kernspeer (T1) braucht den Boss-Drop kernholz – Waffen und Rüstung einer Stufe brauchen keinen',
      'Gating: Rüstung schuppenhelm (T1) braucht den Boss-Drop schuppe – Waffen und Rüstung einer Stufe brauchen keinen',
    ]);
  });

  it('Stufe ohne Waffe bzw. Rüstungsset ohne Boss-Drop ⇒ Fehler; ein offener geplanter Task entschuldigt', () => {
    const noWeapon = BASE_ITEMS.filter((i) => i.id !== 'speer_1');
    const noWeaponRecipes = BASE_RECIPES.filter((r) => r.id !== 'rezept_speer_1');
    expect(check(noWeapon, noWeaponRecipes).errors).toEqual(['Gating: Stufe T1 hat Werkzeuge, aber keine Waffe ohne Boss-Drop']);
    // Only a weapon that needs a boss drop does not count either.
    const bossWeapon = check([...noWeapon, weapon('kernspeer', 1)], [...noWeaponRecipes, recipe('kernspeer', { kernholz: 1 })]);
    expect(bossWeapon.errors).toContain('Gating: Stufe T1 hat Werkzeuge, aber keine Waffe ohne Boss-Drop');
    // Three of four armour pieces are no set.
    const noBoots = check(
      BASE_ITEMS.filter((i) => i.id !== 'stiefel_0'),
      BASE_RECIPES.filter((r) => r.id !== 'rezept_stiefel_0'),
    );
    expect(noBoots.errors).toEqual(['Gating: Stufe T0 hat Werkzeuge, aber kein Rüstungsset ohne Boss-Drop']);
    // Planned with an open task: fine; with a finished task: error; planned but present: stale warning.
    expect(check(noWeapon, noWeaponRecipes, { ...OPTIONS, geplant: { 1: { waffe: 'M6-11' } } })).toEqual({ errors: [], warnings: [] });
    expect(check(noWeapon, noWeaponRecipes, { ...OPTIONS, geplant: { 1: { waffe: 'M4-10' } } }).errors).toEqual(['Gating: Waffe für T1 war mit M4-10 geplant, der Task ist erledigt – die Waffe fehlt aber']);
    expect(check(noWeapon, noWeaponRecipes, { ...OPTIONS, geplant: { 1: { waffe: 'M99-1' } } }).errors).toEqual(['Gating: geplante Waffe für T1 nennt unbekannten Task M99-1']);
    expect(check(BASE_ITEMS, BASE_RECIPES, { ...OPTIONS, geplant: { 1: { waffe: 'M6-11' } } }).warnings).toHaveLength(1);
    // A tier without tools needs nothing.
    const onlyT0 = BASE_ITEMS.filter((i) => i.stufe === 0 || i.kategorie === 'rohstoff');
    expect(check(onlyT0, BASE_RECIPES.filter((r) => onlyT0.some((i) => i.id === r.ergebnis.item))).errors).toEqual([]);
  });

  it('falsche Abbaukraft, Härte oder Tabelle ⇒ Fehler', () => {
    expect(check([...BASE_ITEMS.filter((i) => i.id !== 'bronzeaxt'), tool('bronzeaxt', 'axt', 1, 1)]).errors).toEqual(['Gating: Werkzeug bronzeaxt (T1) hat Abbaukraft 1, die Stufe verlangt 2']);
    expect(check(BASE_ITEMS, BASE_RECIPES, OPTIONS, { oreHardness: 3 }).errors).toEqual(['Gating: Erz eisen hat Härte 3, §13.2 verlangt 2']);
    expect(check(BASE_ITEMS, BASE_RECIPES, OPTIONS, { torf: 1 }).errors).toEqual(['Gating: Boden torf hat Grabhärte 1, §13.2 verlangt 2']);
    expect(check(BASE_ITEMS, BASE_RECIPES, { ...OPTIONS, hardness: { ...HARDNESS, 'erz:eisen': 3 } }, { oreHardness: 3 }).errors).toEqual(['Gating: erz:eisen (Härte 3) wird von T1 erschlossen – seine Härte muss 2 sein']);
    expect(check(BASE_ITEMS, BASE_RECIPES, { ...OPTIONS, miningPower: [1, 3] }).errors).toEqual(['Gating: BALANCE.tools.miningPowerByTier[1] = 3, die Tabelle nennt 2']);
  });
});
