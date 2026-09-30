/**
 * Kreatur-Regeln des Content-Validators (MASTERPROMPT §31.4 „Jede Kreatur: Animationen aller Zustände, Sounds, Beute,
 * Bestiarium. Jedes Biom: Spawntabellen für Tag, Nacht und Jahreszeiten“, §4.5 „jede Attacke mit lesbarer Ausholphase“,
 * §19.4 „Ausholzeit 0,3–0,8 s“; docs/SPIEL.md §11; M6-19, M6-27, M6-30). Reine Funktionen über eine Registry und die
 * Sprite-Angaben, damit Tests sie mit Fixtures aufrufen können; `runChecks()` (checks.ts) wendet sie auf den echten
 * Content an.
 *
 * Regel `kreatur` (`checkCreatures`), je Kreatur:
 * - Sprite `kreatur_<id>` mit der Zellgröße `groesse`; Clips `idle`, `move`, `hit`, `death` und `attack_<angriff>` je
 *   Angriff in allen vier Richtungen (`left` darf das gespiegelte `right` sein, wenn das Sprite spiegelbar ist);
 * - jeder Angriffs-Clip hat eine Ausholphase aus mindestens zwei Clip-Positionen, die genau `ausholzeit` dauert, und sein
 *   `schlag`-Event liegt bei `ausholzeit + anlauf` (die Telegraph-Zeit der Simulation ist die des Bildes);
 * - Nachtjäger (Gegner, Elite oder Schattenbrut, die nachts wach sind) haben leuchtende Augen (`augen`), und wer
 *   `augen` hat, hat emissive Pixel im Sprite;
 * - Sounds `laut`, `treffer`, `tod` und je Angriff sein Sound existieren als SFX-Preset;
 * - KI-Profil existiert; Beutetabelle mit der Id der Kreatur existiert (oder `ohneBeute` begründet ihr Fehlen);
 * - Bestiarium-Text und -Hinweis in DE und EN;
 * - jede Variante (§20.1 „Varianten je Biom über Palette und Modifikator“, M6-25b) nennt eine Palettenzeile, die es gibt
 *   und die mindestens eine Farbe des Sprites umfärbt (sonst sähe die Variante aus wie die Grundform);
 * - Wildtiere stehen in mindestens einer Spawntabelle (Warnung).
 * Außerdem: jede Beutetabelle gehört zu einer Kreatur; jede Falle ist ein platzierbares Item und fängt mindestens eine
 * Kreatur.
 *
 * Regel `spawn` (`checkSpawnTables`): jedes Biom hat eine Spawntabelle oder einen geplanten Eintrag mit offenem Task
 * (spawn-geplant.ts, in beide Richtungen erzwungen); jede Tabelle hat für `tag` und `nacht` in jeder Jahreszeit einen
 * Eintrag oder begründet die Lücke (`leer`); in Untergrund-Biomen gilt nur `nacht` (zu jeder Stunde), `tag` bleibt leer;
 * Kreaturen, die keine Schattenbrut sind, leben in dem Biom ihrer Tabelle.
 */
import type { ContentRecord, ContentRegistryView } from '../../src/content/registry';
import { SEASON_IDS } from '../../src/content/balance';
import { missingLanguages, looksLikeLocalizedText } from '../../src/content/schema/common';
import { ATTACK_STRIKE_EVENT, CREATURE_BASE_ACTIONS, attackClipAction, creatureSpriteId } from '../../src/content/creatures/schema';
import { taskStatus } from './items';
import type { GeplanteSpawntabelle } from './spawn-geplant';

/** Ein Clip eines Sprites, wie die Regel ihn liest (Atlas-Form). */
export interface CreatureClipInfo {
  readonly frames: readonly number[];
  readonly fps: number;
  readonly events: ReadonlyArray<{ readonly frame: number; readonly name: string }>;
}

