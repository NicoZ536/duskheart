/**
 * M3-01 Validator-Regeln §31.4 für Items: fehlendes Icon, fehlender Text, fehlende Quelle oder
 * Verwendung ⇒ Fehler; Endprodukt ohne Verwendung erlaubt; geplante Verwendungen nur mit offenem Task.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTENT } from '../../../src/content/index';
import { ITEMS, itemFigureLayer, itemIconId, itemLayerSpriteId } from '../../../src/content/items/index';
import { ContentRegistry, type ContentRegistryView } from '../../../src/content/registry';
import { idSchema, localizedTextSchema, ref, refSchema } from '../../../src/content/schema/common';
import { itemSchema, type ItemInput } from '../../../src/content/schema/item';
import { conventionSpriteIds, loadRegistry } from '../../../tools/validator/checks';
import { checkItems, taskStatus, type ItemCheckInput } from '../../../tools/validator/items';
import { GEPLANTE_VERWENDUNGEN, type GeplanteVerwendung } from '../../../tools/validator/verwendungen-geplant';

const PROGRESS = ['- [x] M3-01 Item-Schema', '- [ ] M3-16 Crafting-Kern', '- [X] M3-99 erledigt groß'].join('\n');

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

const objectSchema = z.object({ id: idSchema, name: localizedTextSchema, drops: z.array(z.object({ item: refSchema }).strict()).optional() }).strict();
const terrainSchema = z.object({ id: idSchema, dig: z.object({ tool: z.string() }).nullable() }).strict();

/** A consistent world: wood from a tree, stone from digging, a burning wood item, an edible berry. */
function registry(items: ItemInput[], extraRefs: boolean = false): ContentRegistryView {
  return new ContentRegistry()
    .defineCollection('terrain', terrainSchema, [
      { id: 'sand', dig: { tool: 'schaufel' } },
      { id: 'strasse', dig: null },
    ])
    .defineCollection(
      'worldObjects',
      objectSchema,
      [
        { id: 'baum_eiche', name: { de: 'Eiche', en: 'Oak' }, drops: [{ item: 'holz' }] },
        { id: 'busch_beeren', name: { de: 'Busch', en: 'Bush' }, drops: [{ item: 'beeren' }] },
      ],
      { refs: [ref('drops[].item', 'items'), ...(extraRefs ? [ref('name.de', 'items')] : [])] },
    )
    .defineCollection('items', itemSchema, items);
}

const BASE: ItemInput[] = [
  item('holz', { brennwert: 45 }),
  item('beeren', { kategorie: 'nahrung', stapel: 20, frische: 3, essbar: { saettigung: 4, durst: 3 } }),
];

function run(items: ItemInput[], opts: Partial<ItemCheckInput> = {}) {
  const reg = registry(items);
  const sprites = new Set(items.map((i) => itemIconId(i.id)));
  return checkItems({ registry: reg, spriteIds: sprites, geplant: {}, progress: PROGRESS, ...opts });
}

