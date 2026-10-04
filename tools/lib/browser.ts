/** Shared helpers for tools that drive the game in headless Chromium (shot, bench). */
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { GL_ARGS } from '../../playwright.config';
import { spielOeffnen, type Neuladezaehler } from '../shot/neuladen';

/** A Vite dev server plus a headless Chromium with WebGL2 (SwiftShader). */
export interface BrowserSession {
  browser: Browser;
  server: ViteDevServer;
  baseUrl: string;
  close(): Promise<void>;
}

export async function startBrowserSession(): Promise<BrowserSession> {
  const server = await createServer({ logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
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
