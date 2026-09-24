/**
 * M3-36 Tag-1-Integrationstest (MASTERPROMPT §31.2 "Tag-1-Szenario (sammeln → Werkzeuge → Feuer → Nacht
 * überleben)", §32 M3): headless, ein Spieler wacht am Startstrand auf und spielt den ersten Tag – nur mit
 * den Befehlen, die Tastatur, Maus und Menüs senden (tests/integration/tag1-spieler.ts):
 *
 * 1. Mit bloßen Händen: Fasern (Strandhafer, Gräser), Steine und Feuerstein (Steinchen), Zweige (Laub).
 * 2. Faserseil → Steinaxt (Handwerk ohne Station), die Axt liegt in der Hand.
 * 3. Bäume fällen (Holz, Zweige, Harz), Lagerfeuer herstellen, am Nachmittag am Fluss trinken (E aufs Wasser).
 * 4. Am Abend das Lagerfeuer aufstellen (Schnellleiste + Primärtaste), mit E Holz nachlegen und entzünden.
 * 5. Die Nacht am Feuer: mit E nachlegen, bevor es ausgeht, bis 06:00 des zweiten Tages.
 *
 * Am Morgen gilt (M3-36): Leben > 0, Kerntemperatur ≥ 36 °C, Furcht < 60 – und die Nacht war wirklich eine
 * Gefahr: dieselbe Nacht ohne Feuer (derselbe Tag bis zum Abend, dann im Dunkeln stehen) endet unterkühlt
 * und mit hoher Furcht. Die Aufzeichnung enthält nur Spielerbefehle; ihr Replay auf einer frischen
 * Simulation ergibt denselben Zustands-Hash.
 */
import { describe, expect, it } from 'vitest';
import { ReplayPlayer } from '../../src/engine/commands';
import type { DeathSystem } from '../../src/game/death/system';
import type { GatheringSystem } from '../../src/game/gathering/system';
import { createSimulation } from '../../src/game/setup';
import type { Simulation } from '../../src/game/sim';
import { TILE_PX } from '../../src/world/model/coords';
import { Day1Player, PLAYER_COMMANDS, objectsDropping, type Script, type Tile } from './tag1-spieler';

/** Welt des Tests: klein, Seed mit Kiefern, Steinchen und Strandhafer am Strand und einem Fluss in Sichtweite. */
const CONFIG = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;

/** Vorräte des Tages [Stück]. */
const FIBRES = 5;
const STONES = 8;
const TWIGS = 2;
/** Holz für das Lagerfeuer (3) und die Nacht (11 Spielstunden ≈ 660 s Brennzeit, je Scheit 45 s). */
const LOGS = 20;
/** Durst, ab dem der Spieler zum Wasser geht, und bis zu dem er trinkt [Punkte]. */
const THIRSTY_BELOW = 75;
const DRUNK_FROM = 95;
/** Stunde, zu der das Lager aufgeschlagen wird (vor der Dämmerung, §10) [Spielstunde]. */
const CAMP_HOUR = 18;
/** Stunde, zu der das Feuer entzündet wird [Spielstunde]. */
const LIGHT_HOUR = 19;
/** Restbrennzeit, bei der nachgelegt wird [s] (E legt nach, so viel das Feuer fasst: höchstens 6 min, §15.4). */
const REFUEL_BELOW_S = 120;
/** Wie oft der Spieler nachts nach dem Feuer sieht [Ticks]. */
const CHECK_TICKS = 300;

interface DayReport {
  readonly player: Day1Player;
  /** Tick, in dem der Morgen des zweiten Tages erreicht war. */
  readonly morningTick: number;
  readonly fireId: number;
  /** Nächte-Zustand: kleinste Kerntemperatur und größte Furcht zwischen 20:00 und 06:00. */
  readonly nightMinCoreC: number;
  readonly nightMaxFear: number;
  /** Ticks der Nacht (20:00–06:00), in denen das Feuer brannte, und alle Ticks der Nacht. */
  readonly litTicks: number;
  readonly nightTicks: number;
}

function hour(sim: Simulation): number {
  return sim.clock.hour;
}

