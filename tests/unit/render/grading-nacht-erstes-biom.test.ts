/**
 * M7-61: die Nächte des ersten Bioms (docs/ART.md §5: Grünhain „Nacht kühles Blau mit violetten Schatten“, Salzküste „Nacht
 * marineblau mit silbernem Mondlicht“). Unter dem Halbmond liegt die Wiese bei ≈ 0,04 der Anzeige, der mondhelle Sand bei
 * ≈ 0,07; ein Kontrast über 1 um den Drehpunkt 0,42 drückte beides gegen Schwarz – Kronen, Wege und Wiese wurden eine dunkle
 * Masse. Die Nächte öffnen ihre Tiefen ein wenig und tönen sie blau, bleiben aber Nacht und flacher als die geöffneten
 * Nächte von Aschenschlund und Nachtherz (grading-lesbarkeit.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { BIOME_ATMOSPHERE, CORRUPTION_GRADING } from '../../../src/render/post/atmosphereTable';
import { addGradingDelta, createGrading, gradeColor, luma } from '../../../src/render/post/grading';

const out: [number, number, number] = [0, 0, 0];

function nightOf(biome: string): Float32Array {
  const a = BIOME_ATMOSPHERE[biome];
  if (a === undefined) throw new Error(`Biom ${biome} fehlt in der Atmosphärentabelle`);
  const p = createGrading(a.night);
  addGradingDelta(p, CORRUPTION_GRADING, a.corruption);
  return p;
}

function grey(p: Float32Array, v: number): number {
  return luma(...gradeColor(v, v, v, p, out));
}

describe('M7-61: Nächte von Grünhain und Salzküste', () => {
  it('the moonlit darks stay above black: meadow, crowns and sand keep their level or rise a little', () => {
    for (const biome of ['gruenhain', 'salzkueste']) {
      const p = nightOf(biome);
      for (const v of [0.02, 0.04, 0.07]) expect(grey(p, v), `${biome} ${v}`).toBeGreaterThanOrEqual(v);
      // Still night: a mid grey is not lifted towards day.
      expect(grey(p, 0.25), biome).toBeLessThan(0.3);
    }
  });

  it('the darkness is cool: a grey turns blue, the Grünhain’s with violet shadows (red above green)', () => {
    const [r, g, b] = gradeColor(0.05, 0.05, 0.05, nightOf('gruenhain'), [0, 0, 0]);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
    expect(r).toBeGreaterThanOrEqual(g * 0.9);
    const [sr, sg, sb] = gradeColor(0.07, 0.07, 0.07, nightOf('salzkueste'), [0, 0, 0]);
    expect(sb).toBeGreaterThan(sg);
    expect(sg).toBeGreaterThan(sr);
  });

  it('the first biome’s nights stay flatter than the opened nights of the dark biomes', () => {
    const spread = (biome: string): number => grey(nightOf(biome), 0.08) - grey(nightOf(biome), 0.02);
    for (const first of ['gruenhain', 'salzkueste']) {
      for (const dark of ['aschenschlund', 'nachtherz']) expect(spread(first), `${first} < ${dark}`).toBeLessThan(spread(dark));
    }
  });
});
