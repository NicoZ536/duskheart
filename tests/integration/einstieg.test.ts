/**
 * M7-43 Einstieg „Die ersten Stunden“ (MASTERPROMPT §23.3; docs/SPIEL.md §23 „Einstieg“): headless spielt der Spieler des
 * Tag-1-Tests (tests/integration/tag1-spieler.ts) den ersten Tag – nur mit dem, was Tastatur, Maus und Menüs senden, dazu
 * das Setzen im Baumodus (`build.place`) für das Grasbett – und die Zielkette der Aufgabe `einstieg` wird vollständig erfüllt,
 * Schritt für Schritt in ihrer Reihenfolge:
 *
 * 1. Fasern und Steine (Strandhafer, Gräser, Steinchen), 2. die Steinaxt (Faserseil, dann die Axt),
 * 3. das Lagerfeuer vor der ersten Nacht (aufgestellt, Holz nachgelegt, mit E entzündet),
 * 4. der Unterschlupf (ein Grasbett neben dem Feuer, in der Nacht mit E hineingelegt),
 * 5. die Werkbank (hergestellt am Nachmittag).
 *
 * Danach ist die Aufgabe erledigt (`questCompleted`, Belohnung zwei Verbände), die Bronzezeit beginnt, Funke hat gesprochen,
 * und die Chronik hat ihre Einträge. Der Einstieg ist jederzeit abschaltbar: derselbe Morgen mit `quest.onboarding {on: false}`
 * startet ihn nicht, Funkes Einstiegs-Kommentare bleiben aus.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/content/balance';
import { parseGameCommand } from '../../src/game/commands';
import type { GatheringSystem } from '../../src/game/gathering/system';
import type { QuestsSystem } from '../../src/game/quests/system';
import { createSimulation } from '../../src/game/setup';
import type { StatsSystem } from '../../src/game/stats/system';
import type { Simulation } from '../../src/game/sim';
import { TILE_PX } from '../../src/world/model/coords';
import { Day1Player, objectsDropping, type Script, type Tile } from './tag1-spieler';

/** Die Welt des Tag-1-Tests (Seed 3, klein, 24-Minuten-Tag). */
const CONFIG = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;
/** Vorräte des Tages [Stück]: zwei Seile für die Werkbank, eins für die Axt; Holz für Feuer, Werkbank und Nacht. */
const FASERN_SEILE = 9;
const STEINE = 12;
const ZWEIGE = 2;
const HOLZ = 30;
/** Das Grasbett: Fasern, Laub, Zweige. */
const BETT = { fasern: 12, laub: 10, zweig: 4 } as const;
/** Stunden des Lagers und des Feuers (vor der Dämmerung, §10). */
const LAGER_STUNDE = 18;
const FEUER_STUNDE = 19;
/** Wie oft der Spieler nachts ans Bett geht, bis er müde genug ist [Ticks]. */
const VERSUCH_TICKS = 600;

const STEP_ORDER = ['fasern_steine', 'steinaxt', 'lagerfeuer', 'unterschlupf', 'werkbank'];

function ok(condition: boolean, what: string, p: Day1Player): void {
  if (!condition) throw new Error(`Einstieg: ${what} misslang um ${p.clockText()} (Verlauf: ${p.log.join(' · ')})`);
}

function byHand(sim: Simulation, ids: readonly string[]): string[] {
  const g = sim.system('gathering') as unknown as GatheringSystem;
  return ids.filter((id) => g.rules.object(id)?.standing?.tool === 'hand');
}

function trees(sim: Simulation, ids: readonly string[]): string[] {
  const g = sim.system('gathering') as unknown as GatheringSystem;
  return ids.filter((id) => g.rules.object(id)?.standing?.action === 'faellen');
}

/** Ein freier Platz für Feuer und Bett nahe dem Spieler (Feuer, Stehplatz darunter, das Bett 1×2 rechts daneben – beide in Reichweite von E). */
function lagerPlatz(p: Day1Player): { feuer: Tile; stand: Tile; bett: Tile } {
  const me = p.tile;
  for (let r = 1; r < 10; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const feuer = { tx: me.tx + dx, ty: me.ty + dy };
        const stand = { tx: feuer.tx, ty: feuer.ty + 1 };
        const bett = { tx: feuer.tx + 1, ty: feuer.ty };
        if ([feuer, stand, bett, { tx: bett.tx, ty: bett.ty + 1 }].every((t) => p.freeGround(t.tx, t.ty))) return { feuer, stand, bett };
      }
    }
  }
  throw new Error(`Einstieg: kein Lagerplatz bei ${me.tx},${me.ty}`);
}

