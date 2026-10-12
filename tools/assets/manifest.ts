/**
 * Schreibt das typisierte Atlas-Manifest `src/generated/atlas.ts` (docs/RENDER.md §2): Atlasgröße und
 * -dateien, je Sprite Frames/Anker/Hitbox/Sockel/Clips/Occluder/Sonnenschatten/Höhen-Hinweis/Emissiv/
 * Gruppe, die Palettenzeilen-Tabelle, die Materialstufen und den Quell-Hash.
 *
 * Die Sprite-Tabelle `SPRITES` ist eine `SpriteTable` (src/render/assets/spriteTable.ts, M7-151): die Köpfe der Sprites als
 * JSON-Text (`JSON.parse`, M7-130: kein Objektliteral mit Vorlagen im Heap), Frames, Clips und Sockel aller Sprites als
 * Spalten in Typed Arrays – eindeutige Frame-Rechtecke, eindeutige Clip-Sequenzen und eindeutige Sockelpunkte je einmal,
 * die Sprites als Spannen darin –, die das Modul je Sprite beim ersten Lesen von `frames`, `clips` oder `sockets`
 * entschlüsselt. So liegen nach dem Laden ein Dutzend Typed Arrays statt rund 110 000 kleiner Objekte im Alt-Speicher
 * (ADR-0315: die Lücken, die der Speicherreduzierer bei 30 s räumt, stammen aus der Modulauswertung). Jeder Frame nennt
 * seinen Anker (`ax`, `ay`), jeder Clip seinen Namen; der Renderer übernimmt die Einträge der Tabelle selbst, ohne Kopie
 * (src/render/assets/generated.ts).
 *
 * Dazu die Palettenzeilen-Regel der Welt-Objekt-Sprites (`OBJEKT_ZEILEN`, M2-28), damit der Renderer
 * `assets-src/` nicht importiert: abgeleitet aus `objektZeile()` (`assets-src/paletteRows.ts`) –
 * Jahreszeitzeilen (Bäume je Art, Büsche) oder die Biomzeile des Tiles (geteilte Streudeko, Erze,
 * Kristalle); Sprites ohne Eintrag nehmen `basis`.
 */
