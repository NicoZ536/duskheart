/**
 * M4-26 (MASTERPROMPT §16.6 "Overlays: Räume/Typen, Temperatur, Licht, Behaglichkeit, Stützen", §16.3 "Der
 * Baumodus zeigt die Stützreichweite als Overlay", §16.4 "Raumtypen … im Baumodus angezeigt"): the build overlays
 * read the simulation and fill the frame's overlay list with unlit fields and labels – rooms in their type's colour
 * with name and size, a closed room without roof in the warning colour, room temperatures, comfort, the light map's
 * stage per tile, and every roof tile's distance to its support with a mark on every support.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { DebugOverlayList, type DebugOverlayEntry } from '../../../src/render/debugOverlay';
import { BUILD_OVERLAYS, BuildOverlays, comfortStep, COMFORT_REFS, createBuildOverlayFrame, isBuildOverlay, ROOM_COLORS, ROOM_TEMPERATURE_STEPS, roomTemperatureStep, supportKey, type BuildOverlay } from '../../../src/render/game/overlays';
import type { Simulation } from '../../../src/game/sim';
import type { SimWorld } from '../../../src/game/world';
import { LIGHT_STAGES } from '../../../src/world/lightmap/stages';
import { bauWelt, hut, type BauWelt } from '../game/bau-testwelt';
import { lightWorld } from '../game/licht-testwelt';
import { meadow, OFFSET } from '../game/spieler-testwelt';

const T = 16;

function entries(list: DebugOverlayList): DebugOverlayEntry[] {
  const out: DebugOverlayEntry[] = [];
  for (let i = 0; i < list.count; i++) out.push({ ...(list.entry(i) as DebugOverlayEntry) });
  return out;
}

/** Tile of an entry relative to the map. */
function tileOf(e: DebugOverlayEntry): string {
  return `${Math.floor(e.x / T) - OFFSET},${Math.floor(e.y / T) - OFFSET}`;
}

/** Overlay `kind` over the drawn tiles (x0, y0)–(x1, y1); labels are translated to `key|n`. */
function overlay(sim: Simulation, kind: BuildOverlay, x0: number, y0: number, x1: number, y1: number, view = new BuildOverlays()): { list: DebugOverlayList; view: BuildOverlays } {
  const f = createBuildOverlayFrame();
  f.left = (OFFSET + x0) * T;
  f.top = (OFFSET + y0) * T;
  f.right = (OFFSET + x1 + 1) * T;
  f.bottom = (OFFSET + y1 + 1) * T;
  f.t = (key, p) => (p?.['n'] === undefined ? key : `${key}|${p['n']}`);
  const list = new DebugOverlayList();
  view.fill(list, sim, kind, f);
  return { list, view };
}

/** A hut with the inner tiles (9, 9)–(11, 11) – roofed unless `roof` is null – and the player outside. */
function huette(roof: string | null = 'dach_stroh'): BauWelt {
  const w = bauWelt(meadow(24, 24));
  w.spawn(10, 14);
  hut(w, 9, 9, 11, 11, 'wand_holz', 'tuer_holz', roof);
  w.act();
  return w;
}

