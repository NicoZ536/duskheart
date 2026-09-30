/**
 * M4-05 Stationen T0 und M4-06 Stationen T1 (MASTERPROMPT §15.2; docs/SPIEL.md §8 "Stationen T0 (M4-05) … T1
 * (M4-06)", "Verarbeitungsprodukte T0–T1"):
 * - Content: die kanonischen Stationen T0 (Lagerfeuer als Station, Werkbank I, Sägebock, Steinmetzbank,
 *   Trockengestell, Köhlermeiler, Lehmofen) und T1 (Werkbank II, Schmelzofen, Bronzeamboss, Schleifstein, Spinnrad)
 *   mit Stufe, Linie, Art, Rezept, Texten DE/EN; der Validator zählt ≥ 7 bzw. ≥ 11 Stationen.
 * - Verhalten: aufstellen aus den Taschen (Reichweite, freier Boden), zurücknehmen mit Inhalt, öffnen; Werkbank I
 *   → II als Rezept an der Station, an Ort und Stelle; das Lagerfeuer als Station braucht ein brennendes Feuer;
 *   Handwerk-EP für eine gebaute Station, sobald sie die Frist des vollen Abbaus überstanden hat, Schmiede-EP am Amboss
 *   und beim Schmelzen; tot oder schlafend nichts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { STATIONS, stationSpriteId } from '../../../src/content/stations';
import { STATION_BUILT_XP_SOURCE } from '../../../src/game/stations/system';
import { OFFSET } from './spieler-testwelt';
import { catalog, eventsOf, stationWorld, TICK_HZ } from './stationen-testwelt';

/** Ids in backticks on the line of docs/SPIEL.md §8 that contains `label`, from `from` on. */
function canonical(label: string): string[] {
  const doc = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');
  const line = doc.split('\n').find((l) => l.includes(label));
  if (line === undefined) throw new Error(`docs/SPIEL.md §8 has no line ${label}`);
  return [...line.slice(line.indexOf(label)).matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1] as string);
}

const T0 = ['lagerfeuer', 'werkbank', 'saegebock', 'steinmetzbank', 'trockengestell', 'koehlermeiler', 'lehmofen'];
const T1 = ['werkbank_2', 'schmelzofen', 'amboss_bronze', 'schleifstein', 'spinnrad'];
/** The armoury's stations (M6-12 loom and tailor's table, M6-31 tanning frame; tests/unit/game/ruestung-inhalt.test.ts). */
const M6 = ['webstuhl', 'schneidertisch', 'gerbrahmen'];

