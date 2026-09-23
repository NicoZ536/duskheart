import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'threads',
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
