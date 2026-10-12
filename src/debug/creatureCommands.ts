/**
 * Console commands for creatures (MASTERPROMPT §31.6 "spawn … kill"; M6-13 ff.): like every console command that changes
 * the world they only queue game commands (`GameSession.command`: validated, applied in the next tick, recorded for
 * replays).
 *
 * - `spawn <kreatur> [anzahl]` – creatures in front of the player (`creature.spawn`; pack animals spawned together are
 *   one pack). The creature id completes from the content (unique prefixes are accepted).
 * - `kill <radius>` – every creature within `radius` tiles of the player dies as if slain by it (`creature.kill`: loot,
 *   carcass, bestiary); `kill` without a radius stays the player's own death (src/debug/playerCommands.ts calls
 *   `killCreatures` for the radius form).
 * - `condition <kreatur> <zustand> [sekunden]` (M7-128) – the creature of that kind nearest the player takes the condition
 *   (`creature.condition`, system `creature-debug`): for `sekunden`, else for the condition's own time; an untimed
 *   condition needs `sekunden`.
 *
 * `creatureExtensions` adds `__dh.call('creatures')` (src/debug/boot.tsx): the living creatures per id, carcasses, traps
 * and the path service's counters (requests, answers of the path worker, paths computed in the simulation's thread) –
 * what the E2E checks read (tests/e2e/kreaturen.spec.ts).
 */
import { CONTENT } from '../content/index';
import { MAX_DEBUG_CONDITION_SECONDS, MAX_DEBUG_KILL_RADIUS, MAX_DEBUG_SPAWN } from '../game/creatures/commands';
import { CreatureSystem } from '../game/creatures/system';
import { TrapSystem } from '../game/creatures/traps';
import type { PathServiceStats } from '../world/path/service';
import { createPlayerSample, type GameSession } from '../game/session';
import type { Lang } from '../i18n';
import { ConsoleError, type DebugConsole, type Translate } from './console';

/** Smallest kill radius the console accepts [tiles]: one tile around the player. */
export const MIN_DEBUG_KILL_RADIUS = 1;
/** Shortest condition the console lays [s]: a tenth of a second – six ticks, long enough to be seen in a frame. */
export const MIN_DEBUG_CONDITION_SECONDS = 0.1;

/** What the creature commands need from the page. */
export interface CreatureCommandDeps {
  readonly t: Translate;
  readonly lang: () => Lang;
  readonly session: Pick<GameSession, 'command' | 'samplePlayer'>;
}

/** The radius argument of `kill` (optional: without it `kill` is the player's death). */
export const KILL_RADIUS_ARG = { name: 'radius', type: 'float', min: MIN_DEBUG_KILL_RADIUS, max: MAX_DEBUG_KILL_RADIUS, optional: true } as const;

/** Queues `creature.kill` around the player; throws without a player. Returns the console's answer. */
export function killCreatures(deps: CreatureCommandDeps, radius: number): string {
  if (!deps.session.samplePlayer(createPlayerSample())) throw new ConsoleError('debug.cmd.player.none');
  deps.session.command({ type: 'creature.kill', radius });
  return deps.t('debug.cmd.kill.creatures', { radius });
}

export function registerCreatureCommands(con: DebugConsole, deps: CreatureCommandDeps): void {
  const { t, session } = deps;
  const creatures = CONTENT.collection('creatures');
  const sample = createPlayerSample();
  con.register(
    'spawn',
    [
      { name: 'kreatur', type: 'enum', options: () => creatures.ids() },
      { name: 'anzahl', type: 'int', min: 1, max: MAX_DEBUG_SPAWN, default: 1 },
    ],
    ({ kreatur, anzahl }) => {
      const def = creatures.get(kreatur);
      if (!session.samplePlayer(sample)) throw new ConsoleError('debug.cmd.player.none');
      session.command({ type: 'creature.spawn', creature: def.id, count: anzahl });
      return t('debug.cmd.spawn.done', { creature: def.name[deps.lang()], count: anzahl });
    },
    'debug.cmd.spawn.help',
  );
  const conditions = CONTENT.collection('conditions');
  con.register(
    'condition',
    [
      { name: 'kreatur', type: 'enum', options: () => creatures.ids() },
      { name: 'zustand', type: 'enum', options: () => conditions.ids() },
      { name: 'sekunden', type: 'float', min: MIN_DEBUG_CONDITION_SECONDS, max: MAX_DEBUG_CONDITION_SECONDS, optional: true },
    ],
    ({ kreatur, zustand, sekunden }) => {
      const def = creatures.get(kreatur);
      const cond = conditions.get(zustand);
      // Without a duration a timed condition lasts its own (at most the command's longest); an untimed one needs one.
      const own = cond.dauer.art === 'zeit' ? Math.min(cond.dauer.sekunden, MAX_DEBUG_CONDITION_SECONDS) : null;
      const seconds = sekunden ?? own;
      if (seconds === null) throw new ConsoleError('debug.cmd.condition.duration', { condition: cond.name[deps.lang()] });
      if (!session.samplePlayer(sample)) throw new ConsoleError('debug.cmd.player.none');
      session.command({ type: 'creature.condition', creature: def.id, condition: cond.id, seconds });
      return t('debug.cmd.condition.done', { condition: cond.name[deps.lang()], creature: def.name[deps.lang()], seconds });
    },
    'debug.cmd.condition.help',
  );
}

/** What `__dh.call('creatures')` reports. */
export interface CreatureDebugSummary {
  /** Living creatures per creature id. */
  readonly byId: Readonly<Record<string, number>>;
  readonly carcasses: number;
  readonly traps: number;
  readonly paths: Readonly<PathServiceStats>;
}

/** The `__dh` extensions of the creatures (null while the simulation has no creature system). */
export function creatureExtensions(session: Pick<GameSession, 'sim'>): Record<string, () => CreatureDebugSummary | null> {
  return {
    creatures: () => {
      const c = session.sim.system('creatures');
      const t = session.sim.system('traps');
      if (!(c instanceof CreatureSystem)) return null;
      const byId: Record<string, number> = {};
      for (let i = 0; i < c.store.size; i++) {
        const s = c.store.valueAt(i);
        if (s.health > 0) byId[s.creature] = (byId[s.creature] ?? 0) + 1;
      }
      return { byId, carcasses: c.carcasses.size, traps: t instanceof TrapSystem ? t.traps.length : 0, paths: { ...c.paths.stats } };
    },
  };
}
