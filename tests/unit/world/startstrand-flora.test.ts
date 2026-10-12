/**
 * M7-107 "Frühjahrspflanzen am Startstrand" (docs/WORLD.md resources, `BALANCE.places.startFlora`): the world generator's rule
 * for hand-picked plants that bear in spring agrees with the gathering's (`isRipe`) for every world object and season; the
 * start flora's kinds are deposit plants of the start biomes; in small worlds the plan holds `depositKinds` of them within the
 * radius around the spawn and the chunks there show more than two kinds pickable in spring, the same each time. The 20
 * acceptance seeds (Mittel) are swept in
 * tests/integration/weltgen-validierung.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE, SEASON_IDS } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { isRipe } from '../../../src/game/gathering/formulas';
import { OBJECTS_BY_ID, pickableIn, RESOURCES, SPRING_FLORA, springKindsAround } from '../../../src/world/gen/resources';
import { generateWorld } from '../../../src/world/gen/world';
import { springPickableAround, WORLD_TIMEOUT_MS } from './weltgen-hilfen';

const F = BALANCE.places.startFlora;

describe('Startstrand-Flora (M7-107)', () => {
  it('the generator reads ripeness like the gathering: every hand plant in every season', () => {
    for (const def of CONTENT.collection('worldObjects').values()) {
      const o = OBJECTS_BY_ID.get(def.id);
      if (o === undefined) throw new Error(def.id);
      const hand = (def.kind === 'pflanze' || def.kind === 'busch') && def.tool === 'hand';
      for (const season of SEASON_IDS) expect(pickableIn(o, season), `${def.id} ${season}`).toBe(hand && isRipe(def.drops ?? [], 'abbau', season));
    }
  });

  it('the spring flora: deposit bushes and herbs picked by hand, enough kinds for the target, Grünhain and Salzküste among them', () => {
    expect(SPRING_FLORA.length).toBeGreaterThanOrEqual(F.depositKinds);
    for (const id of SPRING_FLORA) {
      const o = OBJECTS_BY_ID.get(id)!;
      expect(['busch', 'pflanze']).toContain(o.kind);
      expect((RESOURCES.ambientPlants as readonly string[]).includes(id)).toBe(false);
      expect(pickableIn(o, 'fruehling')).toBe(true);
    }
    // The start beach lies on the Salzküste beside the Grünhain: both have spring flora.
    expect(SPRING_FLORA.some((id) => OBJECTS_BY_ID.get(id)!.biomes.includes('salzkueste'))).toBe(true);
    expect(SPRING_FLORA.filter((id) => OBJECTS_BY_ID.get(id)!.biomes.includes('gruenhain')).length).toBeGreaterThanOrEqual(F.depositKinds - 1);
    expect(F.springKinds).toBeGreaterThan(2);
    expect(F.innerTiles).toBeLessThan(F.radiusTiles);
  });

  it(
    'a small world: the deposit kinds stand within the radius, the chunks bear more than two kinds in spring, the same each time',
    () => {
      for (const seed of [3, 11]) {
        const w = generateWorld(seed, 'small');
        const res = w.resources;
        const kinds = springKindsAround(res.objects, res.nodeX, res.nodeY, res.nodeObject, w.spawn.x, w.spawn.y, F.radiusTiles);
        expect(kinds.size, `seed ${seed}: ${[...kinds].join(', ')}`).toBeGreaterThanOrEqual(F.depositKinds);
        const picked = springPickableAround(w, F.radiusTiles);
        expect(picked.size, `seed ${seed}: ${[...picked].join(', ')}`).toBeGreaterThan(2);
        expect(generateWorld(seed, 'small').resources.deposits).toEqual(res.deposits);
      }
    },
    WORLD_TIMEOUT_MS,
  );
});
