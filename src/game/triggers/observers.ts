/**
 * The observers of strand G at the end of the system order (docs/SPIEL.md §16 "52 `stats` · 53 `achievements` · 54 `chronicle` ·
 * 55 `quests` · 56 `guide`", §17; ADR-0207): one trigger world for all of them, read-only views of the systems that hold what the
 * triggers ask for, the quest rewards and the quest markers on the map. `createSimulation` calls `addObservers` once, after the
 * cheats, as its block 52–56.
 */
import { NULL_ENTITY } from '../../engine/ecs';
import { TILE_PX, type Layer } from '../../world/model/coords';
import { AchievementsSystem } from '../achievements/system';
import type { BeaconsSystem } from '../beacons/system';
import type { BossesSystem } from '../bosses/system';
import { ChronicleSystem } from '../chronicle/system';
import type { ConditionsSystem } from '../conditions/system';
import { GuideSystem } from '../guide/system';
import type { InventorySystem } from '../inventory/system';
import type { ItemStack } from '../items/stack';
import type { LightSystem } from '../light/system';
import type { MapSystem } from '../map/system';
import type { PlacesSystem } from '../places/system';
import type { PlaceState } from '../places/types';
import { NOT_YET } from '../places/state';
import type { PlayerSystem } from '../player/system';
import { questMarkerSource, type QuestTarget } from '../quests/markers';
import { QuestsSystem } from '../quests/system';
import type { RoomsSystem } from '../rooms/system';
import type { Simulation } from '../sim';
import type { SleepSystem } from '../sleep/system';
import { StatsSystem } from '../stats/system';
import type { UnlocksSystem } from '../unlocks/system';
import { SimTriggerWorld } from './world';

/** The systems the observers read (all registered before them). */
export interface ObserverDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  readonly conditions: ConditionsSystem;
  readonly sleep: SleepSystem;
  readonly light: LightSystem;
  readonly rooms: RoomsSystem;
  readonly unlocks: UnlocksSystem;
  readonly places: PlacesSystem;
  readonly beacons: BeaconsSystem;
  readonly bosses: BossesSystem;
  readonly map: MapSystem;
  /** Drops a stack at the player's feet (a reward that does not fit). */
  readonly spill: (sim: Simulation, stack: ItemStack, layer: Layer, x: number, y: number) => void;
  /** Makes a fresh stack of `item` (the item catalog). */
  readonly stack: (item: string, count: number) => ItemStack;
}

/** The observers, registered. */
export interface Observers {
  readonly world: SimTriggerWorld;
  readonly stats: StatsSystem;
  readonly achievements: AchievementsSystem;
  readonly chronicle: ChronicleSystem;
  readonly quests: QuestsSystem;
  readonly guide: GuideSystem;
}

/** Pieces of `item` in the bags and the worn equipment (§17 "besitz: Anzahl in Taschen + Ausrüstung"; no allocation). */
function carriedOf(inventory: InventorySystem, item: string): number {
  let n = inventory.count(item);
  const worn = inventory.state.ausruestung;
  for (let i = 0; i < worn.length; i++) {
    const s = worn[i];
    if (s !== null && s !== undefined && s.item === item) n += s.count;
  }
  return n;
}

