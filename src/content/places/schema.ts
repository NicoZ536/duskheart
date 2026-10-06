/**
 * Places (docs/SPIEL.md §18, MASTERPROMPT §21; strand B – the `gewoelbe` record by C, `bossarena` by F, same schema;
 * ADR-0207): the location types that fill the slots of `GeneratedWorld.locations`, their ASCII layouts and their chest loot.
 *
 * - `locationTypes` (`PlaceDef`, id = a `LocationType` of src/world/gen/locations.ts – the content layer does not import the
 *   world, the validator checks it): name, description, chronicle line, map symbol, discovery stinger and radius, guards
 *   (owned creatures, `CreatureSystem.spawnOwned`), effect (look-out, blessing, dig site, tablet, crater, beacon site …).
 *   Only records with `zaehlt` count towards §C "Ortstypen".
 * - `placeLayouts`: ASCII templates per type and biome (`src/content/places/layouts/<ortstyp>_<biom>_<nn>.ts`); the
 *   generator's step `orte` picks one per slot (seed, slot id) and stamps it into the surface chunks.
 * - `placeLoot`: chest loot `ort_<ortstyp>_<stufe>` (C: `gewoelbe_<biom>_<stufe>`), entries like a creature's loot table.
 */
import { z } from 'zod';
import { lootEntrySchema } from '../creatures/schema';
import { idSchema, localizedTextSchema, type LocalizedText } from '../schema/common';

/** What a place does beyond chests and guards (docs/SPIEL.md §18). */
export const PLACE_EFFECTS = ['keine', 'aussicht', 'segen', 'buddeln', 'tafel', 'krater', 'leuchtfeuer', 'gewoelbe', 'arena'] as const;
export type PlaceEffect = (typeof PLACE_EFFECTS)[number];
/** Marks in a layout that systems read (stamped with world coordinates into `GeneratedWorld.placeLayouts`). */
export const PLACE_MARKS = ['truhe', 'waechter', 'tafel', 'leuchtfeuer', 'altar', 'eingang', 'aussicht', 'buddel', 'arena_rand', 'siegel', 'erz'] as const;
export type PlaceMark = (typeof PLACE_MARKS)[number];

export interface PlaceGuardDef {
  readonly creature: string;
  readonly anzahl: number;
  readonly variante?: number;
  readonly leineTiles?: number;
}

/** One location type (`id` = a `LocationType` of src/world/gen/locations.ts, checked by the validator). Collection `locationTypes`. */
export interface PlaceDef {
  readonly id: string;
  readonly name: LocalizedText;
  readonly beschreibung: LocalizedText;
  /** Chronicle line on discovery (`{name}` = the place's name). */
  readonly chronik: LocalizedText;
  /** Counts towards §C "Ortstypen" (false for `gewoelbe`, `bossarena`, `startstrand`). */
  readonly zaehlt: boolean;
  /** Map symbol sprite (`karte_ort_<id>`). */
  readonly kartensymbol: string;
  /** Music stinger on discovery (`stingers` id, usually `entdeckung`). */
  readonly stinger: string;
  /** Discovery radius around the slot centre [tiles]; absent = slot radius + `BALANCE.places.discoverExtraTiles`. */
  readonly entdeckungTiles?: number;
  readonly waechter: readonly PlaceGuardDef[];
  readonly wirkung: PlaceEffect;
  readonly segen?: { readonly zustand: string; readonly sekunden: number; readonly abklingTage: number };
  readonly aussichtTiles?: number;
}

/** A layout cell of the legend: ground terrain, world object, mark (with free data, e.g. the chest tier or a tablet id). */
export interface PlaceLayoutCell {
  readonly boden?: string;
  readonly objekt?: string;
  readonly marke?: PlaceMark;
  readonly daten?: string;
}
/** ASCII layout of a place (`src/content/places/layouts/<ortstyp>_<biom>_<nn>.ts`). Collection `placeLayouts`. */
export interface PlaceLayoutDef {
  readonly id: string;
  readonly ortstyp: string;
  readonly biom: string;
  /** Variant of the slot it fits (`uraltbaum`); absent = every variant. */
  readonly variante?: string;
  /** Whether the generator may rotate and mirror it. */
  readonly drehbar: boolean;
  readonly legende: Readonly<Record<string, PlaceLayoutCell>>;
  /** Rows of equal length; `.` = keep the generated tile. Must fit into the slot disc (validator). */
  readonly zeilen: readonly string[];
}

