/**
 * M4-40 feedback of filling a dug tile (src/render/game/effects.ts, MASTERPROMPT §2.7 "Jede Aktion hat visuelles …
 * Feedback"): earth shovelled back in (`itemUsed`, use `zuschuetten`, at the centre of the filled tile) drops clods of
 * its material into that tile and raises a little dust there – not the fibres of a bandage. A bandage and a poured
 * bucket keep their own effects.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { SimEventMap } from '../../../src/game/sim';
import type { AtlasData, AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { SpriteDesc } from '../../../src/render/batch/spriteList';
import { DUST_SPRITE, GatherEffects, MATERIAL_PARTICLES, PARTICLE_SPRITES, USE_TINTS, itemMaterial } from '../../../src/render/game/effects';
import { RenderScene } from '../../../src/render/scene';
import { WorldRenderTables } from '../../../src/render/world/tables';
import { TILE_PX } from '../../../src/world/model/coords';
import { centre, field, gatherWorld, type GatherWorld } from '../game/interaktion-testwelt';

let manifest: AtlasManifest;
let atlas: AtlasData;
let tables: WorldRenderTables;

beforeAll(() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('generated atlas missing (npm run assets)');
  manifest = manifestFromGenerated(mod);
  atlas = { manifest } as AtlasData;
  tables = new WorldRenderTables(manifest);
});

interface Pushed {
  readonly frame: string;
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  readonly height: number;
  readonly tint: number;
}

/** Captures the sprite owner, position, depth, height and tint of every sprite pushed into `scene`. */
function capture(scene: RenderScene): Pushed[] {
  const out: Pushed[] = [];
  const push = scene.sprites.push.bind(scene.sprites);
  scene.sprites.push = (d: SpriteDesc): number => {
    const f = d.frame;
    const owner = f === null ? '' : (Object.values(manifest.sprites).find((s) => s.frames.includes(f))?.id ?? '?');
    out.push({ frame: owner, x: d.x, y: d.y, depth: d.depth, height: d.heightBase, tint: (d.tintR << 16) | (d.tintG << 8) | d.tintB });
    return push(d);
  };
  return out;
}

/** A session stand-in on the test world that delivers the events the test emits. */
function session(w: GatherWorld): { session: { onEvent: <K extends keyof SimEventMap>(type: K, h: (p: SimEventMap[K]) => void) => () => void; sim: GatherWorld['sim'] }; emit: <K extends keyof SimEventMap>(type: K, p: SimEventMap[K]) => void } {
  const handlers = new Map<string, ((p: unknown) => void)[]>();
  return {
    session: {
      sim: w.sim,
      onEvent: (type, h) => {
        handlers.set(type, [...(handlers.get(type) ?? []), h as (p: unknown) => void]);
        return () => undefined;
      },
    },
    emit: (type, p) => {
      for (const h of handlers.get(type) ?? []) h(p);
    },
  };
}

function frame(fx: GatherEffects, w: GatherWorld, time: number): Pushed[] {
  const scene = new RenderScene();
  scene.beginFrame(time);
  const pushed = capture(scene);
  fx.draw(scene, atlas, tables, 0, time, 0, w.gathering, (k) => k);
  return pushed;
}

const HOTBAR_0 = { bereich: 'schnellleiste', index: 0 } as const;

/** The player on a meadow, the dug tile two tiles east of it. */
function fillWorld(): { w: GatherWorld; fx: GatherEffects; emit: ReturnType<typeof session>['emit']; tile: { x: number; y: number } } {
  const w = gatherWorld(field(12, 8));
  w.place(3, 4);
  const fx = new GatherEffects();
  const ev = session(w);
  fx.follow(ev.session);
  return { w, fx, emit: ev.emit, tile: centre(5, 4) };
}

