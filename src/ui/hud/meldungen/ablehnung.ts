/**
 * Abgelehnte Spielerbefehle als Warnung (MASTERPROMPT §26 „Fehlermeldungen sagen, was fehlt und wie man es
 * löst“, §2 „jede Aktion hat Bild- und Ton-Rückmeldung“): Lehnt die Simulation einen Befehl ab, den der
 * Spieler selbst gab (`commandRejected`), zeigt die Meldung den Grund mit Lösung aus den Texten seines
 * Bereichs – den Fehlerklang spielt der Audiokern (`src/audio/eventMap.ts`).
 *
 * - Bereich je Befehl: Aktionen `ui.action.reject.*`, Licht `ui.light.reject.*`, Schlaf `ui.sleep.reject.*`,
 *   Tod und Grab `ui.death.reject.*`, Fertigkeiten `ui.skill.reject.*`, Handwerk `ui.craft.reject.*`,
 *   Benutzen `ui.tools.reject.*`; Gründe der Taschen (ein leerer Gürtelplatz, volle Taschen) aus
 *   `ui.inventory.reject.*`.
 * - E ohne Ziel meldet „Hier gibt es nichts zu tun …“, E im Schlaf „Du schläfst …“; einen blockierten Fokus
 *   nennt schon der Interaktionshinweis (HUD oder Marker), er wird nicht wiederholt.
 * - Still bleiben: fortlaufende Eingaben (Bewegen, Zielen, Sprinten), Debug-Befehle und die Befehle des
 *   Inventar-Bildschirms (er zeigt ihre Gründe in seiner Hinweiszeile), und Gründe ohne Text.
 */
import type { GameCommandType } from '../../../game/commands';
import { isI18nKey, type I18nKey } from '../../../i18n';

/** Textbereich der abgelehnten Spielerbefehle. */
const BEREICH: Partial<Readonly<Record<GameCommandType, string>>> = {
  'action.eat': 'ui.action.reject',
  'action.useBelt': 'ui.action.reject',
  'action.drink': 'ui.action.reject',
  'action.sit': 'ui.action.reject',
  'action.throw': 'ui.action.reject',
  'light.toggle': 'ui.light.reject',
  'light.place': 'ui.light.reject',
  'light.fuel': 'ui.light.reject',
  'light.ignite': 'ui.light.reject',
  'light.douse': 'ui.light.reject',
  'light.take': 'ui.light.reject',
  'sleep.start': 'ui.sleep.reject',
  'death.respawn': 'ui.death.reject',
  'death.lootGrave': 'ui.death.reject',
  'skills.choosePerk': 'ui.skill.reject',
  'craft.start': 'ui.craft.reject',
  'craft.cancel': 'ui.craft.reject',
  'craft.useChests': 'ui.craft.reject',
  'player.useItem': 'ui.tools.reject',
};
/** Bereich der Taschen-Gründe, die ein Befehl eines anderen Bereichs weiterreicht. */
const TASCHEN = 'ui.inventory.reject';
/**
 * Interaktionsgründe, die kein Hinweis schon zeigt: E ohne Ziel und E im Schlaf (der Schlafende hat keinen
 * Fokus). Im Tod spricht der Todesbildschirm.
 */
const INTERAKTION_OHNE_HINWEIS: Readonly<Record<string, I18nKey>> = {
  nothingToInteract: 'ui.interaction.block.nothingToInteract',
  asleep: 'ui.interaction.block.asleep',
};

/** Text der Ablehnung von Befehl `type` aus Grund `reason`, oder `null`, wenn sie still bleibt. */
export function ablehnungsText(type: GameCommandType, reason: string): I18nKey | null {
  if (type === 'player.interact') return INTERAKTION_OHNE_HINWEIS[reason] ?? null;
  const bereich = BEREICH[type];
  if (bereich === undefined) return null;
  const eigen = `${bereich}.${reason}`;
  if (isI18nKey(eigen)) return eigen;
  const taschen = `${TASCHEN}.${reason}`;
  return isI18nKey(taschen) ? taschen : null;
}
