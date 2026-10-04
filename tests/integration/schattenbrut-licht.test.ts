/**
 * Schattenbrut meidet Licht (M6-28, MASTERPROMPT §12.4 „Meidet Licht > 0,5“; docs/SPIEL.md §11 „Schattenbrut-Licht“):
 * sechs Schleicher jagen nachts einen Spieler, der im Schein zweier Lichter steht – in 1000 Ticks betritt keiner eine
 * Kachel heller als 0,5, obwohl sie bis an den Rand des Lichts kommen (Pfade mit Lichtsperre, Schritte ins Licht
 * abgewiesen, auch beim Zurückstoßen).
 *
 * M6-37: auch in der Spielwelt (`createSimulation`, tests/integration/kampf-welt.ts) mit der echten Lichtkarte, einer
 * brennenden Fackel in der Hand und einem Lagerfeuer daneben, nachts, gegen die ganze Grundfamilie des Contents (Schleicher,
 * Kriecher, Speier, Lichtfresser) und was der Nachtspawner dazu bringt: in 1000 Ticks steht keine Schattenbrut auf einer
 * Kachel heller als ihre Schwelle (0,5; der Lichtfresser nur gleißendes Licht über 0,9, §12.4 „Ausnahmen“), und sie kommen
 * bis an den Rand des Lichts.
 *
 * M6-Gate (§12.4 „Spawnt … nachts oder im Untergrund“, §20.1 „Schattenbrut (überall nachts und im Untergrund)“): in der
 * Spielwelt unter der Oberfläche – Wurzelhöhlen (−1), Tiefgrund (−2), Glutadern (−3) – bringt der Nachtspawner die
 * Grundfamilie auch mittags (die Höhlenbiome haben ihre Spawntabellen, src/content/creatures/untergrund.ts), auf dunklen
 * Kacheln 16–40 Kacheln vom Spieler, in der Variante des Bioms; unter Tage schläft die Brut zu keiner Stunde.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/content/balance';
import { CONTENT } from '../../src/content/index';
import { worldCreatureEnvironment } from '../../src/game/creatures/environment';
import type { WorldCollision } from '../../src/game/player/collision';
import type { SimEventMap } from '../../src/game/sim';
import { BLOCK_ALL } from '../../src/world/collision/tiles';
import { CHUNK_SHIFT, TILE_PX, type Layer } from '../../src/world/model/coords';
import { kreaturWelt, meadow, tileOf } from '../unit/game/kreatur-testwelt';
import { centreOf, kampfWelt, tileAt, type KampfWelt, type Tile } from './kampf-welt';

/** §12.4 (MASTERPROMPT Z. 439): shadow brood avoids light above 0,5 – the literal of the spec, not the balance mirror (M6-66). */
const LIMIT = 0.5;
const SB = BALANCE.spawn.shadowBrood;
const BROOD = ['schleicher', 'kriecher', 'speier', 'lichtfresser'];

/**
 * Takes the player down to `layer` (the zone loads its chunks) and onto the nearest open ground there (3 × 3 tiles free, a
 * biome under them); returns the tile and its biome.
 */
function hinab(w: KampfWelt, layer: Layer): { tile: Tile; biome: string } {
  const env = worldCreatureEnvironment();
  const p = w.pos();
  const t = tileAt(p);
  w.ok('hinab', [{ type: 'player.teleport', x: p.x, y: p.y, layer }], 30);
  const grid = (w.sim.system('world-collision') as unknown as WorldCollision).grid;
  const open = (x: number, y: number): boolean => w.sim.world.chunks.get(layer, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT) !== undefined && (grid.tileInfo(layer, x, y) & BLOCK_ALL) === 0 && env.biome(w.sim, layer, x, y) !== null;
  for (let r = 0; r < 80; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tile = { tx: t.tx + dx, ty: t.ty + dy };
        let free = true;
        for (let y = -1; y <= 1 && free; y++) for (let x = -1; x <= 1 && free; x++) free = open(tile.tx + x, tile.ty + y);
        if (!free) continue;
        w.ok('auf freien Grund', [{ type: 'player.teleport', ...centreOf(tile), layer }], 30);
        return { tile, biome: env.biome(w.sim, layer, tile.tx, tile.ty) as string };
      }
    }
  }
  throw new Error(`kein freier Grund auf Ebene ${layer}`);
}

