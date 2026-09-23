import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_CATEGORIES, INPUT_CONTEXTS, actionLabelKey } from '../../src/engine/input/actions';
import { NAMED_KEY_CODES, bindingLabel, DEFAULT_BINDINGS } from '../../src/engine/input/bindings';
import { SETTING_CHOICES, defaultSettings } from '../../src/engine/settings';
import { DEBUG_STAT_KEYS } from '../../src/debug/stats';
import de from '../../src/i18n/de.json';
import en from '../../src/i18n/en.json';
import {
  createFormatter,
  formatDuration,
  formatGameTime,
  formatHours,
  formatNumber,
  formatPercent,
  formatTemperature,
} from '../../src/i18n/format';
import { LANGS, createI18n, isLang, listKeys, placeholders } from '../../src/i18n/index';

const dicts: Record<string, Record<string, string>> = { de, en };

describe('dictionaries', () => {
  it('have identical key sets and non-empty strings', () => {
    expect(listKeys('de')).toEqual(listKeys('en'));
    for (const lang of LANGS) {
      for (const [k, v] of Object.entries(dicts[lang] ?? {})) {
        expect(typeof v, `${lang}:${k}`).toBe('string');
        expect(v.trim().length, `${lang}:${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('use the same placeholders in both languages', () => {
    for (const k of listKeys('de')) expect(placeholders(en[k as keyof typeof en]), k).toEqual(placeholders(de[k as keyof typeof de]));
  });

  it('have keys for title, menu, WebGL2 error and loading', () => {
    const i18n = createI18n('de');
    for (const k of [
      'game.title',
      'game.subtitle',
      'ui.menu.continue',
      'ui.menu.newWorld',
      'ui.menu.worlds',
      'ui.menu.settings',
      'ui.menu.quit',
      'ui.error.webgl2.title',
      'ui.error.webgl2.body',
      'ui.error.webgl2.hint',
      'loading.title',
    ]) {
      expect(i18n.has(k, 'de'), k).toBe(true);
      expect(i18n.has(k, 'en'), k).toBe(true);
    }
    expect(i18n.t('ui.menu.continue')).toBe('Weiter');
    expect(i18n.t('ui.menu.newWorld')).toBe('Neue Welt');
    expect(i18n.t('ui.error.webgl2.hint')).toMatch(/Hardwarebeschleunigung/);
    expect(createI18n('en').t('ui.error.webgl2.hint')).toMatch(/hardware acceleration/);
  });

  it('have a label and description for every settings field and every choice', () => {
    const i18n = createI18n('de');
    const d = defaultSettings() as unknown as Record<string, unknown>;
    for (const [section, value] of Object.entries(d)) {
      const fields = typeof value === 'object' && value !== null ? Object.keys(value).map((f) => `${section}.${f}`) : [section];
      for (const path of fields) {
        for (const lang of LANGS) {
          expect(i18n.has(`settings.${path}`, lang), `${lang}: settings.${path}`).toBe(true);
          expect(i18n.has(`settings.${path}.desc`, lang), `${lang}: settings.${path}.desc`).toBe(true);
        }
      }
      expect(i18n.has(`settings.tab.${section}`), section).toBe(true);
    }
    for (const [path, choices] of Object.entries(SETTING_CHOICES)) {
      for (const choice of choices) {
        for (const lang of LANGS) expect(i18n.has(`settings.${path}.${String(choice)}`, lang), `${lang}: ${path}.${String(choice)}`).toBe(true);
      }
    }
  });

  it('name every input action, category, context and default binding label', () => {
    const i18n = createI18n('en');
    for (const a of ACTIONS) for (const lang of LANGS) expect(i18n.has(actionLabelKey(a), lang), a).toBe(true);
    for (const c of ACTION_CATEGORIES) expect(i18n.has(`input.category.${c}`), c).toBe(true);
    for (const c of INPUT_CONTEXTS) expect(i18n.has(`input.context.${c}`), c).toBe(true);
    for (const code of NAMED_KEY_CODES) expect(i18n.has(`input.key.${code}`), code).toBe(true);
    for (const family of ['xbox', 'playstation', 'generic'] as const) {
      for (const a of ACTIONS) {
        for (const b of DEFAULT_BINDINGS[a]) {
          for (const part of bindingLabel(b, family)) {
            if ('i18n' in part) expect(i18n.has(part.i18n), `${family}: ${part.i18n}`).toBe(true);
          }
        }
      }
    }
  });

  it('label every debug overlay row', () => {
    const i18n = createI18n('de');
    for (const k of DEBUG_STAT_KEYS) expect(i18n.has(`debug.overlay.${k}`), k).toBe(true);
  });
});

describe('createI18n', () => {
  it('interpolates {name} placeholders and formats numbers per locale', () => {
    const i18n = createI18n('de');
    expect(i18n.t('loading.chunks', { done: 1200, total: 2048 })).toBe('Gelände 1.200 von 2.048');
    expect(i18n.t('input.rebind.prompt', { action: 'Rollen' })).toBe('Drücke eine Taste oder einen Knopf für „Rollen“ …');
    // Unknown placeholders stay visible instead of disappearing.
    expect(i18n.t('game.version')).toBe('Version {version}');
    i18n.setLanguage('en');
    expect(i18n.t('loading.chunks', { done: 1200, total: 2048 })).toBe('Terrain 1,200 of 2,048');
  });

  it('selects plural forms via {count}', () => {
    const de = createI18n('de');
    expect(de.t('ui.worlds.count', { count: 1 })).toBe('1 Welt');
    expect(de.t('ui.worlds.count', { count: 0 })).toBe('0 Welten');
    expect(de.t('ui.worlds.count', { count: 3 })).toBe('3 Welten');
    const en = createI18n('en');
    expect(en.t('ui.worlds.count', { count: 1 })).toBe('1 world');
    expect(en.t('ui.worlds.count', { count: 2 })).toBe('2 worlds');
    expect(en.t('settings.game.autosaveMinutes.value', { count: 1 })).toBe('Every minute');
    expect(en.t('settings.game.autosaveMinutes.value', { count: 5 })).toBe('Every 5 minutes');
    expect(en.has('ui.worlds.count')).toBe(true);
  });

  it('falls back to DE, then to the key, and tracks missing keys', () => {
    const i18n = createI18n('en', { dictionaries: { en: { 'only.en': 'English only' }, de: { 'only.de': 'Nur deutsch', 'x.one': '{count} Ding', 'x.other': '{count} Dinge' } } });
    expect(i18n.t('only.en')).toBe('English only');
    expect(i18n.t('only.de')).toBe('Nur deutsch');
    expect(i18n.t('x', { count: 2 })).toBe('2 Dinge');
    expect(i18n.t('does.not.exist')).toBe('does.not.exist');
    expect(i18n.missingKeys()).toEqual(['does.not.exist', 'only.de', 'x']);
    expect(i18n.missingKeys('de')).toEqual(['does.not.exist']);
  });

  it('switches language and notifies listeners', () => {
    const i18n = createI18n('de');
    const seen: string[] = [];
    const off = i18n.onChange((l) => seen.push(l));
    i18n.setLanguage('en');
    i18n.setLanguage('en');
    expect(i18n.lang).toBe('en');
    expect(i18n.locale).toBe('en-GB');
    expect(i18n.t('ui.menu.quit')).toBe('Quit');
    off();
    i18n.setLanguage('de');
    expect(seen).toEqual(['en']);
    expect(isLang('en')).toBe(true);
    expect(isLang('fr')).toBe(false);
  });
});

describe('format', () => {
  const NBSP = ' ';

  it('numbers and percent', () => {
    expect(formatNumber('de', 12345.5, 1)).toBe('12.345,5');
    expect(formatNumber('en', 12345.5, 1)).toBe('12,345.5');
    expect(formatPercent('de', 0.755)).toBe(`76${NBSP}%`);
    expect(formatPercent('en', 0.75)).toBe('75%');
    expect(formatPercent('de', 0.1234, 1)).toBe(`12,3${NBSP}%`);
    expect(formatNumber('de', Number.NaN)).toBe('0');
  });

  it('temperature with one decimal and locale comma', () => {
    expect(formatTemperature('de', 21.46)).toBe(`21,5${NBSP}°C`);
    expect(formatTemperature('en', 21.46)).toBe(`21.5${NBSP}°C`);
    expect(formatTemperature('de', -3)).toBe(`-3,0${NBSP}°C`);
    expect(formatTemperature('de', -0.04)).toBe(`0,0${NBSP}°C`);
    expect(formatTemperature('en', 1.5, true)).toBe(`+1.5${NBSP}°C`);
  });

  it('durations and play time', () => {
    expect(formatDuration('de', 65)).toBe('01:05');
    expect(formatDuration('en', 3599.9)).toBe('59:59');
    expect(formatDuration('de', 3725)).toBe('1:02:05');
    expect(formatDuration('de', -5)).toBe('00:00');
    expect(formatHours('de', 45000)).toBe(`12,5${NBSP}h`);
    expect(formatHours('en', 45000)).toBe(`12.5${NBSP}h`);
  });

  it('game time HH:MM with wrap-around', () => {
    expect(formatGameTime('de', 6 * 60)).toBe('06:00');
    expect(formatGameTime('en', 23 * 60 + 59.9)).toBe('23:59');
    expect(formatGameTime('de', 1440 + 75)).toBe('01:15');
    expect(formatGameTime('de', -30)).toBe('23:30');
  });

  it('bound formatter', () => {
    const f = createFormatter('de');
    expect(f.locale).toBe('de-DE');
    expect(f.temperature(5)).toBe(`5,0${NBSP}°C`);
    expect(f.gameTime(90)).toBe('01:30');
    expect(f.percent(0.5)).toBe(`50${NBSP}%`);
    expect(f.number(1.25, 2)).toBe('1,25');
    expect(f.duration(61)).toBe('01:01');
    expect(f.hours(3600)).toBe(`1,0${NBSP}h`);
  });
});
