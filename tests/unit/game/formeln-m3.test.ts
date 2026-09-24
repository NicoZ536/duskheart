/**
 * M3-Gate „alle Formeln unit-getestet“ (MASTERPROMPT §32 M3, §11, §12, §14, §15.4, §D): die reinen Formeln,
 * die bisher nur über ihre Systeme geprüft waren, hier direkt gegen die Zahlen der Spezifikation – Trefferschaden
 * des Sammelns, Brennwerte und Lichtstufen des Lagerfeuers, Restbrennzeit der Fackel, Grundtempi, Blickrichtung,
 * Lichtverdeckung durch Fels und Klippen, Furchtstufen, Stufenzustände der Überlebenswerte, Wirkungen der
 * Zustände, Rüstungsgewicht, getragenes Licht, Drop-Landepunkt und Saison, benutzbare Zutaten.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { crafting as craftingNs, drops as dropsNs, equipment, fear, gathering, light, player, conditions } from '../../../src/game';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { newStack } from '../../../src/game/items/stack';
import { createVitals } from '../../../src/game/survival/state';
import { BLOCK_SOLID, BLOCK_WALL, infoLevel, packTileInfo } from '../../../src/world/collision/tiles';
import { blocksLight, lightLevelOfTile } from '../../../src/world/lightmap/occlusion';
import { TILE_PX } from '../../../src/world/model/coords';

const HZ = BALANCE.time.tickHz;
const L = BALANCE.light;
const items = contentItemCatalog();
const conditionDef = (id: string) => CONTENT.collection('conditions').get(id);

describe('§D Sammeln: Trefferschaden', () => {
  it('ein Treffer richtet Abbaukraft × (1 + Skillbonus) an – zusammen mit hitsNeeded: Grünhain-Baum 5 Hiebe mit der Steinaxt, 3 mit der Bronzeaxt', () => {
    expect(gathering.hitDamage(1)).toBe(1);
    expect(gathering.hitDamage(2)).toBe(2);
    expect(gathering.hitDamage(1, 0.495)).toBeCloseTo(1.495, 10);
    const tree = 5;
    expect(Math.ceil(tree / gathering.hitDamage(1))).toBe(gathering.hitsNeeded(tree, 1));
    expect(Math.ceil(tree / gathering.hitDamage(2))).toBe(3);
  });

  it('Drops fallen nur in ihrer Jahreszeit; ohne Jahreszeitenliste immer', () => {
    const berry = { item: 'himbeeren', min: 1, max: 2, anlass: 'ernte' as const, jahreszeiten: ['sommer' as const] };
    const twig = { item: 'zweig', min: 1, max: 1, anlass: 'ernte' as const };
    expect(gathering.dropInSeason(berry, 'sommer')).toBe(true);
    expect(gathering.dropInSeason(berry, 'winter')).toBe(false);
    expect(gathering.dropInSeason(twig, 'winter')).toBe(true);
  });
});

describe('§12.2/§15.4 Licht: Brennwerte, Lagerfeuer, Fackel', () => {
  it('Brennwerte in Ticks: Zweig 15 s, Holzscheit 45 s; ein Lagerfeuer fasst höchstens 6 min = 8 Scheite', () => {
    expect(light.fuelTicks(15)).toBe(15 * HZ);
    expect(light.fuelTicks(45)).toBe(45 * HZ);
    expect(light.FIRE_MAX_FUEL_TICKS).toBe(light.fuelTicks(360));
    expect(light.fuelItemsThatFit(0, light.fuelTicks(45), 20)).toBe(8);
    expect(light.fuelItemsThatFit(0, light.fuelTicks(15), 30)).toBe(24);
  });

  it('das Licht des Lagerfeuers: brennt 8 Kacheln, brennt nieder schwächer, Glut klein, kalt und Asche ohne Licht', () => {
    expect(light.fireLight('brennt')).toEqual({ radiusPx: 8 * TILE_PX, intensity: L.campfire.intensity, flicker: L.campfire.flicker });
    const weak = light.fireLight('schwach');
    expect(weak?.radiusPx).toBeCloseTo(8 * TILE_PX * L.campfire.weakRadiusFactor, 10);
    expect(weak?.intensity).toBeLessThan(L.campfire.intensity);
    expect(light.fireLight('glut')?.radiusPx).toBe(L.campfire.emberRadiusTiles * TILE_PX);
    expect(light.fireLight('aus')).toBeNull();
    expect(light.fireLight('asche')).toBeNull();
  });

  it('eine frische Fackel brennt 4 Spielstunden (Restbrennzeit in Sekunden normalen Brennens)', () => {
    const ticksPerGameHour = 60 * HZ;
    const rest = light.torchBurnTicks(ticksPerGameHour);
    expect(light.torchRestSeconds({ lit: true, rest, at: 0, rain: 'trocken', heavyTicks: 0 })).toBe(4 * 60);
  });

  it('getragen wird die Fackel, nicht das Lagerfeuer; das Handlicht sitzt vor dem Körper in Blickrichtung', () => {
    expect(light.carriedKind('fackel')?.id).toBe('fackel');
    expect(light.carriedKind('lagerfeuer')).toBeUndefined();
    expect(light.carriedKind('holz')).toBeUndefined();
    const out = { dx: 0, dy: 0 };
    expect(light.handLightOffset('right', out)).toEqual({ dx: L.torch.handReachPx, dy: 0 });
    expect(light.handLightOffset('up', out)).toEqual({ dx: 0, dy: -L.torch.handReachPx });
  });
});

describe('§11.4 Bewegung', () => {
  it('Grundtempi: Gehen 4,5 · Sprint 7 · Schleichen 2,5 · Schwimmen 2,5; Stehen, Rolle, Sprung, Klettern steuern nicht', () => {
    expect(['walk', 'sprint', 'sneak', 'swim'].map((s) => player.baseSpeedTilesPerSecond(s as 'walk'))).toEqual([4.5, 7, 2.5, 2.5]);
    for (const s of ['idle', 'roll', 'jump', 'climb'] as const) expect(player.baseSpeedTilesPerSecond(s)).toBe(0);
  });

  it('die Blickrichtung als Einheitsvektor (Rolle ohne Eingabe)', () => {
    const out = { x: 0, y: 0 };
    expect(player.facingVector('right', out)).toEqual({ x: 1, y: 0 });
    expect(player.facingVector('left', out)).toEqual({ x: -1, y: 0 });
    expect(player.facingVector('up', out)).toEqual({ x: 0, y: -1 });
    expect(player.facingVector('down', out)).toEqual({ x: 0, y: 1 });
  });

  it('Rüstungsgewicht: das schwerere Teil zählt (leicht < mittel < schwer)', () => {
    expect(equipment.heavierWeight('leicht', 'mittel')).toBe('mittel');
    expect(equipment.heavierWeight('schwer', 'mittel')).toBe('schwer');
    expect(equipment.heavierWeight('leicht', 'leicht')).toBe('leicht');
  });
});

describe('§12.1 Verdeckung der Lichtkarte', () => {
  it('fester Fels verdeckt immer; eine Klippenwand nur Lichter unterhalb ihres Plateaus; offener Boden nie', () => {
    const rock = packTileInfo(BLOCK_SOLID, 0);
    const cliffFace = packTileInfo(BLOCK_WALL, 0, 2);
    const ground = packTileInfo(0, 1);
    expect(blocksLight(rock, 4)).toBe(true);
    expect(blocksLight(cliffFace, 0)).toBe(true);
    expect(blocksLight(cliffFace, 1)).toBe(true);
    expect(blocksLight(cliffFace, 2)).toBe(false);
    expect(blocksLight(ground, 0)).toBe(false);
    expect(lightLevelOfTile(ground)).toBe(1);
    expect(lightLevelOfTile(cliffFace)).toBe(infoLevel(cliffFace));
  });
});

describe('§12.3 Furchtstufen', () => {
  it('die sechs Stufen in ihrer Reihenfolge (ruhig 0 … Nachtmahr 5)', () => {
    expect(['ruhig', 'unruhig', 'fluestern', 'trugbilder', 'bedrohlich', 'nachtmahr'].map((s) => fear.fearStageIndex(s as 'ruhig'))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(fear.fearStageIndex(fear.fearStage(59.9))).toBeLessThan(fear.fearStageIndex(fear.fearStage(60)));
  });
});

describe('§11.1–§11.3 Zustände aus Werten und ihre Wirkungen', () => {
  it('Stufenzustände gelten, solange der Wert in ihrer Stufe steht (Hungrig, Verdurstend, Frierend, Ertrinkend, Wohlgenährt)', () => {
    const v = createVitals();
    const hungry = conditionDef('hungrig');
    const parched = conditionDef('verdurstend');
    const freezing = conditionDef('frierend');
    const drowning = conditionDef('ertrinkend');
    const fed = conditionDef('wohlgenaehrt');
    expect([hungry, parched, freezing, drowning].map((d) => conditions.valueStageActive(d, v))).toEqual([false, false, false, false]);
    v.satietyStage = 'hungrig';
    v.thirstStage = 'verdurstend';
    v.temperatureStage = 'frierend';
    v.drowning = true;
    expect([hungry, parched, freezing, drowning].map((d) => conditions.valueStageActive(d, v))).toEqual([true, true, true, true]);
    v.satiety = 80;
    v.thirst = 80;
    expect(conditions.valueStageActive(fed, v)).toBe(true);
    v.thirst = 79;
    expect(conditions.valueStageActive(fed, v)).toBe(false);
    expect(conditions.valueStageActive(conditionDef('blutung'), v)).toBe(false);
  });

  it('Wirkungen addieren sich: Knochenbruch −40 % Tempo, Erschüttert −15 % max. Leben, Blutung je Stapel', () => {
    const e = conditions.createConditionEffects();
    expect(e).toMatchObject({ moveSpeed: 1, maxHealth: 1, damagePerSecond: 0 });
    conditions.addConditionEffect(e, conditionDef('knochenbruch').wirkung, 1);
    conditions.addConditionEffect(e, conditionDef('erschuettert').wirkung, 1);
    conditions.addConditionEffect(e, conditionDef('blutung').wirkung, 3);
    expect(e.moveSpeed).toBeCloseTo(0.6, 10);
    expect(e.maxHealth).toBeCloseTo(0.85, 10);
    expect(e.damagePerSecond).toBeCloseTo(3 * (conditionDef('blutung').wirkung.schadenProSekunde ?? 0), 10);
    conditions.resetConditionEffects(e);
    expect(e).toEqual(conditions.createConditionEffects());
  });
});

describe('Drops und Handwerk', () => {
  it('der Landepunkt eines Drops liegt im Abstand in Richtung des Winkels', () => {
    const out = { x: 0, y: 0 };
    expect(dropsNs.landingSpot(100, 50, 0, 16, out)).toEqual({ x: 116, y: 50 });
    const p = dropsNs.landingSpot(100, 50, Math.PI / 2, 16, out);
    expect(p.x).toBeCloseTo(100, 10);
    expect(p.y).toBeCloseTo(66, 10);
  });

  it('ein kaputtes Werkzeug ist keine Zutat (§13.1 „Kaputt = unbenutzbar“); Rohstoffe ohne Haltbarkeit immer', () => {
    const axe = newStack(items.get('steinaxt'), 1);
    expect(craftingNs.usableStack(axe)).toBe(true);
    expect(craftingNs.usableStack({ ...axe, haltbarkeit: 0 })).toBe(false);
    expect(craftingNs.usableStack(newStack(items.get('stein'), 5))).toBe(true);
  });
});
