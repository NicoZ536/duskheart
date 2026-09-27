/**
 * M4-22 (MASTERPROMPT §16.6 "Baumodus (B) mit Kategorienleiste … und Suche", §2.1 "keine coming-soon-Menüs"): the
 * build mode's catalog is derived from the content – every build part with an item and every station set up on the
 * grid, in the category its kind names; categories without pieces are hidden; search folds case, accents and ß;
 * costs come from the piece's plain recipe, availability from the bags. Every category and every refusal reason has
 * its text in German and English.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { buildPartSpriteId } from '../../../src/content/buildParts';
import { stationSpriteId } from '../../../src/content/stations';
import { generatedAtlasModule } from '../../../src/render/assets/generated';
import { BUILD_REJECT_REASONS } from '../../../src/game/building/events';
import { emptyBags, type BagsState } from '../../../src/game/inventory/bags';
import { createI18n } from '../../../src/i18n';
import { BAU_KATEGORIEN, bauKatalog, bauKosten, eintraegeDer, kategorieVon, normalisiere, platzMit, sichtbareKategorien, sucheEintraege, vorrat, type BauEintrag } from '../../../src/ui/screens/bau/katalog';

const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });

function taschen(fill: Partial<Record<'inventar' | 'rucksackfach' | 'schnellleiste', ReadonlyArray<readonly [number, string, number]>>>): BagsState {
  const bags = emptyBags();
  const out: Record<string, unknown> = { ...bags };
  for (const [area, slots] of Object.entries(fill)) {
    const base = area === 'rucksackfach' ? new Array(4).fill(null) : [...bags[area as 'inventar']];
    for (const [i, item, count] of slots) base[i] = { item, count };
    out[area] = base;
  }
  return out as unknown as BagsState;
}

describe('Kategorien (M4-22)', () => {
  it('die zwölf Kategorien der Leiste in der Reihenfolge von §16.6, jede mit Namen auf Deutsch und Englisch', () => {
    expect(BAU_KATEGORIEN).toEqual(['fundament', 'waende', 'tueren', 'daecher', 'moebel', 'stationen', 'licht', 'lagerung', 'landwirtschaft', 'verteidigung', 'deko', 'lumen']);
    for (const k of BAU_KATEGORIEN) {
      expect(de.has(`ui.bau.kategorie.${k}`), k).toBe(true);
      expect(en.has(`ui.bau.kategorie.${k}`), k).toBe(true);
    }
    expect(de.t('ui.bau.kategorie.fundament')).toBe('Fundament/Boden');
  });

  it('Bauteilart und Möbelkategorie bestimmen die Kategorie', () => {
    expect(kategorieVon('boden', undefined)).toBe('fundament');
    expect(kategorieVon('treppe', undefined)).toBe('fundament');
    expect(kategorieVon('saeule', undefined)).toBe('waende');
    expect(kategorieVon('zaun', undefined)).toBe('waende');
    expect(kategorieVon('fenster', undefined)).toBe('tueren');
    expect(kategorieVon('falltuer', undefined)).toBe('tueren');
    expect(kategorieVon('dach', undefined)).toBe('daecher');
    expect(kategorieVon('moebel', 'bett')).toBe('moebel');
    expect(kategorieVon('moebel', 'licht')).toBe('licht');
    expect(kategorieVon('wandmoebel', 'licht')).toBe('licht');
    expect(kategorieVon('moebel', 'lager')).toBe('lagerung');
    expect(kategorieVon('moebel', 'station')).toBe('stationen');
    expect(kategorieVon('moebel', 'beet')).toBe('landwirtschaft');
    expect(kategorieVon('moebel', 'trog')).toBe('landwirtschaft');
    expect(kategorieVon('moebel', 'teppich')).toBe('deko');
    expect(kategorieVon('wandmoebel', 'bild')).toBe('deko');
    expect(kategorieVon('moebel', undefined)).toBeNull();
  });

  it('eine Kategorie ohne Teile wird nicht gezeigt (keine „coming soon"-Leisten)', () => {
    const k = bauKatalog();
    const sichtbar = sichtbareKategorien(k);
    for (const kat of BAU_KATEGORIEN) expect(sichtbar.includes(kat)).toBe(eintraegeDer(k, kat).length > 0);
    expect(sichtbar).toEqual(BAU_KATEGORIEN.filter((kat) => sichtbar.includes(kat)));
    // What M4 brings: foundations, walls, doors and windows, roofs, stations.
    for (const kat of ['fundament', 'waende', 'tueren', 'daecher', 'stationen'] as const) expect(sichtbar).toContain(kat);
    const nurWaende: BauEintrag[] = k.filter((e) => e.kategorie === 'waende');
    expect(sichtbareKategorien(nurWaende)).toEqual(['waende']);
    expect(sichtbareKategorien([])).toEqual([]);
  });
});

describe('Katalog aus dem Inhalt (M4-22)', () => {
  it('jedes Bauteil mit Gegenstand steht genau einmal darin, in Kategorie-, dann Stufenreihenfolge', () => {
    const k = bauKatalog();
    const items = CONTENT.collection('items');
    const ids = k.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of CONTENT.collection('buildParts').values()) {
      const expected = items.find(p.id) !== undefined && kategorieVon(p.art, p.kategorie) !== null;
      expect(ids.includes(p.id), p.id).toBe(expected);
    }
    for (let i = 1; i < k.length; i++) {
      const a = k[i - 1] as BauEintrag;
      const b = k[i] as BauEintrag;
      const ka = BAU_KATEGORIEN.indexOf(a.kategorie);
      const kb = BAU_KATEGORIEN.indexOf(b.kategorie);
      expect(ka < kb || (ka === kb && a.stufe <= b.stufe), `${a.id} vor ${b.id}`).toBe(true);
    }
    expect(bauKatalog()).toBe(k);
  });

  it('Wände ziehen als Linie, Böden und Dächer als Fläche; Treppe und Tor drehen, Möbel und Stationen spiegeln', () => {
    const k = new Map(bauKatalog().map((e) => [e.id, e]));
    expect(k.get('wand_holz')).toMatchObject({ kategorie: 'waende', kind: 'wand', ziehen: 'linie', drehbar: false, spiegelbar: false, source: 'bauteil' });
    expect(k.get('boden_holz')).toMatchObject({ kategorie: 'fundament', ziehen: 'flaeche' });
    expect(k.get('dach_stroh')).toMatchObject({ kategorie: 'daecher', ziehen: 'flaeche' });
    expect(k.get('tuer_holz')).toMatchObject({ kategorie: 'tueren', ziehen: 'einzeln' });
    expect(k.get('treppe_holz')?.drehbar).toBe(true);
    expect(k.get('tor_holz')?.drehbar).toBe(true);
    expect(k.get('werkbank')).toMatchObject({ kategorie: 'stationen', kind: null, source: 'station', spiegelbar: true, ziehen: 'einzeln' });
  });

  it('F bietet nur an, was sein Sprite spiegeln darf (`spiegelbar`, docs/ART.md): Möbel und Stationen danach, Strukturen nie – so zeigt die Spielansicht, was F verspricht', () => {
    const sprites = generatedAtlasModule()?.SPRITES;
    if (sprites === undefined) throw new Error('Spielatlas fehlt – npm run assets');
    const parts = CONTENT.collection('buildParts');
    let mirrorable = 0;
    for (const e of bauKatalog()) {
      const spriteId = e.source === 'station' ? stationSpriteId(e.id) : buildPartSpriteId(e.id, e.kind ?? 'moebel');
      const moebel = e.source === 'station' || e.kind === 'moebel' || e.kind === 'wandmoebel';
      expect(e.spiegelbar, e.id).toBe(moebel && sprites[spriteId]?.spiegelbar === true);
      if (e.spiegelbar) mirrorable++;
      if (e.source === 'bauteil') expect(parts.find(e.id), e.id).toBeDefined();
    }
    // Every station set up from the bags stands mirrored with F; some furniture does, some (with a handed detail) not.
    for (const e of bauKatalog().filter((x) => x.source === 'station')) expect(e.spiegelbar, e.id).toBe(true);
    expect(mirrorable).toBeGreaterThan(10);
    expect(bauKatalog().some((x) => (x.kind === 'moebel' || x.kind === 'wandmoebel') && !x.spiegelbar)).toBe(true);
  });

  it('Stationen stehen darin, außer denen, die aus der Hand brennen (Lagerfeuer), und Stationen, die Bauteile sind', () => {
    const k = bauKatalog();
    const parts = CONTENT.collection('buildParts');
    for (const s of CONTENT.collection('stations').values()) {
      const e = k.find((x) => x.id === s.id);
      if (s.brennt === true || s.nurAufwerten === true) expect(e, s.id).toBeUndefined();
      else if (CONTENT.collection('items').find(s.id) !== undefined && parts.find(s.id) === undefined) expect(e, s.id).toMatchObject({ source: 'station', b: s.groesse.b, t: s.groesse.t });
    }
  });

  it('Stufen, die nur eine Aufwertung an Ort und Stelle macht (nurAufwerten: Werkbank II), stellt niemand aus den Taschen auf – sie fehlen (Review M4 #15)', () => {
    const k = bauKatalog();
    const nurAufwerten = [...CONTENT.collection('stations').values()].filter((s) => s.nurAufwerten === true).map((s) => s.id);
    expect(nurAufwerten).toContain('werkbank_2');
    for (const id of nurAufwerten) expect(k.some((e) => e.id === id), id).toBe(false);
    // The stage below stays: Werkbank I is set up from the bags.
    expect(k.find((e) => e.id === 'werkbank')?.source).toBe('station');
  });
});

describe('Suche (M4-22)', () => {
  it('Groß-/Kleinschreibung, Akzente und ß egal; jedes Wort muss passen; Deutsch, Englisch oder die Kennung', () => {
    expect(normalisiere('Tür Straße ÉCLAIR')).toBe('tur strasse eclair');
    const k = bauKatalog();
    const ids = (q: string): string[] => sucheEintraege(k, q).map((e) => e.id);
    expect(ids('tur')).toContain('tuer_holz');
    expect(ids('TÜR')).toEqual(ids('tur'));
    expect(ids('wooden wall')).toContain('wand_holz');
    expect(ids('holz wand')).toContain('wand_holz');
    expect(ids('holz wand')).not.toContain('wand_stein');
    expect(ids('wand stein')).toContain('wand_stein');
    expect(ids('dach')).toEqual(expect.arrayContaining(['dach_stroh', 'dach_schindel']));
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
    expect(ids('gibtsnicht')).toEqual([]);
  });
});

describe('Kosten und Vorrat (M4-22)', () => {
  it('die Kosten sind die Zutaten des schlichten Rezepts `rezept_<id>` mit seiner Station', () => {
    const r = CONTENT.collection('recipes').find('rezept_wand_holz');
    if (r === undefined) throw new Error('rezept_wand_holz fehlt');
    const k = bauKosten('wand_holz');
    expect(k).not.toBeNull();
    expect(k?.station).toBe(r.station ?? null);
    expect(k?.ergebnis).toBe(r.ergebnis.anzahl);
    expect(k?.zutaten.map((z) => [z.item ?? z.gruppe, z.anzahl])).toEqual(r.zutaten.map((z) => ['item' in z ? z.item : z.gruppe, z.anzahl]));
    for (const z of k?.zutaten ?? []) expect(z.name.de.length > 0 && z.name.en.length > 0).toBe(true);
    expect(bauKosten('gibt_es_nicht')).toBeNull();
  });

  it('jedes Teil des Katalogs mit Rezept nennt mindestens eine Zutat', () => {
    for (const e of bauKatalog()) {
      const k = bauKosten(e.id);
      if (k !== null) expect(k.zutaten.length, e.id).toBeGreaterThan(0);
    }
  });

  it('Vorrat zählt die getragenen Taschen; eine Station kommt aus dem ersten Platz, der sie hält', () => {
    const bags = taschen({ inventar: [[4, 'wand_holz', 3]], schnellleiste: [[1, 'wand_holz', 2], [5, 'werkbank', 1]] });
    expect(vorrat(bags, 'wand_holz')).toBe(5);
    expect(vorrat(bags, 'boden_holz')).toBe(0);
    expect(vorrat(null, 'wand_holz')).toBe(0);
    expect(platzMit(bags, 'wand_holz')).toEqual({ bereich: 'inventar', index: 4 });
    expect(platzMit(bags, 'werkbank')).toEqual({ bereich: 'schnellleiste', index: 5 });
    expect(platzMit(bags, 'boden_holz')).toBeNull();
    expect(platzMit(null, 'werkbank')).toBeNull();
    const fach = taschen({ rucksackfach: [[2, 'werkbank', 1]], schnellleiste: [[0, 'werkbank', 1]] });
    expect(platzMit(fach, 'werkbank')).toEqual({ bereich: 'rucksackfach', index: 2 });
  });
});

describe('Texte der Ablehnungsgründe', () => {
  it('jeder Grund des Bausystems und jeder Boden-Grund der Stationen hat einen kurzen Text auf Deutsch und Englisch', () => {
    const stationGruende = ['outOfReach', 'tileBlocked', 'tileTaken', 'notAStation', 'placedElsewhere'];
    for (const r of [...BUILD_REJECT_REASONS, ...stationGruende]) {
      expect(de.has(`ui.bau.grund.${r}`), r).toBe(true);
      expect(en.has(`ui.bau.grund.${r}`), r).toBe(true);
    }
    expect(de.t('ui.bau.grund.noSupport')).toBe('Keine Stütze in Reichweite');
    expect(de.t('ui.bau.grund.blocked')).toBe('Blockiert');
    expect(de.t('ui.bau.grund.tooFar')).toBe('Zu weit');
  });
});
