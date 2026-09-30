/**
 * M6-05 "Schadenszahlen in welt-ui (abschaltbar)" (MASTERPROMPT §19.1, §29 "Spiel: … Schadenszahlen"; docs/SPIEL.md §13):
 * every hit with damage puts its amount – whole points, at least 1 – above the body it hit into the world UI, a crit in
 * its own kind; the number lives `DAMAGE_LIFETIME` seconds of simulation time on its layer; the setting
 * `game.damageNumbers` (default on, a row of the settings screen with DE/EN texts) switches them off. Checked with a real
 * blow of the combat system through the session's events.
 */
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../../src/engine/settings';
import type { CombatEventMap } from '../../../src/game/combat/events';
import { GameSession } from '../../../src/game/session';
import de from '../../../src/i18n/de.json';
import en from '../../../src/i18n/en.json';
import type { AtlasData, AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { CombatView, createCombatFrame } from '../../../src/render/game/combat';
import { DamageNumbers } from '../../../src/render/game/damageNumbers';
import type { RenderScene } from '../../../src/render/scene';
import type { Layer } from '../../../src/world/model/coords';
import { DAMAGE_LIFETIME, type DamageKind, type WorldUiList } from '../../../src/render/worldUi/worldUi';
import { PAUSE_SETTING_ROWS } from '../../../src/ui/screens/pause/settingsRows';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const TICK_HZ = 60;
const TILE = 16;

interface Shown {
  x: number;
  y: number;
  text: string;
  age: number;
  kind: DamageKind;
}

function recordingUi(): { ui: WorldUiList; shown: Shown[] } {
  const shown: Shown[] = [];
  const ui = { damage: (x: number, y: number, text: string, age: number, kind: DamageKind = 'treffer') => shown.push({ x, y, text, age, kind }) } as unknown as WorldUiList;
  return { ui, shown };
}

function recordingScene(): { scene: RenderScene; shown: Shown[] } {
  const { ui, shown } = recordingUi();
  const scene = {
    sprite: new SpriteDesc(),
    sprites: { push: () => 0 },
    worldUi: ui,
    water: { impulse: () => true },
    light: { reset: () => ({}) },
    lights: { push: () => undefined },
    post: { distortion: { shockwave: () => 0 } },
  } as unknown as RenderScene;
  return { scene, shown };
}

describe('Schadenszahlen: Text und Lebensdauer', () => {
  it('ganze Punkte, jeder Schaden mindestens 1, kein Schaden keine Zahl; ein Text je Wert', () => {
    expect(DamageNumbers.textOf(0)).toBeNull();
    expect(DamageNumbers.textOf(-3)).toBeNull();
    expect(DamageNumbers.textOf(Number.NaN)).toBeNull();
    expect(DamageNumbers.textOf(0.2)).toBe('1');
    expect(DamageNumbers.textOf(12.4)).toBe('12');
    expect(DamageNumbers.textOf(12.5)).toBe('13');
    expect(DamageNumbers.textOf(1e7)).toBe('9999');
    const cache: string[] = [];
    const a = DamageNumbers.textOf(7.2, cache);
    expect(DamageNumbers.textOf(6.8, cache)).toBe(a);
    expect(cache[7]).toBe('7');
  });

  it('eine Zahl steigt über ihre Lebensdauer in Simulationszeit, nur auf ihrer Ebene; ein Krit ist kritisch, eine Parade ein Wort', () => {
    const numbers = new DamageNumbers();
    numbers.add(100, 50, 0, 12.3, false, 200);
    numbers.add(140, 50, 0, 30, true, 200);
    numbers.label(180, 50, 0, 'Parade!', 200);
    numbers.add(100, 50, -1, 5, false, 200);
    const at = (now: number, layer: Layer = 0, enabled = true) => {
      const r = recordingUi();
      numbers.draw(r.ui, layer, now, TICK_HZ, enabled);
      return r.shown;
    };
    const first = at(200);
    expect(first.map((s) => [s.text, s.kind, s.age])).toEqual([
      ['12', 'treffer', 0],
      ['30', 'kritisch', 0],
      ['Parade!', 'kritisch', 0],
    ]);
    expect(first[0]).toMatchObject({ x: 100, y: 50 });
    expect(at(230)[0]?.age).toBeCloseTo(0.5, 12);
    // Alive until its lifetime ran out, then gone.
    const lastTick = 200 + Math.ceil(DAMAGE_LIFETIME * TICK_HZ) - 1;
    expect(at(lastTick)).toHaveLength(3);
    expect(at(lastTick + 1)).toEqual([]);
    expect(at(199)).toEqual([]);
    expect(at(210, -1).map((s) => s.text)).toEqual(['5']);
    // The setting off: nothing shown, and the count says so.
    expect(at(210, 0, false)).toEqual([]);
    expect(numbers.stats.shown).toBe(0);
    expect(numbers.stats.added).toBe(4);
  });

  it('ein fester Ring: viele Treffer zugleich zeigen die jüngsten 32', () => {
    const numbers = new DamageNumbers();
    for (let k = 1; k <= 40; k++) numbers.add(k, 0, 0, k, false, 10);
    const r = recordingUi();
    numbers.draw(r.ui, 0, 10, TICK_HZ, true);
    expect(r.shown).toHaveLength(32);
    expect(r.shown.map((s) => Number(s.text)).sort((a, b) => a - b)[0]).toBe(9);
  });
});

describe('Schadenszahlen: Einstellung', () => {
  it('Spiel-Einstellung game.damageNumbers, Standard an, als Zeile der Einstellungen mit deutschem und englischem Text', () => {
    const defaults = defaultSettings();
    expect(defaults.game.damageNumbers).toBe(true);
    const row = PAUSE_SETTING_ROWS.find((r) => r.id === 'damageNumbers');
    expect(row?.labelKey).toBe('settings.game.damageNumbers');
    expect(row?.get(defaults)).toBe(true);
    expect(row?.patch(false)).toEqual({ game: { damageNumbers: false } });
    const key = 'settings.game.damageNumbers' as const;
    expect((de as Record<string, string>)[key]).toBe('Schadenszahlen');
    expect((en as Record<string, string>)[key]).toBe('Damage numbers');
  });
});

describe('Schadenszahlen: ein echter Treffer', () => {
  it('der Schwerthieb auf ein Reh zeigt seinen Schaden über dem Reh; ausgeschaltet zeigt er nichts', () => {
    const session = new GameSession({ config: { seed: 20260930, worldSize: 'small', dayLengthMinutes: 12 } });
    const view = new CombatView();
    view.follow(session, () => 'Parade!');
    const hits: CombatEventMap['hitLanded'][] = [];
    session.onEvent('hitLanded', (e) => hits.push(e));
    session.command({ type: 'player.spawn' });
    session.step();
    session.command({ type: 'debug.god', on: true });
    session.command({ type: 'inventory.give', item: 'bronzeschwert', count: 1 });
    session.step();
    const p = session.debugState().player;
    if (p === null) throw new Error('kein Spieler');
    session.command({ type: 'player.selectHotbar', index: 0 });
    session.command({ type: 'player.aim', x: Math.round(p.x + TILE), y: Math.round(p.y) });
    session.command({ type: 'combat.attack', on: true });
    session.step();
    session.command({ type: 'combat.attack', on: false });
    for (let k = 0; k < 8; k++) session.step();
    // The deer appears on the tile east one tick before the blow (it would flee at once).
    session.command({ type: 'creature.spawn', creature: 'reh', count: 1, x: Math.round(p.x + TILE), y: Math.round(p.y), layer: 0 });
    for (let k = 0; k < 10 && hits.length === 0; k++) session.step();
    expect(hits).toHaveLength(1);
    const hit = hits[0] as CombatEventMap['hitLanded'];
    expect(hit.amount).toBeGreaterThan(0);
    const frame = createCombatFrame();
    const atlas = { manifest: MANIFEST } as unknown as AtlasData;
    const on = recordingScene();
    view.draw(on.scene, atlas, session.sim, frame);
    expect(on.shown).toHaveLength(1);
    expect(on.shown[0]?.text).toBe(String(Math.max(1, Math.round(hit.amount))));
    expect(on.shown[0]?.kind).toBe(hit.crit ? 'kritisch' : 'treffer');
    expect(on.shown[0]?.x).toBe(hit.x);
    expect(on.shown[0]?.y).toBeLessThan(hit.y);
    expect(view.info().damageNumbersAdded).toBe(1);
    frame.damageNumbers = false;
    const off = recordingScene();
    view.draw(off.scene, atlas, session.sim, frame);
    expect(off.shown).toEqual([]);
    expect(view.info().damageNumbersShown).toBe(0);
    view.dispose();
  });
});
