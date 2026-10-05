/**
 * Kreaturen im Wasser, die gehende Möwe, die Finstermond-Brut (M6-Gate; src/render/game/creatures.ts):
 * - visual:water-creatures-not-immersed (MASTERPROMPT §6 Pass 7, §31.5; docs/RENDER.md Wasser): wer im Wasser steht, kommt in
 *   die Eintauchmaske des Wassers – ein Schwimmer bis zu seiner Wasserlinie (der Anteil `wasserlinie` seiner Art, sonst
 *   `IMMERSION.creatureSwimShare` seiner Zeichnung: die Qualle schwimmt hoch, Schirm und Fäden über der Linie – M7-65, im
 *   M6-Gate vorgezogen), ein Landtier im Flachen knöcheltief (`IMMERSION.wadeDepthPx`); der Spieler hat Vorrang, dann die
 *   Nächsten zur Bildmitte;
 * - spec20:moewe-walk-land-clips-unused (docs/ART.md §15.3 `gehen` 4@8, `landen` 4@10): am Boden geht die Möwe, in der Luft
 *   (schnell, fliehend, über Wasser) fliegt sie, nach dem Flug spielt sie einmal `landen`;
 * - spec20:finstermond-marking-untracked (ADR-0135 „sichtbare Kennzeichnung“): die Brut einer Finstermondnacht pulst in ihrem
 *   Glühen über dem Hellsten einer gewöhnlichen Brut – sichtbar auch im Dunkeln, wo nur das Glühen bleibt – und trägt die
 *   Palettenzeile `brut_finster` (M7-66, im M6-Gate vorgezogen: `schattenbrut-finstermond`): kräftiger violetter Saum und
 *   Schimmer, glühend rote Augen statt der weißen – erkennbar auch im Standbild, wo der Puls steht.
 */
import { describe, expect, it } from 'vitest';
import { hexToOklch } from '../../../assets-src/lib/color';
import { RAMPS, flatPalette, rampStart } from '../../../assets-src/palette';
import { CONTENT } from '../../../src/content/index';
import { creatureSchema } from '../../../src/content/creatures/schema';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import { BALANCE } from '../../../src/content/balance';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { createCreatureFrame, creatureWaterline, CreatureSprites, FINSTER_GLOW, FINSTER_ROW, finsterGlow, wetKind, type CreatureFrame } from '../../../src/render/game/creatures';
import type { RenderScene } from '../../../src/render/scene';
import { IMMERSION, MAX_IMMERSIONS } from '../../../src/render/water/params';
import { WaterState } from '../../../src/render/water/state';
import { WATER_DEPTH_MASK } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT } from '../../../src/world/model/coords';

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const TILE = 16;
/** Water depth classes of `CreatureFrame.waterAt`. */
const SHALLOW = 1;

interface Pushed {
  readonly sprite: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly glow: number;
  readonly tint: number;
  readonly row: number;
}

function drawn(view: CreatureSprites, sim: Simulation, frame: CreatureFrame, sprite: string): Pushed[] {
  const owner = new Map<unknown, { id: string; index: number }>();
  for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f, index) => owner.set(f, { id: s.id, index }));
  const pushed: Pushed[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        const o = owner.get(d.frame);
        pushed.push({ sprite: o?.id ?? '?', frame: o?.index ?? -1, x: d.x, y: d.y, glow: d.emissiveBoost, tint: d.tintStrength, row: d.paletteRow });
        return pushed.length - 1;
      },
    },
  } as unknown as RenderScene;
  view.draw(scene, ATLAS, sim, frame);
  return pushed.filter((p) => p.sprite === sprite);
}

function frameAround(over: Partial<CreatureFrame> = {}): CreatureFrame {
  return Object.assign(createCreatureFrame(), { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9, alpha: 1, time: 0 }, over);
}

/** The nearest tile with water around tile (tx, ty) of the surface. */
function waterTileNear(sim: Simulation, tx: number, ty: number): { tx: number; ty: number } {
  for (let r = 0; r < 64; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx;
        const y = ty + dy;
        const chunk = sim.world.chunks.get(0, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
        if (chunk !== undefined && ((chunk.water[((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK)] as number) & WATER_DEPTH_MASK) !== 0) return { tx: x, ty: y };
      }
    }
  }
  throw new Error(`kein Wasser um ${tx},${ty}`);
}

