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
- `Simulation` besitzt: `config` (Seed, Weltgröße, Schwierigkeit, Tageslänge …), `rng: RngStreams`, `ecs: Ecs`, `clock: GameClock`, `events: EventQueue<SimEventMap>`, geordnete `systems`, `tick` und – über `createSimulation` angehängt – `world: SimWorld` (Abschnitt „Welt in der Simulation“).
- `step(commands)`: genau ein 60-Hz-Tick. Reihenfolge: Commands anwenden (Handler-Registry je Command-Typ) → `update` aller Systeme → alle 60 Ticks `worldTick` (1 Hz) → beim Überschreiten von 06:00 `dailyTick` → `ecs.flushDestroyed()`.
- `skipTicks(n)` (Zeitsprung der Debug-Commands `setTime`, `advanceTime`, `setSeason`, ADR-0026): die Uhr springt vorwärts (`GameClock.skip`), jedes übersprungene 06:00 löst ein `dailyTick`-Ereignis und `dailyTick` der globalen Systeme aus; die Welt friert vorher ihre Aktive Zone ein, deren Chunks holen beim Wiederaktivieren im selben Tick analytisch auf. Zeit läuft nie rückwärts.
- `SimSystem = { id; commands?: { [Command-Typ]: Handler }; update?(sim, dt); worldTick?(sim); dailyTick?(sim, day); catchUp?(chunk, fromTick, toTick); timeScope?: 'global'; save?: SaveParticipant; stateDigest?(): string }`. Jeder Command-Typ hat genau einen Handler (`createSimulation` prüft, dass keiner fehlt); abgelehnte Commands erzeugen ein `commandRejected`-Event. Systeme kommunizieren über Komponenten, `sim.events` und Commands – nie über Präsentationsmodule. Ein zeitabhängiges System (mit `update`/`worldTick`/`dailyTick`) ist entweder chunkgebunden (`catchUp`) oder global (`timeScope: 'global'`); `createSimulation` versiegelt die Aufhol-Registry gegen die Systemliste und wirft `CatchUpCoverageError` für jedes unerklärte, ein später hinzugefügtes nicht-globales zeitabhängiges System scheitert beim nächsten Tick.
- `createSimulation(config, options?)` (`src/game/setup.ts`) registriert in fester Reihenfolge `world-chunks` (Aktive Zone, zuerst), `motion`, `calendar`, `weather-regions`, `temperature`; `options` reicht die Welt aus dem Welt-Worker und die Job-Queue des Streamings durch (`SimWorldOptions`).
- `hashState()`: stabiler Hash über den kanonisch serialisierten Gesamtzustand – alle Save-Teilnehmer plus die `stateDigest`s der Systeme (Zustand außerhalb des Snapshots, heute die Chunk-Änderungen des Chunk-Stores) – für Determinismustests und Replays.
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
- `saveWorld(store, sim, { worldId, name, now, gameVersion, slot? })` schreibt in **einer** Transaktion Weltmeta, Weltrecord (Spielversion, Generator-Version, Diff-Format, Laufzeit-ID-Tabellen), genau die geänderten Chunks als Diffs (`saveChunkWorld`, `ChunkManager.collectChanges`/`markSaved`) und den Snapshot-Slot; `loadWorld` prüft den Slot-Hash, liest die Chunk-Diffs (umnummeriert auf die aktuellen IDs), gibt sie dem Chunk-Store der neuen Simulation (`loadStored`) und stellt danach die Teilnehmer wieder her. Die Welt selbst wird nie gespeichert, sondern aus Seed und Größe neu erzeugt.

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
- **Speichern/Laden:** `frozenAtTick` gehört zum Chunk-Zustand. Beim Speichern erhalten aktive Chunks den aktuellen Tick als `frozenAtTick`, und der Teilnehmer `world-chunks` hält fest, welche Chunks aktiv waren. Nach dem Laden sind zunächst alle Chunks eingefroren; die erste Aktualisierung aktiviert die Zone um den Spieler regulär und dazu die gespeicherten aktiven Chunks, die noch im Radius + Hysterese liegen (die übrigen bleiben beim Speicher-Tick eingefroren). So hat der geladene Lauf denselben Hysterese-Ring wie der ununterbrochene, und „speichern → laden → weiter“ ergibt denselben `hashState()` (ADR-0024).
- **Regel für Systeme:** Kein System setzt voraus, dass ferne Chunks tickten, und kein System liest Zustand eines eingefrorenen Chunks, ohne ihn vorher aufzuholen.

