/**
 * The presentation of gathering (M3-10 … M3-15; MASTERPROMPT §4.6, §11.4, §14 "Feedback"): pointer to
 * world, the art the view relies on (ring, arrow, drop shadow, particles, dust, stumps, fallen trunks,
 * icons – all by convention), the object layer's stump and outline, the drop sprites (flight arc, bob,
 * outline) and the effects of the harvest events (particles per material, sparks and "Zu hart", the
 * falling tree, messages).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { AtlasData, AtlasManifest } from '../../../src/render/assets/atlas';
import { RenderScene } from '../../../src/render/scene';
import type { SpriteDesc } from '../../../src/render/batch/spriteList';
import { WorldObjectLayer, objectAnchor, type ObjectView } from '../../../src/render/world/objects';
import { ChunkSignatures } from '../../../src/render/world/signature';
import { WorldRenderTables } from '../../../src/render/world/tables';
import { cursorToInternal, internalToWorld, ARROW_SPRITE, RING_SPRITE } from '../../../src/render/game/objects';
import { DROP_ARC_PEAK_PX, DROP_SHADOW_SPRITE, DropSprites, dropLift, iconSprite } from '../../../src/render/game/drops';
import { DUST_SPRITE, GatherEffects, MATERIAL_PARTICLES, PARTICLE_SPRITES, fallEase, trunkSprite } from '../../../src/render/game/effects';
import { HARVEST_MATERIALS } from '../../../src/game/gathering/rules';
import { STAGE_STUMP } from '../../../src/game/gathering/objectState';
import { newStack } from '../../../src/game/items/stack';
import type { SimEventMap } from '../../../src/game/sim';
import { ChunkData, NO_REGROW_TICK } from '../../../src/world/model/chunk';
import { packChunkId, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { centre, field, gatherCatalog, gatherWorld } from './interaktion-testwelt';

const ids = contentWorldIdTables();
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

/** Captures the fields of every sprite pushed into `scene` (the description object is reused per push). */
function capture(scene: RenderScene): { frame: string; x: number; y: number; outline: boolean; rotation: number; fade: number; mirror: boolean; depth: number }[] {
  const out: { frame: string; x: number; y: number; outline: boolean; rotation: number; fade: number; mirror: boolean; depth: number }[] = [];
  const push = scene.sprites.push.bind(scene.sprites);
  scene.sprites.push = (d: SpriteDesc): number => {
    const f = d.frame;
    const owner = f === null ? '' : (Object.values(manifest.sprites).find((s) => s.frames.includes(f))?.id ?? '?');
    out.push({ frame: owner, x: d.x, y: d.y, outline: d.outline, rotation: d.rotation, fade: d.fade, mirror: d.mirror, depth: d.depth });
    return push(d);
  };
  return out;
}

describe('Zeiger und Welt', () => {
  it('maps CSS px through the letterboxed viewport into internal px and world px', () => {
    const vp = { internalWidth: 480, internalHeight: 270, integerScale: 2, outX: 100, outY: 20, outWidth: 960, outHeight: 540 };
    const p = { x: 0, y: 0 };
    // Device px = CSS px × 2 (a 2× display): the pointer at CSS (290, 145) lies at device (580, 290).
    expect(cursorToInternal(290, 145, 2, vp, p)).toEqual({ x: 240, y: 135 });
    expect(internalToWorld(240, 135, 1000, 2000, 480, 270, p)).toEqual({ x: 1000, y: 2000 });
    expect(internalToWorld(0, 0, 1000, 2000, 480, 270, p)).toEqual({ x: 760, y: 1865 });
  });
});

describe('Kunst nach Konvention', () => {
  it('ring (9 steps), arrow, drop shadow, particles and dust exist with their clips', () => {
    expect(manifest.sprites[RING_SPRITE]?.frames.length).toBe(9);
    expect(manifest.sprites[ARROW_SPRITE]?.clips.wippen).toBeDefined();
    expect(manifest.sprites[DROP_SHADOW_SPRITE]?.clips.wippen).toBeDefined();
    for (const id of Object.values(PARTICLE_SPRITES)) expect(manifest.sprites[id], id).toBeDefined();
    expect(manifest.sprites[DUST_SPRITE]?.clips.aufwirbeln).toBeDefined();
    for (const m of HARVEST_MATERIALS) expect(MATERIAL_PARTICLES[m].count, m).toBeGreaterThan(0);
  });

  it('every tree has its stump and its three fallen trunks; every item its icon', () => {
    for (const o of CONTENT.collection('worldObjects').values().filter((w) => w.kind === 'baum')) {
      expect(tables.objects[ids.objects.runtimeId(o.id)]?.stump, o.id).not.toBeNull();
      for (const dir of ['rechts', 'links', 'nord', 'sued'] as const) {
        const t = trunkSprite(o.id, dir);
        const s = manifest.sprites[t.id];
        expect(s, t.id).toBeDefined();
        expect(s?.clips.liegen).toBeDefined();
        expect(s?.clips.zerfallen).toBeDefined();
      }
    }
    for (const item of CONTENT.collection('items').values()) expect(manifest.sprites[iconSprite(item.id)], item.id).toBeDefined();
    expect(trunkSprite('baum_eiche', 'links')).toEqual({ id: 'baum_stamm_eiche', mirror: true });
    expect(trunkSprite('baum_eiche', 'nord')).toEqual({ id: 'baum_stamm_eiche_nord', mirror: false });
  });
});

