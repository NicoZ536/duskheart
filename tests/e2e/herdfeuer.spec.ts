/**
 * M4-20 in the browser: the hearth screen over the running game. A hearthfire is built north of the player on the
 * start beach (`build.place`, the first 3 × 3 spot that takes it) and a wooden chest beside it; the player stands at
 * the hearth, aims at it and presses E – "Öffnen: Herdfeuer" opens the screen (the simulation's `hearthOpened`).
 *
 * - Cold and empty: "Erloschen", "Kein Brennstoff", "Entzünden" locked, no ember core niches (no core item exists
 *   yet – the section appears with the items, tests/unit/ui/herdfeuer-modell.test.ts), the storage overview waiting
 *   for the fire.
 * - Fuel by keys (Enter on the focused wood) and by mouse (right click: half the charcoal), "12/40"-style count and
 *   the stacks in the store; "Entzünden": burning with the game time left ("Brennt noch 15 h"), the safe zone and
 *   "Am Herdfeuer erwachen".
 * - The storage overview lists the chest with its name and fill, shows its slots, and the search finds the stone in
 *   it (German or English name); a query nothing matches says so.
 * - A stack of the store goes back into the bags; "Löschen" puts it out; Esc closes.
 * - Layout: the glow bar under "Brennt noch …" stays clear of "Löschen" and of its keyboard focus frame, at
 *   1280 × 720 and 1920 × 1080.
 * No console errors or warnings.
 */
import { expect, test, type Page } from '@playwright/test';
import { logicUrl } from './logik';

interface Dh {
  ready: boolean;
  state(): { sim: { tick: number; player: { x: number; y: number } | null; events: Record<string, number> } };
  command(cmd: unknown): unknown;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

const TILE = 16;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function cmd(page: Page, c: unknown): Promise<void> {
  await page.evaluate((x) => (window as unknown as { __dh: Dh }).__dh.command(x), c);
}

async function events(page: Page, type: string): Promise<number> {
  return page.evaluate((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.events[t] ?? 0, type);
}

async function ticks(page: Page, n: number): Promise<void> {
  const t = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.tick);
  await page.waitForFunction(([from, k]) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick > (from as number) + (k as number), [t, n] as const);
}

async function start(page: Page, items: ReadonlyArray<readonly [string, number]>): Promise<void> {
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  for (const [item, count] of items) await cmd(page, { type: 'inventory.give', item, count });
}

/** Builds `part` on the first of `offsets` (from the player's tile) that takes it (`event` rises); returns the id and anchor. */
async function build(page: Page, part: string, event: string, offsets: ReadonlyArray<readonly [number, number]>): Promise<{ id: number; tx: number; ty: number }> {
  for (const [dx, dy] of offsets) {
    // Queue the command and read the tick and count in one go: ticks may run between two evaluations.
    const sent = await page.evaluate(
      ([p, e, x, y, tileSize]) => {
        const dh = (window as unknown as { __dh: Dh }).__dh;
        const sim = dh.state().sim;
        if (sim.player === null) return null;
        const tx = Math.floor(sim.player.x / (tileSize as number)) + (x as number);
        const ty = Math.floor(sim.player.y / (tileSize as number)) + (y as number);
        dh.command({ type: 'build.place', part: p, tx, ty });
        return { tick: sim.tick, before: sim.events[e as string] ?? 0, tx, ty };
      },
      [part, event, dx, dy, TILE] as const,
    );
    if (sent === null) throw new Error('no player');
    await page.waitForFunction(([t, b, e]) => {
      const s = (window as unknown as { __dh: Dh }).__dh.state().sim;
      return (s.events[e as string] ?? 0) > (b as number) || s.tick > (t as number) + 3;
    }, [sent.tick, sent.before, event] as const);
    const after = await events(page, event);
    if (after > sent.before) return { id: after, tx: sent.tx, ty: sent.ty };
  }
  throw new Error(`no free spot for ${part}`);
}

const HEARTH_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-1, -4],
  [-1, 2],
  [-5, -1],
  [3, -1],
  [-5, -4],
  [3, -4],
];
const CHEST_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [2, 0],
  [-2, 0],
  [2, 1],
  [-2, 1],
  [3, 0],
  [-3, 0],
];

/**
 * Room between the glow row (flame and bar) and the ignite/douse button [CSS px], and what the button's keyboard focus
 * frame reaches beyond its box (outline with its offset, or the dark ring of the box shadow – src/ui/focus/focus.css).
 */
