/**
 * M7-81 (MASTERPROMPT §6.1 Pass 9 „Color-Grading über 3D-LUTs … aus Parametern generiert“, §30 „keine Allokationen in
 * Hot-Loops“): the LUT build that the post pass runs whenever the blended grade moves.
 *
 * - Every texel is `gradeColor` of its node, bit for bit – the build evaluates the channel-wise part of the grade once per node
 *   of an axis (per-channel curves) and mixes the channels per texel with the same expressions.
 * - Once optimised a build allocates nothing (sampled heap profile, median of three windows after re-warming, ADR-0203): a
 *   fractional number boxed per texel would be 64 KB a build.
 * - The post pass uploads a new LUT only when a texel byte changed: a grade that moved only in what the LUT does not hold
 *   (the vignette) builds and compares, but uploads nothing.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { createGrading, daltonize, generateGradingLut, gradeColor, GRADING_INDEX, GRADING_KEYS, GRADING_LUT_BYTES, GRADING_LUT_SIZE, type ColorblindMode } from '../../../src/render/post/grading';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { createFakeGl } from './fakeGl';

/** A grade with every kind of term: white balance, exposure, lift/gamma/gain per channel, contrast, saturation, split toning. */
function fullGrade(k: number): Float32Array {
  const p = createGrading();
  const I = GRADING_INDEX;
  p[I.temperature] = 0.35 - 0.1 * k;
  p[I.tint] = -0.2 + 0.05 * k;
  p[I.exposure] = 0.3 - 0.2 * k;
  p[I.contrast] = 1.15 - 0.1 * k;
  p[I.saturation] = 0.8 + 0.15 * k;
  p[I.liftR] = 0.03;
  p[I.liftB] = 0.06 * k;
  p[I.gammaR] = 0.9;
  p[I.gammaG] = 1.1;
  p[I.gainB] = 1.08;
  p[I.shadowR] = 0.05;
  p[I.shadowB] = 0.25;
  p[I.shadowAmount] = 0.4;
  p[I.highlightR] = 0.3;
  p[I.highlightG] = 0.2;
  p[I.highlightAmount] = 0.3 * k;
  return p;
}

/** Seeded variations of every parameter around the neutral grade (a fixed list: the check is the same every run). */
function variedGrades(count: number): Float32Array[] {
  let s = 0x2545f491;
  const next = (): number => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
  const grades: Float32Array[] = [];
  for (let n = 0; n < count; n++) {
    const p = createGrading();
    for (const key of GRADING_KEYS) if (next() < 0.6) p[GRADING_INDEX[key]] = (p[GRADING_INDEX[key]] as number) + (next() - 0.5) * 0.7;
    if (next() < 0.25) p[GRADING_INDEX.saturation] = 1;
    if (next() < 0.25) p[GRADING_INDEX.contrast] = 1;
    grades.push(p);
  }
  return grades;
}

/** The LUT texel by texel through `gradeColor` (and `daltonize`): the definition the build must match. */
function referenceLut(p: Float32Array, size: number, mode: ColorblindMode): Uint8Array {
  const out = new Uint8Array(size * size * size * 4);
  const c: [number, number, number] = [0, 0, 0];
  const step = 1 / (size - 1);
  let o = 0;
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        gradeColor(x * step, y * step, z * step, p, c);
        if (mode !== 'none') daltonize(mode, c[0], c[1], c[2], c);
        out[o] = Math.round(c[0] * 255);
        out[o + 1] = Math.round(c[1] * 255);
        out[o + 2] = Math.round(c[2] * 255);
        out[o + 3] = 255;
        o += 4;
      }
  return out;
}

describe('Grading-LUT: Bau (M7-81)', () => {
  it('jeder Texel ist gradeColor seines Knotens, bitgleich – alle Terme, Farbenblind-Modi, andere Kantenlängen', () => {
    const cases: Array<[Float32Array, number, ColorblindMode]> = [
      [fullGrade(0), GRADING_LUT_SIZE, 'none'],
      [fullGrade(1), GRADING_LUT_SIZE, 'none'],
      [fullGrade(0.5), GRADING_LUT_SIZE, 'deuteranopia'],
      [fullGrade(1), 9, 'protanopia'],
      [fullGrade(0), 2, 'tritanopia'],
      ...variedGrades(12).map((p, i): [Float32Array, number, ColorblindMode] => [p, i % 3 === 0 ? 9 : GRADING_LUT_SIZE, 'none']),
    ];
    for (const [p, size, mode] of cases) {
      const built = generateGradingLut(p, new Uint8Array(size * size * size * 4), size, mode);
      expect(built).toEqual(referenceLut(p, size, mode));
    }
    // A larger LUT after the default one grows the per-channel curves (the default size keeps working afterwards).
    const big = fullGrade(0.25);
    expect(generateGradingLut(big, new Uint8Array(20 ** 3 * 4), 20)).toEqual(referenceLut(big, 20, 'none'));
    expect(generateGradingLut(big, new Uint8Array(GRADING_LUT_BYTES))).toEqual(referenceLut(big, GRADING_LUT_SIZE, 'none'));
  });
});

