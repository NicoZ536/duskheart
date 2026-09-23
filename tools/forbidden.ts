/**
 * Verbotsliste (MASTERPROMPT §2.1, §2.6, §3.4 `check`).
 * - Marker TODO/FIXME/HACK in Quelltext (überall), XXX in Kommentaren (Sprite-Raster dürfen X-Folgen enthalten).
 * - Math.random / Date.now / new Date( in der Simulation (src/engine, src/world, src/game, src/content).
 * - performance.now in src/world, src/game, src/content (Zeit kommt nur über den Loop).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'tools', 'tests', 'assets-src'];
const EXT = /\.(ts|tsx|js|mjs|glsl|json|css|html)$/;
const SKIP_DIRS = new Set(['node_modules', 'generated', 'out']);
const SIM_DIRS = ['src/engine/', 'src/world/', 'src/game/', 'src/content/'];
const NO_PERF_DIRS = ['src/world/', 'src/game/', 'src/content/'];
const SELF = 'tools/forbidden.ts';

// Built from parts so this file does not flag itself.
const M_TODO = 'TO' + 'DO';
const M_FIXME = 'FIX' + 'ME';
const M_HACK = 'HA' + 'CK';
const M_XXX = 'X' + 'XX';
const markerAnywhere = new RegExp(`\\b(${M_TODO}|${M_FIXME}|${M_HACK})\\b`);
const markerComment = new RegExp(`\\b(${M_TODO}|${M_FIXME}|${M_HACK}|${M_XXX})\\b`);
const simBanned: Array<[RegExp, string]> = [
  [/\bMath\.random\s*\(/, 'Math.random'],
  [/\bDate\.now\s*\(/, 'Date.now'],
  [/\bnew\s+Date\s*\(/, 'new Date('],
];
const perfBanned: Array<[RegExp, string]> = [[/\bperformance\.now\s*\(/, 'performance.now']];

interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXT.test(name)) out.push(full);
  }
}

/** Returns code with comments and string contents blanked (same line structure) plus the list of comments. */
function splitTs(source: string, isTsx: boolean): { code: string; comments: Array<{ pos: number; text: string }> } {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, isTsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, source);
  const comments: Array<{ pos: number; text: string }> = [];
  const chars = source.split('');
  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    const start = scanner.getTokenStart();
    const end = scanner.getTokenEnd();
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      comments.push({ pos: start, text: source.slice(start, end) });
      for (let i = start; i < end; i++) if (chars[i] !== '\n') chars[i] = ' ';
    } else if (kind === ts.SyntaxKind.StringLiteral || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral || kind === ts.SyntaxKind.TemplateHead || kind === ts.SyntaxKind.TemplateMiddle || kind === ts.SyntaxKind.TemplateTail) {
      for (let i = start + 1; i < end - 1; i++) if (chars[i] !== '\n') chars[i] = ' ';
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

const files: string[] = [];
for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
const violations: Violation[] = [];

for (const full of files) {
  const rel = relative(ROOT, full).split(sep).join('/');
  if (rel === SELF) continue;
  const source = readFileSync(full, 'utf8');
  const isTs = /\.(ts|tsx|js|mjs)$/.test(rel);
  const lines = source.split('\n');
  lines.forEach((l, i) => {
    const m = markerAnywhere.exec(l);
    if (m) violations.push({ file: rel, line: i + 1, rule: `Marker ${m[1]}`, text: l.trim() });
  });
  if (!isTs) continue;
  const { code, comments } = splitTs(source, rel.endsWith('.tsx'));
  for (const c of comments) {
    const m = markerComment.exec(c.text);
    if (m && m[1] === M_XXX) violations.push({ file: rel, line: lineOf(source, c.pos), rule: `Marker ${m[1]} im Kommentar`, text: c.text.slice(0, 80) });
  }
  const inSim = SIM_DIRS.some((d) => rel.startsWith(d));
  const noPerf = NO_PERF_DIRS.some((d) => rel.startsWith(d));
  if (!inSim && !noPerf) continue;
  code.split('\n').forEach((l, i) => {
    if (inSim) for (const [re, name] of simBanned) if (re.test(l)) violations.push({ file: rel, line: i + 1, rule: `${name} in der Simulation`, text: (lines[i] ?? '').trim() });
    if (noPerf) for (const [re, name] of perfBanned) if (re.test(l)) violations.push({ file: rel, line: i + 1, rule: `${name} in der Simulation`, text: (lines[i] ?? '').trim() });
  });
}

if (violations.length > 0) {
  console.error(`Verbotsliste: ${violations.length} Verstoß/Verstöße`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.text}`);
  process.exit(1);
}
console.log(`Verbotsliste: ${files.length} Dateien geprüft, keine Verstöße.`);
