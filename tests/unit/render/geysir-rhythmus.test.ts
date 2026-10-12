/**
 * Ausbruchsrhythmus des Geysirs (M7-141; MASTERPROMPT §6.2 „Emitter als Daten“, §21 „Naturwunder“; docs/SPIEL.md §18;
 * src/content/particles/orte.ts, src/render/world/objectEmitters.ts): der Geysir dampft nicht mehr gleichmäßig, sondern ruht,
 * schwillt an, bricht aus (Wasserstrahl und Dampfschwall als eigene Quellen am selben Punkt) und klingt ab. Wo im Zyklus ein
 * Geysir steht, ist eine reine Funktion der Darstellungszeit und seiner Kachel – kein Simulationszustand: ein eingefrorenes
 * Bild zeigt immer dieselbe Phase, zwei Geysire eines Feldes stehen an verschiedenen Stellen ihres Zyklus.
 */
import { describe, expect, it } from 'vitest';
import { OBJECT_EMITTERS, PARTICLE_EMITTERS, PARTICLE_KINDS, ParticleDataError, defineObjectEmitters, type ObjectRhythm } from '../../../src/content/particles/index';
import { NATURWUNDER_ASCHENSCHLUND_01 } from '../../../src/content/places/layouts/naturwunder_aschenschlund_01';
import { NATURWUNDER_ASCHENSCHLUND_02 } from '../../../src/content/places/layouts/naturwunder_aschenschlund_02';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { particleEmitter } from '../../../src/render/particles/tables';
import { RenderScene } from '../../../src/render/scene';
import {
  createRhythmRegister,
  ObjectEmitters,
  RHYTHM_AT,
  RHYTHM_BURST,
  RHYTHM_PERIOD,
  RHYTHM_SOURCE,
  rhythmIn,
  rhythmPhaseIn,
  writeRhythmRow,
} from '../../../src/render/world/objectEmitters';
import type { ObjectView } from '../../../src/render/world/objects';
import { ChunkSignatures } from '../../../src/render/world/signature';
import { WorldRenderTables } from '../../../src/render/world/tables';
import { ChunkData } from '../../../src/world/model/chunk';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

const CHUNK_TILES = 32;
const TABLES = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return new WorldRenderTables(manifestFromGenerated(mod));
})();
const IDS = contentWorldIdTables().objects;
const GEYSIR = (() => {
  const b = OBJECT_EMITTERS.find((x) => x.objekt === 'ort_geysir');
  if (b?.rhythmus === undefined) throw new Error('Der Geysir hat keinen Rhythmus');
  return { binding: b, rhythm: b.rhythmus };
})();
const R: ObjectRhythm = GEYSIR.rhythm;
/** Sampling step of the cycle [s]. */
const STEP = 0.05;

/** The rhythm table of `r` (one row) and a register. */
function rhythmTable(r: ObjectRhythm): Float64Array {
  const t = new Float64Array(5);
  writeRhythmRow(t, 0, r);
  return t;
}

/** The strengths [source, burst] at second `at` of a cycle of `period` seconds. */
function strengthsAt(table: Float64Array, at: number, period: number): [number, number] {
  const reg = createRhythmRegister();
  reg[RHYTHM_AT] = at;
  reg[RHYTHM_PERIOD] = period;
  rhythmIn(table, 0, reg);
  return [reg[RHYTHM_SOURCE] as number, reg[RHYTHM_BURST] as number];
}

/** Cycle length and offset [s] of the geysir on tile (tx, ty). */
function phaseOf(tx: number, ty: number): { period: number; offset: number } {
  const reg = createRhythmRegister();
  rhythmPhaseIn(tx, ty, new Float64Array([R.periode.min, R.periode.max - R.periode.min]), 0, reg);
  return { period: reg[RHYTHM_PERIOD] as number, offset: reg[RHYTHM_AT] as number };
}

/** A surface chunk (cx, cy) with geysirs on the local tiles `at`. */
function chunkWith(cx: number, cy: number, at: readonly (readonly [number, number])[]): ChunkData {
  const c = new ChunkData(0, cx, cy);
  for (const [x, y] of at) c.object[y * CHUNK_TILES + x] = IDS.runtimeId('ort_geysir');
  return c;
}

/** The view over chunk (0, 0). */
function viewOf(c: ChunkData): ObjectView {
  return {
    layer: 0,
    chunks: { get: (_l, cx, cy) => (cx === c.cx && cy === c.cy ? c : undefined) },
    signatures: new ChunkSignatures(),
    left: 0,
    top: 0,
    right: CHUNK_TILES * 16,
    bottom: CHUNK_TILES * 16,
    fadeX: 0,
    fadeY: 0,
    fadeRadius: 0,
  };
}

