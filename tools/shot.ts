/**
 * `npm run shot -- <szenario> [<szenario> …]` (MASTERPROMPT §3.4, §31.5):
 * rendert deterministische Screenshots (fester Seed, eingefrorene Zeit, festes Wetter) nach shots/latest/.
 * Jedes Szenario läuft im Screenshot-Modus (HUD/Overlays aus, Simulationszeit eingefroren, §31.6);
 * das Werkzeug prüft das vor der Aufnahme. Ohne Argument: alle Szenarien. `--list` zeigt sie.
 *
 * Die Weltkarten `weltkarte-klein`, `weltkarte-mittel`, `weltkarte-gross` (M2-15) zeichnet das Werkzeug in
 * Node aus demselben Generator wie das Spiel (`tools/world/weltkarte.ts`, Seed der Debug-Welt): eine
 * Karte braucht jeden Chunk der Welt. Eine Welt mit Validierungsproblemen gilt als Fehler.
 *
 * Szenarien mit eigener Viewport-Liste (`Scenario.viewports`, z. B. `aufloesungen`) werden je Viewport
 * aufgenommen (`<name>-<b>x<h>.png`); dabei prüft das Werkzeug die interne Auflösung (§4.2) und die
 * Schärfe der hochskalierten Pixel (`tools/lib/sharpness.ts`: jedes interne Pixel ist ein einfarbiger
 * Block, die Balken sind schwarz).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorldSizePreset } from '../src/content/balance';
import { renderWorldMap, WORLD_MAP_SHOTS } from './world/weltkarte';
import { openGame, startBrowserSession, type BrowserSession } from './lib/browser';
import { decodePng } from './lib/png';
import { checkSharpness, type PresentedLayout } from './lib/sharpness';

interface ShotViewport {
  readonly width: number;
  readonly height: number;
  readonly internalWidth: number;
  readonly internalHeight: number;
}

interface DhShotApi {
  readonly screenshot: boolean;
  readonly timeFrozen: boolean;
  call(name: 'scenarios'): string[];
  call(name: 'scenarioReady'): boolean;
  call(name: 'scenarioViewports', scenario: string): ShotViewport[] | null;
  call(name: 'renderInfo'): { viewport: PresentedLayout & { integerScale: number } };
}

/** Viewport of scenarios without an own list. */
const DEFAULT_VIEWPORT = { width: 1920, height: 1080 } as const;
/** Scenario settle timeout (web font, game atlas, WebGL warm-up under SwiftShader). */
const READY_TIMEOUT_MS = 90_000;
/**
 * A sharpness check is only meaningful on a detailed picture: at least this share of neighbouring
 * internal pixels must differ in colour (a uniform frame would pass the block test trivially).
 */
const MIN_CONTRAST_SHARE = 0.05;

const args = process.argv.slice(2).filter((a) => a !== '--');
/** Scenarios drawn in Node (world maps). */
const MAP_SCENARIOS = Object.keys(WORLD_MAP_SHOTS);
const outDir = join(process.cwd(), 'shots/latest');
mkdirSync(outDir, { recursive: true });

