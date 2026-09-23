# src/world – Welt (MASTERPROMPT §3.2, §9)

Weltgenerierung, Chunks, Tiles, Biome, Zeit-/Wettersimulation (Kalender auf `GameClock`), Lichtkarte, Pfadfindung.

- Importiert nur `src/engine` und `src/content` (ESLint-Schichtregel), läuft headless in Node.
- Kein `Math.random`, `Date.now`, `new Date(`, `performance.now` (Verbotsliste), keine Magic Numbers (ESLint).
- Verträge: docs/ARCHITEKTUR.md „Welt“ und „Aktive Zone“. Erste Module entstehen mit M2.
