/**
 * Objects with a state on the build grid (`BuildingView`, src/render/game/building.ts; M4-15 chests, M4-19 furniture
 * lights, M4-21 hearth fire on screen): a chest shows `offen` while its screen is open and the player stands at it,
 * `zu` otherwise; lamps and lanterns burn in their `idle` clip while lit and stand `aus` when empty; the stone fireplace
 * runs the camp fire's clips (`brennt`, `schwach`, `glut`, `asche`, `aus`); the hearth fire burns (`brennt`), sinks to
 * its embers on its last log (`glut`) and stands cold (`aus`), its ember cores drawn at the sockets `glutkern_1` … `6`
 * of its sprite with `obj_herdfeuer_glutkern`; burning things glow; the piece the interaction targets carries the
 * outline.
 */
import { describe, expect, it } from 'vitest';
import { furnitureLightListener } from '../../../src/game/building/listeners';
import type { Hearth } from '../../../src/game/hearth/state';
import { LightSystem } from '../../../src/game/light/system';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import {
  BuildingView,
  CHEST_CLIP,
  createBuildingFrame,
  HEARTH_CLIP,
  HEARTH_CORE_SOCKET,
  HEARTH_CORE_SPRITE,
  HEARTH_EMBERS_BELOW,
  hearthClip,
  LAMP_CLIP,
  partRole,
} from '../../../src/render/game/building';
import type { RenderScene } from '../../../src/render/scene';
import { lagerWelt, px, type LagerWelt } from '../game/lager-testwelt';
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
  depth: number;
  outline: boolean;
  glow: number;
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
        pushed.push({ sprite: o?.id ?? '?', frame: o?.frame ?? -1, x: d.x, y: d.y, depth: d.depth, outline: d.outline, glow: d.emissiveBoost });
        return pushed.length - 1;
      },
    },
  } as unknown as RenderScene;
  return { scene, pushed };
}

function clipFrames(id: string, clip: string): number[] {
  const c = MANIFEST.sprites[id]?.clips[clip];
  if (c === undefined) throw new Error(`${id}: Clip ${clip} fehlt`);
  return [...c.frames];
}

/** The base test world with the light system on the build grid (as `createSimulation` wires it); player on (10, 10). */
function world(): LagerWelt & { readonly light: LightSystem } {
  const w = lagerWelt(meadow(30, 20), { x: 10, y: 10 });
  const light = w.sim.addSystem(new LightSystem(w.sim, { player: w.player, inventory: w.inventory, collision: w.collision, environment: { rain: () => 0, ambient: () => 0, active: () => true } }));
  furnitureLightListener(w.building, light);
  return Object.assign(w, { light });
}

/** The session's chest events, fed from the ticks of the test world. */
function chestEvents() {
  const handlers = new Map<string, (e: unknown) => void>();
  return {
    session: {
      onEvent(type: string, cb: (e: unknown) => void) {
        handlers.set(type, cb);
        return () => handlers.delete(type);
      },
    },
    emit(events: Map<string, unknown[]>) {
      for (const [type, list] of events) for (const e of list) handlers.get(type)?.(e);
    },
  };
}

/** A frame over the drawn map with the player's figure where it stands, `focus` the use target (drawn tile). */
function frame(w: LagerWelt, time = 0, focus: { x: number; y: number } | null = null) {
  const f = createBuildingFrame();
  f.left = OFFSET * T;
  f.top = OFFSET * T;
  f.right = (OFFSET + 30) * T;
  f.bottom = (OFFSET + 20) * T;
  f.time = time;
  const p = w.pos();
  f.hasFigure = true;
  f.figureX = p.x;
  f.figureY = p.y;
  f.instant = true;
  f.focusTx = focus === null ? -1 : OFFSET + focus.x;
  f.focusTy = focus === null ? -1 : OFFSET + focus.y;
  return f;
}

function draw(view: BuildingView, w: LagerWelt, f = frame(w)): Pushed[] {
  const { scene, pushed } = recordingScene();
  view.draw(scene, ATLAS, w.sim, f);
  return pushed;
}

function only(pushed: readonly Pushed[], sprite: string): Pushed {
  const hits = pushed.filter((p) => p.sprite === sprite);
  expect(hits, sprite).toHaveLength(1);
  return hits[0] as Pushed;
}