/** One frame at presentation time `t`: the pushed sources [preset, x, y, z, strength, id]. */
function frameAt(sources: ObjectEmitters, view: ObjectView, scene: RenderScene, t: number): number[][] {
  scene.beginFrame(t);
  view.signatures.beginFrame();
  sources.emit(scene, view);
  const e = scene.particles.emitters;
  const out: number[][] = [];
  for (let k = 0; k < e.count; k++) out.push([e.preset[k] as number, e.x[k] as number, e.y[k] as number, e.z[k] as number, e.strength[k] as number, e.id[k] as number]);
  return out;
}

/** The presentation times [s] in [0, until) at which eruptions of the sources in `view` begin (in steps of `STEP`). */
function eruptionStarts(view: ObjectView, until: number, idOf: number): number[] {
  const sources = new ObjectEmitters(TABLES);
  const scene = new RenderScene();
  const starts: number[] = [];
  let was = false;
  for (let i = 0; i * STEP < until; i++) {
    const t = i * STEP;
    const now = frameAt(sources, view, scene, t).some((s) => s[5] === idOf && s[0] === particleEmitter('geysir_fontaene'));
    if (now && !was && i > 0) starts.push(t);
    was = now;
  }
  return starts;
}

/** The stable number of the source on tile (tx, ty) (`SOURCE_ID_BASE` | row | column). */
function sourceId(tx: number, ty: number): number {
  return 0x3a000000 + ((ty << 8) | tx);
}

describe('Rhythmus als Daten (M7-141)', () => {
  it('der Geysir hat Ruhe, Anstieg, Ausbruch und Abklingen; der Ausbruch ist ein fallender Wasserstrahl und ein steigender Dampfschwall; der Dampfspalt dampft gleichmäßig', () => {
    expect(R.ausbruchEmitter).toEqual(['geysir_saeule', 'geysir_fontaene', 'geysir_schwall']);
    expect(R.anstieg + R.ausbruch + R.abklingen).toBeLessThan(R.periode.min);
    expect(R.ruhe).toBeGreaterThan(0);
    expect(R.ruhe).toBeLessThan(1);
    expect(R.periode.max).toBeGreaterThan(R.periode.min);
    const kindOf = (emitter: string) => PARTICLE_KINDS.find((k) => k.id === PARTICLE_EMITTERS.find((e) => e.id === emitter)?.art);
    const core = kindOf('geysir_saeule');
    const jet = kindOf('geysir_fontaene');
    const billow = kindOf('geysir_schwall');
    // Water is pulled down (the pillar slows, the spray falls back and splashes on the sinter); steam rises; none glows.
    expect(core?.schwerkraft).toBeGreaterThan(0);
    expect(jet?.schwerkraft).toBeGreaterThan(0);
    expect(jet?.boden).toBe('spritzen');
    expect(billow?.schwerkraft).toBeLessThan(0);
    expect([core?.emissiv, jet?.emissiv, billow?.emissiv]).toEqual([0, 0, 0]);
    // The pillar and the spray are thrown far faster than the column's puffs rise (the jet stands out of the steam).
    const dampf = PARTICLE_EMITTERS.find((e) => e.id === 'geysir_dampf');
    for (const id of ['geysir_saeule', 'geysir_fontaene']) {
      expect(PARTICLE_EMITTERS.find((e) => e.id === id)?.steigen.min, id).toBeGreaterThan(4 * (dampf?.steigen.max ?? Infinity));
    }
    expect(OBJECT_EMITTERS.find((b) => b.objekt === 'ort_dampfspalt')?.rhythmus).toBeUndefined();
  });

  it('der Inhalt weist einen Rhythmus ohne Ruhe, zu lange Rampen und unbekannte Ausbruchsquellen zurück', () => {
    const base = { objekt: 'ort_geysir', emitter: 'geysir_dampf', dx: 0, hoehe: 4 };
    const rhythm = { periode: { min: 24, max: 36 }, anstieg: 4, ausbruch: 6, abklingen: 5, rampe: 0.8, ruhe: 0.3, ausbruchEmitter: ['geysir_fontaene'] };
    expect(defineObjectEmitters([{ ...base, rhythmus: rhythm }], PARTICLE_EMITTERS)).toHaveLength(1);
    expect(() => defineObjectEmitters([{ ...base, rhythmus: { ...rhythm, periode: { min: 15, max: 36 } } }], PARTICLE_EMITTERS)).toThrow(/rest/);
    expect(() => defineObjectEmitters([{ ...base, rhythmus: { ...rhythm, rampe: 3.1 } }], PARTICLE_EMITTERS)).toThrow(/ramps/);
    expect(() => defineObjectEmitters([{ ...base, rhythmus: { ...rhythm, ausbruchEmitter: ['gibtsnicht'] } }], PARTICLE_EMITTERS)).toThrow(ParticleDataError);
    expect(() => defineObjectEmitters([{ ...base, rhythmus: { ...rhythm, ausbruchEmitter: [] } }], PARTICLE_EMITTERS)).toThrow(ParticleDataError);
    expect(() => defineObjectEmitters([{ ...base, rhythmus: { ...rhythm, ruhe: 1.2 } }], PARTICLE_EMITTERS)).toThrow(ParticleDataError);
  });
});

