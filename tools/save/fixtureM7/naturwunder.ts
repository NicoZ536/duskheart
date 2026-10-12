/**
 * Contribution of strand V4 (Bilder & Oberfläche, M7-122) to the reference save of save version 4 (docs/SPIEL.md §27, §18
 * "Naturwunder"): a natural wonder discovered, so the diary keeps the wonder's variant beside its type (`zusatz` of the
 * chronicle rule `chronik_ort_entdeckt` – the chronicle names it "Entdeckt: Geysirfeld."), made by commands only, and its facts
 * for the migration test – read through the public APIs of the places and the chronicle (`PlacesSystem`,
 * `ChronicleSystem.entries`), never from the snapshot layout.
 *
 * `playNaturwunder(sim)` goes to the natural wonder nearest the player (the fixture world, seed 3 small, has one of each
 * variant), waits there until it is discovered and returns the player to where they stood.
 * Use (integrator, tools/save/fixture.ts): right after `playOrte(sim)` (both visit places and come back), and
 * `naturwunderFacts(sim)` beside `saveFacts` (field `naturwunder`). Fixtures of versions 1–3 load with
 * `EMPTY_NATURWUNDER_FACTS` (no place was discovered before M7; the participant `chronicle` migrates from 0 to an empty diary).
 */
import { z } from 'zod';
import { ChronicleSystem } from '../../../src/game/chronicle/system';
import type { GameCommand } from '../../../src/game/commands';
import { PlacesSystem } from '../../../src/game/places/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import type { Simulation } from '../../../src/game/sim';
import { TILE_PX } from '../../../src/world/model/coords';

/** Ticks for the zone to stream the chunks around a teleport target (as the places part, fixtureM7/orte.ts). */
const SETTLE_TICKS = 30;
/** The chronicle rule of a discovery (src/content/chronik/orte.ts). */
const DISCOVERY_RULE = 'chronik_ort_entdeckt';

function places(sim: Simulation): PlacesSystem {
  const p = sim.system('places');
  if (!(p instanceof PlacesSystem)) throw new Error('naturwunder: die Simulation hat kein System places');
  return p;
}

function chronicle(sim: Simulation): ChronicleSystem {
  const c = sim.system('chronicle');
  if (!(c instanceof ChronicleSystem)) throw new Error('naturwunder: die Simulation hat kein System chronicle');
  return c;
}

/** Runs `commands` then `ticks − 1` more ticks; throws if a command was refused. */
function run(sim: Simulation, what: string, commands: readonly GameCommand[], ticks: number): void {
  const refused: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? commands : undefined);
    sim.events.drain((type, payload) => {
      if (type === 'commandRejected') refused.push(JSON.stringify(payload));
    });
  }
  if (refused.length > 0) throw new Error(`Fixture-Szenario (Naturwunder): ${what} abgelehnt: ${refused.join(', ')}`);
}

function teleport(tx: number, ty: number): GameCommand {
  return { type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 0.5) * TILE_PX, layer: 0 };
}

/** Plays the natural-wonder part of the reference save (see module comment); throws if the wonder was not discovered. */
export function playNaturwunder(sim: Simulation): void {
  const p = places(sim);
  const player = sim.system('player') as PlayerSystem;
  const at = { x: 0, y: 0 };
  if (!player.position(sim, at)) throw new Error('Fixture-Szenario (Naturwunder): kein Spieler');
  const home = { tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) };
  let best: { slot: number; x: number; y: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  p.forEachPlace((slot, def) => {
    if (def.id !== 'naturwunder' || p.isDiscovered(slot.id)) return;
    const d = (slot.x - home.tx) ** 2 + (slot.y - home.ty) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { slot: slot.id, x: slot.x, y: slot.y };
    }
  });
  const target = best as { slot: number; x: number; y: number } | null;
  if (target === null) throw new Error('Fixture-Szenario (Naturwunder): die Welt hat kein Naturwunder');
  run(sim, 'zum Naturwunder', [teleport(target.x, target.y)], SETTLE_TICKS);
  if (!p.isDiscovered(target.slot)) throw new Error('Fixture-Szenario (Naturwunder): das Naturwunder wurde nicht entdeckt');
  run(sim, 'zurück', [teleport(home.tx, home.ty)], SETTLE_TICKS);
}

/** Facts: every discovered natural wonder with its slot variant and the variant its diary entry keeps (null: none). */
export const naturwunderFactsSchema = z
  .object({
    wunder: z.array(z.object({ slot: z.number().int().min(0), variante: z.string().min(1), chronik: z.string().min(1).nullable() }).strict()),
  })
  .strict();
export type NaturwunderFacts = z.output<typeof naturwunderFactsSchema>;

/** A world before M7: no place was discovered. */
export const EMPTY_NATURWUNDER_FACTS: NaturwunderFacts = { wunder: [] };

/** The discovered natural wonders of `sim` and the variants of their diary entries, read through places and chronicle. */
export function naturwunderFacts(sim: Simulation): NaturwunderFacts {
  const p = places(sim);
  const kept: string[] = [];
  for (const e of chronicle(sim).entries()) {
    if (e.rule !== DISCOVERY_RULE || e.values.ortstyp !== 'naturwunder') continue;
    const v = e.values.variante;
    if (typeof v === 'string') kept.push(v);
  }
  const wunder: NaturwunderFacts['wunder'] = [];
  p.forEachPlace((slot, def) => {
    if (def.id !== 'naturwunder' || !p.isDiscovered(slot.id)) return;
    wunder.push({ slot: slot.id, variante: slot.variant, chronik: kept.includes(slot.variant) ? slot.variant : null });
  });
  return { wunder };
}
