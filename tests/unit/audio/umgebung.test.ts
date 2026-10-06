/**
 * M7-06 Umgebung (MASTERPROMPT §27 "Biom-Klangbetten (Vögel tags, Grillen nachts, Wind, positionale Flüsse …),
 * Wetterschichten, Donner mit entfernungsabhängiger Verzögerung"; docs/SPIEL.md §24):
 *
 * - beds and callers by biome, day and night, season and cave layer; calls around the listener, quiet in rain;
 * - weather layers from drizzle to thunderstorm, muffled indoors; snow is silent;
 * - thunder after distance / 343 m/s (1 tile = 1 m), crack near, roll far, nothing through the rock of another layer;
 *   far lightning of a thunderstorm 500–3000 m away, never in clear weather;
 * - rivers: at most three voices at the nearest stretches, frozen water silent; the nearest shore.
 */
import { describe, expect, it } from 'vitest';
import {
  AMBIENCE_BEDS,
  AmbienceDirector,
  CALL_DISTANCE_TILES,
  CAVE_BED,
  DEFAULT_BED,
  FAR_LIGHTNING_INTERVAL,
  FAR_LIGHTNING_M,
  INDOOR_MUFFLE,
  RAIN_FULL,
  SPEED_OF_SOUND,
  bedFor,
  thunderDelay,
  type AmbienceSink,
} from '../../../src/audio/ambience/director';
import { MAX_RIVERS, RIVER_SPACING_TILES, createAmbienceState, scanWaterAround, type AmbienceState } from '../../../src/audio/ambience/probe';
import type { SfxCue } from '../../../src/audio/sfxPlayer';
import { SFX_PRESETS } from '../../../src/content/sfx/index';
import { WATER_DEPTH_SHALLOW, WATER_FROZEN, WATER_RIVER, WATER_SEA } from '../../../src/world/model/chunk';
import { TILE_PX } from '../../../src/world/model/coords';
import { OFFSET, TestChunks } from '../game/spieler-testwelt';

/** Records what the director plays. */
class Sink implements AmbienceSink {
  readonly loops = new Map<string, SfxCue>();
  readonly played: Array<SfxCue & { at: number }> = [];
  now = 0;
  setLoop(slot: string, cue: SfxCue | null): void {
    if (cue === null) this.loops.delete(slot);
    else this.loops.set(slot, { ...cue });
  }
  play(cue: SfxCue): boolean {
    this.played.push({ ...cue, at: this.now });
    return true;
  }
  loopIds(): string[] {
    return [...this.loops.values()].map((c) => c.id).sort();
  }
}

const LISTENER = { x: 5000, y: 7000, layer: 0 };

function state(patch: Partial<AmbienceState>): AmbienceState {
  return Object.assign(createAmbienceState(), { active: true, biome: 'gruenhain', season: 'sommer' }, patch);
}

/** Runs the director at 60 frames per second from `from` to `to` [s]. */
function run(d: AmbienceDirector, s: AmbienceState, sink: Sink, from: number, to: number): void {
  for (let t = from; t < to; t += 1 / 60) {
    sink.now = t;
    d.update(s, LISTENER, { now: t }, sink);
  }
}

const PRESET_IDS = new Set(SFX_PRESETS.map((p) => p.id));

