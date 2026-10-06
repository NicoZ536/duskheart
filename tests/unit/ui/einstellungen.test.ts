/**
 * M7-55/M7-56 Einstellungen-Bildschirm (MASTERPROMPT §29, §26 „Alles umbelegbar“; docs/SPIEL.md §25): jeder Schlüssel
 * von `src/engine/settings.ts`, den der Spieler setzt, hat genau eine Zeile in seinem Reiter; jeder Schritt ändert genau
 * sein Feld gültig und zurücklesbar (die Qualitätsstufe ihr ganzes Preset), jeder Wert hat einen Text in DE und EN. Die
 * Tastenbelegung: Erfassung (Taste mit Modifikatoren, Maus, Controller), Konflikt ⇒ Rückfrage (ablehnen, tauschen,
 * ersetzen), markierte Konflikte, unbelegte Aktionen, Entwickler-Aktionen nur im Entwicklermodus, Speicherung als
 * Abweichungen von der Standardbelegung.
 */
import { describe, expect, it } from 'vitest';
import { ACTIONS, type Action } from '../../../src/engine/input/actions';
import { DEFAULT_BINDINGS, key, mouse, padButton, type SerializedBindings } from '../../../src/engine/input/bindings';
import { createSettingsStore, defaultSettings, QUALITY_PRESETS, type Settings } from '../../../src/engine/settings';
import { createI18n } from '../../../src/i18n';
import { stepValue } from '../../../src/ui/screens/pause/settingsRows';
import {
  belegbareAktionen,
  belegungAus,
  belegungsText,
  ersteBelegung,
  konfliktAktionen,
  passtZuGeraet,
  standardFuer,
  tastenBelegung,
  umbelegen,
  unbelegtText,
} from '../../../src/ui/screens/einstellungen/belegung';
import { alleZeilen, EINSTELLUNGEN_REITER, EINSTELLUNGEN_ZEILEN, naechsterReiter, qualitaetAngepasst, zeileMitId } from '../../../src/ui/screens/einstellungen/zeilen';

const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });

function store() {
  return createSettingsStore(null, { navigatorLanguage: 'de-DE', autoSave: false });
}

function changedPaths(a: unknown, b: unknown, path = ''): string[] {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return Object.is(a, b) ? [] : [path];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => changedPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
}

/** Keys a player does not set in a row: the benchmark's flag, and the bindings (their own rows). */
const NOT_A_ROW = new Set(['graphics.autoDetected', 'controls.bindings']);

describe('Einstellungen: Zeilen', () => {
  it('jeder Schlüssel, den der Spieler setzt, hat genau eine Zeile im Reiter seines Abschnitts', () => {
    const d = defaultSettings() as unknown as Record<string, unknown>;
    const keys = Object.entries(d).flatMap(([section, v]) => (typeof v === 'object' && v !== null ? Object.keys(v).map((f) => `${section}.${f}`) : [section]));
    const rows = alleZeilen().map((r) => r.id);
    expect(new Set(rows).size).toBe(rows.length);
    expect([...rows].sort()).toEqual(keys.filter((k) => !NOT_A_ROW.has(k)).sort());
    for (const tab of EINSTELLUNGEN_REITER) {
      for (const row of EINSTELLUNGEN_ZEILEN[tab.id]) expect(row.id === tab.abschnitt || row.id.startsWith(`${tab.abschnitt}.`), row.id).toBe(true);
      expect(de.t(`settings.tab.${tab.id}`).length).toBeGreaterThan(0);
    }
    expect(zeileMitId('graphics.fpsLimit')?.values).toEqual([0, 30, 60, 120, 144, 165]);
    expect(zeileMitId('fehlt')).toBeUndefined();
    expect(naechsterReiter('graphics', -1)).toBe('accessibility');
    expect(naechsterReiter('accessibility', 1)).toBe('graphics');
  });

  it('jede Zeile hat Name und Beschreibung, jeder Wert einen Text – DE und EN', () => {
    for (const row of alleZeilen()) {
      for (const i18n of [de, en]) {
        expect(i18n.t(row.labelKey).length, row.id).toBeGreaterThan(0);
        expect(i18n.t(`${row.labelKey}.desc`).length, row.id).toBeGreaterThan(0);
        for (const v of row.values) expect(row.format(i18n, v).length, `${row.id}=${String(v)}`).toBeGreaterThan(0);
      }
    }
    expect(zeileMitId('graphics.fpsLimit')?.format(de, 0)).toBe('An Bildwiederholrate');
    expect(zeileMitId('graphics.fpsLimit')?.format(en, 0)).toBe('Match refresh rate');
    expect(zeileMitId('game.autosaveMinutes')?.format(de, 3)).toBe('Alle 3 Minuten');
  });

  it('ein Schritt ändert genau das Feld der Zeile, gültig und zurücklesbar; die Qualitätsstufe ihr ganzes Preset', () => {
    for (const row of alleZeilen()) {
      const s = store();
      const before: Settings = s.get();
      const up = stepValue(row, row.get(before), 1);
      const next = up === row.get(before) ? stepValue(row, row.get(before), -1) : up;
      expect(next, row.id).not.toEqual(row.get(before));
      s.update(row.patch(next));
      expect(s.issues, row.id).toEqual([]);
      expect(row.get(s.get()), row.id).toEqual(next);
      const changed = changedPaths(before, s.get());
      if (row.id === 'graphics.quality') {
        expect(s.get().graphics).toMatchObject(QUALITY_PRESETS[next as Settings['graphics']['quality']]);
        expect(qualitaetAngepasst(s.get())).toBe(false);
      } else expect(changed, row.id).toEqual([row.id]);
    }
    const s = store();
    s.update({ graphics: { water: 'simple' } });
    expect(qualitaetAngepasst(s.get())).toBe(true);
  });
});

