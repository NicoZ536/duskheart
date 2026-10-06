/**
 * M4-10 Content T0–T1 (MASTERPROMPT §13.2 "T1 Bronze", §15.2, §15.4; docs/SPIEL.md §8 "Verarbeitungsprodukte
 * T0–T1"): Bronze aus Kupfer und Zinn, Barren, Zwischenprodukte (Bretter, Balken, Schindeln, Seile, Steinblöcke,
 * Stroh, Ziegel, Keramik, Glas, Lehmputz, Garn, Holzkohle, Nägel), Bronzewerkzeuge außer der Spitzhacke.
 * - Jedes kanonische Verarbeitungsprodukt ist ein Item mit Rezept an seiner Station, Texten DE/EN, Stufe T0/T1.
 * - Bronze: drei Kupferbarren und ein Zinnbarren; Barren aus Erz im Schmelzofen.
 * - Bronzewerkzeuge: Axt, Schaufel, Hacke, Sichel, Hammer, Messer – T1, Abbaukraft 2, 150 Nutzungen; keine
 *   Bronzespitzhacke (sie braucht das Kernholz, M7-34).
 * - Stufenreihenfolge und Erreichbarkeit grün für diesen Content; die Zielwerte zählen ihn.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { BRONZEWERKZEUGE } from '../../../src/content/items/verarbeitung_bronzewerkzeuge';
import { STATIONEN } from '../../../src/content/items/stationen';
import { VERARBEITUNG } from '../../../src/content/items/verarbeitung';
import { BRONZE_REZEPTE } from '../../../src/content/recipes/bronze';
import { STATIONEN_REZEPTE } from '../../../src/content/recipes/stationen';
import { VERARBEITUNG_REZEPTE } from '../../../src/content/recipes/verarbeitung';
import { checkReachability } from '../../../tools/validator/reachability';
import { checkTierOrder } from '../../../tools/validator/tiers';

const items = CONTENT.collection('items');
const recipes = CONTENT.collection('recipes');

/** Ids in backticks on the line of docs/SPIEL.md that contains `label`. */
function canonical(label: string): string[] {
  const doc = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');
  const line = doc.split('\n').find((l) => l.includes(label));
  if (line === undefined) throw new Error(`docs/SPIEL.md has no line ${label}`);
  return [...line.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1] as string);
}

/** The recipes making `item`. */
function makers(item: string): ReturnType<typeof recipes.values>[number][] {
  return recipes.values().filter((r) => r.ergebnis.item === item);
}

/** Concrete ingredients of a recipe [item → pieces]. */
function inputs(id: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const z of recipes.get(id).zutaten) out['item' in z ? z.item : `gruppe:${z.gruppe}`] = z.anzahl;
  return out;
}

const MINE = new Set([...VERARBEITUNG, ...STATIONEN, ...BRONZEWERKZEUGE].map((i) => i.id));
const MY_RECIPES = new Set([...VERARBEITUNG_REZEPTE, ...STATIONEN_REZEPTE, ...BRONZE_REZEPTE].map((r) => r.id));

