/**
 * Console command of the kitchen (docs/SPIEL.md §21 "Debug"; M7-29, strand E): like every console command that changes the
 * world it only queues a game command (`GameSession.command`: validated, applied in the next tick, recorded for replays).
 *
 * - `spoil [stunden]` – every perishable stack in the bags and the active zone ages that many game hours at once
 *   (`spoilage.advance`; default one day, at most `MAX_DEBUG_SPOIL_HOURS`): the freshness stages and the rotten leftovers show
 *   without waiting for them.
 */
import type { GameSession } from '../game/session';
import { MAX_DEBUG_SPOIL_HOURS } from '../game/spoilage/commands';
import type { DebugConsole, Translate } from './console';

/** Hours of `spoil` without an argument (one game day). */
const DEFAULT_HOURS = 24;

/** What the command needs from the page. */
export interface KuecheCommandDeps {
  readonly t: Translate;
  readonly session: Pick<GameSession, 'command'>;
}

export function registerKuecheCommands(con: DebugConsole, deps: KuecheCommandDeps): void {
  const { t, session } = deps;
  con.register(
    'spoil',
    [{ name: 'stunden', type: 'int', min: 1, max: MAX_DEBUG_SPOIL_HOURS, default: DEFAULT_HOURS }],
    ({ stunden }) => {
      session.command({ type: 'spoilage.advance', hours: stunden });
      return t('debug.cmd.spoil.done', { stunden });
    },
    'debug.cmd.spoil.help',
  );
}
