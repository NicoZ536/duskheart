/**
 * The Builders' vaults (docs/SPIEL.md §19, MASTERPROMPT §21; ADR-0207; strand C – collections `roomTemplates`,
 * `vaultTilesets`, `puzzleTypes`, `vaultTraps`, `tablets`): ASCII room templates of 16 × 16 tiles per cell, the tileset of a
 * biome, the puzzle types with their variants (each solvable by its solver), the vault traps (named apart from the M6 traps
 * `traps`) and the Builder tablets. The zod schemas producing these types are strand C's.
 */
import { z } from 'zod';
import { DAMAGE_TYPE_IDS, type DamageTypeId } from '../balance/combat';
import { idSchema, localizedTextSchema, type LocalizedText } from '../schema/common';

export const VAULT_ROLES = ['start', 'gang', 'kammer', 'schluessel', 'schloss', 'raetsel', 'falle', 'schatz', 'endkammer'] as const;
export type VaultRole = (typeof VAULT_ROLES)[number];
export const ROOM_SLOTS = ['raetsel', 'falle', 'truhe', 'waechter', 'tafel', 'splitter', 'boss'] as const;
export type RoomSlotKind = (typeof ROOM_SLOTS)[number];

/** ASCII room template (`src/content/dungeons/<tileset>/<id>.ts`): 16 × 16 tiles per cell. */
export interface RoomTemplateDef {
  readonly id: string;
  readonly tileset: string;
  readonly rolle: VaultRole;
  readonly zellen: { readonly b: 1 | 2; readonly t: 1 | 2 };
  /** 16·b chars × 16·t rows; legend of the tileset (`#` wall, `.` floor, `D` door socket …). */
  readonly zeilen: readonly string[];
  readonly tueren: readonly { readonly seite: 'n' | 'o' | 's' | 'w'; readonly zelle: number; readonly versatz: number }[];
  readonly plaetze: readonly { readonly art: RoomSlotKind; readonly tx: number; readonly ty: number }[];
}
export interface VaultTilesetDef {
  readonly id: string;
  readonly biom: string;
  readonly boden: string;
  readonly wand: string;
  readonly legende: Readonly<Record<string, { readonly boden?: string; readonly objekt?: string }>>;
}
/** One puzzle variant; solvable by the solver of its type (unit test per variant). */
export type PuzzleVariantDef =
  | { readonly typ: 'kisten'; readonly id: string; readonly karte: readonly string[] }
  | { readonly typ: 'hebel'; readonly id: string; readonly hebel: number; readonly folge: readonly number[] }
  | { readonly typ: 'feuerschalen'; readonly id: string; readonly schalen: number; readonly folge: readonly number[] }
  | { readonly typ: 'verborgene_wand'; readonly id: string; readonly waende: number; readonly echt: readonly number[] }
  | { readonly typ: 'glocken'; readonly id: string; readonly glocken: number; readonly toene: readonly number[]; readonly folge: readonly number[] };
export interface PuzzleTypeDef {
  readonly id: PuzzleVariantDef['typ'];
  readonly name: LocalizedText;
  readonly beschreibung: LocalizedText;
  readonly hinweis: LocalizedText;
  readonly varianten: readonly PuzzleVariantDef[];
}
export interface VaultTrapDef {
  readonly id: string;
  readonly name: LocalizedText;
  readonly schaden: number;
  readonly schadensart: DamageTypeId;
  /** Warning before it strikes [s] (≥ 0.4, §4.6). */
  readonly telegraphSekunden: number;
  readonly abklingSekunden: number;
  readonly ausloeser: 'platte' | 'naehe' | 'takt';
  /** Rolling stone: back after this many seconds; collapsing floor: stays open (chunk diff). */
  readonly resetSekunden?: number;
  readonly bleibtOffen?: boolean;
  readonly sprite: string;
  readonly sound: string;
}
export interface TabletDef {
  readonly id: string;
  readonly nummer: number;
  readonly titel: LocalizedText;
  readonly text: LocalizedText;
  readonly fundort: { readonly art: 'gewoelbe'; readonly rolle?: VaultRole } | { readonly art: 'ort'; readonly ortstyp: string };
}

// ---------------------------------------------------------------------------------------------
// zod schemas (strand C, M7-10 … M7-14, M7-46)
// ---------------------------------------------------------------------------------------------

/** Edge of one template cell [tiles] (docs/SPIEL.md §19 "Zellen zu 16 × 16 Kacheln"). */
export const ROOM_CELL_TILES = 16;
/**
 * Door sockets sit in the middle of a cell side: two tiles wide, from `DOOR_OFFSET` on (tiles 7 and 8 of the 16). So any two
 * templates whose cells touch along a side meet with their sockets – the embedding needs no fitting of door positions.
 */
