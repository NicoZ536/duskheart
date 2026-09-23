/**
 * Sprite-Quellformat (MASTERPROMPT §5, docs/RENDER.md §1): `sprite({...})` prüft eine Sprite-Quelle
 * mit zod, zerlegt die Index-Raster (Template-Strings, Einrückung wird entfernt) und liefert ein
 * `Sprite` mit Palettenindex, Emissiv-Maske und Materialflags je Pixel und Frame.
 *
 * - Legende: ein Zeichen → `rampe.stufe` (Stufen 0-basiert, dunkel → hell) oder `null`
 *   (transparent); `*` am Ende markiert emissive Pixel. Eine Hexfarbe `#rrggbb` ist erlaubt, wenn
 *   sie exakt einer Palettenfarbe entspricht – sonst ist sie ein Farbfehler, den der
 *   Paletten-Validator meldet und an dem der Atlas-Build scheitert.
 * - Struktur (unbekanntes Rasterzeichen, ungleiche Framegrößen, Clips/Sockel/Hitbox außerhalb) ist
 *   ein harter Fehler (`SpriteFormatError`).
 * - `spriteFromPixels()` baut dasselbe `Sprite` aus Index-Puffern (Generatoren, Umfärbungen).
 */
import { z } from 'zod';
import { ID_MAX_LENGTH, ID_PATTERN } from '../../src/content/schema/common';
import { MASTER_COLOR_COUNT, flatPalette, paletteIndex, paletteRef } from '../palette';
import { hexToOklab, nearestPaletteIndex } from './color';

/** Höhen-Hinweise des Normal-/Höhengenerators. */
export const HEIGHT_HINTS = ['flach', 'zylinder', 'kugel', 'block', 'custom'] as const;
export type HeightHint = (typeof HEIGHT_HINTS)[number];

/** Materialflags (Albedo-Atlas Kanal B, docs/RENDER.md §2). */
export const MATERIAL_BITS = { metall: 1, nass: 2, eis: 4, wind: 8, dach: 16 } as const;
export type MaterialFlag = keyof typeof MATERIAL_BITS;
const MATERIAL_FLAGS = Object.keys(MATERIAL_BITS) as MaterialFlag[];

/** §4.3: höchstens 12 Farben je Sprite inklusive Outline (Ausnahmen mit Begründung). */
export const MAX_SPRITE_COLORS = 12;
/** Größte erlaubte Zellkante in Pixeln (Bosse bis 160 px, §4.4). */
export const MAX_CELL_SIZE = 256;
/** Höchste Pixelhöhe über Grund (Normal-Atlas Kanal B: 0…255 ≙ 0…32 px). */
export const MAX_HEIGHT_PX = 32;
/** Palettenindex für transparente Pixel. */
export const TRANSPARENT = 0;
/** Mindestlänge einer Begründung (`ausnahmeFarben`, `einzelpixel`). */
export const MIN_REASON_LENGTH = 10;
/** Höchste Abspielrate eines Clips (Bilder je Sekunde, Simulationstakt). */
export const MAX_CLIP_FPS = 60;
/** Zahlenbasis der Höhen-Raster-Ziffern (`0`–`9`, `a`–`w` = 0…32 px). */
const HEIGHT_DIGIT_RADIX = 36;
/** Zeichen im Höhen-Raster für „automatisch nach Höhen-Hinweis“. */
const HEIGHT_AUTO = '.';
/** Markierung emissiver Legendenwerte. */
const EMISSIVE_MARK = '*';
/** `-1` im Höhen-Override: automatisch. */
export const HEIGHT_AUTO_VALUE = -1;

// ---------------------------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------------------------

