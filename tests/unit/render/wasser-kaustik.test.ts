/**
 * M5-62 (Kaustik-Teil): Das Kaustiknetz im sonnigen Flachwasser las sich im Screenshot-Set M5 wie Eisrisse – 15-px-Zellen
 * mit geraden Nähten, eine Linie deckte 32 % des Grunds, eine Kreuzung 60 %. Jetzt ist es feiner (11-px-Zellen), schwächer
 * (22 %, Kreuzungen höchstens 36 %) und gebogen (die Gitterkoordinaten wellen sich um bis zu 1 px): Licht, das die Wellen
 * bündeln, läuft in Kurven. Gemessen am CPU-Spiegel `src/render/water/caustics.ts` gegen das Netz von M5-29; die
 * Biegung wiederholt sich mit dem Gitter, der Drift-Umbruch bleibt ohne Naht. Der Shader rechnet dasselbe.
 */
import { describe, expect, it } from 'vitest';
import { SHADERS } from '../../../src/render/shaderLib';
import { causticAt, causticCover, causticPeriods, voronoiEdge, waterHash, type CausticNetNumbers } from '../../../src/render/water/caustics';
import { waterShaderDefines } from '../../../src/render/water/defines';
import { CAUSTICS, causticWarpFrequency, ICE } from '../../../src/render/water/params';

/** The caustic net of the M5-29 screenshot set (before M5-62): large straight-seamed cells, strong lines. */
const M5_NET: CausticNetNumbers = {
  cellPx: 15,
  layerScale: 0.63,
  periodCells: 80,
  layerOffsetPx: [31, 17],
  lineWidth: 0.085,
  layerLineWidth: 1.2,
  warpPx: 0,
  warpSpanCells: 1,
  wobble: 0.38,
  wobbleSpeed: [0.8, 0.6],
  layerWobble: 1.3,
  strength: 0.32,
  maxCover: 0.6,
};

const DRIFT_A = [12.3125, -40.1875] as const;
const DRIFT_B = [-7.0625, 24.625] as const;
const MOTION = 17.3125;

/** The net over a patch of the shallows: mean spacing of its lines along rows [px] and the mean share of caustic colour laid over the ground. */
function measure(net: CausticNetNumbers): { spacing: number; cover: number; lit: Uint8Array } {
  let runs = 0;
  let px = 0;
  let cover = 0;
  const lit = new Uint8Array(400 * 60);
  for (let j = 0; j < 60; j++) {
    const y = 100 + j * 5;
    let prev = 0;
    for (let i = 0; i < 400; i++) {
      const c = causticAt(1000 + i + 0.5, y + 0.5, DRIFT_A, DRIFT_B, MOTION, net);
      cover += causticCover(c, 1, net);
      lit[j * 400 + i] = c;
      if (c > 0.5 && prev < 0.5) runs++;
      prev = c;
      px++;
    }
  }
  return { spacing: px / runs, cover: cover / px, lit };
}

