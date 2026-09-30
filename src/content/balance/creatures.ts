/**
 * Balance values of the creatures (MASTERPROMPT §19.4, §20.1, §12.3, §12.4, §14 "Jagen & Zerlegen", §29, §D; docs/SPIEL.md
 * §11; M6-13 … M6-18, M6-28 … M6-30, M6-32) – group `BALANCE.creatures` (src/content/balance.ts re-exports it). Every value
 * states its unit and the reason for it. The creatures themselves are content (src/content/creatures/); the thinking and
 * senses of the AI are `BALANCE.ai`, the populations and the night spawner `BALANCE.spawn`.
 */
import type { Difficulty } from './death';

export const CREATURE_BALANCE = {
  /**
   * What the difficulty does to creatures (§29 "Gegnerschaden ×0,6 / ×1 / ×1,3 / ×1,5", §19.4 "Ausholzeit 0,3–0,8 s
   * (Schwierigkeit skaliert)"): damage factor, and the factor on every wind-up – Entspannt gives a quarter more time to
   * react, Unbarmherzig a quarter less (0,8 s stay above the 0,6 s a parry needs to be read, §19.1).
   */
  difficulty: {
    damageFactor: { entspannt: 0.6, normal: 1, hart: 1.3, unbarmherzig: 1.5 } satisfies Record<Difficulty, number>,
    windupFactor: { entspannt: 1.25, normal: 1, hart: 0.85, unbarmherzig: 0.75 } satisfies Record<Difficulty, number>,
  },
  /** Movement and steering (M6-17). */
  movement: {
    /** A goal counts as reached within this distance [tiles]. Half a tile: a body stands on the tile it walked to. */
    arriveTiles: 0.5,
    /**
     * Separation (§19.4 "lokales Ausweichen"): bodies closer than this many radii (sum of both) push each other apart
     * [× sum of radii]; 1,6 keeps a pack a body's width apart without scattering it.
     */
    separationRadii: 1.6,
    /** Strength of the separation push relative to the walking pace [× pace]. Half the pace lets bodies slide past each other instead of stopping. */
    separationWeight: 0.5,
    /**
     * Up to this distance [tiles] a creature with a free line to its goal walks straight at it instead of asking for a
     * path (a chase in the open needs none; a path costs the service a snapshot).
     */
    directTiles: 6,
    /** A path is asked again at the latest after this long [s] (the goal moved or the world changed). */
    repathSeconds: 1.5,
    /** The goal of a path moved by more than this since the request [tiles]: ask again at once. */
    repathMovedTiles: 3,
    /** Node limit of one path request [nodes] (the service clamps it to `BALANCE.ai.path.maxNodesPerRequest`). */
    pathMaxNodes: 2048,
    /**
     * A body that moved less than this share of its pace for `stuckSeconds` gives up its path goal and picks another
     * (a door it cannot pass, a pack blocking a corridor).
     */
    stuckShare: 0.2,
    stuckSeconds: 1.5,
    /** How fast the facing turns towards the direction of movement [rad/s]: a quarter turn in 0,25 s – snappy but not a jump. */
    turnRadPerSecond: 6.3,
    /** Fleeing: how far ahead a fleeing body looks for a free direction [tiles]. */
    fleeLookTiles: 3,
    /**
     * A creature only moves, and new ones only appear, at least this far inside the active zone [tiles]
     * (docs/ARCHITEKTUR.md "Aktive Zone"): the collision of a tile near a chunk border depends on its neighbour chunk (cliff
     * faces reach 4 tiles south, footprints east and north), and whether a frozen neighbour is resident differs between
     * the browser (the camera streams it) and headless runs. 6 tiles cover the widest band plus the body's radius, so a
     * creature never reads a tile whose collision depends on a chunk outside the zone – the game stays deterministic.
     */
    zoneMarginTiles: 6,
  },
  /** Attacks (M6-15): the recovery after a blow [s] and how close a leaping attack must land to hit [px beyond the body]. */
  attack: { recoverySeconds: 0.35, leapContactPx: 6 },
  /** Chance of an idle call per decision of an awake creature at rest [probability] (5 decisions a second: about every 20 s). */
  idleCallChance: 0.01,
  /** Doors (§19.4 "Türen (für bestimmte Gegner brechbar)"): damage per blow on a closed door [HP] and blows per second. */
  doors: { damagePerBlow: 12, blowsPerSecond: 1 },
  /** Knockback of a hit on a creature is spread over this many ticks (like the player's, `BALANCE.combat.impact.knockbackTicks`). */
  knockbackTicks: 4,
  /** A creature that was hit turns to face its attacker and is aware of it for this long [s] (no backstab right after a hit). */
  alarmedSeconds: 6,
  /**
   * Healing of a creature whose chunk is frozen [share of max health per game hour]: a wounded deer that escaped is whole
   * again after four hours (docs/SPIEL.md §11 "catchUp: heilen").
   */
  healPerGameHour: 0.25,
  /** Hunting and carving (§14 "Jagen & Zerlegen"). */
  hunting: {
    /** Shelf life of raw meat and fowl [game days] (§18: meat spoils fastest, faster than berries' 3 days). */
    meatShelfDays: 2,
    /** Burn time of fat as fuel [real seconds] (§15.4 "Harzholz 60": tallow burns like resinous wood). */
    fatBurnSeconds: 60,
    /** A carcass lies this long before it rots away [game hours] (half a day: carve it the same day). */
    carcassGameHours: 12,
    /** The tool kind that carves (§14: "E mit Messer zerlegt ihn"). */
    carveTool: 'messer',
    /** Reach within which E carves a carcass [tiles] (the interaction's reach). */
    carveReachTiles: 1.5,
    /** Spread of the carved pieces around the carcass [px]. */
    spreadPx: 6,
  },
  /** Loot on defeat (M6-30): spread of the drops around the body [px]. */
  loot: { spreadPx: 8 },
  /** Shadow brood and light (§12.4, M6-28). */
  shadowBrood: {
    /** Tiles brighter than this are avoided in paths and steering (§12.4 "Meidet Licht > 0,5"). */
    avoidLightAbove: 0.5,
    /** Damage per second in glaring light [HP/s] (§12.4 "erleidet in gleißendem Licht 5 Schaden/s"). */
    burnPerSecond: 5,
    /**
     * A shadow brood in light above `avoidLightAbove` flees towards the darkest direction; it looks this far for it
     * [tiles] (the radius of a torch, 6, plus a margin).
     */
    escapeLookTiles: 8,
    /** How long the fading at sunrise takes before the body is gone [s] (the dissolve the presentation shows). */
    fadeSeconds: 1.5,
  },
  /** The Nachtmahr (§12.3 "bei 100 erscheint ein Nachtmahr, der dich jagt", M6-29). */
  nightmare: {
    /** The creature that comes. */
    creature: 'nachtmahr',
    /** It appears this far from the player, in the darkest direction [tiles] – out of sight, but not for long. */
    spawnDistanceTiles: 14,
    /** Directions tried for the darkest spot [directions]. */
    spawnDirections: 8,
  },
  /** Bestiary (§20.1, M6-32). */
  bestiary: {
    /** Seconds a creature must be in view before it counts as sighted [s] (a glimpse is not enough). */
    sightSeconds: 3,
    /** In view: within this distance of the player [tiles] (about the 480 × 270 view's half height and more). */
    sightRadiusTiles: 12,
    /** A creature in the dark counts as in view only with glowing eyes; the light it must stand in otherwise [light level] (§12.1 "dämmrig"). */
    sightMinLight: 0.15,
    /** Defeats that unlock its resistances and weaknesses, and its loot [defeats]. */
    killsForResistances: 1,
    killsForLoot: 3,
    /** How often the bestiary looks who is in view [Hz]: four times a second is plenty for seconds of watching. */
    checkHz: 4,
  },
  /** Traps (§14 "Fallen (Schlinge, Kastenfalle)", M6-30). */
  traps: {
    /** Reach of setting up and taking a trap [tiles] (like placing a torch). */
    reachTiles: 2,
  },
};
