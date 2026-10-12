/**
 * Fixture-Beitrag „Naturwunder“ (Referenzspielstand v4, tools/save/fixtureM7/naturwunder.ts; M7-122): nur über Befehle wird das
 * nächste Naturwunder der Fixture-Welt (Seed 3, klein) entdeckt; der Tagebucheintrag hält seine Variante neben dem Ortstyp
 * (`zusatz`), die Chronik nennt sie („Entdeckt: Geysirfeld.“) – und gespeichert und geladen bleibt alles gleich. Ein
 * Spielstand von vor M7 (v3) lädt ohne entdecktes Naturwunder.
 */
import { describe, expect, it } from 'vitest';
import type { ChronicleSystem } from '../../src/game/chronicle/system';
import { placeName } from '../../src/game/places/names';
import { createSimulation } from '../../src/game/setup';
import { MemorySaveStore } from '../../src/save/memoryStore';
import { loadWorld, saveWorld } from '../../src/save/world';
import { tagebuchText } from '../../src/ui/screens/chronik/modell';
import { loadFixture, readFixture } from '../../tools/save/fixture';
import { EMPTY_NATURWUNDER_FACTS, naturwunderFacts, naturwunderFactsSchema, playNaturwunder } from '../../tools/save/fixtureM7/naturwunder';
import { WORLD_TIMEOUT_MS } from '../unit/world/weltgen-hilfen';

/** Fixed meta of the save (the timestamp is no simulation input). */
const SAVED_AT = Date.UTC(2026, 9, 12);

describe('Fixture-Beitrag „Naturwunder“ (Referenzspielstand v4, tools/save/fixtureM7/naturwunder.ts)', () => {
  it(
    'nur über Befehle: ein Naturwunder entdeckt, der Eintrag hält und nennt seine Variante – verlustfrei gespeichert',
    async () => {
      const sim = createSimulation({ seed: 3, worldSize: 'small' });
      expect(naturwunderFacts(sim)).toEqual(EMPTY_NATURWUNDER_FACTS);
      sim.step([{ type: 'player.spawn' }]);
      playNaturwunder(sim);
      const facts = naturwunderFactsSchema.parse(naturwunderFacts(sim));
      expect(facts.wunder).toHaveLength(1);
      const wunder = facts.wunder[0];
      expect(['uraltbaum', 'geysirfeld', 'kristallbogen']).toContain(wunder?.variante);
      expect(wunder?.chronik).toBe(wunder?.variante);
      const chronicle = sim.system('chronicle') as ChronicleSystem;
      const entry = chronicle.entries().find((e) => e.rule === 'chronik_ort_entdeckt' && e.values.ortstyp === 'naturwunder');
      if (entry === undefined || wunder === undefined) throw new Error('kein Tagebucheintrag des Naturwunders');
      const name = placeName('naturwunder', wunder.variante);
      expect(tagebuchText(entry, 'de')).toBe(`Entdeckt: ${name?.de}.`);
      expect(tagebuchText(entry, 'en')).toBe(`Discovered: ${name?.en}.`);
      expect(name?.de).not.toBe('Naturwunder');

      const store = new MemorySaveStore();
      await saveWorld(store, sim, { worldId: 'naturwunder', name: 'Naturwunder', now: SAVED_AT, gameVersion: 'test' });
      const loaded = await loadWorld(store, 'naturwunder');
      expect(naturwunderFacts(loaded)).toEqual(facts);
    },
    WORLD_TIMEOUT_MS,
  );

  it('ein Spielstand von vor M7 (v3) lädt ohne entdecktes Naturwunder', async () => {
    const sim = await loadFixture(readFixture(3));
    expect(naturwunderFacts(sim)).toEqual(EMPTY_NATURWUNDER_FACTS);
  });
});
