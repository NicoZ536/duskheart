/**
 * M6-Gate Runde 3 (hitstop: der Keulenkopf verschwand im weißen Trefferblitz des Rehs, das ein paar Pixel weiter südlich stand;
 * src/render/anim/figure.ts `NEAR_HAND_DEPTH`): ein Gegenstand, den die Figur in der nahen Hand schwingt – er spielt den Clip
 * der Körperaktion und liegt in der Reihenfolge der Richtung vor dem Körper –, sortiert sich `NEAR_HAND_DEPTH` Pixel vor der
 * Fußlinie der Figur; jeder danach gezeichnete Teil behält mindestens diese Tiefe, so bleibt die Reihenfolge der Figur. In der
 * fernen Hand, gehalten (Halte-Clip), hinter dem Körper (gedrehtes Körperbild) bleibt er auf der Fußlinie. Am synthetischen
 * Wanderer der Szenen-Sprites.
 */
import { describe, expect, it } from 'vitest';
import type { AnimationClip } from '../../../src/render/anim/animation';
import { defaultFigureState, FigureRig, NEAR_HAND_DEPTH, TURN_STEP, TURNED_CLIP_SUFFIX, type FigureState } from '../../../src/render/anim/figure';
import { atlasSprite, type AtlasSprite } from '../../../src/render/assets/atlas';
import { sceneAtlas } from '../../../src/render/assets/sceneSprites';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';
import spieler from '../../../assets-src/sprites/figuren/spieler_basis';

const atlas = sceneAtlas();
const base = atlasSprite(atlas.manifest, 'wanderer');
const sword = atlasSprite(atlas.manifest, 'schwert');
const helm = atlasSprite(atlas.manifest, 'helm');
const FEET = 200;

/** The sword with clips of the walk (it swings with it) in every direction, or only its hold clips. */
function item(acted: boolean): AtlasSprite {
  if (!acted) return { ...sword, id: 'gehalten' };
  const clips: Record<string, AnimationClip> = { ...sword.clips, left: { ...(sword.clips['right'] as AnimationClip), name: 'left' } };
  for (const d of ['down', 'up', 'right', 'left']) {
    clips[`walk_${d}`] = { name: `walk_${d}`, frames: [0, 1, 0, 1], fps: 10, loop: true, events: [] };
    clips[`idle_${d}`] = { name: `idle_${d}`, frames: [0], fps: 1, loop: true, events: [] };
  }
  return { ...sword, id: 'geschwungen', clips, symmetric: false };
}

function state(direction: FigureState['direction'], handAngle = 0): FigureState {
  const s = defaultFigureState();
  s.x = 100;
  s.y = FEET;
  s.direction = direction;
  s.action = 'walk';
  s.time = 0.25;
  s.handAngle = handAngle;
  return s;
}

/** Sprite id and depth of every push, in order. */
function pushed(rig: FigureRig, s: FigureState): (readonly [string, number])[] {
  const owner = new Map<SpriteFrameRef, string>();
  for (const sp of [base, sword, helm]) for (const f of sp.frames) owner.set(f, sp.id);
  const out: (readonly [string, number])[] = [];
  const list = {
    push(d: SpriteDesc) {
      const f = d.frame as SpriteFrameRef;
      const source = 'source' in f && f.source !== null ? (f.source as SpriteFrameRef) : f;
      out.push([owner.get(source) ?? '?', d.depth]);
      return out.length - 1;
    },
  };
  rig.emit(list as never, new SpriteDesc(), s);
  return out;
}

/** A rig emitting its last pushed part again after the figure (like `PlayerRig`'s late items). */
class LateRig extends FigureRig {
  emitLate(list: Parameters<FigureRig['emit']>[0], d: SpriteDesc, s: FigureState): void {
    this.emit(list, d, s);
    this.emitSlot(list, d, s, 'kopf');
  }
}

