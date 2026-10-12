/**
 * M7-92 Titelmusik im Hauptmenü (MASTERPROMPT §27 „Titel“; docs/SPIEL.md §24 Stimmung `titel`, §25 „Hauptmenü mit lebendiger
 * Pixel-Szene“): die Menüwelt hat einen Spieler – den Hüter des Küstenlagers, der Feuer und Fackeln am Leben hält –, deren
 * Welt nach der Erkundungsmusik fragen würde. Die Menüansicht der Sitzung (`menuAudioView`) hält die Stimmung `titel`
 * (`AudioSession.musicMood`): der Musik-Worker rendert zuerst und nur das Titelstück (und die Stinger, die nach dem ersten Stück
 * geholt werden), nie das Stück des Bioms. Eine Sitzung mit fester Stimmung spielt keine Stinger – die Momente ihrer Welt sind
 * Kulisse.
 */
import { describe, expect, it } from 'vitest';
import { attachAudio, type AudioSession } from '../../../src/audio/runtime';
import { AudioMixer, busGains } from '../../../src/audio/mixer';
import { MusicProbeReader } from '../../../src/audio/music/probe';
import { MusicRuntime } from '../../../src/audio/music/musicRuntime';
import { createMusicProbe } from '../../../src/audio/music/types';
import { BIOME_MUSIC, MOOD_MUSIC, STINGERS } from '../../../src/content/music/index';
import { createSettingsStore, defaultSettings } from '../../../src/engine/settings';
import type { SessionFocus } from '../../../src/game/session';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import { menuAudioView } from '../../../src/render/world/menuScene';
import { meadow, testWorld } from '../game/spieler-testwelt';
import { FakeContext } from './fakeAudio';
import { FakeMusicWorker, testLibrary } from './musik-testlied';

/** The events of a test session: handlers by type, `emit` calls them like the session after a tick. */
class EventHub {
  private readonly handlers = new Map<string, Array<(payload: never) => void>>();
  readonly onEvent = <K extends keyof SimEventMap>(type: K, handler: (payload: SimEventMap[K]) => void): (() => void) => {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as (payload: never) => void);
    this.handlers.set(type, list);
    return () => list.splice(list.indexOf(handler as (payload: never) => void), 1);
  };
  emit<K extends keyof SimEventMap>(type: K, payload: SimEventMap[K]): void {
    for (const h of this.handlers.get(type) ?? []) (h as (p: SimEventMap[K]) => void)(payload);
  }
}

/** The game's session as the kernel hears it in a running world (no fixed mood). */
function gameSession(sim: Simulation, hub: EventHub): AudioSession {
  return {
    sim,
    onEvent: hub.onEvent,
    sampleFocus(out: SessionFocus): boolean {
      out.x = 5 * 16;
      out.y = 5 * 16;
      out.layer = 0;
      return true;
    },
  };
}

/** The kernel on `session` with a music worker in the test's hands, unlocked by a key press. */
function attach(session: AudioSession) {
  const ctx = new FakeContext();
  ctx.state = 'suspended';
  const worker = new FakeMusicWorker(testLibrary(false));
  const gestures = new EventTarget();
  const audio = attachAudio({
    session,
    settings: createSettingsStore(null),
    gestureTarget: gestures,
    createContext: () => ctx,
    createWorker: null,
    schedule: () => undefined,
    createMusicWorker: () => worker,
    seed: 5,
  });
  gestures.dispatchEvent(new Event('keydown'));
  const frames = (count: number): void => {
    for (let i = 0; i < count; i++) {
      ctx.currentTime += 1 / 60;
      audio.frame();
      worker.deliver();
    }
  };
  const renders = (): string[] => worker.requests.flatMap((r) => (r.kind === 'render' ? [r.piece] : []));
  /** Whether the music ducked under a discovery stinger (−8 dB). */
  const ducked = (): boolean => ctx.gains.some((g) => g.gain.calls.some((c) => c.kind === 'target' && Math.abs(c.value - 10 ** (-8 / 20)) < 1e-9));
  return { audio, frames, renders, ducked };
}

