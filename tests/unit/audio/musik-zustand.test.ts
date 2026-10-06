/**
 * M7-04 Musik-Direktor (docs/SPIEL.md §24 "Musik-System"; MASTERPROMPT §27 "adaptive Schichten (Gefahren-Percussion bei
 * Gegnernähe), weiche Überblendungen, Stinger …, Stille ist erlaubt"):
 *
 * - moods → piece, arrangement and layers (title, biome by day and night, base, fight, boss, vault, silence; the biomes
 *   without their own theme and the caves);
 * - hysteresis: a mood must hold before the music follows, the fight holds on after the last hunter;
 * - fades of 2–4 s; the danger layer with the hunter's distance;
 * - quiet nights: after one pass a pause of 60–180 s drawn per world and night, the same for the same seed;
 * - stingers: event table, one at a time, the more important one waits, a stale one is dropped;
 * - the runtime: the title theme loads and plays sample-locked stems; a stinger ducks the music; the player's song plays on
 *   the effects bus; the probe reads the title, a living and a dead player.
 */
import { describe, expect, it } from 'vitest';
import { AudioMixer, busGains } from '../../../src/audio/mixer';
import { ENTER_SECONDS, FADE_SECONDS, FIGHT_DANGER_MIN, KAMPF_HOLD_SECONDS, MusicDirector, QUIET_MAX_SECONDS, QUIET_MIN_SECONDS, createMusicDecision, dangerGain, type MusicDecision } from '../../../src/audio/music/director';
import { MusicPlayer } from '../../../src/audio/music/player';
import { MusicProbeReader } from '../../../src/audio/music/probe';
import { MusicRuntime } from '../../../src/audio/music/musicRuntime';
import { STINGER_EVENTS, STINGER_PRIORITY, STINGER_WAIT_SECONDS, StingerQueue, stingerEventTypes } from '../../../src/audio/music/stingers';
import { MUSIC_MOODS, createMusicProbe, type MusicProbe } from '../../../src/audio/music/types';
import { BIOME_MUSIC, MOOD_MUSIC, STINGERS } from '../../../src/content/music/index';
import { defaultSettings } from '../../../src/engine/settings';
import { SIM_EVENT_TYPES } from '../../../src/game/sim';
import { meadow, testWorld } from '../game/spieler-testwelt';
import { FakeContext, type FakeGain, type FakeSource } from './fakeAudio';
import { testLibrary } from './musik-testlied';

/** A director over pieces of 100 s. */
function director(seed = 1): MusicDirector {
  return new MusicDirector({ seed, pieceSeconds: () => 100, hasPiece: (id) => id === 'borkenvater' || id === 'kampf' || id === 'gruenhain' || id === 'titel' || id === 'basis' });
}

function probe(patch: Partial<MusicProbe>): MusicProbe {
  return Object.assign(createMusicProbe(), { mood: 'erkundung', biome: 'gruenhain' }, patch);
}

/** Feeds `p` every 1/10 s from `from` to `to`; returns the last decision. */
function hold(d: MusicDirector, p: MusicProbe, from: number, to: number, out: MusicDecision = createMusicDecision()): MusicDecision {
  for (let t = from; t <= to + 1e-9; t += 0.1) d.update(p, t, out);
  return out;
}

