/**
 * M7-20 Qualität, Dünger, Kompostkiste, Schädlinge (MASTERPROMPT §17 "Qualität (Normal/Silber/Gold) aus Fruchtbarkeit und
 * Skill … Ernte −10 Fruchtbarkeit; Kompost +30, Knochenmehl +20 … Schädlinge: Krähen (Vogelscheuche), Hasen (Zaun), Mehltau
 * (Kräuterbrühe)"; docs/SPIEL.md §20):
 * - die Qualität 1–3 der Ernte folgt der mittleren Fruchtbarkeit, mit der die Pflanze wuchs, und der Landwirtschaft-Stufe;
 *   eine Ernte kostet 10 Fruchtbarkeit, gibt Frucht und Saat, mehrfach Tragendes fällt auf seine Nachwuchsstufe zurück;
 * - Kompost +30, Knochenmehl +20 (höchstens 100); die Kräuterbrühe heilt Mehltau;
 * - die Kompostkiste macht aus sechs Stück Gartenabfall in einem Tag zwei Kompost, ohne Brennstoff, auch eingefroren;
 * - Krähen fressen Saat ohne Vogelscheuche, Hasen knabbern ohne Zaun, Mehltau kommt nach drei Regentagen und tötet nach drei
 *   weiteren – alles aus dem Hash je Kachel und Tag.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CROPS } from '../../../src/content/farming/index';
import { CONTENT } from '../../../src/content/index';
import { harvestQuality } from '../../../src/game/farming/index';
import { stackQuality, type ItemStack } from '../../../src/game/items/stack';
import { minuteOf } from '../../../src/world/climate/gameTime';
import { F, FeldWelt, X0, Y0, feldCatalog } from './feld-testwelt';
import { stationWorld } from './stationen-testwelt';

const Q = F.quality;
const P = F.pests;

/** The pieces of `item` in the bags (of every quality). */
function inBags(w: FeldWelt, item: string): ItemStack[] {
  return [...w.bags.state.schnellleiste, ...w.bags.state.inventar].filter((s): s is ItemStack => s !== null && s.item === item);
}

/** A ripe crop on (tx, ty) grown by `farm.grow` (good days, no weather). */
function reif(w: FeldWelt, tx: number, ty: number, crop: string): void {
  w.feld(tx, ty).saeen(tx, ty, crop);
  w.farming.commands['farm.grow']?.(w.sim, { type: 'farm.grow', tage: 30 }, w.sim.tick);
}

describe('Qualität Normal/Silber/Gold', () => {
  it('aus mittlerer Fruchtbarkeit und Landwirtschaft-Stufe, gestreut um höchstens ±spread', () => {
    expect([Q.fertilityShare + Q.skillShare, Q.silverFrom < Q.goldFrom]).toEqual([1, true]);
    // Fertility 50 at level 1 is always Normal; 100 at level 100 always Gold; nothing grown in dead soil is better than Normal.
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(harvestQuality(50, 1, roll)).toBe(1);
      expect(harvestQuality(100, 100, roll)).toBe(3);
      expect(harvestQuality(0, 100, roll)).toBe(1);
    }
    // A novice on the best soil harvests Silver – Gold only with the luckiest draws.
    expect([0, 0.5, 0.9].map((roll) => harvestQuality(100, 1, roll))).toEqual([2, 2, 2]);
    expect(harvestQuality(100, 1, 0.999)).toBe(3);
    // Near a threshold the roll decides.
    const edge = (Q.silverFrom - Q.skillShare * 1) / Q.fertilityShare;
    expect([harvestQuality(edge, 1, 0), harvestQuality(edge, 1, 0.999)]).toEqual([1, 2]);
  });

  it('eine Ernte: Frucht mit Qualität, Saat, −10 Fruchtbarkeit, Erfahrung; gedüngte Beete und Erfahrene ernten besser', () => {
    const w = new FeldWelt({ wetter: 'hand' });
    reif(w, X0 + 3, Y0 + 3, 'karotte');
    expect(w.farming.harvestState(0, X0 + 3, Y0 + 3)).toBe('ernten');
    w.farming.harvest(w.sim, 0, X0 + 3, Y0 + 3, w.sim.tick);
    const [fruit] = inBags(w, 'karotte');
    const karotte = CROPS.find((c) => c.id === 'karotte');
    expect(stackQuality(fruit as ItemStack)).toBe(1);
    expect(fruit?.count).toBeGreaterThanOrEqual(karotte?.ertrag[0] ?? 99);
    expect(fruit?.count).toBeLessThanOrEqual(karotte?.ertrag[1] ?? 0);
    expect(inBags(w, 'saat_karotte').reduce((n, s) => n + s.count, 0)).toBeGreaterThanOrEqual(karotte?.saatErtrag[0] ?? 99);
    expect(w.beet(X0 + 3, Y0 + 3)).toMatchObject({ crop: '', fertility: F.startFertility - F.harvestFertilityLoss });
    expect(F.harvestFertilityLoss).toBe(10);
    expect(w.awarded).toContain(F.experience.harvested);
    expect(w.ereignisse('cropHarvested').map((e) => [e.crop, e.qualitaet])).toEqual([['karotte', 1]]);

    // Well fed soil and a master farmer: gold.
    const g = new FeldWelt({ wetter: 'hand', stufe: 100 });
    g.feld(X0 + 3, Y0 + 3);
    g.farming.fertilize(g.sim, 0, X0 + 3, Y0 + 3, feldCatalog.get('kompost'));
    g.farming.fertilize(g.sim, 0, X0 + 3, Y0 + 3, feldCatalog.get('kompost'));
    expect(g.beet(X0 + 3, Y0 + 3).fertility).toBe(100);
    g.saeen(X0 + 3, Y0 + 3, 'karotte');
    g.farming.commands['farm.grow']?.(g.sim, { type: 'farm.grow', tage: 30 }, g.sim.tick);
    g.farming.harvest(g.sim, 0, X0 + 3, Y0 + 3, g.sim.tick);
    expect(stackQuality(inBags(g, 'karotte')[0] as ItemStack)).toBe(3);
  });

  it('mehrfach Tragendes fällt nach der Ernte auf seine Nachwuchsstufe zurück, bis zur letzten Ernte', () => {
    const erdbeere = CROPS.find((c) => c.id === 'erdbeere');
    expect(erdbeere?.nachwuchs).toEqual({ stufe: 3, ernten: 5 });
    const w = new FeldWelt({ wetter: 'hand' });
    reif(w, X0 + 3, Y0 + 3, 'erdbeere');
    for (let k = 1; k <= 5; k++) {
      w.farming.harvest(w.sim, 0, X0 + 3, Y0 + 3, w.sim.tick);
      const p = w.beet(X0 + 3, Y0 + 3);
      if (k < 5) expect(p, `Ernte ${k}`).toMatchObject({ crop: 'erdbeere', stage: 3, harvests: k });
      else expect(p).toMatchObject({ crop: '', stage: 0, harvests: 0 });
      w.morgen();
      w.farming.commands['farm.grow']?.(w.sim, { type: 'farm.grow', tage: 10 }, w.sim.tick);
    }
    expect(w.beet(X0 + 3, Y0 + 3).fertility).toBe(0);
  });
});

