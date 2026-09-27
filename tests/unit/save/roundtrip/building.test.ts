/**
 * Save roundtrip of the participant `building` (M4-11 … M4-14): the structure layers – walls, a door left open, a
 * gate, floors, roofs, furniture across tiles, wall furniture, a blueprint – with their hit points, and the placing
 * ticks of the last 30 s (the full refund). A loaded world collides, recognises its rooms and refunds exactly like
 * the uninterrupted one.
 */
import { describe, expect, it } from 'vitest';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { BLOCK_SOLID } from '../../../../src/world/collision/tiles';
import { bauWelt, hut, type BauWelt } from '../../game/bau-testwelt';
import { OFFSET, meadow } from '../../game/spieler-testwelt';

/** A furnished house with an open door, a gate, a floor, a blueprint and a picture. */
function homestead(w: BauWelt): void {
  w.spawn(10, 10);
  hut(w, 9, 9, 12, 11);
  for (const [part, x, y] of [
    ['boden_holz', 9, 9],
    ['probe_moebel_bett', 12, 10],
    ['probe_moebel_lampe', 9, 11],
    ['probe_moebel_bild', 10, 9],
    ['tor_holz', 15, 12],
  ] as const) {
    const r = w.build(part, x, y);
    if (r !== null) throw new Error(`${part}: ${r}`);
  }
  w.act({ type: 'build.door', tx: OFFSET + 10, ty: OFFSET + 12 });
  w.act({ type: 'build.blueprint', part: 'wand_stein', tx: OFFSET + 16, ty: OFFSET + 9 });
}

describe('save roundtrip: building', () => {
  it('restores every structure layer, hit points, open doors, blueprints and the recent placing ticks', () => {
    const report = expectRoundtrip(
      () => bauWelt(meadow(24, 24)),
      (w) => homestead(w),
      (w) => w.sim.participant('building'),
    );
    expect(report.id).toBe('building');
    const data = JSON.parse(report.canonical) as { structures: { ids: string[]; cells: number[] }; recent: number[][] };
    expect(data.structures.ids).toEqual(['boden_holz', 'dach_stroh', 'probe_moebel_bett', 'probe_moebel_bild', 'probe_moebel_lampe', 'tor_holz', 'tuer_holz', 'wand_holz', 'wand_stein']);
    // 17 walls and the door, 30 roof tiles, a floor, the bed (2 tiles), the lamp, the picture, the gate (2 tiles), the blueprint.
    expect(data.structures.cells.length / 7).toBe(18 + 30 + 1 + 2 + 1 + 1 + 2 + 1);
    // Placing ticks of the finished anchors (not the blueprint).
    expect(data.recent.length).toBe(18 + 30 + 1 + 1 + 1 + 1 + 1);
  });

  it('save → load → continue: the same buildings, collision, rooms, refunds and hash as the uninterrupted run', () => {
    const a = bauWelt(meadow(24, 24));
    homestead(a);
    const b = bauWelt(meadow(24, 24));
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    // Collision: the closed wall and the open door.
    for (const w of [a, b]) {
      expect(w.collision.grid.tileInfo(0, OFFSET + 8, OFFSET + 10) & BLOCK_SOLID).not.toBe(0);
      expect(w.collision.grid.tileInfo(0, OFFSET + 10, OFFSET + 12) & BLOCK_SOLID).toBe(0);
    }
    expect(b.roomAt(10, 10)?.type?.id).toBe(a.roomAt(10, 10)?.type?.id);
    expect(b.roomAt(10, 10)?.comfort).toEqual(a.roomAt(10, 10)?.comfort);
    // Dismantling right away still gives the part back whole in both.
    for (const w of [a, b]) {
      const events = w.act({ type: 'build.remove', tx: OFFSET + 9, ty: OFFSET + 9, ebene: 'boden' });
      expect(events.get('partRemoved')).toEqual([expect.objectContaining({ part: 'boden_holz', refund: 'ganz' })]);
    }
    a.run(200);
    b.run(200);
    expect(b.sim.participant('building').serialize()).toEqual(a.sim.participant('building').serialize());
    expect(b.sim.hashState()).toBe(a.sim.hashState());
  });

  it('a save from before building (no data, version 0) loads with no buildings', () => {
    const p = bauWelt(meadow(4, 4)).sim.participant('building');
    const initial = p.migrations?.find((m) => m.from === 0)?.migrate(undefined);
    expect(initial).toBeDefined();
    const fresh = bauWelt(meadow(4, 4)).sim.participant('building');
    p.deserialize(initial);
    expect(p.serialize()).toEqual(fresh.serialize());
  });

  it('rejects malformed snapshots and parts that no longer exist', () => {
    const p = bauWelt(meadow(4, 4)).sim.participant('building');
    expect(() => p.deserialize(null)).toThrow(TypeError);
    expect(() => p.deserialize({ structures: { ids: ['gibt_es_nicht'], cells: [0, 1, 70, 70, 0, 0, 10] }, recent: [] })).toThrow(/gibt_es_nicht/);
    expect(() => p.deserialize({ structures: { ids: ['wand_holz'], cells: [0, 9, 70, 70, 0, 0, 10] }, recent: [] })).toThrow(TypeError);
    expect(() => p.deserialize({ structures: { ids: ['wand_holz'], cells: [0, 1, 70, 70, 0, 0, 10, 0, 1, 70, 70, 0, 0, 10] }, recent: [] })).toThrow(/twice/);
    expect(() => p.deserialize({ structures: { ids: [], cells: [] }, recent: [[0, 1, 70, 70, 5]] })).toThrow(/empty cell/);
    // A covered tile without its anchor.
    expect(() => p.deserialize({ structures: { ids: ['tor_holz'], cells: [0, 1, 71, 70, 0, (1 << 17) | (1 << 18), 0] }, recent: [] })).toThrow(/anchor/);
  });
});
