/**
 * M4-14 Statik (MASTERPROMPT §16.3): every roof tile needs a support (wall or pillar) within the reach of its
 * material – straw 3, wood 5, stone/brick 6 – counted along carried roof tiles; when a support goes, roof tiles
 * without support collapse with dust and give back 50 % of their material.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { MAX_ROOF_REACH, RoofScratch, roofDistances, roofSupportDistance, unsupportedRoofs, type RoofGrid } from '../../../src/game/building/statics';
import { contentPartCatalog } from '../../../src/world/structures/catalog';
import { bauWelt, type BauWelt } from './bau-testwelt';
import { OFFSET, meadow } from './spieler-testwelt';

/** A roof grid from a picture: digits = roof reach, `#` = support (with roof of reach 5 on it), `|` = support without roof, `.` nothing. */
function picture(rows: readonly string[]): RoofGrid {
  const at = (x: number, y: number): string => rows[y]?.[x] ?? '.';
  return {
    roofReach: (x, y) => {
      const c = at(x, y);
      return c === '#' ? 5 : c >= '1' && c <= '9' ? Number(c) : 0;
    },
    support: (x, y) => at(x, y) === '#' || at(x, y) === '|',
  };
}

describe('Reichweite je Material (§16.3)', () => {
  it('Stroh 3, Holz 5, Stein/Ziegel 6 – aus der Materialtabelle; Glas liegt im Balkenrahmen (5)', () => {
    const m = BALANCE.building.materials;
    expect([m.stroh.roofReach, m.holz.roofReach, m.stein.roofReach, m.glas.roofReach]).toEqual([3, 5, 6, 5]);
    const c = contentPartCatalog();
    expect([c.get('dach_stroh').roofReach, c.get('dach_schindel').roofReach, c.get('dach_glas').roofReach]).toEqual([3, 5, 5]);
    expect(MAX_ROOF_REACH).toBe(6);
  });

  it('Abstand: 0 auf der Stütze, 1 daneben (auch diagonal), dann +1 je getragenem Dachtile', () => {
    const g = picture(['|3333', '.3.33', '.....']);
    const d = roofDistances(g, 0, 0, 5, 3);
    expect([...d.dist.slice(0, 5)]).toEqual([-1, 1, 2, 3, -1]);
    // Diagonal neighbour of the support; the tile at (3,1) is 3 via (2,0); (4,1) would be 4 > 3.
    expect([d.dist[6], d.dist[8], d.dist[9]]).toEqual([1, 3, -1]);
  });

  it('nur getragene Tiles tragen weiter: ein Strohtile außer Reichweite hält kein Steindach dahinter', () => {
    // Straw reaches 3: the fourth tile falls, and the stone tile (6) after it has no other way.
    expect(unsupportedRoofs(picture(['|33336']), 0, 0, 6)).toEqual([4, 0, 5, 0]);
    // A second support behind the stone tile carries it (and the straw tile next to it).
    expect(unsupportedRoofs(picture(['|33336|']), 0, 0, 6)).toEqual([]);
  });

  it('Kette nur über Dachtiles: eine Lücke trennt', () => {
    expect(roofSupportDistance(picture(['|5.5']), 3, 0)).toBe(-1);
    expect(roofSupportDistance(picture(['|555']), 3, 0)).toBe(3);
  });
});

/** Places a roof of `part` on drawn tile (x, y) and returns the refusal (null when placed). */
function roof(w: BauWelt, part: string, x: number, y: number): string | null {
  return w.build(part, x, y);
}

