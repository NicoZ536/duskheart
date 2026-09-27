/**
 * M4-05/M4-06 in the game view (`StationView`, src/render/game/stations.ts): every station the station system keeps is
 * drawn with its sprite `obj_<station>` at the middle of its footprint's front edge, y-sorted by that anchor; the clip
 * follows what it does – a fired station burns (`brennt`) while it works and shows its output (`fertig`), a drying
 * rack hangs full (`belegt`) or moves in the wind (`arbeitet`), a hand station works (`arbeitet`) while the player's
 * piece is made at it, and stands cold (`aus`, `leer`) otherwise; fired stations glow through their emissive pixels
 * while they burn; the station under the interaction's target carries the outline; the campfire is no station here
 * (the light view draws it).
 */
import { describe, expect, it } from 'vitest';
import type { PlacedStation } from '../../../src/game/stations/state';
import type { AtlasData, AtlasSprite } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { createStationFrame, DONE_CLIPS, IDLE_CLIPS, LOADED_CLIP, stationClip, StationView, WORKING_CLIPS } from '../../../src/render/game/stations';
import type { RenderScene } from '../../../src/render/scene';
import { stationWorld, type StationWorld } from '../game/stationen-testwelt';
import { OFFSET } from '../game/spieler-testwelt';

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const T = 16;

interface Pushed {
  sprite: string;
  frame: number;
  x: number;
  y: number;
  depth: number;
  outline: boolean;
  glow: number;
  mirror: boolean;
}

function recordingScene(): { scene: RenderScene; pushed: Pushed[] } {
  const owner = new Map<unknown, { id: string; frame: number }>();
  for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f, i) => owner.set(f, { id: s.id, frame: i }));
  const pushed: Pushed[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        const o = owner.get(d.frame);
        pushed.push({ sprite: o?.id ?? '?', frame: o?.frame ?? -1, x: d.x, y: d.y, depth: d.depth, outline: d.outline, glow: d.emissiveBoost, mirror: d.mirror });
        return pushed.length - 1;
      },
    },
  } as unknown as RenderScene;
  return { scene, pushed };
}

function sprite(id: string): AtlasSprite {
  const s = MANIFEST.sprites[id];
  if (s === undefined) throw new Error(`Sprite ${id} fehlt`);
  return s;
}

/** Frames of clip `clip` of sprite `id`. */
function clipFrames(id: string, clip: string): number[] {
  const c = sprite(id).clips[clip];
  if (c === undefined) throw new Error(`${id}: Clip ${clip} fehlt`);
  return [...c.frames];
}

/** A station state with only what the clip choice reads (its processing slots). */
function state(proc: { laeuft: boolean; eingang?: boolean; ausgang?: boolean } | null): Readonly<PlacedStation> {
  const slot = (full: boolean | undefined) => [full === true ? { item: 'holz', count: 1 } : null];
  return { proc: proc === null ? null : { laeuft: proc.laeuft, eingang: slot(proc.eingang), ausgang: slot(proc.ausgang) } } as unknown as Readonly<PlacedStation>;
}

/** A frame over drawn tiles (0, 0) … (20, 14), `focus` the interaction's use target (drawn tile) or none. */
function frame(focus: { x: number; y: number } | null = null, time = 0) {
  const f = createStationFrame();
  f.left = OFFSET * T;
  f.top = OFFSET * T;
  f.right = (OFFSET + 20) * T;
  f.bottom = (OFFSET + 14) * T;
  f.time = time;
  f.focusTx = focus === null ? -1 : OFFSET + focus.x;
  f.focusTy = focus === null ? -1 : OFFSET + focus.y;
  return f;
}

function draw(view: StationView, w: StationWorld, f = frame()): Pushed[] {
  const { scene, pushed } = recordingScene();
  view.draw(scene, ATLAS, w.sim, f);
  return pushed;
}

