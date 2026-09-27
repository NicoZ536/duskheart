/**
 * The build mode's tools in the ghost (`GhostView`, src/render/game/ghost.ts; MASTERPROMPT §16.6 "Aufwerten an Ort und
 * Stelle (Holz → Stein), Flächenreparatur, Abbauen (100 % zurück in den ersten 30 s, danach 60 %)"), judged on the real
 * game (`createSimulation`, tests/unit/game/bau-spielwelt.ts) – read-only, by the simulation's own data and rules, and
 * checked against what the simulation then does with the commands:
 *
 * - **Abbauen:** the topmost thing under the cursor (wall furniture, furniture, structure, roof, floor – `build.remove`'s
 *   order), a station (`station.remove`) or a torch (`light.take`); within 30 s of placing it comes back whole with the
 *   seconds left, later 60 % of its materials rounded down (the building system's refund), a blueprint nothing; out of
 *   reach refused. A drag takes everything in the rectangle, roofs before the walls that carry them – nothing
 *   collapses on the way.
 * - **Aufwerten:** the parts under the chosen piece's anchors it may replace (`isUpgrade`): plank to stone walls, one
 *   stone wall per target from the bags, not a palisade; the new piece drawn green over the old one.
 * - **Reparieren:** the damaged parts of the rectangle in reach, their cost (`repairCost`), a hammer in the hand, the
 *   materials at hand, the area's size.
 * Drawn: unlit fields in the tool's colours and the UI's short text over the cursor in the tool's tone – red when
 * nothing can be done (an area with nothing damaged in it is no refusal).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { BuildingSystem } from '../../../src/game/building/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import type { StationSystem } from '../../../src/game/stations/system';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { DebugOverlayList } from '../../../src/render/debugOverlay';
import { BuildGhost, createGhostFrame, GhostView, TOOL_COLORS, TOOL_LABEL_TONES, type BuildTool, type GhostFrame, type ToolTarget } from '../../../src/render/game/ghost';
import type { RenderScene } from '../../../src/render/scene';
import { LABEL_COLORS, WorldUiList } from '../../../src/render/worldUi/worldUi';
import { TILE_PX } from '../../../src/world/model/coords';
import { BAU_SPIEL_TIMEOUT_MS, bauSpiel, eventsOf, rejections, type BauSpiel } from '../game/bau-spielwelt';

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const NO_POINTER = { inside: false, x: 0, y: 0 } as const;
const TICK_HZ = BALANCE.time.tickHz;

interface Werkzeug {
  readonly g: BauSpiel;
  readonly ghost: BuildGhost;
  readonly view: GhostView;
  readonly f: GhostFrame;
}

function werkzeug(tool: BuildTool, piece: string | null = null): Werkzeug {
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

/** Judges the ghost with the cursor on site tile (x, y) (and the drag from site tile `von` when given). */
function judge(w: Werkzeug, x: number, y: number, von?: { x: number; y: number }): void {
  const p = { x: 0, y: 0 };
  w.g.sys<PlayerSystem>('player').position(w.g.sim, p);
  w.f.figureX = p.x;
  w.f.figureY = p.y;
  const t = w.g.at(x, y);
  w.ghost.padDx = t.tx - Math.floor(p.x / TILE_PX);
  w.ghost.padDy = t.ty - Math.floor(p.y / TILE_PX);
  const d = von === undefined ? null : w.g.at(von.x, von.y);
  w.ghost.dragTx = d === null ? Number.NaN : d.tx;
  w.ghost.dragTy = d === null ? Number.NaN : d.ty;
  // A fresh judgement every time (the verdicts are cached while nothing changes).
  w.view.update(w.g.sim, NO_POINTER, w.f, w.ghost);
  for (let i = 0; i < 16 && w.ghost.judgedTool !== w.ghost.tool; i++) w.view.update(w.g.sim, NO_POINTER, w.f, w.ghost);
}

