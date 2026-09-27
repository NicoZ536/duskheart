/**
 * M4-08 in the crafting system (MASTERPROMPT §15.1 "Rezept anheften → HUD zeigt fehlende Zutaten live"; docs/SPIEL.md
 * §3 Handwerk): `craft.pin {recipe, on}` pins a visible recipe to the HUD's tracker – at most three, a fourth lets the
 * oldest go –, unpins it, refuses unknown and hidden recipes, and needs no living player (it is bookkeeping, not
 * work). `waterInReach` answers the surroundings check of recipes made by the water for the recipe book. The save form
 * of the pins: tests/unit/save/roundtrip/crafting.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { GameCommand } from '../../../src/game/commands';
import { CraftingSystem } from '../../../src/game/crafting/system';
import { MAX_PINNED_RECIPES } from '../../../src/game/crafting/state';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { meadow } from './spieler-testwelt';

interface PinWorld extends LifeWorld {
  readonly crafting: CraftingSystem;
}

/** The life test world plus crafting, the player on drawn tile (2, 2) with the materials of the first tools. */
function pinWorld(rows: readonly string[] = meadow(10, 8)): PinWorld {
  const w = lifeWorld(rows);
  const crafting = w.sim.addSystem(new CraftingSystem({ player: w.player, inventory: w.inventory, collision: w.collision, spill: () => undefined }));
  crafting.useSkills(w.life.skills);
  w.spawn(2, 2);
  for (const [item, count] of [['fasern', 6], ['zweig', 4], ['stein', 4], ['faserseil', 1], ['harz', 1], ['holz', 4]] as const) w.inventory.give(w.sim, item, count);
  w.run(1);
  return { ...w, crafting };
}

function pin(recipe: string, on = true): GameCommand {
  return { type: 'craft.pin', recipe, on };
}

function rejections(events: Map<string, unknown[]>): Array<[string, string]> {
  return (events.get('commandRejected') ?? []).map((e) => [(e as { type: string }).type, (e as { reason: string }).reason]);
}

describe('Rezepte anheften (craft.pin)', () => {
  it('die Obergrenze ist ein Balancewert (Review M4 #19): BALANCE.crafting.maxPinnedRecipes = 3', () => {
    expect(BALANCE.crafting.maxPinnedRecipes).toBe(3);
    expect(MAX_PINNED_RECIPES).toBe(BALANCE.crafting.maxPinnedRecipes);
  });

  it('heftet sichtbare Rezepte an, höchstens drei – das älteste weicht; doppelt ändert nichts, lösen nimmt es heraus', () => {
    const w = pinWorld();
    expect(w.crafting.pinned).toEqual([]);
    expect(rejections(w.run(1, [pin('rezept_faserseil'), pin('rezept_steinaxt'), pin('rezept_faserseil')]))).toEqual([]);
    expect(w.crafting.pinned).toEqual(['rezept_faserseil', 'rezept_steinaxt']);
    w.run(1, [pin('rezept_fackel'), pin('rezept_lagerfeuer')]);
    expect(w.crafting.pinned).toHaveLength(MAX_PINNED_RECIPES);
    expect(w.crafting.pinned).toEqual(['rezept_steinaxt', 'rezept_fackel', 'rezept_lagerfeuer']);
    w.run(1, [pin('rezept_fackel', false), pin('rezept_faserseil', false)]);
    expect(w.crafting.pinned).toEqual(['rezept_steinaxt', 'rezept_lagerfeuer']);
    // Pinned again, it stands last (the newest).
    w.run(1, [pin('rezept_fackel')]);
    expect(w.crafting.pinned).toEqual(['rezept_steinaxt', 'rezept_lagerfeuer', 'rezept_fackel']);
  });

  it('lehnt unbekannte und noch verborgene Rezepte ab; lösen, was nicht angeheftet ist, ist still', () => {
    const w = pinWorld();
    expect(w.crafting.isVisible('rezept_brett')).toBe(false);
    const events = w.run(1, [pin('rezept_mondstaub'), pin('rezept_brett'), pin('rezept_brett', false)]);
    expect(rejections(events)).toEqual([
      ['craft.pin', 'unknownRecipe'],
      ['craft.pin', 'recipeHidden'],
    ]);
    expect(w.crafting.pinned).toEqual([]);
    // Owning the sawbuck makes the plank known: now it pins.
    w.inventory.give(w.sim, 'saegebock', 1);
    w.run(1, [pin('rezept_brett')]);
    expect(w.crafting.pinned).toEqual(['rezept_brett']);
  });

  it('ein eben erst besessenes Rezept lässt sich im selben Tick anheften (die Sichtbarkeit wird vorher nachgeführt)', () => {
    const w = pinWorld();
    w.inventory.give(w.sim, 'laub', 1);
    expect(rejections(w.run(1, [pin('rezept_grasbett')]))).toEqual([]);
    expect(w.crafting.pinned).toEqual(['rezept_grasbett']);
  });

  it('Anheften ist Buchführung: auch als Leiche oder im Schlaf', () => {
    const w = pinWorld();
    w.vit().health = 0;
    w.run(1);
    expect(rejections(w.run(1, [pin('rezept_faserseil')]))).toEqual([]);
    expect(w.crafting.pinned).toEqual(['rezept_faserseil']);
  });
});

describe('Wasser in Reichweite (umgebung: wasser)', () => {
  it('beantwortet die Umgebungsprüfung von craft.start für das Rezeptbuch; ohne Spieler kein Wasser', () => {
    const nass = pinWorld(['........', '........', '...ww...', '...ww...', '........']);
    expect(nass.crafting.waterInReach(nass.sim)).toBe(true);
    const trocken = pinWorld(['........', '........', '........', '.......w']);
    expect(trocken.crafting.waterInReach(trocken.sim)).toBe(false);
    trocken.inventory.give(trocken.sim, 'holzeimer', 1);
    trocken.run(1);
    expect(rejections(trocken.run(1, [{ type: 'craft.start', recipe: 'rezept_holzeimer_wasser', count: 1 }]))).toEqual([['craft.start', 'noWater']]);
    const leer = lifeWorld(meadow(6, 6));
    const crafting = leer.sim.addSystem(new CraftingSystem({ player: leer.player, inventory: leer.inventory, collision: leer.collision, spill: () => undefined }));
    expect(crafting.waterInReach(leer.sim)).toBe(false);
  });
});
