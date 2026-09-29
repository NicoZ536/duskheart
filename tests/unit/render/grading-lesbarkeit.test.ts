/**
 * M5-63: Lesbarkeit der dunklen Biome (docs/ART.md §8 „Figur vor Grund“, §5 Grading-Absicht).
 *
 * - **Nachtherz bei Tag:** die Verderbnis-Zeile färbt die Figur in dieselben Violetttöne wie den Grund (Tunika `wasser.2`
 *   → `nacht.2`, Grund `verderb.1`/`nacht.3`); die Figur liest sich nur durch ihre dunklere Beleuchtung und Kontur. Der Tag
 *   des Bioms spreizt deshalb den Bereich zwischen Figur (≈ 0,1 … 0,15 nach dem Licht) und Grund (≈ 0,2 … 0,3): Die
 *   Pixelprobe am Screenshot `biom-nachtherz-tag` misst ΔL = −0,148 (vorher −0,108; Referenz Grünhain bei Tag −0,134, der
 *   ART-§8-Wert 0,14).
 * - **Nächte von Aschenschlund und Nachtherz:** ein Kontrast über 1 um den Drehpunkt 0,42 drückte die Nacht (Anzeige
 *   unter ≈ 0,05) auf Schwarz – Asche, Kronen und Stämme verschwanden, nur die emissiven Glutstücke blieben. Ihre Nacht
 *   öffnet die Tiefen (Gamma, Kontrast ≤ 1) und tönt sie in der Nachtfarbe des Bioms (ART §5: `feuer.0`, `nacht.0` →
 *   Violett).
 */
import { describe, expect, it } from 'vitest';
import { BIOME_ATMOSPHERE, CORRUPTION_GRADING, paletteColor } from '../../../src/render/post/atmosphereTable';
import { addGradingDelta, createGrading, gradeColor, luma } from '../../../src/render/post/grading';

const out: [number, number, number] = [0, 0, 0];

/** The packed grade of `biome` at `when`, with the biome's corruption pulled in as the game view does. */
function gradeOf(biome: string, when: 'day' | 'night'): Float32Array {
  const a = BIOME_ATMOSPHERE[biome];
  if (a === undefined) throw new Error(`Biom ${biome} fehlt in der Atmosphärentabelle`);
  const p = createGrading(a[when]);
  addGradingDelta(p, CORRUPTION_GRADING, a.corruption);
  return p;
}

/** Luma of a grey `v` (display space) through grade `p`. */
function gradedGrey(p: Float32Array, v: number): number {
  return luma(...gradeColor(v, v, v, p, out));
}

describe('Lesbarkeit der dunklen Biome (M5-63, ART §8)', () => {
  it('the Nachtherz day spreads the tones between the lit figure and its violet ground (slope ≥ 1.25)', () => {
    const p = gradeOf('nachtherz', 'day');
    // Figure body and outline lie around 0.1 … 0.15 after the light, the ground around 0.2 … 0.3.
    const slope = (gradedGrey(p, 0.25) - gradedGrey(p, 0.1)) / 0.15;
    expect(slope).toBeGreaterThanOrEqual(1.25);
    // More spread than the reference biome's day (neutral: 1) and its own night.
    expect(slope).toBeGreaterThan((gradedGrey(gradeOf('gruenhain', 'day'), 0.25) - gradedGrey(gradeOf('gruenhain', 'day'), 0.1)) / 0.15 + 0.2);
    // The light sources stay cold white (ART §5 "Lichtquellen kalt-weiß"): a white stays bright, blue not below red.
    const [r, g, b] = gradeColor(1, 1, 1, p, out);
    expect(luma(r, g, b)).toBeGreaterThan(0.9);
    expect(b).toBeGreaterThanOrEqual(r - 0.02);
    // Mid-tones keep their level: the grade separates, it does not brighten or darken the biome as a whole.
    expect(gradedGrey(p, 0.42)).toBeCloseTo(0.42, 1);
  });

  it('the nights of the Aschenschlund and the Nachtherz open their darks instead of crushing them to black', () => {
    const reference = gradeOf('gruenhain', 'night');
    const referenceSpread = gradedGrey(reference, 0.08) - gradedGrey(reference, 0.02);
    for (const biome of ['aschenschlund', 'nachtherz']) {
      const p = gradeOf(biome, 'night');
      // The darkest lit ash, crowns and trunks of the night (display ≈ 0.02 … 0.08) stay above black and apart.
      for (const v of [0.02, 0.04, 0.08]) expect(gradedGrey(p, v), `${biome} ${v}`).toBeGreaterThan(v);
      const spread = gradedGrey(p, 0.08) - gradedGrey(p, 0.02);
      expect(spread, biome).toBeGreaterThan(referenceSpread);
      // Still night: a mid grey is not lifted above day level.
      expect(gradedGrey(p, 0.25), biome).toBeLessThan(0.36);
    }
  });

  it('the darkness takes the colour of the biome’s night (ART §5): embers red in the Aschenschlund, violet in the Nachtherz', () => {
    const ash = gradeColor(0.06, 0.06, 0.06, gradeOf('aschenschlund', 'night'), [0, 0, 0]);
    const [er, , eb] = paletteColor('feuer.0');
    expect(er).toBeGreaterThan(eb);
    expect(ash[0]).toBeGreaterThan(ash[2]);
    expect(ash[0]).toBeGreaterThan(ash[1]);
    const heart = gradeColor(0.06, 0.06, 0.06, gradeOf('nachtherz', 'night'), [0, 0, 0]);
    expect(heart[2]).toBeGreaterThan(heart[1]);
    expect(heart[0]).toBeGreaterThan(heart[1]);
  });
});
