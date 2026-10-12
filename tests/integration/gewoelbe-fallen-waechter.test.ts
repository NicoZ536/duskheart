/**
 * Das Fallenbild `gewoelbe-fallen` räumt die Wächter des Gewölbes, ohne dass einer stirbt (M7-121; src/debug/gewoelbeScenarios.ts
 * `GuardClearing`): seit M7-97 bewacht ein Fallengeist die Bahn des Pfeilwerfers. Getötet (`creature.kill`, wie das Rätselbild
 * `gewoelbe-gruenhain`) spielte er seinen Tod an seinem Platz – und den beendet die eingefrorene Präsentationszeit des Bildes
 * nie: Geist und Wurzelhüter standen sterbend neben der Figur. Das Fallenbild entfernt die Wächter (`despawn`): kein
 * `creatureDied`, keine Kreatur mehr auf der Gewölbe-Ebene, wenn das Bild entsteht. Szenario-Ablauf wie im Browser (Phasen
 * `welt`, `abstieg`, `raum`) auf der Sitzungswelt, ohne Renderer.
 */
import { describe, expect, it } from 'vitest';
import { gewoelbeScenarios, trapPicture } from '../../src/debug/gewoelbeScenarios';
import { livingCreatures } from '../../src/debug/scenarioCreatures';
import { BOOT_SESSION_SEED, GameSession } from '../../src/game/session';
import { WORLD_TIMEOUT_MS } from '../unit/world/weltgen-hilfen';

/** The vault layer (ADR-0207). */
const VAULT_LAYER = -1;

describe('gewoelbe-fallen: Wächter entfernt, nicht getötet (M7-121)', () => {
  it(
    'nach Abstieg und Fallenraum: kein Wächter gestorben, keine Kreatur mehr auf der Gewölbe-Ebene; die Bahn hat ihren Fallengeist',
    () => {
      const session = new GameSession({ config: { seed: BOOT_SESSION_SEED } });
      const died: { creature: string; layer: number }[] = [];
      session.onEvent('creatureDied', (e) => died.push({ creature: e.creature, layer: e.layer }));
      const scenario = gewoelbeScenarios.find((s) => s.name === 'gewoelbe-fallen');
      if (scenario === undefined) throw new Error('Szenario gewoelbe-fallen fehlt');
      // A renderer that is always ready, its camera anywhere: the scenario reads the world from the simulation.
      const render = {
        showScene: () => undefined,
        setDebugView: () => undefined,
        sceneReady: () => true,
        startGameCamera: () => undefined,
        gameCamera: () => ({ layer: 0, tx: 0, ty: 0 }),
        setQuality: () => undefined,
      };
      scenario.setup({ freezeAt: () => undefined, render, session: { command: (c) => session.command(c), step: () => session.step(), sim: () => session.sim } });
      const picture = trapPicture(session.sim);
      if (picture === null) throw new Error('kein Fallenbild in der Sitzungswelt');
      // The lane is guarded: a trap spirit within three tiles of the spot the player stands on (the one the picture showed).
      expect(picture.plan.guards.some((g) => g.creature === 'fallengeist' && Math.abs(g.tx - picture.tx) <= 3 && Math.abs(g.ty - picture.ty) <= 3)).toBe(true);
      // `welt`, `abstieg` (down, the guards rise and are cleared), `raum` (into the lane, half way through the warning).
      for (let phase = 0; phase < 3; phase++) expect(scenario.ready()).toBe(false);
      expect(died.filter((d) => d.layer === VAULT_LAYER)).toEqual([]);
      expect(livingCreatures(session.sim).filter((c) => c.layer === VAULT_LAYER)).toEqual([]);
    },
    WORLD_TIMEOUT_MS,
  );
});
