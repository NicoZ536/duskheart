/**
 * M6-Gate Runde 3 (waffe-rotation NO/NW: der Schmierbogen des Schwerts setzte in den Schrägen nach oben wieder an der Nase an;
 * src/render/anim/figure.ts `AIM_CLIP_MARK`): ein Gegenstand in der Hand kann für eine weiter gedrehte Hand eigene Bilder
 * tragen – Clips `<aktion>_<richtung><Drehsinn>_ab<Grad>`, Position für Position wie `<aktion>_<richtung>`. Ist die Hand in
 * diesem Sinn um mehr als die Gradzahl gedreht, zeigt das Rig das Bild der größten solchen Stufe und dreht es um den ganzen
 * Winkel; Richtungen ohne solchen Clip, der andere Drehsinn und kleinere Winkel behalten den Clip. Ein um eine Achteldrehung
 * gezeichnetes Bild (`TURNED_CLIP_SUFFIX`) geht vor. Am synthetischen Wanderer der Szenen-Sprites; die Kunst (Luft zwischen
 * Bogen und Kopf) prüft spielerfigur-schmier-luft.test.ts am Spielatlas.
 */
import { describe, expect, it } from 'vitest';
import type { AnimationClip } from '../../../src/render/anim/animation';
import { AIM_CLIP_MARK, defaultFigureState, FigureRig, TURN_STEP, TURNED_CLIP_SUFFIX, type FigureState } from '../../../src/render/anim/figure';
import { atlasSprite, type AtlasSprite } from '../../../src/render/assets/atlas';
import { sceneAtlas } from '../../../src/render/assets/sceneSprites';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';

const atlas = sceneAtlas();
const base = atlasSprite(atlas.manifest, 'wanderer');
const sword = atlasSprite(atlas.manifest, 'schwert');
/** Four frames no other part of the figure draws (the probe item's pictures). */
const BILDER = atlasSprite(atlas.manifest, 'fackel').frames;
/** Clip position with the picture the steps replace, and a time on it (the 10-fps walk). */
const POSITION = 2;
const T_POSITION = (POSITION + 0.5) / 10;
/** Frames of the probe item: 0 = its clip, 1 = beyond 0°, 2 = beyond 30°, 3 = drawn turned by a step. */
const BILD = { clip: 0, ab0: 1, ab30: 2, gedreht: 3 } as const;
const GRAD = Math.PI / 180;

/**
 * A probe item in the hand with the walk clips of every direction (frame `BILD.clip`); `steps` adds, counter-clockwise for the
 * directions given, the steps beyond 0° and 30° (their frame on `POSITION`); `turned` the turned clips (`BILD.gedreht` on
 * `POSITION` counter-clockwise facing right).
 */
function probe(opts: { readonly steps?: readonly ('down' | 'up' | 'right' | 'left')[]; readonly symmetric?: boolean; readonly turned?: boolean; readonly lengthOff?: boolean }): AtlasSprite {
  const frames = [...BILDER];
  // Hold clips (an unmirrored item needs the left one too).
  const hold = (name: string): AnimationClip => ({ name, frames: [BILD.clip], fps: 1, loop: true, events: [] });
  const clips: Record<string, AnimationClip> = { down: hold('down'), up: hold('up'), right: hold('right'), ...(opts.symmetric === true ? {} : { left: hold('left') }) };
  const walk = (name: string, at: number, length = 4): AnimationClip => ({ name, frames: Array.from({ length }, (_, i) => (i === POSITION ? at : BILD.clip)), fps: 10, loop: true, events: [] });
  const directions = opts.symmetric === true ? (['down', 'up', 'right'] as const) : (['down', 'up', 'right', 'left'] as const);
  for (const d of directions) {
    clips[`walk_${d}`] = walk(`walk_${d}`, BILD.clip);
    clips[`idle_${d}`] = walk(`idle_${d}`, BILD.clip);
    if (opts.steps?.includes(d) === true) {
      clips[`walk_${d}${TURNED_CLIP_SUFFIX.ccw}${AIM_CLIP_MARK}0`] = walk(`walk_${d}_ab0`, BILD.ab0, opts.lengthOff === true && d === 'right' ? 5 : 4);
      clips[`walk_${d}${TURNED_CLIP_SUFFIX.ccw}${AIM_CLIP_MARK}30`] = walk(`walk_${d}_ab30`, BILD.ab30);
    }
    if (opts.turned === true) {
      clips[`walk_${d}${TURNED_CLIP_SUFFIX.ccw}`] = walk(`walk_${d}_l`, d === 'right' ? BILD.gedreht : BILD.clip);
      clips[`walk_${d}${TURNED_CLIP_SUFFIX.cw}`] = walk(`walk_${d}_r`, BILD.clip);
    }
  }
  return { ...sword, id: 'probe', frames, clips, symmetric: opts.symmetric ?? false };
}

function state(direction: FigureState['direction'], handAngle: number, time = T_POSITION): FigureState {
  const s = defaultFigureState();
  s.x = 100;
  s.y = 200;
  s.direction = direction;
  s.action = 'walk';
  s.time = time;
  s.handAngle = handAngle;
  return s;
}

