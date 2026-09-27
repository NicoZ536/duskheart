/**
 * Möbellichter und Regen (M4-19, M4-28; MASTERPROMPT §12.2 "Kerzen, Wandlampen … Behaglichkeit", "Öllaterne … wetterfest",
 * §16.4 "Heizquellen (Kamin …)", §10 "Wetterwirkung … Feuer löschen, Fackeln (Regen halbiert die Brenndauer …)"):
 * - die Lichter der Möbel (`MOEBEL_LICHTER`) sind Lichtarten mit Möbeldaten; ihre Flamme sitzt im Sockel `licht` ihres
 *   Sprites; aufgestellt werden sie im Bau-Raster, nicht mit `light.place`;
 * - Lampen: nur ihr eigener Brennstoff, höchstens ihr Vorrat, ein Stück brennt seine Spielstunden; leer bleibt die Lampe
 *   stehen; eine offene Flamme brennt im Regen doppelt so schnell und würfelt im Starkregen, die Laterne hinter Glas
 *   nicht; an der Wand hängt das Licht vor der Wandfläche; abgebaut kommen die ganzen Stücke zurück;
 * - der Kamin: ein Feuer mit eigenem Vorrat (12 min), eigenem Licht und 15 °C Wärme, kein Kochfeuer;
 * - Regen (nicht Niesel) löscht ein Feuer im Freien beim nächsten Welt-Tick, unter einem Dach brennt es weiter, im Regen
 *   zündet keins; eingefroren und aufgeholt wie tickend.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { MOEBEL_LICHTER } from '../../../src/content/items/moebel';
import { MOEBEL_WANDHOEHE_PX } from '../../../src/content/items/moebel_deko';
import { FURNITURE_FLAME_HEIGHT_PX, LIGHT_KINDS, lightKind, lightKindOfItem } from '../../../src/content/lights';
import { SPRITES, type AtlasSprite } from '../../../src/generated/atlas';
import { fireMaxFuelTicks, lampMaxTicks, lampPieceTicks, rainPutsOutFire } from '../../../src/game/light/formulas';
import { copyLightState, type PlacedLight } from '../../../src/game/light/state';
import { CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';
import { lightWorld, type LightWorld } from './licht-testwelt';
import { meadow, OFFSET } from './spieler-testwelt';

const HZ = BALANCE.time.tickHz;
const ATLAS_SPRITES = SPRITES as Readonly<Record<string, AtlasSprite>>;

/** A 24 × 24 meadow with the player on drawn tile (10, 10) and resin, wood and camp fires in the bags. */
function room(): LightWorld {
  const w = lightWorld(meadow(24, 24));
  w.spawn(10, 10);
  w.give('harz', 10);
  w.give('holz', 30);
  w.give('lagerfeuer', 2);
  return w;
}

/** Sets up the furniture light `item` with its anchor on drawn tile (x, y), footprint w × h; returns it. */
function furniture(w: LightWorld, item: string, x: number, y: number, fw = 1, fh = 1): PlacedLight {
  const id = w.light.placeFurniture(w.sim, item, 0, OFFSET + x, OFFSET + y, fw, fh);
  if (id === null) throw new Error(`${item} was not set up`);
  return w.light.placed(id) as PlacedLight;
}

function rejected(w: LightWorld): string[] {
  return ((w.last.get('commandRejected') ?? []) as Array<{ reason: string }>).map((r) => r.reason);
}

function sourceOf(w: LightWorld, id: number): { x: number; y: number; height: number; radius: number; intensity: number } | undefined {
  return w.light.sources(w.sim).find((s) => s.id === id);
}

