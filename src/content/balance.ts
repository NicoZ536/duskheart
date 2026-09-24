/**
 * All balance values of DUSKHEARTH (MASTERPROMPT §2.4, §D). Systems read their tuning numbers only
 * from here; every value states its unit and the reason for it. The object is deeply frozen.
 * Groups are added by the milestone that introduces the mechanic.
 */
import type { DayLengthMinutes } from '../engine/time';
import type { WeatherStateId } from './weather';
import { deepFreeze } from './freeze';
import { PLAYER_BALANCE } from './balance/player';
import { SURVIVAL_BALANCE } from './balance/survival';
import { ITEM_BALANCE } from './balance/items';
import { INTERACTION_BALANCE } from './balance/interaction';
import { HARVEST_BALANCE } from './balance/harvest';
import { CONDITION_BALANCE } from './balance/conditions';
import { FEAR_BALANCE } from './balance/fear';
import { SLEEP_BALANCE } from './balance/sleep';
import { ACTION_BALANCE } from './balance/actions';
import { DEATH_BALANCE } from './balance/death';
import { SKILL_BALANCE } from './balance/skills';
import { TOOL_BALANCE } from './balance/tools';
import { CRAFTING_BALANCE } from './balance/crafting';
import { LIGHT_BALANCE } from './balance/light';

/** World size presets the player can choose (§9.1: Klein · Mittel · Groß). */
export type WorldSizePreset = 'small' | 'medium' | 'large';

/** The four seasons in calendar order (§10: the world starts in spring). Ids match the palette rows of the foliage. */
export const SEASON_IDS = ['fruehling', 'sommer', 'herbst', 'winter'] as const;
/** One season id. */
export type SeasonId = (typeof SEASON_IDS)[number];

