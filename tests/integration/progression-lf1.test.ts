/**
 * M7-64 Progression bis Leuchtfeuer 1 (MASTERPROMPT §23.1 "Leuchtfeuer 1 nach ~3 h", §D "Pacing … gemessen per
 * Debug-Statistik (Zeit bis zu Meilenstein-Ereignissen) im Progressionstest"; docs/SPIEL.md §23): headless spielt ein
 * Skript den Weg vom Strand bis zum ersten Leuchtfeuer – Rohstoffe gibt die Konsole (`inventory.give`: Sammeln und
 * Bergbau misst der Tag-1-Test), alles andere geschieht mit den Befehlen des Spiels:
 *
 * - **T0** von Hand: Faserseile, Steinaxt, Steinspitzhacke, Lagerfeuer, Werkbank; das Feuer aufgestellt, mit Holz
 *   beschickt und mit E entzündet; ein Grasbett gesetzt, in der Nacht darin geschlafen bis zum Morgen.
 * - **T1**: Werkbank II (Aufwertung an Ort und Stelle), Schmelzofen; Kupfer- und Zinnbarren, Bronze im Ofen
 *   geschmolzen; der Bronze-Amboss, Bronzeaxt und Bronzestreitkolben daran geschmiedet.
 * - **Leuchtfeuer 1**: die Stätte entdeckt (`place.discover`), der Borkenvater besiegt und das Leuchtfeuer entzündet
 *   (Konsole `boss.debug`/`beacon.debug`, wie der Referenzspielstand; den Kampf selbst misst boss-borkenvater.test.ts),
 *   aus dem Kernholz die Bronzespitzhacke.
 *
 * Geprüft wird, was strand G daraus macht: die Aufgaben (Einstieg → Bronzezeit; Hauptaufgabe Akt 1 Schritt für Schritt
 * bis erledigt), die Freischaltungen von LF1, die Erfolge auf dem Weg, die Meilensteine der Pacing-Messung in ihrer
 * Reihenfolge und die Chronik. Die Messwerte (Spielzeit bis zu jedem Meilenstein, Herstell- und Ofenzeit der Kette)
 * stehen in `PACING` für docs/BALANCE.md; mit `DH_PACING=1` gibt der Test sie aus.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/content/balance';
import { CONTENT } from '../../src/content/index';
import { AchievementsSystem } from '../../src/game/achievements/system';
import type { GameCommand } from '../../src/game/commands';
import type { InventorySystem } from '../../src/game/inventory/system';
import type { SlotRef } from '../../src/game/items/slots';
import type { PlayerSystem } from '../../src/game/player/system';
import { QuestsSystem } from '../../src/game/quests/system';
import { createSimulation } from '../../src/game/setup';
import type { Simulation } from '../../src/game/sim';
import { StatsSystem } from '../../src/game/stats/system';
import { UnlocksSystem } from '../../src/game/unlocks/system';
import { TILE_PX } from '../../src/world/model/coords';

const HZ = BALANCE.time.tickHz;
/** Die Welt des Referenzspielstands (Seed 3, klein, Standard-Tag). */
const CONFIG = { seed: 3, worldSize: 'small' } as const;
/** Längste Wartezeit auf ein Ereignis [Ticks]: ein Ofen-Durchgang, ein Herstellen, ein Morgen. */
const WARTE_TICKS = 40 * 60 * HZ;
/** Versätze vom Spieler für Stationen, Feuer und Bett, nächste zuerst [Kacheln]. */
const VERSAETZE: ReadonlyArray<readonly [number, number]> = [
  [2, 0],
  [-3, 0],
  [0, 2],
  [0, -2],
  [3, 2],
  [-3, 2],
  [3, -2],
  [-3, -2],
  [0, 3],
  [0, -3],
  [4, 0],
  [-4, 0],
];
/** Versätze für Feuer und Bett: dicht am Spieler, in Reichweite von E [Kacheln]. */
const NAH: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [1, -1],
  [-1, -1],
  [1, 1],
  [-1, 1],
];
/** Reihenfolge der Meilensteine auf dem Weg (content `milestones`, strand G). */
const MEILENSTEINE = ['m_steinaxt', 'm_werkbank', 'm_lagerfeuer', 'm_erste_nacht', 'm_bronze', 'm_staette', 'm_borkenvater', 'm_lf1'] as const;
/** Die vier Freischaltungen von Leuchtfeuer 1 (docs/SPIEL.md §23 "Freischaltungen LF1"). */
const LF1 = ['lf1_glutkern', 'lf1_lumen_laterne', 'lf1_lumen_werkbank', 'lf1_wegsteine'];

