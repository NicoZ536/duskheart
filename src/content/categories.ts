/**
 * Count categories of the content minimums (MASTERPROMPT §C). Every content collection maps its
 * records to zero or more of these categories; the validator reports and enforces the counts
 * (tools/validate-content.ts). The list is kept identical to `CATEGORIES` in
 * tools/content-targets.ts (checked by tests/unit/tools/validate.test.ts).
 */
import { z } from 'zod';

export const CONTENT_CATEGORIES = [
  'items',
  'recipes',
  'stations',
  'buildParts',
  'weapons',
  'armor',
  'armorSets',
  'jewelry',
  'dishes',
  'potions',
  'crops',
  'trees',
  'fish',
  'statusEffects',
  'creatures',
  'elites',
  'bosses',
  'vaults',
  'roomTemplates',
  'puzzleTypes',
  'locationTypes',
  'settlers',
  'settlerLines',
  'tablets',
  'achievements',
  'perks',
  'music',
  'sfx',
] as const;

/** One §C count category. */
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export const contentCategorySchema = z.enum(CONTENT_CATEGORIES);

/** Whether `name` is a §C count category. */
export function isContentCategory(name: string): name is ContentCategory {
  return (CONTENT_CATEGORIES as readonly string[]).includes(name);
}