## Präsentation
- `src/render`: eigener WebGL2-Renderer (GLSL ES 3.00, `.glsl` mit `#include`), interne Höhe 270 px, Pässe nach §6.1 (docs/RENDER.md, ADR-0011/-0012/-0014). `main.tsx` bindet ihn über `createRenderRuntime` ein (`src/render/runtime.ts`: Renderer, aktive Szene, Pixelprobe, Shader-Fehler-Overlay, Kontextverlust, Welt-UI-Schrift, Debug-Overlays); Standardszene ist die Spielansicht `spiel` auf der Welt der Sitzung (`attachGame({ session, host })`; hinter der Titelkarte der Startstrand, ADR-0026), Szenarien wählen andere Szenen. Weltnahe UI (Namen, Leisten, Schadenszahlen, Marker) füllt die Präsentation in `RenderScene.worldUi`; der Pass `welt-ui` zeichnet sie zuletzt, unbeleuchtet, mit dem Glyphenatlas.
- `src/audio`: Web-Audio-Graph, SFX-Synth, Sequencer; Musik-Rendering im Worker.
- `src/ui`: Preact + @preact/signals, DOM-Overlay über dem Canvas (`App.tsx` rendert den aktuellen Bildschirm, `mountApp` in `src/ui/index.ts`). Weltnahe UI im WebGL-Pass.
  - **Signals-Brücke** (`src/ui/bridge.ts`, `createUiBridge(session)`): `frame()` einmal je gerendertem Frame liest `GameSession.sampleStatus(out)` in einen wiederverwendeten Datensatz (keine Allokation je Tick) und veröffentlicht Tick, Tag, Spielminute, Entitätenzahl und gesteuerte Position in einem `batch` als schreibgeschützte Signals; Sim-Events kommen über `GameSession.onEvent` (z. B. `commandRejected` → `lastRejection`). `actions` reihen ausschließlich Game-Commands über `GameSession.command` ein; die Brücke sieht die Simulation nicht (Typ `UiBridgeSession` = lesen, abonnieren, einreihen).
  - **Theme** (`src/ui/theme.ts`): Farb-Tokens `--dh-<name>` aus den UI-Farben der Master-Palette (`UI_HEX`), UI-Skalierung ganzzahlig 1–4 (Auto = ⌊min(Breite/480, Höhe/270)⌋ in CSS-px, sonst Einstellung `accessibility.uiScale`); `--dh-ui-scale` ist die CSS-Länge eines Designpixels, auf ganze Gerätepixel gerastert (`devicePixelScale`: bei `devicePixelRatio` 1 gleich der Stufe, bei 1,25/1,5 ein Bruchteil, der ganze Bildschirmpixel deckt; ADR-0015). `base.css` verweist nur auf diese Tokens.
- `src/debug`: nur mit `?debug=1` oder Entwicklermodus (`installDebugApiIfEnabled`); `window.__dh`: `state()` (Einstellungen, Sprache, `sim` = Tick/Tag/Uhrzeit/Entitäten), `command(cmd)` (Game-Command, zod-geprüft, nächster Tick), `exec(zeile)` (Konsole), `freezeTime`, `setSpeed`, `screenshotMode` (HUD aus + Zeit eingefroren), `readPixel(x, y)` (Pixelprobe des nächsten Frames, asynchron über Pixel-Pack-Buffer), `call(erweiterung)` (Szenarien, Tick, Bench) – für E2E und Screenshots. Szenarien (`?scenario=`) laufen immer im Screenshot-Modus.
- i18n ohne stillen Fallback: fehlende Schlüssel meldet `onMissing` (App: Konsolenfehler ⇒ E2E rot); `strict: true` wirft (Tests, Werkzeuge).

