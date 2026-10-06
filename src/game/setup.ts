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
 *    (`player.useItem`: eat, bandage, pour a bucket, fill dug ground with earth; M3-15, M3-16, M4-40; no tick
 *    hooks). Both are bound to the skills, conditions and actions of the life systems once those exist.
 * 16. `light` – light sources and the gameplay light map (M3-21, M3-22): the carried torch after the body
 *    moved and the bags changed, placed torches and fires of the active zone (frozen ones catch up); fires
 *    are heat sources of the influences, the light map feeds fear; camp fires stand in the way; rain puts
 *    unroofed fires out (M4-28); lamps and the fireplace of the build grid are its furniture lights (M4-19).
 * 17. `stations` – placed stations, their processing batches in active chunks and the catch-up of frozen
 *    ones; the crafting system's stations at hand (with the lit campfires of the light system) and the
 *    upgrade of a station in place (M4-03 … M4-06); placed stations stand in the way, E opens them. 18. `repair` – mending at a workbench, anvil or
 *    grindstone (M4-09; no tick hooks).
 * 19. `building` – the structure layers of the build grid: placing, blueprints, dismantling, upgrading, doors,
 *    statics (M4-11 … M4-14; no tick hooks); a collision overlay, shelter for torches, ladders for the player;
 *    its parts keep stations and lights off their tiles, station parts and furniture lights reach their systems
 *    (src/game/building/listeners.ts), E opens doors and sits on chairs (src/game/building/uses.ts).
 *    20. `rooms` – rooms, their climate, types and comfort around the player (M4-15 … M4-18): the felt temperature's
 *    room value, "Behaglich", the fear decay of cosy rooms, the comfort of placed beds, the workshop's tempo.
 * 21. `storage` – the chests on the build grid and their slots (M4-21; no tick hooks): crafting takes from them,
 *    blueprints, upgrades and repairs take their parts and materials from the bags and the chests near the site
 *    (M4-24). 22. `hearth` – the hearth fires, the cores of the bases (M4-20): fuel burns in active chunks, frozen
 *    ones catch up; a burning hearth protects its base, warms, gives light and is a respawn point; the bases are the
 *    chests' search area and keep felled trees from growing back. 23. `fire` – burning tiles on the world tick
 *    (M4-28): a torch sets flammable things alight, fires damage buildings and trees, spread with the wind, go out
 *    in rain; frozen ones catch up.
 * Then `combat` – the fight (M6-01 … M6-09, docs/SPIEL.md §10): the player's blows, blocks and shots, projectiles, the
 *    combatants of every provider (the player's own, the creatures' later); before the life systems, so they see its
 *    hits in the same tick. It holds the player still in hitstop, turns the facing to the aim while fighting, slows the
 *    walk while swinging and blocking, hangs the light on the belt for two-handers, lights glowing arrows, lets battle
 *    axes fell trees at half power and takes the primary blow of `player.useItem`.
 * Then `creatures`, `traps`, `bestiary` (M6-13 … M6-18, M6-27 … M6-32, docs/SPIEL.md §11): the creatures think, hear
 *    the noises of the tick, move along their paths and strike through the combat system after the player's blows, so a
 *    creature hit in this tick reacts in it; their zone listener writes a freezing chunk's animals into its stock and
 *    brings them back; traps catch, the bestiary watches. Before the life systems: fear summons the Nachtmahr and sees
 *    the creatures' hits of the tick.
 * 24.–29. The player's life (`addPlayerLifeSystems`, src/game/death/life.ts): `conditions`, `fear`, `sleep`,
 *    `actions`, `skills`, `death` (M3-19, M3-23 … M3-26, M3-32) – after everything that can hurt the player,
 *    so eating and sleep notice the hits of the same tick and death sees all damage.
 * 30. `cheats` – the console's cheats `god`, `noclip`, `unlock` (M3-35; no tick hooks): its switches are
 *    created first and read by the player's movement, the vitals and the harm of conditions and fear; the full
 *    `unlock` also shows every recipe (M4-01).
 * The list follows `SYSTEM_ORDER` (src/game/systemOrder.ts, docs/SPIEL.md §16): M7 adds its systems at their places there,
 * each as one block with its wiring; a system out of that order makes `createSimulation` throw.
 * After the list is complete the catch-up registry is sealed against it: a time-dependent system that
 * neither catches chunks up nor declares itself global makes `createSimulation` throw
 * (`CatchUpCoverageError`, docs/WORLD.md §5).
 */
