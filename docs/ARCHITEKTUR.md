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
- Spieltempo (Barrierefreiheit 50–100 %) und Pause wirken auf den Akkumulator. Pause hat benannte Gründe (`pause(reason)`/`resume(reason)`: `hidden` für den Tab, `debugFreeze` für `__dh.freezeTime`, später das Pausemenü); die Simulation läuft nur, solange kein Grund aktiv ist (ADR-0009).
- `beginFrame` läuft einmal je Frame vor den Ticks (auch pausiert): dort wird die Eingabe des Frames zu Commands übersetzt.

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
- zod-Schemas in `src/content/schema/*.ts`, Daten als typisierte TS-Module (teils per deterministischem Generator aus Tabellen), Registry mit ID-Nachschlag (`src/content/registry.ts`).
- Content-Texte stehen zweisprachig direkt am Datensatz: `LocalizedText = { de: string; en: string }` (zod: beide nicht leer) – Namen, Beschreibungen, Tooltips, Dialoge, Tafeln, Sprüche (ADR-0005). UI-/Systemtexte liegen als Schlüssel in `src/i18n/de.json` und `en.json`.
- Alle Balancewerte in `src/content/balance.ts` (Einheit + Begründung kommentiert).
- Zählung für §C über die Kategorie-Zuordnung jeder Sammlung (Zählregeln ADR-0006); der Validator erzwingt die Werte aus `tools/validator/zielwerte.json`, die jeder Zähl-Task anhebt (ADR-0007).

## Simulation (`src/game/sim.ts`)
- `Simulation` besitzt: `config` (Seed, Weltgröße, Schwierigkeit, Tageslänge …), `rng: RngStreams`, `ecs: Ecs`, `clock: GameClock`, `events: EventQueue<SimEventMap>`, geordnete `systems`, `tick`.
- `step(commands)`: genau ein 60-Hz-Tick. Reihenfolge: Commands anwenden (Handler-Registry je Command-Typ) → `update` aller Systeme → alle 60 Ticks `worldTick` (1 Hz) → beim Überschreiten von 06:00 `dailyTick` → `ecs.flushDestroyed()`.
- `SimSystem = { id; commands?: { [Command-Typ]: Handler }; update?(sim, dt); worldTick?(sim); dailyTick?(sim, day); save?: SaveParticipant }`. Jeder Command-Typ hat genau einen Handler (`createSimulation` prüft, dass keiner fehlt); abgelehnte Commands erzeugen ein `commandRejected`-Event. Systeme kommunizieren über Komponenten, `sim.events` und Commands – nie über Präsentationsmodule.
- `hashState()`: stabiler Hash über den kanonisch serialisierten Gesamtzustand (Determinismustests, Replays).
- `src/game/headless.ts`: `runHeadless({ seed, ticks, commands? })` für Tests, Balancing und Bench.
- `src/game/session.ts`: `GameSession` (DOM-frei) = Simulation + `InputState` + `ActionReader` + `InputCommandTranslator` (`src/game/input.ts`). Der Browser (`main.tsx`) hängt den DOM-Adapter an und ruft `beginFrame()` je Frame und `step()` je Tick (ADR-0009).
- Aktive Zone: nur Chunks um den Spieler laufen voll; ferne Chunks speichern `frozenAtTick` und holen beim Aktivieren analytisch auf (`catchUp(chunk, fromTick, toTick)` je System). Kein System setzt voraus, dass ferne Chunks tickten.

## Zeit (`src/engine/time.ts`)
- `GameClock`: zählt Ticks; Tageslänge in Echtminuten (12/24/36/48, Standard 24 → 1 Spielstunde = 1 Echtminute = 3600 Ticks). Liefert `minuteOfDay`, `hour`, `day` (ab 1), `dayFraction`, Hooks für Welt-Tick (1 Hz) und Tages-Tick (06:00). Jahreszeiten, Mond und Wetter baut `src/world/calendar.ts` darauf auf.

## Speichern-Registry (`src/save/registry.ts`)
- `SaveParticipant = { id; version; migrations?; serialize(): unknown; deserialize(data: unknown): void }`. Jedes System mit Zustand registriert genau einen Teilnehmer; `tests/unit/save/registry.test.ts` erzwingt, dass jeder registrierte Teilnehmer einen Roundtrip-Test `tests/unit/save/roundtrip/<id>.test.ts` mit `expectRoundtrip` hat.
- Der Vertrag (`src/game/participant.ts`) und die kanonische Serialisierung (`src/game/canonical.ts`) liegen im game-Layer, weil `SimSystem.save` und `hashState()` sie brauchen und `game` nicht aus `save` importieren darf; `src/save/registry.ts` und `src/save/canonical.ts` exportieren sie weiter (ADR-0008).
- `RngStreams` speichert nur Streams, die gezogen haben: Nachschlagen eines Streams (Debug, Inspektoren) ändert weder Spielstand noch `hashState()`.

## Speichern (`src/save`)
- Jedes System liefert `serialize(): Snapshot` / `deserialize(s)`; Roundtrip-Test je System. IndexedDB-Adapter im Browser, In-Memory-Adapter in Node. Versionierte Migrationen.