function ziele(ghost: BuildGhost): ToolTarget[] {
  return ghost.targets.slice(0, ghost.targetCount).map((t) => ({ ...t, items: [...t.items] }));
}

/** Waits `seconds` of game time. */
function warte(w: Werkzeug, seconds: number): void {
  w.g.run([], Math.round(seconds * TICK_HZ));
}

function recordingScene(): { scene: RenderScene; labels: Array<{ text: string; color: number }> } {
  const worldUi = new WorldUiList();
  const scene = { sprite: new SpriteDesc(), sprites: { push: () => 0 }, worldUi } as unknown as RenderScene;
  const labels: Array<{ text: string; color: number }> = [];
  const orig = worldUi.label.bind(worldUi);
  worldUi.label = (x, y, text, tone = 'name') => {
    labels.push({ text, color: LABEL_COLORS[tone] });
    orig(x, y, text, tone);
  };
  return { scene, labels };
}

describe('Werkzeug Abbauen im Geist (M4-25)', { timeout: BAU_SPIEL_TIMEOUT_MS }, () => {
  it('eine Wand: in den ersten 30 s ganz zurück mit den Sekunden, danach 60 % der Materialien (abgerundet) – wie die Simulation sie gibt', () => {
    const w = werkzeug('abbauen');
    expect(w.g.build('wand_holz', 7, 4)).toEqual([]);
    judge(w, 7, 4);
    const [t] = ziele(w.ghost);
    expect(w.ghost.targetCount).toBe(1);
    expect(t).toMatchObject({ art: 'bauteil', piece: 'wand_holz', ebene: 'struktur', ...w.g.at(7, 4), refund: 'ganz', reason: null, blueprint: false });
    expect(t?.secondsLeft).toBeGreaterThanOrEqual(BALANCE.building.refund.fullSeconds - 1);
    expect(t?.secondsLeft).toBeLessThanOrEqual(BALANCE.building.refund.fullSeconds);
    expect(w.ghost).toMatchObject({ okCount: 1, firstReason: null, judgedTool: 'abbauen' });
    // Past the window: 60 % of three planks, rounded down – one plank; the simulation gives exactly that.
    warte(w, BALANCE.building.refund.fullSeconds + 1);
    judge(w, 7, 5);
    judge(w, 7, 4);
    const [spaet] = ziele(w.ghost);
    expect(spaet).toMatchObject({ refund: 'anteilig', secondsLeft: 0, items: [{ item: 'brett', count: 1 }] });
    const bretter = w.g.count('brett');
    const ev = w.g.run([{ type: 'build.remove', ...w.g.at(7, 4), ebene: 'struktur' }]);
    expect(rejections(ev)).toEqual([]);
    expect(eventsOf(ev, 'partRemoved')[0]).toMatchObject({ refund: 'anteilig' });
    expect(w.g.count('brett')).toBe(bretter + 1);
  });

  it('das Oberste unter dem Zeiger wie build.remove ohne Ebene: das Möbel vor dem Boden; eine Blaupause gibt nichts; zu weit ist abgelehnt', () => {
    const w = werkzeug('abbauen');
    expect(w.g.build('boden_holz', 3, 3)).toEqual([]);
    expect(w.g.build('stuhl_holz', 3, 3)).toEqual([]);
    judge(w, 3, 3);
    expect(ziele(w.ghost).map((t) => [t.piece, t.ebene])).toEqual([['stuhl_holz', 'objekt']]);
    expect(rejections(w.g.run([{ type: 'build.blueprint', part: 'wand_holz', ...w.g.at(8, 2) }]))).toEqual([]);
    judge(w, 8, 2);
    expect(ziele(w.ghost)[0]).toMatchObject({ piece: 'wand_holz', blueprint: true, refund: 'keine', reason: null });
    // Beyond the build reach of 8 tiles: planned standing next to it, judged from far away.
    w.g.stand(9, 7);
    expect(rejections(w.g.run([{ type: 'build.blueprint', part: 'wand_holz', ...w.g.at(10, 8) }]))).toEqual([]);
    w.g.run([{ type: 'player.teleport', x: (w.g.at(0, 0).tx - 3 + 0.5) * TILE_PX, y: (w.g.at(0, 0).ty - 3 + 0.5) * TILE_PX, layer: 0 }], 2);
    judge(w, 10, 8);
    expect(ziele(w.ghost)[0]?.reason).toBe('tooFar');
    expect(w.ghost.firstReason).toBe('tooFar');
    expect(w.ghost.okCount).toBe(0);
  });

  it('eine Fläche: alles darin, Wandmöbel und Möbel vor den Dächern, Dächer vor ihren Wänden, Böden zuletzt – nichts stürzt ein', () => {
    const w = werkzeug('abbauen');
    // A 3 × 3 hut (walls around one floor tile) with a straw roof and a stool inside.
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) if (x !== 2 || y !== 2) expect(w.g.build('wand_holz', x, y)).toEqual([]);
    expect(w.g.build('boden_holz', 2, 2)).toEqual([]);
    expect(w.g.build('hocker_holz', 2, 2)).toEqual([]);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) expect(w.g.build('dach_stroh', x, y)).toEqual([]);
    judge(w, 3, 3, { x: 1, y: 1 });
    const t = ziele(w.ghost);
    expect(t).toHaveLength(8 + 1 + 1 + 9);
    const ebenen = t.map((z) => z.ebene);
    const zuletzt = (e: string): number => ebenen.lastIndexOf(e as ToolTarget['ebene']);
    const zuerst = (e: string): number => ebenen.indexOf(e as ToolTarget['ebene']);
    expect(zuletzt('objekt')).toBeLessThan(zuerst('dach'));
    expect(zuletzt('dach')).toBeLessThan(zuerst('struktur'));
    expect(zuletzt('struktur')).toBeLessThan(zuerst('boden'));
    expect(w.ghost).toMatchObject({ okCount: 19, firstReason: null });
    // Sent in that order in one tick, everything comes down by hand – no roof tile collapses.
    const ev = w.g.run(t.map((z) => ({ type: 'build.remove' as const, tx: z.tx, ty: z.ty, ebene: z.ebene })));
    expect(rejections(ev)).toEqual([]);
    expect(eventsOf(ev, 'partRemoved').map((e) => e.reason)).toEqual(new Array<string>(19).fill('abgebaut'));
    expect(eventsOf(ev, 'roofCollapsed')).toEqual([]);
  });

  it('Stationen und Fackeln: die Werkbank mit ihrer Frist (station.remove), die Fackel ganz (light.take), ein Lagerfeuer bleibt stehen', () => {
    const w = werkzeug('abbauen');
    w.g.give('werkbank', 1);
    expect(rejections(w.g.run([{ type: 'station.place', from: w.g.slotOf('werkbank'), ...w.g.at(2, 2), mirror: true }]))).toEqual([]);
    judge(w, 2, 2);
    const station = w.g.sys<StationSystem>('stations').stationAt(0, w.g.at(2, 2).tx, w.g.at(2, 2).ty);
    expect(station?.gespiegelt).toBe(true);
    expect(ziele(w.ghost)).toMatchObject([{ art: 'station', piece: 'werkbank', id: station?.id, w: 2, h: 1, refund: 'ganz', mirror: true, reason: null }]);
    w.g.give('fackel', 1);
    expect(rejections(w.g.run([{ type: 'light.place', from: w.g.slotOf('fackel'), ...w.g.at(6, 3) }]))).toEqual([]);
    w.g.stand(6, 4);
    judge(w, 6, 3);
    expect(ziele(w.ghost)).toMatchObject([{ art: 'licht', piece: 'fackel', refund: 'ganz', reason: null }]);
    w.g.give('lagerfeuer', 1);
    expect(rejections(w.g.run([{ type: 'light.place', from: w.g.slotOf('lagerfeuer'), ...w.g.at(8, 5) }]))).toEqual([]);
    judge(w, 8, 5);
    expect(ziele(w.ghost)).toMatchObject([{ art: 'licht', piece: 'lagerfeuer', reason: 'notTakeable' }]);
    // The station within its window comes back whole.
    w.g.stand(2, 3);
    const ev = w.g.run([{ type: 'station.remove', station: station?.id ?? 0 }]);
    expect(rejections(ev)).toEqual([]);
    expect(w.g.count('werkbank')).toBe(1);
  });
});

