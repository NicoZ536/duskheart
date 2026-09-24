/**
 * Tuning of the world plan (docs/WORLD.md §2 step 1, MASTERPROMPT §9.2 steps 1–6). Every value
 * states its unit and the reason for it (§2.4). Fractions of the world edge keep the three world
 * sizes self-similar; tile values are absolute because the player walks in tiles.
 */
import type { WorldSizePreset } from '../../../content/balance';

/**
 * Edge length of a plan cell [tiles]. 8 tiles = ¼ chunk: fine enough for 1–4 tile rivers routed on
 * cells and 8-tile cliff terraces, coarse enough that a Groß plan has 256² = 65 536 cells and stays
 * far below the 2 MB plan budget (WORLD.md §2).
 */
export const PLAN_CELL_TILES = 8;

/** Version of the plan format and generator; part of the plan hash so old hashes never match a changed generator. */
export const PLAN_VERSION = 1;

/**
 * Whole-plan attempts. A failed attempt (unsatisfiable biome constraints) regenerates the island
 * from a derived seed. Measured: the first island satisfies every rule for 597 of 597 tested worlds
 * (199 seeds × 3 sizes); the further attempts are a safety net.
 */
export const PLAN_MAX_ATTEMPTS = 4;

// ---------------------------------------------------------------------------------------------
// Step 1: island mask (§9.2.1 "Rauschen + Falloff: Küste mit Buchten, Halbinseln, vorgelagerten Inseln")
// ---------------------------------------------------------------------------------------------

export const ISLAND = {
  /** Smallest island radius [fraction of the world edge]. π·0,34² ≈ 36 % before bays and peninsulas; leaves a wide sea for islets. */
  radiusMin: 0.34,
  /** Largest island radius [fraction of the world edge]. Bigger islands press against the sea margin and turn square. */
  radiusMax: 0.37,
  /** Random shift of the island centre [fraction of the world edge]. Breaks the perfectly centred look between seeds. */
  centerJitter: 0.03,
  /** Smallest axis ratio of the island ellipse [ratio]. Slightly oval islands read less like a stamped disc. */
  aspectMin: 0.86,
  /** Largest axis ratio of the island ellipse [ratio]. */
  aspectMax: 1.16,
  /** Domain-warp strength of the radial falloff [fraction of the world edge]. Pushes the coast in and out: bays and peninsulas. */
  warpAmplitude: 0.2,
  /** Domain-warp frequency [cycles per world edge]. ≈ 2 lobes per side are big enough to become peninsulas. */
  warpFrequency: 1.6,
  /** Octaves of the domain warp [count]. The second and third octave bend the lobes. */
  warpOctaves: 3,
  /** Amplitude of the coast noise added to the falloff [falloff units]. Frays the coast into coves and headlands. */
  noiseAmplitude: 0.42,
  /** Base frequency of the coast noise [cycles per world edge]. */
  noiseFrequency: 4.2,
  /** Octaves of the coast noise [count]. Five octaves reach down to ~2 cells. */
  noiseOctaves: 5,
  /** Bays carved into every island [count range]. §9.2.1 "Buchten": the noise alone sometimes leaves a round coast. */
  baysMin: 2,
  baysMax: 3,
  /** Smallest bay radius [fraction of the world edge]. */
  bayRadiusMin: 0.06,
  /** Largest bay radius [fraction of the world edge]. */
  bayRadiusMax: 0.09,
  /** Falloff carved out at a bay centre [falloff units]. */
  bayStrength: 1.6,
  /** Shift of the bay centre inland from its coast cell [fraction of the bay radius, negative = inland]. The bay bites into the land and opens to the sea. */
  bayPush: -0.35,
  /** Peninsulas pushed out of every island [count range]. §9.2.1 "Halbinseln". */
  peninsulasMin: 1,
  peninsulasMax: 2,
  /** Smallest peninsula radius [fraction of the world edge]. */
  peninsulaRadiusMin: 0.045,
  /** Largest peninsula radius [fraction of the world edge]. */
  peninsulaRadiusMax: 0.07,
  /** Falloff added at a peninsula centre [falloff units]. */
  peninsulaStrength: 1.4,
  /** Shift of the peninsula centre out to sea from its coast cell [fraction of the peninsula radius]. It juts out but stays attached. */
  peninsulaPush: 0.6,
  /** Axis ratio of bays and peninsulas [ratio]. Longer than wide along the outward direction: inlets and headlands. */
  featureElongation: 1.35,
  /** Smallest distance between two bays or peninsulas [fraction of the world edge]. */
  featureSpacing: 0.18,
  /** Coast cells tried per bay or peninsula [attempts]. */
  featureAttempts: 60,
  /** Hard sea margin along the world edge [tiles]. The player never reaches the edge of the world on foot or by raft. */
  edgeMarginTiles: 48,
  /** Width of the soft falloff zone inside the margin [fraction of the world edge]. Land fades out before the hard margin cuts it. */
  edgeSoftFraction: 0.08,
  /** Falloff subtracted at the hard margin [falloff units]. */
  edgeSoftStrength: 1.2,
  /** Smallest kept island [cells]. 10 cells ≈ 640 tiles² (≈ 25 × 25 tiles): room for a beach and a camp; smaller specks are removed. */
  minIsletCells: 10,
  /** Smallest number of offshore islets [islets]. §9.2.1 "vorgelagerte Inseln": reachable by raft (T1). */
  minIslets: { small: 2, medium: 3, large: 4 } satisfies Record<WorldSizePreset, number>,
  /** Smallest radius of an added islet [cells]. */
  isletRadiusMinCells: 2.5,
  /** Largest radius of an added islet [cells]. 5,5 cells ≈ 90 tiles across: an islet, not a second continent. */
  isletRadiusMaxCells: 5.5,
  /** Shortest distance of an added islet from other land [tiles]. A raft trip, not a wade. */
  isletOffshoreMinTiles: 24,
  /** Longest distance of an added islet from the main coast [tiles]. Still visible from the beach (§25 Fernrohr 40 tiles + margin). */
  isletOffshoreMaxTiles: 96,
  /** Water gap kept between an added islet and other land [tiles]. Keeps islets separate landmasses. */
  isletGapTiles: 16,
  /** Candidate positions tried per missing islet [attempts]. */
  isletAttempts: 80,
  /** Relative radius noise of added islets, bays and peninsulas [fraction of the radius]. Irregular outlines. */
  isletRadiusNoise: 0.4,
  /** Frequency of the outline noise [cycles per cell]. */
  isletNoiseFrequency: 0.3,
} as const;