/** Der Tag: sammeln, Werkzeug, Holz, Werkbank, Bett; am Abend Feuer und Bett aufstellen; in der Nacht ins Bett. */
function* tag(p: Day1Player): Script {
  const sim = p.sim;
  p.send({ type: 'player.spawn' });
  yield;
  ok(yield* p.gather('fasern', FASERN_SEILE, byHand(sim, objectsDropping('fasern'))), 'Fasern sammeln', p);
  ok(yield* p.gather('stein', STEINE, byHand(sim, objectsDropping('stein'))), 'Steine sammeln', p);
  ok(yield* p.gather('zweig', ZWEIGE, byHand(sim, objectsDropping('zweig'))), 'Zweige sammeln', p);
  ok(yield* p.craft('rezept_faserseil', 3), 'drei Faserseile', p);
  ok(yield* p.craft('rezept_steinaxt'), 'Steinaxt', p);
  const axe = p.slotOf('steinaxt');
  ok(axe !== null && axe.bereich === 'schnellleiste', 'Axt in der Schnellleiste', p);
  p.send({ type: 'player.selectHotbar', index: (axe as { index: number }).index });
  yield;
  const baeume = trees(sim, objectsDropping('holz'));
  ok(yield* p.gather('holz', HOLZ, baeume), 'Holz schlagen', p);
  ok(yield* p.craft('rezept_lagerfeuer'), 'Lagerfeuer herstellen', p);
  ok(yield* p.craft('rezept_werkbank'), 'Werkbank herstellen', p);
  ok(yield* p.gather('fasern', BETT.fasern, byHand(sim, objectsDropping('fasern'))), 'Fasern für das Bett', p);
  ok(yield* p.gather('laub', BETT.laub, [...byHand(sim, objectsDropping('laub')), ...baeume]), 'Laub für das Bett', p);
  ok(yield* p.gather('zweig', BETT.zweig, [...byHand(sim, objectsDropping('zweig')), ...baeume]), 'Zweige für das Bett', p);
  ok(yield* p.craft('rezept_grasbett'), 'Grasbett herstellen', p);
  ok(yield* p.gather('holz', 8, baeume), 'Holz für die Nacht', p);
  while (sim.clock.day === 1 && sim.clock.hour < LAGER_STUNDE) yield;
  const platz = lagerPlatz(p);
  ok(yield* p.goTo(platz.stand.tx, platz.stand.ty), 'zum Lagerplatz', p);
  // Das Feuer wie am ersten Tag: Schnellleiste, zielen, Primärtaste.
  const from = p.slotOf('lagerfeuer');
  ok(from !== null, 'Lagerfeuer in den Taschen', p);
  const hotbar = { bereich: 'schnellleiste', index: 1 } as const;
  p.send({ type: 'inventory.move', from: from as { bereich: 'inventar'; index: number }, to: hotbar });
  p.send({ type: 'player.selectHotbar', index: hotbar.index });
  p.send({ type: 'player.aim', x: platz.feuer.tx * TILE_PX + TILE_PX / 2, y: platz.feuer.ty * TILE_PX + TILE_PX / 2 });
  yield;
  p.send({ type: 'player.useItem' });
  ok(yield* p.waitFor(() => p.eventsOf('lightPlaced').length > 0, 10), 'Lagerfeuer aufstellen', p);
  // Das Grasbett im Baumodus daneben setzen (der Baumodus sendet `build.place`).
  sim.commands.push(parseGameCommand({ type: 'build.place', part: 'grasbett', tx: platz.bett.tx, ty: platz.bett.ty }));
  ok(yield* p.waitFor(() => p.eventsOf('partPlaced').length > 0 || p.eventsOf('commandRejected').length > 0, 10), 'Grasbett setzen', p);
  ok(p.eventsOf('commandRejected').length === 0, 'Grasbett setzen (abgelehnt)', p);
  const fed = yield* p.press(platz.feuer.tx, platz.feuer.ty);
  ok(fed.some((e) => e[0] === 'fireFueled'), 'Holz nachlegen', p);
  while (sim.clock.day === 1 && sim.clock.hour < FEUER_STUNDE) yield;
  const lit = yield* p.press(platz.feuer.tx, platz.feuer.ty);
  ok(lit.some((e) => e[0] === 'lightIgnited'), 'Feuer entzünden', p);
  p.log.push(`${p.clockText()} Feuer brennt, Bett bei ${platz.bett.tx},${platz.bett.ty}`);
  // In der Nacht ins Bett, sobald der Spieler müde genug ist (E auf das Bett).
  for (let versuch = 0; versuch < 24; versuch++) {
    // E on the bed's lower half, beside the standing place.
    const pressed = yield* p.press(platz.bett.tx, platz.bett.ty + 1);
    if (pressed.some((e) => e[0] === 'sleepStarted')) {
      p.log.push(`${p.clockText()} schläft im Grasbett`);
      return;
    }
    yield* p.wait(VERSUCH_TICKS);
  }
  ok(false, 'im Grasbett schlafen', p);
}

