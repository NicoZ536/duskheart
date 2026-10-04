/**
 * Platzwahl der Kreatur- und Kampfbilder (M6-Gate-Bildprüfung: graue Wölfe auf grauem Pflaster in `kreaturen-gruenhain-gegner`
 * und `kampf-tag`, die Robbe unter einem Strandhaferbüschel und eine Möwe daran geklebt in `kreaturen-kueste`, der
 * Geschossschatten im Klippen- und Kronenschatten in `brandflasche`/`geschosse`, die Finstermond-Brut nicht paarweise
 * gegenüber, die formende Brut außerhalb des Fackellichts, die kleinen Tiere im Dunkeln; src/debug/kreaturenGruenhain.ts,
 * kreaturenKueste.ts, kampfScenarios.ts):
 * - auf Wunsch steht die Besetzung auf dem Grund des Bioms, nicht auf dem Erbauer-Pflaster – ein Rudel mit seinen Nachbarfeldern;
 * - an der Küste hält ein Bild die acht Felder um jede Landrolle frei von Büschen und Steinen;
 * - eine gespiegelte Rolle steht genau spiegelbildlich zu ihrer Partnerin, sonst findet die Stelle keinen Platz;
 * - die Ziele eines Wurfs oder Schusses liegen im Freien: kein Baum und keine Stufe in ihrer Nähe;
 * - die Bilder selbst: formende Brut und kleine Tiere im Fackelkern, die Finstermond-Brut gespiegelt, Pflaster und Stockräumen
 *   wo das Bild sie braucht.
 */
import { describe, expect, it } from 'vitest';
import { inTheOpen, openSpot, openTile } from '../../../src/debug/kampfScenarios';
import { goodSpot, gruenhainPicture, type Role as GruenhainRole } from '../../../src/debug/kreaturenGruenhain';
import { castPlaces, coastPicture, roleGround, type Role as CoastRole } from '../../../src/debug/kreaturenKueste';
import { PAVED_GROUND } from '../../../src/debug/scenarioCreatures';

/** A small world for the spot searches: grass on level 0 everywhere, with the exceptions a test sets. */
class World {
  private readonly ground = new Map<string, { terrain: string; level: number; water: boolean; solid: boolean }>();
  private readonly objects = new Map<string, string>();

  set(x: number, y: number, g: Partial<{ terrain: string; level: number; water: boolean; solid: boolean }>): this {
    this.ground.set(`${x},${y}`, { ...this.groundAt(x, y), ...g });
    return this;
  }

  object(x: number, y: number, id: string): this {
    this.objects.set(`${x},${y}`, id);
    return this;
  }

  groundAt(x: number, y: number): { terrain: string; level: number; water: boolean; solid: boolean } {
    return this.ground.get(`${x},${y}`) ?? { terrain: 'gras', level: 0, water: false, solid: false };
  }

  objectAt(x: number, y: number): string {
    return this.objects.get(`${x},${y}`) ?? '';
  }
}

const PAVED = PAVED_GROUND[0] as string;

describe('Grund der Besetzung (kreaturenGruenhain.ts goodSpot)', () => {
  const cast: GruenhainRole[] = [
    { creature: 'keiler', dx: 4, dy: -2 },
    { creature: 'wolf', dx: 2, dy: 3, count: 3 },
  ];

  it('Pflaster unter einer Rolle schließt die Stelle nur aus, wenn das Bild den Grund des Bioms verlangt', () => {
    const w = new World().set(4, -2, { terrain: PAVED });
    expect(goodSpot(w, 0, 0, cast, false)).toBe(true);
    expect(goodSpot(w, 0, 0, cast, true)).toBe(false);
    expect(goodSpot(new World(), 0, 0, cast, true)).toBe(true);
  });

  it('ein Rudel braucht auch seine acht Nachbarfelder auf dem Grund des Bioms, eine einzelne Rolle nicht', () => {
    expect(goodSpot(new World().set(3, 4, { terrain: PAVED }), 0, 0, cast, true)).toBe(false);
    expect(goodSpot(new World().set(5, -1, { terrain: PAVED }), 0, 0, cast, true)).toBe(true);
  });
});