describe('Schattenbrut im Licht (M6-28)', () => {
  it('in 1000 Ticks betritt keine Schattenbrut Licht über 0,5', () => {
    const w = kreaturWelt(meadow(60, 50), { x: 30, y: 25 });
    w.cheats.god = true;
    w.cenv.phase = 'nacht';
    w.light.ambient = 0.05;
    const p = w.pos();
    // Eine Fackel am Spieler (heller als 0,5, nicht gleißend) und ein Lagerfeuer daneben.
    w.light.discs.push({ x: p.x, y: p.y, radius: 5, level: 0.6 }, { x: p.x + 7 * TILE_PX, y: p.y, radius: 4, level: 0.7 });
    const brood = [
      [30, 12],
      [18, 25],
      [42, 25],
      [30, 38],
      [20, 15],
      [40, 36],
    ].map(([x, y]) => w.creature('probe_schleicher', x as number, y as number));
    let nearest = Infinity;
    for (let t = 0; t < 1000; t++) {
      w.run(1);
      for (const e of brood) {
        if (!w.creatures.store.has(e)) continue;
        const at = w.where(e);
        const { tx, ty } = tileOf(at);
        expect(w.light.tileLevel(null, 0, tx, ty), `Tick ${w.sim.tick}`).toBeLessThanOrEqual(LIMIT);
        nearest = Math.min(nearest, Math.hypot(at.x - p.x, at.y - p.y) / TILE_PX);
      }
    }
    expect(brood.every((e) => w.creatures.store.has(e))).toBe(true);
    // They came to the edge of the torch light (radius 5), they did not keep away.
    expect(nearest).toBeLessThan(6.5);
  });
  it('M6-37: in der Spielwelt betritt keine Schattenbrut des Contents in 1000 Ticks Licht über ihrer Schwelle – Fackel und Lagerfeuer', () => {
    const w = kampfWelt({ hour: 22, god: true });
    w.goTo(w.openSpot(w.tile(), 3));
    // A burning torch in the off hand, a camp fire with logs beside the player.
    w.ok('Licht', [
      { type: 'inventory.give', item: 'fackel', count: 1 },
      { type: 'inventory.give', item: 'lagerfeuer', count: 1 },
      { type: 'inventory.give', item: 'holz', count: 4 },
    ]);
    const bag = (item: string): { bereich: 'schnellleiste' | 'inventar'; index: number } => {
      for (const bereich of ['schnellleiste', 'inventar'] as const) {
        const index = w.inventory.state[bereich].findIndex((x) => x?.item === item);
        if (index >= 0) return { bereich, index };
      }
      throw new Error(`${item} fehlt`);
    };
    w.ok('Fackel in die Nebenhand', [{ type: 'inventory.move', from: bag('fackel'), to: { bereich: 'ausruestung', index: 5 }, count: 1 }]);
    w.ok('Fackel an', [{ type: 'light.toggle' }]);
    const me = w.tile();
    const fire = { tx: me.tx + 2, ty: me.ty };
    w.ok('Lagerfeuer in die Hand', [{ type: 'inventory.move', from: bag('lagerfeuer'), to: { bereich: 'schnellleiste', index: 1 } }]);
    w.ok('wählen', [{ type: 'player.selectHotbar', index: 1 }]);
    const placed = w
      .ok('aufstellen', [{ type: 'player.aim', ...centreOf(fire) }, { type: 'player.useItem' }])
      .find((e) => e[0] === 'lightPlaced')?.[1] as SimEventMap['lightPlaced'] | undefined;
    if (placed === undefined) throw new Error('Lagerfeuer steht nicht');
    w.ok('Holz', [{ type: 'light.fuel', light: placed.light, from: bag('holz'), count: 4 }]);
    w.ok('entzünden', [{ type: 'light.ignite', tx: fire.tx, ty: fire.ty }], 30);
    expect(w.light.carried?.burn.lit).toBe(true);
    expect(w.lightAt(me)).toBeGreaterThan(LIMIT);
    // The base family north of the player (a new creature faces south: it sees the player's light), a dozen tiles off in
    // the dark; the light eater comes later.
    const spots = [
      ['schleicher', 0, -12],
      ['schleicher', 9, -9],
      ['kriecher', -6, -10],
      ['speier', 5, -12],
    ] as const;
    for (const [id, dx, dy] of spots) {
      const at = { tx: me.tx + dx, ty: me.ty + dy };
      expect(w.lightAt(at), `${id} erscheint im Dunkeln`).toBeLessThan(0.15);
      w.spawn(id, 1, at);
    }
    const threshold = (creature: string): number => CONTENT.collection('aiProfiles').get(CONTENT.collection('creatures').get(creature).ki).meidetLicht ?? 1;
    expect(threshold('schleicher')).toBe(LIMIT);
    expect(threshold('lichtfresser')).toBeGreaterThan(BALANCE.light.map.stages.glaringAbove - 1e-9);
    const p = w.pos();
    const at = { x: 0, y: 0 };
    /** Runs `ticks` ticks; every tick no living shadow brood stands on a tile brighter than its threshold. Nearest approach per kind [tiles]. */
    const watch = (ticks: number): { nearest: Map<string, number>; checks: number; events: SimEventMap['lightExtinguished'][] } => {
      const nearest = new Map<string, number>();
      const events: SimEventMap['lightExtinguished'][] = [];
      let checks = 0;
      for (let t = 0; t < ticks; t++) {
        for (const [type, payload] of w.run()) if (type === 'lightExtinguished') events.push(payload as SimEventMap['lightExtinguished']);
        const store = w.creatures.store;
        for (let i = 0; i < store.size; i++) {
          const s = store.valueAt(i);
          if (s.fadeTick >= 0 || s.health <= 0 || !w.creatures.catalog.get(s.creature).shadow) continue;
          if (!w.creatures.positionOf(store.entityAt(i), at)) continue;
          checks++;
          expect(w.lightAt(tileAt(at)), `${s.creature} Tick ${w.sim.tick}`).toBeLessThanOrEqual(threshold(s.creature) + 1e-9);
          nearest.set(s.creature, Math.min(nearest.get(s.creature) ?? Infinity, Math.hypot(at.x - p.x, at.y - p.y) / TILE_PX));
        }
      }
      return { nearest, checks, events };
    };
    // 1000 ticks with the lights burning: nobody steps into them, but they come to their edge.
    const lit = watch(1000);
    expect(lit.checks).toBeGreaterThanOrEqual(4 * 1000);
    expect(w.light.carried?.burn.lit).toBe(true);
    for (const id of ['schleicher', 'kriecher', 'speier']) {
      // They come to the edge of the torchlight (0,5 at about 2 tiles, the spitter keeps its 5 tiles of range) – not
      // merely somewhere in the dark.
      expect(lit.nearest.get(id), id).toBeLessThan(7);
      expect(lit.nearest.get(id), id).toBeGreaterThan(1);
    }
    // Then the light eater: it goes nearer than the rest – up to glaring light – and puts the torch out (M6-26, ADR-0110);
    // every brood keeps to its threshold all the while.
    w.spawn('lichtfresser', 1, { tx: me.tx - 8, ty: me.ty - 10 });
    const eaten = watch(1000);
    expect(eaten.nearest.get('lichtfresser')).toBeLessThan(4);
    expect(eaten.events.some((e) => e.reason === 'lichtfresser')).toBe(true);
    expect(w.light.carried?.burn.lit).toBe(false);
  });
});

