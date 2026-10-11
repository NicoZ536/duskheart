/**
 * Dialoge (docs/SPIEL.md §23 „Dialoge“, zod-Schema in src/content/quests/schema.ts; M7-42): jede Zeile DE und EN, ein fehlender
 * EN-Text ist ein Fehler (Schema und Validator), jeder Dialog gehört zu einem Aufgabenschritt, Funkes Zeilen passen in zwei
 * Zeilen seiner Box (Regel `funke`, funke.test.ts misst sie).
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { dialogSchema } from '../../../src/content/quests/schema';
import { ContentRegistry } from '../../../src/content/registry';
import { checkLocalizedTexts } from '../../../tools/validator/checks';

describe('Dialoge', () => {
  it('jede Zeile in DE und EN, jeder Dialog an einem Aufgabenschritt', () => {
    const dialogs = CONTENT.collection('dialogs').values();
    expect(dialogs.length).toBeGreaterThanOrEqual(3);
    const genutzt = new Set(CONTENT.collection('quests').values().flatMap((q) => q.schritte.map((s) => s.dialog).filter((d): d is string => d !== undefined)));
    for (const d of dialogs) {
      expect(genutzt.has(d.id), d.id).toBe(true);
      for (const z of d.zeilen) expect(z.de.trim().length * z.en.trim().length, d.id).toBeGreaterThan(0);
    }
  });

  it('fehlender EN-Text ⇒ Fehler: das Schema lehnt ab, die Registry lädt nicht, der Validator nennt die Stelle', () => {
    const ohneEn = { id: 'funke_probe', sprecher: 'funke', zeilen: [{ de: 'Hallo.' }] };
    const r = dialogSchema.safeParse(ohneEn);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toEqual(['zeilen.0.en']);
    expect(() => new ContentRegistry().defineCollection('dialogs', dialogSchema, [ohneEn as never])).toThrow(/funke_probe/);
    expect(dialogSchema.safeParse({ ...ohneEn, zeilen: [{ de: 'Hallo.', en: '   ' }] }).success).toBe(false);
    // The validator's text rule over a registry that took a record past the schema (a view without it).
    const view = { collections: () => [{ name: 'dialogs', values: () => [ohneEn], ids: () => ['funke_probe'] }] } as unknown as Parameters<typeof checkLocalizedTexts>[0];
    expect(checkLocalizedTexts(view)).toEqual(['Übersetzung fehlt (EN): dialogs/funke_probe.zeilen[0]']);
  });
});
