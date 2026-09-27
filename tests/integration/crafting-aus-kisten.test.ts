/**
 * M4-31 Crafting aus Kisten, headless in der echten Welt (MASTERPROMPT §15.1 "Crafting nimmt aus Inventar und Kisten im
 * Umkreis von 8 Tiles (abschaltbar)", §32 M4 "Crafting aus Kisten"): eine volle Simulation am Startstrand, der Spieler
 * handelt nur mit den Befehlen, die Tastatur, Maus und Menüs senden – Laufen (Stick-Richtung, tests/integration/
 * tag1-spieler.ts), Bauen (`build.place`, `station.place`), Kisten (`storage.put`), Handwerk (`craft.start`,
 * `craft.useChests`). Die Zutaten kommen einmal mit dem Debug-Befehl `inventory.give` in die Taschen (wie in den
 * Referenzspielständen, tools/save/fixture.ts); alles Weitere geht durch die Welt.
 *
 * 1. Eine Holzkiste neben dem Weg, die Zutaten eines Holzeimers (Werkbank: 4 Bretter, 1 Faserseil, 1 Harz) zweimal
 *    hinein; zur Werkbank gelaufen (Kiste 3½ Kacheln entfernt), die Taschen ohne eine Zutat: der Auftrag nimmt genau
 *    einen Satz aus der Kiste, der Eimer landet in den Taschen.
 * 2. Kisten abgeschaltet: derselbe Auftrag wird abgelehnt („nicht genug“), die Kiste bleibt unberührt; wieder
 *    eingeschaltet nimmt er den zweiten Satz, die Kiste ist leer.
 * 3. Eine zweite Kiste 10½ Kacheln von der Werkbank entfernt, mit einem Satz gefüllt: an der Werkbank wird der Auftrag
 *    abgelehnt (die Kiste liegt außerhalb der 8 Kacheln) – ein paar Schritte weiter, die Werkbank noch in Reichweite
 *    und die Kiste 6½ Kacheln entfernt, nimmt er sie.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/content/balance';
import { parseGameCommand, type GameCommand } from '../../src/game/commands';
import type { CraftingSystem } from '../../src/game/crafting/system';
import type { WorldCollision } from '../../src/game/player/collision';
import { createSimulation } from '../../src/game/setup';
import type { SimEventMap, Simulation } from '../../src/game/sim';
import type { StorageSystem } from '../../src/game/storage/system';
import { BLOCK_ALL } from '../../src/world/collision/tiles';
import { TILE_FLAG_RAMP, TILE_FLAG_STAIRS, WATER_DEPTH_MASK } from '../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX } from '../../src/world/model/coords';
import { Day1Player, type Script, type TickEvent, type Tile } from './tag1-spieler';

/** Welt des Tests: klein, offener Sand am Startstrand. */
const CONFIG = { seed: 1, worldSize: 'small', dayLengthMinutes: 24 } as const;
const RECIPE = 'rezept_holzeimer_werkbank';
/** Ein Satz Zutaten des Rezepts (src/content/recipes/verarbeitung.ts). */
const SET: Readonly<Record<string, number>> = { brett: 4, faserseil: 1, harz: 1 };
const CHEST_RADIUS_TILES = BALANCE.crafting.chestRadiusTiles;
/** Ticks, die der Spieler auf die Antwort eines Befehls wartet. */
const ANSWER_TICKS = 5;
/** Längste Wartezeit auf einen fertigen Eimer [Ticks]: Zeitklasse „werkzeug“ mit Reserve. */
const CRAFT_LIMIT_TICKS = Math.ceil(BALANCE.crafting.durationSeconds.werkzeug * BALANCE.time.tickHz) * 2;
/** Längste Suche nach dem Bauplatz um den Startstrand [Kacheln]. */
const SITE_SEARCH_TILES = 40;

/**
 * Layout (Kacheln ab dem Weg-Anfang x0 in der Reihe cy; Kisten und Werkbank eine Reihe nördlich): Kiste A über x0,
 * Werkbank (2 × 1) über x0+5, Kiste B über x0+15. Standplätze: an Kiste A x0, an der Werkbank x0+4 (A 3½, B 10½
 * Kacheln entfernt), weiter vorn x0+8 (Werkbank 1½, B 6½), an Kiste B x0+15.
 */
const LAYOUT = { chestA: 0, bench: 5, chestB: 15, atA: 0, atBench: 4, atBenchNearB: 8, atB: 15, from: -1, to: 16 } as const;

function sys<T>(sim: Simulation, id: string): T {
  return sim.system(id) as unknown as T;
}

