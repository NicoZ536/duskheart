/**
 * M7-01 Audio-Graph (MASTERPROMPT §27 "Master → Busse …; Kompressor/Limiter; räumliches Panning + Distanzdämpfung;
 * Tiefpass bei Verdeckung; Hall per Convolution mit prozedural erzeugten Impulsantworten (Höhle, Innenraum, Halle)"):
 *
 * - the buses' reverb sends (the UI stays dry, the sends behind the bus faders), the A/B convolver crossfade between rooms;
 * - the procedural impulses: the same bits for the same seed, the decay of their room (RT60 measured by Schroeder
 *   integration), decorrelated stereo, the cave darker than the hall, unit energy;
 * - the room of the listener (cave layer, house, great room, vault, open sky);
 * - occlusion on a drawn world: rock and built walls between listener and sound, a roof between them, open ground;
 * - the voices' chain: positioned → gain → occlusion low-pass → panner → bus; a muffled sound of the listener gets the
 *   low-pass too.
 */
import { describe, expect, it } from 'vitest';
import { AudioMixer, REVERB_BUSES, busGains } from '../../../src/audio/mixer';
import { MAX_RAY_TILES, ROOF_OCCLUSION, SoundOcclusion, WALL_OCCLUSION } from '../../../src/audio/occlusion';
import { HALLE_MIN_TILES, REVERB_CROSSFADE_SECONDS, REVERB_SPECS, generateImpulse, impulseLength, reverbRoomFor, type ReverbRoom } from '../../../src/audio/reverb';
import { RoomProbe, createRoomSituation } from '../../../src/audio/roomProbe';
import { SfxPlayer } from '../../../src/audio/sfxPlayer';
import { CLOSED_CUTOFF_HZ, OPEN_CUTOFF_HZ, occlusionCutoffHz } from '../../../src/audio/spatial';
import { SFX_PRESETS } from '../../../src/content/sfx/index';
import { defaultSettings } from '../../../src/engine/settings';
import { TILE_PX } from '../../../src/world/model/coords';
import { bauWelt, hut } from '../game/bau-testwelt';
import { meadow, testWorld } from '../game/spieler-testwelt';
import { FakeContext, type FakeConvolver, type FakeFilter, type FakeGain, type FakeNode, chainOf } from './fakeAudio';

/** Sample rate of the impulse measurements (low: the test stays fast; the decay does not depend on it). */
const SR = 16000;

/** RT60 of an impulse by Schroeder backward integration: the −5 … −25 dB slope extrapolated to −60 dB [s]. */
function rt60(ir: Float32Array, sampleRate: number): number {
  const n = ir.length;
  const edc = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) {
    acc += (ir[i] as number) ** 2;
    edc[i] = acc;
  }
  const total = edc[0] as number;
  const db = (i: number): number => 10 * Math.log10((edc[i] as number) / total);
  let i5 = 0;
  while (i5 < n && db(i5) > -5) i5++;
  let i25 = i5;
  while (i25 < n && db(i25) > -25) i25++;
  return ((i25 - i5) / sampleRate) * 3;
}

/** Share of the high band in the late tail: energy of the first difference over the energy of the signal. */
function brightness(ir: Float32Array, from: number): number {
  let hi = 0;
  let all = 0;
  for (let i = from + 1; i < ir.length; i++) {
    hi += ((ir[i] as number) - (ir[i - 1] as number)) ** 2;
    all += (ir[i] as number) ** 2;
  }
  return hi / all;
}

function correlation(a: Float32Array, b: Float32Array, from: number): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = from; i < a.length; i++) {
    ab += (a[i] as number) * (b[i] as number);
    aa += (a[i] as number) ** 2;
    bb += (b[i] as number) ** 2;
  }
  return ab / Math.sqrt(aa * bb);
}

