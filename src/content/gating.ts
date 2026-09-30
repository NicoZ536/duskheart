/**
 * Tiers and gating as content (MASTERPROMPT §13.2 "Stufen & Gating"; M4-33): "Abbaukraft des Werkzeugs muss ≥
 * Härte der Ressource sein. Die Spitzhacke jeder Stufe ab T1 braucht den Schlüssel-Drop des Bosses dieser
 * Stufe – so erschließt jeder Boss die nächste Welt. Waffen und Rüstung einer Stufe brauchen keinen Boss-Drop."
 *
 * - `GATING_TIERS`: the table of §13.2 – per tier T0–T7 the tool material, the mining power, the key drop the
 *   pickaxe of the tier needs and the boss that drops it, the resources the tier's tools open and the biomes.
 *   Key drops and bosses are named here before their content exists (bosses M6–M12; the pickaxes with their
 *   recipes: T1 M7-34, T2 M8-29, T4 M10-26, T5 M10-27, T6 M12-14, T7 M12-18).
 * - `RESOURCE_HARDNESS`: hardness per resource – ores (`erz:<ore>`, src/content/ores.ts) and ground that needs
 *   a tool of a tier (`boden:<terrain>`, src/content/terrain.ts `dig`).
 * - `GEPLANTE_STUFENAUSRUESTUNG`: tiers whose tools exist before their weapon or armour set does, with the
 *   backlog task that brings it (PROGRESS.md). The validator rule `gating` (tools/validator/gating.ts) holds the
 *   content to all of this: mining power per tier, hardness per resource, every pickaxe of a tier ≥ T1 needs the
 *   tier's key drop, weapons and armour never need a boss drop, and every tier whose tools exist has a weapon and
 *   an armour set without a boss drop – or a planned task for them.
 */
import { z } from 'zod';
import { deepFreeze } from './freeze';
import { idSchema, localizedTextSchema, tierSchema } from './schema/common';

/** The key drop a tier's pickaxe needs and the boss that drops it. */
export const tierKeySchema = z.object({ item: idSchema, boss: idSchema }).strict();

/** Schema of one tier of the §13.2 table. */
export const gatingTierSchema = z
  .object({
    stufe: tierSchema,
    /** Tool material of the tier. */
    material: localizedTextSchema,
    /** Mining power of the tier's tools. */
    abbaukraft: z.number().int().min(1),
    /** What the tier's pickaxe needs (`null` for T0). */
    schluessel: tierKeySchema.nullable(),
    /** Resources the tier's tools open (keys of `RESOURCE_HARDNESS`). */
    erschliesst: z.array(z.string().min(1)),
    /** Biomes of the tier (ids of src/content/biomes.ts). */
    biome: z.array(idSchema),
  })
  .strict();

/** One tier of the table. */
export type GatingTier = z.output<typeof gatingTierSchema>;

/** Error in the gating content. */
export class GatingContentError extends Error {
  override readonly name = 'GatingContentError';
}

/** Validates the tier table: one entry per tier T0–T7 in order, a key drop exactly from T1 on. */
export function defineGatingTiers(raw: readonly z.input<typeof gatingTierSchema>[]): readonly GatingTier[] {
  const tiers = raw.map((t, i) => {
    const r = gatingTierSchema.safeParse(t);
    if (!r.success) throw new GatingContentError(`gating tier [${i}] invalid: ${r.error.issues.map((x) => `${x.path.map(String).join('.')}: ${x.message}`).join('; ')}`);
    if (r.data.stufe !== i) throw new GatingContentError(`gating tier [${i}] must be tier T${i}, is T${r.data.stufe}`);
    if ((r.data.schluessel === null) !== (i === 0)) throw new GatingContentError(`gating tier T${i}: ${i === 0 ? 'T0 needs no key drop' : 'every pickaxe from T1 on needs a key drop'}`);
    return r.data;
  });
  deepFreeze(tiers);
  return tiers;
}

