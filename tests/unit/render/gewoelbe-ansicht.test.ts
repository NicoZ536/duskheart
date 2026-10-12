/**
 * The vault view on a vault test world (M7-11 … M7-14, strand C; docs/SPIEL.md §30 "C `src/render/game/vaults.ts` (Kisten,
 * Hebel, Schalen, Glocken, Türen, Fallen, verborgene Wände, Luftzug-Emitter)"): `VaultView.draw` shows every sampled part with
 * the clip of its state – doors shut and open, the real cracked wall breathing dust (an emitter), burning bowls with their flames
 * (an emitter each), a struck bell for a moment, the lever stele's order digits – and the traps (a dart thrower facing west
 * mirrored, a blade with its groove, a spent floor not at all); nothing off layer −1. A minimal atlas stands in for the generated
 * one (one frame per clip: the drawn frame names the clip). In steady state the draw – sampler and view – allocates nothing per
 * frame, measured with the sampling heap profiler like `feld-frame.test.ts` (windows after a warm-up, each re-warmed after its
 * forced collection as ADR-0203 requires, the median) on the generated atlas.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { BALANCE } from '../../../src/content/balance';
import type { PuzzleVariantDef } from '../../../src/content/dungeons/schema';
import { VaultSampler } from '../../../src/game/samples/gewoelbe';
import type { SimEventMap } from '../../../src/game/sim';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { SpriteDesc } from '../../../src/render/batch/spriteList';
import { createVaultFrame, PARTICLE_ID_BASE, VaultView, type VaultFrame, type VaultSession } from '../../../src/render/game/vaults';
import { RenderScene } from '../../../src/render/scene';
import { vaultRaster } from '../../../src/world/gen/vaults/raster';
import type { VaultPlan } from '../../../src/world/gen/vaults/types';
import { TILE_PX } from '../../../src/world/model/coords';
import { gewoelbeWelt, VAULT_SLOT, type GewoelbeWelt } from '../game/gewoelbe-testwelt';

/** Clips of each stand-in sprite (one frame each, in this order). */
const CLIPS: Readonly<Record<string, readonly string[]>> = {
  gw_tor_quer: ['schloss', 'schloss_offen', 'raetsel', 'raetsel_offen', 'verborgen', 'verborgen_offen'],
  gw_tor_laengs: ['schloss', 'schloss_offen', 'raetsel', 'raetsel_offen', 'verborgen', 'verborgen_offen'],
  gw_hebel: ['oben', 'unten'],
  gw_schale: ['kalt', 'brennt'],
  gw_glocke: ['still', 'geschlagen'],
  gw_risswand: ['ganz', 'luftzug', 'offen'],
  gw_kiste: ['kiste'],
  gw_platte: ['oben', 'gedrueckt'],
  gw_ruecksetzer: ['rune'],
  gw_hinweis: ['hebel', 'schalen', 'glocken', 'glocken_spielt'],
  gw_hinweis_zahl: ['1', '2', '3', '4', '5'],
  gw_sockel_schluessel: ['voll', 'leer'],
  gw_sockel_splitter: ['voll', 'leer'],
  gw_falle_speer: ['ruhe', 'warnung', 'stoss'],
  gw_falle_pfeilwerfer: ['n_ruhe', 'o_ruhe', 's_ruhe', 'n_warnung', 'o_warnung', 's_warnung'],
  gw_falle_rollstein: ['ruhe', 'warnung', 'rollt'],
  gw_falle_grube: ['ruhe', 'warnung', 'offen'],
  gw_falle_einsturz: ['ruhe', 'warnung', 'offen'],
  gw_falle_pendel: ['p0', 'p1', 'p2', 'p3', 'p4'],
  gw_falle_pendel_rille: ['quer', 'laengs'],
  gw_falle_pfeil: ['pfeil'],
  gw_falle_pfeil_senkrecht: ['pfeil'],
};

/** Which sprite and clip each stand-in frame is. */
const FRAME_NAME = new Map<object, string>();

