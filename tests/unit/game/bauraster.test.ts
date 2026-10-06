/**
 * M4-11 Bau-Raster & Ebenen (MASTERPROMPT §16.1, §16.6; M4-12 materials): occupancy of the five build layers,
 * collision of walls, doors, fences and furniture, the pile rule for water buildings, build reach, footprints of
 * objects 1×1 up to 4×4 with rotation, wall furniture, ladders and stairs, the part materials (§16.2 hit points),
 * dismantling (100 % within 30 s, then 60 %), upgrading in place, blueprints with the hammer.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { ITEM_GROUPS } from '../../../src/content/items/index';
import { BUILD_REJECT_REASONS } from '../../../src/game/building/events';
import { parseGameCommand } from '../../../src/game/commands';
import { contentMaterialBook, MaterialBook } from '../../../src/game/building/materials';
import { LANGS, createI18n } from '../../../src/i18n/index';
import { BLOCK_DEEP_WATER, BLOCK_OBJECT, BLOCK_SOLID, BLOCK_WALL, INFO_CONNECTOR, infoLevel } from '../../../src/world/collision/tiles';
import { contentPartCatalog } from '../../../src/world/structures/catalog';
import { BUILD_LAYER_INDEX, cellCovered, cellDx, cellDy, cellOpen, cellPart, cellRot } from '../../../src/world/structures/cells';
import { connectMask } from '../../../src/world/structures/query';
import { bauWelt, type BauWelt } from './bau-testwelt';
import { OFFSET, meadow } from './spieler-testwelt';

const STRUCTURE = BUILD_LAYER_INDEX.struktur;
const OBJECT = BUILD_LAYER_INDEX.objekt;
const TICK_HZ = BALANCE.time.tickHz;

/** Collision info of drawn tile (x, y) as movers see it. */
function info(w: BauWelt, x: number, y: number): number {
  return w.collision.grid.tileInfo(0, OFFSET + x, OFFSET + y);
}

/** The cell of drawn tile (x, y) on build layer `li`. */
function cell(w: BauWelt, li: number, x: number, y: number): number {
  return w.building.structures.cell(0, li, OFFSET + x, OFFSET + y);
}

describe('Bauteile als Daten (M4-12, §16.2)', () => {
  it('Wand-HP nach Material: Palisade 150, Holz 300, Fachwerk 450, Stein 900; Fachwerk brennt 70 % weniger', () => {
    const c = contentPartCatalog();
    expect([c.get('wand_palisade').hp, c.get('wand_holz').hp, c.get('wand_fachwerk').hp, c.get('wand_stein').hp]).toEqual([150, 300, 450, 900]);
    expect(c.get('wand_holz').flammability).toBe(1);
    expect(c.get('wand_fachwerk').flammability).toBeCloseTo(0.3, 10);
    expect(c.get('wand_stein').flammability).toBe(0);
    expect(c.get('tuer_verstaerkt').hp).toBe(2 * c.get('tuer_holz').hp);
  });

  it('die 23 Bauteile T0–T1 sind Items der Kategorie bauteil mit Rezept, Bauteil-Datensatz und §16.1-Ebene', () => {
    const parts = CONTENT.collection('buildParts');
    // The structure parts of M4-12 are the item group `bauteile`; furniture, lights and decoration (M4-19) are build
    // parts of the category bauteil too – every one of them has its part record and its recipe as well.
    const bauteile = ITEM_GROUPS.bauteile;
    for (const item of CONTENT.collection('items').values().filter((i) => i.kategorie === 'bauteil')) {
      expect(parts.has(item.id), item.id).toBe(true);
      // Except a boss's trophy (docs/SPIEL.md §22: a wall piece whose only source is `boss:<id>`, M7-32): no recipe makes it.
      const sources = item.quellen ?? [];
      const bossTrophy = parts.get(item.id).kategorie === 'trophaee' && sources.length > 0 && sources.every((q) => q.startsWith('boss:'));
      expect(CONTENT.collection('recipes').has(`rezept_${item.id}`), item.id).toBe(!bossTrophy);
    }
    expect(bauteile.every((i) => i.kategorie === 'bauteil')).toBe(true);
    expect(bauteile.map((i) => i.id).sort()).toEqual(
      [
        'wand_palisade', 'wand_holz', 'wand_fachwerk', 'wand_stein', 'boden_holz', 'boden_stein', 'boden_lehm', 'dach_stroh', 'dach_schindel', 'dach_glas',
        'tuer_holz', 'tuer_verstaerkt', 'tor_holz', 'falltuer_holz', 'fenster_offen', 'fenster_glas', 'fenster_buntglas', 'saeule_holz', 'saeule_stein', 'zaun_holz', 'zaun_stein',
        'leiter_holz', 'treppe_holz', 'steg_holz',
      ].sort(),
    );
    const recipes = CONTENT.collection('recipes');
    for (const item of bauteile) {
      expect(parts.has(item.id), item.id).toBe(true);
      expect(recipes.has(`rezept_${item.id}`), item.id).toBe(true);
      // Tier after the material (§16.2: palisade, wood, straw T0; timber frame, stone, glass T1).
      expect(item.stufe, item.id).toBe(BALANCE.building.materials[parts.get(item.id).material].tier === 1 || item.id === 'dach_schindel' || item.id === 'tuer_verstaerkt' ? 1 : 0);
    }
    expect(CONTENT.countsByCategory().buildParts).toBeGreaterThanOrEqual(bauteile.length);
  });
});