type Ev = readonly [string, Record<string, unknown>];

/** Die Messwerte des letzten Laufs (für docs/BALANCE.md, M7-64). */
export const PACING: {
  /** Spielzeit bis zum Meilenstein [s] (`StatsSystem.milestoneTime`: ohne Zeitsprünge, der Schlaf mit seiner Dauer am Bildschirm). */
  meilensteine: Record<string, number>;
  herstellenTicks: number;
  ofenTicks: number;
  schlafTicks: number;
  gesamtTicks: number;
  spielzeitSekunden: number;
} = {
  meilensteine: {},
  herstellenTicks: 0,
  ofenTicks: 0,
  schlafTicks: 0,
  gesamtTicks: 0,
  spielzeitSekunden: 0,
};

/** Treibt die Simulation Tick für Tick; sammelt die Ereignisse und wirft bei einer Ablehnung. */
class Lauf {
  readonly sim: Simulation;
  private readonly inv: InventorySystem;
  private readonly player: PlayerSystem;
  /** Alle Ereignisse des Laufs (Typ, Nutzlast), in Reihenfolge. */
  readonly alle: Ev[] = [];
  herstellenTicks = 0;
  ofenTicks = 0;

  constructor(sim: Simulation) {
    this.sim = sim;
    this.inv = sim.system('inventory') as InventorySystem;
    this.player = sim.system('player') as PlayerSystem;
  }

  /** `commands` im ersten Tick, dann `ticks − 1` weitere; die Ereignisse dieser Ticks. */
  schritt(commands: readonly GameCommand[] = [], ticks = 1): Ev[] {
    const out: Ev[] = [];
    for (let i = 0; i < ticks; i++) {
      this.sim.step(i === 0 ? commands : undefined);
      this.sim.events.drain((type, payload) => {
        const e: Ev = [type, payload as Record<string, unknown>];
        out.push(e);
        this.alle.push(e);
        if (type === 'craftStarted') this.herstellenTicks += Number((payload as { ticks: number }).ticks);
        if (type === 'stationBatchStarted') this.ofenTicks += Number((payload as { ticks: number }).ticks);
      });
    }
    return out;
  }

  /** Wie `schritt`, aber eine Ablehnung oder ein fehlendes erwartetes Ereignis ist ein Fehler. */
  muss(was: string, commands: readonly GameCommand[], erwartet: readonly string[] = []): Ev[] {
    const ev = this.schritt(commands);
    const abgelehnt = ev.filter((e) => e[0] === 'commandRejected');
    if (abgelehnt.length > 0) throw new Error(`Progression: ${was} abgelehnt: ${JSON.stringify(abgelehnt.map((e) => e[1]))}`);
    for (const t of erwartet) if (!ev.some((e) => e[0] === t)) throw new Error(`Progression: ${was} ohne ${t}`);
    return ev;
  }

  /** Läuft, bis `bis` ein Ereignis erkennt; die Ticks bis dahin. */
  warten(was: string, bis: (e: Ev) => boolean, limit = WARTE_TICKS): number {
    for (let t = 1; t <= limit; t++) if (this.schritt().some(bis)) return t;
    throw new Error(`Progression: ${was} blieb aus (${limit} Ticks)`);
  }

  geben(items: Readonly<Record<string, number>>): void {
    this.muss(
      'Rohstoffe geben',
      Object.entries(items).map(([item, count]) => ({ type: 'inventory.give', item, count })),
    );
  }

  /** `count` Stück von `recipe` herstellen (Hand oder Station in Reichweite) und warten, bis sie fertig sind. */
  herstellen(recipe: string, count = 1): void {
    this.muss(`${recipe} beginnen`, [{ type: 'craft.start', recipe, count }], ['craftStarted']);
    for (let n = 0; n < count; n++) this.warten(`${recipe} fertig`, (e) => e[0] === 'craftCompleted' && e[1].recipe === recipe);
  }

  /** Erster Platz des Items in den Taschen. */
  platz(item: string): SlotRef {
    const bags = this.inv.state;
    const quick = bags.schnellleiste.findIndex((s) => s?.item === item);
    if (quick >= 0) return { bereich: 'schnellleiste', index: quick };
    const index = bags.inventar.findIndex((s) => s?.item === item);
    if (index < 0) throw new Error(`Progression: ${item} nicht in den Taschen`);
    return { bereich: 'inventar', index };
  }

