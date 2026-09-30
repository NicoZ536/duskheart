/**
 * Armour sets and their set bonuses (MASTERPROMPT §13.1 "Rüstungssets mit Set-Boni (z. B. Pelz: Isolation · Moorleder:
 * Giftresistenz …)", §C "Rüstungsteile 48 (12 Sets)"; docs/SPIEL.md §14 "Rüstung"; M6-12, M6-31).
 *
 * A set names its pieces (armour items, one per slot of `ARMOR_SET_SLOTS`: head, chest, legs, feet) and its bonuses: from
 * `teile` worn pieces of the set on, `werte` add to the worn equipment's stats (same stats and units as an item's
 * `werte`, src/content/schema/item.ts `ITEM_STATS`). Bonuses stack: with the whole set every bonus up to four pieces
 * counts. Only pieces that are not broken count (§13.1 "Kaputt = unbenutzbar"). The equipment system adds them
 * (src/game/equipment/formulas.ts `setBonusStats`); each set counts once as `armorSets` (§C).
 *
 * Bonuses of T0–T1 (numbers with their reason):
 * - `faser` – light fibre garb, freedom of movement: 2 pieces +5 stamina, 4 pieces +10 stamina more and +5 % walking
 *   tempo (it offsets nothing heavy – the garb is light already; the tempo is its own gain).
 * - `leder` – supple and warm: 2 pieces +2 isolation (§11.2: a cool night's margin), 4 pieces +2 armour (so the set reaches
 *   §D's T1 value 12) and +15 stamina.
 * - `bronze` – protection: 2 pieces +2 armour, 4 pieces +2 armour more (16 in all: a third less damage from a T1 blow than
 *   leather, R/(R+50)) and +15 maximum health.
 */
import { z } from 'zod';
import { deepFreeze } from './freeze';
import { idSchema, localizedTextSchema } from './schema/common';
import { itemStatsSchema } from './schema/item';

/** Pieces a set of §C has (§13.1: head, chest, legs, feet). */
export const ARMOR_SET_PIECES = 4;
/** Fewest worn pieces a bonus can ask for (a single piece is no set). */
export const ARMOR_SET_BONUS_MIN_PIECES = 2;

/** One bonus of a set: from `teile` worn pieces on, `werte` add to the equipment's stats. */
export const armorSetBonusSchema = z
  .object({
    teile: z.number().int().min(ARMOR_SET_BONUS_MIN_PIECES).max(ARMOR_SET_PIECES),
    werte: itemStatsSchema,
    /** What the bonus does, for the tooltip. */
    beschreibung: localizedTextSchema,
  })
  .strict();

/** Schema of one armour set. */
export const armorSetSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    /** The armour items of the set (ids, one per slot). */
    teile: z.array(idSchema).length(ARMOR_SET_PIECES),
    /** Bonuses by pieces worn, ascending. */
    boni: z.array(armorSetBonusSchema).min(1),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (new Set(s.teile).size !== s.teile.length) ctx.addIssue({ code: 'custom', path: ['teile'], message: 'pieces must be unique' });
    for (let i = 1; i < s.boni.length; i++) {
      if ((s.boni[i] as { teile: number }).teile <= (s.boni[i - 1] as { teile: number }).teile) ctx.addIssue({ code: 'custom', path: ['boni', i, 'teile'], message: 'bonuses ascend by pieces worn' });
    }
    for (const [i, b] of s.boni.entries()) if (Object.keys(b.werte).length === 0) ctx.addIssue({ code: 'custom', path: ['boni', i, 'werte'], message: 'a bonus changes at least one stat' });
  });

/** One armour set (validated). */
export type ArmorSetDef = z.output<typeof armorSetSchema>;
/** Armour set data as written below. */
export type ArmorSetInput = z.input<typeof armorSetSchema>;

/** Error in the set content. */
export class ArmorSetError extends Error {
  override readonly name = 'ArmorSetError';
}

/** Validates the sets (schema, unique ids, no piece in two sets) and freezes them. */
export function defineArmorSets(records: readonly ArmorSetInput[]): readonly ArmorSetDef[] {
  const ids = new Set<string>();
  const pieces = new Map<string, string>();
  const parsed = records.map((raw, index) => {
    const r = armorSetSchema.safeParse(raw);
    if (!r.success) throw new ArmorSetError(`Armour set [${index}] "${raw.id}" invalid: ${r.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ')}`);
    if (ids.has(r.data.id)) throw new ArmorSetError(`duplicate armour set "${r.data.id}"`);
    ids.add(r.data.id);
    for (const p of r.data.teile) {
      const other = pieces.get(p);
      if (other !== undefined) throw new ArmorSetError(`armour piece "${p}" belongs to the sets "${other}" and "${r.data.id}"`);
      pieces.set(p, r.data.id);
    }
    return r.data;
  });
  deepFreeze(parsed);
  return parsed;
}

/** The armour sets T0–T1 (docs/SPIEL.md §14). */
export const RUESTUNGSSETS = defineArmorSets([
  {
    id: 'faser',
    name: { de: 'Fasergewand', en: 'Fibre Garb' },
    teile: ['faserkappe', 'faserhemd', 'faserhose', 'faserschuhe'],
    boni: [
      { teile: 2, werte: { maxAusdauer: 5 }, beschreibung: { de: '+5 maximale Ausdauer', en: '+5 maximum stamina' } },
      { teile: 4, werte: { maxAusdauer: 10, tempo: 0.05 }, beschreibung: { de: '+10 maximale Ausdauer, +5 % Tempo', en: '+10 maximum stamina, +5 % speed' } },
    ],
  },
  {
    id: 'leder',
    name: { de: 'Lederrüstung', en: 'Leather Armour' },
    teile: ['lederkappe', 'lederwams', 'lederhose', 'lederstiefel'],
    boni: [
      { teile: 2, werte: { isolation: 2 }, beschreibung: { de: '+2 Isolation', en: '+2 insulation' } },
      { teile: 4, werte: { ruestung: 2, maxAusdauer: 15 }, beschreibung: { de: '+2 Rüstung, +15 maximale Ausdauer', en: '+2 armour, +15 maximum stamina' } },
    ],
  },
  {
    id: 'bronze',
    name: { de: 'Bronzerüstung', en: 'Bronze Armour' },
    teile: ['bronzehelm', 'bronzebrustpanzer', 'bronzebeinschienen', 'bronzestiefel'],
    boni: [
      { teile: 2, werte: { ruestung: 2 }, beschreibung: { de: '+2 Rüstung', en: '+2 armour' } },
      { teile: 4, werte: { ruestung: 2, maxLeben: 15 }, beschreibung: { de: '+2 Rüstung, +15 maximales Leben', en: '+2 armour, +15 maximum health' } },
    ],
  },
]);