describe('Zuschütten: Erdklumpen fallen in die gefüllte Kachel (M4-40)', () => {
  it('Erde: Klumpen in Erdfarbe über der Kachelmitte, die dort niederfallen; Staub steigt auf; keine Verbandsfasern', () => {
    const { w, fx, emit, tile } = fillWorld();
    emit('itemUsed', { item: 'erde', from: HOTBAR_0, use: 'zuschuetten', cured: [], layer: 0, x: tile.x, y: tile.y, tick: 9 });
    const first = frame(fx, w, 1);
    const clods = first.filter((p) => p.frame === PARTICLE_SPRITES.erde);
    expect(clods.length).toBeGreaterThanOrEqual(MATERIAL_PARTICLES.erde.count);
    // The clods are earth (the earth particle in its own colour), not the pale fibres of a bandage or blue water.
    expect(first.filter((p) => p.frame === PARTICLE_SPRITES.blatt)).toEqual([]);
    expect(clods.every((p) => p.tint === MATERIAL_PARTICLES.erde.tint)).toBe(true);
    // They start over the filled tile (not at the player three tiles west), dropped from the blade above the ground.
    for (const p of clods) {
      expect(Math.abs(p.x - tile.x), 'x').toBeLessThanOrEqual(TILE_PX / 2);
      expect(Math.abs(p.depth - tile.y), 'Tiefe').toBeLessThanOrEqual(TILE_PX / 2);
      expect(p.height).toBeGreaterThan(0);
    }
    // A puff of dust over the tile.
    const dust = first.filter((p) => p.frame === DUST_SPRITE);
    expect(dust).toHaveLength(1);
    expect(Math.abs((dust[0]?.x ?? 0) - tile.x)).toBeLessThanOrEqual(TILE_PX);
    // They fall: frame by frame some come to rest on the ground around the tile, and the effect is over within a second.
    let landed = 0;
    for (let t = 1.05; t <= 2.2; t += 0.05) {
      const now = frame(fx, w, t).filter((p) => p.frame === PARTICLE_SPRITES.erde);
      for (const p of now) expect(Math.abs(p.depth - tile.y), 'Tiefe').toBeLessThanOrEqual(2 * TILE_PX);
      landed = Math.max(landed, now.filter((p) => p.height === 0).length);
    }
    expect(landed).toBeGreaterThan(0);
    expect(fx.particles).toBe(0);
    // The same event draws the same clods (seeded by the event: frozen screenshots stay still).
    const again = fillWorld();
    again.emit('itemUsed', { item: 'erde', from: HOTBAR_0, use: 'zuschuetten', cured: [], layer: 0, x: tile.x, y: tile.y, tick: 9 });
    expect(frame(again.fx, again.w, 1)).toEqual(first);
  });

  it('das Material kommt vom Geschaufelten: Erde wirft Erde; ein Verband und ein Eimer behalten ihr eigenes Bild', () => {
    expect(itemMaterial('erde', 'holz')).toBe('erde');
    expect(itemMaterial('gibt_es_nicht', 'erde')).toBe('erde');
    const { w, fx, emit, tile } = fillWorld();
    const pos = w.pos();
    emit('itemUsed', { item: 'verband', from: HOTBAR_0, use: 'heilen', cured: ['blutung'], layer: 0, x: pos.x, y: pos.y, tick: 3 });
    const fibres = frame(fx, w, 1);
    expect(fibres.length).toBeGreaterThan(0);
    expect(fibres.every((p) => p.frame === PARTICLE_SPRITES.blatt && p.tint === USE_TINTS.verband)).toBe(true);
    emit('itemUsed', { item: 'holzeimer_wasser', from: HOTBAR_0, use: 'ausgiessen', cured: [], layer: 0, x: pos.x, y: pos.y, tick: 4 });
    const splash = frame(fx, w, 1.02).filter((p) => p.tint === USE_TINTS.wasser);
    expect(splash.length).toBeGreaterThan(0);
    expect(splash.every((p) => p.frame === PARTICLE_SPRITES.erde)).toBe(true);
    // Filling on another layer is not drawn on this one.
    emit('itemUsed', { item: 'erde', from: HOTBAR_0, use: 'zuschuetten', cured: [], layer: -1, x: tile.x, y: tile.y, tick: 5 });
    const below = frame(fx, w, 1.04);
    expect(below.filter((p) => p.frame === PARTICLE_SPRITES.erde && Math.abs(p.x - tile.x) <= TILE_PX / 2 && p.tint === 0)).toEqual([]);
    expect(below.filter((p) => p.frame === DUST_SPRITE)).toEqual([]);
  });
});
