/**
 * M6-Gate (kreatur-betaeubt-nacht.png: "helle Kerbe an der Brust", also in telegraph.png; src/render/game/figureFx.ts): the
 * sparks of a light lit are a burst timed from the frame that first draws them – and over, at the latest, once the
 * simulation has run their life past the tick of their event, whichever clock passes it first. A scenario runs its
 * simulation on while its presentation time stands (a frame may have drawn the burst at the start) and draws its still at
 * that one time: the torch lit at the start stood frozen as a spark cluster on the chest. Frames drawn in step with the
 * simulation see the burst to its end (one tick of slack); without a simulation (a view following only events) the
 * presentation time alone counts.
 */
import { describe, expect, it } from 'vitest';
import type { AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { FigureFx, SPARKS } from '../../../src/render/game/figureFx';
import type { RenderScene } from '../../../src/render/scene';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const HZ = 60;
/** The ticks a burst of sparks lives. */
const LIFE_TICKS = SPARKS.life * HZ;

function countingScene(): { scene: RenderScene; count: () => number } {
  let n = 0;
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push() {
        n++;
        return n - 1;
      },
    },
  } as unknown as RenderScene;
  return { scene, count: () => n };
}

/** A session raising `lightIgnited` at the simulation's tick; `withSim` false: one without a simulation. */
function session(withSim = true): { sim: { tick: number; clock: { tickHz: number } }; light: () => void; value: object } {
  const sim = { tick: 100, clock: { tickHz: HZ } };
  let ignited: ((e: unknown) => void) | null = null;
  const value = {
    ...(withSim ? { sim } : {}),
    onEvent(name: string, h: (e: unknown) => void) {
      if (name === 'lightIgnited') ignited = h;
      return () => undefined;
    },
  };
  return { sim, value, light: () => (ignited as ((e: unknown) => void) | null)?.({ x: 200, y: 300, layer: 0, tick: sim.tick, light: 7 }) };
}

function draw(fx: FigureFx, time: number): number {
  const r = countingScene();
  fx.drawBursts(r.scene, MANIFEST, 0, time);
  return r.count();
}

describe('Funken eines entzündeten Lichts (M6-Gate)', () => {
  it('kein Frame zeichnete sie, bevor die Simulation ihre Lebenszeit hinter sich hatte: vorbei – nicht eingefroren am Anfang', () => {
    const s = session();
    const fx = new FigureFx();
    fx.follow(s.value as never);
    s.light();
    expect(fx.bursting).toBe(1);
    // The scenario's simulation runs on without pictures, then its still is drawn at one presentation time.
    s.sim.tick += Math.ceil(LIFE_TICKS) + 2;
    expect(draw(fx, 12)).toBe(0);
    expect(draw(fx, 12)).toBe(0);
    expect(fx.bursting).toBe(0);
    fx.dispose();
  });

  it('ein Frame zeichnete sie, dann stand die Präsentationszeit, während die Simulation weiterlief: vorbei – nicht eingefroren', () => {
    const s = session();
    const fx = new FigureFx();
    fx.follow(s.value as never);
    s.light();
    // A frame at the scenario's start draws them …
    expect(draw(fx, 7)).toBeGreaterThan(0);
    // … then its simulation runs on past their life while the presentation time stands: the still shows none.
    s.sim.tick += Math.ceil(LIFE_TICKS) + 2;
    expect(draw(fx, 7)).toBe(0);
    expect(fx.bursting).toBe(0);
    fx.dispose();
  });

  it('Frames im Gleichschritt mit der Simulation sehen sie bis zum Ende ihrer Zeit', () => {
    const s = session();
    const fx = new FigureFx();
    fx.follow(s.value as never);
    s.light();
    // The frame of the next tick draws them; frames and ticks then advance together (60 Hz).
    s.sim.tick += 1;
    const t0 = 5;
    let last = 0;
    for (let k = 0; k <= Math.floor(LIFE_TICKS); k++) {
      const n = draw(fx, t0 + k / 60);
      if (n > 0) last = k;
      s.sim.tick += 1;
    }
    // Drawn up to the end of their life on presentation time (the last tick of it at most cut off).
    expect(last).toBeGreaterThanOrEqual(Math.floor(LIFE_TICKS) - 1);
    // Past their life: gone.
    expect(draw(fx, t0 + SPARKS.life + 0.05)).toBe(0);
    expect(fx.bursting).toBe(0);
    fx.dispose();
  });

  it('ohne Simulation (nur Ereignisse) gilt die Zeit des ersten Frames wie bisher', () => {
    const s = session(false);
    const fx = new FigureFx();
    fx.follow(s.value as never);
    s.light();
    s.sim.tick += Math.ceil(LIFE_TICKS) * 4;
    expect(draw(fx, 3)).toBeGreaterThan(0);
    expect(draw(fx, 3 + SPARKS.life + 0.01)).toBe(0);
    fx.dispose();
  });
});
