/**
 * Dampf am Geysir als Partikelquelle (M7-123; MASTERPROMPT §6.2 „Emitter als Daten“; src/content/particles/orte.ts,
 * src/render/world/objectEmitters.ts): Weltobjekte haben keine Clips – Geysir und Dampfspalt sind an Quellen gebunden (Daten:
 * Objekt, Emitter, Punkt über dem Anker), und die Darstellung setzt für jedes solche Objekt im Bild eine Quelle: am Anker des
 * Objekts plus `dx`, `hoehe` darüber – die Höhenstufe hebt sie nicht (das Bild des Objekts steht auch auf einem Plateau an
 * seinem Anker; die Höhe eines Partikels ist ein Versatz auf dem Bildschirm) –, mit stabiler Nummer aus der Kachel; ein Objekt
 * weit außerhalb des Bildes nicht; nach einer Änderung des Chunks neu gelesen; im eingeschwungenen Frame ohne Allokation – auch
 * während die Zeit läuft und Geysire ausbrechen (M7-141: der Rhythmus selbst steht in `geysir-rhythmus.test.ts`).
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { OBJECT_EMITTERS, PARTICLE_EMITTERS, PARTICLE_KINDS, ParticleDataError, defineObjectEmitters } from '../../../src/content/particles/index';
import { WORLD_OBJECTS } from '../../../src/content/worldObjects';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { particleEmitter } from '../../../src/render/particles/tables';
import { RenderScene } from '../../../src/render/scene';
import { createRhythmRegister, ObjectEmitters, RHYTHM_AT, RHYTHM_PERIOD, rhythmPhaseIn } from '../../../src/render/world/objectEmitters';
import { objectAnchor, type ObjectView } from '../../../src/render/world/objects';
import { ChunkSignatures } from '../../../src/render/world/signature';
import { WorldRenderTables } from '../../../src/render/world/tables';
import { ChunkData } from '../../../src/world/model/chunk';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

const CHUNK_TILES = 32;
/** Chunk columns of the test's chunk key. */
const KEY_ROW = 64;
const TILE = 16;
const TABLES = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return new WorldRenderTables(manifestFromGenerated(mod));
})();
const IDS = contentWorldIdTables().objects;

/** A surface chunk (cx, cy) with `objects` – [local tx, local ty, object id, level]. */
function chunk(cx: number, cy: number, objects: readonly (readonly [number, number, string, number])[]): ChunkData {
  const c = new ChunkData(0, cx, cy);
  for (const [x, y, id, level] of objects) {
    c.object[y * CHUNK_TILES + x] = IDS.runtimeId(id);
    c.height[y * CHUNK_TILES + x] = level;
  }
  return c;
}

/** The view of the chunks `list` around (0, 0) … (640, 360) px. */
function viewOf(list: readonly ChunkData[]): ObjectView & { signatures: ChunkSignatures } {
  // A numeric key: the harness forms no string per lookup.
  const byKey = new Map(list.map((c) => [c.cy * KEY_ROW + c.cx, c]));
  return {
    layer: 0,
    chunks: { get: (_l, cx, cy) => byKey.get(cy * KEY_ROW + cx) },
    signatures: new ChunkSignatures(),
    left: 0,
    top: 0,
    right: 640,
    bottom: 360,
    fadeX: 0,
    fadeY: 0,
    fadeRadius: 0,
  };
}

/**
 * A presentation time [s] at which the geysir on tile (tx, ty) rests (second 1 of its cycle; M7-141): the frame shows its
 * column alone, without the eruption's sources.
 */
function restAt(tx: number, ty: number): number {
  const r = OBJECT_EMITTERS.find((b) => b.objekt === 'ort_geysir')?.rhythmus;
  if (r === undefined) throw new Error('Der Geysir hat keinen Rhythmus');
  const reg = createRhythmRegister();
  rhythmPhaseIn(tx, ty, new Float64Array([r.periode.min, r.periode.max - r.periode.min]), 0, reg);
  const period = reg[RHYTHM_PERIOD] as number;
  return (((1 - (reg[RHYTHM_AT] as number)) % period) + period) % period;
}