export const DOOR_OFFSET = 7;
/** Width of a doorway [tiles]. */
export const DOOR_WIDTH = 2;
/**
 * The puzzle area a `raetsel` slot opens [tiles]: its north-west corner is the slot, a ring of one floor tile around it stays
 * free, so the room's doors stay connected whatever the puzzle builds inside (kisten maps, rows of levers, bowls, bells or
 * cracked walls; src/game/puzzles/layout.ts).
 */
export const PUZZLE_AREA = { w: 10, h: 8 } as const;

/** Characters every template understands (any tileset): wall, floor, door socket, the way up of a start room. */
export const ROOM_WALL = '#';
export const ROOM_FLOOR = '.';
export const ROOM_DOOR = 'D';
export const ROOM_ENTRANCE = 'E';
/** Structural characters (not in a tileset's legend). */
export const ROOM_STRUCTURE: readonly string[] = [ROOM_WALL, ROOM_FLOOR, ROOM_DOOR, ROOM_ENTRANCE];
/** Where the way up of a start room lies (the vault's box is centred on the entrance, src/world/gen/vaults/embed.ts). */
export const START_ENTRANCE = { tx: 8, ty: 8 } as const;

const SIDES = ['n', 'o', 's', 'w'] as const;

/** The tiles of door socket `d` in a template of `b × t` cells (two tiles, west to east or north to south). */
export function doorSocketTiles(d: RoomTemplateDef['tueren'][number], b: number, t: number): readonly [readonly [number, number], readonly [number, number]] {
  const w = b * ROOM_CELL_TILES;
  const h = t * ROOM_CELL_TILES;
  const along = d.zelle * ROOM_CELL_TILES + d.versatz;
  switch (d.seite) {
    case 'n':
      return [
        [along, 0],
        [along + 1, 0],
      ];
    case 's':
      return [
        [along, h - 1],
        [along + 1, h - 1],
      ];
    case 'w':
      return [
        [0, along],
        [0, along + 1],
      ];
    default:
      return [
        [w - 1, along],
        [w - 1, along + 1],
      ];
  }
}

