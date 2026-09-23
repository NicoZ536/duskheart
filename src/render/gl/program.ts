/**
 * GLSL preprocessing and compilation (MASTERPROMPT §6.3 "Shader in `.glsl`-Dateien mit `#include`"):
 * `#include "datei.glsl"` is resolved recursively (cycle-safe), global `#define`s are inserted after
 * `#version`, and every line of the final source remembers its file and line, so compiler errors
 * point at `datei.glsl:17` instead of a line of the concatenated source.
 */

/** Origin of one line of preprocessed GLSL. */
export interface SourceLine {
  readonly file: string;
  readonly line: number;
}

/** One compiler/linker message, mapped back to its source file. */
export interface ShaderDiagnostic {
  readonly file: string;
  /** 1-based line in `file`; 0 when the driver did not name a line. */
  readonly line: number;
  readonly message: string;
  /** The offending source line (trimmed), empty when unknown. */
  readonly code: string;
}

export class ShaderError extends Error {
  override readonly name = 'ShaderError';
  constructor(
    readonly shaderName: string,
    readonly log: string,
    /** Final source with line numbers (for the console). */
    readonly source: string,
    readonly diagnostics: readonly ShaderDiagnostic[] = [],
  ) {
    super(`Shader „${shaderName}“: ${diagnostics.length > 0 ? diagnostics.map((d) => `${d.file}:${d.line}: ${d.message}`).join(' · ') : log}`);
  }
}

const INCLUDE_RE = /^[ \t]*#include\s+"([^"]+)"[ \t]*$/;
/** Deepest `#include` nesting accepted (guards against runaway recursion). */
export const MAX_INCLUDE_DEPTH = 8;
/** Pseudo file name of the injected `#define` lines. */
export const DEFINES_FILE = '<defines>';

export interface Preprocessed {
  readonly code: string;
  readonly lines: readonly SourceLine[];
  /** Every file that contributed (the entry file and all includes) – for hot-reload invalidation. */
  readonly files: ReadonlySet<string>;
}

type ChunkLookup = (name: string) => string | undefined;

function lookupOf(chunks: Readonly<Record<string, string>> | ChunkLookup): ChunkLookup {
  return typeof chunks === 'function' ? chunks : (name) => chunks[name];
}

function expand(file: string, source: string, lookup: ChunkLookup, stack: readonly string[], outCode: string[], outLines: SourceLine[], files: Set<string>): void {
  if (stack.length > MAX_INCLUDE_DEPTH) throw new Error(`GLSL #include: zu tief verschachtelt (${stack.join(' → ')})`);
  files.add(file);
  const lines = source.split('\n');
  lines.forEach((text, i) => {
    const m = INCLUDE_RE.exec(text);
    if (m === null) {
      outCode.push(text);
      outLines.push({ file, line: i + 1 });
      return;
    }
    const name = m[1] ?? '';
    if (stack.includes(name)) throw new Error(`GLSL #include: Zyklus ${[...stack, name].join(' → ')} (${file}:${i + 1})`);
    const chunk = lookup(name);
    if (chunk === undefined) throw new Error(`GLSL #include: ${name} nicht gefunden (${file}:${i + 1})`);
    expand(name, chunk, lookup, [...stack, name], outCode, outLines, files);
  });
}

/**
 * Resolves includes of `source` (named `file`) and inserts `defines` right after the `#version`
 * line. Throws on unknown includes, cycles and too deep nesting.
 */
export function preprocess(file: string, source: string, chunks: Readonly<Record<string, string>> | ChunkLookup, defines: Readonly<Record<string, string>> = {}): Preprocessed {
  const code: string[] = [];
  const lines: SourceLine[] = [];
  const files = new Set<string>();
  expand(file, source, lookupOf(chunks), [file], code, lines, files);
  const defineLines = Object.entries(defines).map(([k, v]) => `#define ${k} ${v}`);
  if (defineLines.length > 0) {
    const versionAt = code.findIndex((l) => l.trimStart().startsWith('#version'));
    const at = versionAt + 1;
    code.splice(at, 0, ...defineLines);
    lines.splice(at, 0, ...defineLines.map((_, i) => ({ file: DEFINES_FILE, line: i + 1 })));
  }
  return { code: code.join('\n'), lines, files };
}

/** Resolve `#include "name.glsl"` directives against a chunk library (recursive, cycle-safe). */
export function resolveIncludes(source: string, chunks: Readonly<Record<string, string>>, file = '<shader>'): string {
  return preprocess(file, source, chunks).code;
}

