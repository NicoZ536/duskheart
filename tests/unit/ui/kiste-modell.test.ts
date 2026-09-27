/**
 * M4-21: the rules of the chest screen (src/ui/screens/kiste/modell.ts) – the name on the lid (own or the item's,
 * trimmed and cut to the longest name), the icon label selector (none, then the items the chest holds, the current
 * label kept, wrapping), which bag stacks the chest takes (the shelf: raw materials and ingots only) and the texts
 * of refused storage commands.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { newStack } from '../../../src/game/items/stack';
import { STORAGE_REJECT_REASONS } from '../../../src/game/storage/events';
import { createI18n } from '../../../src/i18n';
import { etikettAuswahl, kistenAblehnung, kistenName, nameKlemmen, naechstesEtikett, passtHinein } from '../../../src/ui/screens/kiste/modell';

const catalog = contentItemCatalog();
const stack = (id: string, n = 1) => newStack(catalog.get(id), n);

describe('Name', () => {
  it('zeigt den eigenen Namen, sonst den des Behälters', () => {
    expect(kistenName('Erze', 'Holzkiste')).toBe('Erze');
    expect(kistenName('   ', 'Holzkiste')).toBe('Holzkiste');
  });

  it('kürzt auf die längste erlaubte Länge und schneidet Leerraum ab', () => {
    expect(nameKlemmen('  Vorrat  ')).toBe('Vorrat');
    expect([...nameKlemmen('Ä'.repeat(BALANCE.storage.nameMaxLength + 5))]).toHaveLength(BALANCE.storage.nameMaxLength);
  });
});

describe('Icon-Etikett', () => {
  it('bietet „keins“ und die Items der Kiste in Platzreihenfolge, das aktuelle bleibt wählbar', () => {
    const slots = [stack('stein', 5), null, stack('holz', 3), stack('stein', 2)];
    expect(etikettAuswahl(slots, null)).toEqual([null, 'stein', 'holz']);
    expect(etikettAuswahl(slots, 'lehm')).toEqual([null, 'stein', 'holz', 'lehm']);
    const auswahl = etikettAuswahl(slots, null);
    expect(naechstesEtikett(auswahl, null, 1)).toBe('stein');
    expect(naechstesEtikett(auswahl, 'holz', 1)).toBeNull();
    expect(naechstesEtikett(auswahl, null, -1)).toBe('holz');
  });
});

describe('Was hineinpasst und Ablehnungen', () => {
  it('das Lagerregal nimmt nur Rohstoffe und Barren', () => {
    const only = BALANCE.storage.containers.lagerregal?.only ?? null;
    expect(passtHinein(only, catalog.get('stein'))).toBe(true);
    expect(passtHinein(only, catalog.get('steinaxt'))).toBe(false);
    expect(passtHinein(null, catalog.get('steinaxt'))).toBe(true);
  });

  it('hat für jeden Grund der Lagerung einen Text', () => {
    const de = createI18n('de', { strict: true });
    const en = createI18n('en', { strict: true });
    for (const r of STORAGE_REJECT_REASONS) {
      expect(kistenAblehnung(de, r).length).toBeGreaterThan(0);
      expect(kistenAblehnung(en, r).length).toBeGreaterThan(0);
    }
  });
});
