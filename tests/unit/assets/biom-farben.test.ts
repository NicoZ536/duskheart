/**
 * M1-02: Farbidentität der Biome (MASTERPROMPT §4.1, docs/ART.md §5). `BIOME_TINTS` und die
 * Biom-Tabelle in docs/ART.md beschreiben dasselbe: 8 Oberflächenbiome + 3 Untergrundebenen, je mit
 * Grundton, Akzent, Nachtfarbe (Palettenreferenzen) und Grading-Absicht; jede Tönung ist eine
 * Palettenzeile, die nur Landschaftsrampen umfärbt.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { paletteIndex } from '../../../assets-src/palette';
import { BIOME_TINTS, PALETTE_ROWS, identityMap, paletteRowIndex } from '../../../assets-src/paletteRows';

const ART_MD = fileURLToPath(new URL('../../../docs/ART.md', import.meta.url));
/** Biome nach MASTERPROMPT §9.3: Oberfläche und Untergrundebenen −1 … −3. */
const OBERFLAECHE = ['gruenhain', 'salzkueste', 'nebelmoor', 'frostkamm', 'glutsand', 'aschenschlund', 'scherbenhain', 'nachtherz'];
const UNTERGRUND = ['wurzelhoehlen', 'tiefgrund', 'glutadern'];
/** Rampen, die eine Biom-Tönung umfärben darf (Figuren, Feuer, Wasser und UI bleiben unberührt). */
const LANDSCHAFT = ['gras', 'erde', 'stein', 'holz', 'laub'];
/** Spalten der Biom-Tabelle: Biom | Ebene | Grundton | Akzent | Nachtfarbe | Grading-Absicht. */
const COLUMNS = 6;
const MIN_GRADING_LENGTH = 40;

interface ArtRow {
  readonly cells: readonly string[];
}

/** Zeilen der Biom-Tabelle in docs/ART.md (erkannt an der Kopfzeile). */
function artBiomeRows(): ArtRow[] {
  const lines = readFileSync(ART_MD, 'utf8').split('\n');
  const head = lines.findIndex((l) => l.startsWith('| Biom | Ebene | Grundton | Akzent | Nachtfarbe | Grading-Absicht |'));
  if (head < 0) throw new Error('docs/ART.md: Biom-Tabelle fehlt');
  const rows: ArtRow[] = [];
  for (let i = head + 2; i < lines.length && (lines[i] ?? '').startsWith('|'); i++) {
    rows.push({ cells: (lines[i] ?? '').split('|').slice(1, -1).map((c) => c.trim()) });
  }
  return rows;
}

function refsIn(cell: string): string[] {
  return [...cell.matchAll(/`([a-z]+\.\d)`/g)].map((m) => m[1] ?? '');
}

describe('Biom-Farbidentität', () => {
  it('umfasst 8 Oberflächenbiome und 3 Untergrundebenen mit eigener Palettenzeile', () => {
    expect(BIOME_TINTS.filter((b) => b.ebene === 0).map((b) => b.biom)).toEqual(OBERFLAECHE);
    expect(BIOME_TINTS.filter((b) => b.ebene !== 0).map((b) => [b.biom, b.ebene])).toEqual([
      ['wurzelhoehlen', -1],
      ['tiefgrund', -2],
      ['glutadern', -3],
    ]);
    for (const b of BIOME_TINTS) {
      expect(b.zeile).toBe(`biom_${b.biom}`);
      expect(PALETTE_ROWS[paletteRowIndex(b.zeile)]?.id).toBe(b.zeile);
    }
    expect(UNTERGRUND).toHaveLength(3);
  });

  it('nennt nur gültige Palettenreferenzen', () => {
    for (const b of BIOME_TINTS) {
      for (const ref of [...b.grundton, ...b.akzent, b.nacht, ...Object.values(b.toenung).flat()]) expect(() => paletteIndex(ref), `${b.biom}: ${ref}`).not.toThrow();
      expect(b.grundton.length, b.biom).toBeGreaterThanOrEqual(2);
      expect(b.akzent.length, b.biom).toBeGreaterThanOrEqual(2);
    }
  });

  it('Tönungen färben nur Landschaftsrampen; Grünhain ist die Referenz, alle anderen Zeilen sind verschieden', () => {
    const maps = new Set<string>();
    for (const b of BIOME_TINTS) {
      for (const ramp of Object.keys(b.toenung)) expect(LANDSCHAFT, `${b.biom}: ${ramp}`).toContain(ramp);
      const row = PALETTE_ROWS[paletteRowIndex(b.zeile)];
      expect(row).toBeDefined();
      if (row === undefined) continue;
      if (b.biom === 'gruenhain') expect(row.map).toEqual(identityMap());
      else expect(row.map, b.biom).not.toEqual(identityMap());
      maps.add(row.map.join(','));
    }
    expect(maps.size).toBe(BIOME_TINTS.length);
  });

  it('docs/ART.md enthält je Biom eine Tabellenzeile mit denselben Rampen-Referenzen und einer Grading-Absicht', () => {
    const rows = artBiomeRows();
    expect(rows).toHaveLength(BIOME_TINTS.length);
    for (const b of BIOME_TINTS) {
      const row = rows.find((r) => (r.cells[0] ?? '').includes(`\`${b.biom}\``));
      expect(row, b.biom).toBeDefined();
      if (row === undefined) continue;
      expect(row.cells, b.biom).toHaveLength(COLUMNS);
      const [, ebene = '', grundton = '', akzent = '', nacht = '', grading = ''] = row.cells;
      expect(ebene.replace('−', '-'), b.biom).toBe(String(b.ebene));
      expect(refsIn(grundton), `${b.biom} Grundton`).toEqual([...b.grundton]);
      expect(refsIn(akzent), `${b.biom} Akzent`).toEqual([...b.akzent]);
      expect(refsIn(nacht), `${b.biom} Nachtfarbe`).toEqual([b.nacht]);
      expect(grading.length, `${b.biom} Grading-Absicht`).toBeGreaterThanOrEqual(MIN_GRADING_LENGTH);
    }
  });
});