describe('Möbellichter als Lichtarten (M4-19)', () => {
  it('MOEBEL_LICHTER sind Lichtarten mit ihren Werten; die Flamme sitzt im Sockel licht; kein light.place, nicht getragen', () => {
    expect(MOEBEL_LICHTER.length).toBeGreaterThan(0);
    for (const l of MOEBEL_LICHTER) {
      const kind = lightKind(l.item);
      expect(lightKindOfItem(l.item)).toBe(kind);
      expect(kind.verhalten, l.item).toBe(l.verhalten);
      expect(kind.getragen).toBe(false);
      expect(kind.sprites).toEqual({});
      expect(kind.moebel).toMatchObject({ radius: l.radius, intensitaet: l.intensitaet, flackern: l.flackern, montage: l.montage, wetterfest: l.wetterfest });
      const sprite = ATLAS_SPRITES[l.sprite];
      if (sprite === undefined) throw new Error(l.sprite);
      const heights = (sprite.sockets.licht ?? []).map((p) => sprite.anchor[1] - p[1]);
      const flame = FURNITURE_FLAME_HEIGHT_PX[l.item] as number;
      expect(flame, l.item).toBeGreaterThanOrEqual(Math.min(...heights));
      expect(flame, l.item).toBeLessThanOrEqual(Math.max(...heights));
      expect(kind.moebel?.flammeHoehePx).toBe(flame);
    }
    expect(LIGHT_KINDS.filter((k) => k.moebel === undefined).map((k) => k.id)).toEqual(['fackel', 'lagerfeuer']);
    // §12.2: resin lamps 4 tiles, 6 h a lump, open; lanterns behind glass; the fireplace a fire of 12 min and 15 °C.
    expect(lightKind('harzlampe').moebel).toMatchObject({ radius: 4, brennstoff: 'harz', stundenJeEinheit: 6, vorrat: 4, wetterfest: false });
    expect(lightKind('laterne_stehend').moebel?.wetterfest).toBe(true);
    expect(lightKind('kamin_stein').moebel).toMatchObject({ radius: 6, maxSekunden: 720, waermeC: 15 });
    expect(lampPieceTicks(lightKind('harzlampe'), 3600)).toBe(6 * 3600);
    expect(lampMaxTicks(lightKind('harzlampe'), 3600)).toBe(4 * 6 * 3600);
    expect(fireMaxFuelTicks(lightKind('kamin_stein'))).toBe(720 * HZ);
    expect(fireMaxFuelTicks(lightKind('lagerfeuer'))).toBe(BALANCE.light.campfire.maxFuelSeconds * HZ);
  });

  it('light.place lehnt Möbellichter ab (Baumodus); ein Lagerfeuer nicht auf den eigenen Körper, eine Fackel schon', () => {
    const w = room();
    w.give('harzlampe', 1);
    w.step(1, [{ type: 'light.place', from: w.slotOf('harzlampe'), tx: OFFSET + 12, ty: OFFSET + 10 }]);
    expect(rejected(w)).toEqual(['onGrid']);
    w.step(1, [{ type: 'light.place', from: w.slotOf('lagerfeuer'), tx: OFFSET + 10, ty: OFFSET + 10 }]);
    expect(rejected(w)).toEqual(['standingThere']);
    w.give('fackel', 1);
    w.step(1, [{ type: 'light.place', from: w.slotOf('fackel'), tx: OFFSET + 10, ty: OFFSET + 10 }]);
    expect(rejected(w)).toEqual([]);
  });
});