## Werkzeuge (`tools/`)
- `tools/assets/build.ts` → `src/generated/` (Atlanten, Manifeste) + `tools/out/sheets/` (Kontaktbögen).
- `tools/forbidden.ts` Verbotsliste · `tools/validate-content.ts` Content-Validator (Prüfungen in `tools/validator/checks.ts`, Zielwerte `tools/validator/zielwerte.json`) · `tools/shot.ts` Screenshots (Szenarien mit `viewports` je Auflösung, mit Prüfung von interner Größe und Pixelschärfe über `tools/lib/sharpness.ts`; die Weltkarten `weltkarte-klein|mittel|gross` zeichnet es in Node über `tools/world/weltkarte.ts`, ADR-0027) · `tools/bench.ts` Performance.
- Bench: Szenarien in `tools/bench/{sim,render}.ts` (Browser: Draw-Calls, Render-Vorbereitung und Frame-CPU als p95, Heap, Konsolenfehler; `sprites-5000` mit 5 000 animierten Sprites und 32 Punktlichtern, eingefrorene Szenarien laufen während der Messung auf einer 60-Hz-Uhr weiter; dazu `render:frame-pfad`: Allokation des Render-Frame-Pfads je Szene in Node über Vites SSR-Lader, mit WebGL-Attrappe `tools/bench/nullGl.ts` und Heap-Stichproben von `node:inspector`, ADR-0015), Grenzwerte in `tools/bench/schwellwerte.json` (Budget × Marge mit Begründung je Messwert; fehlender Schwellwert = Fehler), JSON-Bericht nach `tools/out/bench/bericht.json`; `--schwellwerte <datei>` belegt mit zu engen Grenzen, dass der Lauf scheitert (`tests/integration/bench.test.ts`).

## Prüfkette (`npm run check`, §3.4)
- `tools/check.ts` führt die npm-Skripte `assets` → `typecheck` → `lint` → `forbidden` → `validate:content` → `test:unit` → `test:integration:fast` nacheinander aus, bricht beim ersten roten Schritt ab (dessen Exit-Code), druckt eine Zeittabelle und scheitert bei Gesamtlaufzeit > 180 s. `verify` = `check` → `test:integration` → `build` → `test:e2e` → `bench`.
- ESLint (`eslint.config.js`): Schichtregeln (oben), Preact/@preact nur in `src/ui` und `src/debug` (ADR-0010; `src/main.tsx` bindet die UI über `mountApp` ein), keine Browser-/Timer-Globals (`window`, `document`, `localStorage`, `setTimeout` …) in `world`/`game`/`content`/`save`, kein `any`, und `@typescript-eslint/no-magic-numbers` in `src/game/**` und `src/world/**` (§2.4): erlaubt sind nur −1, 0, 0,5, 1, 2, 10, 100, 1000 sowie Enums, Literaltypen, Klassenfeld-Startwerte, Defaults und Array-Indizes; alles andere als Balancewert in `src/content/balance.ts` oder als benannte Modulkonstante.
- Verbotsliste (`tools/forbidden.ts`): Platzhalter-Marker, `Math.random`/`Date.now`/`new Date(` in `engine`/`world`/`game`/`content`, `performance.now` in `world`/`game`/`content`; `any` nur mit `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Interop: <Grund>`; Schicht-, Globals- und Magic-Number-Regel dürfen nicht per Direktive abgeschaltet werden. `tests/fixtures/**` enthält absichtliche Verstöße und ist vom regulären Lauf ausgenommen; `tests/unit/tooling/` prüft beide Werkzeuge daran.

