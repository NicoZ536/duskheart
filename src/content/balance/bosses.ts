/**
 * Balance values of the boss framework (MASTERPROMPT §20.2 "Bosse", §D "Boss-Spezial 30–45 %, kein One-Shot auf Normal",
 * §4.6 "Telegraphs … Boss-Flächenangriffe mit Bodenmarkierung"; docs/SPIEL.md §22; M7-32 … M7-34) – group `BALANCE.bosses`
 * (src/content/balance.ts re-exports it). A boss's own numbers (health, attacks, phases, loot) are content
 * (src/content/bosses/); what every boss shares – fairness limits, arena rules, the pace of the fight – lives here. Every
 * value states its unit and the reason for it.
 */

export const BOSS_BALANCE = {
  /**
   * Largest share of the player's maximum health one boss hit may take on Normal with tier armour [share of max health].
   * §D: "Boss-Spezial 30–45 %" of the effective health against tier armour, "kein One-Shot auf Normal" – the content test
   * (boss-framework.test.ts) checks every area attack of every phase against it.
   */
  maxHitShare: 0.45,
  /** Shortest telegraph of any boss attack [s]. §4.6 "jede Attacke lesbar", docs/SPIEL.md §22: "jede Attacke telegraphiert (≥ 0,4 s)". */
  telegraphMinSeconds: 0.4,
  /**
   * Telegraph of a summon or an arena effect [s] (the cast pose before the servants rise or the storm breaks). Longer than a
   * blow's minimum: it changes the whole arena, the player gets time to read it.
   */
  castSeconds: 0.8,
  /** How long the title card shows after the boss awakens [s]. docs/SPIEL.md §22: "Titelkarte 3 s"; no attack lands meanwhile. */
  titleCardSeconds: 3,
  /**
   * Inset of the inner ring from the arena's edge [tiles]: stepping this far into the arena wakes a boss whose access is
   * `betreten` (§20.2 "Beschwörung oder Zugang"). Three tiles: the player is clearly inside, not brushing the rim.
   */
  innerRingInsetTiles: 3,
  /**
   * Distance beyond the arena's edge at which a fight counts as fled [tiles] (docs/SPIEL.md §22 "Verlassen der Arena →
   * bossReset"). The sealed rim keeps a walker in; this catches a teleport or a fall through.
   */
  leaveMarginTiles: 2,
  /**
   * Half thickness of the sealing root wall around the arena [tiles]: tiles whose centre lies within this of the arena
   * radius block while the boss is awake. 0.75 closes the ring also on the diagonals (no corner slips through).
   */
  sealHalfWidthTiles: 0.75,
  /**
   * Pause between two attacks at tempo 1 [s]: at least `min`, plus a share of `spread` drawn per attack (stream `bosses`,
   * docs/SPIEL.md §28). §D "Kampfdauer 3–6 min" with 120–200 hit equivalents: the player needs open windows to strike.
   */
  attackGapSeconds: { min: 1.4, spread: 1.2 },
  /**
   * Stand-off of the "before the arena" respawn spot beyond the arena's edge, on the side of the beacon site [tiles].
   * §20.2 "Wiedereinstieg nach Tod direkt vor der Arena": outside the seal, a few steps from the rim.
   */
  respawnOffsetTiles: 3,
  /** Sight in a leaf storm [share of the normal view]. docs/SPIEL.md §22 "blaettersturm senkt die Sicht": half the view, the edges close in. */
  leafStormSight: 0.5,
  /**
   * Tiles of the arena set burning by `arena_brennt` [tiles] when the layout marks none (a drawn test map, a slot without
   * a stamped layout): the ring at this share of the arena radius gets one patch every `burnSpacingTiles`. "Arena brennt
   * teilweise" (§20.2 Borkenvater): a burning ring around the boss leaves the centre and the rim to stand on.
   */
  burnRingShare: 0.55,
  /** Spacing of the fallback burning patches along their ring [tiles]. Every third tile burns: gaps to cross. */
  burnSpacingTiles: 3,
  /** Radius of a burning patch around its tile centre [px]. Half a tile and a little: standing on the tile means standing in it. */
  burnPatchRadiusPx: 10,
  /**
   * Light of a burning arena patch: radius [tiles], brightness [light level], flicker [0–1], flame height [px], colour
   * [palette ref]. Like a burning tile of the fire simulation (`BALANCE.fire.light`): the ring lights the arena.
   */
  burnLight: { radiusTiles: 4, intensity: 1, flicker: 0.3, flameHeightPx: 8, farbe: 'feuer.3' },
  /** Light of the boss's glowing knots while awake [tiles, light level, 0–1, palette ref]. The weak points glow in the dark (§4.6). */
  knotLight: { radiusTiles: 3, intensity: 0.7, flicker: 0.15, farbe: 'feuer.4' },
  /** Fear a boss sighting adds [points]. §12.3: "Sichtung Elite/Boss +10" – once when it awakens. */
  sightingFear: 10,
  /**
   * Distance from the boss's centre at which its servants rise [px]: a ring just outside the trunk, so a summon never
   * spawns into the player's face and never inside the boss.
   */
  summonRingPx: 40,
  /**
   * What a used shard adds for good: a heart shard [HP of maximum health], an ember shard [points of maximum stamina].
   * §20.2 "Herzsplitter (+10 max. Leben)", §21 "Glutsplitter (+5 max. Ausdauer)" (docs/SPIEL.md §22 "Splitter").
   */
  shards: { healthPerHeart: 10, staminaPerEmber: 5 },
};