describe('Platzieren mit Stütze (Geister-Vorschau „Keine Stütze in Reichweite“)', () => {
  it('Strohdach bis 3 Tiles von der Wand, Schindeldach bis 5; darüber hinaus „noSupport“', () => {
    const w = bauWelt(meadow(30, 20));
    w.spawn(8, 8);
    expect(w.build('wand_holz', 4, 6)).toBeNull();
    for (const x of [4, 5, 6, 7]) expect(roof(w, 'dach_stroh', x, 6), `stroh ${x}`).toBeNull();
    expect(roof(w, 'dach_stroh', 8, 6)).toBe('noSupport');
    expect(w.count('dach_stroh')).toBe(1);
    // The support overlay reads the distances.
    expect([...w.building.roofSupport(0, OFFSET + 4, OFFSET + 6, 5, 1).dist]).toEqual([0, 1, 2, 3, -1]);
    expect(w.build('wand_holz', 4, 10)).toBeNull();
    for (const x of [5, 6, 7, 8, 9]) expect(roof(w, 'dach_schindel', x, 10), `schindel ${x}`).toBeNull();
    expect(roof(w, 'dach_schindel', 10, 10)).toBe('noSupport');
    // A roof tile far from anything, or over nothing but a fence, has no support either.
    expect(w.build('zaun_holz', 12, 6)).toBeNull();
    expect(roof(w, 'dach_schindel', 12, 6)).toBe('noSupport');
    // A pillar carries like a wall.
    expect(w.build('saeule_holz', 12, 3)).toBeNull();
    expect(roof(w, 'dach_stroh', 12, 4)).toBeNull();
  });

  it('Blaupausen-Dächer dürfen auf geplante Stützen; fertigstellen verlangt echte Stützen', () => {
    const w = bauWelt(meadow(30, 20));
    w.spawn(8, 8);
    w.act({ type: 'build.blueprint', part: 'wand_holz', tx: OFFSET + 4, ty: OFFSET + 6 });
    expect(w.rejection(w.act({ type: 'build.blueprint', part: 'dach_stroh', tx: OFFSET + 5, ty: OFFSET + 6 }))).toBeNull();
    w.inventory.give(w.sim, 'steinhammer', 1);
    w.act({ type: 'player.selectHotbar', index: w.inventory.state.schnellleiste.findIndex((s) => s?.item === 'steinhammer') });
    w.inventory.give(w.sim, 'dach_stroh', 1);
    expect(w.rejection(w.act({ type: 'build.complete', tx: OFFSET + 5, ty: OFFSET + 6, ebene: 'dach' }))).toBe('noSupport');
    w.inventory.give(w.sim, 'wand_holz', 1);
    expect(w.rejection(w.act({ type: 'build.complete', tx: OFFSET + 4, ty: OFFSET + 6 }))).toBeNull();
    expect(w.rejection(w.act({ type: 'build.complete', tx: OFFSET + 5, ty: OFFSET + 6, ebene: 'dach' }))).toBeNull();
  });
});

