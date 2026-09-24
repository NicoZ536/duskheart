/**
 * M3-15 Werkzeuge T0 + Sammel-Feedback (MASTERPROMPT §13.2, §14, §D; docs/SPIEL.md §6):
 * - Steinaxt, Steinspitzhacke, Steinschaufel, Steinhacke, Steinsichel, Steinhammer, Steinmesser, Holzeimer
 *   (leer und voll) mit Abbaukraft 1 (§13.2 T0) und Haltbarkeit 60 (§D T0); der Validator zählt ≥ 60 Items.
 * - Die Werkzeuge arbeiten in der Welt: Axt fällt (5 Hiebe, §D), Spitzhacke bricht Fels und Kupfer, zu hart
 *   für Härte 3 („Zu hart“), Schaufel gräbt, Hacke legt Felder an, Sichel schneidet Schilf; jeder Treffer
 *   kostet eine Nutzung, ein kaputtes Werkzeug bleibt und arbeitet nicht.
 * - `player.useItem`: Verband stillt Blutung, der volle Eimer wird ausgegossen (durchnässt, löscht Brennen,
 *   nutzt den Eimer ab), Essen geht an die Aktionen, Werkzeuge sind so nicht benutzbar.
 * - Sammel-Feedback: Schlagpunkt auf der Seite zum Spieler in Handhöhe, Splitter vom Spieler weg, Zerbersten
 *   beim letzten Treffer, „Kaputt!“, Wasserspritzer, Fasern, Werkstücke; das Screenshot-Szenario
 *   `sammeln-feedback` läuft headless mit jedem Ereignis zu seinem Tick.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { BUCKETS } from '../../../src/content/items/werkzeuge';
import { CURES } from '../../../src/content/items/grundlagen';
import type { ItemToolKind } from '../../../src/content/schema/item';
import type { DropSystem } from '../../../src/game/drops/system';
import type { InteractionSystem } from '../../../src/game/interaction/system';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { newStack } from '../../../src/game/items/stack';
import { BOOT_SESSION_SEED } from '../../../src/game/session';
import { createSimulation } from '../../../src/game/setup';
import type { SimEventMap } from '../../../src/game/sim';
import { STAT_MAX } from '../../../src/game/survival/formulas';
import { curable, pouredBucket, tierDurability, toolPower } from '../../../src/game/tools/formulas';
import { ToolsSystem } from '../../../src/game/tools/system';
import { worldFor } from '../../../src/game/worldCache';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { AtlasData, AtlasManifest } from '../../../src/render/assets/atlas';
import type { SpriteDesc } from '../../../src/render/batch/spriteList';
import { GatherEffects, MATERIAL_PARTICLES, ORE_TINTS, PARTICLE_SPRITES, USE_TINTS, chipTint } from '../../../src/render/game/effects';
import { FEEDBACK_SPOT, FEEDBACK_TICKS, FEEDBACK_TOOL, feedbackScript, feedbackSetup } from '../../../src/render/game/effectsScenario';
import { RenderScene } from '../../../src/render/scene';
import { WorldRenderTables } from '../../../src/render/world/tables';
import { BLOCK_ALL, CollisionGrid, infoLevel } from '../../../src/world/collision/tiles';
import { generateChunk } from '../../../src/world/gen/chunk';
import type { ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_SIZE, TILE_PX, packChunkId, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { worldDimensions } from '../../../src/world/model/worldSize';
import { field, gatherWorld, type GatherWorld } from './interaktion-testwelt';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { meadow } from './spieler-testwelt';

const catalog = contentItemCatalog();

/** The canonical T0 tool ids of docs/SPIEL.md §6. */
function canonicalTools(): string[] {
  const doc = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');
  const line = doc.split('\n').find((l) => l.includes('**Werkzeuge T0 (M3-15)**'));
  if (line === undefined) throw new Error('docs/SPIEL.md §6 lists no T0 tools');
  return [...line.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1] as string);
}

