/**
 * Küstenlinie ohne 16-px-Treppen (M7-148; docs/ART.md §3 Blob-Generator; assets-src/lib/blob.ts `flaechenEcken`,
 * assets-src/sprites/terrain/_quelle.ts `GEOMETRIE_STRAND`): eine Küste, die schräg über das Kachelraster läuft, besteht aus
 * Kachelstufen. Mit den runden Außenecken (Radius 4–6) und runden Innenkerben stand jede Stufe als rechter Winkel da
 * (`biom-salzkueste-tag`). Sand und Meeresgrund schneiden die Außenecken einer Fläche jetzt als flache Fase über fast die ganze
 * Kachelseite und die Innenkerben fast gerade: Fase und Kerbe setzen dieselbe Schräge fort. Die Kanten bleiben nahtlos,
 * Zungen behalten ihre runden Ecken, und die anderen weichen Terrains bleiben unverändert.
 */
import { describe, expect, it } from 'vitest';
import { blobFeld, istInnen, KACHEL, pruefeGeometrie, type KantenGeometrie } from '../../../assets-src/lib/blob';
import { GEOMETRIE_STRAND, GEOMETRIE_WEICH } from '../../../assets-src/sprites/terrain/_quelle';
import { NB, RICHTUNGEN, VERSATZ } from '../../../src/world/autotile';

/** Land pixels (1) of a map of `w` × `h` tiles, each land tile drawn as the blob frame of its eight neighbours. */
function felder(land: (x: number, y: number) => boolean, w: number, h: number, geo: KantenGeometrie): Uint8Array {
  const out = new Uint8Array(w * KACHEL * h * KACHEL);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (!land(tx, ty)) continue;
      let maske = 0;
      for (const r of RICHTUNGEN) {
        const [dx, dy] = VERSATZ[r];
        if (land(tx + dx, ty + dy)) maske |= NB[r];
      }
      const f = blobFeld(maske, geo);
      for (let y = 0; y < KACHEL; y++) for (let x = 0; x < KACHEL; x++) if (istInnen(f, x, y)) out[(ty * KACHEL + y) * w * KACHEL + tx * KACHEL + x] = 1;
    }
  }
  return out;
}

const N = 10;
/** A coast at 45° across the grid: land where x + y < N (and beyond the map's north and west). */
const treppe = (x: number, y: number): boolean => x < 0 || y < 0 || x + y < N;

/** Spread [px] of x + y of the last land pixel per row over the middle rows of the diagonal coast: 0 for a straight line. */
function streuung(geo: KantenGeometrie): number {
  const f = felder(treppe, N, N, geo);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 3 * KACHEL; y < 7 * KACHEL; y++) {
    let rand = -1;
    for (let x = 0; x < N * KACHEL; x++) if (f[y * N * KACHEL + x] === 1) rand = x;
    lo = Math.min(lo, rand + y);
    hi = Math.max(hi, rand + y);
  }
  return hi - lo;
}

/** Most pixels along one tile border whose land differs across it, over a fixed pseudo-random map. */
function naht(geo: KantenGeometrie): number {
  const R = 14;
  let s = 7;
  const karte: boolean[] = [];
  for (let i = 0; i < R * R; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    karte.push(s / 2 ** 32 < 0.55);
  }
  const land = (x: number, y: number): boolean => (x < 0 || y < 0 || x >= R || y >= R ? true : (karte[y * R + x] as boolean));
  const f = felder(land, R, R, geo);
  const W = R * KACHEL;
  let schlimmste = 0;
  for (let ty = 0; ty < R; ty++) {
    for (let tx = 0; tx < R; tx++) {
      let quer = 0;
      let laengs = 0;
      for (let k = 0; k < KACHEL; k++) {
        if (tx < R - 1 && f[(ty * KACHEL + k) * W + tx * KACHEL + KACHEL - 1] !== f[(ty * KACHEL + k) * W + tx * KACHEL + KACHEL]) quer++;
        if (ty < R - 1 && f[(ty * KACHEL + KACHEL - 1) * W + tx * KACHEL + k] !== f[(ty * KACHEL + KACHEL) * W + tx * KACHEL + k]) laengs++;
      }
      schlimmste = Math.max(schlimmste, quer, laengs);
    }
  }
  return schlimmste;
}

describe('Küstenlinie ohne Kachelstufen (M7-148)', () => {
  it('eine Küste schräg über das Raster wird eine schräge Linie: die Stufen schrumpfen von 11 auf höchstens 5 px', () => {
    expect(streuung(GEOMETRIE_WEICH)).toBeGreaterThanOrEqual(10);
    expect(streuung(GEOMETRIE_STRAND)).toBeLessThanOrEqual(5);
  });

  it('nahtlos: an keiner Kachelgrenze springt die Kante (die Fase endet vor der letzten Spalte, tests/unit/world/autotile.test.ts)', () => {
    expect(naht(GEOMETRIE_WEICH)).toBe(0);
    expect(naht(GEOMETRIE_STRAND)).toBe(0);
  });

  it('nur Flächenecken werden zur Fase: eine Zunge (ein verbundener Nachbar) behält ihre runden Ecken', () => {
    const zungen = [NB.N, NB.E, NB.S, NB.W, 0];
    for (const maske of zungen) {
      const weich = blobFeld(maske, GEOMETRIE_WEICH);
      const strand = blobFeld(maske, GEOMETRIE_STRAND);
      for (let y = 0; y < KACHEL; y++) for (let x = 0; x < KACHEL; x++) expect(istInnen(strand, x, y), `${maske} ${x},${y}`).toBe(istInnen(weich, x, y));
    }
    // A face corner (north and west connected, the corner south-east open) is cut much deeper than the round one.
    const knick = NB.N | NB.W | NB.NW;
    let weich = 0;
    let strand = 0;
    for (let y = 0; y < KACHEL; y++) {
      for (let x = 0; x < KACHEL; x++) {
        if (istInnen(blobFeld(knick, GEOMETRIE_WEICH), x, y)) weich++;
        if (istInnen(blobFeld(knick, GEOMETRIE_STRAND), x, y)) strand++;
      }
    }
    expect(weich - strand).toBeGreaterThan(30);
  });

  it('die Geometrieprüfung hält den Schnitt in der Kachel und die Form zwischen Fase und Viertelkreis', () => {
    expect(pruefeGeometrie(GEOMETRIE_STRAND)).toEqual([]);
    expect(pruefeGeometrie({ ...GEOMETRIE_STRAND, flaechenEcken: { radien: [12], form: 1.25 } }).join(' ')).toContain('Radius 12');
    // One more than the deepest profile inset allows: the cut reaches the tile's last column (two rows step across the seam).
    expect(pruefeGeometrie({ ...GEOMETRIE_STRAND, flaechenEcken: { radien: [11], form: 1.25 } }).join(' ')).toContain('Radius 11');
    expect(pruefeGeometrie({ ...GEOMETRIE_STRAND, flaechenEcken: { radien: [10], form: 0.8 } }).join(' ')).toContain('Form 0.8');
    expect(pruefeGeometrie({ ...GEOMETRIE_STRAND, flaechenEcken: { radien: [], form: 1.25 } }).join(' ')).toContain('Radien nötig');
  });
});
