/**
 * M3-05 … M3-07 in the renderer (docs/SPIEL.md §5): the player's body clip follows movement mode,
 * activity, a fresh hit and a torch in the off hand (`<aktion>_licht`); items in the hands play their
 * clips of the body's action on the body clip's time (the axe head follows the swinging arm) and their
 * hold clip on their own time otherwise (the torch flame flickers on while the body walks); the hands are
 * empty while rolling, swimming, asleep or dead; a carried load sits on the socket `last`; the swing of the
 * tool clip matches the simulation's hit rhythm.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { clipDuration, clipFrameAt, clipPositionAt, type Direction } from '../../../src/render/anim/animation';
import { defaultFigureState, HAND_SLOTS_MASK, slotBit, socketOffset } from '../../../src/render/anim/figure';
import type { AtlasManifest, AtlasSprite } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { SpriteFrameRef, SpriteList } from '../../../src/render/batch/spriteList';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { buildPlayerFigure, figureAction, hiddenSlots, PLAYER_BODY_SPRITE, START_CLOTHING, TOOL_SWING_SECONDS, type PlayerFigureRig } from '../../../src/render/game/playerFigure';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();

function sprite(id: string): AtlasSprite {
  const s = MANIFEST.sprites[id];
  if (s === undefined) throw new Error(`${id} fehlt im Spielatlas`);
  return s;
}

/** Sprites a rig pushed for one state: sprite id, frame index within the sprite, position. */
function emit(rig: PlayerFigureRig, patch: Partial<ReturnType<typeof defaultFigureState>>): { sprite: string; frame: number; x: number; y: number }[] {
  const owner = new Map<SpriteFrameRef, [string, number]>();
  for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f, i) => owner.set(f, [s.id, i]));
  const out: { sprite: string; frame: number; x: number; y: number }[] = [];
  const list = {
    push(d: SpriteDesc) {
      const o = d.frame === null ? undefined : owner.get(d.frame);
      out.push({ sprite: o?.[0] ?? '?', frame: o?.[1] ?? -1, x: d.x, y: d.y });
      return out.length - 1;
    },
  } as unknown as SpriteList;
  rig.rig.emit(list, new SpriteDesc(), { ...defaultFigureState(), x: 200, y: 200, ...patch });
  return out;
}

const AVAILABLE = new Set(['idle', 'idle_licht', 'walk', 'walk_licht', 'run', 'run_licht', 'tool', 'tool_licht', 'eat', 'eat_licht', 'hit', 'roll', 'swim', 'sleep', 'death']);
const BY_STATE = { idle: 'idle', walk: 'walk', sprint: 'run', sneak: 'walk', roll: 'roll', swim: 'swim', jump: 'idle', climb: 'idle' } as const;

describe('Spielerfigur: Clipwahl', () => {
  it('Tod und Schlaf vor allem, Körpermodi vor Tätigkeiten, Tätigkeit vor Treffer; mit Licht in der Nebenhand die _licht-Variante, wo es sie gibt', () => {
    expect(figureAction('walk', 'none', false, false, BY_STATE, AVAILABLE)).toBe('walk');
    expect(figureAction('walk', 'none', false, true, BY_STATE, AVAILABLE)).toBe('walk_licht');
    expect(figureAction('sprint', 'none', false, true, BY_STATE, AVAILABLE)).toBe('run_licht');
    expect(figureAction('idle', 'tool', false, true, BY_STATE, AVAILABLE)).toBe('tool_licht');
    expect(figureAction('idle', 'eat', true, false, BY_STATE, AVAILABLE)).toBe('eat');
    expect(figureAction('idle', 'none', true, true, BY_STATE, AVAILABLE)).toBe('hit');
    expect(figureAction('roll', 'tool', true, true, BY_STATE, AVAILABLE)).toBe('roll');
    expect(figureAction('swim', 'none', false, true, BY_STATE, AVAILABLE)).toBe('swim');
    expect(figureAction('swim', 'death', false, true, BY_STATE, AVAILABLE)).toBe('death');
    expect(figureAction('idle', 'sleep', false, false, BY_STATE, AVAILABLE)).toBe('sleep');
    // An action the atlas lacks shows the movement clip.
    expect(figureAction('walk', 'drink', false, false, BY_STATE, AVAILABLE)).toBe('walk');
  });

  it('leere Hände beim Rollen, Schwimmen, Schlafen und im Tod; beim Essen und Trinken nur die Haupthand', () => {
    for (const state of ['roll', 'swim'] as const) expect(hiddenSlots(state, 'none')).toBe(HAND_SLOTS_MASK);
    for (const activity of ['sleep', 'death'] as const) expect(hiddenSlots('idle', activity)).toBe(HAND_SLOTS_MASK);
    for (const activity of ['eat', 'drink'] as const) expect(hiddenSlots('idle', activity)).toBe(slotBit('waffe'));
    expect(hiddenSlots('walk', 'tool')).toBe(0);
    expect(HAND_SLOTS_MASK).toBe(slotBit('waffe') | slotBit('nebenhand') | slotBit('last'));
  });

  it('ein Werkzeugschwung dauert so lange wie der Takt der Simulation, und der Schlagframe fällt auf ihren Treffer', () => {
    const body = sprite(PLAYER_BODY_SPRITE);
    expect(TOOL_SWING_SECONDS).toBe(BALANCE.harvest.toolSwingSeconds);
    for (const d of ['down', 'up', 'right'] as const) {
      const clip = body.clips[`tool_${d}`];
      if (clip === undefined) throw new Error(`tool_${d} fehlt`);
      expect(clipDuration(clip)).toBeCloseTo(TOOL_SWING_SECONDS, 9);
      const hit = clip.events?.find((e) => e.name === 'treffer');
      expect(hit).toBeDefined();
      expect((hit?.frame ?? 0) / clip.fps).toBeCloseTo(BALANCE.harvest.toolHitSeconds, 9);
    }
  });
});

