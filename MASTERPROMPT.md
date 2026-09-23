# DUSKHEARTH — MASTERPROMPT
**Arbeitstitel · 2D-Top-Down-Survival (3/4-Perspektive) · Webapp/PWA · 16-Bit-Pixelart × moderne Shader-Pipeline**
Spezifikation für die autonome Entwicklung mit Claude Code im Loop-Betrieb.

Jeder Abschnitt beginnt mit `## §` → Übersicht jederzeit mit `grep -n "^## §" MASTERPROMPT.md`

| § | Inhalt | § | Inhalt |
|---|---|---|---|
| 0 | Mission & Rolle | 17 | Landwirtschaft & Tierhaltung |
| 1 | **Loop-Protokoll (jeder Durchlauf)** | 18 | Kochen, Ernährung, Verderb, Wasser |
| 2 | Qualitätsgesetz | 19 | Kampf & KI |
| 3 | Tech-Stack & Architektur | 20 | Kreaturen & Bosse |
| 4 | Art Direction | 21 | Dungeons & Orte |
| 5 | Asset-Pipeline | 22 | Siedler, Begleiter, Händlerin |
| 6 | Render-Pipeline & Shader | 23 | Progression, Skills, Chronik |
| 7 | Design-Säulen | 24 | Lumen-Netz (Automatisierung) |
| 8 | Setting & Story | 25 | Erkundung, Karte, Reisen |
| 9 | Welt & Weltgenerierung | 26 | UI/UX |
| 10 | Zeit, Jahreszeiten, Wetter, Ereignisse | 27 | Audio |
| 11 | Spieler & Überlebenswerte | 28 | Speichern & Laden |
| 12 | Licht & Dunkelheit (Kernmechanik) | 29 | Modi, Schwierigkeit, Einstellungen, Barrierefreiheit |
| 13 | Items, Inventar, Ausrüstung, Stufen | 30 | Performance-Budgets |
| 14 | Ressourcen & Sammeln | 31 | Tests, QA, Dev-Tools |
| 15 | Crafting & Stationen | 32 | Meilensteine M0–M14 |
| 16 | Basisbau & Verteidigung | 33 | Definition of Done |
| A–D | Anhänge: CLAUDE.md-Vorlage · PROGRESS.md-Vorlage · Content-Mindestumfang · Balancing-Rahmen | | |

---

## §0 Mission & Rolle

Du bist ein komplettes Spielestudio in einer Person: Game Director, Lead Designer, Graphics Engineer (WebGL2/GLSL), Engine- und Gameplay-Programmierer, Pixel-Artist, Sounddesigner und Komponist, Level-Designer und QA-Lead.

**Ziel:** DUSKHEARTH – ein vollständiges, poliertes, veröffentlichungsreifes Survival-Spiel, das im Browser läuft (installierbar als PWA, offline spielbar). Klassische 16-Bit-Pixelart der SNES-Ära, kombiniert mit einer modernen Licht- und Shader-Pipeline: dynamisches Licht mit Normal-Maps, weiche Schatten, über den Tag wandernde Sonnenschatten, 2D-Global-Illumination, lebendiges Wasser, Wetter, Nebel, Bloom und Color-Grading. Umfang: 25–40 Stunden Hauptinhalt, 80+ Stunden für Komplettisten. Kein Prototyp, keine Tech-Demo – es soll sich wie ein kommerzieller Indie-Titel anfühlen.

**Autonomie:** Du arbeitest im Claude-Code-Loop (`/loop` mit festem Intervall, selbst getaktet oder per `/goal`), bis §33 erfüllt ist. Du stellst keine Rückfragen und wartest nie auf Antworten. Bei Unklarheit triffst du die beste Entscheidung im Sinne dieser Spezifikation, dokumentierst sie in `docs/DECISIONS.md` und arbeitest weiter. Der Mensch steuert ausschließlich über `FEEDBACK.md`.

**Rangfolge bei Konflikten:** 1. `FEEDBACK.md` (neuere Einträge zuerst) · 2. diese Spezifikation · 3. `docs/DECISIONS.md` · 4. dein Urteil.
`MASTERPROMPT.md` veränderst du nie.

---

## §1 Loop-Protokoll (bei JEDEM Durchlauf befolgen)

Zwischen Durchläufen hast du kein Gedächtnis außer Dateien und Git. Behandle jeden Durchlauf so, als kämst du frisch ins Projekt.

### 1.1 Zustandsdateien
| Datei | Zweck |
|---|---|
| `PROGRESS.md` | Status, vollständiger Backlog (alle Meilensteine/Tasks), Blocker, Spec-Abdeckung, Log |
| `FEEDBACK.md` | Notizen des Menschen, höchste Priorität. Umsetzen (als Task), danach mit `✅ <Task-ID>` markieren |
| `docs/DECISIONS.md` | Entscheidungen im ADR-Kurzformat (Kontext · Entscheidung · Alternativen · Folgen) |
| `docs/SPEC_AUDIT.md` | Abgleich jeder Anforderung mit Umsetzung und Beleg |
| `CLAUDE.md` | Kompakte Arbeitsregeln aus §A. Existiert bereits eine: Abschnitt ergänzen, nichts löschen |
| Git | Jeder abgeschlossene Task = mindestens ein Commit |

### 1.2 Ablauf jedes Durchlaufs (strikt in dieser Reihenfolge)
1. **Aufräumen:** `git status`. Liegen uncommittete Änderungen aus einem abgebrochenen Durchlauf vor: vollständig und `npm run check` grün → committen; sonst `git stash push -m "abgebrochen <Datum>"` und im Log vermerken.
2. **Orientieren:** Kopf von `PROGRESS.md` (Status, Meilenstein, nächster Task), neue Einträge in `FEEDBACK.md`, die letzten 10 Log-Zeilen, `git log --oneline -10`. Fehlt `PROGRESS.md` → Bootstrap (1.3).
3. **Fertig-Check:** Steht `STATUS: FERTIG` in `PROGRESS.md` → 1.6 ausführen und Durchlauf beenden.
4. **Gesundheit:** `npm run check`. Rot → Reparieren ist die Aufgabe dieses Durchlaufs, vor allem anderen.
5. **Task wählen:** (a) `FEEDBACK.md`-Punkte mit `!` · (b) `[BUG]`-Tasks des aktuellen Meilensteins · (c) erster offener Task des aktuellen Meilensteins, dessen Abhängigkeiten erledigt sind · (d) übrige Feedback-Punkte. Ist ein Task größer als ~90 Minuten Arbeit, zerlege ihn zuerst in `PROGRESS.md` (M5-07a, M5-07b …) und nimm den ersten Teil.
6. **Kontext laden:** Nur die relevanten Abschnitte dieser Spezifikation lesen (`grep -n "^## §" MASTERPROMPT.md`, dann gezielt per Zeilenbereich). Bestehenden Code des Bereichs lesen, bevor du schreibst.
7. **Umsetzen:** vollständig nach §2 – Code, Daten/Content, Sprites, Sounds, UI, Texte DE+EN, Speichern/Laden, Debug-Hooks, Tests.
8. **Verifizieren:** `npm run check`. Bei Gameplay-, Rendering- oder UI-Änderungen zusätzlich passende E2E-Tests und `npm run shot -- <szenarien>`; die erzeugten Bilder öffnest du selbst und prüfst sie kritisch gegen §4 und §6. Erst wenn alles grün ist und visuell überzeugt, ist der Task erledigt.
9. **Committen:** `git add -A && git commit -m "<typ>(<bereich>): <was> [<Task-ID>]"` – typ ∈ feat, fix, perf, refactor, content, art, audio, test, docs, chore.
10. **Buchführen:** Task abhaken, Log-Zeile `JJJJ-MM-TT HH:MM | ID | Ergebnis | Notiz`, neu entdeckte Arbeit als Tasks eintragen (`[BUG]`, `[POLISH]`), „Nächster Task" setzen, committen.
11. **Weiter oder enden:** Reichen Zeit und Kontext, nächster Task (höchstens 3 pro Durchlauf). Ein Durchlauf endet immer mit grünem, committetem Stand und genau dieser Meldung: `Erledigt: … | Nächster: … | Risiken: …`. Läuft der Loop selbst getaktet, wähle als nächste Wartezeit das Minimum (1 Minute), solange Tasks offen sind.

### 1.3 Bootstrap (nur wenn `PROGRESS.md` fehlt)
1. `git init` (falls nötig), Scaffold nach §3, `.gitignore`, alle npm-Skripte aus §3.4.
2. `CLAUDE.md` aus §A; `FEEDBACK.md` mit kurzer Anleitung für den Menschen (Datum pro Eintrag, `!` = dringend, du markierst Erledigtes mit ✅); `docs/DECISIONS.md`; `docs/SPEC_AUDIT.md` mit Tabellenkopf.
3. `PROGRESS.md` nach §B: **alle** Meilensteine M0–M14 aus §32 in konkrete Tasks von 30–90 Minuten zerlegt, jeweils mit ID, Akzeptanzkriterium und Abhängigkeiten, plus Abdeckungstabelle (jeder Abschnitt §3–§31 und §C → Task-IDs). Kein Abschnitt ohne Tasks.
4. Erste M0-Tasks umsetzen, soweit der Durchlauf reicht; committen.

### 1.4 Arbeitsregeln
- Jeder Durchlauf hinterlässt einen grünen Build, ein startbares Spiel, einen committeten Stand und eine aktuelle `PROGRESS.md`.
- Nie einen Task ohne Verifikation abhaken. Nie Tests abschwächen, überspringen oder löschen, um grün zu werden. Nie Anforderungen stillschweigend streichen. Ein Test ist nur falsch, wenn er der Spezifikation widerspricht – dann Test anpassen und in `DECISIONS.md` begründen.
- Größere Umbauten nur mit ADR und als eigene Tasks.
- **Subagents** (Agent-/Task-Tool) für parallelisierbare, klar getrennte Arbeit: Sprite-Serien, Content-Datensätze, Übersetzungen, Testfälle, Reviews. Jeder Subagent bekommt exklusive Dateien; du integrierst, prüfst und committest. Nach etwa 5 Tasks: ein Review-Subagent mit frischem Blick (Bugs, Spec-Abweichungen, Codequalität, Performance).
- Keine Pushes, keine Force-Operationen, nichts außerhalb des Projektordners. Nur Abhängigkeiten mit MIT-, BSD-, ISC-, Apache-2.0-, OFL- oder CC0-Lizenz, Versionen gepinnt.
- Kontext sparen: diese Datei nie komplett lesen; Testausgaben kompakt (`--reporter=dot`), lange Logs mit `| tail -n 40`, generierte Großdateien nie ausgeben.
- `PROGRESS.md` schlank halten: Log höchstens 25 Zeilen, Älteres pro Meilenstein zu einer Zusammenfassung verdichten.

### 1.5 Meilenstein-Gate
Sind alle Tasks eines Meilensteins erledigt: (1) jedes Akzeptanzkriterium aus §32 einzeln prüfen und in `PROGRESS.md` belegen (Test, Screenshot oder Befehl) · (2) `npm run verify` · (3) Standard-Screenshot-Set ansehen · (4) Review-Subagent über den gesamten Meilenstein-Diff · (5) Mängel als Tasks im selben Meilenstein beheben · (6) `git tag Mx`. Danach die Tasks des nächsten Meilensteins mit dem jetzt vorhandenen Code-Wissen prüfen und verfeinern, dann beginnen.

### 1.6 Fertig-Bedingung und Loop beenden
Nach M14 folgt der **Spec-Audit**: Gehe §3–§31 und §C Anforderung für Anforderung durch und trage in `docs/SPEC_AUDIT.md` ein: Anforderung | umgesetzt in | belegt durch | Status. Jede Lücke wird Task, wird umgesetzt, dann neuer Audit. FERTIG gilt erst, wenn (a) zwei aufeinanderfolgende vollständige Audits null Lücken finden, (b) §33 vollständig erfüllt ist, (c) `npm run verify` grün ist. Dann:
1. In `PROGRESS.md` `STATUS: FERTIG`, Datum und Kurzbilanz eintragen, committen, `git tag v1.0.0`.
2. **Loop beenden:** Bei festem Intervall `CronList` aufrufen, den Job mit diesem Loop-Prompt finden und per `CronDelete` löschen. Bei selbst getaktetem Loop `ScheduleWakeup` mit `stop: true`. Bei `/goal` genügt Schritt 3.
3. Zum Schluss ausgeben: `STATUS: FERTIG`, die Ergebniszeile von `npm run verify` und `DUSKHEARTH_FERTIG`.

Startet ein Durchlauf, obwohl FERTIG gesetzt ist: `npm run verify` – grün → Schritte 2 und 3; rot → `STATUS: IN_ARBEIT` setzen und reparieren.

### 1.7 Wenn du feststeckst
- Scheitert derselbe Task im zweiten Durchlauf: Ursachenanalyse unter „Blocker" in `PROGRESS.md`, dann einen anderen Lösungsweg wählen, der die Anforderung ebenso erfüllt.
- Nach drei Anläufen: Task `[BLOCKIERT]` markieren, Zwischenstand dokumentieren, mit dem nächsten Task weitermachen und beim Gate erneut angehen. Der Meilenstein schließt nicht ohne ihn.
- Ist etwas im Browser technisch unmöglich: gleichwertigen Ersatz bauen, in `DECISIONS.md` begründen, im Audit als „ersetzt durch …" führen. Nie ersatzlos streichen.

---

## §2 Qualitätsgesetz (nicht verhandelbar)
1. **Keine Platzhalter:** keine Stubs, keine „coming soon"-Menüs, keine Dummy-Items, keine Graukästen als Endgrafik, kein `TODO`/`FIXME`/`XXX`/`HACK` im Quellcode (`npm run check` schlägt dann fehl). Temporäre Grafik ist nur innerhalb eines Tasks erlaubt.
2. **Alles ist erreichbar und erklärt:** Jedes Item hat Quelle(n), Verwendung, Icon, Name, Beschreibung (DE/EN) und Tooltip. Jede Mechanik wird im Spiel vermittelt (Hinweis, Chronik, Tooltip).
3. **Alles ist speicherbar:** Save/Load-Roundtrip-Test pro System.
4. **Datengetrieben:** Items, Rezepte, Kreaturen, Biome, Loot, Bauteile, Pflanzen, Tiere, Quests, Dialoge liegen typisiert in `src/content/` mit zod-Schemas; Balancewerte zentral in `src/content/balance.ts` (Einheit und Begründung kommentiert). Keine Magic Numbers in Systemcode.
5. **TypeScript** `strict` + `noUncheckedIndexedAccess`, kein `any` außer an markierten Interop-Grenzen, ESLint fehlerfrei.
6. **Deterministisch:** eigener Seeded-PRNG mit Streams pro System; kein `Math.random`/`Date.now` in der Simulation (`src/engine`-Kern, `src/world`, `src/game`).
7. **Game Feel:** Jede Aktion hat visuelles und akustisches Feedback; Eingaben wirken im nächsten Frame.
8. **Lesbarkeit vor Spektakel:** Effekte verdecken nie Gegner, Telegraphs oder Interaktionsziele.
9. **Budgets aus §30** gelten ab M1 für jede Änderung.
10. **Eigene Assets:** Grafik, Sound und Musik erzeugst du selbst (§5, §27). Ausnahme: OFL/CC0-Schrift aus npm, dokumentiert in `CREDITS.md`. Keine geschützten Namen, Figuren oder Designs anderer Werke.
11. **Konsistenz:** ein Begriff pro Ding (`docs/GLOSSAR.md`, DE/EN), eine Palette, ein UI-Stil.

---

## §3 Tech-Stack & Architektur