## Weltdatenmodell (M2-03, docs/WORLD.md §1–§4)
- **Module** (`src/world/model/`, Einstieg `index.ts`): `coords.ts` (Tile ↔ Chunk ↔ lokaler Index per `>>`/`&`, korrekt auch für negative Tiles; Ebenen `LAYERS`; Chunk-Schlüssel `layer:cx:cy` für Spielstände und Debug, gepackte nicht-negative Zahl-ID `packChunkId` für Maps im Hot Path ohne String-Allokation), `worldSize.ts` (Klein/Mittel/Groß = Presets `small`/`medium`/`large` der `SimConfig`, Kantenlängen aus `BALANCE.world.sizeTiles`, ganze Chunks), `chunk.ts` (`ChunkData`, Wasser- und Flag-Bits, `chunkHash`, Snapshot), `runtimeIds.ts` (Laufzeit-ID-Tabellen).
- **Laufzeit-IDs:** je Tabelle (Terrain, Biome, Welt-Objekte) die String-IDs in Code-Unit-Reihenfolge sortiert, nummeriert ab 1; **0 = keins** in jeder Tabelle (kein Boden, offenes Tile, kein Biom, kein Objekt). `ground` und `solid` teilen die Terrain-Tabelle. Spielstände speichern die drei ID-Listen (`serializeWorldIdTables`); beim Laden schreibt `remapChunk` die Chunks auf die aktuelle Nummerierung um (`createChunkIdRemap`, bei unveränderter Nummerierung entfällt das Umschreiben). Nicht mehr vorhandener Content im Spielstand ist ein Ladefehler (`RuntimeIdError`) statt einer stillen Weltänderung.
- **Chunk-Hash:** FNV-1a 64 über Adresse, die sieben Arrays in der Reihenfolge von WORLD.md §3 (Little Endian) und die Objektzustände nach Tile-Index. `frozenAtTick` gehört nicht dazu: er hält fest, wann der Chunk zuletzt tickte, und ist kein Weltinhalt.
- **Snapshot** (`serializeChunk`): je Feld RLE + Base64, Objektzustände als Quadrupel; ein einheitlicher Chunk braucht < 400 Byte JSON. Diffs gegen den generierten Zustand (WORLD.md §5) baut die Chunk-Speicherung (M2-27) darauf auf.

### Speicherbedarf je Chunk
| | je Chunk-Ebene | Klein (32² Chunks je Ebene) | Mittel (48²) | Groß (64²) |
|---|---|---|---|---|
| Tile-Daten (8 Byte je Tile, ein `ArrayBuffer`) | 8 KiB | 8 MiB je Ebene · 32 MiB alle 4 Ebenen | 18 MiB · 72 MiB | 32 MiB · 128 MiB |
| Objektzustände (`Map`, nur abweichende Objekte) | ≈ 80 Byte je Eintrag (`OBJECT_STATE_BYTES_ESTIMATE`) | – | – | – |
| Snapshot (JSON, RLE) | < 0,4 KiB einheitlich, ≈ 2 KiB gemischt, ≤ 21 KiB bei Zufallsdaten | – | – | – |
- Folgerung: Nie alle Chunks aller Ebenen gleichzeitig im Speicher (Groß wären 128 MiB der 350 MiB Heap-Budget, §30). Der `ChunkManager` (M2-22) hält nur den Ladekreis der aktiven Ebene resident, z. B. Radius 4 ⇒ 9 × 9 = 81 Chunks ≈ 648 KiB + Objektzustände; der Weltplan (< 2 MB) bleibt dauerhaft.
- Ein Chunk wandert zwischen Worker und Hauptthread als **ein** Transferable (`chunk.buffer`); `new ChunkData(layer, cx, cy, buffer)` legt die Views ohne Kopie darauf.

### Sampling und Kalender (M2-01, M2-24)
- `src/world/gen/sampling.ts`: `poissonDisc` (Bridson, Maske, Lückenfüllung für getrennte Maskenteile) für Poisson-Regionen und Orts-Slots; `createBlueNoiseTile` (Void-and-Cluster auf dem Torus, 64² ≈ 0,1 s) + `blueNoiseAt` für reihenfolgeunabhängige, nahtlose Streuung in Chunks. Beide rechnen nur mit + − × ÷ und dem geseedeten `Rng`: `Math.sin`/`cos`/`exp` dürfen sich zwischen JS-Engines im letzten Bit unterscheiden, und unveränderte Chunks werden aus dem Seed neu erzeugt statt gespeichert – Generatorcode sollte es ebenso halten.
- `src/world/calendar.ts` (`Calendar`, global, kein Tick nötig): Nacht mittig um Mitternacht, Dämmerungen außen daran, Sonnenaufgang = Ende der Morgendämmerung; eine Nacht gehört zum Tag ihres Abends (Mondphase wechselt mittags, der erste Morgen zählt zu Nacht 1). Spiellogik (Tagesphase, Tageslicht, Mond, Umgebungslicht) nutzt nur Grundrechenarten; nur die Schattenvektoren für den Renderer verwenden Trigonometrie. Gespeichert wird nur die Historie der Jahreszeitenlänge (Teilnehmer `calendar`); die `Calendar`-Instanz ist selbst ein `SimSystem` und wird in `createSimulation` registriert (`sim.addSystem(new Calendar(sim.clock))`).