describe('Stimmungen', () => {
  it('Titel, Biom bei Tag und Nacht, Basis, Kampf, Boss, Gewölbe, Stille wählen Stück, Arrangement und Schichten', () => {
    const at = (p: MusicProbe): MusicDecision => hold(director(), p, 0, 0);
    expect(at(probe({ mood: 'titel' }))).toMatchObject({ piece: MOOD_MUSIC.titel, arrangement: 'standard' });
    expect(at(probe({}))).toMatchObject({ piece: 'gruenhain', arrangement: 'tag', layers: { basis: 1, melodie: 1, gefahr: 0 } });
    expect(at(probe({ night: true }))).toMatchObject({ piece: 'gruenhain', arrangement: 'nacht' });
    expect(at(probe({ mood: 'basis' }))).toMatchObject({ piece: MOOD_MUSIC.basis });
    const fight = at(probe({ mood: 'kampf', dangerTiles: 10 }));
    expect(fight.piece).toBe(MOOD_MUSIC.kampf);
    expect(fight.layers.gefahr).toBe(FIGHT_DANGER_MIN);
    expect(at(probe({ mood: 'boss', boss: 'borkenvater' }))).toMatchObject({ piece: 'borkenvater', layers: { gefahr: 1 } });
    // A boss without its own theme fights to the fight music.
    expect(at(probe({ mood: 'boss', boss: 'unbekannt' })).piece).toBe(MOOD_MUSIC.kampf);
    expect(at(probe({ mood: 'gewoelbe' }))).toMatchObject({ piece: 'gruenhain', arrangement: 'nacht', layers: { melodie: 0 } });
    expect(at(probe({ mood: 'stille' })).piece).toBe('');
    // Biomes without their own theme borrow Grünhain's; caves its night without the melody.
    expect(at(probe({ biome: 'nebelmoor' })).piece).toBe('gruenhain');
    expect(at(probe({ biome: 'wurzelhoehlen' }))).toMatchObject({ piece: 'gruenhain', arrangement: 'nacht', layers: { melodie: 0 } });
    for (const id of ['gruenhain', 'salzkueste', 'nebelmoor', 'frostkamm', 'glutsand', 'aschenschlund', 'scherbenhain', 'nachtherz', 'wurzelhoehlen', 'tiefgrund', 'glutadern']) expect(BIOME_MUSIC[id], id).toBeDefined();
  });

  it('Überblendungen dauern 2–4 s; die Gefahrenschicht steigt von 12 bis 4 Kacheln', () => {
    for (const mood of MUSIC_MOODS) {
      expect(FADE_SECONDS[mood]).toBeGreaterThanOrEqual(2);
      expect(FADE_SECONDS[mood]).toBeLessThanOrEqual(4);
    }
    expect(dangerGain(-1)).toBe(0);
    expect(dangerGain(12)).toBe(0);
    expect(dangerGain(8)).toBeCloseTo(0.5);
    expect(dangerGain(4)).toBe(1);
    expect(dangerGain(1)).toBe(1);
    const d = hold(director(), probe({ dangerTiles: 8 }), 0, 0);
    expect(d.layers.gefahr).toBeCloseTo(0.5);
    expect(d.fadeSeconds).toBe(FADE_SECONDS.erkundung);
  });
});

describe('Hysterese', () => {
  it('ein kurzer Ausflug in eine Stimmung schaltet nicht um; erst wer bleibt, bekommt ihre Musik', () => {
    const d = director();
    const out = createMusicDecision();
    hold(d, probe({}), 0, 5, out);
    // A hunter for 0,3 s (below ENTER_SECONDS.kampf): still exploring.
    hold(d, probe({ mood: 'kampf', dangerTiles: 5 }), 5.1, 5.1 + ENTER_SECONDS.kampf - 0.2, out);
    hold(d, probe({}), 5.5, 6, out);
    expect(out.mood).toBe('erkundung');
    // Into the base for 2 s (below 3 s): still exploring; staying 3 s: the base theme.
    hold(d, probe({ mood: 'basis' }), 6.1, 8, out);
    expect(out.mood).toBe('erkundung');
    hold(d, probe({ mood: 'basis' }), 8.1, 9.2, out);
    expect(out.mood).toBe('basis');
    expect(out.piece).toBe(MOOD_MUSIC.basis);
  });

  it('der Kampf hält nach dem letzten Jäger KAMPF_HOLD_SECONDS, dann dauert die Rückkehr ENTER_SECONDS', () => {
    const d = director();
    const out = createMusicDecision();
    hold(d, probe({}), 0, 1, out);
    hold(d, probe({ mood: 'kampf', dangerTiles: 3 }), 1.1, 2, out);
    expect(out.mood).toBe('kampf');
    expect(out.layers.gefahr).toBe(1);
    // The hunter is gone at t = 2: the fight holds until 2 + 6, then exploring must hold 2 s more.
    hold(d, probe({}), 2.1, 2 + KAMPF_HOLD_SECONDS - 0.2, out);
    expect(out.mood).toBe('kampf');
    hold(d, probe({}), 2 + KAMPF_HOLD_SECONDS, 2 + KAMPF_HOLD_SECONDS + ENTER_SECONDS.erkundung - 0.3, out);
    expect(out.mood).toBe('kampf');
    hold(d, probe({}), 2 + KAMPF_HOLD_SECONDS + ENTER_SECONDS.erkundung, 2 + KAMPF_HOLD_SECONDS + ENTER_SECONDS.erkundung + 0.5, out);
    expect(out.mood).toBe('erkundung');
    expect(out.piece).toBe('gruenhain');
    // A boss interrupts at once.
    hold(d, probe({ mood: 'boss', boss: 'borkenvater' }), 20, 20, out);
    expect(out.mood).toBe('boss');
  });
});

