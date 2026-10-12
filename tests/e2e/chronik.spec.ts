/**
 * M7-41 Die Chronik im Browser (MASTERPROMPT §23.3 "Chronik (J): Aufgaben, Bestiarium, Herbarium & Fischbuch, Wissen (Erbauer-
 * Tafeln, Visionen), Rezeptbuch, Statistiken, Erfolge"; docs/SPIEL.md §23, §30; M7-42 Tracker, M7-48 Perk-Wahl): J öffnet die
 * Chronik auf dem Reiter Aufgaben; jeder der sieben Reiter zeigt seine Seite (Klick und Q/E); "Verfolgen" nimmt eine Aufgabe aus
 * dem HUD-Tracker und wieder hinein, der Einstieg-Schalter pausiert die Einstiegsaufgabe; was die Welt erlebt (ein Ort entdeckt,
 * ein Hase gesichtet, der Borkenvater besiegt), steht im Tagebuch, im Wissen, im Bestiarium und bei den Erfolgen; steigt eine
 * Fertigkeit auf 30/60/90, öffnet die Perk-Wahl von selbst, die Wahl steht danach in den Statistiken. Keine Konsolenfehler.
 */
import { expect, test, type Page } from '@playwright/test';
import { logicUrl } from './logik';

test.use({ viewport: { width: 1920, height: 1080 }, locale: 'de-DE' });

interface Dh {
  ready?: boolean;
  call(name: string, ...args: unknown[]): unknown;
  command(cmd: unknown): unknown;
  state(): { sim: { player: { x: number; y: number } | null; events: Record<string, number> } };
}

/** Location slots tried by `place.discover` (the world's places sit among the first slots, beacon sites first). */
const ORT_SLOTS = 24;
/** The seven tabs (src/ui/screens/chronik/modell.ts `CHRONIK_REITER`). */
const REITER = ['aufgaben', 'bestiarium', 'herbarium', 'wissen', 'rezepte', 'statistik', 'erfolge'] as const;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function starte(page: Page): Promise<void> {
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
}

async function befehl(page: Page, cmd: Record<string, unknown>): Promise<void> {
  await page.evaluate((c) => (window as unknown as { __dh: Dh }).__dh.command(c), cmd);
}

