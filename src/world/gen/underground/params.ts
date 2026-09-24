/**
 * Tuning of the underground layers −1/−2/−3 (MASTERPROMPT §9.1, §9.2 "Untergrund", §9.3 cave biomes;
 * docs/WORLD.md §2). Every value states its unit and the reason for it (§2.4). Distances are in tiles
 * because the player walks in tiles; counts per world size keep the three sizes comparable.
 *
 * Content is referenced by string id (terrain, ores, world objects); `tests/unit/world/underground.test.ts`
 * checks that every id exists, belongs to the layer's biome and that every underground object and
 * vein ore of the content is placed by exactly this table.
 */
import type { WorldSizePreset } from '../../../content/balance';

/** Version of the underground generator; part of the plan so saved hashes never match a changed generator. */
export const UNDERGROUND_VERSION = 1;

/** Layer −1 Wurzelhöhlen (WORLD.md §1). */
const WURZELHOEHLEN_LAYER = -1;
/** Layer −2 Tiefgrund. */
const TIEFGRUND_LAYER = -2;
/** Layer −3 Glutadern. */
const GLUTADERN_LAYER = -3;
/** The three underground layers, top down (WORLD.md §1). */
export const UNDERGROUND_LAYERS = [WURZELHOEHLEN_LAYER, TIEFGRUND_LAYER, GLUTADERN_LAYER] as const;
/** One underground layer. */
export type UndergroundLayer = (typeof UNDERGROUND_LAYERS)[number];
/** A layer with an underground layer below it: the surface, −1 and −2. */
export type UpperLayer = 0 | Exclude<UndergroundLayer, typeof GLUTADERN_LAYER>;

/** Special cavern kinds of the layers (§9.3 "Pilzhaine", "Kristalladern", "Obsidianhallen"). */
export const CAVE_SPECIALS = ['pilzhain', 'kristallgrotte', 'obsidianhalle'] as const;
/** One special cavern kind. */
export type CaveSpecial = (typeof CAVE_SPECIALS)[number];

// ---------------------------------------------------------------------------------------------
// Entrances and links between layers
// ---------------------------------------------------------------------------------------------

export const LINKS = {
  /**
   * Smallest distance between two natural cave entrances [tiles]. 96 tiles ≈ 21 s walking (§11.4
   * 4,5 tiles/s): entrances are landmarks, not holes on every hill.
   */
  entranceMinSpacingTiles: 96,
  /** Most entrances per world size [entrances]. ≈ one per 150 × 150 tiles of island, so every region has one within reach. */
  entranceMaxCount: { small: 10, medium: 16, large: 24 } satisfies Record<WorldSizePreset, number>,
  /** Spacing of the default candidate set `proposeEntranceCandidates` [tiles]. Wider than the minimum so the cap picks from a spread-out set. */
  candidateSpacingTiles: 110,
  /** Core radius of the chamber under an entrance or at the foot of a shaft [tiles]. 3,5 keeps the 7 × 7 tiles around the link open. */
  accessCoreRadius: 3.5,
  /** Soft radius of that chamber [tiles]. */
  accessSoftRadius: 5,
  /** Noise amplitude of the chamber outline [tiles]. */
  accessJitter: 1.5,
  /** Rough band around the chamber [tiles]. */
  accessBand: 3,
  /** Tiles around a link kept free of objects [tiles, Chebyshev]. Two tiles: the player never steps out of a shaft into a rock. */
  reserveRadius: 2,
  /** Caverns closer than this to an access point are dropped [tiles]. Keeps the entrance chamber distinct from the first cavern. */
  accessClearanceTiles: 26,
  /** Access points closer than this factor × entrance spacing may share one cave system [factor]. */
  mergeDistanceFactor: 1.8,
  /** Chance that two such neighbouring access points share one system [0–1]. Some systems have two ways out. */
  mergeChance: 0.35,
} as const;

/**
 * Lloyd relaxation rounds when spreading shafts and place slots over the caverns [rounds]. The
 * centres settle within a few rounds; eight leave them in the middle of their share.
 */
export const LLOYD_ITERATIONS = 8;

// ---------------------------------------------------------------------------------------------
// Area and carving (§9.2 "zelluläre Automaten + Rauschtunnel + Kavernen", WORLD.md §2 "Rand-Überlapp")
// ---------------------------------------------------------------------------------------------

