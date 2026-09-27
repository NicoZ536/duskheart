/**
 * M4-22/M4-23 in the game view (`GhostView`): the ghost preview judges every planned anchor by the building system's
 * own rules (`BuildingSystem.preview`, read-only) – green where it can be placed, red with the reason where not
 * ("Blockiert", "Zu weit", "Keine Stütze in Reichweite"); the pieces in the bags cap a drag; planned roof tiles carry
 * each other and are placed nearest-to-the-support first; the pipette reads the piece under the cursor as it stands;
 * the verdicts name the piece they were judged for. Drawn: one tinted, dithered sprite and one unlit field per anchor,
 * the first reason centred over the cursor in the world UI. Blueprint mode (M4-24): the anchors judged as
 * `build.blueprint` judges them – no material, not blocked by the player's body, planned walls carry planned roofs,
 * stations cannot be planned – and drawn like a placed blueprint on a blue field; outside it a missing part names the
 * blueprint toggle above its reason in the plan's blue.
 */
import { describe, expect, it } from 'vitest';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { DebugOverlayList } from '../../../src/render/debugOverlay';
import { BLUEPRINT_LOOK } from '../../../src/render/game/building';
import { BuildGhost, createGhostFrame, GHOST_COLORS, GhostView, PLAN_HINT_TONE, type GhostFrame } from '../../../src/render/game/ghost';
import type { RenderScene } from '../../../src/render/scene';
import { rgbaFromHex } from '../../../src/render/text/textBatch';
import { LABEL_COLORS, WorldUiList } from '../../../src/render/worldUi/worldUi';
import { bauWelt, hut, type BauWelt } from '../game/bau-testwelt';
import { meadow, OFFSET } from '../game/spieler-testwelt';

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const T = 16;
/** The pointer outside the canvas: the cursor is the player's tile plus the gamepad offset. */
const NO_POINTER = { inside: false, x: 0, y: 0 } as const;

interface Setup {
  readonly w: BauWelt;
  readonly ghost: BuildGhost;
  readonly view: GhostView;
  readonly f: GhostFrame;
}

/** A meadow with the player on drawn tile (10, 12) and the build mode on with `piece`. */
function setup(piece: string): Setup {
  const w = bauWelt(meadow(28, 24));
  w.spawn(10, 12);
  const ghost = new BuildGhost();
  ghost.active = true;
  ghost.piece = piece;
  const f = createGhostFrame();
  f.hasFigure = true;
  f.reasonLabel = (reason) => `grund:${reason}`;
  return { w, ghost, view: new GhostView(), f };
}

/** Judges the ghost with the cursor on drawn tile (x, y) (and the drag start on (dx, dy) when given). */
function judge(s: Setup, x: number, y: number, drag?: { x: number; y: number }): void {
  const p = s.w.pos();
  s.f.figureX = p.x;
  s.f.figureY = p.y;
  s.ghost.padDx = OFFSET + x - Math.floor(p.x / T);
  s.ghost.padDy = OFFSET + y - Math.floor(p.y / T);
  s.ghost.dragTx = drag === undefined ? Number.NaN : OFFSET + drag.x;
  s.ghost.dragTy = drag === undefined ? Number.NaN : OFFSET + drag.y;
  s.view.update(s.w.sim, NO_POINTER, s.f, s.ghost);
}

/** Planned anchors (drawn coordinates) with their verdicts. */
function verdicts(g: BuildGhost): Array<[number, number, string | null]> {
  const out: Array<[number, number, string | null]> = [];
  for (let i = 0; i < g.plan.length / 2; i++) out.push([(g.plan[2 * i] as number) - OFFSET, (g.plan[2 * i + 1] as number) - OFFSET, g.verdicts[i] ?? null]);
  return out;
}

function give(w: BauWelt, item: string, n: number): void {
  w.inventory.give(w.sim, item, n);
}

