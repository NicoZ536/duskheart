/**
 * Every balance value with its unit and its reason (MASTERPROMPT §2.4 "Balancewerte … (Einheit und Begründung
 * kommentiert)"; docs/BALANCE.md §1 "Alle Werte stehen in src/content/balance/*.ts (mit Einheit und Begründung)"; review
 * finding "balance-gruppen-ohne-einheit"): not only `src/content/balance.ts` (tests/unit/content/balance.test.ts) and the
 * groups with a test of their own (player, survival, light) – every module of `src/content/balance/`.
 *
 * The rule per value line (`name: value,`): the doc comment directly above it names a unit in brackets (`[px]`, `[s]`,
 * `[× the light blow]`, `[item id]` …) and gives a reason (more than ten characters besides the unit) – or, for the rows of
 * a map-like record (values by station, by biome, by difficulty, by material), the doc comment of the record that holds
 * them does: one comment with the units of its fields and the reason of the table. A value in a profile record (the fist,
 * a tool swung as a weapon) has its own comment; the comment of a neighbouring value does not cover it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('../../../src/content/balance/', import.meta.url));
/** A value line of a balance module: `name: value,` (a scalar, a list, or a row of a record on one line). */
const VALUE_LINE = /^\s+[a-zA-Z0-9_]+: .*,\s*$/;
/** The line that opens a record value: `name: {`. */
const RECORD_LINE = /^\s+[a-zA-Z0-9_]+: \{\s*$/;

/** The doc comment directly above line `i` (empty without one). */
function docAbove(lines: readonly string[], i: number): string {
  const doc: string[] = [];
  for (let j = i - 1; j >= 0 && /^\s*(\/\*\*|\*)/.test(lines[j] ?? ''); j--) doc.unshift(lines[j] ?? '');
  return doc.join(' ');
}

/** Whether a doc comment names a unit in brackets and gives a reason besides it. */
function documents(text: string): boolean {
  return /\[[^\]]+\]/.test(text) && text.replace(/\[[^\]]+\]/, '').replace(/[/*\s]/g, '').length > 10;
}

function indent(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0;
}

/** Value lines of `source` (from its `export const …_BALANCE`) that neither they nor an enclosing record document. */
function undocumentedValues(source: string): string[] {
  const start = source.search(/export const [A-Z_]+_BALANCE/);
  const lines = source.slice(start < 0 ? 0 : start).split('\n');
  const missing: string[] = [];
  lines.forEach((line, i) => {
    if (!VALUE_LINE.test(line) || documents(docAbove(lines, i))) return;
    // A row of a map-like record: the comment of an enclosing record covers it.
    let depth = indent(line);
    for (let j = i - 1; j >= 0; j--) {
      const p = lines[j] ?? '';
      if (/^export const/.test(p)) break;
      if (RECORD_LINE.test(p) && indent(p) < depth) {
        if (documents(docAbove(lines, j))) return;
        depth = indent(p);
      }
    }
    missing.push(line.trim());
  });
  return missing;
}

const MODULES = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts'))
  .sort();

describe('Balancewerte: Einheit und Begründung in jeder Gruppe (§2.4)', () => {
  it('jede Datei unter src/content/balance/ dokumentiert jeden Wert', () => {
    expect(MODULES.length).toBeGreaterThanOrEqual(25);
    const missing: Record<string, string[]> = {};
    let values = 0;
    for (const f of MODULES) {
      const source = readFileSync(DIR + f, 'utf8');
      values += source.split('\n').filter((l) => VALUE_LINE.test(l)).length;
      const m = undocumentedValues(source);
      if (m.length > 0) missing[f] = m;
    }
    expect(values).toBeGreaterThan(500);
    expect(missing).toEqual({});
  });

  it('die Regel greift: ein Wert ohne Einheit, ohne Begründung oder nur unter dem Kommentar seines Nachbarn ist undokumentiert', () => {
    const source = `export const PROBE_BALANCE = {
  /** Reach [px]: an arm's length, the dagger's. */
  reach: 14,
  arc: 70,
  /** Tempo of a blow. */
  tempo: 0.4,
  /** Wind-up [s]. */
  windup: 0.2,
  /** Values by difficulty [× damage]: Normal is the reference of every number. */
  byDifficulty: {
    leicht: 0.6,
    normal: 1,
  },
  profile: {
    /** Stamina [points]: half a tool's swing, a punch tires less. */
    stamina: 4,
    stagger: 0.1,
  },
};`;
    expect(undocumentedValues(source)).toEqual(['arc: 70,', 'tempo: 0.4,', 'windup: 0.2,', 'stagger: 0.1,']);
  });
});