describe('Stationen T0 und T1 als Content', () => {
  it('die kanonischen Ids aus docs/SPIEL.md §8 sind Stationen und platzierbare Items ihrer Stufe', () => {
    const line = canonical('**Stationen T0 (M4-05)**');
    for (const id of [...T0, ...T1]) expect(line, id).toContain(id);
    const stations = CONTENT.collection('stations');
    for (const [ids, tier] of [
      [T0, 0],
      [T1, 1],
    ] as const) {
      for (const id of ids) {
        expect(stations.has(id), id).toBe(true);
        const item = catalog.get(id);
        expect(item.kategorie, id).toBe('platzierbar');
        expect(item.stufe, id).toBe(tier);
        expect(item.name.de.length > 0 && item.name.en.length > 0, id).toBe(true);
        expect(item.beschreibung.de.length > 0 && item.beschreibung.en.length > 0, id).toBe(true);
      }
    }
    expect(STATIONS.map((s) => s.id)).toEqual([...T0, ...T1, ...M6]);
  });

  it('der Validator zählt ≥ 11 Stationen, die Zielwerte verlangen sie', () => {
    const count = CONTENT.countsByCategory().stations ?? 0;
    expect(count).toBe(STATIONS.length);
    expect(count).toBeGreaterThanOrEqual(T0.length + T1.length);
    const targets = JSON.parse(readFileSync(join(process.cwd(), 'tools/validator/zielwerte.json'), 'utf8')) as { ziele: { stations: number } };
    expect(targets.ziele.stations).toBeGreaterThanOrEqual(11);
    expect(targets.ziele.stations).toBeLessThanOrEqual(count);
  });

  it('Linien und Stufen: Werkbank II ist Stufe 2 der Werkbank; Verarbeitungsstationen haben Plätze, Öfen Brennstoff', () => {
    const s = CONTENT.collection('stations');
    expect(s.get('werkbank')).toMatchObject({ linie: 'werkbank', stufe: 1, art: 'handwerk' });
    expect(s.get('werkbank_2')).toMatchObject({ linie: 'werkbank', stufe: 2, art: 'handwerk' });
    for (const id of ['trockengestell', 'koehlermeiler', 'lehmofen', 'schmelzofen']) expect(s.get(id).art, id).toBe('verarbeitung');
    expect(s.get('trockengestell').verarbeitung?.brennstoff).toBe(false);
    for (const id of ['koehlermeiler', 'lehmofen', 'schmelzofen']) expect(s.get(id).verarbeitung?.brennstoff, id).toBe(true);
    expect(s.get('lagerfeuer').brennt).toBe(true);
    // Repair (§13.1): workbench, anvil, grindstone.
    expect(STATIONS.filter((x) => x.reparatur !== undefined).map((x) => x.id)).toEqual(['werkbank', 'werkbank_2', 'amboss_bronze', 'schleifstein']);
    expect(stationSpriteId('lehmofen')).toBe('obj_lehmofen');
    // Experience sources exist in the skills.
    const sources = new Set(CONTENT.collection('skills').values().flatMap((k) => k.quellen.map((q) => q.id)));
    for (const x of STATIONS) if (x.erfahrung !== undefined) expect(sources.has(x.erfahrung), x.id).toBe(true);
    expect(sources.has(STATION_BUILT_XP_SOURCE)).toBe(true);
  });

  it('jede Station außer den Grundlagen hat ihr Rezept; jede Station wird von Rezepten genutzt oder repariert', () => {
    const recipes = CONTENT.collection('recipes').values();
    for (const id of [...T0.slice(2), ...T1]) expect(recipes.some((r) => r.ergebnis.item === id), id).toBe(true);
    for (const x of STATIONS) expect(recipes.some((r) => r.station === x.id) || x.reparatur !== undefined, x.id).toBe(true);
    // The processing products of docs/SPIEL.md §8 are made at their stations.
    const products = canonical('**Verarbeitungsprodukte T0–T1**');
    expect(products).toHaveLength(16);
    for (const p of products) expect(recipes.some((r) => r.ergebnis.item === p && r.station !== null), p).toBe(true);
    const at = (item: string): (string | null)[] => recipes.filter((r) => r.ergebnis.item === item).map((r) => r.station);
    expect(at('holzkohle')).toEqual(['koehlermeiler', 'lagerfeuer']);
    expect(at('ziegel')).toEqual(['lehmofen']);
    expect(at('glas')).toEqual(['lehmofen']);
    expect(at('keramik_topf')).toEqual(['lehmofen']);
    expect(at('bronzebarren')).toEqual(['schmelzofen']);
    expect(at('garn')).toEqual(['spinnrad']);
    expect(at('steinblock')).toEqual(['steinmetzbank']);
  });
});