// ---------------------------------------------------------------------------------------------
// Step 2: Poisson regions → Voronoi → region graph (§9.2.2)
// ---------------------------------------------------------------------------------------------

export const REGIONS = {
  /**
   * Width of the coastal band that forms the Salzküste ring [tiles] (§9.3 "Salzküste T0–2 (Ring)":
   * beaches, cliffs, Watt). Wide enough for beach, dune and tidal flat, narrow enough that the
   * interior keeps most of the land.
   */
  bandWidthTiles: { small: 32, medium: 36, large: 40 } satisfies Record<WorldSizePreset, number>,
  /** Variation of the band width [tiles, ±]. The beach widens into dune fields and narrows at cliffs. */
  bandWidthVariationTiles: 10,
  /** Wavelength of the band width variation [tiles per cycle]. One swell per 200 tiles of coast. */
  bandWidthWavelengthTiles: 200,
  /** Share of the regions that lie on the coastal ring [fraction]. Ring segments ≈ ⅔ of an inland region's area. */
  bandShare: 0.28,
  /** Smallest interior piece that keeps its own region [cells]. Smaller interior pieces (narrow peninsulas) join the ring. */
  minInteriorPieceCells: 40,
  /** Smallest islet that gets its own coastal region [cells]; smaller islets join the nearest ring region. */
  minSeededIsletCells: 24,
  /** Starting point density of the inland Poisson disc [points × r² per tile²]. Random close packing ≈ 0,68. */
  poissonDensity: 0.68,
  /** Radius refinements of the inland Poisson disc [iterations]. Each step rescales r by √(count/target). */
  poissonIterations: 6,
  /** Accepted deviation of the inland count before refinement stops [fraction]. */
  poissonTolerance: 0.03,
} as const;

// ---------------------------------------------------------------------------------------------
// Climate proxies used by the biome solver and the height field (§9.2.3 "Klimaplausibilität")
// ---------------------------------------------------------------------------------------------

