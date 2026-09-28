/**
 * M4-30 in the browser: "bauen → speichern → neu laden ⇒ identischer Zustand" (MASTERPROMPT §28, §32 M4 "Save/Load
 * erhält alles"). On a free site near the start beach (found the way the build mode spec finds one – floor blueprints
 * over the footprint, counted, taken back) the player builds a small base with the game's commands: a wooden house
 * (walls, a door, a straw roof – an interior) with a named, labelled chest holding stones and twigs, a workbench with
 * orders at it in the crafting queue, a drying rack with a batch of fibres in progress, a lit hearth with logs in its
 * store, and a blueprint wall.
 *
 * - Time frozen, the state hash (`Simulation.hashState()`) is read; "Speichern" in the pause menu writes the world into
 *   IndexedDB (the game's own save path); the hash is unchanged by saving.
 * - The page reloads: a fresh session on the start beach, none of the base. `__dh.call('loadSave')` boots the page
 *   from the saved world (src/debug/saveLoad.ts – the world selection of the title screen arrives with M7-50): it
 *   starts at the tick of the save with exactly the saved state hash.
 * - Saved again right after loading, the slot holds the same snapshot (hash) and the same chunk records. Both dumps,
 *   loaded in Node like the reference saves (tools/save/fixture.ts), give the same facts of the base (`baseFacts`:
 *   parts, blueprint, chest, stations with batch and orders, hearth) and of its rooms (`roomFacts`), and the Node
 *   simulation has the browser's hash.
 * - Running on, the loaded game is the saved one: the house is an interior, the chest screen shows its stones, the
 *   hearth screen shows it burning, the orders at the workbench finish.
 * No console errors or warnings.
 */
import { expect, test, type Page } from '@playwright/test';
import { importWorld, parseWorldDumpText } from '../../src/save/dump';
import { MemorySaveStore } from '../../src/save/memoryStore';
import { loadWorld, MAIN_SLOT } from '../../src/save/world';
import { baseFacts, roomFacts, type BaseFacts, type RoomFacts } from '../../tools/save/fixture';
import { logicUrl } from './logik';

interface SimState {
  tick: number;
  player: { x: number; y: number; layer: number } | null;
  events: Record<string, number>;
}

interface Dh {
  ready: boolean;
  timeFrozen: boolean;
  state(): { sim: SimState };
  command(cmd: unknown): unknown;
  freezeTime(on: boolean): void;
  call(name: string, ...args: unknown[]): unknown;
}

interface StateHash {
  tick: number;
  hash: string;
}

interface Room {
  interior: boolean;
  size: number;
  type: string | null;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

const TILE = 16;
/** The base site: 11 × 6 tiles (layout in `buildBase`). */
const SITE_W = 11;
const SITE_H = 6;

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

function sim(page: Page): Promise<SimState> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim);
}

async function events(page: Page, type: string): Promise<number> {
  return (await sim(page)).events[type] ?? 0;
}

/** Waits until the simulation counted at least `more` events of `type` beyond `before`. */
async function waitEvents(page: Page, type: string, before: number, more = 1): Promise<void> {
  await page.waitForFunction(([t, n]) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events[t as string] ?? 0) >= (n as number), [type, before + more] as const, { timeout: 30_000 });
}

/** Waits a few ticks (commands of the last frame applied). */
async function ticks(page: Page, n = 2): Promise<void> {
  const t = (await sim(page)).tick;
  await page.waitForFunction((x) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick >= x, t + n);
}

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as { __dh: Dh }).__dh.call(n as string, ...(a as unknown[])), [name, args] as const) as Promise<T>;
}

/** Waits until the page booted: debug API ready, the game view shows the world, the player is there. */
async function booted(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
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
}

/** A free, buildable `w` × `h` site near the spawn: its north-west tile (the footprint laid as floor blueprints, counted, taken back). */
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