const intSchema = z.number().int();
const dimSchema = intSchema.min(1).max(MAX_CELL_SIZE);
const pairSchema = z.tuple([intSchema, intSchema]);
const idSchema = z.string().max(ID_MAX_LENGTH).regex(ID_PATTERN, { message: 'snake_case erwartet (a-z, 0-9, einzelne "_")' });
const reasonSchema = z.string().trim().min(MIN_REASON_LENGTH, { message: `Begründung mit mindestens ${MIN_REASON_LENGTH} Zeichen erwartet` });
/** `rampe.stufe` oder `#rrggbb`, optional mit `*` (emissiv). */
const colorRefSchema = z.string().regex(/^(?:[a-z]+\.\d+|#[0-9a-fA-F]{6})\*?$/, { message: 'Farbe als "rampe.stufe" oder "#rrggbb" (optional mit "*") erwartet' });

const clipSchema = z
  .object({
    frames: z.array(intSchema.min(0)).min(1),
    fps: z.number().positive().max(MAX_CLIP_FPS),
    loop: z.boolean().default(true),
    /** Frame-Events: `frame` ist die Position im Clip (nicht der Sprite-Frame). */
    events: z.array(z.object({ frame: intSchema.min(0), name: idSchema }).strict()).default([]),
  })
  .strict();

const occluderSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('rect'), x: intSchema, y: intSchema, w: dimSchema, h: dimSchema }).strict(),
  z.object({ kind: z.literal('ellipse'), x: z.number(), y: z.number(), rx: z.number().positive(), ry: z.number().positive() }).strict(),
  z.object({ kind: z.literal('sprite') }).strict(),
]);

/** Gemeinsame Metadaten der Text- und Pixel-Quellen. */
const metaShape = {
  id: idSchema,
  /** Kontaktbogen-Gruppe; ohne Angabe der Ordnername unter `assets-src/sprites/`. */
  group: idSchema.optional(),
  size: z.tuple([dimSchema, dimSchema]),
  anchor: pairSchema,
  hoehe: z.enum(HEIGHT_HINTS),
  clips: z.record(idSchema, clipSchema).optional(),
  hitbox: z.tuple([intSchema, intSchema, dimSchema, dimSchema]).optional(),
  sockets: z.record(idSchema, z.array(pairSchema).min(1)).optional(),
  occluder: occluderSchema.optional(),
  schatten: z.enum(['silhouette', 'none']).optional(),
  /** Nur mit Begründung: mehr als 12 Farben (§4.3). */
  ausnahmeFarben: reasonSchema.optional(),
  /** Nur mit Begründung: beabsichtigte Einzelpixel (Funken, Glanzpunkte) – unterdrückt die Warnung. */
  einzelpixel: reasonSchema.optional(),
  /** Symmetrisch gezeichnet: der Renderer darf spiegeln (§4.5 „Spiegelung nur bei Symmetrie“). */
  spiegelbar: z.boolean().optional(),
};

export const spriteSourceSchema = z
  .object({
    ...metaShape,
    legende: z.record(z.string(), colorRefSchema.nullable()),
    frames: z.array(z.string()).min(1),
    /** Zeichen mit Materialflags, z. B. `{ metall: 'Mm', nass: 'W' }`; `true` = alle deckenden Pixel. */
    material: z.partialRecord(z.enum(MATERIAL_FLAGS as [MaterialFlag, ...MaterialFlag[]]), z.union([z.string().min(1), z.literal(true)])).optional(),
    /** Manuelle Höhen (Override): Raster aus `.` (automatisch) und Ziffern `0`–`9`, `a`–`w` (px). */
    hoehenRaster: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
  })
  .strict();
export type SpriteSource = z.input<typeof spriteSourceSchema>;

export const pixelSpriteMetaSchema = z.object(metaShape).strict();
export type PixelSpriteMeta = z.input<typeof pixelSpriteMetaSchema>;

// ---------------------------------------------------------------------------------------------
// Ergebnis
// ---------------------------------------------------------------------------------------------

/** Ein Frame: je Pixel Palettenindex, Emissiv (0/1), Materialflags und optional manuelle Höhe. */
export interface SpriteFrame {
  readonly index: Uint8Array;
  readonly emissive: Uint8Array;
  readonly material: Uint8Array;
  /** Höhe in px je Pixel, `HEIGHT_AUTO_VALUE` = automatisch; `null` = keine Überschreibung. */
  readonly heightOverride: Int8Array | null;
}

export interface SpriteClipEvent {
  readonly frame: number;
  readonly name: string;
}

