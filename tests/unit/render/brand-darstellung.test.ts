/**
 * M4-28 in the game view (`FireView`, src/render/game/fire.ts; sprite `brand`, assets-src/sprites/effekte/brand.ts):
 * burning tiles of the fire simulation carry animated flames in four sizes of six looping frames each – a young fire
 * grows from a small tongue to the full blaze within seconds, a part burned down to its last hit points sinks to an
 * ember bed, a barely flammable part (timber frame) never burns in full; the flames stand on what burns (the foot and
 * top of a wall, the trunk and crown of a tree), sort just in front of it and run out of step between tiles; after the
 * part is gone the ember bed glows on the ground until the fire is out.
 */
import { describe, expect, it } from 'vitest';
import BRAND from '../../../assets-src/sprites/effekte/brand';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { createFireFrame, FIRE_COURSE, FIRE_SPRITE, FIRE_STAGE_CLIPS, FireView, fireStage, STAGE } from '../../../src/render/game/fire';
import type { RenderScene } from '../../../src/render/scene';
import { BALANCE } from '../../../src/content/balance';
import { lagerWelt, type LagerWelt } from '../game/lager-testwelt';
import { meadow, OFFSET } from '../game/spieler-testwelt';

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const T = 16;
const SECOND = BALANCE.time.tickHz;
const WALL_HP = BALANCE.building.materials.holz.wallHp;

interface Flame {
  frame: number;
  x: number;
  y: number;
  depth: number;
  mirror: boolean;
}

function recordingScene(): { scene: RenderScene; flames: Flame[] } {
  const brand = MANIFEST.sprites[FIRE_SPRITE];
  const index = new Map<unknown, number>();
  brand?.frames.forEach((f, i) => index.set(f, i));
  const flames: Flame[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        flames.push({ frame: index.get(d.frame) ?? -1, x: d.x, y: d.y, depth: d.depth, mirror: d.mirror });
        return flames.length - 1;
      },
    },
  } as unknown as RenderScene;
  return { scene, flames };
}

/** The stage whose clip holds brand frame `frame` (−1 none). */
function stageOf(frame: number): number {
  return FIRE_STAGE_CLIPS.findIndex((c) => MANIFEST.sprites[FIRE_SPRITE]?.clips[c]?.frames.includes(frame) === true);
}

/** A 30 × 16 meadow (birches where `T` is drawn), the player on (4, 12). */
function world(extra: readonly string[] = []): LagerWelt {
  const rows = meadow(30, 16);
  extra.forEach((r, y) => {
    rows[y] = r + rows[y]?.slice(r.length);
  });
  return lagerWelt(rows, { x: 4, y: 12 });
}

function row(w: LagerWelt, x: number, y: number, parts: readonly string[]): void {
  parts.forEach((p, k) => {
    const r = w.build(p, x + k, y);
    if (r !== null) throw new Error(`${p} at ${x + k},${y}: ${r}`);
  });
}

function frame(time = 0) {
  const f = createFireFrame();
  f.left = OFFSET * T;
  f.top = OFFSET * T;
  f.right = (OFFSET + 30) * T;
  f.bottom = (OFFSET + 16) * T;
  f.time = time;
  return f;
}

function draw(view: FireView, w: LagerWelt, f = frame()): Flame[] {
  const { scene, flames } = recordingScene();
  view.draw(scene, ATLAS, w.sim, f, null, null);
  return flames;
}

/** Flames on the column of drawn tile x. */
function onColumn(flames: readonly Flame[], x: number): Flame[] {
  return flames.filter((f) => Math.floor(f.x / T) === OFFSET + x);
}

describe('Brand-Sprite und Verlauf', () => {
  it('vier Größen zu je sechs Frames im Kreis, leuchtend, spiegelbar; jede Größe ist höher als die vorige', () => {
    const s = MANIFEST.sprites[FIRE_SPRITE];
    if (s === undefined) throw new Error('brand fehlt im Atlas');
    expect(s.size).toEqual([16, 16]);
    expect(s.emissive).toBe(true);
    expect(s.symmetric).toBe(true);
    expect(FIRE_STAGE_CLIPS).toEqual(['glimmen', 'klein', 'mittel', 'gross']);
    const heights = FIRE_STAGE_CLIPS.map((name) => {
      const c = s.clips[name];
      expect(c?.frames, name).toHaveLength(6);
      expect(c?.loop, name).toBe(true);
      // Mean height of the flame over its loop, from the source pixels (topmost lit row to the bottom).
      const rows = (c?.frames ?? []).map((i) => {
        const px = BRAND.frames[i]?.index as Uint8Array;
        let top = 16;
        for (let p = 0; p < px.length; p++) if ((px[p] as number) > 0) top = Math.min(top, Math.floor(p / 16));
        return 16 - top;
      });
      return rows.reduce((a, b) => a + b, 0) / rows.length;
    });
    for (let i = 1; i < heights.length; i++) expect(heights[i], FIRE_STAGE_CLIPS[i]).toBeGreaterThan(heights[i - 1] as number);
    // Every pixel of every frame glows.
    for (const f of BRAND.frames) for (let p = 0; p < f.index.length; p++) if ((f.index[p] as number) > 0) expect(f.emissive[p]).toBeGreaterThan(0);
  });

  it('fireStage: ein junges Feuer wächst, ein heruntergebranntes sinkt zur Glut, Fachwerk brennt nie voll', () => {
    const [grow1, grow2] = FIRE_COURSE.growSeconds;
    expect(fireStage(0, 1, 1)).toBe(STAGE.klein);
    expect(fireStage(grow1, 1, 1)).toBe(STAGE.mittel);
    expect(fireStage(grow2, 1, 1)).toBe(STAGE.gross);
    expect(fireStage(60, 0.45, 1)).toBe(STAGE.mittel);
    expect(fireStage(60, 0.2, 1)).toBe(STAGE.klein);
    expect(fireStage(60, 0.05, 1)).toBe(STAGE.glimmen);
    expect(fireStage(0, 0.05, 1)).toBe(STAGE.glimmen);
    expect(fireStage(60, 1, BALANCE.building.materials.fachwerk.flammability)).toBe(STAGE.mittel);
  });
});