  anzahl(item: string): number {
    return this.inv.count(item);
  }

  /** Kachel unter den Füßen. */
  kachel(): { tx: number; ty: number } {
    const at = { x: 0, y: 0 };
    if (!this.player.position(this.sim, at)) throw new Error('Progression: kein Spieler');
    return { tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) };
  }

  /** Probiert `befehl` an den Versätzen um den Spieler, bis er angenommen wird; die Kachel und die Ereignisse. */
  setzen(was: string, befehl: (tx: number, ty: number) => GameCommand[], belegt: (e: Ev) => boolean, versaetze = VERSAETZE): { tx: number; ty: number; ev: Ev[] } {
    const me = this.kachel();
    for (const [dx, dy] of versaetze) {
      const tx = me.tx + dx;
      const ty = me.ty + dy;
      const ev = this.schritt(befehl(tx, ty));
      if (ev.some(belegt)) return { tx, ty, ev };
    }
    throw new Error(`Progression: kein Platz für ${was} bei ${me.tx},${me.ty}`);
  }

  /** E auf Kachel (tx, ty): zielen, drücken, loslassen. */
  druecken(tx: number, ty: number): Ev[] {
    const down = this.schritt([
      { type: 'player.aim', x: tx * TILE_PX + TILE_PX / 2, y: ty * TILE_PX + TILE_PX / 2 },
      { type: 'player.interact', on: true, tx, ty },
    ]);
    return [...down, ...this.schritt([{ type: 'player.interact', on: false }])];
  }

  /** Stellt die Station aus den Taschen auf; ihre Id. */
  aufstellen(item: string): number {
    const r = this.setzen(item, (tx, ty) => [{ type: 'station.place', from: this.platz(item), tx, ty }], (e) => e[0] === 'stationPlaced');
    const placed = r.ev.find((e) => e[0] === 'stationPlaced') as Ev;
    return Number(placed[1].id);
  }

  /** Ein Ofen-Durchgang: `eingang` und Brennstoff hinein, warten, bis `ergebnis` `stueck`-mal entstand, alles heraus. */
  schmelzen(ofen: number, eingang: Readonly<Record<string, number>>, ergebnis: string, stueck: number): void {
    for (const [item, count] of Object.entries(eingang)) this.muss(`${item} in den Ofen`, [{ type: 'station.put', station: ofen, from: this.platz(item), bereich: 'eingang', count }]);
    let made = 0;
    while (made < stueck) {
      this.warten(`${ergebnis} aus dem Ofen`, (e) => {
        if (e[0] !== 'stationProduced' || e[1].item !== ergebnis) return false;
        made += Number(e[1].count);
        return true;
      });
    }
    this.muss(`${ergebnis} herausnehmen`, [{ type: 'station.takeAll', station: ofen }]);
  }
}

function system<T>(sim: Simulation, id: string, kind: abstract new (...args: never[]) => T): T {
  const s = sim.system(id);
  if (!(s instanceof kind)) throw new Error(`Progression: kein System ${id}`);
  return s;
}

