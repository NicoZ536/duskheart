/**
 * Balance values of the creatures' AI (MASTERPROMPT §19.4; docs/SPIEL.md §11, §12) – group `BALANCE.ai`
 * (src/content/balance.ts re-exports it). Every value states its unit and the reason for it.
 *
 * `pathLatencyTicks` and the group `path` belong to the path finding (M6-16, src/world/path/); the creature AI adds
 * its own values next to them (M6-13, M6-14: thinking rate, senses, noises, utilities).
 */

export const AI_BALANCE = {
  /**
   * Ticks from a path request to the tick its result counts [ticks] (docs/SPIEL.md §12: `readyTick = tick +
   * pathLatencyTicks`). A request of tick t goes to the worker with the job queue of that frame and comes back while
   * the next frames draw; 4 ticks (67 ms) leave the worker about three frames at 60 fps before the simulation has to
   * compute the path itself. A creature reacts far slower than that anyway (a telegraph alone takes 0,3–0,8 s,
   * §19.4), so the delay never shows as hesitation.
   */
  pathLatencyTicks: 4,
  path: {
    /**
     * Requests admitted per tick [requests]; the rest waits in a queue for the next ticks. The bench load of M6-16 is
     * 200 requests/s = 3,3 per tick; 8 let a whole pack (4–6 wolves, §19.4 "Rudel") re-plan in the same tick
     * without delaying the others.
     */
    requestsPerTick: 8,
    /**
     * Search nodes admitted per tick [nodes]: the node limits of the admitted requests add up to at most this (the
     * first request of a tick always goes). It bounds what the simulation computes itself when the worker has not
     * answered, even if every search ran to its limit (two searches of the largest limit). Searches seldom do: the
     * bench load (200/s, mixed distances, limits 512/2 048/4 096) expands ≈ 135 nodes per request and costs the tick
     * 0,3 ms in the median without worker; its reserved limits (≈ 4 800 per tick) fit with room, so nothing queues
     * for more than a tick (`sim:pfad-200`).
     */
    nodesPerTick: 8192,
    /**
     * Largest node limit of one request [nodes] (a request's `maxNodes` is clamped to it). A path across the active
     * zone (7 × 7 chunks) expands ≈ 200–600 nodes through the chunk hierarchy (portals, legs with jump points), a
     * direct search round a lake up to ≈ 2 000; 4 096 leaves room for that while one request never takes the whole
     * tick budget.
     */
    maxNodesPerRequest: 4096,
    /**
     * Extra cost of stepping through a closed door [tiles]. Breaking or opening a door takes a creature a few
     * seconds (§19.4 "Türen (für bestimmte Gegner brechbar)"): it goes round when the way round is at most 6 tiles
     * longer, else it takes the door.
     */
    doorCostTiles: 6,
    /**
     * Straight-line distance from which a search uses the chunk hierarchy [tiles] (HPA*, §19.4 "hierarchisch für
     * weite Strecken"). Below it start and goal lie within about a chunk of each other and the direct search in their
     * box is cheaper than routing through the portals (bench: 64 tiles cost the tick p95 a third more, 28 no less
     * than 40).
     */
    hierarchyMinTiles: 40,
    /**
     * How much longer than its straight-line estimate the first or last leg of a hierarchical path may be before the
     * search routes again with exact distances inside that chunk [tiles]. Start and goal join the portal graph at the
     * straight-line distance (no search per request); a winding lake shore or a maze of walls can make that leg much
     * longer and the chosen portal a poor one. 4 tiles is below what one portal's spacing can cost, so only real
     * detours trigger the second route.
     */
    insertionSlackTiles: 4,
    /**
     * Spacing of the portals along an open stretch of a chunk border [tiles] (HPA*: one portal per stretch). 8 puts
     * four portals on a fully open 32-tile border – detours through a portal cost at most ≈ 4 tiles, which the
     * corridor search afterwards straightens – while a chunk keeps ≤ 16 portals on open ground.
     */
    portalSpacingTiles: 8,
    /**
     * Margin of the box around start and goal a search tries first [tiles] (a direct search in its window, a leg of a
     * hierarchical path in its chunk). A jump scans to the edge of its area, so on open ground the work grows with the
     * area: a box instead of the whole window keeps a short search short. 8 tiles hold the way round a tree cluster, a
     * pond or a hut; only when the box holds no way does the search take the whole area.
     */
    directMarginTiles: 8,
    /** Chunks around the start and goal chunks a search may use [chunks]: one ring lets a path go round an obstacle at the edge. */
    windowMarginChunks: 1,
    /**
     * Largest search window per axis [chunks]. The active zone with its hysteresis ring spans 7 chunks
     * (`stream.activeRadiusChunks` 2 + `hysteresisChunks` 1 on each side); creatures only walk there.
     */
    maxWindowChunks: 7,
    /**
     * Chunks whose tile words the service keeps [chunks] (2 KiB each). Two layers of a full active zone with
     * hysteresis (2 × 49) fit, so walking in and out of a cave does not rebuild them.
     */
    tileCacheChunks: 112,
    /**
     * Chunk areas kept per thread for the portal graph [entries] (one per chunk version and mover profile: area
     * labels and legal steps, 3 KiB, plus the distance fields of its portal tiles, ½ KiB each); borders keep four
     * times as many portal sets. 8 profiles × 49 chunks of a zone with hysteresis fit (≈ 4 MiB with twenty fields each).
     */
    abstractCacheEntries: 448,
    /**
     * Legs between two portals of a chunk kept per thread [legs] (a tile path of ≤ ~45 steps, ≈ 150 B). The chunks of
     * a zone (49) with the portal pairs long paths use through them (a few dozen each) fit; a leg is searched once per
     * chunk version instead of once per path.
     */
    legCacheEntries: 16384,
    /** Main-thread time per frame for delivering worker answers [ms]. Copying a path back costs microseconds; 0,5 ms of the 8 ms frame (§30) is plenty. */
    jobFrameBudgetMs: 0.5,
    /** Path jobs the worker holds at once [jobs]. A few per frame at 200 requests/s; 8 keep it busy while cancelled jobs stay cheap. */
    maxJobsInFlight: 8,
    /** Owners whose last path the debug overlay `pfade` keeps [owners] (§31.6): a raid's worth of creatures on screen. */
    debugOwners: 64,
  },
  /**
   * How often a creature thinks [Hz] (docs/SPIEL.md §11 "Denken gestaffelt mit `BALANCE.ai.thinkHz` (Versatz nach
   * Entität), Bewegung jeden Tick"): five decisions a second react within a fifth of a second – faster than any
   * telegraph (0,3 s) – while 80 bodies of a raid think 400 times a second in all, spread over the ticks.
   */
  thinkHz: 5,
  /** Senses (M6-14, §19.4 "Wahrnehmung"). */
  perception: {
    /** Sight cone [°] (§19.4 "Sichtkegel 120°"). */
    coneDeg: 120,
    /** A body closer than this is noticed whatever it faces [tiles] (one hears and smells what stands next to one). */
    nearTiles: 1.5,
    /**
     * Sight range by the light stage at the player [× the profile's sight] (§19.4 "Sichtweite abhängig vom Licht am
     * Spieler (im Dunkeln schwer zu sehen)"; stages §12.1): in the dark a quarter, at dusk three fifths, in full light
     * all, glaring light a little more.
     */
    lightFactor: { dunkel: 0.25, daemmrig: 0.6, hell: 1, gleissend: 1.2 },
    /** The player carries a burning light (§12.2 "Wer leuchtet, wird von Gegnern doppelt so weit gesehen") [×]. */
    ownLightFactor: 2,
    /** Haze of the weather over the player (fog 1, driving snow 0,7) takes this share of the sight [× haze] (§19.4 "Wetter senkt Sichtweite"). */
    hazeSightLoss: 0.6,
    /** Precipitation above this [0–1] (heavy rain, a storm) takes sight as well … */
    heavyRainFrom: 0.6,
    /** … this share per unit above it [× (precipitation − heavyRainFrom)]: a storm (1,0) takes a fifth. */
    heavyRainSightLoss: 0.5,
    /** Rain damps what is heard [× precipitation] (§19.4 "Regen dämpft"): a storm halves every noise's radius. */
    rainHearingLoss: 0.5,
  },
  /**
   * Radius of the noises creatures hear (M6-14, docs/SPIEL.md §11 `noise.ts`) [tiles, before the profile's hearing and
   * the rain]: a walking step 5 (× the body's `noise`: sprinting 1,5, sneaking 0,3 – "Schleichen −70 %"), a blow or shot
   * 8, a hit 10, chopping wood 10, a tree falling 18, picking at rock and ore 12, digging 6, a door 7, building 8. A
   * creature's call alerts its kind within 12.
   */
  noise: { step: 5, attack: 8, hit: 10, chop: 10, treeFall: 18, mine: 12, dig: 6, door: 7, build: 8, call: 12 },
  /** How far a creature's attention carries to its pack [tiles]: a wolf that spots prey tells the others (§19.4 "Rudel"). */
  packAlertTiles: 16,
  /**
   * Utility of the states (M6-13): fixed scores of the decisive situations and the random part that breaks ties among
   * the idle states [0–1]. Fear beats everything, then the fight, then investigating, then the idle states.
   */
  utility: { flee: 0.95, attack: 0.9, hunt: 0.8, circle: 0.75, retreat: 0.85, homeward: 0.7, investigate: 0.6, sleep: 0.5, idleNoise: 0.15 },
  /**
   * Idle states last this long before the creature thinks about something new [s]: 3 to 9 – a deer grazes a few
   * seconds, then looks up; long enough that the idle clips play out, short enough that a herd does not freeze.
   */
  idleSeconds: { min: 3, max: 9 },
  /** A creature about to attack stops this close to the target's edge [× the attack's reach] (it winds up just in reach). */
  attackApproach: 0.85,
};