describe('Gegenstand in der nahen Hand vor der Fußlinie (M6-Gate Runde 3, hitstop)', () => {
  it('so weit vor der Mitte, wie die Hände der Spielfigur von vorn neben ihr hängen', () => {
    // Seen from the front (`idle_down`) the hands hang beside the centre line (the anchor); in profile the near one lies
    // that far in front of it – on whole pixels, at least a few: a creature struck on the same row stands up to 4 px south.
    const f = spieler.clips['idle_down']?.frames[0] ?? -1;
    const neben = (['hand', 'nebenhand'] as const).map((sockel) => Math.abs((spieler.sockets[sockel]?.[f]?.[0] ?? Number.NaN) + 0.5 - spieler.anchor[0]));
    expect(NEAR_HAND_DEPTH).toBe(Math.floor(Math.min(...neben)));
    expect(NEAR_HAND_DEPTH).toBeGreaterThan(4);
  });

  it('geschwungen in der nahen Hand: NEAR_HAND_DEPTH vor den Füßen, Körper und Teile davor auf der Fußlinie', () => {
    const rig = new FigureRig(base, ['walk', 'idle'], [{ slot: 'waffe', sprite: item(true) }]);
    // Facing right (and towards the viewer) the right hand is the near hand, drawn after the body.
    for (const dir of ['right', 'down'] as const) expect(pushed(rig, state(dir)), dir).toEqual([[base.id, FEET], [sword.id, FEET + NEAR_HAND_DEPTH]]);
    // Turned about its grip the same.
    expect(pushed(rig, state('right', 0.3))).toEqual([[base.id, FEET], [sword.id, FEET + NEAR_HAND_DEPTH]]);
  });

  it('in der fernen Hand, nur gehalten oder hinter dem gedrehten Körper: auf der Fußlinie', () => {
    const swung = new FigureRig(base, ['walk', 'idle'], [{ slot: 'waffe', sprite: item(true) }]);
    // Facing left and away the right hand's item is behind the body.
    for (const dir of ['left', 'up'] as const) expect(pushed(swung, state(dir)), dir).toEqual([[sword.id, FEET], [base.id, FEET]]);
    const held = new FigureRig(base, ['walk', 'idle'], [{ slot: 'waffe', sprite: item(false) }]);
    expect(pushed(held, state('right'))).toEqual([[base.id, FEET], [sword.id, FEET]]);
    // A turned body picture puts the item behind the body: it stays on the ground line, and so does the body.
    const clips: Record<string, AnimationClip> = { ...base.clips };
    for (const d of ['down', 'up', 'right', 'left']) {
      const walk = base.clips[`walk_${d}`] as AnimationClip;
      clips[`walk_${d}${TURNED_CLIP_SUFFIX.ccw}`] = { ...walk, frames: walk.frames.map((f) => (d === 'right' ? (base.clips['idle_right']?.frames[0] ?? f) : f)) };
      clips[`walk_${d}${TURNED_CLIP_SUFFIX.cw}`] = walk;
    }
    const turned = new FigureRig({ ...base, clips }, ['walk', 'idle'], [{ slot: 'waffe', sprite: item(true) }]);
    expect(pushed(turned, state('right', -(TURN_STEP / 2 + 0.1)))).toEqual([[sword.id, FEET], [base.id, FEET]]);
  });

  it('was danach kommt, behält mindestens die Tiefe der nahen Hand – auch ein nachträglich gezeichneter Teil', () => {
    const rig = new LateRig(base, ['walk', 'idle'], [
      { slot: 'waffe', sprite: item(true) },
      { slot: 'kopf', sprite: helm },
    ]);
    const out: (readonly [string, number])[] = [];
    const owner = new Map<SpriteFrameRef, string>();
    for (const sp of [base, sword, helm]) for (const f of sp.frames) owner.set(f, sp.id);
    const list = {
      push(d: SpriteDesc) {
        const f = d.frame as SpriteFrameRef;
        const source = 'source' in f && f.source !== null ? (f.source as SpriteFrameRef) : f;
        out.push([owner.get(source) ?? '?', d.depth]);
        return out.length - 1;
      },
    };
    rig.emitLate(list as never, new SpriteDesc(), state('right'));
    // Facing right: body, helmet, the near hand's sword – then the helmet again, drawn late: not below the sword.
    expect(out).toEqual([
      [base.id, FEET],
      [helm.id, FEET],
      [sword.id, FEET + NEAR_HAND_DEPTH],
      [helm.id, FEET + NEAR_HAND_DEPTH],
    ]);
    // The next figure starts on its own ground line again.
    out.length = 0;
    rig.emit(list as never, new SpriteDesc(), state('left'));
    expect(out.every(([, depth]) => depth === FEET)).toBe(true);
  });
});