describe('Lampen', () => {
  it('nur ihr Brennstoff, höchstens vier Stück; brennt ein Stück je 6 Spielstunden; leer bleibt sie stehen', () => {
    const w = room();
    const lamp = furniture(w, 'harzlampe', 11, 10);
    expect(lamp.mount).toBe('stand');
    expect(lamp.torch).toMatchObject({ lit: false, rest: 0 });
    w.step(1, [{ type: 'light.ignite', tx: lamp.tx, ty: lamp.ty }]);
    expect(rejected(w)).toEqual(['noFuel']);
    w.step(1, [{ type: 'light.fuel', light: lamp.id, from: w.slotOf('holz') }]);
    expect(rejected(w)).toEqual(['wrongFuel']);
    w.step(1, [{ type: 'light.fuel', light: lamp.id, from: w.slotOf('harz'), count: 6 }]);
    expect(w.last.get('fireFueled')).toEqual([expect.objectContaining({ light: lamp.id, item: 'harz', count: 4 })]);
    expect(w.inventory.count('harz')).toBe(6);
    const piece = w.light.lampPieceTicks(lightKind('harzlampe'));
    expect(piece).toBe(6 * w.sim.clock.ticksPerGameHour);
    expect(lamp.torch?.rest).toBe(4 * piece);
    w.step(1, [{ type: 'light.fuel', light: lamp.id, from: w.slotOf('harz') }]);
    expect(rejected(w)).toEqual(['lampFull']);
    w.step(1, [{ type: 'light.ignite', tx: lamp.tx, ty: lamp.ty }]);
    expect(w.last.get('lightIgnited')).toHaveLength(1);
    // Its light: 4 tiles, standing on the front row of its tile, the flame in the bowl 16 px up.
    expect(sourceOf(w, lamp.id)).toMatchObject({ x: (lamp.tx + 0.5) * TILE_PX, y: (lamp.ty + 1) * TILE_PX - 1, height: 16, radius: 4 * TILE_PX, intensity: 0.85 });
    // Burning a piece away takes 6 game hours: one hour costs a sixth of it.
    const before = lamp.torch?.rest ?? 0;
    w.step(w.sim.clock.ticksPerGameHour);
    expect(before - (lamp.torch?.rest ?? 0)).toBe(w.sim.clock.ticksPerGameHour);
    // Burned down (caught up in one step): it goes out and stays, empty.
    const chunk = { layer: 0 as const, cx: lamp.tx >> CHUNK_SHIFT, cy: lamp.ty >> CHUNK_SHIFT };
    w.setFrozen(11, 10, true);
    w.light.catchUp(chunk, w.sim.tick, w.sim.tick + 5 * piece);
    w.setFrozen(11, 10, false);
    expect(w.light.placed(lamp.id)?.torch).toMatchObject({ lit: false, rest: 0 });
    expect(w.light.lightAt(0, lamp.tx, lamp.ty)?.id).toBe(lamp.id);
    w.step(1, [{ type: 'light.take', light: lamp.id }]);
    expect(rejected(w)).toEqual(['notTakeable']);
  });

  it('eine offene Flamme brennt im Regen doppelt so schnell und würfelt im Starkregen; die Laterne hinter Glas nicht', () => {
    const w = room();
    const open = furniture(w, 'harzlampe', 11, 10);
    const glass = furniture(w, 'laterne_stehend', 9, 10);
    for (const l of [open, glass]) {
      w.step(1, [{ type: 'light.fuel', light: l.id, from: w.slotOf('harz'), count: 1 }]);
      w.step(1, [{ type: 'light.ignite', tx: l.tx, ty: l.ty }]);
    }
    w.lenv.precipitation = 0.65;
    // The rain is sampled at the world tick; from then on the open flame burns twice as fast.
    while (open.torch?.rain !== 'regen') w.step(1);
    expect(glass.torch?.rain).toBe('trocken');
    const o = open.torch?.rest ?? 0;
    const g = glass.torch?.rest ?? 0;
    w.step(600);
    expect(o - (open.torch?.rest ?? 0)).toBe(1200);
    expect(g - (glass.torch?.rest ?? 0)).toBe(600);
    w.lenv.precipitation = 1;
    w.step(120);
    expect(open.torch?.heavyTicks).toBeGreaterThan(0);
    expect(glass.torch?.heavyTicks).toBe(0);
    expect(glass.torch?.lit).toBe(true);
  });

  it('an der Wand: das Licht hängt vor der Wandfläche in der Höhe der Lampe', () => {
    const w = room();
    const lamp = furniture(w, 'harzlampe_wand', 11, 10);
    expect(lamp.mount).toBe('wand');
    w.step(1, [{ type: 'light.fuel', light: lamp.id, from: w.slotOf('harz'), count: 1 }]);
    w.step(1, [{ type: 'light.ignite', tx: lamp.tx, ty: lamp.ty }]);
    const flame = 1 + (TILE_PX - BALANCE.light.furniture.wallFaceFootPx) + (MOEBEL_WANDHOEHE_PX.harzlampe_wand as number) + (FURNITURE_FLAME_HEIGHT_PX.harzlampe_wand as number);
    expect(sourceOf(w, lamp.id)).toMatchObject({ x: (lamp.tx + 0.5) * TILE_PX, y: lamp.ty * TILE_PX + 1, height: flame, radius: 4 * TILE_PX });
  });

  it('abgebaut: das Licht geht, die ganzen unverbrannten Stücke kommen in die Taschen', () => {
    const w = room();
    const lamp = furniture(w, 'harzlampe', 11, 10);
    w.step(1, [{ type: 'light.fuel', light: lamp.id, from: w.slotOf('harz'), count: 3 }]);
    w.step(1, [{ type: 'light.ignite', tx: lamp.tx, ty: lamp.ty }]);
    w.step(60);
    const harz = w.inventory.count('harz');
    expect(w.light.removeFurniture(w.sim, 0, lamp.tx, lamp.ty)).toBe(true);
    w.step(1);
    expect(w.inventory.count('harz')).toBe(harz + 2);
    expect(w.light.placed(lamp.id)).toBeUndefined();
    expect(w.light.lightAt(0, lamp.tx, lamp.ty)).toBeUndefined();
    expect(w.light.removeFurniture(w.sim, 0, lamp.tx, lamp.ty)).toBe(false);
  });
});