import { BIOME_TINTS, JAHRESZEITEN, MATERIAL_TIERS, objektZeile, type Jahreszeit, type PaletteRow } from '../../assets-src/paletteRows';
import { MASTER_COLOR_COUNT } from '../../assets-src/palette';
import { MATERIAL_BITS, MAX_HEIGHT_PX } from '../../assets-src/lib/sprite';
import { EVENT_INTS, POINT_INTS, RECT_INTS, SEQUENCE_INTS, SOCKET_INTS, SpriteTable, type SpriteColumns, type SpriteHeader } from '../../src/render/assets/spriteTable';
import type { AtlasBuild, ManifestSprite } from './atlas';

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
/** Atlas-Rechteck eines Frames mit dem Anker in diesem Rechteck: der Zell-Anker, bei einem beschnittenen Frame (Sprite-Angabe \`zuschnitt\`) minus Schnitt. */
export interface AtlasFrame extends AtlasRect {
  readonly ax: number;
  readonly ay: number;
}
/** Punkt in Zellkoordinaten (px, y nach unten). */
export type AtlasPoint = readonly [number, number];
export interface AtlasClipEvent {
  /** Position im Clip (nicht Sprite-Frame). */
  readonly frame: number;
  readonly name: string;
}
export interface AtlasClip {
  /** Name des Clips (sein Schlüssel in \`clips\`). */
  readonly name: string;
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
/** Ein Sprite der Tabelle: \`frames\`, \`clips\` und \`sockets\` werden beim ersten Lesen aus den Spalten entschlüsselt (M7-151, \`SpriteEntry\`). */
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
  readonly frames: readonly AtlasFrame[];
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

/** Ein Sprite, wie die Tabelle es entschlüsselt zeigt: jeder Clip trägt seinen Namen (Tests bauen daraus Module aus reinen Daten). */
export function manifestSprite(s: ManifestSprite): Omit<ManifestSprite, 'clips'> & { readonly clips: Readonly<Record<string, { readonly name: string } & ManifestSprite['clips'][string]>> } {
  const clips: Record<string, { readonly name: string } & ManifestSprite['clips'][string]> = {};
  for (const [name, c] of Object.entries(s.clips)) clips[name] = { name, frames: c.frames, fps: c.fps, loop: c.loop, events: c.events };
  return { ...s, clips };
}

/** Die Sprite-Tabelle des Manifests (Sprite-Id → Sprite) als Objekt aus reinen Daten (entschlüsselte Sicht). */
export function manifestSprites(build: AtlasBuild): Record<string, ReturnType<typeof manifestSprite>> {
  const out: Record<string, ReturnType<typeof manifestSprite>> = {};
  for (const s of build.sprites) out[s.id] = manifestSprite(s);
  return out;
}

/** Die Spalten der Sprite-Tabelle als Zahlen- und Namenslisten (die Quelle schreibt sie als Typed Arrays). */
export type SpriteColumnLists = { readonly [K in keyof SpriteColumns]: SpriteColumns[K] extends Int32Array | Float64Array ? readonly number[] : readonly string[] };

/** Die Daten der Sprite-Tabelle: Köpfe in Sprite-Reihenfolge und die Spalten (`SpriteColumns`). */
export interface SpriteTableData {
  readonly headers: readonly SpriteHeader[];
  readonly columns: SpriteColumnLists;
}

/** Index von `key` in `table`, neu vergeben in Reihenfolge des ersten Auftretens. */
function intern(table: Map<string, number>, key: string, onNew: () => void): number {
  const known = table.get(key);
  if (known !== undefined) return known;
  const index = table.size;
  table.set(key, index);
  onNew();
  return index;
}

/**
 * Köpfe und Spalten der Sprite-Tabelle aus den Sprites des Atlas-Builds (M7-151): je Sprite eine Spanne seiner Frames
 * (Index je Frame ins eindeutige Rechteck), Clips (Name, eindeutige Frame-Sequenz, Bildrate, Schleife, Ereignisse) und
 * Sockel (Name, Punktindex je Frame ins eindeutige Punktpaar). Deterministisch: Reihenfolge der Sprites, Clips (Schlüssel)
 * und Sockel (Schlüssel) wie im Build.
 */
export function spriteTableData(sprites: readonly ManifestSprite[]): SpriteTableData {
  const headers: SpriteHeader[] = [];
  const spans: number[] = [];
  const rects: number[] = [];
  const rectIndex = new Map<string, number>();
  const frames: number[] = [];
  const clipNames: string[] = [];
  const clipNameIndex = new Map<string, number>();
  const clips: number[] = [];
  const clipFps: number[] = [];
  const sequences: number[] = [];
  const sequenceIndex = new Map<string, number>();
  const clipFrames: number[] = [];
  const eventNames: string[] = [];
  const eventNameIndex = new Map<string, number>();
  const events: number[] = [];
  const socketNames: string[] = [];
  const socketNameIndex = new Map<string, number>();
  const sockets: number[] = [];
  const socketPoints: number[] = [];
  const points: number[] = [];
  const pointIndex = new Map<string, number>();
  for (const s of sprites) {
    headers.push({ id: s.id, group: s.group, size: s.size, anchor: s.anchor, hitbox: s.hitbox, occluder: s.occluder, schatten: s.schatten, hoehe: s.hoehe, emissiv: s.emissiv, material: s.material, bounds: s.bounds, spiegelbar: s.spiegelbar, farben: s.farben });
    const frameStart = frames.length;
    for (const f of s.frames) frames.push(intern(rectIndex, `${f.x},${f.y},${f.w},${f.h},${f.ax},${f.ay}`, () => rects.push(f.x, f.y, f.w, f.h, f.ax, f.ay)));
    const clipStart = clipFps.length;
    for (const [name, c] of Object.entries(s.clips)) {
      const sequence = intern(sequenceIndex, c.frames.join(','), () => {
        sequences.push(clipFrames.length, c.frames.length);
        clipFrames.push(...c.frames);
      });
      const eventStart = events.length / EVENT_INTS;
      for (const e of c.events) events.push(e.frame, intern(eventNameIndex, e.name, () => eventNames.push(e.name)));
      clips.push(intern(clipNameIndex, name, () => clipNames.push(name)), sequence, c.loop ? 1 : 0, eventStart, c.events.length);
      clipFps.push(c.fps);
    }
    const socketStart = sockets.length / SOCKET_INTS;
    for (const [name, track] of Object.entries(s.sockets)) {
      if (track.length !== s.frames.length) throw new Error(`Manifest: ${s.id} – Sockel ${name} hat ${track.length} Punkte für ${s.frames.length} Frames`);
      sockets.push(intern(socketNameIndex, name, () => socketNames.push(name)), socketPoints.length);
      for (const p of track) socketPoints.push(intern(pointIndex, `${p[0]},${p[1]}`, () => points.push(p[0], p[1])));
    }
    spans.push(frameStart, s.frames.length, clipStart, clipFps.length - clipStart, socketStart, sockets.length / SOCKET_INTS - socketStart);
  }
  return { headers, columns: { spans, rects, frames, clipNames, clips, clipFps, sequences, clipFrames, eventNames, events, socketNames, sockets, socketPoints, points } };
}

/** Die Spalten als Typed Arrays, wie das Modul sie hält. */
export function typedColumns(c: SpriteColumnLists): SpriteColumns {
  return {
    spans: Int32Array.from(c.spans),
    rects: Int32Array.from(c.rects),
    frames: Int32Array.from(c.frames),
    clipNames: c.clipNames,
    clips: Int32Array.from(c.clips),
    clipFps: Float64Array.from(c.clipFps),
    sequences: Int32Array.from(c.sequences),
    clipFrames: Int32Array.from(c.clipFrames),
    eventNames: c.eventNames,
    events: Int32Array.from(c.events),
    socketNames: c.socketNames,
    sockets: Int32Array.from(c.sockets),
    socketPoints: Int32Array.from(c.socketPoints),
    points: Int32Array.from(c.points),
  };
}

/** Die Sprite-Tabelle des Builds, wie das Modul sie hält (Tests: die entschlüsselte Sicht gegen `manifestSprites`). */
export function spriteTableOf(build: AtlasBuild): SpriteTable {
  const data = spriteTableData(build.sprites);
  return new SpriteTable(data.headers, typedColumns(data.columns));
}

/** Konstruktor-Ausdruck der Typed-Array-Spalte `values` (`Int32Array` oder `Float64Array`). */
function typedSource(ctor: 'Int32Array' | 'Float64Array', values: readonly number[]): string {
  for (const v of values) if (ctor === 'Int32Array' && !(Number.isInteger(v) && v >= -(2 ** 31) && v < 2 ** 31)) throw new Error(`Manifest: Spaltenwert ${v} passt nicht in Int32Array`);
  return `new ${ctor}(${jsonParseSource(values)})`;
}

/** Quelltext der Sprite-Tabelle: `new SpriteTable(<Köpfe als JSON>, { <Spalten als Typed Arrays> })`. */
export function spriteTableSource(data: SpriteTableData): string {
  const c = data.columns;
  const lines = [
    `new SpriteTable(${jsonParseSource(data.headers)}, {`,
    `  spans: ${typedSource('Int32Array', c.spans)},`,
    `  rects: ${typedSource('Int32Array', c.rects)},`,
    `  frames: ${typedSource('Int32Array', c.frames)},`,
    `  clipNames: ${jsonParseSource(c.clipNames)},`,
    `  clips: ${typedSource('Int32Array', c.clips)},`,
    `  clipFps: ${typedSource('Float64Array', c.clipFps)},`,
    `  sequences: ${typedSource('Int32Array', c.sequences)},`,
    `  clipFrames: ${typedSource('Int32Array', c.clipFrames)},`,
    `  eventNames: ${jsonParseSource(c.eventNames)},`,
    `  events: ${typedSource('Int32Array', c.events)},`,
    `  socketNames: ${jsonParseSource(c.socketNames)},`,
    `  sockets: ${typedSource('Int32Array', c.sockets)},`,
    `  socketPoints: ${typedSource('Int32Array', c.socketPoints)},`,
    `  points: ${typedSource('Int32Array', c.points)},`,
    '})',
  ];
  return lines.join('\n');
}

/**
 * `JSON.parse` of `value` as TypeScript source: the JSON text in a template literal (no quote to escape, so the text stays
 * readable and searchable in the generated file), with backslashes, backticks and `${` escaped.
 */
export function jsonParseSource(value: unknown): string {
  const json = JSON.stringify(value).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return `JSON.parse(\`${json}\`)`;
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
  const table = spriteTableData(build.sprites);
  const columnCount = Object.keys(table.columns).length;
  return [
    '// Generiert von tools/assets (npm run assets). Nicht bearbeiten – Quellen: assets-src/.',
    "import { SpriteTable } from '../render/assets/spriteTable';",
    '',
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
    `/** Sprite-Köpfe als JSON (M7-130) und die ${columnCount} Spalten ihrer Frames, Clips und Sockel als Typed Arrays (M7-151): ${build.sprites.length} Sprites, ${table.columns.frames.length} Frames auf ${table.columns.rects.length / RECT_INTS} Rechtecken, ${table.columns.clipFps.length} Clips auf ${table.columns.sequences.length / SEQUENCE_INTS} Sequenzen, ${table.columns.sockets.length / SOCKET_INTS} Sockel mit ${table.columns.socketPoints.length} Punkten auf ${table.columns.points.length / POINT_INTS} Paaren. */`,
    `const TABLE = ${spriteTableSource(table)};`,
    '',
    '/** Sprites nach Id: die Einträge der Tabelle (`frames`, `clips`, `sockets` beim ersten Lesen entschlüsselt). */',
    'export const SPRITES: Readonly<Record<SpriteId, AtlasSprite>> = TABLE.sprites;',
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
    `export const OBJEKT_ZEILEN: Readonly<Record<string, ObjektZeilenRegel>> = ${jsonParseSource(objektZeilen)};`,
    '',
  ].join('\n');
}