## Weltgenerierung (M2-10 … M2-15, docs/WORLD.md §2, ADR-0021, ADR-0023)
- **Ablauf** (`src/world/gen/world.ts`, `generateWorld(seed, size, onProgress)`, rein und deterministisch): `weltplan` (Insel, Regionen, Biome, Höhe, Wasser – `gen/plan/`) → `schluesselorte` (Startstrand, Nachtherz + Finalarena, 6 Leuchtfeuer-Stätten + Boss-Arenen – `locations.ts`) → `strassen` (Spannbaum zwischen den Stätten – `roads.ts`) → `erreichbarkeit` (Rampen, Furten, Brücken einfügen – `validate.ts`) → `orte` (Brückenruinen, 18 Ortstypen aus §21) → `untergrund` (Höhlennetz der Ebenen −1 … −3 aus den Eingangskandidaten der Oberfläche, `gen/underground/`; Höhleneingänge) → `ressourcen` (Vorkommen + lokales Nachstreuen – `resources.ts`) → `pruefung` (Bericht: Probleme, Reparaturzähler). Ergebnis `GeneratedWorld` (strukturiert klonbar, nicht im Spielstand, aus Seed + Größe + `WORLD_GEN_VERSION` reproduzierbar).
- **Chunk-Generator** (`chunk.ts`): `generateChunk(world, layer, cx, cy) → ChunkData`, rein, reihenfolgeunabhängig, nahtlos (jede Entscheidung liest nur ein festes Fenster um den Chunk, `chunkWindow.ts`); Oberfläche = Sampler des Plans + Boden (`chunkGround.ts`) + Reservierungen und Straßenzerfall (`worldContext.ts`) + Vorkommensknoten + Streuung (`vegetation.ts`); Ebenen −1 … −3 = `generateUndergroundChunk`. Abgeleitete Daten je Weltobjekt einmal (`WeakMap`), danach alloziert ein Chunk nur sein `ChunkData`.
- **Worker** (`world.worker.ts` → `worker.ts`): `generate` mit `progress`-Ereignissen je Schritt (`WORLD_GEN_STEPS`), danach die Chunk-API des Streamings (`load`, ADR-0020) auf derselben Welt; Hauptthread `requestWorld(client, seed, size, onProgress)`, In-Thread-Rückfall mit demselben Code.
- **Determinismus:** `worldHash(world)` (Plan, Orte, Straßen, Brücken, Vorkommen, Untergrund, Bericht) und `surfaceChunksHash(world, order?)` (Hash aller Oberflächen-Chunks in Zeilenfolge, erzeugt in beliebiger Reihenfolge); `tests/unit/world/weltgen-determinismus.test.ts`, Validierung über 20 Seeds `weltgen-validierung.test.ts`.

### Dauer „Mittel“ (§30: neue Welt spielbar ≤ 8 s)
Gemessen in Node 22 im Cloud-Container, 6 Seeds; „spielbar“ = Welt + die 81 Oberflächen-Chunks im Ladekreis (Radius 4) um den Spawn.

| Schritt | Dauer (warm) |
|---|---|
| `weltplan` | 200–300 ms |
| `schluesselorte` + `strassen` + `erreichbarkeit` | 115–150 ms |
| `orte` (inkl. Erreichbarkeitsprobe der Brückenruinen) | 95–125 ms |
| `untergrund` | 30–40 ms |
| `ressourcen` + `pruefung` | 70–90 ms |
| **Welt gesamt** | **540–660 ms** (erste Welt eines Prozesses ≈ 1,1 s: JIT, Blue-Noise-Kachel) |
| Strukturierter Klon der Welt (Worker → Hauptthread, 1,8 MB) | 4–7 ms |
| 81 Chunks um den Spawn | 255–340 ms (≈ 3,3 ms/Chunk, Oberflächenmittel über alle Chunks ≈ 1,5 ms) |
| **spielbar** | **≈ 0,8–0,95 s** (erste Welt ≈ 1,45 s) |

