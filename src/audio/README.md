# src/audio – Klang (MASTERPROMPT §3.2, §27)

Web-Audio-Graph, Mixer, SFX-Synthese und -Wiedergabe, Ereignis-→-Klang-Tabelle; später Sequencer,
Songs und Musik-Rendering im Worker (M7).

- Liest Simulationszustand und Events, verändert die Simulation nie; importiert nie `src/ui`
  (ESLint-Schichtregel). Verträge: docs/ARCHITEKTUR.md „Präsentation“, docs/SPIEL.md §5 (`sfx_<bereich>_<name>`).

## Audio-Minimalkern (M3-33)

| Datei | Aufgabe |
|---|---|
| `src/content/sfx/*.ts` | Presets als Daten (zod, `sfxPresetSchema`), je Gruppe eine Datei, Registry-Sammlung `sfx` (§C „Soundeffekte“) |
| `dsp/render.ts`, `dsp/biquad.ts` | Synthese in reinem TypeScript: Oszillatoren (Rechteck/Dreieck/Säge/Sinus, PolyBLEP), FM, Rauschen weiß/rosa/braun, Sample-and-Hold-Rauschen, Knistern, Resonanzfilter mit Sweep, ADSR, Layering, Wiederholungen, Bit-Reduktion; Lautheitsnormierung, nahtlose Schleifen |
| `sfx.worker.ts`, `sfxWorkerProtocol.ts` | rendert alle Presets nach dem ersten Input im Worker (kein Frame-Einbruch) |
| `mixer.ts` | Master → Busse Musik/Effekte/Umgebung/UI, Kompressor, Limiter, Pegel aus `settings.audio` |
| `spatial.ts` | Distanzdämpfung, Panorama, Tiefpass bei Verdeckung (Hook `occlusion`), Ebenen |
| `sfxPlayer.ts` | Stimmen, Varianten gegen Wiederholung (andere Take, Tonhöhe, Pegel), Stimmenlimit, Sperrzeit, Schleifen je Platz, Untertitel-Rückruf |
| `eventMap.ts` | Datentabelle `EVENT_SFX`: jedes Sim-Ereignis → Klänge, `SILENT_EVENTS` mit Begründung |
| `clipEvents.ts` | Frame-Ereignisse der Körper-Clips (`biss`, `schluck`, `aufprall` …) → Klänge; was die Simulation schon meldet, bleibt beim Sim-Ereignis (ein Klang je Moment) |
| `runtime.ts` | `attachAudio` (src/main.tsx): Autoplay-Freigabe beim ersten Input, Events abonnieren, Hörer je Frame, Einstellungen, verborgener Tab, Clip-Ereignisse der Figur, Pausemenü (Effekte und Umgebung aus) |

## Klänge der Basis (M4-29)

| Datei | Aufgabe |
|---|---|
| `src/content/sfx/bauen.ts`, `tueren.ts`, `stationen.ts`, `lagerung.ts`, `brand.ts` | Presets: Setzen/Abbauen/Bersten/Schaden je Material (Holz, Stroh, Stein, Lehm, Glas, Metall), Einsturz, Herabfallen, Blaupause, Fertigstellen, Aufwerten, Reparatur; Türen je Art; Arbeitsschleife und „fertig“ je Stationslinie, Nachlegen, Stillstand, Abkühlen, Reparieren; Kisten je Behälter; Brand und Herdfeuer |
| `baseSounds.ts` | Datentabellen Ereignis-Merkmal → Preset: `BUILD_AUDIO` (§16.2-Material → Klangmaterial), `DOOR_AUDIO`, `STATION_EXTRA_AUDIO` (was alle Stationen teilen: Nachlegen, Stillstand, Abkühlen, Reparieren), `STORAGE_AUDIO` (je Behälter), `FIRE_AUDIO`, `HEARTH_AUDIO`, `FLOOR_STEP`. Die Klänge einer Station stehen nur in ihrem Content-Datensatz (`sounds`: `koerper`, `laeuft`, `fertig` in `src/content/stations.ts`) |
| `loopSources.ts` | `LoopDirector`: Schleifen dessen, was in der Welt brennt und arbeitet – laufende Verarbeitungsstationen, die Warteschlange an einer Handstation, platzierte Lichter, Herdfeuer, Brände – **aus dem Zustand der Simulation**, nicht aus Ereignissen (ein geladener Spielstand, der Audio-Start mit dem ersten Input und das stille Aufholen eingefrorener Chunks melden nichts). Alle 0,25 s und im Bild nach einem Ereignis aus `LOOP_SOURCE_EVENTS`; je Preset die nächsten `stimmen`, nur in Reichweite und auf der Ebene des Hörers, höchstens `MAX_WORLD_LOOPS` (12 von 32 Stimmen) |
| `underfoot.ts` | Schritte auf gebauten Böden klingen nach dem Boden (Dielen, Steinplatten, Stampflehm, Treppe), Blaupausen nach dem Gelände |
| `lightProbe.ts` | Art eines platzierten Lichts für `fireFueled`: Brennstoff auf einem Feuer (Lagerfeuer, Kamin) klingt nach Nachlegen (`sfx_feuer_nachlegen`), Harz in einer Lampe nach dem Harz |