describe('Belegung der Ebenen (§16.1)', () => {
  it('Boden, Struktur, Objekt, Wandobjekt und Dach liegen übereinander; dieselbe Ebene ist blockiert', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 12);
    expect(w.build('wand_holz', 12, 8)).toBeNull();
    expect(w.build('boden_holz', 12, 9)).toBeNull();
    expect(w.build('probe_moebel_kiste', 12, 9)).toBeNull();
    expect(w.build('probe_moebel_bild', 12, 9)).toBeNull();
    expect(w.build('dach_stroh', 12, 9)).toBeNull();
    for (const layer of ['boden', 'objekt', 'wandobjekt', 'dach'] as const) expect(w.building.partAt(0, layer, OFFSET + 12, OFFSET + 9), layer).toBeDefined();
    // One part per layer and tile; structure and object exclude each other.
    expect(w.build('boden_stein', 12, 9)).toBe('blocked');
    expect(w.build('wand_holz', 12, 9)).toBe('blocked');
    expect(w.build('probe_moebel_vase', 12, 9)).toBe('blocked');
    expect(w.build('probe_moebel_vase', 12, 8)).toBe('blocked');
    expect(w.count('boden_stein') + w.count('wand_holz') + w.count('probe_moebel_vase')).toBe(4);
  });

  it('Objekte 1×1 bis 4×4 belegen ihre (gedrehte) Stellfläche; der Anker ist die Nordwest-Kachel', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(9, 12);
    expect(w.build('probe_moebel_gross', 6, 6)).toBeNull();
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) expect(cellPart(cell(w, OBJECT, x, y)), `${x},${y}`).not.toBe(0);
    const covered = cell(w, OBJECT, 9, 8);
    expect(cellCovered(covered)).toBe(true);
    expect([cellDx(covered), cellDy(covered)]).toEqual([3, 2]);
    // A table 2 × 1, turned a quarter: 1 × 2.
    expect(w.build('probe_moebel_tisch', 12, 6, 1)).toBeNull();
    expect(cellPart(cell(w, OBJECT, 12, 7))).not.toBe(0);
    expect(cell(w, OBJECT, 13, 6)).toBe(0);
    expect(cellRot(cell(w, OBJECT, 12, 6))).toBe(1);
    // Overlapping footprints are blocked; so is a footprint over a tree.
    expect(w.build('probe_moebel_tisch', 11, 7)).toBe('blocked');
    const tree = bauWelt([...meadow(24, 24).slice(0, 5), '..........T.............', ...meadow(24, 18)]);
    tree.spawn(10, 8);
    expect(tree.build('probe_moebel_tisch', 9, 5)).toBe('blocked');
    expect(tree.build('wand_holz', 10, 5)).toBe('blocked');
  });

  it('Baureichweite 8 Tiles: „Zu weit“; ohne Bauteil in den Taschen: fehlendes Material', () => {
    const w = bauWelt(meadow(40, 24));
    w.spawn(10, 10);
    expect(w.build('wand_holz', 18, 10)).toBeNull();
    expect(w.build('wand_holz', 20, 10)).toBe('tooFar');
    const events = w.act({ type: 'build.place', part: 'wand_stein', tx: OFFSET + 11, ty: OFFSET + 10 });
    expect(w.rejection(events)).toBe('noMaterial');
    expect(w.rejection(w.act({ type: 'build.place', part: 'gibt_es_nicht', tx: OFFSET + 11, ty: OFFSET + 10 }))).toBe('unknownPart');
  });

  it('kein Bauen auf Fels, Wasser (ohne Steg) oder unter den Füßen des Spielers', () => {
    const w = bauWelt(['........', '..#.ww..', '........', '........']);
    w.spawn(1, 3);
    expect(w.build('wand_holz', 2, 1)).toBe('blocked');
    expect(w.build('boden_holz', 4, 1)).toBe('blocked');
    expect(w.build('wand_holz', 4, 1)).toBe('blocked');
    expect(w.build('wand_holz', 1, 3)).toBe('blocked');
    expect(w.build('boden_holz', 1, 3)).toBeNull();
  });
});