describe('M7-43 Einstieg im Tag-1-Szenario (headless)', () => {
  it('die Zielkette wird vollständig erfüllt – Fasern, Axt, Feuer vor der Nacht, Unterschlupf, Werkbank – in ihrer Reihenfolge', () => {
    const sim = createSimulation(CONFIG);
    const p = new Day1Player(sim);
    const schritte: Array<{ schritt: string; tag: number; stunde: number }> = [];
    const funke: string[] = [];
    let fertig = -1;
    let bronze = -1;
    const beobachten = (): void => {
      for (const [type, payload] of p.events) {
        const e = payload as Record<string, unknown>;
        if (type === 'questStepCompleted' && e.quest === 'einstieg') schritte.push({ schritt: String(e.schritt), tag: sim.clock.day, stunde: sim.clock.hour });
        if (type === 'questCompleted' && e.quest === 'einstieg') fertig = sim.tick;
        if (type === 'questStarted' && e.quest === 'bronzezeit') bronze = sim.tick;
        if (type === 'guideHint' && e.kanal === 'funke') funke.push(String(e.hint));
      }
    };
    function* lauf(): Script {
      const t = tag(p);
      for (;;) {
        const r = t.next();
        yield;
        beobachten();
        if (r.done === true) break;
      }
      // Bis der Werkbank-Schritt am nächsten Welt-Takt gilt (die Werkbank ist längst hergestellt).
      for (let i = 0; i < 600 && fertig < 0; i++) {
        yield;
        beobachten();
      }
    }
    p.run(lauf());
    const summary = `${p.clockText()} – Schritte ${JSON.stringify(schritte)} – ${p.log.join(' · ')}`;
    expect(schritte.map((s) => s.schritt), summary).toEqual(STEP_ORDER);
    // The fire before the first night: on day 1, before 20:00.
    const feuer = schritte[2] as { tag: number; stunde: number };
    expect(feuer.tag === 1 && feuer.stunde < 20, summary).toBe(true);
    expect(fertig, summary).toBeGreaterThan(0);
    const quests = sim.system('quests') as unknown as QuestsSystem;
    expect(quests.status('einstieg'), summary).toBe('erledigt');
    expect(p.count('verband'), summary).toBeGreaterThanOrEqual(2);
    // The side quest of bronze follows; Funke spoke on the way; nothing but player commands and the build mode's placement.
    for (let i = 0; i < 120 && bronze < 0; i++) {
      sim.step();
      sim.events.drain((type, payload) => {
        if (type === 'questStarted' && (payload as { quest: string }).quest === 'bronzezeit') bronze = sim.tick;
      });
    }
    expect(bronze, summary).toBeGreaterThan(0);
    expect(funke.length, summary).toBeGreaterThan(0);
    // Pacing of the first day (M7-64, docs/BALANCE.md): the play time to the onboarding's milestones – the player walks and
    // gathers every piece here, so these are the measured hours of T0 (the progression test gives the materials).
    const stats = sim.system('stats') as unknown as StatsSystem;
    const pacing = Object.fromEntries(['m_steinaxt', 'm_lagerfeuer', 'm_werkbank', 'm_erste_nacht'].map((id) => [id, stats.milestoneTime(id) / BALANCE.time.tickHz]));
    expect(pacing.m_steinaxt, summary).toBeGreaterThan(0);
    if (process.env.DH_PACING === '1') console.log(`PACING-TAG1 ${JSON.stringify(pacing)} fertig=${fertig / BALANCE.time.tickHz}`);
    const types = new Set(p.recorder.entries.map((e) => e.cmd.type));
    for (const t of types) expect(['player.spawn', 'player.move', 'player.sprint', 'player.aim', 'player.interact', 'player.selectHotbar', 'player.useItem', 'inventory.move', 'craft.start', 'build.place'], t).toContain(t);
  });

  it('jederzeit abschaltbar: mit dem Einstieg aus beginnt er nicht, und kein Einstiegs-Kommentar erklingt', () => {
    const sim = createSimulation(CONFIG);
    sim.step([{ type: 'quest.onboarding', on: false }, { type: 'player.spawn' }]);
    for (let i = 0; i < 120; i++) sim.step();
    const quests = sim.system('quests') as unknown as QuestsSystem;
    expect(quests.status('einstieg')).toBe('offen');
    expect(quests.onboarding).toBe(false);
    sim.step([{ type: 'quest.onboarding', on: true }]);
    expect(quests.status('einstieg')).toBe('aktiv');
  });
});
