/**
 * M4-31 "Holzhaus" in the browser (MASTERPROMPT §16.4, §32 M4: "geschlossenes Holzhaus mit Dach (Dach blendet aus,
 * Raumtyp erkannt, innen nachts wärmer)"): on a free site near the start beach (found the way the build mode spec finds
 * one) the player builds a closed wooden house with the build mode (B) – plank walls dragged as lines, a door set into
 * the south wall, a wooden bed and a resin lamp inside, a straw roof dragged over it all – then lights the lamp.
 *
 * - Entering: the roof fades out completely (the build mode spec's probe `worldInfo.building.roofFade`: 1 = the roof's
 *   alpha is 0), from the frame the player stands inside; outside again it comes back.
 * - The room is an interior of the type Schlafraum (bed + light, src/content/roomTypes.ts) – read with the debug
 *   query `room` (src/debug/roomQuery.ts); the build mode's room overlay marks and labels it. At night, too: the lamp
 *   holds resin for 24 game hours.
 * - At 03:00 of a spring night the house is at least 6 °C warmer inside than the air outside (M4-16) – from its
 *   insulation alone (the lamp gives no heat); the player inside feels the room.
 * The pictures of a finished base inside and outside are the screenshot scenarios `basis-innen` and `basis-aussen`
 * (src/debug/basisScenarios.ts, `npm run shot`). No console errors or warnings.
 */
import { expect, test, type Page } from '@playwright/test';
import { renderedFrames } from './frames';
import { logicUrl } from './logik';

interface SimState {
  tick: number;
  time: string;
  player: { x: number; y: number; layer: number; feltC: number } | null;
  events: Record<string, number>;
  world: { temperatureC: number | null };
}

interface GhostInfo {
  active: boolean;
  piece: string | null;
  cursor: [number, number] | null;
  anchors: number;
  ok: number;
  reason: string | null;
}

interface BuildingInfo {
  roofs: number;
  roofFade: number;
  roofTiles: number;
  inside: boolean;
  ghost: GhostInfo;
  overlay: { kind: string | null; tiles: number; rooms: number; labels: number };
}

interface Room {
  interior: boolean;
  size: number;
  roofed: number;
  type: string | null;
  temperatureC: number;
  outsideC: number;
  sourcesC: number;
  insulation: number;
  lights: number;
  furniture: Record<string, number>;
  comfort: number;
}

interface Dh {
  ready: boolean;
  state(): { sim: SimState };
  command(cmd: unknown): unknown;
  call(name: string, ...args: unknown[]): unknown;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

const TILE = 16;
/** Resin lumps the lamp holds (4 × 6 game hours: lit in the morning, it burns through the night). */
const LAMP_LUMPS = 4;
/** M4-16: a wooden house at night is at least this much warmer inside than outside [°C]. */
const NIGHT_WARMER_C = 6;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

function frames(page: Page, n: number): Promise<void> {
  // Frames the renderer drew (tests/e2e/frames.ts), not animation frames of the page.
  return renderedFrames(page, n);
}

async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await frames(page, 2);
}

async function cmd(page: Page, c: unknown): Promise<void> {
  await page.evaluate((x) => (window as unknown as { __dh: Dh }).__dh.command(x), c);
}

function sim(page: Page): Promise<SimState> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim);
}

function building(page: Page): Promise<BuildingInfo> {
  return page.evaluate(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building);
}

function room(page: Page, tx: number, ty: number): Promise<Room | null> {
  return page.evaluate(([x, y]) => (window as unknown as { __dh: Dh }).__dh.call('room', x, y) as Room | null, [tx, ty] as const);
}

async function events(page: Page, type: string): Promise<number> {
  return (await sim(page)).events[type] ?? 0;
}

async function waitEvents(page: Page, type: string, before: number, more = 1): Promise<void> {
  await page.waitForFunction(([t, b]) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events[t as string] ?? 0) >= (b as number), [type, before + more] as const, { timeout: 30_000 });
}

async function ticks(page: Page, n = 2): Promise<void> {
  const t = (await sim(page)).tick;
  await page.waitForFunction((x) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick >= x, t + n, { timeout: 60_000 });
}

