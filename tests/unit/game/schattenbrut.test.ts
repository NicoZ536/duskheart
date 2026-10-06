/**
 * Schattenbrut und Licht (M6-28, MASTERPROMPT §12.4 „Spawnt nur auf Tiles mit Licht < 0,15, 16–40 Tiles vom Spieler
 * entfernt, außerhalb von Leuchtfeuer- und Herdzonen, nachts oder im Untergrund; Dichte nach Biomstufe, Mondphase und
 * Schwierigkeit. Meidet Licht > 0,5 …, erleidet in gleißendem Licht 5 Schaden/s, verblasst bei Sonnenaufgang (ohne
 * Beute)“; docs/SPIEL.md §11; M6-16c):
 * - der Licht-Abtaster der Pfade über die Lichtliste markiert genau dieselben Kacheln wie die Abfrage je Kachel;
 * - der Nachtspawner hält sich an Licht, Abstand, Herdzonen, Tageszeit und Dichte;
 * - gleißendes Licht brennt 5 LP/s, der Sonnenaufgang lässt verblassen – ohne Beute; die Brut tritt nicht ins Licht und
 *   verlässt die Welt mit ihrem Chunk;
 * - die Lumen-Scherbe (ihre Beute) brennt 6 Stunden im Herdfeuer.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { Rng } from '../../../src/engine/rng';
import { shadowBroodMax } from '../../../src/game/creatures/formulas';
import type { SimEventMap } from '../../../src/game/sim';
import { steadyLightLevel, type MapLight } from '../../../src/world/lightmap/lightmap';
import type { ChunkData } from '../../../src/world/model/chunk';
import { TILE_PX, type Layer } from '../../../src/world/model/coords';
import { lightListSampler, tileLevelSampler, type TileLightLevels } from '../../../src/world/path/light';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow, tileOf, type KreaturWelt } from './kreatur-testwelt';

const SB = BALANCE.spawn.shadowBrood;
const HZ = BALANCE.time.tickHz;

function light(id: number, x: number, y: number, radius: number, intensity: number): MapLight {
  return { id, layer: 0, x, y, height: 12, radius, intensity, flicker: 0, seed: 0, coneDirection: 0, coneAngle: Math.PI * 2, windowTiles: Math.ceil(radius / TILE_PX) };
}

describe('Licht-Abtaster der Pfade (M6-16c)', () => {
  it('ein Licht gibt jenseits seines Radius nichts ab (die Grundlage des Abtasters)', () => {
    const l = light(1, 100, 100, 96, 1);
    expect(steadyLightLevel(l, 100 + 96, 100)).toBe(0);
    expect(steadyLightLevel(l, 100 + 60, 100 + 80)).toBe(0);
    expect(steadyLightLevel(l, 100 + 50, 100)).toBeGreaterThan(0);
  });

  it('markiert über die Lichtliste genau die Kacheln der Abfrage je Kachel – nachts wie am Tag', () => {
    const rng = new Rng(4);
    for (let round = 0; round < 12; round++) {
      const lights = Array.from({ length: 1 + rng.int(0, 5) }, (_, i) => light(i + 1, rng.float(0, 1600), rng.float(0, 1600), rng.float(40, 160), rng.float(0.3, 1.2)));
      const day = round % 4 === 3;
      // Das Umgebungslicht schwankt je Region (Wetter dimmt), bleibt aber unter seiner Schranke.
      const bound = day ? 1 : 0.12;
      const levels: TileLightLevels = {
        tileLevel: (_l: Layer, tx: number, ty: number) => {
          const ambient = bound * (0.5 + 0.5 * (((tx * 7 + ty * 13) % 10) / 10));
          let v = ambient;
          for (const l of lights) v += steadyLightLevel(l, (tx + 0.5) * TILE_PX, (ty + 0.5) * TILE_PX);
          return v;
        },
      };
      const fast = lightListSampler({ lights: () => lights, levels: () => levels, ambientBound: () => bound });
      const slow = tileLevelSampler(() => levels);
      const w = 40 + rng.int(0, 40);
      const h = 30 + rng.int(0, 40);
      const tx0 = rng.int(0, 60);
      const ty0 = rng.int(0, 60);
      const a = new Uint8Array(w * h).fill(7);
      const b = new Uint8Array(w * h).fill(9);
      // The shadow brood's threshold, the Nachtmahr's (glaring) and a low one.
      const threshold = [BALANCE.creatures.shadowBrood.avoidLightAbove, 0.9, 0.2][round % 3] as number;
      fast.markBright(0, tx0, ty0, w, h, threshold, a);
      slow.markBright(0, tx0, ty0, w, h, threshold, b);
      expect(Array.from(a)).toEqual(Array.from(b));
    }
  });
});

describe('Nachtspawner (M6-28, §12.4)', () => {
  it('Dichte nach Stufe, Finstermond und Schwierigkeit', () => {
    expect(shadowBroodMax(0, false, 'normal')).toBe(SB.maxAliveByTier[0]);
    expect(shadowBroodMax(0, true, 'normal')).toBe(Math.round((SB.maxAliveByTier[0] as number) * SB.finstermondFactor));
    expect(shadowBroodMax(3, false, 'unbarmherzig')).toBe(Math.round((SB.maxAliveByTier[3] as number) * SB.difficultyFactor.unbarmherzig));
    expect(shadowBroodMax(99, false, 'normal')).toBe(SB.maxAliveByTier[SB.maxAliveByTier.length - 1]);
  });

  /** A night on an open field, the player in the middle; runs `seconds` and returns the shadow brood spawned. */
  function night(seconds: number, setup: (w: KreaturWelt) => void = () => undefined): { w: KreaturWelt; spawned: SimEventMap['creatureSpawned'][] } {
    const w = kreaturWelt(meadow(10, 10), { x: 5, y: 5 });
    w.cheats.god = true;
    w.cenv.phase = 'nacht';
    w.light.ambient = 0.05;
    setup(w);
    const spawned: SimEventMap['creatureSpawned'][] = [];
    for (let i = 0; i < seconds; i++) spawned.push(...eventsOf<SimEventMap['creatureSpawned']>(w.run(HZ), 'creatureSpawned'));
    return { w, spawned };
  }

  it('nachts 16–40 Kacheln vom Spieler, auf dunklen Kacheln, bis zur Dichte der Stufe', () => {
    const { w, spawned } = night(60);
    expect(spawned.length).toBeGreaterThan(0);
    const p = w.pos();
    for (const s of spawned) {
      expect(s.creature).toBe('probe_schleicher');
      const d = Math.hypot(s.x - p.x, s.y - p.y) / TILE_PX;
      expect(d).toBeGreaterThanOrEqual(SB.minTiles - 1);
      expect(d).toBeLessThanOrEqual(SB.maxTiles + 1);
      expect(w.light.levelAt(null, 0, s.x, s.y)).toBeLessThan(SB.maxLight);
    }
    let alive = 0;
    for (let i = 0; i < w.creatures.store.size; i++) if (w.creatures.store.valueAt(i).creature === 'probe_schleicher') alive++;
    expect(alive).toBeLessThanOrEqual(shadowBroodMax(0, false, 'normal'));
  });

  it('nicht am Tag, nicht im Hellen, nicht in der Zone eines Herdfeuers', () => {
    expect(night(20, (w) => (w.cenv.phase = 'tag')).spawned).toEqual([]);
    expect(night(20, (w) => (w.light.ambient = 0.2)).spawned).toEqual([]);
    expect(night(20, (w) => w.creatures.useHearth({ spawnBlocked: () => true })).spawned).toEqual([]);
  });

  it('im Untergrund auch am Tag', () => {
    const { w, spawned } = night(20, (x) => {
      x.cenv.phase = 'tag';
      const p = x.pos();
      x.run(1, [{ type: 'player.teleport', x: p.x, y: p.y, layer: -1 }]);
    });
    expect(w.body().layer).toBe(-1);
    expect(spawned.length).toBeGreaterThan(0);
    expect(spawned.every((s) => s.layer === -1)).toBe(true);
  });
});

