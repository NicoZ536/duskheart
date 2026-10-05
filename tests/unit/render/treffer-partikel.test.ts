/**
 * Treffer-Partikel im Standbild (M6-Gate Runde 2, `kreatur-betaeubt`; MASTERPROMPT §6.2 "Einschlagpartikel je Material",
 * §4.6 Lesbarkeit; src/render/game/combatFeedback.ts, assets-src/sprites/kampf/effekte.ts, assets-src/sprites/effekte/
 * zustand_partikel.ts): über dem Kopf des betäubten Wolfs lasen sich die eingefrorenen Fellbüschel – ein schmaler Strich mit
 * hellem Kopf und dunkelbraunem Stiel – und der senkrechte Strich des fallenden Blutstropfens als Stock oder Fühler neben den
 * Sternen. Ein Büschel ist ein weicher Klumpen (oben helle Wolle, der Schatten nur darunter), ein weggeschleuderter Tropfen
 * ist im Flug rund und landet als Spritzer; ein gelandetes Büschel liegt still (es dreht sich nicht mehr). Die Blutung des
 * Spielers tropft weiter mit dem fallenden Tropfen.
 */
import { describe, expect, it } from 'vitest';
import { TRANSPARENT, type Sprite, type SpriteFrame } from '../../../assets-src/lib/sprite';
import { RAMPS, paletteRef } from '../../../assets-src/palette';
import kampfEffekte from '../../../assets-src/sprites/kampf/effekte';
import zustandPartikel from '../../../assets-src/sprites/effekte/zustand_partikel';
import type { AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';
import { CombatFeedback, LANDED_HOLD, MATERIAL_IMPACT, PARTICLES } from '../../../src/render/game/combatFeedback';
import type { RenderScene } from '../../../src/render/scene';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const HZ = 60;

function spriteOf(list: readonly unknown[], id: string): Sprite {
  const s = (list as Sprite[]).find((x) => x.id === id);
  if (s === undefined) throw new Error(`Sprite ${id} fehlt`);
  return s;
}

/** The covered pixels of a frame: x, y and `rampe.stufe`. */
function pixels(s: Sprite, f: SpriteFrame): { x: number; y: number; ref: string }[] {
  const out: { x: number; y: number; ref: string }[] = [];
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const v = f.index[y * s.w + x] as number;
      if (v !== TRANSPARENT) out.push({ x, y, ref: paletteRef(v) });
    }
  }
  return out;
}

/** Luma (Rec. 601) of palette colour `rampe.stufe`. */
function luma(ref: string): number {
  const [name, step] = ref.split('.');
  const hex = RAMPS.find((r) => r.name === name)?.colors[Number(step)] ?? '#000000';
  return (0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16) + 0.114 * parseInt(hex.slice(5, 7), 16)) / 255;
}

function box(p: readonly { x: number; y: number }[]): { w: number; h: number } {
  const xs = p.map((q) => q.x);
  const ys = p.map((q) => q.y);
  return { w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 };
}

/** Sprite and frame index of every piece `feedback` draws at simulation time `now` [ticks]. */
function drawn(feedback: CombatFeedback, now: number): { sprite: string; frame: number }[] {
  const owner = new Map<SpriteFrameRef, [string, number]>();
  for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f, i) => owner.set(f, [s.id, i]));
  const out: { sprite: string; frame: number }[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        const o = owner.get(d.frame as SpriteFrameRef);
        out.push({ sprite: o?.[0] ?? '?', frame: o?.[1] ?? -1 });
        return out.length - 1;
      },
    },
    water: { impulse: () => true },
    light: { reset: () => ({}) },
    lights: { push: () => undefined },
    post: { distortion: { shockwave: () => 0 } },
  } as unknown as RenderScene;
  feedback.draw(scene, MANIFEST, 0, now, HZ);
  return out;
}

/** A hit on `material` at the ground at tick 50 whose pieces all leave upwards at `upPx` px/s (they land after 2·up/g). */
function hit(material: 'fell' | 'fleisch', upPx: number): CombatFeedback {
  const f = new CombatFeedback();
  f.impact(material, 100, 100, 0, 1, 0, 3, false, 50, 0, 1);
  (f as unknown as { vz: Float32Array }).vz.fill(upPx);
  return f;
}

