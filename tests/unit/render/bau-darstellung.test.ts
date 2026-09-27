/**
 * M4-13/M4-27 in the game view (`BuildingView`): the building system's parts are drawn with their modular sprites
 * after the contract of assets-src/sprites/bau/_bau.ts – walls with the neighbour mask and version A/B, doors and
 * windows by the orientation of their wall, floors on the ground behind what stands on them, roofs with the row
 * kind of their column sorted at the eave and carrying the canopy fade where they cover the player, blueprints half
 * dithered in the plan colour; inside a house the roof fades out, its rim stays and the walls below its top row are
 * cut; build overlays veil the roofs.
 */
import { describe, expect, it } from 'vitest';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import {
  BLUEPRINT_LOOK,
  BuildingView,
  createBuildingFrame,
  createPieceLook,
  doorFrame,
  DOOR_FRAME,
  inSideWall,
  MASK,
  partSecondSpriteId,
  partSpriteId,
  roofFrame,
  WALL_CUT_BASE,
  wallFrame,
  windowFrame,
  WINDOW_FRAME,
} from '../../../src/render/game/building';
import { FADE_FRAMES, ROOF_ROW } from '../../../src/render/game/roofs';
import type { RenderScene } from '../../../src/render/scene';
import { bauWelt, hut, type BauWelt } from '../game/bau-testwelt';
import { meadow, OFFSET } from '../game/spieler-testwelt';

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
  layer: string;
  depth: number;
  fade: number;
  canopyFade: boolean;
  tint: number;
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
        pushed.push({ sprite: o?.id ?? '?', frame: o?.frame ?? -1, x: d.x, y: d.y, layer: d.layer, depth: d.depth, fade: d.fade, canopyFade: d.canopyFade, tint: d.tintStrength, mirror: d.mirror });
        return pushed.length - 1;
      },
    },
  } as unknown as RenderScene;
  return { scene, pushed };
}

/** A frame around drawn tile (x, y) with the player there. */
function frameAt(w: BauWelt, x: number, y: number) {
  const f = createBuildingFrame();
  const p = w.px(x, y);
  f.left = p.x - 320;
  f.right = p.x + 320;
  f.top = p.y - 200;
  f.bottom = p.y + 200;
  f.hasFigure = true;
  f.figureX = w.pos().x;
  f.figureY = w.pos().y;
  f.fadeX = f.figureX;
  f.fadeY = f.figureY - 12;
  f.fadeRadius = 18;
  f.instant = true;
  return f;
}

function tileOf(p: Pushed, ox = 8, oy = 15): { x: number; y: number } {
  return { x: Math.floor((p.x - ox) / T) - OFFSET, y: Math.floor((p.y - oy) / T) - OFFSET };
}

