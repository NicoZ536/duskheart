/**
 * M4-19 (Content-Teil): Möbel, Deko, Wandobjekte und Lichter T0–T1 (docs/SPIEL.md §8; MASTERPROMPT §16.1,
 * §16.4, §12.2). Belegt an den Daten:
 * - jede Id der §8-Liste ist ein Item – außer denen, deren Quelle erst später kommt (Hirschgeweih: Jagd M6,
 *   Kerzenständer: Wachs M8-43); dazu sieben weitere Möbel für Behaglichkeit und Raumtypen;
 * - jedes Möbel ist ein `bauteil` (zählt als `buildParts`, §C) mit genau einem Bauteil-Eintrag (Ebene Objekt
 *   oder Wandobjekt, Möbelkategorie, Betten als Schlafplatz), Wandobjekte haben ihre Aufhängehöhe;
 * - genau ein Rezept je Möbel an einer Station T0–T1 aus bekannten Items der Stufen T0–T1; die Stufe des
 *   Möbels ist mindestens die seiner Zutaten und Station, der Tauschwert liegt über dem der Zutaten;
 * - die Lichter: Radius nach §12.2, Harz als Brennstoff, Laternen wetterfest, der Kamin wärmt; ihre Sprites
 *   und die Farbvarianten gibt es.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DECORATION_CATEGORIES, PART_KIND_LAYER } from '../../../src/content/buildParts';
import { ITEMS, itemCountCategories } from '../../../src/content/items/index';
import { MOEBEL, MOEBEL_BAUTEILE, MOEBEL_FARBVARIANTEN, MOEBEL_LICHTER } from '../../../src/content/items/moebel';
import { MOEBEL_DEKO, MOEBEL_DEKO_BAUTEILE, MOEBEL_WANDHOEHE_PX } from '../../../src/content/items/moebel_deko';
import { MOEBEL_REZEPTE } from '../../../src/content/recipes/moebel';
import { INGREDIENT_GROUPS, isGroupIngredient } from '../../../src/content/recipes/index';
import { STATIONS } from '../../../src/content/stations';
import type { ItemDef } from '../../../src/content/schema/item';
import moebelSprites from '../../../assets-src/sprites/moebel/betten';
import sitz from '../../../assets-src/sprites/moebel/sitzmoebel';
import tische from '../../../assets-src/sprites/moebel/tische';
import lager from '../../../assets-src/sprites/moebel/lager';
import wand from '../../../assets-src/sprites/moebel/wand';
import lichter from '../../../assets-src/sprites/moebel/lichter';
import deko from '../../../assets-src/sprites/moebel/deko';
import varianten from '../../../assets-src/sprites/moebel/varianten';

const MEINE: readonly ItemDef[] = [...MOEBEL, ...MOEBEL_DEKO];
const TEILE = [...MOEBEL_BAUTEILE, ...MOEBEL_DEKO_BAUTEILE];
/** Items der anderen Gruppen (nach der Integration enthält ITEMS auch die Möbel selbst). */
const ALLE = new Map<string, ItemDef>([...ITEMS, ...MEINE].map((i) => [i.id, i]));
const SPRITE_IDS = new Set([moebelSprites, sitz, tische, lager, wand, lichter, deko, varianten].flat().map((s) => s.id));

/** Ids der §8-Liste, deren Quelle erst ein späterer Meilenstein liefert (Validator-Erreichbarkeit). */
const SPAETER: Readonly<Record<string, string>> = {
  hirschgeweih_wand: 'Geweih von der Jagd (M6)',
  kerzenstaender: 'Kerzen aus Wachs (M8-43)',
};
/** Weitere Möbel dieses Tasks über die §8-Liste hinaus (Behaglichkeit, Raumtypen; ≥ 70 Bauteile mit M4-12). */
const WEITERE = ['sitzkissen', 'nachttisch', 'kommode', 'wandteppich', 'blumenampel', 'schaukelpferd', 'waschzuber'];

/** Kanonische Ids aus docs/SPIEL.md §8 (Aufzählungspunkt mit dem Titel `titel`). */
function spielIds(titel: string): string[] {
  const text = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');
  const zeile = text.split('\n').find((l) => l.startsWith(`- **${titel}`));
  if (zeile === undefined) throw new Error(`docs/SPIEL.md: Zeile „${titel}“ fehlt`);
  return [...zeile.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1] ?? '');
}

function item(id: string): ItemDef {
  const i = ALLE.get(id);
  if (i === undefined) throw new Error(`Item ${id} fehlt`);
  return i;
}

