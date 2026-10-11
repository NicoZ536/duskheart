/** Water (docs/SPIEL.md §21 "Wasser", M7-30; strand E): rain collectors, the water skin, boiled water. */
export { WATER_SAVE_VERSION, WATER_SYSTEM_ID, WaterSystem, type RainCollector, type WaterSystemDeps, type WaterWorld } from './system';
export { BOILED_WATER, CHARGES_KEY, collectorSips, EMPTY_BUCKET, FEVER_KEY, filledCollector, isVessel, mixedFever, vesselFever, vesselSips, withWater } from './formulas';
export { WATER_COMMAND_SCHEMAS } from './commands';
export { WATER_EVENT_TYPES, WATER_REJECT_REASONS, WATER_SFX, type WaterEventMap, type WaterRejectReason } from './events';
export { waterUses } from './uses';
export type { RainCollectorState, WaterApi } from './types';