describe('Objektebene: Stumpf und Umriss', () => {
  function objectsView(chunk: ChunkData, sigs: ChunkSignatures): ObjectView {
    return { layer: 0, chunks: { get: (l: Layer, cx: number, cy: number) => (l === 0 && cx === 0 && cy === 0 ? chunk : undefined) }, signatures: sigs, left: 0, top: 0, right: 512, bottom: 600, fadeX: 0, fadeY: 0, fadeRadius: 0 };
  }

  it('a felled tree shows its stump at the same anchor; the highlighted object carries the outline', () => {
    const chunk = new ChunkData(0, 0, 0);
    const oak = 10 * 32 + 10;
    const rock = 12 * 32 + 4;
    chunk.setObject(oak, ids.objects.runtimeId('baum_eiche'));
    chunk.setObject(rock, ids.objects.runtimeId('fels_klein_gruenhain'));
    const layer = new WorldObjectLayer(tables);
    const sigs = new ChunkSignatures();
    sigs.beginFrame();
    let scene = new RenderScene();
    scene.beginFrame(0);
    layer.setHighlight(0, packChunkId(0, 0, 0), rock);
    let pushed = capture(scene);
    layer.emit(scene, objectsView(chunk, sigs));
    expect(pushed.find((p) => p.frame === 'baum_eiche')?.outline).toBe(false);
    expect(pushed.find((p) => p.frame === 'fels_klein_gruenhain')?.outline).toBe(true);
    const anchor = objectAnchor(tables.objects[ids.objects.runtimeId('baum_eiche')] as NonNullable<(typeof tables.objects)[number]>, 10, 10, { x: 0, y: 0 });
    expect(pushed.find((p) => p.frame === 'baum_eiche')).toMatchObject({ x: anchor.x, y: anchor.y });
    // Felled: the stump stands where the tree stood.
    chunk.setObjectState(oak, 2, STAGE_STUMP, NO_REGROW_TICK);
    sigs.beginFrame();
    scene = new RenderScene();
    scene.beginFrame(0);
    layer.setHighlight(0, -1, -1);
    pushed = capture(scene);
    layer.emit(scene, objectsView(chunk, sigs));
    expect(pushed.map((p) => p.frame).sort()).toEqual(['baum_eiche_stumpf', 'fels_klein_gruenhain']);
    expect(pushed.find((p) => p.frame === 'baum_eiche_stumpf')).toMatchObject({ x: anchor.x, y: anchor.y, outline: false });
  });
});

describe('Drops', () => {
  it('icon over the shadow; lifted on the arc in flight; bobbing on the ground; outlined in focus', () => {
    expect(dropLift(true, 0.5, false)).toBe(2 + DROP_ARC_PEAK_PX);
    expect(dropLift(false, 0, false)).toBeLessThan(dropLift(false, 0, true));
    const w = gatherWorld(field(10, 10));
    const catalog = gatherCatalog();
    const c = centre(5, 5);
    const e = w.drops.spawn(w.sim, newStack(catalog.get('holz'), 2), 0, c.x, c.y);
    w.run(10);
    const sprites = new DropSprites();
    let scene = new RenderScene();
    scene.beginFrame(0);
    let pushed = capture(scene);
    sprites.draw(scene, atlas, w.drops, 0, 0, e, -1);
    expect(pushed.map((p) => p.frame)).toEqual([DROP_SHADOW_SPRITE, 'icon_holz']);
    const inFlight = pushed[1];
    const d = w.drops.get(e);
    expect(inFlight?.outline).toBe(true);
    expect(Math.round(d?.y ?? 0) - (inFlight?.y ?? 0)).toBeGreaterThan(2);
    expect(inFlight?.depth).toBe(Math.round(d?.y ?? 0));
    w.run(30);
    scene = new RenderScene();
    scene.beginFrame(0);
    pushed = capture(scene);
    sprites.draw(scene, atlas, w.drops, 0, 0, -1, -1);
    expect(Math.round(w.drops.get(e)?.y ?? 0) - (pushed[1]?.y ?? 0)).toBeLessThanOrEqual(3);
    expect(pushed[1]?.outline).toBe(false);
    // Another layer shows nothing.
    scene = new RenderScene();
    scene.beginFrame(0);
    sprites.draw(scene, atlas, w.drops, -1, 0, -1, -1);
    expect(sprites.drawn).toBe(0);
  });
});

