/**
 * Fixture-Beitrag „Chronik & Führung“ (Referenzspielstand v4, tools/save/fixtureM7/chronik.ts; docs/SPIEL.md §27 "Aufgaben mitten
 * im Akt, Erfolge, Chronik-Einträge"): nach dem Szenario des Referenzspielstands steht der Einstieg mitten im Weg und nicht mehr
 * verfolgt, die Hauptaufgabe mitten im Akt; die Erfolge, Einträge und das Wissen des Szenarios sind da – und gespeichert und
 * geladen bleibt alles gleich. Ein Spielstand von vor M7 (v3) lädt mit allem leer (`emptyChronikFacts`).
 */
import { describe, expect, it } from 'vitest';
import { MemorySaveStore } from '../../src/save/memoryStore';
import { loadWorld, saveWorld } from '../../src/save/world';
import { loadFixture, playFixtureScenario, readFixture } from '../../tools/save/fixture';
import { CHRONIK_FIXTURE, chronikFacts, chronikFactsSchema, emptyChronikFacts } from '../../tools/save/fixtureM7/chronik';

/** Fixed meta of the save (the timestamp is no simulation input). */
const SAVED_AT = Date.UTC(2026, 9, 6);

describe('Fixture-Beitrag „Chronik“ (Referenzspielstand v4, tools/save/fixtureM7/chronik.ts)', () => {
  it('nur über Befehle: Aufgaben mitten im Akt, der Einstieg nicht verfolgt, Erfolge, Einträge und Wissen – verlustfrei gespeichert', async () => {
    // The scenario of the reference save plays the contribution itself (after the places and the vault, before the fight).
    const sim = playFixtureScenario();
    const facts = chronikFactsSchema.parse(chronikFacts(sim));
    expect(facts.quests).toEqual([
      { quest: CHRONIK_FIXTURE.einstieg, status: 'aktiv', step: 'steinaxt', count: 0, tracked: false },
      { quest: CHRONIK_FIXTURE.hauptaufgabe, status: 'aktiv', step: 'staette_finden', count: 0, tracked: true },
    ]);
    expect(facts.onboarding).toBe(true);
    expect(facts.achievements.map((a) => a.id)).toEqual(expect.arrayContaining(['erste_nacht', 'borkenvater_besiegt', 'erstes_feuer']));
    expect(facts.chronicle.length).toBeGreaterThanOrEqual(10);
    expect(facts.chronicle.map((e) => e.rule)).toEqual(expect.arrayContaining(['chronik_erste_nacht', 'chronik_boss_besiegt', 'chronik_leuchtfeuer_entzuendet', 'chronik_ort_entdeckt']));
    expect(facts.knowledge).toEqual(expect.arrayContaining(['wissen_sechs_feuer', 'wissen_leuchtfeuer', 'wissen_bosse']));
    // Three places discovered: the farmstead of the places part (B), the natural wonder of the wonder part (V4) and the vault
    // the vault part goes down into (C).
    expect(facts.stats).toMatchObject({ naechte_ueberlebt: 1, tode: 1, bosse_besiegt: 1, leuchtfeuer_entzuendet: 1, orte_entdeckt: 3, raetsel_geloest: 1 });
    expect(facts.chronicle.map((e) => e.rule)).toEqual(expect.arrayContaining(['chronik_gewoelbe_betreten', 'chronik_gewoelbe_erstes_raetsel']));
    expect(facts.milestones.map((m) => m.id)).toEqual(expect.arrayContaining(['m_erste_nacht', 'm_borkenvater', 'm_lf1']));
    expect(facts.guide.said.length).toBeGreaterThan(0);

    const store = new MemorySaveStore();
    await saveWorld(store, sim, { worldId: 'chronik', name: 'Chronik', now: SAVED_AT, gameVersion: 'test' });
    const loaded = await loadWorld(store, 'chronik');
    expect(chronikFacts(loaded)).toEqual(facts);
  });

  it('ein Spielstand von vor M7 (v3) lädt leer: nichts gezählt, kein Eintrag, keine Aufgabe begonnen, Einstieg und Hinweise an', async () => {
    const sim = await loadFixture(readFixture(3));
    expect(chronikFacts(sim)).toEqual(emptyChronikFacts());
  });
});