function sprite(id: string, clips: readonly string[]): AtlasSprite {
  const frames = clips.map(() => ({ x: 0, y: 0, w: 1, h: 1, ax: 0, ay: 0 }));
  frames.forEach((f, i) => FRAME_NAME.set(f, `${id}:${clips[i]}`));
  const clipMap = Object.fromEntries(clips.map((c, i) => [c, { name: c, frames: [i], fps: 1, loop: false }]));
  if (id === 'gw_falle_pendel') clipMap['schwung'] = { name: 'schwung', frames: [0, 1, 2, 3, 4], fps: 1, loop: false };
  return { id, group: 'test', size: [1, 1], frames, clips: clipMap, sockets: {}, heightHint: { kind: 'flat' }, emissive: false, symmetric: true } as unknown as AtlasSprite;
}

const stand = {
  manifest: { width: 1, height: 1, sprites: Object.fromEntries(Object.entries(CLIPS).map(([id, c]) => [id, sprite(id, c)])), paletteRows: [], sourceHash: 'test' } as unknown as AtlasManifest,
  albedo: { kind: 'pixels', pixels: new Uint8Array(4) },
  normal: { kind: 'pixels', pixels: new Uint8Array(4) },
} as AtlasData;

type Handler = (payload: never) => void;

/** The session of the vault view over a test world: the sampler on its simulation, events handed in by the test. */
function vaultSession(w: GewoelbeWelt): { session: VaultSession; emit: <K extends keyof SimEventMap>(type: K, payload: SimEventMap[K]) => void } {
  const sampler = new VaultSampler();
  const handlers = new Map<string, Set<Handler>>();
  const session = {
    sampleVaultParts: (out, layer, left, top, right, bottom, ptx, pty) => sampler.fill(w.sim, layer, left, top, right, bottom, ptx, pty, out),
    vaultTrapDefs: () => sampler.trapDefs,
    onEvent: (type, handler) => {
      const set = handlers.get(type) ?? new Set<Handler>();
      handlers.set(type, set);
      set.add(handler as Handler);
      return () => set.delete(handler as Handler);
    },
  } as VaultSession;
  const emit = <K extends keyof SimEventMap>(type: K, payload: SimEventMap[K]): void => {
    for (const h of handlers.get(type) ?? []) (h as (p: SimEventMap[K]) => void)(payload);
  };
  return { session, emit };
}

/** A frame over the whole box of the vault on layer −1. */
function boxFrame(plan: VaultPlan, tick: number, time = 0): VaultFrame {
  const f = createVaultFrame();
  f.layer = -1;
  f.tileLeft = plan.box.x0;
  f.tileTop = plan.box.y0;
  f.tileRight = plan.box.x0 + plan.box.w - 1;
  f.tileBottom = plan.box.y0 + plan.box.h - 1;
  f.tick = tick;
  f.time = time;
  return f;
}

/** Draws one frame; returns the pushed sprites as `sprite:clip` at their tile, with their mirror flag. */
function draw(view: VaultView, session: VaultSession, f: VaultFrame): { name: string; tx: number; ty: number; mirror: boolean }[] {
  const scene = new RenderScene();
  scene.beginFrame(0);
  const pushed: { name: string; tx: number; ty: number; mirror: boolean }[] = [];
  const push = scene.sprites.push.bind(scene.sprites);
  scene.sprites.push = (d: SpriteDesc) => {
    pushed.push({ name: FRAME_NAME.get(d.frame as object) ?? '?', tx: Math.floor(d.x / TILE_PX), ty: Math.floor(d.y / TILE_PX), mirror: d.mirror });
    return push(d);
  };
  view.draw(scene, stand, session, f);
  return pushed;
}

function enter(w: GewoelbeWelt): void {
  w.goToTile(w.plan.entrance.tx, w.plan.entrance.ty + 1, 0);
  w.run(1, [{ type: 'vault.enter', vault: VAULT_SLOT }]);
}

const named = (list: readonly { name: string }[], prefix: string) => list.filter((s) => s.name.startsWith(prefix)).map((s) => s.name);

