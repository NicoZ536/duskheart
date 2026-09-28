/**
 * M5-36: the build mode's ghost knows what other systems keep standing before the click (M4-Gate, ADR-0048/0049) – it
 * asks their public, read-only `removalProblem` (src/game/storage, src/game/hearth, src/game/stations) on the real game
 * (`createSimulation`, tests/unit/game/bau-spielwelt.ts), and the simulation then refuses exactly those:
 *
 * - a chest with items is red with `notEmpty` (dismantling and replacing it), empty it comes down;
 * - a lit hearth is red with `burning`, put out but holding fuel with `notEmpty`, empty and out it comes down;
 * - a workbench at which an order is worked is red with `inUse`, after the order is cancelled it comes down;
 * - free targets beside them (a wall, the empty chest) stay in the tool's amber; in a drag the refused ones are drawn red
 *   and the status names their reason, the short text over the cursor included (`ui.bau.grund.*`, DE and EN).
 */
import { describe, expect, it } from 'vitest';
import type { HearthSystem } from '../../../src/game/hearth/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import type { StationSystem } from '../../../src/game/stations/system';
import type { StorageSystem } from '../../../src/game/storage/system';
import { createI18n } from '../../../src/i18n';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { DebugOverlayList } from '../../../src/render/debugOverlay';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { BuildGhost, createGhostFrame, GhostView, TOOL_COLORS, type BuildTool, type GhostFrame, type ToolTarget } from '../../../src/render/game/ghost';
import type { RenderScene } from '../../../src/render/scene';
import { WorldUiList } from '../../../src/render/worldUi/worldUi';
import { werkzeugBefund, werkzeugText } from '../../../src/ui/screens/bau/werkzeugStatus';
import { TILE_PX } from '../../../src/world/model/coords';
import { BAU_SPIEL_TIMEOUT_MS, bauSpiel, rejections, type BauSpiel } from '../game/bau-spielwelt';

const ATLAS: AtlasData = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return { manifest: manifestFromGenerated(mod), albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
})();

const NO_POINTER = { inside: false, x: 0, y: 0 } as const;

interface Geist {
  readonly g: BauSpiel;
  readonly ghost: BuildGhost;
  readonly view: GhostView;
  readonly f: GhostFrame;
}

function geist(tool: BuildTool, piece: string | null = null): Geist {
  const g = bauSpiel();
  const ghost = new BuildGhost();
  ghost.active = true;
  ghost.tool = tool;
  ghost.piece = piece;
  const f = createGhostFrame();
  f.hasFigure = true;
  f.reasonLabel = (reason) => `grund:${reason}`;
  return { g, ghost, view: new GhostView(), f };
}

/** Judges the ghost afresh with the cursor on site tile (x, y) (and the drag from site tile `von`). */
function judge(w: Geist, x: number, y: number, von?: { x: number; y: number }): void {
  const p = { x: 0, y: 0 };
  w.g.sys<PlayerSystem>('player').position(w.g.sim, p);
  w.f.figureX = p.x;
  w.f.figureY = p.y;
  const t = w.g.at(x, y);
  const d = von === undefined ? null : w.g.at(von.x, von.y);
  // Another cursor first: the verdicts are cached while their inputs stay (a chest's content is none of them).
  w.ghost.padDx = t.tx + 1 - Math.floor(p.x / TILE_PX);
  w.ghost.padDy = t.ty - Math.floor(p.y / TILE_PX);
  w.ghost.dragTx = Number.NaN;
  w.ghost.dragTy = Number.NaN;
  w.view.update(w.g.sim, NO_POINTER, w.f, w.ghost);
  w.ghost.padDx = t.tx - Math.floor(p.x / TILE_PX);
  w.ghost.dragTx = d === null ? Number.NaN : d.tx;
  w.ghost.dragTy = d === null ? Number.NaN : d.ty;
  w.view.update(w.g.sim, NO_POINTER, w.f, w.ghost);
}

function ziele(ghost: BuildGhost): Array<Pick<ToolTarget, 'art' | 'piece' | 'reason'>> {
  return ghost.targets.slice(0, ghost.targetCount).map((t) => ({ art: t.art, piece: t.piece, reason: t.reason }));
}

/** A wooden crate on site tile (x, y) with `stein` in it; returns its id. */
function volleKiste(w: Geist, x: number, y: number): number {
  expect(w.g.build('kiste_holz', x, y)).toEqual([]);
  const at = w.g.at(x, y);
  const chest = w.g.sys<StorageSystem>('storage').chestAt(0, at.tx, at.ty);
  if (chest === undefined) throw new Error('no chest');
  w.g.give('stein', 3);
  expect(rejections(w.g.run([{ type: 'storage.put', chest: chest.id, from: w.g.slotOf('stein') }]))).toEqual([]);
  return chest.id;
}