export const CLIMATE = {
  /** Frequency of the mountain relief [cycles per world edge]. 3–4 ranges across the island. */
  reliefFrequency: 3.6,
  /** Octaves of the ridged mountain relief [count]. */
  reliefOctaves: 4,
  /** Relief weight in the south [factor]. §9.2.3 "Frostkamm im Norden bzw. hoch": mountains rise towards the north. */
  reliefSouthGain: 0.62,
  /** Relief weight in the north [factor]. */
  reliefNorthGain: 1.22,
  /** Relief subtracted everywhere [relief units]. Leaves lowland between the ranges. */
  reliefOffset: 0.12,
  /** Frequency of the moisture noise [cycles per world edge]. */
  moistureFrequency: 2.6,
  /** Octaves of the moisture noise [count]. */
  moistureOctaves: 3,
  /** Amplitude of the moisture noise [moisture units]. */
  moistureNoise: 0.28,
  /** West → east moisture gradient [moisture units per world edge]. §9.2.3 "Glutsand trocken im Süden/Osten": the east is dry. */
  moistureEastGradient: 0.7,
  /** North → south moisture gradient [moisture units per world edge]. The south dries out as well. */
  moistureSouthGradient: 0.3,
} as const;

// ---------------------------------------------------------------------------------------------
// Step 3: biome assignment by constraint solver (§9.2.3)
// ---------------------------------------------------------------------------------------------

/** Roles of the surface biomes in the rules of §9.2.3 (ids from `src/content/biomes.ts`). */
export const BIOME_ROLES = {
  /** "Startregion Grünhain an der Südküste". */
  start: 'gruenhain',
  /** "Salzküste als Ring" (T0–2 along the whole coast). */
  ring: 'salzkueste',
  /** Nebelmoor: wet lowland; Glutsand keeps away from it. */
  wet: 'nebelmoor',
  /** "Frostkamm im Norden bzw. hoch". */
  cold: 'frostkamm',
  /** "Glutsand trocken im Süden/Osten fern vom Nebelmoor". */
  dry: 'glutsand',
  /** "Aschenschlund angrenzend an Frostkamm- oder Glutsand-Gebirge". */
  volcanic: 'aschenschlund',
  /** "Scherbenhain ringförmig um das Nachtherz". */
  coreRing: 'scherbenhain',
  /** "Nachtherz in der entferntesten Region". */
  core: 'nachtherz',
} as const;

export const BIOME_SOLVER = {
  /** Regions every biome needs [regions]. §9.2.3 "Jedes Biom kommt mehrfach vor" (the Nachtherz is the one wound of §8, ADR-0021). */
  minRegionsPerBiome: 2,
  /** Relative distance jitter [fraction, ±]. §9.2.3 "Biomstufe wächst mit der Graphdistanz (mit Jitter)". */
  distanceJitter: 0.14,
  /**
   * Share of the free inland regions per tier 0…5 [fractions, sum 1]. The start tiers are smaller
   * (a compact Grünhain around the start), the later ones equal.
   */
  tierShares: { t0: 0.1, t1: 0.17, t2: 0.19, t3: 0.18, t4: 0.18, t5: 0.18 },
  /** Cost factor of entering a ring region on the progression distance [factor]. The ring is a coast road, not a shortcut to the far biomes. */
  ringDistanceFactor: 2.5,
  /** Cost factor of a sea crossing on the progression distance [factor]. Rafts are slower than walking. */
  crossingDistanceFactor: 2,
  /** Smallest westward pull of the start region [score]. The start leans to the south-west, so the dry south-east (Glutsand, T4) lies far away. */
  startWestPullMin: 0.15,
  /** Largest westward pull of the start region [score]. A pull of 0,5 still prefers the south coast over the west coast. */
  startWestPullMax: 0.5,
  /** Weight of the tier deviation (t − τ)² [cost per tier²]. */
  tierWeight: 1,
  /** Cost of one violated hard rule [cost]. Far above every soft cost, so the solver never trades a rule for a preference. */
  hardCost: 1000,
  /** Mountain relief from which a region counts as high [relief 0–1]. §9.2.3 "Frostkamm … hoch". */
  highRelief: 0.42,
  /** Largest moisture of a Glutsand region [moisture 0–1]. §9.2.3 "Glutsand trocken". */
  dryMoisture: 0.5,
  /** Moisture a Nebelmoor region should reach [moisture 0–1]. Moors lie in the wet west, clearly wetter than any desert. */
  wetMoisture: 0.6,
  /** Soft cost per missing moisture of a Nebelmoor region [cost per moisture unit]. Strong enough to trade a tier step (cost 1) for 0,15 moisture. */
  wetWeight: 7,
  /** Soft cost per relief of a Nebelmoor region [cost per relief unit]. Moors lie low. */
  lowlandWeight: 2,
  /** Soft cost per missing relief of a Frostkamm or Aschenschlund region [cost per relief unit]. */
  mountainWeight: 2,
  /** Soft cost per moisture of a Glutsand region [cost per moisture unit]. */
  dryWeight: 3,
  /** Solver iterations per free region [iterations]. */
  iterationsPerRegion: 30,
  /** Share of swap moves (two regions exchange tiers) [fraction]. Swaps keep the tier counts. */
  swapShare: 0.3,
  /** Initial acceptance threshold of threshold accepting [cost]. Lets the search leave shallow local minima. */
  startThreshold: 8,
  /** Largest number of repair steps after a search that left a rule broken [steps]. Each step applies the first improving change of a same-tier area or of two neighbouring regions. */
  pairRepairRounds: 40,
  /** Solver attempts with fresh jitter before the plan attempt fails [attempts]. */
  attempts: 8,
} as const;