export const AREA = {
  /** Band along the world edge without caves [tiles]. The island leaves ≥ 48 tiles of sea there (plan ISLAND.edgeMarginTiles). */
  edgeMarginTiles: 40,
  /** Growth of the surface land mask where caverns may lie [mask cells]. Caves reach a little under the coast. */
  extentDilationCells: 3,
} as const;

export const CARVE = {
  /**
   * Cellular automaton iterations [steps]. Four smoothing passes turn the random band into rounded
   * alcoves; each pass needs one tile of border overlap (WORLD.md §2 "Rand-Überlapp").
   */
  caIterations: 4,
  /**
   * Longest path from the carved skeleton to an extra open tile [tiles]. Everything farther away (or
   * not connected at all) is filled with rock, so every open tile belongs to a system with an access
   * point. Also the border overlap of a chunk: the check is exact because no such path leaves it.
   */
  attachMaxTiles: 16,
  /** Extra tiles computed around a chunk for object rules that look at neighbours [tiles]. */
  objectMarginTiles: 3,
  /** Chance that a tile inside the soft outline starts open [0–1]. A few rocks survive and the automaton rounds them off. */
  insideOpenChance: 0.9,
  /**
   * Chance that a tile at the inner edge of the rough band starts open [0–1]; falls linearly to 0 at
   * its outer edge. 0,75: near the outline the automaton keeps most of it and grows alcoves, farther
   * out it closes the sparse tiles again.
   */
  bandOpenChance: 0.5,
  /** A tile closes when at least this many of its 8 neighbours are rock [tiles]. Classic 4-5 rule. */
  closeAtRockNeighbours: 5,
  /** A tile opens when at most this many of its 8 neighbours are rock [tiles]. */
  openAtRockNeighbours: 3,
  /** Frequency of the outline noise [cycles per tile]. ≈ 9 tile bumps on cavern and tunnel walls. */
  shapeFrequency: 0.11,
  /** Frequency of the outline detail octave [cycles per tile]. ≈ 4 tile knobs on top of the bumps. */
  shapeDetailFrequency: 0.24,
  /** Weight of the detail octave in the outline noise [0–1]; the main octave gets the rest. */
  shapeDetailWeight: 0.35,
  /**
   * Frequency of the alcove noise that scales the band's open chance [cycles per tile]. Patches of
   * ≈ 10 tiles: where it is high the automaton keeps alcoves and side pockets, elsewhere the wall
   * stays smooth, so tunnels do not read as hoses.
   */
  alcoveFrequency: 0.09,
  /** Strength of the alcove noise: band chance × (1 + gain × noise) [factor]. */
  alcoveGain: 0.3,
  /** Frequency of the floor patch noise [cycles per tile]. Patches of 10–15 tiles. */
  floorFrequency: 0.07,
  /** Radius around a special cavern within which its floor, objects and ore boost apply, beyond its soft radius [tiles]. */
  specialMarginTiles: 4,
} as const;

export const SHAPES = {
  /** Soft radius of a satellite chamber [fraction of its cavern's soft radius]. Satellites make caverns lobed instead of round. */
  satelliteSizeMin: 0.45,
  satelliteSizeMax: 0.75,
  /** Distance of a satellite from its cavern centre [fraction of the cavern's soft radius]. */
  satelliteOffsetMin: 0.45,
  satelliteOffsetMax: 0.8,
  /** Overlap kept between the cores of a satellite and its cavern [tiles]; two tiles guarantee a shared open tile. */
  satelliteCoreOverlap: 2,
  /** Chance that a cavern with side passages has a second one [0–1]. */
  wormSecondChance: 0.35,
  /** Soft radius of the chamber at the end of a side passage [tiles]. */
  wormChamberMin: 3,
  wormChamberMax: 5,
} as const;

export const LAKES = {
  /** Dry ring kept between a lake and the edge of its cavern core [tiles]. The way around a lake never needs swimming. */
  ringTiles: 2.5,
  /** Smallest lake radius [tiles]. */
  minRadius: 2.5,
  /** Lake outline amplitude [fraction of the lake radius]. Bays of up to a third of the radius. */
  outlineAmplitude: 0.18,
  /** Distance of the outline noise sample from the lake centre [tiles]; larger = more bays. */
  outlineScale: 7,
  /** Width of the shallow (wadeable) rim [tiles]. */
  shallowWidth: 1.6,
} as const;

