/**
 * Open flames as the creatures sense them (MASTERPROMPT §19.4; docs/SPIEL.md §11 "Feuerscheu"; M6-22): a creature whose
 * profile shies from fire (`scheutFeuer`) flees from the nearest torch, camp fire or burning tile within its distance –
 * smoke drives off the wasp swarm. `lightSystemFlames` reads the light system's source list (lit lights only): the light
 * kinds that burn with a flame (content `LIGHT_KINDS` with the behaviour `fackel` or `feuer`, carried or placed) and the
 * fire system's burning tiles (`FIRE_LIGHT_KIND`); lamps give no smoke. Tests hand in their own.
 */
import { LIGHT_KINDS } from '../../content/lights';
import type { Layer } from '../../world/model/coords';
import { FIRE_LIGHT_KIND } from '../fire/system';
import type { LightSystem } from '../light/system';
import type { Simulation } from '../sim';

/** The open flames the creatures read. */
export interface CreatureFlames {
  /** Writes the nearest open flame within `radius` [px] of (x, y) on `layer` into `out` [px]; false when there is none. */
  nearest(sim: Simulation, layer: Layer, x: number, y: number, radius: number, out: { x: number; y: number }): boolean;
}

/** Light kinds that burn with an open flame (torches, camp fires, fireplaces) and the burning tiles of the fire system. */
export const FLAME_LIGHT_KINDS: ReadonlySet<string> = new Set([...LIGHT_KINDS.filter((k) => k.verhalten === 'fackel' || k.verhalten === 'feuer').map((k) => k.id), FIRE_LIGHT_KIND]);

/** The open flames among the light system's lit sources. */
export function lightSystemFlames(light: Pick<LightSystem, 'sources'>): CreatureFlames {
  return {
    nearest(sim, layer, x, y, radius, out) {
      const list = light.sources(sim);
      let best = radius * radius;
      let found = false;
      for (let i = 0; i < list.length; i++) {
        const l = list[i];
        if (l === undefined || l.layer !== layer || !FLAME_LIGHT_KINDS.has(l.kind)) continue;
        const dx = l.x - x;
        const dy = l.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 > best) continue;
        best = d2;
        out.x = l.x;
        out.y = l.y;
        found = true;
      }
      return found;
    },
  };
}