async function start(page: Page, items: ReadonlyArray<readonly [string, number]>): Promise<void> {
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  for (const [item, count] of items) await cmd(page, { type: 'inventory.give', item, count });
  await page.mouse.move(1, 1);
}

async function teleport(page: Page, tx: number, ty: number): Promise<void> {
  await cmd(page, { type: 'player.teleport', x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, layer: 0 });
  await page.waitForFunction(
    ([x, y]) => {
      const pl = (window as unknown as { __dh: Dh }).__dh.state().sim.player;
      return pl !== null && Math.floor(pl.x / 16) === x && Math.floor(pl.y / 16) === y;
    },
    [tx, ty] as const,
  );
  await frames(page, 4);
}

/** A free, buildable `w` × `h` site near the spawn: its north-west tile (floor blueprints over the footprint, counted, taken back). */
async function findSite(page: Page, w: number, h: number): Promise<{ x0: number; y0: number }> {
  const p = (await sim(page)).player;
  if (p === null) throw new Error('kein Spieler');
  const sx = Math.floor(p.x / TILE);
  const sy = Math.floor(p.y / TILE);
  const offsets: Array<[number, number]> = [[0, 0]];
  for (let r = 3; r <= 24; r += 3) for (let dy = -r; dy <= r; dy += 3) for (let dx = -r; dx <= r; dx += 3) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) offsets.push([dx, dy]);
  for (const [dx, dy] of offsets) {
    const x0 = sx + dx - Math.floor(w / 2);
    const y0 = sy + dy - Math.floor(h / 2);
    await teleport(page, sx + dx, sy + dy);
    const before = await events(page, 'partPlaced');
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) await cmd(page, { type: 'build.blueprint', part: 'boden_holz', tx: x, ty: y });
    await ticks(page, 3);
    const placed = (await events(page, 'partPlaced')) - before;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) await cmd(page, { type: 'build.remove', tx: x, ty: y, ebene: 'boden' });
    await ticks(page, 3);
    if (placed === w * h) return { x0, y0 };
  }
  throw new Error(`kein freier Bauplatz ${w} × ${h} um den Startstrand`);
}

/** The CSS point of the middle of tile (tx, ty) under the current camera. */
async function tilePoint(page: Page, tx: number, ty: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([x, y]) => {
      const dh = (window as unknown as { __dh: Dh }).__dh;
      const view = dh.call('worldInfo') as { camera: [number, number] };
      const vp = (dh.call('renderInfo') as { viewport: { internalWidth: number; internalHeight: number; outX: number; outY: number; outWidth: number; outHeight: number } }).viewport;
      const c = (document.getElementById('dh-canvas') as HTMLCanvasElement).getBoundingClientRect();
      const dpr = window.devicePixelRatio;
      const ix = (x as number) * 16 + 8 - view.camera[0] + vp.internalWidth / 2;
      const iy = (y as number) * 16 + 8 - view.camera[1] + vp.internalHeight / 2;
      return { x: c.left + (vp.outX + (ix * vp.outWidth) / vp.internalWidth) / dpr, y: c.top + (vp.outY + (iy * vp.outHeight) / vp.internalHeight) / dpr };
    },
    [tx, ty] as const,
  );
}

/** Moves the pointer over tile (tx, ty) and waits until the ghost's cursor is there. */
async function pointAt(page: Page, tx: number, ty: number): Promise<GhostInfo> {
  const pt = await tilePoint(page, tx, ty);
  await page.mouse.move(pt.x, pt.y);
  await page.waitForFunction(
    ([x, y]) => {
      const g = ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building.ghost;
      return g.cursor !== null && g.cursor[0] === x && g.cursor[1] === y;
    },
    [tx, ty] as const,
  );
  await frames(page, 2);
  return (await building(page)).ghost;
}

/** Chooses piece `id` in category `kategorie` of the build panel. */
async function choose(page: Page, kategorie: string, id: string): Promise<void> {
  await page.getByTestId(`bau-kategorie-${kategorie}`).click();
  await page.getByTestId(`bau-teil-${id}`).click();
  await expect(page.getByTestId(`bau-teil-${id}`)).toHaveAttribute('aria-pressed', 'true');
  await page.waitForFunction((p) => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building.ghost.piece === p, id);
}

