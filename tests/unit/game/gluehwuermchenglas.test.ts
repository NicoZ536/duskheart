/**
 * M7-31 Glühwürmchenglas (MASTERPROMPT §12.2 "Glühwürmchenglas | 3 | 2 Tage | kostenlos, schwach"): a furniture light of
 * behaviour `lampe` – radius 3 tiles, weak (0,45), its fuel the firefly (48 game hours a piece, two at most), behind glass
 * (rain does not shorten it), its light in the jar 6 px above the foot (socket `licht` of `obj_gluehwuermchenglas`); made at
 * the workbench from glass, a twig, fibre rope and three fireflies; a glass build part of the furniture category `licht`.
 * In an unloaded chunk it glows on like every lamp: frozen and caught up equals ticking, and a → b → c equals a → c, the
 * burning out included (docs/SPIEL.md §28).
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { GLAS_LICHT_HOEHE_PX, INSTRUMENTE_LICHTER } from '../../../src/content/items/instrumente';
import { lightKind, lightKindOfItem } from '../../../src/content/lights';
import { SPRITES, type AtlasSprite } from '../../../src/generated/atlas';
import { lampMaxTicks, lampPieceTicks } from '../../../src/game/light/formulas';
import { copyLightState, type PlacedLight } from '../../../src/game/light/state';
import { CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';
import { lightWorld, type LightWorld } from './licht-testwelt';
import { meadow, OFFSET } from './spieler-testwelt';

describe('Glühwürmchenglas', () => {
  it('ist eine Lampe: 3 Kacheln, schwach, Glühwürmchen als Brennstoff zu 48 h, zwei im Glas, wetterfest; Licht im Sockel', () => {
    const kind = lightKind('gluehwuermchenglas');
    expect(lightKindOfItem('gluehwuermchenglas')).toBe(kind);
    expect(kind.verhalten).toBe('lampe');
    expect(kind.getragen).toBe(false);
    expect(kind.moebel).toMatchObject({ radius: 3, intensitaet: 0.45, brennstoff: 'gluehwuermchen', stundenJeEinheit: 48, vorrat: 2, wetterfest: true, flammeHoehePx: GLAS_LICHT_HOEHE_PX });
    // Weaker than the resin lamp and the camp fire's light.
    expect(kind.moebel?.intensitaet ?? 1).toBeLessThan(lightKind('harzlampe').moebel?.intensitaet ?? 0);
    expect(lampPieceTicks(kind, 3600)).toBe(48 * 3600);
    expect(lampMaxTicks(kind, 3600)).toBe(2 * 48 * 3600);
    // The light sits in the jar: the sprite's socket `licht`, GLAS_LICHT_HOEHE_PX above its foot, in every frame.
    const l = INSTRUMENTE_LICHTER[0];
    const sprite = (SPRITES as Readonly<Record<string, AtlasSprite>>)[l?.sprite ?? ''];
    if (sprite === undefined) throw new Error('obj_gluehwuermchenglas fehlt im Atlas');
    for (const p of sprite.sockets.licht ?? []) expect(sprite.anchor[1] - p[1]).toBe(GLAS_LICHT_HOEHE_PX);
    expect(Object.keys(sprite.clips).sort()).toEqual(['aus', 'idle']);
    // Recipe and build part.
    const recipe = CONTENT.collection('recipes').get('rezept_gluehwuermchenglas');
    expect(recipe.station).toBe('werkbank');
    expect(recipe.zutaten).toEqual(expect.arrayContaining([expect.objectContaining({ item: 'gluehwuermchen', anzahl: 3 }), expect.objectContaining({ item: 'glas' })]));
    expect(CONTENT.collection('buildParts').get('gluehwuermchenglas')).toMatchObject({ art: 'moebel', material: 'glas', kategorie: 'licht' });
  });

  it('nimmt nur Glühwürmchen, höchstens zwei; ein Stück glimmt 48 Spielstunden; Regen ändert daran nichts', () => {
    const w = lightWorld(meadow(24, 24));
    w.spawn(10, 10);
    w.give('gluehwuermchen', 5);
    w.give('harz', 2);
    const id = w.light.placeFurniture(w.sim, 'gluehwuermchenglas', 0, OFFSET + 11, OFFSET + 10, 1, 1);
    if (id === null) throw new Error('not set up');
    const jar = w.light.placed(id) as PlacedLight;
    expect(jar.mount).toBe('stand');
    w.step(1, [{ type: 'light.fuel', light: jar.id, from: w.slotOf('harz') }]);
    expect(((w.last.get('commandRejected') ?? []) as Array<{ reason: string }>).map((r) => r.reason)).toEqual(['wrongFuel']);
    w.step(1, [{ type: 'light.fuel', light: jar.id, from: w.slotOf('gluehwuermchen'), count: 5 }]);
    expect(w.last.get('fireFueled')).toEqual([expect.objectContaining({ light: jar.id, item: 'gluehwuermchen', count: 2 })]);
    expect(w.inventory.count('gluehwuermchen')).toBe(3);
    const hour = w.sim.clock.ticksPerGameHour;
    expect(jar.torch?.rest).toBe(2 * 48 * hour);
    w.step(1, [{ type: 'light.ignite', tx: jar.tx, ty: jar.ty }]);
    expect(w.last.get('lightIgnited')).toHaveLength(1);
    const source = w.light.sources(w.sim).find((s) => s.id === jar.id);
    expect(source).toMatchObject({ x: (jar.tx + 0.5) * TILE_PX, radius: 3 * TILE_PX, intensity: 0.45, height: GLAS_LICHT_HOEHE_PX });
    // An hour in the rain costs an hour: the fireflies are behind glass.
    w.lenv.precipitation = 1;
    const before = jar.torch?.rest ?? 0;
    w.step(hour);
    expect(before - (jar.torch?.rest ?? 0)).toBe(hour);
    expect(jar.torch?.lit).toBe(true);
  });

  it('im entladenen Chunk: eingefroren + aufgeholt = tickend; a → b → c = a → c, bis es erlischt', () => {
    /** A jar with one firefly, lit at tick ~3; `frozen` freezes its chunk right after. */
    const setUp = (frozen: boolean): { w: LightWorld; jar: PlacedLight } => {
      const w = lightWorld(meadow(24, 24));
      w.spawn(10, 10);
      w.give('gluehwuermchen', 1);
      const id = w.light.placeFurniture(w.sim, 'gluehwuermchenglas', 0, OFFSET + 11, OFFSET + 10, 1, 1);
      if (id === null) throw new Error('not set up');
      const jar = w.light.placed(id) as PlacedLight;
      w.step(1, [{ type: 'light.fuel', light: jar.id, from: w.slotOf('gluehwuermchen') }]);
      w.step(1, [{ type: 'light.ignite', tx: jar.tx, ty: jar.ty }]);
      if (frozen) w.setFrozen(11, 10, true);
      return { w, jar };
    };
    const chunk = { layer: 0, cx: (OFFSET + 11) >> CHUNK_SHIFT, cy: (OFFSET + 10) >> CHUNK_SHIFT } as const;
    // Ticking with rain coming and going (behind glass it changes nothing) vs frozen and caught up at once.
    const RUN = 1_500;
    const ticking = setUp(false);
    const frozen = setUp(true);
    const from = frozen.w.sim.tick;
    for (const w of [ticking.w, frozen.w]) {
      while (w.sim.tick < from + RUN) {
        w.lenv.precipitation = w.sim.tick % 1_000 < 400 ? 0.9 : 0;
        w.step(1);
      }
    }
    frozen.w.setFrozen(11, 10, false);
    frozen.w.light.catchUp(chunk, from, frozen.w.sim.tick);
    expect(copyLightState(frozen.w.light.state as never).placed).toEqual(copyLightState(ticking.w.light.state as never).placed);
    expect(ticking.jar.torch?.lit).toBe(true);
    // Unloaded across its burning out: in one piece or cut in two, the same – out after 48 game hours exactly.
    const hour = ticking.w.sim.clock.ticksPerGameHour;
    const whole = setUp(true);
    const cut = setUp(true);
    const t0 = whole.w.sim.tick;
    const end = t0 + 50 * hour;
    whole.w.light.catchUp(chunk, t0, end);
    cut.w.light.catchUp(chunk, t0, t0 + 17 * hour + 5);
    cut.w.light.catchUp(chunk, t0 + 17 * hour + 5, end);
    expect(copyLightState(cut.w.light.state as never).placed).toEqual(copyLightState(whole.w.light.state as never).placed);
    expect(whole.jar.torch?.lit).toBe(false);
    expect(whole.jar.torch?.rest).toBe(0);
    const early = setUp(true);
    early.w.light.catchUp(chunk, t0, t0 + 48 * hour - 10);
    expect(early.jar.torch?.lit).toBe(true);
  });
});