export const VEINS = {
  /** Frequency of the deposit mask [cycles per tile]. Deposits of 25–40 tiles. */
  depositFrequency: 0.028,
  /** Frequency of the vein pattern [cycles per tile]. Veins wind every ≈ 13 tiles. */
  veinFrequency: 0.075,
  /**
   * Vein pattern threshold: 1 − |noise| above this is ore [0–1]. 0,86 ⇔ |noise| < 0,14, measured
   * ≈ 18 % of all tiles as lines ≈ 2 tiles wide (thinner lines break into diagonal specks); the
   * deposit mask keeps them in pockets. Single vein tiles without a 4-neighbour of the same ore
   * are dropped.
   */
  ridgeThreshold: 0.86,
} as const;

// ---------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------

/** Placement density of one object per zone [objects per tile]. */
export interface ObjectDensity {
  /** World object id. */
  readonly id: string;
  /** Dry floor tile touching rock. */
  readonly wand: number;
  /** Dry floor tile in the open. */
  readonly frei: number;
  /** Inside a special cavern (grove, grotto, hall). */
  readonly besonders: number;
}

/** A floor terrain used where the floor noise lies above `above` or below `below` (exactly one is given). */
export interface FloorPatch {
  readonly terrain: string;
  /** Floor noise threshold [−1, 1]: the patch covers values above it. */
  readonly above?: number;
  /** Floor noise threshold [−1, 1]: the patch covers values below it. */
  readonly below?: number;
}

/** Tuning of one underground layer. */
export interface LayerParams {
  readonly layer: UndergroundLayer;
  /** Biome id of the whole layer (§9.3). */
  readonly biome: string;
  /** Solid host rock (terrain `fest`). */
  readonly hostRock: string;
  /** Floor terrain (`boden`). */
  readonly floor: string;
  /** Floor patches over the base floor. */
  readonly floorPatches: readonly FloorPatch[];
  /** Floor of the tiles ringing a lake (water: shore, lava: cooled crust). */
  readonly lakeRim: string;
  /** Poisson spacing of caverns [tiles]. */
  readonly cavernSpacing: number;
  /** Soft radius of a cavern [tiles]. */
  readonly cavernRadiusMin: number;
  readonly cavernRadiusMax: number;
  /** Core radius as a fraction of the soft radius [ratio]; the core is carved for sure. */
  readonly coreFraction: number;
  /** Outline noise of caverns [fraction of the soft radius]. */
  readonly cavernJitter: number;
  /** Rough band around caverns [tiles]. */
  readonly cavernBand: number;
  /** Satellite chambers per cavern [count]; each merges into the main chamber. */
  readonly satellitesMax: number;
  /** Tunnel core radius [tiles]; ≥ 1 keeps every tunnel passable. */
  readonly tunnelCoreMin: number;
  readonly tunnelCoreMax: number;
  /** Soft radius beyond the core [tiles]. */
  readonly tunnelSoftExtra: number;
  /** Outline noise of tunnels [tiles]. */
  readonly tunnelJitter: number;
  /** Rough band around tunnels [tiles]. */
  readonly tunnelBand: number;
  /** Sideways displacement of a tunnel midpoint [fraction of the segment length]. */
  readonly meander: number;
  /** Tunnels are subdivided until segments are shorter than this [tiles]. */
  readonly segmentTiles: number;
  /** Chance of an extra loop tunnel from a cavern to its nearest unconnected neighbour [0–1]. */
  readonly loopChance: number;
  /** Longest loop tunnel [factor of the cavern spacing]. */
  readonly loopMaxFactor: number;
  /** Chance of dead-end side passages ("Rauschtunnel") from a cavern [0–1]. */
  readonly wormChance: number;
  /** Steps of a side passage [count]. */
  readonly wormStepsMin: number;
  readonly wormStepsMax: number;
  /** Step length of a side passage [tiles]. */
  readonly wormStepTiles: number;
  /** Chance per step that a side passage turns by 22,5° [0–1]. */
  readonly wormTurnChance: number;
  /** Chance of a small chamber at the end of a side passage [0–1]. */
  readonly wormChamberChance: number;
  /** Farthest distance of a cavern from its access point [tiles per world size]; farther caverns stay rock. */
  readonly reachTiles: Readonly<Record<WorldSizePreset, number>>;
  /**
   * Lakes: water or lava; chance per cavern; a lake cavern grows by `cavernScale` (lakes need room
   * for water plus a dry ring); smallest grown core that can hold one [tiles].
   */
  readonly lake: { readonly kind: 'wasser' | 'lava'; readonly chance: number; readonly cavernScale: number; readonly minCore: number };
  /** Special caverns of the layer. */
  readonly special: {
    readonly kind: CaveSpecial;
    readonly chance: number;
    /** Floor inside the special cavern. */
    readonly floor: string;
    /** Ores whose deposits reach further around it [ore ids]. */
    readonly oreBoost: readonly string[];
  };
  /** Shafts down to the next layer per world size [count]. */
  readonly shaftsDown: Readonly<Record<WorldSizePreset, number>>;
  /** Cave place slots (§21 "Höhlenorte", Untergrund-Spezialorte) per world size [count]. */
  readonly slots: Readonly<Record<WorldSizePreset, number>>;
  /** Smallest cavern core for a place slot [tiles]. */
  readonly slotMinCore: number;
  /**
   * Ore veins `ader_<ore>`: deposit mask threshold per ore [−1, 1]; higher = rarer. Measured share of
   * the simplex field above a threshold: 0,52 ≈ 14 %, 0,58 ≈ 10 %, 0,6 ≈ 8 %, 0,63 ≈ 6,5 %,
   * 0,68 ≈ 5 %, 0,71 ≈ 4 %; times ≈ 18 % vein pattern gives the share of rock per ore (common ≈ 2,5 %,
   * rare ≈ 0,7 %).
   * Order = check order (rarest first, so a rare vein is not hidden under a common one).
   */
  readonly veins: ReadonlyArray<{ readonly ore: string; readonly deposit: number }>;
  /** Deposit threshold decrease for boosted ores near a special cavern [noise units]. */
  readonly oreBoostAmount: number;
  /** Non-blocking objects (plants, scatter) per zone. */
  readonly scatter: readonly ObjectDensity[];
  /**
   * Blocking objects (bushes, rocks, crystals, ore nodes) per zone; placed only on lattice tiles
   * (pitch = largest footprint + 1), so the chance per lattice tile is density × lattice area and each
   * zone's densities must sum to ≤ 1 / lattice area.
   */
  readonly blocking: readonly ObjectDensity[];
}

