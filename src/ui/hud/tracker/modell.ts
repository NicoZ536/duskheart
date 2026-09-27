/**
 * The recipe tracker's content as plain data (MASTERPROMPT §15.1 "Rezept anheften → HUD zeigt fehlende Zutaten
 * live", §26 "rechts Aufgaben- und Rezept-Tracker"; M4-08), unit tested in tests/unit/ui/tracker-modell.test.ts:
 * per pinned recipe the product, each ingredient with what is at hand (bags and chests in reach, like crafting
 * takes it) against what one craft needs, whether all is there, the station it needs – with whether one is within
 * reach – and, for a recipe made by the water (`umgebung: 'wasser'`, filling a bucket), whether water is within reach.
 * A missing ingredient carries its solution hint ("herstellbar am Sägebock"; for things found in the world only the
 * kind, "Sammeln in der Welt" – one short line next to the minimap). A plate is ready ("Alles da") once ingredients,
 * station and water are all there.
 */
import type { I18n } from '../../../i18n';
import { loesungsHinweis, ortSchluessel, rezeptName, zutatZeilen, type RezeptKontext } from '../../screens/handwerk/modell';
import type { VorratStand } from '../../screens/handwerk/quelle';

/** One ingredient line of the tracker. */
export interface TrackerZeile {
  readonly key: string;
  readonly name: string;
  readonly hat: number;
  readonly braucht: number;
  /** How to get it when pieces are missing, else `null`. */
  readonly hinweis: string | null;
}

/** One pinned recipe. */
export interface TrackerBlock {
  readonly id: string;
  readonly name: string;
  /** Product item (icon). */
  readonly produkt: string;
  readonly zeilen: readonly TrackerZeile[];
  /** Every ingredient of one craft is at hand. */
  readonly zutatenDa: boolean;
  /** The station it needs ("am Sägebock") and whether one is within reach; `null` for hand recipes. */
  readonly station: { readonly ort: string; readonly daHand: boolean } | null;
  /** For a recipe made by the water: whether water is within reach; `null` otherwise. */
  readonly wasser: { readonly da: boolean } | null;
  /** Ingredients, station and water: all there. */
  readonly bereit: boolean;
}

/** The blocks of the pinned recipes `pins` (unknown ids left out), in pin order. */
export function trackerBloecke(i18n: I18n, ctx: RezeptKontext, pins: readonly string[], vorrat: VorratStand, sichtbar: ReadonlySet<string>): TrackerBlock[] {
  const out: TrackerBlock[] = [];
  for (const id of pins) {
    const recipe = ctx.book.find(id);
    if (recipe === undefined) continue;
    const produkt = ctx.book.catalog.get(recipe.ergebnis.item);
    const zeilen = zutatZeilen(ctx, id, 1, vorrat, i18n.lang).map((z) => {
      const item = z.gruppe ? (ctx.book.group(z.key)?.items[0] ?? z.key) : z.key;
      return { key: z.key, name: z.name, hat: z.hat, braucht: z.braucht, hinweis: z.fehlt > 0 ? loesungsHinweis(i18n, ctx, item, sichtbar, 0) : null };
    });
    const station = recipe.station === null ? null : { ort: i18n.t(ortSchluessel(recipe.station)), daHand: vorrat.stationAnHand(recipe.station) !== null };
    const wasser = recipe.umgebung === 'wasser' ? { da: vorrat.amWasser } : null;
    const zutatenDa = zeilen.every((z) => z.hat >= z.braucht);
    const bereit = zutatenDa && (station === null || station.daHand) && (wasser === null || wasser.da);
    out.push({ id, name: rezeptName(recipe, produkt, i18n.lang), produkt: produkt.id, zeilen, zutatenDa, station, wasser, bereit });
  }
  return out;
}