/** A world with a player and `count` creatures `id` 3 tiles east of it – or, `inWater`, on the nearest water (the newest entries of the store). */
function world(id: string, count = 1, inWater = false): { sim: Simulation; creatures: CreatureSystem; first: number } {
  const sim = createSimulation({ seed: 20260930, worldSize: 'small' });
  sim.step([{ type: 'player.spawn' } as never]);
  sim.step([{ type: 'debug.god', on: true } as never]);
  const pos = sim.ecs.component('position') as unknown as { get(e: number, c: 'x' | 'y'): number };
  const creatures = sim.system('creatures') as CreatureSystem;
  const before = creatures.store.size;
  let x = pos.get(sim.player, 'x') + 3 * TILE;
  let y = pos.get(sim.player, 'y');
  if (inWater) {
    const t = waterTileNear(sim, Math.floor(x / TILE), Math.floor(y / TILE));
    x = (t.tx + 0.5) * TILE;
    y = (t.ty + 0.5) * TILE;
  }
  sim.step([{ type: 'creature.spawn', creature: id, count, x, y, layer: 0 } as never]);
  expect(creatures.store.size - before).toBe(count);
  for (let i = before; i < creatures.store.size; i++) expect(creatures.store.valueAt(i).creature).toBe(id);
  return { sim, creatures, first: before };
}

/** Where creature `index` stands [world px]. */
function placeOf(creatures: CreatureSystem, index: number): { x: number; y: number } {
  const at = { x: 0, y: 0 };
  creatures.positionOf(creatures.store.entityAt(index), at);
  return at;
}

/** The drawing of the creature standing at `at` in `list`. */
function at(list: readonly Pushed[], where: { x: number; y: number }): Pushed | undefined {
  return list.find((p) => Math.abs(p.x - where.x) < 1e-6 && Math.abs(p.y - where.y) < 1e-6);
}

/** `CreatureFrame.waterAt` with shallow water only under the creatures at `places` (the view's tile of their feet). */
function waterUnder(...places: { x: number; y: number }[]): (tx: number, ty: number) => number {
  const tiles = new Set(places.map((p) => `${Math.floor(p.x) >> 4},${Math.floor(p.y - 1) >> 4}`));
  return (tx, ty) => (tiles.has(`${tx},${ty}`) ? SHALLOW : 0);
}

/** Frame indices of clip `clip` of `sprite`. */
function framesOf(sprite: string, clip: string): Set<number> {
  const c = MANIFEST.sprites[sprite]?.clips[clip];
  if (c === undefined) throw new Error(`${sprite}: kein Clip ${clip}`);
  return new Set(c.frames);
}

/** A creature standing still facing right, in no action. */
function standStill(creatures: CreatureSystem, index: number): void {
  const s = creatures.store.valueAt(index);
  s.vx = 0;
  s.vy = 0;
  s.facing = 0;
  s.hurtTick = -1;
  s.attackPhase = 'keine';
  s.attack = -1;
  s.flyUntilTick = -1;
  s.state = 'ruhen';
}