describe('Stationen aufstellen, öffnen, zurücknehmen', () => {
  it('aus den Taschen auf freien Boden in Reichweite; belegter, blockierter oder ferner Boden wird abgelehnt', () => {
    const w = stationWorld(['....................', '....................', '....................', '....................', '..........T.........']);
    w.give('saegebock', 3);
    w.give('fackel', 1);
    const place = (tx: number, ty: number, item = 'saegebock'): string[] => w.refused({ type: 'station.place', from: w.slotOf(item), tx: OFFSET + tx, ty: OFFSET + ty });
    expect(place(6, 4, 'fackel')).toEqual(['notAStation']);
    expect(place(4 + 12, 4)).toEqual(['outOfReach']);
    expect(place(9, 4)).toEqual(['tileBlocked']);
    const ok = w.run(1, [{ type: 'station.place', from: w.slotOf('saegebock'), tx: OFFSET + 6, ty: OFFSET + 3 }]);
    expect(eventsOf(ok, 'stationPlaced')).toEqual([expect.objectContaining({ station: 'saegebock', tx: OFFSET + 6, ty: OFFSET + 3 })]);
    expect(w.has('saegebock')).toBe(2);
    // The sawbuck covers (6, 3) and (7, 3): overlapping it is refused.
    expect(place(7, 3)).toEqual(['tileTaken']);
    expect(w.stations.stationAt(0, OFFSET + 7, OFFSET + 3)?.station).toBe('saegebock');
    // The campfire goes through the light system.
    w.give('lagerfeuer', 1);
    expect(place(6, 6, 'lagerfeuer')).toEqual(['placedElsewhere']);
  });

  it('Zurücknehmen gibt die Station mit allem in ihren Plätzen zurück; Öffnen meldet sich für die UI', () => {
    const w = stationWorld();
    // Set up from the bags: taken back within 30 s, it comes back whole (§16.6).
    w.give('lehmofen', 1);
    w.run(1, [{ type: 'station.place', from: w.slotOf('lehmofen'), tx: OFFSET + 6, ty: OFFSET + 4 }]);
    const oven = w.stations.placed[0]?.id as number;
    w.give('lehm', 5);
    w.give('holz', 2);
    w.run(1, [{ type: 'station.put', station: oven, from: w.slotOf('lehm'), bereich: 'eingang' }]);
    w.run(1, [{ type: 'station.put', station: oven, from: w.slotOf('holz'), bereich: 'brennstoff' }]);
    const opened = w.run(1, [{ type: 'station.use', station: oven }]);
    expect(eventsOf(opened, 'stationOpened')).toEqual([expect.objectContaining({ id: oven, station: 'lehmofen' })]);
    const removed = w.run(1, [{ type: 'station.remove', station: oven }]);
    expect(eventsOf(removed, 'stationRemoved')).toHaveLength(1);
    expect(w.stations.placed).toHaveLength(0);
    expect([w.has('lehmofen'), w.has('lehm'), w.has('holz')]).toEqual([1, 5, 1]);
    expect(w.refused({ type: 'station.use', station: oven })).toEqual(['unknownStation']);
  });

  it('zu weit weg, tot oder schlafend: abgelehnt', () => {
    const w = stationWorld();
    const far = w.place('saegebock', 14, 4);
    expect(w.refused({ type: 'station.use', station: far })).toEqual(['outOfReach']);
    const near = w.place('steinmetzbank', 6, 4);
    w.vit().health = 0;
    expect(w.refused({ type: 'station.use', station: near })).toEqual(['dead']);
  });

  it('das Bau-Raster kann Stationen melden: attach (gedreht) und detach geben Inhalt zurück; Aufwertungen hören Zuhörer', () => {
    const w = stationWorld();
    const id = w.stations.attach(w.sim, 'lehmofen', 0, OFFSET + 6, OFFSET + 3);
    expect(id).not.toBeNull();
    expect(w.stations.attach(w.sim, 'lehmofen', 0, OFFSET + 6, OFFSET + 3)).toBeNull();
    expect(w.stations.attach(w.sim, 'lagerfeuer', 0, OFFSET + 9, OFFSET + 3)).toBeNull();
    const bench = w.stations.attach(w.sim, 'werkbank', 0, OFFSET + 3, OFFSET + 6, { b: 1, t: 2 }) as number;
    expect(w.st(bench).groesse).toEqual({ b: 1, t: 2 });
    expect(w.stations.stationAt(0, OFFSET + 3, OFFSET + 7)?.id).toBe(bench);
    expect(w.stations.stationAt(0, OFFSET + 4, OFFSET + 6)).toBeUndefined();
    w.give('lehm', 3);
    w.run(1, [{ type: 'station.put', station: id as number, from: w.slotOf('lehm'), bereich: 'eingang' }]);
    expect(w.has('lehm')).toBe(0);
    expect(w.stations.detach(w.sim, 0, OFFSET + 6, OFFSET + 3)).toBe(true);
    expect(w.stations.detach(w.sim, 0, OFFSET + 6, OFFSET + 3)).toBe(false);
    expect([w.has('lehm'), w.has('lehmofen')]).toEqual([3, 0]);
    const heard: string[] = [];
    w.stations.addUpgradeListener((_s, st, from, to) => heard.push(`${st.id}:${from}→${to}`));
    expect(w.stations.upgrade(w.sim, bench, 'werkbank_2')).toBe(true);
    expect(heard).toEqual([`${bench}:werkbank→werkbank_2`]);
  });

  it('eine gebaute Station gibt Handwerk-Erfahrung, sobald sie die Frist des vollen Abbaus überstanden hat', () => {
    // Review M4 #3: the experience came with every `station.place`, and taking the station back within the window
    // returned it whole – placing and taking back farmed Handwerk without end. It is due once the station stands.
    const w = stationWorld();
    w.give('saegebock', 1);
    const ev = w.run(1, [{ type: 'station.place', from: w.slotOf('saegebock'), tx: OFFSET + 6, ty: OFFSET + 4 }]);
    expect(eventsOf(ev, 'xpGained')).toEqual([]);
    const window = BALANCE.building.refund.fullSeconds * TICK_HZ;
    expect(eventsOf(w.run(window - 1), 'xpGained')).toEqual([]);
    expect(eventsOf(w.run(2), 'xpGained')).toEqual([expect.objectContaining({ skill: 'handwerk', source: STATION_BUILT_XP_SOURCE })]);
    expect(eventsOf(w.run(TICK_HZ), 'xpGained')).toEqual([]);
  });
});

