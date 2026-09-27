/**
 * The sounds of the base (MASTERPROMPT §15, §16, §27 "Crafting, Bauen, Feuer"; M4-29): which preset of
 * src/content/sfx/ (`bauen.ts`, `tueren.ts`, `stationen.ts`, `lagerung.ts`, `brand.ts`) a building, crafting, storage,
 * hearth or fire event plays. The tables are data like `EVENT_SFX`; src/audio/eventMap.ts maps the events with them,
 * src/audio/loopSources.ts starts the loops of working stations, blazes and the hearth.
 *
 * - **Build parts** sound by their §16.2 material (`BUILD_MATERIAL_SOUND`: palisade and timber frame are wood); a
 *   destroyed or damaged part splinters, crumbles or cracks (`breakSound`).
 * - **Doors** by their kind (`doorSound`): a plain wooden door, the reinforced door with bronze bands, the gate, the
 *   trapdoor.
 * - **Stations** by their own `sounds` (src/content/stations.ts, the only table of station sounds): the body it is set
 *   up and taken down with (`koerper`, a sound material → `BUILD_AUDIO.place`/`dismantle`), the loop while it works
 *   (`laeuft`, src/audio/loopSources.ts) and the finished piece or batch (`fertig`); here only what all stations share
 *   (`STATION_EXTRA_AUDIO`).
 * - **Chests** by their container (`chestSound`, one entry per container of `BALANCE.storage.containers`).
 * - **Floors** under the player's feet by their material (`FLOOR_STEP`, src/audio/underfoot.ts).
 */
import type { BuildMaterial } from '../content/balance/building';
import type { PartKind } from '../content/buildParts';
import type { SoundMaterial } from '../content/sfx/materials';

/** How a material sounds when it is handled on the build grid or a station is set up (content names it). */
export { SOUND_MATERIALS, type SoundMaterial } from '../content/sfx/materials';

/** The sound material of each §16.2 build material: palisade and timber frame are wood. */
export const BUILD_MATERIAL_SOUND: Readonly<Record<BuildMaterial, SoundMaterial>> = {
  stroh: 'stroh',
  palisade: 'holz',
  holz: 'holz',
  fachwerk: 'holz',
  lehm: 'lehm',
  stein: 'stein',
  glas: 'glas',
};

/** How a destroyed or damaged part sounds: splintering timber, crumbling masonry, glass. */
export const BREAK_SOUNDS = ['holz', 'stein', 'glas'] as const;
/** One kind of breaking. */
export type BreakSound = (typeof BREAK_SOUNDS)[number];

/** Straw breaks like timber, clay and metal like masonry. */
const BREAK_OF: Readonly<Record<SoundMaterial, BreakSound>> = { holz: 'holz', stroh: 'holz', stein: 'stein', lehm: 'stein', glas: 'glas', metall: 'stein' };

/** Sounds of the build grid (§16.1–§16.6). */
export const BUILD_AUDIO = {
  /** A part set on the grid. */
  place: {
    holz: 'sfx_bau_setzen_holz',
    stroh: 'sfx_bau_setzen_stroh',
    stein: 'sfx_bau_setzen_stein',
    lehm: 'sfx_bau_setzen_lehm',
    glas: 'sfx_bau_setzen_glas',
    metall: 'sfx_bau_setzen_metall',
  } satisfies Record<SoundMaterial, string>,
  /** A part taken down. */
  dismantle: {
    holz: 'sfx_bau_abbauen_holz',
    stroh: 'sfx_bau_abbauen_stroh',
    stein: 'sfx_bau_abbauen_stein',
    lehm: 'sfx_bau_abbauen_lehm',
    glas: 'sfx_bau_abbauen_glas',
    metall: 'sfx_bau_abbauen_metall',
  } satisfies Record<SoundMaterial, string>,
  /** A part destroyed (fire, the Schattenflut). */
  destroyed: { holz: 'sfx_bau_bersten_holz', stein: 'sfx_bau_bersten_stein', glas: 'sfx_bau_bersten_glas' } satisfies Record<BreakSound, string>,
  /** A part losing hit points. */
  damaged: { holz: 'sfx_bau_schaden_holz', stein: 'sfx_bau_schaden_stein', glas: 'sfx_bau_schaden_glas' } satisfies Record<BreakSound, string>,
  /** Unsupported roof tiles coming down (§16.3). */
  collapse: 'sfx_bau_einsturz',
  /** Wall furniture falling off its removed wall. */
  fallOff: 'sfx_bau_herabfallen',
  /** A blueprint drawn / rubbed out (§16.6). */
  blueprint: 'sfx_bau_blaupause',
  blueprintDiscarded: 'sfx_bau_blaupause_verwerfen',
  /** A blueprint finished with the hammer (with the part's material). */
  finished: 'sfx_bau_fertigstellen',
  /** A part or a station upgraded in place (§16.6 "Aufwerten", Werkbank I → II). */
  upgraded: 'sfx_bau_aufwerten',
  /** A damaged part mended (§16.6 "Flächenreparatur"). */
  repaired: 'sfx_bau_reparieren',
} as const;

/** The sound material of a build material. */
export function buildSound(material: BuildMaterial): SoundMaterial {
  return BUILD_MATERIAL_SOUND[material];
}

/** How a part of `material` breaks. */
export function breakSound(material: BuildMaterial): BreakSound {
  return BREAK_OF[BUILD_MATERIAL_SOUND[material]];
}