describe('Spielerfigur: Gegenstände in den Händen', () => {
  const rig = buildPlayerFigure(MANIFEST, START_CLOTHING, { hand: 'ausruestung_steinaxt', offhand: 'ausruestung_fackel' });
  if (rig === null) throw new Error('Spielerfigur fehlt');
  const axe = sprite('ausruestung_steinaxt');
  const torch = sprite('ausruestung_fackel');
  const body = sprite(PLAYER_BODY_SPRITE);

  it('die Axt spielt ihren Clip der Körperaktion Frame für Frame auf der Zeit des Körperclips – mit und ohne Fackel', () => {
    for (const action of ['tool', 'tool_licht'] as const) {
      for (const d of ['down', 'up', 'right', 'left'] as Direction[]) {
        const bodyClip = body.clips[`${action}_${d}`];
        const axeClip = axe.clips[`${action}_${d}`];
        if (bodyClip === undefined || axeClip === undefined) throw new Error(`${action}_${d} fehlt`);
        for (let k = 0; k < bodyClip.frames.length; k++) {
          const time = (k + 0.5) / bodyClip.fps;
          const pushed = emit(rig, { action, direction: d, time, itemTime: 7.77 });
          const a = pushed.find((p) => p.sprite === axe.id);
          expect(a?.frame, `${action}_${d} @${k}`).toBe(axeClip.frames[clipPositionAt(bodyClip, time)]);
        }
      }
    }
  });

  it('ohne Clip der Aktion hält die Axt ihren Halteclip; die Fackel flackert auf ihrer eigenen Zeit, während der Körper geht', () => {
    const hold = axe.clips['down'];
    const flame = torch.clips['down'];
    if (hold === undefined || flame === undefined) throw new Error('Halteclips fehlen');
    const walk = (itemTime: number) => emit(rig, { action: 'walk_licht', direction: 'down', time: 0.25, itemTime });
    expect(walk(0).find((p) => p.sprite === axe.id)?.frame).toBe(clipFrameAt(hold, 0));
    const flames = [0, 0.1, 0.2, 0.3].map((t) => walk(t).find((p) => p.sprite === torch.id)?.frame);
    expect(flames).toEqual([0, 0.1, 0.2, 0.3].map((t) => clipFrameAt(flame, t)));
    expect(new Set(flames).size).toBeGreaterThan(1);
  });

  it('die Fackel sitzt in jedem Frame auf dem Sockel „nebenhand“, die Axt auf „hand“', () => {
    const offset = { x: 0, y: 0 };
    for (const action of ['idle_licht', 'walk_licht', 'tool_licht'] as const) {
      const bodyClip = body.clips[`${action}_right`];
      if (bodyClip === undefined) throw new Error(`${action}_right fehlt`);
      for (let k = 0; k < bodyClip.frames.length; k++) {
        const time = (k + 0.5) / bodyClip.fps;
        const index = clipFrameAt(bodyClip, time);
        const pushed = emit(rig, { action, direction: 'right', time });
        const frame = body.frames[index] as SpriteFrameRef;
        for (const [id, socket] of [
          [torch.id, 'nebenhand'],
          [axe.id, 'hand'],
        ] as const) {
          const point = body.sockets[socket]?.[index];
          if (point === undefined || point === null) throw new Error(`${socket} @${index}`);
          socketOffset(frame, point, false, offset);
          const p = pushed.find((q) => q.sprite === id);
          expect({ x: p?.x, y: p?.y }, `${id} ${action} @${k}`).toEqual({ x: 200 + offset.x, y: 200 + offset.y });
        }
      }
    }
  });

  it('verborgene Hände zeichnen weder Axt noch Fackel; der Körper und die Kleidung bleiben', () => {
    const pushed = emit(rig, { action: 'idle_licht', direction: 'down', hidden: HAND_SLOTS_MASK });
    expect(pushed.map((p) => p.sprite).sort()).toEqual([PLAYER_BODY_SPRITE, 'ausruestung_leinenhose', 'ausruestung_leinentunika'].sort());
  });

  it('eine getragene Last liegt auf dem Sockel „last“', () => {
    const load = buildPlayerFigure(MANIFEST, START_CLOTHING, { load: 'ausruestung_holzeimer_wasser' });
    if (load === null) throw new Error('Spielerfigur fehlt');
    const clip = body.clips['idle_down'];
    if (clip === undefined) throw new Error('idle_down fehlt');
    const index = clipFrameAt(clip, 0);
    const point = body.sockets['last']?.[index];
    if (point === undefined || point === null) throw new Error('Sockel last fehlt');
    const offset = socketOffset(body.frames[index] as SpriteFrameRef, point, false, { x: 0, y: 0 });
    const pushed = emit(load, { action: 'idle', direction: 'down', time: 0 });
    const bucket = pushed.find((p) => p.sprite === 'ausruestung_holzeimer_wasser');
    expect({ x: bucket?.x, y: bucket?.y }).toEqual({ x: 200 + offset.x, y: 200 + offset.y });
    expect(load.held).toEqual(['ausruestung_holzeimer_wasser']);
  });
});
