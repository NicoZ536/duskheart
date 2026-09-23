/**
 * Verbotsliste (MASTERPROMPT §2.1, §2.5, §2.6, §3.4 `check`).
 * - Platzhalter-Marker (`MARKERS`): drei davon überall; der X-Marker nur in Kommentaren von TS/JS
 *   (Sprite-Raster dürfen X-Folgen enthalten), in GLSL/CSS/HTML überall.
 * - Math.random / Date.now / new Date( in der Simulation (src/engine, src/world, src/game, src/content).
 * - performance.now in src/world, src/game, src/content (Zeit kommt nur über den Loop).
 * - `any` nur an markierten Interop-Grenzen: eine eslint-disable-Direktive für `no-explicit-any` braucht
 *   die Begründung `-- Interop: …`.
 * - Schichtregeln (Importe, Browser-Globals) und Magic-Number-Regel (eslint.config.js) dürfen nicht per
 *   eslint-disable abgeschaltet werden; pauschale `eslint-disable`-Direktiven ohne Regelliste sind
 *   ebenfalls verboten.
 *
 * CLI: `tsx tools/forbidden.ts [--root <dir>] [dir …]`. Standard: Projektwurzel (cwd) mit
 * `DEFAULT_SCAN_DIRS`. `tests/fixtures/` wird im Standardlauf übersprungen – dort liegen absichtliche
 * Verstöße, die `tests/unit/tooling/verbotsliste.test.ts` mit `--root` gezielt prüft.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Placeholder markers, built from parts so this file does not flag itself. */
export const MARKERS = {
  todo: 'TO' + 'DO',
  fixme: 'FIX' + 'ME',
  hack: 'HA' + 'CK',
  xxx: 'X' + 'XX',
} as const;

export type ViolationCode =
  | 'marker'
  | 'marker-comment'
  | 'sim-random'
  | 'sim-date-now'
  | 'sim-new-date'
  | 'sim-performance-now'
  | 'any-without-interop'
  | 'protected-rule-disabled';

export interface Violation {
  /** Path relative to the scan root, `/`-separated. */
  readonly file: string;
  readonly line: number;
  readonly code: ViolationCode;
  /** The offending marker, API or rule name. */
  readonly token: string;
  /** Trimmed source line (or comment excerpt). */
  readonly text: string;
}

export interface ScanResult {
  readonly files: number;
  readonly violations: readonly Violation[];
}

export interface ScanOptions {
  /** Directory that plays the role of the project root (paths like `src/game/` are relative to it). */
  readonly root: string;
  /** Directories below `root` to scan. */
  readonly dirs?: readonly string[];
  /** Path prefixes (relative to `root`, `/`-separated) that are skipped. */
  readonly exclude?: readonly string[];
}

export const DEFAULT_SCAN_DIRS: readonly string[] = ['src', 'tools', 'tests', 'assets-src'];
/** Deliberate violations used by the tooling tests. */
export const DEFAULT_EXCLUDES: readonly string[] = ['tests/fixtures/'];
/** Simulation layers: no nondeterministic randomness or wall-clock time. */
export const SIM_DIRS: readonly string[] = ['src/engine/', 'src/world/', 'src/game/', 'src/content/'];
/** Layers that must not read the high-resolution clock (time only arrives through the loop). */
export const NO_PERF_DIRS: readonly string[] = ['src/world/', 'src/game/', 'src/content/'];
/** ESLint rules that inline directives may never switch off. */
export const PROTECTED_RULES: readonly string[] = ['no-restricted-imports', 'no-restricted-globals', 'no-magic-numbers', '@typescript-eslint/no-magic-numbers'];
/** Rule that may only be disabled with an `-- Interop: …` justification. */
export const ANY_RULE = '@typescript-eslint/no-explicit-any';

const EXT = /\.(ts|tsx|js|mjs|glsl|json|css|html)$/;
const SCRIPT_EXT = /\.(ts|tsx|js|mjs)$/;
/** Text formats without raster data: every marker counts anywhere. */
const PLAIN_SOURCE_EXT = /\.(glsl|css|html)$/;
const SKIP_DIRS = new Set(['node_modules', 'generated', 'out']);

