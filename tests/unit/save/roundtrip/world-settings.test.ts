/**
 * Save roundtrip of the participant `world-settings` (M7-51, docs/SPIEL.md §27): peaceful, the factor overrides, the shadow
 * flood interval and logistics realism survive save → load; saves without the participant (versions 1–3) load with the
 * settings nobody changed; malformed data is refused.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../../../src/game/sim';
import { defaultWorldSettings } from '../../../../src/game/worldsettings/formulas';
import { WORLD_SETTINGS_MIGRATIONS } from '../../../../src/game/worldsettings/state';
import { WorldSettingsSystem } from '../../../../src/game/worldsettings/system';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { SaveRegistry } from '../../../../src/save/registry';

function subject(): { sim: Simulation; ws: WorldSettingsSystem } {
  const sim = new Simulation({ seed: 3, worldSize: 'small' });
  return { sim, ws: sim.addSystem(new WorldSettingsSystem()) };
}

describe('save roundtrip: world-settings', () => {
  it('restores peaceful, the overrides, the shadow flood interval and logistics realism', () => {
    const report = expectRoundtrip(
      subject,
      (s) => {
        s.sim.step([{ type: 'world.setSettings', friedlich: true, hungerDurst: 0.75, gegnerschaden: 1.8, schattenflut: null, logistikRealismus: true }]);
      },
      (s) => s.ws.save,
    );
    expect(report.id).toBe('world-settings');
    expect(JSON.parse(report.canonical)).toEqual({ peaceful: true, hungerThirst: 0.75, enemyDamage: 1.8, shadowFloodNights: null, logisticsRealism: true });
    // A numeric interval and the preset's survive too.
    const numeric = expectRoundtrip(subject, (s) => s.sim.step([{ type: 'world.setSettings', schattenflut: 4 }]), (s) => s.ws.save);
    expect(JSON.parse(numeric.canonical)).toMatchObject({ shadowFloodNights: 4 });
  });

  it('a save without the participant (versions 1–3) loads with the settings nobody changed', () => {
    const { sim, ws } = subject();
    sim.step([{ type: 'world.setSettings', friedlich: true }]);
    const fresh = subject();
    const registry = new SaveRegistry().register(fresh.ws.save);
    registry.deserializeAll({ format: 1, participants: {} });
    expect(fresh.ws.state).toEqual(defaultWorldSettings());
    expect(WORLD_SETTINGS_MIGRATIONS.map((m) => m.from)).toEqual([0]);
    expect(ws.state.peaceful).toBe(true);
  });

  it('malformed snapshots are refused', () => {
    const p = subject().ws.save;
    expect(p.serialize()).toEqual(defaultWorldSettings());
    expect(() => p.deserialize({ ...defaultWorldSettings(), peaceful: 'ja' })).toThrow(TypeError);
    expect(() => p.deserialize({ ...defaultWorldSettings(), hungerThirst: -1 })).toThrow(TypeError);
    expect(() => p.deserialize({ ...defaultWorldSettings(), shadowFloodNights: 'oft' })).toThrow(TypeError);
    expect(() => p.deserialize({ ...defaultWorldSettings(), extra: 1 })).toThrow(TypeError);
    const { logisticsRealism: _dropped, ...partial } = defaultWorldSettings();
    expect(() => p.deserialize(partial)).toThrow(TypeError);
  });
});
