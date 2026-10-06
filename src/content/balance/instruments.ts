/**
 * Balance values of making music and of the net (MASTERPROMPT §12.3 "Musizieren (Flöte, Laute) −2/s im Umkreis", §14
 * "Netz (Insekten, Glühwürmchen …)"; M7-31, docs/SPIEL.md §24) – group `BALANCE.instruments` (src/content/balance.ts). The
 * calming rate itself is the fear group's (`BALANCE.fear.decay.musicPerSecond`, 2/s): the instruments only say who hears
 * it. Every value states its unit and the reason for it.
 */
export const INSTRUMENT_BALANCE = {
  /** Who hears the music and is calmed by it [tiles]. §12.3 "im Umkreis": the radius of a camp fire's light (§12.2: 8). */
  radiusTiles: 8,
  net: {
    /** Reach of a net swing from the player [tiles]. §11.4: like the reach of a tool, a step and an arm. */
    reachTiles: 2,
    /** How close a firefly swarm must hover to the swept tile [tiles]. A swarm drifts over a few tiles of meadow. */
    swarmRadiusTiles: 1.5,
    /** Fireflies one swarm gives per night [pieces]. A swarm thins but stays: the meadow keeps its lights (§7 Atmosphäre). */
    firefliesPerSwarmPerNight: 3,
    /** Chance a swing through grass catches a cricket at night [0–1]. §27 "Grillen nachts": they sing and sit in the open. */
    cricketChanceNight: 0.45,
    /** Chance a swing through grass catches a cricket by day [0–1]. By day they hide low: one swing in five or six. */
    cricketChanceDay: 0.18,
    /** Wear of the net per swing [uses]. Like a tool's hit (§D: one use per hit). */
    wearPerSwing: 1,
  },
  /** Swarm entries the net remembers [swarms]. One night of a meadow: more swarms than that never sit in reach at once. */
  maxRememberedSwarms: 32,
} as const;
