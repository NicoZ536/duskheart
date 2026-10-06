/**
 * The new-world flow (docs/SPIEL.md §25 "Boot-Ablauf": Neue Welt → Charaktererstellung → Ladebildschirm → Spiel; M7-51).
 *
 * Each step is a menu screen that adds to one draft of the world – its config and its first commands – and goes on to the
 * next step; after the last one the menu starts the world (src/ui/menu/start.ts). "Zurück" goes one step back with the
 * draft kept. The character creation (M7-52, strand I) adds its step here (one entry after `welt`) and its screen to the
 * menu's screens (src/ui/menu/MenuApp.tsx); its command (`appearance.set`) joins the draft's commands.
 */
import type { GameCommand } from '../../game/commands';
import type { WorldConfigChoice } from './start';

/** One step of the flow: its id and the menu screen that shows it. */
export interface AblaufSchritt {
  readonly id: string;
  readonly screen: string;
}

/** The steps in order. */
export const NEUE_WELT_ABLAUF: readonly AblaufSchritt[] = [{ id: 'welt', screen: 'neue-welt' }];

/** The world as the steps build it. */
export interface WeltEntwurf {
  readonly worldId: string;
  readonly name: string;
  readonly config: WorldConfigChoice;
  /** Commands of the world's first tick, by step (each step replaces its own when the player goes back and on again). */
  readonly commands: Readonly<Record<string, readonly GameCommand[]>>;
}

/** The step after `id`, or null after the last. */
export function naechsterSchritt(id: string): AblaufSchritt | null {
  const i = NEUE_WELT_ABLAUF.findIndex((s) => s.id === id);
  return i < 0 ? null : (NEUE_WELT_ABLAUF[i + 1] ?? null);
}

/** The step before `id`, or null before the first. */
export function vorherigerSchritt(id: string): AblaufSchritt | null {
  const i = NEUE_WELT_ABLAUF.findIndex((s) => s.id === id);
  return i <= 0 ? null : (NEUE_WELT_ABLAUF[i - 1] ?? null);
}

/** The draft's commands in the order of the steps (the flow's order is the order the world receives them). */
export function entwurfBefehle(entwurf: WeltEntwurf): GameCommand[] {
  const out: GameCommand[] = [];
  for (const s of NEUE_WELT_ABLAUF) out.push(...(entwurf.commands[s.id] ?? []));
  return out;
}
