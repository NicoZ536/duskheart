/**
 * M7-56 Einstellungen II – Steuerung, Spiel, Sprache (MASTERPROMPT §29, §26 „Alles umbelegbar“; docs/SPIEL.md §25): im
 * Einstellungsbildschirm des Hauptmenüs (`?debug=1&menue=1`) wird eine Aktion neu belegt (die Taste wird erfasst, die
 * Spieleingabe sieht sie nicht), eine belegte Taste fragt nach (Tauschen gibt der anderen Aktion die alte Taste),
 * Empfindlichkeit und Halten/Umschalten, HUD-Modus, Kompassbalken, Schadenszahlen, Hinweise, Funkes Kommentare und das
 * Autosave-Intervall ändern sich; die Sprache wechselt ohne Neustart; nach einem Neuladen stehen dieselben Werte da.
 * Aus dem Pausemenü öffnet „Alle Einstellungen“ denselben Bildschirm.
 */
import { expect, test, type Page } from '@playwright/test';
import { logicUrl } from './logik';

interface Binding {
  kind: string;
  code?: string;
}
interface Dh {
  ready: boolean;
  state(): { settings: { language: string; controls: Record<string, unknown> & { bindings: Record<string, Binding[]> }; game: Record<string, unknown> }; sim: { player: unknown } };
}

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true, undefined, { timeout: 120_000 });
}

function settings(page: Page): Promise<ReturnType<Dh['state']>['settings']> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().settings);
}

const wert = (page: Page, id: string) => page.getByTestId(`${id.startsWith('belegung-') ? id : `einstellung-${id}`}-wert`);

test('Steuerung, Spiel und Sprache: umbelegen mit Konfliktanzeige, Werte bleiben nach dem Neuladen', async ({ page }) => {
  const errors = collectConsole(page);
  await page.goto(logicUrl('menue=1'));
  await ready(page);
  await page.evaluate(() => (window as unknown as { __dh: { exec(l: string): string } }).__dh.exec('set language de'));
  await page.getByTestId('menue-einstellungen').click();
  await page.getByTestId('einstellungen-reiter-controls').click();

  // Sensitivity, hold/toggle.
  await page.getByTestId('einstellung-controls.mouseSensitivity').click();
  await page.getByTestId('einstellung-controls.sprintMode').click();
  await expect(wert(page, 'controls.sprintMode')).toHaveText('Umschalten');

  // Rebinding: "Interagieren" onto O – the prompt waits, the key is captured, the game input does not see it.
  const interact = page.getByTestId('belegung-interact');
  await interact.scrollIntoViewIfNeeded();
  await interact.click();
  await expect(page.getByTestId('belegung-erfassen')).toBeVisible();
  await page.keyboard.press('KeyO');
  await expect(page.getByTestId('belegung-erfassen')).toHaveCount(0);
  await expect(wert(page, 'belegung-interact')).toHaveText('O');
  // A key another action uses asks first; Esc on the prompt cancels without change.
  await interact.click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('belegung-erfassen')).toHaveCount(0);
  await expect(wert(page, 'belegung-interact')).toHaveText('O');
  // Tab belongs to the inventory: the conflict names it; swapping gives the inventory the replaced O.
  await interact.click();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('belegung-konflikt')).toContainText('Inventar');
  await page.getByTestId('belegung-tauschen').click();
  await expect(wert(page, 'belegung-interact')).toHaveText('Tab');
  let s = await settings(page);
  expect(s.controls.bindings.interact?.[0]).toMatchObject({ kind: 'key', code: 'Tab' });
  expect(s.controls.bindings.inventory?.some((b) => b.code === 'KeyO')).toBe(true);
  expect(s.controls).toMatchObject({ mouseSensitivity: 1.05, sprintMode: 'toggle' });

  // Game: HUD mode, compass bar, damage numbers, hints, Funke's comments, autosave interval.
  await page.getByTestId('einstellungen-reiter-game').click();
  await page.getByTestId('einstellung-game.hudMode').click();
  await page.getByTestId('einstellung-game.compassBar').click();
  await page.getByTestId('einstellung-game.damageNumbers').click();
  await page.getByTestId('einstellung-game.hints').click();
  await page.getByTestId('einstellung-game.funkeComments').click();
  await page.getByTestId('einstellung-game.autosaveMinutes').click();
  await expect(wert(page, 'game.autosaveMinutes')).toHaveText('Alle 4 Minuten');
  s = await settings(page);
  expect(s.game).toMatchObject({ hudMode: 'contextual', compassBar: true, damageNumbers: false, hints: false, funkeComments: false, autosaveMinutes: 4 });

  // Language: every text switches at once, no reload.
  await page.getByTestId('einstellungen-reiter-language').click();
  await page.getByTestId('einstellung-language').click();
  await expect(page.getByTestId('einstellungen-reiter-controls')).toHaveText('Controls');
  await expect(page.getByTestId('einstellungen-zurueck')).toHaveText('Back');
  expect((await settings(page)).language).toBe('en');

  // After a reload: the same values, in English.
  await page.reload();
  await ready(page);
  await expect(page.getByTestId('menue-einstellungen')).toHaveText('Settings');
  await page.getByTestId('menue-einstellungen').click();
  await page.getByTestId('einstellungen-reiter-controls').click();
  await expect(wert(page, 'controls.sprintMode')).toHaveText('Toggle');
  await expect(wert(page, 'belegung-interact')).toHaveText('Tab');
  await page.getByTestId('einstellungen-reiter-game').click();
  await expect(wert(page, 'game.autosaveMinutes')).toHaveText('Every 4 minutes');
  s = await settings(page);
  expect(s.game).toMatchObject({ hudMode: 'contextual', compassBar: true, damageNumbers: false, hints: false, funkeComments: false, autosaveMinutes: 4 });
  expect(s.controls.bindings.interact?.[0]).toMatchObject({ code: 'Tab' });
  // Esc goes back to the main menu.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ui-einstellungen')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('das Pausemenü öffnet unter „Alle Einstellungen“ denselben Bildschirm; Esc führt Ansicht für Ansicht zurück', async ({ page }) => {
  const errors = collectConsole(page);
  await page.goto(logicUrl('spieler=1'));
  await ready(page);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ui-pause')).toBeVisible();
  await page.getByTestId('pause-einstellungen').click();
  await page.getByTestId('einstellungen-alle').click();
  await expect(page.getByTestId('einstellungen-reiter-graphics')).toBeVisible();
  await page.getByTestId('einstellungen-reiter-accessibility').click();
  await page.getByTestId('einstellung-accessibility.reducedMotion').click();
  expect(((await page.evaluate(() => (window as unknown as { __dh: { state(): { settings: { accessibility: { reducedMotion: boolean } } } } }).__dh.state().settings.accessibility.reducedMotion)))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('einstellungen-alle')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-weiter')).toBeVisible();
  expect(errors).toEqual([]);
});