describe('Dünger', () => {
  it('Kompost +30, Knochenmehl +20, höchstens 100; die Kräuterbrühe heilt Mehltau', () => {
    expect([feldCatalog.get('kompost').duenger?.fruchtbarkeit, feldCatalog.get('knochenmehl').duenger?.fruchtbarkeit]).toEqual([30, 20]);
    const w = new FeldWelt({ wetter: 'hand' }).feld(X0 + 3, Y0 + 3);
    w.farming.fertilize(w.sim, 0, X0 + 3, Y0 + 3, feldCatalog.get('knochenmehl'));
    expect(w.beet(X0 + 3, Y0 + 3).fertility).toBe(70);
    w.farming.fertilize(w.sim, 0, X0 + 3, Y0 + 3, feldCatalog.get('kompost'));
    expect(w.beet(X0 + 3, Y0 + 3).fertility).toBe(100);
    expect(w.farming.fertilizeProblem(0, X0 + 3, Y0 + 3, feldCatalog.get('kraeuterbruehe'))).toBe('noMildew');
    expect(w.farming.fertilizeProblem(0, X0 + 9, Y0 + 3, feldCatalog.get('kompost'))).toBe('noPlot');
    expect(w.ereignisse('plotFertilized').map((e) => e.item)).toEqual(['knochenmehl', 'kompost']);
  });
});

describe('Kompostkiste', () => {
  it('sechs Gartenabfall → zwei Kompost in einem Tag, ohne Brennstoff; eingefroren holt sie auf', () => {
    const recipe = CONTENT.collection('recipes').find('rezept_kompost');
    expect(recipe).toMatchObject({ station: 'kompostkiste', zutaten: [{ gruppe: 'kompostgut', anzahl: 6 }], ergebnis: { item: 'kompost', anzahl: 2 }, dauer: 'kompostieren' });
    expect(BALANCE.crafting.durationSeconds.kompostieren).toBe(24 * 60);
    for (const ticking of [true, false]) {
      const w = stationWorld();
      const box = w.place('kompostkiste', 6, 4);
      w.give('fasern', 6);
      expect(w.refused({ type: 'station.put', station: box, from: w.slotOf('fasern'), bereich: 'eingang' })).toEqual([]);
      const day = BALANCE.crafting.durationSeconds.kompostieren * BALANCE.time.tickHz;
      if (ticking) w.run(day + 2);
      else {
        w.active = false;
        const from = w.sim.tick;
        w.sim.skipTicks(day + 2);
        w.stations.catchUp({ layer: 0, cx: w.st(box).tx >> 5, cy: w.st(box).ty >> 5 }, from, w.sim.tick);
      }
      expect(w.st(box).proc?.ausgang[0], ticking ? 'tickend' : 'eingefroren').toEqual({ item: 'kompost', count: 2 });
    }
  });
});

