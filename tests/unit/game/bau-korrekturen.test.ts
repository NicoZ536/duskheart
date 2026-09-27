/**
 * Review M4 – Korrekturen am Bauraster (MASTERPROMPT §16.1, §16.2, §16.3, §16.6):
 * - #9 Aufwerten: nur ein besseres Teil derselben Art, Größe und Möbelkategorie (Material nach §16.2, dann Stufe, dann
 *   Ausbau), keine Abwertung, kein Stuhl zur Kiste; nie ein Teil, das im Weg steht, auf den Spieler – auch nicht beim
 *   Teiltausch einer Station;
 * - #10 spätes Abbauen gibt je Zutat höchstens 60 % zurück (abgerundet), ein Einsturz höchstens 50 %;
 * - #6 eine Blaupause wird nur fertig, wo der Boden noch trägt (keine Wand auf Wasser);
 * - #22 ein Steg, auf dem etwas steht oder hängt – auch Wandmöbel oder Dinge anderer Systeme –, bleibt; eine Falltür,
 *   auf der etwas steht, öffnet nicht;
 * - #20 die Geister-Vorschau eines Dachs legt nach dem ersten Mal keine Puffer mehr an;
 * - #23 die Reparaturkosten nennen jede Zutat einmal, die Flächenreparatur zahlt sie ohne Absturz.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { BUILD_PARTS } from '../../../src/content/buildParts';
import { BuildingSystem } from '../../../src/game/building/system';
import { MaterialBook, contentMaterialBook } from '../../../src/game/building/materials';
import { repairCost } from '../../../src/game/building/repair';
import { WATER_DEPTH_SHALLOW } from '../../../src/world/model/chunk';
import { contentPartCatalog, createPartCatalog, isUpgrade } from '../../../src/world/structures/catalog';
import { cellBlueprint, cellOpen } from '../../../src/world/structures/cells';
import { PROBE_FURNITURE_PARTS, bauItemCatalog } from './bau-testwelt';
import { lagerWelt, px, type LagerWelt } from './lager-testwelt';
import { lifeWorld } from './leben-testwelt';
import { OFFSET, meadow } from './spieler-testwelt';

const B = BALANCE.building;
const TICK_HZ = BALANCE.time.tickHz;
const STRUCTURE = 1;
const FLOOR = 0;

function world(rows: readonly string[] = meadow(40, 20)): LagerWelt {
  return lagerWelt(rows, { x: 10, y: 10 });
}

function goTo(w: LagerWelt, x: number, y: number): void {
  const p = px(x, y);
  w.act({ type: 'player.teleport', x: p.x, y: p.y, layer: 0 });
}

function upgrade(w: LagerWelt, part: string, x: number, y: number): string | null {
  w.give(part, 1);
  return w.rejection(w.act({ type: 'build.upgrade', tx: OFFSET + x, ty: OFFSET + y, part }));
}

function partAt(w: LagerWelt, ebene: 'boden' | 'struktur' | 'objekt' | 'wandobjekt', x: number, y: number): string | undefined {
  return w.building.partAt(0, ebene, OFFSET + x, OFFSET + y)?.id;
}

describe('#9 Aufwerten nach Regeln (§16.6 "Aufwerten an Ort und Stelle (Holz → Stein)")', () => {
  it('die Regel als Daten: Material nach §16.2, dann Stufe, dann Ausbau – Art, Größe und Kategorie gleich', () => {
    const c = contentPartCatalog();
    const up = (a: string, b: string): boolean => isUpgrade(c.get(a), c.get(b));
    expect([up('wand_palisade', 'wand_holz'), up('wand_holz', 'wand_fachwerk'), up('wand_fachwerk', 'wand_stein'), up('wand_holz', 'wand_stein')]).toEqual([true, true, true, true]);
    expect([up('wand_stein', 'wand_holz'), up('wand_holz', 'wand_palisade'), up('wand_holz', 'wand_holz')]).toEqual([false, false, false]);
    expect([up('dach_stroh', 'dach_schindel'), up('dach_schindel', 'dach_glas'), up('dach_schindel', 'dach_stroh')]).toEqual([true, true, false]);
    expect([up('tuer_holz', 'tuer_verstaerkt'), up('tuer_verstaerkt', 'tuer_holz')]).toEqual([true, false]);
    expect([up('fenster_offen', 'fenster_glas'), up('fenster_glas', 'fenster_buntglas'), up('fenster_buntglas', 'fenster_glas')]).toEqual([true, true, false]);
    expect([up('boden_holz', 'boden_lehm'), up('boden_lehm', 'boden_stein'), up('boden_stein', 'boden_holz')]).toEqual([true, true, false]);
    expect([up('kiste_holz', 'truhe'), up('sitzkissen', 'hocker_holz')]).toEqual([true, true]);
    // Another kind, footprint or furniture category is never an upgrade.
    expect([up('stuhl_holz', 'kiste_holz'), up('wand_holz', 'tuer_holz'), up('tuer_holz', 'tor_holz'), up('hocker_holz', 'bank_holz')]).toEqual([false, false, false, false]);
  });

  it('kein Aufwerten gibt einem Dach eine kürzere Reichweite; jede Abwertung wäre eine', () => {
    const roofs = contentPartCatalog().parts.filter((p) => p.kind === 'dach');
    expect(roofs.length).toBeGreaterThanOrEqual(3);
    for (const a of roofs) for (const b of roofs) if (isUpgrade(a, b)) expect(b.roofReach, `${a.id} → ${b.id}`).toBeGreaterThanOrEqual(a.roofReach);
  });

  it('Abwerten, Stuhl → Kiste und Glas → Öffnung werden abgelehnt; das Teil bleibt, das Item auch', () => {
    const w = world();
    expect(w.build('wand_holz', 12, 8)).toBeNull();
    expect(upgrade(w, 'wand_palisade', 12, 8)).toBe('notUpgradable');
    expect([partAt(w, 'struktur', 12, 8), w.count('wand_palisade')]).toEqual(['wand_holz', 1]);
    expect(w.build('wand_palisade', 13, 8)).toBeNull();
    expect(upgrade(w, 'wand_holz', 13, 8)).toBeNull();
    expect(partAt(w, 'struktur', 13, 8)).toBe('wand_holz');
    expect(w.build('stuhl_holz', 12, 12)).toBeNull();
    expect(upgrade(w, 'kiste_holz', 12, 12)).toBe('notUpgradable');
    expect([partAt(w, 'objekt', 12, 12), w.count('kiste_holz')]).toEqual(['stuhl_holz', 1]);
    expect(w.build('fenster_glas', 14, 8)).toBeNull();
    expect(upgrade(w, 'fenster_offen', 14, 8)).toBe('notUpgradable');
    expect(upgrade(w, 'fenster_buntglas', 14, 8)).toBeNull();
    expect(partAt(w, 'struktur', 14, 8)).toBe('fenster_buntglas');
  });

  it('ein Sitzkissen unter dem Spieler wird nicht zum Hocker, der ihn einsperrt; neben ihm schon', () => {
    const w = world();
    // The cushion does not stand in the way: it lies under the player.
    expect(w.build('sitzkissen', 10, 10)).toBeNull();
    expect(upgrade(w, 'hocker_holz', 10, 10)).toBe('blocked');
    expect([partAt(w, 'objekt', 10, 10), w.count('hocker_holz')]).toEqual(['sitzkissen', 1]);
    goTo(w, 12, 10);
    expect(w.rejection(w.act({ type: 'build.upgrade', tx: OFFSET + 10, ty: OFFSET + 10, part: 'hocker_holz' }))).toBeNull();
    expect(partAt(w, 'objekt', 10, 10)).toBe('hocker_holz');
  });

  it('der Teiltausch einer Station setzt nichts Sperrendes auf den Spieler', () => {
    const w = world();
    expect(w.build('sitzkissen', 10, 10)).toBeNull();
    expect(w.building.swapPart(w.sim, 0, 'objekt', OFFSET + 10, OFFSET + 10, 'hocker_holz')).toBe(false);
    expect(partAt(w, 'objekt', 10, 10)).toBe('sitzkissen');
    goTo(w, 12, 10);
    expect(w.building.swapPart(w.sim, 0, 'objekt', OFFSET + 10, OFFSET + 10, 'hocker_holz')).toBe(true);
    expect(partAt(w, 'objekt', 10, 10)).toBe('hocker_holz');
  });
});

describe('#10 spätes Abbauen: höchstens 60 % je Zutat (§16.6), Einsturz höchstens 50 % (§16.3)', () => {
  it('abgerundet: eine Zutat, die ein Teil einmal braucht, kommt spät nicht zurück', () => {
    const book = contentMaterialBook();
    expect(B.refund.lateShare).toBe(0.6);
    // Stone floor = 1 stone block, wooden pillar = 1 beam: 0,6 → 0 (half-up rounding gave them back whole).
    expect(book.refund([{ part: 'boden_stein', pieces: 1 }], B.refund.lateShare)).toEqual([]);
    expect(book.refund([{ part: 'saeule_holz', pieces: 1 }], B.refund.lateShare)).toEqual([]);
    // Stone wall = 2 blocks + 1 plaster: 1,2 → 1 block, 0,6 → no plaster.
    expect(book.refund([{ part: 'wand_stein', pieces: 1 }], B.refund.lateShare)).toEqual([{ item: 'steinblock', count: 1 }]);
    // Never more than the share of any ingredient of any part.
    for (const p of contentPartCatalog().parts) {
      const back = book.refund([{ part: p.id, pieces: 1 }], B.refund.lateShare);
      for (const a of back) {
        const had = book.materials(p.id).filter((m) => m.item === a.item).reduce((n, m) => n + m.perPiece, 0);
        expect(a.count, `${p.id}: ${a.item}`).toBeLessThanOrEqual(had * B.refund.lateShare + 1e-9);
      }
    }
  });

  it('im Spiel: die Säule gibt nach 30 s nichts, die Steinwand einen Block zurück', () => {
    const w = world();
    expect(w.build('saeule_holz', 12, 8)).toBeNull();
    expect(w.build('wand_stein', 13, 8)).toBeNull();
    w.run(B.refund.fullSeconds * TICK_HZ + 1);
    const pillar = w.act({ type: 'build.remove', tx: OFFSET + 12, ty: OFFSET + 8 });
    expect(pillar.get('partRemoved')).toEqual([expect.objectContaining({ part: 'saeule_holz', refund: 'anteilig' })]);
    expect([w.count('saeule_holz'), w.count('balken')]).toEqual([0, 0]);
    w.act({ type: 'build.remove', tx: OFFSET + 13, ty: OFFSET + 8 });
    expect([w.count('steinblock'), w.count('lehmputz')]).toEqual([1, 0]);
  });
});

describe('#6 Fertigstellen prüft den Boden erneut', () => {
  it('eine Wand-Blaupause auf inzwischen überflutetem Boden wird nicht fertig – nichts wird genommen; trocken wieder ja', () => {
    const w = world();
    const tx = OFFSET + 12;
    const ty = OFFSET + 8;
    expect(w.rejection(w.act({ type: 'build.blueprint', part: 'wand_holz', tx, ty }))).toBeNull();
    // The ground under the plan turns to water (a ditch, a flood).
    const { chunk, i } = w.chunks.at(tx, ty);
    chunk.water[i] = WATER_DEPTH_SHALLOW;
    w.collision.invalidateTile(0, tx, ty);
    w.hold('steinhammer');
    w.give('wand_holz', 1);
    expect(w.rejection(w.act({ type: 'build.complete', tx, ty }))).toBe('blocked');
    expect(cellBlueprint(w.building.structures.cell(0, STRUCTURE, tx, ty))).toBe(true);
    expect(w.count('wand_holz')).toBe(1);
    chunk.water[i] = 0;
    w.collision.invalidateTile(0, tx, ty);
    expect(w.rejection(w.act({ type: 'build.complete', tx, ty }))).toBeNull();
    expect(cellBlueprint(w.building.structures.cell(0, STRUCTURE, tx, ty))).toBe(false);
    expect(w.count('wand_holz')).toBe(0);
  });
});

describe('#22 was auf Steg oder Falltür steht, hält sie', () => {
  /** Water from row 6 down, the player on the shore. */
  function lake(): LagerWelt {
    const rows = meadow(40, 20).map((r, y) => (y >= 6 && y < 14 ? `${r.slice(0, 10)}${'w'.repeat(10)}${r.slice(20)}` : r));
    return lagerWelt(rows, { x: 12, y: 4 });
  }

  it('ein Steg, an dessen Wand ein Wandmöbel über ihm hängt, bleibt; ohne Last lässt er sich abbauen', () => {
    const w = lake();
    for (const y of [6, 7]) expect(w.build('steg_holz', 12, y)).toBeNull();
    expect(w.build('wand_holz', 12, 6)).toBeNull();
    expect(w.build('regal_wand', 12, 7)).toBeNull();
    expect(w.rejection(w.act({ type: 'build.remove', tx: OFFSET + 12, ty: OFFSET + 7, ebene: 'boden' }))).toBe('carriesLoad');
    expect(partAt(w, 'boden', 12, 7)).toBe('steg_holz');
    expect(w.rejection(w.act({ type: 'build.remove', tx: OFFSET + 12, ty: OFFSET + 7, ebene: 'wandobjekt' }))).toBeNull();
    expect(w.rejection(w.act({ type: 'build.remove', tx: OFFSET + 12, ty: OFFSET + 7, ebene: 'boden' }))).toBeNull();
  });

  it('ein Steg, auf dem ein anderes System etwas aufgestellt hat (Station, Fackel), bleibt', () => {
    const w = lake();
    expect(w.build('steg_holz', 13, 6)).toBeNull();
    // A station or a torch of another system stands on the jetty (the occupancy providers of createSimulation).
    const on = { tx: OFFSET + 13, ty: OFFSET + 6 };
    w.building.addOccupancy((_s, _layer, tx, ty) => tx === on.tx && ty === on.ty);
    expect(w.rejection(w.act({ type: 'build.remove', ...on, ebene: 'boden' }))).toBe('carriesLoad');
    expect(partAt(w, 'boden', 13, 6)).toBe('steg_holz');
  });

  it('eine Falltür unter einem Tisch öffnet nicht; frei schon', () => {
    const w = world();
    expect(w.build('falltuer_holz', 12, 8)).toBeNull();
    expect(w.build('tisch_holz', 12, 8)).toBeNull();
    expect(w.rejection(w.act({ type: 'build.door', tx: OFFSET + 12, ty: OFFSET + 8 }))).toBe('carriesLoad');
    expect(cellOpen(w.building.structures.cell(0, FLOOR, OFFSET + 12, OFFSET + 8))).toBe(false);
    w.act({ type: 'build.remove', tx: OFFSET + 12, ty: OFFSET + 8, ebene: 'objekt' });
    expect(w.rejection(w.act({ type: 'build.door', tx: OFFSET + 12, ty: OFFSET + 8 }))).toBeNull();
    expect(cellOpen(w.building.structures.cell(0, FLOOR, OFFSET + 12, OFFSET + 8))).toBe(true);
  });
});