describe('Schattenbrut im Untergrund (§12.4, M6-Gate)', () => {
  for (const [layer, biom, variante, hour] of [
    [-1, 'wurzelhoehlen', null, 12],
    [-1, 'wurzelhoehlen', null, 1],
    [-2, 'tiefgrund', 'tiefe', 12],
    [-3, 'glutadern', 'asche', 12],
  ] as const) {
    it(`Ebene ${layer} (${biom}) um ${hour} Uhr: die Grundfamilie erscheint im Dunkeln, 16–40 Kacheln weit${variante === null ? '' : `, als Variante ${variante}`}, und schläft nicht`, () => {
      const w = kampfWelt({ hour, god: true });
      const { biome } = hinab(w, layer);
      expect(biome).toBe(biom);
      expect(w.creatures.catalog.spawnTable(biom)?.nacht.map((e) => e.kreatur).sort()).toEqual([...BROOD].sort());
      const p = w.pos();
      const map = w.light.mapFor(w.sim);
      const spawned: SimEventMap['creatureSpawned'][] = [];
      // 90 s: the night spawner tries every `intervalSeconds` (here at any hour: below the surface there is no day).
      for (let s = 0; s < 90; s++) for (const [type, payload] of w.run([], 60)) if (type === 'creatureSpawned') spawned.push(payload as SimEventMap['creatureSpawned']);
      expect(spawned.length, 'Spawns in 90 s').toBeGreaterThan(0);
      for (const c of spawned) {
        expect(c.layer).toBe(layer);
        expect(BROOD).toContain(c.creature);
        const d = Math.hypot(c.x - p.x, c.y - p.y) / TILE_PX;
        expect(d, c.creature).toBeGreaterThanOrEqual(SB.minTiles - 1);
        expect(d, c.creature).toBeLessThanOrEqual(SB.maxTiles + 1);
        const t = tileAt(c);
        expect(map.tileLevel(layer, t.tx, t.ty), c.creature).toBeLessThan(SB.maxLight);
      }
      const store = w.creatures.store;
      let brood = 0;
      for (let i = 0; i < store.size; i++) {
        const s = store.valueAt(i);
        if (!w.creatures.catalog.get(s.creature).shadow || s.layer !== layer) continue;
        brood++;
        const kind = w.creatures.catalog.get(s.creature);
        expect(s.variant >= 0 ? kind.def.varianten?.[s.variant]?.id : null, s.creature).toBe(variante);
        expect(s.state, `${s.creature} um ${hour} Uhr`).not.toBe('schlafen');
        expect(s.fadeTick, s.creature).toBe(-1);
      }
      expect(brood).toBeGreaterThan(0);
    });
  }
});
