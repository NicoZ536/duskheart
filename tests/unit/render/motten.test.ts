/**
 * Motten an Lichtquellen (M7-149; MASTERPROMPT §6.2 „Emitter als Daten“, „Nacht: … Glühwürmchen“; src/content/particles/
 * nachtleben.ts, src/render/world/particlesScene.ts): ein Nachtleben der Lichter als Daten – eine Partikelart `motte`, eine
 * Quelle `motten_licht` und ein Lichtgast, der sagt, an welchen Lichtarten, unter welchem Tageslicht und in welchen
 * Jahreszeiten sie fliegen. Die Darstellung setzt die Quelle nur nachts, nur an gesetzten Lichtern dieser Arten im Bild (nicht
 * an der getragenen Fackel, nicht unter der Erde, nicht im Winter), ein Lagerfeuer nach seiner Helligkeit; im Frame ohne
 * Allokation.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { BALANCE } from '../../../src/content/balance';
import { LIGHT_KINDS } from '../../../src/content/lights';
import { LIGHT_VISITORS, PARTICLE_EMITTERS, PARTICLE_KINDS, ParticleDataError, defineLightVisitors } from '../../../src/content/particles/index';
import { SimWorld } from '../../../src/game/world';
import { particleEmitter } from '../../../src/render/particles/tables';
import { RenderScene } from '../../../src/render/scene';
import { ParticleSceneFiller } from '../../../src/render/world/particlesScene';
import { lightWorld, type LightWorld } from '../game/licht-testwelt';
import { OFFSET } from '../game/spieler-testwelt';

const T = 16;
const MOTH = particleEmitter('motten_licht');

/** Sources of the moths in `scene`: position, height, strength. */
function moths(scene: RenderScene): { x: number; y: number; z: number; strength: number }[] {
  const e = scene.particles.emitters;
  const out: { x: number; y: number; z: number; strength: number }[] = [];
  for (let i = 0; i < e.count; i++) if (e.preset[i] === MOTH) out.push({ x: e.x[i] as number, y: e.y[i] as number, z: e.z[i] as number, strength: e.strength[i] as number });
  return out;
}

/**
 * A light world with a calendar (a `SimWorld` that is never materialized: nothing falls from its sky) at `hour` o'clock `days`
 * days on, the figure on (10, 10) with a lit torch in its hand, a burning camp fire on (11, 10) and a torch on its stand on
 * (16, 10) – lit after the clock's jump (a jump burns them down).
 */
function lagerNacht(days: number, hour: number): LightWorld {
  const w = lightWorld(Array.from({ length: 24 }, () => '.'.repeat(24)));
  w.sim.attachWorld(new SimWorld(w.sim));
  jumpTo(w, days, hour);
  w.spawn(10, 10);
  w.give('lagerfeuer', 1);
  w.give('holz', 3);
  w.give('fackel', 2);
  const fire = w.place('lagerfeuer', 11, 10);
  w.step(1, [{ type: 'light.fuel', light: fire, from: w.slotOf('holz') }]);
  w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 10 }]);
  w.place('fackel', 16, 10);
  w.equipTorch();
  w.step(1, [{ type: 'light.toggle' }]);
  return w;
}

/** Jumps the clock `days` days and to `hour` o'clock (from wherever it stands, forwards). */
function jumpTo(w: LightWorld, days: number, hour: number): void {
  const perHour = w.sim.clock.ticksPerGameHour;
  const now = w.sim.world.calendar.hour;
  const hours = days * 24 + ((hour - now + 48) % 24);
  // A whole tick count (`| 0`): the clock keeps its tick a small integer, as the game's clock does.
  w.sim.clock.skip(Math.round(hours * perHour) | 0);
}

/** One frame of the particle filler with the camera on (cameraX, cameraY) [world px]. */
function frameAt(w: LightWorld, filler: ParticleSceneFiller, scene: RenderScene, layer: 0 | -1, cameraX: number, cameraY: number): RenderScene {
  scene.beginFrame(1);
  const figure = w.pos();
  filler.fill(scene, w.sim, layer, cameraX, cameraY, true, figure.x, figure.y);
  return scene;
}

