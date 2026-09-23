# Tooling-Fixtures (M0-02)

Absichtliche Verstöße für `tests/unit/tooling/verbotsliste.test.ts`. Jedes Unterverzeichnis spielt die
Rolle einer Projektwurzel (`src/game/…`, `src/world/…`), damit die Verzeichnisregeln von
`eslint.config.js` und `tools/forbidden.ts` greifen.

- `verstoesse/` – jede Datei verletzt genau die Regel, die ihr Name beschreibt.
- `sauber/` – Grenzfälle, die erlaubt sind (benannte Konstanten, Content-Zahlen, X-Folgen in
  Sprite-Rastern, Interop-markiertes `any`, Uhrzeit außerhalb der Simulation).

Der reguläre Lauf von `npm run lint` und `npm run forbidden` überspringt `tests/fixtures/**`.
