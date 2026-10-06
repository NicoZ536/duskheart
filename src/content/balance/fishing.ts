/**
 * Balance values of fishing (MASTERPROMPT §14 "Angeln: Angel (T0 Stock + Faser + Knochenhaken …), Köder, Minispiel
 * (Spannung halten, Fisch zieht, Rute biegt sich) … Reusen (passiv); Eisangeln im Winter", docs/SPIEL.md §20; M7-24) –
 * group `BALANCE.fishing` (src/content/balance.ts re-exports it). The fish themselves are content (src/content/fishing/).
 * Every value states its unit and the reason for it.
 */

export const FISHING_BALANCE = {
  /** Longest cast from the player's feet [tiles]. A stick rod with a horsehair line reaches a few tiles out into a river or lake. */
  castReachTiles: 6,
  /** Flight of the float from the rod to the water [s]. A swing and a plop: half a second the player sees the line fly. */
  castSeconds: 0.5,
  /**
   * Shortest wait for the bite [s]: the wait lies between `biteMinSeconds` and `biteMaxSeconds`, drawn from `hash(seed, cast
   * tick)` (§20 "Biss nach hash(Seed, Wurf-Tick)") and divided by the bait's bite factor (`koeder.biss`). Long enough to look
   * at the water.
   */
  biteMinSeconds: 4,
  /** Longest wait for the bite [s]: short enough not to bore – about ten seconds on average without bait. */
  biteMaxSeconds: 16,
  /** How long the float dips before the fish lets go [s]. A bite must be answered by holding the reel within it. */
  biteWindowSeconds: 1.5,
  /**
   * The fight (§14 "Spannung halten, Fisch zieht"): tension 0–1 [per s]. Reeling raises it by `reelTension`, the fish's pull
   * by `pullTension` × its `kraft`; slack line lowers it by `slackTension`. At 1 the line breaks, at 0 the fish shakes off
   * the hook (§20). The fight starts at `startTension`. Tuned by simulated fights (scratch bot, 200 fights per fish): holding
   * the reel all the time breaks every line, never reeling loses every fish, keeping the tension below ~0.7 lands all eight in
   * 4–11 s; a reaction late by 0.2 s costs a pike or a mackerel now and then.
   */
  fight: { startTension: 0.45, reelTension: 0.6, pullTension: 0.8, slackTension: 0.8 },
  /**
   * Distance of the hooked fish [tiles per s]: reeling pulls it in by `reelSpeed`, minus what it swims against (`kraft` ×
   * `swimAway`); on slack line it swims off by `swimAway` × `kraft`. A tired fish (endurance spent) pulls with `tiredPull`.
   * Beyond `maxDistanceTiles` it is gone: a cast reaches 6 tiles, three more of slack line are the limit.
   */
  reel: { reelSpeed: 3, swimAway: 1.2, tiredPull: 0.35, maxDistanceTiles: 9 },
  /**
   * Pull of the fish over time [s, ×]: every `pullChangeSeconds` it changes direction and strength (stream `fishing`, §28
   * "fortlaufende Ströme … fishing (Drill)") between `pullMin` and 1 of its `kraft`; a leap doubles the pull for `leapSeconds`.
   */
  pull: { pullChangeSeconds: 0.8, pullMin: 0.35, leapSeconds: 0.5, leapFactor: 2 },
  /**
   * Weight of the fish that fit (§20 "Fischwahl gewichtet nach … Köder"): a bait multiplies the weight of the fish it is
   * made for by `baitPreference` [×]; a fish without a matching bait keeps its own weight.
   */
  baitPreference: 3,
  /** Hours of the dawn and the dusk the fish count as `daemmerung` [h around sunrise and sunset]. The calendar's twilight phases. */
  twilightHours: 1,
  /**
   * Fish traps (§14 "Reusen (passiv)", §20 "Fang je 06:00 per Hash"): chance per dawn to catch one fish [0–1], and the most
   * fish a trap holds [pieces]. A trap left for a week fills up: about one fish every two days.
   */
  trap: { catchChance: 0.5, capacity: 4, reachTiles: 1.5 },
  /** How long a catch or a loss shows before the rod is free again [s]: long enough to read the fish's name in the HUD. */
  resultSeconds: 1.5,
  /** Walking off with the line out [tiles beyond `castReachTiles`]: farther than this the line comes loose (the cast ends). */
  lineSlackTiles: 2,
  /** Days an ice hole stays open [game days] (§20 "Eisangeln … mit Loch (Spitzhacke)"): it freezes over again after two days. */
  iceHoleDays: 2,
  /** Shelf life of raw fish [game days]. §18 "rohes Fleisch 2 Tage": fresh fish spoils as fast as raw meat. */
  rawShelfDays: 2,
  /** Experience of a caught fish [source id of src/content/skills.ts, skill `sammeln`]. §20 "EP: neue Quelle fisch_gefangen". */
  experience: 'fisch_gefangen',
};