describe('Werkzeug Aufwerten im Geist (M4-25)', { timeout: BAU_SPIEL_TIMEOUT_MS }, () => {
  it('Holz zu Stein: je Ziel eine Steinwand aus den Taschen; ohne sie fehlt Material, eine Palisade ist kein Aufwerten – und die Simulation sieht es genauso', () => {
    const w = werkzeug('aufwerten', 'wand_stein');
    for (const x of [3, 4, 5]) expect(w.g.build('wand_holz', x, 2)).toEqual([]);
    w.g.give('wand_stein', 2);
    // A drag along the line: two stone walls for three plank walls.
    judge(w, 5, 2, { x: 3, y: 2 });
    expect(ziele(w.ghost).map((t) => [t.piece, t.to, t.reason])).toEqual([
      ['wand_holz', 'wand_stein', null],
      ['wand_holz', 'wand_stein', null],
      ['wand_holz', 'wand_stein', 'noMaterial'],
    ]);
    expect(w.ghost).toMatchObject({ okCount: 2, firstReason: 'noMaterial', judgedTool: 'aufwerten' });
    const ev = w.g.run(ziele(w.ghost).map((t) => ({ type: 'build.upgrade' as const, tx: t.tx, ty: t.ty, part: 'wand_stein' })));
    expect(eventsOf(ev, 'partUpgraded').map((e) => e.to)).toEqual(['wand_stein', 'wand_stein']);
    expect(rejections(ev)).toEqual(['noMaterial']);
    // A palisade replaces nothing better; over empty ground there is no target.
    w.ghost.piece = 'wand_palisade';
    judge(w, 5, 2);
    expect(ziele(w.ghost)[0]?.reason).toBe('notUpgradable');
    judge(w, 7, 6);
    expect(w.ghost.targetCount).toBe(0);
  });
});

