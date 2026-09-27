/**
 * Pinned recipes (MASTERPROMPT §15.1 "Rezept anheften → HUD zeigt fehlende Zutaten live", §26 "rechts Aufgaben-
 * und Rezept-Tracker"; M4-08): the crafting menu and the station screens pin a recipe, the HUD's tracker shows
 * its ingredients. The list is the simulation's (`craft.pin`, saved with the game in the participant `crafting`): at
 * most `MAX_ANGEHEFTET` recipes are pinned – pinning one more lets the oldest go, so the tracker keeps its size next to
 * the minimap. The newest pin stands last.
 *
 * The crafting source of the page's bridge (src/ui/screens/handwerk/quelle.ts) binds itself here as the pin target
 * (`bindeAnheften`): `angeheftet` reads its sampled list, `anheften`/`loesen`/`umschalten` send the command through
 * it – the list follows with the next sample. Without a target (no game) nothing is pinned and pinning does nothing.
 */
import { computed, signal, type ReadonlySignal } from '@preact/signals';
import { MAX_PINNED_RECIPES } from '../../../game/crafting/state';

/** Recipes pinned at once at most (the simulation's limit: three blocks fit below the minimap at 480×270). */
export const MAX_ANGEHEFTET = MAX_PINNED_RECIPES;

/** Where the pins live: the sampled list and the command that changes it (a crafting source). */
export interface AnheftZiel {
  /** The pinned recipe ids, oldest first. */
  readonly angeheftet: ReadonlySignal<readonly string[]>;
  /** Pins (`an`) or unpins recipe `id`. */
  anheften(id: string, an: boolean): void;
}

const KEINE: readonly string[] = [];
const ziel = signal<AnheftZiel | null>(null);

/** The pinned recipe ids of the page's game, oldest first. */
export const angeheftet: ReadonlySignal<readonly string[]> = computed(() => ziel.value?.angeheftet.value ?? KEINE);

/** Makes `z` the page's pin target (the crafting source of the bridge in use); returns the function that unbinds it. */
export function bindeAnheften(z: AnheftZiel): () => void {
  if (ziel.peek() !== z) ziel.value = z;
  return () => {
    if (ziel.peek() === z) ziel.value = null;
  };
}

/** Whether recipe `id` is pinned. */
export function istAngeheftet(id: string): boolean {
  return angeheftet.peek().includes(id);
}

/** Pins recipe `id` (the simulation ignores a pinned one and lets the oldest go beyond `MAX_ANGEHEFTET`). */
export function anheften(id: string): void {
  ziel.peek()?.anheften(id, true);
}

/** Unpins recipe `id`. */
export function loesen(id: string): void {
  ziel.peek()?.anheften(id, false);
}

/** Pins or unpins recipe `id`; returns whether it is to be pinned afterwards. */
export function umschalten(id: string): boolean {
  const an = !istAngeheftet(id);
  ziel.peek()?.anheften(id, an);
  return an;
}