describe('Einstellungen: Tastenbelegung', () => {
  it('Entwickler-Aktionen nur im Entwicklermodus; jede Aktion hat einen Namen', () => {
    const normal = belegbareAktionen(false);
    const dev = belegbareAktionen(true);
    expect(normal).not.toContain('debugConsole');
    expect(dev).toContain('debugConsole');
    expect([...dev].sort()).toEqual([...ACTIONS].sort());
    for (const a of dev) expect(de.t(`input.action.${a}`).length).toBeGreaterThan(0);
  });

  it('erfasst Tasten mit gehaltenen Modifikatoren; ein Modifikator allein ist eine einfache Taste', () => {
    expect(tastenBelegung({ code: 'KeyK', ctrlKey: true, shiftKey: false, altKey: false })).toEqual(key('KeyK', { ctrl: true }));
    expect(tastenBelegung({ code: 'KeyK', ctrlKey: false, shiftKey: false, altKey: false, metaKey: true })).toEqual(key('KeyK', { ctrl: true }));
    expect(tastenBelegung({ code: 'ShiftLeft', ctrlKey: false, shiftKey: true, altKey: false })).toEqual(key('ShiftLeft'));
    expect(passtZuGeraet(key('KeyK'), 'keyboardMouse')).toBe(true);
    expect(passtZuGeraet(mouse(2), 'gamepad')).toBe(false);
    expect(passtZuGeraet(padButton(3), 'gamepad')).toBe(true);
    expect(belegungsText(de, key('KeyK', { ctrl: true }), 'generic')).toBe('Strg+K');
    expect(belegungsText(de, undefined, 'generic')).toBe('Nicht belegt');
  });

  it('eine freie Taste ersetzt die erste Belegung des Geräts; gespeichert werden nur Abweichungen', () => {
    const r = umbelegen({}, 'interact', key('KeyO'), 'reject');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const set = belegungAus(r.bindings);
    expect(ersteBelegung(set, 'interact', 'keyboardMouse')).toEqual(key('KeyO'));
    // The controller binding stays.
    expect(ersteBelegung(set, 'interact', 'gamepad')).toEqual(DEFAULT_BINDINGS.interact.find((b) => b.kind === 'padButton'));
    expect(Object.keys(r.bindings)).toEqual(['interact']);
    const s = store();
    s.update({ controls: { bindings: r.bindings } });
    expect(s.issues).toEqual([]);
    expect(s.get().controls.bindings).toEqual(r.bindings);
    expect(standardFuer(r.bindings, 'interact')).toEqual({});
  });

  it('eine belegte Taste fragt nach: ablehnen ändert nichts, tauschen gibt der anderen Aktion die alte, ersetzen nimmt sie ihr', () => {
    const inventoryKey = DEFAULT_BINDINGS.inventory.find((b) => b.kind === 'key');
    const interactKey = DEFAULT_BINDINGS.interact.find((b) => b.kind === 'key');
    if (inventoryKey === undefined || interactKey === undefined) throw new Error('Standardbelegung ohne Taste');
    const refused = umbelegen({}, 'interact', inventoryKey, 'reject');
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.konflikte.map((c) => c.other)).toContain('inventory');
    const swapped = umbelegen({}, 'interact', inventoryKey, 'swap');
    if (!swapped.ok) throw new Error('swap refused');
    const s1 = belegungAus(swapped.bindings);
    expect(ersteBelegung(s1, 'interact', 'keyboardMouse')).toEqual(inventoryKey);
    expect(s1.get('inventory')).toContainEqual(interactKey);
    expect(konfliktAktionen(s1).has('interact')).toBe(false);
    const replaced = umbelegen({}, 'interact', inventoryKey, 'unbindOther');
    if (!replaced.ok) throw new Error('replace refused');
    const s2 = belegungAus(replaced.bindings);
    expect(s2.get('inventory')).not.toContainEqual(inventoryKey);
  });

  it('Konflikte werden markiert, unbelegte Aktionen genannt', () => {
    expect(konfliktAktionen(belegungAus({})).size).toBe(0);
    expect(unbelegtText(de, belegungAus({}))).toBeNull();
    const clash: SerializedBindings = { interact: [key('KeyI')], inventory: [key('KeyI')] };
    const marked = konfliktAktionen(belegungAus(clash));
    expect([...marked].sort()).toEqual(['interact', 'inventory'] satisfies Action[]);
    const empty: SerializedBindings = { roll: [] };
    expect(unbelegtText(de, belegungAus(empty))).toBe('Diese Aktionen haben keine Belegung: Rollen');
  });
});