async function glowClearance(page: Page): Promise<{ gap: number; ring: number; barWidth: number }> {
  return page.evaluate(() => {
    const row = document.querySelector('.dh-hf__glut');
    const bar = document.querySelector('.dh-hf__glut .dh-hw__balken');
    const button = document.querySelector('[data-testid="herd-schalter"]');
    if (row === null || bar === null || button === null) throw new Error('Glut oder Schalter fehlt');
    const had = button.hasAttribute('data-fokus-sichtbar');
    if (!had) button.setAttribute('data-fokus-sichtbar', '');
    const cs = getComputedStyle(button);
    const spreads = [...cs.boxShadow.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
    const outline = cs.outlineStyle === 'none' ? 0 : Number.parseFloat(cs.outlineWidth) + Number.parseFloat(cs.outlineOffset);
    if (!had) button.removeAttribute('data-fokus-sichtbar');
    const ring = Math.max(outline, spreads.length >= 4 ? (spreads[3] ?? 0) : 0);
    return { gap: button.getBoundingClientRect().top - row.getBoundingClientRect().bottom, ring, barWidth: bar.getBoundingClientRect().width };
  });
}

test('Herdfeuer mit E öffnen, befeuern, entzünden, Restzeit; die Lagerübersicht listet und durchsucht die Kiste', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['herdfeuer', 1],
    ['kiste_holz', 1],
    ['holz', 12],
    ['holzkohle', 2],
    ['stein', 10],
  ]);
  const hearth = await build(page, 'herdfeuer', 'hearthBuilt', HEARTH_SPOTS);
  const chest = await build(page, 'kiste_holz', 'chestPlaced', CHEST_SPOTS);
  await cmd(page, { type: 'storage.put', chest: chest.id, from: { bereich: 'inventar', index: 4 } });
  await cmd(page, { type: 'storage.rename', chest: chest.id, name: 'Vorrat' });
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['chestRenamed'] ?? 0) >= 1);

  // Stand south of the ring, aim at its centre (the mouse stays off the page): E opens the cold, empty hearth.
  await cmd(page, { type: 'player.teleport', x: (hearth.tx + 1.5) * TILE, y: (hearth.ty + 3.5) * TILE, layer: 0 });
  await cmd(page, { type: 'player.aim', x: (hearth.tx + 1.5) * TILE, y: (hearth.ty + 1.5) * TILE });
  await ticks(page, 2);
  // Keys in use (Tab/I opens and closes the inventory): the screen shows its focus frame.
  await press(page, 'KeyI');
  await press(page, 'KeyI');
  await expect(page.getByTestId('hud-hinweis')).toContainText('Öffnen: Herdfeuer');
  const opened = await events(page, 'hearthOpened');
  await press(page, 'KeyE');
  await page.waitForFunction((n) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['hearthOpened'] ?? 0) > n, opened);
  const screen = page.getByTestId('ui-herdfeuer');
  await expect(screen).toBeVisible();
  await ticks(page, 3);
  await expect(screen).toBeVisible();
  await expect(page.getByTestId('herdfeuer')).toHaveAttribute('data-herd', String(hearth.id));
  const status = page.getByTestId('herd-status');
  await expect(status).toHaveAttribute('data-ton', 'leer');
  await expect(status).toContainText('Erloschen');
  await expect(status).toContainText('Kein Brennstoff');
  await expect(page.getByTestId('herd-schalter')).toBeDisabled();
  await expect(page.getByTestId('herd-uebersicht-aus')).toBeVisible();
  // No ember core exists yet (the beacons bring them, M7): no niche section at all, nothing that waits for later
  // content (§2.1, Review M4 #18); the radius line of the zone stays.
  await expect(page.getByTestId('herd-kerne')).toHaveCount(0);
  await expect(page.getByTestId('herd-nischen')).toHaveCount(0);
  await expect(page.locator('[data-testid^="herd-nische-"]')).toHaveCount(0);
  await expect(page.getByTestId('herd-nischen-hinweis')).toHaveCount(0);
  await expect(page.getByTestId('herd-radius')).toBeVisible();

  // Keys: the focus frame starts on the wood in the bags; Enter puts it into the store.
  await expect(page.locator('[data-fokus-sichtbar]')).toHaveAttribute('data-item', 'holz');
  await press(page, 'Enter');
  await expect(page.getByTestId('herd-vorrat-0')).toHaveAttribute('data-item', 'holz');
  await expect(page.getByTestId('herd-vorrat-0').locator('.dh-slot__anzahl')).toHaveText('12');
  // Mouse: right click puts half of the charcoal in.
  await page.mouse.move(2, 2);
  await page.locator('[data-testid^="herd-tasche-"][data-item="holzkohle"]').click({ button: 'right' });
  await expect(page.getByTestId('herd-vorrat-1')).toHaveAttribute('data-item', 'holzkohle');
  await expect(page.getByTestId('herd-vorrat-stueck')).toHaveText('13/40 Stück');
  // What the hearth does not burn stays dim and is refused with a text.
  await expect(status).toHaveAttribute('data-ton', 'bereit');

  // Light it: 12 logs (1 h each) and a piece of charcoal (3 h) burn 15 game hours.
  await page.getByTestId('herd-schalter').click();
  await expect(status).toHaveAttribute('data-ton', 'brennt');
  await expect(status).toHaveAttribute('aria-label', /^Brennt noch 1[45] h/);
  await expect(page.getByTestId('herd-restzeit')).toHaveText(/^1[45] h( \d+ min)?$/);
  await expect(page.getByTestId('herd-schalter')).toHaveText('Löschen');
  await expect(page.getByTestId('herd-radius')).toHaveText('Schutzzone 12 Felder');
  await expect(page.getByTestId('herd-wiedereinstieg')).toHaveText('Am Herdfeuer erwachen');
  await expect(page.getByTestId('herd-vorrat-stueck')).toHaveText('12/40 Stück');
  // The glow bar stays wholly visible above "Löschen", its focus frame included, at both window sizes.
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await ticks(page, 2);
    const c = await glowClearance(page);
    expect(c.ring, `${size.width}: Fokusrahmen`).toBeGreaterThan(0);
    expect(c.barWidth, `${size.width}: Balken`).toBeGreaterThan(0);
    expect(c.gap, `${size.width}: Abstand ${c.gap} px, Rahmen ${c.ring} px`).toBeGreaterThanOrEqual(c.ring);
  }

  // The overview of the base lists the chest, shows its slots and searches them.
  await expect(page.getByTestId('herd-uebersicht')).toHaveAttribute('data-gezeigt', '');
  const row = page.getByTestId(`herd-kiste-${chest.id}`);
  await expect(row).toContainText('Vorrat');
  await expect(row).toContainText('1/16');
  await row.click();
  await expect(page.getByTestId('herd-kiste-inhalt')).toHaveAttribute('data-kiste', String(chest.id));
  await expect(page.getByTestId('herd-kiste-slot-0')).toHaveAttribute('data-item', 'stein');
  await page.getByTestId('herd-suche').fill('Stein');
  await expect(page.getByTestId(`herd-fund-${chest.id}-stein`)).toContainText('10× Stein');
  await expect(page.getByTestId('herd-kisten-zahl')).toHaveText('1 Fund');
  await page.getByTestId('herd-suche').fill('stone');
  await expect(page.getByTestId(`herd-fund-${chest.id}-stein`)).toBeVisible();
  await page.getByTestId('herd-suche').fill('Obsidian');
  await expect(page.getByTestId('herd-keine-funde')).toBeVisible();
  await page.getByTestId('herd-suche').press('Escape');
  await expect(page.getByTestId('herd-suche')).toHaveValue('');

  // A stack of the store back into the bags; put it out; Esc closes.
  await page.getByTestId('herd-vorrat-0').click();
  await expect(page.locator('[data-testid^="herd-tasche-"][data-item="holz"]')).toHaveCount(1);
  await page.getByTestId('herd-schalter').click();
  await expect(status).toHaveAttribute('data-ton', 'bereit');
  await expect(page.getByTestId('herd-uebersicht-aus')).toBeVisible();
  const closedBefore = await events(page, 'hearthOut');
  expect(closedBefore).toBeGreaterThan(0);
  await press(page, 'Escape');
  await expect(screen).toBeHidden();
  expect(errors).toEqual([]);
});

