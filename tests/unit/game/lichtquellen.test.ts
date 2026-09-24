/**
 * M3-22 – light sources (MASTERPROMPT §12.2, §10 Wetterwirkung, §15.4): the torch in hand and on stake or
 * wall (6 tiles, 4 game hours, rain halves the burn time, heavy rain 5 % per minute to go out, lights
 * flammable things), the camp fire (8 tiles, fuel of §15.4 up to 6 minutes, embers, warmth, a cooking
 * spot), the Nebenhand rule (shield or two-hander: on the belt, −40 % radius), F, and the catch-up of
 * torches and fires in frozen chunks – frozen and caught up equals ticking, to the last tick.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { FIRE_CLIPS, LIGHT_KINDS, lightKindOfItem } from '../../../src/content/lights';
import { SFX_PRESETS } from '../../../src/content/sfx/index';
import { SPRITES, type AtlasSprite } from '../../../src/generated/atlas';
import { BindingSet } from '../../../src/engine/input/bindings';
import { ActionReader } from '../../../src/engine/input/reader';
import { InputState } from '../../../src/engine/input/state';
import { lightToggleCommand } from '../../../src/game/light/input';
import { equipmentRef } from '../../../src/game/items/slots';
import { newStack } from '../../../src/game/items/stack';
import { emptyBags, withSlot } from '../../../src/game/inventory/bags';
import {
  advanceFire,
  advanceTorch,
  burnRestOf,
  carriedRadiusPx,
  findCarriedLight,
  FIRE_EMBER_TICKS,
  FIRE_MAX_FUEL_TICKS,
  FIRE_WEAK_TICKS,
  fireClip,
  fuelItemsThatFit,
  HEAVY_RAIN_ROLL_TICKS,
  heavyRainPutsOut,
  rainClass,
  tileInReach,
  torchBurnRate,
  torchBurnTicks,
  withBurnRest,
} from '../../../src/game/light/formulas';
import { LIGHT_OUT_REASONS, LIGHT_REJECT_REASONS, LIGHT_SFX, lightKindSound } from '../../../src/game/light/events';
import { CARRY_MODES, copyLightState, type FireBurn, type TorchBurn } from '../../../src/game/light/state';
import { CARRIED_LIGHT_ID, type LightSystem } from '../../../src/game/light/system';
import { createSimulation } from '../../../src/game/setup';
import { hashCombine, hashString, normalizeSeed } from '../../../src/engine/rng';
import { CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';
import de from '../../../src/i18n/de.json';
import en from '../../../src/i18n/en.json';
import { testCatalog } from './items-fixtures';
import { lightWorld, type LightWorld } from './licht-testwelt';
import { meadow, OFFSET } from './spieler-testwelt';

const L = BALANCE.light;
/** Sprites of the generated atlas by id. */
const ATLAS_SPRITES = SPRITES as Readonly<Record<string, AtlasSprite | undefined>>;
const HZ = BALANCE.time.tickHz;
/** Ticks per game hour at the default day length (24 real minutes per day). */
const HOUR = 3600;
const FULL = 4 * HOUR;

