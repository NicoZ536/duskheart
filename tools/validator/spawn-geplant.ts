/**
 * Geplante Spawntabellen (MASTERPROMPT §31.4 „Jedes Biom: Spawntabellen für Tag, Nacht und Jahreszeiten“; M6-27):
 * Biome, deren Kreaturen erst ein späterer Backlog-Task liefert – ohne Kreatur keine Tabelle. Jeder Eintrag nennt
 * den Task aus PROGRESS.md und den Grund.
 *
 * Die Regel `spawn` (tools/validator/kreaturen.ts) erzwingt die Liste in beide Richtungen wie die geplanten
 * Verwendungen: ein Biom ohne Tabelle und ohne Eintrag ist ein Fehler; ist der Task abgehakt und die Tabelle fehlt noch,
 * ebenfalls; ein unbekannter Task oder ein unbekanntes Biom auch. Hat ein Biom inzwischen seine Tabelle, meldet die Regel
 * den Eintrag als veraltet (Warnung). So kann die Liste nur schrumpfen.
 */

/** Eine geplante Spawntabelle. */
export interface GeplanteSpawntabelle {
  /** Backlog-Task, der die ersten Kreaturen des Bioms liefert (PROGRESS.md). */
  readonly task: string;
  readonly grund: string;
}

/** Biom-Id → geplante Spawntabelle. */
export const GEPLANTE_SPAWNTABELLEN: Readonly<Record<string, GeplanteSpawntabelle>> = {
  // Die übrigen Biome bekommen ihre Kreaturen mit ihrem Content-Stand (§20.1); ihre Nächte trägt bis dahin keine Tabelle.
  // Die Höhlenbiome (Wurzelhöhlen, Tiefgrund, Glutadern) haben ihre Tabellen seit dem M6-Gate mit der Schattenbrut
  // (src/content/creatures/untergrund.ts, §12.4 „im Untergrund“); ihre Höhlenkreaturen tragen sich dort ein (M8-13, M8-15, M10-10).
  nebelmoor: { task: 'M8-05', grund: 'Nebelmoor-Kreaturen I (Reiher, Moorfrosch, Schildkröte)' },
  frostkamm: { task: 'M8-10', grund: 'Frostkamm-Kreaturen I (Schneehase, Schneeeule, Rentier, Wollhorn, Eisbär)' },
  glutsand: { task: 'M10-02', grund: 'Glutsand-Kreaturen I (Wüstenfuchs, Echse, Geier)' },
  aschenschlund: { task: 'M10-07', grund: 'Aschenschlund-Kreaturen I (Aschekäfer, Magmakröte, Schlackengolem, Aschefledermaus)' },
  scherbenhain: { task: 'M12-02', grund: 'Scherbenhain-Kreaturen I (Lichtmotte, Prismenhirsch, Kristallspinne, Splitterwolf)' },
  nachtherz: { task: 'M12-06', grund: 'Schattenzwilling und die Schattenbrut-Dichte des Nachtherzens' },
};
