/**
 * Balance values of farming (MASTERPROMPT §17 "Landwirtschaft", §14 "Bäume … aus Setzlingen", docs/SPIEL.md §20; M7-19 …
 * M7-23) – group `BALANCE.farming` (src/content/balance.ts re-exports it). Plots, growth at 06:00, the climate log,
 * quality, fertiliser, pests, the watering can and the trees grown from saplings. The crops themselves are content
 * (src/content/farming/). Every value states its unit and the reason for it.
 */
import type { WaterNeed } from '../farming/schema';

export const FARMING_BALANCE = {
  /**
   * Fertility of a freshly hoed plot or a new garden bed [points 0–100]. §17 gives the scale 0–100 but no start: a field
   * of plain meadow soil is half-rich, so quality starts at Normal and compost (+30) or bone meal (+20) lift it to Silver.
   */
  startFertility: 50,
  /**
   * Fertility a harvest takes from its plot [points]. §17 "Ernte −10 Fruchtbarkeit": five harvests wear a fresh field down
   * to nothing unless it is fertilised.
   */
  harvestFertilityLoss: 10,
  /**
   * Moisture of a freshly hoed plot or a new garden bed [points 0–100]: turned soil holds half its water – above the growth
   * threshold (20) for a day or two, so a seed sown at once sprouts before the first watering.
   */
  startMoisture: 50,
  /** Moisture of a plot after rain, watering or sowing into wet soil [points 0–100]. §17 "Regen = 100 Feuchte". */
  wetMoisture: 100,
  /**
   * Moisture a plot loses per day at the reference temperature [points/day]. §17 names drying but no rate: a watered plot
   * (100) stays above the growth threshold (20) for three dry days and dries out on the fourth – water every other day.
   */
  dailyDrying: 25,
  /**
   * Day temperature at which the plot dries by exactly `dailyDrying` [°C]. A mild spring day of the Grünhain (15 °C): hot
   * days dry faster, cool ones slower (§20 "−dailyDrying (Temperaturfaktor)").
   */
  dryingReferenceC: 15,
  /** Least drying of a day relative to `dailyDrying` [×]. A frosty day still dries a plot a little. */
  dryingFactorMin: 0.5,
  /** Most drying of a day relative to `dailyDrying` [×]. A heat wave dries at most twice as fast as a mild day. */
  dryingFactorMax: 2,
  /**
   * Drying by the crop's water need [× dailyDrying]. §17 "Wasserbedarf": a thirsty crop (tomato, maize, cabbage) drinks its
   * plot dry a quarter faster, a frugal one (onion, grain) a quarter slower; an empty plot dries as `mittel`.
   */
  dryingByNeed: { gering: 0.75, mittel: 1, hoch: 1.25 } satisfies Record<WaterNeed, number>,
  /**
   * Moisture above which a crop grows at a dawn [points]. §17 "Stufe steigt bei Feuchte > 20".
   */
  growthMoistureAbove: 20,
  /** Lowest air temperature of the night above which a crop grows [°C]. §17 "Temperatur > 2 °C". */
  growthTemperatureAboveC: 2,
  /** Lowest air temperature of the night below which frost kills tender crops outdoors [°C]. §20 "Frost (T_min < 0 °C)". */
  frostBelowC: 0,
  /**
   * Distance within which open fresh water keeps a plot moist [tiles]. §17 "Wassernähe erhöht Feuchte": a field along a
   * river or a water ditch (two tiles beside it) needs no can.
   */
  waterNearTiles: 2,
  /** Moisture a plot near water never drops below [points]. Above the growth threshold (20) with room: a river field grows without watering. */
  waterNearMoisture: 60,
  /**
   * Precipitation from which a weather period counts as rain for the fields [0–1, the weather state's intensity]. §20
   * "Niederschlagsart regen ≥ rainThreshold": rain (0,65) and thunderstorms count, drizzle (0,25) does not water a field.
   */
  rainThreshold: 0.3,
  /**
   * Hour of the night the climate log takes as the coldest [h]. The day curve of src/world/climate/temperature.ts is
   * lowest at sunrise; 5 o'clock lies before the earliest sunrise of the year, the frost hour of the fields.
   */
  coldestHour: 5,
  /** Hour of the day the climate log takes as the warmest [h]: the peak of the day curve (`CLIMATE_BALANCE.dayCurvePeakHour`). */
  warmestHour: 15,
  /**
   * Days of the climate log kept before the oldest frozen field still needs them [days]. One spare day: the dawn of a
   * day reads the day before it (§20 "Regen des Vortags").
   */
  climateSpareDays: 1,
  /**
   * Quality of a harvest (§17 "Qualität (Normal/Silber/Gold) aus Fruchtbarkeit und Skill"): score = fertility share × mean
   * fertility while it grew + skill share × Landwirtschaft level (1–100) + a hash spread of ±`qualitySpread` [points];
   * Silver from `silverFrom`, Gold from `goldFrom`. A fresh field (50) of a beginner (level 1) gives Normal, a composted
   * field (80) Silver, a well-kept field of an experienced farmer Gold.
   */
  quality: { fertilityShare: 0.7, skillShare: 0.3, spread: 8, silverFrom: 52, goldFrom: 78 },
  /**
   * Pests per plot and day (§17 "Schädlinge: Krähen (Vogelscheuche), Hasen (Zaun), Mehltau bei Dauerregen (Kräuterbrühe)")
   * [chance per day, tiles, days]: crows peck at seeds and ripe fruit of plots without a scarecrow within `scarecrowTiles`
   * – a seed is gone, a ripe crop loses half its yield; hares nibble the leaves of plots outside a fenced enclosure – the
   * plant falls back a stage; mildew strikes after `mildewRainDays` rainy days in a row, stops growth and kills the plant
   * after `mildewKillDays` days unless herb brew cures it. Rare enough that an unprotected field still pays.
   */
  pests: { crowChance: 0.06, hareChance: 0.05, mildewChance: 0.3, scarecrowTiles: 6, mildewRainDays: 3, mildewKillDays: 3 },
  /**
   * Largest enclosure a fence ring can hold for the hares [tiles]. A fill over the fences, walls and gates that grows past
   * this is open land: a garden of 20 × 20 tiles is closed, a meadow beyond it is not (the size limit of rooms, §16.4 "≤ 400 Tiles").
   */
  enclosureMaxTiles: 400,
  /** Experience of the Landwirtschaft skill per action [source ids of src/content/skills.ts]. §23.2 "Learning by Doing". */
  experience: { planted: 'saat_gepflanzt', harvested: 'feld_geerntet' },
  /**
   * Days a planted sapling needs to become a tree [days]. §14 "Außerhalb von Basen wächst Wald langsam nach" and §17
   * "Bäume aus Setzlingen": a planted sapling is quicker than the forest (a stump's regrowth takes about a season) – a week
   * of care, half of it as a young tree (`youngFrom`).
   */
  treeGrowDays: 8,
  /** Growth from which a sapling is drawn as a young tree [0–1]. Halfway: it shoots up after four days. */
  youngTreeFrom: 0.5,
  /**
   * The watering can (§14 "Gießkanne", §20 "Gießen mit giesskanne (Ladungen, am Wasser füllen)") [charges]: one charge
   * waters one plot to `wetMoisture`. Ten plots per filling – a row of a field.
   */
  canCharges: 10,
  /** Chance that hoeing a tile turns up an earthworm (§20 "regenwurm aus graben:erde") [chance per tilled tile]. A worm for every few plots: bait enough for an evening's fishing. */
  wormChance: 0.25,
  /**
   * Days a dead plant stays on its plot as a wilted heap before the plot is empty again [days]. Long enough to notice the
   * frost or the mildew; E clears it at once.
   */
  wiltedDays: 3,
  /** Reach of planting, watering, fertilising and harvesting [tiles]: the interaction reach of §11.4 (1,5 tiles). */
  reachTiles: 1.5,
  /**
   * Shelf life of the harvest by kind [game days] (§18 "Frische 100 → 0 über die Haltbarkeit", "Beeren 3"): leaf and berry
   * crops (salad, strawberries) like berries, pods and soft fruit (peas, beans, tomatoes) within a week, roots and cabbage
   * in a cool corner for weeks, onions, garlic and pumpkins through a season. Grain, flax and dried chamomile do not spoil.
   */
  shelfLifeDays: { blatt: 3, beeren: 3, huelse: 5, frucht: 6, kohl: 14, wurzel: 18, zwiebel: 30, kuerbis: 40 },
};