describe('Kamin (§16.4 Heizquelle)', () => {
  it('ein Feuer mit 12 min Vorrat, 6 Kacheln Licht und 15 °C Wärme auf beiden Kacheln; kein Kochfeuer', () => {
    const w = room();
    const kamin = furniture(w, 'kamin_stein', 11, 9, 2, 1);
    expect(kamin.mount).toBe('boden');
    expect(kamin.groesse).toEqual({ b: 2, t: 1 });
    expect(w.light.lightAt(0, kamin.tx + 1, kamin.ty)?.id).toBe(kamin.id);
    w.step(1, [{ type: 'light.fuel', light: kamin.id, from: w.slotOf('holz'), count: 20 }]);
    expect(w.last.get('fireFueled')).toEqual([expect.objectContaining({ count: 16 })]);
    expect(kamin.fire?.fuel).toBe(720 * HZ);
    w.step(1, [{ type: 'light.ignite', tx: kamin.tx, ty: kamin.ty }]);
    expect(kamin.fire?.lit).toBe(true);
    const src = sourceOf(w, kamin.id);
    expect(src).toMatchObject({ x: (kamin.tx + 1) * TILE_PX, y: (kamin.ty + 1) * TILE_PX - 1, height: 7, radius: 6 * TILE_PX, intensity: 1.1 });
    const heat = w.light.heatSources()(w.sim);
    expect(heat).toEqual([expect.objectContaining({ x: (kamin.tx + 1) * TILE_PX, y: (kamin.ty + 1) * TILE_PX - 1, coreHeatC: 15 })]);
    expect(w.light.cookingFireNear(0, (kamin.tx + 1) * TILE_PX, kamin.ty * TILE_PX, 3)).toBe(0);
  });
});

