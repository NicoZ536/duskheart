/**
 * M6-37/M6-39 in the browser (MASTERPROMPT §2.7 "Eingaben wirken im nächsten Frame", §19.1 "Parade: Block in den letzten
 * 0,15 s vor dem Treffer … Hitstop"; docs/SPIEL.md §10 "Die Eingabe wirkt im nächsten Tick"): against a real wolf of the
 * content, in the evening twilight of the boot world, with a wooden club in the hand and no god mode –
 * - **parry in the 9-tick window:** the block button goes down in the frame after the tick 9 ticks before the wolf's blow
 *   (read from the wolf's own attack clock, `attackEndTick`): the guard is up from the next tick and the bite is parried
 *   (`parried`, no damage); a block begun one tick earlier (10 ticks) only blocks (`blocked`, no parry);
 * - **hitstop measured:** the staggered, parry-marked wolf takes the club's blow; from the tick after the hit it stands still
 *   for exactly its `hitstopTicks` (2–6 by the club's impact) – position unchanged tick by tick –, then the knockback moves it;
 * - **roll:** Space in the frame after the tick 5 ticks before a bite starts the roll in the next tick (`playerRolled`,
 *   `stateSince`), its 0,25 s of invulnerability (and the three tiles it carries the player) take the bite – no damage.
 * Every input acts in the first tick after the frame that read it: at most one rendered frame plus the tick it lands in.
 *
 * Method (as in kampf-eingabe.spec.ts): the simulation is frozen while an input goes down; within the next frame the renderer
 * draws (`renderedFrames`, tests/e2e/frames.ts) the input is read – one more command waits in the queue, the tick has not
 * moved –; then the simulation runs at a twentieth of the speed – at most one tick per frame – and stops at the tick it was
 * asked for: the first tick after the frame applied the input. The wolf is found with the inspector
 * (`inspectAt` over the canvas) and read with `inspectEntity`: its `creature` component (attack phase and clock, hitstop,
 * stagger) and its `position` – as the simulation holds them.
 */
import { expect, test, type Page } from '@playwright/test';
import { renderedFrames } from './frames';
import { logicUrl } from './logik';

interface PlayerState {
  x: number;
  y: number;
  state: string;
  stateSince: number;
  health: number;
}
interface SimState {
  tick: number;
  queuedCommands: number;
  player: PlayerState | null;
  events: Record<string, number>;
}
interface Inspected {
  entity: number;
  components: { name: string; fields: [string, string][] }[];
}
interface Dh {
  ready: boolean;
  exec(line: string): string;
  command(raw: unknown): unknown;
  state(): { sim: SimState };
  freezeTime(on: boolean): void;
  setSpeed(factor: number): void;
  call(name: string, ...args: unknown[]): unknown;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

/** A twentieth of the speed: one tick every ≈ 20 animation frames – never two between two reads. */
const CRAWL = 0.05;
/** The parry window [ticks] (§19.1: 0,15 s; `BALANCE.combat.parry.windowSeconds`). */
const PARRY_TICKS = 9;
/** Hitstop of a blow by impact [ticks] (§19.1 "Hitstop 2–6 Frames je Wucht"). */
const HITSTOP_MIN = 2;
const HITSTOP_MAX = 6;
/** How long a wind-up may take to come [ms of the page]. */
const WAIT_MS = 90_000;
/** Index of the wolf's bite among its attacks (content: `biss`, then `sprung`). */
const BITE = 0;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

function sim(page: Page): Promise<SimState> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim);
}

function command(page: Page, raw: unknown): Promise<unknown> {
  return page.evaluate((c) => (window as unknown as { __dh: Dh }).__dh.command(c), raw);
}

/** The wolf's `creature` and `position` fields as the inspector prints them (numbers as text). */
async function wolf(page: Page, entity: number): Promise<Record<string, string>> {
  const info = (await page.evaluate((e) => (window as unknown as { __dh: Dh }).__dh.call('inspectEntity', e), entity)) as Inspected | null;
  if (info === null) throw new Error(`Wolf ${entity} lebt nicht mehr`);
  const out: Record<string, string> = {};
  for (const c of info.components) if (c.name === 'creature' || c.name === 'position') for (const [k, v] of c.fields) out[c.name === 'position' ? `pos.${k}` : k] = v;
  return out;
}

/** Runs the simulation at crawl speed until its tick counter reads `target`, then freezes it there. */
async function runTo(page: Page, target: number): Promise<SimState> {
  const s = (await page.evaluate(
    ([crawl, t]) =>
      new Promise<SimState>((resolve) => {
        const dh = (window as unknown as { __dh: Dh }).__dh;
        if (dh.state().sim.tick >= t) {
          resolve(dh.state().sim);
          return;
        }
        dh.setSpeed(crawl);
        dh.freezeTime(false);
        const check = (): void => {
          const now = dh.state().sim;
          if (now.tick < t) {
            requestAnimationFrame(check);
            return;
          }
          dh.freezeTime(true);
          dh.setSpeed(1);
          resolve(now);
        };
        requestAnimationFrame(check);
      }),
    [CRAWL, target] as const,
  )) as SimState;
  expect(s.tick, 'die Simulation hält genau am verlangten Tick').toBe(target);
  return s;
}