describe('Küstenrollen (kreaturenKueste.ts roleGround, castPlaces)', () => {
  const seal: CoastRole = { creature: 'robbe', dx: -6, dy: 1 };

  it('ein Büschel neben einer Landrolle schließt ihr Feld aus, wenn das Bild es freihält', () => {
    const w = new World().object(-6, 0, 'strandhafer');
    expect(roleGround(w, -6, 1, seal, 0)).toBe(true);
    expect(roleGround(w, -6, 1, seal, 0, { plantFree: true })).toBe(false);
    // Over the slack the role finds the nearest free tile instead.
    const places = castPlaces(w, 0, 0, [seal], 2, { plantFree: true });
    expect(places).not.toBe(false);
    const p = (places as { tx: number; ty: number }[])[0];
    expect(p).toBeDefined();
    expect(Math.max(Math.abs((p?.tx ?? 0) + 6), Math.abs((p?.ty ?? 0) - 1))).toBeLessThanOrEqual(2);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(w.objectAt((p?.tx ?? 0) + dx, (p?.ty ?? 0) + dy)).toBe('');
    // Without slack it finds none.
    expect(castPlaces(w, 0, 0, [seal], 0, { plantFree: true })).toBe(false);
  });

  it('eine gespiegelte Rolle steht genau spiegelbildlich zu ihrer Partnerin über die Spalte des Spielers', () => {
    const cast: CoastRole[] = [
      { creature: 'schleicher', dx: -4, dy: -2 },
      { creature: 'schleicher', dx: 4, dy: -2, mirrorOf: 0 },
    ];
    // The left spot is taken by a stone: the left role slips by one, the right one follows it mirrored (not to its own plan).
    const w = new World().object(10 - 4, 5 - 2, 'stein');
    const places = castPlaces(w, 10, 5, cast.map((c) => ({ ...c })), 1) as { tx: number; ty: number }[];
    expect(places).toHaveLength(2);
    const [l, r] = places as [{ tx: number; ty: number }, { tx: number; ty: number }];
    expect(l).not.toEqual({ tx: 6, ty: 3 });
    expect(r.ty).toBe(l.ty);
    expect(r.tx - 10).toBe(10 - l.tx);
    expect(r).not.toEqual({ tx: 14, ty: 3 });
    // When the mirrored tile is not open, the spot finds no place – no uneven comparison.
    const blocked = new World().object(10 + 4, 5 - 2, 'stein').object(10 + 3, 5 - 2, 'stein').object(10 + 5, 5 - 2, 'stein');
    const both = castPlaces(blocked, 10, 5, cast, 0);
    expect(both).toBe(false);
  });
});

describe('Ziele im Freien (kampfScenarios.ts)', () => {
  it('Pflaster zählt nur mit `natural` als verschlossen', () => {
    const w = new World().set(2, 0, { terrain: PAVED });
    expect(openTile(w, 2, 0, 0)).toBe(true);
    expect(openTile(w, 2, 0, 0, true)).toBe(false);
    expect(openSpot(w, 0, 0, [[3, 0]], undefined, { natural: true })).toBe(false);
    expect(openSpot(w, 0, 0, [[0, 3]], undefined, { natural: true })).toBe(true);
  });

  it('auf der Wiese gehören Büschel und Funde dazu: nur am Ende eines Weges und als Baumkrone versperren sie', () => {
    const tuft = new World().object(2, 0, 'grasbueschel');
    expect(openTile(tuft, 2, 0, 0)).toBe(false);
    expect(openTile(tuft, 2, 0, 0, true, false)).toBe(true);
    expect(openTile(tuft, 2, 0, 0, true, true)).toBe(false);
    expect(openSpot(tuft, 0, 0, [[4, 0]], undefined, { natural: true })).toBe(true);
    expect(openSpot(tuft, 0, 0, [[4, 0]], undefined, {})).toBe(false);
    // A tree two tiles south of a way tile spreads its crown over it.
    const tree = new World().object(2, 2, 'baum_eiche');
    expect(openTile(tree, 2, 0, 0, true, false)).toBe(false);
  });

  it('kein Baum und keine Stufe nahe dem Weg eines Geschosses', () => {
    expect(inTheOpen(new World(), 0, 0, 0, 3)).toBe(true);
    // A tree three tiles off (straight line) is too near, one beyond is not.
    expect(inTheOpen(new World().object(3, 0, 'baum_eiche'), 0, 0, 0, 3)).toBe(false);
    expect(inTheOpen(new World().object(3, 1, 'baum_eiche'), 0, 0, 0, 3)).toBe(true);
    // A bush is no tree; a cliff (another level) is too near.
    expect(inTheOpen(new World().object(1, 1, 'busch_beeren'), 0, 0, 0, 3)).toBe(true);
    expect(inTheOpen(new World().set(0, -2, { level: 1 }), 0, 0, 0, 3)).toBe(false);
    // In the spot search: on the way to the target, not for the cast.
    const cliff = new World().set(3, -4, { level: 1 });
    expect(openSpot(cliff, 0, 0, [[1, -3]], undefined, { openAround: 3 }, [[1, -3]])).toBe(false);
    expect(openSpot(cliff, 0, 0, [[1, -3]], undefined, {}, [[1, -3]])).toBe(true);
  });
});

