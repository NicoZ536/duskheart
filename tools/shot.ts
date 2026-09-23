/**
 * `npm run shot -- <szenario> [<szenario> …]` (MASTERPROMPT §3.4, §31.5):
 * rendert deterministische Screenshots (fester Seed, eingefrorene Zeit, festes Wetter) nach shots/latest/.
 * Jedes Szenario läuft im Screenshot-Modus (HUD/Overlays aus, Simulationszeit eingefroren, §31.6);
 * das Werkzeug prüft das vor der Aufnahme. Ohne Argument: alle Szenarien. `--list` zeigt sie.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, startBrowserSession } from './lib/browser';

interface DhShotApi {
  readonly screenshot: boolean;
  readonly timeFrozen: boolean;
  call(name: 'scenarios'): string[];
  call(name: 'scenarioReady'): boolean;
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const outDir = join(process.cwd(), 'shots/latest');
mkdirSync(outDir, { recursive: true });

const session = await startBrowserSession();
let failed = 0;
try {
  const probe = await openGame(session, '');
  const all = await probe.page.evaluate(() => (window as unknown as { __dh: DhShotApi }).__dh.call('scenarios'));
  await probe.page.close();
  if (args.includes('--list')) {
    console.log(all.join('\n'));
  } else {
    const wanted = args.length > 0 ? args : all;
    for (const name of wanted) {
      if (!all.includes(name)) {
        console.error(`shot: unbekanntes Szenario „${name}“ (verfügbar: ${all.join(', ')})`);
        failed++;
        continue;
      }
      const { page, errors } = await openGame(session, `scenario=${encodeURIComponent(name)}`);
      await page.waitForFunction(() => (window as unknown as { __dh: DhShotApi }).__dh.call('scenarioReady') === true, undefined, { timeout: 90_000 });
      const mode = await page.evaluate(() => {
        const dh = (window as unknown as { __dh: DhShotApi }).__dh;
        return { screenshot: dh.screenshot, frozen: dh.timeFrozen };
      });
      if (!mode.screenshot || !mode.frozen) {
        failed++;
        console.error(`shot: ${name} – Screenshot-Modus nicht aktiv (screenshot=${String(mode.screenshot)}, eingefroren=${String(mode.frozen)})`);
        await page.close();
        continue;
      }
      const file = join(outDir, `${name}.png`);
      await page.screenshot({ path: file });
      if (errors.length > 0) {
        failed++;
        console.error(`shot: ${name} – Konsolenmeldungen:\n  ${errors.join('\n  ')}`);
      } else console.log(`shot: ${name} → shots/latest/${name}.png`);
      await page.close();
    }
  }
} finally {
  await session.close();
}
process.exit(failed > 0 ? 1 : 0);