- Klein ≈ 0,2–0,6 s, Groß ≈ 0,7–1,3 s je Welt. Weltbeschreibung Klein 0,95 MB, Mittel 1,8 MB, Groß 3,3 MB (Oberflächenplan ≤ 1,4 MB, Orte/Straßen/Vorkommen ≤ 0,2 MB, Untergrundplan ≤ 1,8 MB).

## Welt in der Simulation (`src/game/world.ts`, ADR-0024)
- **`SimWorld`** (`sim.world`) bindet die Weltschicht ein: generierte Welt (`generated`), Chunk-Store (`chunks: ChunkManager` über `generateChunk`), Aktive Zone (`zone`, mit der von `createSimulation` versiegelten Aufhol-Registry), Kalender (`calendar`), Wetter der Oberflächenregionen (`weather`) und Temperaturfeld (`temperature`, Wetterregion einer Kachel = Planregion ihrer Zelle, Lavawärme aus den residenten Chunks).
- **Systeme:** `world-chunks` (erstes System, global) bewegt je Tick die Zone zum Fokus – bis zur Spielerentität (M3-08) die gesteuerte Entität auf der Oberfläche; ohne Fokus friert die Zone ganz ein – und gibt Chunks frei, die sie eingefroren hat und die keine Kamera hält (`ChunkManager.trim`; headless streamt niemand). Save-Teilnehmer `world-chunks`, `stateDigest` = Digest aller Chunk-Änderungen. `calendar` (der `Calendar` selbst), `weather-regions` (Welt-Tick, Teilnehmer) und `temperature` (Welt-Tick, zustandslos) sind global.
- **Faul in zwei Stufen:** `createSimulation` baut nichts von der Welt. Die *Planstufe* (Weltplan ≈ ⅓ der Generierzeit: Wetter, Temperatur) entsteht beim ersten Welt-Tick, beim Speichern/Laden des Wetters oder beim Lesen; die *Weltstufe* (generierte Welt: Chunk-Store, Zone) sobald die Zone einen Fokus hat, beim Laden einer Zone mit Chunks, beim Laden von Chunk-Diffs oder wenn die Präsentation `generated`/`chunks`/`zone` liest. Das ändert nie den Zustand: Plan und Welt sind reine Funktionen von Seed und Größe, das Wetter hängt nur von den Minuten ab, bis zu denen es fortgeschrieben wurde, und eine Zone ohne Fokus hat nichts Aktives. Simulationen, die die Welt nie brauchen (kurze Unit-Tests, Command-Prüfung), kosten keine Generierung.
- **Welt-Cache** (`src/game/worldCache.ts`): Plan und Welt je (Seed, Größe), je zwei Einträge (LRU). Simulationen derselben Welt teilen eine Instanz (Spielstand der laufenden Welt laden, Vergleichsläufe); die Weltstufe erzeugt die Welt aus dem Plan der Planstufe (`generateWorld(…, basePlan)`), nichts entsteht doppelt.
- **Browser (ADR-0026):** `main.tsx` erzeugt die Welt der Sitzung beim Boot im Welt-Worker (`WorldHost` im Modus `adopt`, Fortschritt als Titelzeile) und gibt sie mit `sim.world.provide(world)` hinein; `chunkJobs` (`WorldHost.createJobQueue`) baut die Job-Queue des Streamings über denselben Worker mit `performance.now` als Uhr. Bis dahin ruht der Loop (Pausengrund `welt`), die Simulation baut also nie Plan oder Welt im Hauptthread. Ohne `chunkJobs` nutzt die Simulation eine In-Thread-Queue ohne Uhr (die Simulationsschichten lesen keine Echtzeit) und damit ohne Frame-Budget – genug für `ensure`, nicht für Streaming je Frame. Die Spielansicht streamt mit `sim.world.chunks.update(ebene, cx, cy)` je Frame um ihre Kamera (lesend für die Simulation: Residenz ändert weder Inhalt noch `hashState()`).
- **Messung (Node 22, geteilter 4-Kern-Container):** `createSimulation` ohne Weltzugriff < 3 ms; Planstufe (erster Welt-Tick) ≈ 80–250 ms; Weltstufe danach ≈ 0,3–0,5 s (Klein/Mittel), mit Welt aus dem Cache 55–110 ms (25 Zonen-Chunks synchron). `npm run test:unit` 61 s → 77–85 s Wandzeit ohne Fremdlast (jede Testdatei mit Simulationen erzeugt ihre erste Welt JIT-kalt, ≈ 1–1,4 s; ein Cache über Testdateien hinweg bräuchte eine Vitest-Setup-Datei).