/** Width of the line-number column in printed shader sources and error excerpts. */
export const LINE_NUMBER_WIDTH = 4;

export function withLineNumbers(src: string): string {
  return src
    .split('\n')
    .map((l, i) => `${String(i + 1).padStart(LINE_NUMBER_WIDTH, ' ')}  ${l}`)
    .join('\n');
}

/** `ERROR: 0:12: 'x' : undeclared identifier` (ANGLE, Mesa) and `0(12) : error …` (some drivers). */
const LOG_LINE_RES = [/^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/, /^\d+\((\d+)\)\s*:\s*(.*)$/];

/**
 * Maps a compiler log to diagnostics in the original files. Lines without a location become a
 * diagnostic of the entry file with line 0.
 */
export function parseShaderLog(log: string, pre: Pick<Preprocessed, 'code' | 'lines'>, entryFile: string): ShaderDiagnostic[] {
  const codeLines = pre.code.split('\n');
  const out: ShaderDiagnostic[] = [];
  for (const raw of log.split('\n')) {
    const text = raw.replace(/\0/g, '').trim();
    if (text === '') continue;
    let matched = false;
    for (const re of LOG_LINE_RES) {
      const m = re.exec(text);
      if (m === null) continue;
      const finalLine = Number(m[1]);
      const origin = pre.lines[finalLine - 1];
      out.push({
        file: origin?.file ?? entryFile,
        line: origin?.line ?? finalLine,
        message: (m[2] ?? '').trim(),
        code: (codeLines[finalLine - 1] ?? '').trim(),
      });
      matched = true;
      break;
    }
    if (!matched) out.push({ file: entryFile, line: 0, message: text, code: '' });
  }
  return out;
}

export interface CompiledProgram {
  readonly handle: WebGLProgram;
  readonly files: ReadonlySet<string>;
}

export interface ProgramSources {
  readonly name: string;
  readonly vertexFile: string;
  readonly fragmentFile: string;
  /** Looks up a source file by name (entry files and includes). */
  readonly lookup: ChunkLookup;
  readonly defines?: Readonly<Record<string, string>>;
}

function compileStage(gl: WebGL2RenderingContext, type: number, file: string, pre: Preprocessed, programName: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new ShaderError(programName, 'createShader fehlgeschlagen', '');
  gl.shaderSource(sh, pre.code);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(sh) ?? 'unbekannter Fehler';
    gl.deleteShader(sh);
    throw new ShaderError(programName, log, withLineNumbers(pre.code), parseShaderLog(log, pre, file));
  }
  return sh;
}

function sourceOf(lookup: ChunkLookup, file: string, programName: string): string {
  const src = lookup(file);
  if (src === undefined) throw new ShaderError(programName, `Quelldatei ${file} fehlt`, '', [{ file, line: 0, message: 'Quelldatei fehlt', code: '' }]);
  return src;
}

function preprocessOrThrow(file: string, lookup: ChunkLookup, defines: Readonly<Record<string, string>>, programName: string): Preprocessed {
  try {
    return preprocess(file, sourceOf(lookup, file, programName), lookup, defines);
  } catch (e) {
    if (e instanceof ShaderError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new ShaderError(programName, message, '', [{ file, line: 0, message, code: '' }]);
  }
}

/** Compiles and links a program. Throws `ShaderError` (with mapped diagnostics) on failure. */
export function compileProgram(gl: WebGL2RenderingContext, src: ProgramSources): CompiledProgram {
  const defines = src.defines ?? {};
  const vPre = preprocessOrThrow(src.vertexFile, src.lookup, defines, src.name);
  const fPre = preprocessOrThrow(src.fragmentFile, src.lookup, defines, src.name);
  const vs = compileStage(gl, gl.VERTEX_SHADER, src.vertexFile, vPre, src.name);
  let fs: WebGLShader;
  try {
    fs = compileStage(gl, gl.FRAGMENT_SHADER, src.fragmentFile, fPre, src.name);
  } catch (e) {
    gl.deleteShader(vs);
    throw e;
  }
  const prog = gl.createProgram();
  if (!prog) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new ShaderError(src.name, 'createProgram fehlgeschlagen', '');
  }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(prog) ?? 'unbekannter Fehler';
    gl.deleteProgram(prog);
    throw new ShaderError(src.name, log, '', [{ file: `${src.vertexFile} + ${src.fragmentFile}`, line: 0, message: log.trim(), code: '' }]);
  }
  return { handle: prog, files: new Set([...vPre.files, ...fPre.files]) };
}
