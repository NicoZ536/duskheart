/**
 * Builds the complete game simulation with every system in its fixed order. All entry points
 * (browser game, headless runner, save loading, tests) create simulations through this function
 * so they always run the same system list.
 *
 * Order (docs/ARCHITEKTUR.md "Simulation"):
 * 1. `world-chunks` – the active zone decides which chunks tick in this tick (it follows the player);
 * 2. `motion` – debug movers, owner of the shared `position` component;
 * 3. `world-collision` – the memoised collision grid of the world (no tick hooks);
 * 4. `player` – spawn and steering of the player, collision, roll, swimming, cliffs (M3-08, M3-09);
 * 5. `vitals` – survival stats and temperature model after the body moved (M3-17, M3-18);
 * 6. `calendar`, 7. `weather-regions`, 8. `temperature` (the field samples the weather of the same
 *    world tick);
 * 9. `inventory` – the player's bags and their commands (M3-02); 10. `equipment` – worn pieces,
 *    durability, stats; a modifier source of the player (M3-03). Both share one `PlayerBags` and have
 *    no tick hooks.
 * 11. `drops` – dropped items: flight, magnet, pick-up, lifetime (M3-10); 12. `gathering` – harvesting,
 *    tree falls, regrowth in active chunks and catch-up of frozen ones (M3-11 … M3-14); 13. `interaction`
 *    – the player's focus and E action after the body moved, using drops and gathering (M3-10), and the
 *    use targets of light, death, sleep and actions (feed and light a fire, take a torch, recover the
 *    grave, lie down, sit on a stump, drink) through their commands in the same tick.
 * 14. `crafting` – recipe visibility and the crafting queue (M3-16); 15. `tools` – using items from the bags
 *    (`player.useItem`: eat, bandage, pour a bucket; M3-15, M3-16; no tick hooks). Both are bound to the
 *    skills, conditions and actions of the life systems once those exist.
 * 16. `light` – light sources and the gameplay light map (M3-21, M3-22): the carried torch after the body
 *    moved and the bags changed, placed torches and fires of the active zone (frozen ones catch up); fires
 *    are heat sources of the influences, the light map feeds fear.
 * 17.–22. The player's life (`addPlayerLifeSystems`, src/game/death/life.ts): `conditions`, `fear`, `sleep`,
 *    `actions`, `skills`, `death` (M3-19, M3-23 … M3-26, M3-32) – after everything that can hurt the player,
 *    so eating and sleep notice the hits of the same tick and death sees all damage.
 * 23. `cheats` – the console's cheats `god`, `noclip`, `unlock` (M3-35; no tick hooks): its switches are
 *    created first and read by the player's movement, the vitals and the harm of conditions and fear.
 * After the list is complete the catch-up registry is sealed against it: a time-dependent system that
 * neither catches chunks up nor declares itself global makes `createSimulation` throw
 * (`CatchUpCoverageError`, docs/WORLD.md §5).
 */
import { CatchUpRegistry } from '../world/stream/catchUp';
import { pxToTile } from '../world/model/coords';
import { worldDimensions } from '../world/model/worldSize';
import { Simulation, type SimConfigInput } from './sim';
import { MotionSystem } from './systems/motion';
import { WorldCollision } from './player/collision';
import { registerPlayerComponents } from './player/components';
import { PlayerSystem } from './player/system';
import { PlayerInfluences, ownClothingModifierSource } from './survival/modifiers';
import { VitalsSystem } from './survival/system';
import { contentItemCatalog } from './items/catalog';
import { PlayerBags } from './inventory/bags';
import { InventorySystem } from './inventory/system';
import { EquipmentSystem } from './equipment/system';
import { equipmentModifierSource } from './equipment/modifiers';
import { DropSystem } from './drops/system';
import { GatheringSystem } from './gathering/system';
import { InteractionSystem } from './interaction/system';
import { createUseProviders } from './interaction/uses';
import { addPlayerLifeSystems } from './death/life';
import { CraftingSystem } from './crafting/system';
import { ToolsSystem } from './tools/system';
import { LightSystem } from './light/system';
import { CheatsSystem, createDebugCheats } from './cheats';
import { SimWorld, TemperatureSystem, WeatherRegionsSystem, WorldChunksSystem, type SimWorldOptions, type WorldFocus } from './world';

/** Options of `createSimulation`: how the simulation gets its world. */
export type SimulationOptions = SimWorldOptions;

/** Clamps a tile coordinate into the world edge [0, tiles − 1]. */
function clampTile(t: number, tiles: number): number {
  return t < 0 ? 0 : t >= tiles ? tiles - 1 : t;
}

