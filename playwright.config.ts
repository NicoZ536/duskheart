import { defineConfig, devices } from '@playwright/test';

/** Chromium flags so that WebGL2 runs headless via SwiftShader (MASTERPROMPT §3.1). */
export const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
/** Specs that also run in Firefox and WebKit (M7-140): the simulation's bits across JS engines. */
const ENGINE_SPECS = /determinismus\.spec\.ts$/;

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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: GL_ARGS } } },
    // M7-140 (MASTERPROMPT §33 "Smoke-Tests in Chromium, Firefox und WebKit"): the determinism spec in the other two
    // engines. The other specs judge pictures and timings of the Chromium build and stay there. A browser that is not
    // installed skips the spec with that reason (tests/e2e/determinismus.spec.ts); the Chromium flags do not apply.
    { name: 'firefox', testMatch: ENGINE_SPECS, use: { ...devices['Desktop Firefox'], launchOptions: { args: [] } } },
    { name: 'webkit', testMatch: ENGINE_SPECS, use: { ...devices['Desktop Safari'], launchOptions: { args: [] } } },
  ],
});
