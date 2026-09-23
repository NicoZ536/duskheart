/**
 * M0-01/M0-04: Ordner nach §3.2 (Schichten) und §3.5 sowie die Loop-Dateien existieren. Leere
 * Ordner sind in git nicht vorhanden – jeder Ordner hier enthält mindestens eine versionierte Datei.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const LAYERS = ['engine', 'world', 'game', 'content', 'save', 'render', 'audio', 'ui', 'i18n', 'debug'];
const FOLDERS = ['assets-src', 'assets-src/sprites', 'tools', 'tests/unit', 'tests/integration', 'tests/e2e', 'docs', 'shots/referenz'];
const LOOP_FILES = ['CLAUDE.md', 'FEEDBACK.md', 'PROGRESS.md', 'docs/DECISIONS.md', 'docs/SPEC_AUDIT.md', 'docs/ARCHITEKTUR.md', 'docs/GLOSSAR.md'];
const IGNORED = ['shots/latest', 'tools/out', 'src/generated'];

function hasFile(dir: string): boolean {
  return readdirSync(dir).some((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? hasFile(full) : true;
  });
}

describe('Projektstruktur', () => {
  it.each([...LAYERS.map((l) => `src/${l}`), ...FOLDERS])('%s existiert und enthält eine Datei', (dir) => {
    const full = join(ROOT, dir);
    expect(existsSync(full) && statSync(full).isDirectory(), dir).toBe(true);
    expect(hasFile(full), dir).toBe(true);
  });

  it('Loop-Dateien sind vorhanden', () => {
    for (const f of LOOP_FILES) expect(existsSync(join(ROOT, f)), f).toBe(true);
  });

  it('erzeugte Ausgaben sind gitignored', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim().replace(/\/$/, ''));
    for (const p of IGNORED) expect(ignore, p).toContain(p);
  });

  it('GLOSSAR hat mindestens 40 Begriffe DE/EN', () => {
    const rows = readFileSync(join(ROOT, 'docs/GLOSSAR.md'), 'utf8')
      .split('\n')
      .filter((l) => /^\|[^-|]/.test(l) && !/^\|\s*(Deutsch|DE)\s*\|/i.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(40);
  });
});
