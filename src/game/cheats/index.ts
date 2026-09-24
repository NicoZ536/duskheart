/** Cheats of the debug console (M3-35): `debug.god`, `debug.noclip`, `debug.unlock`. */
export { createDebugCheats, type DebugCheats } from './state';
export { DEBUG_COMMAND_SCHEMAS, debugGodCommandSchema, debugNoclipCommandSchema, debugUnlockCommandSchema } from './commands';
export { CHEATS_SAVE_VERSION, CHEATS_SYSTEM_ID, CheatsSystem, type CheatsSystemDeps } from './system';
