/**
 * M6-Gate (zustand-geblendet: „Die Blendfunken sind auf hellem Sand schwach: 5×5 px blassblau mit cremefarbenem Hof auf Sand
 * cec187“; assets-src/sprites/figuren/spieler_blendfunke.ts): die Blendfunken am Spieler sind die Funkenkreuze der Kreaturen
 * (`kampf_zustand`, Clip `blendung`, ADR-0173) mit einem tiefblauen, nicht leuchtenden Rand. Belegt: Kern, Farben und Takt
 * wie bei den Kreaturen; jedes leere Pixel neben dem Kreuz (4er-Nachbarschaft) ist Rand, sonst nichts; der Rand hebt sich
 * von hellem Sand und Schnee deutlich ab, der Kern von dunklem Grund.
 */
import { describe, expect, it } from 'vitest';
import { TRANSPARENT } from '../../../assets-src/lib/sprite';
import { flatPalette, paletteIndex } from '../../../assets-src/palette';
import funke from '../../../assets-src/sprites/figuren/spieler_blendfunke';
import zustaende from '../../../assets-src/sprites/kampf/zustaende';
import { checkSprite } from '../../../tools/assets/spriteChecks';

const PALETTE = flatPalette();
const RAND = paletteIndex('wasser.2');

/** Relative luminance (sRGB weights) of palette index `i` (0–255). */
function luma(i: number): number {
  const hex = PALETTE[i - 1] ?? '#000000';
  return 0.2126 * parseInt(hex.slice(1, 3), 16) + 0.7152 * parseInt(hex.slice(3, 5), 16) + 0.0722 * parseInt(hex.slice(5, 7), 16);
}

describe('Blendfunken am Spieler (M6-Gate)', () => {
  const quelle = zustaende.clips['blendung'];
  const clip = funke.clips['blendung'];

  it('die Kreaturfunken, um einen Pixel Rand größer: gleicher Takt, Anker in der Mitte, Kern und Farben der Kreaturfunken', () => {
    expect(quelle).toBeDefined();
    expect([clip?.frames.length, clip?.fps, clip?.loop]).toEqual([quelle?.frames.length, quelle?.fps, quelle?.loop]);
    expect([funke.w, funke.h]).toEqual([zustaende.w + 2, zustaende.h + 2]);
    expect(funke.anchor).toEqual([zustaende.anchor[0] + 1, zustaende.anchor[1] + 1]);
    clip?.frames.forEach((f, pos) => {
      const src = zustaende.frames[quelle?.frames[pos] ?? -1];
      const dst = funke.frames[f];
      if (src === undefined || dst === undefined) throw new Error(`Bild ${pos}`);
      for (let y = 0; y < funke.h; y++) {
        for (let x = 0; x < funke.w; x++) {
          const i = y * funke.w + x;
          const inQuelle = x >= 1 && y >= 1 && x <= zustaende.w && y <= zustaende.h;
          const q = inQuelle ? (y - 1) * zustaende.w + (x - 1) : -1;
          const v = inQuelle ? (src.index[q] ?? TRANSPARENT) : TRANSPARENT;
          const label = `Bild ${pos} (${x}, ${y})`;
          if (v !== TRANSPARENT) {
            // The spark itself: same colour, same glow.
            expect([dst.index[i], dst.emissive[i]], label).toEqual([v, src.emissive[q]]);
            continue;
          }
          const at = (xx: number, yy: number): number => (xx >= 1 && yy >= 1 && xx <= zustaende.w && yy <= zustaende.h ? (src.index[(yy - 1) * zustaende.w + xx - 1] ?? TRANSPARENT) : TRANSPARENT);
          const amFunken = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some((n) => n !== TRANSPARENT);
          // Beside the spark: the rim, not glowing; elsewhere nothing.
          expect([dst.index[i], dst.emissive[i]], label).toEqual(amFunken ? [RAND, 0] : [TRANSPARENT, 0]);
        }
      }
    });
  });

  it('der Rand trägt auf hellem Grund, der Kern auf dunklem; die Sprite-Prüfung ist sauber', () => {
    for (const f of funke.frames) {
      // The rim: the pixels that do not glow. Bright sand of the beach (cec187 ≈ sand.3 / sand.2) and snow (eis.3): every
      // rim pixel at least 80 darker.
      const rand = Array.from(f.index).filter((v, i) => v !== TRANSPARENT && (f.emissive[i] ?? 0) === 0);
      expect(rand.length).toBeGreaterThan(0);
      for (const grund of ['sand.2', 'sand.3', 'eis.3']) for (const v of rand) expect(luma(paletteIndex(grund)) - luma(v), grund).toBeGreaterThanOrEqual(80);
      // The core (brightest spark pixel) glows over night ground.
      const kern = Math.max(...Array.from(f.index).filter((v, i) => v !== TRANSPARENT && (f.emissive[i] ?? 0) !== 0).map(luma));
      expect(kern - luma(paletteIndex('nacht.2'))).toBeGreaterThanOrEqual(150);
    }
    expect(checkSprite(funke)).toEqual({ errors: [], warnings: [] });
  });
});
