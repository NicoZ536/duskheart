/**
 * M6-16f Lichtkarte über Lichtspalten: die Karte kopiert die Lichter je Stempel in Spalten (Typed Arrays) und wertet die
 * kanonischen Formeln Anweisung für Anweisung an Ort und Stelle aus, statt `steadyLightLevel` je Licht und Kachel
 * aufzurufen. Geprüft wird die Bitgleichheit mit dem kanonischen Modell:
 * - Kachelpegel (`tileLevel`, `tileSourceLevel`, `brighter`) = Umgebung + Σ `steadyLightLevel` am Kachelmittelpunkt in
 *   Listenreihenfolge, für Punktlichter und Kegel jeder Öffnung, Höhen, Radien, Intensitäten, Ebenen;
 * - Punktabfragen (`levelAt`, `sourceLevelAt`) = Umgebung bilinear + Σ `steadyLightLevel` am Punkt;
 * - mehr Lichter als die Spalten anfangs fassen (sie wachsen), weniger im nächsten Stempel (die alten zählen nicht mehr);
 *   Lichter mit Radius oder Intensität 0 zählen nicht.
 */
import { describe, expect, it } from 'vitest';
import { LIGHT_FULL_CIRCLE } from '../../../src/engine/lightFalloff';
import { Rng } from '../../../src/engine/rng';
import { GameplayLightMap, steadyLightLevel, type MapLight } from '../../../src/world/lightmap/lightmap';
import { TILE_PX, type Layer } from '../../../src/world/model/coords';

const AMBIENT = 0.07;

/** A random light of `layer` around tile (40, 40): every third a cone, every fifth on the ground. */
function randomLight(rng: Rng, id: number, layer: Layer): MapLight {
  const radius = rng.float(1.5, 9) * TILE_PX;
  const cone = id % 3 === 0;
  return {
    id,
    layer,
    windowTiles: Math.ceil(radius / TILE_PX) + 1,
    x: rng.float(20, 60) * TILE_PX,
    y: rng.float(20, 60) * TILE_PX,
    height: id % 5 === 0 ? 0 : rng.float(2, 30),
    radius,
    intensity: rng.float(0.2, 1.4),
    flicker: 0.2,
    seed: id,
    coneDirection: rng.float(-Math.PI, Math.PI),
    coneAngle: cone ? rng.float(0.2, 5) : LIGHT_FULL_CIRCLE,
  };
}

/** A map over `lights` without walls (every tile in a light's window sees it) and a constant ambient. */
function openMap(lights: readonly MapLight[]): GameplayLightMap {
  const map = new GameplayLightMap(
    {
      lights: () => lights,
      ambient: (_layer, _tx, _ty, out, i) => {
        out[i] = AMBIENT;
        return undefined;
      },
      occluders: { beginQuery: () => undefined, info: () => 0 },
    },
    4,
  );
  map.setStamp(1);
  return map;
}

/** The canonical sum of the lights of `layer` at world px (x, y), in list order. */
function canonical(lights: readonly MapLight[], layer: Layer, x: number, y: number): number {
  let sum = 0;
  for (const l of lights) {
    if (l.layer !== layer || !(l.radius > 0) || !(l.intensity > 0)) continue;
    const level = steadyLightLevel(l, x, y);
    if (level === 0) continue;
    sum += level * 1;
  }
  return sum;
}

describe('Lichtkarte über Lichtspalten (M6-16f)', () => {
  it('Kachelpegel bitgleich mit Umgebung + Σ steadyLightLevel – Punktlichter, Kegel, Ebenen', () => {
    const rng = new Rng(61);
    // Every tile of every round; the tiles that differ are collected and checked in one expect (M6-93).
    const abweichend: string[] = [];
    for (let round = 0; round < 6; round++) {
      const lights = Array.from({ length: 3 + rng.int(0, 30) }, (_, i) => randomLight(rng, i + 1, i % 4 === 3 ? -1 : 0));
      const map = openMap(lights);
      for (const layer of [0, -1] as const) {
        for (let ty = 18; ty < 62; ty += 1) {
          for (let tx = 18; tx < 62; tx += 3) {
            const cx = (tx + 0.5) * TILE_PX;
            const cy = (ty + 0.5) * TILE_PX;
            let sources = 0;
            for (const l of lights) if (l.layer === layer) sources += steadyLightLevel(l, cx, cy);
            if (!Object.is(map.tileSourceLevel(layer, tx, ty), sources)) abweichend.push(`${round}:${layer}:${tx}:${ty} tileSourceLevel`);
            if (!Object.is(map.tileLevel(layer, tx, ty), AMBIENT + sources)) abweichend.push(`${round}:${layer}:${tx}:${ty} tileLevel`);
            if (map.brighter(layer, tx, ty, AMBIENT + sources) !== false) abweichend.push(`${round}:${layer}:${tx}:${ty} brighter(Pegel)`);
            if (map.brighter(layer, tx, ty, AMBIENT + sources - 1e-9) !== true) abweichend.push(`${round}:${layer}:${tx}:${ty} brighter(Pegel − 1e-9)`);
          }
        }
      }
    }
    expect(abweichend).toEqual([]);
  });

  it('Punktabfragen bitgleich mit der Umgebung und Σ steadyLightLevel am Punkt', () => {
    const rng = new Rng(62);
    const lights = Array.from({ length: 24 }, (_, i) => randomLight(rng, i + 1, 0));
    const map = openMap(lights);
    const abweichend: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const x = rng.float(18, 62) * TILE_PX;
      const y = rng.float(18, 62) * TILE_PX;
      const sources = canonical(lights, 0, x, y);
      if (!Object.is(map.sourceLevelAt(0, x, y), sources)) abweichend.push(`${x}:${y} sourceLevelAt`);
      if (!Object.is(map.levelAt(0, x, y), AMBIENT + sources)) abweichend.push(`${x}:${y} levelAt`);
    }
    expect(abweichend).toEqual([]);
  });

  it('die Spalten wachsen mit mehr Lichtern und vergessen die eines früheren Stempels; Radius oder Intensität 0 zählen nicht', () => {
    const rng = new Rng(63);
    const many = Array.from({ length: 70 }, (_, i) => randomLight(rng, i + 1, 0));
    const list: MapLight[] = [...many, { ...randomLight(rng, 900, 0), radius: 0 }, { ...randomLight(rng, 901, 0), intensity: 0 }];
    const map = openMap(list);
    const probe = (): number[] => Array.from({ length: 40 }, (_, k) => map.tileSourceLevel(0, 20 + k, 40));
    const expected = (ls: readonly MapLight[]): number[] =>
      Array.from({ length: 40 }, (_, k) => {
        let s = 0;
        for (const l of ls) if (l.radius > 0 && l.intensity > 0) s += steadyLightLevel(l, (20 + k + 0.5) * TILE_PX, 40.5 * TILE_PX);
        return s;
      });
    expect(probe()).toEqual(expected(list));
    // The next stamp holds only five of them: the others are gone from the columns.
    list.length = 5;
    map.setStamp(2);
    expect(probe()).toEqual(expected(list));
    list.length = 0;
    map.setStamp(3);
    expect(probe()).toEqual(new Array<number>(40).fill(0));
  });
});
