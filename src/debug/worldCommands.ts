/**
 * World console commands (M2-29, MASTERPROMPT §31.6): `tp`, `time`, `season`, `weather`, `seed` and
 * `overlay`. Everything that changes the world goes through game commands (`GameSession.command`,
 * validated like a replay file, applied in the next tick, recorded for replays); the commands only
 * read the session to report. Without arguments each command prints the current state.
 *
 * - `tp [x] [y] [ebene]` – the controlled figure to tile (x, y) on a layer (0, −1, −2, −3): the player
 *   (`player.teleport`, M3-08) or the debug mover of M2; without either the mover is created there first.
 *   Without coordinates: the start beach.
 * - `time [HH:MM | +Minuten]` – jump forward to the next HH:MM, or by minutes.
 * - `season [fruehling | sommer | herbst | winter]` – jump to 06:00 of the next start of that season.
 * - `weather [zustand] [hier | alle]` – force the weather where the camera looks, or everywhere.
 * - `seed [n]` – the world's seed and size; with `n` the page reloads with a new world (`?seed=n`).
 * - `overlay <chunks | kollision | temperatur> [an | aus]` – debug overlays of the game view.
 */
import { SEASON_IDS, type SeasonId } from '../content/balance';
import { WEATHER_STATES, WEATHER_STATE_IDS, type WeatherStateId } from '../content/weather';
import { HOURS_PER_DAY, MINUTES_PER_HOUR } from '../engine/time';
import { createPlayerSample, type GameSession } from '../game/session';
import type { Lang } from '../i18n';
import { WORLD_OVERLAYS, type WorldOverlay } from '../render/debugOverlay';
import { TILE_PX, type Layer } from '../world/model/coords';
import { worldDimensions } from '../world/model/worldSize';
import { ConsoleError, type DebugConsole, type Translate } from './console';

/** Deepest layer (`tp`). */
const DEEPEST_LAYER = -3;
/** Moon cycle shown in `time` (phase n of 8). */
const MOON_PHASES = 8;
/** Two digits of a clock value. */
const PAD = 2;

/** What the world commands need from the page. */
export interface WorldCommandDeps {
  readonly t: Translate;
  readonly lang: () => Lang;
  readonly session: Pick<GameSession, 'command' | 'sim' | 'sampleFocus' | 'samplePlayer'>;
  /** Start beach of the session's world (tile), or null while it is generated. */
  spawn(): { readonly x: number; readonly y: number } | null;
  /** Layer and tile the game view's camera looks at, or null (no game view). */
  cameraTile(): { readonly layer: Layer; readonly tx: number; readonly ty: number } | null;
  setOverlay(name: WorldOverlay, on: boolean): void;
  overlayState(): Readonly<Record<WorldOverlay, boolean>>;
  /** Reloads the page with another world seed. */
  reloadWithSeed(seed: number): void;
}

function two(n: number): string {
  return String(n).padStart(PAD, '0');
}

function centre(tile: number): number {
  return tile * TILE_PX + TILE_PX / 2;
}

/** Parses the `time` argument: `HH:MM` → absolute, `+N` → relative minutes. */
export function parseTimeArg(raw: string): { readonly hour: number; readonly minute: number } | { readonly minutes: number } | null {
  const abs = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (abs !== null) {
    const hour = Number(abs[1]);
    const minute = Number(abs[2]);
    return hour < HOURS_PER_DAY && minute < MINUTES_PER_HOUR ? { hour, minute } : null;
  }
  const rel = /^\+(\d+)$/.exec(raw);
  if (rel !== null) {
    const minutes = Number(rel[1]);
    return minutes > 0 ? { minutes } : null;
  }
  return null;
}

