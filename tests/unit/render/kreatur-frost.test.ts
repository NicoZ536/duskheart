/**
 * Frost-Palettenzeile für Kreaturrampen (M7-71; ADR-0173 „Frost färbt warme Körper eher grau als blau – eine Palettenzeile
 * „vereist“ wäre palettenreiner“; assets-src/paletteRows.ts `FROST_ZEILE`): eine verlangsamte Kreatur ohne eigene Zeile
 * trägt die Zeile `frost` – Fell, Haut, Federn und Panzer Stufe für Stufe in Eisblau ähnlicher Helligkeit, Kontur, Augen und
 * Glut bleiben; eine Kreatur mit eigener Zeile (Biomvariante der Brut) behält sie und bekommt die Eistönung.
 */
import { describe, expect, it } from 'vitest';
import { RAMPS, paletteIndex } from '../../../assets-src/palette';
import { hexToOklab } from '../../../assets-src/lib/color';
import { FROST_ZEILE, PALETTE_ROWS } from '../../../assets-src/paletteRows';
import { BALANCE } from '../../../src/content/balance';
import { createCombatAttack, type CombatSystem } from '../../../src/game/combat/system';
import { equipmentRef } from '../../../src/game/items/slots';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import type { Entity } from '../../../src/engine/ecs';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { createCreatureFrame, CreatureSprites, FROST_ROW } from '../../../src/render/game/creatures';
import { FROST } from '../../../src/render/game/statusMarks';
import type { RenderScene } from '../../../src/render/scene';

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const TILE = 16;
const ROW = PALETTE_ROWS.find((r) => r.id === FROST_ZEILE.id);
/** Colour of palette index i (1…64) in OKLab. */
const LAB = RAMPS.flatMap((r) => r.colors).map((c) => hexToOklab(c));
const lab = (i: number) => LAB[i - 1] as { L: number; a: number; b: number };

describe('Palettenzeile `frost` (M7-71)', () => {
  it('färbt jede Stufe von Fell, Haut, Federn und Panzer in Wasser- oder Eisblau ähnlicher Helligkeit, dunkel → hell, und lässt Kontur, Augen, Glut, Wasser, Eis und Verderbnis', () => {
    if (ROW === undefined) throw new Error('Zeile frost fehlt');
    const warm = Object.keys(FROST_ZEILE.toenung);
    expect(warm.sort()).toEqual(['erde', 'gras', 'haut', 'holz', 'laub', 'sand', 'stein']);
    const cold = new Set([...RAMPS.filter((r) => r.name === 'eis' || r.name === 'wasser').flatMap((r) => r.colors.map((_, i) => paletteIndex(`${r.name}.${i}`)))]);
    for (const ramp of RAMPS) {
      const mapped = ramp.colors.map((_, i) => ROW.map[paletteIndex(`${ramp.name}.${i}`) - 1] as number);
      if (!warm.includes(ramp.name)) {
        expect(mapped, ramp.name).toEqual(ramp.colors.map((_, i) => paletteIndex(`${ramp.name}.${i}`)));
        continue;
      }
      for (let i = 0; i < mapped.length; i++) {
        const to = mapped[i] as number;
        const from = paletteIndex(`${ramp.name}.${i}`);
        expect(cold.has(to), `${ramp.name}.${i}`).toBe(true);
        // Its value (OKLab L) within 0,1 of the stage's: the shading reads as before.
        expect(Math.abs(lab(to).L - lab(from).L), `${ramp.name}.${i}`).toBeLessThan(0.1);
        // Blue, not grey: towards blue on the b axis, clearly so below the palest highlights (the snow-white `eis.3`).
        expect(lab(to).b, `${ramp.name}.${i}`).toBeLessThan(Math.min(0, lab(from).b));
        if (lab(to).L < 0.85) expect(lab(to).b, `${ramp.name}.${i}`).toBeLessThan(-0.035);
        // Dark → light kept, no two stages on one colour (no banding).
        if (i > 0) expect(lab(to).L, `${ramp.name}.${i}`).toBeGreaterThan(lab(mapped[i - 1] as number).L);
      }
    }
  });
});

/** A world at `hour` with the player (god mode) and `creature` 3 tiles east of it; the creature is held still facing east. */
function world(creature: string, hour = 12): { sim: Simulation; creatures: CreatureSystem; body: Entity; hold: () => void } {
  const sim = createSimulation({ seed: 20261004, worldSize: 'small' });
  sim.step([{ type: 'setTime', hour, minute: 0 } as never]);
  sim.step([{ type: 'player.spawn' } as never]);
  sim.step([{ type: 'debug.god', on: true } as never]);
  const pos = sim.ecs.component('position') as unknown as { get(e: number, c: 'x' | 'y'): number };
  sim.step([{ type: 'creature.spawn', creature, count: 1, x: pos.get(sim.player, 'x') + 3 * TILE, y: pos.get(sim.player, 'y'), layer: 0 } as never]);
  const creatures = sim.system('creatures') as CreatureSystem;
  const body = creatures.store.entityAt(creatures.store.size - 1);
  const hold = (): void => {
    const s = creatures.store.get(body);
    if (s === undefined) throw new Error(`${creature} ist fort`);
    s.facing = 0;
    s.vx = 0;
    s.vy = 0;
  };
  hold();
  return { sim, creatures, body, hold };
}