describe('Effekte', () => {
  /** A session stand-in that delivers the events the test emits. */
  function events(): { session: { onEvent: <K extends keyof SimEventMap>(type: K, h: (p: SimEventMap[K]) => void) => () => void }; emit: <K extends keyof SimEventMap>(type: K, p: SimEventMap[K]) => void } {
    const handlers = new Map<string, ((p: unknown) => void)[]>();
    return {
      session: {
        onEvent: (type, h) => {
          const list = handlers.get(type) ?? [];
          list.push(h as (p: unknown) => void);
          handlers.set(type, list);
          return () => undefined;
        },
      },
      emit: (type, p) => {
        for (const h of handlers.get(type) ?? []) h(p);
      },
    };
  }

  const hit = (material: SimEventMap['harvestHit']['material'], tooHard = false): SimEventMap['harvestHit'] => ({ layer: 0, tx: 5, ty: 5, x: 88, y: 88, target: 'baum_eiche', action: 'faellen', material, hits: 1, hitsNeeded: 5, tooHard, xp: null, tick: 7 });

  it('a hit throws pieces of its material that fall and fade; a too weak hit strikes sparks and says "Zu hart"', () => {
    const w = gatherWorld(field(8, 8));
    const fx = new GatherEffects();
    const ev = events();
    fx.follow(ev.session);
    ev.emit('harvestHit', hit('holz'));
    const scene = new RenderScene();
    scene.beginFrame(0);
    const pushed = capture(scene);
    fx.draw(scene, atlas, tables, 0, 1, 0, w.gathering, (key) => (key === 'ui.interaction.tooHardShort' ? 'Zu hart' : key));
    expect(fx.particles).toBe(MATERIAL_PARTICLES.holz.count);
    expect(new Set(pushed.map((p) => p.frame))).toEqual(new Set([PARTICLE_SPRITES.splitter]));
    // They live less than a second.
    for (let t = 1.1; t < 2.2; t += 0.1) fx.draw(new RenderScene(), atlas, tables, 0, t, 0, w.gathering, null);
    expect(fx.particles).toBe(0);
    ev.emit('harvestHit', hit('stein', true));
    const s2 = new RenderScene();
    s2.beginFrame(0);
    const sparks = capture(s2);
    fx.draw(s2, atlas, tables, 0, 2.3, 0, w.gathering, (key) => (key === 'ui.interaction.tooHardShort' ? 'Zu hart' : key));
    expect(new Set(sparks.map((p) => p.frame))).toEqual(new Set([PARTICLE_SPRITES.funken]));
    expect(s2.worldUi.count).toBe(1);
    expect(s2.worldUi.entry(0)).toMatchObject({ kind: 'damage', text: 'Zu hart' });
  });

  it('the felled tree tips away over the fall time, then lies as its trunk, crumbles and is gone; the landing raises dust', () => {
    const w = gatherWorld(field(8, 8));
    const fx = new GatherEffects();
    const ev = events();
    fx.follow(ev.session);
    ev.emit('treeFelled', { layer: 0, tx: 5, ty: 5, object: 'baum_eiche', direction: 'rechts', landsAtTick: 60, tick: 0 });
    const at = (time: number): ReturnType<typeof capture> => {
      const scene = new RenderScene();
      scene.beginFrame(time);
      const pushed = capture(scene);
      fx.draw(scene, atlas, tables, 0, time, 1, w.gathering, null);
      return pushed;
    };
    expect(at(10)[0]).toMatchObject({ frame: 'baum_eiche', rotation: 0 });
    const mid = at(10.5)[0];
    expect(mid?.frame).toBe('baum_eiche');
    expect(mid?.rotation).toBeGreaterThan(0);
    expect(mid?.rotation).toBeLessThan(Math.PI / 2);
    ev.emit('treeLanded', { layer: 0, tx: 5, ty: 5, object: 'baum_eiche', direction: 'rechts', tick: 60 });
    const lying = at(11.05).map((p) => p.frame);
    expect(lying).toContain('baum_stamm_eiche');
    expect(lying).toContain(DUST_SPRITE);
    expect(lying.filter((f) => f === PARTICLE_SPRITES.blatt).length).toBeGreaterThan(0);
    expect(fx.fallingTrees).toBe(1);
    at(13);
    expect(fx.fallingTrees).toBe(0);
    expect(fallEase(0)).toBe(0);
    expect(fallEase(0.5)).toBeLessThan(0.5);
    expect(fallEase(1)).toBe(1);
  });

  it('a dig spot and a drop the bags cannot take show their message', () => {
    const w = gatherWorld(field(8, 8));
    const fx = new GatherEffects();
    const ev = events();
    fx.follow(ev.session);
    fx.setDropLookup(() => ({ x: 40, y: 40, layer: 0 }));
    ev.emit('digSpotFound', { layer: 0, tx: 3, ty: 3, tick: 1 });
    ev.emit('dropBlocked', { entity: 3, item: 'holz', count: 2, tick: 1 });
    const scene = new RenderScene();
    scene.beginFrame(0);
    fx.draw(scene, atlas, tables, 0, 0.2, 0, w.gathering, (key) => key);
    expect([scene.worldUi.entry(0)?.text, scene.worldUi.entry(1)?.text]).toEqual(['ui.interaction.digSpot', 'ui.interaction.bagsFullShort']);
  });
});
