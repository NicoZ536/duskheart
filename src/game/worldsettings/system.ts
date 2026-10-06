/**
 * The world settings (MASTERPROMPT §29 "Modi, Schwierigkeit", docs/SPIEL.md §25 "Neue Welt", §17 "Haken"; M7-51) – system
 * and save participant `world-settings`, second in the system order (right after `world-chunks`), so every reader of its
 * factors runs after it.
 *
 * - **Difficulty:** kept in the participant `death` since save version 1 (`DeathSystem.setDifficulty`: never away from
 *   Unbarmherzig); `world.setDifficulty` delegates there (ADR-0207: no participant-crossing migration).
 * - **Factors** (`factors()`): the preset of the difficulty (`BALANCE.difficulty.presets`) with this world's overrides of
 *   hunger/thirst and enemy damage and its shadow flood interval. Read by `vitals` (drain of satiety and thirst), `creatures`
 *   (their blows) and – from M7-32 – `bosses`. The record is held and recomputed only when the difficulty or an override
 *   changed: reading it every tick allocates nothing.
 * - **Peaceful** (`peaceful()`, `spawnBlocker`): the creatures' spawn veto (`CreatureSystem.addSpawnBlocker`) keeps foes,
 *   shadow brood and elites from every table spawn – first population, regrowth active and frozen, the night spawner, the
 *   Nachtmahr –, the animals stay; owned creatures (guards, boss servants) are not table spawns.
 * - **Logistics realism** (`logisticsRealism()`): read by fast travel (M7-37).
 * - **Season length:** `world.setSettings {jahreszeitenLaenge}` hands it to the calendar, which keeps the history of season
 *   lengths in its own participant.
 * - **Unbarmherzig** locks the difficulty and every setting that would soften the world; only the season length changes.
 * Each changed field raises `worldSettingsChanged`; no tick hooks (nothing here depends on time or chunks).
 */
import type { Difficulty } from '../../content/balance/death';
import type { CreatureFamily } from '../../content/creatures/schema';
import type { SpawnBlocker } from '../creatures/owned';
import type { SaveParticipant } from '../participant';
import type { CommandOfType } from '../commands';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { WorldSettingsField } from './events';
import { defaultWorldSettings, difficultyLocked, peacefulBlocks, resolveFactors, type MutableDifficultyFactors } from './formulas';
import { parseWorldSettings, serializeWorldSettings, WORLD_SETTINGS_MIGRATIONS, WORLD_SETTINGS_SAVE_VERSION, WORLD_SETTINGS_SYSTEM_ID } from './state';
import type { DifficultyFactors, WorldSettings, WorldSettingsApi } from './types';

/** Where the difficulty lives (the death system, src/game/death/system.ts). */
export interface DifficultyHolder {
  readonly difficulty: Difficulty;
  setDifficulty(difficulty: Difficulty): boolean;
}

/** The calendar's season length (src/world/calendar.ts). */
export interface SeasonLengthHolder {
  readonly seasonLengthDays: number;
  setSeasonLength(days: number): void;
}

/** Dependencies of the world settings system. */
export interface WorldSettingsSystemDeps {
  /** The calendar that keeps the season lengths (`SimWorld.calendar`); without it the season length cannot change. */
  readonly calendar?: SeasonLengthHolder;
}

/** Difficulty of a world without the life systems (tests of single systems): the reference preset. */
const REFERENCE_DIFFICULTY: Difficulty = 'normal';

export class WorldSettingsSystem implements SimSystem, WorldSettingsApi {
  readonly id = WORLD_SETTINGS_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  /** The spawn veto of a peaceful world (`CreatureSystem.addSpawnBlocker`). */
  readonly spawnBlocker: SpawnBlocker;
  private settings: WorldSettings = defaultWorldSettings();
  private death: DifficultyHolder | null = null;
  private readonly calendar: SeasonLengthHolder | null;
  private readonly held: MutableDifficultyFactors = { hungerThirst: 1, enemyDamage: 1, shadowFloodNights: null };
  /** Difficulty the held factors were computed for (`null`: stale – an override changed). */
  private heldFor: Difficulty | null = null;