describe('Hilfsfunktionen der Overlays', () => {
  it('die fünf Overlays von §16.6 (ohne Stromnetz bis M11), jedes mit Namen auf Deutsch und Englisch', () => {
    expect(BUILD_OVERLAYS).toEqual(['raeume', 'temperatur', 'licht', 'behaglichkeit', 'stuetzen']);
    expect(isBuildOverlay('stuetzen')).toBe(true);
    expect(isBuildOverlay('kollision')).toBe(false);
  });

  it('Behaglichkeit 0–20 in fünf Stufen; Stützabstand nah, halb, am Rand der Reichweite, frei', () => {
    const max = BALANCE.rooms.comfort.max;
    expect(comfortStep(0, max)).toBe(0);
    expect(comfortStep(-3, max)).toBe(0);
    expect(comfortStep(max, max)).toBe(COMFORT_REFS.length - 1);
    expect(comfortStep(max * 2, max)).toBe(COMFORT_REFS.length - 1);
    expect(comfortStep(max / 2, max)).toBe(2);
    expect(supportKey(-1, 3)).toBe('frei');
    expect(supportKey(0, 3)).toBe('nah');
    expect(supportKey(1, 3)).toBe('nah');
    expect(supportKey(2, 3)).toBe('mittel');
    expect(supportKey(3, 3)).toBe('weit');
    expect(supportKey(0, 0)).toBe('weit');
  });

  it('Temperatur in Stufen, die ein Spieler liest: Frost, kalt, kühl, angenehm im Behaglichkeitsband (§11.2), warm, heiß', () => {
    const { comfortLowC, comfortHighC } = BALANCE.survival.temperature;
    expect(ROOM_TEMPERATURE_STEPS.map((st) => st.id)).toEqual(['frost', 'kalt', 'kuehl', 'angenehm', 'warm', 'heiss']);
    const step = (c: number): string => ROOM_TEMPERATURE_STEPS[roomTemperatureStep(c)]?.id ?? '';
    expect(step(-12)).toBe('frost');
    expect(step(0)).toBe('kalt');
    expect(step(comfortLowC - 0.5)).toBe('kuehl');
    expect(step(comfortLowC)).toBe('angenehm');
    expect(step(comfortHighC - 0.5)).toBe('angenehm');
    expect(step(comfortHighC)).toBe('warm');
    expect(step(60)).toBe('heiss');
    // The edges rise from cold to hot.
    for (let i = 1; i < ROOM_TEMPERATURE_STEPS.length; i++) expect((ROOM_TEMPERATURE_STEPS[i] as { bisC: number }).bisC).toBeGreaterThan((ROOM_TEMPERATURE_STEPS[i - 1] as { bisC: number }).bisC);
  });
});