## Streaming, Aktive Zone, Chunk-Speicherung (M2-02, M2-22, M2-27, ADR-0020)
- `src/world/stream/`: `ChunkManager` (Ladekreis je Ebene um die Kamera, Entladen mit Hysterese, zuletzt verlassene Ebene bleibt, gepinnte Zonen-Chunks nie entladen; `ensure` lädt synchron im Thread – identisch zum Worker-Pfad `loadChunk`), `ActiveZone` (Radius und Hysterese aus `BALANCE.stream`, aktive Chunks nach gepackter ID sortiert), `CatchUpRegistry` (Pflicht-Erklärung je zeitabhängigem System), Diffs (`diff.ts`: Lauflängen je Feld + neue Werte + Objektzustände, umnummerierbar).
- Jeder residente Chunk hält seine generierte Baseline; geändert ist, wessen Hash vom gespeicherten Stand abweicht (Systeme schreiben Chunk-Arrays direkt). Entladene geänderte Chunks lassen ihren Diff im Speicher; `contentHash()` ist unabhängig von der Residenz.

## Klima und Kollision (M2-23, M2-25, M2-26, ADR-0022)
- `src/world/climate/`: `WeatherSystem` (Markov-Automat je Planregion, Ziehung k einer Region aus `hash(Seed, 'weather', Region, k)`, Perioden in Spielminuten, Überblendung 45 min), `TemperatureField` (Formel WORLD.md §6, Zeitterme je Welt-Tick zwischengespeichert, kein Zustand). Parameter in `BALANCE.climate`.
- `src/world/collision/`: `CollisionGrid` (gepackte Tile-Info aus den Chunk-Arrays, Klippenwände nach `wandAn` des Autotilers, optionaler Speicher je Chunk mit `invalidateTile`/`invalidateChunk`), `moveCircles`/`moveBox` (Unterschritte, kein Tunneln), `sweepCircle` (Geschosse), `BodyGrid` (je Tick neu aufgebaut, 2 000 Entitäten ≤ 0,5 ms).

## Untergrund (M2-13, `src/world/gen/underground/`, docs/WORLD.md §3)
- **Plan** (`createUndergroundPlan`, 25–45 ms je Welt, 0,5–2 MB, nicht im Spielstand): Eingänge aus den Kandidaten der Oberfläche (erreichbar, trocken, ≥ 96 Tiles Abstand, 10/16/24 je Größe) → Ebene −1; Schächte von −1 nach −2 und −2 nach −3, gleichmäßig über die Kavernen verteilt. Kavernen als Poisson-Punkte, jede gehört zum Höhlensystem ihres nächsten Zugangs; Gänge als Spannbaum + Schleifen je System mit gewundenen Mittellinien, dazu Sackgassen („Rauschtunnel“) mit kleinen Kammern. Seen (Wasser in −1/−2, Lava in −3 mit Obsidianrand) mit trockenem Ring, Sonderkavernen (Pilzhaine −1, Kristallgrotten −2, Obsidianhallen −3), 3–7 Höhlenort-Slots je Ebene.
- **Chunks** (`generateUndergroundChunk`, von `generateChunk` für Ebenen < 0 aufgerufen, ≈ 0,85 ms je Chunk, in Höhlengebieten 2,5–3 ms): Kern jedes Stücks sicher offen, Rauschrand + 4 Schritte zellulärer Automat, Rückfüllen offener Taschen ohne Verbindung (kein Tile abgeschnitten), 20 Tiles Überlapp für nahtlose Grenzen. `solid` = Wirtsgestein der Ebene oder Erzader `ader_<erz>` (Lagerstättenmaske × Aderlinien); `ground` = Ebenenboden mit Flecken (−1: Wurzelboden, Höhlenboden, Lehmnester ≈ 7 % des Bodens), Sonderboden, Seeufer, Lava. Blockierende Objekte nur auf einem dünnen Gitter und nur auf „einfachen“ Kacheln, die keinen Gang trennen.
- **Verbindungen:** Jede Verbindung (`links`, Art `eingang` oder `schacht`) ist dieselbe Kachel in beiden Ebenen: oben `TILE_FLAG_STAIRS` (Höhleneingang auf der Oberfläche, Schachtöffnung im Untergrund), unten `TILE_FLAG_RAMP` (Weg nach oben, offen und trocken); `TILE_FLAG_PLACE` markiert Höhlenort-Slots. Tests: Konnektivität aller begehbaren Kacheln zu einem Weg nach oben (`tests/unit/world/hoehlen.test.ts`), Verbindungskacheln in beiden Ebenen (`tests/unit/world/ebenen-verbindung.test.ts`).