export const roomTemplateSchema = z
  .object({
    id: idSchema,
    tileset: idSchema,
    rolle: z.enum(VAULT_ROLES),
    zellen: z.object({ b: z.union([z.literal(1), z.literal(2)]), t: z.union([z.literal(1), z.literal(2)]) }).strict(),
    zeilen: z.array(z.string().min(1)).min(ROOM_CELL_TILES),
    tueren: z.array(z.object({ seite: z.enum(SIDES), zelle: z.number().int().min(0).max(1), versatz: z.literal(DOOR_OFFSET) }).strict()).min(1),
    plaetze: z.array(z.object({ art: z.enum(ROOM_SLOTS), tx: z.number().int().min(0), ty: z.number().int().min(0) }).strict()),
  })
  .strict()
  .superRefine((r, ctx) => {
    const w = r.zellen.b * ROOM_CELL_TILES;
    const h = r.zellen.t * ROOM_CELL_TILES;
    if (r.zeilen.length !== h) ctx.addIssue({ code: 'custom', path: ['zeilen'], message: `${h} rows (16 per cell), got ${r.zeilen.length}` });
    r.zeilen.forEach((row, y) => {
      if (row.length !== w) ctx.addIssue({ code: 'custom', path: ['zeilen', y], message: `rows are ${w} wide (16 per cell), row ${y} has ${row.length}` });
    });
    const at = (x: number, y: number): string => r.zeilen[y]?.charAt(x) ?? '';
    // The outer ring is wall or door socket: rooms touch only through their sockets.
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (at(x, y) !== ROOM_WALL && at(x, y) !== ROOM_DOOR) ctx.addIssue({ code: 'custom', path: ['zeilen', y], message: `the outer ring is wall or door socket, (${x}, ${y}) is "${at(x, y)}"` });
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (at(x, y) !== ROOM_WALL && at(x, y) !== ROOM_DOOR) ctx.addIssue({ code: 'custom', path: ['zeilen', y], message: `the outer ring is wall or door socket, (${x}, ${y}) is "${at(x, y)}"` });
    // Every socket lies on its side's cells and is drawn as "DD"; every "D" belongs to a socket.
    const socket = new Set<number>();
    r.tueren.forEach((d, k) => {
      const cells = d.seite === 'n' || d.seite === 's' ? r.zellen.b : r.zellen.t;
      if (d.zelle >= cells) {
        ctx.addIssue({ code: 'custom', path: ['tueren', k, 'zelle'], message: `side ${d.seite} has ${cells} cell(s)` });
        return;
      }
      for (const [x, y] of doorSocketTiles(d, r.zellen.b, r.zellen.t)) {
        if (at(x, y) !== ROOM_DOOR) ctx.addIssue({ code: 'custom', path: ['tueren', k], message: `socket tile (${x}, ${y}) is drawn "${at(x, y)}", not "${ROOM_DOOR}"` });
        socket.add(y * w + x);
      }
    });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y) === ROOM_DOOR && !socket.has(y * w + x)) ctx.addIssue({ code: 'custom', path: ['zeilen', y], message: `"${ROOM_DOOR}" at (${x}, ${y}) belongs to no socket of tueren` });
    // Slots stand on floor inside the room.
    r.plaetze.forEach((p, k) => {
      if (p.tx <= 0 || p.ty <= 0 || p.tx >= w - 1 || p.ty >= h - 1) ctx.addIssue({ code: 'custom', path: ['plaetze', k], message: `slot (${p.tx}, ${p.ty}) lies on or outside the outer ring` });
      else if (p.art !== 'raetsel' && at(p.tx, p.ty) !== ROOM_FLOOR) ctx.addIssue({ code: 'custom', path: ['plaetze', k], message: `slot ${p.art} (${p.tx}, ${p.ty}) is drawn "${at(p.tx, p.ty)}", not floor` });
    });
    // The puzzle area of a raetsel slot and its free ring are floor.
    for (const [k, p] of r.plaetze.entries()) {
      if (p.art !== 'raetsel') continue;
      for (let y = p.ty - 1; y <= p.ty + PUZZLE_AREA.h; y++) {
        for (let x = p.tx - 1; x <= p.tx + PUZZLE_AREA.w; x++) {
          if (at(x, y) !== ROOM_FLOOR) {
            ctx.addIssue({ code: 'custom', path: ['plaetze', k], message: `puzzle area ${PUZZLE_AREA.w}×${PUZZLE_AREA.h} at (${p.tx}, ${p.ty}) with its ring needs floor, (${x}, ${y}) is "${at(x, y)}"` });
            return;
          }
        }
      }
    }
    const entrances: [number, number][] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y) === ROOM_ENTRANCE) entrances.push([x, y]);
    if (r.rolle === 'start') {
      if (r.zellen.b !== 1 || r.zellen.t !== 1) ctx.addIssue({ code: 'custom', path: ['zellen'], message: 'a start room is one cell (the box is centred on its way up)' });
      const [e] = entrances;
      if (entrances.length !== 1 || e === undefined || e[0] !== START_ENTRANCE.tx || e[1] !== START_ENTRANCE.ty) ctx.addIssue({ code: 'custom', path: ['zeilen'], message: `a start room has exactly one "${ROOM_ENTRANCE}" at (${START_ENTRANCE.tx}, ${START_ENTRANCE.ty})` });
    } else if (entrances.length > 0) ctx.addIssue({ code: 'custom', path: ['zeilen'], message: `only a start room has the way up "${ROOM_ENTRANCE}"` });
    const has = (art: RoomSlotKind): boolean => r.plaetze.some((p) => p.art === art);
    if (r.rolle === 'raetsel' && !has('raetsel')) ctx.addIssue({ code: 'custom', path: ['plaetze'], message: 'a puzzle room has a raetsel slot' });
    if (r.rolle !== 'raetsel' && has('raetsel')) ctx.addIssue({ code: 'custom', path: ['plaetze'], message: 'only a puzzle room has a raetsel slot' });
    if (r.rolle === 'endkammer' && !has('boss')) ctx.addIssue({ code: 'custom', path: ['plaetze'], message: 'the end chamber has a boss slot' });
    if (r.rolle !== 'endkammer' && has('boss')) ctx.addIssue({ code: 'custom', path: ['plaetze'], message: 'only the end chamber has a boss slot' });
    if (r.rolle === 'endkammer' && !has('truhe')) ctx.addIssue({ code: 'custom', path: ['plaetze'], message: 'the end chamber has its chest slot (the end chest)' });
  }) satisfies z.ZodType<RoomTemplateDef>;
/** One room template as written in the content files. */
export type RoomTemplateInput = z.input<typeof roomTemplateSchema>;

