/**
 * M3-27: timing of the contextual HUD (src/ui/hud/kontext.ts) – linger, hard fade steps, reduced motion,
 * sudden changes against slow drifts – and the frame logic that turns the bridge's state into the fade
 * steps of every display (src/ui/hud/steuerung.ts).
 */
import { signal } from '@preact/signals';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { emptyBags, withSlot } from '../../../src/game/inventory/bags';
import type { UiState } from '../../../src/ui/bridge';
import { createHudSignals } from '../../../src/ui/hud/signale';
import { AUSBLEND_STUFEN, Aenderungswaechter, Einblendung, FENSTER_S, NACHLAUF_S, SCHRITT, STUFE_S, VOLL } from '../../../src/ui/hud/kontext';
import { HudSteuerung } from '../../../src/ui/hud/steuerung';

const HZ = BALANCE.time.tickHz;
const s = (sekunden: number): number => Math.round(sekunden * HZ);

describe('Einblendung', () => {
  it('bleibt nach der Relevanz NACHLAUF_S stehen und blendet dann in harten Stufen aus', () => {
    const e = new Einblendung();
    expect(e.stufe(0, false)).toBe(0);
    expect(e.stufe(10, true)).toBe(VOLL);
    expect(e.stufe(10 + s(NACHLAUF_S) - 1, false)).toBe(VOLL);
    const start = 10 + s(NACHLAUF_S);
    const stufen: number[] = [];
    for (let i = 0; i <= AUSBLEND_STUFEN; i++) stufen.push(e.stufe(start + s(STUFE_S) * i + 1, false));
    expect(stufen).toEqual([3, 2, 1, 0]);
    // Relevant again: at once fully visible.
    expect(e.stufe(start + s(10), true)).toBe(VOLL);
  });

  it('verschwindet bei reduzierter Bewegung ohne Zwischenstufen', () => {
    const e = new Einblendung();
    e.stufe(0, true);
    expect(e.stufe(s(NACHLAUF_S), false, true)).toBe(0);
  });

  it('vergisst nach zuruecksetzen', () => {
    const e = new Einblendung();
    e.stufe(0, true);
    e.zuruecksetzen();
    expect(e.stufe(1, false)).toBe(0);
  });
});

describe('Aenderungswaechter', () => {
  it('erkennt Essen, Treffer und Sprinten (≥ 1 Punkt in ≤ 1 s)', () => {
    const w = new Aenderungswaechter();
    expect(w.melde(60, 0)).toBe(false);
    expect(w.melde(60.5, 20)).toBe(false);
    expect(w.melde(60 + SCHRITT, 30)).toBe(true);
    // A hit: many points in one tick.
    expect(w.melde(40, 31)).toBe(true);
  });

  it('ignoriert natürliches Zehren (Sättigung −100 in 36 min ≈ −1 Punkt je 22 s)', () => {
    const w = new Aenderungswaechter();
    const proTick = 100 / (BALANCE.survival.satiety.minutesToEmpty * 60 * HZ);
    let wert = 80;
    let gemeldet = false;
    for (let t = 0; t < s(120); t++) {
      if (w.melde(wert, t)) gemeldet = true;
      wert -= proTick;
    }
    expect(gemeldet).toBe(false);
  });

  it('zählt einen Sprung nach langer Ruhe (Fenster abgelaufen) nicht als Zeitraffer', () => {
    const w = new Aenderungswaechter();
    w.melde(50, 0);
    expect(w.melde(50.4, s(FENSTER_S) + 5)).toBe(false);
    expect(w.melde(52, s(FENSTER_S) + 10)).toBe(true);
  });
});

/** A UI state with the signals the frame logic reads. */
function zustand() {
  const tick = signal(0);
  const present = signal(true);
  const v = {
    health: signal(100),
    maxHealth: signal(100),
    stamina: signal(100),
    maxStamina: signal(100),
    satiety: signal(90),
    thirst: signal(90),
    coreC: signal(37),
    feltC: signal(22),
    bandLowC: signal(18),
    bandHighC: signal(26),
    temperatureStage: signal<'normal' | 'frierend'>('normal'),
    coreRateCps: signal(0),
  };
  const bags = signal(emptyBags());
  const state = { tick, bags, player: { present, ...v }, hud: createHudSignals().view } as unknown as UiState;
  return { state, tick, present, v, bags };
}

describe('HudSteuerung', () => {
  it('Voll: jede Anzeige voll sichtbar; ohne Spieler nichts', () => {
    const z = zustand();
    const st = new HudSteuerung();
    st.frame(z.state);
    for (const teil of ['leben', 'ausdauer', 'saettigung', 'durst', 'thermo', 'schnellleiste'] as const) expect(st.stufe(teil).value).toBe(VOLL);
    z.present.value = false;
    st.frame(z.state);
    expect(st.stufe('leben').value).toBe(0);
  });

  it('Kontextuell: ruhende Leisten aus, Treffer und Essen blenden ein und nach dem Nachlauf wieder aus', () => {
    const z = zustand();
    const st = new HudSteuerung();
    st.modus = 'contextual';
    st.frame(z.state);
    expect(st.stufe('leben').value).toBe(0);
    expect(st.stufe('saettigung').value).toBe(0);
    expect(st.stufe('thermo').value).toBe(0);
    expect(st.stufe('schnellleiste').value).toBe(VOLL);
    // A hit: health below its maximum.
    z.tick.value = 10;
    z.v.health.value = 80;
    st.frame(z.state);
    expect(st.stufe('leben').value).toBe(VOLL);
    // Eating: satiety rises suddenly – shown although it rests above 50.
    z.v.satiety.value = 98;
    z.tick.value = 11;
    st.frame(z.state);
    expect(st.stufe('saettigung').value).toBe(VOLL);
    z.tick.value = 11 + s(NACHLAUF_S) + s(STUFE_S) * AUSBLEND_STUFEN + 2;
    st.frame(z.state);
    expect(st.stufe('saettigung').value).toBe(0);
    expect(st.stufe('leben').value).toBe(VOLL);
    // Cold: the felt temperature leaves the band.
    z.v.feltC.value = 12;
    st.frame(z.state);
    expect(st.stufe('thermo').value).toBe(VOLL);
  });

  it('Minimal: die Schnellleiste erscheint nur kurz nach einer Änderung von Leiste, Gürtel, Ausrüstung oder Auswahl', () => {
    const z = zustand();
    const st = new HudSteuerung();
    st.modus = 'minimal';
    st.frame(z.state);
    expect(st.stufe('schnellleiste').value).toBe(0);
    // The main inventory changes: the row stays away.
    z.tick.value = 5;
    z.bags.value = withSlot(z.bags.value, { bereich: 'inventar', index: 0 }, { item: 'holz', count: 3 });
    st.frame(z.state);
    expect(st.stufe('schnellleiste').value).toBe(0);
    // The selection changes: shown for the linger time.
    z.tick.value = 6;
    z.bags.value = { ...z.bags.value, auswahl: 4 };
    st.frame(z.state);
    expect(st.stufe('schnellleiste').value).toBe(VOLL);
    z.tick.value = 6 + s(NACHLAUF_S) + s(STUFE_S) * AUSBLEND_STUFEN + 2;
    st.frame(z.state);
    expect(st.stufe('schnellleiste').value).toBe(0);
  });
});
