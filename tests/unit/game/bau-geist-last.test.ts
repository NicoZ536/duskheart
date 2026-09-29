/**
 * M5-52: the build mode's ghost is complete before the click (src/render/game/ghost.ts):
 *
 * - the building system's own removal rule `carriesLoad` (a jetty with something standing on it) is asked read-only
 *   (`BuildingSystem.loadProblem`): a loaded jetty is red with its reason before the click, and the simulation refuses
 *   exactly that; in a drag the targets come down one after the other, so a jetty whose load comes down before it is
 *   free, one under a chest that stays is red;
 * - the contents of the chests are an input of the ghost's cache: an emptied chest is free in the next frame, not up to
 *   `REFRESH_FRAMES` (0.25 s) later, and an unchanged frame is not judged again.
 */
import { describe, expect, it } from 'vitest';
import { BuildGhost, createGhostFrame, GhostView, type BuildTool, type GhostFrame, type ToolTarget } from '../../../src/render/game/ghost';
import { TILE_PX } from '../../../src/world/model/coords';
import { lagerWelt, type LagerWelt } from './lager-testwelt';
import { meadow } from './spieler-testwelt';

const NO_POINTER = { inside: false, x: 0, y: 0 } as const;

/** Meadow with a lake of shallow water in columns 10–19, rows 6–13; the player on the shore above it. */
function lake(): LagerWelt {
  const rows = meadow(40, 20).map((r, y) => (y >= 6 && y < 14 ? `${r.slice(0, 10)}${'w'.repeat(10)}${r.slice(20)}` : r));
  return lagerWelt(rows, { x: 12, y: 4 });
}

interface Geist {
  readonly w: LagerWelt;
  readonly ghost: BuildGhost;
  readonly view: GhostView;
  readonly f: GhostFrame;
}

function geist(w: LagerWelt, tool: BuildTool): Geist {
  const ghost = new BuildGhost();
  ghost.active = true;
  ghost.tool = tool;
  const f = createGhostFrame();
  f.hasFigure = true;
  f.reasonLabel = (reason) => `grund:${reason}`;
  return { w, ghost, view: new GhostView(), f };
}

/** Points the cursor at drawn tile (x, y) (the drag from drawn tile `von`) and runs one frame of the ghost. */
function frame(g: Geist, x: number, y: number, von?: { x: number; y: number }): void {
  const p = g.w.pos();
  g.f.figureX = p.x;
  g.f.figureY = p.y;
  const t = g.w.tile(x, y);
  g.ghost.padDx = t.tx - Math.floor(p.x / TILE_PX);
  g.ghost.padDy = t.ty - Math.floor(p.y / TILE_PX);
  const d = von === undefined ? null : g.w.tile(von.x, von.y);
  g.ghost.dragTx = d === null ? Number.NaN : d.tx;
  g.ghost.dragTy = d === null ? Number.NaN : d.ty;
  g.view.update(g.w.sim, NO_POINTER, g.f, g.ghost);
}

/** A fresh judgement: another cursor first (the other systems' state is no input of the cache), then (x, y). */
function judge(g: Geist, x: number, y: number, von?: { x: number; y: number }): void {
  frame(g, x + 1, y);
  frame(g, x, y, von);
}

function ziele(ghost: BuildGhost): Array<Pick<ToolTarget, 'piece' | 'reason'> & { at: string }> {
  return ghost.targets.slice(0, ghost.targetCount).map((t) => ({ piece: t.piece, reason: t.reason, at: `${t.tx},${t.ty}` }));
}

/** A wooden crate with stones on drawn tile (x, y); returns its id. */
function volleKiste(w: LagerWelt, x: number, y: number): number {
  expect(w.build('kiste_holz', x, y)).toBeNull();
  const at = w.tile(x, y);
  const chest = w.storage.chestAt(0, at.tx, at.ty);
  if (chest === undefined) throw new Error('no chest');
  w.give('stein', 3);
  expect(w.rejection(w.act({ type: 'storage.put', chest: chest.id, from: w.slotOf('stein') }))).toBeNull();
  return chest.id;
}