describe('Schädlinge (Hash je Kachel und Tag)', () => {
  /** `n` × `n` plots of `crop` at `stage`, all at water, around (X0 + 1, Y0 + 1). */
  function beete(w: FeldWelt, crop: string, stage: number, n = 12): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    w.wasser(X0, Y0);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const tx = X0 + 2 + x * 2;
        const ty = Y0 + 2 + y * 2;
        if (tx >= X0 + 32 || ty >= Y0 + 32) continue;
        w.feld(tx, ty).saeen(tx, ty, crop);
        const c = w.farming.chunkAt(0, 4, 4);
        if (c !== undefined) c.stage[((ty & 31) << 5) | (tx & 31)] = stage;
        out.push({ x: tx, y: ty });
      }
    }
    w.farming.surroundingsChanged();
    return out;
  }

  it('Krähen fressen frische Saat ohne Vogelscheuche – im Umkreis der Vogelscheuche nie', () => {
    const open = new FeldWelt({ wetter: 'hand' });
    const plots = beete(open, 'karotte', 0);
    open.tage(5);
    const eaten = open.ereignisse('cropDied').filter((e) => e.grund === 'kraehen').length;
    // Five days, a chance of crowChance a day: about plots × (1 − (1 − p)^5).
    const expected = plots.length * (1 - (1 - P.crowChance) ** 5);
    expect(eaten).toBeGreaterThan(expected * 0.4);
    expect(eaten).toBeLessThan(expected * 1.8);
    const guarded = new FeldWelt({ wetter: 'hand' });
    guarded.scarecrows.add(`${X0 + 12},${Y0 + 12}`);
    const near = beete(guarded, 'karotte', 0).filter((p) => Math.max(Math.abs(p.x - X0 - 12), Math.abs(p.y - Y0 - 12)) <= P.scarecrowTiles);
    guarded.tage(5);
    const died = guarded.ereignisse('cropDied').map((e) => `${String(e.tx)},${String(e.ty)}`);
    expect(near.length).toBeGreaterThan(20);
    for (const p of near) expect(died).not.toContain(`${p.x},${p.y}`);
  });

  it('Hasen knabbern wachsende Pflanzen eine Stufe zurück – im Zaunring nie', () => {
    const open = new FeldWelt({ wetter: 'hand' });
    beete(open, 'kohl', 3);
    open.tage(3);
    const nibbled = open.ereignisse('pestAppeared').filter((e) => e.art === 'hasen');
    expect(nibbled.length).toBeGreaterThan(0);
    const fenced = new FeldWelt({ wetter: 'hand' });
    const plots = beete(fenced, 'kohl', 3);
    for (const p of plots) fenced.enclosed.add(`${p.x},${p.y}`);
    fenced.tage(3);
    expect(fenced.ereignisse('pestAppeared').filter((e) => e.art === 'hasen')).toEqual([]);
    for (const p of plots) expect(fenced.beet(p.x, p.y).stage).toBeGreaterThanOrEqual(3);
  });

  it('Mehltau nach drei Regentagen in Folge; nach drei weiteren Tagen stirbt die Pflanze; die Kräuterbrühe heilt', () => {
    const w = new FeldWelt({ wetter: 'hand' });
    const plots = beete(w, 'kohl', 2);
    for (let d = 1; d <= 3; d++) w.wetter('regen', d, 10, 4);
    w.tage(2);
    expect(w.ereignisse('pestAppeared').filter((e) => e.art === 'mehltau')).toEqual([]);
    w.morgen();
    const struck = w.ereignisse('pestAppeared').filter((e) => e.art === 'mehltau');
    expect(struck.length).toBeGreaterThan(plots.length * P.mildewChance * 0.4);
    expect(struck.length).toBeLessThan(plots.length * P.mildewChance * 1.8);
    const [cured, ...rest] = struck;
    const cx = cured?.tx as number;
    const cy = cured?.ty as number;
    expect(w.beet(cx, cy).pest).toBe('mehltau');
    expect(w.farming.fertilizeProblem(0, cx, cy, feldCatalog.get('kraeuterbruehe'))).toBeNull();
    w.farming.fertilize(w.sim, 0, cx, cy, feldCatalog.get('kraeuterbruehe'));
    expect(w.beet(cx, cy).pest).toBe('keine');
    expect(w.ereignisse('pestCured').map((e) => e.art)).toEqual(['mehltau']);
    // No more rain: the mildew stays and kills after mildewKillDays.
    w.tage(P.mildewKillDays);
    const killed = w.ereignisse('cropDied').filter((e) => e.grund === 'mehltau');
    expect(killed.map((e) => `${String(e.tx)},${String(e.ty)}`).sort()).toEqual(rest.map((e) => `${String(e.tx)},${String(e.ty)}`).sort());
    expect(w.beet(cx, cy).dead).toBe(false);
    expect(minuteOf(1, 10)).toBeLessThan(minuteOf(2, 6));
  });
});
