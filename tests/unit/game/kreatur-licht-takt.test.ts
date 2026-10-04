/**
 * M6-16f Schattenbrut im Kreatur-Takt ohne Allokation (Bench `sim:kreaturen-50` mit Schattenbrut, ADR-0140): was der Takt
 * dafür umstellt, liefert dieselben Werte wie vorher.
 * - Das Licht der Kachel liest der Takt über `CreatureLight.tileLevelInto` (Ausgabeparameter) – gleich `tileLevel`.
 * - Gleißend (`lightStage(level) === 'gleissend'`) prüft er als `level > glaringAbove`: gleichwertig, weil die Stufengrenzen
 *   steigen.
 * - Die KI-Profile des Katalogs haben eine Gestalt (alle Felder, auch die optionalen, in einer Reihenfolge) und die Werte
 *   des Contents.
 * - Der Tempofaktor der Varianten (`variantPace`) ist der Wert der Variante, die Grundform 1.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { AI_PROFILES, CREATURES } from '../../../src/content/creatures/index';
import { contentCreatureCatalog } from '../../../src/game/creatures/catalog';
import { lightSystemCreatureLight } from '../../../src/game/creatures/light';
import { parseGameCommand } from '../../../src/game/commands';
import { createSimulation } from '../../../src/game/setup';
import type { LightSystem } from '../../../src/game/light/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import { lightStage } from '../../../src/world/lightmap/stages';
import { TILE_PX } from '../../../src/world/model/coords';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow, type KreaturWelt } from './kreatur-testwelt';

const HZ = BALANCE.time.tickHz;
const FORM_TICKS = Math.round(BALANCE.creatures.shadowBrood.formSeconds * HZ);

/** Night on an open meadow (80 × 40 tiles), the player far off in god mode, the ambient light `ambient`. */
function nacht(ambient: number): KreaturWelt {
  const w = kreaturWelt(meadow(80, 40), { x: 2, y: 2 });
  w.cheats.god = true;
  w.cenv.phase = 'nacht';
  w.light.ambient = ambient;
  return w;
}