/** Opens `name` at `viewport`, waits until stable, checks screenshot mode and writes `file`; returns error messages. */
async function shoot(session: BrowserSession, name: string, viewport: { width: number; height: number }, file: string, expect: ShotViewport | null): Promise<string[]> {
  const problems: string[] = [];
  const { page, errors } = await openGame(session, `scenario=${encodeURIComponent(name)}`, viewport);
  try {
    await page.waitForFunction(() => (window as unknown as { __dh: DhShotApi }).__dh.call('scenarioReady') === true, undefined, { timeout: READY_TIMEOUT_MS });
    const mode = await page.evaluate(() => {
      const api = (window as unknown as { __dh: DhShotApi }).__dh;
      return { screenshot: api.screenshot, frozen: api.timeFrozen };
    });
    if (!mode.screenshot || !mode.frozen) {
      problems.push(`Screenshot-Modus nicht aktiv (screenshot=${String(mode.screenshot)}, eingefroren=${String(mode.frozen)})`);
      return problems;
    }
    const png = await page.screenshot({ path: file });
    if (expect !== null) {
      const layout = await page.evaluate(() => (window as unknown as { __dh: DhShotApi }).__dh.call('renderInfo').viewport);
      if (layout.internalWidth !== expect.internalWidth || layout.internalHeight !== expect.internalHeight) {
        problems.push(`interne Auflösung ${layout.internalWidth}×${layout.internalHeight}, erwartet ${expect.internalWidth}×${expect.internalHeight} (§4.2)`);
      }
      const r = checkSharpness(decodePng(png), layout);
      const minEdges = Math.round(r.blocks * MIN_CONTRAST_SHARE);
      console.log(
        `shot: ${name} ${viewport.width}×${viewport.height}: intern ${layout.internalWidth}×${layout.internalHeight}, Faktor ${r.scale.toFixed(3)}${r.integerScale ? ' (ganzzahlig)' : ''}, ` +
          `${r.uniformBlocks}/${r.blocks} Blöcke einfarbig, ${r.contrastEdges} Kontrastkanten, ${r.litBarPixels} helle Balkenpixel`,
      );
      if (r.uniformBlocks !== r.blocks) problems.push(`${r.blocks - r.uniformBlocks} unscharfe Blöcke (erstes internes Pixel ${r.firstBlur?.x ?? -1}, ${r.firstBlur?.y ?? -1})`);
      if (r.contrastEdges < minEdges) problems.push(`nur ${r.contrastEdges} Kontrastkanten (mindestens ${minEdges}) – Bild zu gleichförmig für die Schärfeprüfung`);
      if (r.litBarPixels > 0) problems.push(`${r.litBarPixels} Pixel der Balken sind nicht schwarz`);
    }
    if (errors.length > 0) problems.push(`Konsolenmeldungen:\n  ${errors.join('\n  ')}`);
    return problems;
  } finally {
    await page.close();
  }
}

/** Draws a world map scenario in Node and writes `file`; returns error messages. */
function shootMap(name: string, file: string): string[] {
  const map = renderWorldMap(WORLD_MAP_SHOTS[name] as WorldSizePreset);
  writeFileSync(file, map.png);
  return map.problems.length > 0 ? [`Validierung der Welt: ${map.problems.join('; ')}`] : [];
}

const listOnly = args.includes('--list');
const requested = args.filter((a) => a !== '--list');
const maps = listOnly ? [] : requested.length > 0 ? requested.filter((a) => MAP_SCENARIOS.includes(a)) : MAP_SCENARIOS;
/** Browser scenarios asked for (`null` = all of them). */
const scenes = requested.length > 0 ? requested.filter((a) => !MAP_SCENARIOS.includes(a)) : null;
let failed = 0;
for (const name of maps) {
  const problems = shootMap(name, join(outDir, `${name}.png`));
  if (problems.length > 0) {
    failed++;
    console.error(`shot: ${name} – ${problems.join('; ')}`);
  } else console.log(`shot: ${name} → shots/latest/${name}.png`);
}
if (listOnly || scenes === null || scenes.length > 0) {
  const session = await startBrowserSession();
  try {
    const probe = await openGame(session, '');
    const all = await probe.page.evaluate(() => (window as unknown as { __dh: DhShotApi }).__dh.call('scenarios'));
    const viewportsOf = new Map<string, ShotViewport[] | null>();
    for (const name of all) viewportsOf.set(name, await probe.page.evaluate((n) => (window as unknown as { __dh: DhShotApi }).__dh.call('scenarioViewports', n), name));
    await probe.page.close();
    if (listOnly) {
      for (const name of all) {
        const vps = viewportsOf.get(name);
        console.log(vps ? `${name} (${vps.map((v) => `${v.width}×${v.height}`).join(', ')})` : name);
      }
      for (const name of MAP_SCENARIOS) console.log(`${name} (Node)`);
    } else {
      for (const name of scenes ?? all) {
        if (!all.includes(name)) {
          console.error(`shot: unbekanntes Szenario „${name}“ (verfügbar: ${[...all, ...MAP_SCENARIOS].join(', ')})`);
          failed++;
          continue;
        }
        const viewports = viewportsOf.get(name) ?? null;
        const jobs = viewports ? viewports.map((v) => ({ viewport: { width: v.width, height: v.height }, file: `${name}-${v.width}x${v.height}.png`, expect: v })) : [{ viewport: DEFAULT_VIEWPORT, file: `${name}.png`, expect: null }];
        for (const job of jobs) {
          const problems = await shoot(session, name, job.viewport, join(outDir, job.file), job.expect);
          if (problems.length > 0) {
            failed++;
            console.error(`shot: ${name} (${job.file}) – ${problems.join('; ')}`);
          } else console.log(`shot: ${name} → shots/latest/${job.file}`);
        }
      }
    }
  } finally {
    await session.close();
  }
}
process.exit(failed > 0 ? 1 : 0);
