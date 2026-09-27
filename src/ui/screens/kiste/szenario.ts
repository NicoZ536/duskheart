/**
 * Screenshot scenario `ui-kiste` (M4-21, MASTERPROMPT §31.5): a wooden chest built next to the player on the start
 * beach at 11:00 (`build.place`), renamed "Baustoffe" with a stone as its icon label, stone, wood and clay stored in
 * it; the chest screen open (`storage.open`) – name field, label selector, its 16 slots, "Sortieren", "Alles
 * nehmen" – beside the bags (the stone axe, food and the rest), "Alles einlagern" and "Schnellablage", the keyboard
 * focus frame on "Alles einlagern". Registered in src/debug/scenarios.ts.
 *
 * Scenario `ui-kiste-suche` (M4-21, §16.7 "Suche über alle Kisten der Basis"): three wooden chests without a hearth –
 * "Baustoffe" (stone, wood) and "Steinlager" (stone, clay) next to the player, "Erze" (stone, copper ore) about eight
 * tiles south-east –; "Baustoffe" open on its search tab, "stein" typed: the base line ("Umkreis 12 Felder: 3 Kisten"),
 * the finds per chest nearest first with where each stands, the stone of the open chest highlighted in its slots; the
 * focus frame on the tab "Suche".
 */
import { TILE_PX } from '../../../world/model/coords';
import { activeGameScreens } from '../../focus/GameScreens';
import { platzieren, werkstattSzenario, type WerkstattSzenario } from '../handwerk/szenarioHilfe';

/** The chest's id as the simulation reports it (the first chest of a fresh world gets 1). */
let kiste = 0;

export function kisteSzenario(): WerkstattSzenario {
  return werkstattSzenario({
    name: 'ui-kiste',
    description:
      'M4-21: Kistenbildschirm – Holzkiste „Baustoffe“ mit Stein-Etikett, darin Stein, Holz und Lehm (16 Plätze, belegt/gesamt), Sortieren und Alles nehmen; daneben die Taschen mit Werkzeug, Nahrung und Rohstoffen, Alles einlagern (ohne Schnellleiste) und Schnellablage; Fokusrahmen auf „Alles einlagern“',
    items: [
      ['kiste_holz', 1],
      ['stein', 30],
      ['holz', 20],
      ['lehm', 8],
      ['kupfererz', 5],
      ['fasern', 12],
      ['himbeeren', 6],
      ['steinaxt', 1],
      ['feuerstein', 4],
    ],
    schritte: [
      platzieren(
        (tx, ty) => ({ type: 'build.place', part: 'kiste_holz', tx, ty }),
        'chestPlaced',
        (id) => (kiste = id),
      ),
      (s) => {
        s.command({ type: 'storage.put', chest: kiste, from: { bereich: 'inventar', index: 1 } });
        s.command({ type: 'storage.put', chest: kiste, from: { bereich: 'inventar', index: 2 }, count: 12 });
        s.command({ type: 'storage.put', chest: kiste, from: { bereich: 'inventar', index: 3 } });
        s.command({ type: 'storage.rename', chest: kiste, name: 'Baustoffe' });
        s.command({ type: 'storage.label', chest: kiste, item: 'stein' });
        s.command({ type: 'storage.open', chest: kiste });
        s.step();
        return true;
      },
    ],
    fokus: '[data-testid="kiste-alles-einlagern"]',
  });
}

/** The chests of `ui-kiste-suche` (ids as the simulation reports them). */
const suche = { baustoffe: 0, steinlager: 0, erze: 0 };
/** Where the third chest is built: this many tiles east and south of the start. */
const ERZE_VERSATZ = { x: 7, y: 4 } as const;
/** What is typed into the search field. */
const SUCHE = 'stein';

