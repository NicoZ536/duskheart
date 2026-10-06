/**
 * The start request between the main menu and the game (docs/SPIEL.md §25 "Boot-Ablauf"; M7-50, M7-51).
 *
 * The menu and the running game are two boots of the page: the menu runs its own small scene session; when the player
 * starts a world, the menu writes a start request into the tab's session storage and reloads; the boot finds the request
 * and starts the game with it (the loading screen shows while the world is generated and the save read). A new world's
 * request becomes a load request of the same world once the world has its first save – reloading the tab resumes it;
 * "Zum Titel" clears the request, and the next boot is the menu again.
 *
 * - `new`: world id and name, the immutable config (seed, size, day length, resource density) and the world's first
 *   commands (`world.setSettings` before `world.setDifficulty` – Unbarmherzig would refuse the settings after it –, from
 *   M7-52 `appearance.set`), applied in the world's first tick together with `player.spawn`.
 * - `load`: a stored world; the boot reads its newest intact slot (src/save/world.ts `readNewestIntactSave`).
 * Pure parsing; the storage is injected.
 */
import { z } from 'zod';
import { DAY_LENGTH_OPTIONS } from '../../engine/time';
import { RESOURCE_DENSITIES } from '../../game/worldsettings/types';
import { U32_MAX } from '../../engine/rng';

/** Session storage key of the start request. */
export const START_REQUEST_KEY = 'duskhearth.start';

const worldConfigSchema = z
  .object({
    seed: z.number().int().min(0).max(U32_MAX),
    worldSize: z.enum(['small', 'medium', 'large']),
    dayLengthMinutes: z.literal(DAY_LENGTH_OPTIONS),
    resourceDensity: z.enum(RESOURCE_DENSITIES),
  })
  .strict();

export const startRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('new'),
      worldId: z.string().min(1),
      name: z.string().min(1),
      config: worldConfigSchema,
      /** The world's first commands (validated by the simulation when they are applied). */
      commands: z.array(z.unknown()),
    })
    .strict(),
  z.object({ kind: z.literal('load'), worldId: z.string().min(1) }).strict(),
]);
export type StartRequest = z.output<typeof startRequestSchema>;
export type NewWorldRequest = Extract<StartRequest, { kind: 'new' }>;
export type WorldConfigChoice = z.output<typeof worldConfigSchema>;

/** The part of the Web Storage API the request needs (`sessionStorage`; a map in tests). */
export interface RequestStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The pending start request, or null (none, unreadable or invalid – a broken request never blocks the menu). */
export function readStartRequest(storage: RequestStorage | null): StartRequest | null {
  if (storage === null) return null;
  let text: string | null;
  try {
    text = storage.getItem(START_REQUEST_KEY);
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    const parsed = startRequestSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Stores `request` (false when the storage refuses: private mode, quota). */
export function writeStartRequest(storage: RequestStorage | null, request: StartRequest): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(START_REQUEST_KEY, JSON.stringify(request));
    return true;
  } catch {
    return false;
  }
}

/** Removes the start request (back to the menu). */
export function clearStartRequest(storage: RequestStorage | null): void {
  try {
    storage?.removeItem(START_REQUEST_KEY);
  } catch {
    // Nothing to clear when the storage is unavailable.
  }
}

/** A fresh world id: the time of creation and the seed (unique per player and readable in a dump). */
export function newWorldId(now: number, seed: number): string {
  return `welt-${Math.max(0, Math.floor(now)).toString(36)}-${seed}`;
}

/** URL parameter that boots the menu on a debug page (`?debug=1&menue=1`, the menu's E2E tests and scenarios). */
export const MENU_PARAM = 'menue';
/** URL parameter of a debug load (`?debug=1&laden=<worldId>`, src/debug/saveLoad.ts). */
export const LOAD_PARAM = 'laden';

/** How the page boots (docs/SPIEL.md §25 "Boot-Ablauf"). */
export type BootArt =
  /** The world tools of a debug page as before M7 (`?debug=1`, `?debug=1&seed=`, screenshot scenarios). */
  | { readonly art: 'direkt' }
  /** The main menu over its scene. */
  | { readonly art: 'menue' }
  /** A new world from the menu's start request. */
  | { readonly art: 'neu'; readonly request: NewWorldRequest }
  /** A stored world; `debug`: asked for by the URL (`?laden=`), the page starts frozen at the save's tick. */
  | { readonly art: 'laden'; readonly worldId: string; readonly debug: boolean };

/**
 * How a page at `href` boots: a debug page keeps its direct boot (and `?laden=` its load), unless it asks for the menu
 * (`menue=1`) or shows a menu scenario; a start request of the tab (the menu started a world, src/ui/menu/start.ts)
 * starts that world; every other page shows the main menu. `debug`: the page has debug mode (`?debug=1`).
 */
export function bootArt(href: string, debug: boolean, request: StartRequest | null, menuScenario: (name: string) => boolean): BootArt {
  let params: URLSearchParams;
  try {
    params = new URL(href, 'http://localhost/').searchParams;
  } catch {
    params = new URLSearchParams();
  }
  if (debug) {
    const scenario = params.get('scenario');
    if (scenario !== null) return menuScenario(scenario) ? { art: 'menue' } : { art: 'direkt' };
    const load = params.get(LOAD_PARAM);
    if (load !== null && load !== '') return { art: 'laden', worldId: load, debug: true };
  }
  if (request !== null) return request.kind === 'new' ? { art: 'neu', request } : { art: 'laden', worldId: request.worldId, debug: false };
  if (debug && params.get(MENU_PARAM) !== '1') return { art: 'direkt' };
  return { art: 'menue' };
}