describe('Klangbetten und Rufe', () => {
  it('Grünhain: Laub und Vögel am Tag, Grillen und Eule nachts, im Winter keine Grillen; Küste: Brandung und Möwen; Höhle; Wind sonst', () => {
    expect(bedFor(state({}))).toBe(AMBIENCE_BEDS.gruenhain?.tag);
    expect(bedFor(state({ night: true })).betten.map((b) => b.id)).toEqual(['sfx_umgebung_grillen']);
    expect(bedFor(state({ night: true, season: 'winter' })).betten.map((b) => b.id)).not.toContain('sfx_umgebung_grillen');
    expect(bedFor(state({ biome: 'salzkueste' })).rufe).toEqual(['sfx_umgebung_moewe']);
    expect(bedFor(state({ layer: -1, biome: 'wurzelhoehlen' }))).toBe(CAVE_BED);
    expect(bedFor(state({ biome: 'nebelmoor' }))).toBe(DEFAULT_BED);
    // Every id the beds name is a preset of the bus `umgebung`; beds loop, callers do not.
    for (const biome of Object.values(AMBIENCE_BEDS)) {
      for (const bed of [biome.tag, biome.nacht, biome.winternacht, CAVE_BED, DEFAULT_BED]) {
        if (bed === undefined) continue;
        for (const b of bed.betten) expect(SFX_PRESETS.find((p) => p.id === b.id)?.schleife, b.id).toBeDefined();
        for (const r of bed.rufe) {
          const p = SFX_PRESETS.find((q) => q.id === r);
          expect(p?.bus, r).toBe('umgebung');
          expect(p?.schleife, r).toBeUndefined();
        }
      }
    }
  });

  it('der Tag spielt sein Bett und ruft Vögel ringsum in 8–28 Kacheln; im Regen schweigen sie; drinnen gedämpft, ohne Rufe', () => {
    const d = new AmbienceDirector(11);
    const sink = new Sink();
    const day = state({});
    run(d, day, sink, 0, 60);
    expect(sink.loopIds()).toEqual(['sfx_umgebung_laub']);
    const birds = sink.played.filter((c) => c.id.startsWith('sfx_umgebung_vogel_'));
    expect(birds.length).toBeGreaterThanOrEqual(60 / 9 - 1);
    expect(new Set(birds.map((b) => b.id)).size).toBeGreaterThan(1);
    for (const b of birds) {
      const dist = Math.hypot((b.x ?? 0) - LISTENER.x, (b.y ?? 0) - LISTENER.y) / TILE_PX;
      expect(dist).toBeGreaterThanOrEqual(CALL_DISTANCE_TILES[0] - 1e-9);
      expect(dist).toBeLessThanOrEqual(CALL_DISTANCE_TILES[1] + 1e-9);
      expect(b.layer).toBe(0);
    }
    // Heavy rain: the birds keep quiet, the rain falls.
    const before = sink.played.length;
    run(d, state({ weather: 'regen', rain: true, precipitation: 0.65 }), sink, 60, 120);
    expect(sink.played.length).toBe(before);
    expect(sink.loops.get('wetter_regen')?.volume).toBeCloseTo(1);
    // Indoors: the bed quieter and muffled, the rain on the roof muffled, no calls.
    run(d, state({ indoors: true, weather: 'regen', rain: true, precipitation: 0.65 }), sink, 120, 180);
    expect(sink.played.length).toBe(before);
    expect(sink.loops.get('umgebung_bett_0')?.muffle).toBe(INDOOR_MUFFLE);
    expect(sink.loops.get('wetter_regen')?.muffle).toBe(INDOOR_MUFFLE);
    // The same seed draws the same calls.
    const again = new Sink();
    run(new AmbienceDirector(11), day, again, 0, 60);
    expect(again.played).toEqual(sink.played.slice(0, again.played.length));
  });

  it('Höhle: Tropfen und Grollen, kein Wetter, kein Wind; ohne Welt verstummt alles', () => {
    const d = new AmbienceDirector(4);
    const sink = new Sink();
    run(d, state({ layer: -1, biome: 'wurzelhoehlen', weather: 'gewitter', wind: 1, storm: true }), sink, 0, 30);
    expect(sink.loopIds()).toEqual(['sfx_umgebung_hoehle']);
    expect(sink.played.length).toBeGreaterThan(2);
    expect(sink.played.every((c) => c.id === 'sfx_umgebung_tropfen')).toBe(true);
    run(d, createAmbienceState(), sink, 30, 31);
    expect(sink.loops.size).toBe(0);
  });
});

