/**
 * Abgelehnte Spielerbefehle als Warnung (MASTERPROMPT §26 „Fehlermeldungen sagen, was fehlt und wie man es
 * löst“, §2 „jede Aktion hat Bild- und Ton-Rückmeldung“): Lehnt die Simulation einen Befehl ab, den der
 * Spieler selbst gab (`commandRejected`), zeigt die Meldung den Grund mit Lösung aus den Texten seines
 * Bereichs – den Fehlerklang spielt der Audiokern (`src/audio/eventMap.ts`).
 *
 * - Bereich je Befehl: Aktionen `ui.action.reject.*`, Licht `ui.light.reject.*`, Schlaf `ui.sleep.reject.*`,
 *   Tod und Grab `ui.death.reject.*`, Fertigkeiten `ui.skill.reject.*`, Handwerk `ui.craft.reject.*`,
 *   Benutzen `ui.tools.reject.*`; ab M4 Stationen `ui.station.reject.*`, Reparatur `ui.repair.reject.*`, Bauen
 *   `ui.build.reject.*`, Kisten `ui.storage.reject.*`, Herdfeuer `ui.hearth.reject.*`; ab M6 Kampf `ui.combat.reject.*`, Jagd (Zerlegen, Fallen) `ui.creatures.reject.*`; Gründe der Taschen (ein
 *   leerer Gürtelplatz, volle Taschen) aus `ui.inventory.reject.*`.
 * - E ohne Ziel meldet „Hier gibt es nichts zu tun …“, E im Schlaf „Du schläfst …“; einen blockierten Fokus
 *   nennt schon der Interaktionshinweis (HUD oder Marker), er wird nicht wiederholt.
 * - Still bleiben: fortlaufende Eingaben (Bewegen, Zielen, Sprinten), Debug-Befehle (`fire.ignite`), Gründe ohne
 *   Text und die Befehle der Bildschirme, die ihre Gründe selbst in ihrer Hinweiszeile zeigen (`EIGENE_ZEILE`: der
 *   Inventar-Bildschirm, der Baumodus – Setzen, Blaupause, Abbauen, Aufwerten, Flächenreparatur, Stationen aufstellen
 *   und abbauen; eine Fackel nimmt auch E außerhalb des Baumodus, ihr Grund bleibt eine Meldung –, der
 *   Stationsbildschirm – Ein- und Auslegen –, der Kistenbildschirm, der Herdfeuerbildschirm – Brennstoff, Löschen,
 *   Glutkerne – und der Reparatur-Reiter der Stationen); die Meldungen erscheinen auch über offenen Bildschirmen, der Grund stünde sonst doppelt da.
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
  'craft.pin': 'ui.craft.reject',
  'player.useItem': 'ui.tools.reject',
  'station.place': 'ui.station.reject',
  'station.remove': 'ui.station.reject',
  'station.use': 'ui.station.reject',
  'station.put': 'ui.station.reject',
  'station.take': 'ui.station.reject',
  'station.takeAll': 'ui.station.reject',
  'repair.item': 'ui.repair.reject',
  'build.place': 'ui.build.reject',
  'build.blueprint': 'ui.build.reject',
  'build.complete': 'ui.build.reject',
  'build.remove': 'ui.build.reject',
  'build.upgrade': 'ui.build.reject',
  'build.door': 'ui.build.reject',
  'build.repair': 'ui.build.reject',
  'storage.open': 'ui.storage.reject',
  'storage.close': 'ui.storage.reject',
  'storage.put': 'ui.storage.reject',
  'storage.take': 'ui.storage.reject',
  'storage.takeAll': 'ui.storage.reject',
  'storage.storeAll': 'ui.storage.reject',
  'storage.sort': 'ui.storage.reject',
  'storage.rename': 'ui.storage.reject',
  'storage.label': 'ui.storage.reject',
  'storage.quickStash': 'ui.storage.reject',
  'hearth.use': 'ui.hearth.reject',
  'hearth.fuel': 'ui.hearth.reject',
  'hearth.take': 'ui.hearth.reject',
  'hearth.ignite': 'ui.hearth.reject',
  'hearth.douse': 'ui.hearth.reject',
  'hearth.core': 'ui.hearth.reject',
  'hearth.uncore': 'ui.hearth.reject',
  'combat.attack': 'ui.combat.reject',
  'combat.block': 'ui.combat.reject',
  'carcass.carve': 'ui.creatures.reject',
  'trap.place': 'ui.creatures.reject',
  'trap.take': 'ui.creatures.reject',
  'place.use': 'ui.ort.reject',
  'place.discover': 'ui.ort.reject',
  'worldEvent.start': 'ui.ereignis.reject',
  'worldEvent.stop': 'ui.ereignis.reject',
  'lightning.strike': 'ui.ereignis.reject',
  'map.mark': 'ui.karte.reject',
  'map.unmark': 'ui.karte.reject',
  'map.rename': 'ui.karte.reject',
};
/**
 * Befehle, deren Bildschirm den Grund selbst in seiner Hinweiszeile zeigt: Baumodus (src/ui/screens/bau: Setzen,
 * Blaupause, Abbauen, Stationen aufstellen und abbauen), Stationsbildschirm (Ein- und Auslegen), Kistenbildschirm.
 */
export const EIGENE_ZEILE: ReadonlySet<GameCommandType> = new Set<GameCommandType>([
  'build.place',
  'build.blueprint',
  'build.remove',
  'build.upgrade',
  'build.repair',
  'station.place',
  'station.remove',
  'station.put',
  'station.take',
  'station.takeAll',
  'storage.close',
  'storage.put',
  'storage.take',
  'storage.takeAll',
  'storage.storeAll',
  'storage.sort',
  'storage.rename',
  'storage.label',
  'hearth.fuel',
  'hearth.take',
  'hearth.douse',
  'hearth.core',
  'hearth.uncore',
  'repair.item',
]);
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
  if (bereich === undefined || EIGENE_ZEILE.has(type)) return null;
  const eigen = `${bereich}.${reason}`;
  if (isI18nKey(eigen)) return eigen;
  const taschen = `${TASCHEN}.${reason}`;
  return isI18nKey(taschen) ? taschen : null;
}