describe('Overlays auf dem Bauraster (M4-26)', () => {
  it('Räume: der Innenraum in seiner Farbe, mit Namen und Größe; draußen nichts', () => {
    const w = huette();
    const { list, view } = overlay(w.sim, 'raeume', 4, 4, 16, 16);
    const e = entries(list);
    const rects = e.filter((x) => x.kind === 'rect');
    expect(new Set(rects.map(tileOf))).toEqual(new Set(['9,9', '10,9', '11,9', '9,10', '10,10', '11,10', '9,11', '10,11', '11,11']));
    expect(new Set(rects.map((r) => r.color)).size).toBe(1);
    expect(rects[0]?.color).not.toBe(ROOM_COLORS.roofless);
    const labels = e.filter((x) => x.kind === 'label').map((x) => x.text);
    expect(labels[0] === 'ui.bau.overlay.raum.innenraum' || !labels[0]?.startsWith('ui.')).toBe(true);
    expect(labels).toContain('ui.bau.overlay.raum.groesse|9');
    expect(view.stats).toEqual({ tiles: 9, rooms: 1, labels: 2 });
    // Label at the room's top left tile.
    const first = e.find((x) => x.kind === 'label') as DebugOverlayEntry;
    expect(tileOf(first)).toBe('9,9');
  });

  it('Beschriftungen stehen über allen Feldern: Räume, Temperatur und Behaglichkeit legen jede Beschriftung nach dem letzten Feld in die Liste (M4-Gate: „Bedroom“ halb überdeckt)', () => {
    const w = huette();
    w.sim.attachWorld({ temperature: { temperatureAt: () => 3 } } as unknown as SimWorld);
    for (const kind of ['raeume', 'temperatur', 'behaglichkeit'] as const) {
      const e = entries(overlay(w.sim, kind, 4, 4, 16, 16).list);
      const lastRect = e.map((x) => x.kind).lastIndexOf('rect');
      const firstLabel = e.findIndex((x) => x.kind === 'label');
      expect(firstLabel, kind).toBeGreaterThan(lastRect);
    }
  });

  it('Räume: ein geschlossener Raum ohne Dach in der Warnfarbe mit „Kein Dach"', () => {
    const w = huette(null);
    const { list } = overlay(w.sim, 'raeume', 4, 4, 16, 16);
    const e = entries(list);
    const rects = e.filter((x) => x.kind === 'rect');
    expect(rects).toHaveLength(9);
    for (const r of rects) expect(r.color).toBe(ROOM_COLORS.roofless);
    expect(e.filter((x) => x.kind === 'label').map((x) => x.text)).toContain('ui.bau.overlay.raum.ohneDach');
  });

  it('Temperatur: Räume im Band ihrer Raumtemperatur mit dem Wert, die Luft draußen blasser', () => {
    const w = huette();
    // The open air reads the world's temperature field (a game simulation always has one): 3 °C outside.
    w.sim.attachWorld({ temperature: { temperatureAt: () => 3 } } as unknown as SimWorld);
    const { list, view } = overlay(w.sim, 'temperatur', 4, 4, 16, 16);
    const e = entries(list);
    const inside = e.filter((x) => x.kind === 'rect' && tileOf(x) === '10,10')[0] as DebugOverlayEntry;
    const outside = e.filter((x) => x.kind === 'rect' && tileOf(x) === '4,4')[0] as DebugOverlayEntry;
    expect(inside).toBeDefined();
    expect(outside).toBeDefined();
    expect(outside.color & 0xff).toBeLessThan(inside.color & 0xff);
    // Every visible tile gets a field (13 × 13), the room one label, the air one every eight tiles.
    expect(view.stats.tiles).toBe(13 * 13);
    expect(outside.color).not.toBe(inside.color);
    expect(e.some((x) => x.kind === 'label' && x.text === '3°' && tileOf(x) === '8,8')).toBe(true);
    expect(e.some((x) => x.kind === 'label' && /°$/.test(x.text) && tileOf(x) === '9,9')).toBe(true);
  });

  it('Behaglichkeit: nur Innenräume, in der Farbe ihrer Stufe mit dem Wert', () => {
    const w = huette();
    const { list, view } = overlay(w.sim, 'behaglichkeit', 4, 4, 16, 16);
    const e = entries(list);
    expect(e.filter((x) => x.kind === 'rect')).toHaveLength(9);
    const comfort = w.roomAt(10, 10)?.comfort.total ?? -1;
    expect(e.filter((x) => x.kind === 'label').map((x) => x.text)).toEqual([`ui.bau.overlay.behaglichkeit.wert|${Math.round(comfort)}`]);
    expect(view.stats.rooms).toBe(1);
    const open = huette(null);
    const none = overlay(open.sim, 'behaglichkeit', 4, 4, 16, 16);
    expect(none.list.count).toBe(0);
  });

  it('Stützen: jedes Dachtile mit seinem Abstand zur nächsten Stütze in der Mitte, jede Wand, Tür und Säule markiert', () => {
    const w = huette();
    const { list } = overlay(w.sim, 'stuetzen', 4, 4, 16, 16);
    const e = entries(list);
    const full = e.filter((x) => x.kind === 'rect' && x.width === T);
    const marks = e.filter((x) => x.kind === 'rect' && x.width < T);
    expect(full).toHaveLength(25);
    expect(marks).toHaveLength(16);
    const labels = e.filter((x) => x.kind === 'label');
    const dist = new Map(labels.map((x) => [tileOf(x), x.text]));
    // Right on its support the mark alone; the 3 × 3 roof tiles over the room carry their distance.
    expect(dist.has('8,8')).toBe(false);
    expect(labels).toHaveLength(9);
    expect(dist.get('9,9')).toBe('1');
    expect(dist.get('10,10')).toBe('2');
    // The digit stands in the middle of its tile.
    const two = labels.find((x) => x.text === '2') as DebugOverlayEntry;
    expect(two.x % T).toBeGreaterThan(2);
    expect(two.y % T).toBeGreaterThan(2);
    // Close (green) over the walls, farther in the middle: two colours at least.
    expect(new Set(full.map((r) => r.color)).size).toBeGreaterThan(1);
  });

  it('Licht: jede Kachel in der Stufe der Lichtkarte – dunkel fern der Fackel, heller an ihr', () => {
    const lw = lightWorld(meadow(24, 24));
    lw.spawn(10, 10);
    lw.give('fackel', 1);
    lw.place('fackel', 12, 12);
    lw.step(1);
    const { list, view } = overlay(lw.sim, 'licht', 4, 4, 20, 20);
    const e = entries(list);
    expect(view.stats.tiles).toBe(17 * 17);
    const at = (tile: string): number => (e.find((x) => tileOf(x) === tile) as DebugOverlayEntry).color;
    expect(at('12,12')).not.toBe(at('4,20'));
    expect(LIGHT_STAGES[0]).toBe('dunkel');
  });

  it('ohne passendes System zeichnet ein Overlay nichts', () => {
    const lw = lightWorld(meadow(8, 8));
    expect(overlay(lw.sim, 'raeume', 0, 0, 7, 7).list.count).toBe(0);
    expect(overlay(lw.sim, 'stuetzen', 0, 0, 7, 7).list.count).toBe(0);
    const w = huette();
    expect(overlay(w.sim, 'licht', 0, 0, 7, 7).list.count).toBe(0);
  });
});
