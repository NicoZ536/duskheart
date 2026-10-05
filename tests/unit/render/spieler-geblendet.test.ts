/**
 * M6-Gate (zustand-geblendet.png: "kein blendungstypisches Zeichen – keine Blendfunken am Kopf (Kreaturen bekommen sie nach
 * ADR-0173, der Spieler nicht)"; MASTERPROMPT §11.3 „Jeder Zustand: … sichtbare Wirkung“; src/render/game/playerFigure.ts
 * `PLAYER_DAZZLE`): a condition whose visual hook is the dazzle (`sichtbar: 'blendung'`, Geblendet) flickers the creatures'
 * dazzle sparks at the player's head – two of them, either side of the head's top and just above it, emissive like a
 * creature's; without it none. (The picture closing in with a glare is `spieler-zustaende-sicht.test.ts`.)
 */
import { describe, expect, it } from 'vitest';
import { CONDITIONS } from '../../../src/content/conditions';
import { createCombatSample, type CombatSample } from '../../../src/game/combat/sample';
import { createPlayerSample, GameSession, type PlayerSample } from '../../../src/game/session';
import { clipFrameAt } from '../../../src/render/anim/animation';
import { spriteFrame, type AtlasData, type AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';
import { PLAYER_BODY_SPRITE, PLAYER_DAZZLE, PlayerFigure } from '../../../src/render/game/playerFigure';
import { DAZZLE, STATUS_SPRITE } from '../../../src/render/game/statusMarks';
import type { RenderScene } from '../../../src/render/scene';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const STATUS_FRAMES = new Set<SpriteFrameRef>(MANIFEST.sprites[STATUS_SPRITE]?.frames ?? []);
/** A generated small world: more than the default limit on a loaded machine. */
const TIMEOUT_MS = 120_000;

interface Mark {
  readonly x: number;
  readonly y: number;
  readonly glow: number;
}

/** The status marks `figure` draws for `session`'s player standing idle at (100, 200) facing down. */
function marks(figure: PlayerFigure, session: GameSession, time: number): Mark[] {
  const s = {
    sim: session.sim,
    onEvent: () => () => undefined,
    samplePlayer(out: PlayerSample): boolean {
      Object.assign(out, createPlayerSample(), { x: 100, y: 200, facing: 'down', state: 'idle', health: 100, maxHealth: 100 });
      return true;
    },
    sampleCombat(out: CombatSample): boolean {
      Object.assign(out, createCombatSample());
      return true;
    },
  };
  const out: Mark[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        if (STATUS_FRAMES.has(d.frame as SpriteFrameRef)) out.push({ x: d.x, y: d.y, glow: d.emissiveBoost });
        return 0;
      },
    },
  } as unknown as RenderScene;
  expect(figure.place(scene, ATLAS, s, time, 100, 200)).toBe(true);
  return out;
}

describe('Geblendet: Blendfunken am Kopf des Spielers (M6-Gate)', () => {
  it(
    'zwei Funken beiderseits des Scheitels, knapp darüber, leuchtend – nur solange ein blendender Zustand wirkt',
    () => {
      expect(CONDITIONS.some((c) => c.id === 'geblendet' && c.sichtbar === 'blendung')).toBe(true);
      const session = new GameSession({ config: { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } });
      session.command({ type: 'player.spawn' });
      session.step();
      const figure = new PlayerFigure();
      expect(marks(figure, session, 1)).toEqual([]);

      session.command({ type: 'conditions.apply', id: 'geblendet' });
      session.step();
      const body = MANIFEST.sprites[PLAYER_BODY_SPRITE];
      const clip = body?.clips['idle_down'];
      if (body === undefined || clip === undefined) throw new Error('Spielerfigur fehlt');
      // Standing idle since 0 s (`stateSeconds`): the clip's first frame.
      const index = clipFrameAt(clip, 0);
      const top = body.sockets['last']?.[index];
      if (top === undefined || top === null) throw new Error('Sockel last fehlt');
      const frame = spriteFrame(body, index);
      const headX = 100 + top[0] - frame.ax;
      const headY = 200 + top[1] - frame.ay;
      for (const time of [1, 1.03, 1.2]) {
        const m = marks(figure, session, time);
        expect(m, `t ${time}`).toHaveLength(DAZZLE.sparks);
        // Either side of the head's top, beside the 12-px head, the second a little higher (not a level line).
        expect(m.map((p) => p.x - headX).sort((a, b) => a - b), `t ${time}`).toEqual([-PLAYER_DAZZLE.spreadPx, PLAYER_DAZZLE.spreadPx]);
        expect(m.map((p) => headY - p.y).sort((a, b) => a - b), `t ${time}`).toEqual([DAZZLE.liftPx, DAZZLE.liftPx + PLAYER_DAZZLE.risePx]);
        for (const p of m) expect(p.glow, `t ${time}`).toBe(DAZZLE.glow);
      }

      session.command({ type: 'conditions.cure', id: 'geblendet' });
      session.step();
      expect(marks(figure, session, 2)).toEqual([]);
      figure.dispose();
    },
    TIMEOUT_MS,
  );
});