/** Value lines of a balance module whose doc comment lacks a `[unit]` or a reason. */
function undocumented(file: string, marker: string): string[] {
  const source = readFileSync(fileURLToPath(new URL(`../../../src/content/balance/${file}`, import.meta.url)), 'utf8');
  const lines = source.slice(source.indexOf(marker)).split('\n');
  const missing: string[] = [];
  let values = 0;
  lines.forEach((l, i) => {
    if (!/^\s+[a-zA-Z]+: .*,\s*$/.test(l)) return;
    values++;
    let j = i - 1;
    const doc: string[] = [];
    while (j >= 0 && /^\s*(\/\*\*|\*)/.test(lines[j] ?? '')) doc.unshift(lines[j--] ?? '');
    const text = doc.join(' ');
    const reason = text.replace(/\[[^\]]+\]/, '').replace(/[/*\s]/g, '');
    if (!/\[[^\]]+\]/.test(text) || reason.length <= 10) missing.push(l.trim());
  });
  if (values === 0) missing.push(`${file}: no values found`);
  return missing;
}

function torch(over: Partial<TorchBurn> = {}): TorchBurn {
  return { lit: true, rest: FULL, at: 0, rain: 'trocken', heavyTicks: 0, ...over };
}

const never = (): boolean => false;

/** A 24 × 24 meadow with the player in its middle, torches, wood and a camp fire in the bags. */
function camp(rows: readonly string[] = meadow(24, 24), seed = 1): LightWorld {
  const w = lightWorld(rows, seed);
  w.spawn(10, 10);
  w.give('fackel', 3);
  w.give('lagerfeuer', 2);
  w.give('holz', 20);
  w.give('zweig', 30);
  w.give('stein', 5);
  return w;
}

function events<T>(w: LightWorld, type: string): T[] {
  return (w.last.get(type) ?? []) as T[];
}

/** Steps until `pred` holds (at most `max` ticks); returns the ticks stepped. */
function until(w: LightWorld, pred: () => boolean, max: number): number {
  const all = new Map<string, unknown[]>();
  let n = 0;
  while (!pred() && n < max) {
    w.step(1);
    for (const [k, v] of w.last) all.set(k, [...(all.get(k) ?? []), ...v]);
    n++;
  }
  w.last = all;
  return n;
}

describe('Balance und Content der Lichtquellen', () => {
  it('Startwerte §12.2, §10, §15.4, §16 – jeder Wert mit Einheit und Begründung', () => {
    expect(undocumented('light.ts', 'export const LIGHT_BALANCE')).toEqual([]);
    expect([L.torch.radiusTiles, L.torch.burnGameHours, L.torch.rainBurnFactor, L.torch.heavyRainExtinguishChance, L.torch.heavyRainRollSeconds]).toEqual([6, 4, 2, 0.05, 60]);
    expect([L.campfire.radiusTiles, L.campfire.maxFuelSeconds]).toEqual([8, 360]);
    expect(L.offhand.beltRadiusFactor).toBe(0.6);
    expect(L.placement.reachTiles).toBe(8);
    expect(BALANCE.items.burnSeconds).toMatchObject({ zweig: 15, holz: 45 });
  });

  it('Lichtarten: Gegenstand, Sprites mit Sockel in Flammenhöhe, Klänge, Texte DE/EN', () => {
    const sfx = new Set(SFX_PRESETS.map((p) => p.id));
    const items = testCatalog();
    for (const k of LIGHT_KINDS) {
      expect(items.has(k.gegenstand), k.id).toBe(true);
      expect(lightKindOfItem(k.gegenstand)).toBe(k);
      for (const id of Object.values(k.sounds)) expect(sfx.has(id), id).toBe(true);
      for (const id of Object.values(k.sprites)) expect(ATLAS_SPRITES[id], id).toBeDefined();
      expect(k.name.de.length * k.name.en.length * k.beschreibung.de.length * k.beschreibung.en.length).toBeGreaterThan(0);
    }
    // Flame heights = the `licht` sockets of the sprites (ADR-0019: the light sits in the flame).
    const socketHeight = (id: string): number => {
      const s = ATLAS_SPRITES[id];
      if (s === undefined) throw new Error(id);
      const socket = s.sockets.licht?.[0];
      if (socket === undefined) throw new Error(`${id} has no light socket`);
      return s.anchor[1] - socket[1];
    };
    expect(L.torch.flameHeightPx.stand).toBe(socketHeight('fackel_stand'));
    expect(L.torch.flameHeightPx.wand).toBe(socketHeight('fackel_wand') + L.torch.wallMountPx);
    const fire = ATLAS_SPRITES.lagerfeuer;
    const heights = (fire?.sockets.licht ?? []).map((p) => (fire?.anchor[1] ?? 0) - p[1]);
    expect(L.campfire.flameHeightPx).toBeGreaterThanOrEqual(Math.min(...heights));
    expect(L.campfire.flameHeightPx).toBeLessThanOrEqual(Math.max(...heights));
    // The fire's clips are the states of the fire.
    expect(Object.keys(fire?.clips ?? {}).sort()).toEqual(['asche', 'aus', 'brennt', 'glut', 'schwach']);
  });

  it('Rückmeldung: jede Ablehnung, jedes Erlöschen, jeder Feuerzustand und jede Trageweise DE/EN; Klänge sind Presets', () => {
    const texts: ReadonlyArray<Readonly<Record<string, string>>> = [de, en];
    const keys = [
      ...LIGHT_REJECT_REASONS.map((r) => `ui.light.reject.${r}`),
      ...LIGHT_OUT_REASONS.map((r) => `ui.light.erloschen.${r}`),
      ...FIRE_CLIPS.map((c) => `ui.light.feuer.${c}`),
      ...CARRY_MODES.map((m) => `ui.light.nebenhand.${m}`),
    ];
    for (const lang of texts) for (const key of keys) expect(lang[key]?.length ?? 0, key).toBeGreaterThan(0);
    // No German text slipped into the English file.
    for (const key of keys) expect(en[key as keyof typeof en], key).not.toBe(de[key as keyof typeof de]);
    const sfx = new Set(SFX_PRESETS.map((p) => p.id));
    for (const id of Object.values(LIGHT_SFX)) expect(sfx.has(id), id).toBe(true);
    for (const k of LIGHT_KINDS) {
      expect([lightKindSound(k.id, 'an'), lightKindSound(k.id, 'aus'), lightKindSound(k.id, 'brennen')]).toEqual([k.sounds.an, k.sounds.aus, k.sounds.brennen]);
    }
    expect(() => lightKindSound('laterne', 'an')).toThrow();
  });
});

describe('Fackel-Formeln', () => {
  it('4 Spielstunden trocken, Regen halbiert, Starkregen ab 0,9 Niederschlag, Niesel zählt nicht', () => {
    expect(torchBurnTicks(HOUR)).toBe(FULL);
    expect(torchBurnTicks(2 * HOUR)).toBe(2 * FULL);
    expect([0, 0.25, 0.49, 0.5, 0.65, 0.89, 0.9, 1].map(rainClass)).toEqual(['trocken', 'trocken', 'trocken', 'regen', 'regen', 'regen', 'starkregen', 'starkregen']);
    expect([torchBurnRate('trocken'), torchBurnRate('regen'), torchBurnRate('starkregen')]).toEqual([1, 2, 2]);
    const dry = torch();
    expect(advanceTorch(dry, FULL - 1, never)).toBeNull();
    expect(dry.rest).toBe(1);
    expect(advanceTorch(dry, FULL + 500, never)).toEqual({ reason: 'abgebrannt', tick: FULL });
    expect([dry.lit, dry.rest, dry.at]).toEqual([false, 0, FULL + 500]);
    const wet = torch({ rain: 'regen' });
    expect(advanceTorch(wet, FULL, never)).toEqual({ reason: 'abgebrannt', tick: FULL / 2 });
    // Unlit torches do not burn.
    const off = torch({ lit: false });
    expect(advanceTorch(off, 10 * FULL, never)).toBeNull();
    expect([off.rest, off.at]).toEqual([FULL, 10 * FULL]);
  });

  it('Starkregen: jede volle Minute ein Wurf mit 5 %, reproduzierbar aus Weltseed, Fackel und Minute', () => {
    expect(HEAVY_RAIN_ROLL_TICKS).toBe(60 * HZ);
    const rolls: number[] = [];
    const t = torch({ rain: 'starkregen', rest: 2 * FULL });
    expect(
      advanceTorch(t, FULL, (k) => {
        rolls.push(k);
        return k === 2;
      }),
    ).toEqual({ reason: 'regen', tick: 2 * HEAVY_RAIN_ROLL_TICKS });
    expect(rolls).toEqual([1, 2]);
    expect(t.heavyTicks).toBe(2 * HEAVY_RAIN_ROLL_TICKS);
    // The roll is a pure hash: the same torch and minute always agree, and 5 % of torches go out.
    const seed = hashCombine(normalizeSeed(7), hashString('light'));
    expect(heavyRainPutsOut(seed, 3, 1, 4)).toBe(heavyRainPutsOut(seed, 3, 1, 4));
    let out = 0;
    const n = 40_000;
    for (let i = 1; i <= n; i++) if (heavyRainPutsOut(seed, i, 1, 1)) out++;
    expect(out / n).toBeGreaterThan(0.045);
    expect(out / n).toBeLessThan(0.055);
  });

  it('linear: in einem Schritt oder in vielen – derselbe Zustand, auch mit Regenwechseln', () => {
    const roll = (k: number): boolean => k === 3;
    const cuts = [1, 59, 60, 61, 997, 3599, 3600, 3601, 5000, 7199, 9000, 12_345];
    for (const rain of ['trocken', 'regen', 'starkregen'] as const) {
      const one = torch({ rain });
      const many = torch({ rain });
      const endOne = advanceTorch(one, FULL, roll);
      let endMany = null;
      for (const c of [...cuts, FULL]) {
        const e = advanceTorch(many, c, roll);
        endMany ??= e;
      }
      expect(many, rain).toEqual(one);
      expect(endMany, rain).toEqual(endOne);
    }
  });
});

describe('Lagerfeuer-Formeln', () => {
  it('Brennstoff Echtsekunden bis 6 min, dann Glut, dann Asche; Clips nach Zustand', () => {
    expect(FIRE_MAX_FUEL_TICKS).toBe(360 * HZ);
    const f: FireBurn = { lit: true, fuel: 45 * HZ, embers: 0, burned: true, at: 0 };
    expect(fireClip(f)).toBe('brennt');
    expect(advanceFire(f, 45 * HZ - FIRE_WEAK_TICKS)).toBe('none');
    expect(fireClip(f)).toBe('brennt');
    expect(advanceFire(f, 45 * HZ - FIRE_WEAK_TICKS + 1)).toBe('none');
    expect(fireClip(f)).toBe('schwach');
    expect(advanceFire(f, 45 * HZ)).toBe('embers');
    expect([f.lit, f.fuel, f.embers, fireClip(f)]).toEqual([false, 0, FIRE_EMBER_TICKS, 'glut']);
    expect(advanceFire(f, 45 * HZ + FIRE_EMBER_TICKS)).toBe('ash');
    expect(fireClip(f)).toBe('asche');
    expect(fireClip({ lit: false, fuel: 0, embers: 0, burned: false, at: 0 })).toBe('aus');
    // In one step past both.
    const g: FireBurn = { lit: true, fuel: 100, embers: 0, burned: true, at: 0 };
    expect(advanceFire(g, 100 + FIRE_EMBER_TICKS + 5)).toBe('ash');
    expect([g.lit, g.fuel, g.embers, g.at]).toEqual([false, 0, 0, 100 + FIRE_EMBER_TICKS + 5]);
  });

  it('nur ganze Stücke, die noch hineinpassen (§15.4 „höchstens 6 Minuten“)', () => {
    expect(fuelItemsThatFit(0, 15 * HZ, 100)).toBe(24);
    expect(fuelItemsThatFit(0, 45 * HZ, 100)).toBe(8);
    expect(fuelItemsThatFit(300 * HZ, 45 * HZ, 5)).toBe(1);
    expect(fuelItemsThatFit(330 * HZ, 45 * HZ, 5)).toBe(0);
    expect(fuelItemsThatFit(0, 45 * HZ, 3)).toBe(3);
    expect(fuelItemsThatFit(0, 0, 3)).toBe(0);
  });
});

describe('Nebenhand-Regel', () => {
  it('Nebenhand: volle 6 Kacheln; mit Zweihänder oder Schild am Gürtel mit 60 %', () => {
    expect(carriedRadiusPx('hand')).toBe(6 * TILE_PX);
    expect(carriedRadiusPx('guertel')).toBeCloseTo(0.6 * 6 * TILE_PX, 12);
    const catalog = testCatalog();
    const twoHanded = (d: { id: string }): boolean => d.id === 'probe_speer';
    const fackel = newStack(catalog.get('fackel'), 1);
    let bags = withSlot(emptyBags(), equipmentRef('nebenhand'), fackel);
    expect(findCarriedLight(bags, catalog, twoHanded)).toMatchObject({ ref: equipmentRef('nebenhand'), mode: 'hand' });
    bags = withSlot(bags, { bereich: 'schnellleiste', index: 0 }, newStack(catalog.get('probe_speer'), 1));
    expect(findCarriedLight(bags, catalog, twoHanded)).toMatchObject({ ref: equipmentRef('nebenhand'), mode: 'guertel' });
    // A shield in the off hand: the torch of the hotbar hangs on the belt.
    bags = withSlot(bags, equipmentRef('nebenhand'), newStack(catalog.get('probe_schild'), 1));
    expect(findCarriedLight(bags, catalog, twoHanded)).toBeNull();
    bags = withSlot(bags, { bereich: 'schnellleiste', index: 4 }, fackel);
    expect(findCarriedLight(bags, catalog, twoHanded)).toMatchObject({ ref: { bereich: 'schnellleiste', index: 4 }, mode: 'guertel' });
    // Without shield and two-hander a torch in the hotbar is no carried light.
    const plain = withSlot(emptyBags(), { bereich: 'schnellleiste', index: 4 }, fackel);
    expect(findCarriedLight(plain, catalog, twoHanded)).toBeNull();
    // A camp fire is never carried.
    expect(findCarriedLight(withSlot(emptyBags(), { bereich: 'schnellleiste', index: 0 }, newStack(catalog.get('lagerfeuer'), 1)), catalog, () => true)).toBeNull();
  });

  it('Restbrenndauer wandert mit dem Gegenstand; eine volle Fackel trägt keine Daten', () => {
    const catalog = testCatalog();
    const fresh = newStack(catalog.get('fackel'), 1);
    expect(burnRestOf(fresh)).toBeNull();
    const used = withBurnRest(fresh, 1234, FULL);
    expect(burnRestOf(used)).toBe(1234);
    expect(withBurnRest(used, FULL, FULL)).toEqual(fresh);
    expect(tileInReach(16 * 10 + 8, 16 * 10 + 8, 11, 10, 1.5)).toBe(true);
    expect(tileInReach(16 * 10 + 8, 16 * 10 + 8, 13, 10, 1.5)).toBe(false);
  });
});

describe('Fackel in der Hand (F)', () => {
  it('F (Standardbelegung) wird zu light.toggle – einmal je Druck, nicht beim Halten; im Menü nichts', () => {
    const state = new InputState();
    const reader = new ActionReader(state, new BindingSet());
    const frame = (): unknown => {
      reader.update();
      const cmd = lightToggleCommand(reader);
      state.endFrame();
      return cmd;
    };
    expect(frame()).toBeNull();
    state.keyDown('KeyF');
    expect(frame()).toEqual({ type: 'light.toggle' });
    // Held: no second toggle.
    expect(frame()).toBeNull();
    state.keyUp('KeyF');
    expect(frame()).toBeNull();
    state.keyDown('KeyF');
    expect(frame()).toEqual({ type: 'light.toggle' });
    state.keyUp('KeyF');
    frame();
    // In a menu (context ui) the play action is inactive.
    reader.setContext('ui');
    state.keyDown('KeyF');
    expect(frame()).toBeNull();
  });

  it('F zündet und löscht; 4 Spielstunden trocken, dann ist sie verbraucht', () => {
    const w = camp();
    w.step(1, [{ type: 'light.toggle' }]);
    expect(events<{ reason: string }>(w, 'commandRejected')).toMatchObject([{ reason: 'noLight' }]);
    w.equipTorch();
    expect(w.light.carried).toMatchObject({ item: 'fackel', mode: 'hand', startRest: null, burn: { lit: false, rest: FULL } });
    w.step(1, [{ type: 'light.toggle' }]);
    expect(events(w, 'lightIgnited')).toMatchObject([{ light: CARRIED_LIGHT_ID, kind: 'fackel' }]);
    expect(events(w, 'carriedLightChanged')).toMatchObject([{ item: 'fackel', mode: 'hand', lit: true }]);
    const lit = w.sim.tick - 1;
    const hand = w.light.sources(w.sim).find((s) => s.id === CARRIED_LIGHT_ID);
    expect(hand).toMatchObject({ radius: 6 * TILE_PX, height: L.torch.flameHeightPx.hand, intensity: L.torch.intensity, mount: 'hand' });
    // Snuffed for a while: no burn.
    w.step(100);
    w.step(1, [{ type: 'light.toggle' }]);
    expect(events(w, 'lightExtinguished')).toMatchObject([{ reason: 'schalter' }]);
    const rest = w.light.carried?.burn.rest ?? 0;
    expect(rest).toBe(FULL - 101);
    w.step(500);
    expect(w.light.carried?.burn.rest).toBe(rest);
    w.step(1, [{ type: 'light.toggle' }]);
    until(w, () => w.light.carried === null, FULL);
    expect(w.sim.tick - lit).toBe(FULL + 501);
    expect(events(w, 'lightExtinguished')).toMatchObject([{ reason: 'abgebrannt' }]);
    expect(w.inventory.state.ausruestung[equipmentRef('nebenhand').index]).toBeNull();
    expect(w.inventory.count('fackel')).toBe(2);
  });

  it('Regen halbiert die Brenndauer; die Regenlage wird je Welt-Tick abgetastet', () => {
    const w = camp();
    w.equipTorch();
    w.lenv.precipitation = 0.65;
    w.step(1, [{ type: 'light.toggle' }]);
    w.step(HZ);
    expect(w.light.carried?.burn.rain).toBe('regen');
    until(w, () => w.light.carried === null, FULL);
    expect(w.sim.tick).toBeLessThan(FULL / 2 + 2 * HZ);
    expect(w.sim.tick).toBeGreaterThan(FULL / 2 - 2 * HZ);
  });

  it('Starkregen löscht in der ersten Minute, deren Wurf es sagt', () => {
    const w = camp(meadow(24, 24), 5);
    w.equipTorch();
    w.lenv.precipitation = 1;
    // The world tick samples the rain: light the torch right on one, so every heavy minute is a full one.
    until(w, () => w.sim.tick % HZ === HZ - 1, HZ);
    w.step(1, [{ type: 'light.toggle' }]);
    const serial = w.light.carried?.serial ?? 0;
    const seed = hashCombine(normalizeSeed(5), hashString('light'));
    let k = 1;
    while (!heavyRainPutsOut(seed, CARRIED_LIGHT_ID, serial, k) && k * HEAVY_RAIN_ROLL_TICKS < FULL / 2) k++;
    // Lit in the command phase of the last tick: it burned from that tick on.
    const start = w.sim.tick - 1;
    until(w, () => w.light.carried?.burn.lit !== true, FULL);
    const expected = Math.min(k * HEAVY_RAIN_ROLL_TICKS, FULL / 2);
    expect(w.sim.tick - start).toBe(expected);
    expect(events<{ reason: string }>(w, 'lightExtinguished')[0]?.reason).toBe(k * HEAVY_RAIN_ROLL_TICKS < FULL / 2 ? 'regen' : 'abgebrannt');
  });

  it('Schwimmen löscht die Fackel, im Wasser lässt sie sich nicht entzünden', () => {
    const rows = ['..........', '..........', '..wwwwww..', '..wwwwww..', '..........'];
    const w = lightWorld(rows);
    w.spawn(3, 1);
    w.give('fackel', 1);
    w.equipTorch();
    w.step(1, [{ type: 'light.toggle' }]);
    w.step(1, [{ type: 'player.move', dx: 0, dy: 1 }]);
    until(w, () => w.body().swimming, 120);
    // The tick the body entered deep water put the torch out.
    expect(w.light.carried?.burn.lit).toBe(false);
    expect(events<{ reason: string }>(w, 'lightExtinguished').map((e) => e.reason)).toEqual(['wasser']);
    w.step(1, [{ type: 'light.toggle' }]);
    expect(events<{ reason: string }>(w, 'commandRejected')).toMatchObject([{ reason: 'inWater' }]);
  });

  it('Verstauen: die Restdauer geht mit ins Inventar und beim Anlegen weiter', () => {
    const w = camp();
    w.equipTorch();
    w.step(1, [{ type: 'light.toggle' }]);
    w.step(1000);
    w.step(1, [{ type: 'inventory.quickMove', from: equipmentRef('nebenhand') }]);
    expect(events(w, 'lightExtinguished')).toMatchObject([{ reason: 'verstaut' }]);
    expect(w.light.carried).toBeNull();
    const stowed = w.inventory.state.schnellleiste.concat(w.inventory.state.inventar).find((s) => s !== null && s.item === 'fackel' && burnRestOf(s) !== null);
    // Lit in tick T, burned T … T + 1000; stowed in the command phase of T + 1001, before it burned there.
    expect(stowed && burnRestOf(stowed)).toBe(FULL - 1001);
    w.step(1, [{ type: 'inventory.move', from: w.slotOf('fackel'), to: equipmentRef('nebenhand') }]);
    // The first torch found may be a fresh one: equip the used one explicitly.
    const s = w.inventory.state;
    const at = [...s.schnellleiste.map((x, i) => ['schnellleiste', i, x] as const), ...s.inventar.map((x, i) => ['inventar', i, x] as const)].find(([, , x]) => x !== null && burnRestOf(x) !== null);
    if (at !== undefined) w.step(1, [{ type: 'inventory.move', from: { bereich: at[0], index: at[1] }, to: equipmentRef('nebenhand') }]);
    expect(w.light.carried).toMatchObject({ startRest: FULL - 1001, burn: { rest: FULL - 1001, lit: false } });
  });

  it('Nebenhand-Regel im Spiel: Zweihänder in der Haupthand → Gürtel, Radius −40 %', () => {
    const w = camp();
    w.light.addTwoHandedRule((d) => d.id === 'probe_speer');
    w.give('probe_speer', 1);
    w.equipTorch();
    w.step(1, [{ type: 'light.toggle' }]);
    expect(w.light.carried?.mode).toBe('hand');
    w.step(1, [{ type: 'player.selectHotbar', index: w.slotOf('probe_speer').index }]);
    expect(w.light.carried).toMatchObject({ mode: 'guertel', burn: { lit: true } });
    expect(events(w, 'carriedLightChanged')).toMatchObject([{ mode: 'guertel', lit: true }]);
    expect(w.light.sources(w.sim).find((s) => s.id === CARRIED_LIGHT_ID)?.radius).toBeCloseTo(0.6 * 6 * TILE_PX, 12);
  });
});

describe('Platzierte Fackeln und Lagerfeuer', () => {
  it('Fackel aufstellen: brennt am Pfahl, an einer Felswand hängt sie an der Wand; abnehmen mit Restdauer', () => {
    const rows = meadow(24, 24);
    rows[3] = '..........#.............';
    const w = camp(rows);
    const stand = w.place('fackel', 12, 12);
    expect(events(w, 'lightPlaced')).toMatchObject([{ light: stand, kind: 'fackel', mount: 'stand', lit: true }]);
    expect(events(w, 'lightIgnited')).toMatchObject([{ light: stand }]);
    const wall = w.place('fackel', 10, 4);
    expect(w.light.placed(wall)?.mount).toBe('wand');
    const src = w.light.sources(w.sim).find((s) => s.id === wall);
    expect(src).toMatchObject({ height: L.torch.flameHeightPx.wand, y: (OFFSET + 4) * TILE_PX + 1 });
    w.step(600);
    w.step(1, [{ type: 'light.take', light: stand }]);
    expect(events(w, 'commandRejected')).toMatchObject([{ reason: 'outOfReach' }]);
    w.step(1, [{ type: 'player.teleport', x: w.centre(12, 11).x, y: w.centre(12, 11).y, layer: 0 }]);
    w.step(1, [{ type: 'light.take', light: stand }]);
    expect(events(w, 'lightRemoved')).toMatchObject([{ light: stand, reason: 'genommen' }]);
    expect(w.light.placed(stand)).toBeUndefined();
    const taken = w.inventory.state.schnellleiste.concat(w.inventory.state.inventar).find((s) => s !== null && s.item === 'fackel' && burnRestOf(s) !== null);
    expect(taken && burnRestOf(taken)).toBe(FULL - 604);
  });

  it('Platz: nicht auf Wasser, Fels, Baum oder belegter Kachel, höchstens 8 Kacheln entfernt', () => {
    const rows = meadow(24, 24);
    rows[12] = '..........wT#...........';
    const w = camp(rows);
    const tried = (x: number, y: number): string | undefined => {
      w.step(1, [{ type: 'light.place', from: w.slotOf('fackel'), tx: OFFSET + x, ty: OFFSET + y }]);
      return events<{ reason: string }>(w, 'commandRejected')[0]?.reason;
    };
    expect(tried(10, 12)).toBe('tileBlocked');
    expect(tried(11, 12)).toBe('tileBlocked');
    expect(tried(12, 12)).toBe('tileBlocked');
    expect(tried(19, 10)).toBe('outOfReach');
    expect(tried(18, 10)).toBeUndefined();
    expect(tried(18, 10)).toBe('tileTaken');
    w.step(1, [{ type: 'light.place', from: w.slotOf('stein'), tx: OFFSET + 5, ty: OFFSET + 10 }]);
    expect(events(w, 'commandRejected')).toMatchObject([{ reason: 'notPlaceable' }]);
  });

  it('Lagerfeuer: kalt aufgestellt, Brennstoff bis 6 min, entzündet warm und hell, dann Glut, Nachlegen facht an, dann Asche', () => {
    const w = camp();
    // A cool evening by the fire: at 20 °C the fire's 15 °C would bring on heatstroke (§11.2) long before its
    // six minutes are out, and a dead player feeds no fire.
    w.env.air = 8;
    const fire = w.place('lagerfeuer', 11, 10);
    expect(events(w, 'lightPlaced')).toMatchObject([{ light: fire, mount: 'boden', lit: false }]);
    expect(w.light.sources(w.sim).some((s) => s.id === fire)).toBe(false);
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 10 }]);
    expect(events(w, 'commandRejected')).toMatchObject([{ reason: 'noFuel' }]);
    w.step(1, [{ type: 'light.fuel', light: fire, from: w.slotOf('stein') }]);
    expect(events(w, 'commandRejected')).toMatchObject([{ reason: 'notFuel' }]);
    w.step(1, [{ type: 'light.fuel', light: fire, from: w.slotOf('holz') }]);
    expect(events(w, 'fireFueled')).toMatchObject([{ light: fire, item: 'holz', count: 8, fuelSeconds: 360 }]);
    expect(w.inventory.count('holz')).toBe(12);
    w.step(1, [{ type: 'light.fuel', light: fire, from: w.slotOf('zweig') }]);
    expect(events(w, 'commandRejected')).toMatchObject([{ reason: 'fireFull' }]);
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 10 }]);
    const litAt = w.sim.tick - 1;
    expect(events(w, 'lightIgnited')).toMatchObject([{ light: fire, kind: 'lagerfeuer' }]);
    const src = w.light.sources(w.sim).find((s) => s.id === fire);
    expect(src).toMatchObject({ radius: 8 * TILE_PX, intensity: L.campfire.intensity, mount: 'boden' });
    // Warmth: the player 1 tile away feels the full 15 °C of the fire's core.
    w.step(1);
    expect(w.vit().heatC).toBe(15);
    // Cooking spot.
    const p = w.pos();
    expect(w.light.cookingFireNear(0, p.x, p.y, 2)).toBe(fire);
    expect(w.light.cookingFireNear(0, p.x, p.y + 20 * TILE_PX, 2)).toBe(0);
    until(w, () => w.light.placed(fire)?.fire?.lit !== true, FIRE_MAX_FUEL_TICKS + 10);
    expect(w.sim.tick - litAt).toBe(FIRE_MAX_FUEL_TICKS);
    expect(events(w, 'lightExtinguished')).toMatchObject([{ light: fire, reason: 'abgebrannt' }]);
    expect(fireClip(w.light.placed(fire)?.fire as FireBurn)).toBe('glut');
    expect(w.light.sources(w.sim).find((s) => s.id === fire)).toMatchObject({ radius: L.campfire.emberRadiusTiles * TILE_PX, intensity: L.campfire.emberIntensity });
    expect(w.light.heatSources()(w.sim)).toEqual([]);
    // Fuel on the embers rekindles without a light.
    w.step(1, [{ type: 'light.fuel', light: fire, from: w.slotOf('zweig'), count: 2 }]);
    expect(events(w, 'lightIgnited')).toMatchObject([{ light: fire }]);
    // Two twigs (2 × 15 s), one tick of it already burned in the tick they landed.
    expect(w.light.placed(fire)?.fire).toMatchObject({ lit: true, fuel: 30 * HZ - 1 });
    until(w, () => fireClip(w.light.placed(fire)?.fire as FireBurn) === 'asche', 30 * HZ + FIRE_EMBER_TICKS + 10);
    expect(events(w, 'fireCooled')).toMatchObject([{ light: fire }]);
    w.step(1, [{ type: 'light.douse', light: fire }]);
    expect(events(w, 'commandRejected')).toMatchObject([{ reason: 'notBurning' }]);
    w.step(1, [{ type: 'light.take', light: fire }]);
    expect(events(w, 'commandRejected')).toMatchObject([{ reason: 'notTakeable' }]);
  });

  it('Löschen: Feuer wird zu Asche, Fackel geht aus; Anzünden erneut', () => {
    const w = camp();
    const fire = w.place('lagerfeuer', 11, 10);
    w.step(1, [{ type: 'light.fuel', light: fire, from: w.slotOf('zweig'), count: 4 }]);
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 10 }]);
    w.step(1, [{ type: 'light.douse', light: fire }]);
    expect(events(w, 'lightExtinguished')).toMatchObject([{ light: fire, reason: 'schalter' }]);
    expect(fireClip(w.light.placed(fire)?.fire as FireBurn)).toBe('asche');
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 10 }]);
    expect(fireClip(w.light.placed(fire)?.fire as FireBurn)).toBe('brennt');
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 10 }]);
    expect(events(w, 'commandRejected')).toMatchObject([{ reason: 'burning' }]);
    const t = w.place('fackel', 10, 11);
    w.step(1, [{ type: 'light.douse', light: t }]);
    expect(w.light.placed(t)?.torch?.lit).toBe(false);
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 10, ty: OFFSET + 11 }]);
    expect(w.light.placed(t)?.torch?.lit).toBe(true);
  });

  it('entzündet Brennbares: nur mit brennender Fackel in der Hand, über den Haken', () => {
    const w = camp();
    const lit: string[] = [];
    w.light.addFlammables((_sim, layer, tx, ty) => {
      lit.push(`${layer}:${tx}:${ty}`);
      return tx === OFFSET + 11;
    });
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 10 }]);
    expect(events(w, 'commandRejected')).toMatchObject([{ reason: 'nothingToIgnite' }]);
    expect(lit).toEqual([]);
    w.equipTorch();
    w.step(1, [{ type: 'light.toggle' }]);
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 10 }]);
    expect(events(w, 'flammableIgnited')).toMatchObject([{ layer: 0, tx: OFFSET + 11, ty: OFFSET + 10 }]);
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 10, ty: OFFSET + 11 }]);
    expect(events(w, 'commandRejected')).toMatchObject([{ reason: 'nothingToIgnite' }]);
    expect(lit).toEqual([`0:${OFFSET + 11}:${OFFSET + 10}`, `0:${OFFSET + 10}:${OFFSET + 11}`]);
  });
});

