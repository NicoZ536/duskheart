/**
 * M7-52 Charaktererstellung (MASTERPROMPT §26 „Charaktererstellung (Name, Körperform, Haut-/Haarpaletten, Kleidungsfarben)“;
 * docs/SPIEL.md §25 „Boot-Ablauf: Neue Welt → Charaktererstellung → Ladebildschirm → Spiel“, §26 „Aussehen“): aus dem
 * Hauptmenü über „Neue Welt“ in die Charaktererstellung; die Live-Vorschau zeigt die Figur in vier Richtungen und ändert sich
 * mit jeder Wahl; ein leerer Name wird abgewiesen; „Zurück“ und wieder „Weiter“ behalten Welt- und Figurenformular; „Welt
 * betreten“ startet die Welt, und ihr erster Spielstand trägt das gewählte Aussehen (Teilnehmer `appearance`).
 */
import { expect, test, type Page } from '@playwright/test';
import { importWorld, parseWorldDumpText } from '../../src/save/dump';
import { MemorySaveStore } from '../../src/save/memoryStore';
import { loadWorld } from '../../src/save/world';
import { logicUrl } from './logik';

interface Dh {
  ready: boolean;
  call(name: string, ...args: unknown[]): unknown;
  state(): { sim: { tick: number; player: unknown } };
}

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as { __dh: Dh }).__dh.call(n as string, ...(a as unknown[])) as T, [name, args] as const);
}

/** The preview of one facing as a fingerprint: the number of drawn pixels and a sum over their colours. */
function vorschau(page: Page, richtung: string): Promise<{ drawn: number; sum: number }> {
  return page.getByTestId(`charakter-vorschau-${richtung}`).evaluate((el) => {
    // Read through a copy made for reading (one readback per copy): the preview's own canvas is only ever written.
    const c = el as HTMLCanvasElement;
    const copy = document.createElement('canvas');
    copy.width = c.width;
    copy.height = c.height;
    const ctx = copy.getContext('2d', { willReadFrequently: true });
    ctx?.drawImage(c, 0, 0);
    const data = ctx?.getImageData(0, 0, c.width, c.height).data ?? new Uint8ClampedArray(0);
    let drawn = 0;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) === 0) continue;
      drawn++;
      sum = (sum * 31 + (data[i] ?? 0) * 7 + (data[i + 1] ?? 0) * 3 + (data[i + 2] ?? 0) + i) % 1_000_000_007;
    }
    return { drawn, sum };
  });
}

/** The pictures of one facing over a little more than one loop of the clip (8 frames at 8 per second), as fingerprints. */
async function bilder(page: Page, richtung: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < 14; i++) {
    const v = await vorschau(page, richtung);
    out.add(`${v.drawn}:${v.sum}`);
    await page.waitForTimeout(110);
  }
  return out;
}

/**
 * Waits until the preview of `richtung` shows a picture not in `vorher`, then (`jedes`) checks a loop's worth: none of them is.
 * The trousers show only as the strip between the tunic's hem and the boots (the shipwrecked's clothes of M3): a frame whose hem
 * covers them may look the same, so for them one changed frame suffices.
 */
async function geaendert(page: Page, richtung: string, vorher: ReadonlySet<string>, was: string, jedes = true): Promise<void> {
  const key = async (): Promise<string> => {
    const v = await vorschau(page, richtung);
    return `${v.drawn}:${v.sum}`;
  };
  await expect.poll(async () => vorher.has(await key()), { message: was }).toBe(false);
  if (jedes) for (const b of await bilder(page, richtung)) expect(vorher.has(b), was).toBe(false);
}

/** Clicks row `feld` `n` times (each click one step on, wrapping round). */
async function weiter(page: Page, feld: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await page.getByTestId(`charakter-${feld}`).click();
}