describe('Kollision (Wände, Türen, Zäune, Möbel)', () => {
  it('Wände sind massiv (blockieren Bewegung und Licht), Zäune, Fenster, Säulen und Möbel sind Objekte, Böden und Teppiche nichts', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 12);
    for (const [part, x] of [['wand_holz', 6], ['zaun_holz', 7], ['fenster_glas', 8], ['saeule_holz', 9], ['probe_moebel_kiste', 11], ['boden_holz', 12], ['probe_moebel_teppich', 13]] as const) {
      expect(w.build(part, x, 8), part).toBeNull();
    }
    expect(info(w, 6, 8) & BLOCK_SOLID).not.toBe(0);
    for (const x of [7, 8, 9, 11]) expect(info(w, x, 8) & (BLOCK_OBJECT | BLOCK_SOLID), `x ${x}`).toBe(BLOCK_OBJECT);
    for (const x of [12, 13, 14]) expect(info(w, x, 8) & (BLOCK_OBJECT | BLOCK_SOLID), `x ${x}`).toBe(0);
    // The player walks into the wall and stops before it.
    const before = w.pos();
    w.run(90, [{ type: 'player.move', dx: 0, dy: -1 }]);
    expect(w.pos().y).toBeLessThan(before.y);
    w.run(1, [{ type: 'player.move', dx: 0, dy: 0 }]);
    w.run(1, [{ type: 'player.teleport', x: w.px(6, 10).x, y: w.px(6, 10).y, layer: 0 }]);
    w.run(120, [{ type: 'player.move', dx: 0, dy: -1 }]);
    expect(w.pos().y).toBeGreaterThan((OFFSET + 9) * 16);
  });

  it('Türen öffnen und schließen: geschlossen massiv, offen begehbar; nicht über dem Spieler schließen', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 12);
    expect(w.build('tuer_holz', 10, 8)).toBeNull();
    expect(info(w, 10, 8) & BLOCK_SOLID).not.toBe(0);
    const opened = w.act({ type: 'build.door', tx: OFFSET + 10, ty: OFFSET + 8 });
    expect(opened.get('doorToggled')).toEqual([expect.objectContaining({ part: 'tuer_holz', open: true })]);
    expect(cellOpen(cell(w, STRUCTURE, 10, 8))).toBe(true);
    expect(info(w, 10, 8) & BLOCK_SOLID).toBe(0);
    // Walk through the open door.
    w.run(100, [{ type: 'player.move', dx: 0, dy: -1 }]);
    expect(w.pos().y).toBeLessThan((OFFSET + 8) * 16);
    w.run(1, [{ type: 'player.move', dx: 0, dy: 0 }]);
    w.run(1, [{ type: 'player.teleport', x: w.px(10, 8).x, y: w.px(10, 8).y, layer: 0 }]);
    expect(w.rejection(w.act({ type: 'build.door', tx: OFFSET + 10, ty: OFFSET + 8, open: false }))).toBe('doorwayBlocked');
    w.run(1, [{ type: 'player.teleport', x: w.px(10, 11).x, y: w.px(10, 11).y, layer: 0 }]);
    expect(w.rejection(w.act({ type: 'build.door', tx: OFFSET + 10, ty: OFFSET + 8, open: false }))).toBeNull();
    expect(info(w, 10, 8) & BLOCK_SOLID).not.toBe(0);
    // A gate is two tiles wide and opens as one; a wall is no door.
    expect(w.build('tor_holz', 12, 8)).toBeNull();
    w.act({ type: 'build.door', tx: OFFSET + 13, ty: OFFSET + 8 });
    expect([cellOpen(cell(w, STRUCTURE, 12, 8)), cellOpen(cell(w, STRUCTURE, 13, 8))]).toEqual([true, true]);
    expect(w.build('wand_holz', 15, 8)).toBeNull();
    expect(w.rejection(w.act({ type: 'build.door', tx: OFFSET + 15, ty: OFFSET + 8 }))).toBe('notADoor');
  });

  it('Nachbarmaske der modularen Sprites: Wände verbinden mit Türen und Fenstern, Zäune mit Toren', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 12);
    for (const [part, x] of [['wand_holz', 6], ['tuer_holz', 7], ['fenster_offen', 8], ['zaun_holz', 9]] as const) expect(w.build(part, x, 8)).toBeNull();
    const catalog = w.building.catalog;
    const mask = (x: number): number => connectMask(w.building.structures, catalog, 0, STRUCTURE, OFFSET + x, OFFSET + 8);
    expect([mask(6), mask(7), mask(8), mask(9)]).toEqual([2, 2 | 8, 8, 0]);
  });
});