describe('Geister-Vorschau: Urteil je Anker (M4-22)', () => {
  it('grün auf freiem Boden; ein Zug setzt höchstens so viele Teile, wie die Taschen haben – der Rest fehlt', () => {
    const s = setup('wand_holz');
    give(s.w, 'wand_holz', 3);
    judge(s, 12, 12);
    expect(s.ghost.cursorValid).toBe(true);
    expect([s.ghost.cursorTx - OFFSET, s.ghost.cursorTy - OFFSET]).toEqual([12, 12]);
    expect(verdicts(s.ghost)).toEqual([[12, 12, null]]);
    expect(s.ghost).toMatchObject({ okCount: 1, firstReason: null, available: 3, judged: 'wand_holz', judgedSource: 'bauteil' });
    // A drag of five walls with three in the bags.
    judge(s, 12, 8, { x: 12, y: 4 });
    expect(verdicts(s.ghost)).toEqual([
      [12, 4, null],
      [12, 5, null],
      [12, 6, null],
      [12, 7, 'noMaterial'],
      [12, 8, 'noMaterial'],
    ]);
    expect(s.ghost.okCount).toBe(3);
    expect(s.ghost.firstReason).toBe('noMaterial');
  });

  it('rot mit Grund: ein belegtes Tile ist blockiert, ein Tile jenseits der Baureichweite zu weit', () => {
    const s = setup('wand_holz');
    expect(s.w.build('wand_holz', 13, 12)).toBeNull();
    give(s.w, 'wand_holz', 2);
    judge(s, 13, 12);
    expect(s.ghost.firstReason).toBe('blocked');
    judge(s, 20, 12);
    expect(s.ghost.firstReason).toBe('tooFar');
    expect(s.ghost.okCount).toBe(0);
  });

  it('Dächer im Plan tragen einander: über dem Haus ist alles setzbar, die Stütznächsten zuerst; weiter als die Reichweite nicht', () => {
    const s = setup('dach_stroh');
    hut(s.w, 8, 6, 12, 10, 'wand_holz', 'tuer_holz', null);
    give(s.w, 'dach_stroh', 60);
    // The whole house (7 × 7 with its walls) as one drag from its north-west corner.
    judge(s, 13, 11, { x: 7, y: 5 });
    const v = verdicts(s.ghost);
    expect(v).toHaveLength(49);
    expect(v.every(([, , r]) => r === null)).toBe(true);
    // Placing order: first the tiles over the walls (distance 0), the middle last.
    expect(v.slice(0, 24).every(([x, y]) => x === 7 || x === 13 || y === 5 || y === 11)).toBe(true);
    expect(v[48]?.slice(0, 2)).toEqual([10, 8]);
    // Straw carries 3 tiles: a strip reaching 4 tiles east of the east wall ends in a refused tile.
    judge(s, 17, 8, { x: 14, y: 8 });
    expect(verdicts(s.ghost)).toEqual([
      [14, 8, null],
      [15, 8, null],
      [16, 8, null],
      [17, 8, 'noSupport'],
    ]);
    expect(s.ghost.firstReason).toBe('noSupport');
  });

  it('ein Dachzug urteilt ohne neue Puffer: nach dem ersten Urteil legt `chainRoofs` keine Typed Arrays mehr an (M4-Gate, §30)', () => {
    const s = setup('dach_stroh');
    hut(s.w, 8, 6, 12, 10, 'wand_holz', 'tuer_holz', null);
    give(s.w, 'dach_stroh', 60);
    // Two drags of different size, each judged once to grow the kept buffers.
    judge(s, 13, 11, { x: 7, y: 5 });
    judge(s, 12, 10, { x: 7, y: 5 });
    const counted = { n: 0 };
    const original = { i16: globalThis.Int16Array, i32: globalThis.Int32Array, u8: globalThis.Uint8Array };
    const count = <T extends object>(ctor: T): T =>
      new Proxy(ctor, {
        construct(target, args, newTarget) {
          counted.n++;
          return Reflect.construct(target as unknown as new (...a: unknown[]) => object, args, newTarget) as object;
        },
      });
    try {
      globalThis.Int16Array = count(original.i16);
      globalThis.Int32Array = count(original.i32);
      globalThis.Uint8Array = count(original.u8);
      for (let k = 0; k < 20; k++) judge(s, k % 2 === 0 ? 13 : 12, k % 2 === 0 ? 11 : 10, { x: 7, y: 5 });
    } finally {
      globalThis.Int16Array = original.i16;
      globalThis.Int32Array = original.i32;
      globalThis.Uint8Array = original.u8;
    }
    expect(counted.n).toBe(0);
    // The chained verdicts are unchanged: the whole 7 × 7 roof is placeable.
    judge(s, 13, 11, { x: 7, y: 5 });
    expect(verdicts(s.ghost).every(([, , r]) => r === null)).toBe(true);
  });

  it('Pipette: das Teil unter dem Cursor, gedreht und gespiegelt, wie es steht; über leerem Boden nichts', () => {
    const s = setup('wand_holz');
    give(s.w, 'tor_holz', 1);
    const events = s.w.act({ type: 'build.place', part: 'tor_holz', tx: OFFSET + 13, ty: OFFSET + 12, rot: 1 });
    expect(s.w.rejection(events)).toBeNull();
    judge(s, 13, 12);
    expect(s.ghost.hovered).toMatchObject({ piece: 'tor_holz', source: 'bauteil', rot: 1, mirror: false });
    judge(s, 15, 15);
    expect(s.ghost.hovered.piece).toBeNull();
  });

  it('ohne Wahl, ohne Figur oder außerhalb des Baumodus bleibt der Plan leer und benennt kein Teil', () => {
    const s = setup('wand_holz');
    judge(s, 12, 12);
    expect(s.ghost.plan.length).toBe(2);
    s.ghost.piece = null;
    judge(s, 12, 12);
    expect(s.ghost.plan).toEqual([]);
    expect(s.ghost.judged).toBeNull();
    s.ghost.piece = 'wand_holz';
    s.ghost.active = false;
    judge(s, 12, 12);
    expect(s.ghost.plan).toEqual([]);
    expect(s.ghost.cursorValid).toBe(false);
    expect(s.ghost.judged).toBeNull();
  });
});

