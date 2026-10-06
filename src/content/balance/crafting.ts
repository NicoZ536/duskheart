/**
 * Balance values of crafting (MASTERPROMPT §15.1 "Crafting nimmt aus Inventar und Kisten im Umkreis von 8
 * Tiles (abschaltbar); Mengenwahl, Warteschlange (10), Abbrechen erstattet vollständig", "Stationsstufen
 * erhöhen Qualität, Tempo und verfügbare Rezepte"; §13.1 "Qualität 1–3 Sterne (aus Handwerks-Skill und
 * Stationsstufe)", "Reparatur an Werkbank, Amboss oder Schleifstein (anteilige Materialkosten)"; §23.2
 * Handwerk; M3-16, M4-01 … M4-04, M4-09) – group `BALANCE.crafting` (src/content/balance.ts re-exports it).
 * The recipes themselves are content (src/content/recipes/), the stations too (src/content/stations.ts,
 * their stage values in src/content/balance/stations.ts). Every value states its unit and the reason for it.
 */
import { ACTION_BALANCE } from './actions';

/** Crafting time classes of hand work – in the hand or at a crafting station (the player's queue). */
export const HAND_TIME_CLASSES = ['handgriff', 'werkzeug', 'gross'] as const;
/** Time classes of processing stations (a batch runs on its own: drying, charring, firing, smelting, tanning; §15.1). */
export const PROCESS_TIME_CLASSES = ['trocknen', 'koehlern', 'brennen', 'schmelzen', 'gerben', 'kompostieren'] as const;
/** Every time class a recipe's `dauer` can name. */
export const CRAFT_TIME_CLASSES = [...HAND_TIME_CLASSES, ...PROCESS_TIME_CLASSES] as const;
/** One crafting time class. */
export type CraftTimeClass = (typeof CRAFT_TIME_CLASSES)[number];
/** One time class of hand work. */
export type HandTimeClass = (typeof HAND_TIME_CLASSES)[number];
/** One time class of processing. */
export type ProcessTimeClass = (typeof PROCESS_TIME_CLASSES)[number];

export const CRAFTING_BALANCE = {
  /** Orders waiting in the crafting queue at most [orders]. §15.1: "Warteschlange (10)". */
  queueLength: 10,
  /**
   * Pieces one order may ask for at most [pieces]. The quantity choice of §15.1 ("Mengenwahl") picks up
   * to a full stack of raw materials (100, §13.1): enough to turn a day's fibres into rope in one go,
   * small enough that a single order never blocks the queue for an hour.
   */
  maxOrderCount: 100,
  /**
   * Recipes pinned to the HUD's recipe tracker at once at most [recipes] (§15.1 "Rezept anheften → HUD zeigt fehlende
   * Zutaten live", §26 "rechts … Rezept-Tracker"): three plates with their missing ingredients fit between the minimap
   * and the hotbar at 480 × 270 design px; pinning a fourth lets the oldest go.
   */
  maxPinnedRecipes: 3,
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
   * first day (§23.1: tools within the first in-game hour) sets the hand classes: a quick twist or bind
   * (rope, bandage, torch, filling a bucket) takes a breath, a tool lashed to its haft a few seconds, a
   * workbench, a campfire ring or a bed a short job. The Handwerk skill shortens them (§23.2 "+0,5 %
   * Wirkung je Stufe"), a better station too (its `tempo`).
   *
   * Processing stations work on their own while the player does something else (§15.1 "laufen
   * zeitbasiert"), so one batch takes about one to three burn times of a log (45 s, §15.4): drying straw or
   * raw bricks on the rack two minutes (the slowest, it needs no fuel), a charcoal kiln three minutes for a
   * load of wood (the smouldering pile, the longest wait for the most valuable fuel), firing bricks, pots
   * and glass in the clay oven one minute, smelting ore or casting bronze one minute – the charcoal of one
   * kiln load (3 × 120 s) smelts six bars. Tanning a hide on the frame (M6-31, §15.1 "Gerbrahmen") takes four minutes – the
   * longest wait of all, like the day it takes bark tannin to cure a pelt, and like the rack it needs no fuel.
   */
  durationSeconds: {
    handgriff: 1.5,
    werkzeug: 3,
    gross: 6,
    trocknen: 120,
    koehlern: 180,
    brennen: 60,
    schmelzen: 60,
    gerben: 240,
    // Strand D (M7-20, docs/SPIEL.md §20 "Kompostkiste (Verarbeitungsstation, Tage)"): garden waste rots into compost in one
    // game day at the standard day length (24 real minutes) – the slowest batch of all, it needs neither fire nor care.
    kompostieren: 1440,
  } satisfies Record<CraftTimeClass, number>,
  /**
   * Quality of crafted pieces (§13.1 "Qualität 1–3 Sterne (aus Handwerks-Skill und Stationsstufe)"): the
   * quality score is the Handwerk level (1–100, §23.2) plus the quality points of the station
   * (`BALANCE.stations.stages`). Only pieces with durability or stats have a quality – the +10 %/+20 % act
   * on stats and durability (`BALANCE.items.quality.bonus`).
   */
  quality: {
    /**
     * Score from which a piece gets 2 and 3 stars [points]. A crafter at level 40 makes 2-star pieces at a
     * plain bench, at level 80 3-star pieces; a better station (Werkbank II, the anvil: +20) brings each
     * star 20 levels earlier – "Stationsstufen erhöhen Qualität" (§15.1).
     */
    thresholds: [40, 80] as readonly number[],
    /**
     * Most stars of a piece made in the hand, without a station [stars]. A masterpiece needs a bench to
     * clamp the work on: the hand basics (§15.1 "Grundlagen") reach 2 stars at most.
     */
    handMaxStars: 2,
  },
  /**
   * Repair at a workbench, anvil or grindstone (§13.1 "anteilige Materialkosten"): mending a piece costs
   * the ingredients of its recipe times the worn share of its durability times this factor [fraction].
   * Half: a broken tool costs half a new one to mend – worth doing for a piece with quality or when
   * material is short, not a way around making tools at all.
   */
  repairMaterialShare: 0.5,
};
