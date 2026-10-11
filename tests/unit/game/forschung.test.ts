/**
 * Research and maps (M7-18; MASTERPROMPT §21 "Relikte → Forschungspult → Rezepte", "Karten von Orten (Kartentisch)"; docs/SPIEL.md
 * §19 "Forschungspult", "Kartentisch"): the research desk is a processing station without fuel that turns each relic into its
 * blueprint in the time class `forschen`; the map table a crafting station waiting for its blueprint, drawing a map per kind of
 * place; using a blueprint grants its unlock once (the recipes waiting for it show), using a map reveals the nearest place of
 * its kind the player does not know (source `kartentisch`) and is refused when none is left. The stations count ≥ 16 (§C).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { researchItemUses } from '../../../src/game/research/uses';
import type { ItemUseContext } from '../../../src/game/tools/itemUses';
import { UnlocksSystem } from '../../../src/game/unlocks/system';
import { kampfWelt, type KampfWelt } from './kampf-testwelt';

const RELICS = { relikt_kompass: 'bauplan_kartentisch', relikt_siegel: 'bauplan_erbauer_amulett', relikt_zahnrad: 'bauplan_erbauer_ring' } as const;

/** The context of using the first stack of `item` in the bags. */
function context(w: KampfWelt, item: string): ItemUseContext {
  for (const area of ['schnellleiste', 'inventar'] as const) {
    const slots = w.inventory.state[area];
    for (let index = 0; index < slots.length; index++) {
      const stack = slots[index];
      if (stack !== null && stack !== undefined && stack.item === item) {
        return { slot: { bereich: area, index }, stack, def: CONTENT.collection('items').get(item), target: null, tick: w.sim.tick, named: false, primary: false };
      }
    }
  }
  throw new Error(`no ${item} in the bags`);
}

describe('research desk and map table: content', () => {
  it('the desk studies each relic into its blueprint (no fuel, time class forschen); the map table waits for its blueprint', () => {
    const desk = CONTENT.collection('stations').get('forschungspult');
    expect(desk.art).toBe('verarbeitung');
    expect(desk.verarbeitung?.brennstoff).toBe(false);
    const recipes = CONTENT.collection('recipes').values();
    for (const [relic, blueprint] of Object.entries(RELICS)) {
      const r = recipes.find((x) => x.ergebnis.item === blueprint && x.station === 'forschungspult');
      expect(r, blueprint).toBeDefined();
      expect(r?.zutaten.map((z) => ('item' in z ? z.item : z.gruppe))).toEqual([relic]);
      expect(r?.dauer).toBe('forschen');
      expect(CONTENT.collection('items').get(blueprint).bauplan?.freischaltung).toMatch(/^bp_/);
    }
    expect(BALANCE.crafting.durationSeconds.forschen).toBeGreaterThan(BALANCE.crafting.durationSeconds.schmelzen);
    const table = CONTENT.collection('stations').get('kartentisch');
    expect(table.art).toBe('handwerk');
    expect(recipes.find((x) => x.ergebnis.item === 'kartentisch')?.freischaltung).toBe('bp_kartentisch');
    const maps = recipes.filter((x) => x.station === 'kartentisch');
    expect(maps.length).toBeGreaterThanOrEqual(4);
    for (const m of maps) expect(CONTENT.collection('items').get(m.ergebnis.item).ortskarte, m.ergebnis.item).toBeDefined();
    expect(CONTENT.collection('stations').ids().length).toBeGreaterThanOrEqual(16);
  });
});

describe('research: using blueprints and maps', () => {
  it('a blueprint grants its unlock once (source bauplan:<item>) and is used up; the waiting recipe is allowed then', () => {
    const w = kampfWelt();
    const unlocks = w.sim.addSystem(new UnlocksSystem());
    const [blueprint] = researchItemUses({ inventory: w.inventory, unlocks, places: { nearestHidden: () => -1, reveal: () => false }, player: w.player });
    w.inventory.give(w.sim, 'bauplan_kartentisch', 2);
    expect(unlocks.recipeAllowed('rezept_kartentisch')).toBe(false);
    expect(blueprint!.handles(CONTENT.collection('items').get('bauplan_kartentisch'))).toBe(true);
    expect(blueprint!.use(w.sim, context(w, 'bauplan_kartentisch'))).toBe('used');
    expect(unlocks.has('bp_kartentisch')).toBe(true);
    expect(unlocks.granted().map((g) => g.source)).toEqual(['bauplan:bauplan_kartentisch']);
    expect(unlocks.recipeAllowed('rezept_kartentisch')).toBe(true);
    expect(w.inventory.count('bauplan_kartentisch')).toBe(1);
    // Known already: refused, nothing used up.
    expect(blueprint!.use(w.sim, context(w, 'bauplan_kartentisch'))).toEqual({ reject: 'alreadyUnlocked' });
    expect(w.inventory.count('bauplan_kartentisch')).toBe(1);
  });

  it('a map reveals the nearest unknown place of its kind (source kartentisch) and is used up; refused when none is left', () => {
    const w = kampfWelt();
    w.spawn(10, 10);
    const revealed: { slot: number; source: string }[] = [];
    let hidden = 4;
    const places = {
      nearestHidden: (type: string) => (type === 'gewoelbe' ? hidden : -1),
      reveal: (_s: unknown, slot: number, source: string) => {
        revealed.push({ slot, source });
        hidden = -1;
        return true;
      },
    };
    const [, map] = researchItemUses({ inventory: w.inventory, unlocks: new UnlocksSystem(), places: places as never, player: w.player });
    w.inventory.give(w.sim, 'ortskarte_gewoelbe', 2);
    expect(map!.handles(CONTENT.collection('items').get('ortskarte_gewoelbe'))).toBe(true);
    expect(map!.use(w.sim, context(w, 'ortskarte_gewoelbe'))).toBe('used');
    expect(revealed).toEqual([{ slot: 4, source: 'kartentisch' }]);
    expect(w.inventory.count('ortskarte_gewoelbe')).toBe(1);
    expect(map!.use(w.sim, context(w, 'ortskarte_gewoelbe'))).toEqual({ reject: 'noPlaceLeft' });
    expect(w.inventory.count('ortskarte_gewoelbe')).toBe(1);
  });
});
