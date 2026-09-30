/**
 * M6-15 presentation, M6-15c (MASTERPROMPT §19.4 "Telegraphs … klar sichtbar; Boss-Flächenangriffe mit Bodenmarkierung",
 * §4.6 "Ausholpose + kurzer Glint", §2.8; docs/ART.md §8): every `creatureTelegraph` sets a glint at the creature's head
 * on the side it attacks; an area attack puts its ground marker on the ground layer – a dashed ring of exactly its
 * radius, a ring growing from the centre that meets it on the blow's tick, a fill that thickens – which keeps pace with a
 * wind-up the hitstop stretches, vanishes when the wind-up breaks off and flashes when the blow lands.
 */
import { describe, expect, it } from 'vitest';
import type { CreatureEventMap } from '../../../src/game/creatures/events';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import type { AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';
import { CombatFeedback, PUNKT } from '../../../src/render/game/combatFeedback';
import { TelegraphView } from '../../../src/render/game/telegraphs';
import type { RenderScene } from '../../../src/render/scene';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();

interface Pushed {
  sprite: string;
  frame: number;
  x: number;
  y: number;
  layer: string;
  glow: number;
}

function recordingScene(): { scene: RenderScene; pushed: Pushed[] } {
  const owner = new Map<SpriteFrameRef, [string, number]>();
  for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f, i) => owner.set(f, [s.id, i]));
  const pushed: Pushed[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        const o = owner.get(d.frame as SpriteFrameRef);
        pushed.push({ sprite: o?.[0] ?? '?', frame: o?.[1] ?? -1, x: d.x, y: d.y, layer: d.layer, glow: d.emissiveBoost });
        return pushed.length - 1;
      },
    },
    water: { impulse: () => true },
    light: { reset: () => ({}) },
    lights: { push: () => undefined },
    post: { distortion: { shockwave: () => 0 } },
  } as unknown as RenderScene;
  return { scene, pushed };
}

const START = 100;
const TICKS = 42;
const CENTRE = { x: 400, y: 300, radius: 28 };

function telegraph(flaeche: CreatureEventMap['creatureTelegraph']['flaeche'], angle = Math.PI): CreatureEventMap['creatureTelegraph'] {
  return { entity: 5, creature: 'nachtmahr', angriff: 'stampfen', ticks: TICKS, poseTicks: TICKS, angle, flaeche, layer: 0, x: 448, y: 300, tick: START };
}

/** A creature system whose entity 5 winds up (or not) from `START` until `end`. */
function creatures(state: { attackPhase: string; attackTick: number; attackEndTick: number } | undefined): CreatureSystem {
  return { store: { get: (e: number) => (e === 5 ? state : undefined) } } as unknown as CreatureSystem;
}