export interface SpriteClip {
  readonly frames: readonly number[];
  readonly fps: number;
  readonly loop: boolean;
  readonly events: readonly SpriteClipEvent[];
}

export type Occluder =
  | { readonly kind: 'none' }
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: 'ellipse'; readonly x: number; readonly y: number; readonly rx: number; readonly ry: number }
  | { readonly kind: 'sprite' };

export type Point = readonly [number, number];

export interface Sprite {
  readonly kind: 'sprite';
  readonly id: string;
  /** `null`: Gruppe = Ordnername (setzt die Sprite-Suche). */
  readonly group: string | null;
  readonly w: number;
  readonly h: number;
  readonly anchor: Point;
  readonly hoehe: HeightHint;
  readonly frames: readonly SpriteFrame[];
  readonly clips: Readonly<Record<string, SpriteClip>>;
  readonly hitbox: readonly [number, number, number, number] | null;
  /** Sockel je Frame (auf die Frameanzahl erweitert). */
  readonly sockets: Readonly<Record<string, readonly Point[]>>;
  readonly occluder: Occluder;
  readonly schatten: 'silhouette' | 'none';
  readonly spiegelbar: boolean;
  readonly ausnahmeFarben: string | null;
  readonly einzelpixel: string | null;
  /** Farbwerte, die keine Palettenfarbe sind (Validator: Fehler; Atlas: Abbruch). */
  readonly farbFehler: readonly string[];
  /** Anzahl verschiedener Nicht-Palettenfarben in den Pixeln (zählen bei der Farbgrenze mit). */
  readonly fremdFarben: number;
}

/** Strukturfehler einer Sprite-Quelle. */
export class SpriteFormatError extends Error {
  constructor(id: string, detail: string) {
    super(`Sprite ${id}: ${detail}`);
    this.name = 'SpriteFormatError';
  }
}

// ---------------------------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------------------------