// ---------------------------------------------------------------------------------------------
// Step 4: height field 0–4, cliffs, ramps, stairs (§9.2.4, §9.1)
// ---------------------------------------------------------------------------------------------

/** Base elevation and relief amplitude of a biome [height levels]. */
export interface HeightProfile {
  /** Elevation of the flattest ground of the biome [levels]. */
  readonly base: number;
  /** Elevation added at full mountain relief [levels]. */
  readonly relief: number;
}

export const HEIGHT = {
  /**
   * Height profile per surface biome [levels] (§9.3 features): Salzküste beaches at sea level with
   * dune and cliff steps; Grünhain hills; Nebelmoor flat and low; Frostkamm the high mountains up to
   * level 4; Glutsand mesas and canyons; Aschenschlund volcanic highland; Scherbenhain crystal
   * uplands; Nachtherz a crater plateau.
   */
  profiles: {
    salzkueste: { base: 0.35, relief: 0.9 },
    gruenhain: { base: 1, relief: 1.4 },
    nebelmoor: { base: 0.2, relief: 0.5 },
    frostkamm: { base: 2.6, relief: 2.2 },
    glutsand: { base: 1.2, relief: 1.6 },
    aschenschlund: { base: 2, relief: 2.4 },
    scherbenhain: { base: 1.4, relief: 1.4 },
    nachtherz: { base: 1.2, relief: 0.8 },
  } satisfies Record<string, HeightProfile>,
  /**
   * Base lift of a Glutsand region bordering the Aschenschlund [levels]. §9.2.3 "Aschenschlund
   * angrenzend an Frostkamm- oder Glutsand-Gebirge": the desert rises into a range at the volcano.
   */
  volcanicRangeLift: 0.9,
  /** Blur radius of the biome profiles [cells]. Biomes blend into each other over ≈ 50 tiles instead of stepping at the border. */
  blendRadiusCells: 3,
  /** Distance over which land rises from sea level [tiles]. Beaches and tidal flats stay at level 0. */
  coastRiseTiles: 44,
  /** Amplitude of the local hill noise [levels]. Terraces and knolls inside a biome. */
  detailAmplitude: 0.45,
  /** Wavelength of the local hill noise [tiles per cycle]. One knoll per 60 tiles. */
  detailWavelengthTiles: 60,
  /** Octaves of the local hill noise [count]. */
  detailOctaves: 3,
  /** Elevation the summit reaches at least [levels]. Guarantees level 4 (§9.1 "Höhenstufen 0–4") on every main island. */
  peakElevation: 4.25,
  /** Cells of the guaranteed summit [cells]. Twice the smallest plateau, so the cleanup keeps it. */
  peakCells: 6,
  /** Elevation from which the peak lift fades in [levels]. Only the high mountains are lifted. */
  peakLiftFrom: 2.5,
  /** Smallest plateau kept [cells]. A single-cell step (8 × 8 tiles) reads as noise, not as a terrace. */
  minPlateauCells: 3,
  /** Plateau cleanup passes [passes]. */
  plateauPasses: 2,
  /** Cell edges of shared border per additional ramp [edges]. A long cliff gets a ramp about every 100 tiles (≈ 20 s walk along the wall). */
  rampEveryEdges: 12,
  /** Largest number of ramps between two plateaus [ramps]. */
  maxRampsPerBorder: 16,
  /** Smallest distance between two ramps of the same border [cells]. */
  rampMinGapCells: 8,
  /** Width of a ramp along the cliff [tiles]. Wide enough for the player and a cart (§4.4: 16 px tiles). */
  rampWidthTiles: 4,
  /** Depth of a ramp across the cliff, half on each level [tiles]. Twice the tile detail of the cliff line plus margin, so the ramp always spans the actual cliff. */
  rampDepthTiles: 6,
  /** Biomes whose steps are carved stairs instead of earth ramps (rock and crystal ground). */
  stairBiomes: ['frostkamm', 'glutsand', 'aschenschlund', 'scherbenhain', 'nachtherz'],
} as const;

