/**
 * M3-30: stats panel of the inventory screen (src/ui/screens/inventar/stats.ts) – vitals, temperature
 * (core with stage, felt, comfort band) and what the equipment adds (insulation, cooling, armour,
 * armour weight), with warnings where a value needs attention; DE/EN without missing keys.
 * M6-43: the worn armour sets below the paper doll (`setSummaries`) – pieces worn n/4, the bonuses with the pieces they ask
 * for, reached ones active, the others greyed; a lone piece only its set line.
 */
import { describe, expect, it } from 'vitest';
import { TEMPERATURE_STAGES } from '../../../src/content/balance/survival';
import { ITEMS } from '../../../src/content/items/index';
import { RUESTUNGSSETS } from '../../../src/content/ruestungssets';
import { aggregateEquipmentStats, zeroStats, type EquippedPiece } from '../../../src/game/equipment/formulas';
import { newStack } from '../../../src/game/items/stack';
import { createI18n } from '../../../src/i18n';
import { setSummaries, statGroups, type VitalsValues } from '../../../src/ui/screens/inventar/stats';

const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });

const VITALS: VitalsValues = {
  health: 87.4,
  maxHealth: 100,
  stamina: 100,
  maxStamina: 100,
  satiety: 76.2,
  thirst: 64.9,
  wetness: 0,
  exhaustion: 12.6,
  coreC: 37,
  feltC: 21.46,
  bandLowC: 18,
  bandHighC: 26,
  temperatureStage: 'normal',
};

function row(groups: ReturnType<typeof statGroups>, id: string) {
  const r = groups.flatMap((g) => g.rows).find((x) => x.id === id);
  if (r === undefined) throw new Error(`row ${id} missing`);
  return r;
}

describe('Werte-Tafel', () => {
  it('zeigt Werte, Temperatur und Ausrüstung in dieser Reihenfolge, gerundet wie die Leisten', () => {
    const groups = statGroups(de, VITALS, aggregateEquipmentStats([]));
    expect(groups.map((g) => g.heading)).toEqual(['Werte', 'Temperatur', 'Kleidung und Schutz']);
    expect(row(groups, 'leben').value).toBe('88/100');
    expect(row(groups, 'saettigung').value).toBe('77');
    expect(row(groups, 'erschoepfung').value).toBe('12');
    expect(row(groups, 'kern').value).toBe('37,0 °C');
    expect(row(groups, 'gefuehlt').value).toBe('21,5 °C');
    expect(row(groups, 'komfort').value).toBe('18–26 °C');
    expect(row(groups, 'zustand').value).toBe('Normal');
    for (const g of groups) for (const r of g.rows) expect(r.label.length, r.id).toBeGreaterThan(0);
  });

  it('warnt bei niedrigem Leben/Hunger/Durst, Nässe, Erschöpfung, Temperaturstufe und gefühlter Temperatur außerhalb des Komforts', () => {
    const groups = statGroups(de, { ...VITALS, health: 15, satiety: 10, thirst: 5, wetness: 80, exhaustion: 70, feltC: 4, temperatureStage: 'frierend' }, null);
    for (const id of ['leben', 'saettigung', 'durst', 'naesse', 'erschoepfung', 'kern', 'zustand', 'gefuehlt']) expect(row(groups, id).tone, id).toBe('warn');
    expect(row(groups, 'zustand').value).toBe('Frierend');
    const ok = statGroups(de, VITALS, null);
    for (const id of ['leben', 'saettigung', 'durst', 'naesse', 'erschoepfung', 'kern', 'gefuehlt']) expect(row(ok, id).tone, id).toBe('text');
  });

  it('Ausrüstung: nichts getragen ist gedimmt, Isolation/Kühlung/Rüstung/Gewicht aus den aggregierten Werten', () => {
    const none = statGroups(de, VITALS, null);
    expect(['isolation', 'kuehlung', 'ruestung', 'gewicht'].map((id) => row(none, id).tone)).toEqual(['dim', 'dim', 'dim', 'dim']);
    expect(row(none, 'gewicht').value).toBe('Keine');
    const werte = { ...zeroStats(), isolation: 25, kuehlung: 3, ruestung: 4.4 };
    const worn = statGroups(de, VITALS, { werte, ruestungsgewicht: 'mittel', sets: [] });
    expect(row(worn, 'isolation')).toMatchObject({ value: '25', tone: 'text' });
    expect(row(worn, 'kuehlung')).toMatchObject({ value: '3', tone: 'text' });
    expect(row(worn, 'ruestung')).toMatchObject({ value: '4,4', tone: 'text' });
    expect(row(worn, 'gewicht')).toMatchObject({ value: 'Mittel', tone: 'text' });
  });

  it('ohne Spieler nur die Ausrüstung; jede Temperaturstufe hat Text in DE und EN', () => {
    expect(statGroups(de, null, null).map((g) => g.id)).toEqual(['ausruestung']);
    for (const stage of TEMPERATURE_STAGES) {
      for (const i18n of [de, en]) expect(row(statGroups(i18n, { ...VITALS, temperatureStage: stage }, null), 'zustand').value.length).toBeGreaterThan(0);
    }
    expect(statGroups(en, VITALS, null).map((g) => g.heading)).toEqual(['Stats', 'Temperature', 'Clothing and protection']);
  });
});

