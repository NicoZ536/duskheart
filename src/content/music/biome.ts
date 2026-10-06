/**
 * Which piece explores which biome (docs/SPIEL.md §24 "erkundung (Biom-Stück, Arrangement nach Tageszeit)"; MASTERPROMPT §27
 * "je Biom ein Thema mit Tag- und Nacht-Arrangement"). M7 brings the theme of the start region; until a biome has its own
 * (the task in `eigenesThema`, checked open in PROGRESS.md by tools/validator/musik.ts), it borrows Grünhain's – the
 * caves its night arrangement without the melody, a dark bed under the cave's echo.
 */
import type { MusicArrangementKind } from './schema';

export interface BiomeMusic {
  readonly stueck: string;
  /** A fixed arrangement (caves: always night); without it the time of day chooses `tag` or `nacht`. */
  readonly arrangement?: MusicArrangementKind;
  /** The melody layer stays silent (caves). */
  readonly ohneMelodie?: boolean;
  /** The task that brings the biome's own theme (until then it borrows). */
  readonly eigenesThema?: string;
}

const HOEHLE: BiomeMusic = { stueck: 'gruenhain', arrangement: 'nacht', ohneMelodie: true, eigenesThema: 'M8-28' };

/** Exploration piece per biome id (every biome of src/content/biomes.ts has one). */
export const BIOME_MUSIC: Readonly<Record<string, BiomeMusic>> = {
  gruenhain: { stueck: 'gruenhain' },
  salzkueste: { stueck: 'gruenhain', eigenesThema: 'M8-28' },
  nebelmoor: { stueck: 'gruenhain', eigenesThema: 'M8-28' },
  frostkamm: { stueck: 'gruenhain', eigenesThema: 'M8-28' },
  glutsand: { stueck: 'gruenhain', eigenesThema: 'M10-32' },
  aschenschlund: { stueck: 'gruenhain', eigenesThema: 'M10-32' },
  scherbenhain: { stueck: 'gruenhain', eigenesThema: 'M12-28' },
  nachtherz: { stueck: 'gruenhain', eigenesThema: 'M12-28' },
  wurzelhoehlen: HOEHLE,
  tiefgrund: HOEHLE,
  glutadern: HOEHLE,
};

/** The pieces of the moods that do not follow the biome. */
export const MOOD_MUSIC = { titel: 'titel', basis: 'basis', kampf: 'kampf' } as const;
