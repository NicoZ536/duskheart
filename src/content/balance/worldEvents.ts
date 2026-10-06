/**
 * Balance values of the world events (MASTERPROMPT §10 "Ereignisse", "Blitze"; docs/SPIEL.md §18; M7-38 … M7-40) – group
 * `BALANCE.worldEvents` (src/content/balance.ts re-exports it). The register itself – planning chances, durations, lead
 * times, texts – is content (src/content/worldEvents/). Every value states its unit and the reason for it.
 */

export const WORLD_EVENTS_BALANCE = {
  /**
   * Window in which a night event (`naechtlich`, the Lumen rain) begins [hours of the clock, 22 … 26 = 02:00 the next
   * morning]. Deep in the night, when every season's sky is fully dark (summer's night is the shortest: 23:00–03:00 dark).
   */
  nightWindowHours: [22, 26] as const,
  /**
   * Window in which a day event (`taeglich`, the eclipse) begins [hours of the clock]. Late morning to mid-afternoon: the
   * sun is high in every season (winter 08:00–16:00 light), so the eclipse is unmistakably "night by day".
   */
  dayWindowHours: [10, 15] as const,
  /**
   * Minutes the eclipse takes to darken the day fully and to give it back [game minutes]. §10 "eine Stunde Nacht": the hour
   * counts from full darkness to its end; a few minutes of creeping dusk make it read as a sky event, not a switch.
   */
  eclipseRampMinutes: 6,
  /**
   * Daylight factor of the eclipse below which the day counts as night for fear and the creatures' day/night [0–1]. Below a
   * third of the light the world looks like dusk turning night (the dusk phases cross 0,3 too): the shadow brood wakes, the
   * fear of the dark sets in (docs/SPIEL.md §18 "Lichtkarte, Schattenbrut, Furcht und Himmel lesen denselben Wert").
   */
  eclipseNightBelow: 0.3,
  /**
   * Chance per game minute that a glowing shard falls during the Lumen rain [0–1 per minute]. About one shard every two
   * minutes: 15–30 shards over a rain of 30–60 minutes – a good night's find (a shard is worth a fifth of a heart, §23), not a
   * fortune.
   */
  shardChancePerMinute: 0.5,
  /** Distance of a falling shard from the player [tiles, min–max]: in sight or just beyond it (the view is 30 × 17 tiles). */
  shardDistanceTiles: [5, 22] as const,
  /** Chance that a Lumen rain brings a meteorite [0–1 per rain]. §10 "selten ein Meteorit": one rain in four. */
  meteorChance: 0.25,
  /** Distance of the meteorite's impact from the player [tiles, min–max]: visible from afar, a short walk away. */
  meteorDistanceTiles: [12, 28] as const,
  /** Pieces of star ore a meteorite leaves [pieces, min–max]. A crater node gives 1–2 a strike; the meteorite is worth more. */
  meteorOre: [3, 5] as const,
  /**
   * Chance of a lightning strike per weather region and game minute in a thunderstorm [0–1]. A storm of 1–3 hours over the
   * player's region brings 15–60 strikes – most far off, a few close: the danger is real but rare.
   */
  strikeChancePerMinute: 0.25,
  /**
   * Radius around the strike point in which the lightning seeks the tallest target [tiles]. §10 "schlagen bevorzugt in hohe
   * Objekte und Metall": within a few tiles a tree or a wall draws the bolt instead of the open ground.
   */
  strikeSearchTiles: 4,
  /**
   * How far from the player a strike lands [tiles, max]. Strikes only happen in the active zone (a fire in a frozen chunk would
   * burn unseen); beyond this they are distant flashes and thunder, presentation only.
   */
  strikeRangeTiles: 30,
  /**
   * World objects of metal that draw a bolt first [object ids]. §10 "bevorzugt … Metall": the graveyard's iron fence; metal
   * build parts arrive with the iron age (M8) and join here.
   */
  metalObjects: ['ort_eisenzaun', 'ort_eisenzaun_senkrecht'] as const,
  /**
   * Tall world objects that draw a bolt like a tree [object ids]. §10 "bevorzugt hohe Objekte": the look-out tower, the
   * Builder pillars and the graveyard's obelisk, the bridge pillars, the ancient tree.
   */
  tallObjects: ['ort_aussichtsturm', 'ort_saeule', 'ort_obelisk', 'ort_brueckenpfeiler', 'ort_uraltbaum'] as const,
  /** Chance that a strike sets a tree alight [0–1]: wet bark often only smokes. */
  igniteTreeChance: 0.3,
  /** Chance that a strike sets a tree alight during a forest fire (a dry summer storm) [0–1]. §10 "Waldbrand (Sommer, Blitz)". */
  igniteTreeChanceDry: 0.9,
  /** Chance that a strike sets a wooden build part alight [0–1]. §10 "können … Holzbauten entzünden". */
  igniteWoodChance: 0.4,
  /** Radius around the strike in which the player is hit [tiles]: standing next to the struck tree is enough. */
  playerHitTiles: 1.5,
  /** Damage of a strike to the player [HP]. A third of a fresh life (100): a warning to seek shelter, not an instant death. */
  playerDamage: 35,
} as const;
