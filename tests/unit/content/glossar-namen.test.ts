/**
 * M7-91 Texte nach dem Glossar (MASTERPROMPT §2.11 „ein Begriff pro Ding“; docs/GLOSSAR.md „Verbindliche Namen für Texte,
 * Content-IDs, Code-Kommentare und UI“):
 *
 * - die Namen der Weltereignisse, der Ortstypen und der Bosse stehen so im Glossar – deutsch und englisch;
 * - keine der alten Schreibweisen (Greenwood, Bark Father, Shadow Flood, Shadow Brood, Darkmoon, Night of Mists, die Arena des
 *   Wächters) steht in einem Text des Contents oder der Sprachdateien;
 * - kein englischer Text trägt einen deutschen Glossarnamen, der englisch anders heißt (Grünhain, Nachtherz, Funke …);
 * - der Boss eines Leuchtfeuers heißt Hüter / Guardian, nicht Wächter / Warden (der Wächter eines Ortes ist ein Guard).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { BOSS_ARENA_PLACE } from '../../../src/content/bosses/arena';
import { GUIDE_HINTS_F } from '../../../src/content/guide/leuchtfeuer';
import { KNOWLEDGE_F } from '../../../src/content/wissen/leuchtfeuer';
import { CHRONICLE_RULES_F } from '../../../src/content/chronik/leuchtfeuer';
import type { LocalizedText } from '../../../src/content/schema/common';

/** The glossary's rows `| DE | EN | Bedeutung |`: German name → English name. */
function glossary(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^\| ([^|]+?) \| ([^|]+?) \| /.exec(line);
    if (m === null) continue;
    const de = (m[1] as string).trim();
    const en = (m[2] as string).trim();
    if (de === 'DE' || de.startsWith('---')) continue;
    out.set(de, en);
  }
  return out;
}

/** Every localized text of `value` with the path it stands at. */
function texts(value: unknown, path: string, out: Array<{ path: string; text: LocalizedText }>): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => texts(v, `${path}[${i}]`, out));
    return;
  }
  const o = value as Record<string, unknown>;
  if (typeof o.de === 'string' && typeof o.en === 'string') out.push({ path, text: { de: o.de, en: o.en } });
  for (const [k, v] of Object.entries(o)) texts(v, `${path}.${k}`, out);
}

const GLOSSARY = glossary(readFileSync(new URL('../../../docs/GLOSSAR.md', import.meta.url), 'utf8'));
const I18N_DE = JSON.parse(readFileSync(new URL('../../../src/i18n/de.json', import.meta.url), 'utf8')) as Record<string, string>;
const I18N_EN = JSON.parse(readFileSync(new URL('../../../src/i18n/en.json', import.meta.url), 'utf8')) as Record<string, string>;

/** Every localized text of the content and every line of the language files. */
function allTexts(): Array<{ path: string; text: LocalizedText }> {
  const out: Array<{ path: string; text: LocalizedText }> = [];
  for (const c of CONTENT.collections()) for (const r of c.values()) texts(r, `${c.name}:${(r as { id?: string }).id ?? '?'}`, out);
  for (const [key, en] of Object.entries(I18N_EN)) out.push({ path: `i18n:${key}`, text: { de: I18N_DE[key] ?? '', en } });
  return out;
}

/** The names of a collection's records. */
function names(collection: string): Array<{ id: string; name: LocalizedText }> {
  const c = CONTENT.collections().find((x) => x.name === collection);
  if (c === undefined) throw new Error(`Sammlung ${collection} fehlt`);
  return (c.values() as ReadonlyArray<{ id: string; name: LocalizedText }>).map((r) => ({ id: r.id, name: r.name }));
}

/** Old spellings that must not come back (M7-91), as patterns over a text. */
const OLD_SPELLINGS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Greenwood', /Greenwood/],
  ['Bark Father', /Bark Father/i],
  ['Shadow Flood', /shadow flood/i],
  ['Shadow Brood', /shadow ?brood/i],
  ['Darkmoon', /darkmoon/i],
  ['Night of Mists', /night of mists/i],
  ['Arena des Wächters', /Arena des Wächters/],
  ['Warden’s Arena', /Warden[’']s Arena/],
];

describe('M7-91 Namen nach dem Glossar', () => {
  it('Weltereignisse, Ortstypen und Bosse heißen deutsch und englisch, wie das Glossar sie nennt', () => {
    const wrong: string[] = [];
    for (const collection of ['worldEvents', 'locationTypes', 'bosses']) {
      const list = names(collection);
      expect(list.length, collection).toBeGreaterThan(0);
      for (const { id, name } of list) {
        const en = GLOSSARY.get(name.de);
        if (en === undefined) wrong.push(`${collection}:${id}: „${name.de}“ fehlt im Glossar`);
        else if (en !== name.en) wrong.push(`${collection}:${id}: „${name.de}“ heißt englisch „${en}“, nicht „${name.en}“`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('keine der alten Schreibweisen in Content und Sprachdateien', () => {
    const found: string[] = [];
    for (const { path, text } of allTexts()) {
      for (const [old, re] of OLD_SPELLINGS) if (re.test(text.de) || re.test(text.en)) found.push(`${path}: ${old}`);
    }
    expect(found).toEqual([]);
  });

  it('kein englischer Text trägt einen deutschen Glossarnamen, der englisch anders heißt', () => {
    // Capitalised German names of at least four letters whose English name differs (Grünhain → Greengrove, Funke → Spark …).
    const german = [...GLOSSARY].filter(([de, en]) => de !== en && /^[A-ZÄÖÜ]/.test(de) && de.length >= 4 && !de.includes('`'));
    expect(german.length).toBeGreaterThan(100);
    const patterns = german.map(([de, en]) => [de, en, new RegExp(`(^|[^\\p{L}])${de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u')] as const);
    const found: string[] = [];
    // The pattern matches only where the text holds the name literally (case-sensitive), so `includes` skips the
    // regular expression for every other text without changing what is found (M7-75: 7,7 s → < 1 s).
    for (const { path, text } of allTexts()) for (const [de, en, re] of patterns) if (text.en.includes(de) && re.test(text.en)) found.push(`${path}: ${de} → ${en}`);
    expect(found).toEqual([]);
  });

  it('der Boss eines Leuchtfeuers ist der Hüter / Guardian: Arena, Wissen, Funke und Chronik der Leuchtfeuer', () => {
    expect(GLOSSARY.get('Hüter')).toBe('Guardian');
    const own: Array<{ path: string; text: LocalizedText }> = [];
    texts(BOSS_ARENA_PLACE, 'bossarena', own);
    texts(KNOWLEDGE_F, 'wissen', own);
    texts(GUIDE_HINTS_F, 'funke', own);
    texts(CHRONICLE_RULES_F, 'chronik', own);
    expect(own.length).toBeGreaterThan(10);
    const found = own.filter(({ text }) => /Wächter/.test(text.de) || /warden/i.test(text.en)).map(({ path }) => path);
    expect(found).toEqual([]);
    // The arena names its guardian; the knowledge entry tells of the guardians of the fires.
    expect(BOSS_ARENA_PLACE.beschreibung.de).toContain('Hüter');
    expect(BOSS_ARENA_PLACE.beschreibung.en).toContain('guardian');
    expect(KNOWLEDGE_F.some((k) => k.titel.de === 'Die Hüter der Feuer' && k.titel.en === 'The Guardians of the Fires')).toBe(true);
  });
});