/** The sources a frame pushed: [preset, x, y, z, id]. */
function sources(scene: RenderScene): number[][] {
  const e = scene.particles.emitters;
  const out: number[][] = [];
  for (let k = 0; k < e.count; k++) out.push([e.preset[k] as number, e.x[k] as number, e.y[k] as number, e.z[k] as number, e.id[k] as number]);
  return out;
}

describe('Dampf der Orte als Daten (M7-123)', () => {
  it('Geysir und Dampfspalt sind an ihre Quellen gebunden; Objekte, Emitter und Arten gibt es, der Dampf ist weiß wie im Bild und leuchtet nicht', () => {
    expect(OBJECT_EMITTERS.map((b) => [b.objekt, b.emitter])).toEqual([
      ['ort_geysir', 'geysir_dampf'],
      ['ort_dampfspalt', 'dampfspalt_dampf'],
    ]);
    for (const b of OBJECT_EMITTERS) {
      expect(WORLD_OBJECTS.some((o) => o.id === b.objekt), b.objekt).toBe(true);
      const e = PARTICLE_EMITTERS.find((x) => x.id === b.emitter);
      expect(e, b.emitter).toBeDefined();
      const kind = PARTICLE_KINDS.find((k) => k.id === e?.art);
      expect(kind?.farben[0]).toBe('eis.4');
      expect(kind?.emissiv).toBe(0);
      // Steam rises by itself.
      expect(kind?.schwerkraft).toBeLessThan(0);
    }
    expect(() => defineObjectEmitters([{ objekt: 'ort_geysir', emitter: 'gibtsnicht', dx: 0, hoehe: 4 }], PARTICLE_EMITTERS)).toThrow(ParticleDataError);
    expect(() => defineObjectEmitters([{ objekt: 'ort_geysir', emitter: 'geysir_dampf', dx: 0, hoehe: 4 }, { objekt: 'ort_geysir', emitter: 'geysir_dampf', dx: 1, hoehe: 4 }], PARTICLE_EMITTERS)).toThrow(/twice/);
    expect(() => defineObjectEmitters([{ objekt: 'ort_geysir', emitter: 'geysir_dampf', dx: 0.5, hoehe: 4 }], PARTICLE_EMITTERS)).toThrow(ParticleDataError);
  });
});

describe('Quelle je Objekt im Bild (src/render/world/objectEmitters.ts)', () => {
  it('am Anker plus dx, hoehe darüber (auch auf einer Höhenstufe), stabile Nummer aus der Kachel; fern vom Bild keine; nach einer Änderung neu', () => {
    // A geyser on level 1 and a vent in view (chunk 0,0), a geyser far east of the view (chunk 3,0: 1536 px), a vent just east
    // of it (below).
    const near = chunk(0, 0, [
      [5, 6, 'ort_geysir', 1],
      [10, 6, 'ort_dampfspalt', 0],
      [12, 9, 'ort_sinterbecken', 0],
    ]);
    const far = chunk(3, 0, [[4, 4, 'ort_geysir', 0]]);
    // A vent in a chunk the view reaches into, but east of the view and its margin (840 px > 640 + 48): no source either.
    const beside = chunk(1, 0, [[20, 5, 'ort_dampfspalt', 0]]);
    const view = viewOf([near, far, beside]);
    const sourcesOf = new ObjectEmitters(TABLES);
    const scene = new RenderScene();
    // While the geysir rests (M7-141): its column alone.
    scene.beginFrame(restAt(5, 6));
    view.signatures.beginFrame();
    expect(sourcesOf.emit(scene, view)).toBe(2);
    const geysir = TABLES.objects[IDS.runtimeId('ort_geysir')];
    const spalt = TABLES.objects[IDS.runtimeId('ort_dampfspalt')];
    if (geysir === undefined || geysir === null || spalt === undefined || spalt === null) throw new Error('Objekte fehlen in den Tabellen');
    const a = objectAnchor(geysir, 5, 6, { x: 0, y: 0 });
    const b = objectAnchor(spalt, 10, 6, { x: 0, y: 0 });
    expect(sources(scene)).toEqual([
      // Level 1 does not lift the source: the sprite stands at its anchor on the plateau too, a particle's height is drawn as a screen offset.
      [particleEmitter('geysir_dampf'), a.x - 1, a.y, 36, 0x3a000000 + ((6 << 8) | 5)],
      [particleEmitter('dampfspalt_dampf'), b.x, b.y, 6, 0x3a000000 + ((6 << 8) | 10)],
    ]);
    // The source stands where the geyser's sprite stands: the middle of its 2-tile footprint, on the tile's last row.
    expect([a.x, a.y]).toEqual([5 * TILE + TILE, 6 * TILE + TILE - 1]);
    // The geyser gone (a changed chunk): its source too.
    near.object[6 * CHUNK_TILES + 5] = 0;
    scene.beginFrame(restAt(5, 6) + 1);
    view.signatures.beginFrame();
    expect(sourcesOf.emit(scene, view)).toBe(1);
    expect(sources(scene)[0]?.[0]).toBe(particleEmitter('dampfspalt_dampf'));
  });
});

