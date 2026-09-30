/**
 * Steuerung der Kreaturen (M6-17, M6-16a, M6-16e, M6-17b; MASTERPROMPT §19.4 „lokales Ausweichen (Separation), Türen (für
 * bestimmte Gegner brechbar), Sonderregeln für Schwimmer und Flieger“; docs/SPIEL.md §11 „Steuerung“):
 * - Separation schiebt überlappende Körper auseinander;
 * - der Pfaddienst führt eine Kreatur um eine Wand herum (M6-16a: Anfrage, Schnappschuss, Ergebnis im Kreatursystem);
 * - ein Türbrecher plant durch eine geschlossene Tür und schlägt auf sie ein (`BuildingSystem.damage`, `doorBattered`);
 * - ein Schwimmer bleibt im Wasser, ein aufgescheuchter Bodenvogel flattert (Flugregeln über `moverBlockMask`);
 * - Zonenrand (M6-16e): Kreaturen bleiben den Rand der aktiven Zone fern – was hinter ihm liegt, ändert nichts an ihnen.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { Entity } from '../../../src/engine/ecs';
import { moverRules } from '../../../src/game/creatures/catalog';
import { coreChunk, insideZone, type CreatureZone } from '../../../src/game/creatures/zone';
import type { SimEventMap } from '../../../src/game/sim';
import { BLOCK_DEEP_WATER, BLOCK_OBJECT, BLOCK_SOLID } from '../../../src/world/collision/tiles';
import { WATER_DEPTH_MASK } from '../../../src/world/model/chunk';
import { CHUNK_SIZE, TILE_PX } from '../../../src/world/model/coords';
import type { ChunkData } from '../../../src/world/model/chunk';
import { eventsOf } from './kampf-testwelt';
import { OFFSET, chunkOfMap, kreaturWelt, meadow, tileOf, type KreaturWelt } from './kreatur-testwelt';

const M = BALANCE.creatures.movement.zoneMarginTiles;

/** Makes creature `e` hunt the player from now on (it remembers the place for its memory). */
function huntPlayer(w: KreaturWelt, e: Entity): void {
  const s = w.state(e);
  const p = w.pos();
  s.target = w.sim.player;
  s.targetX = p.x;
  s.targetY = p.y;
  s.targetTick = w.sim.tick;
}

function distTiles(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_PX;
}

describe('Separation (M6-17)', () => {
  it('zwei Körper auf einem Fleck schieben sich auseinander', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 2, y: 2 });
    const a = w.creature('reh', 20, 15);
    const b = w.creature('reh', 24, 15);
    const pos = w.motion.position;
    const ra = pos.indexOf(a);
    const rb = pos.indexOf(b);
    pos.columns.x[rb] = pos.columns.x[ra] as number;
    pos.columns.y[rb] = pos.columns.y[ra] as number;
    w.run(40);
    const radius = 7;
    expect(distTiles(w.where(a), w.where(b)) * TILE_PX).toBeGreaterThanOrEqual(2 * radius);
  });
});

