/**
 * M1-16: animation clips (frame timing, 8–12 fps for figures, loops, one-shots), frame events
 * (in order, none skipped, none doubled), four directions with mirroring only for symmetric sets,
 * equipment layers on the hand/head sockets of every frame (offsets, mirroring, draw order).
 */
import { describe, expect, it } from 'vitest';
import { Animator, ClipEventCursor, clipFinished, clipFrameAt, resolveDirection, validateClip, validateDirectional, type AnimationClip, type DirectionalClips } from '../../../src/render/anim/animation';
import { defaultFigureState, FIGURE_LAYER_ORDER, FigureRig, SLOT_SOCKET, socketOffset } from '../../../src/render/anim/figure';
import { atlasSprite, type AtlasSprite } from '../../../src/render/assets/atlas';
import { sceneAtlas } from '../../../src/render/assets/sceneSprites';
import { INSTANCE_WORDS, OFFSET } from '../../../src/render/batch/spriteLayout';
import { SpriteDesc, SpriteList } from '../../../src/render/batch/spriteList';

const walk: AnimationClip = {
  name: 'walk',
  frames: [10, 11, 12, 13],
  fps: 10,
  loop: true,
  events: [
    { frame: 0, name: 'schritt' },
    { frame: 2, name: 'schritt' },
  ],
};
const swing: AnimationClip = { name: 'swing', frames: [3, 4, 5], fps: 12, loop: false, events: [{ frame: 2, name: 'treffer' }] };

describe('Frame-Timing', () => {
  it('shows frame floor(t · fps), looping', () => {
    expect([0, 0.099, 0.1, 0.3, 0.39, 0.4, 0.5].map((t) => clipFrameAt(walk, t))).toEqual([10, 10, 11, 13, 13, 10, 11]);
  });

  it('one-shot clips hold the last frame and report finished after its frame time', () => {
    expect(clipFrameAt(swing, 10)).toBe(5);
    expect(clipFinished(swing, 2.9 / 12)).toBe(false);
    expect(clipFinished(swing, 3 / 12)).toBe(true);
  });

  it('figures run at 8–12 fps; effects may be faster', () => {
    expect(() => validateClip({ ...walk, fps: 7 }, 'figure')).toThrow(/8–12 fps/);
    expect(() => validateClip({ ...walk, fps: 13 }, 'figure')).toThrow(/8–12 fps/);
    expect(() => validateClip({ ...walk, fps: 24 }, 'effect')).not.toThrow();
    expect(() => validateClip({ ...walk, events: [{ frame: 4, name: 'x' }] }, 'figure')).toThrow(/Frame 4/);
  });
});

describe('Frame-Ereignisse', () => {
  it('fires each event once per pass, in order, also across large steps', () => {
    const a = new Animator();
    const seen: string[] = [];
    const sink = (e: string, f: number): void => void seen.push(`${e}@${f}`);
    a.play(walk);
    a.advance(0.05, sink); // enters frame 0
    a.advance(0.1, sink); // frame 1
    a.advance(0.25, sink); // frames 2, 3, 0 (wrap)
    expect(seen).toEqual(['schritt@0', 'schritt@2', 'schritt@0']);
    expect(a.frame).toBe(10);
  });

  it('one-shot fires its last-frame event exactly once', () => {
    const a = new Animator();
    let hits = 0;
    a.play(swing);
    for (let i = 0; i < 40; i++) a.advance(1 / 60, (e) => (hits += e === 'treffer' ? 1 : 0));
    expect(hits).toBe(1);
    expect(a.finished).toBe(true);
  });

  it('ClipEventCursor (Clip-Zeit je Frame berechnet): feuert die betretenen Positionen mit ihrer Schleife, nichts bei stehender Zeit, beim Neustart die erste Position', () => {
    const cursor = new ClipEventCursor();
    const seen: string[] = [];
    const sink = (e: string, f: number, cycle: number): void => void seen.push(`${e}@${f}/${cycle}`);
    cursor.update(walk, 0, sink); // start: position 0 of loop 0
    cursor.update(walk, 0, sink); // time stands still (a frozen screenshot)
    cursor.update(walk, 0.25, sink); // positions 1, 2
    cursor.update(walk, 0.45, sink); // 3, then 0 of loop 1
    cursor.update(walk, 0.65, sink); // 1, 2 of loop 1
    expect(seen).toEqual(['schritt@0/0', 'schritt@2/0', 'schritt@0/1', 'schritt@2/1']);
    seen.length = 0;
    cursor.update(walk, 0.05, sink); // the time went back: the clip restarted
    expect(seen).toEqual(['schritt@0/0']);
    seen.length = 0;
    cursor.update(swing, 0, sink); // another clip starts
    cursor.update(swing, 1, sink); // a one-shot fires its last position once, in loop 0
    cursor.update(swing, 2, sink);
    expect(seen).toEqual(['treffer@2/0']);
  });

  it('playing the running clip again does not restart it unless asked', () => {
    const a = new Animator();
    a.play(walk);
    a.advance(0.15);
    a.play(walk);
    expect(a.frame).toBe(11);
    a.play(walk, true);
    expect(a.frame).toBe(10);
  });
});

