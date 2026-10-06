/**
 * Samples of the world events for the presentation (docs/SPIEL.md §18 "Ankündigung: Himmel, Grading, Klang, HUD mit Restzeit";
 * strand B, M7-38 … M7-40): a read-only view into the world events system, found once and kept. Every frame the HUD's event
 * lines and the sky's preset are sampled into a held record (no allocation): every announced or running event – running ones
 * first, then the announced, each in register order – with the whole game minutes to its start or end and the ticks of its
 * run (the renderer eases the sky's preset in over the lead and out at the end from them).
 */
import type { Simulation } from '../sim';
import { WorldEventsSystem } from '../worldevents/system';
import type { WorldEventPhase } from '../worldevents/types';

/** Most event lines a sample holds (four events run in M7; a big one excludes the others, the Finstermond runs beside). */
export const WORLD_EVENT_LINES = 4;

/** One announced or running world event. */
export interface WorldEventLine {
  /** Register id (`worldEvents`). */
  event: string;
  phase: Exclude<WorldEventPhase, 'ruhe'>;
  /** Whole game minutes to the start (announced) or to the end (running), rounded up; at least 1. */
  minutes: number;
  /** The run [ticks]: when it was announced, starts and ends. */
  announceTick: number;
  startTick: number;
  endTick: number;
  /** Sky/grading preset of the register (`ankuendigung.himmel`), '' without. */
  himmel: string;
}

/** The world events of the moment: only the first `count` lines are valid (the records are reused). */
export interface WorldEventSample {
  readonly lines: WorldEventLine[];
  count: number;
  /** Tick of the sample. */
  tick: number;
}

/** A fresh sample (no event). */
export function createWorldEventSample(): WorldEventSample {
  const lines: WorldEventLine[] = [];
  for (let i = 0; i < WORLD_EVENT_LINES; i++) lines.push({ event: '', phase: 'angekuendigt', minutes: 0, announceTick: 0, startTick: 0, endTick: 0, himmel: '' });
  return { lines, count: 0, tick: 0 };
}

/** Finds the world events system of a simulation once. */
export class OrteSampler {
  private eventSystem: WorldEventsSystem | null | undefined = undefined;
  private eventSim: Simulation | null = null;

  /** The world events system, or null. */
  worldEvents(sim: Simulation): WorldEventsSystem | null {
    if (this.eventSim !== sim) {
      this.eventSim = sim;
      this.eventSystem = undefined;
    }
    if (this.eventSystem === undefined) {
      const s = sim.systems.find((x) => x instanceof WorldEventsSystem);
      this.eventSystem = s instanceof WorldEventsSystem ? s : null;
    }
    return this.eventSystem;
  }

  /** Fills `out` with the announced and running world events (none without the system). */
  sampleWorldEvents(sim: Simulation, out: WorldEventSample): WorldEventSample {
    out.count = 0;
    out.tick = sim.tick;
    const system = this.worldEvents(sim);
    if (system === null) return out;
    const perMinute = sim.clock.ticksPerGameMinute;
    // Running first, then announced.
    for (let pass = 0; pass < 2; pass++) {
      const want: WorldEventPhase = pass === 0 ? 'aktiv' : 'angekuendigt';
      for (let i = 0; i < system.count && out.count < out.lines.length; i++) {
        const s = system.stateAt(i);
        if (s.phase !== want) continue;
        const def = system.defAt(i);
        const line = out.lines[out.count++] as WorldEventLine;
        line.event = def.id;
        line.phase = want;
        line.announceTick = s.announceTick;
        line.startTick = s.startTick;
        line.endTick = s.endTick;
        line.minutes = Math.max(1, Math.ceil(((want === 'aktiv' ? s.endTick : s.startTick) - sim.tick) / perMinute));
        line.himmel = def.ankuendigung.himmel ?? '';
      }
    }
    return out;
  }
}