/** Was die Regel von einem Kreatur-Sprite braucht. */
export interface CreatureSpriteInfo {
  readonly w: number;
  readonly h: number;
  readonly spiegelbar: boolean;
  /** Mindestens ein emissives Pixel. */
  readonly emissiv: boolean;
  readonly clips: Readonly<Record<string, CreatureClipInfo>>;
  /** Ausholphase je Angriffs-Clip (Clip-Name → Clip-Positionen von–bis, einschließlich), wo der Generator sie kennt. */
  readonly ausholen?: Readonly<Record<string, { readonly von: number; readonly bis: number }>>;
  /** Palettenindizes (1…64), die das Sprite in irgendeinem Frame verwendet (die Prüfung der Varianten-Zeilen). */
  readonly farben?: ReadonlySet<number>;
}

/** Palettenzeilen für die Varianten-Prüfung: Id → Abbildung (`map[i]` = Zielindex von Palettenindex i + 1). */
export type PaletteRowMaps = ReadonlyMap<string, readonly number[]>;

/** Ergebnis einer Regel. */
export interface CreatureCheckResult {
  errors: string[];
  warnings: string[];
}

/** Toleranz beim Vergleich zweier Zeiten [s]: ein halber Simulations-Tick. */
const TIME_TOLERANCE_S = 1 / 120;
/** Richtungen, in denen jeder Clip vorhanden sein muss. */
const EIGENE_RICHTUNGEN = ['down', 'up'] as const;
/** Mindestlänge einer Ausholphase [Clip-Positionen] (§4.5 „Antizipation … ≥ 2 Frames“). */
const MIN_AUSHOL_POSITIONEN = 2;

function field(record: object, key: string): unknown {
  return (record as Record<string, unknown>)[key];
}

function collection(registry: ContentRegistryView, name: string): readonly ContentRecord[] {
  return registry.collections().find((c) => c.name === name)?.values() ?? [];
}

function has(registry: ContentRegistryView, name: string, id: unknown): boolean {
  return typeof id === 'string' && registry.hasCollection(name) && registry.has(name, id);
}

function text(value: unknown, where: string, res: CreatureCheckResult): void {
  if (!looksLikeLocalizedText(value)) {
    res.errors.push(`${where} fehlt`);
    return;
  }
  for (const lang of missingLanguages(value)) res.errors.push(`${where}: Übersetzung fehlt (${lang.toUpperCase()})`);
}

/** Prüft die Clips einer Aktion in allen Richtungen. */
function checkAction(id: string, sprite: CreatureSpriteInfo, action: string, res: CreatureCheckResult): void {
  for (const dir of EIGENE_RICHTUNGEN) if (sprite.clips[`${action}_${dir}`] === undefined) res.errors.push(`Kreatur ${id}: Clip ${action}_${dir} fehlt`);
  const right = sprite.clips[`${action}_right`] !== undefined;
  const left = sprite.clips[`${action}_left`] !== undefined;
  if (!right && !left) res.errors.push(`Kreatur ${id}: Clip ${action}_right bzw. ${action}_left fehlt`);
  else if (!left && !sprite.spiegelbar) res.errors.push(`Kreatur ${id}: Clip ${action}_left fehlt und das Sprite ist nicht spiegelbar`);
  else if (!right && !sprite.spiegelbar) res.errors.push(`Kreatur ${id}: Clip ${action}_right fehlt und das Sprite ist nicht spiegelbar`);
}