describe('Stille Nächte', () => {
  /** When the night music pauses and resumes for `seed` [s from the start], following one night from t = 0. */
  function quiet(seed: number, day: number): { pausedAt: number; resumedAt: number } {
    const d = director(seed);
    const out = createMusicDecision();
    const p = probe({ night: true, day });
    let pausedAt = -1;
    let resumedAt = -1;
    for (let t = 0; t < 400; t += 0.5) {
      d.update(p, t, out);
      if (pausedAt < 0 && out.piece === '') pausedAt = t;
      if (pausedAt >= 0 && resumedAt < 0 && out.piece !== '') resumedAt = t;
    }
    return { pausedAt, resumedAt };
  }

  it('nach einem Durchgang ruht die Musik 60–180 s, gleich für dieselbe Welt und Nacht; am Tag nie', () => {
    const a = quiet(7, 3);
    expect(a.pausedAt).toBeGreaterThanOrEqual(100);
    expect(a.pausedAt).toBeLessThan(101);
    const pause = a.resumedAt - a.pausedAt;
    expect(pause).toBeGreaterThanOrEqual(QUIET_MIN_SECONDS);
    expect(pause).toBeLessThanOrEqual(QUIET_MAX_SECONDS + 0.5);
    expect(quiet(7, 3)).toEqual(a);
    // Other nights and worlds draw other pauses.
    const pauses = new Set([quiet(7, 4), quiet(8, 3), quiet(9, 5), quiet(10, 6)].map((q) => Math.round(q.resumedAt - q.pausedAt)));
    expect(pauses.size).toBeGreaterThan(1);
    // By day, or with danger near, the piece plays on.
    const d = director(7);
    const out = createMusicDecision();
    for (let t = 0; t < 300; t += 0.5) {
      d.update(probe({ day: 3 }), t, out);
      expect(out.piece).toBe('gruenhain');
    }
    // A hunter ends the rest at once.
    const n = director(7);
    const o = createMusicDecision();
    hold(n, probe({ night: true, day: 3 }), 0, 101, o);
    expect(o.piece).toBe('');
    n.update(probe({ night: true, day: 3, dangerTiles: 10 }), 101.1, o);
    expect(o.piece).toBe('gruenhain');
  });
});