test('Wer weggeht, schließt den Bildschirm; was das Herdfeuer nicht brennt, lehnt es mit Grund ab', async ({ page }) => {
  const errors = collectConsole(page);
  await start(page, [
    ['herdfeuer', 1],
    ['stein', 4],
  ]);
  const hearth = await build(page, 'herdfeuer', 'hearthBuilt', HEARTH_SPOTS);
  await cmd(page, { type: 'player.teleport', x: (hearth.tx + 1.5) * TILE, y: (hearth.ty + 3.5) * TILE, layer: 0 });
  await ticks(page, 2);
  await cmd(page, { type: 'hearth.use', hearth: hearth.id });
  const screen = page.getByTestId('ui-herdfeuer');
  await expect(screen).toBeVisible();
  await page.mouse.move(2, 2);
  await page.locator('[data-testid^="herd-tasche-"][data-item="stein"]').click();
  await expect(page.getByTestId('herd-hinweis')).toHaveText(/Holzscheite und Holzkohle/);
  await expect(page.getByTestId('herd-vorrat-frei')).toHaveCount(6);
  await cmd(page, { type: 'player.teleport', x: (hearth.tx + 1.5) * TILE + 20 * TILE, y: (hearth.ty + 3.5) * TILE, layer: 0 });
  await expect(screen).toBeHidden();
  expect(errors).toEqual([]);
});
