/**
 * M3-31: settings of the pause menu (src/ui/screens/pause/settingsRows.ts) – only settings that the
 * page applies live, each row changes exactly its field through the settings store (validated, no
 * issues), choices wrap around, number ranges stop at their ends, labels and descriptions exist in DE
 * and EN.
 */
import { describe, expect, it } from 'vitest';
import { createSettingsStore, SETTING_RANGES, type Settings } from '../../../src/engine/settings';
import { createI18n } from '../../../src/i18n';
import { PAUSE_SETTING_ROWS, rangeValues, stepValue } from '../../../src/ui/screens/pause/settingsRows';

const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });

function store() {
  return createSettingsStore(null, { navigatorLanguage: 'de-DE', autoSave: false });
}

/** Paths of every leaf that differs between two settings objects. */
function changedPaths(a: unknown, b: unknown, path = ''): string[] {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return Object.is(a, b) ? [] : [path];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => changedPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
}

describe('Pausemenü: Einstellungen', () => {
  it('bietet genau die live wirksamen Einstellungen an', () => {
    expect(PAUSE_SETTING_ROWS.map((r) => r.id)).toEqual(['language', 'uiScale', 'gameSpeed', 'scaleMode', 'lightBanding', 'lightBands', 'dither', 'flashReduction', 'sprintMode', 'sneakMode']);
  });

  it('jede Zeile hat Name und Beschreibung in DE und EN, jeder Wert einen Text', () => {
    for (const row of PAUSE_SETTING_ROWS) {
      for (const i18n of [de, en]) {
        expect(i18n.t(row.labelKey).length, row.id).toBeGreaterThan(0);
        expect(i18n.t(`${row.labelKey}.desc`).length, row.id).toBeGreaterThan(0);
        for (const v of row.values) expect(row.format(i18n, v).length, `${row.id}=${String(v)}`).toBeGreaterThan(0);
      }
    }
    const speed = PAUSE_SETTING_ROWS.find((r) => r.id === 'gameSpeed');
    expect(speed?.format(de, 0.75)).toMatch(/^75\s%$/);
  });

  it('ein Schritt ändert genau das Feld der Zeile, gültig und zurücklesbar', () => {
    for (const row of PAUSE_SETTING_ROWS) {
      const s = store();
      const before: Settings = s.get();
      // A range at its end (game speed 100 %) steps down instead.
      const up = stepValue(row, row.get(before), 1);
      const next = up === row.get(before) ? stepValue(row, row.get(before), -1) : up;
      expect(next, row.id).not.toEqual(row.get(before));
      s.update(row.patch(next));
      expect(s.issues, row.id).toEqual([]);
      expect(row.get(s.get()), row.id).toEqual(next);
      expect(changedPaths(before, s.get()), row.id).toHaveLength(1);
    }
  });

  it('Auswahllisten laufen um, Zahlenbereiche halten an ihren Enden; Zwischenwerte rasten ein', () => {
    const lang = PAUSE_SETTING_ROWS.find((r) => r.id === 'language');
    const speed = PAUSE_SETTING_ROWS.find((r) => r.id === 'gameSpeed');
    const bands = PAUSE_SETTING_ROWS.find((r) => r.id === 'lightBands');
    if (lang === undefined || speed === undefined || bands === undefined) throw new Error('rows missing');
    expect(stepValue(lang, 'en', 1)).toBe('de');
    expect(stepValue(lang, 'de', -1)).toBe('en');
    expect(stepValue(speed, 1, 1)).toBe(1);
    expect(stepValue(speed, 1, -1)).toBe(0.95);
    expect(stepValue(speed, 0.5, -1)).toBe(0.5);
    expect(stepValue(speed, 0.83, 1)).toBe(0.9);
    expect(stepValue(bands, 10, 1)).toBe(10);
    expect(stepValue(bands, 6, -1)).toBe(6);
  });

  it('Bereichswerte ohne Gleitkomma-Drift (Spieltempo 50–100 % in 5er-Schritten)', () => {
    const values = rangeValues(SETTING_RANGES['accessibility.gameSpeed']);
    expect(values).toHaveLength(11);
    expect(values[0]).toBe(0.5);
    expect(values[3]).toBe(0.65);
    expect(values[10]).toBe(1);
  });
});