function isMorningOfDay2(sim: Simulation): boolean {
  return sim.clock.day >= 2 && sim.clock.hour >= 6;
}

function ok(condition: boolean, what: string, p: Day1Player): void {
  if (!condition) throw new Error(`Tag 1: ${what} misslang um ${p.clockText()} (Verlauf: ${p.log.join(' · ')})`);
}

/** Die Welt-Objekte von `ids`, die sich mit bloßen Händen bearbeiten lassen. */
function byHand(sim: Simulation, ids: readonly string[]): string[] {
  const gathering = sim.system('gathering') as unknown as GatheringSystem;
  return ids.filter((id) => gathering.rules.object(id)?.standing?.tool === 'hand');
}

/** Die Bäume unter `ids` (fällbar mit der Axt). */
function trees(sim: Simulation, ids: readonly string[]): string[] {
  const gathering = sim.system('gathering') as unknown as GatheringSystem;
  return ids.filter((id) => gathering.rules.object(id)?.standing?.action === 'faellen');
}

/** Tagsüber: sammeln, Werkzeug, Holz, Lagerfeuer, trinken. */
function* gatherAndCraft(p: Day1Player): Script {
  const sim = p.sim;
  p.send({ type: 'player.spawn' });
  yield;
  p.log.push(`${p.clockText()} erwacht am Strand ${p.tile.tx},${p.tile.ty}`);
  ok(yield* p.gather('fasern', FIBRES, byHand(sim, objectsDropping('fasern'))), 'Fasern sammeln', p);
  ok(yield* p.gather('stein', STONES, byHand(sim, objectsDropping('stein'))), 'Steine sammeln', p);
  ok(yield* p.gather('zweig', TWIGS, byHand(sim, objectsDropping('zweig'))), 'Zweige sammeln', p);
  p.log.push(`${p.clockText()} Fasern ${p.count('fasern')}, Steine ${p.count('stein')}, Zweige ${p.count('zweig')}`);
  ok(yield* p.craft('rezept_faserseil'), 'Faserseil herstellen', p);
  ok(yield* p.craft('rezept_steinaxt'), 'Steinaxt herstellen', p);
  const axe = p.slotOf('steinaxt');
  ok(axe !== null && axe.bereich === 'schnellleiste', 'Axt in der Schnellleiste', p);
  p.send({ type: 'player.selectHotbar', index: (axe as { index: number }).index });
  yield;
  const felled = trees(sim, objectsDropping('holz'));
  ok(yield* p.gather('holz', LOGS, felled), 'Holz schlagen', p);
  p.log.push(`${p.clockText()} Holz ${p.count('holz')}, Harz ${p.count('harz')}, Zweige ${p.count('zweig')}`);
  ok(yield* p.craft('rezept_lagerfeuer'), 'Lagerfeuer herstellen', p);
  // Nachschub: was nach dem Lagerfeuer fehlt, wieder auf LOGS auffüllen.
  ok(yield* p.gather('holz', LOGS - 2, felled), 'Holz für die Nacht', p);
  // Bis zum Abend: trinken, sobald der Durst kommt.
  while (sim.clock.day === 1 && hour(sim) < CAMP_HOUR) {
    yield* drink(p);
    yield* p.wait(CHECK_TICKS);
  }
}

/** Geht zum nächsten Süßwasser und trinkt, bis der Durst gestillt ist. */
function* drink(p: Day1Player): Script {
  if (p.vitals.thirst >= THIRSTY_BELOW) return;
  const water = p.freshWater();
  ok(water !== null, 'Süßwasser finden', p);
  const w = water as Tile;
  ok(yield* p.approachTile(w.tx, w.ty, 1), 'zum Wasser gehen', p);
  while (p.vitals.thirst < DRUNK_FROM) {
    const pressed = yield* p.press(w.tx, w.ty);
    ok(pressed.every((e) => e[0] !== 'commandRejected'), 'E aufs Wasser', p);
    const drank = yield* p.waitFor(() => p.eventsOf('waterDrunk').length > 0 || p.eventsOf('commandRejected').length > 0, 600);
    ok(drank && p.eventsOf('commandRejected').length === 0, 'trinken', p);
  }
  p.log.push(`${p.clockText()} getrunken, Durst ${p.vitals.thirst.toFixed(0)}`);
}

