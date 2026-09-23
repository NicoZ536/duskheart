# Sprite-Fixtures (M1-03 … M1-08)

Kleine Sprite-Ordner für die Asset-Tests (`tests/unit/assets/`, `tests/unit/tools/atlas*.test.ts`).
Jeder Unterordner spielt die Rolle von `assets-src/sprites/`.

- `atlas/` – gemischte Quellen für den Atlas-Build: animierte Flamme (Clip, Emissiv, doppelter Frame),
  Generator-Ergebnis (Felsen), Kugel-Busch, flache Fliese, Hilfsmodul mit `_` (wird übersprungen).
- `nutzung/quellen/` + `nutzung/src/` – ein Sprite wird in `src/` erwähnt, eines nicht (Warnung „ungenutzt“).
- `verstoesse/` – je Datei ein Paletten-Verstoß: Fremdfarbe, 13 Farben, verwaiste Einzelpixel.
- `sauber/` – erlaubte Grenzfälle: 13 Farben mit `ausnahmeFarben`, Funken mit `einzelpixel`, exakte Hexfarbe.
