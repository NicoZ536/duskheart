/**
 * Console commands for the player (MASTERPROMPT §31.6; M3-35): `give`, `kill`, `god`, `noclip`, `unlock` and
 * `inspect`. Like every console command that changes the world they only queue game commands
 * (`GameSession.command`: validated, applied in the next tick, recorded for replays) and read the session
 * to report.
 *
 * - `give <item> [anzahl]` – puts items into the player's bags (`inventory.give`); the item id is checked
 *   against the content first (a typo names the closest id).
 * - `kill` – the player's light goes out at once (`death.kill`).
 * - `god [an | aus]` – the player takes no damage (`debug.god`); without an argument it toggles.
 * - `noclip [an | aus]` – the player walks through everything (`debug.noclip`); without an argument it toggles.
 * - `unlock [fertigkeit]` – every skill, or one, at its highest level with its perk choices open
 *   (`debug.unlock`, the Grundform of M3); the skill id is checked against the content first.
 * - `inspect [an | aus]` – the entity inspector: while on, a click on the game view picks the entity under
 *   the pointer (Alt + click works without it); without an argument it toggles.
 * `speed` (loop tempo) and `tp` (with a player: `player.teleport`) live with the core and world commands.
 */
import { BALANCE } from '../content/balance';
import { CONTENT } from '../content/index';
import { createPlayerSample, type GameSession } from '../game/session';
import { MAX_GIVE_COUNT } from '../game/inventory/commands';
import type { Lang } from '../i18n';
import { ConsoleError, type DebugConsole, type Translate } from './console';

/** Edit distance up to which `give` suggests an item id for a typo. */
const SUGGEST_DISTANCE = 3;

/** What the player commands need from the page. */
export interface PlayerCommandDeps {
  readonly t: Translate;
  readonly lang: () => Lang;
  readonly session: Pick<GameSession, 'command' | 'samplePlayer' | 'debugState'>;
  /** Whether inspecting is on, and switching it. */
  inspecting(): boolean;
  setInspecting(on: boolean): void;
}

/** Levenshtein distance (small strings: ids). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j] as number;
      row[j] = Math.min(cur + 1, (row[j - 1] as number) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length] as number;
}

/** The item id closest to `id` within `SUGGEST_DISTANCE`, or null. */
export function closestItem(id: string): string | null {
  let best: string | null = null;
  let bestD = SUGGEST_DISTANCE + 1;
  for (const candidate of CONTENT.collection('items').ids()) {
    const d = distance(id, candidate);
    if (d < bestD) {
      bestD = d;
      best = candidate;
    }
  }
  return best;
}

export function registerPlayerCommands(con: DebugConsole, deps: PlayerCommandDeps): void {
  const { t, session } = deps;
  const items = CONTENT.collection('items');
  const sample = createPlayerSample();
  const requirePlayer = (): void => {
    if (!session.samplePlayer(sample)) throw new ConsoleError('debug.cmd.player.none');
  };

  con.register(
    'give',
    [
      { name: 'item', type: 'string' },
      { name: 'anzahl', type: 'int', min: 1, max: MAX_GIVE_COUNT, default: 1 },
    ],
    ({ item, anzahl }) => {
      const def = items.find(item);
      if (def === undefined) {
        const guess = closestItem(item);
        throw guess === null ? new ConsoleError('debug.cmd.give.unknown', { item }) : new ConsoleError('debug.cmd.give.unknownSuggest', { item, suggestion: guess });
      }
      requirePlayer();
      session.command({ type: 'inventory.give', item: def.id, count: anzahl });
      return t('debug.cmd.give.done', { item: def.name[deps.lang()], count: anzahl });
    },
    'debug.cmd.give.help',
  );

  con.register(
    'kill',
    [],
    () => {
      requirePlayer();
      session.command({ type: 'death.kill' });
      return t('debug.cmd.kill.done');
    },
    'debug.cmd.kill.help',
  );

  con.register(
    'god',
    [{ name: 'state', type: 'enum', options: ['an', 'aus'], optional: true }],
    ({ state }) => {
      const on = state === undefined ? !session.debugState().cheats.god : state === 'an';
      session.command({ type: 'debug.god', on });
      return t(on ? 'debug.cmd.god.on' : 'debug.cmd.god.off');
    },
    'debug.cmd.god.help',
  );

  con.register(
    'noclip',
    [{ name: 'state', type: 'enum', options: ['an', 'aus'], optional: true }],
    ({ state }) => {
      const on = state === undefined ? !session.debugState().cheats.noclip : state === 'an';
      session.command({ type: 'debug.noclip', on });
      return t(on ? 'debug.cmd.noclip.on' : 'debug.cmd.noclip.off');
    },
    'debug.cmd.noclip.help',
  );

  const skills = CONTENT.collection('skills');
  con.register(
    'unlock',
    [{ name: 'fertigkeit', type: 'string', optional: true }],
    ({ fertigkeit }) => {
      const level = BALANCE.skills.maxLevel;
      if (fertigkeit === undefined) {
        session.command({ type: 'debug.unlock' });
        return t('debug.cmd.unlock.done', { level });
      }
      const def = skills.find(fertigkeit);
      if (def === undefined) throw new ConsoleError('debug.cmd.unlock.unknown', { skill: fertigkeit, skills: skills.ids().join(', ') });
      session.command({ type: 'debug.unlock', skill: def.id });
      return t('debug.cmd.unlock.doneOne', { skill: def.name[deps.lang()], level });
    },
    'debug.cmd.unlock.help',
    { aliases: ['freischalten'] },
  );

  con.register(
    'inspect',
    [{ name: 'state', type: 'enum', options: ['an', 'aus'], optional: true }],
    ({ state }) => {
      const on = state === undefined ? !deps.inspecting() : state === 'an';
      deps.setInspecting(on);
      return t(on ? 'debug.cmd.inspect.on' : 'debug.cmd.inspect.off');
    },
    'debug.cmd.inspect.help',
    { aliases: ['inspektor'] },
  );
}
