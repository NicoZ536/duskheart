/**
 * Screenshot scenario `hud-tracker` (M4-08, MASTERPROMPT §31.5): the page's HUD in the mode Voll over the start beach
 * at 11:00 with three pinned recipes in the tracker below the minimap – fibre rope (all at hand: ticks, "Alles da"),
 * stone axe (stone and rope missing in red with their solution hints) and plank (wood at hand, but only at the
 * sawbuck). The pins are the game's (`craft.pin`), and only known recipes pin: the player owns a sawbuck (the plank is
 * known) and had a fibre rope, thrown away again (the stone axe is known, its rope missing). The
 * scenario waits until the notifications of the given items and discovered recipes have run their course. Registered
 * in src/debug/scenarios.ts.
 */
import { befehle, werkstattSzenario, type WerkstattSzenario } from '../../screens/handwerk/szenarioHilfe';
import { aktiveHudWelt, hudVorgabe } from '../Hud';

export function trackerSzenario(): WerkstattSzenario {
  return werkstattSzenario({
    name: 'hud-tracker',
    description:
      'M4-08: Rezept-Tracker rechts unter der Minimap (HUD Voll) – drei angeheftete Rezepte: Faserseil (alle Zutaten da, Haken, „Alles da“), Steinaxt (Stein 1/2 und Faserseil 0/1 rot mit Lösungshinweis) und Brett (Bauholz da, „Nur am Sägebock“)',
    items: [
      ['fasern', 7],
      ['zweig', 3],
      ['stein', 1],
      ['holz', 3],
      ['saegebock', 1],
      ['faserseil', 1],
    ],
    vorher: () => {
      hudVorgabe.value = { modus: 'full' };
    },
    schritte: [
      befehle(
        { type: 'inventory.discard', from: { bereich: 'inventar', index: 5 } },
        { type: 'craft.pin', recipe: 'rezept_faserseil', on: true },
        { type: 'craft.pin', recipe: 'rezept_steinaxt', on: true },
        { type: 'craft.pin', recipe: 'rezept_brett', on: true },
      ),
      // The pickups of the given items and the new recipes run their course (their own scenario is hud-meldungen).
      () => {
        const w = aktiveHudWelt()?.warteschlange;
        return w === undefined || (w.sichtbar.length === 0 && w.wartend === 0);
      },
      () => document.querySelector('[data-testid="tracker-rezept_brett"]') !== null,
    ],
  });
}