describe('Motten als Daten (M7-149)', () => {
  it('der Lichtgast nennt warme Lichtarten, die es gibt; die Motte ist ein beleuchteter Fleck ohne Schwerkraft, der um das Licht taumelt', () => {
    expect(LIGHT_VISITORS.map((v) => v.emitter)).toEqual(['motten_licht']);
    const v = LIGHT_VISITORS[0];
    if (v === undefined) throw new Error('kein Lichtgast');
    for (const l of v.lichter) expect(LIGHT_KINDS.some((k) => k.id === l), l).toBe(true);
    // Warm lights only: the cold Lumen lantern and the firefly jar draw none, the stone fireplace stands in a room.
    expect(v.lichter).toContain('fackel');
    expect(v.lichter).toContain('lagerfeuer');
    for (const l of ['lumen_laterne', 'gluehwuermchenglas', 'kamin_stein']) expect(v.lichter).not.toContain(l);
    expect(v.jahreszeiten).not.toContain('winter');
    expect(v.tageslichtUnter).toBeLessThanOrEqual(0.25);
    const emitter = PARTICLE_EMITTERS.find((e) => e.id === v.emitter);
    const kind = PARTICLE_KINDS.find((k) => k.id === emitter?.art);
    expect(kind?.emissiv).toBe(0);
    expect(kind?.schwerkraft).toBe(0);
    expect(kind?.groesse.max).toBeLessThanOrEqual(2);
    expect(kind?.wirbel).toBeGreaterThan(20);
    // A handful per light: rate × mean life between 4 and 10.
    const alive = (emitter?.rate ?? 0) * (((kind?.leben.min ?? 0) + (kind?.leben.max ?? 0)) / 2);
    expect(alive).toBeGreaterThanOrEqual(4);
    expect(alive).toBeLessThanOrEqual(10);
  });

  it('der Inhalt weist eine unbekannte Quelle, eine doppelt besuchte Lichtart und eine unbekannte Jahreszeit zurück', () => {
    const ok = { emitter: 'motten_licht', lichter: ['fackel'], tageslichtUnter: 0.2, jahreszeiten: ['sommer'] };
    expect(defineLightVisitors([ok], PARTICLE_EMITTERS)).toHaveLength(1);
    expect(() => defineLightVisitors([{ ...ok, emitter: 'gibtsnicht' }], PARTICLE_EMITTERS)).toThrow(ParticleDataError);
    expect(() => defineLightVisitors([ok, { ...ok }], PARTICLE_EMITTERS)).toThrow(/twice/);
    expect(() => defineLightVisitors([{ ...ok, jahreszeiten: ['regenzeit'] }], PARTICLE_EMITTERS)).toThrow(ParticleDataError);
    expect(() => defineLightVisitors([{ ...ok, lichter: [] }], PARTICLE_EMITTERS)).toThrow(ParticleDataError);
  });
});