describe('Wetterschichten', () => {
  it('Niesel leise, Regen voll, Gewitter mit Starkregen und Sturm; Schnee fällt lautlos', () => {
    const at = (patch: Partial<AmbienceState>): Sink => {
      const sink = new Sink();
      run(new AmbienceDirector(2), state(patch), sink, 0, 0.5);
      return sink;
    };
    const drizzle = at({ weather: 'niesel', rain: true, precipitation: 0.25, wind: 0.2 });
    expect(drizzle.loops.get('wetter_regen')?.volume).toBeCloseTo(0.25 / RAIN_FULL);
    expect(drizzle.loops.has('wetter_starkregen')).toBe(false);
    expect(drizzle.loops.has('wetter_wind')).toBe(false);
    const storm = at({ weather: 'gewitter', rain: true, precipitation: 1, wind: 0.85, storm: true });
    expect(storm.loops.get('wetter_regen')?.volume).toBe(1);
    expect(storm.loops.get('wetter_starkregen')?.volume).toBe(1);
    expect(storm.loops.get('wetter_wind')?.volume).toBeCloseTo(0.75);
    const snow = at({ weather: 'schneesturm', rain: false, precipitation: 1, wind: 1 });
    expect(snow.loops.has('wetter_regen')).toBe(false);
    expect(snow.loops.get('wetter_wind')?.volume).toBe(1);
    for (const sink of [drizzle, storm, snow]) for (const c of sink.loops.values()) expect(PRESET_IDS.has(c.id), c.id).toBe(true);
  });
});

describe('Donner', () => {
  it('kommt nach Entfernung / 343 m/s: fern rollend, nah krachend; auf einer anderen Ebene gar nicht', () => {
    expect(SPEED_OF_SOUND).toBe(343);
    expect(thunderDelay(686)).toBeCloseTo(2);
    const d = new AmbienceDirector(5);
    const sink = new Sink();
    const s = state({});
    run(d, s, sink, 0, 1);
    sink.played.length = 0;
    // 686 tiles east = 686 m: two seconds.
    d.lightning(LISTENER.x + 686 * TILE_PX, LISTENER.y, 0, LISTENER, 1);
    run(d, s, sink, 1, 2.98);
    expect(sink.played.filter((c) => c.id.startsWith('sfx_umgebung_donner'))).toEqual([]);
    run(d, s, sink, 2.98, 3.05);
    const far = sink.played.filter((c) => c.id.startsWith('sfx_umgebung_donner'));
    expect(far.map((c) => c.id)).toEqual(['sfx_umgebung_donner_fern']);
    expect((far[0]?.at ?? 0) - 1).toBeGreaterThanOrEqual(2 - 1e-9);
    expect((far[0]?.at ?? 0) - 1).toBeLessThan(2 + 1 / 30);
    // Panned towards the lightning (east).
    expect(far[0]?.x ?? 0).toBeGreaterThan(LISTENER.x);
    // 120 m north: a crack after 0,35 s, louder than the far roll.
    d.lightning(LISTENER.x, LISTENER.y - 120 * TILE_PX, 0, LISTENER, 4);
    run(d, s, sink, 4, 4.5);
    const near = sink.played.filter((c) => c.id === 'sfx_umgebung_donner_nah');
    expect(near).toHaveLength(1);
    expect((near[0]?.at ?? 0) - 4).toBeCloseTo(120 / 343, 1);
    expect(near[0]?.volume ?? 0).toBeGreaterThan(far[0]?.volume ?? 1);
    expect(near[0]?.y ?? 0).toBeLessThan(LISTENER.y);
    // A strike on the surface is not heard in the caves.
    d.lightning(LISTENER.x + 100, LISTENER.y, 0, { ...LISTENER, layer: -1 }, 5);
    expect(d.pendingThunder).toBe(0);
  });

  it('ein Gewitter blitzt ringsum 500–3000 m entfernt, alle 6–20 s, jeder Blitz mit seinem Donner; klares Wetter nie', () => {
    const d = new AmbienceDirector(9);
    const sink = new Sink();
    run(d, state({ weather: 'gewitter', rain: true, precipitation: 1, wind: 0.85, storm: true }), sink, 0, 300);
    const flashes = d.farLightning;
    expect(flashes.length).toBeGreaterThanOrEqual(300 / FAR_LIGHTNING_INTERVAL[1] - 1);
    for (const f of flashes) {
      expect(f.distance).toBeGreaterThanOrEqual(FAR_LIGHTNING_M[0]);
      expect(f.distance).toBeLessThanOrEqual(FAR_LIGHTNING_M[1]);
    }
    for (let i = 1; i < flashes.length; i++) {
      const gap = (flashes[i]?.at ?? 0) - (flashes[i - 1]?.at ?? 0);
      expect(gap).toBeGreaterThanOrEqual(FAR_LIGHTNING_INTERVAL[0] - 1 / 60);
      expect(gap).toBeLessThanOrEqual(FAR_LIGHTNING_INTERVAL[1] + 1 / 60);
    }
    const thunders = sink.played.filter((c) => c.id === 'sfx_umgebung_donner_fern');
    // Every flash whose thunder had time to arrive was heard, d / 343 s later.
    const arrived = flashes.filter((f) => f.at + thunderDelay(f.distance) < 300);
    expect(thunders).toHaveLength(arrived.length);
    for (const [i, f] of arrived.entries()) expect((thunders[i]?.at ?? 0) - f.at - thunderDelay(f.distance)).toBeLessThan(1 / 30);
    const clear = new AmbienceDirector(9);
    run(clear, state({ weather: 'klar' }), new Sink(), 0, 300);
    expect(clear.farLightning).toEqual([]);
  });
});

