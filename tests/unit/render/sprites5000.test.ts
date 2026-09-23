/**
 * M1-24 / §32 M1 „5 000 animierte Sprites bei 60 FPS“: die Bench-Szene `sprites-5000` zeigt genau
 * 5 000 animierte Sprites (jedes ändert sich mit der Zeit – Frame, Position, Glühstufe – oder wiegt
 * sich im Wind des Sprite-Shaders) und 32 Punktlichter; der Boden ist die statische Kachelkarte
 * (vier Chunks), kein Sprite – wie in der Spielwelt.
 */
import { describe, expect, it } from 'vitest';
import { INSTANCE_STRIDE, INSTANCE_WORDS, LAYER, OFFSET, SPRITE_FLAG } from '../../../src/render/batch/spriteLayout';
import { RenderScene } from '../../../src/render/scene';
import { GLOW_STEPS, GLOW_STEPS_PER_SECOND, glowStep, STRESS_LIGHTS, STRESS_SPRITES, Sprites5000Scene } from '../../../src/render/scenes/sprites5000';

/** Ground chunks under the view (2 × 2). */
const GROUND_CHUNKS = 4;
/** Two presentation times a quarter second apart: a torch frame (12 fps) and a glow step (4/s) further. */
const T0 = 1;
const T1 = 1.25;

function snapshot(time: number): { words: Uint32Array; bytes: Uint8Array; layers: Uint8Array; count: number; lights: number; chunks: number } {
  const scene = new RenderScene();
  const source = new Sprites5000Scene();
  scene.beginFrame(time);
  source.fill(scene, time);
  const list = scene.sprites;
  const words = list.words.slice(0, list.count * INSTANCE_WORDS);
  return { words, bytes: new Uint8Array(words.buffer), layers: list.layerKeys.slice(0, list.count), count: list.count, lights: scene.lights.count, chunks: source.terrainChunks.length };
}

describe('Bench-Szene sprites-5000', () => {
  it('zeigt genau 5 000 animierte Sprites und 32 Punktlichter auf der Kachelkarte', () => {
    const a = snapshot(T0);
    const b = snapshot(T1);
    expect(a.count).toBe(STRESS_SPRITES);
    expect(b.count).toBe(a.count);
    expect(a.lights).toBe(STRESS_LIGHTS);
    expect(a.chunks).toBe(GROUND_CHUNKS);
    let animated = 0;
    for (let i = 0; i < a.count; i++) {
      expect(a.layers[i]).not.toBe(LAYER.ground);
      const w = i * INSTANCE_WORDS;
      let changed = false;
      for (let k = 0; k < INSTANCE_WORDS; k++) if (a.words[w + k] !== b.words[w + k]) changed = true;
      const windy = ((a.bytes[i * INSTANCE_STRIDE + OFFSET.misc + 1] ?? 0) & SPRITE_FLAG.wind) !== 0;
      if (changed || windy) animated++;
    }
    expect(animated).toBe(STRESS_SPRITES);
  });

  it('Glühpilze pulsieren in harten Stufen; benachbarte Stufen unterscheiden sich immer', () => {
    for (let i = 0; i < GLOW_STEPS.length; i++) expect(GLOW_STEPS[i]).not.toBe(GLOW_STEPS[(i + 1) % GLOW_STEPS.length]);
    const step = 1 / GLOW_STEPS_PER_SECOND;
    for (const phase of [0, 0.3, 0.99]) {
      for (let k = 0; k < GLOW_STEPS.length * 2; k++) {
        const t = k * step + step / 2;
        expect(glowStep(t, phase)).not.toBe(glowStep(t + step, phase));
        expect(GLOW_STEPS).toContain(glowStep(t, phase));
      }
    }
    // Negative Zeiten (vor dem Start) bleiben in der Tabelle.
    expect(GLOW_STEPS).toContain(glowStep(-0.6, 0.2));
  });
});