/** Prüft Ausholphase und Schlagzeit eines Angriffs gegen seinen Clip (Richtung `down`). */
function checkWindup(id: string, sprite: CreatureSpriteInfo, attack: object, res: CreatureCheckResult): void {
  const name = field(attack, 'name');
  const aushol = field(attack, 'ausholzeit');
  const anlauf = field(attack, 'anlauf');
  if (typeof name !== 'string' || typeof aushol !== 'number') return;
  const clipName = `${attackClipAction(name)}_down`;
  const clip = sprite.clips[clipName];
  if (clip === undefined) return;
  const strike = clip.events.find((e) => e.name === ATTACK_STRIKE_EVENT);
  if (strike === undefined) {
    res.errors.push(`Kreatur ${id}: ${clipName} hat kein Event „${ATTACK_STRIKE_EVENT}“ (wann der Schlag trifft)`);
    return;
  }
  const strikeS = strike.frame / clip.fps;
  const expected = aushol + (typeof anlauf === 'number' ? anlauf : 0);
  if (Math.abs(strikeS - expected) > TIME_TOLERANCE_S) {
    res.errors.push(`Kreatur ${id}: Angriff ${name} schlägt im Bild nach ${strikeS.toFixed(3)} s zu, die Daten sagen ${expected.toFixed(3)} s (ausholzeit + anlauf)`);
  }
  const range = sprite.ausholen?.[clipName];
  const positions = range === undefined ? Math.round((strikeS - (typeof anlauf === 'number' ? anlauf : 0)) * clip.fps) : range.bis - range.von + 1;
  if (positions < MIN_AUSHOL_POSITIONEN) res.errors.push(`Kreatur ${id}: ${clipName} holt nur ${positions} Clip-Position(en) aus (mindestens ${MIN_AUSHOL_POSITIONEN}, §4.5)`);
  if (range !== undefined) {
    const windupS = positions / clip.fps;
    if (Math.abs(windupS - aushol) > TIME_TOLERANCE_S) res.errors.push(`Kreatur ${id}: Angriff ${name} holt im Bild ${windupS.toFixed(3)} s aus, die Daten sagen ${aushol.toFixed(3)} s`);
  }
}

/** Prüft die Varianten einer Kreatur gegen die Palettenzeilen (M6-25b). */
function checkVariants(id: string, c: object, sprite: CreatureSpriteInfo | undefined, rows: PaletteRowMaps, res: CreatureCheckResult): void {
  const list = field(c, 'varianten');
  if (!Array.isArray(list)) return;
  for (const v of list) {
    if (typeof v !== 'object' || v === null) continue;
    const vid = String(field(v, 'id'));
    const palette = field(v, 'palette');
    const map = typeof palette === 'string' ? rows.get(palette) : undefined;
    if (map === undefined) {
      res.errors.push(`Kreatur ${id}: Variante ${vid} nennt die unbekannte Palettenzeile ${String(palette)}`);
      continue;
    }
    const farben = sprite?.farben;
    if (farben !== undefined && ![...farben].some((i) => map[i - 1] !== undefined && map[i - 1] !== i)) {
      res.errors.push(`Kreatur ${id}: Variante ${vid} färbt nichts um – Palettenzeile ${String(palette)} ändert keine Farbe des Sprites`);
    }
  }
}

/**
 * Regel `kreatur` über alle Kreaturen, Beutetabellen und Fallen einer Registry (siehe Modulkommentar); `paletteRows` sind
 * die Palettenzeilen für die Varianten (ohne sie werden Varianten nicht geprüft).
 */