describe('Bildwahl der modularen Bauteile (Vertrag _bau.ts)', () => {
  it('Sprite-Ids: bau_<id> für Bauteile, obj_<id> für Möbel; Tor-Seite und Falltür-Klappe als zweites Sprite', () => {
    expect(partSpriteId({ id: 'wand_holz', kind: 'wand' })).toBe('bau_wand_holz');
    expect(partSpriteId({ id: 'holzbett', kind: 'moebel' })).toBe('obj_holzbett');
    expect(partSpriteId({ id: 'regal_wand', kind: 'wandmoebel' })).toBe('obj_regal_wand');
    expect(partSecondSpriteId({ id: 'tor_holz', kind: 'tor' })).toBe('bau_tor_holz_seite');
    expect(partSecondSpriteId({ id: 'falltuer_holz', kind: 'falltuer' })).toBe('bau_falltuer_holz_klappe');
    for (const id of ['bau_wand_holz', 'bau_tuer_holz', 'bau_fenster_glas', 'bau_dach_stroh', 'bau_boden_holz', 'bau_tor_holz_seite', 'bau_falltuer_holz_klappe']) expect(MANIFEST.sprites[id], id).toBeDefined();
  });

  it('Wände: Maske der Fassung A/B, Schnitt 32 + Maske; eine volle Wand verbindet nicht zur gekappten südlich', () => {
    const l = createPieceLook();
    l.mask = MASK.o | MASK.w;
    expect(wallFrame(l)).toBe(MASK.o | MASK.w);
    l.versionB = true;
    expect(wallFrame(l)).toBe(16 + (MASK.o | MASK.w));
    l.mask = MASK.n | MASK.s;
    l.cutSouth = true;
    expect(wallFrame(l)).toBe(16 + MASK.n);
    l.cut = true;
    expect(wallFrame(l)).toBe(WALL_CUT_BASE + (MASK.n | MASK.s));
  });

  it('Türen und Fenster: Ost-West-Wand, Nord-Süd-Wand, Zustand, erleuchtet, Schnitt nur in Ost-West-Wänden', () => {
    const l = createPieceLook();
    l.mask = MASK.o | MASK.w;
    expect(inSideWall(l.mask)).toBe(false);
    expect(doorFrame(l)).toBe(0);
    l.door = 2;
    expect(doorFrame(l)).toBe(2);
    l.mask = MASK.n | MASK.s;
    expect(inSideWall(l.mask)).toBe(true);
    expect(doorFrame(l)).toBe(DOOR_FRAME.side + 2);
    l.cut = true;
    expect(doorFrame(l)).toBe(DOOR_FRAME.side + 2);
    l.mask = MASK.w;
    expect(doorFrame(l)).toBe(DOOR_FRAME.cut);
    const f = createPieceLook();
    f.mask = MASK.n | MASK.s;
    f.lit = true;
    expect(windowFrame(f)).toBe(WINDOW_FRAME.side + WINDOW_FRAME.lit);
    f.mask = MASK.o;
    f.cut = true;
    expect(windowFrame(f)).toBe(WINDOW_FRAME.cut);
  });

  it('Dächer: Reihenart · 16 + Maske', () => {
    const l = createPieceLook();
    l.roofRow = ROOF_ROW.nord;
    l.mask = MASK.s | MASK.o;
    expect(roofFrame(l)).toBe(2 * 16 + 6);
  });
});