async function ereignisse(page: Page, typ: string): Promise<number> {
  return page.evaluate((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.events[t] ?? 0, typ);
}

test('Chronik: sieben Reiter, Verfolgen, Einstieg-Schalter, Tagebuch, Erfolge, Perk-Wahl', async ({ page }) => {
  test.setTimeout(300_000);
  const fehler = collectConsole(page);
  await starte(page);
  const chronik = page.getByTestId('ui-chronik');

  // The onboarding runs from the first tick and stands in the HUD's tracker.
  await expect(page.getByTestId('aufgabe-einstieg')).toBeVisible({ timeout: 30_000 });

  // What the world lives through: a place discovered (diary, knowledge), a hare in sight (bestiary), the Barkfather defeated
  // (diary, statistic, achievement – a statistic trigger holds on the next world tick).
  await befehl(page, { type: 'debug.god', on: true });
  // Picked-up fibres and twigs make the first hand recipes known (the recipe book).
  await befehl(page, { type: 'inventory.give', item: 'fasern', count: 6 });
  await befehl(page, { type: 'inventory.give', item: 'zweig', count: 4 });
  // The debug API names no place slots: discover the first ones the world has (other slots are refused, `unknownPlace`).
  for (let slot = 0; slot < ORT_SLOTS; slot++) await befehl(page, { type: 'place.discover', place: slot });
  await befehl(page, { type: 'creature.spawn', creature: 'hase', count: 1 });
  await befehl(page, { type: 'boss.debug', boss: 'borkenvater', aktion: 'besiegen' });
  await expect.poll(() => ereignisse(page, 'placeDiscovered'), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => ereignisse(page, 'bossDefeated'), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => ereignisse(page, 'achievementUnlocked'), { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(() => ereignisse(page, 'bestiaryUnlocked'), { timeout: 60_000 }).toBeGreaterThan(0);

  // J opens the chronicle on the quest tab.
  await page.keyboard.press('j');
  await expect(chronik).toBeVisible();
  await expect(chronik.getByTestId('chronik-seite-aufgaben')).toBeVisible();
  const einstieg = chronik.getByTestId('chronik-aufgabe-einstieg');
  await expect(einstieg).toContainText('Die ersten Stunden');
  await expect(chronik.getByTestId('chronik-tagebuch')).toContainText('Entdeckt:');

  // "Verfolgen": out of the HUD's tracker and back in (`quest.track`).
  await chronik.getByTestId('chronik-verfolgen-einstieg').click();
  await expect(page.getByTestId('aufgabe-einstieg')).toHaveCount(0);
  await expect(chronik.getByTestId('chronik-verfolgen-einstieg')).toHaveAttribute('aria-pressed', 'false');
  await chronik.getByTestId('chronik-verfolgen-einstieg').click();
  // Under an open screen the HUD stays in the page but hidden: count the tracker's block, not its visibility.
  await expect(page.getByTestId('aufgabe-einstieg')).toHaveCount(1);

  // The onboarding switch pauses the onboarding quest (it leaves the tracker) and resumes it.
  await chronik.getByTestId('chronik-einstieg').click();
  await expect(einstieg).toContainText('Pausiert');
  await expect(page.getByTestId('aufgabe-einstieg')).toHaveCount(0);
  await chronik.getByTestId('chronik-einstieg').click();
  await expect(einstieg).not.toContainText('Pausiert');
  await expect(page.getByTestId('aufgabe-einstieg')).toHaveCount(1);

  // E and Q switch the tabs in a ring.
  await page.keyboard.press('e');
  await expect(chronik.getByTestId('chronik-seite-bestiarium')).toBeVisible();
  // One press per frame (the input is read per frame; SwiftShader frames are slow): wait for each page.
  await page.keyboard.press('q');
  await expect(chronik.getByTestId('chronik-seite-aufgaben')).toBeVisible();
  await page.keyboard.press('q');
  await expect(chronik.getByTestId('chronik-seite-erfolge')).toBeVisible();

  // Every tab by click shows its page.
  for (const r of REITER) {
    await chronik.getByTestId(`chronik-reiter-${r}`).click();
    await expect(chronik.getByTestId(`chronik-seite-${r}`)).toBeVisible();
    await expect(chronik.getByTestId(`chronik-reiter-${r}`)).toHaveAttribute('aria-selected', 'true');
  }
  await chronik.getByTestId('chronik-reiter-bestiarium').click();
  await expect(chronik.getByTestId('chronik-seite-bestiarium')).toContainText('Hase');
  await expect(chronik.getByTestId('chronik-seite-bestiarium')).toContainText('???');
  // M7-108: a known creature with its portrait (the hare's standing pose from the atlas, decoded), an unknown one without.
  const portraet = chronik.locator('[data-kreatur="hase"] .dh-chronik__portraet img[data-sprite="kreatur_hase"]');
  await expect(portraet).toBeVisible();
  expect(await portraet.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(chronik.locator('[data-bekannt="nein"] .dh-chronik__portraet')).toHaveCount(0);
  await chronik.getByTestId('chronik-reiter-herbarium').click();
  await expect(chronik.getByTestId('chronik-pflanzen')).toBeVisible();
  await expect(chronik.getByTestId('chronik-fische')).toBeVisible();
  await chronik.getByTestId('chronik-reiter-wissen').click();
  await expect(chronik.getByTestId('chronik-seite-wissen')).toContainText('Orte der Alten');
  await chronik.getByTestId('chronik-reiter-rezepte').click();
  await expect(chronik.getByTestId('chronik-seite-rezepte')).toContainText('In der Hand');
  await expect(chronik.getByTestId('chronik-seite-rezepte')).toContainText('Faserseil');
  await chronik.getByTestId('chronik-reiter-statistik').click();
  await expect(chronik.locator('[data-stat="spielzeit"]')).toBeVisible();
  await expect(chronik.locator('[data-meilenstein="m_borkenvater"]')).toHaveAttribute('data-erreicht', 'ja');
  await chronik.getByTestId('chronik-reiter-erfolge').click();
  await expect(chronik.locator('[data-erfolg="borkenvater_besiegt"]')).toHaveAttribute('data-erreicht', 'ja');
  await expect(chronik.getByTestId('chronik-erfolge-anzahl')).toContainText(/[1-9]\d* von \d+ Erfolgen/);

  // Closing: the button (Escape works like every screen).
  await chronik.getByTestId('chronik-schliessen').click();
  await expect(chronik).toHaveCount(0);

  // A skill rises to 100: the perk choice opens by itself (`perkChoiceOpened`, the game pauses) on the first open choice (30).
  await befehl(page, { type: 'debug.unlock', skill: 'holzfaellen' });
  const wahl = page.getByTestId('ui-perkwahl');
  await expect(wahl).toBeVisible({ timeout: 30_000 });
  await expect(wahl.locator('[data-stufe="30"]')).toHaveCount(1);
  await wahl.getByTestId('perkwahl-kraftvolle_hiebe').click();
  // The next choice (60) follows at once although the paused game takes the first only on its next tick; "Später" closes:
  // the game runs on, the choice arrives (`perkChosen`), the one of 60 stays open – the chronicle offers it again.
  await expect(wahl.locator('[data-stufe="60"]')).toHaveCount(1);
  await wahl.getByTestId('perkwahl-spaeter').click();
  await expect(wahl).toHaveCount(0);
  await expect.poll(() => ereignisse(page, 'perkChosen'), { timeout: 30_000 }).toBe(1);
  await page.keyboard.press('j');
  await chronik.getByTestId('chronik-reiter-statistik').click();
  const holz = chronik.locator('[data-fertigkeit="holzfaellen"]');
  await expect(holz).toContainText('Kraftvolle Hiebe');
  await holz.getByTestId('chronik-perkwahl-holzfaellen').click();
  await expect(wahl).toBeVisible();
  await expect(wahl.locator('[data-stufe="60"]')).toHaveCount(1);

  expect(fehler).toEqual([]);
});