describe('Clipwahl der Stationen', () => {
  it('Öfen: kalt aus, befeuert brennt, mit Ausgabe fertig; eine Eingabe allein lässt den Meiler kalt', () => {
    const meiler = sprite('obj_koehlermeiler');
    expect(stationClip(meiler, state({ laeuft: false }), false)).toBe('aus');
    expect(stationClip(meiler, state({ laeuft: true, eingang: true }), false)).toBe('brennt');
    expect(stationClip(meiler, state({ laeuft: false, ausgang: true }), false)).toBe('fertig');
    expect(stationClip(meiler, state({ laeuft: false, eingang: true }), false)).toBe('aus');
    // The clay oven has no `fertig`: done and cold it stands cold.
    expect(stationClip(sprite('obj_lehmofen'), state({ laeuft: false, ausgang: true }), false)).toBe('aus');
    expect(stationClip(sprite('obj_schmelzofen'), state({ laeuft: true }), false)).toBe('brennt');
  });

  it('Trockengestell: leer, mit Eingabe belegt, trocknend arbeitet, getrocknet belegt', () => {
    const rack = sprite('obj_trockengestell');
    expect(stationClip(rack, state({ laeuft: false }), false)).toBe('leer');
    expect(stationClip(rack, state({ laeuft: false, eingang: true }), false)).toBe(LOADED_CLIP);
    expect(stationClip(rack, state({ laeuft: true, eingang: true }), false)).toBe('arbeitet');
    expect(stationClip(rack, state({ laeuft: false, ausgang: true }), false)).toBe('belegt');
  });

  it('Handstationen arbeiten, solange an ihnen gefertigt wird; Stationen ohne Clips stehen im ersten Frame', () => {
    expect(stationClip(sprite('obj_spinnrad'), state(null), false)).toBe('aus');
    expect(stationClip(sprite('obj_spinnrad'), state(null), true)).toBe('arbeitet');
    expect(stationClip(sprite('obj_schleifstein'), state(null), true)).toBe('arbeitet');
    expect(stationClip(sprite('obj_werkbank'), state(null), true)).toBeNull();
    expect(stationClip(sprite('obj_amboss_bronze'), state(null), false)).toBeNull();
    // The clip names are the station sprites' contract (assets-src/sprites/stationen/).
    expect([...WORKING_CLIPS, ...DONE_CLIPS, ...IDLE_CLIPS]).toEqual(['brennt', 'arbeitet', 'fertig', 'belegt', 'leer', 'aus']);
  });
});

