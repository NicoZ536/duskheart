/**
 * Evaluates a scalar GLSL function of the shader library in JavaScript (tests of the atmosphere and post
 * strand, like `falloff.test.ts`): the body of `float name(float …) { … }` with the `#define`s substituted,
 * run with Math helpers. Throws for vector code or open defines, so a test cannot silently compare
 * against a function it did not really evaluate.
 */
import { SHADERS } from '../../../src/render/shaderLib';

export type ScalarFn = (...args: number[]) => number;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function mix(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

function smoothstep(e0: number, e1: number, v: number): number {
  const t = clamp((v - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function step(edge: number, v: number): number {
  return v < edge ? 0 : 1;
}

function fract(v: number): number {
  return v - Math.floor(v);
}

export function glslScalar(file: string, name: string, defines: Readonly<Record<string, string>> = {}): ScalarFn {
  const source = SHADERS[file];
  if (source === undefined) throw new Error(`Shader ${file} fehlt`);
  const m = new RegExp(`float\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (m === null) throw new Error(`${file}: Funktion ${name} nicht gefunden`);
  const params = (m[1] ?? '')
    .split(',')
    .map((p) => p.trim().replace(/^float\s+/, ''))
    .filter((p) => p.length > 0);
  let body = m[2] ?? '';
  for (const [k, v] of Object.entries(defines)) body = body.replace(new RegExp(`\\b${k}\\b`, 'g'), v);
  if (/\b(vec[234]|[iu]vec[234]|texelFetch|texture|dot|normalize|length)\b|DH_/.test(body)) throw new Error(`${file}: ${name} ist nicht skalar oder hat offene Defines:\n${body}`);
  body = body.replace(/\bfloat\s+/g, 'let ');
  const factory = new Function('max', 'min', 'clamp', 'floor', 'sqrt', 'smoothstep', 'mix', 'sin', 'cos', 'abs', 'exp', 'pow', 'step', 'fract', 'sign', `return function (${params.join(', ')}) {${body}};`) as (...helpers: unknown[]) => ScalarFn;
  return factory(Math.max, Math.min, clamp, Math.floor, Math.sqrt, smoothstep, mix, Math.sin, Math.cos, Math.abs, Math.exp, Math.pow, step, fract, Math.sign);
}