test('Neue Welt → Charaktererstellung → Spiel: Vorschau, Prüfung, Zurück, und das Aussehen steht im Spielstand', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectConsole(page);
  await page.goto(logicUrl('menue=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true, undefined, { timeout: 120_000 });
  await page.getByTestId('menue-neue-welt').click();
  await expect(page.getByTestId('ui-neue-welt')).toBeVisible();
  await page.getByTestId('neue-welt-name').fill('Figurenwelt');
  await page.getByTestId('neue-welt-seed').fill('DH-13579-small');
  await page.getByTestId('neue-welt-erschaffen').click();

  // The character creation: the name suggested, four facings walking, the rows at the figure as drawn up to M6.
  await expect(page.getByTestId('ui-charakter')).toBeVisible();
  await expect(page.getByTestId('ui-neue-welt')).toHaveCount(0);
  await expect(page.getByTestId('charakter-name')).toHaveValue(/^(Namenlos|Nameless)$/);
  await expect(page.getByTestId('charakter-vorschau')).toHaveAttribute('data-aktion', 'walk');
  await expect(page.getByTestId('charakter-form-wert')).toHaveText(/^(Mittel|Medium)$/);
  await expect(page.getByTestId('charakter-frisur-wert')).toHaveText(/^(Seitenscheitel|Side parting)$/);
  for (const r of ['down', 'right', 'up', 'left']) await expect.poll(async () => (await vorschau(page, r)).drawn, { timeout: 30_000 }).toBeGreaterThan(80);

  // Standing: the idle clip (it breathes) in every facing.
  await page.getByTestId('charakter-gehen').click();
  await expect(page.getByTestId('charakter-vorschau')).toHaveAttribute('data-aktion', 'idle');

  // Every choice changes the live preview: none of the pictures after it is one of the idle clip's before it.
  const choices: ReadonlyArray<readonly [string, number, RegExp, string]> = [
    ['form', 1, /^(Kräftig|Sturdy)$/, 'down'],
    ['haut', 4, /^(Braun|Brown)$/, 'down'],
    // The braid shows from behind.
    ['frisur', 3, /^(Zopf|Braid)$/, 'up'],
    ['haar', 1, /^(Dunkelbraun|Dark brown)$/, 'down'],
    ['oberteil', 1, /^(Rot|Red)$/, 'down'],
  ];
  for (const [feld, n, wert, richtung] of choices) {
    const vorher = await bilder(page, richtung);
    await weiter(page, feld, n);
    await expect(page.getByTestId(`charakter-${feld}-wert`)).toHaveText(wert);
    await geaendert(page, richtung, vorher, feld);
  }
  // The left arrow steps back and wraps round: the last trousers.
  const vorher = await bilder(page, 'down');
  await page.getByTestId('charakter-hose').locator('.dh-menue__pfeil').first().click();
  await expect(page.getByTestId('charakter-hose-wert')).toHaveText(/^(Nachtdunkel|Night)$/);
  await geaendert(page, 'down', vorher, 'hose', false);

  // An empty name is refused: the screen stays and says why.
  await page.getByTestId('charakter-name').fill('');
  await page.getByTestId('charakter-los').click();
  await expect(page.getByTestId('charakter-fehler')).toBeVisible();
  await expect(page.getByTestId('ui-charakter')).toBeVisible();
  await page.getByTestId('charakter-name').fill('Mira');
  await expect(page.getByTestId('charakter-fehler')).toHaveCount(0);

  // Back to the world's form and on again: both forms are kept.
  await page.getByTestId('charakter-zurueck').click();
  await expect(page.getByTestId('ui-neue-welt')).toBeVisible();
  await expect(page.getByTestId('neue-welt-name')).toHaveValue('Figurenwelt');
  await page.getByTestId('neue-welt-erschaffen').click();
  await expect(page.getByTestId('ui-charakter')).toBeVisible();
  await expect(page.getByTestId('charakter-name')).toHaveValue('Mira');
  await expect(page.getByTestId('charakter-form-wert')).toHaveText(/^(Kräftig|Sturdy)$/);
  await expect(page.getByTestId('charakter-hose-wert')).toHaveText(/^(Nachtdunkel|Night)$/);

  // Into the world: loading screen, then the game; its first save holds the appearance chosen.
  await Promise.all([page.waitForEvent('load'), page.getByTestId('charakter-los').click()]);
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 120_000 });
  await expect.poll(async () => (await call<unknown[]>(page, 'saves')).length, { timeout: 60_000 }).toBe(1);
  const [world] = await call<Array<{ id: string; name: string }>>(page, 'saves');
  expect(world?.name).toBe('Figurenwelt');
  const dump = parseWorldDumpText(await call<string>(page, 'exportSave', world?.id));
  const store = new MemorySaveStore();
  await importWorld(store, dump);
  const loaded = await loadWorld(store, dump.world.id);
  expect(loaded.participant('appearance').serialize()).toEqual({ name: 'Mira', form: 'kraeftig', haut: 'haut_5', frisur: 'zopf', haar: 'haar_2', oberteil: 'kleid_2', hose: 'kleid_8', gewaehlt: true });
  expect(errors).toEqual([]);
});