/**
 * Footsteps on a built floor, per §16.2 material (§27 "Schritte je Untergrund … Holz, Stein"): planks, the jetty and
 * stairs creak like wood, flagstones and glass ring like stone, rammed clay thuds like earth, straw rustles like grass.
 */
export const FLOOR_STEP: Readonly<Record<BuildMaterial, string>> = {
  holz: 'sfx_schritt_holz',
  palisade: 'sfx_schritt_holz',
  fachwerk: 'sfx_schritt_holz',
  stein: 'sfx_schritt_stein',
  glas: 'sfx_schritt_stein',
  lehm: 'sfx_schritt_erde',
  stroh: 'sfx_schritt_gras',
};

/** Kinds of door by their sound (§16.2 "Türen (Holz, verstärkt, … zweibreites Tor, Falltür)"). */
export const DOOR_SOUNDS = ['holz', 'beschlagen', 'tor', 'falltuer'] as const;
/** One kind of door sound. */
export type DoorSound = (typeof DOOR_SOUNDS)[number];

/** Opening and closing per kind of door. */
export const DOOR_AUDIO: Readonly<Record<DoorSound, { readonly open: string; readonly close: string }>> = {
  holz: { open: 'sfx_tuer_holz_auf', close: 'sfx_tuer_holz_zu' },
  beschlagen: { open: 'sfx_tuer_beschlagen_auf', close: 'sfx_tuer_beschlagen_zu' },
  tor: { open: 'sfx_tor_holz_auf', close: 'sfx_tor_holz_zu' },
  falltuer: { open: 'sfx_falltuer_auf', close: 'sfx_falltuer_zu' },
};

/** Doors that do not sound like their kind: the reinforced door is bound with bronze. */
const DOOR_PART_SOUND: Readonly<Record<string, DoorSound>> = { tuer_verstaerkt: 'beschlagen' };

/** How door part `part` of kind `art` sounds (a gate like a gate, a trapdoor like a trapdoor, any other door by its part). */
export function doorSound(part: string, art: PartKind | undefined): DoorSound {
  const own = DOOR_PART_SOUND[part];
  if (own !== undefined) return own;
  if (art === 'tor') return 'tor';
  if (art === 'falltuer') return 'falltuer';
  return 'holz';
}

/** Sounds all stations share (their own are their `sounds`, src/content/stations.ts). */
export const STATION_EXTRA_AUDIO = {
  /** Fuel laid into a fired station, the hearth or a fire (the camp fire, the fireplace). */
  fuel: 'sfx_feuer_nachlegen',
  /** A processing station stands still with its output full. */
  standstill: 'sfx_station_stillstand',
  /** A fired station ran out of work and cools down. */
  cooling: 'sfx_station_abkuehlen',
  /** A piece mended at the bench, anvil or grindstone (§13.1). */
  repaired: 'sfx_handwerk_reparieren',
} as const;

/** Kinds of container by their sound (§16.7). */
export const CHEST_SOUNDS = ['kiste', 'truhe', 'regal'] as const;
/** One kind of container sound. */
export type ChestSound = (typeof CHEST_SOUNDS)[number];

/** The sound of each container item (`BALANCE.storage.containers`). */
export const CHEST_ITEM_SOUND: Readonly<Record<string, ChestSound>> = { kiste_holz: 'kiste', truhe: 'truhe', lagerregal: 'regal' };

/** How container item `item` sounds (one without an entry like the wooden crate). */
export function chestSound(item: string): ChestSound {
  return CHEST_ITEM_SOUND[item] ?? 'kiste';
}

/** Sounds of storage (§16.7). */
export const STORAGE_AUDIO = {
  /** Opening and closing per kind of container. */
  lid: {
    kiste: { open: 'sfx_kiste_oeffnen', close: 'sfx_kiste_schliessen' },
    truhe: { open: 'sfx_truhe_oeffnen', close: 'sfx_truhe_schliessen' },
    regal: { open: 'sfx_regal_oeffnen', close: 'sfx_regal_schliessen' },
  } satisfies Record<ChestSound, { open: string; close: string }>,
  /** A stack laid in by hand (taking out sounds like the item arriving in the bags, `itemsAdded`). */
  stored: 'sfx_kiste_einlagern',
  /** "Alles einlagern". */
  all: 'sfx_kiste_alles',
  sorted: 'sfx_kiste_sortieren',
  /** Named or labelled. */
  labelled: 'sfx_kiste_beschriften',
  quickStash: 'sfx_kiste_schnellablage',
} as const;

/** Sounds of fires on the build grid and in trees (§16.2, §10). */
export const FIRE_AUDIO = {
  /** A burning tile (loop). */
  burning: 'sfx_brand_lodern',
  /** Set alight by a torch or the console. */
  breaksOut: 'sfx_brand_entflammen',
  /** Caught from a burning neighbour. */
  spreads: 'sfx_brand_ausbreiten',
  /** Put out by rain. */
  rain: 'sfx_brand_zischen',
  /** Burned down. */
  burnedOut: 'sfx_brand_verglimmen',
  /** A standing tree burned down to its stump. */
  treeBurned: 'sfx_brand_baum',
} as const;

/** Sounds of the hearth fire (§16.5). */
export const HEARTH_AUDIO = {
  /** It burns (loop). */
  burning: 'sfx_herd_knistern',
  ignited: 'sfx_herd_entzuenden',
  /** Out of fuel. */
  out: 'sfx_herd_erloeschen',
  /** Put out by the player. */
  doused: 'sfx_herd_loeschen',
  coreSet: 'sfx_herd_glutkern',
  coreTaken: 'sfx_herd_glutkern_nehmen',
} as const;