export const vaultTilesetSchema = z
  .object({
    id: idSchema,
    biom: idSchema,
    boden: idSchema,
    wand: idSchema,
    legende: z.record(z.string().length(1), z.object({ boden: idSchema.optional(), objekt: idSchema.optional() }).strict()),
  })
  .strict()
  .superRefine((t, ctx) => {
    for (const ch of Object.keys(t.legende)) if (ROOM_STRUCTURE.includes(ch)) ctx.addIssue({ code: 'custom', path: ['legende', ch], message: `"${ch}" is a structural character of every template` });
  }) satisfies z.ZodType<VaultTilesetDef>;
export type VaultTilesetInput = z.input<typeof vaultTilesetSchema>;

/** Characters of a `kisten` map: wall, floor, plate, crate, crate on a plate, the entry, the reset rune. */
export const KISTEN_CHARS = { wall: '#', floor: '.', plate: 'o', crate: '$', crateOnPlate: '*', entry: '@', reset: 'R' } as const;
const KISTEN_ALLOWED = new Set<string>(Object.values(KISTEN_CHARS));
/** Bounds of the puzzles (they must fit their area and stay readable). */
export const PUZZLE_LIMITS = { partsMin: 3, partsMax: 5, sequenceMin: 3, sequenceMax: 8, toneMax: 12, platesMin: 2 } as const;

const parts = z.number().int().min(PUZZLE_LIMITS.partsMin).max(PUZZLE_LIMITS.partsMax);
const sequence = z.array(z.number().int().min(0)).min(PUZZLE_LIMITS.sequenceMin).max(PUZZLE_LIMITS.sequenceMax);

function checkSequence(ctx: z.RefinementCtx, folge: readonly number[], count: number, path: string): void {
  folge.forEach((i, k) => {
    if (i >= count) ctx.addIssue({ code: 'custom', path: [path, k], message: `index ${i} ≥ ${count}` });
  });
}

const kistenVariantSchema = z
  .object({ typ: z.literal('kisten'), id: idSchema, karte: z.array(z.string().min(3)).min(3).max(PUZZLE_AREA.h) })
  .strict()
  .superRefine((v, ctx) => {
    const w = v.karte[0]?.length ?? 0;
    if (w > PUZZLE_AREA.w) ctx.addIssue({ code: 'custom', path: ['karte'], message: `at most ${PUZZLE_AREA.w} wide` });
    let entries = 0;
    let crates = 0;
    let plates = 0;
    v.karte.forEach((row, y) => {
      if (row.length !== w) ctx.addIssue({ code: 'custom', path: ['karte', y], message: 'rows have equal length' });
      [...row].forEach((ch, x) => {
        if (!KISTEN_ALLOWED.has(ch)) ctx.addIssue({ code: 'custom', path: ['karte', y], message: `"${ch}" is no kisten character` });
        const border = x === 0 || y === 0 || x === w - 1 || y === v.karte.length - 1;
        if (border && ch !== KISTEN_CHARS.wall && ch !== KISTEN_CHARS.entry) ctx.addIssue({ code: 'custom', path: ['karte', y], message: `the border is wall except the entry, (${x}, ${y}) is "${ch}"` });
        if (ch === KISTEN_CHARS.entry) entries++;
        if (ch === KISTEN_CHARS.crate || ch === KISTEN_CHARS.crateOnPlate) crates++;
        if (ch === KISTEN_CHARS.plate || ch === KISTEN_CHARS.crateOnPlate) plates++;
      });
    });
    if (entries !== 1) ctx.addIssue({ code: 'custom', path: ['karte'], message: `exactly one entry "${KISTEN_CHARS.entry}"` });
    if (plates < PUZZLE_LIMITS.platesMin || crates !== plates) ctx.addIssue({ code: 'custom', path: ['karte'], message: `as many crates as plates, at least ${PUZZLE_LIMITS.platesMin} (crates ${crates}, plates ${plates})` });
  });

const hebelVariantSchema = z
  .object({ typ: z.literal('hebel'), id: idSchema, hebel: parts, folge: sequence })
  .strict()
  .superRefine((v, ctx) => checkSequence(ctx, v.folge, v.hebel, 'folge'));

const feuerschalenVariantSchema = z
  .object({ typ: z.literal('feuerschalen'), id: idSchema, schalen: parts, folge: sequence })
  .strict()
  .superRefine((v, ctx) => {
    checkSequence(ctx, v.folge, v.schalen, 'folge');
    // A lit bowl stays lit: the order names each bowl once.
    if (new Set(v.folge).size !== v.folge.length) ctx.addIssue({ code: 'custom', path: ['folge'], message: 'each bowl is lit once' });
  });

