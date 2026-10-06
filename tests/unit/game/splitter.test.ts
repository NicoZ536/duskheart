/**
 * Heart and ember shards (M7-32; MASTERPROMPT §20.2 "Herzsplitter (+10 max. Leben)", §21 "Glutsplitter (+5 max. Ausdauer)",
 * §11.1 "Leben 100 (+10 je Boss-Herzsplitter)"; docs/SPIEL.md §22 "Splitter"): using a heart shard (`player.useItem`, the
 * item-use hook of the tools) takes the piece for good, raises the maximum health by 10 and fills the 10 at once; the gain
 * stays (a modifier source of the player) and adds up; `shardUsed` tells it. The ember shard's +5 stamina through the same
 * modifier source.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { shardGain, shardHealthBonus, shardStaminaBonus } from '../../../src/game/shards/formulas';
import { ToolsSystem } from '../../../src/game/tools/system';
import { eventsOf } from './kampf-testwelt';
import { leuchtfeuerWelt, type LeuchtfeuerWelt } from './leuchtfeuer-testwelt';

const S = BALANCE.bosses.shards;

/** `player.useItem` on the first bag slot holding `item`. */
function use(w: LeuchtfeuerWelt, item: string): Map<string, unknown[]> {
  const state = w.inventory.state;
  for (const bereich of ['schnellleiste', 'inventar', 'rucksackfach'] as const) {
    const index = state[bereich].findIndex((s) => s?.item === item);
    if (index >= 0) return w.run(1, [{ type: 'player.useItem', slot: { bereich, index } }]);
  }
  throw new Error(`no ${item} in the bags`);
}

function withTools(): LeuchtfeuerWelt {
  const w = leuchtfeuerWelt();
  const tools = w.sim.addSystem(new ToolsSystem({ player: w.player, inventory: w.inventory }));
  tools.addItemUse(w.shards.itemUse());
  return w;
}

describe('Splitter', () => {
  it('Formeln: +10 Leben je Herz-, +5 Ausdauer je Glutsplitter; der Herzsplitter ist Content mit Block splitter', () => {
    expect(shardHealthBonus(3)).toBe(3 * S.healthPerHeart);
    expect(shardStaminaBonus(2)).toBe(2 * S.staminaPerEmber);
    expect(shardGain('herz')).toBe(10);
    expect(CONTENT.collection('items').get('herzsplitter').splitter).toEqual({ art: 'herz' });
  });

  it('Herzsplitter benutzen: weg aus den Taschen, +10 max. Leben dauerhaft, die 10 sofort; zwei addieren sich', () => {
    const w = withTools();
    w.run(2);
    const base = w.vit().maxHealth;
    w.vit().health = base - 30;
    w.inventory.give(w.sim, 'herzsplitter', 2);
    const ev = use(w, 'herzsplitter');
    expect(eventsOf(ev, 'shardUsed')).toEqual([expect.objectContaining({ art: 'herz', gesamt: 1, item: 'herzsplitter' })]);
    expect(w.inventory.count('herzsplitter')).toBe(1);
    expect(w.shards.used('herz')).toBe(1);
    expect(w.vit().maxHealth).toBe(base + 10);
    // The 10 at once (regeneration over one tick is a fraction of a point).
    expect(w.vit().health).toBeGreaterThanOrEqual(base - 20);
    expect(w.vit().health).toBeLessThan(base - 19);
    use(w, 'herzsplitter');
    w.run(1);
    expect(w.vit().maxHealth).toBe(base + 20);
    expect(w.inventory.count('herzsplitter')).toBe(0);
  });

  it('volle Gesundheit bleibt voll – am neuen Maximum', () => {
    const w = withTools();
    w.run(2);
    const base = w.vit().maxHealth;
    w.vit().health = base;
    w.inventory.give(w.sim, 'herzsplitter', 1);
    use(w, 'herzsplitter');
    expect(w.vit().health).toBe(base + 10);
  });

  it('Glutsplitter (+5 max. Ausdauer) über dieselbe Einflussquelle; nach dem Laden bleibt der Gewinn', () => {
    const w = withTools();
    w.run(2);
    const stamina = w.vit().maxStamina;
    w.shards.save.deserialize({ herz: 1, glut: 2 });
    w.run(1);
    expect(w.vit().maxStamina).toBe(stamina + 2 * S.staminaPerEmber);
    expect(w.shards.used('glut')).toBe(2);
    expect(() => w.shards.save.deserialize({ herz: -1, glut: 0 })).toThrow(/shards snapshot invalid/);
  });
});