describe('ein Zyklus (rhythmIn)', () => {
  it('ruht bei einem Drittel, schwillt an, bricht aus (Strahl mit Rampen), klingt ab – der Ausbruch dauert so lange wie in den Daten', () => {
    const table = rhythmTable(R);
    const period = 30;
    const riseFrom = period - R.anstieg - R.ausbruch - R.abklingen;
    const eruptFrom = riseFrom + R.anstieg;
    const decayFrom = eruptFrom + R.ausbruch;
    let bursting = 0;
    let last: [number, number] = [0, 0];
    for (let i = 0; i * STEP < period; i++) {
      const at = i * STEP;
      const [source, burst] = strengthsAt(table, at, period);
      expect(source, `${at}`).toBeGreaterThanOrEqual(R.ruhe - 1e-12);
      expect(source, `${at}`).toBeLessThanOrEqual(1);
      expect(burst, `${at}`).toBeGreaterThanOrEqual(0);
      expect(burst, `${at}`).toBeLessThanOrEqual(1);
      if (burst > 0) bursting++;
      if (at < riseFrom) expect([source, burst], `Ruhe ${at}`).toEqual([R.ruhe, 0]);
      else if (at < eruptFrom) {
        // Rising: the column thickens, no jet yet.
        expect(burst, `Anstieg ${at}`).toBe(0);
        expect(source, `Anstieg ${at}`).toBeGreaterThanOrEqual(last[0]);
        expect(source).toBeLessThan(1);
      } else if (at < decayFrom) {
        expect(source, `Ausbruch ${at}`).toBe(1);
        const e = at - eruptFrom;
        if (e >= R.rampe && e <= R.ausbruch - R.rampe) expect(burst, `Ausbruch ${at}`).toBe(1);
        else if (e < R.rampe) expect(burst, `Ausbruch steigt ${at}`).toBeGreaterThanOrEqual(last[1]);
        else expect(burst, `Ausbruch fällt ${at}`).toBeLessThanOrEqual(last[1]);
      } else {
        expect(burst, `Abklingen ${at}`).toBe(0);
        expect(source, `Abklingen ${at}`).toBeLessThanOrEqual(last[0]);
      }
      last = [source, burst];
    }
    // The jet blows for the eruption's length (to a sampling step at either end).
    expect(Math.abs(bursting * STEP - R.ausbruch)).toBeLessThanOrEqual(2 * STEP);
    // The rise starts calm and ends full; the decay ends back at rest.
    expect(strengthsAt(table, riseFrom, period)[0]).toBeCloseTo(R.ruhe, 12);
    expect(strengthsAt(table, eruptFrom - 1e-9, period)[0]).toBeCloseTo(1, 6);
    expect(strengthsAt(table, period - 1e-9, period)[0]).toBeCloseTo(R.ruhe, 6);
  });

  it('jede Kachel hat ihren Zyklus: Länge im Band der Daten, Versatz im Zyklus, über viele Kacheln gestreut', () => {
    const periods: number[] = [];
    const quarters = new Set<number>();
    const offsets = new Set<number>();
    for (let ty = 0; ty < 8; ty++) {
      for (let tx = 0; tx < 8; tx++) {
        const { period, offset } = phaseOf(100 + 13 * tx, 200 + 7 * ty);
        expect(period).toBeGreaterThanOrEqual(R.periode.min);
        expect(period).toBeLessThanOrEqual(R.periode.max);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(period);
        periods.push(period);
        quarters.add(Math.floor((4 * offset) / period));
        offsets.add(offset);
        // The same tile, the same cycle (a pure function of the tile).
        expect(phaseOf(100 + 13 * tx, 200 + 7 * ty)).toEqual({ period, offset });
      }
    }
    expect(offsets.size).toBe(64);
    expect(quarters.size).toBe(4);
    const spread = Math.max(...periods) - Math.min(...periods);
    expect(spread).toBeGreaterThan((R.periode.max - R.periode.min) / 2);
  });
});