import { CatchUpRegistry } from '../world/stream/catchUp';
import { CHUNK_MASK, CHUNK_SHIFT, pxToTile, type Layer } from '../world/model/coords';
import { worldDimensions } from '../world/model/worldSize';
import { Simulation, type SimConfigInput } from './sim';
import { systemOrderViolation } from './systemOrder';
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
import { InstrumentsSystem } from './instruments/system';
import { refillUses } from './tools/uses';
import { LightSystem } from './light/system';
import { StationSystem } from './stations/system';
import { stationLightProvider } from './stations/light';
import { campfireStations } from './stations/campfire';
import { RepairSystem } from './repair/system';
import { BuildingSystem } from './building/system';
import { RoomsSystem } from './rooms/system';
import { StorageSystem } from './storage/system';
import { HearthSystem } from './hearth/system';
import { FireSystem, worldFireEnvironment } from './fire/system';
import { CombatSystem } from './combat/system';
import { CombatPerks } from './combat/perks';
import { BestiarySystem } from './creatures/bestiary';
import { lightSystemFlames } from './creatures/flames';
import { lightSystemCreatureLight } from './creatures/light';
import { CreatureSystem } from './creatures/system';
import { TrapSystem } from './creatures/traps';
import { carcassUses, trapUses } from './creatures/uses';
import { worldCreatureZone } from './creatures/zone';
import { structureDoorSource } from '../world/path/doors';
import type { PathJobs } from '../world/path/worker';
import { blueprintMaterials } from './blueprints/supply';
import { storageUses } from './storage/uses';
import { hearthUses } from './hearth/uses';
import { bedRespawnListener } from './building/beds';
import { furnitureLightListener, stationGridListener } from './building/listeners';
import { blueprintUses, chairUses, doorUses } from './building/uses';
import { stationUses } from './stations/uses';
import { CheatsSystem, createDebugCheats } from './cheats';
import { PlacesSystem, placeUses, worldPlaceWorld } from './places/index';
import { dryStormEnvironment, simWorldEventsWorld, WorldEventsSystem } from './worldevents/index';
import { FARM_BED_CATEGORY, FarmingSystem, farmItemUse, farmReach, farmSurroundings, farmUses } from './farming/index';
import { FishingSystem, fishingFeet, fishingUses } from './fishing/index';
import { contentWorldIdTables } from '../world/model/runtimeIds';
import { WorldSettingsSystem } from './worldsettings/system';
import { BossesSystem } from './bosses/index';
import { BeaconsSystem, beaconUses } from './beacons/index';
import { UnlocksSystem } from './unlocks/index';
import { ShardsSystem, vitalsHealer } from './shards/index';
import { TravelSystem, waystoneUses } from './travel/index';
import { creatureLumenAura } from './light/lumen';
import { SimWorld, TemperatureSystem, WeatherRegionsSystem, WorldChunksSystem, type SimWorldOptions, type WorldFocus } from './world';

/** Options of `createSimulation`: how the simulation gets its world, and the path worker's job queue. */
export interface SimulationOptions extends SimWorldOptions {
  /**
   * The path worker's job queue (browser: `createPathJobs` with `path.worker.ts`, driven by `PathService.frame()` once per
   * frame). Without it every path is computed in this thread at its ready tick – the same result (ADR-0087).
   */
  readonly pathJobs?: PathJobs | null;
}

/** Clamps a tile coordinate into the world edge [0, tiles − 1]. */
function clampTile(t: number, tiles: number): number {
  return t < 0 ? 0 : t >= tiles ? tiles - 1 : t;
}

