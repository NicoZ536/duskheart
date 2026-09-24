import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'threads',
    // One worker per core (Vitest's default leaves one idle): `npm run check` runs the unit suite alone and
    // must stay under its 3-minute budget (§3.4); on the 4-core container this saves ≈ 15 % (ADR-0035).
    maxWorkers: availableParallelism(),
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration-fast',
          include: ['tests/integration/**/*.fast.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          exclude: ['tests/integration/**/*.fast.test.ts'],
          environment: 'node',
          testTimeout: 600_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
