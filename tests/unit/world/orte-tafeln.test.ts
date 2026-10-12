/**
 * M7-96 acceptance "Erbauer-Tafeln `tafel_08` … `tafel_10` an Orten … Unit-Test: jede Tafel ist an einer Marke lesbar"
 * (docs/SPIEL.md §18 "tafel", §19 "Erbauer-Tafeln"; ADR-0247): every tablet whose find spot is a place type stands in every
 * layout of that type – the Builder tablet (`ort_erbauer_tafel`) on a second mark `tafel` whose data is the tablet's id, inside
 * the slot disc, the place's own note keeps its mark – and in a generated world (seed 3, Klein) E at that mark reads the tablet
 * (`tabletRead` with the place as find spot), while the note's mark still reads the note.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import type { TabletDef } from '../../../src/content/dungeons/schema';
import type { PlaceLayoutDef } from '../../../src/content/places/schema';
import type { GameCommand } from '../../../src/game/commands';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import { LOCATION_RULES, type LocationType } from '../../../src/world/gen/locations';
import { compileLayout, placementOf, STAMP_ALL } from '../../../src/world/gen/places';
import type { PlacePlacement } from '../../../src/world/gen/places/types';
import { TILE_PX } from '../../../src/world/model/coords';

/** The world object a tablet stands as (src/content/dungeons/objekte.ts). */
const TABLET_OBJECT = 'ort_erbauer_tafel';

/** The tablets found at places (find spot `ort`), with their place type. */
function placeTablets(): { readonly id: string; readonly ortstyp: string }[] {
  const out: { id: string; ortstyp: string }[] = [];
  for (const t of CONTENT.collection('tablets').values() as readonly TabletDef[]) if (t.fundort.art === 'ort') out.push({ id: t.id, ortstyp: t.fundort.ortstyp });
  return out;
}

/** Runs one tick with `commands`; returns the events of that tick by type. */
function tick(sim: Simulation, commands: readonly GameCommand[]): Map<string, unknown[]> {
  const out = new Map<string, unknown[]>();
  sim.step(commands);
  sim.events.drain((type, payload) => {
    const list = out.get(type) ?? [];
    list.push(payload);
    out.set(type, list);
  });
  return out;
}

/** Stands beside marker `marker` of `p` (the tile south of it) and uses it with E (`place.use`); the events of that tick. */
function useMark(sim: Simulation, p: PlacePlacement, marker: number): Map<string, unknown[]> {
  const m = p.markers[marker];
  if (m === undefined) throw new Error(`placement ${p.layout} @${p.slot} has no marker ${marker}`);
  tick(sim, [{ type: 'player.teleport', x: (m.tx + 0.5) * TILE_PX, y: (m.ty + 1.5) * TILE_PX, layer: 0 }]);
  return tick(sim, [{ type: 'place.use', place: p.slot, marker }]);
}

describe('Erbauer-Tafeln an Orten (M7-96)', () => {
  it('jede Tafel mit Fundort Ort steht in jeder Vorlage ihres Ortstyps an einer Marke tafel, die ihre Id trägt', () => {
    const tablets = placeTablets();
    expect(tablets.map((t) => t.id).sort()).toEqual(['tafel_08', 'tafel_09', 'tafel_10']);
    const layouts = CONTENT.collection('placeLayouts').values() as readonly PlaceLayoutDef[];
    for (const t of tablets) {
      const own = layouts.filter((l) => l.ortstyp === t.ortstyp);
      expect(own.length, t.ortstyp).toBeGreaterThan(0);
      for (const def of own) {
        const layout = compileLayout(def);
        const radius = LOCATION_RULES[t.ortstyp as LocationType]?.radius ?? 0;
        // The placement of the unturned layout around a slot centre (the generator's choice for a layout that is not turned).
        const slot = { id: 0, type: t.ortstyp as LocationType, variant: '', x: 100, y: 100, radius, level: 0, region: 0, biome: def.biom, tier: 0, landmass: 0, link: -1 };
        const p = placementOf(slot, layout, 0, false, slot.x - Math.floor(layout.w / 2), slot.y - Math.floor(layout.h / 2), () => STAMP_ALL);
        const marks = p.markers.filter((m) => m.mark === 'tafel');
        // The place's own note (data empty) and exactly one tablet – this one.
        expect(marks.map((m) => m.data).sort(), def.id).toEqual(['', t.id]);
        const m = marks.find((x) => x.data === t.id);
        if (m === undefined) throw new Error(`${def.id}: no mark for ${t.id}`);
        const cell = (m.ty - p.y0) * layout.w + (m.tx - p.x0);
        expect(layout.object[cell], `${def.id}: object at ${t.id}`).toBe(TABLET_OBJECT);
        expect((m.tx - slot.x) ** 2 + (m.ty - slot.y) ** 2, `${def.id}: ${t.id} in the disc`).toBeLessThanOrEqual(radius * radius);
      }
    }
  });

  it(
    'in einer Welt liest E an der Tafel-Marke die Tafel (tabletRead), die Notiz des Ortes bleibt lesbar',
    () => {
      const sim = createSimulation({ seed: 3, worldSize: 'small' });
      tick(sim, [{ type: 'player.spawn' }]);
      const placements = sim.world.generated.placeLayouts;
      for (const t of placeTablets()) {
        const p = placements.find((x) => x.type === t.ortstyp && x.markers.some((m) => m.mark === 'tafel' && m.data === t.id));
        if (p === undefined) throw new Error(`world seed 3: no ${t.ortstyp} with ${t.id}`);
        const tablet = p.markers.findIndex((m) => m.mark === 'tafel' && m.data === t.id);
        const read = useMark(sim, p, tablet);
        expect(read.get('commandRejected'), `${t.id}`).toBeUndefined();
        expect(read.get('tabletRead'), `${t.id}`).toEqual([expect.objectContaining({ tablet: t.id, quelle: 'ort', ort: p.slot })]);
        expect(read.get('placeNoteRead')).toBeUndefined();
        const note = p.markers.findIndex((m) => m.mark === 'tafel' && m.data === '');
        const noted = useMark(sim, p, note);
        expect(noted.get('placeNoteRead'), `${t.ortstyp} note`).toEqual([expect.objectContaining({ place: p.slot, ortstyp: t.ortstyp })]);
        expect(noted.get('tabletRead')).toBeUndefined();
      }
    },
    30_000,
  );
});