describe('Item-Regeln des Validators', () => {
  it('ein stimmiger Fixture-Content ist fehlerfrei', () => {
    expect(run(BASE)).toEqual({ errors: [], warnings: [] });
  });

  it('fehlendes Icon ⇒ Fehler', () => {
    const res = run(BASE, { spriteIds: new Set(['icon_holz']) });
    expect(res.errors).toEqual(['Item beeren: Icon icon_beeren fehlt']);
  });

  it('an der Figur sichtbare Items brauchen ihr Ausrüstungs-Sprite', () => {
    const axe = item('axt', { kategorie: 'werkzeug', stapel: 1, haltbarkeit: 60, werkzeug: { art: 'axt', abbaukraft: 1 }, quellen: ['haendlerin'] });
    const res = run([...BASE, axe]);
    expect(res.errors).toEqual(['Item axt: Ausrüstungs-Sprite ausruestung_axt fehlt (Figuren-Layer waffe)']);
    expect(run([...BASE, axe], { spriteIds: new Set(['icon_holz', 'icon_beeren', 'icon_axt', 'ausruestung_axt']) }).errors).toEqual([]);
  });

  it('fehlender Text ⇒ Fehler (beim Laden durch das Schema, sonst durch die Prüfung)', async () => {
    const loaded = await loadRegistry(() => registry([...BASE, { ...item('stein'), beschreibung: { de: 'Stein.' } } as never]));
    expect(loaded.errors).toEqual([expect.stringMatching(/Content items\[2\] "stein" invalid: beschreibung\.en/)]);
    const lax = new ContentRegistry().defineCollection('items', z.object({ id: idSchema, name: z.unknown(), beschreibung: z.unknown() }), [
      { id: 'stein', name: { de: 'Stein', en: ' ' }, beschreibung: undefined },
    ]);
    const res = checkItems({ registry: lax, spriteIds: new Set(['icon_stein']), geplant: {}, progress: PROGRESS });
    expect(res.errors.slice(0, 2)).toEqual(['Item stein: Übersetzung fehlt (EN) in "name"', 'Item stein: Text "beschreibung" fehlt']);
  });

  it('fehlende Quelle ⇒ Fehler; deklarierte Quellen müssen auflösen', () => {
    expect(run([...BASE, item('stein', { brennwert: 1 })]).errors).toEqual(['Item stein: keine Quelle (weder deklarierte quellen noch Drops, Rezepte o. Ä.)']);
    expect(run([...BASE, item('stein', { brennwert: 1, quellen: ['graben:sand'] })]).errors).toEqual([]);
    const errors = run([...BASE, item('stein', { brennwert: 1, quellen: ['graben:strasse', 'graben:lava', 'welt:baum_eiche', 'drop:wolf', 'haendlerin'] })]).errors;
    expect(errors).toEqual([
      'Item stein: Quelle "graben:strasse": strasse lässt sich nicht graben',
      'Item stein: Quelle "graben:lava": terrain/lava existiert nicht',
      'Item stein: Quelle "welt:baum_eiche": baum_eiche lässt "stein" nicht fallen (drops)',
      'Item stein: Quelle "drop:wolf": Sammlung "creatures" gibt es (noch) nicht',
    ]);
  });

  it('fehlende Verwendung ⇒ Fehler; Endprodukt ohne Verwendung erlaubt', () => {
    const stone = item('stein', { quellen: ['haendlerin'] });
    expect(run([...BASE, stone]).errors).toEqual([
      'Item stein: keine Verwendung (kein Rezept, keine Baukosten, nicht ess-, brenn-, trag- oder pflanzbar) und nicht als endprodukt markiert',
    ]);
    expect(run([...BASE, { ...stone, endprodukt: true }]).errors).toEqual([]);
  });

  it('geplante Verwendung: offen ⇒ Warnung, erledigt oder unbekannt ⇒ Fehler, veraltet ⇒ Warnung', () => {
    const stone = item('stein', { quellen: ['haendlerin'] });
    const plan = (task: string): Record<string, GeplanteVerwendung> => ({ stein: { task, zweck: 'Steinaxt' } });
    expect(run([...BASE, stone], { geplant: plan('M3-16') })).toEqual({ errors: [], warnings: ['Items mit geplanter Verwendung (1): stein → M3-16'] });
    expect(run([...BASE, stone], { geplant: plan('M3-01') }).errors).toEqual([
      'Item stein: Verwendung war mit M3-01 geplant (Steinaxt), der Task ist erledigt – das Item hat aber noch keine Verwendung',
    ]);
    expect(run([...BASE, stone], { geplant: plan('M9-99') }).errors).toEqual(['Item stein: geplante Verwendung nennt unbekannten Task M9-99']);
    const stale = run(BASE, { geplant: { holz: { task: 'M3-16', zweck: 'x' } } });
    expect(stale.errors).toEqual([]);
    expect(stale.warnings).toEqual([expect.stringMatching(/^Geplante Verwendung für holz \(M3-16\) ist veraltet/)]);
    expect(run(BASE, { geplant: { gold: { task: 'M3-16', zweck: 'x' } } }).errors).toEqual(['Geplante Verwendung für unbekanntes Item gold']);
  });

  it('jede Referenz auf items muss als Quelle oder Verwendung eingeordnet sein', () => {
    const reg = registry([...BASE, item('eiche', { brennwert: 1, quellen: ['haendlerin'] })], true);
    const res = checkItems({ registry: reg, spriteIds: new Set(['icon_holz', 'icon_beeren', 'icon_eiche']), geplant: {}, progress: PROGRESS });
    expect(res.errors).toEqual([
      'Referenz worldObjects/baum_eiche.name.de → items ist weder als Quelle noch als Verwendung eingeordnet (src/content/items/relations.ts)',
      'Referenz worldObjects/busch_beeren.name.de → items ist weder als Quelle noch als Verwendung eingeordnet (src/content/items/relations.ts)',
    ]);
  });

  it('ohne Sammlung items gibt es nichts zu prüfen', () => {
    expect(checkItems({ registry: new ContentRegistry(), spriteIds: new Set(), geplant: {}, progress: '' })).toEqual({ errors: [], warnings: [] });
  });

  it('Task-Status aus PROGRESS.md', () => {
    expect(taskStatus(PROGRESS, 'M3-01')).toBe('erledigt');
    expect(taskStatus(PROGRESS, 'M3-99')).toBe('erledigt');
    expect(taskStatus(PROGRESS, 'M3-16')).toBe('offen');
    expect(taskStatus(PROGRESS, 'M3-1')).toBeNull();
    expect(taskStatus(PROGRESS, 'M3-160')).toBeNull();
  });
});

describe('Item-Regeln am echten Content', () => {
  const progress = readFileSync(join(process.cwd(), 'PROGRESS.md'), 'utf8');

  it('bestehen, sobald die Icons und Figuren-Layer da sind; offen bleiben nur geplante Verwendungen', () => {
    const icons = ITEMS.map((i) => itemIconId(i.id));
    const layers = ITEMS.filter((i) => itemFigureLayer(i) !== null).map((i) => itemLayerSpriteId(i.id));
    const res = checkItems({ registry: CONTENT, spriteIds: new Set([...icons, ...layers]), geplant: GEPLANTE_VERWENDUNGEN, progress });
    expect(res.errors).toEqual([]);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/^Items mit geplanter Verwendung/);
  });

  it('jede geplante Verwendung nennt einen Task aus PROGRESS.md', () => {
    for (const [id, plan] of Object.entries(GEPLANTE_VERWENDUNGEN)) {
      expect(CONTENT.has('items', id), id).toBe(true);
      expect(taskStatus(progress, plan.task), `${id} → ${plan.task}`).not.toBeNull();
      expect(plan.zweck.length).toBeGreaterThan(3);
    }
  });

  it('Icons gelten als verwendete Sprites (keine Warnung „wird nirgends verwendet“)', () => {
    const convention = new Set(conventionSpriteIds());
    for (const i of ITEMS) expect(convention.has(itemIconId(i.id)), i.id).toBe(true);
  });
});