/** Freier Boden zum Bauen und Gehen: nichts blockiert, trocken, kein Welt-Objekt, keine Rampe oder Treppe. */
function open(sim: Simulation, x: number, y: number): boolean {
  const chunk = sim.world.chunks.get(0, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
  if (chunk === undefined) return false;
  const grid = sys<WorldCollision>(sim, 'world-collision').grid;
  grid.beginQuery();
  const i = ((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK);
  return (
    (grid.tileInfo(0, x, y) & BLOCK_ALL) === 0 &&
    chunk.object[i] === 0 &&
    ((chunk.water[i] as number) & WATER_DEPTH_MASK) === 0 &&
    ((chunk.flags[i] as number) & (TILE_FLAG_RAMP | TILE_FLAG_STAIRS)) === 0
  );
}

/** Der nächste Weg (x0, cy) um `from`, dessen zwei Reihen frei und vom Spieler aus erreichbar sind. */
function findSite(p: Day1Player, from: Tile): { x0: number; cy: number } {
  for (let r = 0; r <= SITE_SEARCH_TILES; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x0 = from.tx + dx;
        const cy = from.ty + dy;
        let ok = true;
        for (let x = x0 + LAYOUT.from; x <= x0 + LAYOUT.to && ok; x++) ok = open(p.sim, x, cy - 1) && open(p.sim, x, cy);
        if (ok && p.path((tx, ty) => tx === x0 && ty === cy) !== null) return { x0, cy };
      }
    }
  }
  throw new Error('kein freier Weg am Startstrand');
}

/** Sends `raw` (validated like a replay) and waits for its answer: the tick's events of `answer` or a refusal of its type. */
function* act(p: Day1Player, raw: GameCommand, answer: keyof SimEventMap): Generator<void, { ok: boolean; reason: string | null; events: TickEvent[] }, void> {
  p.sim.commands.push(parseGameCommand(raw));
  const seen: TickEvent[] = [];
  for (let i = 0; i < ANSWER_TICKS; i++) {
    yield;
    seen.push(...p.events);
    const refusal = p.eventsOf('commandRejected').find((r) => r.type === raw.type);
    if (refusal !== undefined) return { ok: false, reason: refusal.reason, events: seen };
    if (p.eventsOf(answer).length > 0) return { ok: true, reason: null, events: seen };
  }
  throw new Error(`${raw.type}: keine Antwort`);
}

/** Pieces of each ingredient in the chest on tile (tx, ty). */
function chestSet(sim: Simulation, tx: number, ty: number): Record<string, number> {
  const chest = sys<StorageSystem>(sim, 'storage').chestAt(0, tx, ty);
  if (chest === undefined) throw new Error(`keine Kiste auf ${tx},${ty}`);
  const out: Record<string, number> = Object.fromEntries(Object.keys(SET).map((k) => [k, 0]));
  for (const s of chest.slots) if (s !== null && s.item in out) out[s.item] = (out[s.item] ?? 0) + s.count;
  return out;
}

const times = (n: number): Record<string, number> => Object.fromEntries(Object.entries(SET).map(([k, v]) => [k, v * n]));

