/**
 * M1-18/M1-19: the GLSL light model mirrors the canonical TypeScript model. The scalar functions of
 * `lighting.glsl` (falloff, cone), `composite.glsl` (light bands, dither threshold) and `post.glsl`
 * (tonemapping shoulder) are extracted from the shader sources, evaluated as JavaScript and compared
 * with `src/engine/lightFalloff.ts` / `src/render/light/banding.ts` / `passes/postPass.ts` on
 * sample points – a change on one side without the other fails here.
 */
import { describe, expect, it } from 'vitest';
import * as canonical from '../../../src/engine/lightFalloff';
import { bandingDefines, bandThreshold, bayerThreshold, BAYER_4X4, lightBandLevel } from '../../../src/render/light/banding';
import * as renderFalloff from '../../../src/render/light/falloff';
import { postDefines, tonemapWhite } from '../../../src/render/passes/postPass';
import { SHADERS } from '../../../src/render/shaderLib';

type ScalarFn = (...args: number[]) => number;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Turns a scalar GLSL function (`float name(float a, …) { … }`) into JavaScript: `#define`s are
 * substituted, `float` declarations become `let`, the builtins map to their JS equivalents. Anything
 * vector-valued is refused, so the test cannot silently evaluate something else than the shader.
 */
function glslFunction(file: string, name: string, defines: Readonly<Record<string, string>>): ScalarFn {
  const source = SHADERS[file];
  if (source === undefined) throw new Error(`Shader ${file} fehlt`);
  const m = new RegExp(`float\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (m === null) throw new Error(`${file}: Funktion ${name} nicht gefunden`);
  const params = (m[1] ?? '').split(',').map((p) => p.trim().replace(/^float\s+/, ''));
  let body = m[2] ?? '';
  for (const [k, v] of Object.entries(defines)) body = body.replaceAll(k, v);
  if (/\b(vec[234]|[iu]vec[234]|texelFetch|dot|normalize|mix|length)\b|DH_/.test(body)) throw new Error(`${file}: ${name} ist nicht skalar oder hat offene Defines:\n${body}`);
  body = body.replace(/\bfloat\s+/g, 'let ');
  const factory = new Function('max', 'min', 'clamp', 'floor', 'sqrt', 'smoothstep', `return function (${params.join(', ')}) {${body}};`) as (...helpers: unknown[]) => ScalarFn;
  return factory(Math.max, Math.min, clamp, Math.floor, Math.sqrt, canonical.smoothstep);
}

const lightingDefines = renderFalloff.lightingDefines();

describe('render light model = canonical model', () => {
  it('the renderer re-exports the canonical functions instead of re-implementing them', () => {
    expect(renderFalloff.lightFalloff).toBe(canonical.lightFalloff);
    expect(renderFalloff.lightCone).toBe(canonical.lightCone);
    expect(renderFalloff.lightConeOuter).toBe(canonical.lightConeOuter);
    expect(renderFalloff.lightConeInner).toBe(canonical.lightConeInner);
    expect(renderFalloff.lightFlicker).toBe(canonical.lightFlicker);
    expect(renderFalloff.lightLevelAt).toBe(canonical.lightLevelAt);
  });

  it('lighting.glsl lightFalloff equals the canonical falloff on sample points', () => {
    const glsl = glslFunction('lighting.glsl', 'lightFalloff', lightingDefines);
    for (const r of [0, 1, 16, 96, 224]) {
      for (let i = 0; i <= 64; i++) {
        const d = (i / 48) * Math.max(r, 1);
        expect(glsl(d, r), `d=${d} r=${r}`).toBeCloseTo(canonical.lightFalloff(d, r), 12);
      }
    }
  });

  it('lighting.glsl lightCone equals the canonical cone on sample points', () => {
    const glsl = glslFunction('lighting.glsl', 'lightCone', lightingDefines);
    for (const angle of [Math.PI / 6, Math.PI / 3, Math.PI, canonical.LIGHT_FULL_CIRCLE]) {
      const outer = canonical.lightConeOuter(angle);
      const inner = canonical.lightConeInner(angle);
      for (let i = 0; i <= 40; i++) {
        const cos = -1 + i / 20;
        expect(glsl(cos, outer, inner)).toBeCloseTo(canonical.lightCone(cos, outer, inner), 12);
      }
    }
  });

  it('the shading constants reach GLSL as floats', () => {
    for (const v of Object.values(lightingDefines)) expect(v).toMatch(/^-?\d+\.\d+$/);
    expect(lightingDefines['DH_LIGHT_FALLOFF_CORE']).toBe(canonical.LIGHT_FALLOFF_CORE.toFixed(1));
  });

  it('a flat surface is shaded exactly like the gameplay light map sees it; relief follows the light', () => {
    const l = [0.6, 0.48, 0.64];
    const len = Math.hypot(l[0] ?? 0, l[1] ?? 0, l[2] ?? 0);
    const [lx, ly, lz] = l.map((v) => v / len) as [number, number, number];
    expect(renderFalloff.lightShade(0, 0, 1, lx, ly, lz)).toBeCloseTo(1, 12);
    const s = Math.SQRT1_2;
    expect(renderFalloff.lightShade(s, 0, s, lx, ly, lz)).toBeGreaterThan(1);
    expect(renderFalloff.lightShade(-s, 0, s, lx, ly, lz)).toBeLessThan(1);
    expect(renderFalloff.lightShade(-1, 0, 0, 1, 0, 0)).toBe(0);
  });
});

describe('light bands and tonemapping mirror their GLSL', () => {
  const bandDefines = bandingDefines();

  it('composite.glsl lightBandLevel / bandThreshold equal banding.ts', () => {
    const level = glslFunction('composite.glsl', 'lightBandLevel', bandDefines);
    const threshold = glslFunction('composite.glsl', 'bandThreshold', bandDefines);
    for (const levels of [6, 8, 10]) {
      for (let i = 0; i <= 200; i++) {
        const peak = i / 80;
        for (const t of [0.03125, 0.5, 0.96875]) expect(level(peak, levels, t)).toBeCloseTo(lightBandLevel(peak, levels, t), 12);
      }
    }
    for (let b = 0; b < 16; b++) expect(threshold((b + 0.5) / 16)).toBeCloseTo(bandThreshold((b + 0.5) / 16), 12);
  });

  it('the Bayer matrix is the one of bayer.glsl, anchored to the world grid', () => {
    const m = /int\[16\]\(([^)]*)\)/.exec(SHADERS['bayer.glsl'] ?? '');
    expect(m?.[1]?.split(',').map((v) => Number(v.trim()))).toEqual(BAYER_4X4);
    expect(bayerThreshold(0, 0)).toBe(bayerThreshold(4, -8));
    expect(bayerThreshold(-1, -1)).toBe(bayerThreshold(3, 3));
  });

  it('post.glsl tonemapWhite equals postPass.ts', () => {
    const white = glslFunction('post.glsl', 'tonemapWhite', postDefines());
    for (let i = 0; i <= 100; i++) {
      const peak = i / 10;
      expect(white(peak)).toBeCloseTo(tonemapWhite(peak), 12);
    }
  });
});
