/**
 * M5-35: Stationen mit Feuer leuchten – Köhlermeiler, Lehmofen und Schmelzofen sind Lichtquellen der gemeinsamen
 * Liste (§12.1), solange ein Brennstück in ihnen glüht: Radius, Helligkeit, Flackern, Lage des Feuers und Farbe als
 * Daten der Station (src/content/stations.ts), der Lichtpunkt hinter der Mitte ihrer Vorderkante im Körper; die
 * Gameplay-Lichtkarte (Furcht, Spawnregeln) sieht dasselbe Licht wie der Renderer.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { STATIONS, stationSchema } from '../../../src/content/stations';
import { LIGHT_FULL_CIRCLE, lightFalloff } from '../../../src/engine/lightFalloff';
import type { LightEnvironment } from '../../../src/game/light/environment';
import { LightSystem, type ExtraLightSink } from '../../../src/game/light/system';
import { STATION_LIGHT_ID_BASE, stationLightPoint, stationLightProvider } from '../../../src/game/stations/light';
import { TILE_PX } from '../../../src/world/model/coords';
import { stationWorld, TICK_HZ, type StationWorld } from '../game/stationen-testwelt';
import { OFFSET } from '../game/spieler-testwelt';

interface Emitted {
  id: number;
  kind: string;
  farbe: string;
  x: number;
  y: number;
  height: number;
  radius: number;
  intensity: number;
  flicker: number;
  seconds: number;
  window: number;
}

/** What the provider puts into the list this tick. */
function emitted(w: StationWorld, active = true): Emitted[] {
  const out: Emitted[] = [];
  const sink: ExtraLightSink = (id, kind, farbe, _layer, x, y, height, radius, intensity, flicker, seconds, window) => out.push({ id, kind, farbe, x, y, height, radius, intensity, flicker, seconds, window });
  stationLightProvider(w.stations, { active: () => active })(w.sim, sink);
  return out;
}

/** Loads `count` of `item` into `bereich` of station `id` (in reach of the player); returns the refusals. */
function put(w: StationWorld, id: number, item: string, bereich: 'eingang' | 'brennstoff', count: number): string[] {
  return w.refused({ type: 'station.put', station: id, from: w.slotOf(item), bereich, count });
}

/** A charcoal kiln on drawn tile (6, 4), next to the player, loaded with driftwood and fired with `fuel`. */
function firedKiln(fuel = 'holz', pieces = 3): { w: StationWorld; kiln: number } {
  const w = stationWorld();
  const kiln = w.place('koehlermeiler', 6, 4);
  w.give('treibholz', 4);
  w.give(fuel, pieces);
  expect(put(w, kiln, 'treibholz', 'eingang', 4)).toEqual([]);
  expect(put(w, kiln, fuel, 'brennstoff', pieces)).toEqual([]);
  w.run(2);
  return { w, kiln };
}

describe('Licht der Stationen: Daten', () => {
  it('genau die befeuerten Verarbeitungsstationen haben Licht, jede mit Radius, Farbe, Tiefe und Höhe', () => {
    const lit = STATIONS.filter((s) => s.licht !== undefined).map((s) => s.id);
    expect(lit.sort()).toEqual(['koehlermeiler', 'lehmofen', 'schmelzofen']);
    for (const s of STATIONS) if (s.licht !== undefined) expect(s.verarbeitung?.brennstoff, s.id).toBe(true);
    const radius = (id: string): number => STATIONS.find((s) => s.id === id)?.licht?.radiusTiles ?? 0;
    // The kiln smoulders under earth, the furnace burns hottest: the order of their reach.
    expect(radius('koehlermeiler')).toBeLessThan(radius('lehmofen'));
    expect(radius('lehmofen')).toBeLessThan(radius('schmelzofen'));
    // Enclosed fires: none reaches as far or burns as bright as the open camp fire (§12.2 "Lagerfeuer 8").
    for (const s of STATIONS) {
      if (s.licht === undefined) continue;
      expect(s.licht.radiusTiles, s.id).toBeLessThan(BALANCE.light.campfire.radiusTiles);
      expect(s.licht.intensitaet, s.id).toBeLessThanOrEqual(BALANCE.light.campfire.intensity);
      // The fire sits inside the body, in the station's front row of tiles.
      expect(s.licht.tiefePx, s.id).toBeGreaterThan(0);
      expect(s.licht.tiefePx, s.id).toBeLessThan(TILE_PX);
    }
  });

  it('eine Station ohne Brennstoff darf kein Licht haben', () => {
    const drying = STATIONS.find((s) => s.id === 'trockengestell');
    const r = stationSchema.safeParse({ ...drying, licht: { radiusTiles: 3, intensitaet: 1, flackern: 0, tiefePx: 4, hoehePx: 4, farbe: 'feuer.3' } });
    expect(r.success).toBe(false);
  });
});

