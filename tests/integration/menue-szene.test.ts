/**
 * M7-50 Menüszene (src/render/world/menuScene.ts; docs/SPIEL.md §25 „Küstenlager, Zeitraffer von Tag, Wetter und Licht,
 * keine Figur“): auf der festen kleinen Menüwelt steht nach wenigen Ticks das Lager – ein brennendes Lagerfeuer und zwei
 * Fackeln am Pfahl –, der Spieler wartet außer Sicht im Landesinneren, die Welt ist friedlich; über Spielstunden hält
 * der Wächter das Feuer und die Fackeln am Brennen (keine abgewiesenen Befehle durch ein volles Feuer) und wechselt das
 * Wetter. Im Integrationsprojekt: erzeugt die Menüwelt und simuliert Spielstunden (ADR-0192).
 */
import { describe, expect, it } from 'vitest';
import { createSkySample, GameSession } from '../../src/game/session';
import { createWorldSettingsSample } from '../../src/game/samples/weltEinstellungen';
import type { SimEventMap } from '../../src/game/sim';
import { MENU_CAMP, MENU_WORLD, MENU_WEATHER, MenuScene, menuRenderView } from '../../src/render/world/menuScene';

/** World generation and hours of simulation under parallel test load [ms]. */
const TIMEOUT_MS = 240_000;
/** Ticks per frame of the menu (its time-lapse ×4). */
const TICKS_PER_FRAME = 4;
/** Ticks per game hour at the menu's 12-minute day. */
const TICKS_PER_HOUR = (MENU_WORLD.dayLengthMinutes * 60 * 60) / 24;

describe('Menüszene', () => {
  it(
    'baut das Lager, versteckt den Spieler und hält Feuer, Fackeln und Wetter über Stunden am Laufen',
    () => {
      const session = new GameSession({ config: MENU_WORLD });
      const events: Array<{ type: keyof SimEventMap; e: unknown }> = [];
      const track = <K extends keyof SimEventMap>(type: K): void => {
        session.onEvent(type, (e) => events.push({ type, e }));
      };
      for (const t of ['lightPlaced', 'lightRemoved', 'lightExtinguished', 'commandRejected', 'fireFueled'] as const) track(t);
      const scene = new MenuScene(session);
      scene.start(session.sim.world.generated);
      let frames = 0;
      while (!scene.ready && frames < 200) {
        scene.frame();
        session.step();
        frames++;
      }
      expect(scene.ready).toBe(true);
      const placed = events.filter((x) => x.type === 'lightPlaced').map((x) => x.e as SimEventMap['lightPlaced']);
      expect(placed.filter((p) => p.kind === 'lagerfeuer')).toHaveLength(1);
      expect(placed.filter((p) => p.kind === 'fackel')).toHaveLength(MENU_CAMP.torches);
      const fire = placed.find((p) => p.kind === 'lagerfeuer');
      if (fire === undefined) throw new Error('kein Lagerfeuer');
      // The player waits inland, far out of the picture; the world is peaceful.
      const player = session.debugState().player;
      if (player === null) throw new Error('kein Spieler');
      const away = Math.hypot(player.x / 16 - (fire.tx + 0.5), player.y / 16 - (fire.ty + 0.5));
      expect(away).toBeGreaterThan(MENU_CAMP.hideoutTiles - 8);
      const ws = createWorldSettingsSample();
      session.sampleWorldSettings(ws);
      expect(ws.friedlich).toBe(true);
      // The game view sees neither focus nor player: free camera, no figure.
      const view = menuRenderView(session);
      expect(view.sampleFocus({ x: 0, y: 0, layer: 0 })).toBe(false);

      // Six game hours of time-lapse: the keeper sends its commands once per frame of four ticks.
      const weather = new Set<string>();
      const sky = createSkySample();
      const hours = 6;
      for (let t = 0; t < hours * TICKS_PER_HOUR; t += TICKS_PER_FRAME) {
        scene.frame();
        for (let i = 0; i < TICKS_PER_FRAME; i++) session.step();
        if (t % TICKS_PER_HOUR === 0) {
          session.sampleSky(sky, 0, fire.tx, fire.ty);
          if (sky.weather !== null) weather.add(sky.weather);
        }
      }
      const rejected = events.filter((x) => x.type === 'commandRejected').map((x) => x.e as SimEventMap['commandRejected']);
      expect(rejected.filter((r) => r.type === 'light.fuel')).toEqual([]);
      // The fire never went out (no rain in the forced weather) and was fuelled again and again.
      const out = events.filter((x) => x.type === 'lightExtinguished').map((x) => x.e as SimEventMap['lightExtinguished']);
      expect(out.filter((o) => o.light === fire.light)).toEqual([]);
      // One log whenever one has burned (45 s each): the start's fuelling and one per 45 s of the six hours.
      expect(events.filter((x) => x.type === 'fireFueled').length).toBeGreaterThanOrEqual(Math.floor((hours * TICKS_PER_HOUR) / (MENU_CAMP.fuelEverySeconds * 60)));
      // Torches burned down (4 game hours) were set up again: two stand at the end.
      const torches = new Map<number, boolean>();
      for (const x of events) {
        if (x.type === 'lightPlaced' && (x.e as SimEventMap['lightPlaced']).kind === 'fackel') torches.set((x.e as SimEventMap['lightPlaced']).light, true);
        if (x.type === 'lightRemoved' && (x.e as SimEventMap['lightRemoved']).kind === 'fackel') torches.delete((x.e as SimEventMap['lightRemoved']).light);
      }
      expect(torches.size).toBe(MENU_CAMP.torches);
      // Every three game hours the next forced weather: within six hours the first two of the cycle, nothing else.
      expect(weather.size).toBeGreaterThanOrEqual(2);
      for (const w of weather) expect(MENU_WEATHER, w).toContain(w);
      scene.dispose();
    },
    TIMEOUT_MS,
  );
});