/**
 * The real simulation (seed `seed`, small world): the player on the start beach (at `hour` o'clock, when
 * given) and a camp fire set up next to them – fuelled with `logs` logs and lit when `logs` > 0.
 */
function realCamp(seed: number, logs: number, hour?: number): { sim: ReturnType<typeof createSimulation>; fire: { id: number; fire: FireBurn | null; tx: number; ty: number }; p: { x: number; y: number } } {
  const sim = createSimulation({ seed, worldSize: 'small' });
  sim.step([{ type: 'player.spawn' }]);
  if (hour !== undefined) sim.step([{ type: 'setTime', hour, minute: 0 }]);
  const player = sim.system('player') as unknown as { position(s: typeof sim, o: { x: number; y: number }): boolean };
  const p = { x: 0, y: 0 };
  player.position(sim, p);
  sim.step([
    { type: 'inventory.give', item: 'lagerfeuer', count: 1 },
    { type: 'inventory.give', item: 'holz', count: 8 },
  ]);
  const light = sim.system('light') as unknown as { state: { placed: Array<{ id: number; fire: FireBurn | null; tx: number; ty: number }> } };
  const tx = Math.floor(p.x / TILE_PX);
  const ty = Math.floor(p.y / TILE_PX);
  const slot = (item: string): { bereich: 'inventar' | 'schnellleiste'; index: number } => {
    const inv = sim.system('inventory') as unknown as { state: { inventar: Array<{ item: string } | null>; schnellleiste: Array<{ item: string } | null> } };
    const h = inv.state.schnellleiste.findIndex((s) => s?.item === item);
    if (h >= 0) return { bereich: 'schnellleiste', index: h };
    return { bereich: 'inventar', index: inv.state.inventar.findIndex((s) => s?.item === item) };
  };
  // The first free tile next to the player takes the fire.
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
  ] as const) {
    if (light.state.placed.length > 0) break;
    sim.step([{ type: 'light.place', from: slot('lagerfeuer'), tx: tx + dx, ty: ty + dy }]);
    sim.events.drain(() => undefined);
  }
  const fire = light.state.placed[0];
  if (fire === undefined) throw new Error('no free tile next to the player for the camp fire');
  if (logs > 0) {
    sim.step([{ type: 'light.fuel', light: fire.id, from: slot('holz'), count: logs }]);
    sim.step([{ type: 'light.ignite', tx: fire.tx, ty: fire.ty }]);
    if (fire.fire?.lit !== true) throw new Error('the camp fire did not light');
  }
  sim.events.drain(() => undefined);
  return { sim, fire, p };
}