## Datenfluss (Input → Commands → Simulation → Events → Präsentation)
Eine Richtung, keine Abkürzungen: Die Präsentation schreibt nie Simulationszustand, die Simulation kennt keine Präsentation.
```text
Browser/Gamepad/Touch
  │ attachDomInput · pollGamepads · Touch-Adapter            (engine/input, je Frame)
  ▼
InputState ──► ActionReader.update(BindingSet, Kontext play|build|ui, Hold/Toggle)
  │ Aktionen: gedrückt · gehalten · losgelassen · Analogwert
  ▼
InputCommandTranslator: Aktion → Command (einmal je Frame in loop.beginFrame); UI-Aktionen erzeugen Commands direkt
  │ CommandQueue.push(cmd)                                    (Typen: src/game/commands.ts)
  ▼
FixedStepLoop.update (je 60-Hz-Tick, 0–5 Ticks pro Frame)
  │ CommandQueue.drainForTick(tick) ──► CommandRecorder (Sink, tick-gestempelt → Replays)
  ▼
Simulation.step: Command-Handler → Systeme (update · worldTick · dailyTick) → sim.events.push(…)
  │ EventQueue<SimEventMap>
  ▼
nach jedem Tick: Präsentation leert sim.events (Audio, Partikel, Meldungen, Chronik-Hinweise)
  │ Zustand wird nur gelesen (Komponenten, Uhr, Kalender)
  ▼
FixedStepLoop.render(alpha): Renderer interpoliert zwischen vorletztem und letztem Tick, Pixel-Snapping danach; UI liest Signals
```
- **Commands tragen Absichten, keine Ergebnisse:** „bewege in Richtung d“, „interagiere mit Entität e“, „platziere Bauteil b an (x, y)“. Ob die Absicht gelingt, entscheidet allein die Simulation im Tick; Fehlschläge kommen als Event zurück (z. B. „zu hart“, „keine Stütze in Reichweite“).
- **Zeitpunkt:** Commands eines Frames werden im ersten Tick danach angewendet. Läuft in einem Frame kein Tick (Bildrate > 60 Hz), warten sie auf den nächsten (≤ 1 Tick = 16,7 ms). Pause und `freezeTime` halten Ticks an; die Queue bleibt erhalten.
- **Replays:** Der Recorder sieht genau die gedrainten Commands mit ihrem Tick. `ReplayPlayer.feed(tick, queue)` speist sie beim selben Tick wieder ein; gleicher Seed + gleiche Command-Folge ⇒ gleicher `hashState()` (unabhängig von Bildrate und Gerät).
- **Events:** `EventQueue` ist die einzige Richtung Simulation → Präsentation. Innerhalb der Simulation koppeln sich Systeme über Komponenten, `sim.events` und Commands; `EventBus` (sofort) nur für Infrastruktur, die nicht von der Tick-Reihenfolge abhängt.
- **Debug:** `window.__dh.exec(…)` und die Konsole laufen durch dasselbe Register. Befehle, die die Welt verändern (`give`, `spawn`, `tp` …), erzeugen Commands und landen damit ebenfalls im Replay; Loop-Befehle (`freeze`, `speed`) wirken nur auf den Takt.
- **Speichern** geschieht zwischen zwei Ticks (nie mitten in `step`): jeder `SaveParticipant` serialisiert seinen Zustand; Commands in der Queue werden nicht gespeichert.

## Aktive Zone (Details zu §3.3)
- **Umfang:** Aktiv sind die Chunks (32×32 Tiles) der Ebene des Spielers im Radius *r* um den Spieler-Chunk (Balancewert in `src/content/balance.ts`). *r* ist so groß, dass Spawnring der Schattenbrut (16–40 Tiles, §12.4) und Gegnerwahrnehmung vollständig darin liegen. Deaktiviert wird erst bei Abstand > *r* + 1 (Hysterese gegen Flattern an der Grenze). Alle anderen Chunks und Ebenen sind eingefroren.
- **Global, nicht chunkgebunden** (laufen immer): `GameClock`, Kalender (Jahreszeit, Mond), Wetterautomat, Ereignisplanung (Schattenflut-Zähler, Händlerin, Finstermond), Siedlerplanung auf Basisebene.
- **Einfrieren:** Beim Verlassen der Zone speichert der Chunk `frozenAtTick`. Seine Entitäten werden nicht mehr aktualisiert (keine `update`-, `worldTick`- oder `dailyTick`-Aufrufe für ihn). Schattenbrut wird beim Einfrieren entfernt und nicht aufgeholt: Sie hat keinen dauerhaften Bestand und spawnt nach §12.4 neu.
- **Aufholen:** Beim Aktivieren ruft jedes System mit chunkgebundenem Zustand `catchUp(chunk, fromTick, toTick)` in der festen Systemreihenfolge auf – analytisch statt Tick für Tick: Wachstum zählt die überschrittenen 06:00-Grenzen (inkl. Frost- und Wasserregeln des Kalenders), Verderb multipliziert Rate × Dauer, Stationen verarbeiten `min(Eingang, Brennstoff, Dauer / Takt)` Chargen und behalten den Restfortschritt, Brände brennen ab oder erlöschen, Tiere werden aus einem RNG-Stream abgeleitet von (Weltseed, Chunk-Koordinaten, `toTick`) neu verteilt.
- **Determinismus:** `catchUp` hängt nur vom Chunk-Zustand, `fromTick`, `toTick` und den globalen Zeitreihen ab – nicht davon, wie oft oder in welcher Reihenfolge Chunks aktiviert wurden. Für deterministische Größen gilt Zerlegbarkeit: Aufholen a → c ≡ a → b, dann b → c. Integrationstests vergleichen „aktiv durchgelaufen“ mit „eingefroren + aufgeholt“ je System.
- **Speichern/Laden:** `frozenAtTick` gehört zum Chunk-Zustand. Beim Speichern erhalten aktive Chunks den aktuellen Tick als `frozenAtTick`; nach dem Laden sind zunächst alle Chunks eingefroren und die Zone um den Spieler wird regulär aktiviert.
- **Regel für Systeme:** Kein System setzt voraus, dass ferne Chunks tickten, und kein System liest Zustand eines eingefrorenen Chunks, ohne ihn vorher aufzuholen.