const markerAnywhere = new RegExp(`\\b(${MARKERS.todo}|${MARKERS.fixme}|${MARKERS.hack})\\b`);
const markerAll = new RegExp(`\\b(${MARKERS.todo}|${MARKERS.fixme}|${MARKERS.hack}|${MARKERS.xxx})\\b`);
const xxxMarker = new RegExp(`\\b${MARKERS.xxx}\\b`);
const simBanned: ReadonlyArray<readonly [RegExp, ViolationCode, string]> = [
  [/\bMath\.random\s*\(/, 'sim-random', 'Math.random'],
  [/\bDate\.now\s*\(/, 'sim-date-now', 'Date.now'],
  [/\bnew\s+Date\s*\(/, 'sim-new-date', 'new Date('],
];
const perfBanned: readonly [RegExp, ViolationCode, string] = [/\bperformance\.now\s*\(/, 'sim-performance-now', 'performance.now'];
const directivePattern = /^eslint-disable(?:-next-line|-line)?(?:\s+([\s\S]*))?$/;
const interopPattern = /^Interop\b/i;

/** Tokens after which a `/` starts a division, not a regular expression literal. */
const EXPRESSION_END = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.PrivateIdentifier,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.CloseBracketToken,
  ts.SyntaxKind.CloseBraceToken,
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
  ts.SyntaxKind.ThisKeyword,
  ts.SyntaxKind.SuperKeyword,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
]);

interface SourceComment {
  readonly pos: number;
  readonly text: string;
}

/**
 * Splits TS/JS source into code with comments and string/template/regex contents blanked (same
 * line structure) plus the list of comments. Template expressions `${…}` stay code.
 */
export function splitScript(source: string, isTsx: boolean): { code: string; comments: SourceComment[] } {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, isTsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, source);
  const comments: SourceComment[] = [];
  const chars = source.split('');
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to; i++) if (chars[i] !== '\n') chars[i] = ' ';
  };
  // Brace depth inside each open template expression (innermost last).
  const templates: number[] = [];
  let previous = ts.SyntaxKind.Unknown;
  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    if (kind === ts.SyntaxKind.OpenBraceToken && templates.length > 0) {
      templates[templates.length - 1] = (templates[templates.length - 1] ?? 0) + 1;
    } else if (kind === ts.SyntaxKind.CloseBraceToken && templates.length > 0) {
      const depth = templates[templates.length - 1] ?? 0;
      if (depth === 0) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === ts.SyntaxKind.TemplateTail) templates.pop();
      } else templates[templates.length - 1] = depth - 1;
    } else if ((kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) && !EXPRESSION_END.has(previous)) {
      kind = scanner.reScanSlashToken();
    }
    const start = scanner.getTokenStart();
    const end = scanner.getTokenEnd();
    switch (kind) {
      case ts.SyntaxKind.SingleLineCommentTrivia:
      case ts.SyntaxKind.MultiLineCommentTrivia:
        comments.push({ pos: start, text: source.slice(start, end) });
        blank(start, end);
        break;
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateTail:
      case ts.SyntaxKind.RegularExpressionLiteral:
        blank(start + 1, end - 1);
        break;
      case ts.SyntaxKind.TemplateHead:
        blank(start + 1, end - 2);
        templates.push(0);
        break;
      case ts.SyntaxKind.TemplateMiddle:
        blank(start + 1, end - 2);
        break;
      default:
        break;
    }
    if (kind !== ts.SyntaxKind.WhitespaceTrivia && kind !== ts.SyntaxKind.NewLineTrivia && kind !== ts.SyntaxKind.SingleLineCommentTrivia && kind !== ts.SyntaxKind.MultiLineCommentTrivia) {
      previous = kind;
    }
    kind = scanner.scan();
  }
  return { code: chars.join(''), comments };
}