describe('StationView', () => {
  it('jede Station mit ihrem Sprite an der Mitte ihrer Vorderkante, nach dem Anker sortiert; das Lagerfeuer ist keine', () => {
    const w = stationWorld();
    w.place('koehlermeiler', 2, 2);
    w.place('werkbank', 6, 2);
    w.place('spinnrad', 9, 2);
    w.give('lagerfeuer', 1);
    expect(w.refused({ type: 'station.place', from: w.slotOf('lagerfeuer'), tx: OFFSET + 12, ty: OFFSET + 2 })).toEqual(['placedElsewhere']);
    const view = new StationView();
    const pushed = draw(view, w);
    expect(pushed.map((p) => p.sprite)).toEqual(['obj_koehlermeiler', 'obj_werkbank', 'obj_spinnrad']);
    // The kiln (2 × 2): anchor between its columns, on the last row of its footprint.
    expect(pushed[0]).toMatchObject({ x: (OFFSET + 3) * T, y: (OFFSET + 4) * T - 1, frame: 0 });
    expect(Number.isNaN(pushed[0]?.depth)).toBe(true);
    expect(pushed[1]).toMatchObject({ x: (OFFSET + 7) * T, y: (OFFSET + 3) * T - 1 });
    expect(pushed[2]).toMatchObject({ x: (OFFSET + 9.5) * T, y: (OFFSET + 3) * T - 1 });
    expect(view.stats).toEqual({ drawn: 3, working: 0, missing: 0 });
  });

  it('gespiegelt aufgestellt (F) steht die Station gespiegelt – nur, wenn ihr Sprite `spiegelbar` ist (docs/ART.md, wie Bauteile)', () => {
    const w = stationWorld();
    w.give('saegebock', 2);
    expect(w.refused({ type: 'station.place', from: w.slotOf('saegebock'), tx: OFFSET + 3, ty: OFFSET + 2, mirror: true })).toEqual([]);
    expect(w.refused({ type: 'station.place', from: w.slotOf('saegebock'), tx: OFFSET + 8, ty: OFFSET + 2 })).toEqual([]);
    const view = new StationView();
    const bock = sprite('obj_saegebock') as { symmetric: boolean };
    expect(bock.symmetric).toBe(true);
    expect(draw(view, w).map((p) => p.mirror)).toEqual([true, false]);
    // A station sprite that may not be mirrored is drawn as drawn, even when set up with F.
    bock.symmetric = false;
    try {
      expect(draw(view, w).map((p) => p.mirror)).toEqual([false, false]);
    } finally {
      bock.symmetric = true;
    }
  });

  it('ein befeuerter Meiler brennt und leuchtet; mit Holzkohle im Ausgang steht er fertig', () => {
    const w = stationWorld();
    const id = w.place('koehlermeiler', 6, 4);
    w.give('holz', 8);
    w.run(1, [{ type: 'station.put', station: id, from: w.slotOf('holz'), bereich: 'eingang', count: 4 }]);
    w.run(1, [{ type: 'station.put', station: id, from: w.slotOf('holz'), bereich: 'brennstoff', count: 4 }]);
    w.run(2);
    expect(w.st(id).proc?.laeuft).toBe(true);
    const view = new StationView();
    const burning = clipFrames('obj_koehlermeiler', 'brennt');
    for (const time of [0, 0.4, 0.9, 1.3]) {
      const kiln = draw(view, w, frame(null, time))[0] as Pushed;
      expect(burning).toContain(kiln.frame);
      expect(kiln.glow).toBeGreaterThan(0);
    }
    expect(view.stats.working).toBe(1);
    const cold = w.st(w.place('koehlermeiler', 10, 4)).proc;
    if (cold === null) throw new Error('Meiler ohne Plätze');
    cold.ausgang[0] = { item: 'holzkohle', count: 2 };
    const done = draw(view, w).find((p) => p.x === (OFFSET + 11) * T) as Pushed;
    expect(done.frame).toBe(clipFrames('obj_koehlermeiler', 'fertig')[0]);
    expect(done.glow).toBe(0);
  });

  it('das Spinnrad dreht sich, solange der Spieler an ihm Garn spinnt', () => {
    const w = stationWorld();
    const wheel = w.place('spinnrad', 5, 4);
    const view = new StationView();
    expect(draw(view, w)[0]?.frame).toBe(clipFrames('obj_spinnrad', 'aus')[0]);
    w.give('fasern', 8);
    w.run(1, [{ type: 'craft.start', recipe: 'rezept_garn', count: 2 }]);
    w.run(1);
    expect(w.crafting.orders[0]?.platz).toBe(wheel);
    const turning = clipFrames('obj_spinnrad', 'arbeitet');
    const frames = new Set([0, 0.07, 0.14, 0.21].map((t) => draw(view, w, frame(null, t))[0]?.frame));
    expect(frames.size).toBeGreaterThan(1);
    for (const f of frames) expect(turning).toContain(f);
    expect(view.stats.working).toBe(1);
  });

  it('die Station unter dem Ziel der Interaktion trägt die Umrisslinie; andere Ebenen und Ferne zeichnen nichts', () => {
    const w = stationWorld();
    w.place('koehlermeiler', 2, 2);
    w.place('werkbank', 6, 2);
    const view = new StationView();
    const focused = draw(view, w, frame({ x: 3, y: 3 }));
    expect(focused.map((p) => p.outline)).toEqual([true, false]);
    expect(draw(view, w, frame({ x: 7, y: 2 })).map((p) => p.outline)).toEqual([false, true]);
    expect(draw(view, w, frame({ x: 5, y: 2 })).some((p) => p.outline)).toBe(false);
    const below = frame();
    below.layer = -1;
    expect(draw(view, w, below)).toHaveLength(0);
    const far = frame();
    far.left += 100 * T;
    far.right += 100 * T;
    expect(draw(view, w, far)).toHaveLength(0);
    expect(view.stats.drawn).toBe(0);
  });
});
