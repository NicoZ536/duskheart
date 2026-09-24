/**
 * Game layer entry point: simulation, commands, systems, the world of a simulation and the headless runner,
 * plus one namespace per game system of M3 (docs/SPIEL.md §1: `src/game/<bereich>/`) – namespaced, because
 * the modules name their own formulas, events and sounds alike (`REACH_PX`, `*_SFX` …).
 */
export * from './canonical';
export * from './commands';
export * from './headless';
export * from './input';
export * from './participant';
export * from './session';
export * from './setup';
export * from './sim';
export * from './systems/motion';
export * from './world';
export * from './worldCache';
export * as actions from './actions/index';
export * as conditions from './conditions/index';
export * as crafting from './crafting/index';
export * as death from './death/index';
export * as cheats from './cheats/index';
export * as drops from './drops/index';
export * as equipment from './equipment/index';
export * as fear from './fear/index';
export * as gathering from './gathering/index';
export * as interaction from './interaction/index';
export * as inventory from './inventory/index';
export * as items from './items/index';
export * as light from './light/index';
export * as player from './player/index';
export * as skills from './skills/index';
export * as sleep from './sleep/index';
export * as survival from './survival/index';
export * as tools from './tools/index';
