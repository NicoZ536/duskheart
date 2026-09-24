/**
 * Test items for bags and equipment: the real T0 content plus fixture pieces of the categories that
 * later milestones bring (tools, weapons, armour, shield, light, jewellery, backpacks, potion) – all
 * validated with the real item schema, so the tests exercise exactly the rules the content obeys.
 */
import { baseItem, defineItemGroup, ITEM_SFX } from '../../../src/content/items/define';
import { ITEMS } from '../../../src/content/items/index';
import type { ItemSpec } from '../../../src/content/items/define';
import { ItemCatalog } from '../../../src/game/items/catalog';

function probe(id: string, spec: Omit<ItemSpec, 'id' | 'name' | 'beschreibung' | 'tauschwert' | 'sounds'>): ReturnType<typeof baseItem> {
  return baseItem({
    id,
    name: { de: `Probe ${id}`, en: `Probe ${id}` },
    beschreibung: { de: 'Testgegenstand.', en: 'Test item.' },
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.holz },
    ...spec,
  });
}

/** Fixture items (ids `probe_*`). */
export const PROBE_ITEMS = defineItemGroup('proben', [
  probe('probe_axt', { kategorie: 'werkzeug', haltbarkeit: 60, werkzeug: { art: 'axt', abbaukraft: 1 } }),
  probe('probe_speer', { kategorie: 'waffe', haltbarkeit: 60, werte: { schaden: 8 } }),
  probe('probe_helm', { kategorie: 'ruestung', ausruestung: 'kopf', ruestungsgewicht: 'leicht', haltbarkeit: 60, werte: { ruestung: 2, isolation: 5 } }),
  probe('probe_brust', { kategorie: 'ruestung', ausruestung: 'brust', ruestungsgewicht: 'mittel', haltbarkeit: 60, werte: { ruestung: 3, isolation: 30, maxLeben: 10 } }),
  probe('probe_stiefel', { kategorie: 'ruestung', ausruestung: 'fuesse', ruestungsgewicht: 'schwer', haltbarkeit: 60, werte: { ruestung: 1, tempo: -0.05 } }),
  probe('probe_umhang', { kategorie: 'ruestung', ausruestung: 'ruecken', ruestungsgewicht: 'leicht', haltbarkeit: 60, werte: { isolation: 20, kuehlung: 3, maxAusdauer: 5 } }),
  probe('probe_schild', { kategorie: 'schild', ausruestung: 'nebenhand', haltbarkeit: 60, werte: { blockkraft: 0.4 } }),
  probe('probe_fackel', { kategorie: 'licht', ausruestung: 'nebenhand', werte: { lichtradius: 6 } }),
  probe('probe_ring', { kategorie: 'schmuck', ausruestung: 'schmuck', werte: { magnetradius: 1, furchtresistenz: 0.6 } }),
  probe('probe_amulett', { kategorie: 'schmuck', ausruestung: 'schmuck', werte: { furchtresistenz: 0.6 } }),
  probe('probe_rucksack_8', { kategorie: 'rucksack', rucksack: { plaetze: 8 } }),
  probe('probe_rucksack_16', { kategorie: 'rucksack', rucksack: { plaetze: 16 } }),
  probe('probe_trank', { kategorie: 'trank' }),
]);

/** Real content items plus the fixture items. */
export function testCatalog(): ItemCatalog {
  return new ItemCatalog([...ITEMS, ...PROBE_ITEMS]);
}
