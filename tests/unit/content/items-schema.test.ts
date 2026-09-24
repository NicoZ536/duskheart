/**
 * M3-01 Item-Schema (MASTERPROMPT §13.1, §4.5, §31.4; docs/SPIEL.md §2) und M3-04 Grundressourcen T0
 * (docs/SPIEL.md §6): Schemaregeln, Stapelgrößen je Kategorie, Raritätsfarben, Zählung, kanonische Ids.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RARITY_COLORS } from '../../../assets-src/palette';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { baseItem, defineItemGroup, ITEM_SFX, ItemGroupError, type ItemSpec } from '../../../src/content/items/define';
import { ITEM_GROUPS, ITEMS, itemCountCategories, itemFigureLayer, itemIconId, itemLayerSpriteId } from '../../../src/content/items/index';
import { RARITIES } from '../../../src/content/schema/common';
import { formatItemSource, ITEM_CATEGORIES, ITEM_TOOL_KINDS, itemSchema, parseItemSource, type ItemInput } from '../../../src/content/schema/item';
import { TOOL_KINDS } from '../../../src/content/terrain';
import { RARITY_REFS } from '../../../src/generated/palette';

/** A valid raw material; tests change one field at a time. */
function raw(overrides: Partial<ItemInput> = {}): ItemInput {
  return {
    id: 'probe',
    name: { de: 'Probe', en: 'Probe' },
    beschreibung: { de: 'Eine Probe.', en: 'A probe.' },
    kategorie: 'rohstoff',
    stufe: 0,
    raritaet: 'gewoehnlich',
    stapel: 100,
    tauschwert: 1,
    sounds: { aufheben: 'sfx_item_stein' },
    ...overrides,
  };
}

function issues(item: unknown): string[] {
  const r = itemSchema.safeParse(item);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

/** The canonical T0 raw material ids of docs/SPIEL.md §6. */
function canonicalT0Ids(): string[] {
  const doc = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');
  const line = doc.split('\n').find((l) => l.includes('**Rohstoffe T0 (M3-04)**'));
  if (line === undefined) throw new Error('docs/SPIEL.md §6 lists no T0 raw materials');
  return [...line.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1] as string);
}

