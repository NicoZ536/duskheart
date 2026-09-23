# DECISIONS – Architektur- und Designentscheidungen (ADR-Kurzformat)
Format: Kontext · Entscheidung · Alternativen · Folgen

## ADR-0001 Pushes auf den Arbeitsbranch (2026-09-23)
- **Kontext:** §1.4 verbietet Pushes. Die Entwicklung läuft aber in einem flüchtigen Cloud-Container; die Umgebung schreibt vor, auf den Branch `claude/progress-npm-verify-ous1f6` zu pushen. Ohne Push ginge beim Recyceln des Containers der gesamte Stand verloren.
- **Entscheidung:** Nach abgeschlossenen Durchläufen wird ausschließlich dieser Branch gepusht (`git push -u origin <branch>`), nie mit Force, nie andere Branches. Tags werden lokal gesetzt und zusammen mit dem Branch gesichert.
- **Alternativen:** Gar nicht pushen (Datenverlust-Risiko), auf main pushen (verboten).
- **Folgen:** Der Mensch sieht den Fortschritt im Remote-Branch; die Regel „keine Force-Operationen" bleibt unverändert.

## ADR-0002 npm `legacy-peer-deps` (2026-09-23)
- **Kontext:** npm 10.9.7 bricht beim Auflösen optionaler Peer-Abhängigkeiten von Vitest 4 (msw) mit „Cannot read properties of null (reading 'edgesOut')" ab.
- **Entscheidung:** `.npmrc` setzt `legacy-peer-deps=true` und `save-exact=true`. Alle benötigten Peers (vite, @babel/core für den Preact-Preset, workbox-window) werden explizit und gepinnt installiert.
- **Alternativen:** npm-Upgrade im Container (nicht reproduzierbar für andere Umgebungen), älteres Vitest (verliert aktuelle Fixes).
- **Folgen:** `npm ci` ist reproduzierbar; neue Pakete müssen ihre Peers explizit mitbringen.

