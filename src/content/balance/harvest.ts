/**
 * Balance values of harvesting the world (MASTERPROMPT §11.4 "Sammeln (halten, Fortschrittsring)",
 * §13.2, §14, §D "Sammeln: Treffer = ⌈Ressourcen-HP / (Abbaukraft × (1 + Skillbonus))⌉"; M3-11 … M3-14) –
 * group `BALANCE.harvest` (src/content/balance.ts re-exports it). Hit points and regrow days of the
 * world objects themselves stay with the objects (src/content/worldObjects.ts, `BALANCE.gathering`).
 * Every value states its unit and the reason for it.
 */
export const HARVEST_BALANCE = {
  /**
   * Time between two tool hits while the action is held [s]. The tool clip of the player (M3-06:
   * `tool_<richtung>`, 6 frames at 12 fps) lasts 0,5 s; one hit per swing. A Grünhain tree (5 hits with
   * a stone axe, §D) falls after 2,5 s of chopping.
   */
  toolSwingSeconds: 0.5,
  /** Time from the start of a swing to its hit [s]: the clip's `treffer` event sits on frame 4 of 6 at 12 fps (4/12 s). */
  toolHitSeconds: 1 / 3,
  /**
   * Time to pick something by hand while the action is held [s] (berries, fruit, herbs, flowers,
   * scatter). The progress ring fills once; half a second reads as a deliberate pick without slowing a
   * walk through a berry patch.
   */
  handPickSeconds: 0.5,
  /** Durability a hit costs the tool [uses]. §D counts durability in uses: one hit is one use. */
  toolWearPerHit: 1,
  /**
   * Hit points of a stump relative to its tree [fraction]. §14 "Der Stumpf bleibt (roden: Harz/Holz)":
   * clearing it is a short second job – 2 hits with the axe of its tier (40 % of the 5 hits).
   */
  stumpHpShare: 0.4,
  tree: {
    /**
     * Time from the last axe hit until the trunk hits the ground [s]. §14 "Der Baum fällt vom Spieler
     * weg": the fall is watched, the logs fly out of the trunk when it lands.
     */
    fallSeconds: 1,
    /** Length of the fallen trunk [tiles]: the fall-trunk sprites are 26–44 px long (M3-11 art), rounded up. */
    fallLengthTiles: 3,
    /**
     * Damage to creatures the trunk falls on [HP]. §14 "verletzt Kreaturen, auf die er stürzt": a quarter
     * of the base health – a felled tree is a weapon worth aiming, but no one-shot (§D "kein One-Shot").
     */
    creatureDamage: 25,
  },
  /**
   * Days until a picked fruit tree carries fruit again [game days]. As long as a berry bush
   * (`BALANCE.gathering.bushRegrowDays`): fruit trees are the tree-sized berry bushes of the season.
   */
  fruitRegrowDays: 3,
  mushrooms: {
    /**
     * Mushrooms regrow only in the cool damp hours (§14 "Pilze (Ort und Tageszeit)"): a picked
     * mushroom is back at its place after its regrow days, but only once the evening begins – from 18:00
     * through the night until 10:00 in the morning [game hour of the window's start].
     */
    fromHour: 18,
    /** End of the mushroom hours [game hour, exclusive]. Mid-morning, when the dew is gone. */
    toHour: 10,
    /** World objects that are mushrooms [world object ids]. The cave glowcaps are not listed: under ground there is no day, they regrow at any hour. */
    objects: ['pflanze_steinpilz', 'deko_pilze'] as readonly string[],
  },
  solid: {
    /**
     * Hits a tile of host rock takes per point of hardness with a pickaxe of its tier [hits]. Tunnelling
     * must beat mining a surface node (5 hits, §D): 3 hits (1,5 s) per tile of a Wurzelhöhlen wall.
     */
    rockHitsWithTierTool: 3,
    /** Hits an ore vein tile takes per point of hardness [hits]: a vein is an ore node in the rock (§14), as hard to open as the node (5, §D). */
    veinHitsWithTierTool: 5,
  },
  dig: {
    /** Shovel hits to dig one tile per point of hardness [hits]: a shovel of the tile's tier digs in 2 swings (1 s). */
    hitsWithTierTool: 2,
    /** Pieces of material one dug tile yields [items], at least. §14 "Graben (Schaufel): Erde, Lehm, Sand …". */
    yieldMin: 1,
    /** Pieces of material one dug tile yields [items], at most: two tiles fill a hand, a garden bed needs a few trenches. */
    yieldMax: 2,
    /**
     * Chance that an untouched tile of open ground hides a dig spot [probability per tile]. §14
     * "versteckte Buddelstellen": a path of a hundred dug tiles turns up about one.
     */
    spotChance: 0.01,
    /** Items a dig spot yields [rolls on the dig spot table, src/content/digSpots.ts]: a small find, never a hoard. */
    spotRolls: 2,
  },
};
