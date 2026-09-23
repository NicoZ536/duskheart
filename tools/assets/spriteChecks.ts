/**
 * Paletten-Validator für Sprites (MASTERPROMPT §4.3, §4.5; M1-04) und Nutzungsprüfung (M1-05).
 * - Fehler: Farben außerhalb der Master-Palette; mehr als 12 Farben (inkl. Outline) ohne
 *   `ausnahmeFarben`-Begründung.
 * - Warnung: verwaiste Einzelpixel – ein deckendes Pixel ohne gleichfarbigen Nachbarn (8er-Nachbarschaft),
 *   das zugleich höchstens einen deckenden Nachbarn hat oder dessen Farbe im Frame nur dieses eine Mal
 *   vorkommt (Rauschen statt Farbcluster). Mit `einzelpixel`-Begründung unterdrückt.
 * - Warnung: Sprites, deren Id nirgends in `src/` als String vorkommt (ungenutzt).
 */
import { readFileSync } from 'node:fs';
import { MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, type Sprite } from '../../assets-src/lib/sprite';
import { listFiles } from '../lib/files';

/** Höchstens so viele Koordinaten nennt eine Einzelpixel-Warnung. */
const ORPHAN_LIST_LIMIT = 6;

export interface SpriteIssues {
  readonly errors: string[];
  readonly warnings: string[];
}

/** Ein verwaistes Einzelpixel. */
export interface OrphanPixel {
  readonly frame: number;
  readonly x: number;
  readonly y: number;
}

/** Verwaiste Einzelpixel aller Frames (siehe Modulkommentar). */
export function findOrphanPixels(s: Sprite): OrphanPixel[] {
  const out: OrphanPixel[] = [];
  s.frames.forEach((f, fi) => {
    const counts = new Map<number, number>();
    for (const v of f.index) if (v !== TRANSPARENT) counts.set(v, (counts.get(v) ?? 0) + 1);
    const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= s.w || y >= s.h ? TRANSPARENT : (f.index[y * s.w + x] ?? TRANSPARENT));
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const v = at(x, y);
        if (v === TRANSPARENT) continue;
        let same = 0;
        let opaque = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const n = at(x + dx, y + dy);
            if (n === TRANSPARENT) continue;
            opaque++;
            if (n === v) same++;
          }
        }
        if (same === 0 && (opaque <= 1 || counts.get(v) === 1)) out.push({ frame: fi, x, y });
      }
    }
  });
  return out;
}

/** Palettenprüfung eines Sprites: Fremdfarben, Farbgrenze, Einzelpixel. */
export function checkSprite(s: Sprite): SpriteIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const e of s.farbFehler) errors.push(`Sprite ${s.id}: nur Palettenfarben erlaubt – ${e}`);
  const colors = spriteColorCount(s);
  if (colors > MAX_SPRITE_COLORS && s.ausnahmeFarben === null) {
    errors.push(`Sprite ${s.id}: ${colors} Farben, höchstens ${MAX_SPRITE_COLORS} inkl. Outline (Ausnahme nur mit ausnahmeFarben: 'Begründung')`);
  }
  if (s.einzelpixel === null) {
    const orphans = findOrphanPixels(s);
    if (orphans.length > 0) {
      const list = orphans
        .slice(0, ORPHAN_LIST_LIMIT)
        .map((o) => `F${o.frame}(${o.x},${o.y})`)
        .join(' ');
      warnings.push(`Sprite ${s.id}: ${orphans.length} verwaiste Einzelpixel ${list}${orphans.length > ORPHAN_LIST_LIMIT ? ' …' : ''}`);
    }
  }
  return { errors, warnings };
}

/** Palettenprüfung aller Sprites. */
export function checkSprites(sprites: readonly Sprite[]): SpriteIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const s of sprites) {
    const r = checkSprite(s);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }
  return { errors, warnings };
}

/** Quelldateien, in denen Sprite-Ids verwendet werden (`src/`, ohne erzeugte Dateien). */
export function usageFiles(srcDir: string): string[] {
  return listFiles(srcDir, (f) => /\.(ts|tsx|json)$/.test(f) && !/[\\/]generated[\\/]/.test(f));
}

/** Ids, die in keiner der Dateien als String-Literal (`'id'`, `"id"`, `` `id` ``) vorkommen. */
export function findUnusedSprites(ids: readonly string[], files: readonly string[]): string[] {
  const used = new Set<string>();
  const wanted = new Set(ids);
  const literal = /(['"`])([a-z][a-z0-9_]*)\1/g;
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(literal)) {
      const id = m[2];
      if (id !== undefined && wanted.has(id)) used.add(id);
    }
  }
  return ids.filter((id) => !used.has(id));
}