const verborgeneWandVariantSchema = z
  .object({ typ: z.literal('verborgene_wand'), id: idSchema, waende: parts, echt: z.array(z.number().int().min(0)).min(1) })
  .strict()
  .superRefine((v, ctx) => {
    checkSequence(ctx, v.echt, v.waende, 'echt');
    if (new Set(v.echt).size !== v.echt.length) ctx.addIssue({ code: 'custom', path: ['echt'], message: 'each real wall once' });
    if (v.echt.length >= v.waende) ctx.addIssue({ code: 'custom', path: ['echt'], message: 'at least one cracked wall is false (else there is nothing to find)' });
  });

const glockenVariantSchema = z
  .object({ typ: z.literal('glocken'), id: idSchema, glocken: parts, toene: z.array(z.number().int().min(0).max(PUZZLE_LIMITS.toneMax)), folge: sequence })
  .strict()
  .superRefine((v, ctx) => {
    checkSequence(ctx, v.folge, v.glocken, 'folge');
    if (v.toene.length !== v.glocken) ctx.addIssue({ code: 'custom', path: ['toene'], message: `one tone per bell (${v.glocken})` });
    if (new Set(v.toene).size !== v.toene.length) ctx.addIssue({ code: 'custom', path: ['toene'], message: 'every bell rings its own tone' });
  });

export const puzzleVariantSchema = z.discriminatedUnion('typ', [kistenVariantSchema, hebelVariantSchema, feuerschalenVariantSchema, verborgeneWandVariantSchema, glockenVariantSchema]) satisfies z.ZodType<PuzzleVariantDef>;

export const puzzleTypeSchema = z
  .object({
    id: z.enum(['kisten', 'hebel', 'feuerschalen', 'verborgene_wand', 'glocken']),
    name: localizedTextSchema,
    beschreibung: localizedTextSchema,
    hinweis: localizedTextSchema,
    varianten: z.array(puzzleVariantSchema).min(3),
  })
  .strict()
  .superRefine((p, ctx) => {
    p.varianten.forEach((v, k) => {
      if (v.typ !== p.id) ctx.addIssue({ code: 'custom', path: ['varianten', k], message: `a variant of ${p.id} is of type ${p.id}` });
      if (!v.id.startsWith(`${p.id}_`)) ctx.addIssue({ code: 'custom', path: ['varianten', k, 'id'], message: `variant ids are ${p.id}_<n>` });
    });
    if (new Set(p.varianten.map((v) => v.id)).size !== p.varianten.length) ctx.addIssue({ code: 'custom', path: ['varianten'], message: 'variant ids are unique' });
  }) satisfies z.ZodType<PuzzleTypeDef>;
export type PuzzleTypeInput = z.input<typeof puzzleTypeSchema>;

export const VAULT_TRAP_TRIGGERS = ['platte', 'naehe', 'takt'] as const;
/** Least warning before a trap strikes [s] (§4.6 "Telegraph", docs/SPIEL.md §19 "Telegraph ≥ 0,4 s"). */
export const TRAP_TELEGRAPH_MIN = 0.4;

export const vaultTrapSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    schaden: z.number().positive(),
    schadensart: z.enum(DAMAGE_TYPE_IDS),
    telegraphSekunden: z.number().min(TRAP_TELEGRAPH_MIN),
    abklingSekunden: z.number().positive(),
    ausloeser: z.enum(VAULT_TRAP_TRIGGERS),
    resetSekunden: z.number().positive().optional(),
    bleibtOffen: z.boolean().optional(),
    sprite: idSchema,
    sound: idSchema,
  })
  .strict()
  .refine((t) => !(t.bleibtOffen === true && t.resetSekunden !== undefined), { message: 'a floor that stays open does not reset', path: ['resetSekunden'] }) satisfies z.ZodType<VaultTrapDef>;
export type VaultTrapInput = z.input<typeof vaultTrapSchema>;

/** Number of Builder tablets in the whole game (MASTERPROMPT §C "Erbauer-Tafeln 60"); M7 has the first ten. */
export const TABLETS_TOTAL = 60;

export const tabletSchema = z
  .object({
    id: idSchema,
    nummer: z.number().int().min(1).max(TABLETS_TOTAL),
    titel: localizedTextSchema,
    text: localizedTextSchema,
    fundort: z.union([z.object({ art: z.literal('gewoelbe'), rolle: z.enum(VAULT_ROLES).optional() }).strict(), z.object({ art: z.literal('ort'), ortstyp: idSchema }).strict()]),
  })
  .strict()
  .refine((t) => t.id === `tafel_${String(t.nummer).padStart(2, '0')}`, { message: 'a tablet is tafel_<nn> after its number', path: ['id'] }) satisfies z.ZodType<TabletDef>;
export type TabletInput = z.input<typeof tabletSchema>;