// ---------------------------------------------------------------------------------------------
// Step 5: rivers, lakes, fords, streams, springs (§9.2.5)
// ---------------------------------------------------------------------------------------------

export const WATER = {
  /** Smallest rise per cell that lets flats and filled basins drain [levels]. Priority-flood ε: even at the largest rise (× 5) 10 000 flat cells climb only one level. */
  floodEpsilon: 2e-5,
  /** Extra ε rise at the noise maximum [factor]. Flats drain along curved noise valleys instead of straight lines. */
  flatWanderStrength: 4,
  /** Wavelength of the flat-drainage noise [tiles per cycle]. One bend per 50 tiles. */
  flatWanderWavelengthTiles: 50,
  /** Lake basins pressed into the terrain per world size [basins]. §9.2.5 "Seen in Senken"; §9.3 Moorseen, Eisseen, Prismenseen, Oasen. */
  lakeBasins: { small: 4, medium: 6, large: 9 } satisfies Record<WorldSizePreset, number>,
  /** Biomes that hold lake basins (§9.3 features). */
  lakeBiomes: ['gruenhain', 'nebelmoor', 'frostkamm', 'glutsand', 'scherbenhain'],
  /** Smallest distance between two lake basins [tiles]. */
  lakeSpacingTiles: 180,
  /** Smallest distance of a lake basin from the coast [tiles]. Lakes are inland water, not lagoons. */
  lakeCoastTiles: 80,
  /** Smallest basin radius [cells]. */
  lakeRadiusMinCells: 2,
  /** Largest basin radius [cells]. 4 cells ≈ 64 tiles across: a lake a raft is worth building for. */
  lakeRadiusMaxCells: 4,
  /** Depth of a basin at its centre [levels]. Deep enough to stay closed on a slope. */
  lakeBasinDepth: 1.3,
  /** Filled depth from which a depression becomes a lake [levels]. Shallower hollows fill up as flat ground (meadows, moor flats). */
  lakeMinDepth: 0.5,
  /** Filled depth from which a cell belongs to a hollow [levels]. The lake is the deepest part of its hollow. */
  lakeShoreDepth: 0.02,
  /** Smallest lake [cells]. */
  lakeMinCells: 3,
  /** Largest lake [cells]. 48 cells ≈ 3 000 tiles² (≈ 55 × 55 tiles): a lake stays a place, not a sea; wider hollows keep their deepest part. */
  lakeMaxCells: 48,
  /** Rivers per world size [rivers]. §9.2.5 "Flüsse vom Gebirge zur Küste". */
  rivers: { small: 4, medium: 6, large: 9 } satisfies Record<WorldSizePreset, number>,
  /** Level a river source needs at least [level]. "vom Gebirge". */
  riverSourceLevel: 3,
  /** Fallback source level when the mountains hold too few sources [level]. */
  riverSourceFallbackLevel: 2,
  /** Biomes without river sources: dry desert, volcano and the wound. */
  riverlessBiomes: ['glutsand', 'aschenschlund', 'nachtherz'],
  /** Smallest distance between two river sources [tiles]. Rivers drain different valleys. */
  riverSourceSpacingTiles: 200,
  /** Spacing factors tried in turn when the mountains or hills hold too few sources [factors]. */
  riverSpacingSteps: { full: 1, closer: 0.7, closest: 0.5 },
  /** Shortest river [cells]. ≈ 160 tiles: a river, not a trickle. */
  riverMinCells: 20,
  /** Width at the source [tiles]. §9.2.5 "1–4 Tiles breit": rivers start at 2, streams are 1. */
  riverMinWidth: 2,
  /** Width of a stream [tiles]. */
  streamWidth: 1,
  /** Widest river [tiles]. */
  riverMaxWidth: 4,
  /** Drainage area per additional tile of width [cells]. A river widens to 3 tiles below ≈ 380 cells (24 000 tiles²) of catchment and to 4 below twice that. */
  widthStepCells: 380,
  /** Streams per world size [streams]. §9.2.5 "Bäche". */
  streams: { small: 8, medium: 12, large: 18 } satisfies Record<WorldSizePreset, number>,
  /** Levels a stream can rise from [levels]. Hill springs, not mountain sources. */
  streamLevels: [1, 2],
  /** Biomes with streams. */
  streamBiomes: ['gruenhain', 'nebelmoor', 'frostkamm', 'scherbenhain', 'salzkueste'],
  /** Smallest distance of a stream source from any other source [tiles]. */
  streamSpacingTiles: 120,
  /** Shortest stream [cells]. */
  streamMinCells: 6,
  /** Chaikin corner-cutting passes of the river polylines [passes]. Three passes turn the cell staircase into curves. */
  smoothingPasses: 3,
  /** Sideways meander amplitude [tiles]. Rivers swing up to about a cell to each side; the tile sampler carves their bed to the river's level. */
  meanderTiles: 7,
  /** Meander wavelength [tiles of river length per cycle]. A swing to each side every 25 tiles. */
  meanderWavelengthTiles: 50,
  /** River length over which the meander fades in at source and mouth [tiles]. Keeps springs and mouths in place. */
  meanderTaperTiles: 24,
  /** Smallest distance between two fords of one river [cells]. ≈ 110 tiles: a crossing within sight along the river. */
  fordSpacingCells: 14,
  /** Cells at both river ends without fords [cells]. */
  fordEndMarginCells: 3,
  /** Radius of a ford along the river [tiles]. A shallow stretch a few tiles long. */
  fordRadiusTiles: 3,
  /** Width of the shallow sea along the coast [tiles]. */
  seaShallowTiles: 4,
  /** Width of the shallow lake shore [tiles]. */
  lakeShallowTiles: 2,
  /** Rivers from this width have a deep channel in the middle [tiles]. */
  deepRiverWidth: 3,
  /** Radius around a spring marked as spring water [tiles]. */
  springRadiusTiles: 1,
} as const;