describe('Kreaturen im Wasser: Eintauchmaske nach der Fortbewegung', () => {
  it('Fortbewegung → Lage im Wasser: Schwimmer und Amphibie schwimmen, Landtiere waten, Flieger nie; trocken nichts', () => {
    expect([wetKind('schwimmer', 1), wetKind('amphibie', 2), wetKind('land', 1), wetKind('flieger', 1), wetKind('land', 0)]).toEqual([1, 1, 2, 0, 0]);
    expect(creatureWaterline(1, 20)).toBe(Math.round(20 * IMMERSION.creatureSwimShare));
    expect(creatureWaterline(1, 20, 0.15)).toBe(3);
    expect(creatureWaterline(2, 20)).toBe(IMMERSION.wadeDepthPx);
    expect(creatureWaterline(2, 20, 0.15)).toBe(IMMERSION.wadeDepthPx);
  });

  it('die Wasserlinie je Art: die Qualle schwimmt hoch (eigener Anteil), Robbe und Frosch behalten den gemeinsamen', () => {
    const creatures = CONTENT.collection('creatures');
    const qualle = creatures.get('qualle').wasserlinie;
    expect(qualle).toBeDefined();
    expect(qualle as number).toBeLessThan(IMMERSION.creatureSwimShare / 2);
    for (const id of ['robbe', 'frosch']) expect(creatures.get(id).wasserlinie, id).toBeUndefined();
    // Only swimmers name one (the schema refuses it on land creatures and fliers), a share strictly between 0 and 1.
    for (const c of creatures.values()) if (c.wasserlinie !== undefined) expect(['schwimmer', 'amphibie'], c.id).toContain(c.fortbewegung);
    const issues = (record: object): string[] => {
      const r = creatureSchema.safeParse(record);
      return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
    };
    expect(issues(creatures.get('qualle'))).toEqual([]);
    expect(issues({ ...creatures.get('robbe'), wasserlinie: 0.3 })).toEqual([]);
    expect(issues({ ...creatures.get('wolf'), wasserlinie: 0.3 })).toEqual(['wasserlinie']);
    expect(issues({ ...creatures.get('moewe'), wasserlinie: 0.3 })).toEqual(['wasserlinie']);
    for (const share of [0, 1, -0.2, 1.5]) expect(issues({ ...creatures.get('qualle'), wasserlinie: share }), String(share)).toEqual(['wasserlinie']);
  });

  it('die Qualle im Flachen: bis zu ihrer Wasserlinie unter Wasser (nicht auf der Oberfläche, nicht ganz gespiegelt)', () => {
    const { sim, creatures, first } = world('qualle', 1, true);
    standStill(creatures, first);
    const place = placeOf(creatures, first);
    const view = new CreatureSprites();
    const body = at(drawn(view, sim, frameAround({ waterAt: waterUnder(place) }), 'kreatur_qualle'), place);
    expect(body).toBeDefined();
    const water = new WaterState();
    view.immerse(water);
    const m = water.immersions;
    expect(m.count).toBe(1);
    const ref = MANIFEST.sprites.kreatur_qualle?.frames[body?.frame ?? -1];
    expect(ref).toBeDefined();
    expect(m.x[0]).toBe(Math.floor(place.x + 0.5));
    expect(m.y[0]).toBe(Math.floor(place.y + 0.5));
    expect(m.top[0]).toBe(ref?.ay);
    expect(m.line[0]).toBe(Math.round((ref?.ay ?? 0) * (CONTENT.collection('creatures').get('qualle').wasserlinie ?? 0)));
    expect(m.line[0]).toBeGreaterThan(IMMERSION.wadeDepthPx);
    expect(m.line[0]).toBeLessThan(Math.round((ref?.ay ?? 0) * IMMERSION.creatureSwimShare));
    expect(m.halfWidth[0]).toBe(Math.max(ref?.ax ?? 0, (ref?.w ?? 0) - (ref?.ax ?? 0)));
    // No body frame of its own (the player's swimming body): the water covers the part under the line, the mirror
    // takes only what stands above it (water_surface.frag `figureAt`, `objectReflection`).
    expect(m.frameW[0]).toBe(0);
    expect(view.stats.immersed).toBe(1);
    // Dry, it is not in the mask; the list is consumed by `immerse`.
    drawn(view, sim, frameAround({ waterAt: () => 0 }), 'kreatur_qualle');
    const dry = new WaterState();
    view.immerse(dry);
    expect(dry.immersions.count).toBe(0);
  });

  it('der Wolf im Flachen watet knöcheltief; die Möwe über dem Wasser fliegt und taucht nicht ein', () => {
    const wolf = world('wolf');
    standStill(wolf.creatures, wolf.first);
    const view = new CreatureSprites();
    drawn(view, wolf.sim, frameAround({ waterAt: waterUnder(placeOf(wolf.creatures, wolf.first)) }), 'kreatur_wolf');
    const water = new WaterState();
    view.immerse(water);
    expect(water.immersions.count).toBe(1);
    expect(water.immersions.line[0]).toBe(IMMERSION.wadeDepthPx);
    const gull = world('moewe');
    standStill(gull.creatures, gull.first);
    const gullView = new CreatureSprites();
    drawn(gullView, gull.sim, frameAround({ waterAt: waterUnder(placeOf(gull.creatures, gull.first)) }), 'kreatur_moewe');
    const sea = new WaterState();
    gullView.immerse(sea);
    expect(sea.immersions.count).toBe(0);
  });

  it('der Spieler zuerst, dann die Nächsten zur Bildmitte, solange die Maske Platz hat', () => {
    const { sim, creatures, first } = world('wolf', 3);
    const places = [0, 1, 2].map((k) => {
      standStill(creatures, first + k);
      return placeOf(creatures, first + k);
    });
    const centre = places[1] as { x: number; y: number };
    const view = new CreatureSprites();
    // The view centred on the second wolf.
    drawn(view, sim, frameAround({ left: centre.x - 100, right: centre.x + 100, top: centre.y - 60, bottom: centre.y + 60, waterAt: waterUnder(...places) }), 'kreatur_wolf');
    const water = new WaterState();
    // The player and others already in the mask: one place left.
    for (let i = 0; i < MAX_IMMERSIONS - 1; i++) water.immersions.push(-500 - i, -500, 6, 20, 4);
    view.immerse(water);
    expect(water.immersions.count).toBe(MAX_IMMERSIONS);
    expect(water.immersions.x[0]).toBe(-500);
    const last = MAX_IMMERSIONS - 1;
    expect([water.immersions.x[last], water.immersions.y[last]]).toEqual([Math.floor(centre.x + 0.5), Math.floor(centre.y + 0.5)]);
    // Full: nobody else gets in, nobody is pushed out.
    drawn(view, sim, frameAround({ waterAt: waterUnder(...places) }), 'kreatur_wolf');
    view.immerse(water);
    expect(water.immersions.count).toBe(MAX_IMMERSIONS);
    expect(water.immersions.x[0]).toBe(-500);
  });
});