describe('Wasserbauten auf Pfählen (§16.1)', () => {
  it('ein Steg steht nur im Wasser, überbrückt tiefes Wasser und trägt Wände; ohne Steg kein Bau im Wasser', () => {
    const w = bauWelt(['........', '........', 'wwwwwwww', 'wwwwwwww', '........']);
    w.spawn(3, 0);
    expect(w.build('steg_holz', 3, 1)).toBe('needsWater');
    expect(info(w, 3, 2) & BLOCK_DEEP_WATER).not.toBe(0);
    expect(w.build('steg_holz', 3, 2)).toBeNull();
    expect(w.build('steg_holz', 3, 3)).toBeNull();
    expect(info(w, 3, 2) & BLOCK_DEEP_WATER).toBe(0);
    // A stilt house: a wall on the jetty; next to it, without piles, nothing stands in the water.
    expect(w.build('wand_holz', 3, 3)).toBeNull();
    expect(w.build('wand_holz', 4, 3)).toBe('blocked');
    // The jetty carries the wall: it cannot be dismantled until the wall is gone.
    expect(w.rejection(w.act({ type: 'build.remove', tx: OFFSET + 3, ty: OFFSET + 3, ebene: 'boden' }))).toBe('carriesLoad');
    // The player walks onto the jetty without swimming.
    w.run(60, [{ type: 'player.move', dx: 0, dy: 1 }]);
    expect(w.body().state).not.toBe('swim');
    expect(w.pos().y).toBeGreaterThan((OFFSET + 2) * 16);
  });
});

