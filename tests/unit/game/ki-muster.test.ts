/**
 * Musterwahl der Angriffe (M6-13, M6-Gate; MASTERPROMPT §19.4 „Angreifen (Musterauswahl mit Gewichtung und Cooldowns)“;
 * docs/SPIEL.md §11 „Angreifen (Musterwahl gewichtet mit Abklingzeiten)“): unter den bereiten Angriffen in Reichweite wählt
 * die Kreatur nach `gewicht` (Strom `creatures`, geseedet), und kein Angriff kommt vor dem Ende seiner `abklingzeit` wieder.
 * - Gewichtung: eine Probe-Kreatur mit zwei Angriffen (3 : 1, Abklingzeit kürzer als die Erholung – beide sind bei jeder
 *   Wahl bereit) schlägt rund drei Viertel ihrer Schläge mit dem schweren Gewicht.
 * - Abklingzeiten: der Keiler direkt am Spieler (Hauer 2 s, Ansturm 6 s) wiederholt keinen Angriff vor dessen Abklingzeit.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { AI_PROFILES, CREATURES, LOOT_TABLES, TRAPS } from '../../../src/content/creatures/index';
import { defineCreatureRecords } from '../../../src/content/creatures/define';
import { creatureSchema } from '../../../src/content/creatures/schema';
import type { Entity } from '../../../src/engine/ecs';
import { CreatureCatalog } from '../../../src/game/creatures/catalog';
import type { SimEventMap } from '../../../src/game/sim';
import { eventsOf } from './kampf-testwelt';
import { PROBE_BEUTE, PROBE_KREATUREN, PROBE_PROFILE, PROBE_SPAWN, kreaturWelt, meadow, type KreaturWelt } from './kreatur-testwelt';

const HZ = BALANCE.time.tickHz;
type Attack = SimEventMap['creatureAttack'];

const WOLF = PROBE_KREATUREN.find((c) => c.id === 'probe_wolf');
if (WOLF === undefined) throw new Error('probe_wolf');
const BISS = WOLF.angriffe[0];
if (BISS === undefined) throw new Error('probe_wolf bites');

/** A probe wolf with two attacks of weight 3 and 1, both in reach, their cooldown (0,1 s) shorter than the recovery. */
const ZWEISCHLAG = defineCreatureRecords('creatures', creatureSchema, [
  {
    ...WOLF,
    id: 'probe_zweischlag',
    beute: null,
    ohneBeute: 'Probe ohne Beute',
    angriffe: [
      { ...BISS, name: 'biss', gewicht: 3, abklingzeit: 0.1 },
      { ...BISS, name: 'kratzen', gewicht: 1, abklingzeit: 0.1 },
    ],
  },
]);

function catalog(): CreatureCatalog {
  return new CreatureCatalog([...CREATURES, ...PROBE_KREATUREN, ...ZWEISCHLAG], [...AI_PROFILES, ...PROBE_PROFILE], [...LOOT_TABLES, ...PROBE_BEUTE], [...PROBE_SPAWN], TRAPS);
}

/** The blows of creature `id` placed a tile north of the player (god mode) over `seconds`, by attack name with their ticks. */
function blows(id: string, seconds: number, seed = 1): { w: KreaturWelt; e: Entity; by: Map<string, number[]>; order: string[] } {
  const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 }, seed, 'probe', catalog());
  w.cheats.god = true;
  const e = w.creature(id, 20, 14);
  const by = new Map<string, number[]>();
  const order: string[] = [];
  for (let i = 0; i < seconds * HZ; i++) {
    for (const a of eventsOf<Attack>(w.run(1), 'creatureAttack')) {
      if (a.entity !== e) continue;
      by.set(a.angriff, [...(by.get(a.angriff) ?? []), a.tick]);
      order.push(a.angriff);
    }
  }
  return { w, e, by, order };
}

describe('Musterwahl nach Gewicht (M6-13)', () => {
  it('zwei bereite Angriffe 3 : 1 – rund drei Viertel der Schläge nehmen den schweren', () => {
    const { by, order } = blows('probe_zweischlag', 90);
    const biss = by.get('biss')?.length ?? 0;
    const kratzen = by.get('kratzen')?.length ?? 0;
    expect(biss + kratzen).toBeGreaterThanOrEqual(60);
    // Binomial with p = 0,75 over ≥ 60 blows: three standard deviations are under 0,17.
    const share = biss / (biss + kratzen);
    expect(share).toBeGreaterThan(0.6);
    expect(share).toBeLessThan(0.9);
    expect(kratzen).toBeGreaterThan(0);
    // Both stay possible after each other (the cooldown never forces the other one).
    expect(order.some((n, i) => i > 0 && n === order[i - 1] && n === 'biss')).toBe(true);
  });

  it('geseedet: dieselbe Welt wählt dieselbe Folge, ein anderer Seed eine andere', () => {
    const a = blows('probe_zweischlag', 30).order;
    const b = blows('probe_zweischlag', 30).order;
    const c = blows('probe_zweischlag', 30, 7).order;
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });
});

describe('Abklingzeiten je Angriff (M6-13)', () => {
  it('der Keiler am Spieler wiederholt weder Hauer noch Ansturm vor ihrer Abklingzeit – und nutzt beide', () => {
    const keiler = CREATURES.find((c) => c.id === 'keiler');
    if (keiler === undefined) throw new Error('keiler');
    const { by } = blows('keiler', 60);
    for (const a of keiler.angriffe) {
      const ticks = by.get(a.name) ?? [];
      expect(ticks.length, a.name).toBeGreaterThanOrEqual(3);
      const cooldown = Math.round(a.abklingzeit * HZ);
      for (let i = 1; i < ticks.length; i++) expect((ticks[i] as number) - (ticks[i - 1] as number), `${a.name} #${i}`).toBeGreaterThanOrEqual(cooldown);
    }
  });
});