describe('FireView', () => {
  it('eine brennende Holzwand: erst eine kleine Zunge an ihrem Fuß, dann der volle Brand bis über die Krone', () => {
    const w = world();
    row(w, 6, 10, ['wand_holz', 'wand_holz', 'wand_holz']);
    w.act({ type: 'fire.ignite', tx: OFFSET + 6, ty: OFFSET + 10 });
    const view = new FireView();
    const young = draw(view, w);
    expect(view.stats).toEqual({ tiles: 1, flames: 1 });
    const tongue = young[0] as Flame;
    expect(stageOf(tongue.frame)).toBe(STAGE.klein);
    // At the foot of the wall's front, in the middle of its tile, sorted just in front of the wall's anchor row.
    expect(tongue).toMatchObject({ x: (OFFSET + 6) * T + T / 2, y: (OFFSET + 10) * T + 11, depth: (OFFSET + 10) * T + 15 + 0.5 });
    w.run(5 * SECOND);
    const blaze = draw(view, w);
    expect(blaze.map((f) => stageOf(f.frame))).toEqual([STAGE.gross, STAGE.mittel, STAGE.klein]);
    // A tongue licks over the wall's top.
    expect(Math.min(...blaze.map((f) => f.y))).toBeLessThan((OFFSET + 10) * T + 4);
    // Twelve seconds on, the neighbour has caught; the flames of the two tiles run out of step.
    w.run(8 * SECOND);
    const two = draw(view, w, frame(0.2));
    expect(view.stats.tiles).toBe(2);
    expect(onColumn(two, 7).length).toBeGreaterThan(0);
    const phases = new Set([6, 7].map((x) => onColumn(two, x)[0]?.frame));
    expect(phases.size).toBe(2);
  });

  it('heruntergebrannt glimmt sie; ist nichts mehr da, glüht das Glutbett auf dem Boden bis zur nächsten Weltsekunde', () => {
    const w = world();
    row(w, 6, 10, ['wand_holz']);
    w.act({ type: 'fire.ignite', tx: OFFSET + 6, ty: OFFSET + 10 });
    const view = new FireView();
    // 27 s: 30 of 300 HP left (below 12 %).
    w.run(27 * SECOND);
    expect(w.building.structures.hp(0, 1, OFFSET + 6, OFFSET + 10)).toBeLessThan(WALL_HP * FIRE_COURSE.sinkBelow[2]);
    expect(draw(view, w).map((f) => stageOf(f.frame))).toEqual([STAGE.glimmen]);
    // Torn down while it burns: the fire burns out with the world second, until then its ember bed glows on the ground.
    expect(w.rejection(w.act({ type: 'build.remove', tx: OFFSET + 6, ty: OFFSET + 10 }))).toBeNull();
    expect(w.feuer.size).toBe(1);
    const bed = draw(view, w);
    expect(bed.map((f) => stageOf(f.frame))).toEqual([STAGE.glimmen]);
    expect(bed[0]).toMatchObject({ x: (OFFSET + 6) * T + T / 2, y: (OFFSET + 10) * T + 15 });
    w.run(2 * SECOND);
    expect(w.feuer.size).toBe(0);
    expect(draw(view, w)).toHaveLength(0);
  });

  it('Fachwerk brennt höchstens mittel; ein Baum brennt am Stamm und in der Krone', () => {
    const w = world(['', '', '', '', '', '', '', '', '', '', '...........T']);
    row(w, 6, 10, ['wand_fachwerk']);
    w.act({ type: 'fire.ignite', tx: OFFSET + 6, ty: OFFSET + 10 }, { type: 'fire.ignite', tx: OFFSET + 11, ty: OFFSET + 10 });
    w.run(6 * SECOND);
    const view = new FireView();
    const flames = draw(view, w);
    expect(Math.max(...onColumn(flames, 6).map((f) => stageOf(f.frame)))).toBe(STAGE.mittel);
    const tree = onColumn(flames, 11);
    expect(tree.length).toBeGreaterThanOrEqual(2);
    const trunk = (OFFSET + 10) * T + 15;
    expect(tree.some((f) => f.y === trunk)).toBe(true);
    // The crown burns well above the trunk.
    expect(Math.min(...tree.map((f) => f.y))).toBeLessThan(trunk - 16);
  });

  it('nur die Ebene des Bildes und sein Ausschnitt; ohne Brand nichts', () => {
    const w = world();
    const view = new FireView();
    expect(draw(view, w)).toHaveLength(0);
    row(w, 6, 10, ['wand_holz']);
    w.act({ type: 'fire.ignite', tx: OFFSET + 6, ty: OFFSET + 10 });
    const below = frame();
    below.layer = -1;
    expect(draw(view, w, below)).toHaveLength(0);
    const far = frame();
    far.left += 100 * T;
    far.right += 100 * T;
    expect(draw(view, w, far)).toHaveLength(0);
    expect(view.stats).toEqual({ tiles: 0, flames: 0 });
  });
});
