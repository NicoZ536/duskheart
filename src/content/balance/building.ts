/**
 * Balance values of building (MASTERPROMPT §16.1 "Raster & Ebenen", §16.2 "Materialien", §16.3 "Statik",
 * §16.6 "Bau-UX"; M4-11, M4-12, M4-14) – group `BALANCE.building` (src/content/balance.ts re-exports it).
 * The build parts themselves are content (src/content/buildParts.ts). Every value states its unit and the
 * reason for it.
 *
 * - `materials`: the §16.2 table for the materials of tiers T0–T1 (the later rows – brick, reinforced stone,
 *   iron, obsidian, lumenite – come with the parts of their tiers): wall hit points, how well it burns
 *   (1 = like dry wood, 0 = not at all), tier, insulation of a wall of it (share of the difference to 18 °C a
 *   closed room keeps, §16.4), for roofs the reach of a roof tile to its support (§16.3), and the rank that decides
 *   which part may replace which when upgrading in place (§16.6).
 * - `hpFactor`: hit points of a part = wall hit points of its material × the factor of its kind.
 */

/** Build materials of tiers T0–T1 (§16.2). */
export const BUILD_MATERIALS = ['stroh', 'palisade', 'holz', 'fachwerk', 'lehm', 'stein', 'glas'] as const;
/** One build material. */
export type BuildMaterial = (typeof BUILD_MATERIALS)[number];

/** What a material gives the parts made of it. */
export interface BuildMaterialRules {
  /** Hit points of a wall of it [HP]. §16.2 "Wand-HP". */
  readonly wallHp: number;
  /** Flammability [0–1]: 1 burns like dry wood, 0 does not burn. §16.2 "Brennbar". */
  readonly flammability: number;
  /** Tier [T]. §16.2 "Stufe". */
  readonly tier: number;
  /** Insulation of a closed wall or roof of it [0–1]: the share of the way to 18 °C a room keeps (§16.4 "Dämmwert"). */
  readonly insulation: number;
  /** Farthest a roof tile of it may be from a support [tiles]. §16.3 "Stroh 3, Holz 5, Stein/Ziegel 6, Metall 8". */
  readonly roofReach: number;
  /**
   * Rank of the material when a part is upgraded in place [rank]: a part only gives way to one of a higher rank
   * (§16.6 "Aufwerten an Ort und Stelle (Holz → Stein)"), never to a lower one. The rows of the §16.2 wall table in
   * order – Stroh/Palisade, Holz, Fachwerk/Lehm, Stein – and glass, which §16.2 lists after shingles for roofs and
   * after the opening for windows, beside stone.
   */
  readonly upgradeRank: number;
}

