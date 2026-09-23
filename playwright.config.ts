import { defineConfig, devices } from '@playwright/test';

/** Chromium flags so that WebGL2 runs headless via SwiftShader (MASTERPROMPT §3.1). */
export const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'dot',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: GL_ARGS },
    trace: 'off',
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: GL_ARGS } } }],
});
