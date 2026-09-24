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

**Warum kein OfflineAudioContext:** Dieselbe Synthese läuft im Browser (Worker) und in Node (Vitest), bit-gleich.
Presets sind damit ohne Browser testbar (endlich, Spitze ≤ 1, Länge, Lautheit, Schleifennaht –
`tests/unit/audio/render.test.ts`); der Browser bekommt fertige `AudioBuffer` (32 kHz, SNES-Rate).

**Neues Preset:** in die passende Gruppendatei unter `src/content/sfx/` (Id `sfx_<bereich>_<name>`), dann
`npm run validate:content` – ein Preset, das niemand auslöst, ist eine Warnung (`tools/validator/sfx.ts`),
`tools/validator/zielwerte.json` `sfx` auf die neue Zahl heben.

**Neues Sim-Ereignis:** in `EVENT_SFX` abbilden oder in `SILENT_EVENTS` begründen –
`tests/unit/audio/eventMap.test.ts` schlägt sonst fehl; die Abdeckungsliste der M3-Spieleraktionen steht dort.

**Präsentation/UI:** `audio.play({ id })` für UI-Klänge (die Bildschirme über `MenuHooks.klang`),
`audio.setLoop(platz, { id, x, y })` für Lagerfeuer und Fackeln (ein Platz je Quelle, `null` beendet),
`audio.onSubtitle(fn)` für Untertitel (nur bei `settings.audio.subtitles`; angezeigt von
`src/ui/hud/Untertitel.tsx`), `audio.clipEvent(name, schleife)` für die Frame-Ereignisse der Spielerfigur,
`audio.setPaused(an)` für das Pausemenü.