describe('Licht gegen Schattenbrut', () => {
  it('gleißendes Licht brennt 5 LP/s (einmal je Sekunde hörbar)', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 2, y: 2 });
    w.cenv.phase = 'nacht';
    w.light.ambient = 0.05;
    const e = w.creature('probe_schleicher', 20, 15);
    const at = w.where(e);
    // Ein weites Licht: in einer Sekunde entkommt sie ihm nicht.
    w.light.discs.push({ x: at.x, y: at.y, radius: 40, level: 0.95 });
    const health = w.state(e).health;
    const ev = w.run(HZ);
    expect(health - w.state(e).health).toBeCloseTo(BALANCE.creatures.shadowBrood.burnPerSecond, 5);
    expect(eventsOf(ev, 'creatureBurning')).toHaveLength(1);
  });

  it('bei Sonnenaufgang verblasst sie ohne Beute und ist nach der Auflösung fort', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 2, y: 2 });
    w.cenv.phase = 'nacht';
    w.light.ambient = 0.05;
    const e = w.creature('probe_schleicher', 20, 15);
    w.cenv.phase = 'tag';
    const ev = w.run(1);
    expect(eventsOf<SimEventMap['creatureFaded']>(ev, 'creatureFaded')[0]).toMatchObject({ entity: e, reason: 'sonnenaufgang' });
    const later = w.run(Math.round(BALANCE.creatures.shadowBrood.fadeSeconds * HZ) + 2);
    expect(w.creatures.store.has(e)).toBe(false);
    expect(eventsOf(later, 'creatureDied')).toEqual([]);
    expect(w.spilled).toEqual([]);
  });

  it('sie tritt nicht aus dem Dunkeln ins Licht über 0,5 – auch nicht auf der Jagd', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.cheats.god = true;
    w.cenv.phase = 'nacht';
    w.light.ambient = 0.05;
    const p = w.pos();
    w.light.discs.push({ x: p.x, y: p.y, radius: 5, level: 0.6 });
    const e = w.creature('probe_schleicher', 20, 8);
    let nearest = Infinity;
    for (let i = 0; i < 600; i++) {
      w.run(1);
      const { tx, ty } = tileOf(w.where(e));
      expect(w.light.tileLevel(null, 0, tx, ty)).toBeLessThanOrEqual(BALANCE.creatures.shadowBrood.avoidLightAbove);
      nearest = Math.min(nearest, Math.hypot(w.where(e).x - p.x, w.where(e).y - p.y) / TILE_PX);
    }
    // Sie kam bis an den Rand des Lichts.
    expect(nearest).toBeLessThan(7.5);
  });

  it('sie verlässt die Welt mit ihrem Chunk (kein Bestand)', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 2, y: 2 });
    w.cenv.phase = 'nacht';
    w.light.ambient = 0.05;
    const e = w.creature('probe_schleicher', 20, 15);
    const s = w.state(e);
    const { tx, ty } = tileOf(w.where(e));
    const chunk = w.chunks.get(0, tx >> 5, ty >> 5) as ChunkData;
    w.creatures.zoneListener.onDeactivate(chunk, w.sim.tick);
    w.run(1);
    expect(w.creatures.store.has(e)).toBe(false);
    expect(w.creatures.population.find(0, s.homeCx, s.homeCy)?.members ?? []).toEqual([]);
  });
});