describe('M7-64 Progression bis Leuchtfeuer 1 (headless per Debug-API)', () => {
  it('T0 → T1 → Borkenvater → Entzündung: Aufgaben, Freischaltungen LF1, Erfolge und Meilensteine in ihrer Reihenfolge', () => {
    const sim = createSimulation(CONFIG);
    expect(sim.world.generated.placeLayouts.length).toBeGreaterThan(0);
    const lauf = new Lauf(sim);
    const quests = system(sim, 'quests', QuestsSystem);
    const stats = system(sim, 'stats', StatsSystem);
    const achievements = system(sim, 'achievements', AchievementsSystem);
    const unlocks = system(sim, 'unlocks', UnlocksSystem);
    // God mode: the script does not eat, drink or fight on the long waits at the furnace (the needs are measured by tag1.test.ts).
    lauf.muss('Spieler', [{ type: 'player.spawn' }, { type: 'debug.god', on: true }]);
    lauf.schritt([], 30);
    expect(quests.status('einstieg')).toBe('aktiv');

    // ---- T0 von Hand ----
    lauf.geben({ fasern: 15, stein: 15, zweig: 4, holz: 20 });
    lauf.herstellen('rezept_faserseil', 4);
    lauf.herstellen('rezept_steinaxt');
    lauf.herstellen('rezept_steinspitzhacke');
    lauf.herstellen('rezept_lagerfeuer');
    lauf.herstellen('rezept_werkbank');
    const werkbank = lauf.aufstellen('werkbank');
    // Das Lagerfeuer: in die Schnellleiste, zielen, Primärtaste; Holz nachlegen und mit E entzünden.
    lauf.muss('Feuer in die Schnellleiste', [{ type: 'inventory.move', from: lauf.platz('lagerfeuer'), to: { bereich: 'schnellleiste', index: 1 } }, { type: 'player.selectHotbar', index: 1 }]);
    const feuer = lauf.setzen(
      'das Lagerfeuer',
      (tx, ty) => [{ type: 'player.aim', x: tx * TILE_PX + TILE_PX / 2, y: ty * TILE_PX + TILE_PX / 2 }, { type: 'player.useItem' }],
      (e) => e[0] === 'lightPlaced',
      NAH,
    );
    lauf.schritt([{ type: 'player.selectHotbar', index: 0 }]);
    const nachlegen = lauf.druecken(feuer.tx, feuer.ty);
    expect(nachlegen.some((e) => e[0] === 'fireFueled'), JSON.stringify(nachlegen) + JSON.stringify(feuer.ev) + JSON.stringify(lauf.kachel())).toBe(true);
    expect(lauf.druecken(feuer.tx, feuer.ty).some((e) => e[0] === 'lightIgnited')).toBe(true);
    // Das Grasbett im Baumodus; in der Nacht hinein, bis zum Morgen.
    lauf.geben({ fasern: 12, laub: 10, zweig: 4 });
    lauf.herstellen('rezept_grasbett');
    const bett = lauf.setzen('das Grasbett', (tx, ty) => [{ type: 'build.place', part: 'grasbett', tx, ty }], (e) => e[0] === 'partPlaced', NAH);
    lauf.muss('Abend', [{ type: 'setTime', hour: 22, minute: 0 }]);
    lauf.schritt([], 2);
    const schlaf = lauf.druecken(bett.tx, bett.ty);
    expect(schlaf.some((e) => e[0] === 'sleepStarted' && e[1].place === 'grasbett'), JSON.stringify(schlaf.filter((e) => e[0] === 'commandRejected'))).toBe(true);
    const schlafTicks = lauf.warten('Morgen', (e) => e[0] === 'sleepEnded');
    lauf.schritt([], 30);
    expect(quests.status('einstieg')).toBe('erledigt');
    expect(lauf.anzahl('verband')).toBeGreaterThanOrEqual(2);
    expect(quests.status('bronzezeit')).toBe('aktiv');
    expect(quests.status('hq_sechs_feuer_1')).toBe('aktiv');

    // ---- T1: Werkbank II, Schmelzofen, Bronze, Amboss, Bronzewerkzeug ----
    lauf.geben({ brett: 8, balken: 3, kupferbarren: 2, faserseil: 4 });
    lauf.herstellen('rezept_werkbank_2');
    expect(lauf.alle.some((e) => e[0] === 'stationUpgraded' && e[1].id === werkbank && e[1].to === 'werkbank_2')).toBe(true);
    lauf.geben({ ziegel: 16, lehmputz: 6, keramik_topf: 1, steinblock: 6 });
    lauf.herstellen('rezept_schmelzofen');
    const ofen = lauf.aufstellen('schmelzofen');
    lauf.geben({ kupfererz: 24, zinnerz: 8, holzkohle: 30 });
    lauf.muss('Holzkohle in den Ofen', [{ type: 'station.put', station: ofen, from: lauf.platz('holzkohle'), bereich: 'brennstoff', count: 30 }]);
    // Carrying copper and tin holds the first step on the next world tick (a state trigger, src/game/triggers).
    lauf.schritt([], HZ + 1);
    expect(quests.status('bronzezeit', 'bronze')).toBe('aktiv');
    lauf.schmelzen(ofen, { kupfererz: 24 }, 'kupferbarren', 12);
    lauf.schmelzen(ofen, { zinnerz: 8 }, 'zinnbarren', 4);
    for (let i = 0; i < 4; i++) lauf.schmelzen(ofen, { kupferbarren: 3, zinnbarren: 1 }, 'bronzebarren', 4);
    lauf.schritt([], 2);
    expect(quests.status('bronzezeit')).toBe('erledigt');
    lauf.herstellen('rezept_amboss_bronze');
    lauf.aufstellen('amboss_bronze');
    lauf.geben({ holz: 3 });
    lauf.herstellen('rezept_bronzeaxt');
    lauf.herstellen('rezept_bronzestreitkolben');
    expect(lauf.anzahl('bronzeaxt')).toBe(1);
    expect(lauf.anzahl('bronzestreitkolben')).toBe(1);

    // ---- Die Stätte, der Borkenvater, das erste Feuer ----
    expect(quests.status('hq_sechs_feuer_1', 'staette_finden')).toBe('aktiv');
    const staette = sim.world.generated.placeLayouts.find((p) => p.type === 'leuchtfeuer');
    expect(staette).toBeDefined();
    lauf.muss('Stätte entdecken', [{ type: 'place.discover', place: (staette as { slot: number }).slot }], ['placeDiscovered']);
    lauf.schritt([], 2);
    expect(quests.status('hq_sechs_feuer_1', 'borkenvater')).toBe('aktiv');
    lauf.muss('Borkenvater besiegen', [{ type: 'boss.debug', boss: 'borkenvater', aktion: 'besiegen' }], ['bossDefeated']);
    lauf.schritt([], 2);
    expect(quests.status('hq_sechs_feuer_1', 'entzuenden')).toBe('aktiv');
    lauf.muss('Leuchtfeuer entzünden', [{ type: 'beacon.debug', beacon: 1, aktion: 'entzuenden' }], ['beaconLit', 'unlockGranted']);
    lauf.schritt([], 2);
    expect(quests.status('hq_sechs_feuer_1')).toBe('erledigt');
    // The Barkfather's heartwood gates the bronze pickaxe (§13.2).
    lauf.geben({ kernholz: 1 });
    lauf.herstellen('rezept_bronzespitzhacke');
    expect(lauf.anzahl('bronzespitzhacke')).toBe(1);

    // ---- Freischaltungen LF1 ----
    for (const id of LF1) expect(unlocks.has(id), id).toBe(true);
    expect(new Set(LF1.map((id) => unlocks.granted().find((g) => g.id === id)?.source))).toEqual(new Set(['leuchtfeuer:1']));

    // ---- Erfolge auf dem Weg ----
    for (const id of ['erste_nacht', 'bronzezeit', 'borkenvater_besiegt', 'erstes_feuer']) expect(achievements.has(id), id).toBe(true);
    // Not yet: Steinzeit wants the stone knife too, Feuermacher five camp fires (one burned).
    expect(achievements.has('steinzeit')).toBe(false);
    expect(achievements.has('feuermacher')).toBe(false);

    // ---- Meilensteine: alle erreicht, in der Reihenfolge des Wegs ----
    const ticks = MEILENSTEINE.map((id) => stats.milestoneTime(id));
    for (const [i, id] of MEILENSTEINE.entries()) expect(ticks[i], id).toBeGreaterThanOrEqual(0);
    const sortiert = [...ticks].sort((a, b) => a - b);
    expect(ticks).toEqual(sortiert);
    const lf1Def = CONTENT.collection('milestones').get('m_lf1');
    expect(lf1Def.zielStunden).toBe(3);

    // ---- Die Chronik erzählt den Weg ----
    const types = new Set(lauf.alle.filter((e) => e[0] === 'chronicleEntryAdded').map((e) => String(e[1].art)));
    expect(types.size).toBeGreaterThan(0);

    PACING.meilensteine = Object.fromEntries(MEILENSTEINE.map((id, i) => [id, Math.round((ticks[i] as number) / HZ)]));
    PACING.herstellenTicks = lauf.herstellenTicks;
    PACING.ofenTicks = lauf.ofenTicks;
    PACING.schlafTicks = schlafTicks;
    PACING.gesamtTicks = sim.tick;
    PACING.spielzeitSekunden = stats.value('spielzeit') / HZ;
    // What the script measures – making, smelting, sleeping, without gathering, mining, walking or the fight – stays well inside
    // the 3 h of §23.1: the crafting chain alone never eats the budget of the first beacon.
    expect(PACING.spielzeitSekunden).toBeLessThan((lf1Def.zielStunden ?? 0) * 3600);
    if (process.env.DH_PACING === '1') console.log(`PACING ${JSON.stringify(PACING)}`);
  });
});