describe('Pfade (M6-16a)', () => {
  it('eine Kreatur folgt dem Pfad des Dienstes um eine Wand herum zu ihrem Ziel', () => {
    // Eine Wand in Spalte 30 von Zeile 0 bis 44, unten offen; der kürzere Weg führt unten herum.
    const rows = meadow(60, 60).map((row, y) => (y <= 44 ? row.slice(0, 30) + '#' + row.slice(31) : row));
    const w = kreaturWelt(rows, { x: 40, y: 30 });
    w.cheats.god = true;
    const e = w.creature('probe_brecher', 20, 30);
    huntPlayer(w, e);
    let crossedAt = -1;
    let reached = false;
    for (let i = 0; i < 1200 && !reached; i++) {
      w.run(1);
      const at = tileOf(w.where(e));
      if (crossedAt < 0 && at.tx - OFFSET > 30) crossedAt = at.ty - OFFSET;
      reached = distTiles(w.where(e), w.pos()) < 2;
    }
    expect(reached).toBe(true);
    // Um das Ende der Wand herum, nicht hindurch.
    expect(crossedAt).toBeGreaterThanOrEqual(45);
    expect(w.creatures.paths.stats.admitted).toBeGreaterThan(0);
    expect(w.creatures.paths.pending).toBeLessThanOrEqual(1);
  });

  /** A wall across row 15 with a closed door in its middle; `creature` hunts the player on the other side for 10 s. */
  function doorWorld(creature: string): { blows: { tx: number; ty: number; amount: number; tick: number }[]; battered: SimEventMap['doorBattered'][]; door: { tx: number; ty: number } } {
    const door = { tx: OFFSET + 20, ty: OFFSET + 15 };
    const rows = meadow(40, 30).map((row, y) => (y === 15 ? '#'.repeat(20) + '.' + '#'.repeat(19) : row));
    const w = kreaturWelt(rows, { x: 20, y: 22 });
    w.cheats.god = true;
    // The door: solid like a wall (the build grid's overlay), known to the path service as a closed door.
    w.collision.addOverlay({ overlayAt: (_l, tx, ty) => (tx === door.tx && ty === door.ty ? BLOCK_SOLID : 0) });
    const blows: { tx: number; ty: number; amount: number; tick: number }[] = [];
    w.creatures.useBuilding(
      {
        damage: (s, _layer, ebene, tx, ty, amount) => {
          expect(ebene).toBe('struktur');
          blows.push({ tx, ty, amount, tick: s.eventTick });
          return 50;
        },
      },
      { closedDoorAt: (_l, tx, ty) => tx === door.tx && ty === door.ty, mayHaveDoors: () => true },
    );
    const e = w.creature(creature, 20, 8);
    const battered: SimEventMap['doorBattered'][] = [];
    for (let i = 0; i < 600; i++) {
      if (i % 60 === 0) huntPlayer(w, e);
      battered.push(...eventsOf<SimEventMap['doorBattered']>(w.run(1), 'doorBattered'));
    }
    return { blows, battered, door };
  }

  it('ein Türbrecher plant durch die geschlossene Tür und schlägt einmal je Sekunde auf sie ein', () => {
    const { blows, battered, door } = doorWorld('probe_brecher');
    expect(blows.length).toBeGreaterThanOrEqual(3);
    expect(blows.every((b) => b.tx === door.tx && b.ty === door.ty && b.amount === BALANCE.creatures.doors.damagePerBlow)).toBe(true);
    for (let i = 1; i < blows.length; i++) expect((blows[i] as { tick: number }).tick - (blows[i - 1] as { tick: number }).tick).toBeGreaterThanOrEqual(BALANCE.time.tickHz / BALANCE.creatures.doors.blowsPerSecond);
    expect(battered).toHaveLength(blows.length);
  });

  it('ein Wolf bricht keine Türen', () => {
    const { blows, battered } = doorWorld('probe_wolf');
    expect(blows).toEqual([]);
    expect(battered).toEqual([]);
  });
});

describe('Schwimmer und Flieger (M6-17b)', () => {
  it('die Regeln der Fortbewegung kommen aus derselben Tabelle wie die Pfade', () => {
    expect(moverRules('land').blockMask & BLOCK_DEEP_WATER).not.toBe(0);
    expect(moverRules('schwimmer').blockMask & BLOCK_DEEP_WATER).toBe(0);
    expect(moverRules('flieger').blockMask & (BLOCK_DEEP_WATER | BLOCK_OBJECT)).toBe(0);
    expect(moverRules('flieger').mode).toBe('fly');
  });

  it('ein Schwimmer bleibt im Wasser', () => {
    const rows = meadow(40, 30).map((row, y) => (y >= 10 && y <= 20 ? row.slice(0, 10) + 'w'.repeat(20) + row.slice(30) : row));
    const w = kreaturWelt(rows, { x: 3, y: 3 });
    const fish = w.creature('probe_fisch', 20, 15);
    let moved = 0;
    const start = w.where(fish);
    for (let i = 0; i < 90; i++) {
      w.run(10);
      const { tx, ty } = tileOf(w.where(fish));
      const { chunk, i: idx } = w.chunks.at(tx, ty);
      expect(((chunk.water[idx] as number) & WATER_DEPTH_MASK) !== 0).toBe(true);
      moved = Math.max(moved, distTiles(start, w.where(fish)));
    }
    expect(moved).toBeGreaterThan(1);
  });

  it('eine aufgescheuchte Wachtel flattert auf', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 4 });
    const quail = w.creature('wachtel', 20, 10);
    let flushed: SimEventMap['creatureFlushed'][] = [];
    for (let i = 0; i < 240 && flushed.length === 0; i++) flushed = eventsOf(w.run(1, i === 0 ? [{ type: 'player.move', dx: 0, dy: 1 }] : undefined), 'creatureFlushed');
    expect(flushed[0]?.entity).toBe(quail);
    expect(w.state(quail).flyUntilTick).toBeGreaterThan(w.sim.tick);
    expect(w.state(quail).state).toBe('fliehen');
  });
});