describe('Rollen und Zustände der Objekte', () => {
  it('Kisten, Lichter, Herdfeuer und Stationen tragen ihre Rolle; alles andere ist schlicht', () => {
    expect(partRole('kiste_holz')).toBe('chest');
    expect(partRole('harzlampe')).toBe('light');
    expect(partRole('laterne_stehend')).toBe('light');
    expect(partRole('kamin_stein')).toBe('light');
    expect(partRole('herdfeuer')).toBe('hearth');
    expect(partRole('werkbank')).toBe('station');
    expect(partRole('wand_holz')).toBe('plain');
    expect(partRole('holzbett')).toBe('plain');
  });

  it('Herdfeuer: kalt aus; brennend brennt; auf dem letzten Scheit unter einem Viertel glut', () => {
    const h = (rest: number, vorrat: number): Pick<Hearth, 'rest' | 'voll' | 'vorrat'> => ({ rest, voll: 100, vorrat: Array.from({ length: vorrat }, () => ({ item: 'holz', count: 1 })) as Hearth['vorrat'] });
    expect(hearthClip(false, h(80, 2))).toBe(HEARTH_CLIP.cold);
    expect(hearthClip(true, h(80, 0))).toBe(HEARTH_CLIP.burning);
    expect(hearthClip(true, h(100 * HEARTH_EMBERS_BELOW - 1, 0))).toBe(HEARTH_CLIP.embers);
    // More logs in the store: the fire burns on, however low the piece is.
    expect(hearthClip(true, h(5, 1))).toBe(HEARTH_CLIP.burning);
  });
});

