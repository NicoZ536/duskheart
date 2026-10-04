/**
 * Die Zahlen der Spezifikation für Licht, Schattenbrut und Kampf als Literale (MASTERPROMPT §12, §19; docs/SPIEL.md §11;
 * Review-Mangel „spec-numbers-mirrored-not-pinned“): die Abnahmetests lesen ihre Schwellen aus `BALANCE` und dem Inhalt –
 * eine Änderung an Daten und Balance zugleich (Licht > 0,8 statt > 0,5) bliebe dort grün. Hier steht jede Zahl so, wie die
 * Spezifikation sie nennt, mit der Zeile des MASTERPROMPT; eine Abweichung braucht eine ADR und eine Änderung hier.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CREATURES } from '../../../src/content/creatures/index';
import { WINDUP_MAX_SECONDS, WINDUP_MIN_SECONDS } from '../../../src/content/creatures/schema';
import { CONTENT } from '../../../src/content/index';

describe('§12 Licht (MASTERPROMPT Z. 408–428)', () => {
  it('Z. 410 „Dunkel < 0,15 · Dämmrig 0,15–0,4 · Hell 0,4–0,9 · Gleißend > 0,9“', () => {
    expect(BALANCE.light.map.stages).toEqual({ darkBelow: 0.15, brightFrom: 0.4, glaringAbove: 0.9 });
  });

  it('Z. 427 „Mit Schild oder Zweihandwaffe hängt sie am Gürtel (−40 % Radius)“; Z. 428 „doppelt so weit gesehen“', () => {
    expect(BALANCE.light.offhand.beltRadiusFactor).toBe(0.6);
    expect(BALANCE.combat.twoHandedClasses).toEqual(['zweihand']);
    expect(BALANCE.ai.perception.ownLightFactor).toBe(2);
  });
});

describe('§12.4 Schattenbrut-Regeln (MASTERPROMPT Z. 436–441)', () => {
  it('Z. 438 „Spawnt nur auf Tiles mit Licht < 0,15, 16–40 Tiles vom Spieler entfernt … Dichte nach … Mondphase“ (SPIEL §11 „Finstermond +50 %“)', () => {
    const s = BALANCE.spawn.shadowBrood;
    expect(s.maxLight).toBe(0.15);
    expect([s.minTiles, s.maxTiles]).toEqual([16, 40]);
    expect(s.finstermondFactor).toBe(1.5);
  });

  it('Z. 439 „Meidet Licht > 0,5 (Ausnahmen: Schattenflut, Lichtfresser), erleidet in gleißendem Licht 5 Schaden/s“', () => {
    expect(BALANCE.creatures.shadowBrood.avoidLightAbove).toBe(0.5);
    expect(BALANCE.creatures.shadowBrood.burnPerSecond).toBe(5);
    // Every brood of the content avoids light above 0,5 – the light eater (the exception) and the Nachtmahr (who hunts
    // until glaring light, §12.3 Z. 434) only glaring light above 0,9.
    const avoids = Object.fromEntries(CREATURES.filter((c) => c.familie === 'schattenbrut').map((c) => [c.id, CONTENT.collection('aiProfiles').get(c.ki).meidetLicht]));
    expect(avoids).toEqual({ nachtmahr: 0.9, schleicher: 0.5, kriecher: 0.5, speier: 0.5, lichtfresser: 0.9 });
  });

  it('Z. 440 „Der Lichtfresser löscht Fackeln und Laternen im Umkreis von 4 Tiles“; Z. 441 „Beute: Lumen-Scherben“', () => {
    const eater = CREATURES.find((c) => c.id === 'lichtfresser');
    expect(eater?.angriffe.find((a) => a.lichtfressen !== undefined)?.lichtfressen?.radiusTiles).toBe(4);
    for (const c of CREATURES.filter((x) => x.familie === 'schattenbrut' && x.id !== 'nachtmahr')) {
      const t = CONTENT.collection('lootTables').get(c.beute ?? '');
      expect(new Set(t.beute.map((b) => b.item)), c.id).toEqual(new Set(['lumen_scherbe']));
    }
  });
});

describe('§19 Kampf & KI (MASTERPROMPT Z. 580–601)', () => {
  it('Z. 582 „Rolle (Leertaste, 0,25 s Unverwundbarkeit)“, „Parade: Block in den letzten 0,15 s vor dem Treffer“', () => {
    expect(BALANCE.player.roll.invulnerableSeconds).toBe(0.25);
    expect(BALANCE.combat.parry.windowSeconds).toBe(0.15);
  });

  it('Z. 586 „Axt … fällt Bäume mit 50 %“, „Dolch … Rückenangriff ×3“, „Bogen (Spannen 0,8 s)“, „Armbrust (Nachladen 1,5 s)“; Z. 588 „Holz (40 % Blockkraft)“', () => {
    expect(BALANCE.combat.axe.fellPowerFactor).toBe(0.5);
    expect(BALANCE.combat.dagger.backstabFactor).toBe(3);
    expect(BALANCE.combat.ranged.bowDrawSeconds).toBe(0.8);
    expect(BALANCE.combat.ranged.crossbowReloadSeconds).toBe(1.5);
    expect(CONTENT.collection('items').get('holzschild').schild?.blockkraft).toBe(0.4);
  });

  it('Z. 592 „Rüstung: Reduktion = R / (R + 50). Kritisch 5 % Basis, ×1,75“', () => {
    expect(BALANCE.combat.damage).toMatchObject({ armorConstant: 50, critChance: 0.05, critFactor: 1.75 });
  });

  it('Z. 595 „Sichtkegel 120°, … eigene Lichtquelle ×2“; Z. 598 „Ausholzeit 0,3–0,8 s (Schwierigkeit skaliert)“', () => {
    expect(BALANCE.ai.perception.coneDeg).toBe(120);
    expect(BALANCE.ai.perception.ownLightFactor).toBe(2);
    expect([WINDUP_MIN_SECONDS, WINDUP_MAX_SECONDS]).toEqual([0.3, 0.8]);
    // Every attack of the content winds up within the frame (on Normal; the difficulty scales within it, `windupTicks`).
    for (const c of CREATURES) for (const a of c.angriffe) expect(a.ausholzeit, `${c.id}/${a.name}`).toBeGreaterThanOrEqual(0.3);
    for (const c of CREATURES) for (const a of c.angriffe) expect(a.ausholzeit + (a.anlauf ?? 0), `${c.id}/${a.name}`).toBeLessThanOrEqual(0.8);
  });
});