describe('Wandobjekte, Leitern und Treppen', () => {
  it('Wandobjekte hängen an der Wand nördlich ihres Tiles; fällt die Wand, fallen sie ab', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 12);
    expect(w.build('probe_moebel_bild', 10, 9)).toBe('needsWall');
    expect(w.build('wand_holz', 10, 8)).toBeNull();
    expect(w.build('probe_moebel_bild', 10, 9)).toBeNull();
    const events = w.act({ type: 'build.remove', tx: OFFSET + 10, ty: OFFSET + 8 });
    const removed = (events.get('partRemoved') ?? []) as Array<{ part: string; reason: string }>;
    expect(removed.map((r) => [r.part, r.reason])).toEqual([
      ['wand_holz', 'abgebaut'],
      ['probe_moebel_bild', 'abgefallen'],
    ]);
    expect(w.dropped.map((d) => d.stack.item)).toEqual(['probe_moebel_bild']);
  });

  it('eine Leiter lehnt an einer Klippenwand und ist eine Kletterhilfe; eine Treppe verbindet eine Höhenstufe begehbar', () => {
    // Plateau of level 1 in the north (rows 0–5); its cliff face is row 6, below the edge.
    const rows = [...Array.from({ length: 6 }, () => '11111111'), '........', '........', '........'];
    const w = bauWelt(rows);
    w.spawn(2, 8);
    expect(info(w, 2, 6) & BLOCK_WALL).not.toBe(0);
    expect(w.build('leiter_holz', 2, 7)).toBe('needsCliff');
    expect(w.build('leiter_holz', 2, 6)).toBeNull();
    expect(w.building.ladderAt(0, OFFSET + 2, OFFSET + 6)).toBe(true);
    // Stairs north up the face: face and edge join the two levels; eastwards there is no step here.
    expect(w.build('treppe_holz', 5, 6, 1)).toBe('needsCliff');
    expect(w.build('treppe_holz', 5, 6, 0)).toBeNull();
    const face = info(w, 5, 6);
    expect(face & BLOCK_WALL).toBe(0);
    expect(face & INFO_CONNECTOR).not.toBe(0);
    expect(info(w, 5, 5) & INFO_CONNECTOR).not.toBe(0);
    expect(infoLevel(info(w, 5, 5))).toBe(1);
    // The player walks up the stairs onto the plateau.
    w.run(1, [{ type: 'player.teleport', x: w.px(5, 8).x, y: w.px(5, 8).y, layer: 0 }]);
    w.run(60, [{ type: 'player.move', dx: 0, dy: -1 }]);
    expect(w.pos().y).toBeLessThan((OFFSET + 5) * 16);
    expect(w.body().level).toBe(1);
  });
});

