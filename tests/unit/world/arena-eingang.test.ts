/**
 * M7-89 acceptance "Arena-Vorlage beim Stempeln so drehen, dass ihr Eingang zur verknüpften Leuchtfeuer-Stätte zeigt
 * (ADR-0236) — Unit-Test der Eingangsseite je Drehung" (docs/SPIEL.md §22 "Rand der Arena auf der Seite der Stätte"): the
 * forward transform of a layout cell inverts `layoutCellAt`; the Borkenvater's arena layout (way in at its south edge) is
 * turned so that its mark `eingang` faces the linked beacon site – south → no turn, west → one, north → two, east → three
 * quarter turns clockwise – mirrored or not, and the boss system's way out (`arenaOfSlot`) points to the same side; a site on a
 * diagonal leaves the hash two equally good turns; a slot without a pair keeps its free choice.
 */
import { describe, expect, it } from 'vitest';
import { arenaOfSlot } from '../../../src/game/bosses/arena';
import type { LocationSlot, LocationType } from '../../../src/world/gen/locations';
import { contentPlaceLayouts, layoutCellAt, placeLayout, selectPlaceLayouts, STAMP_ALL, turnedCell, turnedSize, turnsTowards, type StampTest } from '../../../src/world/gen/places';
import type { PlacePlacement, QuarterTurn } from '../../../src/world/gen/places/types';

const ARENA_LAYOUT = 'bossarena_gruenhain_01';
const ALL: StampTest = () => STAMP_ALL;
const TURNS: readonly QuarterTurn[] = [0, 1, 2, 3];
/** Distance of the site from the arena's centre [tiles] (a site's disc, the gap and the arena's disc, docs/WORLD.md). */
const SITE_DISTANCE = 30;
/** Arena centre of the drawn slots [tile]. */
const AT = { x: 300, y: 300 } as const;

function slot(id: number, type: LocationType, x: number, y: number, radius: number, link: number): LocationSlot {
  return { id, type, variant: 'gruenhain', x, y, radius, level: 0, region: 0, biome: 'gruenhain', tier: 0, landmass: 0, link };
}

/** The arena (slot 0) with its site (slot 1) at (dx, dy) × `SITE_DISTANCE` from it, placed by the generator's choice. */
function arenaWithSite(seed: number, dx: number, dy: number): { readonly arena: LocationSlot; readonly site: LocationSlot; readonly p: PlacePlacement } {
  const arena = slot(0, 'bossarena', AT.x, AT.y, 12, 1);
  const site = slot(1, 'leuchtfeuer', AT.x + dx * SITE_DISTANCE, AT.y + dy * SITE_DISTANCE, 6, 0);
  const placements = selectPlaceLayouts(seed, [arena, site], contentPlaceLayouts().values(), [], ALL);
  const p = placements.find((x) => x.slot === arena.id);
  if (p === undefined || p.layout !== ARENA_LAYOUT) throw new Error(`no arena layout placed (seed ${seed})`);
  return { arena, site, p };
}

/** The way in of a placement relative to its slot centre [tiles]. */
function wayIn(p: PlacePlacement, s: LocationSlot): { readonly dx: number; readonly dy: number } {
  const m = p.markers.find((x) => x.mark === 'eingang');
  if (m === undefined) throw new Error(`${p.layout}: no way in`);
  return { dx: m.tx - s.x, dy: m.ty - s.y };
}

describe('Arena-Eingang zur Stätte (M7-89)', () => {
  it('turnedCell is the forward transform of layoutCellAt for every turn and mirroring', () => {
    const l = placeLayout(ARENA_LAYOUT);
    const at = { u: 0, v: 0 };
    for (const r of TURNS) {
      for (const mirror of [false, true]) {
        const { w } = turnedSize(l, r);
        for (let y = 0; y < l.h; y++) {
          for (let x = 0; x < l.w; x++) {
            turnedCell(l, r, mirror, x, y, at);
            expect(layoutCellAt(l, r, mirror, at.u, at.v), `r${r} m${mirror} ${x},${y}`).toBe(y * l.w + x);
            expect(at.u).toBeLessThan(w);
          }
        }
      }
    }
  });

  // Site south of the arena → the layout's own way in (south edge) stays; west → one quarter turn clockwise; north → two; east → three.
  it.each([
    { dir: 'Süden', dx: 0, dy: 1, turn: 0 },
    { dir: 'Westen', dx: -1, dy: 0, turn: 1 },
    { dir: 'Norden', dx: 0, dy: -1, turn: 2 },
    { dir: 'Osten', dx: 1, dy: 0, turn: 3 },
  ])('Stätte im $dir: Drehung $turn, der Eingang liegt am Rand zur Stätte, wie der Ausgang des Boss-Systems', ({ dx, dy, turn }) => {
    for (let seed = 1; seed <= 24; seed++) {
      const { arena, site, p } = arenaWithSite(seed, dx, dy);
      expect(p.rotation, `seed ${seed}`).toBe(turn);
      const e = wayIn(p, arena);
      // On the rim towards the site: along its axis at the layout's half size, across it on the centre line.
      const half = Math.floor((turn % 2 === 0 ? p.height : p.width) / 2);
      expect(dx === 0 ? e.dy : e.dx, `seed ${seed}`).toBe((dx + dy) * half);
      expect(dx === 0 ? e.dx : e.dy, `seed ${seed}`).toBe(0);
      // The boss system opens the arena to the same side (its respawn spot "before the arena").
      const g = arenaOfSlot(arena, site, p);
      expect(Math.sign(Math.round(g.outX)), `seed ${seed}`).toBe(dx);
      expect(Math.sign(Math.round(g.outY)), `seed ${seed}`).toBe(dy);
    }
  });

  it('a site on a diagonal leaves the two turns facing it; the way in never points away', () => {
    const l = placeLayout(ARENA_LAYOUT);
    expect(turnsTowards(l, TURNS, false, 1, 1).sort()).toEqual([0, 3]);
    expect(turnsTowards(l, TURNS, true, -1, -1).sort()).toEqual([1, 2]);
    const seen = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const { arena, p } = arenaWithSite(seed, 1, -1);
      const e = wayIn(p, arena);
      expect(e.dx - e.dy, `seed ${seed}`).toBeGreaterThan(0);
      seen.add(p.rotation);
    }
    expect([...seen].sort()).toEqual([2, 3]);
  });

  it('without a pair (no link, or a link that does not point back) the turn stays the free draw', () => {
    const free = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const lone = slot(0, 'bossarena', AT.x, AT.y, 12, -1);
      const stranger = slot(1, 'leuchtfeuer', AT.x, AT.y + SITE_DISTANCE, 6, -1);
      const half = slot(0, 'bossarena', AT.x, AT.y, 12, 1);
      const a = selectPlaceLayouts(seed, [lone, stranger], contentPlaceLayouts().values(), [], ALL).find((x) => x.slot === 0);
      const b = selectPlaceLayouts(seed, [half, stranger], contentPlaceLayouts().values(), [], ALL).find((x) => x.slot === 0);
      expect(b?.rotation).toBe(a?.rotation);
      free.add(a?.rotation ?? -1);
    }
    expect(free.size).toBe(TURNS.length);
  });
});
