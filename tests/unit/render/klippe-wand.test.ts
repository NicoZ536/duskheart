/**
 * M5-33 in the renderer (src/render/world/terrainMesh.ts, shading.ts, shaders/world/terrain.frag): the rock faces of
 * the cliffs have no side, so the terrain mesh mirrors about half of the middle wall pieces (both faces, every row) –
 * never a wall end with its side face, a ramp or stairs; and the ground at the foot of a wall lies in a cast shadow
 * with a hard core that fades out (`wallFootShadow`, the rule of the terrain program).
 */
import { describe, expect, it } from 'vitest';
import { KLIPPE_FRAME, UEBERGANG, WAND_SPALTE, WAND_ZEILE, wandFrame } from '../../../src/world/autotile';
import { wallMirrored } from '../../../src/render/world/terrainMesh';
import { TERRAIN_SHADING, terrainDefines, wallFootShadow } from '../../../src/render/world/shading';

describe('Klippenwand: gespiegelte Mittelstücke (M5-33)', () => {
  it('spiegelt etwa die Hälfte der Mittelstücke, beide Fassungen, jede Zeile – fest je Kachel', () => {
    for (const zeile of Object.values(WAND_ZEILE)) {
      for (const f of [wandFrame(UEBERGANG.keiner, zeile, WAND_SPALTE.mitte), KLIPPE_FRAME.wandVariante + zeile]) {
        let n = 0;
        for (let ty = 0; ty < 20; ty++) for (let tx = 0; tx < 20; tx++) if (wallMirrored(f, tx, ty)) n++;
        expect(n).toBeGreaterThan(160);
        expect(n).toBeLessThan(240);
        expect(wallMirrored(f, 7, 3)).toBe(wallMirrored(f, 7, 3));
      }
    }
  });

  it('spiegelt nie Wandenden, Rampen, Treppen oder den Rand', () => {
    const nie = [
      ...Object.values(WAND_ZEILE).flatMap((z) => [WAND_SPALTE.links, WAND_SPALTE.rechts, WAND_SPALTE.einzeln].map((s) => wandFrame(UEBERGANG.keiner, z, s))),
      ...Object.values(WAND_ZEILE).flatMap((z) => Object.values(WAND_SPALTE).flatMap((s) => [wandFrame(UEBERGANG.rampe, z, s), wandFrame(UEBERGANG.treppe, z, s)])),
      KLIPPE_FRAME.kante,
      KLIPPE_FRAME.kante + 20,
      KLIPPE_FRAME.rampeBruch,
      KLIPPE_FRAME.treppeBruch,
    ];
    for (const f of nie) for (let tx = 0; tx < 12; tx++) expect(wallMirrored(f, tx, 5), `Frame ${f}`).toBe(false);
  });
});

describe('Schlagschatten am Wandfuß (M5-33)', () => {
  it('voll über dem Kern, dann linear bis null an der Reichweite, nie darüber hinaus', () => {
    const s = TERRAIN_SHADING;
    expect(s.aoFootCorePx).toBeGreaterThan(0);
    expect(s.aoFootPx).toBeGreaterThan(s.aoFootCorePx);
    for (let y = 0; y <= s.aoFootCorePx; y += 0.5) expect(wallFootShadow(y)).toBe(1);
    expect(wallFootShadow((s.aoFootPx + s.aoFootCorePx) / 2)).toBeCloseTo(0.5, 6);
    expect(wallFootShadow(s.aoFootPx)).toBe(0);
    expect(wallFootShadow(s.aoFootPx + 3)).toBe(0);
    let last = 1;
    for (let y = 0; y <= 16; y += 0.25) {
      const v = wallFootShadow(y);
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
  });

  it('bei voller Tiefe liegt der Kern zwei Rampenstufen tief – der Höhenunterschied liest sich am Fuß', () => {
    expect(TERRAIN_SHADING.aoMaxSteps).toBe(2);
    const d = terrainDefines();
    expect(d['DH_AO_FOOT_PX']).toBe('9.0');
    expect(d['DH_AO_FOOT_CORE_PX']).toBe('3.0');
  });
});