describe('Geister-Vorschau: Zeichnung (M4-22)', () => {
  it('je Anker ein getöntes, halb gedithertes Sprite und ein Feld in Grün oder Rot; der erste Grund mittig über dem Cursor', () => {
    const s = setup('wand_holz');
    give(s.w, 'wand_holz', 2);
    judge(s, 12, 9, { x: 12, y: 7 });
    expect(s.ghost.okCount).toBe(2);
    const sprites: SpriteDesc[] = [];
    const scene = {
      sprite: new SpriteDesc(),
      sprites: {
        push(d: SpriteDesc) {
          sprites.push(Object.assign(new SpriteDesc(), d));
          return sprites.length - 1;
        },
      },
      worldUi: new WorldUiList(),
    } as unknown as RenderScene;
    const overlay = new DebugOverlayList();
    s.view.draw(scene, ATLAS, s.w.sim, s.f, s.ghost, overlay);
    expect(sprites).toHaveLength(3);
    for (const d of sprites) {
      expect(d.fade).toBeGreaterThan(0);
      expect(d.tintStrength).toBeGreaterThan(0);
    }
    const fields: number[] = [];
    for (let i = 0; i < overlay.count; i++) {
      const e = overlay.entry(i);
      if (e?.kind === 'rect' && e.width === T && e.height === T) fields.push(e.color);
    }
    expect(fields).toEqual([GHOST_COLORS.ok.fill, GHOST_COLORS.ok.fill, GHOST_COLORS.refused.fill]);
    const ui = (scene as unknown as { worldUi: WorldUiList }).worldUi;
    expect(ui.count).toBe(1);
    const label = ui.entry(0);
    expect(label?.text).toBe('grund:noMaterial');
    expect(label?.x).toBe((OFFSET + 12 + 0.5) * T);
    expect(label?.y).toBeLessThan((OFFSET + 9) * T - T);
    expect(s.view.drawn).toBe(6);
  });
});