describe('Stinger', () => {
  it('Ereignisse → Stinger; die vorhandenen Ereignisse werden abonniert, die anderer Stränge sobald es sie gibt', () => {
    expect(STINGER_EVENTS).toEqual({ placeDiscovered: 'entdeckung', beaconLit: 'leuchtfeuer', bossDefeated: 'boss_besiegt', skillLevelUp: 'stufenaufstieg', worldEventAnnounced: 'ereignis' });
    const ids = new Set(STINGERS.map((s) => s.id));
    for (const id of Object.values(STINGER_EVENTS)) expect(ids.has(id), id).toBe(true);
    expect([...STINGER_PRIORITY].sort()).toEqual([...ids].sort());
    const subscribed = stingerEventTypes(SIM_EVENT_TYPES);
    for (const type of subscribed) expect((SIM_EVENT_TYPES as readonly string[]).includes(type)).toBe(true);
    expect(subscribed).toContain('skillLevelUp');
    expect(stingerEventTypes(['skillLevelUp', 'worldEventAnnounced'])).toEqual(['skillLevelUp', 'worldEventAnnounced']);
  });

  it('einer zur Zeit; der wichtigere wartet, ein veralteter fällt weg', () => {
    const q = new StingerQueue();
    const ready = (): boolean => true;
    expect(q.request('stufenaufstieg', 0)).toBe(true);
    // A more important one takes the waiting place, a less important one does not.
    expect(q.request('boss_besiegt', 0.1)).toBe(true);
    expect(q.request('entdeckung', 0.2)).toBe(false);
    expect(q.request('gibtsnicht', 0.2)).toBe(false);
    expect(q.take(0.3, true, ready)).toBeNull();
    expect(q.take(0.4, false, () => false)).toBeNull();
    expect(q.take(0.5, false, ready)?.id).toBe('boss_besiegt');
    expect(q.pending).toBeNull();
    q.request('entdeckung', 1);
    expect(q.take(1 + STINGER_WAIT_SECONDS + 0.1, false, ready)).toBeNull();
    expect(q.pending).toBeNull();
    q.request('entdeckung', 10);
    q.clear();
    expect(q.take(10.1, false, ready)).toBeNull();
  });
});

describe('Laufzeit', () => {
  it('das Titelthema lädt und spielt seine Stems taktgleich; ein Stinger duckt die Musik; das Lied des Spielers klingt auf dem Effektbus', () => {
    const ctx = new FakeContext();
    const mixer = new AudioMixer(ctx, busGains(defaultSettings().audio));
    const music = new MusicRuntime(ctx, mixer.bus, { createWorker: null, seed: 1, library: testLibrary(false) });
    for (let i = 0; i < 200 && music.player.playing === ''; i++) {
      ctx.currentTime += 1 / 60;
      music.frame(undefined);
    }
    expect(music.player.playing).toBe('titel/standard');
    const deck = ctx.sources.filter((s) => s.buffer !== null && s.startedAt !== null);
    expect(deck).toHaveLength(2);
    expect(deck[0]?.startedAt).toBe(deck[1]?.startedAt);
    // A stinger: its piece was fetched at the start; the music ducks under it.
    for (let i = 0; i < 400 && !STINGERS.every((s) => music.bank.isLoaded(s.stueck, 'standard')); i++) {
      ctx.currentTime += 1 / 60;
      music.frame(undefined);
    }
    const before = ctx.sources.length;
    music.stinger('entdeckung');
    ctx.currentTime += 1 / 60;
    music.frame(undefined);
    expect(ctx.sources.length).toBeGreaterThan(before);
    const duck = ctx.gains.find((g) => g.gain.calls.some((c) => c.kind === 'target' && Math.abs(c.value - 10 ** (-8 / 20)) < 1e-9)) as FakeGain | undefined;
    expect(duck).toBeDefined();
    // The song: on the effects bus, looping.
    const player = new MusicPlayer(ctx, mixer.bus.musik, mixer.bus.effekte);
    const loaded = music.bank.get('titel', 'standard');
    if (loaded === null) throw new Error('not loaded');
    player.setSong({ ...loaded, loops: true }, 'lied');
    const song = ctx.sources.at(-1) as FakeSource;
    expect(song.loop).toBe(true);
    expect((song.outputs[0] as FakeGain).outputs[0]).toBe(mixer.bus.effekte);
    player.setSong(null, '');
    expect(song.stoppedAt).not.toBeNull();
  });

  it('die Sonde liest den Titel, einen lebenden und einen toten Spieler', () => {
    const reader = new MusicProbeReader();
    const p = createMusicProbe();
    expect(reader.read(undefined, p).mood).toBe('titel');
    const w = testWorld(meadow(12, 12));
    w.spawn(5, 5);
    expect(reader.read(w.sim, p).mood).toBe('erkundung');
    expect(p.dangerTiles).toBe(-1);
    expect(p.song).toBe('');
    w.vit().health = 0;
    expect(reader.read(w.sim, p).mood).toBe('stille');
  });
});