/** Gives `count` of `item` into an empty inventory (it lands in slot 0) and runs `use` on that slot's command. */
async function giveAndUse(page: Page, item: string, count: number, use: unknown, event: string): Promise<number> {
  const before = await events(page, event);
  await cmd(page, { type: 'inventory.give', item, count });
  await cmd(page, use);
  await waitEvents(page, event, before);
  return before + 1;
}

const INV0 = { bereich: 'inventar', index: 0 } as const;

/**
 * The base (tiles from the site's north-west corner): the house – walls 0–4 × 0–4, the door at 2,4, a straw roof over
 * it all – with the chest at 1,1; the workbench at 6,0 and the drying rack at 6,2 (2 × 1 each); the hearth at 8,0
 * (3 × 3); a blueprint wall at 9,5. The player ends at 7,1 between the benches, where the queue runs.
 */
async function buildBase(page: Page, x0: number, y0: number): Promise<{ chest: number; hearth: number; house: { tx: number; ty: number } }> {
  const at = (dx: number, dy: number) => ({ tx: x0 + dx, ty: y0 + dy });
  await teleport(page, x0 + 5, y0 + 5);
  await cmd(page, { type: 'inventory.give', item: 'wand_holz', count: 15 });
  await cmd(page, { type: 'inventory.give', item: 'tuer_holz', count: 1 });
  await cmd(page, { type: 'inventory.give', item: 'dach_stroh', count: 25 });
  const placed = await events(page, 'partPlaced');
  for (let dy = 0; dy <= 4; dy++) {
    for (let dx = 0; dx <= 4; dx++) {
      if (dx !== 0 && dx !== 4 && dy !== 0 && dy !== 4) continue;
      await cmd(page, { type: 'build.place', part: dx === 2 && dy === 4 ? 'tuer_holz' : 'wand_holz', ...at(dx, dy) });
    }
  }
  await waitEvents(page, 'partPlaced', placed, 16);
  for (let dy = 0; dy <= 4; dy++) for (let dx = 0; dx <= 4; dx++) await cmd(page, { type: 'build.place', part: 'dach_stroh', ...at(dx, dy) });
  await waitEvents(page, 'partPlaced', placed, 16 + 25);
  // Chest, hearth, blueprint (parts of the build grid); workbench and drying rack (stations).
  const chest = await giveAndUse(page, 'kiste_holz', 1, { type: 'build.place', part: 'kiste_holz', ...at(1, 1) }, 'chestPlaced');
  const hearth = await giveAndUse(page, 'herdfeuer', 1, { type: 'build.place', part: 'herdfeuer', ...at(8, 0) }, 'hearthBuilt');
  const blueprints = await events(page, 'partPlaced');
  await cmd(page, { type: 'build.blueprint', part: 'wand_holz', ...at(9, 5) });
  await waitEvents(page, 'partPlaced', blueprints);
  await giveAndUse(page, 'werkbank', 1, { type: 'station.place', from: INV0, ...at(6, 0) }, 'stationPlaced');
  const rack = await giveAndUse(page, 'trockengestell', 1, { type: 'station.place', from: INV0, ...at(6, 2) }, 'stationPlaced');
  // Fibres on the rack: a batch of straw bundles in progress.
  await teleport(page, x0 + 7, y0 + 1);
  await giveAndUse(page, 'fasern', 6, { type: 'station.put', station: rack, from: INV0, bereich: 'eingang', count: 6 }, 'stationLoaded');
  // Inside the house: stones and twigs into the chest, named and labelled.
  await teleport(page, x0 + 2, y0 + 2);
  await giveAndUse(page, 'stein', 20, { type: 'storage.put', chest, from: INV0 }, 'chestStored');
  await giveAndUse(page, 'zweig', 12, { type: 'storage.put', chest, from: INV0 }, 'chestStored');
  const renamed = await events(page, 'chestRenamed');
  await cmd(page, { type: 'storage.rename', chest, name: 'Vorrat' });
  await cmd(page, { type: 'storage.label', chest, item: 'stein' });
  await waitEvents(page, 'chestRenamed', renamed);
  // The hearth: logs in its store, lit.
  await teleport(page, x0 + 9, y0 + 3);
  await giveAndUse(page, 'holz', 4, { type: 'hearth.fuel', hearth, from: INV0, count: 4 }, 'hearthFueled');
  const lit = await events(page, 'hearthIgnited');
  await cmd(page, { type: 'hearth.ignite', hearth });
  await waitEvents(page, 'hearthIgnited', lit);
  // At the workbench: two palisade walls in progress there, two fibre ropes queued behind them.
  await teleport(page, x0 + 7, y0 + 1);
  await cmd(page, { type: 'inventory.give', item: 'holz', count: 6 });
  await cmd(page, { type: 'inventory.give', item: 'faserseil', count: 2 });
  await cmd(page, { type: 'inventory.give', item: 'fasern', count: 6 });
  await ticks(page, 3);
  const started = await events(page, 'craftQueued');
  await cmd(page, { type: 'craft.start', recipe: 'rezept_wand_palisade', count: 2 });
  await cmd(page, { type: 'craft.start', recipe: 'rezept_faserseil', count: 2 });
  await waitEvents(page, 'craftQueued', started, 2);
  return { chest, hearth, house: at(2, 2) };
}

