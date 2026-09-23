/**
 * M0-02: ESLint layer and magic-number rules plus the forbidden list (tools/forbidden.ts) reject the
 * violation fixtures in tests/fixtures/tooling/verstoesse and accept the edge cases in …/sauber.
 * Both checkers are run with the real project configuration, so a violation like these makes
 * `npm run check` (steps `lint` and `forbidden`) fail.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it, vi } from 'vitest';
import {
  ANY_RULE,
  DEFAULT_EXCLUDES,
  MARKERS,
  describeViolation,
  main,
  parseCliArgs,
  scanSource,
  scanTree,
  splitScript,
  type Violation,
  type ViolationCode,
} from '../../../tools/forbidden';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/[\\/]$/, '');
const FIXTURES = join(ROOT, 'tests/fixtures/tooling');
const BAD = join(FIXTURES, 'verstoesse');
const GOOD = join(FIXTURES, 'sauber');
const CONFIG = join(ROOT, 'eslint.config.js');
const LAYER_RULE = 'no-restricted-imports';
const MAGIC_RULE = '@typescript-eslint/no-magic-numbers';
const GLOBALS_RULE = 'no-restricted-globals';
/** ESLint start-up plus linting a few files; generous for slow CI machines. */
const LINT_TIMEOUT_MS = 60_000;
const CLI_TIMEOUT_MS = 60_000;

function eslintFor(cwd: string): ESLint {
  return new ESLint({ cwd, overrideConfigFile: CONFIG });
}

async function lintAs(cwd: string, relPath: string, code: string): Promise<ESLint.LintResult> {
  const [result] = await eslintFor(cwd).lintText(code, { filePath: join(cwd, relPath) });
  if (!result) throw new Error(`no lint result for ${relPath}`);
  return result;
}

function ruleIds(result: ESLint.LintResult): string[] {
  return result.messages.map((m) => m.ruleId ?? 'eslint');
}

