/**
 * Hilfen der platzierbaren Welt-Sprites (M3-16, M3-22, M3-26): ein Grundbild und Überlagerungen je
 * Frame (Flammen, Glut, Wimpel), jeweils als handgezeichnetes Index-Raster. `.` in der Überlagerung
 * lässt das Grundbild stehen, `_` stanzt ein Pixel aus (transparent).
 */

function zeilen(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Legt `oben` über `unten` (gleich große Raster). */
export function ueberlagere(unten: string, oben: string): string {
  const u = zeilen(unten);
  const o = zeilen(oben);
  if (u.length !== o.length) throw new Error(`Überlagerung: ${o.length} Zeilen über ${u.length} Zeilen`);
  return u
    .map((zeile, y) => {
      const oz = o[y] ?? '';
      if (oz.length !== zeile.length) throw new Error(`Überlagerung Zeile ${y}: ${oz.length} statt ${zeile.length} Zeichen`);
      return [...zeile].map((c, x) => (oz[x] === '.' ? c : oz[x] === '_' ? '.' : (oz[x] ?? c))).join('');
    })
    .join('\n');
}

/** Ersetzt Zeichen eines Rasters (z. B. frisches Holz → verkohltes Holz). */
export function tausche(raster: string, tausch: Readonly<Record<string, string>>): string {
  return zeilen(raster)
    .map((z) => [...z].map((c) => tausch[c] ?? c).join(''))
    .join('\n');
}