describe('Hall-Sends und Raumwechsel', () => {
  it('Effekte, Umgebung und Musik senden in den Hall, die UI bleibt trocken; die Sends stehen hinter den Busreglern', () => {
    const ctx = new FakeContext();
    const mixer = new AudioMixer(ctx, busGains(defaultSettings().audio));
    expect(REVERB_BUSES).toEqual(['effekte', 'umgebung', 'musik']);
    for (const bus of REVERB_BUSES) {
      const node = mixer.bus[bus] as FakeGain;
      // First the dry path (compressor → limiter → master), then the send into the reverb's input.
      expect(chainOf(node)).toEqual(['gain', 'compressor', 'compressor', 'gain', 'destination']);
      expect(node.outputs[1]).toBe(mixer.send[bus]);
      expect((mixer.send[bus] as FakeGain).outputs[0]).toBe(mixer.reverb.input);
      expect(mixer.send[bus].gain.value).toBe(0);
    }
    expect((mixer.bus.ui as FakeGain).outputs).toHaveLength(1);
    // Under the open sky nothing reverberates: no convolver yet.
    expect(ctx.convolvers).toHaveLength(0);
    expect(mixer.reverb.room).toBeNull();
  });

  it('ein Raum lädt seine Impulsantwort in den freien Slot und blendet über; die Sends gleiten auf die Pegel des Raums', () => {
    const ctx = new FakeContext();
    const mixer = new AudioMixer(ctx, busGains(defaultSettings().audio));
    ctx.currentTime = 2;
    mixer.setRoom('hoehle');
    expect(ctx.convolvers).toHaveLength(1);
    const cave = ctx.convolvers[0] as FakeConvolver;
    expect(cave.normalize).toBe(false);
    expect(cave.buffer?.numberOfChannels).toBe(2);
    expect(cave.buffer?.length).toBe(impulseLength('hoehle', ctx.sampleRate));
    // Convolver → wet gain → compressor → limiter → master → destination.
    expect(chainOf(cave)).toEqual(['convolver', 'gain', 'compressor', 'compressor', 'gain', 'destination']);
    const wetA = mixer.reverb.wet(0).gain as FakeGain['gain'];
    expect(wetA.calls.at(-1)).toEqual({ kind: 'target', value: 1, time: 2 });
    for (const bus of REVERB_BUSES) expect(mixer.send[bus].gain.value).toBeCloseTo(REVERB_SPECS.hoehle.sends[bus]);
    expect(mixer.send.musik.gain.value).toBe(0);
    // Into a house: the cave fades out of slot A, the house fades into slot B.
    ctx.currentTime = 5;
    mixer.setRoom('innenraum');
    expect(ctx.convolvers).toHaveLength(2);
    const house = ctx.convolvers[1] as FakeConvolver;
    expect(house.buffer?.length).toBe(impulseLength('innenraum', ctx.sampleRate));
    expect(house.outputs[0]).toBe(mixer.reverb.wet(1));
    expect(wetA.calls.at(-1)).toEqual({ kind: 'target', value: 0, time: 5 });
    expect((mixer.reverb.wet(1).gain as FakeGain['gain']).calls.at(-1)).toEqual({ kind: 'target', value: 1, time: 5 });
    expect(mixer.send.effekte.gain.value).toBeCloseTo(REVERB_SPECS.innenraum.sends.effekte);
    // Back into the cave: slot A still holds it – no new convolver, the house fades out.
    ctx.currentTime = 9;
    mixer.setRoom('hoehle');
    expect(ctx.convolvers).toHaveLength(2);
    expect(wetA.calls.at(-1)).toEqual({ kind: 'target', value: 1, time: 9 });
    expect((mixer.reverb.wet(1).gain as FakeGain['gain']).calls.at(-1)).toEqual({ kind: 'target', value: 0, time: 9 });
    // Into a vault: slot B gets a fresh convolver, the house's is cut off at its feed; the impulse buffer is made once per room.
    ctx.currentTime = 11;
    mixer.setRoom('halle');
    expect(ctx.convolvers).toHaveLength(3);
    expect(house.disconnected).toBe(true);
    expect((ctx.convolvers[2] as FakeConvolver).buffer?.length).toBe(impulseLength('halle', ctx.sampleRate));
    expect(mixer.reverb.impulse('hoehle')).toBe(cave.buffer);
    // Out under the sky: the wet gain closes, no new convolver.
    ctx.currentTime = 12;
    mixer.setRoom(null);
    expect(ctx.convolvers).toHaveLength(3);
    expect((mixer.reverb.wet(1).gain as FakeGain['gain']).calls.at(-1)).toEqual({ kind: 'target', value: 0, time: 12 });
    expect(mixer.reverb.room).toBeNull();
    expect(REVERB_CROSSFADE_SECONDS).toBeGreaterThan(0);
  });
});

