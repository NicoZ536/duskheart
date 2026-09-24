/**
 * Texte rund um Items (MASTERPROMPT §2.2, §26; ADR-0005): Content-Texte stehen am Datensatz, die Namen
 * der Aufzählungen (Kategorie, Rarität, Werte, Werkzeugarten, Ausrüstungsplätze, Taschenbereiche,
 * Ablehnungsgründe, Herkunft, Verwendung) als UI-Schlüssel in de.json und en.json.
 */
import { describe, expect, it } from 'vitest';
import { ITEM_USE_KINDS } from '../../../src/content/items/index';
import { RARITIES } from '../../../src/content/schema/common';
import { ARMOR_WEIGHT_CLASSES, ITEM_CATEGORIES, ITEM_SOURCE_KINDS, ITEM_STATS, ITEM_TOOL_KINDS } from '../../../src/content/schema/item';
import { INVENTORY_REJECT_REASONS } from '../../../src/game/inventory/ops';
import { BAG_AREAS, EQUIPMENT_SLOTS } from '../../../src/game/items/slots';
import de from '../../../src/i18n/de.json';
import en from '../../../src/i18n/en.json';

const expected: Array<[string, readonly string[]]> = [
  ['ui.item.kategorie', ITEM_CATEGORIES],
  ['ui.item.raritaet', RARITIES],
  ['ui.item.wert', ITEM_STATS],
  ['ui.item.werkzeugart', ITEM_TOOL_KINDS],
  ['ui.item.ruestungsgewicht', ARMOR_WEIGHT_CLASSES],
  ['ui.item.quelle', Object.keys(ITEM_SOURCE_KINDS)],
  ['ui.item.verwendung', ITEM_USE_KINDS],
  ['ui.equipment.slot', EQUIPMENT_SLOTS],
  ['ui.inventory.bereich', BAG_AREAS],
  ['ui.inventory.reject', INVENTORY_REJECT_REASONS],
];

describe('UI-Schlüssel der Item-Aufzählungen', () => {
  it.each(expected)('%s.<wert> gibt es für jeden Wert in DE und EN', (prefix, values) => {
    for (const v of values) {
      const key = `${prefix}.${v}`;
      expect((de as Record<string, string>)[key], `de:${key}`).toBeTruthy();
      expect((en as Record<string, string>)[key], `en:${key}`).toBeTruthy();
    }
  });

  it('Tooltip-Zeilen mit denselben Platzhaltern in beiden Sprachen', () => {
    const lines: Array<[string, string[]]> = [
      ['ui.item.stufe', ['stufe']],
      ['ui.item.haltbarkeit', ['wert', 'max']],
      ['ui.item.frische', ['wert']],
      ['ui.item.brennwert', ['sekunden']],
      ['ui.item.essbar', ['saettigung', 'durst']],
      ['ui.item.werkzeug', ['art', 'kraft']],
      ['ui.inventory.voll', ['item', 'anzahl']],
      ['ui.equipment.kaputt', ['item']],
    ];
    for (const [key, names] of lines) {
      for (const dict of [de, en] as Array<Record<string, string>>) for (const n of names) expect(dict[key], key).toContain(`{${n}}`);
    }
  });
});