export function kisteSucheSzenario(): WerkstattSzenario {
  let start: { x: number; y: number } | null = null;
  const basis = werkstattSzenario({
    name: 'ui-kiste-suche',
    description:
      'M4-21, §16.7: Suche über alle Kisten der Basis aus einer Kiste ohne Herdfeuer – Reiter „Suche“, „stein“ eingegeben, „Umkreis 12 Felder: 3 Kisten“, Funde je Kiste mit Entfernung und Richtung (diese Kiste, Steinlager, Erze etwa acht Felder südöstlich), der Stein der offenen Kiste in ihren Plätzen hervorgehoben; Fokusrahmen auf dem Reiter „Suche“',
    items: [
      ['kiste_holz', 3],
      ['stein', 40],
      ['holz', 20],
      ['lehm', 8],
      ['kupfererz', 5],
      ['steinaxt', 1],
    ],
    schritte: [
      (s) => {
        const p = s.state().player;
        if (p === null) return false;
        start = { x: p.x, y: p.y };
        return true;
      },
      platzieren(
        (tx, ty) => ({ type: 'build.place', part: 'kiste_holz', tx, ty }),
        'chestPlaced',
        (id) => (suche.baustoffe = id),
      ),
      (s) => {
        s.command({ type: 'storage.put', chest: suche.baustoffe, from: { bereich: 'inventar', index: 1 }, count: 12 });
        s.command({ type: 'storage.put', chest: suche.baustoffe, from: { bereich: 'inventar', index: 2 }, count: 8 });
        s.command({ type: 'storage.rename', chest: suche.baustoffe, name: 'Baustoffe' });
        s.command({ type: 'storage.label', chest: suche.baustoffe, item: 'holz' });
        s.step();
        return true;
      },
      platzieren(
        (tx, ty) => ({ type: 'build.place', part: 'kiste_holz', tx, ty }),
        'chestPlaced',
        (id) => (suche.steinlager = id),
      ),
      (s) => {
        s.command({ type: 'storage.put', chest: suche.steinlager, from: { bereich: 'inventar', index: 1 }, count: 20 });
        s.command({ type: 'storage.put', chest: suche.steinlager, from: { bereich: 'inventar', index: 3 } });
        s.command({ type: 'storage.rename', chest: suche.steinlager, name: 'Steinlager' });
        s.command({ type: 'storage.label', chest: suche.steinlager, item: 'stein' });
        if (start !== null) s.command({ type: 'player.teleport', x: start.x + ERZE_VERSATZ.x * TILE_PX, y: start.y + ERZE_VERSATZ.y * TILE_PX, layer: 0 });
        s.step();
        return true;
      },
      platzieren(
        (tx, ty) => ({ type: 'build.place', part: 'kiste_holz', tx, ty }),
        'chestPlaced',
        (id) => (suche.erze = id),
      ),
      (s) => {
        s.command({ type: 'storage.put', chest: suche.erze, from: { bereich: 'inventar', index: 1 } });
        s.command({ type: 'storage.put', chest: suche.erze, from: { bereich: 'inventar', index: 4 } });
        s.command({ type: 'storage.rename', chest: suche.erze, name: 'Erze' });
        s.command({ type: 'storage.label', chest: suche.erze, item: 'kupfererz' });
        if (start !== null) s.command({ type: 'player.teleport', x: start.x, y: start.y, layer: 0 });
        s.step();
        return true;
      },
      (s) => {
        s.command({ type: 'storage.open', chest: suche.baustoffe });
        s.step();
        return true;
      },
    ],
    klicks: ['[data-testid="kiste-reiter-suche"]'],
  });
  let phase: 'basis' | 'tippen' | 'fokus' | 'fertig' = 'basis';
  return {
    ...basis,
    ready() {
      switch (phase) {
        case 'basis':
          if (basis.ready()) phase = 'tippen';
          return false;
        case 'tippen': {
          const feld = document.querySelector('[data-testid="kiste-suchfeld"]');
          if (!(feld instanceof HTMLInputElement)) return false;
          feld.value = SUCHE;
          feld.dispatchEvent(new Event('input', { bubbles: true }));
          phase = 'fokus';
          return false;
        }
        case 'fokus': {
          const ui = activeGameScreens();
          const reiter = document.querySelector('[data-testid="kiste-reiter-suche"]');
          // The finds must be there before the picture (the search runs with the next sample).
          const fund = document.querySelector(`[data-testid^="kiste-fund-${suche.steinlager}-"]`);
          if (ui === null || !(reiter instanceof HTMLElement) || fund === null) return false;
          ui.focus.keysUsed();
          ui.focus.focus(reiter);
          phase = 'fertig';
          return false;
        }
        case 'fertig':
          return true;
      }
    },
  };
}
