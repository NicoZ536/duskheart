/**
 * Schreibt das typisierte Atlas-Manifest `src/generated/atlas.ts` (docs/RENDER.md §2): Atlasgröße und
 * -dateien, je Sprite Frames/Anker/Hitbox/Sockel/Clips/Occluder/Sonnenschatten/Höhen-Hinweis/Emissiv/
 * Gruppe, die Palettenzeilen-Tabelle, die Materialstufen und den Quell-Hash.
 *
 * Dazu die Palettenzeilen-Regel der Welt-Objekt-Sprites (`OBJEKT_ZEILEN`, M2-28), damit der Renderer
 * `assets-src/` nicht importiert: abgeleitet aus `objektZeile()` (`assets-src/paletteRows.ts`) –
 * Jahreszeitzeilen (Bäume je Art, Büsche) oder die Biomzeile des Tiles (geteilte Streudeko, Erze,
 * Kristalle); Sprites ohne Eintrag nehmen `basis`.
 */
import { BIOME_TINTS, JAHRESZEITEN, MATERIAL_TIERS, objektZeile, type Jahreszeit, type PaletteRow } from '../../assets-src/paletteRows';
import { MASTER_COLOR_COUNT } from '../../assets-src/palette';
import { MATERIAL_BITS, MAX_HEIGHT_PX } from '../../assets-src/lib/sprite';
import type { AtlasBuild } from './atlas';

/** URLs der Atlanten relativ zur Vite-Basis (`public/generated/…`). */
export const ATLAS_FILES = { albedo: 'generated/atlas-albedo.png', normal: 'generated/atlas-normal.png' } as const;

const TYPES = `/** Höhen-Hinweis des Normal-/Höhengenerators. */
export type HeightHint = 'flach' | 'zylinder' | 'kugel' | 'block' | 'custom';
/** Rechteck in Pixeln (Atlas- oder Zellkoordinaten, y nach unten). */
export interface AtlasRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
/** Punkt in Zellkoordinaten (px, y nach unten). */
export type AtlasPoint = readonly [number, number];
export interface AtlasClipEvent {
  /** Position im Clip (nicht Sprite-Frame). */
  readonly frame: number;
  readonly name: string;
}
export interface AtlasClip {
  /** Sprite-Frames in Abspielreihenfolge. */
  readonly frames: readonly number[];
  readonly fps: number;
  readonly loop: boolean;
  readonly events: readonly AtlasClipEvent[];
}
export type AtlasOccluder =
  | { readonly kind: 'none' }
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: 'ellipse'; readonly x: number; readonly y: number; readonly rx: number; readonly ry: number }
  | { readonly kind: 'sprite' };
/** Sonnenschatten: Silhouette (Deckung der Frames), am Fußpunkt \`basisY\` geschert; \`bounds\` in Zellkoordinaten. */
export type AtlasSunShadow = { readonly kind: 'none' } | { readonly kind: 'silhouette'; readonly basisY: number; readonly bounds: AtlasRect };
export interface AtlasSprite {
  readonly id: string;
  /** Kontaktbogen-Gruppe. */
  readonly group: string;
  /** Zellgröße [w, h] je Frame. */
  readonly size: readonly [number, number];
  /** Fußpunkt (y-Sortierung, Platzierung). */
  readonly anchor: AtlasPoint;
  readonly hitbox: AtlasRect | null;
  /** Sockel je Frame (Länge = Frameanzahl). */
  readonly sockets: Readonly<Record<string, readonly AtlasPoint[]>>;
  /** Atlas-Rechteck je Frame (identische Frames teilen sich ein Rechteck). */
  readonly frames: readonly AtlasRect[];
  readonly clips: Readonly<Record<string, AtlasClip>>;
  readonly occluder: AtlasOccluder;
  readonly schatten: AtlasSunShadow;
  readonly hoehe: HeightHint;
  /** Mindestens ein emissives Pixel. */
  readonly emissiv: boolean;
  /** Oder-Verknüpfung aller Materialflags (MATERIAL_BITS). */
  readonly material: number;
  /** Deckende Pixel aller Frames in Zellkoordinaten. */
  readonly bounds: AtlasRect;
  /** Symmetrisch: darf gespiegelt werden. */
  readonly spiegelbar: boolean;
  /** Anzahl Palettenfarben. */
  readonly farben: number;
}
/** Palettenzeile: \`map[i]\` = Zielindex (1…64) für Palettenindex \`i + 1\`. */
export interface PaletteRowEntry {
  readonly id: string;
  readonly beschreibung: string;
  readonly map: readonly number[];
}
/** Palettenzeile eines Welt-Objekts: Jahreszeitzeile (Frühling, Sommer, Herbst, Winter) oder die Biomzeile des Tiles. */
export type ObjektZeilenRegel = { readonly regel: 'jahreszeit'; readonly zeilen: readonly [string, string, string, string] } | { readonly regel: 'biom' };
`;

type ObjektZeilenRegel = { readonly regel: 'jahreszeit'; readonly zeilen: readonly [string, string, string, string] } | { readonly regel: 'biom' };

/**
 * Palettenzeilen-Regel eines Sprites aus `objektZeile()` über alle Biome × Jahreszeiten: `null` =
 * immer `basis`; `biom` = in jeder Jahreszeit die Biomzeile des Tiles; `jahreszeit` = je Jahreszeit
 * eine vom Biom unabhängige Zeile. Eine Regel, die beides mischt, kann der Renderer nicht abbilden
 * (dafür gäbe es vorberechnete Kombinationszeilen, docs/ART.md §5) und bricht den Build ab.
 */
