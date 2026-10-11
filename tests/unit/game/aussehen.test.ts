/**
 * M7-52 Aussehen (MASTERPROMPT §26 „Charaktererstellung (Name, Körperform, Haut-/Haarfarbe via Palette-LUT,
 * Kleidungsfarbe)“; docs/SPIEL.md §26 „Aussehen“): das System `appearance`, der Befehl `appearance.set` und seine Prüfung, die
 * Namensregel, das Ereignis `appearanceChanged`, die Sperre nach der Wahl (`appearanceLocked`), der Auslieferungszustand
 * (die Figur bis M6) und die Inhalte (drei Formen, zwölf Frisuren, 6 Haut-, 8 Haar-, 8 Kleidungspaletten mit ihren
 * Palettenzeilen im Atlas).
 */
import { describe, expect, it } from 'vitest';
import { AUSSEHEN_ZEILEN } from '../../../assets-src/paletteRows';
import { APPEARANCE_PALETTE_COUNTS, APPEARANCE_PALETTES, BODY_SHAPES, HAIRSTYLES, palettesOf } from '../../../src/content/appearance';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { AppearanceSystem, defaultAppearance, validName, type Appearance } from '../../../src/game/appearance';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import { createSimulation } from '../../../src/game/setup';
import { Simulation } from '../../../src/game/sim';
import { SYSTEM_ORDER } from '../../../src/game/systemOrder';

const WAHL = { type: 'appearance.set', name: 'Mira', form: 'kraeftig', haut: 'haut_5', frisur: 'locken', haar: 'haar_3', oberteil: 'kleid_2', hose: 'kleid_5' } as const satisfies GameCommand;

function welt(): { sim: Simulation; system: AppearanceSystem; run(cmds?: readonly GameCommand[]): Map<string, unknown[]> } {
  const sim = new Simulation({ seed: 3, worldSize: 'small' });
  const system = sim.addSystem(new AppearanceSystem());
  return {
    sim,
    system,
    run(cmds) {
      sim.step(cmds);
      const events = new Map<string, unknown[]>();
      sim.events.drain((type, payload) => events.set(type, [...(events.get(type) ?? []), payload]));
      return events;
    },
  };
}

describe('M7-52 Aussehen: Inhalte', () => {
  it('drei Körperformen, zwölf Frisuren, 6 Haut-, 8 Haar-, 8 Kleidungspaletten – je mit Namen auf Deutsch und Englisch', () => {
    expect(BODY_SHAPES.map((b) => b.id)).toEqual(['schmal', 'mittel', 'kraeftig']);
    expect(HAIRSTYLES).toHaveLength(12);
    for (const art of ['haut', 'haar', 'kleid'] as const) {
      expect(palettesOf(art), art).toHaveLength(APPEARANCE_PALETTE_COUNTS[art]);
      expect(palettesOf(art).map((p) => p.id), art).toEqual(Array.from({ length: APPEARANCE_PALETTE_COUNTS[art] }, (_, i) => `${art}_${i + 1}`));
    }
    expect(APPEARANCE_PALETTE_COUNTS).toEqual({ haut: 6, haar: 8, kleid: 8 });
    for (const d of [...BODY_SHAPES, ...HAIRSTYLES, ...APPEARANCE_PALETTES]) {
      expect(d.name.de.length, d.id).toBeGreaterThan(0);
      expect(d.name.en.length, d.id).toBeGreaterThan(0);
    }
    // Registriert in den Inhalten (Querverweise prüft die Inhalts-Validierung).
    expect(CONTENT.bodyShapes.all().length).toBe(3);
    expect(CONTENT.hairstyles.all().length).toBe(12);
    expect(CONTENT.appearancePalettes.all().length).toBe(22);
  });

  it('jede Palette hat ihre Palettenzeile (LUT, assets-src/paletteRows.ts) mit demselben Namen', () => {
    expect(AUSSEHEN_ZEILEN.map((z) => z.id)).toEqual(APPEARANCE_PALETTES.map((p) => p.id));
  });
});