describe('Werkbank I → II an Ort und Stelle, Lagerfeuer als Station, Schmiede-Erfahrung', () => {
  it('das Aufwertungsrezept verwandelt die Werkbank, an der es entsteht, in Werkbank II', () => {
    const w = stationWorld();
    const bench = w.place('werkbank', 6, 4);
    w.give('brett', 8);
    w.give('balken', 2);
    w.give('kupferbarren', 2);
    w.give('faserseil', 4);
    w.run(1);
    expect(w.crafting.isVisible('rezept_werkbank_2')).toBe(true);
    const ev = w.run(BALANCE.crafting.durationSeconds.gross * TICK_HZ + 2, [{ type: 'craft.start', recipe: 'rezept_werkbank_2', count: 1 }]);
    expect(eventsOf(ev, 'stationUpgraded')).toEqual([expect.objectContaining({ id: bench, from: 'werkbank', to: 'werkbank_2' })]);
    expect(eventsOf(ev, 'craftCompleted')).toEqual([expect.objectContaining({ item: 'werkbank_2', aufgewertet: true })]);
    expect(w.st(bench)).toMatchObject({ station: 'werkbank_2', tx: OFFSET + 6, ty: OFFSET + 4 });
    expect(w.has('werkbank_2')).toBe(0);
    expect(w.stations.placed).toHaveLength(1);
    expect(w.crafting.knowsStation('werkbank_2')).toBe(true);
  });

  it('das Lagerfeuer als Station: Holzkohle aus der Glut nur an einem brennenden Feuer', () => {
    const w = stationWorld();
    w.give('holz', 6);
    w.give('lagerfeuer', 1);
    w.run(1);
    expect(w.crafting.isVisible('rezept_holzkohle_lagerfeuer')).toBe(true);
    expect(w.refused({ type: 'craft.start', recipe: 'rezept_holzkohle_lagerfeuer', count: 1 })).toEqual(['noStation']);
    w.litFires.add('5,4');
    const ev = w.run(BALANCE.crafting.durationSeconds.gross * TICK_HZ + 2, [{ type: 'craft.start', recipe: 'rezept_holzkohle_lagerfeuer', count: 1 }]);
    expect(eventsOf(ev, 'craftCompleted')).toHaveLength(1);
    expect(w.has('holzkohle')).toBe(1);
  });

  it('am Amboss geschmiedet und aus dem Schmelzofen genommen gibt Schmiede-Erfahrung', () => {
    const w = stationWorld();
    w.place('amboss_bronze', 5, 3);
    w.give('bronzebarren', 1);
    w.run(1);
    const ev = w.run(BALANCE.crafting.durationSeconds.werkzeug * TICK_HZ + 2, [{ type: 'craft.start', recipe: 'rezept_nagel_bronze', count: 1 }]);
    expect(eventsOf<{ source: string }>(ev, 'xpGained').map((e) => e.source)).toEqual(['gegenstand_hergestellt', 'metall_geschmiedet']);
    expect(w.has('nagel_bronze')).toBe(8);
    const furnace = w.place('schmelzofen', 6, 5);
    const proc = w.stations.station(furnace)?.proc;
    if (proc === null || proc === undefined) throw new Error('no slots');
    proc.ausgang[0] = { item: 'kupferbarren', count: 3 };
    const taken = w.run(1, [{ type: 'station.takeAll', station: furnace }]);
    expect(eventsOf(taken, 'xpGained')).toEqual([expect.objectContaining({ source: 'barren_geschmolzen' })]);
    expect(w.has('kupferbarren')).toBe(3);
  });
});