describe('BuildingView auf dem Bauraster', () => {
  it('eine Hütte: Wände mit Nachbarmasken, die Tür in der Südwand, Dächer an der Traufe sortiert über allem darunter', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 14);
    hut(w, 9, 9, 11, 11);
    const view = new BuildingView();
    const { scene, pushed } = recordingScene();
    view.draw(scene, ATLAS, w.sim, frameAt(w, 10, 10));
    const walls = pushed.filter((p) => p.sprite === 'bau_wand_holz');
    expect(walls).toHaveLength(15);
    // North-west corner: neighbours east and south.
    const nw = walls.find((p) => tileOf(p).x === 8 && tileOf(p).y === 8);
    expect(nw?.frame !== undefined && nw.frame % 16).toBe(MASK.o | MASK.s);
    const door = pushed.find((p) => p.sprite === 'bau_tuer_holz');
    expect(door).toBeDefined();
    expect(tileOf(door as Pushed)).toEqual({ x: 10, y: 12 });
    expect((door as Pushed).frame).toBe(0);
    const roofs = pushed.filter((p) => p.sprite === 'bau_dach_stroh');
    expect(roofs).toHaveLength(25);
    // Every roof sorts at the eave of its column (the south wall row 12), behind it by half a pixel.
    for (const r of roofs) expect(r.depth).toBe((OFFSET + 12) * T + 15 + 0.5);
    const north = roofs.filter((r) => tileOf(r).y === 8).map((r) => Math.floor(r.frame / 16));
    expect(new Set(north)).toEqual(new Set([ROOF_ROW.nord]));
    const eave = roofs.filter((r) => tileOf(r).y === 12).map((r) => Math.floor(r.frame / 16));
    expect(new Set(eave)).toEqual(new Set([ROOF_ROW.sued]));
    expect(view.stats.roofs).toBe(25);
    expect(view.stats.inside).toBe(false);
  });

  it('Böden liegen auf dem Boden (Ebene ground) und sortieren nach dem, was in ihrem Tile wurzelt', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 14);
    expect(w.build('boden_holz', 10, 12)).toBeNull();
    const { scene, pushed } = recordingScene();
    new BuildingView().draw(scene, ATLAS, w.sim, frameAt(w, 10, 12));
    const floor = pushed.find((p) => p.sprite === 'bau_boden_holz') as Pushed;
    expect(floor.layer).toBe('ground');
    expect(floor.x).toBe((OFFSET + 10) * T);
    expect(floor.y).toBe((OFFSET + 12) * T);
    expect(floor.depth).toBeGreaterThan(floor.y + T - 1);
  });

  it('eine Blaupause ist halb gedithert und in der Planfarbe getönt', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 14);
    w.act({ type: 'build.blueprint', part: 'wand_holz', tx: OFFSET + 12, ty: OFFSET + 12 });
    const view = new BuildingView();
    const { scene, pushed } = recordingScene();
    view.draw(scene, ATLAS, w.sim, frameAt(w, 12, 12));
    const wall = pushed.find((p) => p.sprite === 'bau_wand_holz') as Pushed;
    expect(wall.fade).toBe(BLUEPRINT_LOOK.fade);
    expect(wall.tint).toBe(BLUEPRINT_LOOK.strength);
    expect(view.stats.blueprints).toBe(1);
  });

  it('drinnen: das Dach blendet ganz aus und lässt seinen Rand, die Wände unter der obersten Reihe werden gekappt', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 14);
    hut(w, 9, 9, 11, 11);
    w.act({ type: 'player.teleport', x: w.px(10, 10).x, y: w.px(10, 10).y, layer: 0 });
    expect(w.roomAt(10, 10)?.region.interior).toBe(true);
    const view = new BuildingView();
    let last: Pushed[] = [];
    for (let i = 0; i <= FADE_FRAMES + 1; i++) {
      const { scene, pushed } = recordingScene();
      const f = frameAt(w, 10, 10);
      f.instant = false;
      view.draw(scene, ATLAS, w.sim, f);
      last = pushed;
    }
    expect(view.stats.inside).toBe(true);
    expect(view.stats.roofFade).toBe(1);
    const roofs = last.filter((p) => p.sprite === 'bau_dach_stroh');
    // Each roof tile twice: the full roof gone (fade 1), its rim shown (fade 0).
    expect(roofs.filter((r) => r.fade === 1)).toHaveLength(25);
    const rims = roofs.filter((r) => r.fade === 0);
    expect(rims).toHaveLength(25);
    for (const r of rims) expect(Math.floor(r.frame / 16)).toBe(ROOF_ROW.schnitt);
    // The back wall (row 8) stays full; the others below it show their 4-px cut.
    const cutWalls = last.filter((p) => p.sprite === 'bau_wand_holz' && p.frame >= WALL_CUT_BASE && p.fade === 0);
    expect(cutWalls.map((p) => tileOf(p).y).every((y) => y > 8)).toBe(true);
    expect(cutWalls.length).toBeGreaterThan(0);
    expect(last.filter((p) => p.sprite === 'bau_wand_holz' && tileOf(p).y === 8).every((p) => p.frame < WALL_CUT_BASE)).toBe(true);
    const cutDoor = last.find((p) => p.sprite === 'bau_tuer_holz' && p.fade === 0);
    expect(cutDoor?.frame).toBe(DOOR_FRAME.cut);
  });

  it('hinter dem Haus trägt das Dach die Kreisblende; ein gezeigtes Overlay verschleiert alle Dächer', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 14);
    hut(w, 9, 9, 11, 11);
    w.act({ type: 'player.teleport', x: w.px(10, 7).x, y: w.px(10, 7).y, layer: 0 });
    const { scene, pushed } = recordingScene();
    const f = frameAt(w, 10, 7);
    new BuildingView().draw(scene, ATLAS, w.sim, f);
    const covering = pushed.filter((p) => p.sprite === 'bau_dach_stroh' && p.canopyFade);
    expect(covering.length).toBeGreaterThan(0);
    const veiled = recordingScene();
    f.roofVeil = 0.6;
    new BuildingView().draw(veiled.scene, ATLAS, w.sim, f);
    for (const r of veiled.pushed.filter((p) => p.sprite === 'bau_dach_stroh')) expect(r.fade).toBe(0.6);
  });
});