/** Saves through the pause menu (Esc, "Speichern", the status line names day and time), then closes it. */
async function saveInPauseMenu(page: Page): Promise<void> {
  await press(page, 'Escape');
  await expect(page.getByTestId('ui-pause')).toBeVisible();
  await page.getByTestId('pause-speichern').click();
  await expect(page.getByTestId('pause-status')).toHaveText(/^Gespeichert: Tag \d+, \d\d:\d\d$/, { timeout: 30_000 });
  await press(page, 'Escape');
  await expect(page.getByTestId('ui-pause')).toBeHidden();
}

interface DumpFacts {
  readonly tick: number;
  readonly hash: string;
  readonly slotHash: string;
  readonly chunks: string[];
  readonly base: BaseFacts;
  readonly rooms: RoomFacts;
}

/** Loads a world dump in Node like the reference saves: tick, hash, slot, chunk records, facts of the base and (after one tick, once the chunks are resident) of its rooms. */
async function dumpFacts(text: string): Promise<DumpFacts> {
  const dump = parseWorldDumpText(text);
  const slot = dump.slots.find((s) => s.slot === MAIN_SLOT);
  if (slot === undefined) throw new Error('kein Hauptslot im Spielstand');
  const store = new MemorySaveStore();
  await importWorld(store, dump);
  const loaded = await loadWorld(store, dump.world.id);
  const facts = { tick: loaded.tick, hash: loaded.hashState(), slotHash: slot.hash, chunks: dump.chunks.map((c) => c.key), base: baseFacts(loaded) };
  loaded.step();
  return { ...facts, rooms: roomFacts(loaded) };
}

