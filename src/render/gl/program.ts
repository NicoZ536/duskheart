/** Shader compilation with `#include` resolution and readable, line-numbered errors (§6.3). */

export class ShaderError extends Error {
  constructor(
    readonly shaderName: string,
    readonly log: string,
    readonly source: string,
  ) {
    super(`Shader „${shaderName}“: ${log}`);
    this.name = 'ShaderError';
  }
}

const INCLUDE_RE = /^[ \t]*#include\s+"([^"]+)"[ \t]*$/gm;
const MAX_INCLUDE_DEPTH = 8;

/** Resolve `#include "name.glsl"` directives against a chunk library (recursive, cycle-safe). */
export function resolveIncludes(source: string, chunks: Readonly<Record<string, string>>, depth = 0, seen: ReadonlySet<string> = new Set()): string {
  if (depth > MAX_INCLUDE_DEPTH) throw new Error('GLSL #include: zu tief verschachtelt');
  return source.replace(INCLUDE_RE, (_m, name: string) => {
    if (seen.has(name)) throw new Error(`GLSL #include: Zyklus bei ${name}`);
    const chunk = chunks[name];
    if (chunk === undefined) throw new Error(`GLSL #include: ${name} nicht gefunden`);
    return resolveIncludes(chunk, chunks, depth + 1, new Set([...seen, name]));
  });
}

function compile(gl: WebGL2RenderingContext, type: number, source: string, name: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new ShaderError(name, 'createShader fehlgeschlagen', source);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(sh) ?? 'unbekannter Fehler';
    gl.deleteShader(sh);
    throw new ShaderError(name, log, withLineNumbers(source));
  }
  return sh;
}

export function withLineNumbers(src: string): string {
  return src
    .split('\n')
    .map((l, i) => `${String(i + 1).padStart(4, ' ')}  ${l}`)
    .join('\n');
}

export interface Program {
  readonly name: string;
  readonly handle: WebGLProgram;
  uniform(name: string): WebGLUniformLocation | null;
}

export function createProgram(gl: WebGL2RenderingContext, name: string, vertexSrc: string, fragmentSrc: string, chunks: Readonly<Record<string, string>> = {}): Program {
  const vs = compile(gl, gl.VERTEX_SHADER, resolveIncludes(vertexSrc, chunks), `${name}.vert`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, resolveIncludes(fragmentSrc, chunks), `${name}.frag`);
  const prog = gl.createProgram();
  if (!prog) throw new ShaderError(name, 'createProgram fehlgeschlagen', '');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(prog) ?? 'unbekannter Fehler';
    gl.deleteProgram(prog);
    throw new ShaderError(name, log, '');
  }
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    name,
    handle: prog,
    uniform(u: string) {
      let loc = cache.get(u);
      if (loc === undefined) {
        loc = gl.getUniformLocation(prog, u);
        cache.set(u, loc);
      }
      return loc;
    },
  };
}
