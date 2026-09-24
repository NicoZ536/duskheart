/**
 * M3-30: stats panel of the inventory screen (src/ui/screens/inventar/stats.ts) – vitals, temperature
 * (core with stage, felt, comfort band) and what the equipment adds (insulation, cooling, armour,
 * armour weight), with warnings where a value needs attention; DE/EN without missing keys.
 */
import { describe, expect, it } from 'vitest';
import { TEMPERATURE_STAGES } from '../../../src/content/balance/survival';
import { aggregateEquipmentStats, zeroStats } from '../../../src/game/equipment/formulas';
import { createI18n } from '../../../src/i18n';
import { statGroups, type VitalsValues } from '../../../src/ui/screens/inventar/stats';

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
    const worn = statGroups(de, VITALS, { werte, ruestungsgewicht: 'mittel' });
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