/** Drags the chosen piece from tile a to tile b (a line of walls, a filled area of roof): all `n` anchors green, placed. */
async function drag(page: Page, a: readonly [number, number], b: readonly [number, number], n: number): Promise<void> {
  const before = await events(page, 'partPlaced');
  await pointAt(page, a[0], a[1]);
  await page.mouse.down();
  await frames(page, 2);
  await pointAt(page, b[0], b[1]);
  await page.waitForFunction((k) => {
    const g = ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building.ghost;
    return g.anchors === k && g.ok === k;
  }, n);
  await page.mouse.up();
  await waitEvents(page, 'partPlaced', before, n);
}

/** Clicks the chosen piece onto tile (tx, ty) (the ghost green there) and waits until it is placed. */
async function click(page: Page, tx: number, ty: number): Promise<void> {
  const g = await pointAt(page, tx, ty);
  expect(g, `${g.piece ?? '?'} auf ${tx},${ty}`).toMatchObject({ anchors: 1, ok: 1, reason: null });
  const before = await events(page, 'partPlaced');
  await page.mouse.down();
  await page.mouse.up();
  await waitEvents(page, 'partPlaced', before);
}

test('Holzhaus: im Baumodus gebaut – beim Betreten blendet das Dach ganz aus, Raumtyp Schlafraum, nachts innen ≥ 6 °C wärmer', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectConsole(page);
  await start(page, [
    ['wand_holz', 15],
    ['tuer_holz', 1],
    ['dach_stroh', 25],
    ['holzbett', 1],
    ['harzlampe', 1],
  ]);
  // The house (5 × 5, walls around a 3 × 3 room) on a 7 × 8 site; the player builds from south of the door.
  const site = await findSite(page, 7, 8);
  const x0 = site.x0 + 1;
  const y0 = site.y0 + 1;
  const inside = { tx: x0 + 2, ty: y0 + 2 };
  await teleport(page, x0 + 2, y0 + 6);
  await press(page, 'KeyB');
  await expect(page.getByTestId('baumodus')).toBeVisible();

  // Walls as lines: north, west, east; the south wall beside the door by clicks; the door into the gap.
  await choose(page, 'waende', 'wand_holz');
  await drag(page, [x0, y0], [x0 + 4, y0], 5);
  await drag(page, [x0, y0 + 1], [x0, y0 + 4], 4);
  await drag(page, [x0 + 4, y0 + 1], [x0 + 4, y0 + 4], 4);
  await click(page, x0 + 1, y0 + 4);
  await click(page, x0 + 3, y0 + 4);
  await choose(page, 'tueren', 'tuer_holz');
  await click(page, x0 + 2, y0 + 4);
  // A bed (1 × 2) along the west wall and a resin lamp in the north-east corner.
  await choose(page, 'moebel', 'holzbett');
  await click(page, x0 + 1, y0 + 1);
  const lamps = await events(page, 'lightPlaced');
  await choose(page, 'licht', 'harzlampe');
  await click(page, x0 + 3, y0 + 1);
  await waitEvents(page, 'lightPlaced', lamps);
  // The straw roof dragged over the whole house (a filled area).
  await choose(page, 'daecher', 'dach_stroh');
  await drag(page, [x0, y0], [x0 + 4, y0 + 4], 25);
  await expect(page.getByTestId('bau-vorrat')).toHaveText('Keins dabei');

  // The build mode's room overlay marks the house and labels it.
  await page.getByTestId('bau-overlay-raeume').click();
  await page.waitForFunction(() => {
    const o = ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building.overlay;
    return o.kind === 'raeume' && o.rooms >= 1 && o.tiles >= 9 && o.labels >= 1;
  });
  await page.getByTestId('bau-overlay-raeume').click();
  await press(page, 'Escape');
  await expect(page.getByTestId('baumodus')).toBeHidden();

  // Outside the roof is drawn; entering, it fades out completely (alpha 0) – sampled every frame from the step inside.
  let b = await building(page);
  expect(b.inside).toBe(false);
  expect(b.roofFade).toBe(0);
  expect(b.roofs).toBe(25);
  const fades = await page.evaluate(
    ([x, y]) =>
      new Promise<number[]>((resolve, reject) => {
        const dh = (window as unknown as { __dh: Dh }).__dh;
        // The frame before the step: the roof is drawn.
        const seen: number[] = [(dh.call('worldInfo') as { building: BuildingInfo }).building.roofFade];
        const until = performance.now() + 20_000;
        dh.command({ type: 'player.teleport', x: (x as number) * 16 + 8, y: (y as number) * 16 + 8, layer: 0 });
        const step = (): void => {
          const bi = (dh.call('worldInfo') as { building: BuildingInfo }).building;
          seen.push(bi.roofFade);
          if (bi.inside && bi.roofFade === 1) resolve(seen);
          else if (performance.now() > until) reject(new Error(`Dach blendet nicht aus: ${seen.join(', ')}`));
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    [inside.tx, inside.ty] as const,
  );
  // From drawn to gone, never back (the fade takes 0,3 s of presentation time, tests/unit/render/dach-innenraum.test.ts).
  expect(fades[0]).toBe(0);
  expect(fades[fades.length - 1]).toBe(1);
  for (let i = 1; i < fades.length; i++) expect(fades[i], fades.join(', ')).toBeGreaterThanOrEqual(fades[i - 1] as number);
  b = await building(page);
  expect(b.roofTiles).toBe(25);

  // Inside, next to it, the lamp is filled with resin – four lumps, 6 game hours each: it still burns in the night (a lamp
  // counts as the room's light only while it burns) – and lit.
  const lamp = lamps + 1;
  const fueled = await events(page, 'fireFueled');
  await cmd(page, { type: 'inventory.give', item: 'harz', count: LAMP_LUMPS });
  await ticks(page, 2);
  await cmd(page, { type: 'light.fuel', light: lamp, from: { bereich: 'inventar', index: 0 }, count: LAMP_LUMPS });
  await waitEvents(page, 'fireFueled', fueled);
  const lit = await events(page, 'lightIgnited');
  await cmd(page, { type: 'light.ignite', tx: x0 + 3, ty: y0 + 1 });
  await waitEvents(page, 'lightIgnited', lit);
  await frames(page, 10);
  await page.screenshot({ path: 'shots/latest/e2e-holzhaus-innen.png' });

  // The room: an interior of the type Schlafraum – the bed and the burning lamp.
  let r = await room(page, inside.tx, inside.ty);
  expect(r).toMatchObject({ interior: true, size: 9, roofed: 9, type: 'schlafraum' });
  expect(r?.furniture['bett']).toBe(1);
  expect(r?.lights).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.call('room'))).toEqual(r);

  // A spring night at 03:00 (the next one): inside at least 6 °C warmer than the air outside, by insulation alone.
  const day = (await sim(page)).tick;
  await cmd(page, { type: 'setTime', hour: 3, minute: 0 });
  await page.waitForFunction((t) => {
    const s = (window as unknown as { __dh: Dh }).__dh.state().sim;
    return s.tick > t && s.time.startsWith('03:');
  }, day);
  // The temperature field takes the new hour with the next world tick (1 Hz).
  await ticks(page, 70);
  r = await room(page, inside.tx, inside.ty);
  if (r === null) throw new Error('kein Raum nach dem Zeitsprung');
  const outside = (await sim(page)).world.temperatureC;
  console.log(`Holzhaus 03:00: außen ${r.outsideC.toFixed(2)} °C (Feld am Spieler ${String(outside)}), innen ${r.temperatureC.toFixed(2)} °C, Dämmung ${r.insulation.toFixed(3)}, Quellen ${r.sourcesC} °C`);
  expect((await sim(page)).time.startsWith('03:')).toBe(true);
  expect(r.type).toBe('schlafraum');
  expect(r.lights).toBeGreaterThanOrEqual(1);
  expect(r.sourcesC).toBe(0);
  expect(r.temperatureC - r.outsideC).toBeGreaterThanOrEqual(NIGHT_WARMER_C);
  expect(r.outsideC).toBeCloseTo(outside ?? Number.NaN, 0);

  // Outside again the roof comes back.
  await teleport(page, x0 + 2, y0 + 6);
  await page.waitForFunction(() => {
    const bi = ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { building: BuildingInfo }).building;
    return !bi.inside && bi.roofFade === 0;
  });
  await page.screenshot({ path: 'shots/latest/e2e-holzhaus-aussen.png' });
  expect(errors).toEqual([]);
});