describe('Flüsse und Meer', () => {
  it('höchstens drei Stimmen an den nächsten, auseinanderliegenden Flussstücken; gefrorenes Wasser schweigt; das nächste Ufer', () => {
    const chunks = new TestChunks();
    const set = (x: number, y: number, bits: number): void => {
      const { chunk, i } = chunks.at(OFFSET + x, OFFSET + y);
      chunk.water[i] = bits;
    };
    // A river running north–south at x = 20, frozen from y = 30 on; the listener at (14, 10).
    for (let y = 0; y < 40; y++) set(20, y, WATER_DEPTH_SHALLOW | WATER_RIVER | (y >= 30 ? WATER_FROZEN : 0));
    set(14, 40, WATER_DEPTH_SHALLOW | WATER_SEA);
    const out = createAmbienceState();
    scanWaterAround(chunks, 0, OFFSET + 14, OFFSET + 10, out);
    expect(out.rivers).toBe(MAX_RIVERS);
    const tile = (px: number): number => Math.floor(px / TILE_PX) - OFFSET;
    expect([tile(out.riverX[0] as number), tile(out.riverY[0] as number)]).toEqual([20, 10]);
    for (let i = 0; i < out.rivers; i++) {
      expect(tile(out.riverX[i] as number)).toBe(20);
      for (let j = 0; j < i; j++) expect(Math.abs((out.riverY[i] as number) - (out.riverY[j] as number)) / TILE_PX).toBeGreaterThanOrEqual(RIVER_SPACING_TILES);
    }
    // The sea is 30 tiles away (beyond the scan); one closer is found.
    expect(out.sea).toBe(false);
    set(14, 25, WATER_DEPTH_SHALLOW | WATER_SEA);
    scanWaterAround(chunks, 0, OFFSET + 14, OFFSET + 10, out);
    expect(out.sea).toBe(true);
    expect([tile(out.seaX), tile(out.seaY)]).toEqual([14, 25]);
    // Near the frozen stretch only the open water babbles; the nearer shore wins.
    scanWaterAround(chunks, 0, OFFSET + 20, OFFSET + 38, out);
    expect(out.rivers).toBeGreaterThan(0);
    for (let i = 0; i < out.rivers; i++) expect(tile(out.riverY[i] as number)).toBeLessThan(30);
    expect([tile(out.seaX), tile(out.seaY)]).toEqual([14, 40]);
    // The director plays them as positional loops.
    const d = new AmbienceDirector(1);
    const sink = new Sink();
    const s = Object.assign(state({}), { rivers: out.rivers, sea: true, seaX: out.seaX, seaY: out.seaY });
    s.riverX.set(out.riverX);
    s.riverY.set(out.riverY);
    run(d, s, sink, 0, 0.3);
    const rivers = [...sink.loops.entries()].filter(([slot]) => slot.startsWith('umgebung_fluss'));
    expect(rivers).toHaveLength(out.rivers);
    for (const [, c] of rivers) expect(c.id).toBe('sfx_umgebung_fluss');
    expect(sink.loops.get('umgebung_meer')?.x).toBe(out.seaX);
  });
});