describe('Regen löscht Feuer im Freien (§10, M4-28)', () => {
  it('Regen – nicht Niesel – löscht Flammen und Glut beim nächsten Welt-Tick; unter einem Dach brennt es weiter; im Regen zündet keins', () => {
    expect([0.25, 0.29, 0.3, 0.65].map(rainPutsOutFire)).toEqual([false, false, true, true]);
    const w = room();
    const roofed = new Set<string>([`${OFFSET + 8},${OFFSET + 10}`]);
    w.light.addShelter((_s, _layer, tx, ty) => roofed.has(`${tx},${ty}`));
    const open = w.place('lagerfeuer', 12, 10);
    const inside = w.place('lagerfeuer', 8, 10);
    for (const [id, x] of [
      [open, 12],
      [inside, 8],
    ] as const) {
      w.step(1, [{ type: 'light.fuel', light: id, from: w.slotOf('holz'), count: 3 }]);
      w.step(1, [{ type: 'light.ignite', tx: OFFSET + x, ty: OFFSET + 10 }]);
    }
    w.lenv.precipitation = 0.25;
    w.step(2 * HZ);
    expect(w.light.placed(open)?.fire?.lit).toBe(true);
    w.lenv.precipitation = 0.65;
    const out: Array<{ light: number; reason: string }> = [];
    for (let i = 0; i < HZ + 1; i++) {
      w.step(1);
      out.push(...((w.last.get('lightExtinguished') ?? []) as Array<{ light: number; reason: string }>));
    }
    expect(out).toEqual([expect.objectContaining({ light: open, reason: 'regen' })]);
    const doused = w.light.placed(open)?.fire;
    expect(doused).toMatchObject({ lit: false, embers: 0 });
    expect(doused?.fuel).toBeGreaterThan(0);
    expect(w.light.placed(inside)?.fire?.lit).toBe(true);
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 12, ty: OFFSET + 10 }]);
    expect(rejected(w)).toEqual(['raining']);
    expect(w.light.rainsOnFire(w.sim, w.light.placed(open) as PlacedLight)).toBe(true);
    // Dry again: it lights with the fuel it kept.
    w.lenv.precipitation = 0;
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 12, ty: OFFSET + 10 }]);
    expect(rejected(w)).toEqual([]);
    expect(w.light.placed(open)?.fire?.lit).toBe(true);
  });

  it('Glut erlischt im Regen ohne Flamme (fireCooled); ein Lagerfeuer steht im Weg', () => {
    const w = room();
    const id = w.place('lagerfeuer', 12, 10);
    w.step(1, [{ type: 'light.fuel', light: id, from: w.slotOf('holz'), count: 1 }]);
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 12, ty: OFFSET + 10 }]);
    w.step(45 * HZ + 10);
    expect(w.light.placed(id)?.fire).toMatchObject({ lit: false });
    expect(w.light.placed(id)?.fire?.embers).toBeGreaterThan(0);
    w.lenv.precipitation = 0.7;
    const cooled: unknown[] = [];
    for (let i = 0; i < HZ + 1; i++) {
      w.step(1);
      cooled.push(...(w.last.get('fireCooled') ?? []));
    }
    expect(cooled).toEqual([expect.objectContaining({ light: id })]);
    expect(w.light.placed(id)?.fire?.embers).toBe(0);
    // The camp fire's tile is an object of the collision overlay (the lamp furniture collides as a build part).
    expect(w.light.collisionOverlay().overlayAt(0, OFFSET + 12, OFFSET + 10)).not.toBe(0);
    expect(w.light.collisionOverlay().overlayAt(0, OFFSET + 13, OFFSET + 10)).toBe(0);
  });

  it('Lampen, Kamin und Lagerfeuer im Regenwechsel: eingefroren und aufgeholt exakt wie tickend', () => {
    const run = (frozen: boolean): LightWorld => {
      const w = room();
      const lamp = furniture(w, 'harzlampe', 11, 10);
      const kamin = furniture(w, 'kamin_stein', 11, 11, 2, 1);
      const fire = w.place('lagerfeuer', 9, 11);
      w.step(1, [{ type: 'light.fuel', light: lamp.id, from: w.slotOf('harz'), count: 2 }]);
      w.step(1, [{ type: 'light.ignite', tx: lamp.tx, ty: lamp.ty }]);
      w.step(1, [{ type: 'light.fuel', light: kamin.id, from: w.slotOf('holz'), count: 4 }]);
      w.step(1, [{ type: 'light.ignite', tx: kamin.tx, ty: kamin.ty }]);
      w.step(1, [{ type: 'light.fuel', light: fire, from: w.slotOf('holz'), count: 4 }]);
      w.step(1, [{ type: 'light.ignite', tx: OFFSET + 9, ty: OFFSET + 11 }]);
      if (frozen) w.setFrozen(11, 10, true);
      const schedule: ReadonlyArray<readonly [number, number]> = [
        [500, 0.95],
        [2_000, 0.65],
        [4_130, 0],
      ];
      let si = 0;
      while (w.sim.tick < 6_000) {
        const next = schedule[si];
        if (next !== undefined && w.sim.tick >= next[0]) {
          w.lenv.precipitation = next[1];
          si++;
        }
        w.step(1);
      }
      if (frozen) {
        w.setFrozen(11, 10, false);
        w.light.catchUp({ layer: 0, cx: (OFFSET + 11) >> CHUNK_SHIFT, cy: (OFFSET + 10) >> CHUNK_SHIFT }, 0, w.sim.tick);
      }
      return w;
    };
    const ticking = run(false);
    const frozen = run(true);
    expect(copyLightState(frozen.light.state as never).placed).toEqual(copyLightState(ticking.light.state as never).placed);
    // The rain put both fires out; the open lamp burned in the rain and met heavy-rain minutes.
    const placed = ticking.light.state.placed;
    expect(placed.filter((l) => l.fire !== null).map((l) => l.fire?.lit)).toEqual([false, false]);
    expect(placed.find((l) => l.kind === 'harzlampe')?.torch?.heavyTicks).toBeGreaterThan(0);
  });
});
