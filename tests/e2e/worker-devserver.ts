/**
 * Vite dev server for the worker E2E specs (`worker-*.spec.ts`). The production build has no chunk
 * worker entry until the real generator exists (src/world/gen), so these specs run the bridge,
 * the job queue and the streaming code in Chromium from source: an empty page on the dev server
 * imports the modules, and a module worker created from a Blob imports the same modules (the
 * fixture world as generator). Everything runs exactly as in the game, with real threads.
 */
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { createServer, type Plugin, type ViteDevServer } from 'vite';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** Path of the empty page every worker spec starts from. */
const BLANK_PATH = '/__worker-e2e';

/** An empty HTML page at `BLANK_PATH` (the app's index.html would start the game loop). */
const blankPage: Plugin = {
  name: 'dh-worker-e2e-blank',
  configureServer(server) {
    server.middlewares.use(BLANK_PATH, (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><html lang="de"><head><meta charset="utf-8"><title>worker-e2e</title></head><body></body></html>');
    });
  },
};

/** Starts the dev server on a free port; returns it and the URL of the empty page. */
export async function startWorkerDevServer(): Promise<{ server: ViteDevServer; pageUrl: string }> {
  const server = await createServer({
    configFile: false,
    root: ROOT,
    logLevel: 'error',
    appType: 'custom',
    clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [blankPage],
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (base === undefined) throw new Error('Vite dev server has no local URL');
  return { server, pageUrl: new URL(BLANK_PATH, base).href };
}

/**
 * Source of a module worker serving the chunk worker API of the fixture world plus `sweep(seed,
 * count)` (hashes of `count` generated chunks: one long job). Imports need absolute URLs because
 * a Blob URL is no base for module specifiers.
 */
export function fixtureWorkerSource(origin: string): string {
  return [
    `import { createRpcServer } from '${origin}/src/engine/workerBridge.ts';`,
    `import { chunkHash } from '${origin}/src/world/model/chunk.ts';`,
    `import { createChunkWorkerHandlers } from '${origin}/src/world/stream/worker.ts';`,
    `import { fixtureGenerate } from '${origin}/tests/unit/world/streamFixture.ts';`,
    'const chunks = createChunkWorkerHandlers(fixtureGenerate);',
    'createRpcServer({',
    '  init: (plan) => chunks.init(plan),',
    '  load: (request) => chunks.load(request),',
    '  sweep(seed, count) {',
    '    const out = [];',
    '    for (let i = 0; i < count; i++) out.push(chunkHash(fixtureGenerate({ seed }, 0, i % 32, Math.floor(i / 32) % 32)));',
    '    return out;',
    '  },',
    '}, self);',
  ].join('\n');
}

/** Console errors and page errors of a page (a worker spec must end without any). */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}