describe('Werkzeug Reparieren im Geist (M4-25)', { timeout: BAU_SPIEL_TIMEOUT_MS }, () => {
  it('beschädigte Teile der Fläche mit ihren Kosten; ohne Hammer, ohne Material, nichts beschädigt, zu groß – wie build.repair', () => {
    const w = werkzeug('reparieren');
    for (const x of [3, 5]) expect(w.g.build('wand_holz', x, 2)).toEqual([]);
    const building = w.g.sys<BuildingSystem>('building');
    for (const x of [3, 5]) building.damage(w.g.sim, 0, 'struktur', w.g.at(x, 2).tx, w.g.at(x, 2).ty, 150);
    judge(w, 6, 3, { x: 2, y: 1 });
    expect(w.ghost.repair).toMatchObject({ damaged: 2, hammer: false, reason: 'noHammer' });
    expect(ziele(w.ghost).map((t) => t.piece)).toEqual(['wand_holz', 'wand_holz']);
    w.g.hold('steinhammer');
    judge(w, 6, 4, { x: 2, y: 1 });
    judge(w, 6, 3, { x: 2, y: 1 });
    expect(w.ghost.repair).toMatchObject({ damaged: 2, mendable: 0, hammer: true, reason: 'noMaterial' });
    w.g.give('brett', 5);
    judge(w, 6, 4, { x: 2, y: 1 });
    judge(w, 6, 3, { x: 2, y: 1 });
    // Half its hit points: half of half of three planks, rounded up – one plank per wall.
    expect(w.ghost.repair).toMatchObject({ damaged: 2, mendable: 2, reason: null, cost: [{ item: 'brett', count: 2 }] });
    expect(w.ghost.okCount).toBe(2);
    const q = w.ghost.repair;
    const ev = w.g.run([{ type: 'build.repair', tx0: w.g.at(2, 1).tx, ty0: w.g.at(2, 1).ty, tx1: w.g.at(6, 3).tx, ty1: w.g.at(6, 3).ty }]);
    expect(rejections(ev)).toEqual([]);
    expect(eventsOf(ev, 'partRepaired')).toHaveLength(2);
    expect(w.g.count('brett')).toBe(5 - (q.cost[0]?.count ?? 0));
    judge(w, 6, 4, { x: 2, y: 1 });
    judge(w, 6, 3, { x: 2, y: 1 });
    expect(w.ghost.repair).toMatchObject({ damaged: 0, reason: 'nothingToRepair' });
    judge(w, 2 + BALANCE.building.repair.maxAreaTiles, 3, { x: 2, y: 1 });
    expect(w.ghost.repair.reason).toBe('areaTooLarge');
  });
});

