/**
 * M4-35 Knochenbruch heilt (MASTERPROMPT §11.3 "Knochenbruch (−40 % Tempo bis zur Schiene)"; M3-Gate): the splint –
 * two twigs and a fibre rope at the workbench – sets a broken bone when used (`player.useItem`, `CURES`) and is used
 * up; without a broken bone there is nothing to cure. The item has its texts (DE/EN), its recipe as its source and its
 * use as a cure.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { CURES } from '../../../src/content/items/grundlagen';
import { buildItemIndex } from '../../../src/content/items/index';
import { ToolsSystem } from '../../../src/game/tools/system';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { meadow } from './spieler-testwelt';

/** A life world with the tools system (using items), the player on (4, 4). */
function world(): LifeWorld & { readonly tools: ToolsSystem } {
  const w = lifeWorld(meadow(12, 12));
  const tools = w.sim.addSystem(new ToolsSystem({ player: w.player, inventory: w.inventory }));
  tools.useLife(w.life);
  w.spawn(4, 4);
  return Object.assign(w, { tools });
}

describe('Die Schiene (M4-35)', () => {
  it('Werkbank-Rezept aus Zweigen und Faserseil; Medizin T0 mit Texten; heilt den Knochenbruch', () => {
    const recipe = CONTENT.collection('recipes').get('rezept_schiene');
    expect(recipe).toMatchObject({ station: 'werkbank', ergebnis: { item: 'schiene', anzahl: 1 } });
    expect(recipe.zutaten).toEqual([
      { item: 'zweig', anzahl: 2 },
      { item: 'faserseil', anzahl: 1 },
    ]);
    const item = CONTENT.collection('items').get('schiene');
    expect(item).toMatchObject({ kategorie: 'medizin', stufe: 0 });
    expect(item.name.de.length > 0 && item.name.en.length > 0).toBe(true);
    expect(CURES.schiene).toEqual(['knochenbruch']);
    const index = buildItemIndex(CONTENT);
    expect(index.sources.get('schiene')?.length).toBeGreaterThan(0);
  });

  it('angelegt heilt sie den Knochenbruch und ist verbraucht; ohne Bruch gibt es nichts zu heilen', () => {
    const w = world();
    w.inventory.give(w.sim, 'schiene', 2);
    const slot = { bereich: 'inventar' as const, index: 0 };
    const idle = w.run(1, [{ type: 'player.useItem', slot }]);
    expect(idle.get('commandRejected')).toEqual([expect.objectContaining({ reason: 'nothingToCure' })]);
    w.run(1, [{ type: 'conditions.apply', id: 'knochenbruch' }]);
    expect(w.life.conditions.has('knochenbruch')).toBe(true);
    const used = w.run(1, [{ type: 'player.useItem', slot }]);
    expect(used.get('itemUsed')).toEqual([expect.objectContaining({ item: 'schiene', use: 'heilen', cured: ['knochenbruch'] })]);
    expect(w.life.conditions.has('knochenbruch')).toBe(false);
    expect(w.inventory.count('schiene')).toBe(1);
  });
});