### 3.1 Stack
- TypeScript 5 (strict), Vite, Node 22 LTS, npm.
- **Rendering:** eigener WebGL2-Renderer (GLSL ES 3.00). Keine Engine (kein Phaser, Pixi, Three).
- **UI:** Preact + @preact/signals als DOM-Overlay für Menüs, Inventar, Dialoge. Weltnahe UI (Schadenszahlen, Lebensbalken, Namen, Interaktionsmarker) im WebGL-Pass.
- **Daten:** zod-Schemas, Content als typisierte TS-Module.
- **Speicher:** IndexedDB für Spielstände, localStorage für Einstellungen.
- **Worker:** Weltgenerierung, Pfadfindung, Speicher-Kompression, Musik-Rendering.
- **Tests:** Vitest (Unit, Integration, headless Simulation in Node), Playwright (E2E, Screenshots; Chromium mit WebGL2, bei Bedarf Flags wie `--use-angle=swiftshader` oder `--enable-unsafe-swiftshader`).
- **PWA:** Manifest + Service Worker (vite-plugin-pwa), offline spielbar, installierbar.
- **Build:** rein statisch, `base: './'` → läuft auf jedem Webserver, auch in Unterordnern, ohne Backend.

### 3.2 Schichten (per ESLint-Importregeln erzwungen)
```text
src/engine   Loop, Zeit, Input (Tastatur/Maus/Gamepad/Touch), ECS, Events, RNG, Mathe, Pools, Worker-Brücke
src/world    Weltgen, Chunks, Tiles, Biome, Zeit-/Wettersimulation, Lichtkarte, Pfadfindung
src/game     Systeme: Survival, Kampf, KI, Crafting, Bau, Landwirtschaft, Tiere, Kochen, Siedler,
             Lumen-Netz, Quests, Skills, Loot, Spawns, Ereignisse, Schattenflut
src/content  Daten, Schemas, balance.ts
src/save     Serialisierung, IndexedDB, Migrationen
src/render   GL-Kontext, Batcher, Atlanten, Passes, Shader, Partikel, Post-FX, Kamera
src/audio    Mixer, Synth, Sequencer, Songs, SFX-Definitionen
src/ui       Preact-Komponenten, HUD, Screens, Theme
src/i18n     de.json, en.json, Formatierung
src/debug    Overlay, Konsole, Inspektoren
```
- `engine`, `world`, `game`, `content`, `save` importieren **nie** aus `render`, `audio`, `ui` → das Spiel läuft headless in Node (Tests, Balancing).
- Präsentation hört auf Events und liest Zustand; sie verändert die Simulation nur über Commands.

### 3.3 Kernarchitektur
- Simulation mit festem Zeitschritt 60 Hz (max. 5 Aufholschritte), Rendering interpoliert (120/144/165 Hz), Pixel-Snapping erst nach der Interpolation.
- Langsame Ticks: Welt-Tick 1 Hz (Temperaturfelder, Feuer, Verderb), Tages-Tick um 06:00 (Wachstum, Tiere, Siedlerplanung).
- ECS: eigene schlanke Implementierung (Sparse-Sets; Typed Arrays für heiße Komponenten wie Position, Velocity, Collider, Sprite).
- **Aktive Zone:** Chunks um den Spieler laufen voll; alles außerhalb ist mit Zeitstempel eingefroren und holt beim Laden analytisch auf (Wachstum, Verderb, Stationsverarbeitung, Brände, Tiere). Kein System darf voraussetzen, dass ferne Chunks tickten.
- Kollision: Kreis/AABB gegen Tile-Raster + räumliches Hash-Grid für Entitäten; Swept-Tests für schnelle Projektile.
- Eingaben werden zu Commands → Aufnahme und Wiedergabe (Replays für Bug-Repros).
- Debug-API `window.__dh` (nur Debug-Modus): Zustand lesen, Commands ausführen, Zeit einfrieren – genutzt von E2E- und Screenshot-Skripten.

### 3.4 npm-Skripte (Pflicht)
| Skript | Inhalt |
|---|---|
| `dev` | Assets erzeugen + Vite-Dev-Server |
| `build` | Assets + Typecheck + Produktions-Build |
| `assets` | Sprite-Quellen → Atlanten (Albedo, Normal/Höhe, Emissiv, Occluder) + Manifeste + Kontaktbögen |
| `check` | schnell (< 3 min): Typecheck, Lint, Unit-Tests, schnelle Integrationstests, Content-Validator, Verbotsliste (TODO/FIXME, `Math.random`/`Date.now` in der Simulation) |
| `test:e2e` | Playwright |
| `shot` | deterministische Screenshots, z. B. `npm run shot -- gruenhain-nacht regen` → `shots/latest/` |
| `bench` | Performance-Szenarien gegen §30 (Schwellwerte mit Sicherheitsmarge) |
| `validate:content` | Content-Validator (§31.4) |
| `verify` | check + alle Integrationstests + build + test:e2e + bench – das Freigabetor |

### 3.5 Ordner
```text
assets-src/  Paletten, Sprites als Index-Raster, Generatoren
tools/       Atlas-Builder, Normal-Map-Generator, Validator, Screenshot- und Bench-Skripte
src/         siehe 3.2
tests/       unit/, integration/, e2e/
docs/        DECISIONS.md, SPEC_AUDIT.md, ARCHITEKTUR.md, ART.md, BALANCE.md, GLOSSAR.md
shots/       latest/ (gitignored), referenz/ (freigegebene Referenzbilder)
```

---

## §4 Art Direction (16-Bit-Pixelart)

### 4.1 Look
- 3/4-Top-Down wie klassische SNES-Action-RPGs. Stimmungsreferenz: SNES-Ära (Secret of Mana, A Link to the Past) trifft moderne Pixelspiele mit dynamischem Licht (Eastward, Children of Morta, Core Keeper). Nur das Gefühl übernehmen, nichts kopieren.
- Kernbild: **warme Lichtinseln in kühler, bedrohlicher Dunkelheit.** Tagsüber gedämpft-satte Farben, die mit jedem entzündeten Leuchtfeuer lebendiger werden – die Welt heilt sichtbar.
- Jedes Biom hat eine eigene Farbidentität (Grundton, Akzent, Nachtfarbe, Grading), festgelegt in `docs/ART.md`, bevor Biom-Sprites entstehen.

### 4.2 Auflösung & Skalierung
- Interne Renderhöhe fest **270 px**; Breite = 270 × Seitenverhältnis, begrenzt auf 360–640 px (4:3 bis ~21:9, breiter → seitliche Balken). Alle sehen dieselbe Weltfläche → faire Balance.
- Hochskalieren „scharf": ganzzahlig per Nearest vorskalieren, dann linear auf Zielgröße (keine Pixelverzerrung, kein Matsch). Option „strikt pixelgenau" (nur ganzzahlig, Rand).
- **Subpixel-Kamera:** Szene mit 1 px Rand bei ganzzahliger Kameraposition rendern, Nachkommaanteil beim Hochskalieren als Offset anwenden → weiches Scrollen ohne Pixelflimmern.
- Beispiele: 1920×1080 → 480×270 · 2560×1440 → 480×270 · 3440×1440 → 640×270 · 3840×2160 → 480×270.

### 4.3 Palette & Farbe
- Eigene Master-Palette: 64 Farben in Rampen (je 5–7 Stufen) mit Hue-Shifting (Schatten Richtung Blau/Violett, Lichter Richtung Warmgelb) + 8 UI-Farben, in `assets-src/palette.ts`. Sprites nutzen ausschließlich Palettenfarben (Validator prüft).
- Sprites werden **palettenindiziert** gespeichert (Rampe + Stufe); die Farbe entsteht im Shader über eine Paletten-LUT. Dadurch ohne neue Sprites: Jahreszeiten-Laub, Biom-Tönung, Elite- und Varianten-Recolors, Charakteranpassung, Verderbnis-Effekte.
- Höchstens 12 Farben pro Sprite inklusive Outline; Ausnahmen begründen.

### 4.4 Größen & Raster
- Tiles 16×16. Spieler: Körper ≈ 16×24 in 32×32-Zelle. Kleine Kreaturen 16×16, mittlere 32×32, große 48–64 px, Bosse 96–160 px (auch mehrteilig).
- Icons 16×16 (UI zeigt sie ×2/×3). Bäume 32×48 bis 64×96. Gebäude modular aus Tiles.
- Klippen in Höhenstufen (16 px sichtbare Wand je Stufe), klar lesbare Rampen und Treppen.

### 4.5 Handwerksregeln (anhand der Kontaktbögen prüfen)
- Klare Silhouetten, bewusste Farbcluster, kein Pillow-Shading, keine verwaisten Einzelpixel, kein ungewolltes Banding, saubere Linien ohne Jaggies, selektive Outline (dunkle Rampenfarbe statt reinem Schwarz).
- Albedo mit weicher Form-Schattierung (AO-artig), ohne harte Richtungs-Highlights – gerichtetes Licht kommt dynamisch über die Normal-Maps.
- Animation mit Antizipation, Überschwingen und Smear-Frames. Figuren 8–12 fps, Effekte schneller.
- **Spieler:** Idle 4, Gehen 6, Rennen 6, Rolle 5, Angriff je Waffenklasse 4–6, Werkzeug 4, Treffer 2, Tod 6, Schwimmen 4, Sitzen, Schlafen, Essen, Trinken, Tragen – je 4 Richtungen (Spiegelung nur bei symmetrischer Ausrüstung). Ausrüstung als Layer (Kopf, Körper, Beine, Waffe, Nebenhand) mit Hand-Sockeln pro Frame.
- **Gegner:** Idle, Bewegung, jede Attacke mit lesbarer Ausholphase, Treffer, Tod. Bosse ≥ 8 eigene Animationen.
- **Terrain:** Blob-Autotiling (47er Set) für alle Übergänge (Gras, Erde, Sand, Schnee, Asche, Kristall, Wasser, Klippe), 3–4 Varianten je Grundtile, Streudeko (Steinchen, Blumen, Pilze, Knochen, Muscheln).
- **Rarität** überall gleich: Gewöhnlich weiß · Ungewöhnlich grün · Selten blau · Episch violett · Legendär gold.

### 4.6 Lesbarkeit
- Interagierbares unter Cursor oder in Reichweite: 1-px-Outline in Akzentfarbe (Shader).
- Gegner heben sich in jedem Biom und nachts ab (emissive Augen, Rim-Licht).
- Gefahren (Gift, Lava, Einsturz, Treibsand) haben eine eigene, konsistente Bildsprache.
- Telegraphs: Ausholpose + kurzer Glint + Sound; Boss-Flächenangriffe mit Bodenmarkierung.

---

## §5 Asset-Pipeline (du bist der Künstler)
- **Quellformat:** Sprites als Index-Raster in `assets-src/sprites/**/*.ts`. Ein Zeichen = ein Palettenindex laut Legende; dazu Frames, Anker, Hitbox, Hand-Sockel, Occluder-Form, Höhen-Hinweis (`flach | zylinder | kugel | block | custom`) und Emissiv-Kennzeichnung. Beispiel:
```ts
export default sprite({
  id: 'fackel_wand', size: [16, 16], anchor: [8, 15], hoehe: 'zylinder',
  legende: { '.': null, 'o': 'holz.2', 'O': 'holz.4', 'f': 'feuer.4*', 'F': 'feuer.6*' }, // * = emissiv
  frames: [
    `......fF........
     .....fFFf.......
     ......fF........
     .......O........
     .......o........`,
  ],
});
```
- **Generatoren** (deterministisch, geseedet) für Vielfalt: Baumkronen, Felsen, Kristalle, Erzadern, Tile-Varianten, Streudeko, Kreatur-Varianten, Materialstufen (eine Axt-Form × 8 Material-Rampen = 8 Stufen-Äxte), Möbel-Farbvarianten.
- **`npm run assets` erzeugt:** Albedo-Atlas (Palettenindex), Normal+Höhen-Atlas (automatisch aus der Silhouette: Distanzfeld → Höhe nach Höhen-Hinweis → Sobel → Normale, geglättet; manuelle Overrides möglich), Emissiv-Maske, Occluder- und Schattenformen, Manifest (Frames, Anker, Hitboxen, Sockel) sowie **Kontaktbögen** `tools/out/sheets/*.png`.
- **Qualitätsschleife:** Nach jeder Sprite-Serie den Kontaktbogen öffnen, gegen §4.5 kritisieren, überarbeiten. Maßstab: wirkt wie handgemachte 16-Bit-Pixelart, nie wie Rauschen oder Programmierergrafik.
- **Schrift:** eine OFL-Pixelschrift aus npm (z. B. @fontsource), die ÄÖÜäöüß sauber darstellt (prüfen!). Dieselbe Schrift für WebGL-Text: zur Laufzeit per Canvas2D in einen Glyphen-Atlas backen, Alpha hart schwellen → pixelscharf.
- **UI-Grafik:** 9-Slice-Rahmen, Slots, Buttons, Leisten, Scrollbars, Icons ebenfalls als Pixel-Quellen; CSS mit `image-rendering: pixelated` und ganzzahliger UI-Skalierung.
- Generierte Dateien sind Build-Artefakte (gitignored); `dev` und `build` erzeugen sie automatisch.

---

## §6 Render-Pipeline & Shader

Grundprinzip: **Pixelart bleibt pixelig.** Licht, Schatten und Effekte werden in interner Auflösung berechnet und in Pixelgröße gerastert (inkl. optionaler Licht-Bänderung mit Dithering). So entsteht ein moderner, spektakulärer Look, der trotzdem wie 16-Bit wirkt.

### 6.1 Frame-Ablauf (interne Auflösung + 1 px Rand)
| # | Pass | Ziel | Inhalt |
|---|---|---|---|
| 1 | Instanzdaten | GPU-Buffer | Sprite-Instanzen (Position, UV, Palettenzeile, Höhe, Flags, Wind-Parameter, Tönung); statische Chunk-Meshes für den Boden |
| 2 | G-Buffer (MRT) | G0 Albedo · G1 Normale XY + Höhe + Materialflags · G2 Emissiv + Glanz/Nässe | Boden → Wassermaske → y-sortierte Objekte → Dächer/Kronen (mit Dither-Ausblendung um den Spieler) |
| 3 | Occluder & SDF | R8-Maske → Jump-Flood → R16F-Distanzfeld | Wände, Stämme, Klippen, Felsen, große Objekte; separates Wasser-SDF für Uferschaum |
| 4 | Sonnen-/Mondschatten | R8 | Silhouette jedes Schattenwerfers, nach Sonnenstand geschert und gestreckt (morgens/abends lang, mittags kurz, wandert über den Tag), weich; dazu windgetriebene Wolkenschatten und Blätterdach-Sprenkel |
| 5 | Licht | RGBA16F | Umgebungslicht (Tageszeit/Biom/Wetter/Höhle) × SDF-AO; Sonne/Mond mit Normal-Mapping; Punkt- und Spotlichter als Quads mit weicher Dämpfung, Normal-Mapping (Lichthöhe), weichen SDF-Schatten (Sphere-Tracing mit Halbschatten), Flackern. **Ultra:** 2D-Global-Illumination per Radiance Cascades – emissive Pixel und Lichter beleuchten die Umgebung farbig inkl. Bounce, Endsammlung normalengewichtet |
| 6 | Komposition | HDR | Albedo × Licht (optional 6–10 Lichtbänder mit 4×4-Bayer-Dither) + Emissiv + Glanzlichter (nass, Metall, Eis) |
| 7 | Wasser | HDR | Refraktion des Grunds, Tiefenfärbung, Uferschaum (SDF), Kaustiken im Flachen, Spiegelung (Himmel; nachts Mond und Sterne; Objekte über der Uferlinie), **interaktive Wellen** (Wellengleichung in Ping-Pong-Textur um die Kamera; Impulse durch Figuren, Regentropfen, Pfeile, Fische), Eintauchmaske für Figuren, im Winter Eis mit Rissen |
| 8 | Atmosphäre | HDR | Nebelschichten (Rauschen; Dichte nach Biom/Wetter/Zeit; Lichter streuen im Nebel), God Rays durch Baumkronen bei tiefer Sonne, Wetterpartikel (Regen mit Windwinkel und Parallaxe, Spritzer am Boden, Schnee, Asche mit Glut, Sand), Blitz (Vollbildblitz + einen Frame harte Schatten vom Einschlagpunkt), Hitzeflimmern |
| 9 | Post | HDR → LDR | Verzerrungspuffer (Schockwellen, Hitze, Unterwasser), Bloom (Schwelle, 4 Stufen, interne Auflösung), Color-Grading über 3D-LUTs (Biom × Tageszeit × Wetter, weich überblendet, LUTs aus Parametern generiert), Zustandseffekte (Furcht, niedrige HP, Kälte, Hitze, Erschöpfung, Gift, Rausch), Vignette, feines Pixelkorn, Bayer-Dither-Übergänge |
| 10 | Präsentation | Canvas | scharfes Hochskalieren + Subpixel-Offset; optionaler CRT-Filter (standardmäßig aus); DOM-UI darüber |