describe('Prozedurale Impulsantworten', () => {
  const rooms: readonly ReverbRoom[] = ['hoehle', 'innenraum', 'halle'];
  const irs = new Map(rooms.map((r) => [r, generateImpulse(r, SR, 7)]));

  it('derselbe Seed gibt dieselben Bits, ein anderer andere', () => {
    const a = generateImpulse('innenraum', SR, 7);
    const b = generateImpulse('innenraum', SR, 7);
    const c = generateImpulse('innenraum', SR, 8);
    expect(Buffer.from(a.left.buffer).equals(Buffer.from(b.left.buffer))).toBe(true);
    expect(Buffer.from(a.right.buffer).equals(Buffer.from(b.right.buffer))).toBe(true);
    expect(Buffer.from(a.left.buffer).equals(Buffer.from(c.left.buffer))).toBe(false);
  });

  it('jeder Raum klingt so lange aus, wie er soll (RT60 ±15 %), mit Energie 1 und getrennten Kanälen', () => {
    for (const room of rooms) {
      const ir = irs.get(room);
      if (ir === undefined) throw new Error(room);
      expect(ir.left.length).toBe(impulseLength(room, SR));
      for (const ch of [ir.left, ir.right]) {
        const measured = rt60(ch, SR);
        expect(measured / REVERB_SPECS[room].rt60, `${room}: ${measured.toFixed(3)} s`).toBeGreaterThan(0.85);
        expect(measured / REVERB_SPECS[room].rt60, `${room}: ${measured.toFixed(3)} s`).toBeLessThan(1.15);
        let e = 0;
        for (const v of ch) e += v * v;
        expect(e).toBeCloseTo(1, 5);
      }
      // The pre-delay is silent, the tail starts after it.
      const pre = Math.round(REVERB_SPECS[room].vorverzoegerung * SR);
      for (let i = 0; i < pre - 1; i++) expect(ir.left[i]).toBe(0);
      // Left and right: two noise streams, a wide tail.
      expect(Math.abs(correlation(ir.left, ir.right, pre + Math.round(0.1 * SR)))).toBeLessThan(0.2);
    }
  });

  it('die Höhle ist dunkler als die Halle, die Halle heller als der Innenraum; die Höhle hallt am längsten', () => {
    const late = Math.round(0.15 * SR);
    const b = (r: ReverbRoom): number => brightness((irs.get(r) as { left: Float32Array }).left, late);
    expect(b('hoehle')).toBeLessThan(b('halle'));
    expect(b('innenraum')).toBeLessThan(b('halle'));
    expect(REVERB_SPECS.hoehle.rt60).toBeGreaterThan(REVERB_SPECS.halle.rt60);
    expect(REVERB_SPECS.halle.rt60).toBeGreaterThan(REVERB_SPECS.innenraum.rt60);
  });
});

describe('Raum des Hörers', () => {
  it('Gewölbe → Halle, Höhlenebene → Höhle, großer Raum → Halle, Haus → Innenraum, unter freiem Himmel kein Hall', () => {
    const s = createRoomSituation();
    expect(reverbRoomFor(s)).toBeNull();
    expect(reverbRoomFor({ ...s, layer: -1 })).toBe('hoehle');
    expect(reverbRoomFor({ ...s, layer: -2, inVault: true })).toBe('halle');
    expect(reverbRoomFor({ ...s, indoors: true, roomTiles: 9 })).toBe('innenraum');
    expect(reverbRoomFor({ ...s, indoors: true, roomTiles: HALLE_MIN_TILES })).toBe('halle');
    expect(reverbRoomFor({ ...s, indoors: false, roomTiles: 200 })).toBeNull();
  });

  it('liest im Holzhaus „drinnen“ und die Raumgröße, davor „draußen“', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 10);
    hut(w, 9, 9, 11, 11);
    const probe = new RoomProbe();
    const s = createRoomSituation();
    expect(probe.read(w.sim, s)).toBe(true);
    expect(s.indoors).toBe(true);
    expect(s.roomTiles).toBe(9);
    expect(reverbRoomFor(s)).toBe('innenraum');
    expect(probe.read(undefined, s)).toBe(false);
    expect(reverbRoomFor(s)).toBeNull();
  });
});