  constructor(deps: WorldSettingsSystemDeps = {}) {
    this.calendar = deps.calendar ?? null;
    this.spawnBlocker = (_sim: Simulation, _layer: number, _tx: number, _ty: number, family: CreatureFamily) => this.settings.peaceful && peacefulBlocks(family);
    this.commands = {
      'world.setDifficulty': (sim, cmd, tick) => this.setDifficulty(sim, cmd, tick),
      'world.setSettings': (sim, cmd, tick) => this.setSettings(sim, cmd, tick),
    };
    this.save = {
      id: WORLD_SETTINGS_SYSTEM_ID,
      version: WORLD_SETTINGS_SAVE_VERSION,
      migrations: WORLD_SETTINGS_MIGRATIONS,
      serialize: () => serializeWorldSettings(this.settings),
      deserialize: (data) => {
        this.settings = parseWorldSettings(data);
        this.heldFor = null;
      },
    };
  }

  /** Binds the holder of the difficulty (the death system, created later in `createSimulation`). */
  useDeath(death: DifficultyHolder): void {
    this.death = death;
    this.heldFor = null;
  }

  /** The saved settings (read-only for callers; the commands change them). */
  get state(): Readonly<WorldSettings> {
    return this.settings;
  }

  difficulty(): Difficulty {
    return this.death?.difficulty ?? REFERENCE_DIFFICULTY;
  }

  /** The effective factors: a held record, recomputed only after a change (allocation-free, read every tick). */
  factors(): DifficultyFactors {
    const difficulty = this.difficulty();
    if (this.heldFor !== difficulty) {
      resolveFactors(difficulty, this.settings, this.held);
      this.heldFor = difficulty;
    }
    return this.held;
  }

  peaceful(): boolean {
    return this.settings.peaceful;
  }

  logisticsRealism(): boolean {
    return this.settings.logisticsRealism;
  }

  private changed(sim: Simulation, feld: WorldSettingsField, tick: number): void {
    this.heldFor = null;
    sim.events.push('worldSettingsChanged', { schwierigkeit: this.difficulty(), feld, tick });
  }

  private setDifficulty(sim: Simulation, cmd: CommandOfType<'world.setDifficulty'>, tick: number): void {
    const death = this.death;
    if (death === null) return;
    if (difficultyLocked(death.difficulty) && cmd.schwierigkeit !== death.difficulty) {
      sim.events.push('commandRejected', { type: cmd.type, reason: 'difficultyLocked', tick });
      return;
    }
    if (death.setDifficulty(cmd.schwierigkeit)) this.changed(sim, 'schwierigkeit', tick);
  }

  private setSettings(sim: Simulation, cmd: CommandOfType<'world.setSettings'>, tick: number): void {
    const s = this.settings;
    const next: WorldSettings = {
      peaceful: cmd.friedlich ?? s.peaceful,
      hungerThirst: cmd.hungerDurst === undefined ? s.hungerThirst : cmd.hungerDurst,
      enemyDamage: cmd.gegnerschaden === undefined ? s.enemyDamage : cmd.gegnerschaden,
      shadowFloodNights: cmd.schattenflut === undefined ? s.shadowFloodNights : cmd.schattenflut,
      logisticsRealism: cmd.logistikRealismus ?? s.logisticsRealism,
    };
    const calendar = this.calendar;
    const season = calendar !== null && cmd.jahreszeitenLaenge !== undefined && cmd.jahreszeitenLaenge !== calendar.seasonLengthDays ? cmd.jahreszeitenLaenge : null;
    const fields: WorldSettingsField[] = [];
    if (next.peaceful !== s.peaceful) fields.push('friedlich');
    if (next.hungerThirst !== s.hungerThirst) fields.push('hungerDurst');
    if (next.enemyDamage !== s.enemyDamage) fields.push('gegnerschaden');
    if (next.shadowFloodNights !== s.shadowFloodNights) fields.push('schattenflut');
    if (next.logisticsRealism !== s.logisticsRealism) fields.push('logistikRealismus');
    // Unbarmherzig keeps its rules: only the season length may change (the command is refused whole otherwise).
    if (fields.length > 0 && difficultyLocked(this.difficulty())) {
      sim.events.push('commandRejected', { type: cmd.type, reason: 'difficultyLocked', tick });
      return;
    }
    this.settings = next;
    if (calendar !== null && season !== null) {
      calendar.setSeasonLength(season);
      fields.push('jahreszeitenLaenge');
    }
    for (const feld of fields) this.changed(sim, feld, tick);
  }
}
