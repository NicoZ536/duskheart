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
 *   `asche`); warms (§11.2), calms fear (§12.3) and is a cooking spot. Rain puts an unroofed fire out (§10).
 * - `verhalten: 'lampe'` – a wick in its own fuel (the resin lamps and lanterns of M4-19): each piece burns a
 *   fixed number of game hours, the lamp holds a few pieces; lit by hand, out when the fuel is gone. Behind glass
 *   (`wetterfest`) rain does not reach the flame; an open flame burns like a torch in the rain (§10).
 * - `verhalten: 'lumen'` (M7-36, strand F; docs/SPIEL.md §22 "Lumen-Laterne") – a carried Lumen light: no flame, so rain and
 *   water leave it alone; it glows on a charge of Lumen shards (`BALANCE.light.lumen.hoursPerShard`, reloaded from the bags
 *   when it runs dry or is lit empty), burns shadow brood close by and loses its charge to the light eater (§12.4).
 * Radii, burn times and brightness of the torch and the camp fire are balance values (`BALANCE.light`,
 * src/content/balance/light.ts); the colour is a palette reference – the hue of what glows (the renderer's
 * `paletteLight`).
 *
 * **Furniture lights** (`moebel`, M4-19; §12.2 "Kerzen, Wandlampen, Kronleuchter … Behaglichkeit", §16.4
 * "Heizquellen (Kamin …)"): the lamps and the stone fireplace are pieces of furniture – build parts placed on the
 * build grid (src/game/building), not with `light.place`. Their numbers come with the furniture
 * (`MOEBEL_LICHTER`, src/content/items/moebel.ts: radius, brightness, flicker, fuel, burn time, stock, weather
 * protection, the fireplace's stock and heat) plus the height of the flame above the sprite's anchor (its `licht`
 * socket, `FURNITURE_FLAME_HEIGHT_PX`); the grid draws their sprite `obj_<item>`, so they name no light sprite.
 */
import { z } from 'zod';
import { paletteRefSchema } from './biomes';
import { deepFreeze } from './freeze';
import { MOEBEL, MOEBEL_LICHTER, type MoebelLicht } from './items/moebel';
import { instrumentLightKinds } from './items/instrumente';
import { idSchema, localizedTextSchema, refSchema } from './schema/common';
import { sfxIdSchema } from './schema/item';

/** How a kind of light behaves (see module comment). */
export const LIGHT_BEHAVIOURS = ['fackel', 'feuer', 'lampe', 'lumen'] as const;
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
    /** A furniture light on the build grid (see module comment): its numbers; absent for the torch and the camp fire. */
    moebel: z
      .object({
        /** Reach [tiles]. §12.2. */
        radius: z.number().positive(),
        /** Brightness at the flame [light level]. */
        intensitaet: z.number().positive(),
        /** Flicker [0–1]. */
        flackern: z.number().min(0).max(1),
        /** On the floor (its own footprint) or on the wall face north of its tile. */
        montage: z.enum(['boden', 'wand']),
        /** Height of the flame above the sprite's anchor [px] (the `licht` socket). */
        flammeHoehePx: z.number().min(0),
        /** Lamps: the fuel item, game hours per piece, pieces it holds, behind glass. */
        brennstoff: refSchema.optional(),
        stundenJeEinheit: z.number().positive().optional(),
        vorrat: z.number().int().min(1).optional(),
        wetterfest: z.boolean(),
        /** Fires: most fuel it holds [s] and its heat in the core [°C]. */
        maxSekunden: z.number().positive().optional(),
        waermeC: z.number().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((k, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    const m = k.moebel;
    if (k.verhalten === 'fackel' && (k.sprites.stand === undefined || k.sprites.wand === undefined)) issue('sprites', 'a torch needs a stake and a wall sprite');
    if (k.verhalten === 'feuer' && m === undefined && k.sprites.boden === undefined) issue('sprites', 'a fire needs its ground sprite');
    if (k.verhalten !== 'fackel' && k.verhalten !== 'lumen' && k.getragen) issue('getragen', 'only a torch or a Lumen light is carried');
    if (k.verhalten === 'lumen' && (!k.getragen || m !== undefined || Object.keys(k.sprites).length > 0)) issue('verhalten', 'a Lumen light is carried in the off hand, never placed');
    if (k.verhalten === 'lampe' && (m?.brennstoff === undefined || m.stundenJeEinheit === undefined || m.vorrat === undefined)) issue('moebel', 'a lamp is furniture and names its fuel, hours per piece and stock');
    if (m !== undefined && k.verhalten === 'feuer' && (m.maxSekunden === undefined || m.waermeC === undefined || m.wetterfest)) issue('moebel', 'a furniture fire names its most fuel and heat and is not weatherproof');
    if (m !== undefined && k.verhalten === 'fackel') issue('moebel', 'a torch is no furniture');
    if (m !== undefined && Object.keys(k.sprites).length > 0) issue('sprites', 'the build grid draws a furniture light (obj_<item>)');
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

/**
 * Height of the flame of each furniture light above its sprite's anchor [px]: the `licht` socket of `obj_<item>`
 * (assets-src/sprites/moebel/lichter.ts; the fireplace's flames flare between 6 and 8 px, their middle).
 */
export const FURNITURE_FLAME_HEIGHT_PX: Readonly<Record<string, number>> = {
  harzlampe: 16,
  harzlampe_wand: 9,
  laterne_stehend: 8,
  laternenpfahl: 36,
  kamin_stein: 7,
};

/** The light kind of a furniture light (its item's description, the numbers of `MOEBEL_LICHTER`). */
function furnitureKind(l: MoebelLicht): z.input<typeof lightKindSchema> {
  const item = MOEBEL.find((i) => i.id === l.item);
  if (item === undefined) throw new LightKindError(`Furniture light "${l.item}" has no item`);
  const flame = FURNITURE_FLAME_HEIGHT_PX[l.item];
  if (flame === undefined) throw new LightKindError(`Furniture light "${l.item}" has no flame height`);
  return {
    id: l.item,
    name: l.name,
    beschreibung: item.beschreibung,
    verhalten: l.verhalten,
    gegenstand: l.item,
    getragen: false,
    farbe: l.farbe,
    sprites: {},
    sounds: l.sounds,
    moebel: {
      radius: l.radius,
      intensitaet: l.intensitaet,
      flackern: l.flackern,
      montage: l.montage,
      flammeHoehePx: flame,
      wetterfest: l.wetterfest,
      ...(l.brennstoff === undefined ? {} : { brennstoff: l.brennstoff }),
      ...(l.stundenJeEinheit === undefined ? {} : { stundenJeEinheit: l.stundenJeEinheit }),
      ...(l.vorrat === undefined ? {} : { vorrat: l.vorrat }),
      ...(l.maxSekunden === undefined ? {} : { maxSekunden: l.maxSekunden }),
      ...(l.waermeC === undefined ? {} : { waermeC: l.waermeC }),
    },
  };
}

/** The light kinds (§12.2 "Fackel (Hand/Wand)", "Lagerfeuer", "Kerzen, Wandlampen …"; the furniture lights of M4-19). */
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
  // The furniture lights of M4-19 (resin lamps, lanterns, the stone fireplace), placed on the build grid.
  ...MOEBEL_LICHTER.map(furnitureKind),
  // Strand F (M7-36): the Lumen lantern of the first beacon (§12.2 "Lumen-Laterne … 8 … Lumen-Ladung").
  {
    id: 'lumen_laterne',
    name: { de: 'Lumen-Laterne', en: 'Lumen Lantern' },
    beschreibung: {
      de: 'Leuchtet acht Kacheln weit, kalt und ruhig, und kein Regen löscht sie. Eine Lumen-Scherbe lädt sie für eine Nacht; Schattenbrut, die ihr zu nahe kommt, verbrennt.',
      en: 'Lights eight tiles around, cold and steady, and no rain puts it out. One Lumen shard charges it for a night; shadow brood that comes too close burns.',
    },
    verhalten: 'lumen',
    gegenstand: 'lumen_laterne',
    getragen: true,
    farbe: 'wasser.5',
    sprites: {},
    sounds: { an: 'sfx_lumen_an', aus: 'sfx_lumen_aus', brennen: 'sfx_lumen_summen' },
  },
  // Strand A (M7-31): the firefly jar (§12.2 "Glühwürmchenglas | 3 | 2 Tage"), a furniture lamp fed with fireflies.
  ...instrumentLightKinds(),
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