describe('Zonenrand (M6-16e)', () => {
  const zone = (active: readonly string[]): CreatureZone => ({ isActive: (l, cx, cy) => l === 0 && active.includes(`${cx},${cy}`), chunks: () => [] });

  it('Kreaturen stehen mindestens den Rand weit in der aktiven Zone; Pfade lesen nur Kernchunks', () => {
    const z = zone(['2,2']);
    const at = (lx: number, ly: number): [number, number] => [(2 * CHUNK_SIZE + lx + 0.5) * TILE_PX, (2 * CHUNK_SIZE + ly + 0.5) * TILE_PX];
    expect(insideZone(z, 0, ...at(M, M))).toBe(true);
    expect(insideZone(z, 0, ...at(CHUNK_SIZE - M - 1, 16))).toBe(true);
    expect(insideZone(z, 0, ...at(M - 1, 16))).toBe(false);
    expect(insideZone(z, 0, ...at(CHUNK_SIZE - M, 16))).toBe(false);
    expect(insideZone(zone(['2,2', '1,2']), 0, ...at(M - 1, 16))).toBe(true);
    // Die Ecke braucht beide Nachbarn und den diagonalen.
    expect(insideZone(zone(['2,2', '1,2', '2,1']), 0, ...at(0, 0))).toBe(false);
    expect(insideZone(zone(['2,2', '1,2', '2,1', '1,1']), 0, ...at(0, 0))).toBe(true);
    const block: string[] = [];
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) block.push(`${x},${y}`);
    expect(coreChunk(zone(block), 0, 2, 2)).toBe(true);
    expect(coreChunk(zone(block), 0, 3, 2)).toBe(false);
    // Genug für das breiteste Randband (Klippenfronten: 5 Zeilen) und einen Körper.
    expect(M).toBeGreaterThanOrEqual(BALANCE.world.maxHeightLevel + 2);
  });

  it('was hinter dem Rand liegt, ändert eine Kreatur nicht, die nach Hause will', () => {
    // Die aktive Zone sind die Chunks (1…3, 1…3); der Hase wohnt weit im Osten, im inaktiven Chunk (4, 2).
    const run = (rock: boolean): string => {
      const w = kreaturWelt(meadow(80, 60), { x: 2, y: 2 });
      const block = new Set<string>();
      for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) block.add(`${x},${y}`);
      w.zone.only = block;
      if (rock) {
        // Fels in den westlichen Spalten des inaktiven Chunks (4, 2): nur ein Leser jenseits des Randes sähe ihn.
        const c = w.chunks.get(0, 4, 2) as ChunkData;
        for (let y = 0; y < CHUNK_SIZE; y++) for (let x = 0; x < 4; x++) c.solid[y * CHUNK_SIZE + x] = 1;
      }
      const hare = w.creature('hase', 3 * CHUNK_SIZE + 20 - OFFSET, 2 * CHUNK_SIZE + 16 - OFFSET);
      expect(chunkOfMap(3 * CHUNK_SIZE + 20 - OFFSET, 2 * CHUNK_SIZE + 16 - OFFSET)).toBe('3,2');
      const s = w.state(hare);
      s.homeX = (5 * CHUNK_SIZE + 16) * TILE_PX;
      s.homeY = (2 * CHUNK_SIZE + 16) * TILE_PX;
      let east = 0;
      for (let i = 0; i < 60; i++) {
        w.run(10);
        east = Math.max(east, w.where(hare).x);
      }
      // Er kommt bis an den Rand, nie hinein.
      expect(east / TILE_PX).toBeLessThan(4 * CHUNK_SIZE - M);
      expect(east / TILE_PX).toBeGreaterThan(4 * CHUNK_SIZE - M - 2);
      return JSON.stringify(w.creatures.save.serialize());
    };
    expect(run(true)).toBe(run(false));
  });
});