describe('Richtungen und Spiegelung', () => {
  const clips = { down: walk, up: walk, right: walk };
  it('mirrors the opposite side only for symmetric sets', () => {
    const sym: DirectionalClips = { name: 'sym', symmetric: true, clips };
    expect(resolveDirection(sym, 'left')).toEqual({ clip: walk, mirror: true });
    expect(resolveDirection(sym, 'right')).toEqual({ clip: walk, mirror: false });
    const asym: DirectionalClips = { name: 'asym', symmetric: false, clips };
    expect(() => resolveDirection(asym, 'left')).toThrow(/Spiegeln verboten/);
    expect(() => validateDirectional(asym, 'figure')).toThrow();
    expect(() => validateDirectional({ name: 'x', symmetric: true, clips: { down: walk } }, 'figure')).toThrow(/Richtung left fehlt|Richtung up fehlt/);
  });
});

describe('Ausrüstungs-Layer an Sockeln', () => {
  it('socket offset is relative to the anchor and mirrored in x', () => {
    const frame = { x: 0, y: 0, w: 32, h: 32, ax: 16, ay: 31 };
    const out = { x: 0, y: 0 };
    expect(socketOffset(frame, [22, 18], false, out)).toEqual({ x: 6, y: -13 });
    expect(socketOffset(frame, [22, 18], true, out)).toEqual({ x: -6, y: -13 });
  });

  const atlas = sceneAtlas();
  const body = atlasSprite(atlas.manifest, 'wanderer');
  const rig = new FigureRig(body, ['idle', 'walk'], [
    { slot: 'kopf', sprite: atlasSprite(atlas.manifest, 'helm') },
    { slot: 'waffe', sprite: atlasSprite(atlas.manifest, 'schwert') },
    { slot: 'nebenhand', sprite: atlasSprite(atlas.manifest, 'handfackel') },
  ]);

  /** A pushed sprite: its anchor point in the world, rectangle width, anchor in the frame and height base (`full`). */
  interface Pushed {
    x: number;
    y: number;
    rectW: number;
    ax?: number;
    ay?: number;
    base?: number;
  }

  function emit(direction: 'down' | 'up' | 'left' | 'right', time: number, full = false, handAngle = 0): Pushed[] {
    const list = new SpriteList(8);
    const s = defaultFigureState();
    s.handAngle = handAngle;
    s.x = 100;
    s.y = 200;
    s.direction = direction;
    s.action = 'walk';
    s.time = time;
    rig.emit(list, new SpriteDesc(), s);
    const f32 = new Float32Array(list.words.buffer);
    const u16 = new Uint16Array(list.words.buffer);
    const i16 = new Int16Array(list.words.buffer);
    return Array.from({ length: list.count }, (_, i) => ({
      x: f32[i * INSTANCE_WORDS + OFFSET.pos / 4] ?? 0,
      y: f32[i * INSTANCE_WORDS + OFFSET.pos / 4 + 1] ?? 0,
      rectW: u16[i * INSTANCE_WORDS * 2 + OFFSET.rect / 2 + 2] ?? 0,
      ...(full
        ? {
            ax: i16[i * INSTANCE_WORDS * 2 + OFFSET.anchor / 2] ?? 0,
            ay: i16[i * INSTANCE_WORDS * 2 + OFFSET.anchor / 2 + 1] ?? 0,
            base: f32[i * INSTANCE_WORDS + OFFSET.params / 4] ?? 0,
          }
        : {}),
    }));
  }

  it('the equipped figure is asymmetric (sword and torch swap hands when mirrored): left uses its own frames', () => {
    expect(rig.symmetric).toBe(false);
    expect(body.clips['walk_left']).toBeDefined();
  });

  // M6-Gate (spieler-ruestung: a helmet's shadow floated over the head): a socket item stands on the figure's feet – its
  // anchor point is the feet, its height base the figure's, and its frame's anchor lies the socket's height lower, so the
  // picture keeps its place on the socket while the sun's silhouette pass grounds it where the body stands.
  it('places the sword on the hand socket of the current frame, standing on the feet', () => {
    const sword = atlasSprite(atlas.manifest, 'schwert');
    for (let f = 0; f < 4; f++) {
      const t = (f + 0.5) / 10;
      const clip = body.clips['walk_down'];
      const frameIndex = clip ? clipFrameAt(clip, t) : 0;
      const hand = body.sockets['hand']?.[frameIndex];
      const frame = body.frames[frameIndex];
      if (!hand || !frame) throw new Error('Sockel fehlt');
      const sprites = emit('down', t, true);
      const equipped = FIGURE_LAYER_ORDER.down.filter((part) => part === 'body' || part === 'kopf' || part === 'waffe' || part === 'nebenhand');
      const drawn = sprites[equipped.indexOf('waffe')];
      const item = sword.frames[0];
      if (drawn === undefined || item === undefined || drawn.ax === undefined || drawn.ay === undefined) throw new Error('Schwert fehlt');
      // On the feet like the body, with the body's height base …
      expect([drawn.x, drawn.y, drawn.base], `Frame ${frameIndex}`).toEqual([100 + hand[0] - frame.ax, 200, 0]);
      expect(drawn.rectW).toBe(24);
      // … its picture on the hand socket: the top-left corner where the socket puts the item's anchor.
      expect([drawn.x - drawn.ax, drawn.y - drawn.ay], `Frame ${frameIndex}`).toEqual([100 + hand[0] - frame.ax - item.ax, 200 + hand[1] - frame.ay - item.ay]);
    }
  });

  it('every socket item stands on the feet in every direction – helmet, weapon, torch –; a turned weapon turns about its grip', () => {
    const items: readonly ['kopf' | 'waffe' | 'nebenhand', string][] = [
      ['kopf', 'helm'],
      ['waffe', 'schwert'],
      ['nebenhand', 'handfackel'],
    ];
    for (const direction of ['down', 'up', 'right', 'left'] as const) {
      const clip = body.clips[`walk_${direction}`];
      if (clip === undefined) throw new Error(`walk_${direction} fehlt`);
      const frameIndex = clipFrameAt(clip, 0.05);
      const frame = body.frames[frameIndex];
      if (frame === undefined) throw new Error('Frame fehlt');
      const order = FIGURE_LAYER_ORDER[direction].filter((part) => part === 'body' || part === 'kopf' || part === 'waffe' || part === 'nebenhand');
      for (const angle of [0, 0.5]) {
        const sprites = emit(direction, 0.05, true, angle);
        for (const [slot, id] of items) {
          const item = atlasSprite(atlas.manifest, id);
          const ays = new Set(item.frames.map((f) => f.ay));
          expect(ays.size, id).toBe(1);
          const itemAy = item.frames[0]?.ay ?? 0;
          const socket = body.sockets[SLOT_SOCKET[slot] ?? '']?.[frameIndex];
          const d = sprites[order.indexOf(slot)];
          if (socket === undefined || socket === null || d === undefined || d.ay === undefined) throw new Error(`${slot} ${direction} fehlt`);
          const up = frame.ay - socket[1];
          // The picture sits on the socket either way.
          expect(d.y - d.ay, `${slot} ${direction} ${angle}`).toBe(200 - up - itemAy);
          if (slot === 'waffe' && angle !== 0) {
            // Turned: the renderer turns a sprite about its anchor – the grip stays the anchor, at the socket's height.
            expect([d.y, d.ay, d.base], `${slot} ${direction} gedreht`).toEqual([200 - up, itemAy, up]);
          } else {
            // On the figure's ground: anchor line on the feet, the figure's height base (the shadow falls from the feet).
            expect([d.y, d.ay, d.base], `${slot} ${direction}`).toEqual([200, itemAy + up, 0]);
          }
        }
      }
    }
  });

  it('draw order follows the direction: weapon in front facing down, behind facing up', () => {
    const down = emit('down', 0.05);
    const up = emit('up', 0.05);
    expect(down).toHaveLength(4);
    expect(up).toHaveLength(4);
    // Body (32 wide) is first facing down, last-but-helmet facing up.
    expect(down[0]?.rectW).toBe(32);
    expect(up[2]?.rectW).toBe(32);
    expect(up[0]?.rectW).toBe(24);
  });

  it('a symmetric body alone may be mirrored for the left direction', () => {
    const bare = new FigureRig(body, ['walk'], []);
    const list = new SpriteList(2);
    const s = defaultFigureState();
    s.direction = 'left';
    s.action = 'walk';
    bare.emit(list, new SpriteDesc(), s);
    expect(list.count).toBe(1);
  });

  it('rejects layers without their socket and overlay layers with the wrong frame count', () => {
    const noSockets: AtlasSprite = { ...body, sockets: {} };
    expect(() => new FigureRig(noSockets, ['walk'], [{ slot: 'waffe', sprite: atlasSprite(atlas.manifest, 'schwert') }])).toThrow(/Sockel hand/);
    expect(() => new FigureRig(body, ['walk'], [{ slot: 'koerper', sprite: atlasSprite(atlas.manifest, 'fels') }])).toThrow(/Frames wie der Körper/);
  });
});