function lineOf(source: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

function commentBody(text: string): string {
  if (text.startsWith('//')) return text.slice(2).trim();
  return text.replace(/^\/\*+/, '').replace(/\*\/$/, '').trim();
}

/** Violations of an inline ESLint directive (`any` without Interop marker, protected or blanket disables). */
function checkDirective(body: string): Array<{ code: ViolationCode; token: string }> {
  const m = directivePattern.exec(body);
  if (!m) return [];
  const rest = m[1] ?? '';
  const sepIdx = rest.indexOf('--');
  const ruleList = (sepIdx >= 0 ? rest.slice(0, sepIdx) : rest).trim();
  const description = sepIdx >= 0 ? rest.slice(sepIdx + 2).trim() : '';
  if (ruleList.length === 0) return [{ code: 'protected-rule-disabled', token: '*' }];
  const out: Array<{ code: ViolationCode; token: string }> = [];
  for (const rule of ruleList.split(',').map((r) => r.trim())) {
    if (PROTECTED_RULES.includes(rule)) out.push({ code: 'protected-rule-disabled', token: rule });
    else if (rule === ANY_RULE && !interopPattern.test(description)) out.push({ code: 'any-without-interop', token: rule });
  }
  return out;
}

/**
 * Checks one file. `relPath` is relative to the project root (`/`-separated) and decides which
 * directory rules apply; `source` is the file content. Pure: no file system access.
 */
export function scanSource(relPath: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const lines = source.split('\n');
  const isScript = SCRIPT_EXT.test(relPath);
  const lineMarker = PLAIN_SOURCE_EXT.test(relPath) ? markerAll : markerAnywhere;
  lines.forEach((l, i) => {
    const m = lineMarker.exec(l);
    if (m?.[1]) violations.push({ file: relPath, line: i + 1, code: 'marker', token: m[1], text: l.trim() });
  });
  if (!isScript) return violations;
  scanScript(relPath, source, lines, violations);
  return violations.sort((a, b) => a.line - b.line);
}

function scanScript(relPath: string, source: string, lines: readonly string[], violations: Violation[]): void {
  const { code, comments } = splitScript(source, relPath.endsWith('.tsx'));
  for (const c of comments) {
    const line = lineOf(source, c.pos);
    const excerpt = c.text.trim().slice(0, 100);
    if (xxxMarker.test(c.text)) violations.push({ file: relPath, line, code: 'marker-comment', token: MARKERS.xxx, text: excerpt });
    for (const d of checkDirective(commentBody(c.text))) violations.push({ file: relPath, line, code: d.code, token: d.token, text: excerpt });
  }

  const inSim = SIM_DIRS.some((d) => relPath.startsWith(d));
  const noPerf = NO_PERF_DIRS.some((d) => relPath.startsWith(d));
  if (!inSim && !noPerf) return;
  code.split('\n').forEach((l, i) => {
    const text = (lines[i] ?? '').trim();
    if (inSim) for (const [re, vcode, token] of simBanned) if (re.test(l)) violations.push({ file: relPath, line: i + 1, code: vcode, token, text });
    if (noPerf && perfBanned[0].test(l)) violations.push({ file: relPath, line: i + 1, code: perfBanned[1], token: perfBanned[2], text });
  });
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries.sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXT.test(name)) out.push(full);
  }
}

/** Scans `dirs` below `root` (skipping `exclude` prefixes) and returns every violation. */
export function scanTree(opts: ScanOptions): ScanResult {
  const root = resolve(opts.root);
  const exclude = opts.exclude ?? [];
  const files: string[] = [];
  for (const d of opts.dirs ?? DEFAULT_SCAN_DIRS) walk(join(root, d), files);
  const violations: Violation[] = [];
  let count = 0;
  for (const full of files) {
    const rel = relative(root, full).split(sep).join('/');
    if (exclude.some((p) => rel.startsWith(p))) continue;
    count++;
    violations.push(...scanSource(rel, readFileSync(full, 'utf8')));
  }
  return { files: count, violations };
}

const RULE_TEXT: Readonly<Record<ViolationCode, (token: string) => string>> = {
  marker: (t) => `Marker ${t}`,
  'marker-comment': (t) => `Marker ${t} im Kommentar`,
  'sim-random': (t) => `${t} in der Simulation`,
  'sim-date-now': (t) => `${t} in der Simulation`,
  'sim-new-date': (t) => `${t} in der Simulation`,
  'sim-performance-now': (t) => `${t} in der Simulation`,
  'any-without-interop': () => 'any ohne „-- Interop: …“-Begründung',
  'protected-rule-disabled': (t) => (t === '*' ? 'pauschales eslint-disable' : `geschützte Regel ${t} abgeschaltet`),
};

/** Human-readable rule description for a violation. */
export function describeViolation(v: Violation): string {
  return RULE_TEXT[v.code](v.token);
}

export interface CliArgs {
  readonly root: string;
  readonly dirs: readonly string[];
  readonly exclude: readonly string[];
}

/** Parses `[--root <dir>] [dir …]`. Without `--root`, the default excludes apply. */
export function parseCliArgs(argv: readonly string[], cwd: string): CliArgs {
  let root: string | null = null;
  const dirs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--root') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error('--root erwartet ein Verzeichnis');
      root = resolve(cwd, value);
      i++;
    } else if (arg.startsWith('--')) throw new Error(`Unbekannte Option: ${arg}`);
    else dirs.push(arg);
  }
  return {
    root: root ?? cwd,
    dirs: dirs.length > 0 ? dirs : DEFAULT_SCAN_DIRS,
    exclude: root === null ? DEFAULT_EXCLUDES : [],
  };
}

/** CLI entry: prints the report and returns the exit code (0 clean, 1 violations, 2 usage error). */
export function main(argv: readonly string[], cwd: string): number {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv, cwd);
  } catch (e) {
    console.error(`Verbotsliste: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const result = scanTree(args);
  if (result.violations.length > 0) {
    console.error(`Verbotsliste: ${result.violations.length} Verstoß/Verstöße`);
    for (const v of result.violations) console.error(`  ${v.file}:${v.line}  [${describeViolation(v)}]  ${v.text}`);
    return 1;
  }
  console.log(`Verbotsliste: ${result.files} Dateien geprüft, keine Verstöße.`);
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), process.cwd());
}