describe('die Möwe geht, fliegt und landet (ART.md §15.3)', () => {
  it('am Boden `gehen`, schnell/fliehend/über Wasser `move` (Flug), danach einmal `landen`, dann `idle`', () => {
    const { sim, creatures, first } = world('moewe');
    const kind = creatures.catalog.find('moewe');
    expect(kind).toBeDefined();
    const walkPx = kind?.walkPx ?? 0;
    const runPx = kind?.runPx ?? 0;
    const s = creatures.store.valueAt(first);
    const view = new CreatureSprites();
    const frameOf = (over: Partial<CreatureFrame> = {}): number => at(drawn(view, sim, frameAround({ alpha: 1, time: 0, ...over }), 'kreatur_moewe'), placeOf(creatures, first))?.frame ?? -1;
    const clip = (name: string): Set<number> => framesOf('kreatur_moewe', `${name}_right`);
    // Walking on the ground.
    standStill(creatures, first);
    s.vx = walkPx;
    expect(clip('gehen').has(frameOf())).toBe(true);
    // Standing.
    s.vx = 0;
    expect(clip('idle').has(frameOf())).toBe(true);
    // Fast: in the air.
    s.vx = runPx;
    expect(clip('move').has(frameOf())).toBe(true);
    // Touch-down: the landing's first frames from the tick it touched down.
    s.vx = 0;
    const landing = frameOf();
    expect([...clip('landen')].filter((f) => !clip('idle').has(f))).toContain(landing);
    // After the landing (its clip is 4 frames at 10 fps): standing again.
    for (let k = 0; k < 20; k++) sim.step([]);
    standStill(creatures, first);
    expect(clip('idle').has(frameOf())).toBe(true);
    // Fleeing at a walk, or over water standing still: in the air.
    s.state = 'fliehen';
    s.vx = walkPx;
    expect(clip('move').has(frameOf())).toBe(true);
    standStill(creatures, first);
    expect(clip('move').has(frameOf({ waterAt: waterUnder(placeOf(creatures, first)) }))).toBe(true);
  });
});