describe('M3-04: Grundressourcen T0', () => {
  it('enthält jede kanonische Id aus docs/SPIEL.md §6 und mindestens 40 Items', () => {
    const ids = canonicalT0Ids();
    expect(ids.length).toBeGreaterThanOrEqual(40);
    expect(ids.filter((id) => !CONTENT.has('items', id))).toEqual([]);
    expect(ITEMS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  });

  it('die Registry zählt jedes Item unter „Items gesamt“', () => {
    expect(CONTENT.collection('items').size).toBe(ITEMS.length);
    expect(CONTENT.countsByCategory().items).toBe(ITEMS.length);
    expect(Object.values(ITEM_GROUPS).flat()).toEqual(ITEMS);
  });

  it('jedes Item hat Texte DE/EN, einen Aufhebe-Sound und passende Stufe', () => {
    for (const item of ITEMS) {
      expect(item.name.de.length * item.name.en.length, item.id).toBeGreaterThan(0);
      expect(item.beschreibung.de.length, item.id).toBeGreaterThan(20);
      expect(item.beschreibung.en.length, item.id).toBeGreaterThan(20);
      expect(Object.values(ITEM_SFX)).toContain(item.sounds.aufheben);
    }
    // Saltpetre needs mining power 2 (§13.2 via the ore hardness), everything else is T0.
    expect(ITEMS.filter((i) => i.stufe !== 0).map((i) => i.id)).toEqual(['salpeter']);
    expect(CONTENT.get('ores', 'salpeter').hardness).toBe(2);
  });

  it('Nahrung ist essbar und verdirbt, Brennstoffe haben ihren Brennwert (§15.4, §18)', () => {
    for (const item of ITEMS.filter((i) => i.kategorie === 'nahrung')) {
      expect(item.essbar, item.id).toBeDefined();
      expect(item.frische, item.id).toBeGreaterThan(0);
    }
    expect(CONTENT.get('items', 'zweig').brennwert).toBe(15);
    expect(CONTENT.get('items', 'holz').brennwert).toBe(45);
    for (const id of ['himbeeren', 'blaubeeren', 'walderdbeeren']) expect(CONTENT.get('items', id).frische).toBe(3);
    expect(CONTENT.get('items', 'tang').essbar?.durst).toBeLessThan(0);
  });

  it('Setzlinge pflanzen den Baum ihrer Art', () => {
    const saplings = ITEMS.filter((i) => i.kategorie === 'saatgut');
    expect(saplings).toHaveLength(9);
    for (const s of saplings) {
      expect(s.pflanzt).toBe(`baum_${s.id.replace('setzling_', '')}`);
      expect(CONTENT.get('worldObjects', s.pflanzt as string).kind).toBe('baum');
    }
  });
});

describe('M3-01: Item-Schema', () => {
  it('ein vollständiges Item ist gültig', () => {
    expect(issues(raw())).toEqual([]);
  });

  it('Stapelgröße folgt der Kategorie (§13.1)', () => {
    expect(BALANCE.items.stack).toMatchObject({ rohstoff: 100, barren: 50, nahrung: 20, munition: 200, werkzeug: 1, waffe: 1, ruestung: 1 });
    expect(Object.keys(BALANCE.items.stack).sort()).toEqual([...ITEM_CATEGORIES].sort());
    expect(issues(raw({ stapel: 50 }))).toEqual([expect.stringMatching(/^stapel: stack size of category rohstoff is 100/)]);
    expect(baseItem({ ...raw(), kategorie: 'barren' } as ItemSpec).stapel).toBe(50);
  });

  it('Haltbarkeit: Pflicht für Werkzeuge, Waffen, Rüstung, Schilde; nie stapelbar', () => {
    const tool = raw({ kategorie: 'werkzeug', stapel: 1, werkzeug: { art: 'axt', abbaukraft: 1 } });
    expect(issues(tool)).toEqual([expect.stringMatching(/^haltbarkeit: werkzeug needs a durability/)]);
    expect(issues({ ...tool, haltbarkeit: 60 })).toEqual([]);
    expect(issues(raw({ haltbarkeit: 10 }))).toEqual([expect.stringMatching(/never stack/)]);
    expect(issues({ ...tool, haltbarkeit: 60, werkzeug: undefined })).toEqual([expect.stringMatching(/^werkzeug: tools need tool data/)]);
    expect(issues(raw({ werkzeug: { art: 'axt', abbaukraft: 1 } }))).toEqual([expect.stringMatching(/only tools and weapons/)]);
    expect(issues({ ...tool, haltbarkeit: 60, werkzeug: { art: 'axt', abbaukraft: 9 } })).toHaveLength(1);
  });

  it('Ausrüstungsplatz und Rüstungsgewicht passen zur Kategorie', () => {
    const armour = raw({ kategorie: 'ruestung', stapel: 1, haltbarkeit: 60, ausruestung: 'kopf', ruestungsgewicht: 'leicht', werte: { ruestung: 2 } });
    expect(issues(armour)).toEqual([]);
    expect(issues({ ...armour, ausruestung: 'nebenhand' })).toEqual([expect.stringMatching(/^ausruestung: armour goes to one of/)]);
    expect(issues({ ...armour, ruestungsgewicht: undefined })).toEqual([expect.stringMatching(/weight class/)]);
    expect(issues(raw({ kategorie: 'schild', stapel: 1, haltbarkeit: 60, ausruestung: 'kopf' }))).toEqual([expect.stringMatching(/schild goes to the slot nebenhand/)]);
    expect(issues(raw({ kategorie: 'licht', stapel: 1 }))).toEqual([expect.stringMatching(/licht goes to the slot nebenhand/)]);
    expect(issues(raw({ kategorie: 'schmuck', stapel: 1, ausruestung: 'schmuck' }))).toEqual([]);
    expect(issues(raw({ ausruestung: 'kopf' }))).toEqual([expect.stringMatching(/rohstoff is not worn/)]);
    expect(issues(raw({ ruestungsgewicht: 'schwer' }))).toEqual([expect.stringMatching(/only armour has a weight class/)]);
  });

  it('Rucksäcke bringen 8, 16 oder 24 Plätze (§13.1)', () => {
    const pack = raw({ kategorie: 'rucksack', stapel: 1, rucksack: { plaetze: 16 } });
    expect(issues(pack)).toEqual([]);
    expect(issues({ ...pack, rucksack: { plaetze: 12 } })).toEqual([expect.stringMatching(/8, 16, 24/)]);
    expect(issues({ ...pack, rucksack: undefined })).toEqual([expect.stringMatching(/backpack data/)]);
  });

  it('Nahrung muss essbar sein, nur Verbrauchsgüter sind es; Saatgut nennt, was wächst', () => {
    const food = raw({ kategorie: 'nahrung', stapel: 20, essbar: { saettigung: 4, durst: 3 } });
    expect(issues(food)).toEqual([]);
    expect(issues({ ...food, essbar: undefined })).toEqual([expect.stringMatching(/nahrung must be edible/)]);
    expect(issues({ ...food, essbar: { saettigung: 0, durst: 0 } })).toEqual([expect.stringMatching(/change satiation or thirst/)]);
    expect(issues(raw({ essbar: { saettigung: 1, durst: 0 } }))).toEqual([expect.stringMatching(/only consumables/)]);
    expect(issues(raw({ kategorie: 'saatgut' }))).toEqual([expect.stringMatching(/^pflanzt:/)]);
    expect(issues(raw({ pflanzt: 'baum_eiche' }))).toEqual([expect.stringMatching(/^pflanzt:/)]);
  });

  it('Quellen, Sounds, Werte und Texte sind geformt', () => {
    expect(issues(raw({ quellen: ['welt:baum_eiche', 'graben:sand', 'haendlerin'] }))).toEqual([]);
    expect(issues(raw({ quellen: ['baum_eiche'] }))).toHaveLength(1);
    expect(issues(raw({ quellen: ['haendlerin:x'] }))).toHaveLength(1);
    expect(issues(raw({ quellen: ['welt:a', 'welt:a'] }))).toEqual([expect.stringMatching(/unique/)]);
    expect(issues(raw({ sounds: { aufheben: 'holz' } }))).toHaveLength(1);
    expect(issues(raw({ werte: { ruestung: 1, isolation: 2 } }))).toEqual([]);
    expect(issues(raw({ werte: { staerke: 1 } as never }))).not.toEqual([]);
    expect(issues(raw({ name: { de: 'Probe' } as never }))).toEqual([expect.stringMatching(/^name\.en/)]);
    expect(issues(raw({ beschreibung: { de: ' ', en: 'x' } }))).toEqual([expect.stringMatching(/^beschreibung\.de/)]);
    expect(issues({ ...raw(), farbe: 'rot' })).toHaveLength(1);
  });

  it('Quellenformat: parse und format', () => {
    expect(parseItemSource('welt:baum_eiche')).toEqual({ kind: 'welt', id: 'baum_eiche' });
    expect(parseItemSource('haendlerin')).toEqual({ kind: 'haendlerin', id: null });
    expect(parseItemSource('welt:')).toBeNull();
    expect(parseItemSource('zauber:x')).toBeNull();
    expect(formatItemSource('drop', 'wolf')).toBe('drop:wolf');
    expect(formatItemSource('haendlerin', null)).toBe('haendlerin');
  });

  it('defineItemGroup prüft jeden Datensatz und doppelte Ids', () => {
    expect(() => defineItemGroup('x', [raw({ stapel: 3 })])).toThrow(ItemGroupError);
    expect(() => defineItemGroup('x', [raw({ stapel: 3 })])).toThrow(/Item group "x" \[0\] "probe" invalid: stapel/);
    expect(() => defineItemGroup('x', [raw(), raw()])).toThrow(/duplicate id "probe"/);
    const group = defineItemGroup('x', [raw()]);
    expect(Object.isFrozen(group)).toBe(true);
    expect(Object.isFrozen(group[0]?.name)).toBe(true);
  });

  it('Werkzeugarten umfassen die Sammelwerkzeuge der Welt-Objekte', () => {
    for (const kind of TOOL_KINDS.filter((k) => k !== 'hand')) expect(ITEM_TOOL_KINDS).toContain(kind);
  });
});

describe('Rarität, Zählung, Sprites', () => {
  it('die fünf Raritäten haben ihre Farben (§4.5: weiß, grün, blau, violett, gold)', () => {
    expect(Object.keys(RARITY_REFS)).toEqual([...RARITIES]);
    expect(Object.keys(RARITY_COLORS)).toEqual([...RARITIES]);
    expect(RARITY_COLORS).toEqual({ gewoehnlich: 'eis.4', ungewoehnlich: 'gras.4', selten: 'wasser.4', episch: 'verderb.4', legendaer: 'feuer.4' });
  });

  it('Zählkategorien §C je Item-Kategorie (ADR-0006)', () => {
    expect(itemCountCategories({ kategorie: 'rohstoff' })).toEqual(['items']);
    expect(itemCountCategories({ kategorie: 'waffe' })).toEqual(['items', 'weapons']);
    expect(itemCountCategories({ kategorie: 'ruestung' })).toEqual(['items', 'armor']);
    expect(itemCountCategories({ kategorie: 'schmuck' })).toEqual(['items', 'jewelry']);
    expect(itemCountCategories({ kategorie: 'gericht' })).toEqual(['items', 'dishes']);
    expect(itemCountCategories({ kategorie: 'trank' })).toEqual(['items', 'potions']);
    expect(itemCountCategories({ kategorie: 'medizin' })).toEqual(['items', 'potions']);
    expect(itemCountCategories({ kategorie: 'bauteil' })).toEqual(['items', 'buildParts']);
  });

  it('Icon- und Ausrüstungs-Sprites per Konvention; Figuren-Layer §4.5', () => {
    expect(itemIconId('holz')).toBe('icon_holz');
    expect(itemLayerSpriteId('steinaxt')).toBe('ausruestung_steinaxt');
    expect(itemFigureLayer({ kategorie: 'werkzeug' })).toBe('waffe');
    expect(itemFigureLayer({ kategorie: 'licht', ausruestung: 'nebenhand' })).toBe('nebenhand');
    expect(itemFigureLayer({ kategorie: 'ruestung', ausruestung: 'kopf' })).toBe('kopf');
    expect(itemFigureLayer({ kategorie: 'ruestung', ausruestung: 'fuesse' })).toBe('beine');
    expect(itemFigureLayer({ kategorie: 'ruestung', ausruestung: 'ruecken' })).toBe('koerper');
    expect(itemFigureLayer({ kategorie: 'schmuck', ausruestung: 'schmuck' })).toBeNull();
    // Drawn on the figure (M3-07): the nine T0 tools and the spear in the hand, the torch in the off-hand.
    expect(ITEMS.filter((i) => itemFigureLayer(i) !== null).map((i) => [i.id, itemFigureLayer(i)])).toEqual([
      ['steinaxt', 'waffe'],
      ['steinspitzhacke', 'waffe'],
      ['steinschaufel', 'waffe'],
      ['steinhacke', 'waffe'],
      ['steinsichel', 'waffe'],
      ['steinhammer', 'waffe'],
      ['steinmesser', 'waffe'],
      ['holzeimer', 'waffe'],
      ['holzeimer_wasser', 'waffe'],
      ['fackel', 'nebenhand'],
      ['steinspeer', 'waffe'],
    ]);
  });
});