describe('Einsturz (§16.3: Staub, 50 % Material zurück)', () => {
  it('fällt die Stütze, stürzen die ungestützten Dachtiles ein – Ereignisse, Staub-Tiles, halbes Material als Beute', () => {
    const w = bauWelt(meadow(30, 20));
    w.spawn(8, 8);
    expect(w.build('wand_holz', 4, 6)).toBeNull();
    for (const x of [5, 6, 7]) expect(roof(w, 'dach_stroh', x, 6)).toBeNull();
    // A second hut nearby with its own wall stays up.
    expect(w.build('wand_holz', 12, 6)).toBeNull();
    expect(roof(w, 'dach_stroh', 11, 6)).toBeNull();
    const events = w.act({ type: 'build.remove', tx: OFFSET + 4, ty: OFFSET + 6 });
    const collapsed = events.get('roofCollapsed') as Array<{ tiles: number[]; x: number; y: number }>;
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.tiles).toEqual([OFFSET + 5, OFFSET + 6, OFFSET + 6, OFFSET + 6, OFFSET + 7, OFFSET + 6]);
    expect(collapsed[0]?.x).toBe((OFFSET + 6.5) * 16);
    const removed = (events.get('partRemoved') ?? []) as Array<{ part: string; reason: string; refund: string }>;
    expect(removed.filter((r) => r.reason === 'eingestuerzt').map((r) => r.part)).toEqual(['dach_stroh', 'dach_stroh', 'dach_stroh']);
    for (const x of [5, 6, 7]) expect(w.building.roofed(0, OFFSET + x, OFFSET + 6)).toBe(false);
    expect(w.building.roofed(0, OFFSET + 11, OFFSET + 6)).toBe(true);
    // Straw roof = 2 bundles + 2 twigs; three tiles at 50 % ⇒ 3 + 3, dropped where the roof came down.
    expect(w.dropped.map((d) => [d.stack.item, d.stack.count])).toEqual([
      ['strohbuendel', 3],
      ['zweig', 3],
    ]);
  });

  it('Schaden (Feuer, Schattenflut): Trefferpunkte sinken, bei 0 ist das Teil zerstört – ohne Rückgabe, das Dach stürzt ein', () => {
    const w = bauWelt(meadow(30, 20));
    w.spawn(8, 8);
    expect(w.build('wand_holz', 4, 6)).toBeNull();
    expect(roof(w, 'dach_stroh', 5, 6)).toBeNull();
    const tx = OFFSET + 4;
    const ty = OFFSET + 6;
    expect(w.building.damage(w.sim, 0, 'struktur', tx, ty, 120)).toBe(180);
    expect(w.building.structures.hp(0, 1, tx, ty)).toBe(180);
    expect(w.building.damage(w.sim, 0, 'struktur', tx, ty, 500)).toBe(0);
    // The events of the damage are drained with the next tick.
    const events = w.act();
    expect((events.get('partDamaged') as Array<{ hp: number }>).map((e) => e.hp)).toEqual([180, 0]);
    expect((events.get('partRemoved') as Array<{ part: string; reason: string; refund: string }>).map((e) => [e.part, e.reason, e.refund])).toEqual([
      ['wand_holz', 'zerstoert', 'keine'],
      ['dach_stroh', 'eingestuerzt', 'anteilig'],
    ]);
    expect(w.building.partAt(0, 'struktur', tx, ty)).toBeUndefined();
    expect(w.building.roofed(0, tx + 1, ty)).toBe(false);
    expect(w.building.damage(w.sim, 0, 'struktur', tx, ty, 1)).toBe(-1);
    expect(w.count('wand_holz')).toBe(0);
  });

  it('entferntes Dachtile in der Kette: die dahinter liegenden stürzen ein, die davor bleiben', () => {
    const w = bauWelt(meadow(30, 20));
    w.spawn(8, 8);
    expect(w.build('wand_holz', 4, 6)).toBeNull();
    for (const x of [5, 6, 7]) expect(roof(w, 'dach_stroh', x, 6)).toBeNull();
    const events = w.act({ type: 'build.remove', tx: OFFSET + 6, ty: OFFSET + 6, ebene: 'dach' });
    expect((events.get('roofCollapsed') as Array<{ tiles: number[] }>)[0]?.tiles).toEqual([OFFSET + 7, OFFSET + 6]);
    expect(w.building.roofed(0, OFFSET + 5, OFFSET + 6)).toBe(true);
  });

  it('ein Dach wird nur zu einem besseren mit mindestens derselben Reichweite aufgewertet; Schindel → Stroh ist eine Abwertung', () => {
    // Review M4 #9: upgrading follows the §16.2 order of materials, so the shorter straw reach can no longer replace
    // shingles (formerly refused only where the straw tile would not be carried) – and no upgrade shortens a reach.
    const w = bauWelt(meadow(30, 20));
    w.spawn(8, 8);
    expect(w.build('wand_holz', 4, 10)).toBeNull();
    for (const x of [5, 6, 7, 8]) expect(roof(w, 'dach_schindel', x, 10)).toBeNull();
    w.inventory.give(w.sim, 'dach_stroh', 1);
    expect(w.rejection(w.act({ type: 'build.upgrade', tx: OFFSET + 8, ty: OFFSET + 10, part: 'dach_stroh' }))).toBe('notUpgradable');
    expect(w.rejection(w.act({ type: 'build.upgrade', tx: OFFSET + 6, ty: OFFSET + 10, part: 'dach_stroh' }))).toBe('notUpgradable');
    // Straw → shingles is an upgrade: the longer reach carries on.
    expect(roof(w, 'dach_stroh', 3, 10)).toBeNull();
    w.inventory.give(w.sim, 'dach_schindel', 1);
    expect(w.rejection(w.act({ type: 'build.upgrade', tx: OFFSET + 3, ty: OFFSET + 10, part: 'dach_schindel' }))).toBeNull();
    for (const x of [3, 5, 6, 7, 8]) expect(w.building.roofed(0, OFFSET + x, OFFSET + 10)).toBe(true);
  });

  it('RoofScratch: dieselben Abstände wie ohne, die Puffer werden wiederverwendet (Vorschau je Bild, review M4 #20)', () => {
    const g = picture(['|5555..', '..55|55']);
    const scratch = new RoofScratch();
    const fresh = roofDistances(g, 0, 0, 7, 2);
    const a = roofDistances(g, 0, 0, 7, 2, scratch);
    expect([...a.dist.subarray(0, 14)]).toEqual([...fresh.dist]);
    const buffer = a.dist;
    const b = roofDistances(g, 1, 0, 5, 2, scratch);
    expect(b.dist).toBe(buffer);
    expect([...b.dist.subarray(0, 10)]).toEqual([...roofDistances(g, 1, 0, 5, 2).dist]);
  });
});