/** The player's blow lays Verlangsamt on `target` for `seconds` (no damage, no stagger). */
function freeze(sim: Simulation, target: Entity, seconds: number): void {
  const combat = sim.system('combat') as CombatSystem;
  const a = { ...createCombatAttack(), team: 'spieler' as const, damage: 0, wucht: 0, staggerSeconds: 0, critChance: 0, condition: { id: 'verlangsamt', chance: 1, sekunden: seconds } };
  expect(combat.resolve(sim, sim.player, target, a)?.condition).toBe('verlangsamt');
}

/** How the view drew the body `body` (sprite `sprite`; the world has more creatures of its kind: the one at its place). */
function drawn(view: CreatureSprites, sim: Simulation, sprite: string, creatures: CreatureSystem, body: Entity): { row: number; tint: number; rgb: [number, number, number] } {
  const at = { x: 0, y: 0 };
  if (!creatures.positionOf(body, at)) throw new Error('kein Körper');
  const out: { row: number; tint: number; rgb: [number, number, number] }[] = [];
  const frames = new Set<unknown>(MANIFEST.sprites[sprite]?.frames ?? []);
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        if (frames.has(d.frame) && Math.abs(d.x - at.x) <= 1 && d.y === at.y) out.push({ row: d.paletteRow, tint: d.tintStrength, rgb: [d.tintR, d.tintG, d.tintB] });
        return 0;
      },
    },
  } as unknown as RenderScene;
  view.draw(scene, ATLAS, sim, Object.assign(createCreatureFrame(), { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9, alpha: 0, time: 1 }));
  const first = out[0];
  if (first === undefined) throw new Error(`${sprite} nicht gezeichnet`);
  return first;
}

describe('Frost auf Kreaturen in der Spielansicht (M7-71)', () => {
  const frostRow = MANIFEST.paletteRows.findIndex((r) => r.name === FROST_ROW);

  it('Reh und Dachs verlangsamt: eisblau über die Zeile `frost`, keine Tönung darüber; danach wieder wie gezeichnet', () => {
    expect(frostRow).toBeGreaterThan(0);
    for (const creature of ['reh', 'dachs']) {
      const { sim, creatures, body, hold } = world(creature);
      const view = new CreatureSprites();
      expect(drawn(view, sim, `kreatur_${creature}`, creatures, body).row, creature).toBe(0);
      freeze(sim, body, 2);
      for (let i = 0; i < 10; i++) {
        sim.step();
        hold();
      }
      const frozen = drawn(view, sim, `kreatur_${creature}`, creatures, body);
      expect(frozen.row, creature).toBe(frostRow);
      expect(frozen.tint, creature).toBe(0);
      expect(view.stats.frosted).toBeGreaterThanOrEqual(1);
      for (let i = 0; i < 2 * 60; i++) {
        sim.step();
        hold();
      }
      expect(drawn(view, sim, `kreatur_${creature}`, creatures, body).row, creature).toBe(0);
    }
  });

  it('eine Brut mit eigener Biomzeile behält sie und bekommt die Eistönung', () => {
    // At night (the brood fades in daylight), by the light of the player's torch (in the dark only a foe's eyes show).
    const { sim, creatures, body, hold } = world('schleicher', 23);
    sim.step([
      { type: 'inventory.give', item: 'fackel', count: 1 } as never,
      { type: 'inventory.move', from: { bereich: 'schnellleiste', index: 0 }, to: equipmentRef('nebenhand') } as never,
    ]);
    sim.step([{ type: 'light.toggle' } as never]);
    // Past its forming out of the smoke.
    for (let i = 0; i < Math.ceil(BALANCE.creatures.shadowBrood.formSeconds * 60) + 5; i++) {
      sim.step();
      hold();
    }
    const s = creatures.store.get(body);
    if (s === undefined) throw new Error('kein Schleicher');
    // The Nebelmoor variant (its biome row `brut_moor`).
    s.variant = 0;
    freeze(sim, body, 2);
    sim.step();
    hold();
    const view = new CreatureSprites();
    const brood = drawn(view, sim, 'kreatur_schleicher', creatures, body);
    expect(MANIFEST.paletteRows[brood.row]?.name).toBe('brut_moor');
    expect(brood.tint).toBe(FROST.strength);
    expect(brood.rgb).toEqual([FROST.r, FROST.g, FROST.b]);
    expect(view.stats.frosted).toBeGreaterThanOrEqual(1);
  });
});
