/**
 * Pfützen ohne Blockkanten (M7-147; MASTERPROMPT §4.3 „kein erkennbares Kachelraster“; src/render/surface/rules.ts
 * `puddleNoise`, Shader-Spiegel `puddleNoise` in terrain.frag): die Pfützen lagen auf 2-px-Zellen eines achsparallelen
 * Rauschens – ihre Ränder liefen in Doppelpixel-Stufen und lange Strecken entlang des Rasters (`regen`,
 * `regen-nacht-pfuetzen`). Jetzt eine Zelle je Pixel (das Pixelraster bleibt das Raster des Bildes), der Raum
 * nord-südlich gestaucht und gegen das Raster gedreht: die Kanten liegen auf jeder Pixelzeile und -spalte, und keine läuft
 * lange gerade. Gemessen an der Maske voller Pfützen über einer Fläche von 640 × 640 Weltpixeln, gegen das alte Rauschen.
 */
import { describe, expect, it } from 'vitest';
import { SURFACE_PARAMS } from '../../../src/render/surface/params';
import { clusterNoise, NOISE_SALT, puddleAt, puddleAtWorld } from '../../../src/render/surface/rules';

const P = SURFACE_PARAMS.wet;
const SIZE = 640;

/** Puddle mask (1 = water) of the area at full fill. */
function maske(at: (x: number, y: number) => boolean): Uint8Array {
  const m = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (at(x, y)) m[y * SIZE + x] = 1;
  return m;
}

/** Edges of the mask: the share of horizontal edges on even rows and the longest straight run of edges along a row or column. */
function kanten(m: Uint8Array): { geradeAnteil: number; laengsterLauf: number; anzahl: number } {
  let gerade = 0;
  let anzahl = 0;
  let laengster = 0;
  // Horizontal edges between rows y and y + 1, run along x.
  for (let y = 0; y < SIZE - 1; y++) {
    let lauf = 0;
    for (let x = 0; x < SIZE; x++) {
      if (m[y * SIZE + x] !== m[(y + 1) * SIZE + x]) {
        anzahl++;
        if (y % 2 === 0) gerade++;
        lauf++;
        laengster = Math.max(laengster, lauf);
      } else lauf = 0;
    }
  }
  // Vertical edges between columns x and x + 1, run along y.
  for (let x = 0; x < SIZE - 1; x++) {
    let lauf = 0;
    for (let y = 0; y < SIZE; y++) {
      if (m[y * SIZE + x] !== m[y * SIZE + x + 1]) {
        lauf++;
        laengster = Math.max(laengster, lauf);
      } else lauf = 0;
    }
  }
  return { geradeAnteil: gerade / Math.max(1, anzahl), laengsterLauf: laengster, anzahl };
}

describe('Pfützen ohne Blockkanten (M7-147)', () => {
  it('eine Zelle je Pixel, gestaucht und gedreht: keine Stauchung von 1 und keine Drehung entlang des Rasters', () => {
    expect(P.puddleCellPx).toBe(1);
    expect(P.puddleSquash).toBeGreaterThan(1);
    const [c, s] = P.puddleTurn;
    expect(c * c + s * s).toBeCloseTo(1, 6);
    expect(Math.abs(s)).toBeGreaterThan(0.2);
    expect(Math.abs(c)).toBeGreaterThan(0.2);
  });

  it('die Kanten liegen auf geraden und ungeraden Zeilen; das alte 2-px-Rauschen nur auf einer Hälfte', () => {
    const neu = kanten(maske((x, y) => puddleAtWorld(x, y, 1)));
    const alt = kanten(maske((x, y) => puddleAt(1, clusterNoise(x, y, P.puddleWavelengthPx, P.puddleWavelengthPx * 0.3, 2, NOISE_SALT.puddle))));
    expect(neu.anzahl).toBeGreaterThan(500);
    expect(alt.geradeAnteil === 0 || alt.geradeAnteil === 1).toBe(true);
    expect(neu.geradeAnteil).toBeGreaterThan(0.35);
    expect(neu.geradeAnteil).toBeLessThan(0.65);
  });

  it('keine Kante läuft lange entlang des Rasters (das alte Rauschen: lange gerade Strecken)', () => {
    const neu = kanten(maske((x, y) => puddleAtWorld(x, y, 1)));
    const alt = kanten(maske((x, y) => puddleAt(1, clusterNoise(x, y, P.puddleWavelengthPx, P.puddleWavelengthPx * 0.3, 2, NOISE_SALT.puddle))));
    expect(neu.laengsterLauf).toBeLessThan(alt.laengsterLauf);
    expect(neu.laengsterLauf).toBeLessThanOrEqual(16);
  });
});