describe('#20 Vorschau ohne Puffer je Aufruf', () => {
  it('die Geister-Vorschau eines Dachs legt nach dem ersten Mal keine Typed Arrays mehr an', () => {
    const w = world();
    expect(w.build('wand_holz', 12, 8)).toBeNull();
    const ask = (): string | null => w.building.preview(w.sim, 'dach_stroh', OFFSET + 13, OFFSET + 8);
    expect(ask()).toBe('noMaterial');
    const counted = { n: 0 };
    const original = { i16: globalThis.Int16Array, u8: globalThis.Uint8Array };
    const count = <T extends object>(ctor: T): T =>
      new Proxy(ctor, {
        construct(target, args, newTarget) {
          counted.n++;
          return Reflect.construct(target as unknown as new (...a: unknown[]) => object, args, newTarget) as object;
        },
      });
    try {
      globalThis.Int16Array = count(original.i16);
      globalThis.Uint8Array = count(original.u8);
      for (let k = 0; k < 50; k++) ask();
    } finally {
      globalThis.Int16Array = original.i16;
      globalThis.Uint8Array = original.u8;
    }
    expect(counted.n).toBe(0);
  });
});

describe('#23 Reparaturkosten mit doppelt genannter Zutat', () => {
  it('repairCost fasst dieselbe Zutat zusammen (vor dem Aufrunden)', () => {
    const cost = repairCost(
      [
        { item: 'brett', perPiece: 2 },
        { item: 'holz', perPiece: 1 },
        { item: 'brett', perPiece: 1 },
      ],
      0,
      300,
      0.5,
    );
    expect(cost).toEqual([
      { item: 'brett', count: 2 },
      { item: 'holz', count: 1 },
    ]);
  });

  it('die Flächenreparatur zahlt ein Teil mit doppelt genannter Zutat ohne Absturz – oder lässt es, wenn es nicht reicht', () => {
    const w = lifeWorld(meadow(24, 24), 1, bauItemCatalog());
    // A wall whose recipe names planks twice (a group resolving to planks and planks themselves).
    const materials = new MaterialBook([
      {
        id: 'rezept_wand_holz',
        product: 'wand_holz',
        pieces: 1,
        inputs: [
          { item: 'brett', count: 2 },
          { item: 'brett', count: 2 },
        ],
      },
    ]);
    const building = w.sim.addSystem(new BuildingSystem({ player: w.player, inventory: w.inventory, collision: w.collision, drops: () => undefined, catalog: createPartCatalog([...BUILD_PARTS, ...PROBE_FURNITURE_PARTS]), materials }));
    w.spawn(10, 12);
    w.inventory.give(w.sim, 'wand_holz', 1);
    w.run(1, [{ type: 'build.place', part: 'wand_holz', tx: OFFSET + 10, ty: OFFSET + 8 }]);
    expect(building.partAt(0, 'struktur', OFFSET + 10, OFFSET + 8)?.id).toBe('wand_holz');
    building.damage(w.sim, 0, 'struktur', OFFSET + 10, OFFSET + 8, 300 - 1);
    w.inventory.give(w.sim, 'steinhammer', 1);
    const hammer = w.inventory.state.schnellleiste.findIndex((s) => s?.item === 'steinhammer');
    w.run(1, [{ type: 'player.selectHotbar', index: hammer }]);
    // 4 planks a piece, half of them for a wall at 1 HP: 2 planks – with 1 plank in the bags nothing is taken.
    w.inventory.give(w.sim, 'brett', 1);
    const repair = { type: 'build.repair' as const, tx0: OFFSET + 9, ty0: OFFSET + 7, tx1: OFFSET + 11, ty1: OFFSET + 9 };
    expect(() => w.run(1, [repair])).not.toThrow();
    expect([building.structures.hp(0, STRUCTURE, OFFSET + 10, OFFSET + 8), w.inventory.count('brett')]).toEqual([1, 1]);
    w.inventory.give(w.sim, 'brett', 1);
    w.run(1, [repair]);
    expect([building.structures.hp(0, STRUCTURE, OFFSET + 10, OFFSET + 8), w.inventory.count('brett')]).toEqual([300, 0]);
  });
});