describe('Verarbeitungsprodukte T0–T1', () => {
  it('jedes kanonische Produkt ist ein Item mit Rezept an einer Station, Texten und Stufe', () => {
    const products = canonical('**Verarbeitungsprodukte T0–T1**');
    expect(products).toEqual(['holzkohle', 'brett', 'balken', 'steinblock', 'ziegel_roh', 'ziegel', 'keramik_topf', 'glas', 'kupferbarren', 'zinnbarren', 'bronzebarren', 'garn', 'dachschindel', 'strohbuendel', 'nagel_bronze', 'lehmputz']);
    for (const id of products) {
      const item = items.get(id);
      expect([0, 1], id).toContain(item.stufe);
      expect(item.name.de && item.name.en && item.beschreibung.de && item.beschreibung.en, id).toBeTruthy();
      expect(makers(id).length, id).toBeGreaterThan(0);
      expect(makers(id).every((r) => r.station !== null), id).toBe(true);
    }
    for (const id of ['kupferbarren', 'zinnbarren', 'bronzebarren']) expect(items.get(id)).toMatchObject({ kategorie: 'barren', stapel: 50, stufe: 1 });
    expect(items.get('holzkohle').brennwert).toBe(BALANCE.stations.burnSeconds.holzkohle);
  });

  it('Bronze: drei Kupfer- und ein Zinnbarren; die Barren aus Erz im Schmelzofen', () => {
    expect(inputs('rezept_bronzebarren')).toEqual({ kupferbarren: 3, zinnbarren: 1 });
    expect(recipes.get('rezept_bronzebarren')).toMatchObject({ station: 'schmelzofen', ergebnis: { item: 'bronzebarren', anzahl: 4 } });
    expect(inputs('rezept_kupferbarren')).toEqual({ kupfererz: 2 });
    expect(inputs('rezept_zinnbarren')).toEqual({ zinnerz: 2 });
    // Seile: the fibre rope basic, and planks, bricks, pottery, glass, yarn, charcoal from their stations.
    expect(inputs('rezept_faserseil')).toEqual({ fasern: 3 });
    expect(inputs('rezept_brett')).toEqual({ 'gruppe:bauholz': 1 });
    expect(inputs('rezept_holzkohle')).toEqual({ 'gruppe:bauholz': 4 });
    expect(inputs('rezept_ziegel')).toEqual({ ziegel_roh: 2 });
    expect(inputs('rezept_glas')).toEqual({ sand: 3 });
  });

  it('Bronzewerkzeuge außer der Spitzhacke: T1, Abbaukraft 2, 150 Nutzungen, am Bronzeamboss', () => {
    const kinds = BRONZEWERKZEUGE.map((i) => i.werkzeug?.art);
    expect(kinds).toEqual(['axt', 'schaufel', 'hacke', 'sichel', 'hammer', 'messer']);
    for (const t of BRONZEWERKZEUGE) {
      expect(t).toMatchObject({ stufe: 1, haltbarkeit: BALANCE.items.durabilityByTier[1], werkzeug: { abbaukraft: BALANCE.tools.miningPowerByTier[1] } });
      expect(makers(t.id).map((r) => r.station), t.id).toEqual(['amboss_bronze']);
    }
    // The T1 pickaxe is no tool of this group: it needs the Borkenvater's Kernholz (§13.2; M7-34, strand F) – the only T1
    // pickaxe, hammered at the bronze anvil.
    expect(BRONZEWERKZEUGE.some((i) => i.werkzeug?.art === 'spitzhacke')).toBe(false);
    expect(items.values().filter((i) => i.stufe === 1 && i.werkzeug?.art === 'spitzhacke').map((i) => i.id)).toEqual(['bronzespitzhacke']);
    expect(makers('bronzespitzhacke').map((r) => [r.station, inputs(r.id)])).toEqual([['amboss_bronze', { bronzebarren: 3, kernholz: 1 }]]);
  });
});

describe('Validator: Stufenreihenfolge, Erreichbarkeit, Zählung', () => {
  it('kein Rezept dieses Contents braucht Material oder eine Station höherer Stufe', () => {
    expect(checkTierOrder(CONTENT).filter((e) => [...MY_RECIPES].some((id) => e.includes(`Rezept ${id} `)))).toEqual([]);
  });

  it('jedes Item und Rezept dieses Contents ist von der Welt aus erreichbar', () => {
    const r = checkReachability(CONTENT);
    for (const id of MINE) expect(r.items.has(id), id).toBe(true);
    for (const id of MY_RECIPES) expect(r.recipes.has(id), id).toBe(true);
    expect(r.errors.filter((e) => [...MINE, ...MY_RECIPES].some((id) => e.includes(` ${id} `)))).toEqual([]);
  });

  it('die Zielwerte zählen Items, Rezepte und Stationen dieses Contents', () => {
    const counts = CONTENT.countsByCategory();
    const targets = JSON.parse(readFileSync(join(process.cwd(), 'tools/validator/zielwerte.json'), 'utf8')) as { ziele: Record<string, number> };
    for (const k of ['items', 'recipes', 'stations']) expect(targets.ziele[k] ?? 0, k).toBeLessThanOrEqual(counts[k as 'items'] ?? 0);
    expect(targets.ziele.items).toBeGreaterThanOrEqual(61 + MINE.size);
    expect(targets.ziele.recipes).toBeGreaterThanOrEqual(17 + MY_RECIPES.size);
    expect(targets.ziele.stations).toBeGreaterThanOrEqual(11);
  });
});