## Präsentation
- `src/render`: eigener WebGL2-Renderer (GLSL ES 3.00, `.glsl` mit `#include`), interne Höhe 270 px, Pässe nach §6.1.
- `src/audio`: Web-Audio-Graph, SFX-Synth, Sequencer; Musik-Rendering im Worker.
- `src/ui`: Preact + @preact/signals, DOM-Overlay. Weltnahe UI im WebGL-Pass.
- `src/debug`: nur mit `?debug=1` oder Entwicklermodus (`installDebugApiIfEnabled`); `window.__dh`: `state()` (Einstellungen, Sprache, `sim` = Tick/Tag/Uhrzeit/Entitäten), `command(cmd)` (Game-Command, zod-geprüft, nächster Tick), `exec(zeile)` (Konsole), `freezeTime`, `setSpeed`, `screenshotMode` (HUD aus + Zeit eingefroren), `readPixel(x, y)` (Pixelprobe des nächsten Frames, asynchron über Pixel-Pack-Buffer), `call(erweiterung)` (Szenarien, Tick, Bench) – für E2E und Screenshots. Szenarien (`?scenario=`) laufen immer im Screenshot-Modus.
- i18n ohne stillen Fallback: fehlende Schlüssel meldet `onMissing` (App: Konsolenfehler ⇒ E2E rot); `strict: true` wirft (Tests, Werkzeuge).

## Werkzeuge (`tools/`)
- `tools/assets/build.ts` → `src/generated/` (Atlanten, Manifeste) + `tools/out/sheets/` (Kontaktbögen).
- `tools/forbidden.ts` Verbotsliste · `tools/validate-content.ts` Content-Validator (Prüfungen in `tools/validator/checks.ts`, Zielwerte `tools/validator/zielwerte.json`) · `tools/shot.ts` Screenshots · `tools/bench.ts` Performance.
- Bench: Szenarien in `tools/bench/{sim,render}.ts`, Grenzwerte in `tools/bench/schwellwerte.json` (Budget × Marge mit Begründung je Messwert; fehlender Schwellwert = Fehler), JSON-Bericht nach `tools/out/bench/bericht.json`; `--schwellwerte <datei>` belegt mit zu engen Grenzen, dass der Lauf scheitert (`tests/integration/bench.test.ts`).

## Prüfkette (`npm run check`, §3.4)
- `tools/check.ts` führt die npm-Skripte `assets` → `typecheck` → `lint` → `forbidden` → `validate:content` → `test:unit` → `test:integration:fast` nacheinander aus, bricht beim ersten roten Schritt ab (dessen Exit-Code), druckt eine Zeittabelle und scheitert bei Gesamtlaufzeit > 180 s. `verify` = `check` → `test:integration` → `build` → `test:e2e` → `bench`.
- ESLint (`eslint.config.js`): Schichtregeln (oben), keine Browser-/Timer-Globals (`window`, `document`, `localStorage`, `setTimeout` …) in `world`/`game`/`content`/`save`, kein `any`, und `@typescript-eslint/no-magic-numbers` in `src/game/**` und `src/world/**` (§2.4): erlaubt sind nur −1, 0, 0,5, 1, 2, 10, 100, 1000 sowie Enums, Literaltypen, Klassenfeld-Startwerte, Defaults und Array-Indizes; alles andere als Balancewert in `src/content/balance.ts` oder als benannte Modulkonstante.
- Verbotsliste (`tools/forbidden.ts`): Platzhalter-Marker, `Math.random`/`Date.now`/`new Date(` in `engine`/`world`/`game`/`content`, `performance.now` in `world`/`game`/`content`; `any` nur mit `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Interop: <Grund>`; Schicht-, Globals- und Magic-Number-Regel dürfen nicht per Direktive abgeschaltet werden. `tests/fixtures/**` enthält absichtliche Verstöße und ist vom regulären Lauf ausgenommen; `tests/unit/tooling/` prüft beide Werkzeuge daran.
