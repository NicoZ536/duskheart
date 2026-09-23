/**
 * Palettenzeilen (docs/RENDER.md §1, M1-01/M1-08): jede Zeile bildet alle 64 Indizes auf die Palette
 * ab; Jahreszeiten tauschen nur Laub-Rampen, Materialstufen nur `stein`, und jede Zeile behält die
 * Reihenfolge dunkel → hell innerhalb einer Rampe (Schattierung bleibt lesbar, kein Banding-Umkippen).
 */
import { describe, expect, it } from 'vitest';
import { hexToOklch } from '../../../assets-src/lib/color';
import { RAMPS, flatPalette, paletteIndex, rampStart } from '../../../assets-src/palette';
import {
  MATERIAL_SOURCE_RAMP,
  MATERIAL_TIERS,
  PALETTE_ROWS,
  identityMap,
  paletteRowIndex,
  rampTargets,
  rowFromRamps,
  validatePaletteRows,
  type PaletteRow,
} from '../../../assets-src/paletteRows';

const L = flatPalette().map((hex) => hexToOklch(hex).L);

function row(id: string): PaletteRow {
  const r = PALETTE_ROWS[paletteRowIndex(id)];
  if (r === undefined) throw new Error(id);
  return r;
}

/** Namen der Rampen, deren Indizes die Zeile verändert. */
function changedRamps(r: PaletteRow): string[] {
  return RAMPS.filter((ramp) => {
    const start = rampStart(ramp.name);
    return ramp.colors.some((_, i) => r.map[start - 1 + i] !== start + i);
  }).map((ramp) => ramp.name);
}

describe('Palettenzeilen', () => {
  it('sind gültig: basis zuerst, eindeutige Ids, je 64 Einträge im Bereich 1…64', () => {
    expect(validatePaletteRows(PALETTE_ROWS)).toEqual([]);
    expect(PALETTE_ROWS[0]?.map).toEqual(identityMap());
    expect(validatePaletteRows([{ id: 'x', beschreibung: '', map: [0] }])).toEqual([
      'Palettenzeile 0 muss "basis" sein',
      'Palettenzeile x: 1 Einträge statt 64',
      'Palettenzeile x: Index 1 → 0 liegt außerhalb der Palette',
    ]);
    expect(() => paletteRowIndex('gibtsnicht')).toThrow(/fehlt/);
  });

  it('enthalten Jahreszeiten, Verderbnis, Elite und 8 Materialstufen', () => {
    const ids = PALETTE_ROWS.map((r) => r.id);
    for (const id of ['basis', 'fruehling', 'sommer', 'herbst', 'winter', 'verderbnis', 'elite']) expect(ids).toContain(id);
    expect(MATERIAL_TIERS.map((t) => t.id)).toEqual(['stein', 'bronze', 'eisen', 'stahl', 'sonnenstahl', 'magmit', 'lumenit', 'nachtstahl']);
    expect(MATERIAL_TIERS.map((t) => t.stufe)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const t of MATERIAL_TIERS) expect(ids).toContain(t.zeile);
  });

  it('Jahreszeiten tauschen nur gras/laub; Sommer = gezeichnet; Herbst färbt gras in laub-Töne', () => {
    for (const id of ['fruehling', 'sommer', 'herbst', 'winter']) {
      for (const name of changedRamps(row(id))) expect(['gras', 'laub'], id).toContain(name);
    }
    expect(row('sommer').map).toEqual(identityMap());
    expect(changedRamps(row('herbst'))).toEqual(['gras', 'laub']);
    const gras = rampStart('gras');
    const laubStart = rampStart('laub');
    expect(row('herbst').map[gras - 1]).toBe(laubStart);
  });

  it('Verderbnis verändert alle Rampen außer nacht und verderb und macht sie dunkler', () => {
    const r = row('verderbnis');
    expect(changedRamps(r).sort()).toEqual(RAMPS.map((x) => x.name).filter((n) => n !== 'nacht' && n !== 'verderb').sort());
    const meanL = (map: readonly number[]): number => map.reduce((s, v) => s + (L[v - 1] ?? 0), 0) / map.length;
    expect(meanL(r.map)).toBeLessThan(meanL(identityMap()));
  });

  it('jede Zeile behält die Reihenfolge dunkel → hell innerhalb jeder Rampe', () => {
    for (const r of PALETTE_ROWS) {
      for (const ramp of RAMPS) {
        const start = rampStart(ramp.name);
        const lum = ramp.colors.map((_, i) => L[(r.map[start - 1 + i] ?? 1) - 1] ?? 0);
        for (let i = 1; i < lum.length; i++) expect(lum[i], `${r.id}: ${ramp.name}.${i}`).toBeGreaterThanOrEqual(lum[i - 1] ?? 0);
      }
    }
  });

  it('Materialstufen: nur stein wird umgefärbt, sechs verschiedene Stufen streng dunkel → hell, Stufen unterscheidbar', () => {
    const heads = new Set<string>();
    for (const t of MATERIAL_TIERS) {
      const r = row(t.zeile);
      const changed = changedRamps(r);
      expect(changed.length === 0 || (changed.length === 1 && changed[0] === MATERIAL_SOURCE_RAMP), t.id).toBe(true);
      const lum = t.farben.map((ref) => L[paletteIndex(ref) - 1] ?? 0);
      for (let i = 1; i < lum.length; i++) expect(lum[i], `${t.id} Stufe ${i}`).toBeGreaterThan(lum[i - 1] ?? 0);
      // Die dunkelste Stufe ist nie die Outline-Farbe nacht.1 (Kopf bliebe sonst mit der Outline verschmolzen).
      expect(t.farben[0], t.id).not.toBe('nacht.1');
      heads.add(t.farben.join(','));
    }
    expect(heads.size).toBe(8);
  });

  it('rampTargets bildet relativ ab; rowFromRamps prüft die Stufenzahl', () => {
    expect(rampTargets('stein', 'nacht')).toEqual(['nacht.0', 'nacht.1', 'nacht.2', 'nacht.2', 'nacht.3', 'nacht.4']);
    expect(rampTargets('erde', 'laub')).toEqual(['laub.0', 'laub.1', 'laub.2', 'laub.3', 'laub.4']);
    expect(() => rowFromRamps('x', 'x', { gras: ['laub.0'] })).toThrow(/6 Stufen/);
    expect(() => rowFromRamps('x', 'x', { moor: 'gras' })).toThrow(/unbekannte Rampe moor/);
  });
});