test('bauen → speichern (Pausemenü) → Seite neu laden → Spielstand laden ⇒ identischer Zustand, das Spiel läuft weiter', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectConsole(page);
  await page.goto(logicUrl('spieler=1'));
  await booted(page);
  const { x0, y0 } = await findSite(page, SITE_W, SITE_H);
  const base = await buildBase(page, x0, y0);

  // Frozen between two ticks: the state before the save.
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(true));
  const before = await call<StateHash>(page, 'stateHash');
  await saveInPauseMenu(page);
  expect(await call<StateHash>(page, 'stateHash')).toEqual(before);
  const saves = await call<Array<{ id: string; tick: number }>>(page, 'saves');
  expect(saves[0]?.tick).toBe(before.tick);
  const worldId = saves[0]?.id ?? '';
  const savedDump = await call<string>(page, 'exportSave', worldId);

  // A reload alone starts a new session on the start beach: none of the base.
  await page.reload();
  await booted(page);
  expect(await call<string | null>(page, 'loadedSave')).toBeNull();
  expect((await call<StateHash>(page, 'stateHash')).hash).not.toBe(before.hash);
  expect(await call<Room | null>(page, 'room', base.house.tx, base.house.ty)).toBeNull();

  // Loading the save: the page boots from it, frozen at the tick of the save, with the same state hash.
  expect(await call<string>(page, 'loadSave')).toBe(worldId);
  await page.waitForURL(/[?&]laden=/, { timeout: 30_000 });
  await booted(page);
  expect(await call<string | null>(page, 'loadedSave')).toBe(worldId);
  expect(await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.timeFrozen)).toBe(true);
  const after = await call<StateHash>(page, 'stateHash');
  expect(after).toEqual(before);

  // Saved again right after loading: the same snapshot and chunk records; in Node both give the same base and rooms.
  await saveInPauseMenu(page);
  expect(await call<StateHash>(page, 'stateHash')).toEqual(before);
  const resavedDump = await call<string>(page, 'exportSave', worldId);
  const saved = await dumpFacts(savedDump);
  const resaved = await dumpFacts(resavedDump);
  expect(saved.tick).toBe(before.tick);
  expect(saved.hash).toBe(before.hash);
  expect(resaved).toEqual(saved);
  // What the base holds is really in the save (a save that lost it would prove nothing).
  const b = saved.base;
  expect(b.parts.filter((p) => p.part === 'wand_holz' && !p.blueprint)).toHaveLength(15);
  expect(b.parts.filter((p) => p.part === 'dach_stroh')).toHaveLength(25);
  expect(b.parts.some((p) => p.part === 'tuer_holz' && !p.open)).toBe(true);
  expect(b.parts.filter((p) => p.blueprint)).toEqual([expect.objectContaining({ part: 'wand_holz', tx: x0 + 9, ty: y0 + 5 })]);
  expect(b.chests).toEqual([expect.objectContaining({ name: 'Vorrat', label: 'stein', slots: [expect.objectContaining({ item: 'stein', count: 20 }), expect.objectContaining({ item: 'zweig', count: 12 })] })]);
  expect(b.stations.some((s) => s.station === 'trockengestell' && s.recipe === 'rezept_strohbuendel' && s.input.length > 0)).toBe(true);
  expect(b.stationOrders.map((o) => o.recipe)).toEqual(expect.arrayContaining(['rezept_wand_palisade']));
  expect(b.hearths).toEqual([expect.objectContaining({ lit: true })]);
  expect(saved.rooms).toEqual([expect.objectContaining({ interior: true, size: 9 })]);

  // Running on: the house is the saved interior, the chest and the hearth show their state, the orders finish.
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(false));
  await ticks(page, 5);
  await page.waitForFunction(([tx, ty]) => ((window as unknown as { __dh: Dh }).__dh.call('room', tx, ty) as Room | null)?.interior === true, [base.house.tx, base.house.ty] as const);
  const room = await call<Room>(page, 'room', base.house.tx, base.house.ty);
  expect({ interior: room.interior, size: room.size, type: room.type }).toEqual({ interior: true, size: saved.rooms[0]?.size, type: saved.rooms[0]?.type });
  const done = await events(page, 'craftCompleted');
  await waitEvents(page, 'craftCompleted', done, 1);
  await teleport(page, base.house.tx, base.house.ty);
  await cmd(page, { type: 'storage.open', chest: base.chest });
  await expect(page.getByTestId('ui-kiste')).toBeVisible();
  await expect(page.getByTestId('kiste-name')).toHaveValue('Vorrat');
  await expect(page.locator('[data-testid^="kiste-slot-"][data-item="stein"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="kiste-slot-"][data-item="zweig"]')).toHaveCount(1);
  await press(page, 'Escape');
  await expect(page.getByTestId('ui-kiste')).toBeHidden();
  await teleport(page, x0 + 9, y0 + 3);
  await cmd(page, { type: 'hearth.use', hearth: base.hearth });
  await expect(page.getByTestId('ui-herdfeuer')).toBeVisible();
  await expect(page.getByTestId('herd-status')).toHaveAttribute('data-ton', 'brennt');
  await press(page, 'Escape');
  await page.screenshot({ path: 'shots/latest/e2e-basis-geladen.png' });
  expect(errors).toEqual([]);
});
