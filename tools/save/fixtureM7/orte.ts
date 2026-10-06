/**
 * Contribution of strand B (Orte & Welt) to the reference save of save version 4 (docs/SPIEL.md §27, §18; M7-07): a place
 * plundered and cleansed, made by commands only, and its facts for the migration test – read through the places system's
 * public API (`PlacesSystem`), never from the snapshot layout.
 *
 * `playOrte(sim)` goes to the place with chests and guards nearest the player (a farmstead, a look-out tower …; the fixture
 * world, seed 3 small, has several), discovers it (its guards rise), opens one chest (the object becomes `ort_truhe_offen`, a
 * chunk diff; its loot lands as drops), kills the guards there (`creature.kill` within `GUARD_KILL_TILES` – far from the
 * scenario's own creatures) so the place is cleansed with its return tick, and returns the player to where they stood.
 * On the way the map (M7-49) reveals the cells around every stop, and an own marker is set at the place ("aufgedeckte Karte
 * mit eigenem Marker", docs/SPIEL.md §27).
 * Use (integrator, tools/save/fixture.ts): after `wildlife(d, base)` and before the fight (the fight must stay the last thing
 * before the save), `orteFacts(sim)` beside `saveFacts`. Fixtures of versions 1–3 load with `EMPTY_ORTE_FACTS` (no place was
 * ever touched and nothing revealed before M7; the participants `places` and `map` migrate from 0 to nothing).
 */
import { z } from 'zod';
import type { GameCommand } from '../../../src/game/commands';
import { countRevealed } from '../../../src/game/map/formulas';
import { MapSystem } from '../../../src/game/map/system';
import { MAP_MARKER_SYMBOLS } from '../../../src/game/map/types';
import { PlacesSystem } from '../../../src/game/places/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import type { Simulation } from '../../../src/game/sim';
import { TILE_PX } from '../../../src/world/model/coords';

/** Ticks for the zone to stream the chunks around a teleport target. */
const SETTLE_TICKS = 30;
/** Radius of the guard kill around the place's centre [tiles] (the guards stand at their marks, within a slot radius). */
const GUARD_KILL_TILES = 12;

/** Name of the fixture's own marker. */
export const FIXTURE_MARKER_NAME = 'Gereinigt';

function map(sim: Simulation): MapSystem {
  const m = sim.system('map');
  if (!(m instanceof MapSystem)) throw new Error('orte: die Simulation hat kein System map');
  return m;
}

function places(sim: Simulation): PlacesSystem {
  const p = sim.system('places');
  if (!(p instanceof PlacesSystem)) throw new Error('orte: die Simulation hat kein System places');
  return p;
}

/** Runs `commands` then `ticks − 1` more ticks; throws if a command was refused. Returns the event types seen. */
function run(sim: Simulation, what: string, commands: readonly GameCommand[], ticks = 1): Set<string> {
  const seen = new Set<string>();
  const refused: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? commands : undefined);
    sim.events.drain((type, payload) => {
      seen.add(type);
      if (type === 'commandRejected') refused.push(JSON.stringify(payload));
    });
  }
  if (refused.length > 0) throw new Error(`Fixture-Szenario (Orte): ${what} abgelehnt: ${refused.join(', ')}`);
  return seen;
}

function teleport(tx: number, ty: number): GameCommand {
  return { type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 0.5) * TILE_PX, layer: 0 };
}