export const BALANCE = deepFreeze({
  time: {
    /** Simulation rate [ticks/s]. §3.3: fixed 60 Hz step; fast enough for responsive input and collision. */
    tickHz: 60,
    /** World tick rate [ticks/s]. §3.3: temperature fields, fire and spoilage change slowly, 1 Hz is enough. */
    worldTickHz: 1,
    /** Default day length [real minutes per game day]. §10: 1 game hour = 1 real minute. */
    defaultDayLengthMinutes: 24 as DayLengthMinutes,
    /** Maximum catch-up steps per rendered frame [ticks]. §3.3: prevents a spiral of death after a stall. */
    maxCatchUpSteps: 5,
  },
  world: {
    /** Tile edge length [px]. §4.4: 16×16 tiles are the base grid of all art. */
    tilePx: 16,
    /** World edge length per preset [tiles]. §9.1: Klein 1024², Mittel 1536², Groß 2048². */
    sizeTiles: { small: 1024, medium: 1536, large: 2048 } satisfies Record<WorldSizePreset, number>,
    /** Preset used for new worlds [preset]. §9.1: "Mittel" is the standard size. */
    defaultSize: 'medium' as WorldSizePreset,
    /** Target number of Poisson regions per preset [regions]. §9.2 step 2: "≈ 40 / 70 / 110 je Größe". */
    regionCount: { small: 40, medium: 70, large: 110 } satisfies Record<WorldSizePreset, number>,
    /** Highest surface height level [level]. §9.1: "Höhenstufen 0–4"; WORLD.md §3 stores it in a Uint8. */
    maxHeightLevel: 4,
    /** Temperature change per surface height level [°C/level]. §9.1: "Höhe senkt die Temperatur (−3 °C je Stufe)". */
    temperaturePerHeightLevelC: -3,
  },
  stream: {
    /**
     * Surface load radius around the camera chunk [chunks]. docs/ARCHITEKTUR.md "Speicherbedarf je
     * Chunk": radius 4 ⇒ 9 × 9 = 81 resident chunks ≈ 648 KiB tile data (+ baselines), two chunk
     * rings of prefetch beyond the active zone, far more than the 30 × 17 tile view (480 × 270 px, §4.2) needs.
     */
    surfaceLoadRadiusChunks: 4,
    /**
     * Underground load radius [chunks]. Caves are dark (light reaches a few tiles, §12) and their
     * chunks cost more to generate (cellular automaton with border overlap, §9.2), so one prefetch
     * ring beyond the active zone is enough there.
     */
    undergroundLoadRadiusChunks: 3,
    /**
     * Active zone radius around the player chunk [chunks]. §12.4 spawns Schattenbrut 16–40 tiles
     * around the player: 40 tiles from any tile of the player chunk stay within 2 chunks, so spawn
     * ring and perception lie inside.
     */
    activeRadiusChunks: 2,
    /** Hysteresis ring before unloading and before freezing [chunks]. docs/ARCHITEKTUR.md "Deaktiviert wird erst bei Abstand > r + 1": one ring stops flapping at a border. */
    hysteresisChunks: 1,
    /** Layers besides the camera layer that stay resident [layers]. Stepping into a cave and back keeps the surface around the entrance without holding all four layers (§30 heap budget). */
    retainedLayers: 1,
    /**
     * Main-thread time per frame for integrating loaded chunks and in-thread jobs [ms]. §30 caps
     * frame CPU at 8 ms; integrating a worker result only wraps transferred buffers (microseconds),
     * so 1 ms leaves the frame budget to simulation and rendering. The queue still handles at least one chunk per frame.
     */
    jobFrameBudgetMs: 1,
    /** Load jobs a worker holds at once [jobs]. Enough to keep the worker busy between two frames while the queue stays reorderable when the camera turns. */
    maxJobsInFlight: 4,
  },
  calendar: {
    /** Default season length [game days]. §10: "Jahreszeiten je 7 Tage" – one Schattenflut cycle per season. */
    defaultSeasonLengthDays: 7,
    /** Shortest selectable season length [game days]. §10 "wählbar 3–14": fast seasons for short sessions. */
    minSeasonLengthDays: 3,
    /** Longest selectable season length [game days]. §10 "wählbar 3–14": slow seasons for relaxed play. */
    maxSeasonLengthDays: 14,
    /** Full-darkness night per season, centred on midnight [game hours]. §10: Frühling/Herbst 8 h, Sommer 5 h, Winter 11 h. */
    nightHours: { fruehling: 8, sommer: 5, herbst: 8, winter: 11 } satisfies Record<SeasonId, number>,
    /** Length of each twilight blend between day and night [game hours]. §10: "Dämmerungen je 2 h weich überblendet". */
    twilightHours: 2,
    /** Length of the moon cycle [game days]. §10: "Mond: 8-Tage-Zyklus". */
    moonCycleDays: 8,
    /**
     * Moon phase of the first night [phase index, 0 = Finstermond … 4 = Vollmond]. Phase 1 puts the
     * first full moon on night 4 and the first Finstermond on night 8, one night after the first
     * Schattenflut (night 7, §16.8), so a new player never faces both at once in the first week.
     */
    firstNightMoonPhase: 1,
    /** Temperature offset per season [°C]. §9.3: "Frühling 0 · Sommer +8 · Herbst −3 · Winter −14". */
    seasonTemperatureOffsetC: { fruehling: 0, sommer: 8, herbst: -3, winter: -14 } satisfies Record<SeasonId, number>,
    /** Ambient light in full daylight [light level 0–1]. §12.1: "Umgebungslicht: Tag 1,0". */
    dayAmbientLight: 1,
    /** Ambient light of the darkest moonlit night, thin crescent [light level 0–1]. §12.1: "Nacht 0,05–0,12 (Mondphase)". */
    nightAmbientMin: 0.05,
    /** Ambient light of a full-moon night [light level 0–1]. §12.1: "Nacht 0,05–0,12 (Mondphase)"; stays below "Dunkel" (0,15). */
    nightAmbientMax: 0.12,
    /** Ambient light of a Finstermond night [light level 0–1]. §12.1: "Finstermond 0,02". */
    finstermondAmbientLight: 0.02,
    /**
     * Sun elevation at noon per season [degrees]. Mid-latitude values: summer noon shadows are short
     * (≈ 0,5 × height), spring/autumn equal the caster height, winter noon shadows are long (≈ 1,9 ×)
     * so the season reads in every daytime screenshot (§6.1 pass 4 "mittags kurz").
     */
    noonSunElevationDeg: { fruehling: 45, sommer: 62, herbst: 45, winter: 28 } satisfies Record<SeasonId, number>,
    /** Highest moon elevation of a night [degrees]. Moon shadows stay longer than noon sun shadows, which reads as night light. */
    moonMaxElevationDeg: 35,
    /**
     * Longest cast shadow [shadow length per unit caster height]. cot(elevation) grows without bound
     * near the horizon; beyond 3 heights a tree shadow crosses several tiles and hides terrain detail
     * (§2.8 "Lesbarkeit vor Spektakel").
     */
    maxShadowLength: 3,
    /** Elevation at which sun and moon shadows reach full strength [degrees]. Shadows fade in after sunrise instead of popping in at the horizon. */
    shadowFadeElevationDeg: 10,
    /** Strength of moon shadows at full moon relative to the sun [0–1]. §6.1 pass 4 "Sonnen-/Mondschatten": visible but clearly weaker than daylight shadows. */
    moonShadowStrength: 0.35,
  },
  climate: {
    /**
     * Blend time between two weather states [game minutes]. §10 "weiche Übergänge": clouds build up
     * within three quarters of an hour; shorter than the shortest period (1 h), so every blend is
     * complete before the next change and a change never starts from a half-blended sky.
     */
    weatherBlendMinutes: 45,
    /** State of every region when a world is created [state]. The first hours of a new game are calm everywhere. */
    initialWeather: 'klar' as WeatherStateId,
    /** Warmest hour of the day [game hour]. Mid-afternoon, when the ground has stored the most heat. */
    dayCurvePeakHour: 15,
    /**
     * Position of the §9.3 table value ("°C Frühlingstag") in the day curve [fraction of the amplitude
     * above the daily mean]. §9.3 Glutsand: 34 °C by day, 8 °C at night, ±18 °C ⇒ daily mean 26 °C,
     * the table value lies 8/18 = 4/9 of the amplitude above it. A ±6 °C biome thus spans
     * table value −8,7 … +3,3 °C (Grünhain spring: 7,3 °C before sunrise, 19,3 °C at 15:00).
     */
    dayCurveReference: 4 / 9,
    /**
     * Share of the season offset per layer [factor], index = depth (0 surface, 1 Wurzelhöhlen,
     * 2 Tiefgrund, 3 Glutadern). §9.3 "Höhlen bleiben nahe ihrem Basiswert": the root caves right below
     * the surface feel a quarter of the season (winter −3,5 °C), deeper layers less, the Glutadern
     * none (heated from below).
     */
    seasonFactorByDepth: [1, 0.25, 0.1, 0] as readonly number[],
    /**
     * Climate of surface tiles without a biome (open sea) [biome id]. The sea around the island has the
     * mild, balanced climate of the coast ring (§9.3 Salzküste "T0–2 (Ring)").
     */
    seaClimateBiome: 'salzkueste',
    /** Terrain that radiates heat [terrain id]. §9.3 Aschenschlund "an Lava +20". */
    heatSourceTerrain: 'lava',
    /** Heat next to a heat source [°C]. §9.3 Aschenschlund: 38 °C, "an Lava +20". */
    lavaHeatC: 20,
    /**
     * Reach of the lava heat [tiles]. Full heat on and next to lava, fading with the squared distance
     * to 0 at this distance: the heat is felt a few steps away but a lava river does not warm a whole
     * screen.
     */
    lavaHeatRadiusTiles: 4,
  },
  gathering: {
    /** Hits a resource node takes with a tool of matching tier [hits]. §D: "Grünhain-Baum: 5 Treffer mit Steinaxt"; node HP = hits × hardness. */
    hitsWithTierTool: 5,
    /** Regrow time of surface stone and ore nodes outside a base [game days]. §14: "Oberflächenknoten wachsen außerhalb des Basisradius nach 7 Tagen nach". */
    nodeRegrowDays: 7,
    /** Regrow time of a felled tree outside a base [game days]. §14 "Wald wächst langsam nach": two node cycles, so forests recover within two default seasons. */
    treeRegrowDays: 14,
    /** Regrow time of picked berry and fibre bushes [game days]. Renewable early food: a patch can be harvested twice per default season. */
    bushRegrowDays: 3,
    /** Regrow time of wild plants (fibre grass, herbs, mushrooms) [game days]. Fibres are needed in bulk from day 1; faster than bushes. */
    plantRegrowDays: 2,
  },
  motion: {
    /** Walking speed of the controlled entity [tiles/s]. §11.4: "Gehen 4,5 Tiles/s" – the player's walking speed (`player.movement`), one value for both. */
    walkSpeedTilesPerSecond: PLAYER_BALANCE.movement.walkTilesPerSecond,
    /**
     * Upper bound of each velocity axis of a debug mover spawned without explicit velocity
     * [tiles/s]. §11.4 sprint speed (7 tiles/s): wandering test entities stay within the speed
     * range real creatures and the player use, so collision and streaming tests stay realistic.
     */
    debugMoverMaxAxisSpeedTilesPerSecond: 7,
  },
  /** Player body [group: src/content/balance/player.ts]. §11.4 movement, roll, cliffs, water and spawn; every value there has its unit and reason. */
  player: PLAYER_BALANCE,
  /** Survival stats and temperature model [group: src/content/balance/survival.ts]. §11.1/§11.2 values; every value there has its unit and reason. */
  survival: SURVIVAL_BALANCE,
  /** Items, bags and equipment [group: src/content/balance/items.ts]. §13.1 stacks, slots and quality, §D durability, §15.4 burn times, §18 shelf life; every value there has its unit and reason. */
  items: ITEM_BALANCE,
  /** Interacting, reach, magnet and dropped items [group: src/content/balance/interaction.ts]. §11.4, §14; every value there has its unit and reason. */
  interaction: INTERACTION_BALANCE,
  /** Harvesting trees, rocks, plants and ground [group: src/content/balance/harvest.ts]. §11.4, §13.2, §14, §D; every value there has its unit and reason. */
  harvest: HARVEST_BALANCE,
  /** Condition rules [group: src/content/balance/conditions.ts]. §11.3; the conditions themselves are content (src/content/conditions.ts); every value there has its unit and reason. */
  conditions: CONDITION_BALANCE,
  /** Fear [group: src/content/balance/fear.ts]. §12.3 rises, decays, stages and hallucinations; every value there has its unit and reason. */
  fear: FEAR_BALANCE,
  /** Sleep [group: src/content/balance/sleep.ts]. §11.5 hours, recovery, sleeping places, Ausgeruht; every value there has its unit and reason. */
  sleep: SLEEP_BALANCE,
  /** Eating, drinking, sitting, throwing [group: src/content/balance/actions.ts]. §11.4, §18; every value there has its unit and reason. */
  actions: ACTION_BALANCE,
  /** Death and respawn [group: src/content/balance/death.ts]. §11.6, §29 penalties; every value there has its unit and reason. */
  death: DEATH_BALANCE,
  /** Skills [group: src/content/balance/skills.ts]. §23.2 level curve, bonus, perk levels; every value there has its unit and reason. */
  skills: SKILL_BALANCE,
  /** Tools and weapons by tier [group: src/content/balance/tools.ts]. §13.2 mining power, §D weapon damage and class factors; every value there has its unit and reason. */
  tools: TOOL_BALANCE,
  /** Crafting [group: src/content/balance/crafting.ts]. §15.1 queue, quantity, chests, stations, times; every value there has its unit and reason. */
  crafting: CRAFTING_BALANCE,
  /** Light: the gameplay light map, torches, camp fires, the Nebenhand rule [group: src/content/balance/light.ts]. §12.1, §12.2, §10, §15.4; every value there has its unit and reason. */
  light: LIGHT_BALANCE,
});

/** Type of the balance table. */
export type Balance = typeof BALANCE;