describe('M5-52: Bau-Geist mit der Last des Stegs und dem Kisteninhalt', () => {
  it('ein belasteter Steg (Fackel oder Station darauf) ist vor dem Klick rot mit „carriesLoad“ – wie build.remove; ohne Last frei', () => {
    const w = lake();
    expect(w.build('steg_holz', 12, 6)).toBeNull();
    const on = w.tile(12, 6);
    // What another system placed on the jetty (the occupancy providers of createSimulation: a torch, a station).
    let loaded = true;
    w.building.addOccupancy((_s, _layer, tx, ty) => loaded && tx === on.tx && ty === on.ty);
    const g = geist(w, 'abbauen');
    judge(g, 12, 6);
    expect(ziele(g.ghost)).toEqual([{ piece: 'steg_holz', reason: 'carriesLoad', at: `${on.tx},${on.ty}` }]);
    expect(g.ghost).toMatchObject({ okCount: 0, firstReason: 'carriesLoad' });
    expect(w.rejection(w.act({ type: 'build.remove', ...on, ebene: 'boden' }))).toBe('carriesLoad');
    loaded = false;
    judge(g, 12, 6);
    expect(ziele(g.ghost)).toEqual([{ piece: 'steg_holz', reason: null, at: `${on.tx},${on.ty}` }]);
    expect(w.rejection(w.act({ type: 'build.remove', ...on, ebene: 'boden' }))).toBeNull();
  });

  it('ein Steg ohne Last ist frei', () => {
    const w = lake();
    expect(w.build('steg_holz', 13, 6)).toBeNull();
    const g = geist(w, 'abbauen');
    judge(g, 13, 6);
    expect(ziele(g.ghost)).toEqual([{ piece: 'steg_holz', reason: null, at: `${w.tile(13, 6).tx},${w.tile(13, 6).ty}` }]);
  });

  it('im Zug: kommt die Last vorher mit herunter (Wand), ist der Steg frei; bleibt sie (volle Kiste), ist er rot – die Simulation urteilt in derselben Reihenfolge genauso', () => {
    const w = lake();
    for (const y of [6, 7]) expect(w.build('steg_holz', 12, y)).toBeNull();
    expect(w.build('wand_holz', 12, 6)).toBeNull();
    volleKiste(w, 12, 7);
    const g = geist(w, 'abbauen');
    judge(g, 12, 7, { x: 12, y: 6 });
    const a = w.tile(12, 6);
    const b = w.tile(12, 7);
    // DISMANTLE_ORDER: furniture, roofs, structures, floors last.
    expect(ziele(g.ghost)).toEqual([
      { piece: 'kiste_holz', reason: 'notEmpty', at: `${b.tx},${b.ty}` },
      { piece: 'wand_holz', reason: null, at: `${a.tx},${a.ty}` },
      { piece: 'steg_holz', reason: null, at: `${a.tx},${a.ty}` },
      { piece: 'steg_holz', reason: 'carriesLoad', at: `${b.tx},${b.ty}` },
    ]);
    // The UI sends the drag's targets in this order.
    const reasons = [
      w.rejection(w.act({ type: 'build.remove', ...b, ebene: 'objekt' })),
      w.rejection(w.act({ type: 'build.remove', ...a, ebene: 'struktur' })),
      w.rejection(w.act({ type: 'build.remove', ...a, ebene: 'boden' })),
      w.rejection(w.act({ type: 'build.remove', ...b, ebene: 'boden' })),
    ];
    expect(reasons).toEqual(g.ghost.targets.slice(0, g.ghost.targetCount).map((t) => t.reason));
  });

  it('eine geleerte Kiste ist im nächsten Frame grün (Kisteninhalt als Eingabe des Geist-Caches); ein unveränderter Frame urteilt nicht neu', () => {
    const w = lake();
    const chest = volleKiste(w, 14, 3);
    const g = geist(w, 'abbauen');
    judge(g, 14, 3);
    expect(ziele(g.ghost).map((z) => z.reason)).toEqual(['notEmpty']);
    const judged = g.ghost.toolRevision;
    frame(g, 14, 3);
    expect(g.ghost.toolRevision).toBe(judged);
    expect(w.rejection(w.act({ type: 'storage.takeAll', chest }))).toBeNull();
    // Nothing else changed: same cursor, same buildings, same bags count of the tool – only the chest's content.
    frame(g, 14, 3);
    expect(g.ghost.toolRevision).toBe(judged + 1);
    expect(ziele(g.ghost).map((z) => z.reason)).toEqual([null]);
    frame(g, 14, 3);
    expect(g.ghost.toolRevision).toBe(judged + 1);
    // Filled again: red in the next frame.
    w.give('stein', 1);
    expect(w.rejection(w.act({ type: 'storage.put', chest, from: w.slotOf('stein') }))).toBeNull();
    frame(g, 14, 3);
    expect(ziele(g.ghost).map((z) => z.reason)).toEqual(['notEmpty']);
  });
});