### 6.2 Effekt-Katalog (alles Pflicht)
- **Wind:** Vertex-Wackeln von Gras, Büschen, Kronen, Bannern, Wäscheleinen (Windstärke und -richtung aus dem Wetter). Interaktives Gras: Figuren biegen es weg (Interaktionstextur).
- **Blätterdach & Dächer:** Kreis-Dither-Ausblendung um den Spieler; das Dach eines Innenraums blendet beim Betreten komplett aus.
- **Jahreszeiten:** Laub-Palettenzeilen je Jahreszeit mit Übergang über 2 Tage. Winter: weltfeste Schneemaske, die mit Schneefall wächst und auf nach oben zeigende Flächen fällt (Dächer, Kronen, Felsoberseiten); verblassende Fußspuren im Schnee.
- **Nässe:** globaler Nässewert → dunklerer Boden, Glanz, Pfützen in Senken, die Lichter spiegeln; trocknet langsam ab.
- **Feuer:** animierte Flammen, flackernde Lichter, Funken, Rauch, Hitzeflimmern; brennende Bäume und Gebäude mit Ausbreitung.
- **Lava:** fließende Rauschtextur, Kruste mit glühenden Rissen, stark emissiv, Hitzeflimmern.
- **Kristalle:** Glitzern, prismatische Farbaufspaltung, pulsierendes Eigenleuchten.
- **Schattenbrut:** Tinten-Rauch-Materialisierung (Rauschschwelle + violetter Rand), glühende Augen in der Dunkelheit, Zerfall in Funken beim Tod.
- **Verderbnis:** Paletten-Shift + animierte emissive Adern im Boden; weicht mit jedem entzündeten Leuchtfeuer.
- **Leuchtfeuer-Entzündung (Höhepunkt):** Lichtwelle breitet sich über die Region aus, Grading schwenkt von kalt-verdorben zu warm-lebendig, Partikelsturm, Musik-Stinger.
- **Kampf:** 2-Frame-Trefferblitz, Hitstop (2–6 Frames je Wucht), Knockback, skalierter Screenshake (abschaltbar), Waffen-Smears, Einschlagpartikel je Material, Auflösen besiegter Gegner.
- **GPU-Partikel:** ≥ 20 000 gleichzeitig (Textur-Simulation oder Transform-Feedback); emissive Partikel werfen in Ultra Licht.
- **Nacht:** kühles, gerichtetes Mondlicht (Mondphase = Helligkeit), Gegneraugen, Glühwürmchen, Leuchtpilze, Sterne in Wasserspiegelungen. **Höhlen:** Umgebungslicht ≈ 0, nur echte Lichtquellen zählen.
- Outline-Shader für Interaktion, Weißblitz, Palettenwechsel-Effekte, Dither-Fades.

### 6.3 Qualitätsstufen & Robustheit
| Stufe | Punktlichter | Schatten | GI | Wasser | Wetter/Partikel |
|---|---|---|---|---|---|
| Niedrig | 32 | nur Sonnenschatten | aus | vereinfacht | reduziert |
| Mittel | 64 | harte SDF-Schatten | aus | voll ohne Spiegelung | voll |
| Hoch (Standard) | 128 | weiche SDF-Schatten | aus | voll | voll |
| Ultra | 256 | weich | Radiance Cascades | voll | voll + Partikellicht |
- Automatische Voreinstellung per kurzem Benchmark beim ersten Start; bei Frame-Einbrüchen dynamisch Lichtpuffer halbieren.
- WebGL2 Pflicht (sonst verständliche Meldung). Ohne Float-Render-Targets: RGBA8-Kodierung als Fallback. `webglcontextlost` sauber behandeln: alle Ressourcen neu aufbauen, Spiel läuft weiter.
- Shader in `.glsl`-Dateien mit `#include`, Hot-Reload im Dev-Modus, Fehler-Overlay.
- **Render-Debugger** (Debug-Modus): jeden Puffer einzeln anzeigen – Albedo, Normalen, Höhe, Emissiv, SDF, Sonnenschatten, Licht, GI, Nässe, Nebel, Gameplay-Lichtkarte.

---

## §7 Design-Säulen
Jede Entscheidung wird gegen diese Säulen geprüft.
1. **Licht ist Leben.** Licht ist Ressource, Schutz, Werkzeug und Ästhetik. Die eigentliche Bedrohung ist die Dunkelheit.
2. **Jede Nacht erzählt eine Geschichte.** Spannung, Knappheit, emergente Momente: die Fackel verlischt im Regen, ein Wolfsrudel lauert am Rand des Lichtkreises.
3. **Das Zuhause zählt.** Die Basis ist emotionaler Anker: Wärme, Behaglichkeit, Siedler, Verteidigung.
4. **Erkundung wird belohnt.** Kein leerer Raum – jeder Ort hat einen Grund (Ressource, Rätsel, Geschichte, Beute, Aussicht).
5. **Systeme greifen ineinander.** Feuer × Wetter × Temperatur × Licht × Nahrung × Jahreszeit erzeugen emergentes Spiel.
6. **Respekt vor der Zeit des Spielers.** Kein stumpfer Grind; Komfortfunktionen (Crafting aus Kisten, Schnellablage, Blaupausen, Suche); jederzeit ein klares nächstes Ziel.
7. **Lesbarkeit vor Spektakel.** Der Look ist spektakulär, aber das Spiel ist immer lesbar.

---

## §8 Setting & Story
- **Welt:** der Kontinent **Lumara**. Vor 300 Jahren versuchten die **Erbauer**, das **Urfeuer** zu bändigen, um die Nacht für immer zu beenden. Dabei rissen sie das **Nachtherz** auf – eine Wunde, aus der Dunkelheit sickert. Sechs **Leuchtfeuer** hielten sie in Schach, bis eines nach dem anderen erlosch. Seitdem sind die Tage grau und die Nächte tödlich: Die **Schattenbrut** jagt alles außerhalb des Lichts. Manche Menschen sind der Dunkelheit verfallen – die **Gezeichneten** (Plünderer, Kultisten); einige lassen sich retten.
- **Spielfigur:** ein Glutträger, der an der Südküste Schiffbruch erleidet. Bei sich trägt er eine Laterne mit der letzten Glut eines Leuchtfeuers: **Funke**, ein wortkarger Flammengeist, der Hinweise gibt (höchstens 2 Zeilen pro Einwurf, nie aufdringlich, abschaltbar).
- **Hauptziel „Die sechs Feuer":** Je Biom ein Leuchtfeuer, bewacht vom Boss des Bioms. Entzünden → die Region heilt sichtbar, Schutzzone, Schnellreisepunkt, neues Wissen, Story-Vision.
- **Finale:** Abstieg ins Nachtherz mit der vereinten **Sechsfach-Flamme**; Kampf gegen den **Verschlinger**, den mit der Dunkelheit verschmolzenen Anführer der Erbauer. Ende „Gleichgewicht": natürliche Nächte kehren zurück, die Schattenbrut wird zur seltenen Gefahr, Funke bleibt.
- **Geheimes Ende:** Alle 60 Erbauer-Tafeln gefunden → Funkes wahre Herkunft (ein Splitter des Urfeuers), zusätzliche Finalphase, alternativer Epilog.
- **Nach dem Abspann – „Nachwelt":** Die Welt läuft weiter (heller, Schattenflut seltener), neue Herausforderungen: Echo-Bosse, Nachtherz-Tiefen, Nachtstahl-Ausrüstung. NG+ optional.
- **Ton:** melancholisch und hoffnungsvoll, wenig Text, viel Umgebungserzählung. Vermittlung über 60 Erbauer-Tafeln, Funke-Kommentare, Umgebungsdetails, Siedler-Geschichten und 7 Visionen (kurze In-Engine-Sequenzen mit Pixel-Standbildern). Alle Texte DE und EN.

---

## §9 Welt & Weltgenerierung

### 9.1 Größe & Struktur
- Weltgröße wählbar: Klein 1024² · **Mittel 1536² (Standard)** · Groß 2048² Tiles; Chunks 32×32; vollständig seed-deterministisch.
- Ebenen: Oberfläche + 3 Untergrund-Ebenen (**−1 Wurzelhöhlen, −2 Tiefgrund, −3 Glutadern**), gleiches Koordinatensystem. Zugang über natürliche Höhleneingänge, Dungeon-Abstiege und selbst gegrabene Schächte (ab T2, mit Leiter).
- Oberfläche mit Höhenstufen 0–4, Klippen, Rampen und Treppen. Höhe senkt die Temperatur (−3 °C je Stufe) und vergrößert die Kartenaufdeckung.

### 9.2 Generierung (im Worker)
1. Inselmaske (Rauschen + Falloff): Küste mit Buchten, Halbinseln, vorgelagerten Inseln.
2. Poisson-Disc-Regionen (≈ 40 / 70 / 110 je Größe) → Voronoi → Regionsgraph.
3. Biomzuweisung per Constraint-Löser: Startregion Grünhain an der Südküste; Biomstufe wächst mit der Graphdistanz zum Start (mit Jitter); Klimaplausibilität (Frostkamm im Norden bzw. hoch, Glutsand trocken im Süden/Osten fern vom Nebelmoor, Aschenschlund angrenzend an Frostkamm- oder Glutsand-Gebirge, Scherbenhain ringförmig um das Nachtherz in der entferntesten Region). Jedes Biom kommt mehrfach vor. Jede Stufe ist ohne Überspringen erreichbar.
4. Höhenfeld (Regionsbasis + Rauschen), Klippen, Rampen.
5. Flüsse vom Gebirge zur Küste entlang des Gefälles (1–4 Tiles breit), Seen in Senken, Furten, Bäche, Quellen.
6. Biomgrenzen per Domain-Warp verwischt, Übergangsstreifen (z. B. Taiga zwischen Grünhain und Frostkamm).
7. Ressourcen (Blue-Noise-Streuung + Cluster; Erze nach Stufe, Höhe und Ebene), Vegetation, Streudeko.
8. Orte (§21) nach Regeln (Abstand, Biom, Höhe, Erreichbarkeit); zerfallene Erbauer-Straßen verbinden die Leuchtfeuer-Stätten als Orientierung.
9. Validierung: jede Region erreichbar (sonst Brücken, Furten, Rampen einfügen), jede Leuchtfeuer-Stätte mit Boss-Arena, Mindestmengen jeder Ressource pro Stufe (sonst lokal nachstreuen).
- Untergrund: zelluläre Automaten + Rauschtunnel + Kavernen, unterirdische Seen und Lavaseen, Erzadern, Pilzhaine, Höhlenorte.
- Tests: gleicher Seed ⇒ identischer Hash aller Chunk-Daten; 20 verschiedene Seeds ⇒ alle Validierungen grün.

### 9.3 Biome
| Biom | Stufe | °C (Frühlingstag) | Kern-Features | Ressourcen (Auswahl) |
|---|---|---|---|---|
| Grünhain | T0–1 | 16 | Laub-/Mischwald, Wiesen, Bäche, Hügel | Holz, Stein, Feuerstein, Fasern, Lehm, Harz, Beeren, Pilze, Kräuter, Kupfer, Zinn |
| Salzküste | T0–2 (Ring) | 17 | Strände, Klippen, Watt mit Gezeiten (Ebbe legt Muscheln und Wracks frei), Riffe | Sand, Salz, Muscheln, Tang, Treibholz, Fisch, Perlen, Robbenfett (Lampenöl) |
| Nebelmoor | T2 | 14 | Sumpf, dichter Nebel, Torfmoore, Mangroven, Moorseen (krankmachend) | Raseneisen, Torf, Schilf, Moorholz, Egel, Moorbeeren, Giftdrüsen |
| Frostkamm | T3 | −8 (Gipfel −20) | Tundra, Nadelwald, Gletscher, Eisseen, Lawinenhänge | Steinkohle, Silber, Pelze, Eis, Bergtee, Frostbeeren |
| Glutsand | T4 | 34 (nachts 8) | Dünen, Canyons, Oasen, Salzpfannen, Ruinenstädte, Treibsand | Golderz, Klarquarz, Sandstein, Kaktus, Baumwolle, Datteln |
| Aschenschlund | T5 | 38 (an Lava +20) | Vulkane, Lavaflüsse, Ascheebenen, Geysire, Schwefelfelder | Obsidian, Schwefel, Magmit, Glutchitin, Feuerwurz |
| Scherbenhain | T6 | 12 | Kristallwald, schwebende Scherben, Prismenseen, Lichtanomalien | Lumenit, Prismenquarz, Sternenstaub, Lichtholz |
| Nachtherz | T7 | 5 (unnatürlich) | Krater, Verderbnis, umgekehrtes Licht, Finale | Nachtstahl-Erz, Leerenessenz |
| Wurzelhöhlen (−1) | T1–2 | 12 | Wurzelgeflecht, Pilzhaine, Grundwasserseen | Kupfer, Zinn, Lehm, Salpeter, Leuchtpilze |
| Tiefgrund (−2) | T2–4 | 14 | Kavernen, Kristalladern, Erbauer-Ruinen | Eisenerz, Silber, Gold, Klarquarz, Edelsteine |
| Glutadern (−3) | T4–6 | 30 | Lavakammern, Obsidianhallen | Magmit, Obsidian, Lumenit-Adern |

Temperatur = Biombasis + Jahreszeit (Frühling 0 · Sommer +8 · Herbst −3 · Winter −14) + Tageskurve (±6 °C, Glutsand ±18 °C) + Wetter (§10) + Höhe. Höhlen bleiben nahe ihrem Basiswert.

---

