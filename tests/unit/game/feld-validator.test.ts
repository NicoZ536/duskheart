/**
 * Validator-Regel `feld` (M7-21, M7-22, M7-24; tools/validator/feld.ts) mit Fixtures: eine vollständige Nutzpflanze und ein
 * vollständiger Fisch bestehen; ein Stufen-Sprite mit einer Frame zu wenig, ein fehlendes Welk-Sprite, ein Ernte- oder
 * Saat-Item ohne Quelle `ernte:<id>`, eine Saat, die etwas anderes pflanzt, ein Fisch ohne `angeln:<id>`, ein unbekanntes
 * Biom, ein Köder ohne Block oder einer, der den Fisch nicht nennt, ein Köder mit unbekannter Fischart und ein Gewässer
 * ohne Fisch sind Fehler; ein Gewässer ohne Reusenfisch ist eine Warnung. Der echte Content besteht (Sprite-Angaben aus
 * den Stufen der Pflanzen: die Frames prüft der Validator selbst an den Quellen).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTENT } from '../../../src/content/index';
import { CROPS } from '../../../src/content/farming/index';
import { cropSpriteId, cropWiltedSpriteId } from '../../../src/content/farming/schema';
import { ContentRegistry, type ContentRegistryView } from '../../../src/content/registry';
import { idSchema } from '../../../src/content/schema/common';
import { checkFeld, type FeldSpriteInfo } from '../../../tools/validator/feld';

const loose = z.object({ id: idSchema }).passthrough();
type Row = { id: string } & Record<string, unknown>;

const CROP = { id: 'probe', saat: 'saat_probe', stufen: 4 };
const FISH = (over: Record<string, unknown> = {}): Row => ({ id: 'fisch', biome: ['wald'], gewaesser: ['fluss', 'see', 'meer', 'eis'], koeder: ['wurm'], reuse: true, ...over });
const ITEMS: Row[] = [
  { id: 'probe', quellen: ['ernte:probe'] },
  { id: 'saat_probe', saat: { pflanze: 'probe' }, quellen: ['ernte:probe'] },
  { id: 'fisch', quellen: ['angeln:fisch'] },
  { id: 'wurm', koeder: { biss: 1.5, fische: ['fisch'] } },
];

function registry(p: { items?: Row[]; crop?: Record<string, unknown>; fish?: Row[] } = {}): ContentRegistryView {
  return new ContentRegistry()
    .defineCollection('biomes', loose, [{ id: 'wald' }])
    .defineCollection('items', loose, p.items ?? ITEMS)
    .defineCollection('crops', loose, [{ ...CROP, ...p.crop }])
    .defineCollection('fish', loose, p.fish ?? [FISH()]);
}

function sprites(frames = 4, wilted = true): Map<string, FeldSpriteInfo> {
  const m = new Map<string, FeldSpriteInfo>([['feldfrucht_probe', { frames }]]);
  if (wilted) m.set('feldfrucht_probe_welk', { frames: 1 });
  return m;
}

const replace = (id: string, row: Row): Row[] => ITEMS.map((i) => (i.id === id ? row : i));

describe('Validator-Regel feld', () => {
  it('eine vollständige Nutzpflanze und ein vollständiger Fisch bestehen', () => {
    expect(checkFeld(registry(), sprites())).toEqual({ errors: [], warnings: [] });
  });

  it('Stufen-Sprites: eine Frame je Stufe, das Welk-Sprite muss es geben', () => {
    expect(checkFeld(registry(), sprites(3)).errors).toEqual(['Nutzpflanze probe: Sprite feldfrucht_probe hat 3 Frames, die Pflanze 4 Stufen']);
    expect(checkFeld(registry(), sprites(4, false)).errors).toEqual(['Nutzpflanze probe: Sprite feldfrucht_probe_welk fehlt']);
    expect(checkFeld(registry(), new Map()).errors).toHaveLength(2);
  });

  it('Ernte- und Saat-Item: Quelle ernte:<id>, die Saat pflanzt genau diese Pflanze', () => {
    expect(checkFeld(registry({ items: replace('probe', { id: 'probe', quellen: [] }) }), sprites()).errors).toEqual(['Nutzpflanze probe: Ernte-Item probe nennt die Quelle ernte:probe nicht']);
    expect(checkFeld(registry({ items: replace('saat_probe', { id: 'saat_probe', saat: { pflanze: 'andere' }, quellen: ['ernte:probe'] }) }), sprites()).errors).toEqual(['Nutzpflanze probe: Saat-Item saat_probe pflanzt andere']);
    expect(checkFeld(registry({ items: replace('saat_probe', { id: 'saat_probe', saat: { pflanze: 'probe' } }) }), sprites()).errors).toEqual(['Nutzpflanze probe: Saat-Item saat_probe nennt die Quelle ernte:probe nicht']);
    expect(checkFeld(registry({ items: ITEMS.filter((i) => i.id !== 'saat_probe') }), sprites()).errors).toEqual(['Nutzpflanze probe: Saat-Item saat_probe fehlt']);
  });

  it('Fische: Quelle angeln:<id>, bekannte Biome, Köder mit Block, die den Fisch nennen; Köder nennen nur echte Fische', () => {
    expect(checkFeld(registry({ items: replace('fisch', { id: 'fisch' }) }), sprites()).errors).toEqual(['Fischart fisch: Item fisch nennt die Quelle angeln:fisch nicht']);
    expect(checkFeld(registry({ fish: [FISH({ biome: ['wald', 'mond'] })] }), sprites()).errors).toEqual(['Fischart fisch: unbekanntes Biom mond']);
    expect(checkFeld(registry({ items: replace('wurm', { id: 'wurm' }) }), sprites()).errors).toEqual(['Fischart fisch: Köder wurm ist kein Item mit Block koeder']);
    expect(checkFeld(registry({ items: replace('wurm', { id: 'wurm', koeder: { biss: 1.5, fische: ['hai'] } }) }), sprites()).errors).toEqual([
      'Fischart fisch: mag den Köder wurm, der Köder nennt ihn nicht in fische',
      'Köder wurm: unbekannte Fischart hai',
    ]);
    // A bait that names no fish is liked by everyone who names it.
    expect(checkFeld(registry({ items: replace('wurm', { id: 'wurm', koeder: { biss: 1.5 } }) }), sprites()).errors).toEqual([]);
  });

  it('jedes Gewässer hat einen Fisch (Fehler), Fluss, See und Meer einen Reusenfisch (Warnung)', () => {
    expect(checkFeld(registry({ fish: [FISH({ gewaesser: ['fluss', 'see', 'meer'] })] }), sprites()).errors).toEqual(['Gewässer eis: keine Fischart beißt dort']);
    expect(checkFeld(registry({ fish: [FISH({ reuse: false })] }), sprites())).toEqual({
      errors: [],
      warnings: ['Gewässer fluss: keine Fischart geht in die Reuse', 'Gewässer see: keine Fischart geht in die Reuse', 'Gewässer meer: keine Fischart geht in die Reuse'],
    });
  });

  it('der echte Content besteht: 18 Nutzpflanzen, 8 Fischarten', () => {
    const real = new Map<string, FeldSpriteInfo>(CROPS.flatMap((c) => [[cropSpriteId(c.id), { frames: c.stufen }] as const, [cropWiltedSpriteId(c.id), { frames: 1 }] as const]));
    expect(CONTENT.collections().find((c) => c.name === 'crops')?.values().length).toBeGreaterThanOrEqual(18);
    expect(CONTENT.collections().find((c) => c.name === 'fish')?.values().length).toBeGreaterThanOrEqual(8);
    expect(checkFeld(CONTENT, real)).toEqual({ errors: [], warnings: [] });
  });
});