**Ein Klang je Moment:** Was ein anderes Ereignis schon vertont, bleibt still (`SILENT_EVENTS`): die Kiste und das Herdfeuer
als Bauteil (`partPlaced`/`partRemoved` mit Material), Möbellichter ebenso (`lightPlaced` einer Lampe, einer Laterne, des
Kamins schweigt), Stücke, die in die Taschen kommen (`itemsAdded`), ein Einsturz oder eine Aufwertung für alle ihre
Kacheln, der Stationsbildschirm (sein eigener Öffnen-Klang). Abgelehnte Befehle der Basis antworten mit dem Fehlerklang
(außer `storage.close` und dem Debug-Befehl `fire.ignite`).

**Zuschütten (M4-40):** Erde in eine gegrabene Kachel (`itemUsed`, `zuschuetten`) klingt nach `sfx_graben_zuschuetten`
(`KERNEL_SFX.filled`: Erde rutscht von der Schaufel, Klumpen fallen, zweimal festgeklopft) – nicht nach dem Klick eines
Items ohne eigenen Benutzen-Klang.

**Neue Station:** ihre `sounds` im Content-Datensatz (das Schema verlangt Körper, Arbeitsschleife und „fertig“; jede Stufe
einer Linie klingt wie die Linie). **Neuer Behälter, neues Material:** Eintrag in `baseSounds.ts` –
`tests/unit/audio/baseSounds.test.ts` schlägt sonst fehl (Abdeckungsliste: jedes Bauteil, jede Tür, jede Station, jedes
Rezept, jeder Behälter hat Klang).

**Warum kein OfflineAudioContext:** Dieselbe Synthese läuft im Browser (Worker) und in Node (Vitest), bit-gleich.
Presets sind damit ohne Browser testbar (endlich, Spitze ≤ 1, Länge, Lautheit, Schleifennaht –
`tests/unit/audio/render.test.ts`); der Browser bekommt fertige `AudioBuffer` (32 kHz, SNES-Rate).

**Neues Preset:** in die passende Gruppendatei unter `src/content/sfx/` (Id `sfx_<bereich>_<name>`), dann
`npm run validate:content` – ein Preset, das niemand auslöst, ist eine Warnung (`tools/validator/sfx.ts`),
`tools/validator/zielwerte.json` `sfx` auf die neue Zahl heben.

**Neues Sim-Ereignis:** in `EVENT_SFX` abbilden oder in `SILENT_EVENTS` begründen –
`tests/unit/audio/eventMap.test.ts` schlägt sonst fehl; die Abdeckungsliste der M3-Spieleraktionen steht dort.

**Präsentation/UI:** `audio.play({ id })` für UI-Klänge (die Bildschirme über `MenuHooks.klang`),
`audio.setLoop(platz, { id, x, y })` für eigene Schleifen der Präsentation (ein Platz je Quelle, `null` beendet; Lichter,
Stationen, Herdfeuer und Brände setzt der `LoopDirector` selbst),
`audio.onSubtitle(fn)` für Untertitel (nur bei `settings.audio.subtitles`; angezeigt von
`src/ui/hud/Untertitel.tsx`), `audio.clipEvent(name, schleife)` für die Frame-Ereignisse der Spielerfigur,
`audio.setPaused(an)` für das Pausemenü.