/** Zerlegt ein Raster (Template-String) in Zeilen: Einrückung und Leerzeilen fallen weg. */
export function rasterRows(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Ergebnis einer Farbauflösung: Palettenindex oder Fehlertext. */
export type ResolvedColor = { readonly index: number; readonly emissive: boolean } | { readonly error: string };

/** Löst `rampe.stufe[*]` oder `#rrggbb[*]` auf einen Palettenindex (1…64) auf. */
export function resolveColor(value: string): ResolvedColor {
  const emissive = value.endsWith(EMISSIVE_MARK);
  const ref = emissive ? value.slice(0, -1) : value;
  if (ref.startsWith('#')) {
    const hex = ref.toLowerCase();
    const i = flatPalette().indexOf(hex);
    if (i >= 0) return { index: i + 1, emissive };
    const nearest = paletteRef(nearestPaletteIndex(hexToOklab(hex)));
    return { error: `${ref} ist keine Palettenfarbe (nächste: ${nearest})` };
  }
  try {
    return { index: paletteIndex(ref), emissive };
  } catch (err) {
    return { error: `${ref} ist keine Palettenfarbe (${(err as Error).message})` };
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.map(String).join('.') || '(Quelle)'}: ${i.message}`).join('; ');
}

type ParsedMeta = z.output<typeof pixelSpriteMetaSchema>;

/** Prüft Anker, Hitbox, Clips, Sockel und Occluder gegen Zellgröße und Frameanzahl. */
function checkMeta(meta: ParsedMeta, frameCount: number): void {
  const [w, h] = meta.size;
  const fail = (detail: string): never => {
    throw new SpriteFormatError(meta.id, detail);
  };
  const [ax, ay] = meta.anchor;
  if (ax < 0 || ay < 0 || ax > w || ay > h) fail(`Anker (${ax}, ${ay}) liegt außerhalb der Zelle ${w}×${h}`);
  if (meta.hitbox !== undefined) {
    const [hx, hy, hw, hh] = meta.hitbox;
    if (hx < 0 || hy < 0 || hx + hw > w || hy + hh > h) fail(`Hitbox [${meta.hitbox.join(', ')}] ragt aus der Zelle ${w}×${h}`);
  }
  for (const [name, clip] of Object.entries(meta.clips ?? {})) {
    for (const f of clip.frames) if (f >= frameCount) fail(`Clip ${name} nennt Frame ${f}, es gibt nur ${frameCount}`);
    for (const e of clip.events) if (e.frame >= clip.frames.length) fail(`Clip ${name}: Event ${e.name} auf Clip-Position ${e.frame}, Clip hat ${clip.frames.length} Frames`);
  }
  for (const [name, points] of Object.entries(meta.sockets ?? {})) {
    if (points.length !== 1 && points.length !== frameCount) fail(`Sockel ${name}: ${points.length} Punkte, erwartet 1 oder ${frameCount} (je Frame)`);
    for (const [sx, sy] of points) if (sx < 0 || sy < 0 || sx >= w || sy >= h) fail(`Sockel ${name} (${sx}, ${sy}) liegt außerhalb der Zelle`);
  }
  const occ = meta.occluder;
  if (occ?.kind === 'rect' && (occ.x < 0 || occ.y < 0 || occ.x + occ.w > w || occ.y + occ.h > h)) fail('Occluder-Rechteck ragt aus der Zelle');
  if (occ?.kind === 'ellipse' && (occ.x < 0 || occ.y < 0 || occ.x > w || occ.y > h)) fail('Occluder-Ellipse: Mittelpunkt liegt außerhalb der Zelle');
}

function buildSprite(meta: ParsedMeta, frames: SpriteFrame[], farbFehler: string[], fremdFarben: number): Sprite {
  const clips: Record<string, SpriteClip> = {};
  for (const [name, c] of Object.entries(meta.clips ?? {})) clips[name] = { frames: [...c.frames], fps: c.fps, loop: c.loop, events: c.events.map((e) => ({ ...e })) };
  const sockets: Record<string, Point[]> = {};
  for (const [name, points] of Object.entries(meta.sockets ?? {})) {
    sockets[name] = frames.map((_, i) => {
      const p = points.length === 1 ? points[0] : points[i];
      if (p === undefined) throw new SpriteFormatError(meta.id, `Sockel ${name}: Frame ${i} fehlt`);
      return [p[0], p[1]] as const;
    });
  }
  return {
    kind: 'sprite',
    id: meta.id,
    group: meta.group ?? null,
    w: meta.size[0],
    h: meta.size[1],
    anchor: [meta.anchor[0], meta.anchor[1]],
    hoehe: meta.hoehe,
    frames,
    clips,
    hitbox: meta.hitbox === undefined ? null : [meta.hitbox[0], meta.hitbox[1], meta.hitbox[2], meta.hitbox[3]],
    sockets,
    occluder: meta.occluder ?? { kind: 'none' },
    schatten: meta.schatten ?? (meta.hoehe === 'flach' ? 'none' : 'silhouette'),
    spiegelbar: meta.spiegelbar ?? false,
    ausnahmeFarben: meta.ausnahmeFarben ?? null,
    einzelpixel: meta.einzelpixel ?? null,
    farbFehler,
    fremdFarben,
  };
}

function parseHeightRaster(id: string, text: string, w: number, h: number, where: string): Int8Array {
  const rows = rasterRows(text);
  if (rows.length !== h) throw new SpriteFormatError(id, `${where}: ${rows.length} Zeilen, erwartet ${h}`);
  const out = new Int8Array(w * h).fill(HEIGHT_AUTO_VALUE);
  rows.forEach((row, y) => {
    if (row.length !== w) throw new SpriteFormatError(id, `${where} Zeile ${y}: ${row.length} Zeichen, erwartet ${w}`);
    for (let x = 0; x < w; x++) {
      const c = row.charAt(x);
      if (c === HEIGHT_AUTO) continue;
      const v = Number.parseInt(c, HEIGHT_DIGIT_RADIX);
      if (!Number.isInteger(v) || v > MAX_HEIGHT_PX) throw new SpriteFormatError(id, `${where} (${x}, ${y}): "${c}" ist keine Höhe 0…${MAX_HEIGHT_PX} (Ziffern 0–9, a–w)`);
      out[y * w + x] = v;
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// sprite()
// ---------------------------------------------------------------------------------------------

/** Parst eine Sprite-Quelle (Index-Raster + Legende). Wirft `SpriteFormatError` bei Strukturfehlern. */
export function sprite(source: SpriteSource): Sprite {
  const parsed = spriteSourceSchema.safeParse(source);
  const label = typeof source.id === 'string' ? source.id : '(ohne id)';
  if (!parsed.success) throw new SpriteFormatError(label, formatIssues(parsed.error));
  const src = parsed.data;
  const { id } = src;
  const [w, h] = src.size;
  const fail = (detail: string): never => {
    throw new SpriteFormatError(id, detail);
  };

  // Legende: einzelne, sichtbare Zeichen; Farben auflösen.
  const legend = new Map<string, { index: number; emissive: boolean; error: string | null } | null>();
  const farbFehler: string[] = [];
  for (const [char, value] of Object.entries(src.legende)) {
    if ([...char].length !== 1 || /\s/.test(char) || char === EMISSIVE_MARK) fail(`Legendenzeichen "${char}" muss genau ein sichtbares Zeichen außer "${EMISSIVE_MARK}" sein`);
    if (value === null) {
      legend.set(char, null);
      continue;
    }
    const r = resolveColor(value);
    if ('error' in r) {
      farbFehler.push(`Legende "${char}": ${r.error}`);
      legend.set(char, { index: TRANSPARENT, emissive: false, error: value });
    } else legend.set(char, { index: r.index, emissive: r.emissive, error: null });
  }

  // Materialflags je Legendenzeichen.
  const flagsOf = new Map<string, number>();
  for (const [flag, chars] of Object.entries(src.material ?? {}) as Array<[MaterialFlag, string | true]>) {
    const bit = MATERIAL_BITS[flag];
    const targets = chars === true ? [...legend.keys()].filter((c) => legend.get(c) !== null) : [...chars];
    for (const c of targets) {
      if (!legend.has(c)) fail(`Material ${flag}: Zeichen "${c}" fehlt in der Legende`);
      flagsOf.set(c, (flagsOf.get(c) ?? 0) | bit);
    }
  }

  // Höhen-Override: ein Raster für alle Frames oder eines je Frame.
  const heightRasters = src.hoehenRaster === undefined ? [] : typeof src.hoehenRaster === 'string' ? [src.hoehenRaster] : src.hoehenRaster;
  if (heightRasters.length > 1 && heightRasters.length !== src.frames.length) fail(`hoehenRaster: ${heightRasters.length} Raster für ${src.frames.length} Frames`);
  if (src.hoehe === 'custom' && heightRasters.length === 0) fail('Höhen-Hinweis "custom" braucht ein hoehenRaster');
  const heights = heightRasters.map((t, i) => parseHeightRaster(id, t, w, h, `hoehenRaster ${i}`));

  const usedBad = new Set<string>();
  const frames = src.frames.map((text, f): SpriteFrame => {
    const rows = rasterRows(text);
    if (rows.length !== h) fail(`Frame ${f}: ${rows.length} Zeilen, erwartet ${h} (Zellgröße ${w}×${h}, alle Frames gleich groß)`);
    const index = new Uint8Array(w * h);
    const emissive = new Uint8Array(w * h);
    const material = new Uint8Array(w * h);
    rows.forEach((row, y) => {
      const chars = [...row];
      if (chars.length !== w) fail(`Frame ${f} Zeile ${y}: ${chars.length} Zeichen, erwartet ${w} (alle Frames gleich groß)`);
      chars.forEach((c, x) => {
        const entry = legend.get(c);
        if (entry === undefined) fail(`Frame ${f} (${x}, ${y}): Zeichen "${c}" fehlt in der Legende`);
        if (entry === null || entry === undefined) return;
        const p = y * w + x;
        if (entry.error !== null) usedBad.add(entry.error);
        index[p] = entry.index;
        emissive[p] = entry.emissive ? 1 : 0;
        material[p] = flagsOf.get(c) ?? 0;
      });
    });
    const heightOverride = heights.length === 0 ? null : (heights.length === 1 ? heights[0] : heights[f]) ?? null;
    return { index, emissive, material, heightOverride };
  });

  checkMeta(src, frames.length);
  return buildSprite(src, frames, farbFehler, usedBad.size);
}

// ---------------------------------------------------------------------------------------------
// spriteFromPixels()
// ---------------------------------------------------------------------------------------------

/** Pixelpuffer eines Frames (Generatoren, Umfärbungen). */
export interface PixelFrameInput {
  readonly index: Uint8Array;
  readonly emissive?: Uint8Array;
  readonly material?: Uint8Array;
  readonly heightOverride?: Int8Array | null;
}

/** Baut ein `Sprite` aus Index-Puffern (w·h Palettenindizes je Frame, 0 = transparent). */
export function spriteFromPixels(meta: PixelSpriteMeta, frames: readonly PixelFrameInput[]): Sprite {
  const parsed = pixelSpriteMetaSchema.safeParse(meta);
  const label = typeof meta.id === 'string' ? meta.id : '(ohne id)';
  if (!parsed.success) throw new SpriteFormatError(label, formatIssues(parsed.error));
  const m = parsed.data;
  const [w, h] = m.size;
  if (frames.length === 0) throw new SpriteFormatError(m.id, 'mindestens ein Frame erwartet');
  const farbFehler: string[] = [];
  const out = frames.map((fr, f): SpriteFrame => {
    for (const [name, buf] of [
      ['index', fr.index],
      ['emissive', fr.emissive],
      ['material', fr.material],
      ['heightOverride', fr.heightOverride],
    ] as const) {
      if (buf !== undefined && buf !== null && buf.length !== w * h) throw new SpriteFormatError(m.id, `Frame ${f}: ${name} hat ${buf.length} Pixel, erwartet ${w * h} (alle Frames gleich groß)`);
    }
    const index = Uint8Array.from(fr.index);
    index.forEach((v, p) => {
      if (v > MASTER_COLOR_COUNT) {
        farbFehler.push(`Frame ${f} (${p % w}, ${Math.floor(p / w)}): Index ${v} liegt außerhalb der Palette`);
        index[p] = TRANSPARENT;
      }
    });
    return {
      index,
      emissive: fr.emissive === undefined ? new Uint8Array(w * h) : Uint8Array.from(fr.emissive, (v) => (v > 0 ? 1 : 0)),
      material: fr.material === undefined ? new Uint8Array(w * h) : Uint8Array.from(fr.material),
      heightOverride: fr.heightOverride === undefined || fr.heightOverride === null ? null : Int8Array.from(fr.heightOverride),
    };
  });
  checkMeta(m, out.length);
  return buildSprite(m, out, farbFehler, farbFehler.length > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------
// Auswertungen
// ---------------------------------------------------------------------------------------------

/** Verschiedene Palettenindizes (ohne Transparenz) über alle Frames, aufsteigend. */
export function spriteColors(s: Sprite): number[] {
  const seen = new Set<number>();
  for (const f of s.frames) for (const v of f.index) if (v !== TRANSPARENT) seen.add(v);
  return [...seen].sort((a, b) => a - b);
}

/** Farbanzahl für die 12-Farben-Grenze: Palettenfarben + Nicht-Palettenfarben. */
export function spriteColorCount(s: Sprite): number {
  return spriteColors(s).length + s.fremdFarben;
}

/** Ob mindestens ein Pixel emissiv ist. */
export function spriteHasEmissive(s: Sprite): boolean {
  return s.frames.some((f) => f.emissive.some((v, p) => v > 0 && f.index[p] !== TRANSPARENT));
}

/** Oder-Verknüpfung aller Materialflags des Sprites. */
export function spriteMaterialFlags(s: Sprite): number {
  let flags = 0;
  for (const f of s.frames) for (const v of f.material) flags |= v;
  return flags;
}

/** Ob ein Wert ein geparstes `Sprite` ist (Sprite-Suche). */
export function isSprite(value: unknown): value is Sprite {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'sprite';
}