## ADR-0003 Stack-Versionen (2026-09-23)
- **Kontext:** §3.1 fordert TypeScript 5, Vite, Node 22 LTS. Aktuell verfügbar sind TypeScript 7 und Vite 8.
- **Entscheidung:** TypeScript 5.9.3 (Vorgabe „TypeScript 5"), Vite 7.3.6 (ausgereift, von vite-plugin-pwa 1.3 und Vitest 4 unterstützt), Vitest 4.1.11, Playwright 1.56.1 (passend zum vorinstallierten Chromium 1194), ESLint 9 + typescript-eslint 8, Preact 10 + @preact/signals 2, zod 4. Alle Versionen exakt gepinnt, alle Lizenzen MIT/Apache-2.0/ISC/BSD bzw. OFL (Schrift).
- **Alternativen:** Vite 8 (Rolldown, jünger), TypeScript 7 (widerspricht §3.1).
- **Folgen:** Upgrades nur per ADR.

## ADR-0004 Content-Validator mit Meilenstein-Zielen (2026-09-23)
- **Kontext:** §31.4 verlangt, dass der Validator die Mindestmengen aus §C zählt; `npm run check` muss aber in jedem Durchlauf grün sein, auch bevor die Inhalte existieren.
- **Entscheidung:** `tools/content-targets.ts` enthält je Meilenstein Zielmengen, die bis M14 auf die §C-Werte steigen. Der Validator liest den aktuellen Meilenstein aus `PROGRESS.md` und erzwingt dessen Ziele (Unterschreitung = Fehler). Die Endwerte entsprechen exakt §C.
- **Alternativen:** §C sofort erzwingen (Check wäre bis M14 rot, widerspricht §1.4) oder nur berichten (keine Durchsetzung).
- **Folgen:** Jeder Meilenstein muss seinen Content-Anteil liefern, sonst schließt sein Gate nicht.
- **Status:** Die Meilenstein-Tabelle ist durch ADR-0007 (Zielwerte-Datei) abgelöst; das Prinzip „Unterschreitung = Fehler“ bleibt.

## ADR-0005 Content-Texte zweisprachig am Datensatz (2026-09-23)
- **Kontext:** §2.2 verlangt für jedes Item, jede Kreatur, jede Tafel usw. Texte DE und EN; §31.4 verlangt, dass fehlende Übersetzungen ein Fehler sind. Hunderte Content-Datensätze werden parallel von Subagents erstellt.
- **Entscheidung:** Content-Texte stehen als `LocalizedText { de, en }` direkt am Datensatz (zod erzwingt beide, nicht leer). `src/i18n/de.json`/`en.json` enthalten die UI- und Systemtexte.
- **Alternativen:** Alle Texte als Schlüssel in de.json/en.json (Merge-Konflikte zwischen parallelen Subagents, Texte getrennt vom Datensatz).
- **Folgen:** Fehlende Übersetzungen sind schon beim Laden ein Schemafehler; der Validator prüft zusätzlich die i18n-Dateien auf Parität.

## ADR-0006 Zählregeln für die Content-Mindestmengen (2026-09-23)
- **Kontext:** §C nennt Mindestmengen, §15.2 listet Stationen mit Ausbaustufen (Werkbank I–III, Schmelzofen I–III, Kräutertisch mit Alchemie I–II, Sägebock → Sägewerk). Ohne feste Regeln ließen sich Zählwerte durch Stufen, Varianten oder Umfärbungen aufblähen.
- **Entscheidung:** Gezählt werden Datensätze der Content-Registry über ihre Kategorie-Zuordnung (`defineCollection(…, { category })`), je Datensatz und Kategorie höchstens einmal.
  - **Stationen:** Ausbaustufen einer Station, die am selben Objekt entstehen (Werkbank I–III, Schmelzofen I–III, Alchemie I–II), zählen **einmal**. Eine Ausbaukette mit „→“ (Sägebock → Sägewerk) zählt ebenfalls **einmal**, auch wenn beide Stufen eigene Items sind. Eigenständige Objekte, die §15.2 nur gemeinsam nennt (Butterfass & Käsepresse), zählen einzeln. Damit ergibt die Liste aus §15.2 32 Stationen (≥ 30).
  - **Items:** jede Item-ID zählt einmal unter „Items gesamt“; Bauteile, Waffen, Rüstungsteile, Schmuck, Gerichte und Tränke zählen zusätzlich in ihrer Fachkategorie („inkl. Bauteile“). Materialstufen einer Form (Steinaxt, Bronzeaxt …) sind eigene Items und zählen einzeln („Waffen alle Stufen“).
  - **Nicht gezählt:** Farb- und Palettenvarianten (Möbel-Recolors, Elite-Umfärbungen, Charakteranpassung), Kreaturen-Varianten (§C „ohne Varianten“), Echo-Varianten von Bossen, zufällige Tonhöhen-/Lautstärkevarianten desselben Soundeffekts.
  - **Rüstung:** jedes Teil zählt unter „Rüstungsteile“, jedes Set einmal unter „Rüstungssets“. **Siedler-Sprüche:** jeder Spruch (DE+EN) einmal. **Rezepte:** jeder Rezept-Datensatz einmal, auch wenn zwei Rezepte dasselbe Produkt an verschiedenen Stationen herstellen.
- **Alternativen:** Jede Stufe einzeln zählen (bläht „Stationen“ auf 36+ auf, ohne mehr Spielinhalt); Varianten mitzählen (widerspricht §C „ohne Varianten“).
- **Folgen:** Content-Tasks ordnen jede Sammlung mit dieser Regel Kategorien zu; der Validator zählt generisch über `countsByCategory()`.

## ADR-0007 Zielwerte-Datei für den Content-Validator (2026-09-23)
- **Kontext:** ADR-0004 legte Zwischenziele als Meilenstein-Tabelle in `tools/content-targets.ts` fest. Der Backlog (M0-13) verlangt stattdessen eine Zielwerte-Datei, die jeder Zähl-Task selbst anhebt – so steigt die Untergrenze genau dann, wenn Content geliefert wird, und kann danach nicht mehr unbemerkt sinken.
- **Entscheidung:** `tools/validator/zielwerte.json` enthält je §C-Kategorie den aktuell erzwungenen Wert (zod-geprüft: jede Kategorie genau einmal, ganze Zahl ≥ 0). `npm run validate:content` scheitert, wenn ein Zählwert darunter liegt. Jeder Task, der zählbaren Content liefert, hebt den Wert seiner Kategorien auf den erreichten Stand; M14-20 setzt alle Werte auf §C, ab dann ist §C die harte Untergrenze (zusätzlich erzwingt der Validator nach `STATUS: FERTIG` immer §C). Die Meilenstein-Tabelle aus ADR-0004 entfällt; `tools/content-targets.ts` enthält nur noch Kategorien und §C-Endwerte.
- **Alternativen:** Meilenstein-Tabelle beibehalten (Ziele springen erst am Gate, Rückschritte innerhalb eines Meilensteins bleiben unbemerkt).
- **Folgen:** ADR-0004 ist in diesem Punkt abgelöst. Tests: `tests/unit/tools/validate.test.ts` (Fixture `tests/fixtures/validator/zielwerte-items-4.json` ⇒ Fehler).

## ADR-0008 Save-Vertrag und kanonische Serialisierung im game-Layer (2026-09-23)
- **Kontext:** `SimSystem.save` braucht den Typ `SaveParticipant`, `Simulation.hashState()` die kanonische Serialisierung. Die Schichtregel (§3.2) verbietet `game → save`.
- **Entscheidung:** `SaveParticipant`/`SaveMigration` liegen in `src/game/participant.ts`, `canonicalJson`/`stableHash64` in `src/game/canonical.ts`. `src/save/registry.ts` und `src/save/canonical.ts` exportieren sie unverändert weiter; Registry, Migrationen, Speicher-Adapter und Roundtrip-Helfer bleiben in `src/save`.
- **Alternativen:** Typen in `engine` (gehören fachlich nicht dorthin); Hash ohne kanonische Form (instabil bei Schlüsselreihenfolge).
- **Folgen:** Aufrufer importieren den Save-Vertrag aus `src/save`, Systeme aus `src/game`; beide sehen dieselben Typen.

## ADR-0009 Laufzeit-Verdrahtung im Browser ab M0 (2026-09-23)
- **Kontext:** M0-08 verlangt Eingabe → Aktionen → Commands, M0-10 „Commands ausführen“ und „freezeTime hält die Sim-Zeit an“. Bisher lief im Browser nur die Testszene; Tab-Wechsel hob ein Debug-Einfrieren auf, und fehlende i18n-Schlüssel fielen still auf Deutsch zurück.
- **Entscheidung:**
  - `src/game/session.ts` (`GameSession`, DOM-frei) bündelt Simulation, `InputState`, `ActionReader` und `InputCommandTranslator` (`src/game/input.ts`); `main.tsx` hängt den DOM-Adapter an und treibt die Sitzung über `FixedStepLoop` (`beginFrame` einmal je Frame vor den Ticks, `update` = `session.step()`, Takt und Aufholgrenze aus `BALANCE.time`). Startseed `BOOT_SESSION_SEED`, im Debug-Modus per `?seed=` wählbar.
  - `FixedStepLoop.pause(reason)`/`resume(reason)`: benannte Pausegründe (`hidden`, `debugFreeze`, später Pausemenü); die Simulation läuft nur ohne aktiven Grund.
  - `window.__dh.command(cmd)` führt Game-Commands (zod-geprüft) im nächsten Tick aus; `__dh.readPixel(x, y)` liest ein Pixel des nächsten Frames (Pixelprobe der E2E-Tests); `__dh.state().sim` zeigt Tick, Tag, Uhrzeit, Entitäten.
  - i18n ohne stillen Fallback: fehlende Schlüssel werden über `onMissing` gemeldet (App: Konsolenfehler), `strict: true` wirft.
- **Alternativen:** Simulation erst mit dem Spieler (M3) in den Browser holen – dann wären Input→Command und `freezeTime` bis dahin nur in Node belegt.
- **Folgen:** Präsentation und Debug-Werkzeuge verändern die Welt ausschließlich über `sim.commands`; E2E-Tests prüfen die ganze Kette im Browser.

## ADR-0010 UI-Schicht: Signals-Brücke, Theme, Preact-Grenze (2026-09-23)
- **Kontext:** M0-16 verlangt ein Preact-Overlay, das den Sim-Zustand über Signals liest und nur Commands schreibt, ein Theme-Grundgerüst und „Preact nur in `src/ui`“. Die Entwicklerwerkzeuge (`src/debug`: F3-Overlay, Konsole) rendern seit M0-10 ebenfalls mit Preact; die Brücke braucht eine lesende, allokationsfreie Sicht auf die Sitzung.
- **Entscheidung:**
  - `GameSession` bekommt `sampleStatus(out)` (füllt einen vom Aufrufer gehaltenen Datensatz, keine Allokation je Frame) und `onEvent(type, handler)` (die nach jedem Tick geleerten Sim-Events über einen `EventBus`). `src/ui/bridge.ts` sieht nur `Pick<GameSession, 'sampleStatus' | 'onEvent' | 'command'>`, veröffentlicht einmal je gerendertem Frame in einem `batch` und schreibt ausschließlich Game-Commands.
  - Theme: Farb-Tokens `--dh-<name>` kommen zur Laufzeit aus `UI_HEX` der Master-Palette, `--dh-ui-scale` ist ganzzahlig 1–4 (Auto = ⌊min(B/480, H/270)⌋, sonst `accessibility.uiScale`). CSS enthält keine eigenen Farbwerte; Browser-Themefarbe und PWA-Manifest nutzen die Palettenfarbe `dunkel`.
  - ESLint erlaubt Preact nur in `src/ui` und `src/debug` (Entwickleransichten, nur im Debug-Modus geladen). `src/main.tsx` importiert Preact nicht, sondern bindet die UI über `mountApp` ein; alle Simulations- und Präsentationsschichten außer ui/debug, `src/i18n`, `tools/` und `assets-src/` sind gesperrt.
- **Alternativen:** Debug-Ansichten ohne Preact (rohes DOM, doppelte Komponentenlogik); Signals je Tick aktualisieren (Re-Render bis 5× je Frame); Farb-Tokens als handgepflegte CSS-Werte (zweite Palette neben `assets-src/palette.ts`).
- **Folgen:** Neue UI-Daten kommen als Feld in `SessionStatus` bzw. als Event-Abo in die Brücke, nie als direkter Simulationszugriff. `tests/unit/ui/bruecke.test.ts` und `tests/e2e/ui-overlay.spec.ts` belegen Brücke, Theme und Overlay; `tests/unit/tooling/verbotsliste.test.ts` die Preact-Grenze.
