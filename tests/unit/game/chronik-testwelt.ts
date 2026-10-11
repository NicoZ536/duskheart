/**
 * Testwelt der Beobachter von Strang G (Statistiken, Erfolge, Chronik, Aufgaben, Funke; M7-41 … M7-47): eine nackte Simulation
 * ohne Weltgenerierung, ein Einspeiser, der in seinem `update` die Ereignisse des Tests schiebt (so sehen die Beobachter sie
 * im Schritt), und eine gemeinsame Auslöser-Welt mit einstellbarem Zustand.
 */
import type { SimEventMap, SimSystem, Simulation } from '../../../src/game/sim';
import { Simulation as Sim } from '../../../src/game/sim';
import { SimTriggerWorld } from '../../../src/game/triggers/world';

/** Ein Ereignis, das der Einspeiser im nächsten Schritt schiebt. */
export type Feed = { [K in keyof SimEventMap]: [K, Omit<SimEventMap[K], 'tick'>] }[keyof SimEventMap];

/** Schiebt in seinem `update` die Ereignisse, die der Test vorher eingereiht hat. */
export class Feeder implements SimSystem {
  readonly id = 'feeder';
  readonly timeScope = 'global';
  private readonly queue: Feed[] = [];

  push(...feeds: Feed[]): this {
    this.queue.push(...feeds);
    return this;
  }

  update(sim: Simulation): void {
    for (const [type, payload] of this.queue.splice(0)) sim.events.push(type, { ...payload, tick: sim.eventTick } as never);
  }
}

/** Zustand, den die Auslöser-Welt des Tests liest. */
export interface WorldState {
  items: Record<string, number>;
  conditions: Set<string>;
  light: number;
  indoors: boolean;
  room: string | null;
  unlocks: Set<string>;
  places: Record<string, number>;
}

/** Eine nackte Simulation mit Einspeiser und Auslöser-Welt (Statistiken, Aufgaben … verdrahtet der Test). */
export function chronikWelt(seed = 1): { sim: Simulation; feeder: Feeder; world: SimTriggerWorld; state: WorldState } {
  const sim = new Sim({ seed, worldSize: 'small' });
  const feeder = sim.addSystem(new Feeder());
  const state: WorldState = { items: {}, conditions: new Set(), light: 1, indoors: false, room: null, unlocks: new Set(), places: {} };
  const world = new SimTriggerWorld().use({
    carried: (_s, item) => state.items[item] ?? 0,
    conditionActive: (id) => state.conditions.has(id),
    lightLevel: () => state.light,
    indoors: () => state.indoors,
    roomType: () => state.room,
    unlocked: (id) => state.unlocks.has(id),
    placesDiscovered: (type) => state.places[type] ?? 0,
  });
  return { sim, feeder, world, state };
}

/** `n` Schritte; die Ereignisse werden nach jedem geleert (wie die Präsentation) und gesammelt zurückgegeben. */
export function steps(sim: Simulation, n = 1): Array<[string, Record<string, unknown>]> {
  const out: Array<[string, Record<string, unknown>]> = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    sim.events.drain((type, payload) => out.push([type, payload as Record<string, unknown>]));
  }
  return out;
}
