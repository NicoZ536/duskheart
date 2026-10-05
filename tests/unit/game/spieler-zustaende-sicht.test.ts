/**
 * M6-78 Blendung senkt die Sicht in der Darstellung (MASTERPROMPT §11.3 „Jeder Zustand: … sichtbare Wirkung“; Zustand
 * `geblendet`: „Du siehst im Dunkeln kaum etwas“, `sicht` 0,3): die Sitzung reicht den Sichtfaktor der Zustände an die
 * Präsentation (`GameSession.sampleSight`), die Spielansicht schließt das Bild vom Rand her bis auf den verbliebenen Anteil
 * der Sicht um die Figur: M6-Gate (zustand-geblendet) – mit einem Blendschleier, der Bayer-Iris der Post-Abdeckung in
 * gleißendem Weiß (`scene.post.transition` = `blindCover(Sicht)`, Farbe `BLIND_GLARE.glare`), nicht mehr mit der Vignette der
 * Farbstimmung (1 − Sicht: höchstens halb so dunkel am Rand, 60 % des Bilds unberührt – las sich nicht als Blendung). Ohne
 * Zustand bleibt der Wert genau 1 und das Bild offen.
 */
import { describe, expect, it } from 'vitest';
import { GameSession } from '../../../src/game/session';
import { POST_LOOK } from '../../../src/render/passes/postPass';
import { POST_SLOT, TRANSITION_COLOR } from '../../../src/render/post/state';
import { paletteColor } from '../../../src/render/post/atmosphereTable';
import { RenderScene } from '../../../src/render/scene';
import { BLIND_GLARE, blindCover, fillAtmosphere } from '../../../src/render/world/atmosphereScene';
import type { GameWorldBinding } from '../../../src/render/world/gameScene';
import type { WorldHost } from '../../../src/render/world/worldHost';
import { TILE_PX } from '../../../src/world/model/coords';

/** A generated small world and a few ticks: more than the default limit on a loaded machine. */
const TIMEOUT_MS = 120_000;

describe('Geblendet: die Sicht der Darstellung (M6-78)', () => {
  it(
    'die Sitzung meldet den Sichtfaktor; die Spielansicht schließt das Bild um den verlorenen Anteil – ohne Zustand nichts',
    () => {
      const session = new GameSession({ config: { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } });
      // Without a player: the neutral sight.
      expect(session.sampleSight()).toBe(1);
      session.command({ type: 'player.spawn' });
      session.step();
      session.command({ type: 'setTime', hour: 12, minute: 0 });
      session.step();
      expect(session.sampleSight()).toBe(1);

      // The game view's atmosphere over the player (no chunk fields needed for the post state of the player).
      const host = { get: () => undefined } as unknown as WorldHost;
      const binding: GameWorldBinding = { session, host };
      const scene = new RenderScene();
      const at = { x: 0, y: 0, layer: 0 as const };
      expect(session.sampleFocus(at)).toBe(true);
      const frame = (t: number): void => {
        scene.beginFrame(t);
        fillAtmosphere(scene, binding, 0, at.x, at.y, 30 * TILE_PX, 17 * TILE_PX, t);
      };
      frame(1);
      expect(scene.post.off(POST_SLOT.vignette)).toBe(true);
      expect(scene.post.off(POST_SLOT.transition)).toBe(true);

      session.command({ type: 'conditions.apply', id: 'geblendet' });
      session.step();
      expect(session.sampleSight()).toBeCloseTo(0.3, 12);
      frame(2);
      // The glare covers the picture from where the sight ends: clear up to 0,3 of the way out from the figure's place,
      // fully covered from 0,3 + seam/(1 − seam) ≈ 0,49 on (the cover's key, postPass.ts `transitionKey`).
      expect(scene.post.transition).toBeCloseTo(0.7 * (1 - POST_LOOK.transitionSeam), 12);
      expect(blindCover(0.3)).toBeCloseTo(0.588, 12);
      expect([scene.post.transitionR, scene.post.transitionG, scene.post.transitionB]).toEqual([...BLIND_GLARE.glare]);
      expect(BLIND_GLARE.glare).toEqual(paletteColor('eis.4'));
      // A glare washes out: bright, not the dark cover of a change of layer – and the grade's vignette stays its own.
      expect(BLIND_GLARE.glare[0] + BLIND_GLARE.glare[1] + BLIND_GLARE.glare[2]).toBeGreaterThan(2.5);
      expect(BLIND_GLARE.glare).not.toEqual(TRANSITION_COLOR);
      expect(scene.post.off(POST_SLOT.vignette)).toBe(true);

      // Nachtsicht widens the sight (2): no closing in; together with Geblendet the factors multiply (0,6).
      session.command({ type: 'conditions.apply', id: 'nachtsicht' });
      session.step();
      expect(session.sampleSight()).toBeCloseTo(0.6, 12);
      frame(3);
      expect(scene.post.transition).toBeCloseTo(0.4 * (1 - POST_LOOK.transitionSeam), 12);
      session.command({ type: 'conditions.cure', id: 'geblendet' });
      session.step();
      expect(session.sampleSight()).toBeCloseTo(2, 12);
      frame(4);
      expect(scene.post.off(POST_SLOT.transition)).toBe(true);
      expect(scene.post.off(POST_SLOT.vignette)).toBe(true);
      session.command({ type: 'conditions.cure', id: 'nachtsicht' });
      session.step();
      expect(session.sampleSight()).toBe(1);
    },
    TIMEOUT_MS,
  );
});