export function objektZeilenRegel(spriteId: string): ObjektZeilenRegel | null {
  const zeilen = JAHRESZEITEN.map((j: Jahreszeit) => BIOME_TINTS.map((b) => objektZeile(spriteId, b.biom, j)));
  if (zeilen.every((jz) => jz.every((z) => z === 'basis'))) return null;
  if (zeilen.every((jz) => jz.every((z, i) => z === BIOME_TINTS[i]?.zeile))) return { regel: 'biom' };
  const jeJahreszeit = zeilen.map((jz) => jz[0] ?? 'basis');
  if (zeilen.every((jz, j) => jz.every((z) => z === jeJahreszeit[j]))) {
    const [f = 'basis', s = 'basis', h = 'basis', w = 'basis'] = jeJahreszeit;
    return { regel: 'jahreszeit', zeilen: [f, s, h, w] };
  }
  throw new Error(`Manifest: Palettenzeile von ${spriteId} hängt von Biom und Jahreszeit zugleich ab – dafür braucht es eine vorberechnete Kombinationszeile (docs/ART.md §5)`);
}

function list(values: readonly unknown[]): string {
  return values.length === 0 ? '[]' : `[\n${values.map((v) => `  ${JSON.stringify(v)},`).join('\n')}\n]`;
}

/** TypeScript-Quelltext des Manifests. */
export function manifestSource(build: AtlasBuild, rows: readonly PaletteRow[], sourceHash: string): string {
  const atlas = {
    width: build.width,
    height: build.height,
    albedoUrl: ATLAS_FILES.albedo,
    normalUrl: ATLAS_FILES.normal,
    sourceHash,
    paletteSize: MASTER_COLOR_COUNT,
    maxHeightPx: MAX_HEIGHT_PX,
  };
  const spriteEntries = build.sprites.map((s) => `  ${JSON.stringify(s.id)}: ${JSON.stringify(s)},`).join('\n');
  const tiers = MATERIAL_TIERS.map((t) => ({ id: t.id, stufe: t.stufe, zeile: t.zeile }));
  const rowIndex = Object.fromEntries(rows.map((r, i) => [r.id, i]));
  const rowIds = new Set(rows.map((r) => r.id));
  const objektZeilen: Record<string, ObjektZeilenRegel> = {};
  for (const s of build.sprites) {
    const regel = objektZeilenRegel(s.id);
    if (regel === null) continue;
    const fehlt = regel.regel === 'jahreszeit' ? regel.zeilen.filter((z) => !rowIds.has(z)) : BIOME_TINTS.map((b) => b.zeile).filter((z) => !rowIds.has(z));
    if (fehlt.length > 0) throw new Error(`Manifest: ${s.id} verweist auf fehlende Palettenzeilen ${fehlt.join(', ')}`);
    objektZeilen[s.id] = regel;
  }
  return [
    '// Generiert von tools/assets (npm run assets). Nicht bearbeiten – Quellen: assets-src/.',
    TYPES,
    '/** Atlasgröße, Dateien (relativ zur Vite-Basis) und Quell-Hash. Normal-Atlas: RG = 0,5 + 0,5·n (+x rechts, +y oben, +z zum Betrachter), B = Höhe (0…255 ≙ 0…maxHeightPx). */',
    `export const ATLAS = ${JSON.stringify(atlas)} as const;`,
    '',
    '/** Materialflags im Albedo-Atlas (Kanal B). */',
    `export const MATERIAL_BITS = ${JSON.stringify(MATERIAL_BITS)} as const;`,
    '',
    `export const SPRITE_IDS = ${list(build.sprites.map((s) => s.id))} as const;`,
    'export type SpriteId = (typeof SPRITE_IDS)[number];',
    '',
    `export const SPRITES: Readonly<Record<SpriteId, AtlasSprite>> = {${spriteEntries.length > 0 ? `\n${spriteEntries}\n` : ''}};`,
    '',
    `export const PALETTE_ROW_IDS = ${list(rows.map((r) => r.id))} as const;`,
    'export type PaletteRowId = (typeof PALETTE_ROW_IDS)[number];',
    '',
    '/** Palettenzeilen (Zeile 0 = basis); der Renderer baut daraus die LUT (64 × Zeilen). */',
    `export const PALETTE_ROWS: readonly PaletteRowEntry[] = ${list(rows.map((r) => ({ id: r.id, beschreibung: r.beschreibung, map: r.map })))};`,
    '',
    `export const PALETTE_ROW: Readonly<Record<PaletteRowId, number>> = ${JSON.stringify(rowIndex)};`,
    '',
    '/** Materialstufen T0–T7 mit ihrer Palettenzeile. */',
    `export const MATERIAL_TIERS = ${list(tiers)} as const;`,
    '',
    '/** Palettenzeilen-Regel der Welt-Objekt-Sprites (assets-src/paletteRows.ts `objektZeile`); ohne Eintrag gilt `basis`. */',
    `export const OBJEKT_ZEILEN: Readonly<Record<string, ObjektZeilenRegel>> = ${JSON.stringify(objektZeilen)};`,
    '',
  ].join('\n');
}