describe('the vault view (VaultView)', () => {
  it('draws each part with the clip of its state; the real cracked wall breathes, solved: doors open, bowls burn', () => {
    const w = gewoelbeWelt();
    enter(w);
    const { session } = vaultSession(w);
    const view = new VaultView();
    const p = w.plan;
    const before = draw(view, session, boxFrame(p, w.sim.tick));
    const nonTraps = before.filter((s) => !s.name.startsWith('gw_falle') && !s.name.startsWith('gw_hinweis_zahl'));
    expect(view.stats.parts).toBe(nonTraps.length);
    expect(view.stats.traps).toBe(p.traps.length);
    // Doors shut, each with its kind; the levers up. The steles of the levers (hebel_2: four) and of the bowls (feuerschalen_3:
    // five) show each part's step in the order, 1 … n.
    expect(named(before, 'gw_tor').sort()).toEqual(p.doors.map((d) => `gw_tor_${d.vertical ? 'laengs' : 'quer'}:${d.kind}`).sort());
    expect(named(before, 'gw_hebel:')).toEqual(Array(4).fill('gw_hebel:oben'));
    const digits = p.puzzles.flatMap((z) => {
      const v = w.vaults.variantOf(VAULT_SLOT, z.id) as PuzzleVariantDef;
      if ((v.typ !== 'hebel' && v.typ !== 'feuerschalen') || !z.parts.some((x) => x.role === 'hinweis')) return [];
      return v.folge.map((_, i) => `gw_hinweis_zahl:${i + 1}`);
    });
    expect(digits.length).toBe(9);
    expect(named(before, 'gw_hinweis_zahl').sort()).toEqual(digits.sort());
    // One real cracked wall (verborgene_wand_1): its draft is the only emitter while nothing burns.
    expect(named(before, 'gw_risswand').sort()).toEqual(['gw_risswand:ganz', 'gw_risswand:ganz', 'gw_risswand:luftzug']);
    expect(view.stats.emitters).toBe(1 + p.doors.filter((d) => d.kind === 'verborgen').length);
    // Everything solved: the puzzle doors stand open, the found wall is open, five bowls burn (five flames).
    w.run(1, [{ type: 'vault.solve', vault: VAULT_SLOT }]);
    const after = draw(view, session, boxFrame(p, w.sim.tick));
    expect(named(after, 'gw_tor').sort()).toEqual(p.doors.map((d) => `gw_tor_${d.vertical ? 'laengs' : 'quer'}:${d.kind === 'raetsel' ? 'raetsel_offen' : d.kind}`).sort());
    expect(named(after, 'gw_schale')).toEqual(Array(5).fill('gw_schale:brennt'));
    expect(named(after, 'gw_risswand').sort()).toEqual(['gw_risswand:ganz', 'gw_risswand:ganz', 'gw_risswand:offen']);
    expect(view.stats.emitters).toBe(5);
    // Off layer −1: nothing.
    const f0 = boxFrame(p, w.sim.tick);
    f0.layer = 0;
    expect(draw(view, session, f0)).toEqual([]);
    expect(view.stats.parts).toBe(0);
  });

  it('a struck bell rings for a moment (puzzleStep of the bells), then hangs still', () => {
    const w = gewoelbeWelt();
    enter(w);
    const { session, emit } = vaultSession(w);
    const view = new VaultView();
    view.follow(session);
    const bells = w.plan.puzzles.flatMap((z) => z.parts.filter((x) => x.role === 'glocke'));
    const bell = bells[2]!;
    const tick = w.sim.tick;
    emit('puzzleStep', { vault: VAULT_SLOT, puzzle: 3, typ: 'glocken', part: 2, richtig: true, ton: 0, tx: bell.tx, ty: bell.ty, tick } as SimEventMap['puzzleStep']);
    // Following the same session again does not subscribe twice.
    view.follow(session);
    const ringing = draw(view, session, boxFrame(w.plan, tick + 1)).filter((s) => s.name.startsWith('gw_glocke'));
    expect(ringing.filter((s) => s.name === 'gw_glocke:geschlagen')).toEqual([expect.objectContaining({ tx: bell.tx })]);
    expect(ringing.filter((s) => s.name === 'gw_glocke:still')).toHaveLength(bells.length - 1);
    const later = draw(view, session, boxFrame(w.plan, tick + Math.ceil(0.45 * BALANCE.time.tickHz) + 1));
    expect(named(later, 'gw_glocke:geschlagen')).toEqual([]);
  });

  it('traps: a dart thrower facing west is the east one mirrored, a blade hangs over its groove, a spent floor is gone', () => {
    let floor = { tx: 0, ty: 0 };
    const w = gewoelbeWelt({
      plan: (p) => {
        const r = vaultRaster(p);
        const room = p.rooms.find((x) => x.node === p.graph.start)!;
        const free: { tx: number; ty: number }[] = [];
        for (let ty = room.y0 + 2; ty < room.y0 + 14; ty++) {
          for (let tx = room.x0 + 2; tx < room.x0 + 14; tx++) {
            const i = (ty - r.y0) * r.w + (tx - r.x0);
            if (r.solid[i] === 0 && r.object[i] === null && i !== r.entrance) free.push({ tx, ty });
          }
        }
        floor = free[free.length - 3]!;
        const a = free[2]!;
        const b = free[Math.floor(free.length / 2)]!;
        return {
          ...p,
          traps: [
            { id: 0, type: 'pfeilwerfer', tx: a.tx, ty: a.ty, dir: 3, reach: 3 },
            { id: 1, type: 'pendelklinge', tx: b.tx, ty: b.ty, dir: 0, reach: 3 },
            { id: 2, type: 'einsturzboden', tx: floor.tx, ty: floor.ty, dir: 1, reach: 1 },
          ],
        };
      },
    });
    enter(w);
    const { session } = vaultSession(w);
    const view = new VaultView();
    const first = draw(view, session, boxFrame(w.plan, w.sim.tick));
    expect(view.stats.traps).toBe(3);
    expect(first.filter((s) => s.name.startsWith('gw_falle_pfeilwerfer'))).toEqual([expect.objectContaining({ name: 'gw_falle_pfeilwerfer:o_ruhe', mirror: true })]);
    // Across a north–south lane the blade swings sideways: the groove lies across (`quer`).
    expect(named(first, 'gw_falle_pendel_rille')).toEqual(['gw_falle_pendel_rille:quer']);
    expect(named(first, 'gw_falle_pendel:')).toHaveLength(1);
    expect(named(first, 'gw_falle_einsturz')).toEqual(['gw_falle_einsturz:ruhe']);
    // The floor falls in under the player: spent, no longer drawn.
    w.goToTile(floor.tx, floor.ty);
    w.run(Math.ceil(2 * BALANCE.time.tickHz) + 4);
    const after = draw(view, session, boxFrame(w.plan, w.sim.tick));
    expect(named(after, 'gw_falle_einsturz')).toEqual([]);
    expect(view.stats.traps).toBe(2);
  });
});