describe('Lumen-Scherbe (Beute der Schattenbrut)', () => {
  it('ist Herdfeuer-Brennstoff für 6 Stunden und die Beute des Nachtmahrs', () => {
    expect(BALANCE.hearth.fuelGameHours.lumen_scherbe).toBe(6);
    expect(CONTENT.collection('items').get('lumen_scherbe').kategorie).toBeDefined();
    expect(CONTENT.collection('lootTables').get('nachtmahr').beute.map((b) => b.item)).toContain('lumen_scherbe');
  });
});

describe('Lichtfresser gegen die Lumen-Laterne (M7-36, §12.4 „saugt Lumen-Ladungen ab“)', () => {
  it('sein Saugen leert die geladene Lumen-Laterne in der Nebenhand: sie erlischt mit dem Grund lichtfresser, die Laterne bleibt', async () => {
    const { LightSystem } = await import('../../../src/game/light/system');
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.cenv.phase = 'nacht';
    w.light.ambient = 0.05;
    w.light.lit = true;
    w.cheats.god = true;
    const lamp = w.sim.addSystem(
      new LightSystem(w.sim, {
        player: w.player,
        inventory: w.inventory,
        collision: w.collision,
        environment: {
          rain: () => 0,
          ambient: (_s, _l, _tx, _ty, out, i) => {
            out[i] = 0.05;
            return undefined;
          },
          active: () => true,
        },
      }),
    );
    w.creatures.addLightEater((s, layer, x, y, r, lumen) => lamp.drainLumenNear(s, layer, x, y, r, lumen));
    w.offhand('lumen_laterne');
    w.run(1, [{ type: 'light.toggle' }]);
    expect(lamp.state.carried?.burn.lit).toBe(true);
    w.creature('lichtfresser', 20, 12);
    let out: { reason: string }[] = [];
    for (let i = 0; i < 20 * HZ && out.length === 0; i++) out = eventsOf<{ reason: string }>(w.run(1), 'lightExtinguished');
    expect(out.map((e) => e.reason)).toEqual(['lichtfresser']);
    expect(lamp.state.carried).toMatchObject({ item: 'lumen_laterne', burn: { lit: false, rest: 0 } });
  });
});
