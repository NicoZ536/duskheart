/** Shared helpers for tools that drive the game in headless Chromium (shot, bench). */
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type InlineConfig, type ViteDevServer } from 'vite';
import { GL_ARGS } from '../../playwright.config';
import { spielOeffnen, type Neuladezaehler } from '../shot/neuladen';

/**
 * The bare imports of the game's client code, pre-bundled once when a tool's dev server starts (with the entries the Preact
 * preset adds in development). Every bare import under `src/` must stand here (tests/unit/tools/werkzeug-server.test.ts).
 */
export const TOOL_OPTIMIZED_DEPS = ['preact', 'preact/hooks', 'preact/jsx-runtime', 'preact/jsx-dev-runtime', 'preact/debug', 'preact/devtools', '@preact/signals', 'zod'] as const;

/** The tools' own dependency cache: a run of `npm run dev` with its own configuration does not re-bundle theirs mid-run. */
export const TOOL_CACHE_DIR = 'node_modules/.cache/duskhearth/vite-werkzeuge';

/**
 * The dev server of `npm run shot` and `npm run bench` (M7-98): no HMR and no file watching – a source file saved by other
 * work while a shot or a bench runs (a parallel `npm run assets`, an editor) used to reload the page in the middle of a run
 * ("Execution context was destroyed"); now the page keeps the modules it loaded, and a module requested later is read as it
 * is on disk then. The dependencies are bundled once at the start (`noDiscovery`): no dependency found later reloads the
 * page either (a bare import missing from `TOOL_OPTIMIZED_DEPS` would be served unbundled, not reloaded).
 */
export function toolServerConfig(): InlineConfig {
  return {
    logLevel: 'error',
    cacheDir: TOOL_CACHE_DIR,
    server: { port: 0, host: '127.0.0.1', hmr: false, watch: null },
    optimizeDeps: { include: [...TOOL_OPTIMIZED_DEPS], noDiscovery: true },
  };
}

/** A Vite dev server plus a headless Chromium with WebGL2 (SwiftShader). */
export interface BrowserSession {
  browser: Browser;
  server: ViteDevServer;
  baseUrl: string;
  close(): Promise<void>;
}

export async function startBrowserSession(): Promise<BrowserSession> {
  const server = await createServer(toolServerConfig());
  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr === 'string') throw new Error('Vite-Server hat keine Adresse');
  const baseUrl = `http://127.0.0.1:${addr.port}/`;
  const browser = await chromium.launch({ args: GL_ARGS });
  return {
    browser,
    server,
    baseUrl,
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

/** A started game page: its console errors and the count of its reloads since before `page.goto`. */
export interface OpenGame {
  readonly page: Page;
  readonly errors: string[];
  /** Reloads of the page (Vite) since the start began – the start's own navigation not counted (M6-35e). */
  readonly reloads: Neuladezaehler;
}

/**
 * Open the game with debug API and optional query, collect console errors, wait until `__dh.ready`. The reload counter
 * is attached before `page.goto` (`spielOeffnen`): a reload while the game starts counts as a reload – the thrown
 * `StartFehler` says so (`neuGeladen`) – not as a failed start of the scenario. A page that failed to start is closed.
 */
export async function openGame(session: BrowserSession, query: string, viewport = { width: 1920, height: 1080 }): Promise<OpenGame> {
  const page = await session.browser.newPage({ viewport });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  try {
    const reloads = await spielOeffnen(page, `${session.baseUrl}?debug=1${query ? `&${query}` : ''}`);
    return { page, errors, reloads };
  } catch (e) {
    await page.close().catch(() => undefined);
    throw e;
  }
}