export const BUILDING_BALANCE = {
  /** Farthest a part may be placed from the player [tiles]. §16.1: "Baureichweite 8 Tiles". */
  reachTiles: 8,
  /** Largest side of a placed object [tiles]. §16.1: "Objekte (1×1 bis 4×4)". */
  maxObjectSide: 4,
  /**
   * Highest finish (`ausbau`) of a build part within its material and tier [steps]: §16.2 names at most three
   * steps of one material – "Fenster (Öffnung, Glas, Buntglas)" – so glass has plain and stained.
   */
  maxFinish: 3,
  materials: {
    /**
     * Thatch (roofs of straw bundles): the weakest cover (§16.2 "Stroh/Palisade 150", burns), but a thick
     * layer of straw is the best insulator of the early roofs; §16.3 "Stroh 3".
     */
    stroh: { wallHp: 150, flammability: 1, tier: 0, insulation: 0.8, roofReach: 3, upgradeRank: 0 },
    /** Stakes rammed side by side: §16.2 "Stroh/Palisade 150, brennbar, T0"; the gaps between the stakes let the wind through. */
    palisade: { wallHp: 150, flammability: 1, tier: 0, insulation: 0.35, roofReach: 3, upgradeRank: 0 },
    /**
     * Planks: §16.2 "Holz 300, brennbar, T0"; wood insulates well – a closed plank house with a straw roof keeps
     * a spring night (≈ 9 °C) about 6 °C warmer inside (M4-16); §16.3 "Holz 5".
     */
    holz: { wallHp: 300, flammability: 1, tier: 0, insulation: 0.75, roofReach: 5, upgradeRank: 1 },
    /**
     * Timber frame filled with clay: §16.2 "Fachwerk/Lehm 450, kaum (−70 %), T1" – flammability 0,3; the thick
     * clay infill insulates best of the early walls. Its roofs rest on the same timber (§16.3 "Holz 5").
     */
    fachwerk: { wallHp: 450, flammability: 0.3, tier: 1, insulation: 0.85, roofReach: 5, upgradeRank: 2 },
    /** Rammed clay (floors): as sturdy as the clay infill of the timber frame (§16.2 "Fachwerk/Lehm 450"), does not burn. */
    lehm: { wallHp: 450, flammability: 0, tier: 0, insulation: 0.85, roofReach: 5, upgradeRank: 2 },
    /** Stone: §16.2 "Stein 900, nein, T1"; stone conducts more heat than wood and insulates a little worse; §16.3 "Stein/Ziegel 6". */
    stein: { wallHp: 900, flammability: 0, tier: 1, insulation: 0.7, roofReach: 6, upgradeRank: 3 },
    /**
     * Glass from the clay oven (M4-05): not in the §16.2 wall table – a pane breaks before a palisade (120) and
     * does not burn; a single pane insulates poorly. Glass roofs lie in a timber frame (§16.3 "Holz 5").
     */
    glas: { wallHp: 120, flammability: 0, tier: 1, insulation: 0.35, roofReach: 5, upgradeRank: 3 },
  } satisfies Record<BuildMaterial, BuildMaterialRules>,
  /**
   * Hit points of a part relative to a wall of its material [factor]. §16.2 lists wall HP only; the rest
   * follows how much material stands in the way: a door is the weak point of a wall (the Brecher of §16.8
   * attack the weakest part), a two-leaf gate is framed stronger, a window is mostly a hole, a fence or a
   * post is half a wall, floors, roofs, stairs and ladders are thin boards, furniture is lighter still.
   */
  hpFactor: {
    wand: 1,
    tuer: 0.6,
    tor: 0.8,
    fenster: 0.4,
    saeule: 1,
    zaun: 0.5,
    leiter: 0.3,
    treppe: 0.5,
    boden: 0.5,
    steg: 0.5,
    falltuer: 0.4,
    dach: 0.4,
    moebel: 0.3,
    wandmoebel: 0.2,
  },
  /**
   * Insulation of an open door or gate, relative to the closed one [factor]: an open doorway lets the outside
   * air straight in (§16.4 "Temperatur nach Dämmwert der Wände").
   */
  openDoorInsulation: 0,
  /**
   * Insulation of a closed door or gate relative to a wall of its material [factor]: boards with a gap at the
   * sill keep out less than a wall (a gate more gaps than a door).
   */
  doorInsulation: { tuer: 0.8, tor: 0.7 },
  refund: {
    /** Time after placing in which dismantling gives the part back whole [s]. §16.6: "100 % zurück in den ersten 30 s". */
    fullSeconds: 30,
    /** Share of the materials dismantling gives back after that [fraction]. §16.6: "danach 60 %". */
    lateShare: 0.6,
    /** Share of the materials a collapsed roof tile leaves [fraction]. §16.3: "stürzen … ein (Staub, 50 % Material zurück)". */
    collapseShare: 0.5,
  },
  /**
   * How long the build mode can take back a step of placing (Ctrl+Z) after its newest piece stood [s of game time].
   * §16.6: "Rückgängig innerhalb von 10 s (Strg+Z)" – well inside the full refund window, so undoing costs nothing.
   */
  undoSeconds: 10,
  /**
   * More pieces than this taken down by one drag of the dismantle tool wait for a confirming click [pieces] (§16.6
   * "Abbauen" with area drag; a stray drag over a finished house takes nothing down unasked). 8 = one wall side of the
   * starter hut or a small floor; a single piece or a short fence line goes at once.
   */
  dismantleConfirmAbove: 8,
  /**
   * Hand tool that finishes a blueprint (§16.6 "Blaupausen: … mit Hammer … fertigstellen"): the tool kind of
   * the item in the hand.
   */
  blueprintTool: 'hammer',
  /**
   * Area repair (§16.6 "Flächenreparatur", M4-25): the hammer mends every damaged part of a rectangle within build
   * reach, paying from the bags and the chests near each part.
   */
  repair: {
    /**
     * Share of a part's materials that mending it from 0 to full hit points costs [fraction]; a part at half its hit
     * points costs half of that. Like mending a tool (`BALANCE.crafting.repairMaterialShare`, §13.1): half the
     * materials, rounded up per material.
     */
    materialShare: 0.5,
    /** Longest side of the repaired rectangle [tiles]: the build reach both ways from the player (2 × 8 + 1, §16.1). */
    maxAreaTiles: 17,
  },
};
