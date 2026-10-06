/**
 * The world events in the game view (M7-38 … M7-40; src/render/world/worldEventsScene.ts): every sky preset the register names
 * has its grading; the preset rises over the announcement to `ANNOUNCE_SHARE`, after the start to the full preset and falls
 * at the end, in quantized steps; a strike draws its bolt for any point – also those whose hash has the top bit set (the
 * variant index must never be negative: the bolt's frame would be undefined and the frame would throw) – and lights it; the
 * forest fire's dry storm turns the storm's rain into ash.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import type { WorldEventDef } from '../../../src/content/worldEvents/schema';
import type { WorldEventLine, WorldEventSample } from '../../../src/game/samples/orte';
import type { SimEventMap } from '../../../src/game/sim';
import type { AtlasData, AtlasSprite } from '../../../src/render/assets/atlas';
import { RenderScene } from '../../../src/render/scene';
import { ANNOUNCE_SHARE, BOLT_SECONDS, EVENT_GRADING, presetStrength, RAMP_MINUTES, WorldEventView } from '../../../src/render/world/worldEventsScene';

const TICKS_PER_MINUTE = 60;

/** A sprite with `n` frames (the view reads frames and clips only). */
function fx(id: string, n: number): AtlasSprite {
  return { id, frames: Array.from({ length: n }, (_, i) => ({ x: i * 8, y: 0, w: 8, h: 8, ox: 4, oy: 8 })), clips: {} } as unknown as AtlasSprite;
}

const ATLAS = { manifest: { sprites: { fx_blitz: fx('fx_blitz', 3), fx_sternschnuppe: fx('fx_sternschnuppe', 2), fx_meteor: fx('fx_meteor', 2), fx_einschlag: fx('fx_einschlag', 4) } } } as unknown as AtlasData;

/** A session that hands the view's handlers back, and the world event lines the view samples. */
function session(lines: Partial<WorldEventLine>[] = []) {
  const handlers = new Map<string, (e: unknown) => void>();
  return {
    onEvent<K extends keyof SimEventMap>(type: K, h: (e: SimEventMap[K]) => void): () => void {
      handlers.set(type, h as (e: unknown) => void);
      return () => handlers.delete(type);
    },
    emit<K extends keyof SimEventMap>(type: K, e: SimEventMap[K]): void {
      handlers.get(type)?.(e);
    },
    sampleWorldEvents(out: WorldEventSample): WorldEventSample {
      out.count = 0;
      for (const l of lines) Object.assign(out.lines[out.count++] as WorldEventLine, l);
      return out;
    },
  };
}

describe('Weltereignisse im Bild', () => {
  it('jedes Himmels-Preset des Registers hat seine Farbgebung', () => {
    const named = (CONTENT.collection('worldEvents').values() as readonly WorldEventDef[]).map((d) => d.ankuendigung.himmel).filter((h): h is string => h !== undefined);
    expect(named.length).toBeGreaterThanOrEqual(4);
    for (const h of named) expect(EVENT_GRADING[h], h).toBeDefined();
  });

  it('Stärke: Ankündigung bis ANNOUNCE_SHARE, nach dem Start voll, am Ende aus – in Stufen', () => {
    const line: WorldEventLine = { event: 'lumenregen', minutes: 0, himmel: 'lumenregen', phase: 'angekuendigt', announceTick: 0, startTick: 600, endTick: 6000 };
    expect(presetStrength(line, 0, TICKS_PER_MINUTE)).toBe(0);
    expect(presetStrength(line, 600, TICKS_PER_MINUTE)).toBeCloseTo(ANNOUNCE_SHARE, 1);
    const running: WorldEventLine = { ...line, phase: 'aktiv' };
    expect(presetStrength(running, 600, TICKS_PER_MINUTE)).toBeCloseTo(ANNOUNCE_SHARE, 1);
    expect(presetStrength(running, 600 + RAMP_MINUTES * TICKS_PER_MINUTE, TICKS_PER_MINUTE)).toBe(1);
    expect(presetStrength(running, 6000, TICKS_PER_MINUTE)).toBe(0);
    const s = presetStrength(running, 700, TICKS_PER_MINUTE);
    expect(Math.round(s * 32)).toBe(s * 32);
  });

  it('ein Blitz zeichnet sich an jedem Punkt (auch mit gesetztem Hash-Oberbit) und leuchtet', () => {
    const view = new WorldEventView();
    const s = session();
    view.follow(s);
    // Many points: their hashes cover both halves of the u32 range.
    for (let k = 0; k < 64; k++) {
      s.emit('lightningStruck', { x: 1000 + k * 37, y: 2000 + k * 53, layer: 0, ziel: 'baum', entzuendet: false, tick: 10 } as SimEventMap['lightningStruck']);
      const scene = new RenderScene();
      view.draw(scene, ATLAS, s, 0, 5, 10, 60, 0, 0, 960, 540);
      expect(view.stats.bolts).toBeGreaterThan(0);
      expect(scene.sprites.count).toBe(view.stats.bolts);
      expect(scene.lights.count).toBeGreaterThan(0);
    }
    // After `BOLT_SECONDS` the bolt is gone.
    const later = new RenderScene();
    view.draw(later, ATLAS, s, 0, 5 + BOLT_SECONDS + 0.01, 10, 60, 0, 0, 960, 540);
    expect(view.stats.bolts).toBe(0);
  });

  it('Waldbrand: der Regen des Gewitters wird Asche, der Blitz bleibt', () => {
    const view = new WorldEventView();
    const s = session([{ event: 'waldbrand', phase: 'aktiv', himmel: 'waldbrand' }]);
    view.follow(s);
    const scene = new RenderScene();
    scene.particles.weather.set('regen', 1);
    scene.particles.weather.storm = 1;
    view.draw(scene, ATLAS, s, 0, 1, 1, 60, 0, 0, 960, 540);
    expect(scene.particles.weather.id).toBe('asche');
    expect(scene.particles.weather.amount).toBeLessThan(1);
    expect(scene.particles.weather.storm).toBe(1);
  });
});