export function registerWorldCommands(con: DebugConsole, deps: WorldCommandDeps): void {
  const { t, session } = deps;
  const sim = session.sim;
  const seasonName = (s: SeasonId): string => t(`world.season.${s}`);
  const weatherName = (id: WeatherStateId): string => WEATHER_STATES.find((w) => w.id === id)?.name[deps.lang()] ?? id;
  const worldTiles = (): number => worldDimensions(sim.config.worldSize).tiles;
  const playerSample = createPlayerSample();

  con.register(
    'tp',
    [
      { name: 'x', type: 'int', optional: true },
      { name: 'y', type: 'int', optional: true },
      { name: 'ebene', type: 'int', min: DEEPEST_LAYER, max: 0, default: 0 },
    ],
    ({ x, y, ebene }) => {
      let tx = x;
      let ty = y;
      if (tx === undefined || ty === undefined) {
        const spawn = deps.spawn();
        if (spawn === null) throw new ConsoleError('debug.cmd.world.notReady');
        tx = spawn.x;
        ty = spawn.y;
      }
      const max = worldTiles() - 1;
      if (tx < 0 || ty < 0 || tx > max || ty > max) throw new ConsoleError('debug.cmd.tp.outside', { x: String(tx), y: String(ty), max: String(max) });
      const layer = ebene as Layer;
      if (session.samplePlayer(playerSample)) {
        session.command({ type: 'player.teleport', x: centre(tx), y: centre(ty), layer });
        return t('debug.cmd.tp.done', { x: String(tx), y: String(ty), layer: String(layer) });
      }
      const hasFigure = session.sampleFocus({ x: 0, y: 0, layer: 0 });
      if (!hasFigure) session.command({ type: 'spawnDebugMover', x: centre(tx), y: centre(ty), controlled: true });
      if (hasFigure || layer !== 0) session.command({ type: 'teleport', x: centre(tx), y: centre(ty), layer });
      // Coordinates and seeds are identifiers, not quantities: no digit grouping.
      return t(hasFigure ? 'debug.cmd.tp.done' : 'debug.cmd.tp.spawned', { x: String(tx), y: String(ty), layer: String(layer) });
    },
    'debug.cmd.tp.help',
    { aliases: ['teleport'] },
  );

  con.register(
    'time',
    [{ name: 'zeit', type: 'string', optional: true }],
    ({ zeit }) => {
      const cal = sim.world.calendar;
      if (zeit === undefined) {
        return t('debug.cmd.time.now', {
          day: sim.clock.day,
          time: `${two(sim.clock.hour)}:${two(sim.clock.minute)}`,
          season: seasonName(cal.season),
          dayOfSeason: cal.dayOfSeason,
          seasonLength: cal.seasonLengthDays,
          year: cal.year,
          moon: cal.moonPhase + 1,
          moons: MOON_PHASES,
        });
      }
      const parsed = parseTimeArg(zeit);
      if (parsed === null) throw new ConsoleError('debug.cmd.time.invalid', { value: zeit });
      if ('minutes' in parsed) {
        session.command({ type: 'advanceTime', minutes: parsed.minutes });
        return t('debug.cmd.time.advance', { minutes: parsed.minutes });
      }
      session.command({ type: 'setTime', hour: parsed.hour, minute: parsed.minute });
      return t('debug.cmd.time.set', { time: `${two(parsed.hour)}:${two(parsed.minute)}` });
    },
    'debug.cmd.time.help',
  );

  con.register(
    'season',
    [{ name: 'jahreszeit', type: 'enum', options: SEASON_IDS, optional: true }],
    ({ jahreszeit }) => {
      const cal = sim.world.calendar;
      if (jahreszeit === undefined) return t('debug.cmd.season.now', { season: seasonName(cal.season), day: cal.dayOfSeason, length: cal.seasonLengthDays, year: cal.year });
      session.command({ type: 'setSeason', season: jahreszeit });
      return t('debug.cmd.season.set', { season: seasonName(jahreszeit) });
    },
    'debug.cmd.season.help',
  );

  con.register(
    'weather',
    [
      { name: 'zustand', type: 'enum', options: WEATHER_STATE_IDS, optional: true },
      { name: 'bereich', type: 'enum', options: ['hier', 'alle'], default: 'hier' },
    ],
    ({ zustand, bereich }) => {
      const here = deps.cameraTile();
      const region = here === null || here.layer !== 0 || !sim.world.materialized ? -1 : sim.world.regionAt(here.tx, here.ty);
      if (zustand === undefined) {
        if (region < 0) throw new ConsoleError('debug.cmd.weather.noRegion');
        return t('debug.cmd.weather.now', { state: weatherName(sim.world.weather.state(region)), region });
      }
      if (bereich === 'alle') {
        session.command({ type: 'setWeather', state: zustand });
        return t('debug.cmd.weather.setAll', { state: weatherName(zustand) });
      }
      if (here === null || region < 0) throw new ConsoleError('debug.cmd.weather.noRegion');
      session.command({ type: 'setWeather', state: zustand, tx: here.tx, ty: here.ty });
      return t('debug.cmd.weather.set', { state: weatherName(zustand), region });
    },
    'debug.cmd.weather.help',
  );

  con.register(
    'seed',
    [{ name: 'seed', type: 'int', min: 0, optional: true }],
    ({ seed }) => {
      if (seed === undefined) return t('debug.cmd.seed.now', { seed: String(sim.config.seed), size: t(`world.size.${sim.config.worldSize}`) });
      deps.reloadWithSeed(seed);
      return t('debug.cmd.seed.reload', { seed: String(seed) });
    },
    'debug.cmd.seed.help',
  );

  con.register(
    'overlay',
    [
      { name: 'name', type: 'enum', options: WORLD_OVERLAYS, optional: true },
      { name: 'zustand', type: 'enum', options: ['an', 'aus'], optional: true },
    ],
    ({ name, zustand }) => {
      const state = deps.overlayState();
      if (name === undefined) return WORLD_OVERLAYS.map((o) => t('debug.cmd.overlay.state', { name: o, state: t(state[o] ? 'common.on' : 'common.off') }));
      const on = zustand === undefined ? !state[name] : zustand === 'an';
      deps.setOverlay(name, on);
      return t('debug.cmd.overlay.state', { name, state: t(on ? 'common.on' : 'common.off') });
    },
    'debug.cmd.overlay.help',
  );
}