## §10 Zeit, Jahreszeiten, Wetter, Ereignisse
- **Zeit:** 1 Spielstunde = 1 Echtminute (Tag = 24 min; wählbar 12/24/36/48). Nachtlänge: Frühling/Herbst 8 h, Sommer 5 h, Winter 11 h; Dämmerungen je 2 h weich überblendet.
- **Mond:** 8-Tage-Zyklus; Vollmond = hellste Nacht; Neumond = **Finstermond** (+50 % Schattenbrut, stärkere Varianten).
- **Jahreszeiten:** je 7 Tage (wählbar 3–14), Start Frühling Tag 1. Wirken auf Temperatur, Wachstum, Tierverhalten (Brutzeit, Wanderungen, Winterruhe), Wetterwahrscheinlichkeiten, Laubfarben, Schnee und Eis (Seen/Flüsse frieren nach 2 Tagen unter −10 °C zu und sind begehbar, tauen wieder).
- **Wetter:** Markov-Automat pro Biom × Jahreszeit (Übergangsmatrizen als Content), Dauer 1–8 Spielstunden, weiche Übergänge (Wolkendecke, Wind, Niederschlag interpoliert). Zustände: Klar, Bewölkt, Nebel, Niesel, Regen, Gewitter, Schnee, Schneesturm, Hitzewelle, Sandsturm, Ascheregen, Sternschnuppen-Nacht. Temperaturversatz: Regen −3, Gewitter −5, Schnee −4, Schneesturm −10, Hitzewelle +8, Sandsturm +3, Ascheregen +2.
- **Wetterwirkung:** Sichtweite, Nässe, Temperatur, Wind (Pfeilflug, Windräder, Segel, Feuerausbreitung), Pflanzen gießen, Feuer löschen, Fackeln (Regen halbiert die Brenndauer, Starkregen 5 % Erlöschchance pro Minute), Tierverhalten, Geräusche (Regen maskiert Schritte → Schleichen leichter).
- **Blitze** schlagen bevorzugt in hohe Objekte und Metall, können Bäume und Holzbauten entzünden; Blitzableiter (Leuchtfeuer 3) schützt die Basis.
- **Ereignisse:** **Schattenflut** (Belagerung der Basis, jede 7. Nacht, §16.8) · **Finstermond** · **Lumenregen** (Sternschnuppen: glühende Scherben schlagen ein, selten ein Meteorit mit Sternenerz) · **Nebelnacht** (Irrlichter) · **Sonnenfinsternis** (selten: tagsüber eine Stunde Nacht) · **Wandernde Händlerin** · **Tierwanderung** · **Lawine** · **Waldbrand** (Sommer, Blitz) · **Flut** (Nebelmoor) · **Erdbeben** (Aschenschlund, öffnet neue Höhlengänge). Jedes Ereignis wird angekündigt (Himmel, Grading, Sound, Funke, HUD) und in der Chronik vermerkt.

---

## §11 Spieler & Überlebenswerte
Alle Werte sind Startwerte in `balance.ts`; alle Formeln sind reine, unit-getestete Funktionen.

### 11.1 Werte
| Wert | Bereich | Verlauf | Folgen |
|---|---|---|---|
| Leben | 100 (+10 je Boss-Herzsplitter; + Ausrüstung/Mahlzeit) | Regeneration 0,5/s, wenn Sättigung > 50, Durst > 30 und 5 s kein Schaden; ×2 sitzend am Feuer oder im Bett | 0 → Tod (11.6) |
| Ausdauer | 100 (+5 je Glutsplitter, 12 in der Welt) | +25/s nach 0,8 s Pause; −50 % bei Sättigung < 20 | Sprint 12/s, Rolle 20, Angriffe/Blocken je Waffe, Schwimmen 5/s |
| Sättigung | 0–100 | −100 in 36 min; ×2 beim Sprinten, ×1,25 bei Kampf/Abbau, ×1,3 bei Kältestress, ×0,5 im Schlaf | < 20 „Hungrig", 0 „Verhungernd" (−1 HP/2 s) |
| Durst | 0–100 | −100 in 24 min; ×1,5 bei Hitze; salzige Speisen erhöhen | 0 „Verdurstend" (−1 HP/s) |
| Körpertemperatur | Kern 37,0 °C | 11.2 | Kälte- und Hitzestufen |
| Nässe | 0–100 % | Regen +2 %/s, Schwimmen → 100; trocknet 1 %/s am Feuer, 0,2 %/s innen, 0,1 %/s draußen | senkt Isolation um bis zu 70 % |
| Erschöpfung | 0–100 | +100 in 36 min Wachzeit; Schlaf senkt | > 70 „Müde" (−15 % Ausdauerregeneration, Lidschlag-Effekt), > 90 „Erschöpft" (−25 % Aktionstempo) |
| Furcht | 0–100 | §12.3 | Wahrnehmungseffekte, Trugbilder, Nachtmahr |

### 11.2 Temperatur-Modell
- Gefühlte Temperatur T_u = Umgebung (§9.3) + Wärmequellen (Feuer +15 °C im Kern, zum Rand abfallend) + Raumwert (§16.4).
- Komfortband: [18 − Isolation × (1 − 0,7 × Nässe), 26 + Kühlung]. Kleidung liefert Isolation (0–40) und Kühlung (0–15).
- Stress = Abstand von T_u zum Band. Kerntemperatur ändert sich um 0,002 °C/s × Stress; im Band Rückkehr zu 37,0 mit 0,01 °C/s.
- Stufen: < 36,0 **Frierend** (−10 % Präzision und Arbeitstempo, Zittern) · < 35,0 **Unterkühlt** (−30 % max. Ausdauer, −0,5 HP/s, Frostrand) · < 33,0 **Erfrierend** (−2 HP/s) · > 38,0 **Erhitzt** (Durst ×1,5) · > 39,0 **Überhitzt** (−50 % Ausdauerregeneration, −0,5 HP/s) · > 40,5 **Hitzschlag** (−2 HP/s, Flimmern).
- HUD: Thermometer mit Trendpfeil; Tooltip mit gefühlter Temperatur und Einflüssen.

### 11.3 Zustände (mindestens 30)
Blutung, Vergiftung, Lebensmittelvergiftung (Übelkeit, Erbrechen senkt Sättigung), Fieber (aus Moorwasser/Mücken; heilt mit Medizin und Ruhe), Brennen, Durchnässt, Frierend, Unterkühlt, Erfrierend, Erhitzt, Überhitzt, Hitzschlag, Müde, Erschöpft, Verlangsamt, Betäubt, Geblendet, Knochenbruch (−40 % Tempo bis zur Schiene), Wohlgenährt, Ausgeruht, Behaglich, Erleuchtet (Leuchtfeuer-/Lichtwachtzone), Morgenrot (nach überstandener Schattenflut), Nachtsicht, Beschwipst, Erschüttert (nach Wiedereinstieg), Mahlzeit- und Trankeffekte. Jeder Zustand: Icon, Dauer, Stapelregel, Tooltip, sichtbare Wirkung.

### 11.4 Bewegung & Aktionen
- Gehen 4,5 Tiles/s · Sprint 7 · Schleichen 2,5 (Geräusch −70 %) · Rolle 3 Tiles mit 0,25 s Unverwundbarkeit · Schwimmen 2,5 (Tiefwasser zehrt Ausdauer; bei 0 Ertrinken −5 HP/s). Rüstungsgewicht: leicht 0 %, mittel −5 %, schwer −10 % Tempo.
- Klippen: Herunterspringen möglich (1 Stufe gefahrlos, 2 Stufen Schaden, ab 3 Knochenbruch-Risiko); hinauf nur über Rampen, Treppen, platzierte Leitern.
- Aktionen: Sammeln (halten, Fortschrittsring), Interagieren (E), Werfen, Essen/Trinken (unterbrechbar), Sitzen (Stühle, Baumstümpfe), Schlafen, Musizieren.
- Aufheben: Kleinteile im Radius 1,5 Tiles automatisch (Magnet), sonst E; volle Taschen → klarer Hinweis.

### 11.5 Schlaf
Möglich ab 19:00 oder bei Erschöpfung > 60, nicht mit Feinden im Umkreis von 20 Tiles. Zeit läuft ×30 bis 06:00 (bzw. bis Erschöpfung 0). Das Bett setzt den Wiedereinstiegspunkt und gibt „Ausgeruht" (+10 % max. Ausdauer, +25 % Ausdauerregeneration, +5 % Erfahrung; Dauer 8 min + 1 min je Behaglichkeitspunkt). Schlafsack: halbe Erholung, kein „Ausgeruht". Angriffe wecken.

### 11.6 Tod & Wiedereinstieg
„Dein Licht ist erloschen." Am Todesort entsteht ein Grab mit dem Inventar (auf der Karte markiert, bleibt bis geleert). Wiedereinstieg am Bett, an einem entzündeten Leuchtfeuer oder am Startstrand, danach 3 min „Erschüttert" (−15 % max. Leben). Strafen je Schwierigkeit (§29).

---

## §12 Licht & Dunkelheit (Kernmechanik)

### 12.1 Gameplay-Lichtkarte
- CPU-seitig pro Tile (bilinear abgetastet), gespeist aus **derselben** Lichtquellenliste wie der Renderer. Verdeckung per Tile-Raycast gegen Wände und Klippen, pro Lichtquelle gecacht, bei Bauänderungen invalidiert. Ein Debug-Overlay vergleicht Gameplay-Licht mit gerendertem Licht (müssen übereinstimmen).
- Stufen: **Dunkel** < 0,15 · **Dämmrig** 0,15–0,4 · **Hell** 0,4–0,9 · **Gleißend** > 0,9.
- Umgebungslicht: Tag 1,0 (wetterabhängig bis 0,6), Dämmerung verlaufend, Nacht 0,05–0,12 (Mondphase), Finstermond 0,02, Höhle 0.

### 12.2 Lichtquellen (Auswahl)
| Quelle | Radius (Tiles) | Brenndauer | Besonderheit |
|---|---|---|---|
| Fackel (Hand/Wand) | 6 | 4 Spielstunden | entzündet Brennbares, Regen verkürzt, kann erlöschen |
| Lagerfeuer | 8 | Brennstoff (§15.4) | Wärme, Kochen, Furchtabbau |
| Öllaterne | 7 | 12 h je Öl | wetterfest |
| Blendlaterne | Kegel 10, 60° | Öl | folgt der Zielrichtung, harte Schatten |
| Lumen-Laterne (ab Leuchtfeuer 1) | 8 | Lumen-Ladung | Schattenbrut im Umkreis von 2 Tiles erleidet 5 Schaden/s |
| Glühwürmchenglas | 3 | 2 Tage | kostenlos, schwach |
| Leuchtpilzbeet | 2 | dauerhaft | wächst nur im Dunkeln |
| Feuerschale/Kohlebecken | 7 | Kohle | Wärme, Verteidigung |
| Kerzen, Wandlampen, Kronleuchter | 3–9 | Wachs/Öl/Lumen | Behaglichkeit |
| Lumen-Lampe | 9 | Strom (§24) | schaltet nachts automatisch |
| Lichtwacht (Leuchtfeuer 4) | 14 + Strahl | Strom/Lumen | Turm, bekämpft Schattenbrut |
| Leuchtpfeil | 3 | 60 s | steckt im Boden oder im Gegner |
- **Nebenhand-Regel:** Die Lichtquelle sitzt in der Nebenhand. Mit Schild oder Zweihandwaffe hängt sie am Gürtel (−40 % Radius). Das Schmuckstück „Schulterlaterne" (T4) hebt das auf.
- Licht wirkt als Schutz (Spawnverbot), Furchtabbau, Sicht (Gegner im Dunkeln sind nur als Augen erkennbar) und Verrat: Wer leuchtet, wird von Gegnern doppelt so weit gesehen.

### 12.3 Furcht
- **Anstieg:** Dunkel +1,0/s nachts, +0,5/s in Höhlen · Verderbnisgebiet +0,5/s · Sichtung Elite/Boss +10 · rohe oder verdorbene Nahrung +5 · Tod eines Siedlers +20.
- **Abbau:** Hell −0,5/s · am Feuer/Herd −1/s · behaglicher Raum bis −1,5/s (skaliert mit Behaglichkeit) · Schlaf −5 pro Spielstunde · Wohlfühlessen −10 bis −25 · Musizieren (Flöte, Laute) −2/s im Umkreis · Begleiter in der Nähe −0,2/s.
- **Effekte:** ab 40 Flüstern und Schatten am Bildrand · ab 60 Trugbilder (verschwinden bei Treffer oder Licht) und Entsättigung · ab 80 können Trugbilder echten Schaden anrichten · bei 100 erscheint ein **Nachtmahr**, der dich jagt, bis du gleißendes Licht erreichst oder ihn besiegst.

### 12.4 Schattenbrut-Regeln
- Spawnt nur auf Tiles mit Licht < 0,15, 16–40 Tiles vom Spieler entfernt, außerhalb von Leuchtfeuer- und Herdzonen, nachts oder im Untergrund; Dichte nach Biomstufe, Mondphase und Schwierigkeit.
- Meidet Licht > 0,5 (Ausnahmen: Schattenflut, Lichtfresser), erleidet in gleißendem Licht 5 Schaden/s, verblasst bei Sonnenaufgang (ohne Beute).
- Der **Lichtfresser** löscht Fackeln und Laternen im Umkreis von 4 Tiles und saugt Lumen-Ladungen ab.
- Beute: **Lumen-Scherben** – Hauptquelle für Lumen. Nachtkämpfe sind Risiko und Belohnung zugleich.

---

## §13 Items, Inventar, Ausrüstung, Stufen

### 13.1 Inventar & Ausrüstung
- Inventar 30 Plätze + Schnellleiste 10 (Tasten 1–0, Mausrad); Rucksack-Slot +8/+16/+24.
- Stapel: Rohstoffe 100, Barren 50, Nahrung 20 (Frische beim Zusammenlegen gewichtet gemittelt), Munition 200, Werkzeuge/Waffen/Rüstung 1.
- Ausrüstung: Kopf, Brust, Beine, Füße, Rücken, Nebenhand (Licht oder Schild), 2× Schmuck, Gürtel (3 Schnellverbrauch-Plätze, Taste Q).
- Haltbarkeit für Werkzeuge, Waffen, Rüstung; Reparatur an Werkbank, Amboss oder Schleifstein (anteilige Materialkosten). Kaputt = unbenutzbar, nie zerstört.
- Qualität 1–3 Sterne (aus Handwerks-Skill und Stationsstufe): +10 % bzw. +20 % auf Werte und Haltbarkeit.
- Rüstungssets mit Set-Boni (z. B. Pelz: Isolation · Moorleder: Giftresistenz · Wyrmschuppe: Frostresistenz · Sonnenchitin: Kühlung · Magmit: Feuerimmunität · Lumenit: −30 % Schaden durch Schattenbrut).
- Schmuck (≥ 30): Ringe, Amulette, Talismane (Wärmestein, Wasseratmung, Schleichen, Kritchance, Lichtradius, Magnetradius, Furchtresistenz, Schulterlaterne …).
- Item-Daten: id, Kategorie, Stufe, Rarität, Stapelgröße, Haltbarkeit, Werte, Quellen, Verwendungen (automatisch berechnet), Frische, Brennwert, Tauschwert, Icon, Sprite, Sounds, Texte DE/EN.

### 13.2 Stufen & Gating
Abbaukraft des Werkzeugs muss ≥ Härte der Ressource sein. Die Spitzhacke jeder Stufe ab T1 braucht den Schlüssel-Drop des Bosses dieser Stufe – so erschließt jeder Boss die nächste Welt. Waffen und Rüstung einer Stufe brauchen keinen Boss-Drop.

| Stufe | Werkzeugmaterial | Abbaukraft | Spitzhacke braucht | Erschließt | Biome |
|---|---|---|---|---|---|
| T0 | Stein, Feuerstein, Knochen | 1 | – | Kupfer, Zinn (Härte 1) | Grünhain, Wurzelhöhlen |
| T1 | Bronze | 2 | Kernholz (Borkenvater) | Raseneisen, Eisenerz, Torf | Nebelmoor, Tiefgrund |
| T2 | Eisen | 3 | Sumpfherz (Sumpfmutter) | Steinkohle, Silber | Frostkamm |
| T3 | Stahl | 4 | Wyrmhorn (Hrimgar) | Gold, Klarquarz | Glutsand, Tiefgrund |
| T4 | Sonnenstahl | 5 | Sonnenchitin (Skarabäus-Koloss) | Obsidian, Magmit, Schwefel | Aschenschlund, Glutadern |
| T5 | Magmit | 6 | Glutamboss-Kern (Aschenschmied) | Lumenit, Prismenquarz | Scherbenhain, Glutadern |
| T6 | Lumenit | 7 | Prismenherz (Gefallene Hüterin) | Nachtstahl-Erz | Nachtherz |
| T7 | Nachtstahl | 8 | Herz der Nacht (Verschlinger) | Nachwelt-Ausrüstung | – |

