/**
 * Names of the places for the presentation (docs/SPIEL.md §18 "Naturwunder"; M7-122): a place is named by its location type;
 * a slot of a variant the type names (`PlaceDef.varianten`: the natural wonder's Uraltbaum, Geysirfeld and Kristallbogen) by
 * that variant – the same name on the map, in the discovery message and in the chronicle.
 *
 * - `placeName(ortstyp, variante)`: the name (DE/EN) of a place of that type and slot variant, or undefined for an unknown
 *   type. A variant the type does not name (a beacon site's biome, '') gives the type's name.
 * - `placeNameRef(def, variant)`: the key a derived map marker carries as its `ref` – the type id, or
 *   `<ortstyp>.<variante>` for a named variant. The places system builds it once per place, so the marker visit allocates
 *   nothing; `placeNameOfRef(ref)` names it again (the map screen).
 */
import { CONTENT } from '../../content/index';
import type { PlaceDef } from '../../content/places/schema';
import type { LocalizedText } from '../../content/schema/common';

/** Between type and variant in a marker's `ref` (content ids never contain it). */
export const PLACE_VARIANT_SEPARATOR = '.';

/** The name of a place of location type `ortstyp` in a slot of variant `variante` (undefined: no such type). */
export function placeName(ortstyp: string, variante = ''): LocalizedText | undefined {
  const def = CONTENT.collection('locationTypes').find(ortstyp) as PlaceDef | undefined;
  if (def === undefined) return undefined;
  return (variante === '' ? undefined : def.varianten?.[variante]?.name) ?? def.name;
}

/** The `ref` of the map marker of a place of type `def` in a slot of variant `variant`. */
export function placeNameRef(def: Pick<PlaceDef, 'id' | 'varianten'>, variant: string): string {
  return variant !== '' && def.varianten?.[variant] !== undefined ? `${def.id}${PLACE_VARIANT_SEPARATOR}${variant}` : def.id;
}

/** The name of the place a map marker's `ref` (`placeNameRef`) stands for (undefined: no such type). */
export function placeNameOfRef(ref: string): LocalizedText | undefined {
  const i = ref.indexOf(PLACE_VARIANT_SEPARATOR);
  return i < 0 ? placeName(ref) : placeName(ref.slice(0, i), ref.slice(i + PLACE_VARIANT_SEPARATOR.length));
}