/** Wartet bis zur Stunde `h` des ersten Tages (spätestens bis zum Morgen). */
function* untilHour(p: Day1Player, h: number): Script {
  while (p.sim.clock.day === 1 && hour(p.sim) < h) yield;
}

/** Sucht einen freien Platz für das Feuer neben einem freien Stehplatz; liefert Feuer- und Stehplatz. */
function campSpot(p: Day1Player): { fire: Tile; stand: Tile } {
  const me = p.tile;
  for (let r = 1; r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const fire = { tx: me.tx + dx, ty: me.ty + dy };
        if (!p.freeGround(fire.tx, fire.ty)) continue;
        const stand = { tx: fire.tx, ty: fire.ty + 1 };
        if (p.freeGround(stand.tx, stand.ty)) return { fire, stand };
      }
    }
  }
  throw new Error(`Tag 1: kein Lagerplatz bei ${me.tx},${me.ty} um ${p.clockText()} (Verlauf: ${p.log.join(' · ')})`);
}

/** Schlägt das Lager auf: Feuer aufstellen, füttern; gibt die Id des Feuers und den Stehplatz zurück. */
function* makeCamp(p: Day1Player, out: { fireId: number; fire: Tile; stand: Tile }): Script {
  yield* untilHour(p, CAMP_HOUR);
  const spot = campSpot(p);
  ok(yield* p.goTo(spot.stand.tx, spot.stand.ty), 'zum Lagerplatz gehen', p);
  // Das Lagerfeuer in die Schnellleiste legen, auswählen, auf den Platz zielen und benutzen (LMB).
  const from = p.slotOf('lagerfeuer');
  ok(from !== null, 'Lagerfeuer in den Taschen', p);
  const hotbar = { bereich: 'schnellleiste', index: 1 } as const;
  p.send({ type: 'inventory.move', from: from as { bereich: 'inventar'; index: number }, to: hotbar });
  p.send({ type: 'player.selectHotbar', index: hotbar.index });
  p.send({ type: 'player.aim', x: spot.fire.tx * TILE_PX + TILE_PX / 2, y: spot.fire.ty * TILE_PX + TILE_PX / 2 });
  yield;
  p.send({ type: 'player.useItem' });
  const placed = yield* p.waitFor(() => p.eventsOf('lightPlaced').length > 0, 10);
  ok(placed, 'Lagerfeuer aufstellen', p);
  const light = p.eventsOf('lightPlaced')[0] as { light: number };
  out.fireId = light.light;
  out.fire = spot.fire;
  out.stand = spot.stand;
  p.log.push(`${p.clockText()} Lagerfeuer #${out.fireId} bei ${spot.fire.tx},${spot.fire.ty}`);
  yield* fuel(p, out.fire);
  yield* untilHour(p, LIGHT_HOUR);
  const lit = yield* p.press(spot.fire.tx, spot.fire.ty);
  ok(lit.some((e) => e[0] === 'lightIgnited'), 'Feuer entzünden', p);
  p.log.push(`${p.clockText()} Feuer brennt (${p.fire(out.fireId).fuelSeconds.toFixed(0)} s Brennstoff)`);
}

/** Legt mit E Holz nach (so viel, wie das Feuer fasst). */
function* fuel(p: Day1Player, fire: Tile): Script {
  if (p.slotOf('holz') === null) return;
  const fed = yield* p.press(fire.tx, fire.ty);
  ok(fed.some((e) => e[0] === 'fireFueled'), 'Holz nachlegen', p);
}