describe('Abbau-Vorschau mit den Regeln der anderen Systeme (M5-36)', { timeout: BAU_SPIEL_TIMEOUT_MS }, () => {
  it('eine Kiste mit Inhalt: rot mit „notEmpty“ schon vor dem Klick, leer frei – die Simulation urteilt genauso', () => {
    const w = geist('abbauen');
    const chest = volleKiste(w, 7, 4);
    judge(w, 7, 4);
    expect(ziele(w.ghost)).toEqual([{ art: 'bauteil', piece: 'kiste_holz', reason: 'notEmpty' }]);
    expect(w.ghost).toMatchObject({ okCount: 0, firstReason: 'notEmpty' });
    const remove = { type: 'build.remove' as const, ...w.g.at(7, 4) };
    expect(rejections(w.g.run([remove]))).toEqual(['notEmpty']);
    expect(rejections(w.g.run([{ type: 'storage.takeAll', chest }]))).toEqual([]);
    judge(w, 7, 4);
    expect(ziele(w.ghost)).toEqual([{ art: 'bauteil', piece: 'kiste_holz', reason: null }]);
    expect(rejections(w.g.run([remove]))).toEqual([]);
    expect(w.g.sys<StorageSystem>('storage').chests).toHaveLength(0);
  });

  it('das Herdfeuer: brennend „burning“, aus mit Vorrat „notEmpty“, leer und aus frei – wie build.remove', () => {
    const w = geist('abbauen');
    expect(w.g.build('herdfeuer', 1, 1)).toEqual([]);
    const at = w.g.at(1, 1);
    const hearth = w.g.sys<HearthSystem>('hearth').hearthAt(0, at.tx, at.ty);
    if (hearth === undefined) throw new Error('no hearth');
    const remove = { type: 'build.remove' as const, ...w.g.at(2, 2) };
    judge(w, 2, 2);
    expect(ziele(w.ghost)).toEqual([{ art: 'bauteil', piece: 'herdfeuer', reason: null }]);
    w.g.give('holz', 2);
    expect(rejections(w.g.run([{ type: 'hearth.fuel', hearth: hearth.id, from: w.g.slotOf('holz'), count: 2 }, { type: 'hearth.ignite', hearth: hearth.id }]))).toEqual([]);
    judge(w, 2, 2);
    expect(ziele(w.ghost)).toEqual([{ art: 'bauteil', piece: 'herdfeuer', reason: 'burning' }]);
    expect(rejections(w.g.run([remove]))).toEqual(['burning']);
    expect(rejections(w.g.run([{ type: 'hearth.douse', hearth: hearth.id }]))).toEqual([]);
    judge(w, 2, 2);
    expect(ziele(w.ghost)[0]?.reason).toBe('notEmpty');
    expect(rejections(w.g.run([remove]))).toEqual(['notEmpty']);
    expect(rejections(w.g.run([{ type: 'hearth.take', hearth: hearth.id, index: 0 }]))).toEqual([]);
    judge(w, 2, 2);
    expect(ziele(w.ghost)[0]?.reason).toBeNull();
    expect(rejections(w.g.run([remove]))).toEqual([]);
  });

  it('eine Werkbank mit laufendem Auftrag: rot mit „inUse“, nach dem Abbruch frei – wie station.remove', () => {
    const w = geist('abbauen');
    w.g.give('werkbank', 1);
    expect(rejections(w.g.run([{ type: 'station.place', from: w.g.slotOf('werkbank'), ...w.g.at(6, 2) }]))).toEqual([]);
    const bench = w.g.sys<StationSystem>('stations').placed[0]?.id as number;
    w.g.stand(6, 3);
    for (const [item, count] of [
      ['holz', 8],
      ['zweig', 4],
      ['faserseil', 2],
    ] as const) {
      w.g.give(item, count);
    }
    expect(rejections(w.g.run([{ type: 'craft.start', recipe: 'rezept_saegebock', count: 1 }], 2))).toEqual([]);
    judge(w, 6, 2);
    expect(ziele(w.ghost)).toEqual([{ art: 'station', piece: 'werkbank', reason: 'inUse' }]);
    expect(rejections(w.g.run([{ type: 'station.remove', station: bench }]))).toEqual(['inUse']);
    expect(rejections(w.g.run([{ type: 'craft.cancel', index: 0 }]))).toEqual([]);
    judge(w, 6, 2);
    expect(ziele(w.ghost)).toEqual([{ art: 'station', piece: 'werkbank', reason: null }]);
    expect(rejections(w.g.run([{ type: 'station.remove', station: bench }]))).toEqual([]);
  });

  it('Aufwerten: die volle Kiste zur Truhe ist rot mit „notEmpty“ – wie build.upgrade', () => {
    const w = geist('aufwerten', 'truhe');
    volleKiste(w, 7, 4);
    w.g.give('truhe', 1);
    judge(w, 7, 4);
    expect(w.ghost.targets.slice(0, w.ghost.targetCount).map((t) => [t.piece, t.to, t.reason])).toEqual([['kiste_holz', 'truhe', 'notEmpty']]);
    expect(rejections(w.g.run([{ type: 'build.upgrade', ...w.g.at(7, 4), part: 'truhe' }]))).toEqual(['notEmpty']);
  });

  it('eine Fläche: die drei Fälle rot mit Grund, die Wand und die leere Kiste frei; gezeichnet rot und bernstein, Status und kurzer Text in DE und EN', () => {
    const w = geist('abbauen');
    volleKiste(w, 7, 1);
    expect(w.g.build('kiste_holz', 8, 1)).toEqual([]);
    expect(w.g.build('wand_holz', 9, 1)).toEqual([]);
    expect(w.g.build('herdfeuer', 1, 1)).toEqual([]);
    const at = w.g.at(1, 1);
    const hearth = w.g.sys<HearthSystem>('hearth').hearthAt(0, at.tx, at.ty);
    if (hearth === undefined) throw new Error('no hearth');
    w.g.give('holz', 10);
    expect(rejections(w.g.run([{ type: 'hearth.fuel', hearth: hearth.id, from: w.g.slotOf('holz'), count: 2 }, { type: 'hearth.ignite', hearth: hearth.id }]))).toEqual([]);
    w.g.give('werkbank', 1);
    expect(rejections(w.g.run([{ type: 'station.place', from: w.g.slotOf('werkbank'), ...w.g.at(5, 1) }]))).toEqual([]);
    w.g.stand(5, 3);
    w.g.give('zweig', 4);
    w.g.give('faserseil', 2);
    expect(rejections(w.g.run([{ type: 'craft.start', recipe: 'rezept_saegebock', count: 1 }], 2))).toEqual([]);
    judge(w, 9, 3, { x: 1, y: 1 });
    const t = ziele(w.ghost);
    const grund = (piece: string): Array<string | null> => t.filter((z) => z.piece === piece).map((z) => z.reason);
    expect(grund('kiste_holz')).toEqual(['notEmpty', null]);
    expect(grund('herdfeuer')).toEqual(['burning']);
    expect(grund('werkbank')).toEqual(['inUse']);
    expect(grund('wand_holz')).toEqual([null]);
    expect(w.ghost.okCount).toBe(2);
    // Drawn: every refused target on the red field, the free ones on the amber one.
    const overlay = new DebugOverlayList();
    const scene = { sprite: new SpriteDesc(), sprites: { push: () => 0 }, worldUi: new WorldUiList() } as unknown as RenderScene;
    w.view.draw(scene, ATLAS, w.g.sim, w.f, w.ghost, overlay);
    const fills = new Map<number, number>();
    for (let i = 0; i < overlay.count; i++) {
      const c = overlay.entry(i)?.color ?? 0;
      fills.set(c, (fills.get(c) ?? 0) + 1);
    }
    expect(fills.get(TOOL_COLORS.refused.fill)).toBe(3);
    expect(fills.get(TOOL_COLORS.abbauen.fill)).toBe(2);
    // The status line: two come down, and why the rest stays (the first refused target in the drag's order, the hearth)
    // – before the click; one refused target alone names its reason over the cursor.
    for (const lang of ['de', 'en'] as const) {
      const i18n = createI18n(lang, { strict: true });
      const text = werkzeugText(i18n, werkzeugBefund(w.ghost, null) ?? fail());
      expect(text.status).toContain(i18n.t('ui.build.reject.burning'));
      for (const reason of ['notEmpty', 'burning', 'inUse']) expect(i18n.has(`ui.bau.grund.${reason}`), `${lang}: ${reason}`).toBe(true);
    }
    judge(w, 5, 1);
    const de = createI18n('de', { strict: true });
    expect(werkzeugText(de, werkzeugBefund(w.ghost, null) ?? fail())).toEqual({ status: de.t('ui.station.reject.inUse'), warnung: true, label: 'Arbeitet noch' });
  });
});

function fail(): never {
  throw new Error('no tool verdict');
}