/**
 * −1 Wurzelhöhlen (T1–2, §9.3 "Wurzelgeflecht, Pilzhaine, Grundwasserseen"; Kupfer, Zinn, Salpeter,
 * Leuchtpilze): many medium caverns, narrow winding tunnels, lots of side passages.
 */
const WURZELHOEHLEN: LayerParams = {
  layer: -1,
  biome: 'wurzelhoehlen',
  hostRock: 'fels',
  floor: 'wurzelboden',
  // Bare rock floor where the floor noise is high; clay pockets in the damp root floor where it is
  // low (§9.3 Wurzelhöhlen resource "Lehm"): simplex below −0,62 ≈ 6,5 % of the floor.
  floorPatches: [
    { terrain: 'hoehlenboden', above: 0.35 },
    { terrain: 'lehm', below: -0.62 },
  ],
  lakeRim: 'erde',
  cavernSpacing: 70,
  cavernRadiusMin: 6,
  cavernRadiusMax: 11,
  coreFraction: 0.62,
  cavernJitter: 0.28,
  cavernBand: 5,
  satellitesMax: 2,
  tunnelCoreMin: 1.1,
  tunnelCoreMax: 1.6,
  tunnelSoftExtra: 1.4,
  tunnelJitter: 1.6,
  tunnelBand: 4,
  meander: 0.24,
  segmentTiles: 9,
  loopChance: 0.35,
  loopMaxFactor: 1.6,
  wormChance: 0.7,
  wormStepsMin: 4,
  wormStepsMax: 9,
  wormStepTiles: 5,
  wormTurnChance: 0.45,
  wormChamberChance: 0.5,
  reachTiles: { small: 180, medium: 200, large: 220 },
  lake: { kind: 'wasser', chance: 0.22, cavernScale: 1.7, minCore: 7 },
  special: { kind: 'pilzhain', chance: 0.28, floor: 'wurzelboden', oreBoost: ['salpeter'] },
  shaftsDown: { small: 3, medium: 5, large: 7 },
  slots: { small: 3, medium: 5, large: 7 },
  slotMinCore: 5,
  veins: [
    { ore: 'salpeter', deposit: 0.68 },
    { ore: 'zinn', deposit: 0.58 },
    { ore: 'kupfer', deposit: 0.52 },
  ],
  oreBoostAmount: 0.35,
  scatter: [
    { id: 'pflanze_leuchtpilz', wand: 0.03, frei: 0.006, besonders: 0.16 },
    { id: 'deko_pilze', wand: 0.012, frei: 0.004, besonders: 0.07 },
    { id: 'deko_leuchtmoos', wand: 0.014, frei: 0.004, besonders: 0.06 },
    { id: 'deko_moos', wand: 0.012, frei: 0.006, besonders: 0.04 },
    { id: 'deko_wurzelstraenge', wand: 0.03, frei: 0.004, besonders: 0.01 },
    { id: 'deko_steinchen', wand: 0.01, frei: 0.008, besonders: 0.004 },
  ],
  blocking: [
    { id: 'busch_wurzelgeflecht', wand: 0.03, frei: 0.006, besonders: 0.01 },
    { id: 'fels_klein_wurzelhoehlen', wand: 0.015, frei: 0.006, besonders: 0.004 },
    { id: 'fels_gross_wurzelhoehlen', wand: 0.006, frei: 0.003, besonders: 0 },
    { id: 'erz_kupfer', wand: 0.012, frei: 0.0015, besonders: 0.002 },
    { id: 'erz_zinn', wand: 0.01, frei: 0.0015, besonders: 0.002 },
    { id: 'erz_salpeter', wand: 0.005, frei: 0.0008, besonders: 0.012 },
  ],
};