describe('Licht der Stationen: Lichtanbieter', () => {
  it('ohne glühendes Brennstück kein Licht', () => {
    const w = stationWorld();
    w.place('koehlermeiler', 8, 4);
    w.place('werkbank', 3, 8);
    w.run(2);
    expect(emitted(w)).toEqual([]);
  });

  it('der befeuerte Meiler leuchtet hinter der Mitte seiner Vorderkante, mit den Werten seiner Station', () => {
    const { w, kiln } = firedKiln();
    expect(w.st(kiln).proc?.glut ?? 0).toBeGreaterThan(0);
    const [l, ...rest] = emitted(w);
    expect(rest).toEqual([]);
    const def = STATIONS.find((s) => s.id === 'koehlermeiler')?.licht;
    if (def === undefined || l === undefined) throw new Error('kein Licht');
    const at = { x: 0, y: 0 };
    stationLightPoint(w.st(kiln), w.stations.footprintOf(w.st(kiln)), def.tiefePx, at);
    // 2 × 2 tiles with the north-west corner on (6, 4): the front edge is the last row of tile 5, its middle x = 7; the
    // fire sits `tiefePx` behind it.
    expect(at).toEqual({ x: (OFFSET + 7) * TILE_PX, y: (OFFSET + 6) * TILE_PX - 1 - def.tiefePx });
    expect(l).toEqual({
      id: STATION_LIGHT_ID_BASE + kiln,
      kind: 'koehlermeiler',
      farbe: def.farbe,
      x: at.x,
      y: at.y,
      height: def.hoehePx,
      radius: def.radiusTiles * TILE_PX,
      intensity: def.intensitaet,
      flicker: def.flackern,
      seconds: expect.any(Number) as number,
      window: Math.ceil(def.radiusTiles),
    });
    expect(l.seconds).toBeGreaterThan(0);
  });

  it('ein eingefrorener Chunk leuchtet nicht (er holt ohne Licht auf wie Herdfeuer und Brände)', () => {
    const { w } = firedKiln();
    expect(emitted(w, false)).toEqual([]);
  });

  it('ist das Brennstück verglüht und nichts nachgelegt, erlischt das Licht', () => {
    // A twig smoulders a minute in the kiln (verarbeitung-aufholen.test.ts), then the load waits for fuel.
    const { w, kiln } = firedKiln('zweig', 1);
    expect(emitted(w)).toHaveLength(1);
    w.run(61 * TICK_HZ);
    expect(w.st(kiln).proc?.glut ?? 0).toBe(0);
    expect(emitted(w)).toEqual([]);
  });
});

describe('Licht der Stationen: Gameplay-Lichtkarte (§12.1)', () => {
  it('die Lichtkarte sieht das Licht des befeuerten Meilers: hell an der Vorderkante, dunkel jenseits des Radius', () => {
    const { w } = firedKiln();
    const env: LightEnvironment = { rain: () => 0, ambient: () => 0, active: () => true };
    const light = w.sim.addSystem(new LightSystem(w.sim, { player: w.player, inventory: w.inventory, collision: w.collision, environment: env }));
    light.addLightProviders(stationLightProvider(w.stations, { active: () => true }));
    w.run(1);
    const sources = light.sources(w.sim);
    expect(sources.map((s) => s.kind)).toEqual(['koehlermeiler']);
    const s = sources[0];
    if (s === undefined) throw new Error('keine Quelle');
    expect([s.coneAngle, s.mount]).toEqual([LIGHT_FULL_CIRCLE, 'boden']);
    // A tile in front of the kiln: the canonical falloff of its light on the ground (intensity × falloff).
    const x = s.x;
    const y = s.y + TILE_PX;
    const expected = s.intensity * lightFalloff(Math.hypot(0, TILE_PX, s.height), s.radius);
    expect(light.levelAt(w.sim, 0, x, y)).toBeCloseTo(expected, 6);
    expect(expected).toBeGreaterThan(0.2);
    // Beyond its radius the night stays dark (no ambient in this world).
    expect(light.levelAt(w.sim, 0, x, s.y + s.radius + 2 * TILE_PX)).toBe(0);
  });
});
