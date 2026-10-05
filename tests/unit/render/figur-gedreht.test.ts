/**
 * M6-Gate (waffe-rotation, Bogen nach NO/NW: der Bogen drehte um den Griff auf Hüfthöhe, die Nocke lag am Gürtel und der Schuss
 * nach oben las sich als einer nach vorn unten; src/render/anim/figure.ts `TURNED_CLIP_SUFFIX`): der Körper trägt wie die
 * Waffe um 45° gedrehte Clips. Zielt die Figur weiter als eine halbe Achteldrehung neben die Blickrichtung, zeigt der Körper
 * Position für Position seinen gedrehten Clip (im Spiegelbild den anderen Drehsinn); wo dessen Bild vom ungedrehten abweicht,
 * kommt die Waffe vor dem Körper (dahinter: der gehobene Arm greift sie vor dem Gesicht). Am synthetischen Wanderer der
 * Szenen-Sprites; die Kunst prüft spielerfigur-bogen-schraeg.test.ts am Spielatlas.
 */
import { describe, expect, it } from 'vitest';
import type { AnimationClip } from '../../../src/render/anim/animation';
import { defaultFigureState, FigureRig, TURN_STEP, TURNED_CLIP_SUFFIX, type FigureState } from '../../../src/render/anim/figure';
import { atlasSprite, type AtlasSprite } from '../../../src/render/assets/atlas';
import { sceneAtlas } from '../../../src/render/assets/sceneSprites';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';

const atlas = sceneAtlas();
const base = atlasSprite(atlas.manifest, 'wanderer');
const sword = atlasSprite(atlas.manifest, 'schwert');
/** Picture of `walk_right` the turned clip replaces (position 2) and the picture it shows there (the second idle picture). */
const POSITION = 2;
const GEDREHT_BILD = base.clips['idle_right']?.frames[3] ?? -1;
const UNGEDREHT_BILD = base.clips['walk_right']?.frames[POSITION] ?? -1;
/** A time on clip position `POSITION` of the 10-fps walk (and one on position 0). */
const T_POSITION = (POSITION + 0.5) / 10;
const T_START = 0.05;

/** The wanderer with turned walk clips in every direction (`_rechtsrum` as drawn; `_linksrum` facing right with `GEDREHT_BILD` on `POSITION`). */
function gedreht(directions: readonly ('down' | 'up' | 'right' | 'left')[], symmetric: boolean, lengthOff = 0): AtlasSprite {
  const clips: Record<string, AnimationClip> = {};
  for (const d of directions) {
    const walk = base.clips[`walk_${d}`];
    const idle = base.clips[`idle_${d}`];
    if (walk === undefined || idle === undefined) throw new Error(d);
    clips[`walk_${d}`] = walk;
    clips[`idle_${d}`] = idle;
    const frames = walk.frames.map((f, i) => (d === 'right' && i === POSITION ? GEDREHT_BILD : f));
    clips[`walk_${d}${TURNED_CLIP_SUFFIX.ccw}`] = { ...walk, name: `walk_${d}${TURNED_CLIP_SUFFIX.ccw}`, frames: d === 'right' && lengthOff > 0 ? [...frames, frames[0] ?? 0] : frames };
    clips[`walk_${d}${TURNED_CLIP_SUFFIX.cw}`] = { ...walk, name: `walk_${d}${TURNED_CLIP_SUFFIX.cw}` };
  }
  return { ...base, symmetric, clips };
}

/** Atlas frame → [sprite id, frame index]. */
const OWNER = new Map<SpriteFrameRef, readonly [string, number]>();
for (const s of [base, sword]) s.frames.forEach((f, i) => OWNER.set(f, [s.id, i]));

function state(direction: FigureState['direction'], time: number, handAngle: number): FigureState {
  const s = defaultFigureState();
  s.x = 100;
  s.y = 200;
  s.direction = direction;
  s.action = 'walk';
  s.time = time;
  s.handAngle = handAngle;
  return s;
}

/** Sprite id and frame index of every push of `rig` for `s`, in order. */
function emitted(rig: FigureRig, s: FigureState): (readonly [string, number])[] {
  const out: (readonly [string, number])[] = [];
  const list = {
    push(d: SpriteDesc) {
      out.push(OWNER.get(d.frame as SpriteFrameRef) ?? ['?', -1]);
      return out.length - 1;
    },
  };
  rig.emit(list as never, new SpriteDesc(), s);
  return out;
}

const UEBER = TURN_STEP / 2 + 0.1;
const UNTER = TURN_STEP / 2 - 0.05;

describe('Gedrehte Körper-Clips (M6-Gate, Bogen schräg nach oben)', () => {
  const body = gedreht(['down', 'up', 'right', 'left'], false);
  const rig = new FigureRig(body, ['walk', 'idle'], [{ slot: 'waffe', sprite: sword }]);

  it('weiter als eine halbe Achteldrehung gezielt zeigt der Körper sein gedrehtes Bild, die Waffe liegt dahinter', () => {
    const list = emitted(rig, state('right', T_POSITION, -UEBER));
    expect(list.map(([id]) => id)).toEqual([sword.id, base.id]);
    expect(list[1]?.[1]).toBe(GEDREHT_BILD);
    expect(rig.bodyFrameIndex).toBe(GEDREHT_BILD);
  });

  it('innerhalb einer halben Achteldrehung, im anderen Drehsinn und wo der gedrehte Clip dasselbe Bild zeigt: ungedreht, Waffe in der Reihenfolge der Richtung', () => {
    // Facing right the near hand's weapon comes after the body (`FIGURE_LAYER_ORDER.right`).
    for (const [time, angle, bild] of [
      [T_POSITION, -UNTER, UNGEDREHT_BILD],
      [T_POSITION, UEBER, UNGEDREHT_BILD],
      [T_START, -UEBER, base.clips['walk_right']?.frames[0] ?? -1],
    ] as const) {
      const list = emitted(rig, state('right', time, angle));
      expect(list.map(([id]) => id), `${time} ${angle}`).toEqual([base.id, sword.id]);
      expect(list[0]?.[1], `${time} ${angle}`).toBe(bild);
      expect(rig.bodyFrameIndex, `${time} ${angle}`).toBe(bild);
    }
  });

  it('ein gespiegeltes Bild dreht andersherum: nach links (Spiegelbild von rechts) zeigt der Uhrzeigersinn das gedrehte Bild', () => {
    const mirrored = new FigureRig(gedreht(['down', 'up', 'right'], true), ['walk', 'idle'], []);
    expect(emitted(mirrored, state('left', T_POSITION, UEBER))[0]?.[1]).toBe(GEDREHT_BILD);
    expect(emitted(mirrored, state('left', T_POSITION, -UEBER))[0]?.[1]).toBe(UNGEDREHT_BILD);
  });

  it('ein gedrehter Clip braucht die Positionen des ungedrehten', () => {
    expect(() => new FigureRig(gedreht(['down', 'up', 'right', 'left'], false, 1), ['walk', 'idle'], [])).toThrow(/Positionen wie walk_right/);
  });
});
