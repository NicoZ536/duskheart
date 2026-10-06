/**
 * Musik-Regel des Content-Validators (MASTERPROMPT §27 „je Biom ein Thema mit Tag- und Nacht-Arrangement … Stinger …“, §C
 * „Musikstücke“; docs/SPIEL.md §24, §29; M7-05, M7-31 – Strang A). Reine Funktion über eine Registry und den Text von
 * PROGRESS.md, damit Tests sie mit Fixtures aufrufen können; `runChecks()` (checks.ts) wendet sie auf den echten Content an.
 *
 * Regel `musik` (`checkMusic`):
 * - jedes Biom (`biomes`) hat einen Eintrag in `BIOME_MUSIC`; sein Stück gibt es (Sammlung `music`), es zählt (§C), und es
 *   hat das Arrangement, das der Eintrag verlangt (`tag` und `nacht`, oder das feste);
 * - ein Biom ohne eigenes Thema nennt den Task, der es bringt (`eigenesThema`), und der ist in PROGRESS.md noch offen –
 *   ist er erledigt, muss der Eintrag auf das eigene Stück zeigen;
 * - die Stücke der Stimmungen (`MOOD_MUSIC`: Titel, Basis, Kampf) gibt es und sie zählen;
 * - jeder Stinger (`stingers`) spielt ein Stück, das nicht zählt und einmal spielt; jedes Ereignis von `STINGER_EVENTS`
 *   nennt einen Stinger;
 * - jedes Lied (`songs`) spielt ein Stück, das nicht zählt und schleift; sein Instrument ist ein Item mit Block
 *   `instrument`, das das Lied kennt; jedes Lied eines Instruments gibt es und gehört diesem Instrument.
 */
import type { ContentRegistryView } from '../../src/content/registry';
import type { ItemDef } from '../../src/content/schema/item';
import type { MusicPiece, SongDef, StingerDef } from '../../src/content/music/schema';
import { BIOME_MUSIC, MOOD_MUSIC } from '../../src/content/music/biome';
import { STINGER_EVENTS } from '../../src/audio/music/stingers';
import { taskStatus } from './items';

/** Ergebnis der Regel. */
export interface MusicCheckResult {
  readonly errors: string[];
  readonly warnings: string[];
}

function records<T>(registry: ContentRegistryView, name: string): readonly T[] {
  return (registry.collections().find((c) => c.name === name)?.values() ?? []) as unknown as readonly T[];
}

function find<T>(registry: ContentRegistryView, name: string, id: string): T | undefined {
  return registry.collections().find((c) => c.name === name)?.find(id) as T | undefined;
}

/** Ob das Stück einmal spielt (Stinger) – sonst schleift es. */
function playsOnce(p: MusicPiece): boolean {
  return p.arrangements.every((a) => a.loopAb >= a.folge.length);
}

/** Die Musik-Regel über `registry` mit dem Text von PROGRESS.md (`progress`). */
export function checkMusic(registry: ContentRegistryView, progress: string): MusicCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const piece = (id: string): MusicPiece | undefined => find<MusicPiece>(registry, 'music', id);

  for (const biome of records<{ id: string }>(registry, 'biomes')) {
    const m = BIOME_MUSIC[biome.id];
    const tag = `Biom ${biome.id}`;
    if (m === undefined) {
      errors.push(`${tag}: kein Eintrag in BIOME_MUSIC (src/content/music/biome.ts)`);
      continue;
    }
    const p = piece(m.stueck);
    if (p === undefined) {
      errors.push(`${tag}: Musikstück ${m.stueck} fehlt`);
      continue;
    }
    if (!p.zaehlt) errors.push(`${tag}: Musikstück ${m.stueck} zählt nicht (Stinger oder Lied)`);
    const needed = m.arrangement === undefined ? (['tag', 'nacht'] as const) : [m.arrangement];
    for (const art of needed) if (!p.arrangements.some((a) => a.art === art)) errors.push(`${tag}: Musikstück ${m.stueck} hat kein Arrangement ${art}`);
    if (m.eigenesThema !== undefined) {
      const status = taskStatus(progress, m.eigenesThema);
      if (status === null) errors.push(`${tag}: leiht ${m.stueck}; Task ${m.eigenesThema} für das eigene Thema fehlt in PROGRESS.md`);
      else if (status === 'erledigt') errors.push(`${tag}: Task ${m.eigenesThema} ist erledigt, das Biom leiht aber noch ${m.stueck}`);
    } else if (m.stueck !== biome.id) warnings.push(`${tag}: spielt ${m.stueck} ohne Task für ein eigenes Thema`);
  }

  for (const [mood, id] of Object.entries(MOOD_MUSIC)) {
    const p = piece(id);
    if (p === undefined) errors.push(`Stimmung ${mood}: Musikstück ${id} fehlt`);
    else if (!p.zaehlt) errors.push(`Stimmung ${mood}: Musikstück ${id} zählt nicht`);
  }

  const stingers = records<StingerDef>(registry, 'stingers');
  const stingerIds = new Set(stingers.map((s) => s.id));
  for (const s of stingers) {
    const p = piece(s.stueck);
    if (p === undefined) errors.push(`Stinger ${s.id}: Musikstück ${s.stueck} fehlt`);
    else {
      if (p.zaehlt) errors.push(`Stinger ${s.id}: Musikstück ${s.stueck} zählt als Musikstück (Stinger zählen nicht)`);
      if (!playsOnce(p)) errors.push(`Stinger ${s.id}: Musikstück ${s.stueck} schleift (ein Stinger spielt einmal)`);
    }
  }
  for (const [event, id] of Object.entries(STINGER_EVENTS)) if (!stingerIds.has(id)) errors.push(`Ereignis ${event}: Stinger ${id} fehlt`);

  const items = new Map(records<ItemDef>(registry, 'items').map((i) => [i.id, i]));
  const songs = records<SongDef>(registry, 'songs');
  const songById = new Map(songs.map((s) => [s.id, s]));
  for (const s of songs) {
    const p = piece(s.stueck);
    if (p === undefined) errors.push(`Lied ${s.id}: Musikstück ${s.stueck} fehlt`);
    else {
      if (p.zaehlt) errors.push(`Lied ${s.id}: Musikstück ${s.stueck} zählt als Musikstück (Lieder zählen nicht)`);
      if (playsOnce(p)) errors.push(`Lied ${s.id}: Musikstück ${s.stueck} schleift nicht (ein Lied klingt, solange gespielt wird)`);
    }
    const inst = items.get(s.instrument);
    if (inst?.instrument === undefined) errors.push(`Lied ${s.id}: Instrument ${s.instrument} ist kein Item mit Block instrument`);
    else if (!inst.instrument.lieder.includes(s.id)) errors.push(`Lied ${s.id}: Instrument ${s.instrument} kennt das Lied nicht`);
  }
  for (const item of items.values()) {
    if (item.instrument === undefined) continue;
    if (item.instrument.lieder.length === 0) errors.push(`Instrument ${item.id}: kennt kein Lied`);
    for (const id of item.instrument.lieder) {
      const s = songById.get(id);
      if (s === undefined) errors.push(`Instrument ${item.id}: Lied ${id} fehlt (Sammlung songs)`);
      else if (s.instrument !== item.id) errors.push(`Instrument ${item.id}: Lied ${id} gehört ${s.instrument}`);
    }
  }
  return { errors, warnings };
}
