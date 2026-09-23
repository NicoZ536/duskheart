# ARCHITEKTUR – DUSKHEARTH

Verbindliche technische Verträge. Ergänzt MASTERPROMPT §3. Änderungen nur per ADR in `docs/DECISIONS.md`.

## Schichten (ESLint erzwingt, `eslint.config.js`)
```text
engine   ← nichts aus dem Projekt (nur eigene Module)
content  ← engine
world    ← engine, content
game     ← engine, content, world
save     ← engine, content, world, game
render / audio ← Simulationsschichten (lesend), nie ui
ui, debug, i18n ← alles
```
Simulation (`engine`, `world`, `game`, `content`, `save`) läuft headless in Node: kein DOM-Zugriff zur Importzeit, keine Präsentationsimporte, kein `Math.random`, `Date.now`, `new Date(`, `performance.now` in `world`/`game`/`content` (Verbotsliste `tools/forbidden.ts`). DOM-Adapter (Input, Worker) sind in `engine` erlaubt, werden aber nur im Browser aufgerufen.

## Determinismus
- `src/engine/rng.ts`: `Rng` (sfc32, 128 bit Zustand, `getState()/setState()`), `hashString()`, `RngStreams` (je System ein benannter Stream aus Weltseed + Name; komplett serialisierbar).
- `src/engine/noise.ts`: geseedetes 2D-Simplex-/Value-Rauschen, fBm, Domain-Warp.
- Simulation läuft in festen Ticks (60 Hz). Zeit wird ausschließlich in Ticks gezählt; Echtzeit kommt nur über den Loop hinein.

## Loop (`src/engine/loop.ts`)
- `FixedStepLoop`: Akkumulator, Schritt 1/60 s, max. 5 Aufholschritte je Frame (Rest verworfen), `render(alpha)` mit Interpolationsfaktor. Zeitquelle und Frame-Scheduler werden injiziert (Browser: `performance.now` + `requestAnimationFrame`; Tests: manuell).
- Spieltempo (Barrierefreiheit 50–100 %) und Pause wirken auf den Akkumulator.

## ECS (`src/engine/ecs.ts`)
- Entität = `number` (Index 20 bit + Generation 12 bit). `Ecs.create()/destroy()/alive()`.
- Objektkomponenten: `SparseSet<T>` (dichtes Array + Sparse-Index), Iteration über das kleinste Set.
- Heiße Komponenten: `ColumnStore` mit `Float32Array`/`Int32Array`-Spalten (Position x/y, Velocity, Collider, Sprite), wachsend per Verdopplung, ohne Allokation im Hot-Loop.
- Serialisierung jeder Komponente über registrierte `serialize/deserialize` (für `src/save`).

## Events & Commands
- `src/engine/events.ts`: typisierter `EventBus<Map>` (sofort) + `EventQueue` (pro Tick gepuffert, Präsentation liest nach dem Tick).
- `src/engine/commands.ts`: generische `CommandQueue<C>`, `CommandRecorder<C>` (Tick-gestempelt) und `ReplayPlayer<C>`. Konkrete Command-Typen definiert `src/game/commands.ts`. Präsentation verändert die Simulation **nur** über Commands.

## Input (`src/engine/input/`)
- `InputState` (Tasten, Maus, Rad, Gamepad-Achsen/Knöpfe, Touch-Sticks), `Bindings` (Aktion → Eingaben, umbelegbar, serialisierbar), `ActionReader` (gedrückt / gehalten / losgelassen je Frame), DOM-Adapter `attachDomInput(target)`, Gamepad-Abfrage `pollGamepads(getter)`, Touch-Adapter. Standardbelegung nach §26.

## Welt (`src/world`)
- Kacheln 16×16 px, Chunks 32×32 Kacheln, Ebenen z ∈ {0, −1, −2, −3}. Chunkdaten als Typed Arrays (Boden, Höhe, Wand, Objekt-IDs, Flags). Chunk-Hash für Determinismustests.
- Generierung im Worker (`src/world/gen/*.worker.ts`) über die Worker-Brücke; dieselben Funktionen laufen in Node synchron (Tests).

## Content (`src/content`)
- zod-Schemas in `src/content/schema/*.ts`, Daten als typisierte TS-Module (teils per deterministischem Generator aus Tabellen), Registry mit ID-Nachschlag. Alle Texte sind i18n-Schlüssel (`item.<id>.name`, `item.<id>.desc`), Übersetzungen in `src/i18n/de.json` und `en.json`.
- Alle Balancewerte in `src/content/balance.ts` (Einheit + Begründung kommentiert).

## Speichern (`src/save`)
- Jedes System liefert `serialize(): Snapshot` / `deserialize(s)`; Roundtrip-Test je System. IndexedDB-Adapter im Browser, In-Memory-Adapter in Node. Versionierte Migrationen.

## Präsentation
- `src/render`: eigener WebGL2-Renderer (GLSL ES 3.00, `.glsl` mit `#include`), interne Höhe 270 px, Pässe nach §6.1.
- `src/audio`: Web-Audio-Graph, SFX-Synth, Sequencer; Musik-Rendering im Worker.
- `src/ui`: Preact + @preact/signals, DOM-Overlay. Weltnahe UI im WebGL-Pass.
- `src/debug`: nur mit `?debug=1` oder Entwicklermodus; `window.__dh` (Zustand lesen, Commands ausführen, Zeit einfrieren, Szenarien laden) für E2E und Screenshots.

## Werkzeuge (`tools/`)
- `tools/assets/build.ts` → `src/generated/` (Atlanten, Manifeste) + `tools/out/sheets/` (Kontaktbögen).
- `tools/forbidden.ts` Verbotsliste · `tools/validate-content.ts` Content-Validator · `tools/shot.ts` Screenshots · `tools/bench.ts` Performance.
