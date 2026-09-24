/**
 * The player's life systems in their fixed order (called once by `createSimulation`, src/game/setup.ts;
 * tests build them on hand-drawn worlds the same way):
 *
 * 1. `conditions` – conditions of §11.3 (they deal damage over time);
 * 2. `fear` – fear of §12.3 (harmful hallucinations deal hits);
 * 3. `sleep` – §11.5 (a hit of this tick wakes);
 * 4. `actions` – eating, drinking, sitting, throwing of §11.4 (a hit of this tick interrupts);
 * 5. `skills` – §23.2 (survival XP of this tick);
 * 6. `death` – §11.6, last: it sees every damage of the tick.
 * Systems that deal hits to the player (combat, later) must be registered before these six, so the hits
 * of a tick reach sleep and eating in the same tick (`PlayerHarm`, src/game/conditions/harm.ts).
 *
 * Wiring: the modifier sources of conditions, sleep, actions and death; broken bones of the player system
 * → "Knochenbruch"; beds → the respawn point; the Nachtmahr's pursuit forbids sleep; a sleeper cannot act
 * (`PlayerSystem.addIncapacity`); the equipment's fear
 * resistance; the drop system receives landed throws; the respawn uses the player system's teleport.
 */
import type { Simulation } from '../sim';
import type { EquipmentSystem } from '../equipment/system';
import type { InventorySystem } from '../inventory/system';
import type { WorldCollision } from '../player/collision';
import type { PlayerComponents } from '../player/components';
import type { PlayerSystem } from '../player/system';
import type { PlayerInfluences } from '../survival/modifiers';
import type { MotionSystem } from '../systems/motion';
import { ActionsSystem, type ThrowLanding } from '../actions/system';
import { PlayerHarm } from '../conditions/harm';
import type { DebugCheats } from '../cheats/state';
import { conditionModifierSource } from '../conditions/modifiers';
import { ConditionsSystem } from '../conditions/system';
import { FearSystem, type LightSampler } from '../fear/system';
import { SkillsSystem } from '../skills/system';
import { SleepSystem } from '../sleep/system';
import { DeathSystem } from './system';

/** What the life systems read from the world. */
export interface LifeEnvironment {
  /** Light level at a point [0–1] (fear, hallucinations). */
  readonly lightAt: LightSampler;
  /** Whether it is night (fear rises in the dark only at night on the surface). */
  night(sim: Simulation): boolean;
  /** Tile of the start beach (respawn without a bed). */
  beach(sim: Simulation): { readonly tx: number; readonly ty: number };
}

/**
 * The environment of the simulation's own world: ambient light of the calendar on the surface (§12.1
 * "Tag 1,0 … Nacht 0,05–0,12 … Höhle 0"; the gameplay light map of M3-21 adds the light sources with
 * `FearSystem.useLight`), night = every phase but full day, the start beach of the generated world.
 */
export function worldLifeEnvironment(): LifeEnvironment {
  return {
    lightAt: (sim, layer) => (layer === 0 ? sim.world.calendar.ambientLight : 0),
    night: (sim) => sim.world.calendar.dayPhase !== 'tag',
    beach: (sim) => {
      const spawn = sim.world.generated.spawn;
      return { tx: spawn.x, ty: spawn.y };
    },
  };
}

/** Dependencies of the life systems (the systems registered before them). */
export interface PlayerLifeDeps {
  readonly components: PlayerComponents;
  readonly influences: PlayerInfluences;
  readonly motion: MotionSystem;
  readonly collision: WorldCollision;
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  /** Fear resistance of the worn equipment (absent in tests without equipment). */
  readonly equipment?: EquipmentSystem;
  /** Where landed throws go (the drop system). */
  readonly landing: ThrowLanding;
  /** Default: `worldLifeEnvironment()`. */
  readonly environment?: LifeEnvironment;
  /** Debug cheats (`god` spares the player the damage of conditions and hallucinations); absent = every cheat off. */
  readonly cheats?: Readonly<DebugCheats>;
}

/** The life systems of the player. */
export interface PlayerLife {
  readonly harm: PlayerHarm;
  readonly conditions: ConditionsSystem;
  readonly fear: FearSystem;
  readonly sleep: SleepSystem;
  readonly actions: ActionsSystem;
  readonly skills: SkillsSystem;
  readonly death: DeathSystem;
}

/** Registers the six life systems in their order and wires their hooks. */
export function addPlayerLifeSystems(sim: Simulation, deps: PlayerLifeDeps): PlayerLife {
  const env = deps.environment ?? worldLifeEnvironment();
  const { components, influences, motion, collision, inventory } = deps;
  const harm = new PlayerHarm(deps.cheats);
  const conditions = sim.addSystem(new ConditionsSystem({ components, influences, harm }));
  const equipment = deps.equipment;
  const fear = sim.addSystem(
    new FearSystem({ components, influences, motion, conditions, harm, environment: env, ...(equipment === undefined ? {} : { resistance: () => equipment.stats().werte.furchtresistenz }) }),
  );
  const sleep = sim.addSystem(new SleepSystem({ components, motion, conditions, harm, inventory }));
  const actions = sim.addSystem(new ActionsSystem({ components, motion, collision, inventory, conditions, fear, sleep, harm, landing: deps.landing }));
  const skills = sim.addSystem(new SkillsSystem({ components, conditions }));
  const teleport = deps.player.commands['player.teleport'];
  if (teleport === undefined) throw new Error('addPlayerLifeSystems: the player system handles no player.teleport');
  const death = sim.addSystem(
    new DeathSystem({
      components,
      motion,
      collision,
      influences,
      inventory,
      conditions,
      fear,
      skills,
      harm,
      teleport: (s, x, y, layer) => teleport(s, { type: 'player.teleport', x, y, layer }, s.eventTick),
      beach: env.beach,
    }),
  );
  influences.addModifierSource(conditionModifierSource(conditions));
  influences.addModifierSource(sleep.modifierSource());
  influences.addModifierSource(actions.modifierSource());
  influences.addModifierSource(death.modifierSource());
  deps.player.onFracture((s) => {
    conditions.apply(s, 'knochenbruch');
  });
  sleep.onRespawnPoint((s, place) => death.setRespawnPoint(s, place));
  sleep.addThreats(() => fear.pursued);
  // A sleeper does nothing but sleep: no harvesting, using, lights or crafting until a key wakes it.
  deps.player.addIncapacity(() => (sleep.asleep ? 'asleep' : null));
  return { harm, conditions, fear, sleep, actions, skills, death };
}
