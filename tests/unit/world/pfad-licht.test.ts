/**
 * M6-16b Licht-Abtaster der Pfade (`lightListSampler`): innerhalb der Reichweite eines Lichts fragt er die Lichtkarte
 * nur dort, wo die Obergrenze (Umgebungsschranke + Σ Intensität × Abfall über den Abstand von der Flamme) die Schwelle
 * übersteigt. Geprüft wird an einer echten `GameplayLightMap` mit Mauern (Verdeckung), Lichtern verschiedener Höhe (auch
 * am Boden), Lichtkegeln und Schwellen nahe den Pegeln: die Marken sind genau die der Abfrage je Kachel, nachts wie am
 * Tag (dort fragt er jede Kachel); und eine Fackel auf ihrem Ständer lässt nachts nur einen kleinen Teil ihrer Kacheln
 * fragen.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { Rng } from '../../../src/engine/rng';
import { LIGHT_FULL_CIRCLE } from '../../../src/engine/lightFalloff';
import { BLOCK_SOLID } from '../../../src/world/collision/tiles';
import { GameplayLightMap, type MapLight } from '../../../src/world/lightmap/lightmap';
import { TILE_PX, type Layer } from '../../../src/world/model/coords';
import { lightListSampler, tileLevelSampler, type TileLightLevels } from '../../../src/world/path/light';

/** Kantenlänge des Testfelds [Kacheln]. */
const FIELD = 96;
const NIGHT = BALANCE.calendar.nightAmbientMax;

/** Ein Feld mit Mauerstücken: jede 11. Spalte von Zeile 20 bis 60 und eine Querwand in Zeile 40 (Lücken alle 7 Kacheln). */
function wallAt(tx: number, ty: number): boolean {
  if (tx % 11 === 0 && ty >= 20 && ty <= 60) return true;
  return ty === 40 && tx % 7 !== 0;
}

function lightOf(id: number, tx: number, ty: number, o: { radiusTiles: number; intensity: number; height: number; cone?: number; direction?: number }): MapLight {
  return {
    id,
    layer: 0,
    x: (tx + 0.5) * TILE_PX,
    y: (ty + 0.5) * TILE_PX,
    height: o.height,
    radius: o.radiusTiles * TILE_PX,
    intensity: o.intensity,
    flicker: 0,
    seed: id,
    coneDirection: o.direction ?? 0,
    coneAngle: o.cone ?? LIGHT_FULL_CIRCLE,
    windowTiles: Math.ceil(o.radiusTiles),
  };
}

/** Die Lichtkarte des Felds mit Umgebungslicht `ambient` (je Kachel leicht schwankend, höchstens `ambient`). */
function fieldMap(lights: readonly MapLight[], ambient: number): GameplayLightMap {
  const map = new GameplayLightMap(
    {
      lights: () => lights,
      ambient: (_layer: Layer, tx: number, ty: number) => ambient * (0.6 + 0.4 * (((tx * 5 + ty * 3) % 8) / 7)),
      occluders: { beginQuery: () => undefined, info: (_layer: Layer, tx: number, ty: number) => (wallAt(tx, ty) ? BLOCK_SOLID : 0) },
    },
    BALANCE.light.map.movingCacheEntries,
  );
  map.setStamp(1);
  return map;
}

/** Zählt die Abfragen an `levels`. */
function counted(levels: TileLightLevels): { levels: TileLightLevels; count: () => number } {
  let n = 0;
  return {
    levels: {
      tileLevel(layer, tx, ty) {
        n++;
        return levels.tileLevel(layer, tx, ty);
      },
    },
    count: () => n,
  };
}

describe('Licht-Abtaster mit Obergrenze (M6-16b)', () => {
  it('markiert genau die Kacheln der Abfrage je Kachel – Mauern, Höhen, Kegel, Schwellen nahe den Pegeln', () => {
    const rng = new Rng(16);
    for (let round = 0; round < 24; round++) {
      const lights: MapLight[] = [];
      const count = 1 + rng.int(0, 7);
      for (let i = 0; i < count; i++) {
        const cone = rng.next() < 0.25 ? rng.float(0.6, 2.5) : undefined;
        lights.push(
          lightOf(i + 1, rng.int(0, FIELD), rng.int(0, FIELD), {
            radiusTiles: rng.float(2, 14),
            intensity: rng.float(0.2, 1.4),
            // Auch eine Flamme am Boden (Höhe 0): dort sind Obergrenze und Karte gleich weit vom Licht.
            height: [0, 10, 14, 19][rng.int(0, 4)] as number,
            cone,
            direction: rng.float(0, Math.PI * 2),
          }),
        );
      }
      const day = round % 6 === 5;
      const ambient = day ? 1 : NIGHT;
      const map = fieldMap(lights, ambient);
      const fast = lightListSampler({ lights: () => lights, levels: () => map, ambientBound: () => ambient });
      const slow = tileLevelSampler(() => map);
      const w = 30 + rng.int(0, 60);
      const h = 30 + rng.int(0, 60);
      const tx0 = rng.int(-10, FIELD - w + 10);
      const ty0 = rng.int(-10, FIELD - h + 10);
      // Schwellen: Schattenbrut, Nachtmahr (gleißend), eine niedrige, und der Pegel einer hellen Kachel selbst.
      const probe = lights[0] as MapLight;
      const atLight = map.tileLevel(0, Math.floor(probe.x / TILE_PX) + 1, Math.floor(probe.y / TILE_PX));
      const threshold = [BALANCE.creatures.shadowBrood.avoidLightAbove, 0.9, 0.2, atLight][round % 4] as number;
      const a = new Uint8Array(w * h).fill(7);
      const b = new Uint8Array(w * h).fill(9);
      fast.markBright(0, tx0, ty0, w, h, threshold, a);
      slow.markBright(0, tx0, ty0, w, h, threshold, b);
      expect(Array.from(a), `Runde ${round}`).toEqual(Array.from(b));
    }
  });

  it('eine Fackel auf ihrem Ständer lässt nachts nur einen kleinen Teil ihrer Reichweite fragen', () => {
    const T = BALANCE.light.torch;
    const torch = lightOf(1, 70, 80, { radiusTiles: T.radiusTiles, intensity: T.intensity, height: T.flameHeightPx.stand });
    const map = fieldMap([torch], NIGHT);
    const asked = counted(map);
    const sampler = lightListSampler({ lights: () => [torch], levels: () => asked.levels, ambientBound: () => NIGHT });
    const out = new Uint8Array(FIELD * FIELD);
    sampler.markBright(0, 0, 0, FIELD, FIELD, BALANCE.creatures.shadowBrood.avoidLightAbove, out);
    const reach = (2 * T.radiusTiles + 1) ** 2;
    const bright = out.reduce((n, v) => n + v, 0);
    expect(bright).toBeGreaterThan(0);
    // Gefragt wird mindestens jede helle Kachel, aber weniger als ein Viertel der 13 × 13 Kacheln der Reichweite.
    expect(asked.count()).toBeGreaterThanOrEqual(bright);
    expect(asked.count()).toBeLessThan(reach / 4);
  });
});
