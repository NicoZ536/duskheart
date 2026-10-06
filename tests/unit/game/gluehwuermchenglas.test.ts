/**
 * M7-31 Glühwürmchenglas (MASTERPROMPT §12.2 "Glühwürmchenglas | 3 | 2 Tage | kostenlos, schwach"): a furniture light of
 * behaviour `lampe` – radius 3 tiles, weak (0,45), its fuel the firefly (48 game hours a piece, two at most), behind glass
 * (rain does not shorten it), its light in the jar 6 px above the foot (socket `licht` of `obj_gluehwuermchenglas`); made at
 * the workbench from glass, a twig, fibre rope and three fireflies; a glass build part of the furniture category `licht`.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { GLAS_LICHT_HOEHE_PX, INSTRUMENTE_LICHTER } from '../../../src/content/items/instrumente';
import { lightKind, lightKindOfItem } from '../../../src/content/lights';
import { SPRITES, type AtlasSprite } from '../../../src/generated/atlas';
import { lampMaxTicks, lampPieceTicks } from '../../../src/game/light/formulas';
import type { PlacedLight } from '../../../src/game/light/state';
import { TILE_PX } from '../../../src/world/model/coords';
import { lightWorld } from './licht-testwelt';
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
});
