/**
 * Save roundtrip of the participant `spoilage` (M7-29, docs/SPIEL.md §21, §27): the hour spoiled to, the frozen chunks with
 * their stamps and the places of their containers, and the chunks caught up ahead survive save → load; a loaded world spoils
 * on bit-identically – also the frozen chunk catching up after the load.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { CHUNK_SHIFT } from '../../../../src/world/model/coords';
import { kuecheWelt, type KuecheWelt } from '../../game/kueche-testwelt';
import { OFFSET } from '../../game/spieler-testwelt';

/** A store barrel in a store room and a chest of food in another chunk, which freezes after five hours. */
function welt(): KuecheWelt {
  const w = kuecheWelt();
  w.spawn(10, 10);
  w.run(1);
  const fass = w.container('vorratsfass', 3, 3);
  w.room(3, 3, 'lager');
  fass.slots[0] = w.stack('eintopf', 2);
  const fern = w.container('kiste', 40, 3);
  fern.slots[0] = w.stack('brot', 1);
  fern.slots[1] = w.stack('trockenfleisch', 3);
  return w;
}

function fernChunk(w: KuecheWelt) {
  const chunk = w.chunks.get(0, (OFFSET + 40) >> CHUNK_SHIFT, (OFFSET + 3) >> CHUNK_SHIFT);
  if (chunk === undefined) throw new Error('no chunk');
  return chunk;
}

function gelagert(w: KuecheWelt): void {
  w.hours(5);
  const chunk = fernChunk(w);
  w.frozen.add(`0:${chunk.cx}:${chunk.cy}`);
  w.spoilage.zoneListener.onDeactivate?.(chunk, w.sim.tick);
  w.hours(3);
}

const frische = (w: KuecheWelt): number[] => w.containers.flatMap((c) => c.slots.map((s) => s?.frische ?? -1));

describe('save roundtrip: spoilage', () => {
  it('restores the stamp, the frozen chunk with its kept places', () => {
    const report = expectRoundtrip(welt, gelagert, (w) => w.spoilage.save);
    expect(report.id).toBe('spoilage');
    const data = JSON.parse(report.canonical) as { lastHour: number; frozen: Array<{ stamp: number; behaelter: unknown[] }> };
    expect(data.lastHour).toBe(8);
    expect(data.frozen).toEqual([expect.objectContaining({ stamp: 5, behaelter: [['test:1', 1, false, true]] })]);
  });

  it('save → load → weiter: Taschen, aktive und aufgeholte Behälter bitgleich', () => {
    const a = welt();
    gelagert(a);
    const b = welt();
    // The containers' stacks are the storage participant's – carried over by hand here; the clock by the sim's participant.
    b.sim.participant('clock').deserialize(structuredClone(a.sim.participant('clock').serialize()));
    b.spoilage.save.deserialize(structuredClone(a.spoilage.save.serialize()));
    for (let i = 0; i < a.containers.length; i++) (b.containers[i] as { slots: unknown[] }).slots.splice(0, Infinity, ...structuredClone((a.containers[i] as { slots: unknown[] }).slots));
    for (const k of a.frozen) b.frozen.add(k);
    for (const w of [a, b]) {
      w.hours(20);
      const chunk = fernChunk(w);
      w.spoilage.catchUp(chunk, 0, w.sim.tick);
      w.frozen.clear();
      w.hours(2);
    }
    expect(frische(b)).toEqual(frische(a));
    expect(b.spoilage.save.serialize()).toEqual(a.spoilage.save.serialize());
  });

  it('the game simulation has the participant (no hour yet); saves before the kitchen migrate', () => {
    const sim = createSimulation({ seed: 3 });
    expect(sim.participant('spoilage').serialize()).toEqual({ lastHour: -1, frozen: [], ahead: [] });
    expect(sim.participant('spoilage').migrations?.[0]?.migrate({})).toEqual({ lastHour: -1, frozen: [], ahead: [] });
  });
});
