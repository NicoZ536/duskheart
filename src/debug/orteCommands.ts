/**
 * Console commands of the places, the map and the world events (docs/SPIEL.md §30 "Debug: Konsole `reveal`, `event <id>`,
 * `strike`"; M7-38 … M7-40, M7-49): like every console command that changes the world they only queue game commands
 * (`GameSession.command`: validated, applied in the next tick, recorded for replays).
 *
 * - `reveal [tiefe]` – the map shows a whole layer (`map.reveal`): 0 the surface, 1–3 the caves; without: every layer.
 * - `event <id> [an|aus]` – starts a world event of the register now (`worldEvent.start`: announced and running at once) or
 *   ends it (`worldEvent.stop`). The id completes from the events that run in this build.
 * - `strike [dx] [dy]` – a bolt comes down (`lightning.strike`) `dx`, `dy` tiles from the player and seeks the tallest target
 *   around that point, as in a thunderstorm.
 */
import { CONTENT } from '../content/index';
import { createPlayerSample, type GameSession } from '../game/session';
import { MAX_DEBUG_STRIKE_TILES } from '../game/worldevents/commands';
import { DEEPEST_LAYER } from '../world/model/coords';
import { ConsoleError, type DebugConsole, type Translate } from './console';

/** What the commands need from the page. */
export interface OrteCommandDeps {
  readonly t: Translate;
  readonly session: Pick<GameSession, 'command' | 'samplePlayer'>;
}

export function registerOrteCommands(con: DebugConsole, deps: OrteCommandDeps): void {
  const { t, session } = deps;
  const sample = createPlayerSample();
  const events = (): readonly string[] =>
    CONTENT.collection('worldEvents')
      .values()
      .filter((e) => e.umgesetzt === true)
      .map((e) => e.id);
  con.register(
    'reveal',
    [{ name: 'tiefe', type: 'int', min: 0, max: -DEEPEST_LAYER, optional: true }],
    ({ tiefe }) => {
      if (tiefe === undefined) {
        session.command({ type: 'map.reveal' });
        return t('debug.cmd.reveal.all');
      }
      session.command({ type: 'map.reveal', layer: -tiefe });
      return t('debug.cmd.reveal.layer', { tiefe });
    },
    'debug.cmd.reveal.help',
  );
  con.register(
    'event',
    [
      { name: 'id', type: 'enum', options: events },
      { name: 'schalter', type: 'enum', options: ['an', 'aus'], default: 'an' },
    ],
    ({ id, schalter }) => {
      session.command({ type: schalter === 'aus' ? 'worldEvent.stop' : 'worldEvent.start', event: id });
      return t(schalter === 'aus' ? 'debug.cmd.event.stopped' : 'debug.cmd.event.started', { event: id });
    },
    'debug.cmd.event.help',
  );
  con.register(
    'strike',
    [
      { name: 'dx', type: 'int', min: -MAX_DEBUG_STRIKE_TILES, max: MAX_DEBUG_STRIKE_TILES, default: 0 },
      { name: 'dy', type: 'int', min: -MAX_DEBUG_STRIKE_TILES, max: MAX_DEBUG_STRIKE_TILES, default: 0 },
    ],
    ({ dx, dy }) => {
      if (!session.samplePlayer(sample)) throw new ConsoleError('debug.cmd.player.none');
      session.command({ type: 'lightning.strike', dx, dy });
      return t('debug.cmd.strike.done', { dx, dy });
    },
    'debug.cmd.strike.help',
  );
}