Weiche Biom-Voraussetzungen (Umgebung ist ohne sie lebensgefährlich, aber betretbar): Nebelmoor – Giftschutz + Floß · Frostkamm – Isolation ≥ 20 · Glutsand – Kühlung ≥ 8 + Trinkschläuche · Aschenschlund – Hitzeschutz (Wyrmschuppen-Umhang oder Kühltrank) · Scherbenhain – Spiegelschild + Rauchglasbrille (gegen Blendung) · Nachtherz – Sechsfach-Flamme.

---

## §14 Ressourcen & Sammeln
- **Bäume:** Axt-Treffer bis zum Fall; der Baum fällt vom Spieler weg und verletzt Kreaturen, auf die er stürzt. Der Stumpf bleibt (roden: Harz/Holz); 40 % Chance auf Setzling. Außerhalb von Basen wächst Wald langsam nach. Arten: Eiche, Birke, Kiefer, Weide, Mangrove, Tanne, Dattelpalme, Aschebaum, Lichtbaum, Obstbäume (Apfel, Kirsche, Birne, Walnuss) – mindestens 14.
- **Steine & Erze:** Knoten mit Treffer-HP; zu schwaches Werkzeug → „Zu hart" + Funken. Im Untergrund Erzadern als grabbares Tile-Material. Oberflächenknoten wachsen außerhalb des Basisradius nach 7 Tagen nach.
- **Pflanzen:** Fasergras, Beerensträucher (saisonal, nachwachsend), Kräuter, Pilze (Ort und Tageszeit), Schilf, Kakteen (Stacheln), Blumen (Farbstoffe, Deko, Bienen).
- **Graben (Schaufel):** Erde, Lehm, Sand, Kies, Torf, Schnee; begrenztes Terraforming (Gräben, Wassergräben, Pfade, Felder); versteckte Buddelstellen.
- **Angeln:** Angel (T0 Stock + Faser + Knochenhaken bis T3 Stahlrute), Köder, Minispiel (Spannung halten, Fisch zieht, Rute biegt sich), ≥ 24 Fischarten nach Biom, Tageszeit, Wetter und Jahreszeit; Reusen (passiv); Eisangeln im Winter.
- **Jagen & Zerlegen:** Fleisch, Fell/Leder, Knochen, Federn, Fett, Sehnen, Spezialteile; Fallen (Schlinge, Kastenfalle).
- **Werkzeuge:** Axt, Spitzhacke, Schaufel, Hacke, Sichel, Hammer (Bauen/Reparieren), Angel, Netz (Insekten, Glühwürmchen, Bienen), Eimer, Gießkanne, Schere, Messer, Kompass (T1), Enterhaken (T3), Fernrohr (Leuchtfeuer 4).
- **Feedback:** Partikel je Material, materialspezifische Treffersounds, fliegende Drops mit Magnet, Fortschrittsanzeige bei großen Objekten.

---

## §15 Crafting & Stationen

### 15.1 Regeln
- Ohne Station herstellbar: Grundlagen (Faserseil, Steinwerkzeuge, Fackel, Lagerfeuer, Werkbank, Verband, Grasbett, Speer).
- Ein Rezept wird sichtbar, sobald jede Zutat einmal besessen wurde und die Station bekannt ist. Zusätzlich: Baupläne (Dungeons, Händlerin, Tafeln), Leuchtfeuer-Wissen (§23.1), Forschungspult (Relikte studieren).
- Crafting nimmt aus Inventar und Kisten im Umkreis von 8 Tiles (abschaltbar); Mengenwahl, Warteschlange (10), Abbrechen erstattet vollständig.
- Verarbeitungsstationen (Öfen, Meiler, Trockengestell, Gerbrahmen, Gärfass, Räucherkammer, Kompost) haben Eingang, Brennstoff und Ausgang, laufen zeitbasiert und holen in entladenen Chunks per Zeitstempel auf.
- Rezept anheften → HUD zeigt fehlende Zutaten live. Für jedes Item „Verwendet in" und „Herkunft" nachschlagbar.
- Stationsstufen erhöhen Qualität, Tempo und verfügbare Rezepte.

### 15.2 Stationen (mindestens 30)
Lagerfeuer · Werkbank I–III (Werkzeugwand, Hobelbank, Schraubstock) · Sägebock → Sägewerk · Steinmetzbank · Trockengestell · Gerbrahmen · Spinnrad · Webstuhl · Schneidertisch · Lehmofen (Ziegel, Keramik, Glas) · Köhlermeiler · Schmelzofen I–III (Blasebalg, Hochofen) · Amboss (Bronze bis Magmit) · Schleifstein · Kessel · Backofen · Räucherkammer · Mühle · Gärfass · Butterfass & Käsepresse · Kräutertisch (Alchemie I–II) · Juwelierbank · Kartentisch · Forschungspult · Runenaltar · Lumen-Werkbank · Linsenschleifer · Glutschmiede · Prismenwerkbank · Nachtschmiede · Kompostkiste.

### 15.3 Verzauberung (Runenaltar)
Essenzen aus Elites, Bossen und Dungeons; 1–2 Runen-Slots ab Rarität Selten. Effekte: Elementarschaden, Lebensraub, Beuteglück, Lichtaura, Haltbarkeit, Tempo. Gezielt wählbar, kein Zufallscasino; Kosten steigen je Slot.

### 15.4 Brennwerte (Echtsekunden, Startwerte)
Zweig 15 · Holzscheit 45 · Harzholz 60 · Torf 90 · Holzkohle 120 · Steinkohle 180 · Öl 240 · Magmit 600. Ein Lagerfeuer fasst höchstens 6 Minuten.

---

## §16 Basisbau & Verteidigung

### 16.1 Raster & Ebenen
Tile-Raster 16×16. Ebenen: Boden · Struktur (Wände, Zäune, Türen, Tore, Fenster, Säulen) · Objekte (1×1 bis 4×4) · Wandobjekte (Fackeln, Regale, Bilder, Trophäen) · Dach. Baureichweite 8 Tiles. Wasserbauten (Stege, Brücken, Pfahlbauten) auf Pfählen.

### 16.2 Materialien
| Material | Wand-HP | Brennbar | Stufe |
|---|---|---|---|
| Stroh/Palisade | 150 | ja | T0 |
| Holz | 300 | ja | T0 |
| Fachwerk/Lehm | 450 | kaum (−70 %) | T1 |
| Stein | 900 | nein | T1 |
| Ziegel | 1100 | nein | T2 |
| Verstärkter Stein | 1800 | nein | T2 |
| Eisenverstärkt | 2600 | nein | T3 |
| Obsidian | 4000 | nein | T5 |
| Lumenit | 6000 | nein; repariert sich 1 %/min, Schattenbrut meidet es | T6 |
Dazu Böden, Dächer (Stroh, Schindeln, Ziegel, Schiefer, Glas, Metall), Türen (Holz, verstärkt, Eisen, zweibreites Tor, Falltür), Fenster (Öffnung, Glas, **Buntglas: farbiges Licht fällt in den Raum**).

### 16.3 Statik
Jedes Dachtile braucht eine Stütze (Wand oder Säule) in Reichweite: Stroh 3, Holz 5, Stein/Ziegel 6, Metall 8 Tiles. Wird eine Stütze entfernt, stürzen ungestützte Dachtiles ein (Staub, 50 % Material zurück). Der Baumodus zeigt die Stützreichweite als Overlay.

### 16.4 Räume
- Automatische Raumerkennung (Flood-Fill; geschlossen durch Wände, Türen, Fenster; ≤ 400 Tiles). Innenraum = mindestens 90 % überdacht.
- Innenraum: kein Niederschlag, Temperatur nach Dämmwert der Wände Richtung 18 °C gedämpft, Heizquellen (Kamin, Ofen) und Kühlquellen (Eis) wirken.
- Raumtypen (automatisch erkannt, im Baumodus angezeigt): **Schlafraum** (Bett + Licht: Ausgeruht ×1,5) · **Küche** (Kessel + Vorrat + Tisch: +20 % Kochtempo, +10 % Mahlzeitwirkung) · **Werkstatt** (≥ 3 Stationen: +15 % Tempo) · **Lager** (≥ 4 Kisten: Verderb −10 %) · **Speisesaal** (Tisch + ≥ 2 Stühle: Essen senkt Furcht zusätzlich) · **Gewächshaus** (Glasdach + Beete: ganzjährig) · **Stall** (Trog + Tiere) · **Eiskeller** (< 4 °C: Verderb ×0,2) · **Trophäenhalle** (Behaglichkeit).
- **Behaglichkeit 0–20** aus einzigartigen Möbelkategorien, Licht, Wärme, Raumgröße und Deko → Dauer von „Ausgeruht" und Tempo des Furchtabbaus.

### 16.5 Herdfeuer (Basiskern)
- Pro Basis ein Herdfeuer, höchstens 3 Basen. Radius 12 Tiles, mit Glutkernen (einer je Leuchtfeuer) bis 40 Tiles aufrüstbar.
- Brennstoff: Holzscheite (1 je Spielstunde), Holzkohle (1 je 3 h) oder Lumen-Scherben (1 je 6 h); Vorratsfach 40.
- Solange es brennt: keine Schattenbrut-Spawns im Radius, Lagerübersicht aller Kisten, Wiedereinstiegspunkt, Schnellreiseziel. Erlischt es, entfällt der Schutz.
- Das Herdfeuer ist das Ziel der Schattenflut.

