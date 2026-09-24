/**
 * M1-31: Biom-Tönungen klar unterscheidbar. Gemessen wird am Landschaftsbild aus den gemeinsam
 * genutzten Grünhain-Sprites (Grasboden, Erde, Übergang, Felsen, Laubbaum): Jedes Pixel wird durch
 * zwei Biom-Palettenzeilen gefärbt und der Farbabstand in OKLab gemittelt – je Sprite, dann über die
 * Sprites (jedes Sprite zählt gleich, damit der große Baum den Boden nicht überstimmt).
 *
 * Die Helligkeit zählt dabei nur halb: Tageszeit und Licht verschieben die Helligkeit ohnehin, ein
 * Biom muss sich am Farbton abheben. Eine bloß abgedunkelte Grünhain-Wiese (so sahen Nebelmoor und
 * Wurzelhöhlen vor M1-31 aus) liest sich als Grünhain in der Dämmerung.
 */
import { describe, expect, it } from 'vitest';
import baumLaub from '../../../assets-src/sprites/gruenhain_basis/baum_laub';
import bodenErde from '../../../assets-src/sprites/gruenhain_basis/boden_erde';
import bodenGras from '../../../assets-src/sprites/gruenhain_basis/boden_gras';
import bodenKante from '../../../assets-src/sprites/gruenhain_basis/boden_gras_kante';
import felsen from '../../../assets-src/sprites/gruenhain_basis/felsen';
import { paletteOklab, type Oklab } from '../../../assets-src/lib/color';
import { TRANSPARENT, type Sprite } from '../../../assets-src/lib/sprite';
import { BIOME_TINTS, PALETTE_ROWS, paletteRowIndex, rowFromRamps } from '../../../assets-src/paletteRows';

/** Gewicht der Helligkeit im Farbabstand (Farbton und Buntheit zählen voll). */
const LIGHTNESS_WEIGHT = 0.5;
/** Mindestabstand je Biompaar. */
const MIN_PAIR_DISTANCE = 0.05;
/** Mindestabstand jedes Bioms zur Referenz Grünhain, in deren Farben die Sprites gezeichnet sind. */
const MIN_FROM_REFERENCE = 0.08;
const REFERENCE = 'gruenhain';

const LAB = paletteOklab();
const LANDSCHAFT: readonly Sprite[] = [bodenGras, bodenErde, bodenKante, ...felsen, baumLaub];

function distance(p: Oklab, q: Oklab): number {
  return Math.hypot(LIGHTNESS_WEIGHT * (p.L - q.L), p.a - q.a, p.b - q.b);
}

function rowMap(biom: string): readonly number[] {
  const b = BIOME_TINTS.find((x) => x.biom === biom);
  const row = b === undefined ? undefined : PALETTE_ROWS[paletteRowIndex(b.zeile)];
  if (row === undefined) throw new Error(`Biomzeile ${biom} fehlt`);
  return row.map;
}

function color(map: readonly number[], v: number): Oklab {
  const c = LAB[(map[v - 1] ?? v) - 1];
  if (c === undefined) throw new Error(`Palettenindex ${v} fehlt`);
  return c;
}

/** Mittlerer Farbabstand des Landschaftsbilds unter zwei Palettenzeilen. */
function landscapeDistance(ma: readonly number[], mb: readonly number[]): number {
  let total = 0;
  for (const s of LANDSCHAFT) {
    let sum = 0;
    let n = 0;
    for (const f of s.frames) {
      for (const v of f.index) {
        if (v === TRANSPARENT) continue;
        sum += distance(color(ma, v), color(mb, v));
        n++;
      }
    }
    total += sum / n;
  }
  return total / LANDSCHAFT.length;
}

const BIOME = BIOME_TINTS.map((b) => b.biom);
const PAIRS = BIOME.flatMap((a, i) => BIOME.slice(i + 1).map((b) => [a, b] as const));

describe('M1-31 Biom-Tönung: Farbabstand je Biompaar', () => {
  it('das Landschaftsbild besteht aus den gemeinsamen Sprites der Grünhain-Serie', () => {
    expect(LANDSCHAFT.map((s) => s.id)).toEqual(['boden_gras', 'boden_erde', 'boden_gras_kante', 'fels_klein', 'fels_gross', 'baum_laub']);
    expect(PAIRS).toHaveLength((BIOME.length * (BIOME.length - 1)) / 2);
  });

  it.each(PAIRS)('%s / %s liegen weit genug auseinander', (a, b) => {
    expect(landscapeDistance(rowMap(a), rowMap(b))).toBeGreaterThanOrEqual(MIN_PAIR_DISTANCE);
  });

  it.each(BIOME.filter((b) => b !== REFERENCE))('%s hebt sich deutlich von Grünhain ab', (b) => {
    expect(landscapeDistance(rowMap(REFERENCE), rowMap(b))).toBeGreaterThanOrEqual(MIN_FROM_REFERENCE);
  });

  it('das Maß trennt Farbton von Helligkeit: eine nur abgedunkelte Grünhain-Landschaft fällt durch', () => {
    // Gras, Erde, Holz und Stein je eine Stufe tiefer – dieselbe Lichtung in der Dämmerung.
    const dunkler = rowFromRamps('gruenhain_dunkler', 'Grünhain eine Stufe dunkler', {
      gras: ['gras.0', 'gras.0', 'gras.1', 'gras.2', 'gras.3', 'gras.4'],
      erde: ['erde.0', 'erde.0', 'erde.1', 'erde.2', 'erde.3'],
      holz: ['holz.0', 'holz.0', 'holz.1', 'holz.2', 'holz.3'],
      stein: ['stein.0', 'stein.0', 'stein.1', 'stein.2', 'stein.3', 'stein.4'],
    });
    expect(landscapeDistance(rowMap(REFERENCE), dunkler.map)).toBeLessThan(MIN_FROM_REFERENCE);
  });
});
