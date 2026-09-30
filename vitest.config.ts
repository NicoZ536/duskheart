import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'threads',
    // One worker per core (Vitest's default leaves one idle): `npm run check` runs the unit suite alone and
    // must stay under its 3-minute budget (§3.4); on the 4-core container this saves ≈ 15 % (ADR-0035).
    maxWorkers: availableParallelism(),
    experimental: { fsModuleCache: true },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          // The files of one worker share their module graph (M4-37, ADR-0036): content registry, zod
          // schemas, generated manifests and the world cache are built once per worker instead of once per
          // file – importing them was 40 % of the suite's CPU time. Unit tests therefore keep no state in
          // modules between files and undo what they change on shared objects; shuffled file orders give
          // the same results (`--sequence.shuffle.files`).
          isolate: false,
          // Every test starts from unmocked globals, environment and spies, whichever file ran before it in
          // the same worker.
          restoreMocks: true,
          unstubGlobals: true,
          unstubEnvs: true,
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