describe('M7-52 Aussehen: Namensregel und Befehl', () => {
  it('Namen: 1–20 Zeichen (BALANCE.appearance), ohne Rand-Leerraum und Steuerzeichen; Zeichen zählen als Codepunkte', () => {
    expect(BALANCE.appearance.nameMinChars).toBe(1);
    expect(BALANCE.appearance.nameMaxChars).toBe(20);
    for (const ok of ['M', 'Mira', 'Ænne Ødegård', 'x'.repeat(20), '🔥'.repeat(20), 'Anna Lena']) expect(validName(ok), ok).toBe(true);
    for (const bad of ['', ' ', ' Mira', 'Mira ', 'x'.repeat(21), 'Mi\nra', 'Mi\u0007ra', '\u0085']) expect(validName(bad), JSON.stringify(bad)).toBe(false);
  });

  it('der Befehl prüft jede Id gegen ihre Sammlung und Palettenart', () => {
    expect(parseGameCommand(WAHL)).toEqual(WAHL);
    expect(() => parseGameCommand({ ...WAHL, name: '' })).toThrow();
    expect(() => parseGameCommand({ ...WAHL, form: 'riesig' })).toThrow();
    expect(() => parseGameCommand({ ...WAHL, frisur: 'glatze' })).toThrow();
    // Die Palette muss von der richtigen Art sein: keine Haarfarbe als Haut, keine Hautfarbe als Kleid.
    expect(() => parseGameCommand({ ...WAHL, haut: 'haar_1' })).toThrow();
    expect(() => parseGameCommand({ ...WAHL, haar: 'haut_2' })).toThrow();
    expect(() => parseGameCommand({ ...WAHL, oberteil: 'haar_2' })).toThrow();
    expect(() => parseGameCommand({ ...WAHL, hose: 'kleid_9' })).toThrow();
    expect(() => parseGameCommand({ ...WAHL, extra: 1 })).toThrow();
  });
});

describe('M7-52 Aussehen: System', () => {
  it('ohne Wahl die Figur bis M6 (mittel, erste Paletten, Seitenscheitel), nicht gewählt', () => {
    const w = welt();
    expect(w.system.appearance).toEqual(defaultAppearance());
    expect(defaultAppearance()).toEqual({ name: '', form: 'mittel', haut: 'haut_1', frisur: 'scheitel', haar: 'haar_1', oberteil: 'kleid_1', hose: 'kleid_1', gewaehlt: false });
  });

  it('appearance.set setzt das Aussehen einmal (Ereignis appearanceChanged), eine zweite Wahl wird abgelehnt', () => {
    const w = welt();
    const vorher = w.system.appearance;
    const e1 = w.run([WAHL]);
    const nach: Appearance = w.system.appearance;
    expect(nach).toEqual({ name: 'Mira', form: 'kraeftig', haut: 'haut_5', frisur: 'locken', haar: 'haar_3', oberteil: 'kleid_2', hose: 'kleid_5', gewaehlt: true });
    expect(nach).not.toBe(vorher);
    expect(e1.get('appearanceChanged')).toEqual([{ tick: 0 }]);
    expect(e1.get('commandRejected')).toBeUndefined();
    const e2 = w.run([{ ...WAHL, name: 'Otto', form: 'schmal' }]);
    expect(e2.get('commandRejected')).toEqual([{ type: 'appearance.set', reason: 'appearanceLocked', tick: 1 }]);
    expect(e2.get('appearanceChanged')).toBeUndefined();
    expect(w.system.appearance).toBe(nach);
  });

  it('das Aussehen ändert nichts an der Simulation außer sich selbst (keine Tick-Arbeit, gleiche Ticks)', () => {
    const a = welt();
    const b = welt();
    a.run([WAHL]);
    b.run();
    for (let i = 0; i < 5; i++) {
      a.run();
      b.run();
    }
    expect(a.sim.tick).toBe(b.sim.tick);
    expect(a.system.save.serialize()).not.toEqual(b.system.save.serialize());
  });

  it('im Spiel: System und Teilnehmer `appearance` direkt nach `player` (§16 Systemreihenfolge, §27 Save-Version 4)', () => {
    const sim = createSimulation({ seed: 7 });
    expect(sim.participant('appearance').serialize()).toEqual(defaultAppearance());
    expect(SYSTEM_ORDER.indexOf('appearance')).toBe(SYSTEM_ORDER.indexOf('player') + 1);
  });
});