describe('Abbauen, Aufwerten, Blaupausen (§16.6)', () => {
  it('Abbauen gibt in den ersten 30 s das Bauteil ganz zurück, danach 60 % seines Materials', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 12);
    expect(w.build('wand_palisade', 10, 8)).toBeNull();
    expect(w.building.placedTick(0, 'struktur', OFFSET + 10, OFFSET + 8)).toBe(w.sim.tick - 1);
    const early = w.act({ type: 'build.remove', tx: OFFSET + 10, ty: OFFSET + 8 });
    expect(early.get('partRemoved')).toEqual([expect.objectContaining({ part: 'wand_palisade', refund: 'ganz' })]);
    expect(w.count('wand_palisade')).toBe(1);
    expect(w.build('wand_palisade', 10, 8)).toBeNull();
    w.run(BALANCE.building.refund.fullSeconds * TICK_HZ + 1);
    const late = w.act({ type: 'build.remove', tx: OFFSET + 10, ty: OFFSET + 8 });
    expect(late.get('partRemoved')).toEqual([expect.objectContaining({ refund: 'anteilig' })]);
    // Palisade = 3 logs + 1 rope: 60 % ⇒ 1,8 → 1 log, 0,6 → no rope – rounded down, never more than 60 % (review M4
    // #10; half-up rounding gave the rope back whole). The piece given back early is still in the bags.
    expect([w.count('wand_palisade'), w.count('holz'), w.count('faserseil')]).toEqual([1, 1, 0]);
    expect(w.rejection(w.act({ type: 'build.remove', tx: OFFSET + 10, ty: OFFSET + 8 }))).toBe('nothingHere');
  });

  it('Material eines Bauteils: Rezeptzutaten je Stück; Anteile summiert und abgerundet', () => {
    const book = contentMaterialBook();
    expect(book.materials('wand_holz')).toEqual([{ item: 'brett', perPiece: 3 }]);
    expect(book.materials('zaun_holz')).toEqual([
      { item: 'zweig', perPiece: 2 },
      { item: 'holz', perPiece: 0.5 },
    ]);
    // 3 fences at 50 %: 3 twigs, 0,75 logs → none (rounded down, review M4 #10).
    expect(book.refund([{ part: 'zaun_holz', pieces: 3 }], 0.5)).toEqual([{ item: 'zweig', count: 3 }]);
    // A part no recipe makes is its own material: one piece at 60 % is none (rounded down, review M4 #10), two are one.
    expect(new MaterialBook([]).materials('probe')).toEqual([{ item: 'probe', perPiece: 1 }]);
    expect(new MaterialBook([]).refund([{ part: 'probe', pieces: 1 }], 0.6)).toEqual([]);
    expect(new MaterialBook([]).refund([{ part: 'probe', pieces: 2 }], 0.6)).toEqual([{ item: 'probe', count: 1 }]);
  });

  it('Aufwerten an Ort und Stelle: Holz → Stein kostet das neue Teil, gibt das alte zurück und behält Drehung und Türstand', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 12);
    expect(w.build('wand_holz', 10, 8)).toBeNull();
    w.inventory.give(w.sim, 'wand_stein', 1);
    const events = w.act({ type: 'build.upgrade', tx: OFFSET + 10, ty: OFFSET + 8, part: 'wand_stein' });
    expect(events.get('partUpgraded')).toEqual([expect.objectContaining({ from: 'wand_holz', to: 'wand_stein' })]);
    expect(w.building.partAt(0, 'struktur', OFFSET + 10, OFFSET + 8)?.id).toBe('wand_stein');
    expect(w.building.structures.hp(0, STRUCTURE, OFFSET + 10, OFFSET + 8)).toBe(900);
    expect([w.count('wand_stein'), w.count('wand_holz')]).toEqual([0, 1]);
    // Only within the same kind and footprint.
    w.inventory.give(w.sim, 'tuer_holz', 1);
    expect(w.rejection(w.act({ type: 'build.upgrade', tx: OFFSET + 10, ty: OFFSET + 8, part: 'tuer_holz' }))).toBe('notUpgradable');
    expect(w.build('tuer_holz', 12, 8)).toBeNull();
    w.act({ type: 'build.door', tx: OFFSET + 12, ty: OFFSET + 8 });
    w.inventory.give(w.sim, 'tuer_verstaerkt', 1);
    w.act({ type: 'build.upgrade', tx: OFFSET + 12, ty: OFFSET + 8, part: 'tuer_verstaerkt' });
    expect(cellOpen(cell(w, STRUCTURE, 12, 8))).toBe(true);
  });

  it('Blaupausen kosten nichts, kollidieren nicht und werden mit dem Hammer aus den Taschen fertiggestellt', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 12);
    const placed = w.act({ type: 'build.blueprint', part: 'wand_stein', tx: OFFSET + 10, ty: OFFSET + 8 });
    expect(placed.get('partPlaced')).toEqual([expect.objectContaining({ part: 'wand_stein', blueprint: true })]);
    expect(info(w, 10, 8) & BLOCK_SOLID).toBe(0);
    expect(w.rejection(w.act({ type: 'build.complete', tx: OFFSET + 10, ty: OFFSET + 8 }))).toBe('noHammer');
    w.inventory.give(w.sim, 'steinhammer', 1);
    const hammerSlot = w.inventory.state.schnellleiste.findIndex((s) => s?.item === 'steinhammer');
    w.act({ type: 'player.selectHotbar', index: hammerSlot });
    expect(w.rejection(w.act({ type: 'build.complete', tx: OFFSET + 10, ty: OFFSET + 8 }))).toBe('noMaterial');
    w.inventory.give(w.sim, 'wand_stein', 1);
    const done = w.act({ type: 'build.complete', tx: OFFSET + 10, ty: OFFSET + 8 });
    expect(done.get('blueprintCompleted')).toEqual([expect.objectContaining({ part: 'wand_stein' })]);
    expect(info(w, 10, 8) & BLOCK_SOLID).not.toBe(0);
    expect(w.count('wand_stein')).toBe(0);
    expect(w.rejection(w.act({ type: 'build.complete', tx: OFFSET + 10, ty: OFFSET + 8 }))).toBe('notABlueprint');
    // Dismantling a blueprint gives nothing back.
    w.act({ type: 'build.blueprint', part: 'wand_holz', tx: OFFSET + 11, ty: OFFSET + 8 });
    expect(w.act({ type: 'build.remove', tx: OFFSET + 11, ty: OFFSET + 8 }).get('partRemoved')).toEqual([expect.objectContaining({ refund: 'keine' })]);
  });

  it('Geister-Vorschau (§16.6): dieselben Gründe wie der Befehl, ohne etwas zu setzen oder zu nehmen', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 12);
    const preview = (part: string, x: number, y: number, blueprint = false): string | null => w.building.preview(w.sim, part, OFFSET + x, OFFSET + y, 0, blueprint);
    expect(preview('wand_holz', 10, 8)).toBe('noMaterial');
    expect(preview('wand_holz', 10, 8, true)).toBeNull();
    w.inventory.give(w.sim, 'wand_holz', 1);
    expect(preview('wand_holz', 10, 8)).toBeNull();
    expect(preview('wand_holz', 22, 8)).toBe('tooFar');
    expect(preview('dach_stroh', 10, 8, true)).toBe('noSupport');
    expect(preview('wand_holz', 10, 12)).toBe('blocked');
    expect(w.count('wand_holz')).toBe(1);
    expect(w.building.structures.size).toBe(0);
  });

  it('Bauteil-Zuhörer hören fertige Teile kommen und gehen (Zustand späterer Systeme am Anker), Blaupausen nicht', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 12);
    const heard: string[] = [];
    w.building.addPartListener({ placed: (_s, p, _l, tx, ty) => heard.push(`+${p.id}@${tx - OFFSET},${ty - OFFSET}`), removed: (_s, p) => heard.push(`-${p.id}`) });
    expect(w.build('probe_moebel_tisch', 10, 9)).toBeNull();
    w.act({ type: 'build.blueprint', part: 'wand_holz', tx: OFFSET + 12, ty: OFFSET + 9 });
    w.act({ type: 'build.remove', tx: OFFSET + 11, ty: OFFSET + 9 });
    expect(heard).toEqual(['+probe_moebel_tisch@10,9', '-probe_moebel_tisch']);
  });

  it('das Grasbett wird über das Raster aufgestellt und ist ein Schlafplatz, der den Wiedereinstiegspunkt setzt (M4-34)', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 12);
    expect(w.build('grasbett', 10, 9)).toBeNull();
    expect(w.life.sleep.placeAt(w.sim, 0, OFFSET + 10, OFFSET + 10)).toMatchObject({ kind: 'grasbett', bedroom: false, comfort: 0 });
    w.jumpToHour(20);
    w.run(1, [{ type: 'player.teleport', x: w.px(11, 10).x, y: w.px(11, 10).y, layer: 0 }]);
    const events = w.run(1, [{ type: 'sleep.start', tx: OFFSET + 10, ty: OFFSET + 10 }]);
    expect(events.get('sleepStarted')).toEqual([expect.objectContaining({ place: 'grasbett' })]);
    expect(events.get('respawnPointSet')).toHaveLength(1);
  });

  it('Befehle sind zod-geprüft: Drehung 0–3, Ebenen nach §16.1, Bauteil-Ids', () => {
    expect(parseGameCommand({ type: 'build.place', part: 'wand_holz', tx: 3, ty: 4, rot: 3, mirror: true })).toEqual({ type: 'build.place', part: 'wand_holz', tx: 3, ty: 4, rot: 3, mirror: true });
    expect(parseGameCommand({ type: 'build.remove', tx: 3, ty: 4, ebene: 'dach' })).toEqual({ type: 'build.remove', tx: 3, ty: 4, ebene: 'dach' });
    expect(() => parseGameCommand({ type: 'build.place', part: 'wand_holz', tx: 3, ty: 4, rot: 4 })).toThrow(/rot/);
    expect(() => parseGameCommand({ type: 'build.remove', tx: 3, ty: 4, ebene: 'keller' })).toThrow(/ebene/);
    expect(() => parseGameCommand({ type: 'build.upgrade', tx: 3, ty: 4, part: 'Wand Holz' })).toThrow(/part/);
    expect(() => parseGameCommand({ type: 'build.door', tx: 1.5, ty: 4 })).toThrow(/tx/);
  });

  it('jeder Ablehnungsgrund hat einen Text DE/EN (Geister-Vorschau §16.6, Meldung §26)', () => {
    const i18n = createI18n('de');
    for (const r of BUILD_REJECT_REASONS) for (const lang of LANGS) expect(i18n.has(`ui.build.reject.${r}`, lang), `${lang}:${r}`).toBe(true);
  });

  it('wer tot ist oder schläft, baut nicht', () => {
    const w = bauWelt(meadow(24, 24));
    w.spawn(10, 12);
    w.inventory.give(w.sim, 'wand_holz', 1);
    w.run(1, [{ type: 'death.kill' }]);
    expect(w.rejection(w.act({ type: 'build.place', part: 'wand_holz', tx: OFFSET + 10, ty: OFFSET + 8 }))).toBe('dead');
  });
});