/** Warm-up frames, then `WINDOWS` windows of `FRAMES` frames (the median counts); see `feld-frame.test.ts`. */
describe('the stable numbers of the vault particle sources (M7-143)', () => {
  it('lie below 2^30 (small integers, nothing boxed per call), above the fire hashes and apart from the object sources; one per tile, the same every frame', () => {
    const w = gewoelbeWelt();
    enter(w);
    const bowls = w.plan.puzzles.find((z) => w.vaults.variantOf(VAULT_SLOT, z.id)?.typ === 'feuerschalen')!;
    w.run(1, [{ type: 'vault.solve', vault: VAULT_SLOT, puzzle: bowls.id }]);
    const { session } = vaultSession(w);
    const view = new VaultView();
    const idsOf = (time: number): number[] => {
      const scene = new RenderScene();
      scene.beginFrame(time);
      view.follow(session);
      view.draw(scene, stand, session, boxFrame(w.plan, w.sim.tick, time));
      const e = scene.particles.emitters;
      return Array.from(e.id.subarray(0, e.count));
    };
    const first = idsOf(0);
    expect(first.length).toBeGreaterThanOrEqual(5);
    expect(new Set(first).size).toBe(first.length);
    for (const id of first) {
      expect(Number.isInteger(id) && id >= 2 ** 28 && id < 2 ** 30, `${id}`).toBe(true);
      expect(id >= 0x3a000000 && id <= 0x3a00ffff, `${id} in the object sources' range`).toBe(false);
      expect(id - PARTICLE_ID_BASE).toBeGreaterThanOrEqual(0);
      expect(id - PARTICLE_ID_BASE).toBeLessThan(2 ** 16);
    }
    expect(idsOf(1 / 60)).toEqual(first);
    expect(PARTICLE_ID_BASE).toBeLessThan(2 ** 30);
  });
});