/**
 * Lets the world run at full speed until the wolf winds up (its attack phase `ausholen`), freezes it in that frame and
 * returns the tick its blow lands in (`attackEndTick`) and the attack.
 */
async function nextWindup(page: Page, entity: number): Promise<{ blow: number; tick: number; attack: string }> {
  const r = (await page.evaluate(
    ([e, ms, bite]) =>
      new Promise<{ blow: number; tick: number; attack: string } | null>((resolve) => {
        const dh = (window as unknown as { __dh: Dh }).__dh;
        const started = performance.now();
        dh.setSpeed(1);
        dh.freezeTime(false);
        const check = (): void => {
          const info = dh.call('inspectEntity', e) as Inspected | null;
          const fields = Object.fromEntries(info?.components.find((c) => c.name === 'creature')?.fields ?? []);
          // The bite (the wolf's first attack): its leap may fall short of a player who does not move.
          if (fields['attackPhase'] === 'ausholen' && fields['attack'] === bite) {
            dh.freezeTime(true);
            resolve({ blow: Number(fields['attackEndTick']), tick: dh.state().sim.tick, attack: fields['attack'] ?? '' });
            return;
          }
          if (info === null || performance.now() - started > ms) {
            dh.freezeTime(true);
            resolve(null);
            return;
          }
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
    [entity, WAIT_MS, String(BITE)] as const,
  )) as { blow: number; tick: number; attack: string } | null;
  if (r === null) throw new Error('der Wolf holte nicht aus');
  return r;
}

/** Finds the wolf with the inspector: the canvas point whose pick is a creature `wolf` (the inspector panel closes again). */
async function findWolf(page: Page): Promise<number> {
  const e = await page.evaluate(() => {
    const dh = (window as unknown as { __dh: Dh }).__dh;
    for (let dy = -240; dy <= 240; dy += 16) {
      for (let dx = -300; dx <= 300; dx += 16) {
        const info = dh.call('inspectAt', 640 + dx, 360 + dy) as Inspected | null;
        const c = info?.components.find((x) => x.name === 'creature');
        if (info !== null && info !== undefined && c?.fields.some(([k, v]) => k === 'creature' && v === 'wolf') === true) {
          dh.call('inspectEntity', null);
          return info.entity;
        }
      }
    }
    dh.call('inspectEntity', null);
    return null;
  });
  if (e === null) throw new Error('kein Wolf im Bild');
  return e;
}

/**
 * Lets `input` go down while the simulation stands still and checks that it was read within one rendered frame: one more
 * command waits in the queue, the tick has not moved (nothing ran on it yet). Returns the state at that frame.
 */
async function readInOneFrame(page: Page, input: () => Promise<void>): Promise<SimState> {
  const before = await sim(page);
  await input();
  await renderedFrames(page, 1);
  const read = await sim(page);
  expect(read.tick, 'eingefroren: kein Tick lief').toBe(before.tick);
  expect(read.queuedCommands, 'die Eingabe ist nach einem gezeichneten Frame als Befehl eingereiht').toBeGreaterThan(before.queuedCommands);
  return read;
}

/** Sets the aim onto the wolf (its world position) – the guard covers the half circle in front (§19.1). */
async function aimAt(page: Page, entity: number): Promise<void> {
  const w = await wolf(page, entity);
  await command(page, { type: 'player.aim', x: Math.round(Number(w['pos.x'])), y: Math.round(Number(w['pos.y'])) });
}

test('Parade im 9-Tick-Fenster, Hitstop gemessen, Rolle – gegen einen Wolf, jede Eingabe im ersten Tick', async ({ page }) => {
  test.setTimeout(420_000);
  const msgs = collectConsole(page);
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  // The cursor north of the figure (the wolf comes from there); it stays put, the aim follows the wolf by command.
  await page.mouse.move(640, 250);
  // Evening twilight (wolves hunt), a wooden club in the hand.
  const t0 = (await sim(page)).tick;
  expect(await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.exec('time 19:00'))).toBe('Die Zeit springt vorwärts auf 19:00.');
  await page.waitForFunction((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick > t + 30, t0);
  await command(page, { type: 'inventory.give', item: 'holzkeule', count: 1 });
  await command(page, { type: 'player.selectHotbar', index: 0 });
  // The wolf two and a half tiles north of the player: a new creature faces south, it sees the player at once.
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(true));
  const start = await sim(page);
  const p = start.player;
  if (p === null) throw new Error('kein Spieler');
  await command(page, { type: 'creature.spawn', creature: 'wolf', count: 1, x: p.x, y: p.y - 40, layer: 0 });
  await runTo(page, start.tick + 2);
  expect((await sim(page)).events['creatureSpawned'] ?? 0).toBeGreaterThan(start.events['creatureSpawned'] ?? 0);
  const e = await findWolf(page);

  // --- Parry at the edge of the window: the guard up from the tick 9 before the blow. ---------------------------------
  let w = await nextWindup(page, e);
  expect(w.blow - w.tick).toBeGreaterThan(PARRY_TICKS + 1);
  await runTo(page, w.blow - PARRY_TICKS);
  await aimAt(page, e);
  const before = await sim(page);
  await readInOneFrame(page, () => page.mouse.down({ button: 'right' }));
  const guard = await runTo(page, before.tick + 1);
  // Nothing was hit yet; the parry needs the guard from this very tick.
  expect(guard.events['parried'] ?? 0).toBe(before.events['parried'] ?? 0);
  const landed = await runTo(page, w.blow + 1);
  expect(landed.events['parried'], 'Parade: Block 9 Ticks vor dem Biss').toBe((before.events['parried'] ?? 0) + 1);
  expect(landed.player?.health, 'die Parade nimmt keinen Schaden').toBe(before.player?.health);
  test.info().annotations.push({ type: 'parade', description: `Block ab Tick ${before.tick}, Biss in Tick ${w.blow}: ${w.blow - before.tick} Ticks – pariert` });
  await page.mouse.up({ button: 'right' });
  const staggered = await wolf(page, e);
  expect(Number(staggered['staggerUntilTick'])).toBeGreaterThan(landed.tick);

  // --- Hitstop: the club on the staggered, marked wolf; the wolf stands still for its hitstop ticks. -------------------
  await aimAt(page, e);
  const strike = await sim(page);
  await readInOneFrame(page, () => page.mouse.down({ button: 'left' }));
  const pressed = await runTo(page, strike.tick + 1);
  expect(pressed.events['attackWindup'], 'der Schlag holt im ersten Tick aus').toBe((strike.events['attackWindup'] ?? 0) + 1);
  await page.mouse.up({ button: 'left' });
  let hit = pressed;
  for (let i = 0; i < 60 && (hit.events['hitLanded'] ?? 0) === (strike.events['hitLanded'] ?? 0); i++) hit = await runTo(page, hit.tick + 1);
  expect(hit.events['hitLanded'] ?? 0).toBe((strike.events['hitLanded'] ?? 0) + 1);
  const struck = await wolf(page, e);
  const from = Number(struck['hitstopFromTick']);
  const stop = Number(struck['hitstopTicks']);
  expect(from).toBe(hit.tick - 1);
  expect(stop).toBeGreaterThanOrEqual(HITSTOP_MIN);
  expect(stop).toBeLessThanOrEqual(HITSTOP_MAX);
  // Tick by tick: the body does not move from the tick after the hit until its hitstop ends, then the knockback moves it.
  let still = 0;
  let last = `${struck['pos.x']},${struck['pos.y']}`;
  for (let t = hit.tick + 1; t <= hit.tick + stop + 1; t++) {
    await runTo(page, t);
    const now = await wolf(page, e);
    const here = `${now['pos.x']},${now['pos.y']}`;
    if (here !== last) break;
    still++;
    last = here;
  }
  expect(still, 'gemessene Hitstop-Ticks im Browser').toBe(stop);
  test.info().annotations.push({ type: 'hitstop', description: `${still} Ticks Stillstand nach dem Treffer (Wucht der Holzkeule)` });

  // --- Roll: Space 5 ticks before a bite – the roll starts in the next tick and takes the bite. --------------------------
  w = await nextWindup(page, e);
  await runTo(page, w.blow - 5);
  const rollBefore = await sim(page);
  await readInOneFrame(page, () => page.keyboard.down('Space'));
  const rolled = await runTo(page, rollBefore.tick + 1);
  expect(rolled.events['playerRolled'], 'die Rolle beginnt im ersten Tick').toBe((rollBefore.events['playerRolled'] ?? 0) + 1);
  expect(rolled.player?.state).toBe('roll');
  expect(rolled.player?.stateSince).toBe(rollBefore.tick);
  await page.keyboard.up('Space');
  const dodged = await runTo(page, w.blow + 1);
  expect(dodged.player?.health, 'die Rolle nimmt den Biss').toBe(rollBefore.player?.health);

  // --- One tick too early: a guard begun 10 ticks before the blow blocks, it does not parry. ---------------------------
  w = await nextWindup(page, e);
  await runTo(page, w.blow - PARRY_TICKS - 1);
  await aimAt(page, e);
  const early = await sim(page);
  await readInOneFrame(page, () => page.mouse.down({ button: 'right' }));
  const after = await runTo(page, w.blow + 1);
  expect(after.events['parried'] ?? 0, 'kein Parieren nach 10 Ticks').toBe(early.events['parried'] ?? 0);
  expect(after.events['blocked'] ?? 0, 'der Block fängt ihn').toBe((early.events['blocked'] ?? 0) + 1);
  await page.mouse.up({ button: 'right' });
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(false));
  expect(msgs).toEqual([]);
});