describe('M4-19 Möbel, Deko, Wandobjekte und Lichter – Items', () => {
  it('jede §8-Id ist ein Item, außer den späteren Quellen; dazu die weiteren Möbel', () => {
    const kanonisch = spielIds('Möbel, Deko, Wandobjekte, Lichter T0–T1');
    expect(kanonisch.length).toBe(45);
    const ids = MEINE.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const erwartet = [...kanonisch.filter((id) => SPAETER[id] === undefined), ...WEITERE];
    expect([...ids].sort()).toEqual([...erwartet].sort());
    for (const id of Object.keys(SPAETER)) expect(kanonisch).toContain(id);
    expect(ids.length).toBe(50);
  });

  it('jedes Möbel ist ein Bauteil der Stufe T0–T1 und zählt als buildParts (§C)', () => {
    for (const i of MEINE) {
      expect(i.kategorie, i.id).toBe('bauteil');
      expect(itemCountCategories(i), i.id).toEqual(['items', 'buildParts']);
      expect(i.stufe, i.id).toBeLessThanOrEqual(1);
      expect(i.name.de.length > 0 && i.name.en.length > 0 && i.beschreibung.de.length > 20 && i.beschreibung.en.length > 20, i.id).toBe(true);
      expect(i.name.de === i.name.en && i.beschreibung.de === i.beschreibung.en, i.id).toBe(false);
    }
  });
});

describe('M4-19 Platzierung (Bauteile, §16.1, §16.4)', () => {
  it('genau ein Bauteil je Möbel: Objekt oder Wandobjekt mit Möbelkategorie', () => {
    expect(TEILE.map((t) => t.id).sort()).toEqual(MEINE.map((i) => i.id).sort());
    for (const t of TEILE) {
      expect(['moebel', 'wandmoebel'], t.id).toContain(t.art);
      expect(PART_KIND_LAYER[t.art], t.id).toBe(t.art === 'moebel' ? 'objekt' : 'wandobjekt');
      expect(t.kategorie, t.id).toBeDefined();
    }
  });

  it('Betten sind Schlafplätze; Speisesaal, Schlafraum, Trophäenhalle und Behaglichkeit haben ihre Möbel', () => {
    const kat = (k: string): string[] => TEILE.filter((t) => t.kategorie === k).map((t) => t.id);
    expect(kat('bett').sort()).toEqual(['holzbett', 'strohbett']);
    for (const t of TEILE.filter((x) => x.kategorie === 'bett')) expect(t.schlafplatz, t.id).toBe('bett');
    expect(kat('sitz').length).toBeGreaterThanOrEqual(2);
    expect(kat('tisch').length).toBeGreaterThanOrEqual(1);
    expect(kat('licht').length).toBeGreaterThanOrEqual(4);
    expect(kat('kamin')).toEqual(['kamin_stein']);
    expect(kat('trophaee')).toEqual(['trophaeenbrett']);
    // Behaglichkeit zählt einzigartige Kategorien: die Serie deckt mindestens acht ab, darunter jede Deko-Kategorie.
    const kategorien = new Set(TEILE.map((t) => t.kategorie));
    expect(kategorien.size).toBeGreaterThanOrEqual(8);
    for (const d of DECORATION_CATEGORIES) expect(kategorien.has(d), d).toBe(true);
    // Deko-Behälter sind keine Kisten: sie machen keinen Lagerraum (M4-21 bringt die echten).
    expect(kat('lager')).toEqual([]);
  });

  it('Wandobjekte haben ihre Aufhängehöhe auf der 16-px-Wand; begehbar sind nur Teppich und Sitzkissen', () => {
    const wandIds = TEILE.filter((t) => t.art === 'wandmoebel').map((t) => t.id);
    expect(Object.keys(MOEBEL_WANDHOEHE_PX).sort()).toEqual([...wandIds].sort());
    // Jedes Wandobjekt passt auf die 16-px-Wandfront (assets-src/sprites/bau/_bau.ts): Höhe + Aufhängung ≤ 16.
    const sprites = [wand, lichter].flat();
    for (const [id, h] of Object.entries(MOEBEL_WANDHOEHE_PX)) {
      const s = sprites.find((x) => x.id === `obj_${id}`);
      expect(s, id).toBeDefined();
      if (s === undefined) continue;
      const f = s.frames[0];
      let oben = s.h;
      f?.index.forEach((v, p) => {
        if (v !== 0) oben = Math.min(oben, Math.floor(p / s.w));
      });
      expect(h >= 0 && s.anchor[1] - oben + 1 + h <= 16, `${id}: ${s.anchor[1] - oben + 1} px + ${h} px`).toBe(true);
    }
    expect(TEILE.filter((t) => t.blockiert === false).map((t) => t.id).sort()).toEqual(['sitzkissen', 'teppich_stroh']);
  });
});