describe('Crafting aus Kisten in der echten Welt (M4-31)', () => {
  it('der Auftrag an der Werkbank nimmt aus der Kiste im Umkreis 8; abgeschaltet nie; eine Kiste weiter als 8 Kacheln zählt nicht', () => {
    const sim = createSimulation(CONFIG);
    const p = new Day1Player(sim);
    const log: string[] = [];
    let site: { x0: number; cy: number } | null = null;
    const chestAt = (dx: number): { tx: number; ty: number } => ({ tx: (site?.x0 ?? 0) + dx, ty: (site?.cy ?? 0) - 1 });
    const standAt = (dx: number): Tile => ({ tx: (site?.x0 ?? 0) + dx, ty: site?.cy ?? 0 });
    const walk = function* (dx: number): Script {
      const t = standAt(dx);
      if (!(yield* p.goTo(t.tx, t.ty))) throw new Error(`kein Weg nach ${t.tx},${t.ty}`);
    };
    const give = function* (items: Readonly<Record<string, number>>): Script {
      for (const [item, count] of Object.entries(items)) expect((yield* act(p, { type: 'inventory.give', item, count }, 'itemsAdded')).ok).toBe(true);
    };
    const store = function* (dx: number): Script {
      const chest = sys<StorageSystem>(sim, 'storage').chestAt(0, chestAt(dx).tx, chestAt(dx).ty);
      if (chest === undefined) throw new Error('keine Kiste');
      for (const item of Object.keys(SET)) {
        const from = p.slotOf(item);
        if (from === null) throw new Error(`${item} nicht in den Taschen`);
        expect((yield* act(p, { type: 'storage.put', chest: chest.id, from }, 'chestStored')).ok, `${item} in die Kiste`).toBe(true);
      }
    };
    const craft = function* (): Generator<void, string | null, void> {
      const r = yield* act(p, { type: 'craft.start', recipe: RECIPE, count: 1 }, 'craftQueued');
      if (!r.ok) return r.reason;
      if (!(yield* p.waitFor(() => p.eventsOf('craftCompleted').some((c) => c.recipe === RECIPE), CRAFT_LIMIT_TICKS))) throw new Error('der Eimer wird nicht fertig');
      return null;
    };
    /** The switch of the crafting menu ("aus Kisten"): no event of its own, the setting holds from the next tick. */
    const useChests = function* (on: boolean): Script {
      p.sim.commands.push(parseGameCommand({ type: 'craft.useChests', on }));
      yield;
      expect(sys<CraftingSystem>(sim, 'crafting').usesChests).toBe(on);
    };
    const bagsHaveNoIngredient = (): void => {
      for (const item of Object.keys(SET)) expect(p.count(item), item).toBe(0);
    };

    p.run(
      (function* (): Script {
        p.send({ type: 'player.spawn' });
        yield* p.wait(30);
        site = findSite(p, p.tile);
        // 1. Chest A beside the way, two sets of ingredients in it; the workbench; the bags hold no ingredient.
        yield* walk(LAYOUT.atA);
        yield* give({ kiste_holz: 2, werkbank: 1, ...times(2) });
        expect((yield* act(p, { type: 'build.place', part: 'kiste_holz', ...chestAt(LAYOUT.chestA) }, 'chestPlaced')).ok).toBe(true);
        yield* store(LAYOUT.chestA);
        bagsHaveNoIngredient();
        expect(chestSet(sim, chestAt(LAYOUT.chestA).tx, chestAt(LAYOUT.chestA).ty)).toEqual(times(2));
        yield* walk(LAYOUT.atBench);
        const bench = p.slotOf('werkbank');
        if (bench === null) throw new Error('keine Werkbank in den Taschen');
        expect((yield* act(p, { type: 'station.place', from: bench, ...chestAt(LAYOUT.bench) }, 'stationPlaced')).ok).toBe(true);
        expect(sys<CraftingSystem>(sim, 'crafting').usesChests).toBe(true);
        expect(yield* craft()).toBeNull();
        expect(chestSet(sim, chestAt(LAYOUT.chestA).tx, chestAt(LAYOUT.chestA).ty)).toEqual(times(1));
        expect(p.count('holzeimer')).toBe(1);
        bagsHaveNoIngredient();
        log.push('Kiste A: ein Satz genommen, Eimer 1');

        // 2. Chests switched off: refused, the chest untouched; switched on again: the second set.
        yield* useChests(false);
        expect(yield* craft()).toBe('notEnough');
        expect(chestSet(sim, chestAt(LAYOUT.chestA).tx, chestAt(LAYOUT.chestA).ty)).toEqual(times(1));
        yield* useChests(true);
        expect(yield* craft()).toBeNull();
        expect(chestSet(sim, chestAt(LAYOUT.chestA).tx, chestAt(LAYOUT.chestA).ty)).toEqual(times(0));
        expect(p.count('holzeimer')).toBe(2);
        log.push('abgeschaltet abgelehnt, eingeschaltet Eimer 2');

        // 3. Chest B 10½ tiles from the bench: ignored there; a few steps on (bench within reach, B 6½ tiles) it counts.
        yield* walk(LAYOUT.atB);
        expect((yield* act(p, { type: 'build.place', part: 'kiste_holz', ...chestAt(LAYOUT.chestB) }, 'chestPlaced')).ok).toBe(true);
        yield* give(times(1));
        yield* store(LAYOUT.chestB);
        bagsHaveNoIngredient();
        yield* walk(LAYOUT.atBench);
        const at = p.at;
        const b = chestAt(LAYOUT.chestB);
        expect(b.tx * TILE_PX - at.x).toBeGreaterThan(CHEST_RADIUS_TILES * TILE_PX);
        expect(yield* craft()).toBe('notEnough');
        expect(chestSet(sim, b.tx, b.ty)).toEqual(times(1));
        yield* walk(LAYOUT.atBenchNearB);
        expect(b.tx * TILE_PX - p.at.x).toBeLessThanOrEqual(CHEST_RADIUS_TILES * TILE_PX);
        expect(yield* craft()).toBeNull();
        expect(chestSet(sim, b.tx, b.ty)).toEqual(times(0));
        expect(p.count('holzeimer')).toBe(3);
        bagsHaveNoIngredient();
        log.push('Kiste B: fern abgelehnt, nah genommen, Eimer 3');
      })(),
    );
    expect(log).toHaveLength(3);
  }, 120_000);
});
