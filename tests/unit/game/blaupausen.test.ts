/**
 * M4-24 Blaupausen (MASTERPROMPT §16.6 "Blaupausen: Pläne ohne Material platzieren; mit Hammer oder durch Siedler
 * fertigstellen, Material kommt aus Kisten im Umkreis"):
 * - a blueprint is placed without material and neither collides nor closes a room;
 * - the hammer finishes it with the part from the bags, else from a chest within 8 tiles of the blueprint (the chest
 *   reports `chestTaken` by `bau`); a chest farther away does not count;
 * - `blueprintNeeds` lists the blueprints of an area and what is at hand for them;
 * - the rules of other systems apply when a blueprint is finished (one hearth per base).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { blueprintNeeds } from '../../../src/game/blueprints/needs';
import { blueprintMaterials } from '../../../src/game/blueprints/supply';
import { BLOCK_SOLID } from '../../../src/world/collision/tiles';
import { lagerWelt, px, type LagerWelt } from './lager-testwelt';
import { OFFSET, meadow } from './spieler-testwelt';

function world(): LagerWelt {
  return lagerWelt(meadow(40, 20), { x: 10, y: 10 });
}

function goTo(w: LagerWelt, x: number, y: number): void {
  const p = px(x, y);
  w.act({ type: 'player.teleport', x: p.x, y: p.y, layer: 0 });
}

/** A crate on drawn tile (x, y) holding `count` pieces of `item` (the player walks there and back). */
function crate(w: LagerWelt, x: number, y: number, item: string, count: number): number {
  const home = w.pos();
  goTo(w, x - 1, y);
  if (w.build('kiste_holz', x, y) !== null) throw new Error('crate refused');
  const id = w.storage.chestAt(0, OFFSET + x, OFFSET + y)?.id ?? 0;
  w.give(item, count);
  if (w.rejection(w.act({ type: 'storage.put', chest: id, from: w.slotOf(item) })) !== null) throw new Error('put refused');
  w.act({ type: 'player.teleport', x: home.x, y: home.y, layer: 0 });
  return id;
}

function blueprint(w: LagerWelt, part: string, x: number, y: number): string | null {
  return w.rejection(w.act({ type: 'build.blueprint', part, tx: OFFSET + x, ty: OFFSET + y }));
}

function complete(w: LagerWelt, x: number, y: number): Map<string, unknown[]> {
  return w.act({ type: 'build.complete', tx: OFFSET + x, ty: OFFSET + y });
}

describe('Pläne ohne Material (§16.6)', () => {
  it('eine Blaupause kostet nichts, kollidiert nicht und schließt keinen Raum', () => {
    const w = world();
    expect(w.count('wand_holz')).toBe(0);
    for (let x = 12; x <= 14; x++) expect(blueprint(w, 'wand_holz', x, 8)).toBeNull();
    expect(w.count('wand_holz')).toBe(0);
    w.collision.ensureTiles(0, OFFSET + 12, OFFSET + 8, OFFSET + 14, OFFSET + 8);
    expect(w.collision.grid.info(0, OFFSET + 13, OFFSET + 8) & BLOCK_SOLID).toBe(0);
    expect(w.building.partAt(0, 'struktur', OFFSET + 13, OFFSET + 8)?.id).toBe('wand_holz');
  });
});

describe('Fertigstellen mit dem Hammer, Material aus Kisten im Umkreis', () => {
  it('ohne Hammer nicht; mit Hammer zuerst aus den Taschen', () => {
    const w = world();
    blueprint(w, 'wand_holz', 12, 8);
    w.give('wand_holz', 1);
    expect(w.rejection(complete(w, 12, 8))).toBe('noHammer');
    w.hold('steinhammer');
    const ev = complete(w, 12, 8);
    expect(w.rejection(ev)).toBeNull();
    expect(ev.get('blueprintCompleted')?.[0]).toMatchObject({ part: 'wand_holz' });
    expect(w.count('wand_holz')).toBe(0);
    expect(ev.get('chestTaken')).toBeUndefined();
  });

  it('fehlt das Teil in den Taschen, kommt es aus einer Kiste bis 8 Tiles um die Blaupause', () => {
    const w = world();
    w.hold('steinhammer');
    const near = crate(w, 18, 8, 'wand_holz', 2);
    blueprint(w, 'wand_holz', 12, 8);
    const ev = complete(w, 12, 8);
    expect(w.rejection(ev)).toBeNull();
    expect(ev.get('chestTaken')?.[0]).toMatchObject({ chest: near, taken: 'wand_holz', count: 1, by: 'bau' });
    expect(w.storage.chest(near)?.slots[0]).toMatchObject({ item: 'wand_holz', count: 1 });
    expect(BALANCE.storage.blueprintChestTiles).toBe(8);
  });

  it('eine Kiste weiter als 8 Tiles von der Blaupause zählt nicht', () => {
    const w = world();
    w.hold('steinhammer');
    crate(w, 24, 8, 'wand_holz', 5);
    blueprint(w, 'wand_holz', 12, 8);
    expect(w.rejection(complete(w, 12, 8))).toBe('noMaterial');
    expect(w.building.partAt(0, 'struktur', OFFSET + 12, OFFSET + 8)).toBeDefined();
  });

  it('die Materialquelle zählt Taschen und Kisten um das Bauteil', () => {
    const w = world();
    crate(w, 16, 10, 'brett', 7);
    w.give('brett', 3);
    const source = blueprintMaterials({ inventory: w.inventory, storage: w.storage });
    expect(source.count(w.sim, 'brett', 0, OFFSET + 12, OFFSET + 10)).toBe(10);
    expect(source.count(w.sim, 'brett', 0, OFFSET + 30, OFFSET + 10)).toBe(3);
    expect(source.take(w.sim, 'brett', 11, 0, OFFSET + 12, OFFSET + 10)).toBe(false);
    expect(source.take(w.sim, 'brett', 5, 0, OFFSET + 12, OFFSET + 10)).toBe(true);
    expect(w.count('brett')).toBe(0);
    expect(source.count(w.sim, 'brett', 0, OFFSET + 12, OFFSET + 10)).toBe(5);
  });
});

describe('Was die Blaupausen einer Fläche brauchen', () => {
  it('je Bauteil: Blaupausen, vorhanden, fehlend', () => {
    const w = world();
    crate(w, 16, 12, 'wand_holz', 2);
    for (let x = 12; x <= 14; x++) blueprint(w, 'wand_holz', x, 8);
    blueprint(w, 'boden_holz', 12, 9);
    const source = blueprintMaterials({ inventory: w.inventory, storage: w.storage });
    expect(blueprintNeeds(w.sim, w.building, source, 0, OFFSET + 10, OFFSET + 6, OFFSET + 16, OFFSET + 12)).toEqual([
      { part: 'boden_holz', blueprints: 1, atHand: 0, missing: 1 },
      { part: 'wand_holz', blueprints: 3, atHand: 2, missing: 1 },
    ]);
  });
});

describe('Regeln anderer Systeme gelten beim Fertigstellen', () => {
  it('eine Herdfeuer-Blaupause wird nicht fertig, wenn inzwischen ein Herdfeuer zu nah steht', () => {
    const w = world();
    w.hold('steinhammer');
    expect(blueprint(w, 'herdfeuer', 12, 6)).toBeNull();
    expect(w.build('herdfeuer', 12, 11)).toBeNull();
    w.give('herdfeuer', 1);
    expect(w.rejection(complete(w, 13, 7))).toBe('hearthTooClose');
    expect(w.hearth.hearths).toHaveLength(1);
  });
});