const WARMUP = 3000;
const FRAMES = 500;
const WINDOWS = 5;
const REWARM_FRAMES = 3 * FRAMES;
const COMPILER_PAUSE_MS = 200;
const INSTALL_FRAMES = 100;
const SAMPLING_INTERVAL = 16;
/** Limit [B per frame]: one number or record formed every frame (16 B and more) exceeds it. */
const MAX_BYTES_PER_FRAME = 2;

let inspector: Session;
beforeAll(async () => {
  inspector = new Session();
  inspector.connect();
  await inspector.post('HeapProfiler.enable');
});
afterAll(() => inspector.disconnect());

describe('the vault view in the frame path without allocation (§30, ADR-0142)', { timeout: 60_000 }, () => {
  it('sampler and view: doors, levers, burning bowls, a breathing wall, digits and traps cost nothing per frame', async () => {
    const mod = generatedAtlasModule();
    if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
    const atlas = { manifest: manifestFromGenerated(mod), image: null } as unknown as AtlasData;
    const w = gewoelbeWelt();
    enter(w);
    // Bowls burning (the flames' emitters), the levers half pulled; a struck bell in the ring.
    const bowls = w.plan.puzzles.find((z) => w.vaults.variantOf(VAULT_SLOT, z.id)?.typ === 'feuerschalen')!;
    w.run(1, [{ type: 'vault.solve', vault: VAULT_SLOT, puzzle: bowls.id }]);
    const { session, emit } = vaultSession(w);
    const view = new VaultView();
    view.follow(session);
    const bell = w.plan.puzzles.flatMap((z) => z.parts.filter((x) => x.role === 'glocke'))[0]!;
    emit('puzzleStep', { vault: VAULT_SLOT, puzzle: 3, typ: 'glocken', part: 0, richtig: true, ton: 0, tx: bell.tx, ty: bell.ty, tick: w.sim.tick } as SimEventMap['puzzleStep']);
    const scene = new RenderScene();
    const f = boxFrame(w.plan, w.sim.tick);
    f.playerTx = Math.floor(w.pos().x / TILE_PX);
    f.playerTy = Math.floor(w.pos().y / TILE_PX);
    const tick0 = w.sim.tick;
    const frames = (n: number, from: number): void => {
      for (let i = 0; i < n; i++) {
        scene.beginFrame(0);
        f.time = (from + i) / 60;
        // The view's own clock runs on (the blade's swing is the sampler's, at the standing simulation's tick).
        f.tick = tick0 + ((from + i) % 120);
        view.follow(session);
        view.draw(scene, atlas, session, f);
      }
    };
    frames(WARMUP, 0);
    const perFrame: number[] = [];
    const tops: string[] = [];
    let t = WARMUP;
    for (let k = 1; k <= WINDOWS; k++) {
      await inspector.post('HeapProfiler.collectGarbage');
      frames(REWARM_FRAMES, t);
      t += REWARM_FRAMES;
      await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
      frames(INSTALL_FRAMES, t);
      t += INSTALL_FRAMES;
      await inspector.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      frames(FRAMES, t);
      t += FRAMES;
      const profile = heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
      const alloc = pathAllocation(profile, (fr) => fr.functionName === 'frames' && /gewoelbe-ansicht\.test/.test(fr.url));
      perFrame.push(alloc.inPath / FRAMES);
      tops.push(JSON.stringify(alloc.top));
    }
    const median = [...perFrame].sort((a, b) => a - b)[Math.floor(WINDOWS / 2)] as number;
    expect(view.stats.parts).toBeGreaterThanOrEqual(30);
    expect(view.stats.emitters).toBeGreaterThanOrEqual(5);
    expect(median, `${perFrame.map((b) => b.toFixed(2)).join(' / ')}: ${tops.join(' | ')}`).toBeLessThan(MAX_BYTES_PER_FRAME);
  });
});