/**
 * −2 Tiefgrund (T2–4, §9.3 "Kavernen, Kristalladern, Erbauer-Ruinen"; Eisen, Silber, Gold,
 * Klarquarz, Edelsteine): fewer, much larger caverns joined by wide tunnels.
 */
const TIEFGRUND: LayerParams = {
  layer: -2,
  biome: 'tiefgrund',
  hostRock: 'tiefenfels',
  floor: 'hoehlenboden',
  floorPatches: [],
  lakeRim: 'sand',
  cavernSpacing: 90,
  cavernRadiusMin: 9,
  cavernRadiusMax: 17,
  coreFraction: 0.62,
  cavernJitter: 0.26,
  cavernBand: 6,
  satellitesMax: 2,
  tunnelCoreMin: 1.4,
  tunnelCoreMax: 2.2,
  tunnelSoftExtra: 1.8,
  tunnelJitter: 1.8,
  tunnelBand: 4,
  meander: 0.2,
  segmentTiles: 10,
  loopChance: 0.3,
  loopMaxFactor: 1.5,
  wormChance: 0.4,
  wormStepsMin: 3,
  wormStepsMax: 7,
  wormStepTiles: 6,
  wormTurnChance: 0.35,
  wormChamberChance: 0.4,
  reachTiles: { small: 250, medium: 290, large: 330 },
  lake: { kind: 'wasser', chance: 0.25, cavernScale: 1.5, minCore: 8.5 },
  special: { kind: 'kristallgrotte', chance: 0.22, floor: 'hoehlenboden', oreBoost: ['klarquarz', 'edelstein'] },
  shaftsDown: { small: 2, medium: 3, large: 4 },
  slots: { small: 3, medium: 4, large: 6 },
  slotMinCore: 6,
  veins: [
    { ore: 'edelstein', deposit: 0.71 },
    { ore: 'gold', deposit: 0.68 },
    { ore: 'klarquarz', deposit: 0.63 },
    { ore: 'silber', deposit: 0.6 },
    { ore: 'eisen', deposit: 0.52 },
  ],
  oreBoostAmount: 0.4,
  scatter: [
    { id: 'pflanze_kristallmoos', wand: 0.012, frei: 0.004, besonders: 0.08 },
    { id: 'deko_flechten', wand: 0.02, frei: 0.005, besonders: 0.01 },
    { id: 'deko_steinchen', wand: 0.012, frei: 0.008, besonders: 0.006 },
    { id: 'deko_knochen', wand: 0.004, frei: 0.003, besonders: 0 },
    { id: 'deko_tonscherben', wand: 0.004, frei: 0.002, besonders: 0 },
    { id: 'deko_ruinenbrocken', wand: 0.008, frei: 0.003, besonders: 0 },
    { id: 'deko_kristallsplitter', wand: 0.006, frei: 0.002, besonders: 0.06 },
  ],
  blocking: [
    { id: 'kristall_tiefen', wand: 0.008, frei: 0.0015, besonders: 0.05 },
    { id: 'fels_klein_tiefgrund', wand: 0.016, frei: 0.006, besonders: 0.004 },
    { id: 'fels_gross_tiefgrund', wand: 0.008, frei: 0.004, besonders: 0 },
    { id: 'erz_eisen', wand: 0.012, frei: 0.0015, besonders: 0 },
    { id: 'erz_silber', wand: 0.006, frei: 0.0008, besonders: 0 },
    { id: 'erz_gold', wand: 0.0035, frei: 0.0004, besonders: 0 },
    { id: 'erz_klarquarz', wand: 0.004, frei: 0.0006, besonders: 0.015 },
    { id: 'erz_edelstein', wand: 0.002, frei: 0.0003, besonders: 0.01 },
  ],
};