/** A scene that records the pushed sprites (copies) and the world UI. */
function recordingScene(): { scene: RenderScene; sprites: SpriteDesc[]; ui: WorldUiList } {
  const sprites: SpriteDesc[] = [];
  const ui = new WorldUiList();
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        sprites.push(Object.assign(new SpriteDesc(), d));
        return sprites.length - 1;
      },
    },
    worldUi: ui,
  } as unknown as RenderScene;
  return { scene, sprites, ui };
}

/** Colours of the unlit tile fields the ghost drew. */
function fieldColors(overlay: DebugOverlayList): number[] {
  const out: number[] = [];
  for (let i = 0; i < overlay.count; i++) {
    const e = overlay.entry(i);
    if (e?.kind === 'rect' && e.width === T && e.height === T) out.push(e.color);
  }
  return out;
}

describe('Geister-Vorschau: Blaupausen planen (M4-24)', () => {
  it('ohne Material ist jeder freie Anker planbar – als Teil fehlten alle; ein Zug ist nicht durch die Taschen begrenzt', () => {
    const s = setup('wand_holz');
    judge(s, 12, 8, { x: 12, y: 4 });
    expect(verdicts(s.ghost).map((v) => v[2])).toEqual(['noMaterial', 'noMaterial', 'noMaterial', 'noMaterial', 'noMaterial']);
    expect(s.ghost.judgedBlueprint).toBe(false);
    s.ghost.blueprint = true;
    judge(s, 12, 8, { x: 12, y: 4 });
    expect(verdicts(s.ghost).map((v) => v[2])).toEqual([null, null, null, null, null]);
    expect(s.ghost).toMatchObject({ okCount: 5, firstReason: null, available: 0, judgedBlueprint: true });
    // The rules of the ground stay: an occupied tile and a tile beyond the reach are refused as plans too.
    expect(s.w.build('wand_holz', 13, 12)).toBeNull();
    judge(s, 13, 12);
    expect(s.ghost.firstReason).toBe('blocked');
    judge(s, 20, 12);
    expect(s.ghost.firstReason).toBe('tooFar');
  });

  it('der Körper des Spielers blockiert keinen Plan (eine Blaupause kollidiert nicht)', () => {
    const s = setup('wand_holz');
    give(s.w, 'wand_holz', 1);
    judge(s, 10, 12);
    expect(s.ghost.firstReason).toBe('blocked');
    s.ghost.blueprint = true;
    judge(s, 10, 12);
    expect(s.ghost.firstReason).toBeNull();
  });

  it('geplante Wände tragen ein geplantes Dach; als Teil trägt eine Blaupause nichts', () => {
    const s = setup('dach_stroh');
    for (let x = 12; x <= 14; x++) expect(s.w.rejection(s.w.act({ type: 'build.blueprint', part: 'wand_holz', tx: OFFSET + x, ty: OFFSET + 8 }))).toBeNull();
    give(s.w, 'dach_stroh', 9);
    judge(s, 14, 10, { x: 12, y: 8 });
    expect(verdicts(s.ghost).every(([, , r]) => r === 'noSupport')).toBe(true);
    s.ghost.blueprint = true;
    judge(s, 14, 10, { x: 12, y: 8 });
    expect(verdicts(s.ghost)).toHaveLength(9);
    expect(verdicts(s.ghost).every(([, , r]) => r === null)).toBe(true);
    // Placing order: the tiles over the planned walls first.
    expect(verdicts(s.ghost).slice(0, 3).every(([, y]) => y === 8)).toBe(true);
  });

  it('eine Station hat keinen Plan: nicht planbar', () => {
    const s = setup('werkbank');
    s.ghost.source = 'station';
    s.ghost.blueprint = true;
    judge(s, 12, 12);
    expect(verdicts(s.ghost)).toEqual([[12, 12, 'notPlannable']]);
    expect(s.ghost).toMatchObject({ okCount: 0, firstReason: 'notPlannable', judgedSource: 'station', judgedBlueprint: true });
  });

  it('gezeichnet wie eine gesetzte Blaupause (Planblau, halb gedithert) auf blauem Feld; Abgelehntes bleibt rot', () => {
    const s = setup('wand_holz');
    expect(s.w.build('wand_holz', 12, 7)).toBeNull();
    s.ghost.blueprint = true;
    judge(s, 12, 9, { x: 12, y: 6 });
    expect(verdicts(s.ghost).map((v) => v[2])).toEqual([null, 'blocked', null, null]);
    s.ghost.planHint = '[G] Blaupause';
    const { scene, sprites, ui } = recordingScene();
    const overlay = new DebugOverlayList();
    s.view.draw(scene, ATLAS, s.w.sim, s.f, s.ghost, overlay);
    expect(fieldColors(overlay)).toEqual([GHOST_COLORS.plan.fill, GHOST_COLORS.refused.fill, GHOST_COLORS.plan.fill, GHOST_COLORS.plan.fill]);
    expect(sprites.length).toBeGreaterThanOrEqual(4);
    const planned = sprites.filter((d) => d.tintR === BLUEPRINT_LOOK.r && d.tintG === BLUEPRINT_LOOK.g && d.tintB === BLUEPRINT_LOOK.b);
    expect(planned.length).toBeGreaterThanOrEqual(3);
    for (const d of planned) {
      expect(d.fade).toBe(BLUEPRINT_LOOK.fade);
      expect(d.tintStrength).toBe(BLUEPRINT_LOOK.strength);
    }
    // Only the reason of the refused anchor, no hint of the toggle (the mode is on).
    expect(ui.count).toBe(1);
    expect(ui.entry(0)?.text).toBe('grund:blocked');
  });

  it('fehlt ein Teil außerhalb des Modus, steht der Schalter über dem Grund – im Blau des Plans; mit Material, im Modus, bei Stationen oder ungebunden nicht', () => {
    // The hint's tone is the plan's blue (the tone and the look are held together here).
    expect(LABEL_COLORS[PLAN_HINT_TONE]).toBe(rgbaFromHex(`#${[BLUEPRINT_LOOK.r, BLUEPRINT_LOOK.g, BLUEPRINT_LOOK.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`));
    const s = setup('wand_holz');
    s.ghost.planHint = '[G] Blaupause';
    judge(s, 12, 12);
    expect(s.ghost.firstReason).toBe('noMaterial');
    let r = recordingScene();
    s.view.draw(r.scene, ATLAS, s.w.sim, s.f, s.ghost, new DebugOverlayList());
    expect(r.ui.count).toBe(2);
    const reason = r.ui.entry(0);
    const hint = r.ui.entry(1);
    expect(reason?.text).toBe('grund:noMaterial');
    expect(reason?.color).toBe(LABEL_COLORS.feind);
    expect(hint?.text).toBe('[G] Blaupause');
    expect(hint?.color).toBe(LABEL_COLORS[PLAN_HINT_TONE]);
    expect(hint?.x).toBe(reason?.x);
    expect(hint?.y).toBeLessThan(reason?.y ?? 0);
    // Unbound toggle: the reason alone.
    s.ghost.planHint = null;
    r = recordingScene();
    s.view.draw(r.scene, ATLAS, s.w.sim, s.f, s.ghost, new DebugOverlayList());
    expect(r.ui.count).toBe(1);
    // In blueprint mode nothing is missing.
    s.ghost.planHint = '[G] Blaupause';
    s.ghost.blueprint = true;
    judge(s, 12, 12);
    r = recordingScene();
    s.view.draw(r.scene, ATLAS, s.w.sim, s.f, s.ghost, new DebugOverlayList());
    expect(r.ui.count).toBe(0);
    // A station without its item: no plan to offer.
    const st = setup('werkbank');
    st.ghost.source = 'station';
    st.ghost.planHint = '[G] Blaupause';
    judge(st, 12, 12);
    expect(st.ghost.firstReason).not.toBeNull();
    r = recordingScene();
    st.view.draw(r.scene, ATLAS, st.w.sim, st.f, st.ghost, new DebugOverlayList());
    expect(r.ui.count).toBe(1);
  });
});
