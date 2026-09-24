/**
 * M2-29 console commands `tp`, `time`, `season`, `weather`, `seed`, `overlay` (src/debug/worldCommands.ts):
 * they queue game commands on the running session (validated, applied in the next tick) and read the
 * session to report; texts come from the i18n tables (strict: a missing key throws).
 */
import { describe, expect, it } from 'vitest';
import { GameSession } from '../../../src/game/session';
import { createI18n } from '../../../src/i18n';
import { createDebugConsole } from '../../../src/debug/console';
import { parseTimeArg, registerWorldCommands } from '../../../src/debug/worldCommands';
import type { WorldOverlay } from '../../../src/render/debugOverlay';
import type { Layer } from '../../../src/world/model/coords';

const TILE = 16;

function setup(opts: { spawn?: { x: number; y: number } | null; camera?: { layer: Layer; tx: number; ty: number } | null } = {}) {
  const i18n = createI18n('de', { strict: true });
  const t = (k: string, p?: Readonly<Record<string, string | number>>): string => i18n.t(k, p);
  const con = createDebugConsole({ t });
  const session = new GameSession({ config: { seed: 20260924, worldSize: 'small', dayLengthMinutes: 12 } });
  const overlays: Record<WorldOverlay, boolean> = { chunks: false, kollision: false, temperatur: false };
  const reloads: number[] = [];
  registerWorldCommands(con, {
    t,
    lang: () => i18n.lang,
    session,
    spawn: () => (opts.spawn === undefined ? { x: 100, y: 120 } : opts.spawn),
    cameraTile: () => opts.camera ?? null,
    setOverlay: (name, on) => {
      overlays[name] = on;
    },
    overlayState: () => overlays,
    reloadWithSeed: (seed) => reloads.push(seed),
  });
  const queued = (): string[] => {
    const out: string[] = [];
    session.sim.commands.drainForTick(session.sim.tick, (c) => {
      out.push(c.type);
      session.sim.commands.push(c);
    });
    return out;
  };
  return { con, session, overlays, reloads, queued };
}