/** Worn pieces of the game's content (fresh stacks), aggregated with the game's sets. */
function wearing(...ids: string[]) {
  const pieces: EquippedPiece[] = ids.map((id) => {
    const def = ITEMS.find((i) => i.id === id);
    if (def === undefined) throw new Error(`item ${id} missing`);
    return { def, stack: newStack(def, 1) };
  });
  return aggregateEquipmentStats(pieces, undefined, RUESTUNGSSETS);
}

describe('Rüstungssets im Inventar (M6-43)', () => {
  it('zwei Teile Leder und zwei Teile Bronze: je 2/4, der 2-Teile-Bonus aktiv, der 4-Teile-Bonus grau', () => {
    const sets = setSummaries(de, wearing('bronzehelm', 'bronzebrustpanzer', 'lederhose', 'lederstiefel'));
    // Content order of the sets (faser, leder, bronze).
    expect(sets.map((x) => [x.id, x.name, x.count, x.active])).toEqual([
      ['leder', 'Lederrüstung', '2/4', true],
      ['bronze', 'Bronzerüstung', '2/4', true],
    ]);
    expect(sets[0]?.bonuses).toEqual([
      { teile: 2, text: '2/4: +2 Isolation', active: true },
      { teile: 4, text: '4/4: +2 Rüstung, +15 Max. Ausdauer', active: false },
    ]);
    expect(sets[1]?.bonuses.map((b) => [b.text, b.active])).toEqual([
      ['2/4: +2 Rüstung', true],
      ['4/4: +2 Rüstung, +15 Max. Leben', false],
    ]);
  });

  it('der volle Satz erreicht jeden Bonus; Prozentwerte wie in den Item-Werten; Englisch', () => {
    const faser = setSummaries(en, wearing('faserkappe', 'faserhemd', 'faserhose', 'faserschuhe'));
    expect(faser).toHaveLength(1);
    expect(faser[0]).toMatchObject({ id: 'faser', name: 'Fibre Garb', count: '4/4', active: true });
    expect(faser[0]?.bonuses.map((b) => b.active)).toEqual([true, true]);
    expect(faser[0]?.bonuses[1]?.text).toMatch(/^4\/4: \+10 Max\. Stamina, \+5\s?% Speed$/);
  });

  it('ein einzelnes Teil zeigt nur seine Setzeile (grau, ohne Boni); kaputte Teile zählen nicht; ohne Ausrüstung nichts', () => {
    const lone = setSummaries(de, wearing('bronzehelm', 'lederhose'));
    expect(lone.map((x) => [x.id, x.count, x.active, x.bonuses.length])).toEqual([
      ['leder', '1/4', false, 0],
      ['bronze', '1/4', false, 0],
    ]);
    const helm = ITEMS.find((i) => i.id === 'bronzehelm');
    const brust = ITEMS.find((i) => i.id === 'bronzebrustpanzer');
    if (helm === undefined || brust === undefined) throw new Error('bronze missing');
    const broken = aggregateEquipmentStats([{ def: helm, stack: newStack(helm, 1) }, { def: brust, stack: { ...newStack(brust, 1), haltbarkeit: 0 } }], undefined, RUESTUNGSSETS);
    expect(setSummaries(de, broken).map((x) => x.count)).toEqual(['1/4']);
    expect(setSummaries(de, null)).toEqual([]);
    expect(setSummaries(de, aggregateEquipmentStats([]))).toEqual([]);
  });
});