describe('Verdeckung', () => {
  it('Fels zwischen Hörer und Klang dämpft je Kachel, offenes Gelände nicht, eine andere Ebene zählt nicht', () => {
    const rows = meadow(30, 12);
    rows[5] = '..........#.#.................';
    const w = testWorld(rows);
    w.spawn(4, 5);
    void w.collision.grid;
    const occ = new SoundOcclusion();
    const listener = { ...w.centre(4, 5), layer: 0 };
    occ.begin(w.sim, listener);
    const at = (x: number, y: number): number => {
      const c = w.centre(x, y);
      return occ.at(c.x, c.y, 0);
    };
    expect(at(8, 5)).toBe(0);
    expect(at(11, 5)).toBeCloseTo(WALL_OCCLUSION);
    expect(at(14, 5)).toBeCloseTo(Math.min(1, 2 * WALL_OCCLUSION));
    // The wall tile itself is heard (its face is what the sound comes from); a sound beside the rocks is open.
    expect(at(10, 5)).toBe(0);
    expect(at(14, 8)).toBe(0);
    expect(occ.at(w.centre(14, 5).x, w.centre(14, 5).y, -1)).toBe(0);
    // Beyond the longest ray the walls are not walked.
    expect(occ.at(listener.x + (MAX_RAY_TILES + 2) * TILE_PX, listener.y, 0)).toBe(0);
    // Without a simulation nothing is occluded.
    occ.begin(undefined, listener);
    expect(at(14, 5)).toBe(0);
  });

  it('Holzwände und Dach: drinnen gehört klingt draußen gedämpft und umgekehrt; durch die offene Tür nur das Dach', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 10);
    hut(w, 9, 9, 11, 11);
    const occ = new SoundOcclusion();
    occ.begin(w.sim, { ...w.px(10, 10), layer: 0 });
    const at = (x: number, y: number): number => {
      const c = w.px(x, y);
      return occ.at(c.x, c.y, 0);
    };
    expect(at(9, 9)).toBe(0);
    expect(at(10, 3)).toBeCloseTo(WALL_OCCLUSION + ROOF_OCCLUSION);
    expect(at(3, 10)).toBeCloseTo(WALL_OCCLUSION + ROOF_OCCLUSION);
    // From outside, the house's inside is muffled the same way.
    occ.begin(w.sim, { ...w.px(10, 3), layer: 0 });
    expect(at(10, 10)).toBeCloseTo(WALL_OCCLUSION + ROOF_OCCLUSION);
    expect(at(14, 3)).toBe(0);
    // The door (south, at (10, 12)) opened: straight through it only the roof is between.
    w.act({ type: 'build.door', tx: w.tile(10, 12).tx, ty: w.tile(10, 12).ty });
    occ.begin(w.sim, { ...w.px(10, 16), layer: 0 });
    expect(at(10, 10)).toBeCloseTo(ROOF_OCCLUSION);
  });

  it('Stimmenkette: Position → Pegel → Verdeckungs-Tiefpass → Panner → Bus; ein gedämpfter eigener Klang bekommt den Tiefpass', () => {
    const ctx = new FakeContext();
    const mixer = new AudioMixer(ctx, busGains(defaultSettings().audio));
    const player = new SfxPlayer(ctx, mixer, SFX_PRESETS, { seed: 3, occlusion: (x) => (x > 500 ? 1 : 0) });
    player.setListener(400, 400, 0);
    expect(player.play({ id: 'sfx_umgebung_eule', x: 600, y: 400, layer: 0 })).toBe(true);
    const voice = ctx.sources.at(-1) as FakeNode;
    expect(chainOf(voice)).toEqual(['source', 'gain', 'filter', 'panner', 'gain', 'compressor', 'compressor', 'gain', 'destination']);
    expect((ctx.filters.at(-1) as FakeFilter).frequency.value).toBeCloseTo(CLOSED_CUTOFF_HZ);
    expect(ctx.panners.at(-1)?.pan.value).toBeGreaterThan(0);
    // The rain indoors: no position, muffled; the loop glides to a new muffling and volume.
    player.setLoop('regen', { id: 'sfx_umgebung_regen', muffle: 0.75, volume: 0.5 });
    const rain = ctx.sources.at(-1) as FakeNode;
    expect(chainOf(rain)).toEqual(['source', 'gain', 'filter', 'gain', 'compressor', 'compressor', 'gain', 'destination']);
    const filter = ctx.filters.at(-1) as FakeFilter;
    expect(filter.frequency.value).toBeCloseTo(occlusionCutoffHz(0.75));
    player.setLoop('regen', { id: 'sfx_umgebung_regen', muffle: 0, volume: 0.5 });
    expect(filter.frequency.value).toBeCloseTo(OPEN_CUTOFF_HZ);
    expect(ctx.sources.at(-1)).toBe(rain);
  });
});