// ---------------------------------------------------------------------------------------------
// Step 6 and tile realisation: coast, cliffs, water and biome borders at tile resolution (§9.2.6)
// ---------------------------------------------------------------------------------------------

export const TILE_DETAIL = {
  /** Coastline wobble added to the smooth coast [tiles, ±]. Coves and points smaller than a plan cell. */
  coastAmplitude: 2.5,
  /** Wavelength of the coastline wobble [tiles per cycle]. */
  coastWavelengthTiles: 14,
  /** Cliff-line wobble [tiles, ±]. Below half the ramp depth, so a ramp always spans its cliff. */
  cliffAmplitude: 1.5,
  /** Wavelength of the cliff-line wobble [tiles per cycle]. */
  cliffWavelengthTiles: 12,
  /** Lake-shore wobble [tiles, ±]. */
  lakeAmplitude: 1.5,
  /** Wavelength of the lake-shore wobble [tiles per cycle]. */
  lakeWavelengthTiles: 10,
} as const;

export const BORDERS = {
  /** Domain-warp strength of the biome borders [tiles]. §9.2.6 "Biomgrenzen per Domain-Warp verwischt": borders wander up to ≈ half a chunk off the straight Voronoi line. */
  warpTiles: 12,
  /** Domain-warp wavelength [tiles per cycle]. One bend per 140 tiles keeps the warp gentle, so strip widths survive it. */
  warpWavelengthTiles: 140,
  /** Octaves of the domain warp [count]. */
  warpOctaves: 2,
  /** Narrowest transition strip [tiles]. §9.2.6 "Übergangsstreifen": M2-09 accepts 4–12 tiles; the margin absorbs the tile raster. */
  stripMinTiles: 5,
  /** Widest transition strip [tiles]. The margin to 12 absorbs the first-order warp correction. */
  stripMaxTiles: 9,
  /** Wavelength of the strip width variation [tiles per cycle]. Strips breathe along the border. */
  stripWavelengthTiles: 90,
  /** Step of the finite differences of the warp Jacobian [tiles]. */
  jacobianStepTiles: 1,
} as const;
