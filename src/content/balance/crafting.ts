/**
 * Balance values of crafting (MASTERPROMPT §15.1 "Crafting nimmt aus Inventar und Kisten im Umkreis von 8
 * Tiles (abschaltbar); Mengenwahl, Warteschlange (10), Abbrechen erstattet vollständig"; §23.2 Handwerk;
 * M3-16) – group `BALANCE.crafting` (src/content/balance.ts re-exports it). The recipes themselves are
 * content (src/content/recipes/). Every value states its unit and the reason for it.
 */
import { ACTION_BALANCE } from './actions';

/** Crafting time classes of the recipes (`dauer` of a recipe refers to one of them). */
export const CRAFT_TIME_CLASSES = ['handgriff', 'werkzeug', 'gross'] as const;
/** One crafting time class. */
export type CraftTimeClass = (typeof CRAFT_TIME_CLASSES)[number];

export const CRAFTING_BALANCE = {
  /** Orders waiting in the crafting queue at most [orders]. §15.1: "Warteschlange (10)". */
  queueLength: 10,
  /**
   * Pieces one order may ask for at most [pieces]. The quantity choice of §15.1 ("Mengenwahl") picks up
   * to a full stack of raw materials (100, §13.1): enough to turn a day's fibres into rope in one go,
   * small enough that a single order never blocks the queue for an hour.
   */
  maxOrderCount: 100,
  /** Radius around the player in which crafting takes from chests [tiles]. §15.1: "Kisten im Umkreis von 8 Tiles (abschaltbar)". */
  chestRadiusTiles: 8,
  /**
   * Radius around the player in which a station counts as at hand [tiles]. Twice the interaction reach
   * (1,5 tiles, §11.4): the player stands at the bench while its queue runs, not in its tile.
   */
  stationRadiusTiles: 3,
  /**
   * Distance from the feet to open water within which recipes that need water (filling a bucket) can be
   * made [tiles]. The reach of drinking (`BALANCE.actions.reachTiles`, §11.4): what one can drink from one
   * can scoop from.
   */
  waterReachTiles: ACTION_BALANCE.reachTiles,
  /**
   * Crafting time of one piece per time class [real seconds]. §15 gives no times; the rhythm of the
   * first day (§23.1: tools within the first in-game hour) sets them: a quick twist or bind (rope,
   * bandage, torch, filling a bucket) takes a breath, a tool lashed to its haft a few seconds, a
   * workbench, a campfire ring or a bed a short job. The Handwerk skill shortens them (§23.2 "+0,5 %
   * Wirkung je Stufe").
   */
  durationSeconds: { handgriff: 1.5, werkzeug: 3, gross: 6 } satisfies Record<CraftTimeClass, number>,
};