/** Holds E until the running action stops; returns the events. */
function work(w: GatherWorld, max = 600): Map<string, unknown[]> {
  const ev = w.runUntil(() => !w.interaction.working, max, [{ type: 'player.interact', on: true }]);
  w.run(1, [{ type: 'player.interact', on: false }]);
  return ev;
}

describe('M3-15: die Werkzeuge T0', () => {
  it('jede kanonische Id aus docs/SPIEL.md §6: Werkzeug der Stufe T0, Abbaukraft 1, Haltbarkeit 60, eine Art je Werkzeug', () => {
    const kinds: Record<string, ItemToolKind> = {
      steinaxt: 'axt',
      steinspitzhacke: 'spitzhacke',
      steinschaufel: 'schaufel',
      steinhacke: 'hacke',
      steinsichel: 'sichel',
      steinhammer: 'hammer',
      steinmesser: 'messer',
      holzeimer: 'eimer',
      holzeimer_wasser: 'eimer',
    };
    expect(canonicalTools()).toEqual(Object.keys(kinds));
    for (const [id, art] of Object.entries(kinds)) {
      const def = catalog.get(id);
      expect(def, id).toMatchObject({ kategorie: 'werkzeug', stufe: 0, stapel: 1, haltbarkeit: 60, werkzeug: { art, abbaukraft: 1 } });
      expect(def.haltbarkeit).toBe(BALANCE.items.durabilityByTier[0]);
    }
  });

  it('jedes Werkzeug und jede Grundlage klingt nach einem vorhandenen SFX-Preset (Aufheben, Benutzen)', () => {
    for (const id of [...canonicalTools(), 'faserseil', 'fackel', 'lagerfeuer', 'werkbank', 'verband', 'grasbett', 'steinspeer']) {
      const { aufheben, benutzen } = catalog.get(id).sounds;
      expect(CONTENT.has('sfx', aufheben), `${id}: ${aufheben}`).toBe(true);
      if (benutzen !== undefined) expect(CONTENT.has('sfx', benutzen), `${id}: ${benutzen}`).toBe(true);
    }
  });

  it('§13.2 Abbaukraft T0 1 … T7 8, §D Haltbarkeit T0 60 … T7 1200', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(toolPower)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(tierDurability)).toEqual([60, 150, 250, 400, 550, 700, 900, 1200]);
    expect(() => toolPower(8)).toThrow(RangeError);
    expect(() => tierDurability(-1)).toThrow(RangeError);
    // The stone spear: T0 base damage × the spear's class factor (§D: 8 × 0,95).
    expect(catalog.get('steinspeer').werte?.schaden).toBeCloseTo(7.6, 10);
  });

  it('der Validator zählt ≥ 60 Items, und die Zielwerte-Datei verlangt sie', () => {
    expect(CONTENT.countsByCategory().items).toBeGreaterThanOrEqual(60);
    const targets = JSON.parse(readFileSync(join(process.cwd(), 'tools/validator/zielwerte.json'), 'utf8')) as { ziele: { items: number } };
    expect(targets.ziele.items).toBeGreaterThanOrEqual(60);
    expect(targets.ziele.items).toBeLessThanOrEqual(CONTENT.countsByCategory().items ?? 0);
  });
});