/** The §13.2 table. */
export const GATING_TIERS = defineGatingTiers([
  { stufe: 0, material: { de: 'Stein, Feuerstein, Knochen', en: 'Stone, flint, bone' }, abbaukraft: 1, schluessel: null, erschliesst: ['erz:kupfer', 'erz:zinn'], biome: ['gruenhain', 'wurzelhoehlen'] },
  { stufe: 1, material: { de: 'Bronze', en: 'Bronze' }, abbaukraft: 2, schluessel: { item: 'kernholz', boss: 'borkenvater' }, erschliesst: ['erz:raseneisen', 'erz:eisen', 'boden:torf'], biome: ['nebelmoor', 'tiefgrund'] },
  { stufe: 2, material: { de: 'Eisen', en: 'Iron' }, abbaukraft: 3, schluessel: { item: 'sumpfherz', boss: 'sumpfmutter' }, erschliesst: ['erz:kohle', 'erz:silber'], biome: ['frostkamm'] },
  { stufe: 3, material: { de: 'Stahl', en: 'Steel' }, abbaukraft: 4, schluessel: { item: 'wyrmhorn', boss: 'hrimgar' }, erschliesst: ['erz:gold', 'erz:klarquarz'], biome: ['glutsand', 'tiefgrund'] },
  { stufe: 4, material: { de: 'Sonnenstahl', en: 'Sunsteel' }, abbaukraft: 5, schluessel: { item: 'sonnenchitin', boss: 'skarabaeus_koloss' }, erschliesst: ['erz:obsidian', 'erz:magmit', 'erz:schwefel'], biome: ['aschenschlund', 'glutadern'] },
  { stufe: 5, material: { de: 'Magmit', en: 'Magmite' }, abbaukraft: 6, schluessel: { item: 'glutamboss_kern', boss: 'aschenschmied' }, erschliesst: ['erz:lumenit', 'erz:prismenquarz'], biome: ['scherbenhain', 'glutadern'] },
  { stufe: 6, material: { de: 'Lumenit', en: 'Lumenite' }, abbaukraft: 7, schluessel: { item: 'prismenherz', boss: 'gefallene_hueterin' }, erschliesst: ['erz:nachtstahl'], biome: ['nachtherz'] },
  { stufe: 7, material: { de: 'Nachtstahl', en: 'Nightsteel' }, abbaukraft: 8, schluessel: { item: 'herz_der_nacht', boss: 'verschlinger' }, erschliesst: [], biome: [] },
]);

/**
 * Hardness per resource [mining power needed] (§13.2 / M4-33: "Kupfer/Zinn 1 · Raseneisen/Eisenerz/Torf 2 ·
 * Steinkohle/Silber 3 · Gold/Klarquarz 4 · Obsidian/Magmit/Schwefel 5 · Lumenit/Prismenquarz 6 ·
 * Nachtstahl-Erz 7"). Saltpetre and gemstones are not in the table (src/content/ores.ts gives them the hardness
 * of the tier that opens their biome's deeper resources).
 */
export const RESOURCE_HARDNESS: Readonly<Record<string, number>> = deepFreeze({
  'erz:kupfer': 1,
  'erz:zinn': 1,
  'erz:raseneisen': 2,
  'erz:eisen': 2,
  'boden:torf': 2,
  'erz:kohle': 3,
  'erz:silber': 3,
  'erz:gold': 4,
  'erz:klarquarz': 4,
  'erz:obsidian': 5,
  'erz:magmit': 5,
  'erz:schwefel': 5,
  'erz:lumenit': 6,
  'erz:prismenquarz': 6,
  'erz:nachtstahl': 7,
});

/** Parts of a resource key: `erz:<ore>` or `boden:<terrain>`. */
export function parseResourceKey(key: string): { art: 'erz' | 'boden'; id: string } | null {
  const m = /^(erz|boden):([a-z][a-z0-9_]*)$/.exec(key);
  return m === null ? null : { art: m[1] as 'erz' | 'boden', id: m[2] as string };
}

/** The armour slots an armour set covers (§13.1; M6-12 "je 4 Teile"). */
export const ARMOR_SET_SLOTS = ['kopf', 'brust', 'beine', 'fuesse'] as const;

/** A tier's weapon or armour set that a later task brings. */
export interface GeplanteStufenausruestung {
  /** Task that brings the weapon (PROGRESS.md), when the tier has none yet. */
  readonly waffe?: string;
  /** Task that brings the armour set, when the tier has none yet. */
  readonly ruestung?: string;
}

/**
 * Tiers whose tools exist before their weapon or armour set (tier → planned tasks). The validator rule `gating`
 * enforces it both ways: a tier with tools but without weapon or armour set and without an open planned task is
 * an error, as is a planned task that is done while the piece is still missing; a planned entry whose piece
 * exists is stale (a warning – then it is struck here).
 */
export const GEPLANTE_STUFENAUSRUESTUNG: Readonly<Record<number, GeplanteStufenausruestung>> = deepFreeze({
  // T0 and T1 are complete since M6-11/M6-12 (weapons of every class, the fibre set T0, the leather and bronze sets T1);
  // the tiers from T2 on have no tools yet, so nothing is planned here.
});