function fixture(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function codesByFile(violations: readonly Violation[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const v of violations) (out[v.file] ??= []).push(`${v.code}:${v.token}`);
  return out;
}

describe('ESLint: Schichtregeln (§3.2)', () => {
  it(
    'lehnt einen Import aus render in game ab',
    async () => {
      const result = await lintAs(BAD, 'src/game/importRender.ts', fixture(BAD, 'src/game/importRender.ts'));
      expect(ruleIds(result)).toContain(LAYER_RULE);
      expect(result.errorCount).toBeGreaterThan(0);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'wendet die Regel nach Verzeichnis an: derselbe Import ist in ui erlaubt, in world/engine/content/save verboten',
    async () => {
      const code = "import { SPRITE_SIZE } from '../render/sprite';\nexport const size = SPRITE_SIZE;\n";
      expect(ruleIds(await lintAs(BAD, 'src/ui/hud.ts', code))).not.toContain(LAYER_RULE);
      for (const layer of ['world', 'engine', 'content', 'save']) {
        expect(ruleIds(await lintAs(BAD, `src/${layer}/probe.ts`, code)), layer).toContain(LAYER_RULE);
      }
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'erlaubt Preact nur in ui und debug; die Kompositionswurzel main.tsx bindet die UI über mountApp ein (M0-16)',
    async () => {
      const code = "import { signal } from '@preact/signals';\nimport { h } from 'preact';\nimport { useState } from 'preact/hooks';\nexport const parts = [signal(0), h, useState];\n";
      const forbidden = ['src/main.tsx', 'src/render/probe.ts', 'src/audio/probe.ts', 'src/i18n/probe.ts', 'src/engine/probe.ts', 'src/world/probe.ts', 'src/game/probe.ts', 'src/content/probe.ts', 'src/save/probe.ts', 'tools/probe.ts', 'assets-src/probe.ts'];
      for (const path of forbidden) {
        const result = await lintAs(BAD, path, code);
        const preact = result.messages.filter((m) => m.ruleId === LAYER_RULE && m.message.includes('Preact nur in src/ui'));
        expect(preact, path).toHaveLength(3);
      }
      for (const path of ['src/ui/probe.tsx', 'src/debug/probe.tsx']) {
        expect(ruleIds(await lintAs(BAD, path, code)), path).not.toContain(LAYER_RULE);
      }
      // The layer rule of render still applies next to the Preact pattern.
      expect(ruleIds(await lintAs(BAD, 'src/render/probe.ts', "import { App } from '../ui/App';\nexport const app = App;\n"))).toContain(LAYER_RULE);
    },
    LINT_TIMEOUT_MS,
  );
});

describe('ESLint: keine Browser- und Timer-Globals in der Simulation (§3.2)', () => {
  it(
    'lehnt window, document, localStorage und Timer in world/game/content/save ab, erlaubt sie in engine und ui',
    async () => {
      const code = 'export const w = window.innerWidth;\nexport const d = document.title;\nexport const s = localStorage.length;\nexport const t = setTimeout(() => undefined, 1);\n';
      for (const layer of ['world', 'game', 'content', 'save']) {
        const ids = ruleIds(await lintAs(BAD, `src/${layer}/probe.ts`, code));
        expect(ids.filter((r) => r === GLOBALS_RULE), layer).toHaveLength(4);
      }
      for (const layer of ['engine', 'ui', 'debug']) expect(ruleIds(await lintAs(BAD, `src/${layer}/probe.ts`, code)), layer).not.toContain(GLOBALS_RULE);
      // Injected values with the same names are fine: only the globals are forbidden.
      const injected = 'export function size(window: { innerWidth: number }): number {\n  return window.innerWidth;\n}\n';
      expect(ruleIds(await lintAs(BAD, 'src/game/probe.ts', injected))).not.toContain(GLOBALS_RULE);
    },
    LINT_TIMEOUT_MS,
  );
});

describe('ESLint: Magic Numbers in Systemcode (§2.4)', () => {
  it(
    'lehnt Zahl-Literale in game und world ab',
    async () => {
      const code = fixture(BAD, 'src/game/magicNumber.ts');
      for (const path of ['src/game/magicNumber.ts', 'src/world/magicNumber.ts']) {
        const result = await lintAs(BAD, path, code);
        expect(ruleIds(result).filter((r) => r === MAGIC_RULE), path).toHaveLength(2);
      }
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'erlaubt dieselben Zahlen in content, render und Tests',
    async () => {
      const code = fixture(BAD, 'src/game/magicNumber.ts');
      for (const path of ['src/content/magicNumber.ts', 'src/render/magicNumber.ts', 'tests/unit/game/magicNumber.test.ts']) {
        expect(ruleIds(await lintAs(BAD, path, code)), path).not.toContain(MAGIC_RULE);
      }
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'erlaubt benannte Konstanten, Enums, Literaltypen, Klassenfelder, Defaults und Array-Indizes',
    async () => {
      const result = await lintAs(GOOD, 'src/game/tuning.ts', fixture(GOOD, 'src/game/tuning.ts'));
      expect(result.messages).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );
});

describe('ESLint: Fixture-Bäume', () => {
  it(
    'Verstoß-Baum ist rot, sauberer Baum grün',
    async () => {
      const bad = await eslintFor(BAD).lintFiles(['.']);
      const badRules = new Set(bad.flatMap(ruleIds));
      expect(badRules).toContain(LAYER_RULE);
      expect(badRules).toContain(MAGIC_RULE);
      expect(bad.reduce((n, r) => n + r.errorCount, 0)).toBeGreaterThan(0);

      const good = await eslintFor(GOOD).lintFiles(['.']);
      expect(good.flatMap((r) => r.messages.map((m) => `${r.filePath}: ${m.ruleId ?? 'eslint'} ${m.message}`))).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'der reguläre Projektlauf ignoriert tests/fixtures',
    async () => {
      expect(await eslintFor(ROOT).isPathIgnored(join(BAD, 'src/game/importRender.ts'))).toBe(true);
      expect(await eslintFor(ROOT).isPathIgnored(join(ROOT, 'tests/unit/tooling/verbotsliste.test.ts'))).toBe(false);
    },
    LINT_TIMEOUT_MS,
  );
});

describe('Verbotsliste (tools/forbidden.ts)', () => {
  it('meldet jeden Verstoß im Verstoß-Baum genau einmal', () => {
    const result = scanTree({ root: BAD });
    expect(codesByFile(result.violations)).toEqual({
      'assets-src/sprites/raster.ts': [`marker-comment:${MARKERS.xxx}`],
      'src/engine/seed.ts': ['sim-random:Math.random'],
      'src/game/anyWithoutInterop.ts': [`any-without-interop:${ANY_RULE}`],
      'src/game/disabledLayerRule.ts': [`protected-rule-disabled:${LAYER_RULE}`],
      'src/game/timing.ts': ['sim-performance-now:performance.now'],
      'src/ui/notes.ts': [`marker:${MARKERS.todo}`, `marker:${MARKERS.fixme}`, `marker:${MARKERS.hack}`],
      'src/world/blanketDisable.ts': ['protected-rule-disabled:*'],
      'src/world/clock.ts': ['sim-date-now:Date.now', 'sim-new-date:new Date(', 'sim-performance-now:performance.now'],
      'src/world/random.ts': ['sim-random:Math.random'],
    });
    for (const v of result.violations) expect(describeViolation(v).length).toBeGreaterThan(0);
  });

  it('meldet Zeilennummern der Fundstellen', () => {
    const clock = scanTree({ root: BAD }).violations.filter((v) => v.file === 'src/world/clock.ts');
    const lines = fixture(BAD, 'src/world/clock.ts').split('\n');
    for (const v of clock) expect(lines[v.line - 1]?.trim()).toBe(v.text);
  });

  it('akzeptiert die erlaubten Grenzfälle im sauberen Baum', () => {
    const result = scanTree({ root: GOOD });
    expect(result.files).toBeGreaterThan(0);
    expect(result.violations).toEqual([]);
  });

  it('prüft Marker überall, den X-Marker aber nur in Kommentaren', () => {
    const codes = (rel: string, src: string): ViolationCode[] => scanSource(rel, src).map((v) => v.code);
    expect(codes('tools/a.ts', `const s = '${MARKERS.todo} später';\n`)).toEqual(['marker']);
    expect(codes('tests/a.json', `{ "note": "${MARKERS.fixme}" }\n`)).toEqual(['marker']);
    expect(codes('assets-src/a.ts', `export const row = '.${MARKERS.xxx}.';\n`)).toEqual([]);
    expect(codes('assets-src/a.ts', `/* ${MARKERS.xxx} */ export const row = '.';\n`)).toEqual(['marker-comment']);
    expect(codes('src/render/a.glsl', `// ${MARKERS.xxx} Banding\n`)).toEqual(['marker']);
  });

  it('prüft Zeit- und Zufallsquellen nur in den Simulationsschichten', () => {
    const src = 'export const t = () => [Math.random(), Date.now(), new Date(), performance.now()];\n';
    const codes = (rel: string): ViolationCode[] => scanSource(rel, src).map((v) => v.code);
    const allFour: ViolationCode[] = ['sim-random', 'sim-date-now', 'sim-new-date', 'sim-performance-now'];
    for (const layer of ['world', 'game', 'content']) expect(codes(`src/${layer}/a.ts`), layer).toEqual(allFour);
    expect(codes('src/engine/a.ts')).toEqual(['sim-random', 'sim-date-now', 'sim-new-date']);
    for (const other of ['src/render/a.ts', 'src/ui/a.tsx', 'src/debug/a.ts', 'tools/a.ts', 'tests/unit/a.test.ts']) expect(codes(other), other).toEqual([]);
  });

  it('ignoriert Aufrufe in Strings, Template-Texten, Regex-Literalen und Kommentaren', () => {
    const src = [
      "const a = 'Math.random()';",
      'const b = `Date.now() ${1 + 1} new Date()`;',
      'const c = /performance\\.now\\(/;',
      '// Math.random() wäre hier verboten',
      'const d = `${`${Math.random()}`}`;',
    ].join('\n');
    const found = scanSource('src/world/a.ts', src);
    expect(found.map((v) => `${v.line}:${v.code}`)).toEqual(['5:sim-random']);
  });

  it('trennt Code, Strings und Kommentare zeilentreu', () => {
    const src = "const x = 'a'; // note\nconst y = `t ${x} u`;\n";
    const { code, comments } = splitScript(src, false);
    expect(code.split('\n')).toHaveLength(src.split('\n').length);
    expect(code).toContain('${x}');
    expect(code).not.toContain('note');
    expect(comments.map((c) => c.text)).toEqual(['// note']);
  });

  it('verlangt für any-Ausnahmen eine Interop-Begründung', () => {
    const directive = (desc: string): string => `// eslint-disable-next-line ${ANY_RULE}${desc}\nexport type T = any;\n`;
    expect(scanSource('src/ui/a.ts', directive('')).map((v) => v.code)).toEqual(['any-without-interop']);
    expect(scanSource('src/ui/a.ts', directive(' -- weil es schneller geht')).map((v) => v.code)).toEqual(['any-without-interop']);
    expect(scanSource('src/ui/a.ts', directive(' -- Interop: Gamepad-API liefert untypisierte Achsen'))).toEqual([]);
  });

  it('verbietet das Abschalten der Schicht- und Magic-Number-Regeln', () => {
    for (const rule of [LAYER_RULE, GLOBALS_RULE, MAGIC_RULE, 'no-magic-numbers']) {
      const found = scanSource('src/game/a.ts', `/* eslint-disable ${rule} -- Interop: nein */\nexport const a = 1;\n`);
      expect(found.map((v) => `${v.code}:${v.token}`), rule).toEqual([`protected-rule-disabled:${rule}`]);
    }
    expect(scanSource('src/game/a.ts', '// eslint-disable-line\nexport const a = 1;\n').map((v) => v.token)).toEqual(['*']);
    expect(scanSource('src/game/a.ts', '// eslint-disable-next-line prefer-const -- Beispiel\nexport let a = 1;\n')).toEqual([]);
  });

  it('überspringt tests/fixtures im Standardlauf, nicht aber mit --root', () => {
    const defaults = parseCliArgs([], ROOT);
    expect(defaults.root).toBe(ROOT);
    expect(defaults.exclude).toEqual(DEFAULT_EXCLUDES);
    const project = scanTree({ root: ROOT, dirs: ['tests'], exclude: defaults.exclude });
    expect(project.violations.filter((v) => v.file.startsWith('tests/fixtures/'))).toEqual([]);

    const explicit = parseCliArgs(['--root', 'tests/fixtures/tooling/verstoesse'], ROOT);
    expect(explicit.root).toBe(BAD);
    expect(explicit.exclude).toEqual([]);
    expect(parseCliArgs(['src', 'tools'], ROOT).dirs).toEqual(['src', 'tools']);
    expect(() => parseCliArgs(['--root'], ROOT)).toThrow();
    expect(() => parseCliArgs(['--unbekannt'], ROOT)).toThrow();
  });

  it('main() liefert Exit-Code 1 bei Verstößen, 0 ohne, 2 bei falscher Bedienung', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(main(['--root', BAD], ROOT)).toBe(1);
      expect(main(['--root', GOOD], ROOT)).toBe(0);
      expect(main(['--root'], ROOT)).toBe(2);
      expect(error).toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
      log.mockRestore();
    }
  });

  it(
    'die CLI (Schritt „forbidden“ von npm run check) scheitert am Verstoß-Baum',
    () => {
      const tsx = join(ROOT, 'node_modules/.bin/tsx');
      const bad = spawnSync(tsx, ['tools/forbidden.ts', '--root', BAD], { cwd: ROOT, encoding: 'utf8' });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('src/world/random.ts:3');
      const good = spawnSync(tsx, ['tools/forbidden.ts', '--root', GOOD], { cwd: ROOT, encoding: 'utf8' });
      expect(good.status).toBe(0);
    },
    CLI_TIMEOUT_MS,
  );
});