/** Chest loot (`ort_<ortstyp>_<stufe>`, C: `gewoelbe_<biom>_<stufe>`). Collection `placeLoot`; entries like the creature loot (`lootEntrySchema`). */
export interface PlaceLootDef {
  readonly id: string;
  readonly ziehungen: readonly [number, number];
  readonly beute: readonly { readonly item: string; readonly gewicht: number; readonly anzahl: readonly [number, number] }[];
  readonly garantiert?: readonly { readonly item: string; readonly anzahl: number }[];
}

/** The layout cell that keeps the generated tile. */
export const LAYOUT_KEEP = '.';

export const placeGuardSchema = z
  .object({ creature: idSchema, anzahl: z.number().int().min(1), variante: z.number().int().min(-1).optional(), leineTiles: z.number().positive().optional() })
  .strict() satisfies z.ZodType<PlaceGuardDef>;

export const placeDefSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    beschreibung: localizedTextSchema,
    chronik: localizedTextSchema,
    zaehlt: z.boolean(),
    kartensymbol: idSchema,
    stinger: idSchema,
    entdeckungTiles: z.number().positive().optional(),
    waechter: z.array(placeGuardSchema),
    wirkung: z.enum(PLACE_EFFECTS),
    segen: z.object({ zustand: idSchema, sekunden: z.number().positive(), abklingTage: z.number().positive() }).strict().optional(),
    aussichtTiles: z.number().positive().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if ((p.wirkung === 'segen') !== (p.segen !== undefined)) ctx.addIssue({ code: 'custom', path: ['segen'], message: 'exactly a shrine (wirkung segen) names its blessing' });
    if ((p.wirkung === 'aussicht') !== (p.aussichtTiles !== undefined)) ctx.addIssue({ code: 'custom', path: ['aussichtTiles'], message: 'exactly a look-out (wirkung aussicht) names the radius it reveals' });
  }) satisfies z.ZodType<PlaceDef>;
/** One location type as written in the content files. */
export type PlaceDefInput = z.input<typeof placeDefSchema>;

export const placeLayoutCellSchema = z
  .object({ boden: idSchema.optional(), objekt: idSchema.optional(), marke: z.enum(PLACE_MARKS).optional(), daten: z.string().min(1).optional() })
  .strict()
  .refine((c) => c.boden !== undefined || c.objekt !== undefined || c.marke !== undefined, { message: 'a legend cell sets ground, an object or a mark' }) satisfies z.ZodType<PlaceLayoutCell>;

export const placeLayoutSchema = z
  .object({
    id: idSchema,
    ortstyp: idSchema,
    biom: idSchema,
    variante: idSchema.optional(),
    drehbar: z.boolean(),
    legende: z.record(z.string().length(1), placeLayoutCellSchema),
    zeilen: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((l, ctx) => {
    if (LAYOUT_KEEP in l.legende) ctx.addIssue({ code: 'custom', path: ['legende'], message: `"${LAYOUT_KEEP}" keeps the generated tile and is no legend entry` });
    const first = l.zeilen[0];
    if (first === undefined) return;
    const width = first.length;
    l.zeilen.forEach((row, y) => {
      if (row.length !== width) ctx.addIssue({ code: 'custom', path: ['zeilen', y], message: `rows have equal length (${width}), row ${y} has ${row.length}` });
      for (const ch of row) if (ch !== LAYOUT_KEEP && !(ch in l.legende)) ctx.addIssue({ code: 'custom', path: ['zeilen', y], message: `"${ch}" is not in the legend` });
    });
  }) satisfies z.ZodType<PlaceLayoutDef>;
/** One layout as written in the content files. */
export type PlaceLayoutInput = z.input<typeof placeLayoutSchema>;

export const placeLootSchema = z
  .object({
    id: idSchema,
    ziehungen: z.tuple([z.number().int().min(0), z.number().int().min(0)]).refine(([a, b]) => b >= a, { message: 'max ≥ min' }),
    beute: z.array(lootEntrySchema).min(1),
    garantiert: z.array(z.object({ item: idSchema, anzahl: z.number().int().min(1) }).strict()).optional(),
  })
  .strict() satisfies z.ZodType<PlaceLootDef>;
/** One chest loot table as written in the content files. */
export type PlaceLootInput = z.input<typeof placeLootSchema>;