/** A simulation with all game systems registered and its world attached (materialised on demand). */
export function createSimulation(config: SimConfigInput, options: SimulationOptions = {}): Simulation {
  const sim = new Simulation(config);
  const world = new SimWorld(sim, options);
  sim.addSystem(new WorldChunksSystem(world));
  const motion = sim.addSystem(new MotionSystem(sim));
  const collision = sim.addSystem(new WorldCollision(sim));
  const components = registerPlayerComponents(sim.ecs);
  const influences = new PlayerInfluences();
  // The debug cheats' switches (the `cheats` system, registered last, flips them; M3-35).
  const cheats = createDebugCheats();
  const vitals = new VitalsSystem({ components, influences, motion, cheats });
  const player = sim.addSystem(new PlayerSystem(sim, { motion, collision, components, influences, vitals, cheats }));
  sim.addSystem(vitals);
  sim.addSystem(world.calendar);
  sim.addSystem(new WeatherRegionsSystem(world));
  sim.addSystem(new TemperatureSystem(world));
  const bags = new PlayerBags(contentItemCatalog());
  const inventory = sim.addSystem(new InventorySystem(bags));
  const equipment = sim.addSystem(new EquipmentSystem(bags));
  influences.addModifierSource(ownClothingModifierSource());
  influences.addModifierSource(equipmentModifierSource(equipment));
  const drops = sim.addSystem(new DropSystem(sim, { player, inventory, equipment, collision }));
  const gathering = sim.addSystem(
    new GatheringSystem(sim, {
      collision,
      calendar: world.calendar,
      drops,
      catalog: bags.catalog,
      activeChunks: () => (world.materialized ? world.zone.chunks : []),
      playerAt: (out) => {
        const body = player.body(sim);
        if (body === undefined || !player.position(sim, out)) return false;
        out.layer = body.layer;
        return true;
      },
    }),
  );
  const interaction = sim.addSystem(new InteractionSystem(sim, { player, inventory, equipment, drops, gathering }));
  influences.addModifierSource(interaction.exertionSource);
  // 14. Crafting (M3-16): what does not fit into the bags lands at the player's feet; 15. using items (M3-15, M3-16).
  const crafting = sim.addSystem(new CraftingSystem({ player, inventory, collision, spill: (s, stack, layer, x, y) => drops.spawn(s, stack, layer, x, y) }));
  const tools = sim.addSystem(new ToolsSystem({ player, inventory, interaction }));
  // 16. Light sources and the light map (M3-21, M3-22): before the life systems, so fear reads this tick's light.
  const light = sim.addSystem(new LightSystem(sim, { player, inventory, collision }));
  influences.addHeatSources(light.heatSources());
  collision.addChangeListener(light);
  tools.useLight(light);
  // 17.–22. The player's life, last: conditions, fear, sleep, actions, skills, death (src/game/death/life.ts; they react to every hit of the tick).
  const life = addPlayerLifeSystems(sim, { components, influences, motion, collision, player, inventory, equipment, cheats, landing: (s, stack, layer, x, y) => drops.spawn(s, stack, layer, x, y) });
  crafting.useSkills(life.skills);
  tools.useLife(life);
  life.fear.useLight(light.sampler());
  // Skills (M3-32): the hit formula's skill bonus and the experience of every harvest.
  gathering.setSkillBonus((_s, skill) => life.skills.bonus(skill));
  gathering.setExperience((s, source) => {
    life.skills.award(s, source);
  });
  // Tree stumps are seats (§11.4 "Sitzen (Stühle, Baumstümpfe)").
  const seat = { x: 0, y: 0 };
  life.actions.addSeats((_s, layer, tx, ty) => (gathering.stumpAt(layer, tx, ty, seat) ? { x: seat.x, y: seat.y, layer } : null));
  // Dying returns the crafting queue's reserved ingredients to the bags first, so they go into the grave.
  life.death.onDying((s) => crafting.cancelAll(s, 'tod'));
  // E uses things (src/game/interaction/uses.ts): camp fires and torches, graves, beds, stumps, water.
  for (const provider of createUseProviders({ player, inventory, gathering, light, actions: life.actions, death: life.death, sleep: life.sleep })) interaction.addUses(provider);
  // 23. The console's cheats (M3-35).
  sim.addSystem(new CheatsSystem({ cheats, skills: life.skills }));
  const missing = sim.unhandledCommandTypes();
  if (missing.length > 0) throw new Error(`createSimulation: commands without handler: ${missing.join(', ')}`);
  world.seal(CatchUpRegistry.fromSystems(sim.systems));
  // Focus of the active zone: the player on its layer; without a player the controlled debug mover.
  const tiles = worldDimensions(sim.config.worldSize).tiles;
  const px = { x: 0, y: 0 };
  world.setFocus((out: WorldFocus) => {
    const body = player.body(sim);
    if (body !== undefined && player.position(sim, px)) out.layer = body.layer;
    else if (motion.controlledPosition(sim, px)) out.layer = motion.controlledLayer;
    else return false;
    out.tx = clampTile(pxToTile(px.x), tiles);
    out.ty = clampTile(pxToTile(px.y), tiles);
    return true;
  });
  sim.attachWorld(world);
  return sim;
}