describe('Aufholen in entladenen Chunks: eingefroren + aufgeholt = tickend', () => {
  /** Lights of a camp placed next to each other, then run with a rain schedule; `frozen` freezes their chunk. */
  function run(frozen: boolean, cutAt: readonly number[] = []): LightWorld {
    const w = camp(meadow(24, 24), 9);
    const fire = w.place('lagerfeuer', 11, 11);
    w.step(1, [{ type: 'light.fuel', light: fire, from: w.slotOf('holz'), count: 1 }]);
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 11 }]);
    expect(w.last.get('commandRejected')).toBeUndefined();
    w.place('fackel', 13, 11);
    w.place('fackel', 9, 12);
    const chunk = { layer: 0 as const, cx: (OFFSET + 11) >> CHUNK_SHIFT, cy: (OFFSET + 11) >> CHUNK_SHIFT };
    let frozenAt = w.sim.tick;
    if (frozen) w.setFrozen(11, 11, true);
    // Rain schedule: dry, rain, heavy rain (more than a minute: a roll) – at ticks off the world-tick grid.
    const schedule: ReadonlyArray<readonly [number, number]> = [
      [700, 0.65],
      [2_130, 1],
      [6_010, 0.95],
    ];
    const end = 7_000;
    let si = 0;
    while (w.sim.tick < end) {
      const next = schedule[si];
      if (next !== undefined && w.sim.tick >= next[0]) {
        w.lenv.precipitation = next[1];
        si++;
      }
      if (frozen && cutAt.includes(w.sim.tick)) {
        // Activated for a moment and frozen again: a → b → c must equal a → c.
        w.light.catchUp(chunk, frozenAt, w.sim.tick);
        frozenAt = w.sim.tick;
      }
      w.step(1);
    }
    if (frozen) {
      w.setFrozen(11, 11, false);
      w.light.catchUp(chunk, frozenAt, w.sim.tick);
    }
    return w;
  }

  it('Lagerfeuer und Fackeln (mit Regen und Starkregen) enden eingefroren exakt wie tickend', () => {
    const ticking = run(false);
    const frozen = run(true);
    const a = copyLightState(ticking.light.state as never);
    const b = copyLightState(frozen.light.state as never);
    // Bring the ticking lights to the same tick (they were advanced in the last update already).
    expect(b.placed).toEqual(a.placed);
    // Something happened on the way: the fire burned down to embers, the torches met a full minute of heavy rain.
    expect(fireClip(a.placed.find((l) => l.kind === 'lagerfeuer')?.fire as FireBurn)).toBe('glut');
    const torches = a.placed.filter((l) => l.torch !== null);
    expect(torches).toHaveLength(2);
    for (const t of torches) expect(t.torch?.heavyTicks).toBeGreaterThanOrEqual(HEAVY_RAIN_ROLL_TICKS);
    const split = run(true, [3_001, 3_060, 5_999]);
    expect(copyLightState(split.light.state as never).placed).toEqual(a.placed);
  });

  it('eine Fackel, die eingefroren abbrennt, verschwindet genauso wie tickend', () => {
    const make = (frozen: boolean): LightWorld => {
      const w = camp(meadow(24, 24), 2);
      const t = w.place('fackel', 13, 12);
      w.lenv.precipitation = 0.7;
      if (frozen) w.setFrozen(13, 12, true);
      w.step(FULL / 2 + 3 * HZ);
      if (frozen) {
        w.setFrozen(13, 12, false);
        w.light.catchUp({ layer: 0, cx: (OFFSET + 13) >> CHUNK_SHIFT, cy: (OFFSET + 12) >> CHUNK_SHIFT }, 0, w.sim.tick);
      }
      expect(w.light.placed(t)).toBeUndefined();
      return w;
    };
    expect(copyLightState(make(true).light.state as never)).toEqual(copyLightState(make(false).light.state as never));
  });

  it('in der echten Simulation: Aufhol-Registry, Aktive Zone folgt dem Spieler, das Feuer brennt weiter', () => {
    const { sim, fire, p } = realCamp(11, 4);
    const litAt = sim.tick - 1;
    // Away: the zone freezes the fire's chunk; back after a while: it caught up.
    sim.step([{ type: 'player.teleport', x: p.x + 200 * TILE_PX, y: p.y, layer: 0 }]);
    expect(sim.world.zone.isActive(0, fire.tx >> CHUNK_SHIFT, fire.ty >> CHUNK_SHIFT)).toBe(false);
    for (let i = 0; i < 20 * HZ; i++) sim.step();
    const frozenFuel = fire.fire?.fuel ?? 0;
    expect(frozenFuel).toBeGreaterThan(4 * 45 * HZ - 20 * HZ - 10);
    sim.step([{ type: 'player.teleport', x: p.x, y: p.y, layer: 0 }]);
    expect(sim.world.zone.isActive(0, fire.tx >> CHUNK_SHIFT, fire.ty >> CHUNK_SHIFT)).toBe(true);
    expect(fire.fire?.fuel).toBe(4 * 45 * HZ - (sim.tick - litAt));
  });

  it('in der echten Simulation: nachts wärmt das Lagerfeuer, leuchtet gleißend und senkt die Furcht – ohne Feuer steigt sie', () => {
    const fearOf = (sim: ReturnType<typeof createSimulation>): number => (sim.system('fear') as unknown as { state: { value: number } }).state.value;
    const vitals = (sim: ReturnType<typeof createSimulation>): { heatC: number } | undefined => (sim.system('vitals') as unknown as { vitalsOf(s: typeof sim): { heatC: number } | undefined }).vitalsOf(sim);
    const lightOf = (sim: ReturnType<typeof createSimulation>): LightSystem => sim.system('light') as unknown as LightSystem;
    // Without a fire: night, the dark frightens (§12.3 "Dunkel +1,0/s nachts").
    const dark = realCamp(11, 0, 22);
    dark.sim.step([{ type: 'fear.set', value: 50 }]);
    const darkStart = fearOf(dark.sim);
    for (let i = 0; i < HZ; i++) dark.sim.step();
    expect(lightOf(dark.sim).stageAt(dark.sim, 0, dark.p.x, dark.p.y)).toBe('dunkel');
    expect(fearOf(dark.sim) - darkStart).toBeCloseTo(1, 6);
    expect(vitals(dark.sim)?.heatC).toBe(0);
    // With the fire next to the player: its core warms by 15 °C, its light is glaring, fear falls by 1/s (§12.3 "am Feuer −1/s").
    const warm = realCamp(11, 4, 22);
    warm.sim.step([{ type: 'fear.set', value: 50 }]);
    const warmStart = fearOf(warm.sim);
    for (let i = 0; i < HZ; i++) warm.sim.step();
    expect(warm.fire.fire?.lit).toBe(true);
    expect(vitals(warm.sim)?.heatC).toBe(BALANCE.survival.temperature.fire.coreHeatC);
    expect(lightOf(warm.sim).stageAt(warm.sim, 0, warm.p.x, warm.p.y)).toBe('gleissend');
    expect(fearOf(warm.sim) - warmStart).toBeCloseTo(-1, 6);
    // A cooking spot within reach of the player.
    expect(lightOf(warm.sim).cookingFireNear(0, warm.p.x, warm.p.y, BALANCE.interaction.reachTiles)).toBe(warm.fire.id);
  });
});
