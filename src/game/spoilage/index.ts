/** Spoilage (docs/SPIEL.md §21 "Verderb", M7-29; strand E): the hourly pass, freezing and catching up, the station hook. */
export { CONTAINER_FACTORS, SPOILAGE_SAVE_VERSION, SPOILAGE_SYSTEM_ID, SPOILED_ITEM, SpoilageSystem, type SpoilageStations, type SpoilageSystemDeps, type SpoilageWorld } from './system';
export { containerFactor, dayOfHour, hourOfTick, hourStartTick, isHotBiome, lossOver, lossPerHour, nextDayHour, placeFactor, roomFactor, spoiledFreshness, surroundingsFactor, type SeasonSource, type SpoilagePlace } from './formulas';
export { gameSpoilageWorld, simActiveZone, type SpoilageRoom, type SpoilageRooms } from './world';
export { bagSource, chestSource, dropSource, gameSources, graveSource, PERISHABLE_BAG_AREAS, type ActiveCheck } from './sources';
export { SPOILAGE_COMMAND_SCHEMAS, MAX_DEBUG_SPOIL_HOURS } from './commands';
export { SPOILAGE_EVENT_TYPES, SPOILAGE_SFX, type SpoilageEventMap } from './events';
export { PERISHABLE_CONTAINERS, type PerishableContainer, type PerishableContainerSource, type PerishableSlot, type PerishableVisitor, type SpoilageApi, type SpoilageFactors, type StationSlots, type StationSpoilage } from './types';