describe('Schattenbrut im Kreatur-Takt (M6-16f)', () => {
  it('tileLevelInto schreibt genau tileLevel – nachts um den Spieler mit Fackeln', () => {
    const sim = createSimulation({ seed: 11, worldSize: 'small' });
    sim.step([parseGameCommand({ type: 'setTime', hour: 23, minute: 0 })]);
    sim.step([parseGameCommand({ type: 'player.spawn' })]);
    sim.step();
    const player = sim.system('player') as unknown as PlayerSystem;
    const at = { x: 0, y: 0 };
    expect(player.position(sim, at)).toBe(true);
    const tx = Math.floor(at.x / TILE_PX);
    const ty = Math.floor(at.y / TILE_PX);
    const light = lightSystemCreatureLight(sim, sim.system('light') as unknown as LightSystem, sim.world.calendar);
    const out = new Float64Array(3);
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        for (const layer of [0, -1] as const) {
          out[2] = Number.NaN;
          expect(light.tileLevelInto(sim, layer, tx + dx, ty + dy, out, 2)).toBeUndefined();
          expect(Object.is(out[2], light.tileLevel(sim, layer, tx + dx, ty + dy))).toBe(true);
        }
      }
    }
  });

  it('gleißend heißt: über glaringAbove – die Stufengrenzen steigen', () => {
    const s = BALANCE.light.map.stages;
    expect(s.darkBelow).toBeLessThan(s.brightFrom);
    expect(s.brightFrom).toBeLessThanOrEqual(s.glaringAbove);
    const levels = [Number.NaN, -1, 0, s.darkBelow, s.brightFrom, s.glaringAbove - 1e-12, s.glaringAbove, s.glaringAbove + 1e-12, 1, 2, Number.POSITIVE_INFINITY];
    for (let i = 0; i <= 300; i++) levels.push(i / 200);
    for (const v of levels) expect(v > s.glaringAbove, String(v)).toBe(lightStage(v) === 'gleissend');
  });

  it('die KI-Profile des Katalogs haben eine Gestalt und die Werte des Contents', () => {
    const catalog = contentCreatureCatalog();
    const keys = new Set<string>();
    for (const c of CREATURES) {
      const kind = catalog.get(c.id);
      keys.add(Object.keys(kind.profile).join(','));
      expect(Object.isFrozen(kind.profile)).toBe(true);
      // The content's values (the optional fields it lacks read as undefined).
      const content = AI_PROFILES.find((p) => p.id === c.ki);
      expect(kind.profile).toEqual(content);
    }
    expect(keys.size).toBe(1);
    // Every field of the schema, the optional ones too.
    expect([...keys][0]?.split(',')).toEqual(expect.arrayContaining(['rudel', 'fernkampfAbstand', 'fluchtFlug', 'tarnung', 'scheutFeuer', 'meidetLicht']));
  });

  it('der Tempofaktor je Form: Grundform 1, jede Variante ihr tempo', () => {
    const catalog = contentCreatureCatalog();
    let variants = 0;
    for (const c of CREATURES) {
      const kind = catalog.get(c.id);
      expect(kind.variantPace[0]).toBe(1);
      expect(kind.variantPace.length).toBe(1 + (c.varianten?.length ?? 0));
      c.varianten?.forEach((v, i) => {
        expect(kind.variantPace[i + 1]).toBe(v.tempo);
        variants++;
      });
    }
    // The shadow brood has its biome variants (M6-25b).
    expect(variants).toBeGreaterThan(0);
  });

  it('sie verbrennt nur in gleißendem Licht – in hellem (über ihrer Schwelle) flieht sie unversehrt', () => {
    for (const [level, burns] of [
      [0.85, false],
      [0.95, true],
    ] as const) {
      const w = nacht(0.05);
      const e = w.creature('schleicher', 40, 20);
      const at = w.where(e);
      // A wide light: in a second it does not get out of it.
      w.light.discs.push({ x: at.x, y: at.y, radius: 40, level: level - 0.05 });
      const health = w.state(e).health;
      const ev = w.run(HZ);
      expect(eventsOf(ev, 'creatureBurning').length > 0, String(level)).toBe(burns);
      expect(w.state(e).health < health, String(level)).toBe(burns);
    }
  });

  it('ins Dunkel flieht sie in die dunkelste der acht Richtungen', () => {
    const w = nacht(0.8);
    const e = w.creature('schleicher', 40, 20);
    const at = w.where(e);
    const look = BALANCE.creatures.shadowBrood.escapeLookTiles * TILE_PX;
    // Only north-west (the sixth of the compass directions) lies in the dark.
    const nw = { x: at.x - Math.SQRT1_2 * look, y: at.y - Math.SQRT1_2 * look };
    w.light.discs.push({ x: nw.x, y: nw.y, radius: 1.5, level: -0.78 });
    // Its first decision once formed (it thinks five times a second).
    w.run(FORM_TICKS);
    for (let i = 0; i < HZ && w.state(e).state !== 'fliehen'; i++) w.run(1);
    const s = w.state(e);
    expect(s.state).toBe('fliehen');
    expect(Math.hypot(s.goalX - nw.x, s.goalY - nw.y)).toBeLessThan(TILE_PX);
  });

  it('eine Variante läuft mit ihrem Tempofaktor (der Takt liest variantPace)', () => {
    const w = nacht(0.8);
    const kind = contentCreatureCatalog().get('schleicher');
    const fast = kind.def.varianten?.findIndex((v) => v.tempo === 1.2) ?? -1;
    expect(fast).toBeGreaterThanOrEqual(0);
    const base = w.creature('schleicher', 20, 20);
    const variant = w.creature('schleicher', 20, 32);
    w.state(variant).variant = fast;
    // Both flee the light (bright everywhere: east, the first direction) at their running pace.
    w.run(FORM_TICKS + HZ / 2);
    const from = [w.where(base), w.where(variant)];
    w.run(20);
    const moved = [Math.hypot(w.where(base).x - (from[0]?.x ?? 0), w.where(base).y - (from[0]?.y ?? 0)), Math.hypot(w.where(variant).x - (from[1]?.x ?? 0), w.where(variant).y - (from[1]?.y ?? 0))];
    expect(moved[0]).toBeGreaterThan(10);
    expect((moved[1] as number) / (moved[0] as number)).toBeCloseTo(1.2, 2);
  });

  it('gleißendes Licht löst den Griff des Kriechers (sie brennt), helles nicht', () => {
    for (const [level, holds] of [
      [0.8, true],
      [0.95, false],
    ] as const) {
      const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
      w.cenv.phase = 'nacht';
      w.light.ambient = 0.05;
      w.light.lit = true;
      // The game binds the grab as a motion hold of the player (src/game/setup.ts); the test world does it here.
      w.player.addMotionHold(w.creatures.holdsPlayer);
      const e = w.creature('kriecher', 20, 14);
      for (let i = 0; i < 5 * HZ && !w.creatures.holdsPlayer(w.sim); i++) w.run(1);
      expect(w.creatures.holdsPlayer(w.sim)).toBe(true);
      // Light over both of them, then a few ticks of the hold.
      const at = w.where(e);
      w.light.discs.push({ x: at.x, y: at.y, radius: 10, level: level - 0.05 });
      w.run(10);
      expect(w.creatures.holdsPlayer(w.sim), String(level)).toBe(holds);
    }
  });
});
