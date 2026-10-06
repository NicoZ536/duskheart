/**
 * Systemreihenfolge (M7-01, docs/SPIEL.md §16 „Systemreihenfolge“, ADR-0207): `SYSTEM_ORDER` ist die eine verbindliche
 * Registrierreihenfolge aller Systeme – die Systeme von `createSimulation` bilden eine Teilfolge davon, jedes steht darin;
 * die Liste in docs/SPIEL.md §16 ist dieselbe, und jede System-Id der Modultabelle §16 hat ihren Platz. Ein System an falscher
 * Stelle oder ohne Platz lässt `createSimulation` scheitern (`systemOrderViolation`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../src/game/setup';
import { SYSTEM_ORDER, isSystemId, systemOrderViolation } from '../../../src/game/systemOrder';

const DOC = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');

/** The text of section `n` of docs/SPIEL.md ("## n. …" up to the next "## "). */
function section(n: number): string {
  const start = DOC.indexOf(`\n## ${n}. `);
  if (start < 0) throw new Error(`docs/SPIEL.md: Abschnitt ${n} fehlt`);
  const end = DOC.indexOf('\n## ', start + 1);
  return DOC.slice(start, end < 0 ? undefined : end);
}

describe('SYSTEM_ORDER (M7-01, docs/SPIEL.md §16)', () => {
  it('die Systeme von createSimulation sind eine Teilfolge der Liste, jedes steht darin', () => {
    const ids = createSimulation({ seed: 1 }).systems.map((s) => s.id);
    expect(ids.length).toBeGreaterThan(30);
    expect(ids.filter((id) => !isSystemId(id))).toEqual([]);
    const ranks = ids.map((id) => SYSTEM_ORDER.indexOf(id as (typeof SYSTEM_ORDER)[number]));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(systemOrderViolation(ids)).toBeNull();
  });

  it('die Liste ist ohne Doppelte und steht genau so in docs/SPIEL.md §16', () => {
    expect(new Set(SYSTEM_ORDER).size).toBe(SYSTEM_ORDER.length);
    const s16 = section(16);
    const from = s16.indexOf('1 `world-chunks`');
    const to = s16.indexOf('Gründe:', from);
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const listed = [...s16.slice(from, to).matchAll(/`([a-z-]+)`/g)].map((m) => m[1]);
    expect(listed).toEqual([...SYSTEM_ORDER]);
  });

  it('jede System-Id der Modultabelle §16 hat ihren Platz in der Liste', () => {
    const rows = section(16)
      .split('\n')
      .filter((l) => l.trimStart().startsWith('| `'));
    const ids = rows.map((l) => /^\s*\| [^|]+ \| `([a-z-]+)` \|/.exec(l)?.[1]).filter((id): id is string => id !== undefined);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    for (const id of ids) expect(isSystemId(id), id).toBe(true);
  });

  it('systemOrderViolation: unbekannte Systeme und falsche Reihenfolge werden benannt', () => {
    expect(systemOrderViolation(['world-chunks', 'motion', 'player'])).toBeNull();
    expect(systemOrderViolation(['world-chunks', 'erfunden'])).toMatch(/"erfunden" is not in SYSTEM_ORDER/);
    expect(systemOrderViolation(['motion', 'world-chunks'])).toMatch(/"world-chunks" is registered after "motion"/);
    expect(systemOrderViolation(['stats', 'death'])).toMatch(/"death" is registered after "stats"/);
    expect(systemOrderViolation(['motion', 'motion'])).toMatch(/"motion" is registered after "motion"/);
  });
});