describe('M3-36 Tag 1 (headless)', () => {
  function playDay(withFire: boolean): DayReport {
    const sim = createSimulation(CONFIG);
    const p = new Day1Player(sim);
    const camp = { fireId: 0, fire: { tx: 0, ty: 0 }, stand: { tx: 0, ty: 0 } };
    let nightMinCoreC = Infinity;
    let nightMaxFear = 0;
    let litTicks = 0;
    let nightTicks = 0;
    function* day(): Script {
      yield* gatherAndCraft(p);
      if (withFire) yield* makeCamp(p, camp);
      else yield* untilHour(p, LIGHT_HOUR);
      // Die Nacht: am Feuer stehen und nachlegen – oder ohne Feuer im Dunkeln warten.
      while (!isMorningOfDay2(sim)) {
        for (let i = 0; i < CHECK_TICKS && !isMorningOfDay2(sim); i++) {
          const h = hour(sim);
          if (h >= 20 || h < 6) {
            nightTicks++;
            if (withFire && p.fire(camp.fireId).lit) litTicks++;
            nightMinCoreC = Math.min(nightMinCoreC, p.vitals.coreC);
            nightMaxFear = Math.max(nightMaxFear, p.fear);
          }
          yield;
        }
        if (withFire && p.fire(camp.fireId).fuelSeconds < REFUEL_BELOW_S) yield* fuel(p, camp.fire);
      }
    }
    p.run(day());
    return { player: p, morningTick: sim.tick, fireId: camp.fireId, nightMinCoreC, nightMaxFear, litTicks, nightTicks };
  }

  it('sammeln → Werkzeuge → Feuer → die Nacht am Feuer überleben (Leben > 0, Kern ≥ 36 °C, Furcht < 60)', () => {
    const r = playDay(true);
    const p = r.player;
    const sim = p.sim;
    const v = p.vitals;
    const summary = `${p.clockText()}: Leben ${v.health.toFixed(1)}, Kern ${v.coreC.toFixed(2)} °C, Furcht ${p.fear.toFixed(1)} – ${p.log.join(' · ')}`;
    expect(isMorningOfDay2(sim), summary).toBe(true);
    expect(sim.clock.hour, summary).toBe(6);
    // Die Akzeptanz von M3-36.
    expect(v.health, summary).toBeGreaterThan(0);
    expect(v.coreC, summary).toBeGreaterThanOrEqual(36);
    expect(p.fear, summary).toBeLessThan(60);
    expect((sim.system('death') as unknown as DeathSystem).dead, summary).toBe(false);
    // Der Weg dorthin: Werkzeug, Feuer, eine durchgehend erleuchtete, warme Nacht.
    expect(p.log.some((l) => l.includes('rezept_steinaxt ×1')), summary).toBe(true);
    expect(p.log.some((l) => l.includes('rezept_lagerfeuer ×1')), summary).toBe(true);
    expect(r.nightTicks, summary).toBeGreaterThan(0);
    expect(r.litTicks / r.nightTicks, summary).toBeGreaterThan(0.99);
    expect(r.nightMinCoreC, summary).toBeGreaterThanOrEqual(36);
    expect(r.nightMaxFear, summary).toBeLessThan(60);
    // Nur Spielerbefehle, und nur sie bestimmen den Tag: ihr Replay ergibt denselben Zustand.
    const types = new Set(p.recorder.entries.map((e) => e.cmd.type));
    for (const t of types) expect(PLAYER_COMMANDS.has(t), t).toBe(true);
    const replay = createSimulation(CONFIG);
    const player = new ReplayPlayer(p.recorder);
    while (replay.tick < r.morningTick) {
      player.feed(replay.tick, replay.commands);
      replay.step();
      replay.events.drain(() => undefined);
    }
    expect(replay.hashState()).toBe(sim.hashState());
  });

  it('dieselbe Nacht ohne Feuer ist gefährlich: der Kern sinkt unter 36 °C, die Furcht steigt über 60', () => {
    const r = playDay(false);
    const summary = `${r.player.clockText()}: Kern min ${r.nightMinCoreC.toFixed(2)} °C, Furcht max ${r.nightMaxFear.toFixed(1)} – ${r.player.log.join(' · ')}`;
    expect(r.nightMinCoreC, summary).toBeLessThan(36);
    expect(r.nightMaxFear, summary).toBeGreaterThanOrEqual(60);
  });
});