/** A meadow with a living player – the menu's keeper, or a player exploring. */
function worldWithPlayer(): Simulation {
  const w = testWorld(meadow(12, 12));
  w.spawn(5, 5);
  return w.sim;
}

const DISCOVERY: SimEventMap['placeDiscovered'] = { place: 7, ortstyp: 'schrein', variante: 'a', biome: 'gruenhain', x: 5, y: 5, layer: 0, tick: 1 };

describe('M7-92 Titelmusik im Hauptmenü', () => {
  it('die Menüansicht hält die Stimmung `titel`, obwohl ihre Welt einen lebenden Spieler hat', () => {
    const sim = worldWithPlayer();
    // The world alone asks for the exploration music.
    expect(new MusicProbeReader().read(sim, createMusicProbe()).mood).toBe('erkundung');
    const view = menuAudioView({ sim, onEvent: new EventHub().onEvent }, { campTile: { tx: 5, ty: 5 } });
    expect(view.musicMood).toBe('titel');
    const focus: SessionFocus = { x: 0, y: 0, layer: 0 };
    expect(view.sampleFocus(focus)).toBe(true);
    expect(focus).toEqual({ x: 5.5 * 16, y: 5.5 * 16, layer: 0 });
  });

  it('im Menü rendert der Musik-Worker das Titelstück, nie das Stück des Bioms; im Spiel dieselbe Welt das Biom-Stück', () => {
    const sim = worldWithPlayer();
    const menu = attach(menuAudioView({ sim, onEvent: new EventHub().onEvent }, { campTile: { tx: 5, ty: 5 } }));
    menu.frames(240);
    expect(menu.renders()[0]).toBe(MOOD_MUSIC.titel);
    // After the title: the stingers, nothing else.
    expect(menu.renders().slice(1).sort()).toEqual(STINGERS.map((s) => s.stueck).sort());
    expect(menu.renders()).not.toContain(BIOME_MUSIC.gruenhain?.stueck);

    const game = attach(gameSession(worldWithPlayer(), new EventHub()));
    game.frames(240);
    expect(game.renders()[0]).toBe(BIOME_MUSIC.gruenhain?.stueck);
    expect(game.renders()).not.toContain(MOOD_MUSIC.titel);
  });

  it('eine Sitzung mit fester Stimmung spielt keine Stinger; im Spiel duckt die Entdeckung die Musik', () => {
    const hubMenu = new EventHub();
    const menu = attach(menuAudioView({ sim: worldWithPlayer(), onEvent: hubMenu.onEvent }, { campTile: { tx: 5, ty: 5 } }));
    const hubGame = new EventHub();
    const game = attach(gameSession(worldWithPlayer(), hubGame));
    // Both load their piece and the stingers.
    menu.frames(240);
    game.frames(240);
    hubMenu.emit('placeDiscovered', DISCOVERY);
    hubGame.emit('placeDiscovered', DISCOVERY);
    menu.frames(3);
    game.frames(3);
    expect(game.ducked()).toBe(true);
    expect(menu.ducked()).toBe(false);
  });

  it('die Musik-Laufzeit hält jede feste Stimmung, ohne die Welt zu lesen; ohne sie folgt sie der Welt', () => {
    const ctx = new FakeContext();
    const music = new MusicRuntime(ctx, new AudioMixer(ctx, busGains(defaultSettings().audio)).bus, { createWorker: null, seed: 1, library: testLibrary(false) });
    const sim = worldWithPlayer();
    music.frame(sim, { now: 0 }, 'stille');
    expect(music.probe.mood).toBe('stille');
    music.frame(sim, { now: 0.1 }, 'titel');
    expect(music.probe.mood).toBe('titel');
    music.frame(sim, { now: 0.2 });
    expect(music.probe.mood).toBe('erkundung');
    // With a fixed mood the probe does not read the world (no song, no hunter of the menu's world leaks into the title).
    let reads = 0;
    const watched = new Proxy(sim, {
      get(target, key, receiver) {
        reads++;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    music.frame(watched, { now: 0.3 }, 'titel');
    expect(reads).toBe(0);
    music.frame(watched, { now: 0.4 });
    expect(reads).toBeGreaterThan(0);
  });
});