describe('Finstermond-Brut: sichtbar gekennzeichnet (ADR-0135)', () => {
  it('ihr Glühen pulst zwischen `FINSTER_GLOW.low` und `high`, über dem einer gewöhnlichen Brut – am Tag und in der Nacht', () => {
    const { sim, creatures, first } = world('schleicher', 2);
    for (let i = first; i < first + 2; i++) {
      standStill(creatures, i);
      creatures.store.valueAt(i).bornTick = -1_000_000;
    }
    const marked = creatures.store.valueAt(first);
    marked.finster = true;
    const view = new CreatureSprites();
    const glows: number[] = [];
    let plain = 0;
    for (const time of [0, 0.2, 0.4, 0.6]) {
      for (const ambient of [0.02, 1]) {
        const list = drawn(view, sim, frameAround({ time, ambient }), 'kreatur_schleicher');
        const mine = at(list, placeOf(creatures, first));
        const other = at(list, placeOf(creatures, first + 1));
        expect(other).toBeDefined();
        expect(mine?.glow).toBeCloseTo(finsterGlow(time, marked.serial), 12);
        glows.push(mine?.glow ?? 0);
        plain = Math.max(plain, other?.glow ?? 0);
      }
    }
    expect(Math.min(...glows)).toBeGreaterThanOrEqual(FINSTER_GLOW.low - 1e-9);
    expect(Math.max(...glows)).toBeLessThanOrEqual(FINSTER_GLOW.high + 1e-9);
    // It throbs (not one value) and stays above the brightest glow of an ordinary brood.
    expect(Math.max(...glows) - Math.min(...glows)).toBeGreaterThan(0.05);
    expect(Math.min(...glows)).toBeGreaterThan(plain);
    expect(view.stats.finster).toBe(1);
  });

  it('sie trägt die Palettenzeile `brut_finster` (M7-66): auch im Standbild gekennzeichnet, eine gewöhnliche Brut nicht', () => {
    const { sim, creatures, first } = world('schleicher', 2);
    for (let i = first; i < first + 2; i++) {
      standStill(creatures, i);
      creatures.store.valueAt(i).bornTick = -1_000_000;
    }
    creatures.store.valueAt(first).finster = true;
    const row = MANIFEST.paletteRows.findIndex((r) => r.name === FINSTER_ROW);
    expect(row).toBeGreaterThan(0);
    const view = new CreatureSprites();
    for (const ambient of [0.02, 1]) {
      const list = drawn(view, sim, frameAround({ ambient }), 'kreatur_schleicher');
      expect(at(list, placeOf(creatures, first))?.row).toBe(row);
      expect(at(list, placeOf(creatures, first + 1))?.row).not.toBe(row);
    }
  });

  it('die Zeile `brut_finster`: Saum und Schimmer kräftiger violett, Augen und Kern der Glut glutrot statt weiß bzw. violett; der Leib bleibt', () => {
    const map = MANIFEST.paletteRows.find((r) => r.name === FINSTER_ROW)?.map;
    if (map === undefined) throw new Error('Zeile brut_finster fehlt');
    const hex = flatPalette();
    /** The colour palette index `ramp.step` (1-based) shows in the row, and the one it shows unchanged. */
    const shown = (ramp: string, step: number): { L: number; C: number; h: number } => hexToOklch(hex[(map[rampStart(ramp) - 1 + step] as number) - 1] as string);
    const own = (ramp: string, step: number): { L: number; C: number; h: number } => hexToOklch(hex[rampStart(ramp) - 1 + step] as string);
    const violet = (c: { h: number; C: number }): boolean => c.h > 290 && c.h < 335 && c.C > 0.09;
    const red = (c: { h: number; C: number }): boolean => (c.h < 60 || c.h > 345) && c.C > 0.1;
    // The rim (`verderb.2`) and the shimmer on the body (`verderb.1`): brighter, still violet; the glow sack's outside
    // (`verderb.3*`) at least as bright.
    for (const step of [1, 2]) {
      expect(shown('verderb', step).L, `verderb.${step}`).toBeGreaterThan(own('verderb', step).L);
      expect(violet(shown('verderb', step)), `verderb.${step}`).toBe(true);
    }
    expect(shown('verderb', 3).L).toBeGreaterThanOrEqual(own('verderb', 3).L);
    expect(violet(shown('verderb', 3))).toBe(true);
    // The eyes – white (`eis.4*`: Schleicher, Speier, Lichtfresser, Nachtmahr) and violet (`verderb.4*`: Kriecher) – and the
    // glow sack's core (`verderb.4*`) turn into one red heat of the Finstermond.
    expect(red(shown('eis', 4))).toBe(true);
    expect(red(shown('verderb', 4))).toBe(true);
    expect(map[rampStart('eis') - 1 + 4]).toBe(map[rampStart('verderb') - 1 + 4]);
    expect(red(own('eis', 4)) || red(own('verderb', 4))).toBe(false);
    // The body (`nacht`) keeps its colours.
    const night = RAMPS.find((r) => r.name === 'nacht');
    for (let i = 0; i < (night?.colors.length ?? 0); i++) expect(map[rampStart('nacht') - 1 + i]).toBe(rampStart('nacht') + i);
  });

  it('der Debug-Spawn `finster` bringt Brut wie eine Finstermondnacht (stärker, gekennzeichnet) – nur Schattenbrut', () => {
    const { sim, creatures, first } = world('schleicher', 1);
    const plain = creatures.store.valueAt(first);
    const before = creatures.store.size;
    const pos = sim.ecs.component('position') as unknown as { get(e: number, c: 'x' | 'y'): number };
    const x = pos.get(sim.player, 'x');
    const y = pos.get(sim.player, 'y') + 3 * TILE;
    sim.step([
      { type: 'creature.spawn', creature: 'schleicher', count: 1, x, y, layer: 0, finster: true } as never,
      { type: 'creature.spawn', creature: 'hase', count: 1, x, y: y + 2 * TILE, layer: 0, finster: true } as never,
    ]);
    expect(creatures.store.size - before).toBe(2);
    const marked = creatures.store.valueAt(before);
    const hare = creatures.store.valueAt(before + 1);
    expect([marked.creature, marked.finster, plain.finster]).toEqual(['schleicher', true, false]);
    expect(marked.health).toBeCloseTo(plain.health * BALANCE.spawn.shadowBrood.finstermond.leben, 9);
    expect([hare.creature, hare.finster]).toEqual(['hase', false]);
    const view = new CreatureSprites();
    drawn(view, sim, frameAround({ ambient: 0.02 }), 'kreatur_schleicher');
    expect(view.stats.finster).toBe(1);
  });
});
