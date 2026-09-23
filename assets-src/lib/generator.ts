/**
 * Generator-Framework (MASTERPROMPT §5 „Generatoren“, docs/RENDER.md §1): deterministische,
 * geseedete Sprite-Erzeugung für Vielfalt (Felsen, Kronen, Tile-Varianten …). Jeder Generator hat
 * einen Namen; sein `Rng` (sfc32 aus `src/engine/rng.ts`) wird aus Seed und Name abgeleitet, damit
 * zwei Generatoren mit gleichem Seed unabhängige Folgen ziehen. Gleicher Seed + gleiche Parameter ⇒
 * identische Pixel.
 */
import { Rng, hashCombine, hashString, normalizeSeed } from '../../src/engine/rng';
import { isSprite, type Sprite } from './sprite';

/** Ergebnis eines Generatorlaufs (als Default-Export einer Sprite-Datei zulässig). */
export interface GeneratorResult {
  readonly kind: 'generator';
  readonly generator: string;
  readonly seed: number;
  readonly sprites: readonly Sprite[];
}

export interface SpriteGenerator<P> {
  readonly name: string;
  /** Erzeugt die Sprites für `seed` und `params`; wirft bei doppelten Ids. */
  generate(seed: number, params: P): GeneratorResult;
}

/** Definiert einen Generator: `run` zieht Zufall nur aus dem übergebenen `rng`. */
export function defineGenerator<P>(name: string, run: (rng: Rng, params: P) => Sprite | readonly Sprite[]): SpriteGenerator<P> {
  return {
    name,
    generate(seed: number, params: P): GeneratorResult {
      const s = normalizeSeed(seed);
      const rng = new Rng(hashCombine(s, hashString(name)));
      const out = run(rng, params);
      const sprites = isSprite(out) ? [out] : [...out];
      const ids = new Set<string>();
      for (const sp of sprites) {
        if (ids.has(sp.id)) throw new Error(`Generator ${name}: Sprite-Id ${sp.id} doppelt`);
        ids.add(sp.id);
      }
      return { kind: 'generator', generator: name, seed: s, sprites };
    },
  };
}

/** Ob ein Wert ein Generator-Ergebnis ist (Sprite-Suche). */
export function isGeneratorResult(value: unknown): value is GeneratorResult {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'generator';
}