export function checkCreatures(registry: ContentRegistryView, sprites: ReadonlyMap<string, CreatureSpriteInfo>, paletteRows?: PaletteRowMaps): CreatureCheckResult {
  const res: CreatureCheckResult = { errors: [], warnings: [] };
  const creatures = collection(registry, 'creatures');
  const spawnMembers = new Set<string>();
  for (const table of collection(registry, 'spawnTables')) {
    for (const time of ['tag', 'nacht']) {
      const list = field(table, time);
      if (Array.isArray(list)) for (const e of list) if (typeof e === 'object' && e !== null && typeof field(e, 'kreatur') === 'string') spawnMembers.add(field(e, 'kreatur') as string);
    }
  }
  for (const c of creatures) {
    const id = c.id;
    const spriteId = creatureSpriteId(id);
    const sprite = sprites.get(spriteId);
    const attacks = field(c, 'angriffe');
    const attackList = Array.isArray(attacks) ? (attacks.filter((a) => typeof a === 'object' && a !== null) as object[]) : [];
    if (sprite === undefined) res.errors.push(`Kreatur ${id}: Sprite ${spriteId} fehlt`);
    else {
      const size = field(c, 'groesse');
      if (typeof size === 'number' && (sprite.w !== size || sprite.h !== size)) res.errors.push(`Kreatur ${id}: Sprite ${spriteId} ist ${sprite.w}×${sprite.h}, die Größe ist ${size}`);
      for (const action of CREATURE_BASE_ACTIONS) checkAction(id, sprite, action, res);
      for (const a of attackList) {
        const name = field(a, 'name');
        if (typeof name !== 'string') continue;
        checkAction(id, sprite, attackClipAction(name), res);
        checkWindup(id, sprite, a, res);
      }
      const augen = field(c, 'augen');
      if (augen !== null && augen !== undefined && !sprite.emissiv) res.errors.push(`Kreatur ${id}: leuchtende Augen (${String(augen)}) angegeben, das Sprite hat aber keine emissiven Pixel`);
    }
    const familie = field(c, 'familie');
    const aktiv = field(c, 'aktiv');
    const nachts = Array.isArray(aktiv) && aktiv.includes('nacht');
    if (nachts && familie !== 'friedlich' && (field(c, 'augen') === null || field(c, 'augen') === undefined)) res.errors.push(`Kreatur ${id}: Nachtjäger ohne leuchtende Augen (docs/ART.md §8)`);
    const sounds = field(c, 'sounds');
    for (const key of ['laut', 'treffer', 'tod']) {
      const sfx = typeof sounds === 'object' && sounds !== null ? field(sounds, key) : undefined;
      if (!has(registry, 'sfx', sfx)) res.errors.push(`Kreatur ${id}: Sound ${key} fehlt (${String(sfx)})`);
    }
    for (const a of attackList) {
      const sfx = field(a, 'sound');
      if (!has(registry, 'sfx', sfx)) res.errors.push(`Kreatur ${id}: Angriff ${String(field(a, 'name'))} ohne Sound (${String(sfx)})`);
    }
    if (!has(registry, 'aiProfiles', field(c, 'ki'))) res.errors.push(`Kreatur ${id}: KI-Profil ${String(field(c, 'ki'))} fehlt`);
    const beute = field(c, 'beute');
    if (beute === null) {
      if (typeof field(c, 'ohneBeute') !== 'string') res.errors.push(`Kreatur ${id}: keine Beutetabelle und keine Begründung (ohneBeute)`);
    } else if (beute !== id) res.errors.push(`Kreatur ${id}: die Beutetabelle heißt wie die Kreatur (${id}), nicht ${String(beute)}`);
    else if (!has(registry, 'lootTables', beute)) res.errors.push(`Kreatur ${id}: Beutetabelle ${id} fehlt`);
    const best = field(c, 'bestiarium');
    if (typeof best !== 'object' || best === null) res.errors.push(`Kreatur ${id}: Bestiarium-Eintrag fehlt`);
    else {
      text(field(best, 'text'), `Kreatur ${id}: Bestiarium-Text`, res);
      text(field(best, 'hinweis'), `Kreatur ${id}: Bestiarium-Hinweis`, res);
    }
    if (paletteRows !== undefined) checkVariants(id, c, sprite, paletteRows, res);
    if (familie !== 'schattenbrut' && !spawnMembers.has(id)) res.warnings.push(`Kreatur ${id} steht in keiner Spawntabelle`);
  }
  for (const t of collection(registry, 'lootTables')) if (!creatures.some((c) => c.id === t.id)) res.errors.push(`Beutetabelle ${t.id} gehört zu keiner Kreatur`);
  for (const trap of collection(registry, 'traps')) {
    const item = registry.hasCollection('items') && registry.has('items', trap.id) ? registry.collections().find((c) => c.name === 'items')?.find(trap.id) : undefined;
    if (item === undefined) res.errors.push(`Falle ${trap.id}: Item ${trap.id} fehlt`);
    else if (field(item, 'kategorie') !== 'platzierbar') res.errors.push(`Falle ${trap.id}: das Item ist nicht platzierbar`);
    const max = field(trap, 'groesseMax');
    const catches = creatures.some((c) => field(c, 'fangbar') === true && typeof field(c, 'groesse') === 'number' && typeof max === 'number' && (field(c, 'groesse') as number) <= max);
    if (!catches) res.errors.push(`Falle ${trap.id} fängt keine Kreatur (fangbar, höchstens ${String(max)} px)`);
  }
  return res;
}