describe('Werkzeuge gezeichnet', { timeout: BAU_SPIEL_TIMEOUT_MS }, () => {
  it('Felder in den Farben des Werkzeugs, der kurze Text der UI über dem Zeiger in seinem Ton – rot, wenn nichts geht', () => {
    const w = werkzeug('abbauen');
    expect(w.g.build('wand_holz', 7, 4)).toEqual([]);
    judge(w, 7, 4);
    w.ghost.toolLabel = '100 % zurück (noch 29 s)';
    const overlay = new DebugOverlayList();
    const { scene, labels } = recordingScene();
    w.view.draw(scene, ATLAS, w.g.sim, w.f, w.ghost, overlay);
    const colors = new Set<number>();
    for (let i = 0; i < overlay.count; i++) colors.add(overlay.entry(i)?.color ?? 0);
    // The wall's footprint: the amber field and its frame.
    expect(colors).toEqual(new Set([TOOL_COLORS.abbauen.fill, TOOL_COLORS.abbauen.edge]));
    expect(w.view.drawn).toBe(1);
    expect(labels).toEqual([{ text: '100 % zurück (noch 29 s)', color: LABEL_COLORS[TOOL_LABEL_TONES.abbauen] }]);
    // Refused (out of reach): the text in the enemy red.
    w.g.run([{ type: 'player.teleport', x: (w.g.at(0, 0).tx - 6 + 0.5) * TILE_PX, y: (w.g.at(0, 0).ty - 6 + 0.5) * TILE_PX, layer: 0 }], 2);
    judge(w, 7, 4);
    expect(w.ghost.firstReason).toBe('tooFar');
    const again = recordingScene();
    w.view.draw(again.scene, ATLAS, w.g.sim, w.f, w.ghost, new DebugOverlayList());
    expect(again.labels[0]?.color).toBe(LABEL_COLORS.feind);
    expect(TOOL_COLORS.abbauen.fill).not.toBe(TOOL_COLORS.refused.fill);
  });

  it('Reparieren: ohne Hammer rot; eine heile Fläche ist keine Ablehnung – „Nichts zu reparieren“ im Ton des Werkzeugs', () => {
    const w = werkzeug('reparieren');
    expect(w.g.build('wand_holz', 4, 2)).toEqual([]);
    const label = (): number | undefined => {
      w.ghost.toolLabel = 'Nichts zu reparieren';
      const r = recordingScene();
      w.view.draw(r.scene, ATLAS, w.g.sim, w.f, w.ghost, new DebugOverlayList());
      return r.labels[0]?.color;
    };
    judge(w, 6, 3, { x: 2, y: 1 });
    expect(w.ghost.repair.reason).toBe('noHammer');
    expect(label()).toBe(LABEL_COLORS.feind);
    w.g.hold('steinhammer');
    judge(w, 6, 4, { x: 2, y: 1 });
    judge(w, 6, 3, { x: 2, y: 1 });
    expect(w.ghost.repair.reason).toBe('nothingToRepair');
    expect(label()).toBe(LABEL_COLORS[TOOL_LABEL_TONES.reparieren]);
  });
});