## Spielansicht und Debug-Werkzeuge der Welt (M2-29, M2-30, ADR-0026)
- **Spielansicht** (`src/render/world/gameScene.ts`, Szene `spiel`): liest `GameSession.sampleFocus` (Position und Ebene der gesteuerten Figur, ohne Allokation) und `sim.world` (Kalender, Wetter, Temperatur, Zone) – schreibt nie. Die Kamera folgt der Figur; ohne Figur eine freie Kamera, die am Titelbild beginnt (Startstrand, zum nächsten offenen Meer versetzt) oder – in Szenarien – am Schaufenster eines Bioms.
- **Gesteuerte Entität mit Ebene:** `MotionSystem.controlledLayer` (Teilnehmer `motion` Version 2) ist der Fokus der Aktiven Zone; `teleport` setzt Position und Ebene.
- **Debug-Commands** (`src/game/commands.ts`): `teleport`, `setTime`, `advanceTime`, `setSeason`, `setWeather` – wie jeder Command zod-geprüft, im nächsten Tick angewendet und im Replay aufgezeichnet. Handler: `teleport` in `motion`, Zeitsprünge in `world-chunks` (`SimWorld.jump`: Zone einfrieren, `Simulation.skipTicks`), Wetter in `weather-regions` (`WeatherSystem.force`, Region der Kachel bzw. alle).
- **Konsole** (`src/debug/worldCommands.ts`): `tp [x] [y] [ebene]`, `time [HH:MM|+min]`, `season [jahreszeit]`, `weather [zustand] [hier|alle]`, `seed [n]` (n: Neuladen mit `?seed=n`), `overlay [name] [an|aus]`; ohne Argumente melden sie den Zustand. `__dh.state().sim.world` zeigt Fokus, Jahreszeit, Mond, Wetter und Temperatur am Fokus, Biom, aktive/residente/ladende Chunks; `__dh.call('worldInfo' | 'worldCamera' | 'worldOverlay' | 'worldPoints' | 'frameLog')` für E2E.
- **Debug-Overlays** in der Render-Debug-Ebene (docs/RENDER.md §3): Chunks, Kollision, Temperaturfeld.
- **Welt der Sitzung beim Start** (`WorldHost` im Modus `adopt`): Scheitert der Welt-Worker, bevor die Welt da ist, erzeugt der Host sie mit demselben Code im Hauptthread; scheitert auch das, nennt die Titelzeile den Grund (`loading.world.failed`, DE/EN) und die Simulation ruht weiter (ADR-0027).
- **Determinismus über 20 Seeds** (`tests/integration/welt-determinismus.test.ts`, ADR-0027): Hauptthread = Worker-Thread für 20 Seeds × 3 Größen (Welt-Hash) und Chunk-Stichproben aller Ebenen (Klein); die Welt-Hashes stehen als Snapshot fest.
- **Frame-Zeit im E2E:** Frame-CPU je Spiel-Frame (`frameLog`) und die Tasks des Hauptthreads aus dem Browser-Trace (`toplevel`, Wand- und Thread-Zeit); rAF-Abstände unter SwiftShader und die Null-Timer-Sonde werden berichtet, nicht bewertet (ADR-0014, ADR-0026, ADR-0027). `tests/e2e/fluessiges-laufen.spec.ts` (60 s, > 20 Chunkgrenzen, mehrere Biome), `tests/e2e/debug-welt.spec.ts` (jeder Befehl, jedes Overlay).