/** Eingaben der Regel `spawn`. */
export interface SpawnCheckInput {
  readonly registry: ContentRegistryView;
  readonly geplant: Readonly<Record<string, GeplanteSpawntabelle>>;
  /** Inhalt von PROGRESS.md (Status der Tasks). */
  readonly progress: string;
}

/** Regel `spawn` (siehe Modulkommentar). */
export function checkSpawnTables(input: SpawnCheckInput): CreatureCheckResult {
  const res: CreatureCheckResult = { errors: [], warnings: [] };
  const { registry, geplant, progress } = input;
  const biomes = collection(registry, 'biomes');
  const tables = collection(registry, 'spawnTables');
  const creatures = new Map(collection(registry, 'creatures').map((c) => [c.id, c]));
  for (const b of biomes) {
    const table = tables.find((t) => t.id === b.id);
    const plan = geplant[b.id];
    if (table !== undefined) {
      if (plan !== undefined) res.warnings.push(`Geplante Spawntabelle für ${b.id} (${plan.task}) ist veraltet: das Biom hat seine Tabelle – Eintrag in tools/validator/spawn-geplant.ts streichen`);
      continue;
    }
    if (plan === undefined) {
      res.errors.push(`Biom ${b.id}: keine Spawntabelle (Tag, Nacht, Jahreszeiten) und kein geplanter Eintrag`);
      continue;
    }
    const status = taskStatus(progress, plan.task);
    if (status === null) res.errors.push(`Biom ${b.id}: geplante Spawntabelle nennt unbekannten Task ${plan.task}`);
    else if (status === 'erledigt') res.errors.push(`Biom ${b.id}: Spawntabelle war mit ${plan.task} geplant (${plan.grund}), der Task ist erledigt – die Tabelle fehlt aber`);
  }
  for (const id of Object.keys(geplant)) if (!biomes.some((b) => b.id === id)) res.errors.push(`Geplante Spawntabelle für unbekanntes Biom ${id}`);
  for (const t of tables) {
    const biome = biomes.find((b) => b.id === t.id);
    const underground = biome !== undefined && typeof field(biome, 'layer') === 'number' && (field(biome, 'layer') as number) < 0;
    const leer = field(t, 'leer');
    const reason = (time: string): boolean => typeof leer === 'object' && leer !== null && typeof field(leer, time) === 'string';
    for (const time of underground ? ['nacht'] : ['tag', 'nacht']) {
      const list = field(t, time);
      const entries = Array.isArray(list) ? (list as object[]) : [];
      for (const season of SEASON_IDS) {
        const covered = entries.some((e) => {
          const seasons = field(e, 'jahreszeiten');
          return seasons === undefined || (Array.isArray(seasons) && seasons.includes(season));
        });
        if (!covered && !reason(time)) res.errors.push(`Spawntabelle ${t.id}: ${time} im ${season} ohne Kreatur und ohne Begründung (leer.${time})`);
      }
    }
    if (underground) {
      const tag = field(t, 'tag');
      if (Array.isArray(tag) && tag.length > 0) res.errors.push(`Spawntabelle ${t.id}: im Untergrund gibt es keinen Tag – die Einträge gehören nach nacht (gilt zu jeder Stunde)`);
    }
    for (const time of ['tag', 'nacht']) {
      const list = field(t, time);
      for (const e of Array.isArray(list) ? (list as object[]) : []) {
        const cid = field(e, 'kreatur');
        const c = typeof cid === 'string' ? creatures.get(cid) : undefined;
        if (c === undefined) continue;
        const lives = field(c, 'biome');
        if (field(c, 'familie') !== 'schattenbrut' && !(Array.isArray(lives) && lives.includes(t.id))) res.errors.push(`Spawntabelle ${t.id}: ${String(cid)} lebt nicht in ${t.id} (biome)`);
      }
    }
  }
  return res;
}