describe('Fellbüschel: ein weicher Klumpen, kein Stock', () => {
  it('jeder Frame ist ein kompakter Klumpen, oben hell, der Schatten nur unter Hellem – kein Stiel', () => {
    const fell = spriteOf(kampfEffekte, PARTICLES.fell.sprite);
    expect(fell.frames.length).toBeGreaterThanOrEqual(4);
    for (const [i, f] of fell.frames.entries()) {
      const p = pixels(fell, f);
      const at = new Map(p.map((q) => [`${q.x},${q.y}`, luma(q.ref)]));
      // A clump: a filled 2×2 block in it, no longer than 5 px, at least half of its box covered.
      expect(p.some((q) => at.has(`${q.x + 1},${q.y}`) && at.has(`${q.x},${q.y + 1}`) && at.has(`${q.x + 1},${q.y + 1}`)), `Frame ${i}`).toBe(true);
      const b = box(p);
      expect(Math.max(b.w, b.h), `Frame ${i}`).toBeLessThanOrEqual(5);
      expect(p.length / (b.w * b.h), `Frame ${i}`).toBeGreaterThanOrEqual(0.5);
      // Lit from above: the topmost pixel of every column is at least as light as the lowest.
      for (const x of new Set(p.map((q) => q.x))) {
        const col = p.filter((q) => q.x === x).sort((a, b2) => a.y - b2.y);
        expect(luma((col[0] as { ref: string }).ref), `Frame ${i}, Spalte ${x}`).toBeGreaterThanOrEqual(luma((col[col.length - 1] as { ref: string }).ref));
      }
      // No stem: every pixel of the darkest tone sits right under a lighter one – shade under the light, never a tail of its
      // own (the old tuft's two dark brown pixels hung below its light head as a stick).
      const darkest = Math.min(...at.values());
      for (const q of p) {
        if (luma(q.ref) !== darkest) continue;
        const above = at.get(`${q.x},${q.y - 1}`);
        expect(above !== undefined && above > darkest, `Frame ${i}, (${q.x}, ${q.y})`).toBe(true);
      }
    }
  });

  it('im Flug dreht es sich, gelandet liegt es still', () => {
    expect(MATERIAL_IMPACT.fell.main).toBe('fell');
    expect(PARTICLES.fell.landed).toBe(LANDED_HOLD);
    // Up at 30 px/s from the ground: landed after 0,25 s (every piece lives at least 0,8 × `life` = 0,48 s).
    const f = hit('fell', 30);
    const tufts = (s: number): number[] => drawn(f, 50 + s * HZ).filter((p) => p.sprite === PARTICLES.fell.sprite).map((p) => p.frame);
    // In the air it tumbles (`flug` at 16 fps: another frame 0,1 s later).
    expect(tufts(0.1)).not.toEqual(tufts(0.2));
    // On the ground it keeps the frame it landed with.
    const landed = tufts(0.3);
    expect(landed.length).toBeGreaterThan(0);
    expect(tufts(0.37)).toEqual(landed);
    expect(tufts(0.45)).toEqual(landed);
  });
});

describe('Blut aus einem Treffer: im Flug ein runder Tropfen, gelandet ein Spritzer', () => {
  it('der Flug-Frame ist rund (2 × 2), kein senkrechter Strich; die Blutung tropft weiter mit `fallen`', () => {
    const blut = spriteOf(zustandPartikel, PARTICLES.blut.sprite);
    const flug = blut.clips[PARTICLES.blut.clip];
    expect(flug).toBeDefined();
    const p = pixels(blut, blut.frames[flug?.frames[0] ?? -1] as SpriteFrame);
    expect(box(p)).toEqual({ w: 2, h: 2 });
    expect(p).toHaveLength(4);
    // The bleeding (figureFx.ts takes the sprite's first clip) still drips with the falling drop.
    expect(Object.keys(blut.clips)[0]).toBe('fallen');
    expect(blut.clips[PARTICLES.blut.landed]).toBeDefined();
  });

  it('im Flug der runde Tropfen, nach der Landung der Spritzer', () => {
    expect(MATERIAL_IMPACT.fleisch.main).toBe('blut');
    const sprite = MANIFEST.sprites[PARTICLES.blut.sprite];
    const flug = sprite?.clips[PARTICLES.blut.clip]?.frames[0];
    const spritzer = sprite?.clips[PARTICLES.blut.landed]?.frames[0];
    expect(flug).toBeDefined();
    expect(spritzer).toBeDefined();
    expect(flug).not.toBe(spritzer);
    const f = hit('fleisch', 30);
    const drops = (s: number): number[] => drawn(f, 50 + s * HZ).filter((p) => p.sprite === PARTICLES.blut.sprite).map((p) => p.frame);
    const air = drops(0.1);
    expect(air.length).toBeGreaterThanOrEqual(2 + 3);
    for (const d of air) expect(d).toBe(flug);
    const ground = drops(0.4);
    expect(ground).toHaveLength(air.length);
    for (const d of ground) expect(d).toBe(spritzer);
  });
});
