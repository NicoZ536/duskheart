/**
 * Balance values of sleep (MASTERPROMPT §11.5, M3-24) – group `BALANCE.sleep` (src/content/balance.ts
 * re-exports it). Every value states its unit and the reason for it.
 *
 * Sleeping places: the id of a place kind is the id of the item that is slept in (`bett`, the M3-16
 * `grasbett`, the portable `schlafsack`); the building system reports placed beds with these kinds, a
 * carried portable place (an item in the bags) can be slept on anywhere.
 */

/** What a kind of sleeping place gives. */
export interface SleepPlaceRules {
  /** Share of the full exhaustion recovery [factor]. §11.5: "Schlafsack: halbe Erholung". */
  readonly recovery: number;
  /** Sleeping here sets the respawn point (§11.5 "Das Bett setzt den Wiedereinstiegspunkt"). */
  readonly respawn: boolean;
  /** A completed sleep gives "Ausgeruht" (§11.5: the bed does, the sleeping bag does not). */
  readonly rested: boolean;
  /** Lying here counts as resting for health regeneration (§11.1 "×2 … im Bett"). */
  readonly resting: boolean;
  /** Carried in the bags and rolled out anywhere. */
  readonly portable: boolean;
}

export const SLEEP_BALANCE = {
  /** Hour from which sleeping is possible [game hour]. §11.5: "Möglich ab 19:00". */
  fromHour: 19,
  /** Hour at which a night's sleep ends [game hour]. §11.5: "Zeit läuft ×30 bis 06:00". */
  wakeHour: 6,
  /** Exhaustion above which sleeping is possible at any hour [points]. §11.5: "oder bei Erschöpfung > 60". */
  exhaustionAbove: 60,
  /** No enemy may be this close [tiles]. §11.5: "nicht mit Feinden im Umkreis von 20 Tiles". */
  enemyRadiusTiles: 20,
  /** Speed of time while asleep [factor]. §11.5: "Zeit läuft ×30". */
  timeScale: 30,
  /**
   * Game hours a full recovery (bed) takes from exhaustion 100 to 0 [game hours]. A night from 19:00 to
   * 06:00 lasts 11 hours: a bed restores even a completely exhausted player with three hours to spare,
   * a grass bed or sleeping bag at half recovery (16 h) leaves about a third of it.
   */
  fullRecoveryGameHours: 8,
  /** Distance to a placed sleeping place the player can lie down in [tiles]. The interaction reach of §11.4 ("E" on targets next to the player). */
  reachTiles: 2,
  /** "Ausgeruht" after a completed sleep in a bed [s]. §11.5: "Dauer 8 min + 1 min je Behaglichkeitspunkt". */
  rested: {
    baseSeconds: 480,
    perComfortSeconds: 60,
    /** Factor in a bedroom [factor]. §16.4: "Schlafraum (Bett + Licht: Ausgeruht ×1,5)". */
    bedroomFactor: 1.5,
  },
  /** Kinds of sleeping places by item id. */
  places: {
    bett: { recovery: 1, respawn: true, rested: true, resting: true, portable: false },
    /**
     * The first bed of the first day (M3-16): straw on the ground rests only half as well as a real bed
     * (§11.5 "halbe Erholung" of the makeshift places) and gives no "Ausgeruht", but it is placed at the
     * camp, so it marks where the player returns after death.
     */
    grasbett: { recovery: 0.5, respawn: true, rested: false, resting: true, portable: false },
    /** §11.5 "Schlafsack: halbe Erholung, kein Ausgeruht"; carried along, it marks no home. */
    schlafsack: { recovery: 0.5, respawn: false, rested: false, resting: false, portable: true },
  } satisfies Record<string, SleepPlaceRules>,
};