describe('Quellen im Bild über die Zeit (ObjectEmitters)', () => {
  it('die Säule ruht bei einem Drittel ihrer Rate und bricht einmal je Zyklus aus: Strahl, Gischt und Schwall am Punkt der Säule, nur während des Ausbruchs', () => {
    const c = chunkWith(0, 0, [[5, 6]]);
    const view = viewOf(c);
    const sources = new ObjectEmitters(TABLES);
    const scene = new RenderScene();
    const column = particleEmitter('geysir_dampf');
    const pillar = particleEmitter('geysir_saeule');
    const jet = particleEmitter('geysir_fontaene');
    const billow = particleEmitter('geysir_schwall');
    const { period } = phaseOf(5, 6);
    let resting = 0;
    let erupting = 0;
    for (let i = 0; i * STEP < 2 * period; i++) {
      const s = frameAt(sources, view, scene, i * STEP);
      const [first] = s;
      if (first === undefined) throw new Error('keine Quelle');
      expect(first[0]).toBe(column);
      expect(first[5]).toBe(sourceId(5, 6));
      if (s.length === 1) {
        if (Math.abs((first[4] as number) - R.ruhe) < 1e-6) resting++;
        continue;
      }
      expect(s.length).toBe(4);
      erupting++;
      // The column blows at full rate; the pillar, the spray and the billow stand at its point with one strength.
      expect(first[4]).toBe(1);
      expect(s.map((x) => x[0])).toEqual([column, pillar, jet, billow]);
      for (const b of s.slice(1)) {
        expect(b.slice(1, 4)).toEqual(first.slice(1, 4));
        expect(b[4]).toBe(s[1]?.[4]);
        expect(b[4]).toBeGreaterThan(0);
        expect(b[4]).toBeLessThanOrEqual(1);
      }
    }
    // Two cycles: the jet blew for two eruptions; the column rested for most of the time.
    expect(Math.abs(erupting * STEP - 2 * R.ausbruch)).toBeLessThanOrEqual(4 * STEP);
    expect(resting * STEP).toBeGreaterThan(2 * (R.periode.min - R.anstieg - R.ausbruch - R.abklingen) - 4 * STEP);
    // One eruption per cycle: two starts in the first two cycles and a bit, a cycle apart.
    const starts = eruptionStarts(view, 2 * period + R.ausbruch, sourceId(5, 6));
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs((starts[1] as number) - (starts[0] as number) - period)).toBeLessThanOrEqual(2 * STEP);
  });

  it('ein eingefrorenes Bild zeigt immer dieselbe Phase – kein Zustand in der Darstellung, auch nicht in einer neuen Instanz', () => {
    const c = chunkWith(0, 0, [[5, 6], [20, 18]]);
    const view = viewOf(c);
    const a = new ObjectEmitters(TABLES);
    const sceneA = new RenderScene();
    for (let t = 0; t < 120; t += 7.3) {
      const once = frameAt(a, view, sceneA, t);
      const twice = frameAt(a, view, sceneA, t);
      const fresh = frameAt(new ObjectEmitters(TABLES), view, new RenderScene(), t);
      expect(twice).toEqual(once);
      expect(fresh).toEqual(once);
    }
  });

  it('die zwei Geysire des großen Geysirfelds brechen zu verschiedenen Zeiten aus (an mehreren Stellen der Welt)', () => {
    const geysirsOf = (rows: readonly string[]): [number, number][] => {
      const out: [number, number][] = [];
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === 'G') out.push([x, y]);
      });
      return out;
    };
    // The small field (a crowded slot) has one geysir; the large one two.
    expect(geysirsOf(NATURWUNDER_ASCHENSCHLUND_02.zeilen)).toHaveLength(1);
    for (const layout of [NATURWUNDER_ASCHENSCHLUND_01]) {
      const pair = geysirsOf(layout.zeilen);
      expect(pair, layout.id).toHaveLength(2);
      // The field at several places of the first chunk (the tile decides, not the layout).
      for (const [ox, oy] of [[0, 0], [9, 3], [16, 16], [3, 15]] as const) {
        const tiles = pair.map(([x, y]) => [x + ox, y + oy] as const);
        const view = viewOf(chunkWith(0, 0, tiles));
        const [p, q] = tiles.map(([x, y]) => phaseOf(x, y));
        // Their cycles differ in length and in where they stand.
        expect(p?.period, layout.id).not.toBe(q?.period);
        expect(p?.offset, layout.id).not.toBe(q?.offset);
        const first = tiles.map(([x, y]) => eruptionStarts(view, R.periode.max + R.ausbruch, sourceId(x, y))[0]);
        expect(first.every((t) => t !== undefined), `${layout.id} @${ox},${oy}`).toBe(true);
        // Apart by more than the ramp of an eruption: the two jets do not rise together.
        expect(Math.abs((first[0] as number) - (first[1] as number)), `${layout.id} @${ox},${oy}: ${first.join(' / ')}`).toBeGreaterThan(R.rampe);
      }
    }
  });
});
