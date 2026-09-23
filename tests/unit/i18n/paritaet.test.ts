/**
 * M0-09 i18n-Parität und „kein stiller Fallback“: de.json und en.json haben dieselben, nicht leeren
 * Schlüssel mit denselben Platzhaltern; ein fehlender Schlüssel ist ein Fehler – im Validator
 * (`checkI18nParity`), im strikten Modus als Ausnahme und im Spiel als gemeldetes Ereignis
 * (`onMissing`, das die App als Konsolenfehler ausgibt, den die E2E-Tests abfangen).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import de from '../../../src/i18n/de.json';
import en from '../../../src/i18n/en.json';
import { I18nError, LANGS, createI18n, listKeys, placeholders, type Lang } from '../../../src/i18n/index';
import { checkI18nParity } from '../../../tools/validator/checks';

const dicts: Record<Lang, Record<string, string>> = { de, en };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('de.json und en.json', () => {
  it('haben identische Schlüssel mit nicht leeren Texten', () => {
    expect(listKeys('de')).toEqual(listKeys('en'));
    expect(checkI18nParity(de, en)).toEqual([]);
    for (const lang of LANGS) {
      for (const [k, v] of Object.entries(dicts[lang])) {
        expect(typeof v, `${lang}:${k}`).toBe('string');
        expect(v.trim().length, `${lang}:${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('verwenden in beiden Sprachen dieselben Platzhalter', () => {
    for (const k of listKeys('de')) expect(placeholders(dicts.en[k] ?? ''), k).toEqual(placeholders(dicts.de[k] ?? ''));
  });

  it('enthalten jeden Schlüssel, den der Quellcode wörtlich übersetzt', () => {
    const literal = /(?:\bt\(|ConsoleError\()\s*['"]([A-Za-z0-9_.]+)['"]/g;
    const used = new Set<string>();
    for (const file of sourceFiles(join(process.cwd(), 'src'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(literal)) if (m[1] !== undefined) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(10);
    const i18n = createI18n('de');
    const missing = [...used].filter((k) => !LANGS.every((lang) => i18n.has(k, lang)));
    expect(missing).toEqual([]);
  });
});

describe('fehlender Schlüssel ⇒ Fehler', () => {
  it('der Validator meldet fehlende und leere Übersetzungen in beiden Richtungen', () => {
    expect(checkI18nParity({ 'a.b': 'A', 'c.d': 'C' }, { 'a.b': 'A' })).toEqual(['Übersetzung fehlt (EN): c.d']);
    expect(checkI18nParity({ 'a.b': 'A' }, { 'a.b': 'A', 'e.f': 'E' })).toEqual(['Übersetzung fehlt (DE): e.f']);
    expect(checkI18nParity({ 'a.b': 'A' }, { 'a.b': ' ' })).toEqual(['Übersetzung fehlt (EN): a.b']);
  });

  it('im strikten Modus wirft t() für einen fehlenden Schlüssel', () => {
    const i18n = createI18n('en', { strict: true, dictionaries: { en: { 'nur.de': 'x' }, de: { 'nur.de': 'x', 'fehlt.en': 'Nur deutsch' } } });
    expect(() => i18n.t('fehlt.en')).toThrow(I18nError);
    expect(() => i18n.t('gibt.es.nicht')).toThrow(/gibt\.es\.nicht.*en/);
    expect(i18n.t('nur.de')).toBe('x');
  });

  it('ohne strikten Modus wird jeder fehlende Schlüssel gemeldet, bevor Deutsch oder der Schlüssel erscheint', () => {
    const i18n = createI18n('en', { dictionaries: { en: { 'only.en': 'English only' }, de: { 'only.de': 'Nur deutsch', 'x.one': '{count} Ding', 'x.other': '{count} Dinge' } } });
    const reported: string[] = [];
    const off = i18n.onMissing((key, lang) => reported.push(`${lang}:${key}`));
    expect(i18n.t('only.en')).toBe('English only');
    expect(i18n.t('only.de')).toBe('Nur deutsch');
    expect(i18n.t('x', { count: 2 })).toBe('2 Dinge');
    expect(i18n.t('does.not.exist')).toBe('does.not.exist');
    // Each key and language is reported once, however often it is requested.
    expect(i18n.t('only.de')).toBe('Nur deutsch');
    expect(reported).toEqual(['en:only.de', 'en:x', 'en:does.not.exist', 'de:does.not.exist']);
    expect(i18n.missingKeys()).toEqual(['does.not.exist', 'only.de', 'x']);
    expect(i18n.missingKeys('de')).toEqual(['does.not.exist']);
    off();
    i18n.t('another.missing');
    expect(reported).toHaveLength(4);
  });

  it('die mitgelieferten Wörterbücher lösen im strikten Modus jeden Schlüssel in beiden Sprachen auf', () => {
    for (const lang of LANGS) {
      const i18n = createI18n(lang, { strict: true });
      for (const k of listKeys(lang)) expect(() => i18n.t(k)).not.toThrow();
    }
  });
});
