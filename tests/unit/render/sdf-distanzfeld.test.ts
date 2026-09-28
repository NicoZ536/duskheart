/**
 * M5-01: Occluder-Maske → Jump-Flood → Distanzfeld (MASTERPROMPT §6.1 Pass 3). Geprüft an den CPU-Spiegeln der
 * Shader (`src/render/light/lightMath.ts`): die Schrittfolge der Flutung, die 16-Bit-Kodierung der Saatpunkte in
 * RGBA8, die Saat (Wände, Deko über dem Gelände, Kanten erhöhter Stufen – nicht ihr Inneres), die Distanzen der
 * Flutung gegen eine Brute-Force-Suche, die Kappe jenseits der Reichweite und der Bodenpunkt eines Pixels auf einer
 * erhöhten Stufe. Dazu, dass die Shader dieselben Konstanten und Anweisungen tragen.
 */
import { describe, expect, it } from 'vitest';
import { GBUFFER_HEIGHT_RANGE_PX } from '../../../src/render/gbuffer';
import { OccluderField, jfaDecode, jfaEncode, jumpFlood, maskHeight } from '../../../src/render/light/lightMath';
import { OccluderList } from '../../../src/render/light/occluders';
import { lightStrandDefines, OCCLUDER_CLASS, SDF, STRUCTURAL_TOP_PX } from '../../../src/render/light/params';
import { jumpFloodSteps } from '../../../src/render/passes/occluderPass';
import { SHADERS } from '../../../src/render/shaderLib';

/** Deterministic pseudo-random numbers (xorshift) for the seed fields. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/** Exact distance of every texel to its nearest seed (brute force), capped like the field. */
function bruteForce(seeds: Int32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h).fill(SDF.maxDistancePx);
  const list: number[] = [];
  for (let k = 0; k < seeds.length; k++) if ((seeds[k] ?? -1) >= 0) list.push(k);
  for (let k = 0; k < w * h; k++) {
    let best = Number.POSITIVE_INFINITY;
    for (const s of list) best = Math.min(best, Math.hypot((s % w) - (k % w), Math.floor(s / w) - Math.floor(k / w)));
    out[k] = Math.min(best, SDF.maxDistancePx);
  }
  return out;
}

describe('Jump-Flood: Schritte und Kodierung', () => {
  it('flutet von der ersten Schrittweite in Halbierungen bis 1', () => {
    expect(jumpFloodSteps(SDF.firstStepPx)).toEqual([32, 16, 8, 4, 2, 1]);
    expect(jumpFloodSteps(1)).toEqual([1]);
    expect(jumpFloodSteps(5)).toEqual([5, 2, 1]);
    // Reach of the flood (2 · first − 1) covers the cap the field writes beyond it.
    expect(2 * SDF.firstStepPx - 1).toBeGreaterThanOrEqual(SDF.maxDistancePx);
  });

  it('kodiert 16-Bit-Texelkoordinaten verlustfrei in RGBA8, 0xFFFF ist „kein Saatpunkt“', () => {
    for (const [x, y] of [
      [0, 0],
      [255, 256],
      [1983, 1143],
      [4095, 17],
    ] as const) {
      const e = jfaEncode(x, y);
      for (const b of e) expect(b >= 0 && b <= 255 && Number.isInteger(b)).toBe(true);
      expect(jfaDecode(e)).toEqual([x, y]);
    }
    expect(jfaDecode([255, 255, 255, 255])).toBeNull();
    // The GLSL side: the same byte order (x high, x low, y high, y low) and the same "none".
    const src = SHADERS['jfa.glsl'] ?? '';
    expect(src).toContain('return vec4(hi.x, lo.x, hi.y, lo.y) / 255.0;');
    expect(src).toContain('const float JFA_NONE = 65535.0;');
  });
});

describe('Jump-Flood: Distanzen', () => {
  it('trifft auf zufälligen Saatfeldern die exakte Distanz (höchstens 1 px daneben, fast überall exakt)', () => {
    const w = 96;
    const h = 64;
    const next = rng(7);
    for (const density of [0.002, 0.01, 0.05]) {
      const seeds = new Int32Array(w * h).fill(-1);
      for (let k = 0; k < w * h; k++) if (next() < density) seeds[k] = k;
      const flooded = jumpFlood(seeds, w, h, jumpFloodSteps(SDF.firstStepPx));
      const exact = bruteForce(seeds, w, h);
      let wrong = 0;
      // Every texel checked; the violations are collected and asserted once (one expect per texel was the test's cost).
      const violations: string[] = [];
      for (let k = 0; k < w * h; k++) {
        const s = flooded[k] ?? -1;
        const d = s < 0 ? SDF.maxDistancePx : Math.min(Math.hypot((s % w) - (k % w), Math.floor(s / w) - Math.floor(k / w)), SDF.maxDistancePx);
        const e = exact[k] ?? 0;
        if (d < e - 1e-6 || d - e > 1) violations.push(`Dichte ${density}, Texel ${k}: ${d} statt ${e}`);
        if (d - e > 1e-6) wrong++;
      }
      expect(violations).toEqual([]);
      expect(wrong / (w * h)).toBeLessThan(0.01);
    }
  });

  it('jenseits der Reichweite bleibt die Kappe, ohne Saat überall', () => {
    const w = 200;
    const seeds = new Int32Array(w).fill(-1);
    seeds[0] = 0;
    const flooded = jumpFlood(seeds, w, 1, jumpFloodSteps(SDF.firstStepPx));
    // Reached up to 2 · 32 − 1 texels away, not beyond.
    expect(flooded[63]).toBe(0);
    expect(flooded[64]).toBe(-1);
    const f = new OccluderField(0, 0, 40, 40);
    f.flood(jumpFloodSteps(SDF.firstStepPx));
    for (let k = 0; k < 40 * 40; k++) expect(f.distance[k]).toBe(SDF.maxDistancePx);
  });
});