describe('Quelle an den Lichtern (ParticleSceneFiller)', () => {
  it('nachts an gesetzter Fackel und Lagerfeuer (nach seiner Helligkeit) in Höhe der Flamme, nicht an der getragenen Fackel', () => {
    const w = lagerNacht(0, 0);
    expect(w.sim.world.calendar.daylight).toBeLessThan(0.2);
    const figure = w.pos();
    const scene = frameAt(w, new ParticleSceneFiller(), new RenderScene(), 0, figure.x, figure.y);
    const m = moths(scene);
    expect(m).toHaveLength(2);
    const fire = w.light.sources(w.sim).find((s) => s.kind === 'lagerfeuer');
    const torch = w.light.sources(w.sim).find((s) => s.kind === 'fackel' && s.mount === 'stand');
    if (fire === undefined || torch === undefined) throw new Error('Lichter fehlen');
    const atFire = m.find((x) => x.x === fire.x && x.y === fire.y);
    const atTorch = m.find((x) => x.x === torch.x && x.y === torch.y);
    expect(atFire?.z).toBe(fire.height);
    expect(atFire?.strength).toBeCloseTo(Math.min(1, fire.intensity / BALANCE.light.campfire.intensity), 5);
    expect(atTorch).toEqual({ x: torch.x, y: torch.y, z: torch.height, strength: 1 });
    // The carried torch moves on with the figure: no moths follow it.
    expect(m.some((x) => Math.abs(x.x - figure.x) < T && Math.abs(x.y - figure.y) < T / 2 && x !== atFire)).toBe(false);
  });

  it('nicht am Tag, nicht unter der Erde, nicht im Winter, nicht an Lichtern außerhalb des Bildes', () => {
    const filler = new ParticleSceneFiller();
    const scene = new RenderScene();
    const noon = lagerNacht(0, 12);
    expect(noon.sim.world.calendar.daylight).toBeGreaterThan(0.5);
    expect(noon.light.sources(noon.sim).filter((s) => s.mount !== 'hand')).toHaveLength(2);
    expect(moths(frameAt(noon, filler, scene, 0, noon.pos().x, noon.pos().y))).toHaveLength(0);
    const w = lagerNacht(0, 23);
    const figure = w.pos();
    expect(moths(frameAt(w, filler, scene, 0, figure.x, figure.y))).toHaveLength(2);
    // The same night below ground: the surface's lights draw nothing there.
    expect(moths(frameAt(w, filler, scene, -1, figure.x, figure.y))).toHaveLength(0);
    // The view far off: no light in it.
    expect(moths(frameAt(w, filler, scene, 0, figure.x + 1200, figure.y))).toHaveLength(0);
    // The view so that the stand torch (6 tiles east of the fire) is in it and the fire is not (the view reaches 320 + 64 px).
    const torch = w.light.sources(w.sim).find((s) => s.kind === 'fackel' && s.mount === 'stand');
    if (torch === undefined) throw new Error('Fackel fehlt');
    const east = torch.x + 320 + 64 - 2 * T;
    const one = moths(frameAt(w, filler, scene, 0, east, figure.y));
    expect(one).toHaveLength(1);
    expect(one[0]?.x).toBe(torch.x);
    // Winter nights: no moths (a winter is three seasons on).
    const winter = lagerNacht(3 * BALANCE.calendar.defaultSeasonLengthDays, 23);
    expect(winter.sim.world.calendar.season).toBe('winter');
    expect(winter.sim.world.calendar.daylight).toBeLessThan(0.2);
    expect(winter.light.sources(winter.sim).filter((s) => s.mount !== 'hand')).toHaveLength(2);
    expect(moths(frameAt(winter, filler, scene, 0, winter.pos().x, winter.pos().y))).toHaveLength(0);
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
const WINDOWS = 5;
/**
 * Re-warm of every window after its forced collection (ADR-0203, as `objekt-dampf`, `gewoelbe-ansicht` and `kampf-ruhe`): the
 * collection retires optimised code whose embedded maps died, and in a long-lived shared worker the first windows then ran in a
 * lower tier. So each window first renders `REWARM_FRAMES` frames unsampled, gives the background compiler
 * `COMPILER_PAUSE_MS` and renders `INSTALL_FRAMES` before it samples – the windows, their frames, the median and the limit
 * are unchanged.
 */
const REWARM_FRAMES = FRAMES;
const COMPILER_PAUSE_MS = 200;
const INSTALL_FRAMES = 100;
const SAMPLING_INTERVAL = 16;
const MAX_BYTES_PER_FRAME = 2;

describe('ohne Allokation im Frame (§30, ADR-0142, ADR-0167)', { timeout: 60_000 }, () => {
  it('ein Nachtframe mit Motten an Feuer und Fackel bildet keine Zahl und kein Objekt', async () => {
    const w = lagerNacht(0, 0);
    const filler = new ParticleSceneFiller();
    const scene = new RenderScene();
    const figure = w.pos();
    const frames = (n: number): void => {
      for (let i = 0; i < n; i++) {
        scene.particles.emitters.clear();
        scene.particles.distortion.clear();
        filler.fill(scene, w.sim, 0, figure.x, figure.y, true, figure.x, figure.y);
      }
    };
    frames(FRAMES);
    expect(moths(scene)).toHaveLength(2);
    const perFrame: number[] = [];
    const tops: string[] = [];
    for (let k = 0; k < WINDOWS; k++) {
      await inspector.post('HeapProfiler.collectGarbage');
      frames(REWARM_FRAMES);
      await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
      frames(INSTALL_FRAMES);
      await inspector.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      frames(FRAMES);
      const profile = heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
      const alloc = pathAllocation(profile, (f) => f.functionName === 'frames' && /motten\.test/.test(f.url));
      perFrame.push(alloc.inPath / FRAMES);
      tops.push(JSON.stringify(alloc.top));
    }
    const median = [...perFrame].sort((x, y) => x - y)[Math.floor(WINDOWS / 2)] as number;
    expect(median, `${perFrame.map((b) => b.toFixed(2)).join(' / ')}: ${tops.join(' | ')}`).toBeLessThan(MAX_BYTES_PER_FRAME);
  });
});