/**
 * −3 Glutadern (T4–6, §9.3 "Lavakammern, Obsidianhallen"; Magmit, Obsidian, Lumenit-Adern):
 * medium chambers, many of them holding a lava lake.
 */
const GLUTADERN: LayerParams = {
  layer: -3,
  biome: 'glutadern',
  hostRock: 'glutfels',
  floor: 'hoehlenboden',
  floorPatches: [{ terrain: 'obsidianboden', above: 0.3 }],
  lakeRim: 'obsidianboden',
  cavernSpacing: 85,
  cavernRadiusMin: 8,
  cavernRadiusMax: 15,
  coreFraction: 0.62,
  cavernJitter: 0.28,
  cavernBand: 5,
  satellitesMax: 2,
  tunnelCoreMin: 1.3,
  tunnelCoreMax: 2,
  tunnelSoftExtra: 1.5,
  tunnelJitter: 1.6,
  tunnelBand: 4,
  meander: 0.22,
  segmentTiles: 9,
  loopChance: 0.3,
  loopMaxFactor: 1.5,
  wormChance: 0.5,
  wormStepsMin: 3,
  wormStepsMax: 8,
  wormStepTiles: 5,
  wormTurnChance: 0.4,
  wormChamberChance: 0.45,
  reachTiles: { small: 300, medium: 340, large: 380 },
  lake: { kind: 'lava', chance: 0.42, cavernScale: 1.5, minCore: 7.5 },
  special: { kind: 'obsidianhalle', chance: 0.25, floor: 'obsidianboden', oreBoost: ['obsidian'] },
  shaftsDown: { small: 0, medium: 0, large: 0 },
  slots: { small: 2, medium: 3, large: 4 },
  slotMinCore: 5,
  veins: [
    { ore: 'lumenit', deposit: 0.69 },
    { ore: 'magmit', deposit: 0.6 },
    { ore: 'obsidian', deposit: 0.52 },
  ],
  oreBoostAmount: 0.45,
  scatter: [
    { id: 'pflanze_glutmoos', wand: 0.014, frei: 0.004, besonders: 0.03 },
    { id: 'deko_steinchen', wand: 0.01, frei: 0.008, besonders: 0.006 },
    { id: 'deko_knochen', wand: 0.004, frei: 0.003, besonders: 0.002 },
    { id: 'deko_aschehaufen', wand: 0.012, frei: 0.006, besonders: 0.004 },
    { id: 'deko_glutsteine', wand: 0.012, frei: 0.005, besonders: 0.01 },
    { id: 'deko_obsidiansplitter', wand: 0.008, frei: 0.003, besonders: 0.07 },
  ],
  blocking: [
    { id: 'kristall_glut', wand: 0.008, frei: 0.0015, besonders: 0.012 },
    { id: 'fels_klein_glutadern', wand: 0.016, frei: 0.006, besonders: 0.006 },
    { id: 'fels_gross_glutadern', wand: 0.008, frei: 0.003, besonders: 0.003 },
    { id: 'erz_obsidian', wand: 0.01, frei: 0.0015, besonders: 0.03 },
    { id: 'erz_magmit', wand: 0.007, frei: 0.001, besonders: 0.004 },
    { id: 'erz_lumenit', wand: 0.0035, frei: 0.0004, besonders: 0.002 },
  ],
};

/** Parameters of every underground layer, top down. */
export const LAYER_PARAMS: Readonly<Record<UndergroundLayer, LayerParams>> = { [-1]: WURZELHOEHLEN, [-2]: TIEFGRUND, [-3]: GLUTADERN };

/** Parameters of one layer. */
export function layerParams(layer: UndergroundLayer): LayerParams {
  return LAYER_PARAMS[layer];
}

/** Whether a layer is an underground layer. */
export function isUndergroundLayer(layer: number): layer is UndergroundLayer {
  return layer === WURZELHOEHLEN_LAYER || layer === TIEFGRUND_LAYER || layer === GLUTADERN_LAYER;
}
