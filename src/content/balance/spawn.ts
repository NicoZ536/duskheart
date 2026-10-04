/**
 * Balance values of the populations and the night spawner (MASTERPROMPT §12.4 "Schattenbrut-Regeln", §20.1, §29, §D;
 * docs/SPIEL.md §11 "Bestand und Spawn"; M6-27) – group `BALANCE.spawn` (src/content/balance.ts re-exports it). Every value
 * states its unit and the reason for it. Who lives where is content (`spawnTables`, src/content/creatures/spawn.ts).
 */
import type { Difficulty } from './death';

export const SPAWN_BALANCE = {
  /**
   * Tier of each biome (§13.2 table "Biome": Grünhain and the root caves T0, the moor and the deep ground T1, …; the
   * Salt Coast lies beside the start and counts as T0, the Nachtherz is the last). It scales the shadow brood's density
   * (`shadowBrood.densityByTier`) and the tier of loot draws of creatures below their own.
   */
  biomeTier: {
    gruenhain: 0,
    salzkueste: 0,
    wurzelhoehlen: 0,
    nebelmoor: 1,
    tiefgrund: 1,
    frostkamm: 2,
    glutsand: 3,
    aschenschlund: 4,
    glutadern: 4,
    scherbenhain: 5,
    nachtherz: 6,
  } as Readonly<Record<string, number>>,
  /** Wildlife: the persistent population of each chunk (docs/SPIEL.md §11 "Bestand und Spawn"). */
  wildlife: {
    /**
     * Animals a chunk (32 × 32 tiles) holds at most [animals]. Four keep a meadow lively without crowding it: a view of
     * 30 × 17 tiles shows two or three animals, a hunt finds game within a minute's walk.
     */
    maxPerChunk: 4,
    /** Animals a chunk starts with at its first activation [animals] (× the season's factor, rounded). */
    initialPerChunk: 3,
    /** One animal comes back after this long when a chunk holds fewer than its maximum [game hours] (§11 "wachsen langsam nach"). */
    regrowGameHours: 6,
    /** Tries to find a free tile for a newcomer before giving up [tries]. */
    placeTries: 12,
    /** Members of a group appear within this distance of the first [tiles]. */
    groupSpreadTiles: 3,
    /** No animal appears closer to the player than this [tiles] (nothing pops up in view). */
    minPlayerDistanceTiles: 12,
  },
  /** The night spawner of the shadow brood (§12.4). */
  shadowBrood: {
    /** Distance from the player [tiles] (§12.4 "16–40 Tiles vom Spieler entfernt"). */
    minTiles: 16,
    maxTiles: 40,
    /** Only on tiles darker than this [light level] (§12.4 "Licht < 0,15"). */
    maxLight: 0.15,
    /** The spawner tries every this many seconds [s]. */
    intervalSeconds: 6,
    /** Tries to find a dark tile per attempt [tries]. */
    placeTries: 10,
    /**
     * Shadow brood alive around the player at most, by the tier of the biome under the player [bodies] (§12.4 "Dichte nach
     * Biomstufe"): three at T0 are a threat a torch can hold off; the deep biomes crowd the night.
     */
    maxAliveByTier: [3, 4, 5, 6, 7, 8, 10, 12],
    /** Moon (§12.4 "Mondphase", docs/SPIEL.md §11 "Finstermond +50 %"): factor on the maximum. */
    finstermondFactor: 1.5,
    /**
     * The stronger brood of a Finstermond night (docs/SPIEL.md §11 "Finstermond +50 %, stärkere Varianten", M6-27): every
     * shadow brood the spawner brings under it is its biome variant times these factors [×] – half again the health
     * (a stalker takes six or seven blows of a tier weapon instead of four or five, §D), a fifth more damage (a normal
     * blow of 10 % of the player's health lands at 12 %, the top of §D's normal hits) and a tenth more pace (it closes in
     * a step faster, still slower than a sprint). The darkest night is the most dangerous, but no brood one-shots.
     */
    finstermond: { leben: 1.5, schaden: 1.2, tempo: 1.1 },
    /** Difficulty (§12.4 "Schwierigkeit", §29): factor on the maximum. */
    difficultyFactor: { entspannt: 0.6, normal: 1, hart: 1.3, unbarmherzig: 1.5 } satisfies Record<Difficulty, number>,
  },
};
