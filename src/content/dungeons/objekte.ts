/**
 * World objects of the vaults (docs/SPIEL.md §19, §29 "Tafeln `tafel_01…10`, Welt-Objekt `erbauer_tafel`"; M7-11, M7-46; kind
 * `ort` like the places' pieces – src/content/places/objekte.ts – so the id carries the prefix: `ort_erbauer_tafel`): the
 * decor the room templates stamp (pillars, statues, roots, moss, floor runes, cold braziers), the Builder tablet, the stairs
 * of a vault's entrance (down on the surface, up in the start room) and the hole a collapsing floor leaves. Nothing harvests
 * them (src/game/gathering/rules.ts has no rule for the kind); they block by their footprint. The sprite carries the id
 * (`assets-src/sprites/gewoelbe/**`).
 */
import type { z } from 'zod';
import type { LocalizedText } from '../schema/common';
import type { worldObjectSchema } from '../worldObjects';

type VaultObjectInput = z.input<typeof worldObjectSchema>;

/** Biomes whose places and vaults show the pieces (the tablet also stands at places of every surface biome). */
const VAULT_OBJECT_BIOMES = ['gruenhain', 'salzkueste', 'nebelmoor', 'frostkamm', 'glutsand', 'aschenschlund', 'scherbenhain'] as const;

function ort(id: string, name: LocalizedText, blocking: boolean): VaultObjectInput {
  return { id: `ort_${id}`, name, kind: 'ort', biomes: [...VAULT_OBJECT_BIOMES], hp: 1, hardness: 0, tool: 'hand', regrowDays: null, footprint: { w: 1, h: 1 }, blocking };
}

export const VAULT_OBJECTS: readonly VaultObjectInput[] = [
  // Decor of the templates (src/content/dungeons/tileset.ts).
  ort('gw_saeule', { de: 'Gewölbesäule', en: 'Vault Pillar' }, true),
  ort('gw_statue', { de: 'Erbauer-Statue', en: 'Builder Statue' }, true),
  ort('gw_wurzeln', { de: 'Eingewachsene Wurzeln', en: 'Ingrown Roots' }, false),
  ort('gw_moos', { de: 'Moospolster', en: 'Moss Cushion' }, false),
  ort('gw_rune', { de: 'Leuchtende Bodenrune', en: 'Glowing Floor Rune' }, false),
  ort('gw_becken', { de: 'Kaltes Kohlebecken', en: 'Cold Brazier' }, true),
  // The tablet (vaults and places, M7-46): the player reads it with E.
  ort('erbauer_tafel', { de: 'Erbauer-Tafel', en: 'Builder Tablet' }, true),
  // The way down on the surface and the way up in the start room: the player stands on them and presses E.
  ort('gw_abgang', { de: 'Gewölbe-Abgang', en: 'Vault Stairs Down' }, false),
  ort('gw_aufgang', { de: 'Gewölbe-Aufgang', en: 'Vault Stairs Up' }, false),
  // A collapsed floor (trap `einsturzboden`): a hole that stays (a chunk change).
  ort('gw_einsturz', { de: 'Eingestürzter Boden', en: 'Collapsed Floor' }, true),
];