/** Plays the places part of the reference save (see module comment); throws if a step does not have its effect. */
export function playOrte(sim: Simulation): void {
  const p = places(sim);
  const player = sim.system('player') as PlayerSystem;
  const at = { x: 0, y: 0 };
  if (!player.position(sim, at)) throw new Error('Fixture-Szenario (Orte): kein Spieler');
  const home = { tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) };
  // The nearest place with a chest and guards.
  let best: { slot: number; x: number; y: number; chest: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  p.forEachPlace((slot, def, placement) => {
    if (def.waechter.length === 0 || p.isDiscovered(slot.id)) return;
    const chest = placement.markers.findIndex((m) => m.mark === 'truhe');
    if (chest < 0) return;
    const d = (slot.x - home.tx) ** 2 + (slot.y - home.ty) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { slot: slot.id, x: slot.x, y: slot.y, chest };
    }
  });
  const target = best as { slot: number; x: number; y: number; chest: number } | null;
  if (target === null) throw new Error('Fixture-Szenario (Orte): kein Ort mit Truhe und Wächtern');
  run(sim, 'zum Ort', [teleport(target.x, target.y)], SETTLE_TICKS);
  if (!p.isDiscovered(target.slot)) throw new Error('Fixture-Szenario (Orte): der Ort wurde nicht entdeckt');
  const m = p.marker(target.slot, target.chest);
  if (m === undefined) throw new Error('Fixture-Szenario (Orte): Truhenmarke fehlt');
  run(sim, 'an die Truhe', [teleport(m.tx, m.ty + 1)], 2);
  const opened = run(sim, 'Truhe öffnen', [{ type: 'place.use', place: target.slot, marker: target.chest }]);
  if (!opened.has('placeChestOpened')) throw new Error('Fixture-Szenario (Orte): die Truhe ging nicht auf');
  run(sim, 'zur Ortsmitte', [teleport(target.x, target.y)], 2);
  const killed = run(sim, 'Wächter', [{ type: 'creature.kill', radius: GUARD_KILL_TILES }]);
  if (!killed.has('placeCleansed') || !p.isCleansed(target.slot)) throw new Error('Fixture-Szenario (Orte): der Ort wurde nicht gereinigt');
  const marked = run(sim, 'Marker', [{ type: 'map.mark', symbol: 'eigen_5', name: FIXTURE_MARKER_NAME, layer: 0, tx: target.x, ty: target.y }]);
  if (!marked.has('mapMarked')) throw new Error('Fixture-Szenario (Orte): der Marker wurde nicht gesetzt');
  run(sim, 'zurück', [teleport(home.tx, home.ty)], SETTLE_TICKS);
}

/** Facts of the places and the map: every known place with what the player did there, the revealed cells, the own markers. */
export const orteFactsSchema = z
  .object({
    orte: z.array(
      z
        .object({
      slot: z.number().int().min(0),
      type: z.string().min(1),
      discovered: z.boolean(),
      revealedBy: z.string().nullable(),
      /** Chest marks (marker indices) that are open. */
      chestsOpen: z.array(z.number().int().min(0)),
      looted: z.boolean(),
      cleansed: z.boolean(),
      /** Tick part of the guards comes back (−1: none due). */
      returnTick: z.number().int(),
        })
        .strict(),
    ),
    karte: z
      .object({
        /** Revealed map cells of the surface. */
        cells: z.number().int().min(0),
        markers: z.array(z.object({ symbol: z.enum(MAP_MARKER_SYMBOLS), name: z.string(), layer: z.number().int(), tx: z.number().int(), ty: z.number().int() }).strict()),
      })
      .strict(),
  })
  .strict();
export type OrteFacts = z.output<typeof orteFactsSchema>;

/** A world before M7: no place was touched, nothing revealed. */
export const EMPTY_ORTE_FACTS: OrteFacts = { orte: [], karte: { cells: 0, markers: [] } };

/** The known places and the map of `sim`, read through the places and map systems. */
export function orteFacts(sim: Simulation): OrteFacts {
  const p = places(sim);
  const out: OrteFacts['orte'] = [];
  p.forEachKnown((slot, state) => {
    const placement = p.placementOf(slot);
    const def = p.defOf(slot);
    if (placement === undefined || def === undefined) return;
    const chestsOpen: number[] = [];
    placement.markers.forEach((m, i) => {
      if (m.mark === 'truhe' && p.chestOpen(slot, i)) chestsOpen.push(i);
    });
    out.push({ slot, type: def.id, discovered: p.isDiscovered(slot), revealedBy: state.revealedBy, chestsOpen, looted: p.isLooted(slot), cleansed: p.isCleansed(slot), returnTick: state.returnTick });
  });
  const m = map(sim);
  const surface = m.mask(0);
  return {
    orte: out.sort((a, b) => a.slot - b.slot),
    karte: { cells: surface === null ? 0 : countRevealed(surface), markers: m.markers.map((k) => ({ symbol: k.symbol, name: k.name, layer: k.layer, tx: k.tx, ty: k.ty })) },
  };
}
