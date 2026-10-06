/**
 * Boss-Regel des Content-Validators (MASTERPROMPT §20.2 „Jeder Boss: eigene Arena, Beschwörung oder Zugang, ≥ 3 Phasen,
 * eigene Kampfmusik, Intro-Titelkarte, Bosslebensbalken mit Phasenmarken, einzigartige Drops, Trophäe, Herzsplitter“, §31.4;
 * docs/SPIEL.md §22 „Validator-Regel `boss`“; M7-32, Strang F). Reine Funktion über eine Registry und die Sprite-Angaben,
 * damit Tests sie mit Fixtures aufrufen können; `runChecks()` (checks.ts) wendet sie auf den echten Content an.
 *
 * Regel `boss` (`checkBosses`), je Boss:
 * - Sprite `boss_<id>` vorhanden, 96–160 px in jeder Richtung (mehrteiliges Sprite, §20.2 „Borkenvater … 96–160 px“), mit
 *   mindestens `MIN_BOSS_CLIPS` eigenen Clips; jeder Clip, den ein Angriff nennt, ist darunter;
 * - die Arena-Vorlage (`arena`) gibt es, sie gehört dem Ortstyp `bossarena`;
 * - mindestens `MIN_BOSS_PHASES` Phasen;
 * - mindestens ein einzigartiger Drop: ein Item, dessen einzige Quelle `boss:<id>` ist;
 * - die Trophäe ist ein Item mit einem Wandmöbel-Bauteil (`wandmoebel`), der Herzsplitter ein Item mit Block `splitter`
 *   der Art `herz`;
 * - Titelkarte in DE und EN;
 * - das Musikstück `musik` gibt es (Sammlung `music`); solange es die Sammlung nicht gibt, ist das eine Warnung.
 */
import type { BossDef } from '../../src/content/bosses/schema';
import type { BuildPartDef } from '../../src/content/buildParts';
import type { ContentRegistryView } from '../../src/content/registry';
import type { ItemDef } from '../../src/content/schema/item';

/** Eigene Clips je Boss-Sprite (§20.2, docs/SPIEL.md §22 „≥ 8 eigene Clips“). */
export const MIN_BOSS_CLIPS = 8;
/** Phasen je Boss (§20.2 „≥ 3 Phasen“). */
export const MIN_BOSS_PHASES = 3;
/** Größe eines Boss-Sprites [px] (§20.2 „mehrteiliges Sprite 96–160 px“). */
export const BOSS_SPRITE_PX = { min: 96, max: 160 } as const;

/** Was die Regel von einem Sprite wissen muss. */
export interface BossSpriteInfo {
  readonly w: number;
  readonly h: number;
  readonly clips: readonly string[];
}

/** Ergebnis der Regel. */
export interface BossCheckResult {
  readonly errors: string[];
  readonly warnings: string[];
}

function records<T>(registry: ContentRegistryView, name: string): readonly T[] {
  return (registry.collections().find((c) => c.name === name)?.values() ?? []) as unknown as readonly T[];
}

function find<T>(registry: ContentRegistryView, name: string, id: string): T | undefined {
  return registry.collections().find((c) => c.name === name)?.find(id) as T | undefined;
}

/** Die Boss-Regel über `registry` mit den Sprite-Angaben `sprites` (Sprite-Id → Größe und Clips). */
export function checkBosses(registry: ContentRegistryView, sprites: ReadonlyMap<string, BossSpriteInfo>): BossCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const items = records<ItemDef>(registry, 'items');
  const hasMusic = registry.collections().some((c) => c.name === 'music');
  for (const b of records<BossDef>(registry, 'bosses')) {
    const tag = `Boss ${b.id}`;
    const sprite = sprites.get(b.sprite);
    if (sprite === undefined) errors.push(`${tag}: Sprite ${b.sprite} fehlt`);
    else {
      if (sprite.clips.length < MIN_BOSS_CLIPS) errors.push(`${tag}: Sprite ${b.sprite} hat ${sprite.clips.length} Clips, verlangt sind ≥ ${MIN_BOSS_CLIPS} eigene`);
      for (const [dim, px] of [
        ['Breite', sprite.w],
        ['Höhe', sprite.h],
      ] as const) {
        if (px < BOSS_SPRITE_PX.min || px > BOSS_SPRITE_PX.max) errors.push(`${tag}: Sprite-${dim} ${px} px außerhalb ${BOSS_SPRITE_PX.min}–${BOSS_SPRITE_PX.max} px`);
      }
      for (const p of b.phasen) for (const a of p.angriffe) if (!sprite.clips.includes(a.clip)) errors.push(`${tag}: Angriff ${p.id}/${a.id} nennt den Clip ${a.clip}, den ${b.sprite} nicht hat`);
    }
    const arena = find<{ ortstyp: string }>(registry, 'placeLayouts', b.arena);
    if (arena === undefined) errors.push(`${tag}: Arena-Vorlage ${b.arena} fehlt`);
    else if (arena.ortstyp !== 'bossarena') errors.push(`${tag}: Arena-Vorlage ${b.arena} gehört zum Ortstyp ${arena.ortstyp}, nicht bossarena`);
    if (b.phasen.length < MIN_BOSS_PHASES) errors.push(`${tag}: ${b.phasen.length} Phasen, verlangt sind ≥ ${MIN_BOSS_PHASES}`);
    const own = `boss:${b.id}`;
    const unique = b.beute.einzigartig.filter((id) => {
      const item = items.find((i) => i.id === id);
      return item !== undefined && item.quellen?.length === 1 && item.quellen[0] === own;
    });
    if (unique.length === 0) errors.push(`${tag}: kein einzigartiger Drop (ein Item mit der einzigen Quelle ${own})`);
    for (const id of b.beute.einzigartig) if (!unique.includes(id)) errors.push(`${tag}: ${id} ist nicht einzigartig – seine einzige Quelle muss ${own} sein`);
    const trophy = find<BuildPartDef>(registry, 'buildParts', b.beute.trophaee);
    if (trophy?.art !== 'wandmoebel') errors.push(`${tag}: Trophäe ${b.beute.trophaee} ist kein Wandmöbel-Bauteil`);
    const shard = items.find((i) => i.id === b.beute.herzsplitter);
    if (shard?.splitter?.art !== 'herz') errors.push(`${tag}: ${b.beute.herzsplitter} ist kein Herzsplitter (Block splitter, Art herz)`);
    if (b.titel.de.trim().length === 0 || b.titel.en.trim().length === 0) errors.push(`${tag}: Titelkarte ohne Text in DE oder EN`);
    if (!hasMusic) warnings.push(`${tag}: Musikstück ${b.musik} nicht prüfbar – die Sammlung music fehlt (Strang A, M7-05)`);
    else if (find(registry, 'music', b.musik) === undefined) errors.push(`${tag}: Musikstück ${b.musik} fehlt`);
  }
  return { errors, warnings };
}
