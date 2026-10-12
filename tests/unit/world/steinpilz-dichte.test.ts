/**
 * Steinpilzdichte im Grünhain (M7-150; MASTERPROMPT §9.2.7 "Blue-Noise + Cluster", §14 "Pilze"; src/world/gen/resources.ts
 * `RESOURCES.objectRules`, `RESOURCES.steinpilzBand`): Steinpilze wuchsen in den Flecken der Kräuter (4–9 Knoten in 5 Kacheln
 * Umkreis) – bis zu neun im Ausschnitt, die Wiese von `biom-gruenhain-tag` las sich als Pilzbeet. Jetzt stehen sie einzeln
 * oder zu zweit, zu dritt, an mehr als doppelt so vielen Stellen: die Dichte je Grünhain-Fläche liegt im Zielband, und kaum
 * ein Steinpilz steht in einem Feld. Geprüft an den Welten der Bilder (Seed 20260923 mittel, 20260924 klein).
 */
import { describe, expect, it } from 'vitest';
import { depositRule, OBJECTS_BY_ID, RESOURCES } from '../../../src/world/gen/resources';
import { generateWorld, type GeneratedWorld } from '../../../src/world/gen/world';

const BAND = RESOURCES.steinpilzBand;
const WORLDS: ReadonlyArray<readonly [number, 'small' | 'medium']> = [
  [20260923, 'medium'],
  [20260924, 'small'],
];

/** Porcini anchors on Grünhain land and the Grünhain land's area [tiles] of a world (plan cells of Grünhain regions). */
function porcini(w: GeneratedWorld): { readonly at: ReadonlyArray<readonly [number, number]>; readonly tiles: number } {
  const { grid, region, regions, land } = w.plan;
  const gruen = (c: number): boolean => {
    const r = region[c] as number;
    return r >= 0 && regions[r]?.biome === 'gruenhain' && land[c] === 1;
  };
  let cells = 0;
  for (let c = 0; c < grid.count; c++) if (gruen(c)) cells++;
  const res = w.resources;
  const id = res.objects.indexOf('pflanze_steinpilz');
  const at: [number, number][] = [];
  for (let k = 0; k < res.nodeObject.length; k++) {
    if (res.nodeObject[k] !== id) continue;
    const x = res.nodeX[k] as number;
    const y = res.nodeY[k] as number;
    if (gruen(Math.floor(y / grid.cellTiles) * grid.width + Math.floor(x / grid.cellTiles))) at.push([x, y]);
  }
  return { at, tiles: cells * grid.cellTiles * grid.cellTiles };
}

describe('Steinpilzdichte im Grünhain (M7-150)', { timeout: 120_000 }, () => {
  it('eigene Lagerregel: ein bis drei Knoten, weiter gestreut als die Kräuter, die Mindestmenge je Stufe bleibt die der Art', () => {
    const o = OBJECTS_BY_ID.get('pflanze_steinpilz');
    if (o === undefined) throw new Error('pflanze_steinpilz fehlt');
    const rule = depositRule(o);
    const herbs = RESOURCES.kinds.pflanze;
    expect(rule.nodesMax).toBeLessThanOrEqual(BAND.fieldNeighbours);
    expect(rule.nodesMax).toBeLessThan(herbs.nodesMin);
    expect(rule.radius).toBeGreaterThan(herbs.radius);
    expect(rule.minPerTier).toBe(herbs.minPerTier);
    // Every other plant keeps its kind's rule.
    const kraut = OBJECTS_BY_ID.get('pflanze_kraeuter');
    if (kraut === undefined) throw new Error('pflanze_kraeuter fehlt');
    expect(depositRule(kraut)).toBe(herbs);
  });

  for (const [seed, size] of WORLDS) {
    it(`Welt ${seed} (${size}): Dichte je Grünhain-Fläche im Zielband, höchstens ein Zehntel in einem Feld`, () => {
      const w = generateWorld(seed, size);
      const { at, tiles } = porcini(w);
      expect(tiles).toBeGreaterThan(50_000);
      const perThousand = (at.length / tiles) * 1000;
      expect(perThousand, 'je 1000 Kacheln').toBeGreaterThanOrEqual(BAND.perThousandTiles[0]);
      expect(perThousand, 'je 1000 Kacheln').toBeLessThanOrEqual(BAND.perThousandTiles[1]);
      const r2 = BAND.fieldRadiusTiles * BAND.fieldRadiusTiles;
      let field = 0;
      for (const [x, y] of at) {
        let others = 0;
        for (const [u, v] of at) if ((u !== x || v !== y) && (u - x) ** 2 + (v - y) ** 2 <= r2) others++;
        if (others >= BAND.fieldNeighbours) field++;
      }
      expect(field / at.length, 'Anteil im Feld').toBeLessThanOrEqual(BAND.fieldShareMax);
    });
  }
});