/** Registers `stats`, `achievements`, `chronicle`, `quests` and `guide` (in this order) and wires them. */
export function addObservers(sim: Simulation, deps: ObserverDeps): Observers {
  const { player, inventory, light, rooms, places } = deps;
  const pos = { x: 0, y: 0 };
  const playerLayer = (s: Simulation): number => {
    const body = player.body(s);
    return body !== undefined && player.position(s, pos) ? body.layer : Number.NaN;
  };
  // Places of a type discovered: counted over the known places (once a second at most, through a held visitor).
  let counting = '';
  let counted = 0;
  const countPlace = (slot: number, state: Readonly<PlaceState>): void => {
    if (state.discoveredTick !== NOT_YET && places.defOf(slot)?.id === counting) counted++;
  };
  const world = new SimTriggerWorld().use({
    carried: (_s, item) => carriedOf(inventory, item),
    conditionActive: (id) => deps.conditions.has(id),
    lightLevel: (s) => {
      const layer = playerLayer(s);
      return Number.isNaN(layer) ? 0 : light.levelAt(s, layer as Layer, pos.x, pos.y);
    },
    indoors: (s) => rooms.playerIndoors(s),
    roomType: (s) => rooms.playerRoom(s)?.type?.id ?? null,
    unlocked: (id) => deps.unlocks.has(id),
    placesDiscovered: (type) => {
      counting = type;
      counted = 0;
      places.forEachKnown(countPlace);
      return counted;
    },
  });
  // 52. Statistics and milestones: play time (sleep at its real pace) and the walked distance in `update`, the sources' events.
  const stats = sim.addSystem(
    new StatsSystem({
      world,
      timeScale: () => deps.sleep.timeScale,
      playerAt: (s, out) => {
        const layer = playerLayer(s);
        if (Number.isNaN(layer) || s.player === NULL_ENTITY) return false;
        out.x = pos.x;
        out.y = pos.y;
        out.layer = layer;
        return true;
      },
    }),
  );
  // 53. Achievements; 54. the chronicle's diary and knowledge.
  const achievements = sim.addSystem(new AchievementsSystem({ world }));
  const chronicle = sim.addSystem(new ChronicleSystem({ world }));
  // 55. Quests: rewards into the bags (the rest at the feet) and knowledge; their status for the triggers; their markers on the map.
  const feet = { x: 0, y: 0 };
  const quests = sim.addSystem(
    new QuestsSystem({
      world,
      rewards: {
        give: (s, item, count) => {
          const r = inventory.give(s, item, count);
          if (r.rest <= 0) return;
          const body = player.body(s);
          if (body !== undefined && player.position(s, feet)) deps.spill(s, deps.stack(item, r.rest), body.layer, feet.x, feet.y);
        },
        knowledge: (s, id) => void chronicle.unlockKnowledge(s, id),
      },
    }),
  );
  deps.map.addMarkerSource(
    questMarkerSource(quests, {
      player: (s, out: QuestTarget) => {
        const layer = playerLayer(s);
        if (Number.isNaN(layer)) return false;
        out.layer = layer;
        out.tx = Math.floor(pos.x / TILE_PX);
        out.ty = Math.floor(pos.y / TILE_PX);
        return true;
      },
      place: (_s, type, _variant, layer, tx, ty, out) => {
        const slot = places.nearestHidden(type, layer as Layer, tx, ty);
        const at = slot < 0 ? undefined : places.slotOf(slot);
        if (at === undefined) return false;
        out.layer = 0;
        out.tx = at.x;
        out.ty = at.y;
        return true;
      },
      beacon: (s, nummer, out) => {
        const site = deps.beacons.site(s, nummer);
        if (site === null) return false;
        out.layer = site.layer;
        out.tx = site.tx;
        out.ty = site.ty;
        return true;
      },
      boss: (s, id, out) => {
        const arena = deps.bosses.arena(s, id);
        if (arena === null) return false;
        out.layer = arena.layer;
        out.tx = Math.floor(arena.bossX / TILE_PX);
        out.ty = Math.floor(arena.bossY / TILE_PX);
        return true;
      },
    }),
  );
  // 56. The guide: Funke speaks the dialog of a quest's new step; the onboarding switch for the HUD.
  const guide = sim.addSystem(
    new GuideSystem({
      world,
      stepDialog: (quest) => {
        const run = quests.run(quest);
        return run === undefined ? null : (quests.currentStep(run)?.dialog ?? null);
      },
      onboarding: () => quests.onboarding,
    }),
  );
  return { world, stats, achievements, chronicle, quests, guide };
}