describe('Occluder-Maske und Saat', () => {
  it('Wand = strukturell, Stamm = Deko mit Höhe, erhöhte Stufe = Gelände; Höhen in 8 Bit gerundet', () => {
    const list = new OccluderList();
    list.rect(10, 10, 20, 12, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
    list.push(1, 40, 20, 2, 1.5, 37, OCCLUDER_CLASS.decor);
    list.rect(0, 30, 64, 48, 16, OCCLUDER_CLASS.terrain, true, 16);
    const f = new OccluderField(0, 0, 64, 48);
    f.draw(list);
    expect(f.maskAt(12, 11)).toEqual({ decor: 0, structural: true, terrain: 0, ground: 0 });
    expect(f.maskAt(40, 20).decor).toBeCloseTo(maskHeight(37), 4);
    expect(Math.abs(maskHeight(37) - 37)).toBeLessThanOrEqual(GBUFFER_HEIGHT_RANGE_PX / 255 / 2 + 1e-9);
    const plateau = f.maskAt(5, 40);
    expect([plateau.decor, plateau.structural]).toEqual([0, false]);
    expect(plateau.terrain).toBeCloseTo(maskHeight(16), 4);
    expect(plateau.ground).toBeCloseTo(maskHeight(16), 4);
    // Outside every footprint: nothing.
    expect(f.maskAt(30, 5)).toEqual({ decor: 0, structural: false, terrain: 0, ground: 0 });
  });

  it('eine erhöhte Stufe sät nur an ihrem Rand, ihr Inneres wird über den Rand erreicht', () => {
    const list = new OccluderList();
    list.rect(16, 16, 48, 48, 16, OCCLUDER_CLASS.terrain, true, 16);
    const f = new OccluderField(0, 0, 64, 64);
    f.draw(list);
    expect(f.isSeed(16, 30)).toBe(true);
    expect(f.isSeed(47, 30)).toBe(true);
    expect(f.isSeed(30, 16)).toBe(true);
    expect(f.isSeed(30, 30)).toBe(false);
    expect(f.isSeed(8, 30)).toBe(false);
    f.flood(jumpFloodSteps(SDF.firstStepPx));
    // Inside: distance to the rim; outside: distance to the rim from the other side.
    expect(f.distanceAt(30, 30)).toBe(14);
    expect(f.distanceAt(8, 30)).toBe(8);
    expect(f.infoAt(8, 30).terrain).toBeCloseTo(maskHeight(16), 4);
  });

  it('der Bodenpunkt eines Pixels steht um seine Höhe über dem Boden südlich – auf einer Stufe über deren Boden', () => {
    const list = new OccluderList();
    list.rect(0, 0, 64, 32, 16, OCCLUDER_CLASS.terrain, true, 16);
    const f = new OccluderField(0, 0, 64, 64);
    f.draw(list);
    // On the plateau: a pixel of its ground (height 16, 8-bit like the G-buffer's) stays where it is drawn; a sprite
    // pixel 10 px above that ground stands 10 px further south.
    const level = maskHeight(16);
    const at = (x: number, y: number, z: number): number[] => f.groundPoint(x, y, z).map((v) => Math.round(v * 1000) / 1000);
    expect(at(20, 10.5, level)).toEqual([20, 10.5]);
    expect(at(20, 10.5, level + 10)).toEqual([20, 20.5]);
    // Below the plateau: heights count from level 0.
    expect(at(20, 40.5, 6)).toEqual([20, 46.5]);
  });
});

describe('Shader und CPU-Spiegel teilen Konstanten und Anweisungen', () => {
  it('die Defines tragen die Tabelle params.ts', () => {
    const d = lightStrandDefines();
    expect(d['DH_SDF_MARGIN']).toBe(SDF.marginPx.toFixed(1));
    expect(d['DH_SDF_MAX_DISTANCE']).toBe(SDF.maxDistancePx.toFixed(1));
    expect(d['DH_OCC_STRUCTURAL']).toBe(OCCLUDER_CLASS.structural.toFixed(1));
    expect(d['DH_STRUCTURAL_TOP']).toBe(STRUCTURAL_TOP_PX.toFixed(1));
  });

  it('Saat, Flutschritt und Auflösung stimmen mit dem Spiegel überein', () => {
    const seed = (SHADERS['jfa_seed.frag'] ?? '').replace(/\s+/g, ' ');
    expect(seed).toContain('bool seed = m.g > 0.5 || m.r > m.b + eps || m.b > lowest + eps;');
    const step = (SHADERS['jfa_step.frag'] ?? '').replace(/\s+/g, ' ');
    expect(step).toContain('ivec2 q = p + ivec2(x, y) * uStep;');
    expect(step).toContain('if (dd < d) {');
    const resolve = (SHADERS['sdf_resolve.frag'] ?? '').replace(/\s+/g, ' ');
    expect(resolve).toContain('float d = found ? min(length(s - pf), DH_SDF_MAX_DISTANCE) : DH_SDF_MAX_DISTANCE;');
    expect(resolve).toContain('oInfo = found ? texelFetch(uMask, ivec2(s), 0) : vec4(0.0);');
  });
});
