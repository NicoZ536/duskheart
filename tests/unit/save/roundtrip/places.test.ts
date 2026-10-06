/**
 * Save roundtrip of the participant `places` (M7-07; MASTERPROMPT §21 "Zustand (geplündert, gereinigt) wird gespeichert"):
 * discovered and revealed places, opened chests, the cleansing and its return tick, the shrine's rest survive save → load,
 * and a loaded world brings the guards back on the same tick as the uninterrupted one.
 */
import { describe, expect, it } from 'vitest';
import type { PlacesSnapshot } from '../../../../src/game/places/state';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { PLACES, orteWelt, type OrteWelt } from '../../game/orte-testwelt';

const G = PLACES.gehoeft;

/** The farmstead discovered, cleansed and half plundered; the shrine used; the tower revealed by a map. */
function play(w: OrteWelt): void {
  w.goTo(G.x, G.y);
  w.run(1, [{ type: 'creature.kill', radius: 30 }]);
  w.use(G.slot, w.markerIndex(G.slot, 'truhe', 1));
  w.use(PLACES.schrein.slot, w.markerIndex(PLACES.schrein.slot, 'altar'));
  w.places.reveal(w.sim, PLACES.aussichtsturm.slot, 'kartentisch');
  w.goTo(30, 50);
}

describe('save roundtrip: places', () => {
  it('restores discovery, reveal, chests, cleansing, return tick and the shrine’s rest', () => {
    const report = expectRoundtrip(orteWelt, play, (w) => w.places.save);
    expect(report.id).toBe('places');
    const data = JSON.parse(report.canonical) as PlacesSnapshot;
    const farm = data.places.find((p) => p.slot === G.slot);
    expect(farm?.chestsOpened).toBe(0b10);
    expect(farm?.cleansedTick).toBeGreaterThan(0);
    expect(farm?.returnTick).toBeGreaterThan(farm?.cleansedTick ?? 0);
    expect(data.places.find((p) => p.slot === PLACES.aussichtsturm.slot)?.revealedBy).toBe('kartentisch');
    expect(data.places.find((p) => p.slot === PLACES.schrein.slot)?.blessingReadyTick).toBeGreaterThan(0);
  });

  it('save → load → continue: the guards return on the same tick, the chest stays open', () => {
    const a = orteWelt();
    play(a);
    const b = orteWelt();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.places.isCleansed(G.slot)).toBe(true);
    expect(b.places.chestOpen(G.slot, b.markerIndex(G.slot, 'truhe', 1))).toBe(true);
    const due = (a.places.save.serialize() as PlacesSnapshot).places.find((p) => p.slot === G.slot)?.returnTick ?? 0;
    for (const w of [a, b]) w.sim.skipTicks(due - w.sim.tick - 30);
    const ta = a.run(90).get('placeGuardsReturned') as { tick: number }[] | undefined;
    const tb = b.run(90).get('placeGuardsReturned') as { tick: number }[] | undefined;
    expect(ta).toHaveLength(1);
    expect(tb).toEqual(ta);
    expect(b.places.save.serialize()).toEqual(a.places.save.serialize());
    expect(b.rejections(b.use(G.slot, b.markerIndex(G.slot, 'truhe', 1)))).toEqual(['chestOpen']);
  });

  it('the game simulation has the participant (empty at the start)', () => {
    expect(createSimulation({ seed: 3 }).participant('places').serialize()).toEqual({ places: [] });
  });

  it('rejects malformed snapshots and keeps the state it had', () => {
    const w = orteWelt();
    play(w);
    const good = w.places.save.serialize() as PlacesSnapshot;
    const first = good.places[0] as unknown as Record<string, unknown>;
    const bad: unknown[] = [null, { places: 'x' }, { places: [{ ...first, slot: -1 }] }, { places: [first, first] }, { places: [{ ...first, chestsOpened: 1.5 }] }, { places: [{ ...first, revealedBy: 'gerücht' }] }];
    for (const data of bad) expect(() => w.places.save.deserialize(data), JSON.stringify(data)).toThrow(TypeError);
    expect(w.places.save.serialize()).toEqual(good);
  });
});