describe('M3-15: die Werkzeuge arbeiten', () => {
  it('die Steinaxt fällt eine Eiche in fünf Hieben (§D) und verliert je Hieb eine Nutzung', () => {
    const w = gatherWorld(field(14, 12, ['', '', '', '', '', '.....E']));
    w.spawn(5, 7);
    w.hold('steinaxt');
    const ev = work(w);
    expect(ev.get('harvestHit')).toHaveLength(5);
    expect(ev.get('treeFelled')).toHaveLength(1);
    expect(w.inventory.selected()?.haltbarkeit).toBe(60 - 5);
  });

  it('die Steinspitzhacke bricht Fels und Kupfer; einen Eiskristall (Härte 3) nicht – „Zu hart“ + Funken', () => {
    const rock = gatherWorld(field(10, 8, ['', '', '....R', '', '....C']));
    rock.place(4, 3);
    rock.body().facing = 'up';
    rock.hold('steinspitzhacke');
    // E held: the rock first, then the copper node in reach.
    expect(work(rock).get('harvested')).toEqual([
      expect.objectContaining({ target: 'fels_klein_gruenhain', action: 'abbauen', material: 'stein' }),
      expect.objectContaining({ target: 'erz_kupfer', action: 'abbauen', material: 'erz' }),
    ]);
    expect(rock.inventory.selected()?.haltbarkeit).toBe(60 - 10);
    const ice = gatherWorld(field(10, 8, ['', '', '....X']));
    ice.place(4, 3);
    ice.body().facing = 'up';
    ice.hold('steinspitzhacke');
    const hard = ice.run(40, [{ type: 'player.interact', on: true }]);
    expect(hard.get('harvestHit')).toEqual([expect.objectContaining({ target: 'kristall_eis', tooHard: true })]);
    expect(ice.objectAt(4, 2)).toBe('kristall_eis');
  });

  it('Schaufel gräbt einen Pfad, Hacke legt ein Feld an, Sichel schneidet Schilf', () => {
    const dig = (tool: string): GatherWorld => {
      const w = gatherWorld(field(10, 10));
      w.place(4, 4);
      w.body().facing = 'up';
      w.hold(tool);
      w.run(1);
      return w;
    };
    expect(work(dig('steinschaufel')).get('tileDug')).toEqual([expect.objectContaining({ from: 'gras', result: 'pfad' })]);
    expect(work(dig('steinhacke')).get('tileDug')).toEqual([expect.objectContaining({ from: 'gras', result: 'feld' })]);
    const reed = gatherWorld(field(10, 8, ['', '', '....Z']));
    reed.place(4, 3);
    reed.body().facing = 'up';
    reed.hold('steinsichel');
    expect(work(reed).get('harvested')).toEqual([expect.objectContaining({ target: 'pflanze_schilf', action: 'schneiden' })]);
  });

  it('Hammer und Messer ernten nichts: der Baum verlangt seine Axt', () => {
    for (const tool of ['steinhammer', 'steinmesser']) {
      const w = gatherWorld(field(14, 12, ['', '', '', '', '', '.....E']));
      w.spawn(5, 7);
      w.hold(tool);
      const refused = w.run(2, [{ type: 'player.interact', on: true }]);
      expect(refused.get('commandRejected'), tool).toEqual([expect.objectContaining({ reason: 'needsTool' })]);
    }
  });

  it('ein Werkzeug mit der letzten Nutzung zerbricht beim Hieb, bleibt in der Hand und arbeitet nicht mehr', () => {
    const w = gatherWorld(field(14, 12, ['', '', '', '', '', '.....E']));
    w.spawn(5, 7);
    w.inventory.giveStack(w.sim, { ...newStack(catalog.get('steinaxt'), 1), haltbarkeit: 1 });
    w.run(1, [{ type: 'player.selectHotbar', index: 0 }]);
    const ev = work(w);
    expect(ev.get('harvestHit')).toHaveLength(1);
    expect(ev.get('itemBroken')).toEqual([expect.objectContaining({ item: 'steinaxt', at: { bereich: 'schnellleiste', index: 0 } })]);
    expect(w.inventory.selected()).toEqual({ item: 'steinaxt', count: 1, haltbarkeit: 0 });
    const refused = w.run(2, [{ type: 'player.interact', on: true }]);
    expect(refused.get('commandRejected')).toEqual([expect.objectContaining({ reason: 'toolBroken' })]);
  });
});

/** The life test world plus the item use system, the player on drawn tile (2, 2). */
function useWorld(): LifeWorld & { tools: ToolsSystem } {
  const w = lifeWorld(meadow(8, 6));
  const tools = w.sim.addSystem(new ToolsSystem({ player: w.player, inventory: w.inventory }));
  tools.useLife(w.life);
  w.spawn(2, 2);
  return { ...w, tools };
}

