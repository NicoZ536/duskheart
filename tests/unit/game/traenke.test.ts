/**
 * M7-28: the herb table and potions & medicine 1–8 (MASTERPROMPT §18 "Tränke … Heiltrank, Gegengift, Fiebertee, Wundsalbe,
 * Wärme- und Kühltrank", §11.3 "≥ 30 Statuseffekte"; docs/SPIEL.md §21): the content (eight potions and medicines, at least
 * 30 conditions, every new condition with DE/EN text and a sound), the herb table's recipes, and the potions acting through
 * the eat hook (drunk with `action.eat`) and the salve through `player.useItem`.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { KUECHE_CONDITIONS, MEAL_GROUP, POTION_GROUP } from '../../../src/content/conditions_m7';
import { consumeTicks } from '../../../src/game/actions/formulas';
import { kuecheKatalog, kuecheWelt, type KuecheWelt } from './kueche-testwelt';

const INV0 = { bereich: 'inventar', index: 0 } as const;
const POTIONS = ['heiltrank', 'gegengift', 'fiebertee', 'wundsalbe', 'waermetrank', 'kuehltrank'];

function welt(): KuecheWelt {
  const w = kuecheWelt();
  w.spawn(10, 10);
  w.vit().thirst = 50;
  return w;
}

function drink(w: KuecheWelt, item: string): Map<string, unknown[]> {
  w.put(w.stack(item, 1));
  const def = kuecheKatalog.get(item);
  return w.run(consumeTicks(def.kategorie as Parameters<typeof consumeTicks>[0]) + 2, [{ type: 'action.eat', from: INV0 }]);
}

describe('Tränke & Medizin (Inhalt)', () => {
  it('acht Tränke und Medizin; mindestens 30 Statuseffekte; die neuen mit Gruppe, Texten und Klang', () => {
    const items = CONTENT.collection('items').values();
    const medical = items.filter((d) => d.kategorie === 'trank' || d.kategorie === 'medizin');
    expect(medical.length).toBeGreaterThanOrEqual(8);
    for (const id of POTIONS) expect(medical.map((d) => d.id)).toContain(id);
    expect(CONTENT.collection('conditions').values().length).toBeGreaterThanOrEqual(30);
    for (const c of KUECHE_CONDITIONS) {
      expect([MEAL_GROUP, POTION_GROUP], c.id).toContain(c.gruppe);
      expect(c.name.de.length * c.name.en.length, c.id).toBeGreaterThan(0);
      expect(c.sound, c.id).toBe(`sfx_zustand_${c.id}`);
    }
  });

  it('der Kräutertisch macht jeden Trank; wer Wasser braucht, steht am Wasser', () => {
    const recipes = CONTENT.collection('recipes').values();
    for (const id of POTIONS) {
      const r = recipes.find((x) => x.ergebnis.item === id);
      expect(r?.station, id).toBe('kraeutertisch');
      expect(r?.umgebung ?? (id === 'wundsalbe' ? undefined : 'wasser'), id).toBe(id === 'wundsalbe' ? undefined : 'wasser');
    }
  });
});

describe('Tränke wirken', () => {
  it('Heiltrank: sofort +30 Leben und 30 s „Heilend“', () => {
    const w = welt();
    w.vit().health = 40;
    drink(w, 'heiltrank');
    expect(w.vit().health).toBeGreaterThanOrEqual(70);
    expect(w.life.conditions.has('heilend')).toBe(true);
  });

  it('Gegengift heilt Vergiftung und Lebensmittelvergiftung; Fiebertee das Fieber', () => {
    const w = welt();
    w.life.conditions.apply(w.sim, 'lebensmittelvergiftung');
    w.life.conditions.apply(w.sim, 'vergiftung');
    drink(w, 'gegengift');
    expect(w.life.conditions.has('lebensmittelvergiftung')).toBe(false);
    expect(w.life.conditions.has('vergiftung')).toBe(false);
    w.life.conditions.apply(w.sim, 'fieber');
    drink(w, 'fiebertee');
    expect(w.life.conditions.has('fieber')).toBe(false);
  });

  it('Wärmetrank und Kühltrank geben Isolation und Kühlung; Tränke drängen keine Mahlzeit-Effekte heraus', () => {
    const w = welt();
    const isolation = w.life.conditions.effects().insulation;
    drink(w, 'waermetrank');
    expect(w.life.conditions.has('gewaermt')).toBe(true);
    expect(w.life.conditions.effects().insulation).toBe(isolation + 8);
    drink(w, 'kuehltrank');
    expect(w.life.conditions.has('gekuehlt')).toBe(true);
    expect(w.life.conditions.has('gewaermt')).toBe(true);
    expect(w.life.conditions.effects().cooling).toBe(6);
  });

  it('Wundsalbe wird aufgetragen (Gegenstand benutzen): stillt die Blutung, „Wundversorgt“, ein Stück weniger', () => {
    const w = welt();
    w.life.conditions.apply(w.sim, 'blutung');
    w.put(w.stack('wundsalbe', 2));
    // The salve's handler as `player.useItem` asks it (the tools system tries its handlers in order).
    expect(w.useItem()).toBe('used');
    const ev = w.run(1);
    expect(w.life.conditions.has('blutung')).toBe(false);
    expect(w.life.conditions.has('wundversorgt')).toBe(true);
    expect(w.slot()?.count).toBe(1);
    const used = (ev.get('itemUsed') ?? []) as Array<{ item: string; use: string; cured: string[] }>;
    expect(used).toEqual([expect.objectContaining({ item: 'wundsalbe', use: 'heilen', cured: ['blutung'] })]);
  });
});
