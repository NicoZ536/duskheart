/**
 * Recipes of the basics made without a station (M3-16; MASTERPROMPT §15.1 "Ohne Station herstellbar:
 * Grundlagen (Faserseil, Steinwerkzeuge, Fackel, Lagerfeuer, Werkbank, Verband, Grasbett, Speer)";
 * docs/SPIEL.md §6 "Rezepte `rezept_<itemId>` für Faserseil, alle Steinwerkzeuge, Holzeimer, Fackel,
 * Lagerfeuer, Werkbank, Verband, Grasbett, Steinspeer").
 *
 * The first day in order (§23.1): fibres, stones, flint and twigs lie on the ground and are picked by
 * hand, so rope and the first stone tools need nothing else; logs and resin come from trees, so the
 * bucket, the campfire, the workbench and the torch follow the stone axe. The bandage takes yarrow or –
 * in spring, before the yarrow flowers – ribwort plantain, both wound herbs. Filling the bucket is the
 * one recipe that needs water in reach; the filled bucket is the same bucket (`behaelt`).
 */
import { defineRecipeGroup } from './define';
import type { RecipeInput } from './schema';

/** A basic recipe: one product from `zutaten` [item → pieces], no station. */
function basic(item: string, zutaten: Readonly<Record<string, number>>, dauer: RecipeInput['dauer'], extra: Partial<RecipeInput> = {}): RecipeInput {
  return {
    id: `rezept_${item}`,
    ergebnis: { item, anzahl: 1 },
    zutaten: Object.entries(zutaten).map(([zutat, anzahl]) => ({ item: zutat, anzahl })),
    station: null,
    dauer,
    ...extra,
  };
}

/** Recipes of the basics. */
export const GRUNDLAGEN_REZEPTE = defineRecipeGroup('grundlagen', [
  basic('faserseil', { fasern: 3 }, 'handgriff'),
  // Stone tools: a twig haft, a head of stone or flint, bound with rope.
  basic('steinaxt', { zweig: 2, stein: 2, faserseil: 1 }, 'werkzeug'),
  basic('steinspitzhacke', { zweig: 2, stein: 3, faserseil: 1 }, 'werkzeug'),
  basic('steinschaufel', { zweig: 2, stein: 2, faserseil: 1 }, 'werkzeug'),
  basic('steinhacke', { zweig: 2, stein: 1, feuerstein: 1, faserseil: 1 }, 'werkzeug'),
  basic('steinsichel', { zweig: 1, feuerstein: 2, faserseil: 1 }, 'werkzeug'),
  basic('steinhammer', { zweig: 2, stein: 3, faserseil: 1 }, 'werkzeug'),
  basic('steinmesser', { zweig: 1, feuerstein: 1, faserseil: 1 }, 'werkzeug'),
  basic('steinspeer', { zweig: 2, feuerstein: 1, faserseil: 1 }, 'werkzeug'),
  // The bucket and its water.
  basic('holzeimer', { holz: 4, faserseil: 2, harz: 1 }, 'werkzeug'),
  basic('holzeimer_wasser', { holzeimer: 1 }, 'handgriff', {
    name: { de: 'Eimer füllen', en: 'Fill Bucket' },
    umgebung: 'wasser',
    behaelt: 'haltbarkeit',
    sound: 'sfx_wasser_schoepfen',
  }),
  // Light, fire, rest and a first bench.
  basic('fackel', { zweig: 1, harz: 1, fasern: 2 }, 'handgriff'),
  basic('lagerfeuer', { stein: 6, holz: 3 }, 'gross'),
  basic('werkbank', { holz: 10, stein: 4, faserseil: 2 }, 'gross'),
  basic('grasbett', { fasern: 12, laub: 10, zweig: 4 }, 'gross'),
  // Wound care: yarrow (summer, autumn) or ribwort plantain (spring to autumn).
  basic('verband', { fasern: 3, schafgarbe: 1 }, 'handgriff'),
  { ...basic('verband', { fasern: 3, wegerich: 1 }, 'handgriff'), id: 'rezept_verband_wegerich' },
]);
