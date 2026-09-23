/** Shared helpers for tools that drive the game in headless Chromium (shot, bench). */
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { GL_ARGS } from '../../playwright.config';

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

/** Open the game with debug API and optional query, collect console errors, wait until `__dh.ready`. */
export async function openGame(session: BrowserSession, query: string, viewport = { width: 1920, height: 1080 }): Promise<{ page: Page; errors: string[] }> {
  const page = await session.browser.newPage({ viewport });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`${session.baseUrl}?debug=1${query ? `&${query}` : ''}`);
  await page.waitForFunction(() => (window as unknown as { __dh?: { ready?: boolean } }).__dh?.ready === true, undefined, { timeout: 90_000 });
  return { page, errors };
}