describe('Telegraph: Glint und Bodenmarkierung', () => {
  it('der Glint steht am Kopf der Kreatur auf der Seite ihres Angriffs, kurz, emissiv', () => {
    const view = new TelegraphView();
    const feedback = new CombatFeedback();
    view.add(telegraph(null), 64, 1, feedback);
    const r = recordingScene();
    feedback.draw(r.scene, MANIFEST, 0, START + 2, 60);
    const glint = r.pushed.filter((p) => p.sprite === 'kampf_glint');
    expect(glint).toHaveLength(1);
    expect(glint[0]?.x).toBeLessThan(448);
    expect(glint[0]?.y).toBeLessThan(300 - 30);
    expect(glint[0]?.glow).toBe(1);
    const later = recordingScene();
    feedback.draw(later.scene, MANIFEST, 0, START + 20, 60);
    expect(later.pushed.filter((p) => p.sprite === 'kampf_glint')).toEqual([]);
    // No area: no marker.
    const m = recordingScene();
    view.draw(m.scene, MANIFEST, creatures({ attackPhase: 'ausholen', attackTick: START, attackEndTick: START + TICKS }), 0, START + 5);
    expect(view.stats.markers).toBe(0);
  });

  it('die Bodenmarkierung liegt auf dem Boden: Warnring vom Radius der Fläche, wachsender Innenring, dichter werdende Füllung', () => {
    const view = new TelegraphView();
    view.add(telegraph(CENTRE), 64, 0, new CombatFeedback());
    const state = { attackPhase: 'ausholen', attackTick: START, attackEndTick: START + TICKS };
    const at = (now: number) => {
      const r = recordingScene();
      view.draw(r.scene, MANIFEST, creatures(state), 0, now);
      return r.pushed.filter((p) => p.sprite === 'kampf_punkt');
    };
    const early = at(START + 4);
    const late = at(START + 36);
    for (const p of [...early, ...late]) expect(p.layer).toBe('ground');
    const dist = (p: Pushed) => Math.hypot(p.x - CENTRE.x, p.y - CENTRE.y);
    const ring = early.filter((p) => p.frame === PUNKT.warn);
    expect(ring.length).toBeGreaterThan(100);
    for (const p of ring) expect(Math.abs(dist(p) - CENTRE.radius)).toBeLessThan(1);
    const inner = (list: Pushed[]) => Math.max(...list.filter((p) => p.frame === PUNKT.warnHell).map(dist));
    expect(inner(early)).toBeLessThan(inner(late));
    expect(inner(late)).toBeGreaterThan(CENTRE.radius * 0.8);
    const fill = (list: Pushed[]) => list.filter((p) => p.frame === PUNKT.warnFuell).length;
    expect(fill(late)).toBeGreaterThan(fill(early));
    for (const p of late.filter((q) => q.frame === PUNKT.warnFuell)) expect(dist(p)).toBeLessThan(CENTRE.radius);
  });

  it('der Hitstop streckt die Ausholzeit: der Innenring folgt dem späteren Schlag', () => {
    const view = new TelegraphView();
    view.add(telegraph(CENTRE), 64, 0, new CombatFeedback());
    const state = { attackPhase: 'ausholen', attackTick: START, attackEndTick: START + TICKS };
    const innerAt = (now: number) => {
      const r = recordingScene();
      view.draw(r.scene, MANIFEST, creatures(state), 0, now);
      return Math.max(...r.pushed.filter((p) => p.frame === PUNKT.warnHell).map((p) => Math.hypot(p.x - CENTRE.x, p.y - CENTRE.y)));
    };
    const before = innerAt(START + 21);
    state.attackEndTick = START + TICKS * 2;
    expect(innerAt(START + 21)).toBeLessThan(before);
  });

  it('bricht die Ausholphase ab (Taumeln, Tod), verschwindet die Markierung; landet der Schlag, blitzt der Ring kurz hell', () => {
    const cancelled = new TelegraphView();
    cancelled.add(telegraph(CENTRE), 64, 0, new CombatFeedback());
    const r = recordingScene();
    cancelled.draw(r.scene, MANIFEST, creatures({ attackPhase: 'keine', attackTick: -1, attackEndTick: -1 }), 0, START + 10);
    expect(cancelled.stats.markers).toBe(0);
    const later = recordingScene();
    cancelled.draw(later.scene, MANIFEST, creatures({ attackPhase: 'ausholen', attackTick: START, attackEndTick: START + TICKS }), 0, START + 12);
    expect(cancelled.stats.markers).toBe(0);

    const landed = new TelegraphView();
    landed.add(telegraph(CENTRE), 64, 0, new CombatFeedback());
    const state = { attackPhase: 'ausholen', attackTick: START, attackEndTick: START + TICKS };
    landed.draw(recordingScene().scene, MANIFEST, creatures(state), 0, START + TICKS - 1);
    state.attackPhase = 'erholen';
    const flash = recordingScene();
    landed.draw(flash.scene, MANIFEST, creatures(state), 0, START + TICKS + 2);
    const dots = flash.pushed.filter((p) => p.sprite === 'kampf_punkt');
    expect(dots.length).toBeGreaterThan(100);
    expect(dots.every((p) => p.frame === PUNKT.warnHell)).toBe(true);
    const gone = recordingScene();
    landed.draw(gone.scene, MANIFEST, creatures(state), 0, START + TICKS + 20);
    expect(gone.pushed).toEqual([]);
  });
});