/** A simulation with all game systems registered and its world attached (materialised on demand). */
export function createSimulation(config: SimConfigInput, options: SimulationOptions = {}): Simulation {
  const sim = new Simulation(config);
  const world = new SimWorld(sim, options);
  sim.addSystem(new WorldChunksSystem(world));
  // 2. World settings (M7-51, docs/SPIEL.md §25): before every reader of its factors – the vitals' drain (dependency below),
  // the creatures' blows and the peaceful world's spawn veto, the difficulty kept by death (both bound after the life systems).
  const worldSettings = sim.addSystem(new WorldSettingsSystem({ calendar: world.calendar }));
  const motion = sim.addSystem(new MotionSystem(sim));
  const collision = sim.addSystem(new WorldCollision(sim));
  const components = registerPlayerComponents(sim.ecs);
  const influences = new PlayerInfluences();
  // The debug cheats' switches (the `cheats` system, registered last, flips them; M3-35).
  const cheats = createDebugCheats();
  const vitals = new VitalsSystem({ components, influences, motion, cheats, worldSettings });
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
  const tools = sim.addSystem(new ToolsSystem({ player, inventory, interaction, gathering }));
  // 16. Light sources and the light map (M3-21, M3-22): before the life systems, so fear reads this tick's light.
  // Camp fires stand in the way; a dismantled lamp's fuel that does not fit into the bags lands at the lamp.
  const light = sim.addSystem(new LightSystem(sim, { player, inventory, collision, spill: (s, stack, layer, x, y) => drops.spawn(s, stack, layer, x, y) }));
  influences.addHeatSources(light.heatSources());
  collision.addChangeListener(light);
  collision.addOverlay(light.collisionOverlay());
  tools.useLight(light);
  // 17. Stations (M4-03 … M4-06): placed stations and processing; lit campfires are stations too; lights and stations share no tile. 18. Repair (M4-09).
  const stations = sim.addSystem(new StationSystem({ player, inventory, collision, crafting, spill: (s, stack, layer, x, y) => drops.spawn(s, stack, layer, x, y) }));
  crafting.addStations(campfireStations(light, crafting.recipes.stations));
  stations.addOccupancy((_s, layer, tx, ty) => light.lightAt(layer, tx, ty) !== undefined);
  // Fired stations with a burning fuel piece are light sources (M5-35): light map, fear and renderer.
  light.addLightProviders(stationLightProvider(stations));
  // Placed stations stand in the way (§16.1 "Objekte").
  collision.addOverlay(stations.collisionOverlay());
  sim.addSystem(new RepairSystem({ player, inventory, crafting, stations }));
  // 19. Building (M4-11 … M4-14): the structure layers collide (collision overlay), roofs keep torches dry, ladders
  // are climbed; no part is built onto a light or a station. 20. Rooms (M4-15 … M4-18): climate, types and comfort
  // around the player; fires heat rooms, stations and burning lights are furniture.
  const building = sim.addSystem(new BuildingSystem({ player, inventory, collision, drops: (s, stack, layer, x, y) => drops.spawn(s, stack, layer, x, y) }));
  building.addOccupancy((_s, layer, tx, ty) => light.lightAt(layer, tx, ty) !== undefined || stations.stationAt(layer, tx, ty) !== undefined);
  // …and the other way round: no station or light is set up on a part (a carpet, an open door or wall furniture
  // hanging over the tile included: a torch under a wall lamp would leave the lamp without light).
  const partOn = (layer: Layer, tx: number, ty: number): boolean =>
    building.partAt(layer, 'objekt', tx, ty) !== undefined || building.partAt(layer, 'struktur', tx, ty) !== undefined || building.partAt(layer, 'wandobjekt', tx, ty) !== undefined;
  stations.addOccupancy((_s, layer, tx, ty) => partOn(layer, tx, ty));
  light.addOccupancy((_s, layer, tx, ty) => partOn(layer, tx, ty));
  // No shovel or hoe under a floor, wall or piece of furniture (or its blueprint); no water runs under them.
  gathering.addGroundClaims((layer, tx, ty) => building.groundBuilt(layer, tx, ty));
  // Station parts work as stations, a station upgraded in place swaps its part; lamps and the fireplace are lights.
  stationGridListener(building, stations);
  furnitureLightListener(building, light);
  player.addClimbAids({ ladderAt: (layer, tx, ty) => building.ladderAt(layer, tx, ty) });
  light.addShelter((_s, layer, tx, ty) => building.roofed(layer, tx, ty));
  const rooms = sim.addSystem(new RoomsSystem({ building, collision, player }));
  influences.addModifierSource(rooms.modifierSource());
  rooms.addHeatSources(light.heatSources());
  // Stations set up by `station.place` (a station that is a part counts through the grid); burning lights – lamps of the grid
  // included, a cold or empty lamp lights no room (the grid does not count them).
  rooms.addFurniture((_s, layer, visit) => {
    for (const st of stations.placed) if (st.layer === layer && building.partAt(layer, 'objekt', st.tx, st.ty)?.id !== st.station) visit('station', st.tx, st.ty);
  });
  rooms.addFurniture((s, layer, visit) => {
    for (const l of light.sources(s)) if (l.layer === layer && l.mount !== 'hand' && l.mount !== 'guertel') visit('licht', pxToTile(l.x), pxToTile(l.y));
  });
  // 21. Storage (M4-21): crafting takes from the chests in reach; finishing blueprints, upgrading and repairing take from
  // the bags and the chests near the part (M4-24, M4-25).
  const storage = sim.addSystem(new StorageSystem({ player, inventory, building, spill: (s, stack, layer, x, y) => drops.spawn(s, stack, layer, x, y) }));
  crafting.addStores(storage.storeProvider());
  building.useMaterials(blueprintMaterials({ inventory, storage }));
  // 22. Hearth fires (M4-20): the bases are the chests' search area and keep felled trees from growing back; a burning
  // hearth warms the player and rooms and lights the base.
  const hearth = sim.addSystem(new HearthSystem({ player, inventory, building, storage, spill: (s, stack, layer, x, y) => drops.spawn(s, stack, layer, x, y) }));
  storage.useBases((layer, tx, ty) => hearth.zoneAt(sim, layer, tx, ty));
  gathering.addBaseAreas(hearth.baseAreas());
  influences.addHeatSources(hearth.heatSources());
  rooms.addHeatSources(hearth.heatSources());
  light.addLightProviders(hearth.lightProvider());
  // 23. Fire (M4-28): a torch sets flammable things alight; burning tiles light and warm their surroundings. The forest fire's
  // storm is dry (M7-40, block 43 sets `forestFire`): its rain does not put the fires out.
  let forestFire: () => boolean = () => false;
  const fire = sim.addSystem(new FireSystem(sim, { building, gathering, player, environment: dryStormEnvironment(worldFireEnvironment(), () => forestFire()) }));
  light.addFlammables(fire.flammableProvider());
  light.addLightProviders(fire.lightProvider());
  influences.addHeatSources(fire.heatSources());
  rooms.addHeatSources(fire.heatSources());
  // The fight (M6-01 … M6-09): hitstop holds the player, the aim turns the facing while fighting, swinging and blocking slow
  // the walk; two-handers hang the light on the belt, glowing arrows light up, battle axes fell trees at half power, the
  // primary use of a weapon, tool or empty hand is a blow.
  const combat = sim.addSystem(new CombatSystem(sim, { player, motion, inventory, equipment, vitals, collision, interaction, drops, fire, cheats }));
  player.addMotionHold(combat.motionHold);
  player.addFacingSource(combat.facingSource);
  influences.addModifierSource(combat.modifierSource);
  light.addTwoHandedRule(combat.twoHandedRule);
  light.addLightProviders(combat.lightProvider());
  gathering.setObjectPowerFactor(combat.objectPowerFactor);
  tools.useCombat(combat);
  // The creatures (M6-13 … M6-18, M6-27 … M6-32): they live in the active zone's chunks (the zone listener stores and
  // restores them, frozen chunks catch up), fight through the combat system (the provider `kreaturen`), hear the noises of
  // the tick, read the light map (sight, shadow brood), plan paths around closed doors (door breakers through them) and
  // keep shadow brood out of hearth zones. Traps catch small animals; the bestiary watches and counts.
  const creatureLight = lightSystemCreatureLight(sim, light, world.calendar);
  const creatures = sim.addSystem(new CreatureSystem(sim, { player, motion, collision, combat, inventory, equipment, drops, zone: worldCreatureZone(world), light: creatureLight, pathJobs: options.pathJobs ?? null }));
  world.addZoneListener(creatures.zoneListener);
  collision.addChangeListener(creatures.paths);
  creatures.useHearth(hearth);
  // Creatures shy of fire flee from torches, camp fires and burning tiles (the wasps, M6-22).
  creatures.useFlames(lightSystemFlames(light));
  creatures.useBuilding(building, structureDoorSource(building.structures, building.catalog));
  // The light eater puts out torches and lanterns around its blow (§12.4, M6-26); a grab holds the player (the Kriecher).
  creatures.addLightEater((s, layer, x, y, radiusPx) => light.putOutNear(s, layer, x, y, radiusPx, 'lichtfresser'));
  player.addMotionHold(creatures.holdsPlayer);
  const traps = sim.addSystem(new TrapSystem({ player, inventory, collision, creatures }));
  creatures.useTraps(traps);
  // A trap in the hand is set up like a torch: the primary button on the aimed tile, previewed by the interaction's focus (M6-30).
  tools.useTraps(traps);
  interaction.addPlacer(traps);
  sim.addSystem(new BestiarySystem({ creatures, player, light: creatureLight }));
  // 30. Bosses (M7-32 … M7-34, docs/SPIEL.md §22): one per arena, fought through the combat provider `boss`, servants as owned
  // creatures, the arena sealed while awake (collision overlay); burning patches and glowing knots light the arena; no table
  // spawn inside an arena. Life (enemy damage, death, fear, conditions) and the respawn "before the arena" below.
  const bosses = sim.addSystem(new BossesSystem({ player, collision, combat, creatures, drops, inventory, catalog: bags.catalog }));
  light.addLightProviders(bosses.lightProvider());
  creatures.addSpawnBlocker((_s, layer, tx, ty) => bosses.arenaAt(layer, tx, ty) !== null);
  // 31. Places (M7-07 … M7-09, docs/SPIEL.md §18): discovery, chests, guards (owned creatures) and their return, the effects of
  // look-out towers, shrines, notes and dig sites – E at their marks, the shovel brings up a dig site's cache; table spawns
  // keep out of a place (its creatures are its guards). The shrine's blessing is bound after the life systems.
  const places = sim.addSystem(
    new PlacesSystem(sim, {
      player,
      creatures,
      collision,
      catalog: bags.catalog,
      spill: (s, stack, layer, x, y) => drops.spawn(s, stack, layer, x, y),
      world: worldPlaceWorld((id) => contentWorldIdTables().objects.runtimeId(id)),
    }),
  );
  gathering.addDigFinds(places.digFinds());
  interaction.addUses(placeUses(places));
  // 33. Farming (M7-19 … M7-23, docs/SPIEL.md §20): plots from the hoe (`onTilled`) and the garden beds (part listener), growth at
  // 06:00 from the climate log of the weather periods (it listens from the first world tick on), quality, pests, saplings; a
  // floor or wall over a field ends it; greenhouse, fence ring, scarecrow and water are read anew after any change of the
  // buildings or tiles. Item uses (seed, sapling, can, fertiliser) and E targets (sow, water, fill, harvest, clear). Skills below.
  const farming = sim.addSystem(
    new FarmingSystem(sim, {
      world: {
        chunk: (layer, cx, cy) => (world.materialized ? world.chunks.get(layer, cx, cy) : undefined),
        activeChunks: () => (world.materialized ? world.zone.chunks : []),
        regionAt: (tx, ty) => world.regionAt(tx, ty),
        weather: () => world.weather,
      },
      calendar: world.calendar,
      inventory,
      catalog: bags.catalog,
      spill: (s, stack, layer, x, y) => drops.spawn(s, stack, layer, x, y),
      surroundings: farmSurroundings(rooms, building),
    }),
  );
  gathering.onTilled((s, layer, tx, ty, tilled) => farming.tilled(s, layer, tx, ty, tilled));
  building.addPartListener({
    placed: (s, part, layer, tx, ty) => farming.partPlaced(s, part.category === FARM_BED_CATEGORY, layer, tx, ty, part.w, part.h),
    removed: (s, part, layer, tx, ty) => farming.partRemoved(s, part.category === FARM_BED_CATEGORY, layer, tx, ty),
  });
  building.onChange(() => farming.surroundingsChanged());
  collision.addChangeListener({ invalidateTile: () => farming.surroundingsChanged(), invalidateChunk: () => farming.surroundingsChanged() });
  farming.useGround((layer, tx, ty) => building.groundBuilt(layer, tx, ty));
  farming.useReach(farmReach(player));
  tools.addItemUse(farmItemUse({ farming, gathering, inventory, player }));
  interaction.addUses(farmUses({ farming, gathering, inventory, player }));
  // 34. Fishing (M7-24, docs/SPIEL.md §20 "Angeln"): the rod's cast, bite and fight (E on water casts, E held reels – before the
  // water's own use, drinking), ice holes, fish traps catching at 06:00 and caught up in frozen chunks.
  const fishing = sim.addSystem(
    new FishingSystem(sim, {
      world: {
        chunk: (layer, cx, cy) => (world.materialized ? world.chunks.get(layer, cx, cy) : undefined),
        activeChunks: () => (world.materialized ? world.zone.chunks : []),
        regionAt: (tx, ty) => world.regionAt(tx, ty),
        weather: () => (world.materialized ? world.weather : null),
      },
      calendar: world.calendar,
      inventory,
      catalog: bags.catalog,
      player,
      spill: (s, stack, layer, x, y) => drops.spawn(s, stack, layer, x, y),
      holding: () => interaction.holding,
    }),
  );
  interaction.addUses(fishingUses({ fishing, inventory, aimPoint: () => interaction.aimPoint, feet: fishingFeet(player) }));
  player.addFacingSource(fishing.facingSource);
  // 38. Instruments (M7-31, docs/SPIEL.md §24): the flute and the lute play songs from the hand (item use) or `instrument.play`;
  // the player stands still while playing (motion hold), the music calms fear around (wired with the life systems below);
  // the net (item use) catches fireflies from the swarms of the creature system and crickets from the grass.
  const instruments = sim.addSystem(new InstrumentsSystem({ player, inventory, creatures, collision }));
  player.addMotionHold(instruments.holdsPlayer);
  for (const use of instruments.itemUses()) tools.addItemUse(use);
  // 39. Beacons (M7-35): out → ready (the biome's boss defeated) → ignition → lit: unlocks, the ember core, the light wave and
  // healing, the zone "Erleuchtet" (no shadow brood spawns in it), a travel point and a respawn point. 40. Unlocks (M7-36):
  // the registry of §23.1; recipes with `freischaltung` show once granted. 41. Shards: heart and ember shards used for good
  // (item use, modifier source). 42. Fast travel (M7-37): lit beacons, burning hearths and way stones (part listener), Lumen by
  // distance, logistics realism from the world settings; E at a beacon or a way stone.
  const unlocks = new UnlocksSystem();
  const beacons = sim.addSystem(new BeaconsSystem({ player, inventory, collision, drops, unlocks, bosses }));
  sim.addSystem(unlocks);
  light.addLightProviders(beacons.lightProvider());
  creatures.addSpawnBlocker((_s, layer, tx, ty, family) => family === 'schattenbrut' && beacons.inZone(layer, tx, ty));
  crafting.useUnlocks(unlocks);
  unlocks.onGrant((s) => crafting.unlocksChanged(s));
  const shards = sim.addSystem(new ShardsSystem({ inventory, heal: vitalsHealer(components, influences) }));
  tools.addItemUse(shards.itemUse());
  influences.addModifierSource(shards.modifierSource());
  const teleport = player.commands['player.teleport'];
  if (teleport === undefined) throw new Error('createSimulation: the player system handles no player.teleport');
  const travel = sim.addSystem(
    new TravelSystem({ player, inventory, collision, combat, bosses, beacons, hearths: (s) => hearth.travelTargets(s), teleport: (s, x, y, layer) => teleport(s, { type: 'player.teleport', x, y, layer }, s.eventTick) }),
  );
  building.addPartListener(travel.partListener());
  travel.useLogistics(() => worldSettings.logisticsRealism());
  interaction.addUses(beaconUses(beacons, bosses, travel));
  interaction.addUses(waystoneUses(travel, building));
  // The Lumen lantern burns shadow brood around its bearer; the light eater drains its charge (M7-36, §12.2, §12.4).
  light.useLumenAura(creatureLumenAura(combat, creatures.targets));
  creatures.addLightEater((s, layer, x, y, radiusPx, lumen) => light.drainLumenNear(s, layer, x, y, radiusPx, lumen));
  // 43. World events (M7-38 … M7-40, docs/SPIEL.md §18): the register of §10 – the Finstermond, the Lumen rain, the eclipse
  // (a daylight modifier of the calendar), the forest fire – planned from the seed, announced and chronicled; lightning in a
  // thunderstorm seeks tall targets, sets trees and wood alight and hurts the player close by (before the life systems: they
  // see the strike's hit).
  const surfaceObjectAt = (s: Simulation, tx: number, ty: number): string | null => {
    const chunk = s.world.materialized ? s.world.chunks.get(0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT) : undefined;
    const o = chunk === undefined ? 0 : (chunk.object[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number);
    return o === 0 ? null : contentWorldIdTables().objects.stringId(o);
  };
  const worldEvents = sim.addSystem(
    new WorldEventsSystem({
      calendar: world.calendar,
      player,
      catalog: bags.catalog,
      spill: (s, stack, layer, x, y) => drops.spawn(s, stack, layer, x, y),
      gathering,
      building,
      fire,
      vitals,
      objectAt: surfaceObjectAt,
      world: simWorldEventsWorld((s, _layer, tx, ty) => surfaceObjectAt(s, tx, ty) !== null),
    }),
  );
  world.calendar.addDaylightModifier((minute) => worldEvents.daylightFactor(minute));
  forestFire = () => worldEvents.dry();
  // 24.–29. The player's life, last: conditions, fear, sleep, actions, skills, death (src/game/death/life.ts; they react to every hit of the tick).
  const life = addPlayerLifeSystems(sim, { components, influences, motion, collision, player, inventory, equipment, cheats, landing: (s, stack, layer, x, y) => drops.spawn(s, stack, layer, x, y) });
  // Handwerk and the stations' own skills speed crafting; the workshop a station stands in adds its tempo (§16.4 "Werkstatt
  // … +15 % Tempo") – the room of the station, not the player's.
  crafting.useSkills(life.skills);
  crafting.useWorkshops((s, layer, tx, ty) => rooms.craftTempoAt(s, layer, tx, ty));
  // Rooms (M4-16 … M4-18): a cosy room makes the player "Behaglich" and calms fear; placed beds sleep with their room's comfort; placed chairs are seats.
  rooms.useConditions(life.conditions);
  life.fear.addSurroundings(rooms.fearSurroundings());
  life.sleep.addSleepPlaces(rooms.sleepPlaces());
  life.actions.addSeats(building.seats());
  // A bed that set the respawn point takes it along when it leaves the grid (M4-34); burning hearths are respawn
  // points (§16.5, M4-20); a player in the flames catches "Brennen" (M4-28).
  building.addPartListener(bedRespawnListener(life.death));
  life.death.addHearths((s) => hearth.respawnSpots(s));
  fire.useConditions(life.conditions);
  tools.useLife(life);
  // Experience of the fight and conditions of hits on the player (M6).
  combat.useLife(life);
  // Skills and perks in the fight (M6-34): Nahkampf, Fernkampf and Verteidigung raise damage and blocks, the chosen perks act.
  combat.usePerks(new CombatPerks(life.skills));
  // The Nachtmahr comes with fear 100, the difficulty scales wind-ups and damage, carving gives experience (M6-29, §29).
  creatures.useLife(life);
  // The world settings (M7-51): the difficulty stays in death, the creatures read it and the enemy damage there, a peaceful world keeps foes away.
  worldSettings.useDeath(life.death);
  creatures.useWorldSettings(worldSettings);
  creatures.addSpawnBlocker(worldSettings.spawnBlocker);
  // 38. Instruments (M7-31): music calms the fear of everyone around (§12.3 "Musizieren −2/s im Umkreis").
  life.fear.addSurroundings(instruments.fearSurroundings());
  // 31. Places (M7-08): a shrine blesses the player with a condition.
  places.useConditions(life.conditions);
  // 33. Farming (M7-20): quality from the Landwirtschaft level, experience of sowing and harvesting.
  farming.useSkills(life.skills);
  // 34. Fishing (M7-24): experience of a caught fish (`fisch_gefangen`, skill `sammeln`).
  fishing.useSkills(life.skills);
  // 30./39./42. Bosses, beacons, travel (M7-32 … M7-37): the world's enemy damage, the death (reset, no travel), the fear of a boss
  // sighting, "Brennen" in a burning patch and "Erleuchtet" in a beacon's zone; respawn before the arena and at lit beacons.
  bosses.useLife({ enemyDamage: () => worldSettings.factors().enemyDamage, dead: () => life.death.dead, fright: (s, amount) => life.fear.spike(s, amount, 'sichtung'), condition: (s, id) => void life.conditions.apply(s, id) });
  beacons.useLife({ dead: () => life.death.dead, condition: (s, id) => void life.conditions.apply(s, id) });
  travel.useLife({ dead: () => life.death.dead });
  life.death.addArenaSpots((s, x, y, layer) => bosses.arenaSpot(s, x, y, layer));
  life.death.addBeacons((s) => beacons.respawnSpots(s));
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
  // A bed is named by its item ("Schlafen: Holzbett").
  const bedItemAt = (layer: Layer, tx: number, ty: number): string | undefined => building.partAt(layer, 'objekt', tx, ty)?.id;
  // Earth in the hand fills dug ground back in (M4-40) – asked first, so filling a water ditch wins over drinking from it.
  interaction.addUses(refillUses(tools, gathering, inventory));
  for (const provider of createUseProviders({ player, inventory, gathering, light, actions: life.actions, death: life.death, sleep: life.sleep, bedItemAt })) interaction.addUses(provider);
  // E opens a chest (M4-21) and a hearth (M4-20; it is lit on its screen).
  interaction.addUses(storageUses(storage));
  interaction.addUses(hearthUses(hearth));
  // E opens a station's screen (M4-07), opens and closes doors, gates and trapdoors (M4-11), sits on chairs (§11.4),
  // finishes a blueprint with the hammer (M4-24).
  interaction.addUses(stationUses(stations));
  interaction.addUses(doorUses(building));
  interaction.addUses(chairUses(building, life.actions));
  interaction.addUses(blueprintUses(building));
  // E carves a carcass with a knife and takes a set trap back (M6-30).
  interaction.addUses(carcassUses(creatures));
  interaction.addUses(trapUses(traps));
  // 30. The console's cheats (M3-35); the full unlock also shows every recipe (M4-01).
  sim.addSystem(new CheatsSystem({ cheats, skills: life.skills, crafting }));
  const missing = sim.unhandledCommandTypes();
  if (missing.length > 0) throw new Error(`createSimulation: commands without handler: ${missing.join(', ')}`);
  const disorder = systemOrderViolation(sim.systems.map((s) => s.id));
  if (disorder !== null) throw new Error(`createSimulation: ${disorder}`);
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