describe('M4-19 Rezepte (§15.1, §15.2)', () => {
  const stationen = new Map(STATIONS.map((s) => [s.id, s]));

  it('genau ein Rezept je Möbel, an einer Station T0–T1', () => {
    expect(MOEBEL_REZEPTE.map((r) => r.ergebnis.item).sort()).toEqual(MEINE.map((i) => i.id).sort());
    for (const r of MOEBEL_REZEPTE) {
      expect(r.id, r.id).toBe(`rezept_${r.ergebnis.item}`);
      expect(r.station, r.id).not.toBeNull();
      const s = stationen.get(r.station ?? '');
      expect(s, `${r.id}: Station ${String(r.station)}`).toBeDefined();
      expect(item(r.station ?? '').stufe, r.id).toBeLessThanOrEqual(1);
    }
  });

  it('nur Zutaten der Stufen T0–T1; Stufe des Möbels ≥ Zutaten und Station; Tauschwert über den Zutaten', () => {
    for (const r of MOEBEL_REZEPTE) {
      const produkt = item(r.ergebnis.item);
      let summe = 0;
      let stufe = item(r.station ?? '').stufe;
      for (const z of r.zutaten) {
        const id = isGroupIngredient(z) ? (INGREDIENT_GROUPS.find((g) => g.id === z.gruppe)?.items[0] ?? '') : z.item;
        const zutat = item(id);
        expect(zutat.stufe, `${r.id}: ${id}`).toBeLessThanOrEqual(1);
        stufe = Math.max(stufe, zutat.stufe);
        summe += zutat.tauschwert * z.anzahl;
      }
      expect(produkt.stufe, r.id).toBeGreaterThanOrEqual(stufe);
      expect(produkt.tauschwert, r.id).toBeGreaterThan(summe);
      expect(produkt.tauschwert, r.id).toBeLessThanOrEqual(Math.ceil(summe * 1.5));
    }
  });

  it('Verarbeitungsstationen brennen ihre Stücke im Chargenbetrieb (Vase im Lehmofen)', () => {
    for (const r of MOEBEL_REZEPTE) {
      const s = stationen.get(r.station ?? '');
      if (s?.art !== 'verarbeitung') continue;
      expect(r.zutaten.length, r.id).toBeLessThanOrEqual(s.verarbeitung?.eingang ?? 0);
      expect(['trocknen', 'koehlern', 'brennen', 'schmelzen'], r.id).toContain(r.dauer);
    }
    expect(MOEBEL_REZEPTE.find((r) => r.ergebnis.item === 'vase_keramik')?.station).toBe('lehmofen');
  });
});

describe('M4-19 Lichter (§12.2)', () => {
  it('genau die Licht- und Kaminmöbel sind Lichtquellen, mit Sprite und Radius nach §12.2', () => {
    const lichtMoebel = TEILE.filter((t) => t.kategorie === 'licht' || t.kategorie === 'kamin').map((t) => t.id);
    expect(MOEBEL_LICHTER.map((l) => l.item).sort()).toEqual([...lichtMoebel].sort());
    for (const l of MOEBEL_LICHTER) {
      expect(SPRITE_IDS.has(l.sprite), l.sprite).toBe(true);
      // §12.2 "Kerzen, Wandlampen, Kronleuchter 3–9", "Öllaterne 7": kleiner als das Lagerfeuer (8).
      expect(l.radius >= 3 && l.radius <= 7, l.item).toBe(true);
      const wand = TEILE.find((t) => t.id === l.item)?.art === 'wandmoebel';
      expect(l.montage, l.item).toBe(wand ? 'wand' : 'boden');
    }
  });

  it('Lampen brennen Harz (keine Quelle aus späteren Meilensteinen), Laternen sind wetterfest, der Kamin wärmt', () => {
    for (const l of MOEBEL_LICHTER.filter((x) => x.verhalten === 'lampe')) {
      expect(l.brennstoff, l.item).toBe('harz');
      expect(item('harz').stufe).toBe(0);
    }
    const glas = MOEBEL_LICHTER.filter((l) => l.item.startsWith('laterne'));
    expect(glas.length).toBe(2);
    for (const l of glas) expect(l.wetterfest, l.item).toBe(true);
    const kamin = MOEBEL_LICHTER.find((l) => l.item === 'kamin_stein');
    expect(kamin?.verhalten).toBe('feuer');
    expect(kamin?.waermeC).toBeGreaterThan(0);
    // §15.4 "Ein Lagerfeuer fasst höchstens 6 Minuten": der Kamin fasst mehr, aber keinen halben Tag.
    expect(kamin?.maxSekunden).toBeGreaterThan(360);
  });
});

describe('M4-19 Farbvarianten (§5 „Möbel-Farbvarianten“)', () => {
  it('jede Variante ist ein Sprite eines vorhandenen Möbels', () => {
    for (const [id, liste] of Object.entries(MOEBEL_FARBVARIANTEN)) {
      expect(ALLE.has(id), id).toBe(true);
      for (const v of liste) {
        expect(v.startsWith(`obj_${id}_`), v).toBe(true);
        expect(SPRITE_IDS.has(v), v).toBe(true);
      }
    }
    expect(varianten.map((s) => s.id).sort()).toEqual(Object.values(MOEBEL_FARBVARIANTEN).flat().sort());
  });
});
