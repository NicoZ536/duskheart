/**
 * M7-115: the water pass advances its wave clock on the clock record itself (`advanceWaveClock`), no fractional time
 * through the call – bit-identical to `waveSteps`.
 */
import { describe, expect, it } from 'vitest';
import { advanceWaveClock, waveSteps, type WaveClock } from '../../../src/render/water/waves';

describe('Wellenuhr am Datensatz (M7-115)', () => {
  it('gives exactly the steps and times of waveSteps – frames of 60 and 30 Hz, a jump back, a long pause', () => {
    const viaRecord: WaveClock = { steps: 0, simTime: 10 };
    const viaArgs = { steps: 0, simTime: 0 };
    let sim = 10;
    const frame = { time: 0 };
    const times: number[] = [];
    for (let i = 0; i < 600; i++) times.push(10 + i / 60);
    for (let i = 0; i < 300; i++) times.push(20 + i / 30);
    times.push(12.5, 12.6, 40, 40.016, 39.9);
    for (let i = 0; i < 200; i++) times.push(41 + i * 0.0173);
    let steps = 0;
    for (const t of times) {
      frame.time = t;
      advanceWaveClock(viaRecord, frame);
      const r = waveSteps(sim, t, viaArgs);
      sim = r.simTime;
      expect([viaRecord.steps, viaRecord.simTime]).toEqual([r.steps, r.simTime]);
      steps += r.steps;
    }
    expect(steps).toBeGreaterThan(500);
  });
});