const inspector = new Session();
beforeAll(async () => {
  inspector.connect();
  await inspector.post('HeapProfiler.enable');
});
afterAll(async () => {
  await inspector.post('HeapProfiler.disable');
  inspector.disconnect();
});

/** Frames per measured window, windows, sampling interval [B]; most bytes per frame (one number formed every frame is 16). */
const FRAMES = 2000;
/** Presentation time of a frame [s]: 60 frames a second – a window of 2000 frames spans more than a geysir's cycle (M7-141). */
const FRAME_S = 1 / 60;
const WINDOWS = 5;
const SAMPLING_INTERVAL = 16;
const MAX_BYTES_PER_FRAME = 2;

describe('ohne Allokation im Frame (§30, ADR-0142, ADR-0167)', { timeout: 60_000 }, () => {
  it('ein Frame mit Geysiren und Dampfspalten im Bild bildet keine Zahl und kein Objekt', async () => {
    const list: ChunkData[] = [];
    for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) list.push(chunk(cx, cy, [[3, 3, 'ort_geysir', 0], [20, 12, 'ort_dampfspalt', 1], [9, 25, 'ort_geysir', 2]]));
    const view = viewOf(list);
    // The view over all four chunks (a wide view, 1024 × 1024 px).
    view.right = 2 * CHUNK_TILES * TILE;
    view.bottom = 2 * CHUNK_TILES * TILE;
    const sourcesOf = new ObjectEmitters(TABLES);
    const scene = new RenderScene();
    // The time runs (M7-141): the geysirs rest, swell, erupt and settle within every window – each phase on the measured path.
    // The frame's time is formed from a whole frame counter in a register (the harness boxes no number of its own).
    const times = new Float64Array(1);
    let frame = 0;
    let most = 0;
    let least = Number.MAX_SAFE_INTEGER;
    const frames = (n: number): void => {
      for (let i = 0; i < n; i++) {
        times[0] = frame++ * FRAME_S;
        scene.time = times[0];
        scene.particles.emitters.clear();
        view.signatures.beginFrame();
        sourcesOf.emit(scene, view);
        const count = scene.particles.emitters.count;
        if (count > most) most = count;
        if (count < least) least = count;
      }
    };
    frames(FRAMES);
    // Twelve columns at rest (8 geysirs, 4 vents); an erupting geysir adds its jet and its billow – in 33 s some of the eight did.
    expect(least).toBeGreaterThanOrEqual(12);
    expect(most).toBeGreaterThan(12);
    expect(most).toBeLessThanOrEqual(12 + 2 * 8);
    const perFrame: number[] = [];
    const tops: string[] = [];
    for (let w = 0; w < WINDOWS; w++) {
      await inspector.post('HeapProfiler.collectGarbage');
      await inspector.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      frames(FRAMES);
      const profile = heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
      const alloc = pathAllocation(profile, (f) => f.functionName === 'frames' && /objekt-dampf\.test/.test(f.url));
      perFrame.push(alloc.inPath / FRAMES);
      tops.push(JSON.stringify(alloc.top));
    }
    const median = [...perFrame].sort((x, y) => x - y)[Math.floor(WINDOWS / 2)] as number;
    expect(median, `${perFrame.map((b) => b.toFixed(2)).join(' / ')}: ${tops.join(' | ')}`).toBeLessThan(MAX_BYTES_PER_FRAME);
  });
});
