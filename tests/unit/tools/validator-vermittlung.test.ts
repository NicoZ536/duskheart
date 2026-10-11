/**
 * Validator-Regel `vermittlung` (MASTERPROMPT §2.2 „Jede Mechanik wird im Spiel vermittelt (Hinweis, Chronik, Tooltip)“;
 * docs/SPIEL.md §23 „Vermittlungs-Register“; M7-45): je Mechanik ein Hinweis (Hinweistabelle oder Einstiegsschritt), ein
 * Wissenseintrag, ein Tooltip (i18n-Schlüssel in beiden Sprachen oder ein Content-Datensatz) und ihr Task in PROGRESS.md – jeder
 * fehlende Baustein ist genau ein Fehler (Fixtures); das echte Register besteht die Regel und nennt die Mechaniken bis M7.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { guideHintSchema } from '../../../src/content/guide/schema';
import { knowledgeSchema } from '../../../src/content/chronik/schema';
import { CONTENT } from '../../../src/content/index';
import { questSchema } from '../../../src/content/quests/schema';
import { ContentRegistry } from '../../../src/content/registry';
import { mechanicSchema, type MechanicInput } from '../../../src/content/vermittlung/schema';
import { checkMechanics } from '../../../tools/validator/vermittlung';

const T = { de: 'x', en: 'x' };
const PROGRESS = '- [ ] M7-45 Vermittlung\n- [x] M3-10 Essen\n';
const KEYS = { de: new Set(['ui.probe.tooltip']), en: new Set(['ui.probe.tooltip']) };

function registry(mechanics: MechanicInput[]): ContentRegistry {
  return new ContentRegistry()
    .defineCollection('guideHints', guideHintSchema, [{ id: 'hinweis_probe', kanal: 'hinweis', text: T, ausloeser: { art: 'ereignis', ereignis: 'treeFelled' }, prioritaet: 1, einmalig: true }])
    .defineCollection('knowledge', knowledgeSchema, [{ id: 'wissen_probe', titel: T, text: T, quelle: 'mechanik', freischaltung: { art: 'ereignis', ereignis: 'treeFelled' } }])
    .defineCollection('quests', questSchema, [{ id: 'einstieg', art: 'einstieg', titel: T, beschreibung: T, schritte: [{ id: 'eins', titel: T, hinweis: T, ausloeser: { art: 'ereignis', ereignis: 'treeFelled' } }] }])
    .defineCollection('mechanics', mechanicSchema, mechanics);
}

const GUT: MechanicInput = { id: 'mech_probe_gut', paragraph: '§17', task: 'M7-45', hinweis: 'hinweis_probe', wissen: 'wissen_probe', tooltip: { art: 'i18n', schluessel: 'ui.probe.tooltip' } };

describe('Validator-Regel vermittlung', () => {
  it('vollständige Mechaniken (Hinweis, Einstiegsschritt, Content-Tooltip) bestehen', () => {
    const res = checkMechanics(
      registry([GUT, { ...GUT, id: 'mech_probe_schritt', hinweis: 'aufgabe:einstieg/eins', task: 'M3-10', tooltip: { art: 'content', sammlung: 'knowledge', id: 'wissen_probe' } }]),
      KEYS,
      PROGRESS,
    );
    expect(res.errors).toEqual([]);
    expect(res.mechanics.map((m) => m.id)).toEqual(['mech_probe_gut', 'mech_probe_schritt']);
  });

  it('jeder fehlende Baustein ist genau ein Fehler', () => {
    const fehler = (m: MechanicInput, keys = KEYS): string[] => checkMechanics(registry([m]), keys, PROGRESS).errors;
    expect(fehler({ ...GUT, hinweis: 'hinweis_fehlt' })).toEqual(['Mechanik mech_probe_gut: Hinweis hinweis_fehlt fehlt (guideHints oder aufgabe:<aufgabe>/<schritt>)']);
    expect(fehler({ ...GUT, hinweis: 'aufgabe:gibtsnicht/eins' })).toEqual(['Mechanik mech_probe_gut: Hinweis aufgabe:gibtsnicht/eins – die Aufgabe gibt es nicht']);
    expect(fehler({ ...GUT, hinweis: 'aufgabe:einstieg/zwei' })).toEqual(['Mechanik mech_probe_gut: Hinweis aufgabe:einstieg/zwei – die Aufgabe hat diesen Schritt nicht']);
    expect(fehler({ ...GUT, wissen: 'wissen_fehlt' })).toEqual(['Mechanik mech_probe_gut: Wissenseintrag wissen_fehlt fehlt (knowledge)']);
    expect(fehler(GUT, { de: KEYS.de, en: new Set() })).toEqual(['Mechanik mech_probe_gut: Tooltip-Schlüssel ui.probe.tooltip fehlt in en.json']);
    expect(fehler({ ...GUT, tooltip: { art: 'content', sammlung: 'gibtsnicht', id: 'x' } })).toEqual(['Mechanik mech_probe_gut: Tooltip-Sammlung gibtsnicht gibt es nicht']);
    expect(fehler({ ...GUT, tooltip: { art: 'content', sammlung: 'knowledge', id: 'wissen_fehlt' } })).toEqual(['Mechanik mech_probe_gut: Tooltip knowledge/wissen_fehlt gibt es nicht']);
    expect(fehler({ ...GUT, task: 'M9-99' })).toEqual(['Mechanik mech_probe_gut: Task M9-99 steht nicht in PROGRESS.md']);
  });

  it('das Register des Spiels besteht die Regel: jede Mechanik bis M7 mit Hinweis, Wissen und Tooltip', () => {
    const keys = (lang: 'de' | 'en'): Set<string> => new Set(Object.keys(JSON.parse(readFileSync(`src/i18n/${lang}.json`, 'utf8')) as object));
    const res = checkMechanics(CONTENT, { de: keys('de'), en: keys('en') }, readFileSync('PROGRESS.md', 'utf8'));
    expect(res.errors).toEqual([]);
    // Strand G's own register: the mechanics up to M6 (m3_m6.ts) and its own (kern.ts); the strands add theirs.
    expect(res.mechanics.length).toBeGreaterThanOrEqual(50);
    for (const p of ['§11', '§14', '§15', '§23']) expect(res.mechanics.some((m) => m.paragraph.startsWith(p)), p).toBe(true);
  });
});