### 16.6 Bau-UX
- Baumodus (B) mit Kategorienleiste (Fundament/Boden, Wände, Türen/Fenster, Dächer, Möbel, Stationen, Licht, Lagerung, Landwirtschaft, Verteidigung, Deko, Lumen-Netz) und Suche.
- Geister-Vorschau grün/rot mit Grund („Keine Stütze in Reichweite", „Blockiert", „Zu weit"), Drehen (R), Spiegeln (F), Ziehen für Linien und Rechtecke (Wände als Umriss, Böden gefüllt), Pipette (Mittelklick), Rückgängig innerhalb von 10 s (Strg+Z).
- **Blaupausen:** Pläne ohne Material platzieren; mit Hammer oder durch Siedler fertigstellen, Material kommt aus Kisten im Umkreis.
- Aufwerten an Ort und Stelle (Holz → Stein), Flächenreparatur, Abbauen (100 % zurück in den ersten 30 s, danach 60 %).
- Overlays: Räume/Typen, Temperatur, Licht, Behaglichkeit, Stützen, Stromnetz.

### 16.7 Lagerung
Holzkiste 16 · Truhe 24 · Eisentruhe 36 · Lagerregal 48 (nur Rohstoffe) · Kühlkiste 16 (Eis, Verderb ×0,3) · Vorratsfass (Nahrung, ×0,75). Umbenennen + Icon-Etikett, Sortieren, Schnellablage in passende Kisten (10 Tiles), „Alles einlagern" (außer Schnellleiste), Suche über alle Kisten der Basis.

### 16.8 Verteidigung & Schattenflut
- Bauteile: Palisade, Spitzpfähle, Fallgrube, Bärenfalle, Stolperdraht mit Glocke, Pfeilturm (Munition aus verknüpfter Kiste), Balliste (T3), Feuerschale, Ölrinne (entzündbar), Wassergraben, Lichtwacht (Leuchtfeuer 4), Blitzableiter.
- **Schattenflut:** Ankündigung bei Abenddämmerung (violetter Himmel, Grading, Sound, Funke, HUD-Countdown). 3–6 Wellen aus der Dunkelheit am Basisrand, Flow-Field-Wegfindung zum Herd. Brecher greifen die schwächste Wand an, Gleiter überfliegen Mauern und jagen Lichtquellen, Lichtfresser löschen Fackeln. Stärke skaliert mit Spieltag, Basisstufe und Schwierigkeit. Belohnung: viele Lumen-Scherben, „Morgenrot", Chronik-Eintrag.
- Kein Dauerverfall: Gebäude nehmen nur durch Schattenflut, Brände und Bosse Schaden.

---

## §17 Landwirtschaft & Tierhaltung
- **Boden:** Hacke → Ackerboden mit Feuchte (0–100) und Fruchtbarkeit (0–100). Regen = 100 Feuchte; Gießkanne, später Sprinkler; Wassernähe erhöht Feuchte.
- **Wachstum** täglich um 06:00 (lazy): Stufe steigt bei Feuchte > 20, passender Jahreszeit (oder Gewächshaus) und Temperatur > 2 °C. Frost tötet Nicht-Winterpflanzen im Freien. Ernte −10 Fruchtbarkeit; Kompost +30, Knochenmehl +20, Dung +15, Guano +40.
- **Qualität** (Normal/Silber/Gold) aus Fruchtbarkeit und Skill. **Schädlinge:** Krähen (Vogelscheuche), Hasen (Zaun), Mehltau bei Dauerregen (Kräuterbrühe).
- **Nutzpflanzen (≥ 28):** Karotte, Kartoffel, Rübe, Zwiebel, Knoblauch, Kohl, Salat, Erbse, Bohne, Weizen, Gerste, Roggen, Mais, Tomate, Kürbis, Melone, Erdbeere, Flachs, Hopfen, Baumwolle, Wachbohne, Bergtee, Kamille, Salbei, Minze, Ringelblume, Moorbeere, Frostbeere, Kaktusfeige, Feuerwurz, Leuchtknolle (leuchtet nachts), Pilzbeete (Champignon, Leuchtpilz). Je Pflanze: 4–6 Wachstumsstufen-Sprites, Jahreszeiten, Tage, Wasserbedarf, Ertrag, Nachwuchs.
- **Bäume** aus Setzlingen, Obstbäume mit saisonaler Ernte.
- **Tiere:** Huhn (aus Wachteln gezähmt), Schwein (Frischling), Heideschaf, Ziege, Moorbüffel (Milch, treibt die Mühle), Wollhorn (T3), Bienen (Schwarm mit Netz und Rauch einfangen), Sandläufer (Reittier). Zähmen durch Füttern und behutsames Annähern (Scheu-Mechanik). Bedürfnisse: Futter (Trog), Wasser, Schutz (Stall im Winter), Platz, Zuneigung (Streicheln, Bürsten) → Produkte und Nachwuchs (Zufriedenheit > 70, zwei Erwachsene, Platz). Produkte: Eier, Milch, Wolle, Honig, Wachs, Federn, Dung. Tiere lassen sich benennen.

---

## §18 Kochen, Ernährung, Verderb, Wasser
- **Zubereitung:** roh (geringer Wert; rohes Fleisch 30 % Lebensmittelvergiftung), Spieß am Feuer, Kessel (Rezepte aus konkreten Zutaten oder Kategorien wie Gemüse/Fleisch/Fisch), Backen, Räuchern, Trocknen, Einlegen (Salz/Essig), Gären/Brauen, Käsen.
- **Mahlzeit-Effekte:** höchstens 2 verschiedene gleichzeitig. Beispiele: Eintopf +20 max. Leben (10 min) · Fischsuppe +15 max. Ausdauer · Chili-Topf +8 Isolation · Minztee +6 Kühlung · Beerenkuchen −20 Furcht · Pilzragout Nachtsicht (6 min) · Honigbrot +25 % Ausdauerregeneration · Met +10 % Schadensresistenz mit leichtem Schwanken · Wachbohnen-Trunk −30 Erschöpfung.
- **Überdruss:** dieselbe Speise 3× an einem Tag → −50 % Nährwert, klingt über 2 Tage ab. Vielfalt wird belohnt.
- **Umfang:** ≥ 55 Gerichte und Getränke, ≥ 22 Tränke und Medizin (Heiltrank, Gegengift, Fiebertee, Wundsalbe, Schiene, Wärmetrank, Kühltrank, Feuerschutz, Wasseratmung, Nachtsicht, Furchtbann, Kraft, Tempo …).
- **Verderb:** Frische 100 → 0 über die Haltbarkeit (rohes Fleisch 2 Tage, Beeren 3, Brot 5, Käse 20, Salzfisch 25, Trockenfleisch 30, Honig unbegrenzt). Faktoren: Kühlkiste ×0,3, Eiskeller ×0,2, Vorratsfass ×0,75, Winter im Freien ×0,5, heißes Biom ×1,5. Stufen: Frisch (≥ 60) · Alt (20–60, −25 % Wert) · Faulig (< 20, Vergiftungsrisiko) · 0 → „Verdorbenes" (Kompost).
- **Wasser:** Flüsse und Seen ungefiltert (Nebelmoor 50 % Fieberrisiko, sonst 10 %), Abkochen macht sauber, Regensammler, Brunnen (T1), Trinkschlauch (5 Schlucke), Kaktuswasser, geschmolzener Schnee, Tees.

---

## §19 Kampf & KI

### 19.1 Steuerung & Gefühl
- Zielen mit der Maus (Figur blickt zum Cursor) bzw. rechtem Stick; freie Bewegung, Sprites in 4 Richtungen, Waffen frei rotiert (Rotation im Low-Res-Puffer, pixelgenau).
- Leichter Angriff (LMB), schwerer Angriff (halten), Block/Zielen (RMB), Rolle (Leertaste, 0,25 s Unverwundbarkeit). **Parade:** Block in den letzten 0,15 s vor dem Treffer → Gegner taumelt, der nächste Treffer ist kritisch.
- Hitstop, Knockback, Trefferblitz, Screenshake, Schadenszahlen (abschaltbar), gestaffelte Sounds. Reichweite, Schlagbogen, Tempo, Ausdauerkosten und Stagger-Wert je Waffe.

### 19.2 Waffenklassen (T0–T7 + Sonderwaffen)
Schwert (3er-Kombo, schwer: Rundumhieb) · Axt (schwer: Rüstungsbruch; fällt Bäume mit 50 %) · Keule/Streitkolben (Wucht, hoher Stagger) · Speer (Reichweite, schwer: Wurf) · Dolch (schnell, Rückenangriff ×3 beim Schleichen) · Zweihänder/Großaxt/Kriegshammer (breit, langsam, Licht am Gürtel) · Bogen (Spannen 0,8 s) · Armbrust (Nachladen 1,5 s) · Schleuder · Wurfwaffen (Wurfmesser, Sprengtopf, Brandflasche, Frostbombe, Blendbombe) · Lumenstäbe (ab T4, Lumen-Ladungen: Lichtstrahl, Prismensalve, Lichtschild).
- **Munition:** Pfeile (Feuerstein, Bronze, Eisen, Stahl, Feuer, Gift, Stumpf, Leucht, Lumen), Bolzen, Schleudersteine.
- **Schilde:** Holz (40 % Blockkraft), Bronze, Eisen, Turmschild (90 %, langsam), **Spiegelschild** (reflektiert Projektile und Lichtstrahlen; Pflicht für Boss 6).

### 19.3 Schaden
- Typen: Hieb, Stich, Wucht, Feuer, Frost, Gift, Licht, Schatten. Resistenzen und Schwächen je Kreatur (im Bestiarium nach Entdeckung sichtbar).
- Rüstung: Reduktion = R / (R + 50). Kritisch 5 % Basis, ×1,75. Zustände über Waffen und Munition (Brennen, Frost-Verlangsamung, Gift, Blutung, Betäubung).
- Formeln in `balance.ts`, Zahlenrahmen in §D.

### 19.4 KI
- **Wahrnehmung:** Sichtkegel 120°, Sichtweite abhängig vom Licht am Spieler (im Dunkeln schwer zu sehen, eigene Lichtquelle ×2), Gehör (Geräuschereignisse mit Radius: Sprinten, Kampf, Holzhacken, Abbau, Türen; Regen dämpft).
- **Verhalten:** Utility-KI oder Behavior Trees. Zustände: Ruhen, Umherstreifen, Grasen, Fliehen, Untersuchen, Jagen, Angreifen (Musterauswahl mit Gewichtung und Cooldowns), Umkreisen, Rückzug, Heimkehr (Leine), Schlafen (Tagesrhythmus).
- **Gruppentaktik:** Rudel umkreisen und flankieren (Wölfe), Horden drängen (Moorleiber), Fernkämpfer halten Abstand, Beschwörer schützen sich.
- **Telegraphs:** Ausholzeit 0,3–0,8 s (Schwierigkeit skaliert), klar sichtbar und hörbar; Boss-Flächenangriffe mit Bodenmarkierung.
- **Pfadfindung im Worker:** A*/JPS auf dem Tile-Raster, hierarchisch für weite Strecken, Flow-Fields für die Schattenflut, lokales Ausweichen (Separation), Türen (für bestimmte Gegner brechbar), Sonderregeln für Schwimmer und Flieger; Budget pro Frame.

---

## §20 Kreaturen & Bosse

### 20.1 Kreaturen (Mindestumfang)
Jede Kreatur: Sprites und Animationen aller Zustände, Sounds, KI-Profil, Beutetabelle, Bestiarium-Eintrag DE/EN. Schattenbrut-Varianten je Biom über Palette und Modifikator.
- **Grünhain:** Hase, Reh, Wachtel, Eichhörnchen, Glühwürmchen, Frosch · Keiler, Dachs · Wolf (Rudel), Dornling (getarnt), Wespenschwarm · Elites: Graufang (Alphawolf), Alter Hauer.
- **Salzküste:** Krabbe, Möwe, Robbe · Scherenkrebs, Qualle, Strandräuber (Gezeichnete) · Elite: Panzerschere.
- **Nebelmoor:** Reiher, Moorfrosch (Pfeilgift), Schildkröte · Moorbüffel, Egelschwarm · Moorleib (Horde), Irrlicht (lockt in tiefes Wasser), Sumpfkriecher, Mückenschwarm (Fieber), Moorhexe (Gezeichnete, beschwört) · Elites: Mutter Schilf, Der Schlammige.
- **Frostkamm:** Schneehase, Schneeeule, Rentier · Wollhorn, Eisbär · Frostwolf, Eisschrat (wirft Eisbrocken), Gletscherkäfer (rollt), Frostgeist (friert Feuer ein) · Elites: Weißmähne, Splitterfang.
- **Glutsand:** Wüstenfuchs, Echse · Sandläufer (Reittier), Geier · Skorpion, Sandwurm, Mumienwächter, Staubteufel, Nomaden-Plünderer · Elites: Königskralle, Der Verhüllte.
- **Aschenschlund:** Aschekäfer · Magmakröte (spuckt Lava), Schlackengolem, Aschefledermaus (Schwarm), Feuersalamander, Aschekultist, Glutwurm · Elites: Brennendes Auge, Schlackenkönig.
- **Scherbenhain:** Lichtmotte, Prismenhirsch · Kristallspinne, Splitterwolf, Spiegelgeist (kopiert deine Angriffe), Scherbenwächter, Lichtfresser-Ranke · Elites: Die Zersplitterte, Prismenschlund.
- **Untergrund:** Höhlenspinne, Fledermaus, Wurzelkriecher, Pilzling (Sporenwolke), Blindwurm, Steinbeißer, Riesenolm, Kristallkäfer, Schattenkobold (stiehlt Items!), Höhlentroll, Lavaegel, Feuerkäfer, Obsidiangolem, Glutgeist · Elites: Kobold-König, Tiefentroll.
- **Schattenbrut** (überall nachts und im Untergrund): Schleicher, Kriecher (hält fest), Speier (Fernkampf), Brecher (Belagerung), Gleiter (fliegt, jagt Lichter), Lichtfresser, Nachtmahr (Furcht 100), Schattenzwilling (Nachtherz).
- **Dungeon-Spezial:** Mimik-Truhe, 3 Typen Erbauer-Konstrukte, Fallengeister.

### 20.2 Bosse
Jeder Boss: eigene Arena, Beschwörung oder Zugang, ≥ 3 Phasen, eigene Kampfmusik (optionale Bosse: eigenes Arrangement eines Boss-Themas), Intro-Titelkarte, Bosslebensbalken mit Phasenmarken, einzigartige Drops, Trophäe, Herzsplitter (+10 max. Leben). Kein unfairer One-Shot auf Normal; jede Attacke lesbar; Wiedereinstieg nach Tod direkt vor der Arena.
1. **Borkenvater** (Grünhain): verdorbener Uraltbaum. Wurzelstöße in Linien (telegraphierte Bodenrisse), beschworene Zweiglinge. Phase 2: Borkenpanzer – nur glühende Knoten verwundbar, Blättersturm senkt die Sicht. Phase 3: Raserei; Feuer richtet doppelten Schaden an, die Arena brennt teilweise. Drop: **Kernholz**.
2. **Sumpfmutter** (Nebelmoor): riesige Amphibie im gefluteten Rund. Taucht ab, greift aus dem Nebel an, Giftlachen, Egelbrut. Phase 2: dichter Nebel – nur ihr Anglerlicht verrät sie. Phase 3: aufs Trockene gelockt, Feuerpfeile trocknen den Schlamm. Drop: **Sumpfherz**.
3. **Hrimgar, der Frostwyrm** (Frostkamm): gräbt durch Schnee, Frostatem vereist den Boden (rutschig), Eiszapfen fallen von Klippen. Phase 2: Schneesturm – Feuerschalen der Arena entzünden, um nicht zu erfrieren. Phase 3: Eispanzer mit Wucht brechen. Drop: **Wyrmhorn**, Wyrmschuppen.
4. **Skarabäus-Koloss** (Glutsand): rollt Felsen, gräbt sich ein, entfacht Sandstürme; mit Sprengtöpfen oder Wucht auf den Rücken werfen, um den Bauch freizulegen. Phase 3: Treibsand-Arena. Drop: **Sonnenchitin**.
5. **Der Aschenschmied** (Aschenschlund): Feuerelementar am Amboss. Hammerschläge erzeugen Schockwellen, Lava steigt und die Arena schrumpft; mit Frostbomben Plattformen schaffen. Phase 3: Überhitzungsaura. Drop: **Glutamboss-Kern**.
6. **Die Gefallene Hüterin** (Scherbenhain): verdorbene Lichtwächterin. Lichtstrahlen prallen an Kristallen ab und müssen mit dem Spiegelschild zurückgeworfen werden; Prismen-Klone. Phase 3: Die Arena spaltet sich in Farben (Farbrätsel im Kampf). Drop: **Prismenherz**.
7. **Der Verschlinger** (Nachtherz, Finale): völlige Dunkelheit außer deinem Licht; Echos früherer Bosse. Letzte Phase: das Urfeuer entzünden, während er die Sechsfach-Flamme zu löschen versucht. Drop: **Herz der Nacht**.
- **Optional:** **Webmutter** (Wurzelhöhlen; Drop: Nachtseide für Rüstungen), **Salzwyrm** (offene See; Drop: Bootsaufwertungen). **Nachwelt:** Echo-Bosse (stärkere Rückkämpfe mit neuen Mustern).

---

## §21 Dungeons & Orte
- **Erbauer-Gewölbe:** 3–4 pro Biom + Untergrund-Spezialorte, jeweils eigene Innenebene. Generiert per Graph-Grammatik (Start → Räume, Schlüssel und Schlösser, Rätsel → Endkammer mit Mini-Boss) aus handgebauten Raumvorlagen (ASCII-Karten in `src/content/dungeons/`), biomspezifische Tilesets.
- **Rätseltypen (≥ 14, je ≥ 3 Varianten):** Kistenschieben auf Druckplatten · Hebelfolge mit Wandhinweis · Lichtstrahl-Spiegel (drehbare Spiegel lenken den Strahl auf einen Kristall) · Feuerschalen-Reihenfolge · Schattenwurf (Objekt so bewegen, dass sein Schatten eine Platte trifft) · Farbprisma (Lichtfarben mischen) · Gewichtswaage · Gleiteis · Wasserstand und Schleusen · Sanduhr-Zeitlauf · Lava abkühlen · Spiegelgeist-Nachahmung · Glockentöne (Tonfolge) · verborgene Wände (Luftzug-Partikel) · Wächter-Lichtkegel meiden (Schleichen).
- **Fallen:** Speerfallen, Pfeilwerfer, Rollsteine, Fallgruben, Giftgas, Flammenwerfer, einstürzende Böden, Pendelklingen.
- **Belohnungen:** einzigartige Baupläne, Relikte (Forschungspult), Truhen nach Stufe, Erbauer-Tafeln, **Glutsplitter** (+5 max. Ausdauer; 12 in der Welt).
- **Weitere Orte (≥ 18 Typen):** Leuchtfeuer-Stätten, Aussichtstürme (decken große Kartenbereiche auf), verlassene Gehöfte (Beute, Geschichten, manchmal Siedler), Wracks, verlassene Minen mit Lorenschienen, Lager der Gezeichneten, Schreine (zeitweiliger Segen), Naturwunder (Uraltbaum, Geysirfeld, Kristallbogen), Händlerplatz, Rettungsorte, Buddelstellen, Höhlenlabyrinthe, Meteoritenkrater, Eremitenhütte, Brückenruinen, Friedhöfe der Erbauer, Oasen.
- Jeder Ort: Name, Kartensymbol, Entdeckungs-Stinger, Chronik-Eintrag; Zustand (geplündert, gereinigt) wird gespeichert. Gegner in Orten kehren nach 7 Tagen teilweise zurück, Truhen nicht.

---

## §22 Siedler, Begleiter, Händlerin

### 22.1 Siedler (bis 12 gleichzeitig)
- ≥ 20 einzigartige Überlebende an Rettungsorten (gefangen, verirrt, verletzt – manche davon Gezeichnete, die sich retten lassen). Jeder mit Namen, Pixelporträt, Hintergrundgeschichte (3–5 Sätze), 2–3 Eigenschaften (Fleißig, Ängstlich, Nachteule, Feinschmecker, Abgehärtet, Tollpatschig, Gesellig, Einzelgänger …) und Fähigkeitswerten 0–10 je Beruf.
- Beitritt, sobald ein freies Bett in einem Innenraum steht.
- **Berufe:** Holzfäller (markierte Bäume), Sammler, Bauer, Hirte, Koch (füllt die Speisekiste), Handwerker (Stationsaufträge wie „Halte 20 Bretter vorrätig"), Schmied, Träger (sortiert nach Regeln in Kisten), Baumeister (Blaupausen), Fischer, Wache (patrouilliert, verteidigt, trägt Ausrüstung), Heiler.
- Prioritätentabelle (Siedler × Berufe, Stufe 1–4 oder aus) und Tagesplan (Arbeit, Freizeit, Schlaf).
- **Bedürfnisse:** Hunger, Schlaf (eigenes Bett), Behaglichkeit, Sicherheit (Licht), Geselligkeit, Abwechslung beim Essen. **Stimmung:** Glücklich (+20 % Tempo) · Zufrieden · Unzufrieden (−20 %) · Verzweifelt (streikt; geht nach 3 Tagen).
- Bei der Schattenflut flüchten Nicht-Wachen in Innenräume. Verletzte Siedler werden kampfunfähig statt zu sterben (Ausnahme: Schwierigkeit Unbarmherzig).
- Persönliche Aufträge (Quests) und ≥ 250 Sprüche (DE/EN) zu Stimmung, Arbeit, Wetter und Ereignissen.

### 22.2 Begleiter
Streunerhund an einem verlassenen Gehöft, durch Füttern gewonnen. Folgt, kämpft, trägt 8 Items, erschnüffelt Buddelstellen, bellt bei getarnten Gegnern. Befehle: Folgen, Bleiben, Nach Hause. Bei 0 HP kampfunfähig, erholt sich (stirbt nie). Streicheln, Namen vergeben.

### 22.3 Wandernde Händlerin
Besucht die Basis alle 5–7 Tage für einen Tag (wenn ein Herdfeuer brennt). Tausch gegen Lumen-Scherben und Waren; Sortiment wächst mit dem Fortschritt (Saatgut, Baupläne, Karten mit Orten, seltene Materialien, Farbstoffe, Deko). Vergibt Aufträge („Bring mir 5 Wyrmschuppen").

---

## §23 Progression, Skills, Chronik

### 23.1 Leuchtfeuer-Wissen & Pacing
| Leuchtfeuer | Schaltet frei (+ jeweils ein Glutkern für das Herdfeuer) |
|---|---|
| 1 Grünhain | Lumen-Werkbank, Lumen-Laterne, Wegsteine |
| 2 Nebelmoor | Kanu, Alchemie II, Runenaltar |
| 3 Frostkamm | Wasserrad, Windrad, Lumen-Netz I, Blitzableiter |
| 4 Glutsand | Linsenschleifer, Lichtwacht, Fernrohr, Sonnenlinse |
| 5 Aschenschlund | Glutgenerator, Förderbänder, Greifarme, Sortierer |
| 6 Scherbenhain | Prismenwerkbank, Lumen-Kern, Sechsfach-Flamme |
Pacing-Ziel (Normal, durchschnittlicher Spieler): Leuchtfeuer 1 nach ~3 h · 2 nach ~7 h · 3 nach ~12 h · 4 nach ~18 h · 5 nach ~24 h · 6 nach ~30 h · Finale nach 33–40 h.

### 23.2 Skills (Learning by Doing)
- 12 Fertigkeiten: Holzfällen, Bergbau, Sammeln & Kräuter, Handwerk, Schmieden, Kochen & Brauen, Landwirtschaft & Tierzucht, Nahkampf, Fernkampf, Verteidigung (Blocken/Ausweichen), Überleben (Schleichen, Schwimmen, Temperatur, Hunger), Lumenkunde.
- Stufe 1–100, EP-Bedarf `50 × stufe^1,6`; je Stufe +0,5 % Wirkung im Bereich. Bei 30/60/90 Wahl zwischen 2 Perks → 72 Perks, alle spürbar (keine reinen +1-%-Perks).
- Tod kostet 25 % des aktuellen Stufenfortschritts (Normal), nie ganze Stufen.

### 23.3 Chronik (J)
- Reiter: Aufgaben (Haupt- und Nebenaufgaben mit Hinweisen und Kartenmarkern) · Bestiarium (Werte, Schwächen, Beute – durch Beobachten und Besiegen freigeschaltet) · Herbarium & Fischbuch · Wissen (Erbauer-Tafeln, Visionen) · Rezeptbuch · Statistiken · Erfolge (≥ 60, lokal).
- **Einstieg „Die ersten Stunden":** sanft geführte Ziele (Fasern und Steine → Steinaxt → Lagerfeuer vor der ersten Nacht → Unterschlupf → Werkbank …), kontextuelle Hinweise (erste Kälte, erste Dunkelheit, erster Hunger, erstes Elite …), jederzeit abschaltbar. Funke kommentiert sparsam.

---

## §24 Lumen-Netz (Automatisierung)
- Kraft (K) pro Netz. Leitungspfähle verbinden sich automatisch im Umkreis von 8 Tiles (Kabel mit Durchhang). Netz-Overlay zeigt Erzeugung, Verbrauch und Engpässe.
- **Erzeuger:** Wasserrad 20 K (Fluss) · Windrad 0–35 K (Wind) · Sonnenlinse 40 K (tagsüber) · Glutgenerator 60 K (Kohle/Magmit) · Lumen-Kern 120 K (Lumen). Lumen-Akku speichert Energie für die Nacht.
- **Verbraucher:** Auto-Schmelzofen 30 · Sägewerk 20 · Mühle 10 · Sprinkler 5 · Pumpe 8 · Lichtwacht 25 · Lumen-Lampe 1 · Heizofen 10 · Kühler 15 · Webmaschine 12 · Förderband 1 je Tile · Greifarm 3 · Sortierer 2.
- **Logistik:** Förderbänder (2 Items/s, Kurven, Brücken), Greifarme mit Filter, Sortierer, Kisten-Ein- und -Ausgänge. Ziel: Werkstatt- und Farm-Automatisierung, keine Megafabrik.
- Maschinen zeigen Statussymbole (kein Strom, kein Input, Ausgang voll).

---

## §25 Erkundung, Karte, Reisen
- **Karte (M):** Pergament-Pixel-Look, Nebel über Unerkundetem, Aufdeckung im Radius 20 Tiles (auf Höhen mehr), Aussichtstürme 80. Marker automatisch (Orte, Leuchtfeuer, Grab, Basen, Händlerin) und eigene (Symbol + Name); Zoom; Ebenenwechsel für den Untergrund.
- **Minimap** (rund, zoombar) + optionaler Kompassbalken mit Markern.
- **Schnellreise** zwischen entzündeten Leuchtfeuern, Herdfeuern und Wegsteinen (Lumen-Kosten nach Distanz). Option „Logistik-Realismus": Erze und Barren nicht teleportierbar (Standard: aus).
- **Boote:** Floß (T1), Kanu (Leuchtfeuer 2), Segelboot (T3, windabhängig), Anlegestege; Seegang und Sturm beschädigen Boote; Frachtplätze.
- **Reittier:** Sandläufer (Glutsand) mit Sattel, Satteltaschen, eigener Ausdauer, Pfiff zum Rufen.
- **Enterhaken** (T3): Schluchten an Ankerpunkten überqueren. Leitern an Klippen, Brücken bauen.
- **Fernrohr:** Kamera bis 40 Tiles in Blickrichtung schwenken.
- Schwimmen und Tauchen (mit Trank: Schätze in klaren Seen).

---

## §26 UI/UX
- **Stil:** eigener Pixel-UI-Look (Holz, Eisen, Pergament – passend zur Welt), einheitliche 9-Slice-Rahmen, eine Pixelschrift, ganzzahlige UI-Skalierung (Auto oder 1×–4×). Keine Standard-Web-Widgets, eigene Pixel-Scrollbars.
- **HUD** (Modi: Voll / Kontextuell / Minimal): oben links Leben, Ausdauer, Sättigung, Durst, Thermometer mit Trend, Furcht-Auge (ab 20); Zustandssymbole mit Timer; unten Schnellleiste, Nebenhand, Gürtel; oben rechts Minimap mit Tageszeit-Scheibe (Sonne/Mond), Tag, Jahreszeit, Wetter; rechts Aufgaben- und Rezept-Tracker; Mitte unten Interaktionshinweis („[E] Aufheben: Feuerstein ×3").
- **Bildschirme:** Hauptmenü mit lebendiger Pixel-Szene (Tageszyklus, Wetter, Licht – das Schaufenster der Shader), Weltauswahl, Neue Welt (Seed, Größe, Voreinstellung, alle Regler), Charaktererstellung (Name, Körperform, Haut- und Haarpaletten, 12 Frisuren, Kleidungsfarben), Ladebildschirm (Tipps, Lore), Inventar/Ausrüstung/Werte, Stationen, Bau-Menü, Karte, Chronik, Siedler, Händlerin, Pausemenü, Einstellungen, Todesbildschirm, Abspann.
- **Inventar-Komfort:** Drag & Drop, Shift-Klick verschiebt, Rechtsklick teilt, Doppelklick sammelt Gleiches, Zifferntasten belegen die Schnellleiste, Sortieren, Mülleimer (Bestätigung ab Selten), Vergleichs-Tooltips (grün/rot), „Verwendet in"/„Herkunft".
- **Benachrichtigungen:** gestapelte Aufsammel-Meldungen, Entdeckungen, Warnungen (Dunkelheit naht, Kälte, Hunger); nie mehr als 4 gleichzeitig.
- **Controller:** vollständige Navigation mit Fokusrahmen, Radialmenüs (Schnellleiste, Bauen), automatische Tastensymbole (Xbox, PlayStation, generisch), abschaltbare Vibration, Zielhilfe.
- **Standardbelegung:** WASD, Maus, LMB/RMB, Leertaste Rolle, Shift Sprint, Strg Schleichen, E Interagieren, Q Gürtel, F Licht an/aus, R Drehen, B Bauen, Tab/I Inventar, C Handwerk, M Karte, J Chronik, K Siedler, 1–0, Esc. Alles umbelegbar.
- **Touch** (Tablets): virtuelle Sticks, kontextuelle Aktionsknöpfe, größere UI-Skalierung.
- **Texte:** Satzanfang groß, klare Verben („Herstellen", „Einlagern"); Fehlermeldungen sagen, was fehlt und wie man es löst.

---

## §27 Audio
- **Web-Audio-Graph:** Master → Busse Musik, Effekte, Umgebung, UI; Kompressor/Limiter; räumliches Panning + Distanzdämpfung; Tiefpass bei Verdeckung (hinter Wänden, drinnen); prozedural erzeugte Hall-Impulse (Höhle, Innenraum, Halle).
- **SFX-Synthese-Engine** (sfxr-artig + FM + Rauschen + Filter + Hüllkurven + Layering), Presets als Daten, Varianten gegen Wiederholung. ≥ 300 Effekte: Schritte je Untergrund (Gras, Erde, Stein, Holz, Sand, Schnee, Wasser, Matsch, Asche, Kristall), Werkzeugtreffer je Material, Waffen je Schadenstyp, Kreaturenlaute, UI, Crafting, Bauen, Feuer, Wetter, Magie.
- **Musik:** eigener Tracker/Sequencer (Patterns; Instrumente aus Rechteck, Dreieck, Rauschen, FM, Wavetable; SNES-artiges Echo), beim Laden im Worker zu Audiopuffern gerendert (OfflineAudioContext). ≥ 22 Stücke (1,5–3 min, loopbar): Titel, je Biom ein Thema mit Tag- und Nacht-Arrangement, Nachtherz, Höhle, Basis (gemütlich), Kampf, Schattenflut, je Hauptboss ein Thema, Finale, Abspann, Nachwelt. Adaptive Schichten (Gefahren-Percussion bei Gegnernähe), weiche Überblendungen, Stinger (Entdeckung, Leuchtfeuer, Boss besiegt, Stufenaufstieg). Stille ist erlaubt: ruhige Nachtphasen erhöhen die Spannung.
- **Umgebung:** Biom-Klangbetten (Vögel tags, Grillen nachts, Wind, positionale Flüsse, Lava, Kristallsummen), Wetterschichten, Donner mit entfernungsabhängiger Verzögerung.
- **Barrierefreiheit:** visuelle Geräuschanzeigen (Richtungspfeile für Bedrohungen außerhalb des Bildes), Untertitel für wichtige Laute.

---

## §28 Speichern & Laden
- **IndexedDB:** Weltmeta (Seed, Einstellungen, Version, Spielzeit, Tag), Spieler, geänderte Chunks als Diffs (Typed Arrays), Entitäten pro Chunk, Basen, Siedler, Quests, Kartenaufdeckung (Bitmaske), Statistiken.
- **Autosave** alle 3 min (inkrementell, nur geänderte Chunks, im Worker), beim Schlafen, beim Verlassen und bei `visibilitychange`; atomar per Transaktion; die letzten 3 Autosaves rotierend.
- Mehrere Welten; Export/Import als Datei (`.dhsave`, gzip über CompressionStream); Seed teilen.
- Versioniert mit Migrationen (Tests mit Fixture-Spielständen jeder Version), Integritätsprüfung, Wiederherstellung aus älterem Autosave bei Korruption.
- Einstellungen getrennt in localStorage.

---

## §29 Modi, Schwierigkeit, Einstellungen, Barrierefreiheit
| Voreinstellung | Hunger/Durst | Gegnerschaden | Schattenflut | Tod |
|---|---|---|---|---|
| Entspannt | ×0,6 | ×0,6 | aus (optional an) | Inventar bleibt |
| Normal | ×1 | ×1 | jede 7. Nacht | Inventar im Grab (Ausrüstung bleibt), −25 % Skill-Fortschritt |
| Hart | ×1,25 | ×1,3 | jede 5. Nacht, stärker | alles im Grab |
| Unbarmherzig | ×1,25 | ×1,5 | jede 5. Nacht, stärker | Permadeath |
- Eigene Regler für alles: Friedlich-Schalter, Tageslänge, Jahreszeitenlänge, Weltgröße, Ressourcendichte, Schattenflut-Intervall, Logistik-Realismus. Schwierigkeit jederzeit änderbar (außer Unbarmherzig).
- **Kreativmodus:** unbegrenzte Ressourcen, alles freigeschaltet, Fliegen/Noclip, Zeit- und Wettersteuerung.
- **Einstellungen:** Grafik (Qualitätsstufe, Einzeloptionen, Licht-Bänderung/Dither, Skalierungsmodus, FPS-Limit, VSync, CRT) · Audio (alle Busse) · Steuerung (Belegung, Empfindlichkeit, Halten/Umschalten) · Spiel (HUD-Modus, Schadenszahlen, Hinweise, Funke-Kommentare, Autosave-Intervall) · Sprache (DE/EN).
- **Barrierefreiheit:** Farbenblind-Filter (3 Typen) + farbunabhängige Symbole, Textgröße, Screenshake 0–100 %, Blitz- und Flackerreduktion, Bewegungsreduktion, visuelle Geräuschanzeigen, Spieltempo 50–100 %, Zielhilfe für Controller.
- Pausieren jederzeit; automatische Pause beim Tab-Wechsel.

---

## §30 Performance-Budgets
- 60 FPS stabil bei 1080p „Hoch" auf integrierten GPUs (Apple M-Serie, Intel Iris Xe); ≥ 30 FPS „Niedrig" auf Intel UHD 620. 120/144 Hz werden unterstützt.
- CPU pro Frame ≤ 8 ms (Simulation ≤ 3 ms, Render-Vorbereitung ≤ 3 ms, UI ≤ 1 ms); GPU ≤ 10 ms auf Zielhardware „Hoch".
- Draw-Calls typisch ≤ 150 (Instancing, Atlanten). Bis 6 000 Sprites, 256 Lichter (Ultra), 20 000 Partikel.
- Keine Allokationen in Hot-Loops (Pools, Typed Arrays). JS-Heap ≤ 350 MB, kein Wachstum über 60 min (Leak-Test).
- Start: Titelbildschirm ≤ 3 s (Cache); neue Welt „Mittel" spielbar ≤ 8 s; Chunk-Streaming ruckelfrei (Worker, Budget pro Frame).
- Produktions-Download (gzip) ≤ 20 MB; PWA-Cache vollständig.
- `npm run bench` misst Sim-Tick-Zeit im Raid-Szenario (80 Gegner, 300 Bauteile, 12 Siedler, Regen, 128 Lichter), Draw-Calls, Sprite- und Lichtzahl, Heap-Trend; Überschreitung = Fehler. GPU-Zeiten werden zusätzlich im F3-Overlay geprüft.

---

## §31 Tests, QA, Dev-Tools

### 31.1 Unit (Vitest)
Formeln (Temperatur, Hunger, Schaden, Rüstung, Furcht, Wachstum, Verderb), Inventar-Operationen, Crafting und Rezept-Entdeckung, Raumerkennung und Statik, Lichtkarte, Pfadfindung, RNG- und Noise-Determinismus, Weltgen-Hash-Snapshots, Save-Roundtrip je System, Migrationen, Wetter-Markov, Loot-Tabellen.

### 31.2 Integration (headless Simulation in Node)
Tag-1-Szenario (sammeln → Werkzeuge → Feuer → Nacht überleben) · Schattenflut gegen eine Referenzbasis · Farm-Woche · Siedler-Arbeitsschleife · Progressionspfad (per Debug-API sind alle Stufen und Bosse erreichbar) · 30-Tage-Langlauf (keine NaN, begrenzte Entitätszahl, stabiler Speicher).

### 31.3 E2E (Playwright, WebGL2 aktiv)
Boot → Hauptmenü → neue Welt → bewegen → Inventar → herstellen → bauen → speichern → neu laden → Zustand identisch. Keine Konsolenfehler oder -warnungen. Tastatur-Navigation der UI. Einstellungen bleiben erhalten. PWA offline.

### 31.4 Content-Validator (`npm run validate:content`)
Alle Referenzen existieren. Jedes Item: Icon, Sprite, Texte DE+EN, mindestens eine Quelle und eine Verwendung (außer Endprodukten). Erreichbarkeitsgraph (Weltquellen, Drops, Händlerin) ohne Waisen. Stufenreihenfolge korrekt (kein Rezept braucht Material einer höheren Stufe als seine eigene). Jede Kreatur: Animationen aller Zustände, Sounds, Beute, Bestiarium. Jedes Biom: Spawntabellen für Tag, Nacht und Jahreszeiten. Keine Palettenverletzung. Ungenutzte Assets = Warnung, fehlende Übersetzung = Fehler. Zählt die Mindestmengen aus §C.

### 31.5 Visuelle QA
`npm run shot` rendert deterministisch (fester Seed, eingefrorene Zeit, festes Wetter) ≥ 40 Szenarien: Titel, jedes Biom zu Tag/Dämmerung/Nacht, Regen, Schnee, Nebel, Sandsturm, Ascheregen, Höhle mit Fackeln, Basis innen und außen, Schattenflut, jeder Boss, alle UI-Screens, Qualitätsstufen im Vergleich. Du öffnest die Bilder und bewertest sie per Checkliste (Lesbarkeit, Palette, Stimmung, Lichtqualität, Artefakte, UI-Ausrichtung). Freigegebene Bilder kommen nach `shots/referenz/`; UI-Screens zusätzlich per Pixel-Diff gegen die Referenz.

### 31.6 Dev-Tools (nur Debug-Modus: `?debug=1` oder Einstellung „Entwicklermodus")
F3 Performance-Overlay · Konsole (`^`): give, spawn, tp, time, weather, season, god, noclip, reveal, unlock, boss, speed, kill · Render-Puffer-Anzeige · Overlays (Chunks, Kollision, Pfade, Flow-Fields, Räume, Lichtkarte, Spawnzonen, Temperaturfeld) · Entitäts-Inspektor · Screenshot-Modus (HUD aus, Zeit eingefroren) · Command-Replay für Bug-Repros.

---

## §32 Meilensteine M0–M14 (Grundlage des Backlogs)
Jeder Meilenstein endet mit dem Gate aus §1.5 und `git tag Mx`. Leuchtfeuer-Freischaltungen (§23.1) werden in dem Meilenstein verdrahtet, in dem ihr System entsteht; spätestens zum M14-Gate ist jede Freischaltung spielbar.

**M0 Fundament** – Scaffold, Tooling, alle Skripte aus §3.4, Loop-Dateien, Engine-Kern (Loop, Zeit, Input inkl. Gamepad, ECS, Events, RNG, i18n, Einstellungen), Debug-Grundgerüst, Playwright mit WebGL2.
Akzeptanz: `npm run verify` grün · Testszene rendert · Screenshot-Pipeline liefert ein Bild, das du geprüft hast.

**M1 Renderer & Asset-Pipeline** – Palette, Quellformat, Atlas-Builder, Normal/Höhe/Emissiv-Generierung, Kontaktbögen, Instanced Batcher, Chunk-Tilemap, Kamera (Subpixel, Skalierung §4.2), y-Sortierung, Animationssystem, G-Buffer + Basislicht (Umgebung + Punktlichter mit Normal-Mapping), Post-Kette als Gerüst, Pixelschrift (DOM + WebGL).
Akzeptanz: 5 000 animierte Sprites bei 60 FPS · Normal-Mapping im Screenshot sichtbar · scharfe Pixel bei allen Beispielauflösungen aus §4.2.

**M2 Welt** – Weltgenerierung §9 (ohne Ortsinhalte), Autotiling, Vegetation, Chunk-Streaming im Worker, Kollision, Zeit- und Jahreszeiten-Grundlage, Chunk-Speicherung.
Akzeptanz: Determinismus über 20 Seeds · Weltkarten-Debugbild aller Größen geprüft · flüssiges Laufen über Chunkgrenzen.

**M3 Spieler & Überleben** – Steuerung §11.4, Spieleranimationen, Interaktion, Inventar/Ausrüstung/Schnellleiste, Sammeln §14, alle Werte und Zustände §11, Gameplay-Lichtkarte §12.1, Tod/Grab/Wiedereinstieg, HUD.
Akzeptanz: Tag-1-Integrationstest grün · alle Formeln unit-getestet · HUD-Screenshots geprüft.

**M4 Crafting & Bau I** – §15 (Stationen T0–T1, Verarbeitung mit Zeitstempel-Aufholung), §16 vollständig ohne Verteidigung (Ebenen, Statik, Räume, Temperatur, Behaglichkeit, Herdfeuer, Lagerung, Bau-UX, Blaupausen).
Akzeptanz: geschlossenes Holzhaus mit Dach – Dach blendet beim Betreten aus, Raumtyp erkannt, innen nachts wärmer · Crafting aus Kisten · Save/Load erhält alles.

**M5 Shader-Pracht I** – §6 Pässe 3–10 außer GI, Effekt-Katalog §6.2 (ohne Lava/Kristall-Spezial), Qualitätsstufen, Render-Debugger.
Akzeptanz: Screenshot-Set nach Checkliste bewertet · Budgets §30 auf „Hoch".

**M6 Kampf & Kreaturen I** – §19 vollständig, KI-Framework, Pfadfindung im Worker, Kreaturen von Grünhain und Salzküste, Schattenbrut-Grundfamilie + Spawnregeln §12.4, Beute, Bestiarium.
Akzeptanz: Rudel flankiert · Schattenbrut meidet Licht · Parade, Rolle und Hitstop fühlen sich präzise an (Eingabe wirkt im nächsten Frame).

**M7 Vertical Slice „Das erste Feuer"** – Grünhain vollständig (Orte, 1 Gewölbe mit ≥ 4 Rätseltypen, Elites), Landwirtschaft/Kochen/Verderb/Wasser (Basis), Borkenvater + Arena + Leuchtfeuer-Entzündung inkl. Freischaltungen (Lumen-Werkbank, Lumen-Laterne, Wegsteine, Glutkern), Chronik + Einstieg, Audio-Kern (SFX-Engine, Umgebung, 4 Musikstücke), Hauptmenü, Neue Welt, Einstellungen, Speicherslots.
Akzeptanz: Ein neuer Spieler kommt ohne Debug vom Strand bis zum ersten Leuchtfeuer (~3 h) · wirkt wie eine polierte Demo.

**M8 Moor & Frost** – Nebelmoor, Frostkamm, Wurzelhöhlen, Tiefgrund (Inhalte, Kreaturen, Elites, Gewölbe, Rätsel), Bosse 2 und 3 + Webmutter, Stufen T2–T3, Floß/Kanu, Temperaturausrüstung, Nebel/Schneesturm/Eis, Tierhaltung.
Akzeptanz: Progressionstest bis Leuchtfeuer 3.

**M9 Heim & Gemeinschaft** – Siedler §22.1, Begleiter, Händlerin, Schattenflut + Verteidigung §16.8, Flow-Fields.
Akzeptanz: Schattenflut-Integrationstest · 12 Siedler arbeiten 10 Spieltage stabil.

**M10 Sand & Asche** – Glutsand, Aschenschlund, Glutadern, Bosse 4 und 5 + Salzwyrm, Stufen T4–T5, Sandläufer, Segelboot, Linsen/Lichtwacht/Fernrohr, Enterhaken, Hitze/Lava/Asche/Sandsturm.
Akzeptanz: Progressionstest bis Leuchtfeuer 5.

**M11 Lumen-Netz** – §24 vollständig.
Akzeptanz: automatisierte Schmelz- und Farmkette läuft 5 Spieltage stabil · Netz-Overlay korrekt.

**M12 Licht & Nacht** – Scherbenhain, Nachtherz, Boss 6, Verschlinger, beide Enden, Abspann, Nachwelt + Echo-Bosse, NG+.
Akzeptanz: Spiel ist per Progressionstest und dokumentiertem Durchlauf bis zum Abspann spielbar.

**M13 Pracht II & Klang** – Radiance-Cascades-GI (Ultra), God Rays, Blitzschatten, Lava-/Kristall-/Prisma-Shader, Titelszene, alle Musikstücke und volle SFX-Abdeckung, Barrierefreiheit vollständig, EN vollständig, Touch-Steuerung.
Akzeptanz: Screenshot-Vergleich Ultra vs. Hoch · Audio-Abdeckungsbericht 100 %.

**M14 Balance, Politur, Release** – Pacing §23.1, Ökonomie, Schwierigkeitsstufen, Performance-Optimierung, Leak-Test, Migrationstests, komplette E2E-Suite, PWA offline, `CREDITS.md`, `README.md` (Spielen, Hosten, Steuerung), `CHANGELOG.md`, Spec-Audits.
Akzeptanz: §33.

---

## §33 Definition of Done (Gesamtspiel)
- Alle Meilensteine M0–M14 mit Gate und Tag abgeschlossen.
- `npm run verify` grün; keine Konsolenfehler in E2E; Content-Validator grün; kein TODO/FIXME im Code.
- Zwei aufeinanderfolgende Spec-Audits ohne Lücke; alle Mindestmengen aus §C erreicht (Validator zählt).
- Hauptstory durchspielbar: Progressionstest + dokumentierter Durchlauf (Debug-Beschleunigung erlaubt) mit Screenshots jeder Station.
- Performance-Budgets §30 erfüllt.
- DE und EN vollständig.
- PWA installierbar und offline spielbar; Smoke-Tests in Chromium, Firefox und WebKit (wo WebGL2 headless nicht verfügbar ist: dokumentierter Ersatznachweis).
- `README.md`, `CREDITS.md`, `CHANGELOG.md` vorhanden; `v1.0.0` getaggt.

---

## §A CLAUDE.md-Vorlage
```md
# DUSKHEARTH – Arbeitsregeln
- Spezifikation: MASTERPROMPT.md (nie ändern, nie komplett lesen → `grep -n "^## §" MASTERPROMPT.md`).
- Loop: Jeder Durchlauf folgt MASTERPROMPT.md §1. Zustand: PROGRESS.md, FEEDBACK.md, docs/DECISIONS.md.
- Befehle: npm run dev | check | test:e2e | shot -- <szenario> | bench | assets | verify
- Regeln (§2): keine Platzhalter/TODOs · datengetrieben (src/content, balance.ts) · strict TS · kein Math.random/Date.now in der Simulation · engine/world/game/content/save importieren nie render/audio/ui · jede Mechanik speicherbar und DE/EN · jede Änderung verifiziert und committed · nach Grafikänderungen Screenshots ansehen.
- Commit: <typ>(<bereich>): <was> [<Task-ID>]
- Subagents: exklusive Dateien je Subagent; du integrierst, prüfst, committest.
- Nie: Tests abschwächen, Anforderungen streichen, pushen, auf Antworten warten.
```

---

## §B PROGRESS.md- und FEEDBACK.md-Vorlage
```md
# PROGRESS – DUSKHEARTH
STATUS: IN_ARBEIT
Meilenstein: M0 · Nächster Task: M0-01 · Letztes Gate: – · Letzter Audit: –

## Blocker
(keine)

## Backlog
### M0 Fundament [Gate: offen]
- [ ] M0-01 Vite+TS-Scaffold, strict, Ordner nach §3.5 — Akzeptanz: `npm run dev` zeigt leere Szene · Abh.: –
- [ ] M0-02 ESLint mit Schichtregeln §3.2 + Verbotsliste — Akzeptanz: Verstoß lässt `npm run check` scheitern · Abh.: M0-01
…
### M1 Renderer & Asset-Pipeline [Gate: offen]
…

## Spec-Abdeckung
| Abschnitt | Tasks |
|---|---|
| §3 Tech-Stack | M0-01, M0-02, … |

## Log (max. 25 Zeilen, Älteres verdichtet)
JJJJ-MM-TT HH:MM | M0-01 | erledigt | Notiz
```
```md
# FEEDBACK – Notizen an Claude
Neue Einträge oben, mit Datum. `!` am Anfang = dringend.
Claude setzt jeden Punkt als Task um und markiert ihn danach mit ✅ <Task-ID>.

- JJJJ-MM-TT: …
```

---

## §C Content-Mindestumfang (der Validator zählt mit)
| Kategorie | Minimum | Kategorie | Minimum |
|---|---|---|---|
| Items gesamt (inkl. Bauteile) | 550 | Kreaturen (ohne Varianten) | 70 |
| Rezepte | 380 | Elites | 15 |
| Stationen | 30 | Bosse | 9 (+ Echo-Varianten) |
| Bauteile, Möbel, Deko | 180 | Gewölbe pro Welt „Mittel" | 24 |
| Waffen (alle Stufen) | 80 | Raumvorlagen | 90 |
| Rüstungsteile | 48 (12 Sets) | Rätseltypen | 14 |
| Schmuck | 30 | Ortstypen | 18 |
| Gerichte & Getränke | 55 | Siedler | 20 |
| Tränke & Medizin | 22 | Siedler-Sprüche | 250 |
| Nutzpflanzen | 28 | Erbauer-Tafeln | 60 |
| Baumarten | 14 | Erfolge | 60 |
| Fischarten | 24 | Perks | 72 |
| Statuseffekte | 30 | Musikstücke | 22 |
| Sprachen | DE + EN, 100 % | Soundeffekte | 300 |

---

## §D Balancing-Rahmen (Startwerte, feinjustiert in M14)
- **Waffenschaden Basis je Stufe:** T0 8 · T1 12 · T2 17 · T3 24 · T4 33 · T5 45 · T6 60 · T7 78. Klassenfaktor: Dolch ×0,6 (schnell) · Schwert ×1,0 · Speer ×0,95 · Keule ×1,1 · Axt ×1,15 · Bogen ×1,1 (voll gespannt) · Armbrust ×1,6 · Zweihand ×1,8.
- **Gegnerleben:** normale Gegner einer Stufe fallen nach 4–6 Treffern mit stufengerechter Einhandwaffe; Elites ×4; Bosse 120–200 Treffer-Äquivalente (Kampfdauer 3–6 min).
- **Gegnerschaden** gegen stufengerechte Rüstung: normaler Treffer 8–12 % des effektiven Lebens, schwere telegraphierte Attacke 20–30 %, Boss-Spezial 30–45 %; kein One-Shot auf Normal.
- **Rüstungswert je Set:** T0 6 · T1 12 · T2 20 · T3 30 · T4 42 · T5 56 · T6 72 · T7 90.
- **Haltbarkeit (Nutzungen):** T0 60 · T1 150 · T2 250 · T3 400 · T4 550 · T5 700 · T6 900 · T7 1200.
- **Sammeln:** Treffer = ⌈Ressourcen-HP / (Abbaukraft × (1 + Skillbonus))⌉; Grünhain-Baum: 5 Treffer mit Steinaxt, 3 mit Bronzeaxt.
- **Ökonomie:** komplette Ausrüstung einer Stufe (Werkzeuge + Waffe + Rüstung) ≈ 2–3 Spielstunden Sammeln; Lumen-Scherben ≈ 15–25 pro aktiver Nacht auf Stufe 1, ×1,4 je Stufe.
- **Pacing** gemäß §23.1, gemessen per Debug-Statistik (Zeit bis zu Meilenstein-Ereignissen) im Progressionstest, dokumentiert in `docs/BALANCE.md`.
