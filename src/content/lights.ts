/**
 * Light sources of the player (MASTERPROMPT §12.2, M3-22; docs/SPIEL.md §4 "Gameplay-Licht"): the kinds
 * of light the game's light system (src/game/light) keeps in its light source list – the list the
 * gameplay light map (src/world/lightmap) and the renderer (src/render/game/lights.ts) both read.
 *
 * A kind is the light of one item (`gegenstand`, the item of M3-16 with the same id):
 * - `verhalten: 'fackel'` – burns for a fixed game time (§12.2 "4 Spielstunden"), faster in rain and
 *   possibly going out in heavy rain (§10); carried in the off hand (`getragen`, the Nebenhand rule), or
 *   placed on a stake or a wall (`sprites.stand` / `sprites.wand`); it sets flammable things alight.
 * - `verhalten: 'feuer'` – burns fuel (§15.4 Brennwerte) up to a stock limit, then glows as embers and
 *   turns to ash; placed on the ground (`sprites.boden`, clips `aus`, `brennt`, `schwach`, `glut`,
 *   `asche`); warms (§11.2), calms fear (§12.3) and is a cooking spot.
 * Radii, burn times and brightness are balance values (`BALANCE.light`, src/content/balance/light.ts);
 * the colour is a palette reference – the hue of what glows (the renderer's `paletteLight`).
 */
import { z } from 'zod';
import { paletteRefSchema } from './biomes';
import { deepFreeze } from './freeze';
import { idSchema, localizedTextSchema, refSchema } from './schema/common';
import { sfxIdSchema } from './schema/item';

/** How a kind of light behaves (see module comment). */
export const LIGHT_BEHAVIOURS = ['fackel', 'feuer'] as const;
/** One light behaviour. */
export type LightBehaviour = (typeof LIGHT_BEHAVIOURS)[number];

/** Clips of a fire sprite by state (assets-src/sprites/platzierbar/lagerfeuer.ts). */
export const FIRE_CLIPS = ['aus', 'brennt', 'schwach', 'glut', 'asche'] as const;
/** One fire clip = the visible state of a fire. */
export type FireClip = (typeof FIRE_CLIPS)[number];

/** Schema of one kind of light. */
export const lightKindSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    /** Tooltip: what the light does. */
    beschreibung: localizedTextSchema,
    verhalten: z.enum(LIGHT_BEHAVIOURS),
    /** The item that is this light (placed from the bags, carried in the off hand). */
    gegenstand: refSchema,
    /** Can be carried in the off hand (§12.2 Nebenhand-Regel). */
    getragen: z.boolean(),
    /** Colour of the light: the palette colour of its flame (docs/RENDER.md §1 `rampe.stufe`). */
    farbe: paletteRefSchema,
    /** Sprites when placed: on a stake, on a wall, on the ground (fires). */
    sprites: z.object({ stand: idSchema.optional(), wand: idSchema.optional(), boden: idSchema.optional() }).strict(),
    /** Lighting it, its going out, and the loop while it burns. */
    sounds: z.object({ an: sfxIdSchema, aus: sfxIdSchema, brennen: sfxIdSchema }).strict(),
  })
  .strict()
  .superRefine((k, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if (k.verhalten === 'fackel' && (k.sprites.stand === undefined || k.sprites.wand === undefined)) issue('sprites', 'a torch needs a stake and a wall sprite');
    if (k.verhalten === 'feuer' && k.sprites.boden === undefined) issue('sprites', 'a fire needs its ground sprite');
    if (k.verhalten === 'feuer' && k.getragen) issue('getragen', 'a fire is not carried');
  });

/** One kind of light (validated). */
export type LightKind = z.output<typeof lightKindSchema>;

/** Error in the light kinds. */
export class LightKindError extends Error {
  override readonly name = 'LightKindError';
}

/** Validates the light kinds; throws `LightKindError` naming the record and its issues, or a duplicate id. */
export function defineLightKinds(records: readonly z.input<typeof lightKindSchema>[]): readonly LightKind[] {
  const seen = new Set<string>();
  const parsed = records.map((raw, index) => {
    const r = lightKindSchema.safeParse(raw);
    if (!r.success) throw new LightKindError(`Light kind [${index}] "${raw.id}" invalid: ${r.error.issues.map((i) => `${i.path.map(String).join('.') || '(kind)'}: ${i.message}`).join('; ')}`);
    if (seen.has(r.data.id)) throw new LightKindError(`Light kind "${r.data.id}" is defined twice`);
    seen.add(r.data.id);
    return r.data;
  });
  deepFreeze(parsed);
  return parsed;
}

/** The light kinds of M3 (§12.2 "Fackel (Hand/Wand)", "Lagerfeuer"). */
export const LIGHT_KINDS = defineLightKinds([
  {
    id: 'fackel',
    name: { de: 'Fackel', en: 'Torch' },
    beschreibung: {
      de: 'Leuchtet sechs Kacheln weit und brennt vier Spielstunden – im Regen doppelt so schnell, im Starkregen kann sie verlöschen. Entzündet Brennbares.',
      en: 'Lights six tiles around and burns for four game hours – twice as fast in rain, and heavy rain can put it out. Sets flammable things alight.',
    },
    verhalten: 'fackel',
    gegenstand: 'fackel',
    getragen: true,
    farbe: 'feuer.3',
    sprites: { stand: 'fackel_stand', wand: 'fackel_wand' },
    sounds: { an: 'sfx_fackel_entzuenden', aus: 'sfx_fackel_erloeschen', brennen: 'sfx_fackel_brennen' },
  },
  {
    id: 'lagerfeuer',
    name: { de: 'Lagerfeuer', en: 'Campfire' },
    beschreibung: {
      de: 'Leuchtet acht Kacheln weit, wärmt und vertreibt die Furcht, solange es Brennstoff hat – höchstens sechs Minuten auf einmal. Danach glimmt es noch eine Weile nach.',
      en: 'Lights eight tiles around, warms and drives off fear as long as it has fuel – six minutes at most. Afterwards it glows on for a while.',
    },
    verhalten: 'feuer',
    gegenstand: 'lagerfeuer',
    getragen: false,
    farbe: 'feuer.3',
    sprites: { boden: 'lagerfeuer' },
    sounds: { an: 'sfx_feuer_entzuenden', aus: 'sfx_feuer_erloeschen', brennen: 'sfx_feuer_knistern' },
  },
]);

/** The light kind whose item is `item`, or `undefined` (the item gives no light). */
export function lightKindOfItem(item: string): LightKind | undefined {
  return LIGHT_KINDS.find((k) => k.gegenstand === item);
}

/** The light kind `id`; throws for an unknown id. */
export function lightKind(id: string): LightKind {
  const k = LIGHT_KINDS.find((l) => l.id === id);
  if (k === undefined) throw new LightKindError(`Unknown light kind "${id}" (known: ${LIGHT_KINDS.map((l) => l.id).join(', ')})`);
  return k;
}
