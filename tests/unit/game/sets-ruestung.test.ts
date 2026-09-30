/**
 * M6-12 / M6-31 Set-Boni (MASTERPROMPT §13.1 "Rüstungssets mit Set-Boni"; src/content/ruestungssets.ts): the equipment
 * system adds a set's bonuses once enough unbroken pieces of it are worn – two pieces the first, four the second, bonuses
 * stacking; broken pieces do not count, quality does not scale a bonus, mixed sets each give theirs. The bonuses act where
 * the stats act: maximum health and stamina and walking tempo through the player's modifiers, armour in the fight.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { ARMOR_SET_PIECES, RUESTUNGSSETS, type ArmorSetDef } from '../../../src/content/ruestungssets';
import { aggregateEquipmentStats, setBonusStats, zeroStats, type EquippedPiece } from '../../../src/game/equipment/formulas';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { newStack } from '../../../src/game/items/stack';
import { kampfWelt } from './kampf-testwelt';

const catalog = contentItemCatalog();

function set(id: string): ArmorSetDef {
  const s = RUESTUNGSSETS.find((x) => x.id === id);
  if (s === undefined) throw new Error(`no set ${id}`);
  return s;
}

function piece(id: string, opts: { haltbarkeit?: number; qualitaet?: 1 | 2 | 3 } = {}): EquippedPiece {
  const def = catalog.get(id);
  const stack = newStack(def, 1, opts.qualitaet === undefined ? {} : { qualitaet: opts.qualitaet });
  return { def, stack: opts.haltbarkeit === undefined ? stack : { ...stack, haltbarkeit: opts.haltbarkeit } };
}

const LIMITS = BALANCE.items.statLimits;

describe('Set-Boni (Formeln)', () => {
  it('ein Teil gibt keinen Bonus, zwei den ersten, vier beide', () => {
    const bronze = set('bronze');
    const [helm, brust, beine, fuesse] = bronze.teile.map((id) => piece(id));
    if (helm === undefined || brust === undefined || beine === undefined || fuesse === undefined) throw new Error('bronze set incomplete');
    const one = aggregateEquipmentStats([helm], LIMITS, RUESTUNGSSETS);
    expect(one.werte.ruestung).toBe(3);
    expect(one.sets).toEqual([{ id: 'bronze', teile: 1, boni: 0 }]);
    const two = aggregateEquipmentStats([helm, brust], LIMITS, RUESTUNGSSETS);
    expect(two.werte.ruestung).toBe(3 + 4 + 2);
    expect(two.sets).toEqual([{ id: 'bronze', teile: 2, boni: 1 }]);
    const all = aggregateEquipmentStats([helm, brust, beine, fuesse], LIMITS, RUESTUNGSSETS);
    expect(all.werte.ruestung).toBe(12 + 2 + 2);
    expect(all.werte.maxLeben).toBe(15);
    expect(all.ruestungsgewicht).toBe('schwer');
    expect(all.sets).toEqual([{ id: 'bronze', teile: 4, boni: 2 }]);
  });

  it('zerbrochene Teile zählen nicht zum Set; ohne Sets keine Boni', () => {
    const faser = set('faser').teile.map((id) => piece(id));
    const broken = [...faser.slice(0, 3), piece(set('faser').teile[3] as string, { haltbarkeit: 0 })];
    const s = aggregateEquipmentStats(broken, LIMITS, RUESTUNGSSETS);
    expect(s.sets).toEqual([{ id: 'faser', teile: 3, boni: 1 }]);
    expect(s.werte.maxAusdauer).toBe(5);
    expect(s.werte.tempo).toBe(0);
    expect(aggregateEquipmentStats(faser, LIMITS).werte.maxAusdauer).toBe(0);
  });

  it('gemischte Sets geben je ihren Bonus; Qualität erhöht die Teile, nicht den Bonus', () => {
    const mixed = [piece('faserkappe', { qualitaet: 3 }), piece('faserhemd', { qualitaet: 3 }), piece('bronzebeinschienen'), piece('bronzestiefel')];
    const s = aggregateEquipmentStats(mixed, LIMITS, RUESTUNGSSETS);
    expect(s.sets).toEqual([
      { id: 'faser', teile: 2, boni: 1 },
      { id: 'bronze', teile: 2, boni: 1 },
    ]);
    // Pieces ×1,2 (3 stars): cap 1 and shirt 2 armour → 3,6; bronze 3 + 2; the bonuses 2 (bronze) and 5 stamina (fibre) unscaled.
    expect(s.werte.ruestung).toBeCloseTo((1 + 2) * 1.2 + 3 + 2 + 2, 9);
    expect(s.werte.maxAusdauer).toBe(5);
  });

  it('setBonusStats addiert nur erreichte Boni und nennt die getragenen Sets', () => {
    const werte = zeroStats();
    const worn = setBonusStats(set('leder').teile.map((id) => piece(id)), RUESTUNGSSETS, werte);
    expect(worn).toEqual([{ id: 'leder', teile: ARMOR_SET_PIECES, boni: 2 }]);
    expect(werte).toMatchObject({ isolation: 2, ruestung: 2, maxAusdauer: 15 });
  });

  it('jedes Set: vier Rüstungsteile, je ein Platz Kopf, Brust, Beine, Füße, gleiche Stufe', () => {
    for (const s of RUESTUNGSSETS) {
      const defs = s.teile.map((id) => catalog.get(id));
      expect(defs.map((d) => d.kategorie), s.id).toEqual(['ruestung', 'ruestung', 'ruestung', 'ruestung']);
      expect(defs.map((d) => d.ausruestung), s.id).toEqual(['kopf', 'brust', 'beine', 'fuesse']);
      expect(new Set(defs.map((d) => d.stufe)).size, s.id).toBe(1);
    }
  });
});

describe('Set-Boni im Spiel', () => {
  it('das volle Fasergewand: +15 maximale Ausdauer und +5 % Tempo über die Einflussquelle der Ausrüstung', () => {
    const k = kampfWelt();
    k.run(2);
    const base = k.vit().maxStamina;
    for (const id of set('faser').teile) k.wear(id, catalog.get(id).ausruestung as 'kopf' | 'brust' | 'beine' | 'fuesse');
    expect(k.equipment.stats().sets).toEqual([{ id: 'faser', teile: 4, boni: 2 }]);
    k.run(2);
    expect(k.vit().maxStamina - base).toBeCloseTo(15, 9);
    expect(k.equipment.stats().werte.tempo).toBeCloseTo(0.05, 12);
  });

  it('die volle Bronzerüstung schützt im Kampf mit Rüstung 16 statt 12', () => {
    const k = kampfWelt();
    const foe = k.dummy(12, 0);
    const bronze = set('bronze');
    for (const id of bronze.teile.slice(0, 3)) k.wear(id, catalog.get(id).ausruestung as 'kopf' | 'brust' | 'beine');
    const three = k.strikePlayer(foe, { critChance: 0, damage: 10 });
    expect(three?.amount).toBeCloseTo(10 * (1 - 12 / 62), 9);
    k.wear('bronzestiefel', 'fuesse');
    const full = k.strikePlayer(foe, { critChance: 0, damage: 10 });
    expect(full?.amount).toBeCloseTo(10 * (1 - 16 / 66), 9);
    k.run(2);
    expect(k.vit().maxHealth).toBeCloseTo(BALANCE.survival.health.base + 15, 9);
  });
});
