/**
 * Console commands of the vaults (docs/SPIEL.md §30 "Debug: Konsole … `vault <n>`, `solve`"; M7-10 … M7-13): like every console
 * command that changes the world they only queue game commands (`GameSession.command`: validated, applied in the next tick,
 * recorded for replays); the world's vault plans are read to find where to go.
 *
 * - `vault [n]` – takes the player down into a vault: the `n`-th nearest of the world (0 = the nearest, default), onto the tile
 *   beside the way up of its start room (`player.teleport`, layer −1; the vault counts as entered on arrival).
 * - `solve [rätsel]` – solves the puzzles of the vault the player stands in (`vault.solve`): the given one (its id in the vault),
 *   or every unsolved one – their doors open as if the player had solved them.
 * - `tafel` – reads the Builder tablet of the vault the player stands in that lies nearest to him, as E in front of it does: onto
 *   the tile south of it (`player.teleport`), then `vault.use` on it – `tabletRead` opens the tablet screen.
 */
import { createPlayerSample, type GameSession } from '../game/session';
import { TILE_PX } from '../world/model/coords';
import { ConsoleError, type DebugConsole, type Translate } from './console';

/** The vault layer (ADR-0207). */
const VAULT_LAYER = -1;
/** Most vaults a world has, for the argument's range (seven biomes × at most 4 slots on "Groß", with extra slots). */
const VAULTS_MAX = 64;
/** Most puzzles of a vault (`BALANCE.vaults.puzzlesMax` and the nearest vault's four types). */
const PUZZLES_MAX = 8;

/** What the commands need from the page. */
export interface GewoelbeCommandDeps {
  readonly t: Translate;
  readonly session: Pick<GameSession, 'command' | 'samplePlayer' | 'sim'>;
}

export function registerGewoelbeCommands(con: DebugConsole, deps: GewoelbeCommandDeps): void {
  const { t, session } = deps;
  const sample = createPlayerSample();
  con.register(
    'vault',
    [{ name: 'n', type: 'int', min: 0, max: VAULTS_MAX - 1, default: 0 }],
    ({ n }) => {
      if (!session.samplePlayer(sample)) throw new ConsoleError('debug.cmd.player.none');
      const ptx = Math.floor(sample.x / TILE_PX);
      const pty = Math.floor(sample.y / TILE_PX);
      const plans = [...session.sim.world.generated.vaults].sort((a, b) => (a.entrance.tx - ptx) ** 2 + (a.entrance.ty - pty) ** 2 - ((b.entrance.tx - ptx) ** 2 + (b.entrance.ty - pty) ** 2) || a.slot - b.slot);
      const plan = plans[n];
      if (plan === undefined) throw new ConsoleError('debug.cmd.vault.none', { n, anzahl: plans.length });
      session.command({ type: 'player.teleport', x: (plan.entrance.tx + 0.5) * TILE_PX, y: (plan.entrance.ty + 1 + 0.5) * TILE_PX, layer: VAULT_LAYER });
      return t('debug.cmd.vault.done', { slot: plan.slot, biom: plan.biome, raeume: plan.rooms.length });
    },
    'debug.cmd.vault.help',
  );
  con.register(
    'solve',
    [{ name: 'raetsel', type: 'int', min: 0, max: PUZZLES_MAX - 1, optional: true }],
    ({ raetsel }) => {
      if (!session.samplePlayer(sample)) throw new ConsoleError('debug.cmd.player.none');
      const tx = Math.floor(sample.x / TILE_PX);
      const ty = Math.floor(sample.y / TILE_PX);
      const plan = sample.layer !== VAULT_LAYER ? undefined : session.sim.world.generated.vaults.find((v) => tx >= v.box.x0 && ty >= v.box.y0 && tx < v.box.x0 + v.box.w && ty < v.box.y0 + v.box.h);
      if (plan === undefined) throw new ConsoleError('debug.cmd.solve.outside');
      session.command(raetsel === undefined ? { type: 'vault.solve', vault: plan.slot } : { type: 'vault.solve', vault: plan.slot, puzzle: raetsel });
      return raetsel === undefined ? t('debug.cmd.solve.all', { slot: plan.slot }) : t('debug.cmd.solve.one', { slot: plan.slot, raetsel });
    },
    'debug.cmd.solve.help',
  );
  con.register(
    'tafel',
    [],
    () => {
      if (!session.samplePlayer(sample)) throw new ConsoleError('debug.cmd.player.none');
      const tx = Math.floor(sample.x / TILE_PX);
      const ty = Math.floor(sample.y / TILE_PX);
      const plan = sample.layer !== VAULT_LAYER ? undefined : session.sim.world.generated.vaults.find((v) => tx >= v.box.x0 && ty >= v.box.y0 && tx < v.box.x0 + v.box.w && ty < v.box.y0 + v.box.h);
      if (plan === undefined) throw new ConsoleError('debug.cmd.solve.outside');
      const tablet = [...plan.tablets].sort((a, b) => (a.tx - tx) ** 2 + (a.ty - ty) ** 2 - ((b.tx - tx) ** 2 + (b.ty - ty) ** 2))[0];
      if (tablet === undefined) throw new ConsoleError('debug.cmd.tafel.none', { slot: plan.slot });
      session.command({ type: 'player.teleport', x: (tablet.tx + 0.5) * TILE_PX, y: (tablet.ty + 1 + 0.5) * TILE_PX, layer: VAULT_LAYER });
      session.command({ type: 'vault.use', tx: tablet.tx, ty: tablet.ty });
      // Tile coordinates as written, not as amounts (no digit grouping).
      return t('debug.cmd.tafel.done', { tafel: tablet.tablet, x: String(tablet.tx), y: String(tablet.ty) });
    },
    'debug.cmd.tafel.help',
  );
}
