/**
 * Reading sample of the world settings for the presentation (MASTERPROMPT §29, docs/SPIEL.md §25; M7-51; docs/ARCHITEKTUR.md
 * "Lesende Abtastungen der Sitzung"). The pause menu's world view (src/ui/screens/pause/) never reads the simulation: it
 * calls `GameSession.sampleWorldSettings`, which fills a record the caller owns – the difficulty (kept by death) and whether
 * it is locked, the saved overrides, the effective factors, the season length (kept by the calendar) and the immutable world
 * config (seed, size, day length, resource density). Changes go back as commands (`world.setDifficulty`, `world.setSettings`).
 *
 * Read-only and allocation-free once the record exists (the menu samples it on open and after each change).
 */
import type { Difficulty } from '../../content/balance/death';
import type { WorldSizePreset } from '../../content/balance';
import type { Simulation } from '../sim';
import { difficultyLocked } from '../worldsettings/formulas';
import { WorldSettingsSystem } from '../worldsettings/system';
import type { ResourceDensity, WorldSettings } from '../worldsettings/types';

/** What the world view shows. */
export interface WorldSettingsSample {
  schwierigkeit: Difficulty;
  /** Unbarmherzig: difficulty and every softening setting are locked (§29). */
  gesperrt: boolean;
  friedlich: boolean;
  /** Overrides (`null` = the preset's). */
  hungerDurst: number | null;
  gegnerschaden: number | null;
  schattenflut: WorldSettings['shadowFloodNights'];
  logistikRealismus: boolean;
  /** Effective factors (preset with overrides). */
  wirkHungerDurst: number;
  wirkGegnerschaden: number;
  wirkSchattenflut: number | null;
  /** Days per season today. */
  jahreszeitenLaenge: number;
  /** Immutable world config. */
  seed: number;
  groesse: WorldSizePreset;
  tageslaenge: number;
  ressourcendichte: ResourceDensity;
}

/** An empty record to sample into. */
export function createWorldSettingsSample(): WorldSettingsSample {
  return {
    schwierigkeit: 'normal',
    gesperrt: false,
    friedlich: false,
    hungerDurst: null,
    gegnerschaden: null,
    schattenflut: 'voreinstellung',
    logistikRealismus: false,
    wirkHungerDurst: 1,
    wirkGegnerschaden: 1,
    wirkSchattenflut: null,
    jahreszeitenLaenge: 0,
    seed: 0,
    groesse: 'medium',
    tageslaenge: 0,
    ressourcendichte: 'normal',
  };
}

/** Fills `out` from the simulation's world settings; false when the simulation has none. */
export function sampleWorldSettings(sim: Simulation, out: WorldSettingsSample): boolean {
  const ws = sim.systems.find((s) => s.id === 'world-settings');
  if (!(ws instanceof WorldSettingsSystem)) return false;
  const s = ws.state;
  const f = ws.factors();
  out.schwierigkeit = ws.difficulty();
  out.gesperrt = difficultyLocked(out.schwierigkeit);
  out.friedlich = s.peaceful;
  out.hungerDurst = s.hungerThirst;
  out.gegnerschaden = s.enemyDamage;
  out.schattenflut = s.shadowFloodNights;
  out.logistikRealismus = s.logisticsRealism;
  out.wirkHungerDurst = f.hungerThirst;
  out.wirkGegnerschaden = f.enemyDamage;
  out.wirkSchattenflut = f.shadowFloodNights;
  out.jahreszeitenLaenge = sim.world.calendar.seasonLengthDays;
  out.seed = sim.config.seed;
  out.groesse = sim.config.worldSize;
  out.tageslaenge = sim.config.dayLengthMinutes;
  out.ressourcendichte = sim.config.resourceDensity ?? 'normal';
  return true;
}