function reasons(ev: Map<string, unknown[]>): string[] {
  return (ev.get('commandRejected') ?? []).map((e) => (e as { reason: string }).reason);
}

const HOTBAR_0 = { bereich: 'schnellleiste', index: 0 } as const;
const INV_0 = { bereich: 'inventar', index: 0 } as const;

describe('player.useItem', () => {
  it('der Verband stillt eine Blutung und wird verbraucht; ohne Blutung bleibt er', () => {
    const w = useWorld();
    w.inventory.give(w.sim, 'verband', 2);
    expect(reasons(w.run(1, [{ type: 'player.useItem', slot: INV_0 }]))).toEqual(['nothingToCure']);
    expect(w.inventory.count('verband')).toBe(2);
    w.life.conditions.apply(w.sim, 'blutung');
    const ev = w.run(1, [{ type: 'player.useItem', slot: INV_0 }]);
    expect(ev.get('itemUsed')).toEqual([expect.objectContaining({ item: 'verband', use: 'heilen', cured: ['blutung'], from: INV_0 })]);
    expect(w.life.conditions.has('blutung')).toBe(false);
    expect(w.inventory.count('verband')).toBe(1);
    expect(CURES.verband).toEqual(['blutung']);
    expect(CONTENT.has('conditions', 'blutung')).toBe(true);
  });

  it('der volle Eimer wird ausgegossen: durchnässt, löscht Brennen, derselbe Eimer leer und eine Nutzung älter', () => {
    const w = useWorld();
    w.inventory.giveStack(w.sim, { ...newStack(catalog.get('holzeimer_wasser'), 1, { qualitaet: 2 }), haltbarkeit: 30 });
    w.life.conditions.apply(w.sim, 'brennen');
    const ev = w.run(1, [{ type: 'player.useItem', slot: HOTBAR_0 }]);
    expect(ev.get('itemUsed')).toEqual([expect.objectContaining({ item: 'holzeimer_wasser', use: 'ausgiessen', cured: ['brennen'] })]);
    expect(w.inventory.state.schnellleiste[0]).toEqual({ item: 'holzeimer', count: 1, haltbarkeit: 29, qualitaet: 2 });
    // Soaked as after a swim (the rest of the tick dries a hair of it).
    expect(w.vit().wetness).toBeGreaterThan(STAT_MAX - 0.01);
    expect(w.life.conditions.has('brennen')).toBe(false);
    for (const b of BUCKETS) for (const id of b.loescht) expect(CONTENT.has('conditions', id)).toBe(true);
  });

  it('der letzte Guss zerbricht den Eimer (itemBroken); ein kaputter voller Eimer lässt sich nicht ausgießen', () => {
    const w = useWorld();
    w.inventory.giveStack(w.sim, { ...newStack(catalog.get('holzeimer_wasser'), 1), haltbarkeit: 1 });
    const ev = w.run(1, [{ type: 'player.useItem', slot: HOTBAR_0 }]);
    expect(ev.get('itemBroken')).toEqual([expect.objectContaining({ item: 'holzeimer', at: HOTBAR_0 })]);
    expect(w.inventory.state.schnellleiste[0]).toEqual({ item: 'holzeimer', count: 1, haltbarkeit: 0 });
    const v = useWorld();
    v.inventory.giveStack(v.sim, { ...newStack(catalog.get('holzeimer_wasser'), 1), haltbarkeit: 0 });
    expect(reasons(v.run(1, [{ type: 'player.useItem', slot: HOTBAR_0 }]))).toEqual(['notUsable']);
  });

  it('Essen geht an die Aktionen; Werkzeuge, leere und falsche Plätze werden abgelehnt; ohne Leben nichts', () => {
    const w = useWorld();
    w.inventory.give(w.sim, 'himbeeren', 3);
    const eat = w.run(1, [{ type: 'player.useItem', slot: INV_0 }]);
    expect(eat.get('activityStarted')).toEqual([expect.objectContaining({ action: 'essen', item: 'himbeeren' })]);
    w.inventory.give(w.sim, 'steinaxt', 1);
    expect(reasons(w.run(1, [{ type: 'player.useItem', slot: HOTBAR_0 }]))).toEqual(['notUsable']);
    expect(reasons(w.run(1, [{ type: 'player.useItem', slot: { bereich: 'inventar', index: 29 } }]))).toEqual(['slotEmpty']);
    expect(reasons(w.run(1, [{ type: 'player.useItem', slot: { bereich: 'rucksackfach', index: 3 } }]))).toEqual(['invalidSlot']);
    w.vit().health = 0;
    expect(reasons(w.run(1, [{ type: 'player.useItem', slot: HOTBAR_0 }]))).toEqual(['dead']);
  });

  it('Primärtaste (ohne Platz, die Hand): leere Hand und Werkzeug tun nichts und werden nicht abgelehnt; Essen in der Hand wird gegessen', () => {
    const w = useWorld();
    const primary = (): ReturnType<typeof w.run> => w.run(1, [{ type: 'player.useItem' }]);
    expect(reasons(primary())).toEqual([]);
    w.inventory.give(w.sim, 'steinaxt', 1);
    expect(w.inventory.selected()?.item).toBe('steinaxt');
    const swing = primary();
    expect(reasons(swing)).toEqual([]);
    expect(swing.get('itemUsed') ?? []).toEqual([]);
    expect(w.inventory.state.schnellleiste[0]).toEqual(expect.objectContaining({ item: 'steinaxt', haltbarkeit: 60 }));
    w.inventory.give(w.sim, 'himbeeren', 2);
    const berries = w.inventory.state.inventar.findIndex((s) => s?.item === 'himbeeren');
    w.run(1, [
      { type: 'inventory.move', from: { bereich: 'inventar', index: berries }, to: { bereich: 'schnellleiste', index: 1 } },
      { type: 'player.selectHotbar', index: 1 },
    ]);
    expect(w.inventory.selected()?.item).toBe('himbeeren');
    expect(primary().get('activityStarted')).toEqual([expect.objectContaining({ action: 'essen', item: 'himbeeren' })]);
  });

  it('pouredBucket und curable als reine Formeln', () => {
    const empty = catalog.get('holzeimer');
    expect(pouredBucket({ item: 'holzeimer_wasser', count: 1, haltbarkeit: 12, qualitaet: 3 }, empty)).toEqual({ item: 'holzeimer', count: 1, haltbarkeit: 11, qualitaet: 3 });
    expect(pouredBucket({ item: 'holzeimer_wasser', count: 1, haltbarkeit: 1 }, empty)).toEqual({ item: 'holzeimer', count: 1, haltbarkeit: 0 });
    expect(curable(['blutung', 'brennen'], (id) => id === 'brennen')).toEqual(['brennen']);
    expect(curable(['blutung'], () => false)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------------------------

let manifest: AtlasManifest;
let atlas: AtlasData;
let tables: WorldRenderTables;

beforeAll(() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('generated atlas missing (npm run assets)');
  manifest = manifestFromGenerated(mod);
  atlas = { manifest } as AtlasData;
  tables = new WorldRenderTables(manifest);
});

/** Captures frame owner, position and height of every sprite pushed into `scene`. */
function capture(scene: RenderScene): { frame: string; x: number; y: number; height: number; tint: number }[] {
  const out: { frame: string; x: number; y: number; height: number; tint: number }[] = [];
  const push = scene.sprites.push.bind(scene.sprites);
  scene.sprites.push = (d: SpriteDesc): number => {
    const f = d.frame;
    const owner = f === null ? '' : (Object.values(manifest.sprites).find((s) => s.frames.includes(f))?.id ?? '?');
    out.push({ frame: owner, x: d.x, y: d.y, height: d.heightBase, tint: (d.tintR << 16) | (d.tintG << 8) | d.tintB });
    return push(d);
  };
  return out;
}

/** A session stand-in on a real simulation that delivers the events the test emits. */
function session(w: GatherWorld): { session: { onEvent: <K extends keyof SimEventMap>(type: K, h: (p: SimEventMap[K]) => void) => () => void; sim: GatherWorld['sim'] }; emit: <K extends keyof SimEventMap>(type: K, p: SimEventMap[K]) => void } {
  const handlers = new Map<string, ((p: unknown) => void)[]>();
  return {
    session: {
      sim: w.sim,
      onEvent: (type, h) => {
        handlers.set(type, [...(handlers.get(type) ?? []), h as (p: unknown) => void]);
        return () => undefined;
      },
    },
    emit: (type, p) => {
      for (const h of handlers.get(type) ?? []) h(p);
    },
  };
}

function frame(fx: GatherEffects, w: GatherWorld, time: number, t: ((key: string) => string) | null = (k) => k): { pushed: ReturnType<typeof capture>; scene: RenderScene } {
  const scene = new RenderScene();
  scene.beginFrame(time);
  const pushed = capture(scene);
  fx.draw(scene, atlas, tables, 0, time, 0, w.gathering, t);
  return { pushed, scene };
}

describe('Sammel-Feedback (§14)', () => {
  /** The player west of an oak at map (5, 5), the hit at its centre. */
  function hitWorld(): { w: GatherWorld; hit: (hits: number, needed: number) => SimEventMap['harvestHit'] } {
    const w = gatherWorld(field(14, 12, ['', '', '', '', '', '.....E']));
    w.place(3, 5);
    const c = { x: 5 * TILE_PX + 64 * TILE_PX + TILE_PX, y: 5 * TILE_PX + 64 * TILE_PX + TILE_PX / 2 };
    return { w, hit: (hits, needed) => ({ layer: 0, tx: 64 + 5, ty: 64 + 5, x: c.x, y: c.y, target: 'baum_eiche', action: 'faellen', material: 'holz', hits, hitsNeeded: needed, tooHard: false, xp: null, tick: 3 }) };
  }

  it('ein Werkzeughieb trifft die Seite zum Spieler in Handhöhe und sprüht die Splitter vom Spieler weg', () => {
    const { w, hit } = hitWorld();
    const fx = new GatherEffects();
    const ev = session(w);
    fx.follow(ev.session);
    const e = hit(1, 5);
    ev.emit('harvestHit', e);
    const first = frame(fx, w, 1).pushed;
    expect(first).toHaveLength(MATERIAL_PARTICLES.holz.count);
    expect(first.every((p) => p.frame === PARTICLE_SPRITES.splitter)).toBe(true);
    // Struck on the player's side (west of the centre), above the ground at hand height.
    const meanX = first.reduce((n, p) => n + p.x, 0) / first.length;
    expect(meanX).toBeLessThan(e.x);
    expect(Math.min(...first.map((p) => p.height))).toBeGreaterThanOrEqual(8);
    // A moment later the pieces have moved on, away from the player (east).
    const later = frame(fx, w, 1.2).pushed;
    expect(later.reduce((n, p) => n + p.x, 0) / later.length).toBeGreaterThan(meanX);
  });

  it('Partikel je Material: Erzsplitter tragen die Farbe ihres Erzes (Knoten und Ader), alles andere die des Materials', () => {
    expect(chipTint('erz_kupfer', 'erz')).toBe(ORE_TINTS.kupfer);
    expect(chipTint('ader_zinn', 'erz')).toBe(ORE_TINTS.zinn);
    expect(chipTint('erz_mondstein', 'erz')).toBe(MATERIAL_PARTICLES.erz.tint);
    expect(chipTint('kristall_eis', 'kristall')).toBe(MATERIAL_PARTICLES.kristall.tint);
    expect(chipTint('baum_eiche', 'holz')).toBe(0);
    for (const ore of Object.keys(ORE_TINTS)) expect(CONTENT.has('ores', ore), ore).toBe(true);
    const { w } = hitWorld();
    const fx = new GatherEffects();
    const ev = session(w);
    fx.follow(ev.session);
    ev.emit('harvestHit', { layer: 0, tx: 5, ty: 5, x: 88, y: 88, target: 'erz_kupfer', action: 'abbauen', material: 'erz', hits: 1, hitsNeeded: 5, tooHard: false, xp: null, tick: 2 });
    const chips = frame(fx, w, 1).pushed;
    expect(chips).toHaveLength(MATERIAL_PARTICLES.erz.count);
    expect(chips.every((p) => p.frame === PARTICLE_SPRITES.stein && p.tint === ORE_TINTS.kupfer)).toBe(true);
  });

  it('der letzte Hieb an einem großen Ziel lässt es doppelt zerbersten', () => {
    const { w, hit } = hitWorld();
    const fx = new GatherEffects();
    const ev = session(w);
    fx.follow(ev.session);
    ev.emit('harvestHit', hit(5, 5));
    frame(fx, w, 1);
    expect(fx.particles).toBe(MATERIAL_PARTICLES.holz.count * 2);
  });

  it('ein Werkzeug in der Hand zerbricht: „Kaputt!“ über der Figur und Splitter; Rüstung zerbricht still in der Tasche', () => {
    const { w } = hitWorld();
    const fx = new GatherEffects();
    const ev = session(w);
    fx.follow(ev.session);
    ev.emit('itemBroken', { at: { bereich: 'ausruestung', index: 0 }, item: 'probe_helm', tick: 4 });
    expect(frame(fx, w, 1).pushed).toEqual([]);
    ev.emit('itemBroken', { at: { bereich: 'schnellleiste', index: 0 }, item: 'steinaxt', tick: 5 });
    const { pushed, scene } = frame(fx, w, 1.1);
    expect(new Set(pushed.map((p) => p.frame))).toEqual(new Set([PARTICLE_SPRITES.splitter, PARTICLE_SPRITES.stein]));
    expect(scene.worldUi.entry(0)).toMatchObject({ kind: 'damage', text: 'ui.tools.brokenShort' });
  });

  it('Ausgießen spritzt Wasser, ein Verband lässt Fasern fallen, ein fertiges Werkstück stäubt sein Material', () => {
    const { w } = hitWorld();
    const fx = new GatherEffects();
    const ev = session(w);
    fx.follow(ev.session);
    const pos = w.pos();
    ev.emit('itemUsed', { item: 'holzeimer_wasser', from: HOTBAR_0, use: 'ausgiessen', cured: [], layer: 0, x: pos.x, y: pos.y, tick: 6 });
    const splash = frame(fx, w, 1).pushed;
    expect(splash).toHaveLength(12);
    expect(splash.every((p) => p.frame === PARTICLE_SPRITES.erde && p.tint === USE_TINTS.wasser)).toBe(true);
    ev.emit('itemUsed', { item: 'verband', from: INV_0, use: 'heilen', cured: ['blutung'], layer: 0, x: pos.x, y: pos.y, tick: 7 });
    const fibres = frame(fx, w, 1.05).pushed.filter((p) => p.frame === PARTICLE_SPRITES.blatt);
    expect(fibres).toHaveLength(5);
    expect(fibres.every((p) => p.tint === USE_TINTS.verband)).toBe(true);
    const before = fx.particles;
    ev.emit('craftCompleted', { recipe: 'rezept_steinaxt', item: 'steinaxt', count: 1, tick: 8 });
    const crafted = frame(fx, w, 1.1).pushed.filter((p) => p.frame === PARTICLE_SPRITES.splitter);
    expect(crafted).toHaveLength(3);
    expect(fx.particles).toBe(before + 3);
  });
});

describe('Screenshot-Szenario sammeln-feedback', () => {
  it('der Ort: eine einzelne Kiefer mit freiem Standplatz westlich davon in der Welt der Boot-Sitzung', () => {
    const world = worldFor(BOOT_SESSION_SEED, 'medium');
    const tiles = worldDimensions('medium').tiles;
    const cache = new Map<number, ChunkData>();
    const chunks = {
      get: (layer: Layer, cx: number, cy: number): ChunkData | undefined => {
        const key = packChunkId(layer, cx, cy);
        let c = cache.get(key);
        if (c === undefined) {
          c = generateChunk(world, layer, cx, cy);
          cache.set(key, c);
        }
        return c;
      },
    };
    const ids = contentWorldIdTables();
    const objectAt = (x: number, y: number): string => {
      const r = chunks.get(0, Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE))?.object[(y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)] ?? 0;
      return r === 0 ? '' : ids.objects.stringId(r);
    };
    const grid = new CollisionGrid({ chunks, worldTiles: tiles });
    const s = FEEDBACK_SPOT;
    expect(objectAt(s.tx, s.ty)).toBe(s.tree);
    expect(grid.tileInfo(0, s.standTx, s.standTy) & BLOCK_ALL).toBe(0);
    expect(infoLevel(grid.tileInfo(0, s.standTx, s.standTy))).toBe(infoLevel(grid.tileInfo(0, s.tx, s.ty)));
    // Nothing tall stands east of the pine where it falls, nor south of the scene where crowns would hide it.
    for (let dy = -1; dy <= 6; dy++) for (let dx = -4; dx <= 6; dx++) if (dx !== 0 || dy !== 0) expect(CONTENT.collection('worldObjects').find(objectAt(s.tx + dx, s.ty + dy))?.kind ?? '', `${dx},${dy}`).not.toBe('baum');
  });

  it('das Skript läuft headless: fünf Hiebe, der Fall nach Osten, die Landung mit fliegenden Drops, der Ring am Stumpf auf halb', () => {
    const sim = createSimulation({ seed: BOOT_SESSION_SEED, worldSize: 'medium' });
    const seen: { t: number; type: string; e: Record<string, unknown> }[] = [];
    let t = -1;
    const step = (): void => {
      sim.step();
      sim.events.drain((type, e) => {
        seen.push({ t, type, e: e as Record<string, unknown> });
      });
    };
    for (const c of feedbackSetup()) sim.commands.push(c);
    step();
    expect(seen.filter((s) => s.type === 'commandRejected')).toEqual([]);
    const script = feedbackScript();
    for (t = 0; t < FEEDBACK_TICKS.end; t++) {
      for (const s of script) if (s.at === t) sim.commands.push(s.command);
      step();
    }
    const at = (type: string): number[] => seen.filter((s) => s.type === type).map((s) => s.t);
    expect(seen.filter((s) => s.type === 'commandRejected')).toEqual([]);
    expect(at('harvestHit')).toEqual([20, 50, 80, 110, 140, 205]);
    expect(seen.find((s) => s.type === 'treeFelled')).toMatchObject({ t: 140, e: { object: FEEDBACK_SPOT.tree, direction: 'rechts' } });
    expect(at('treeLanded')).toEqual([200]);
    expect(at('dropSpawned').length).toBeGreaterThanOrEqual(4);
    expect(seen.find((s) => s.type === 'harvestHit' && s.t === 205)?.e).toMatchObject({ action: 'roden', hits: 1, hitsNeeded: 2 });
    const drops = sim.systems.find((s) => s.id === 'drops') as DropSystem;
    for (let i = 0; i < drops.store.size; i++) expect(drops.store.valueAt(i).flightTicks).toBeLessThan(drops.store.valueAt(i).flightTotal);
    const interaction = sim.systems.find((s) => s.id === 'interaction') as InteractionSystem;
    expect(interaction.focus).toMatchObject({ kind: 'object', action: 'roden', working: true, progress: 0.5 });
    expect(interaction.heldTool()).toMatchObject({ kind: 'axt', power: 1 });
    expect(catalog.get(FEEDBACK_TOOL).werkzeug?.art).toBe('axt');
  });
});