describe('M5-62: das Kaustiknetz – feiner, schwächer, gebogen statt Eisrisse', () => {
  const now = measure(CAUSTICS);
  const before = measure(M5_NET);

  it('feiner: die Linien liegen dichter als im Netz von M5-29 und viel dichter als die Risse des Eises', () => {
    expect(now.spacing).toBeLessThan(0.85 * before.spacing);
    expect(CAUSTICS.cellPx).toBeLessThan(ICE.plateCellPx * 0.6);
    // Still a net of lines, not a haze: most of the ground between them is left alone.
    expect(now.spacing).toBeGreaterThan(3);
  });

  it('schwächer: eine Linie und eine Kreuzung decken den Grund höchstens zu 70 % so stark wie vorher, im Mittel weniger', () => {
    expect(causticCover(1, 1)).toBeLessThanOrEqual(0.7 * causticCover(1, 1, M5_NET));
    expect(causticCover(2, 1)).toBeLessThanOrEqual(0.7 * causticCover(2, 1, M5_NET));
    expect(causticCover(2, 1)).toBeGreaterThan(causticCover(1, 1));
    expect(now.cover).toBeLessThan(before.cover);
    // A faint line is still there where the sun reaches the shallows.
    expect(causticCover(1, 1)).toBeGreaterThanOrEqual(0.15);
  });

  it('gebogen: die Biegung verschiebt einen guten Teil der Linienpixel gegenüber geraden Nähten', () => {
    const straight = measure({ ...CAUSTICS, warpPx: 0 });
    let moved = 0;
    let lines = 0;
    for (let k = 0; k < now.lit.length; k++) {
      if ((now.lit[k] ?? 0) > 0 || (straight.lit[k] ?? 0) > 0) lines++;
      if ((now.lit[k] ?? 0) > 0 !== (straight.lit[k] ?? 0) > 0) moved++;
    }
    expect(moved / lines).toBeGreaterThan(0.3);
    expect(CAUSTICS.warpPx).toBeGreaterThanOrEqual(1);
  });

  it('die Biegung wiederholt sich mit dem Gitter: der Drift-Umbruch um eine Periode zeigt keine Naht', () => {
    const [periodA, periodB] = causticPeriods();
    // Both periods whole 1/16 px (world/drift.ts) and whole waves of the bend per period.
    for (const p of [periodA, periodB]) expect(Number.isInteger(p * 16)).toBe(true);
    for (const cell of [CAUSTICS.cellPx, CAUSTICS.cellPx * CAUSTICS.layerScale]) {
      const waves = (causticWarpFrequency(cell) * cell * CAUSTICS.periodCells) / (2 * Math.PI);
      expect(Math.abs(waves - Math.round(waves))).toBeLessThan(1e-9);
    }
    let same = 0;
    let n = 0;
    for (let y = 3; y < 300; y += 11) {
      for (let x = 5; x < 900; x += 13, n++) {
        const a = causticAt(x + 0.5, y + 0.5, DRIFT_A, DRIFT_B, MOTION);
        const b = causticAt(x + 0.5, y + 0.5, [DRIFT_A[0] - periodA, DRIFT_A[1] + periodA], [DRIFT_B[0] + periodB, DRIFT_B[1] - periodB], MOTION);
        if (a === b) same++;
      }
    }
    expect(same).toBe(n);
  });

  it('der Shader rechnet dasselbe Netz (Biegung, Zellen, Linienbreiten, Deckung, Hash)', () => {
    const src = (SHADERS['water_surface.frag'] ?? '').replace(/\s+/g, ' ');
    expect(src).toContain('vec2 r = mod(q, period) * freq; return q + DH_CAUSTIC_WARP * vec2(sin(r.y), cos(r.x));');
    expect(src).toContain('vec2 qa = causticBend(world + uCausticDrift.xy, DH_CAUSTIC_WARP_FREQ.x, DH_CAUSTIC_PERIOD_PX.x);');
    expect(src).toContain('float a = voronoiEdge(qa / DH_CAUSTIC_CELL, uMotionTime * DH_CAUSTIC_WOBBLE_A, 3u, DH_CAUSTIC_PERIOD) < DH_CAUSTIC_LINE ? 1.0 : 0.0;');
    expect(src).toContain('float b = voronoiEdge(qb / DH_CAUSTIC_CELL_B, uMotionTime * DH_CAUSTIC_WOBBLE_B, 5u, DH_CAUSTIC_PERIOD) < DH_CAUSTIC_LINE_B ? 1.0 : 0.0;');
    expect(src).toContain('min(DH_CAUSTIC_STRENGTH * caustic * k, DH_CAUSTIC_MAX_COVER)');
    const d = waterShaderDefines();
    const [periodA, periodB] = causticPeriods();
    expect(d.DH_CAUSTIC_PERIOD_PX).toBe(`vec2(${periodA.toFixed(1)}, ${periodB.toFixed(1)})`);
    expect(d.DH_CAUSTIC_CELL_B).toBe(String(CAUSTICS.cellPx * CAUSTICS.layerScale));
    expect(d.DH_CAUSTIC_LINE_B).toBe(String(CAUSTICS.lineWidth * CAUSTICS.layerLineWidth));
    // The hash mirror (water.glsl): the same integer arithmetic, 0…1, stable for negative cells.
    const glsl = (SHADERS['water.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(glsl).toContain('uvec2 q = uvec2(c) * uvec2(1597334673u, 3812015801u); uint n = (q.x ^ q.y ^ (salt * 2654435761u)) * 1597334673u; return n ^ (n >> 16u);');
    for (const [x, y] of [
      [0, 0],
      [-5, 17],
      [123456, -98765],
    ] as const) {
      const h = waterHash(x, y, 3);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
    // A cell far from its neighbours: the edge distance is the gap between the nearest two points.
    expect(voronoiEdge(0.5, 0.5, 0, 0, 3, 0)).toBeGreaterThanOrEqual(0);
  });
});