describe('BuildingView: Objekte mit Zustand', () => {
  it('eine Kiste steht zu, offen solange ihr Fenster offen ist und der Spieler bei ihr steht', () => {
    const w = world();
    expect(w.build('kiste_holz', 9, 10)).toBeNull();
    const box = w.storage.chests[0]?.id as number;
    const view = new BuildingView();
    const ev = chestEvents();
    view.follow(ev.session as never);
    const zu = clipFrames('obj_kiste_holz', CHEST_CLIP.shut)[0];
    const offen = clipFrames('obj_kiste_holz', CHEST_CLIP.open)[0];
    expect(only(draw(view, w), 'obj_kiste_holz').frame).toBe(zu);
    ev.emit(w.act({ type: 'storage.open', chest: box }));
    expect(only(draw(view, w), 'obj_kiste_holz').frame).toBe(offen);
    ev.emit(w.act({ type: 'storage.close', chest: box }));
    expect(only(draw(view, w), 'obj_kiste_holz').frame).toBe(zu);
    // Walked away with the screen open: the lid falls shut.
    ev.emit(w.act({ type: 'storage.open', chest: box }));
    const far = px(20, 10);
    w.act({ type: 'player.teleport', x: far.x, y: far.y, layer: 0 });
    expect(only(draw(view, w), 'obj_kiste_holz').frame).toBe(zu);
    view.dispose();
  });

  it('Lampen: leer aus, angezündet im Clip idle und leuchtend', () => {
    const w = world();
    expect(w.build('harzlampe', 11, 10)).toBeNull();
    const lamp = w.light.lightAt(0, OFFSET + 11, OFFSET + 10);
    if (lamp === undefined) throw new Error('Lampe fehlt');
    const view = new BuildingView();
    const cold = only(draw(view, w), 'obj_harzlampe');
    expect(cold.frame).toBe(clipFrames('obj_harzlampe', LAMP_CLIP.out)[0]);
    expect(cold.glow).toBe(0);
    w.give('harz', 2);
    w.act({ type: 'light.fuel', light: lamp.id, from: w.slotOf('harz'), count: 2 });
    w.act({ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 10 });
    expect(w.light.lightAt(0, OFFSET + 11, OFFSET + 10)?.torch?.lit).toBe(true);
    const lit = clipFrames('obj_harzlampe', LAMP_CLIP.lit);
    const seen = new Set<number>();
    for (const t of [0, 0.1, 0.2, 0.3]) {
      const p = only(draw(view, w, frame(w, t)), 'obj_harzlampe');
      expect(lit).toContain(p.frame);
      expect(p.glow).toBeGreaterThan(0);
      seen.add(p.frame);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('der Kamin: kalt aus, befeuert im Clip brennt', () => {
    const w = world();
    expect(w.build('kamin_stein', 8, 10)).toBeNull();
    const fire = w.light.lightAt(0, OFFSET + 8, OFFSET + 10);
    if (fire === undefined) throw new Error('Kamin fehlt');
    const view = new BuildingView();
    expect(only(draw(view, w), 'obj_kamin_stein').frame).toBe(clipFrames('obj_kamin_stein', 'aus')[0]);
    w.give('holz', 4);
    w.act({ type: 'light.fuel', light: fire.id, from: w.slotOf('holz'), count: 4 });
    w.act({ type: 'light.ignite', tx: OFFSET + 8, ty: OFFSET + 10 });
    const p = only(draw(view, w, frame(w, 0.2)), 'obj_kamin_stein');
    expect(clipFrames('obj_kamin_stein', 'brennt')).toContain(p.frame);
    expect(p.glow).toBeGreaterThan(0);
  });

  it('das Herdfeuer brennt, sinkt auf dem letzten Scheit zur Glut und steht kalt; Glutkerne sitzen in ihren Nischen', () => {
    const w = world();
    expect(w.build('herdfeuer', 12, 9)).toBeNull();
    const id = w.hearth.hearths[0]?.id as number;
    const view = new BuildingView();
    expect(only(draw(view, w), 'obj_herdfeuer').frame).toBe(clipFrames('obj_herdfeuer', HEARTH_CLIP.cold)[0]);
    // Two cores in the first two niches: drawn on the sockets of the hearth's frame, in front of it.
    for (const core of ['glutkern_1', 'glutkern_2']) {
      w.give(core, 1);
      w.act({ type: 'hearth.core', hearth: id, from: w.slotOf(core) });
    }
    w.give('holz', 1);
    w.act({ type: 'hearth.fuel', hearth: id, from: w.slotOf('holz'), count: 1 });
    w.act({ type: 'hearth.ignite', hearth: id });
    const pushed = draw(view, w, frame(w, 0.3));
    const hearth = only(pushed, 'obj_herdfeuer');
    expect(clipFrames('obj_herdfeuer', HEARTH_CLIP.burning)).toContain(hearth.frame);
    expect(hearth.glow).toBeGreaterThan(0);
    // Anchor on the middle of the 3 × 3 footprint's front edge.
    expect(hearth).toMatchObject({ x: (OFFSET + 12) * T + 24, y: (OFFSET + 12) * T - 1 });
    const cores = pushed.filter((p) => p.sprite === HEARTH_CORE_SPRITE);
    expect(cores).toHaveLength(2);
    const s = MANIFEST.sprites.obj_herdfeuer;
    const f = s?.frames[hearth.frame];
    if (s === undefined || f === undefined) throw new Error('Herdfeuer-Sprite fehlt');
    cores.forEach((c, i) => {
      const socket = s.sockets[`${HEARTH_CORE_SOCKET}${i + 1}`]?.[hearth.frame];
      if (socket === null || socket === undefined) throw new Error(`Sockel ${i + 1} fehlt`);
      expect(c.x).toBe(hearth.x - f.ax + socket[0]);
      expect(c.y).toBe(hearth.y - f.ay + socket[1]);
      expect(c.depth).toBeGreaterThan(hearth.y);
      expect(c.glow).toBeGreaterThan(0);
    });
    // The last log burns down: below a quarter the fire sinks to its embers, then it goes out.
    const h = w.hearth.hearth(id) as Readonly<Hearth>;
    w.run(Math.ceil(h.rest - h.voll * HEARTH_EMBERS_BELOW) + 1);
    expect(clipFrames('obj_herdfeuer', HEARTH_CLIP.embers)).toContain(only(draw(view, w), 'obj_herdfeuer').frame);
    w.run(Math.ceil(h.rest) + 2);
    expect(w.hearth.burning(w.sim, h)).toBe(false);
    expect(only(draw(view, w), 'obj_herdfeuer').frame).toBe(clipFrames('obj_herdfeuer', HEARTH_CLIP.cold)[0]);
  });

  it('das Ziel der Interaktion trägt die Umrisslinie, Wände und Böden nie', () => {
    const w = world();
    expect(w.build('kiste_holz', 9, 10)).toBeNull();
    expect(w.build('wand_holz', 9, 12)).toBeNull();
    const view = new BuildingView();
    expect(only(draw(view, w, frame(w, 0, { x: 9, y: 10 })), 'obj_kiste_holz').outline).toBe(true);
    expect(only(draw(view, w, frame(w, 0, { x: 9, y: 12 })), 'bau_wand_holz').outline).toBe(false);
    expect(draw(view, w).some((p) => p.outline)).toBe(false);
  });
});
