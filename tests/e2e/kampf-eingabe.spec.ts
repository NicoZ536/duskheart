/**
 * M6-02/M6-03 in the browser (MASTERPROMPT §2.7 "Eingaben wirken im nächsten Frame", §19.1; docs/SPIEL.md §10 "Die
 * Eingabe wirkt im nächsten Tick (kein Puffer über Frames)"): the combat buttons act in the very first simulation tick
 * after the frame that read them –
 * - Space rolls (`playerRolled`, the roll's state from that tick; its 0,25 s of invulnerability start with it),
 * - the primary button with the empty hand winds up a blow of the fist (`attackWindup` in that tick, `combat.attack`
 *   through the session's hand probe instead of `player.useItem`); held, it charges without striking and the blow
 *   lands on the release (press and release reach the simulation as two commands),
 * - the block button raises the guard in that tick – the parry window counts from it; visible as the slower walk of a
 *   blocking player (`BALANCE.combat.block.moveFactor`) in the first tick, together with D.
 * Parry and hitstop against a creature follow with the creatures in the browser (M6-35 `spawn`, M6-37).
 *
 * Method: the simulation is frozen while the input goes down (the frame turns it into queued commands, the tick does not
 * move), then it runs at a twentieth of the speed – at most one tick per frame – and the state is read in the frame whose
 * tick count first moved: exactly one tick ran, the one that applied the input.
 */
import { expect, test, type Page } from '@playwright/test';
import { renderedFrames } from './frames';
import { logicUrl } from './logik';

interface PlayerState {
  x: number;
  y: number;
  state: string;
  stateSince: number;
  vx: number;
  vy: number;
}

interface SimState {
  tick: number;
  queuedCommands: number;
  player: PlayerState | null;
  events: Record<string, number>;
}

interface Dh {
  ready: boolean;
  state(): { sim: SimState };
  freezeTime(on: boolean): void;
  setSpeed(factor: number): void;
  call(name: string, ...args: unknown[]): unknown;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

/** Walking speed [px/s] (4,5 tiles/s, 16 px per tile) and the share a raised guard leaves (`BALANCE`). */
const WALK_PX = 4.5 * 16;
const BLOCK_WALK = 0.6;
/** A twentieth of the speed: one tick every ≈ 20 animation frames – never two between two reads. */
const CRAWL = 0.05;
/**
 * Ticks the primary button stays down: past the fist's windup (0,35 × 0,4 s ≈ 8 ticks) and the heavy hold (0,4 s = 24
 * ticks from the press), with room to spare (`BALANCE.combat.attack`, `.fist`).
 */
const HOLD_TICKS = 45;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function openGame(page: Page): Promise<void> {
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
}

function sim(page: Page): Promise<SimState> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim);
}

/**
 * Freezes the simulation, lets `input` go down, checks that the frames only queued it, and returns the state right after
 * the first tick that followed (and the state while frozen).
 */
async function firstTickAfter(page: Page, input: () => Promise<void>): Promise<{ before: SimState; after: SimState }> {
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(true));
  const before = await sim(page);
  await input();
  await renderedFrames(page, 2);
  const queued = await sim(page);
  expect(queued.tick).toBe(before.tick);
  expect(queued.queuedCommands).toBeGreaterThanOrEqual(1);
  const after = (await page.evaluate(
    ([crawl, tick]) =>
      new Promise<SimState>((resolve) => {
        const dh = (window as unknown as { __dh: Dh }).__dh;
        dh.setSpeed(crawl);
        dh.freezeTime(false);
        const check = (): void => {
          const s = dh.state().sim;
          if (s.tick === tick) {
            requestAnimationFrame(check);
            return;
          }
          dh.freezeTime(true);
          dh.setSpeed(1);
          resolve(s);
        };
        requestAnimationFrame(check);
      }),
    [CRAWL, before.tick] as const,
  )) as SimState;
  expect(after.tick).toBe(before.tick + 1);
  return { before, after };
}

async function resume(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(false));
}

test('Rolle, Schlag und Block wirken im ersten Tick nach dem Frame, der sie las', async ({ page }) => {
  test.setTimeout(180_000);
  const msgs = collectConsole(page);
  await openGame(page);
  // The cursor over the picture, beside the figure (the aim of the blow).
  await page.mouse.move(700, 360);

  // Space: the roll starts in the first tick.
  const roll = await firstTickAfter(page, () => page.keyboard.down('Space'));
  expect(roll.after.events['playerRolled']).toBe((roll.before.events['playerRolled'] ?? 0) + 1);
  expect(roll.after.player?.state).toBe('roll');
  expect(roll.after.player?.stateSince).toBe(roll.before.tick);
  await page.keyboard.up('Space');
  await resume(page);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player?.state === 'idle', undefined, { timeout: 30_000 });

  // The primary button with the empty hand: the fist winds up in the first tick (combat.attack, not player.useItem).
  const blow = await firstTickAfter(page, () => page.mouse.down({ button: 'left' }));
  const windups = blow.before.events['attackWindup'] ?? 0;
  const strikes = blow.before.events['attackStarted'] ?? 0;
  expect(blow.after.events['attackWindup']).toBe(windups + 1);
  expect(blow.after.events['commandRejected'] ?? 0).toBe(blow.before.events['commandRejected'] ?? 0);
  // Held past the windup the fist charges (a second, heavy windup) and does not strike while the button stays down –
  // the simulation measures the hold (press and release are separate commands).
  await resume(page);
  await page.waitForFunction((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick > t, blow.after.tick + HOLD_TICKS, { timeout: 30_000 });
  const held = await sim(page);
  expect(held.events['attackWindup']).toBe(windups + 2);
  expect(held.events['attackStarted'] ?? 0).toBe(strikes);
  // Let go: the heavy blow lands.
  await page.mouse.up({ button: 'left' });
  await page.waitForFunction((n) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['attackStarted'] ?? 0) === n + 1, strikes, { timeout: 30_000 });
  const released = await sim(page);
  await page.waitForFunction((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick > t + 60, released.tick, { timeout: 30_000 });

  // The block button with D: the guard is up in the first tick – the player walks at the blocking pace from that tick on.
  const guard = await firstTickAfter(page, async () => {
    await page.mouse.down({ button: 'right' });
    await page.keyboard.down('KeyD');
  });
  expect(guard.after.player?.state).toBe('walk');
  expect(guard.after.player?.stateSince).toBe(guard.before.tick);
  expect(guard.after.player?.vx).toBeCloseTo(WALK_PX * BLOCK_WALK, 0);
  // Letting go of the block: full pace again in the first tick.
  const free = await firstTickAfter(page, () => page.mouse.up({ button: 'right' }));
  expect(free.after.player?.vx).toBeCloseTo(WALK_PX, 0);
  await page.keyboard.up('KeyD');
  await resume(page);
  expect(msgs).toEqual([]);
});