describe('Grading-LUT: Bau ohne Allokation (M7-81)', () => {
  let inspector: Session;
  beforeAll(async () => {
    inspector = new Session();
    inspector.connect();
    await inspector.post('HeapProfiler.enable');
  });
  afterAll(() => inspector.disconnect());

  /** Builds per window, the re-warm after the forced collection, install builds after the compiler pause. */
  const WINDOW_BUILDS = 30;
  const REWARM_BUILDS = 40;
  const INSTALL_BUILDS = 5;
  const COMPILER_PAUSE_MS = 100;
  const WINDOWS = 3;
  /** Limit [B per build]: one number boxed per texel would be 4096 · 16 B = 64 KB a build. */
  const MAX_BYTES_PER_BUILD = 256;

  it('ein Bau legt nichts an (Median dreier Fenster)', async () => {
    const out = new Uint8Array(GRADING_LUT_BYTES);
    const grades = [fullGrade(0), fullGrade(0.5), fullGrade(1)];
    /** The measured builds: a moving grade, as the blended grade of the game moves. */
    function lutBuilds(n: number): void {
      for (let i = 0; i < n; i++) generateGradingLut(grades[i % grades.length] as Float32Array, out, GRADING_LUT_SIZE);
    }
    const perBuild: number[] = [];
    const tops: string[] = [];
    for (let k = 0; k < WINDOWS; k++) {
      await inspector.post('HeapProfiler.collectGarbage');
      lutBuilds(REWARM_BUILDS);
      await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
      lutBuilds(INSTALL_BUILDS);
      await inspector.post('HeapProfiler.startSampling', { samplingInterval: 16, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      lutBuilds(WINDOW_BUILDS);
      const profile = heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
      const alloc = pathAllocation(profile, (f) => f.functionName === 'lutBuilds');
      perBuild.push(alloc.inPath / WINDOW_BUILDS);
      tops.push(JSON.stringify(alloc.top));
    }
    const median = [...perBuild].sort((a, b) => a - b)[Math.floor(WINDOWS / 2)] as number;
    expect(median, `Allokation je LUT-Bau (Fenster ${perBuild.map((b) => b.toFixed(0)).join(' / ')}): ${tops.join(' | ')}`).toBeLessThan(MAX_BYTES_PER_BUILD);
  });
});

describe('Grading-LUT: Hochladen nur bei geändertem Byte (M7-81)', () => {
  it('eine Vignetten-Änderung baut die LUT, lädt sie aber nicht hoch; eine Farbänderung lädt sie hoch', () => {
    const fake = createFakeGl();
    const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
    const post = r.atmosphere.post;
    expect(post).not.toBeNull();
    const scene = new RenderScene();
    const frame = (grade: Float32Array): void => {
      scene.beginFrame(0);
      scene.grading.active = true;
      scene.grading.params.set(grade);
      r.render(scene, 960, 540, 'sharp');
    };
    const warm = fullGrade(0);
    fake.calls.length = 0;
    frame(warm);
    expect([post?.lutBuilds, post?.lutUploads, fake.count('texSubImage3D')]).toEqual([1, 1, 1]);
    // The vignette is a uniform, not part of the LUT: the grade moved (a build), no texel changed (no upload).
    const vignetted = new Float32Array(warm);
    vignetted[GRADING_INDEX.vignette] = (vignetted[GRADING_INDEX.vignette] as number) + 0.2;
    frame(vignetted);
    expect([post?.lutBuilds, post?.lutUploads, fake.count('texSubImage3D')]).toEqual([2, 1, 1]);
    // A cooler grade changes texels: built and uploaded.
    const cooler = new Float32Array(vignetted);
    cooler[GRADING_INDEX.temperature] = (cooler[GRADING_INDEX.temperature] as number) - 0.2;
    frame(cooler);
    expect([post?.lutBuilds, post?.lutUploads, fake.count('texSubImage3D')]).toEqual([3, 2, 2]);
  });
});
