/**
 * All balance values of DUSKHEARTH (MASTERPROMPT §2.4, §D). Systems read their tuning numbers only
 * from here; every value states its unit and the reason for it. The object is deeply frozen.
 * Groups are added by the milestone that introduces the mechanic.
 */
import type { DayLengthMinutes } from '../engine/time';
import { deepFreeze } from './freeze';

/** World size presets the player can choose (§9.1: Klein · Mittel · Groß). */
export type WorldSizePreset = 'small' | 'medium' | 'large';

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
  },
  motion: {
    /** Walking speed of the controlled entity [tiles/s]. §11.4: "Gehen 4,5 Tiles/s". */
    walkSpeedTilesPerSecond: 4.5,
    /**
     * Upper bound of each velocity axis of a debug mover spawned without explicit velocity
     * [tiles/s]. §11.4 sprint speed (7 tiles/s): wandering test entities stay within the speed
     * range real creatures and the player use, so collision and streaming tests stay realistic.
     */
    debugMoverMaxAxisSpeedTilesPerSecond: 7,
  },
});

/** Type of the balance table. */
export type Balance = typeof BALANCE;