describe('Konsole: Weltbefehle', () => {
  it('parses times as HH:MM or +minutes', () => {
    expect(parseTimeArg('18:30')).toEqual({ hour: 18, minute: 30 });
    expect(parseTimeArg('6:05')).toEqual({ hour: 6, minute: 5 });
    expect(parseTimeArg('+90')).toEqual({ minutes: 90 });
    for (const bad of ['24:00', '12:60', '+0', '18', 'mittag', '-5']) expect(parseTimeArg(bad), bad).toBeNull();
  });

  it('tp creates the figure where there is none, moves it and changes its layer through commands', () => {
    const { con, session } = setup();
    expect(con.exec('tp 100 120')).toBe('Figur bei (100, 120) auf Ebene 0 erschaffen.');
    session.step();
    expect(session.debugState().controlled).toEqual({ entity: 0, x: 100 * TILE + TILE / 2, y: 120 * TILE + TILE / 2 });
    expect(con.exec('tp 300 310 -2')).toBe('Teleport nach (300, 310) auf Ebene -2.');
    session.step();
    expect(session.debugState().world.focus).toEqual({ layer: -2, tx: 300, ty: 310 });
    // Without coordinates: the start beach.
    expect(con.exec('tp')).toBe('Teleport nach (100, 120) auf Ebene 0.');
    expect(con.exec('tp 5000 3')).toBe('(5000, 3) liegt außerhalb der Welt (0 … 1023).');
    expect(con.exec('tp 3 3 -4')).toContain('muss zwischen');
    expect(con.exec('teleport 5 5')).toBe('Teleport nach (5, 5) auf Ebene 0.');
  });

  it('tp without coordinates needs the generated world', () => {
    const { con } = setup({ spawn: null });
    expect(con.exec('tp')).toBe('Die Welt entsteht noch – gleich noch einmal versuchen.');
  });

  it('time reports the calendar and jumps forward to a time of day or by minutes', () => {
    const { con, session, queued } = setup();
    expect(con.exec('time')).toBe('Tag 1 · 06:00 · Frühling, Tag 1/7 · Jahr 1 · Mondphase 2/8');
    expect(con.exec('time 18:30')).toBe('Die Zeit springt vorwärts auf 18:30.');
    expect(queued()).toEqual(['setTime']);
    session.step();
    expect(session.debugState().time).toBe('18:30');
    expect(con.exec('time +90')).toBe('Die Zeit springt 90 Spielminuten vorwärts.');
    session.step();
    expect(session.debugState().time).toBe('20:00');
    expect(con.exec('time nachts')).toBe('Erwartet HH:MM oder +Minuten, erhalten: „nachts“.');
  });

  it('season reports and jumps to the next start of a season', () => {
    const { con, session } = setup();
    expect(con.exec('season')).toBe('Frühling, Tag 1/7 · Jahr 1');
    expect(con.exec('season som')).toBe('Die Zeit springt zum Beginn: Sommer.');
    session.step();
    expect(con.exec('season')).toBe('Sommer, Tag 1/7 · Jahr 1');
    expect(con.exec('season frost')).toContain('Ungültiger Wert');
  });

  it(
    'weather reports and forces the weather under the camera, or everywhere; at sea or in caves there is none',
    () => {
      const spot = setup();
      const { spawn } = spot.session.sim.world.generated;
      const here = setup({ camera: { layer: 0, tx: spawn.x, ty: spawn.y } });
      here.session.sim.world.provide(spot.session.sim.world.generated);
      // The page's world host materialises the world when it adopts it; before, `weather` does not build it.
      expect(here.con.exec('weather')).toBe('Hier gibt es kein Wetter (offenes Meer oder Höhle).');
      expect(here.session.sim.world.chunks.residentCount).toBe(0);
      const region = here.session.sim.world.regionAt(spawn.x, spawn.y);
      expect(here.con.exec('weather')).toBe(`Wetter hier: Klar (Region ${region})`);
      expect(here.con.exec('weather gewitter')).toBe(`Wetter in Region ${region}: Gewitter`);
      here.session.step();
      expect(here.session.sim.world.weather.state(region)).toBe('gewitter');
      expect(here.con.exec('weather nebel alle')).toBe('Wetter überall: Nebel');
      here.session.step();
      expect(here.con.exec('weather')).toBe(`Wetter hier: Nebel (Region ${region})`);
      const cave = setup({ camera: { layer: -1, tx: spawn.x, ty: spawn.y } });
      expect(cave.con.exec('weather regen')).toBe('Hier gibt es kein Wetter (offenes Meer oder Höhle).');
      expect(cave.con.exec('weather regen alle')).toBe('Wetter überall: Regen');
    },
    30_000,
  );

  it('seed reports the world and reloads with another seed', () => {
    const { con, reloads } = setup();
    expect(con.exec('seed')).toBe('Seed 20260924 · Weltgröße Klein');
    expect(con.exec('seed 4242')).toBe('Neue Welt aus Seed 4242 wird geladen …');
    expect(reloads).toEqual([4242]);
  });

  it('overlay lists and switches the debug overlays', () => {
    const { con, overlays } = setup();
    expect(con.exec('overlay')).toBe(['Overlay chunks: Aus', 'Overlay kollision: Aus', 'Overlay temperatur: Aus'].join('\n'));
    expect(con.exec('overlay chunks')).toBe('Overlay chunks: An');
    expect(con.exec('overlay temp an')).toBe('Overlay temperatur: An');
    expect(con.exec('overlay chunks aus')).toBe('Overlay chunks: Aus');
    expect(overlays).toEqual({ chunks: false, kollision: false, temperatur: true });
  });

  it('help lists the world commands', () => {
    const { con } = setup();
    const help = con.exec('help');
    for (const usage of ['tp [x] [y] [ebene]', 'time [zeit]', 'season [fruehling|sommer|herbst|winter]', 'weather [zustand] [hier|alle]', 'seed [seed]', 'overlay [chunks|kollision|temperatur] [an|aus]']) expect(help).toContain(usage);
  });
});
