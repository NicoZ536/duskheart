/**
 * The boss arena as a place (docs/SPIEL.md §22 "je Boss eine Instanz in seiner Arena (Slot `bossarena` mit `variant` = Biom,
 * über `link` mit der Leuchtfeuer-Stätte verbunden; `PlaceDef` `bossarena` und Arena-Vorlage in src/content/bosses/arena.ts,
 * Strang F, eingehängt über die Sammeldatei src/content/places/index.ts)"; MASTERPROMPT §20.2 "Jeder Boss: eigene Arena";
 * M7-32, M7-33): the location type `bossarena` (it does not count towards §C "Ortstypen") and the Borkenvater's arena layout.
 *
 * The layout (19 × 19 tiles, it fits the smallest arena disc – `LOCATIONS.arenaRadius` × `fallbackRadiusFactor` = 9 tiles):
 * root soil (`wurzelboden`) inside a rim of bare earth with moss and fallen leaves (only on the rim: a pile is gathered with E,
 * and its prompt must not crowd the fight on the root soil), the boss's place at the centre (mark
 * `altar`), ten patches that burn in the rage phase (mark `siegel`, `arena_brennt`) on a ring 6–7 tiles out, and the way in
 * from the beacon site (mark `eingang`, the side of the respawn spot "before the arena"). The generator of strand B picks and
 * stamps it (rotated with the slot, `drehbar`); without a stamped layout the boss system takes the slot's disc and a ring of
 * its own for the burning patches (`BALANCE.bosses.burnRingShare`).
 */
import type { PlaceDefInput, PlaceLayoutInput } from '../places/schema';

/** Location type of the boss arenas (`LocationType` `bossarena`). */
export const BOSS_ARENA_PLACE: PlaceDefInput = {
  id: 'bossarena',
  name: { de: 'Arena des Wächters', en: 'Warden’s Arena' },
  beschreibung: {
    de: 'Ein Rund aus aufgewühlter Erde und Wurzeln neben einer erloschenen Leuchtfeuer-Stätte. Hier wartet der Wächter des Bioms.',
    en: 'A ring of churned earth and roots beside a dead beacon site. Here the warden of the biome waits.',
  },
  chronik: {
    de: 'Neben der Stätte liegt {name}. Die Wurzeln dort bewegen sich, wenn niemand hinsieht.',
    en: 'Beside the site lies {name}. The roots there move when no one is looking.',
  },
  zaehlt: false,
  kartensymbol: 'karte_ort_bossarena',
  waechter: [],
  wirkung: 'arena',
};

/** The Borkenvater's arena in Grünhain. */
export const BOSS_ARENA_LAYOUTS: readonly PlaceLayoutInput[] = [
  {
    id: 'bossarena_gruenhain_01',
    ortstyp: 'bossarena',
    biom: 'gruenhain',
    drehbar: true,
    legende: {
      W: { boden: 'wurzelboden' },
      E: { boden: 'erde' },
      M: { boden: 'erde', objekt: 'deko_moos' },
      L: { boden: 'wurzelboden', objekt: 'deko_laub' },
      A: { boden: 'wurzelboden', marke: 'altar' },
      S: { boden: 'wurzelboden', marke: 'siegel' },
      G: { boden: 'erde', marke: 'eingang' },
    },
    zeilen: [
      '.......LEEEM.......',
      '.....EMEEEEEEL.....',
      '...EEEEWWSWWMEEE...',
      '..ELELWWWWWWWWLEE..',
      '..MEWSWWWWWWWSWEE..',
      '.EEWWWWWWWWWWWWWEE.',
      '.EEWWWWWWWWWWWWWEE.',
      'EEWSWWWWWWWWWWWSWEE',
      'LELWWWWWWWWWWWWWWEE',
      'EEWWWWWWWAWWWWWWWLE',
      'ELWWWWWWWWWWWWWWWEE',
      'MEWSWWWWWWWWWWWSWEL',
      '.ELLWWWWWWWWWWWWEM.',
      '.MEWWWWWWWWWWWWWEE.',
      '..ELWSWWWWWWWSWEE..',
      '..MEEWWWWWWWWWEEE..',
      '...ELEEWWSWWEEEL...',
      '.....EEEEELEEE.....',
      '.......EEGEE.......',
    ],
  },
];