describe('Die Bilder', () => {
  /** Straight-line distance of a role's planned spot from the player [tiles]. */
  const dist = (r: { dx: number; dy: number }): number => Math.hypot(r.dx, r.dy);

  it('die formende Brut steht im Kern des Fackellichts, nacheinander erschienen, und der Bestand ist geräumt', () => {
    const p = coastPicture('schattenbrut-materialisierung');
    expect(p?.torch).toBe(true);
    expect(p?.clearStock).toBe(true);
    // On their planned spots (no slack onto the tiles beside the player), one in each quarter round it.
    expect(p?.slack).toBe(0);
    for (const r of p?.cast ?? []) expect(dist(r), r.creature).toBeLessThanOrEqual(2.3);
    for (const r of p?.cast ?? []) expect(dist(r), r.creature).toBeGreaterThanOrEqual(2);
    expect(new Set((p?.cast ?? []).map((r) => `${Math.sign(r.dx)},${Math.sign(r.dy)}`)).size).toBe(4);
    const delays = new Set((p?.cast ?? []).map((r) => r.delay ?? 0));
    expect(delays.size).toBeGreaterThanOrEqual(3);
    for (const d of delays) expect(d).toBeLessThan(p?.steps ?? 0);
  });

  it('die Finstermond-Brut steht rechts spiegelbildlich zur gewöhnlichen links', () => {
    const cast = coastPicture('schattenbrut-finstermond')?.cast ?? [];
    const right = cast.filter((r) => r.finster === true);
    expect(right).toHaveLength(3);
    for (const r of right) {
      const partner = cast[r.mirrorOf ?? -1];
      expect(partner?.creature).toBe(r.creature);
      expect(partner?.finster).toBeUndefined();
      expect(partner?.dx).toBe(-r.dx);
      expect(partner?.dy).toBe(r.dy);
    }
  });

  it('an der Küste bleiben die Nachbarfelder frei, in Grünhain stehen Gegner und kleine Tiere auf der Wiese, die kleinen im Fackellicht', () => {
    expect(coastPicture('kreaturen-kueste')?.plantFree).toBe(true);
    const foes = gruenhainPicture('kreaturen-gruenhain-gegner');
    expect(foes?.naturalGround).toBe(true);
    expect(foes?.clearStock).toBe(true);
    const small = gruenhainPicture('kreaturen-gruenhain-klein');
    expect(small?.torch).toBe(true);
    expect(small?.naturalGround).toBe(true);
    for (const r of small?.cast ?? []) {
      if (r.creature === 'gluehwuermchen') expect(dist(r), 'Glühwürmchen draußen im Dunkeln').toBeGreaterThan(4);
      else expect(dist(r), r.creature).toBeLessThanOrEqual(2.3);
    }
    // The pictures approved as they are keep their rules.
    expect(gruenhainPicture('kreaturen-gruenhain-lauer')?.naturalGround).toBeUndefined();
    expect(gruenhainPicture('kreaturen-gruenhain-gegner-nacht')?.clearStock).toBeUndefined();
  });
});