/** Frame index (in the probe item) and turn of the item the rig pushes for `s`. */
function inHand(rig: FigureRig, item: AtlasSprite, s: FigureState): { readonly frame: number; readonly rotation: number } {
  let out = { frame: -1, rotation: Number.NaN };
  const list = {
    push(d: SpriteDesc) {
      const f = d.frame as SpriteFrameRef;
      const source = 'source' in f && f.source !== null ? (f.source as SpriteFrameRef) : f;
      const i = item.frames.indexOf(source);
      if (i >= 0) out = { frame: i, rotation: d.rotation };
      return 0;
    },
  };
  rig.emit(list as never, new SpriteDesc(), s);
  return out;
}

describe('Stufen der weiter gedrehten Hand (M6-Gate Runde 3, Schmierbogen vor dem Gesicht)', () => {
  const item = probe({ steps: ['right'] });
  const rig = new FigureRig(base, ['walk', 'idle'], [{ slot: 'waffe', sprite: item }]);

  it('gegen den Uhrzeigersinn über 0° bzw. 30° hinaus das Bild der größten Stufe darunter, um den ganzen Winkel gedreht', () => {
    for (const [grad, bild] of [
      [-1, BILD.ab0],
      [-30, BILD.ab0],
      [-31, BILD.ab30],
      [-45, BILD.ab30],
      [-57, BILD.ab30],
    ] as const) {
      const got = inHand(rig, item, state('right', grad * GRAD));
      expect(got.frame, `${grad}°`).toBe(bild);
      expect(got.rotation, `${grad}°`).toBeCloseTo(grad * GRAD, 12);
    }
  });

  it('ungedreht, im anderen Drehsinn, in Richtungen ohne Stufen und auf anderen Positionen: der Clip', () => {
    expect(inHand(rig, item, state('right', 0)).frame).toBe(BILD.clip);
    expect(inHand(rig, item, state('right', 45 * GRAD)).frame).toBe(BILD.clip);
    expect(inHand(rig, item, state('down', -45 * GRAD)).frame).toBe(BILD.clip);
    expect(inHand(rig, item, state('right', -45 * GRAD, 0.05)).frame).toBe(BILD.clip);
  });

  it('ein gespiegeltes Bild dreht andersherum: nach links (Spiegelbild von rechts) zeigt der Uhrzeigersinn die Stufen', () => {
    const sym = probe({ steps: ['right'], symmetric: true });
    const ohneLinks = Object.fromEntries(Object.entries(base.clips).filter(([name]) => !name.endsWith('_left')));
    // Mirrored only with the same item in both hands; the off hand does not turn.
    const mirrored = new FigureRig({ ...base, clips: ohneLinks }, ['walk', 'idle'], [
      { slot: 'waffe', sprite: sym },
      { slot: 'nebenhand', sprite: sym },
    ]);
    expect(mirrored.symmetric).toBe(true);
    expect(inHand(mirrored, sym, state('left', 45 * GRAD)).frame).toBe(BILD.ab30);
    expect(inHand(mirrored, sym, state('left', -45 * GRAD)).frame).toBe(BILD.clip);
  });

  it('ein um eine Achteldrehung gezeichnetes Bild geht vor: es dreht nur um den Rest', () => {
    const both = probe({ steps: ['right'], turned: true });
    const r = new FigureRig(base, ['walk', 'idle'], [{ slot: 'waffe', sprite: both }]);
    const got = inHand(r, both, state('right', -45 * GRAD));
    expect(got.frame).toBe(BILD.gedreht);
    expect(got.rotation).toBeCloseTo(-45 * GRAD + TURN_STEP, 12);
    // The rest of the turn is no step of its own: beyond the step by 5° the turned frame still, turned by the 5°.
    const weiter = inHand(r, both, state('right', -50 * GRAD));
    expect(weiter.frame).toBe(BILD.gedreht);
    expect(weiter.rotation).toBeCloseTo(-50 * GRAD + TURN_STEP, 12);
    // Within half a step the turned clip does not apply; the steps do.
    expect(inHand(r, both, state('right', -20 * GRAD)).frame).toBe(BILD.ab0);
  });

  it('ein gespiegelter Gegenstand an einer Figur mit eigenen linken Bildern: die Stufen seiner Quellseite, im anderen Drehsinn', () => {
    // The body draws its left pictures, the symmetric item mirrors its right ones (only the item is mirrored).
    const sym = probe({ steps: ['right'], symmetric: true });
    const rig2 = new FigureRig(base, ['walk', 'idle'], [{ slot: 'waffe', sprite: sym }]);
    expect(inHand(rig2, sym, state('left', 45 * GRAD)).frame).toBe(BILD.ab30);
    expect(inHand(rig2, sym, state('left', -45 * GRAD)).frame).toBe(BILD.clip);
  });

  it('eine Stufe braucht die Positionen ihres Clips', () => {
    expect(() => new FigureRig(base, ['walk', 'idle'], [{ slot: 'waffe', sprite: probe({ steps: ['right'], lengthOff: true }) }])).toThrow(/Positionen wie walk_right/);
  });
});
