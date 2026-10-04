# M7-STRÄNGE – Arbeitsvereinbarung für M7 „Das erste Feuer“ (gültig bis zum M7-Gate)

Verbindlich für alle Stränge A–I und den Integrator, bis `M7-GATE` abgehakt ist (danach gilt sie nicht mehr; was bleibt, steht in
docs/SPIEL.md §16–§30 und ADR-0175). Grundlage: der M7-Vertrag (Teil 4 „Wellenplan“), berichtigt gegen den Code nach Welle 0. Die Typen,
Haken und Sammeldateien aus Welle 0 stehen in docs/SPIEL.md §16–§17 und ADR-0175; die gemeinsamen Aggregationsdateien in der Tabelle
docs/SPIEL.md §16 „Gemeinsame Aggregationsdateien“.

## Überblick und Reihenfolge (Vertrag Teil 4.1)

```text
M6-GATE ─► Welle 0 (Integrator, ~2 h) ─► Welle 1: A Klang · B Orte & Welt · D Feld & Fang · F Boss & Leuchtfeuer · H Menüs & Speichern
                                          │  (parallel, je 2–4 h; Integration + check + Commit nach der Welle)
                                          ▼
                                         Welle 2: C Gewölbe · E Küche & Vorrat · G Chronik & Führung · I Figur & Kreaturen
                                          │  (parallel, je 2–4 h; Integration + check + Commit)
                                          ▼
                                         Welle 3 (Integrator, optional ein Politur-Agent): M7-61, M7-62, M7-63, Fixture v4, Screenshot-Set, M7-GATE
```

| Strang | Tasks (Anzahl) | Welle | braucht vorher | E2E-Port |
|---|---|---|---|---|
| A Klang | M7-01 … M7-06, M7-31 (7) | 1 | Welle 0 | 4271 |
| B Orte & Welt | M7-07, M7-08, M7-09, M7-38, M7-39, M7-40, M7-49 (7) | 1 | Welle 0 | 4272 |
| C Gewölbe | M7-10 … M7-16, M7-18, M7-46 (9) | 2 | B (Orts-Laufzeit, Stempeln, `PlacesApi`) | 4273 |
| D Feld & Fang | M7-19 … M7-24 (6) | 1 | Welle 0 | 4274 |
| E Küche & Vorrat | M7-25 … M7-30, M7-60 (7) | 2 | D (Nutzpflanzen, Fische, `ClimateLog`) | 4275 |
| F Boss & Leuchtfeuer | M7-32 … M7-37 (6) | 1 | Welle 0 (Arena-Vorlage über die Orts-Sammeldatei; ohne B-Stempel testet F auf gezeichneter Karte) | 4276 |
| G Chronik & Führung | M7-41 … M7-45, M7-47, M7-48, M7-64 (8) | 2 | A, B, D, F, H (deren Ereignisse, Tabellen, Einstellungen) | 4277 |
| H Menüs & Speichern | M7-50, M7-51, M7-55 … M7-59 (7) | 1 | Welle 0 | 4278 |
| I Figur & Kreaturen | M7-17, M7-52, M7-53, M7-54 + Schmuck/Deko aus M7-62 (4 + Content) | 2 | H (Neue-Welt-Ablauf), A und D (neue Spielerclips `musizieren`, `angeln`) | 4279 |
| Integrator | Welle 0; M7-61, M7-62, M7-63, Fixture v4, M7-GATE | 0, 3 | alle | 4173 |

Höchstens fünf Stränge gleichzeitig (4 Kerne, 15 GB): mehr parallele Agenten verlängern jeden `npm run check` über das Budget (M6: 110 s
ruhig, 165 s unter Last). Kritischer Pfad: Welle 0 → F (Borkenvater, Leuchtfeuer) → G (Progressionstest M7-64) → Welle 3 (Playtest M7-63).

## Regeln für alle Stränge (Vertrag Teil 4.3)

- **Exklusiv** sind die unten genannten Globs; alles andere ist entweder eine **Aggregationsdatei** (Tabelle §16: unmittelbar vor jeder
  Änderung neu lesen, nur kleine Einfügung am eigenen Anker, nie fremde Zeilen umformatieren, kein Prettier über die ganze Datei) oder tabu.
  Wer eine fremde Datei ändern müsste, beschreibt die Änderung im Bericht; der Integrator macht sie.
- `docs/**`, `PROGRESS.md`, `FEEDBACK.md` ändert nur der Integrator; ADRs als Entwürfe „ADR-00xx …“ (Kontext/Entscheidung/Alternativen/
  Folgen) im Bericht, Belegzeilen je Task, vorgeschlagene Folgeaufgaben, Glossar-Begriffe, Stinger- und Klangwünsche an A.
- Kein `git` (kein add/commit/stash/checkout), kein `npm install`. Gemeinsame Ressourcen nur unter Sperre:
  `flock /tmp/claude-0/dh-assets.lock npm run assets`, `flock /tmp/claude-0/dh-check.lock npm run check` (und `typecheck`/`lint` mit Cache).
  Tests während der Arbeit gezielt: `npx vitest run --project unit <eigene Dateien>`; vor dem Bericht einmal `npm run check` unter Sperre.
- **Private E2E:** eigene Playwright-Konfiguration im Scratchpad (Muster `scratchpad/pw-audio.config.ts` aus M6): `testDir`
  `/home/user/duskheart/tests/e2e`, `baseURL` `http://127.0.0.1:<Port>`, `webServer.command` `npx vite preview --port <Port> --strictPort
  --host 127.0.0.1 --outDir <scratch>/dist-<strang>`, Build vorher mit `npx vite build --outDir <scratch>/dist-<strang>`, `outputDir` im Scratchpad,
  `reuseExistingServer: false`. Screenshots mit `npm run shot -- <szenario>` (eigener Vite-Dev-Server auf freiem Port, keine Kollision) und
  **ansehen** (Read auf die PNGs), Prüfung nach §31.5/ART.md.
- **Tests schnell halten** (Teil 5): Unit-Tests nur auf gezeichneten Testwelten (`tests/unit/game/<bereich>-testwelt.ts` nach dem Muster von
  `lager-testwelt.ts`), keine Weltgenerierung, keine Mehrtages-Läufe, keine ganzen Musikstücke; Sweeps nach `tests/integration/`. Jeder Strang
  meldet die Laufzeit seiner neuen Unit-Dateien (Ziel ≤ 3 s CPU je Strang).
- **Frame-Pfad:** jeder neue Szenen-Teil und jede HUD-Abtastung arbeitet ohne Allokation je Frame (gehaltene Datensätze); Beleg
  `npm run bench -- --nur render` (Frame-Pfad `spiel` ≤ 2 048 B, Messwert vorher/nachher im Bericht).
- Jeder neue Teilnehmer: Roundtrip-Test `tests/unit/save/roundtrip/<id>.test.ts`, Eintrag in Save-Version 4 (`src/save/versions.ts`,
  ggf. Eintrag anlegen = v3 + eigener Teilnehmer), Fixture-Beitrag `tools/save/fixtureM7/<bereich>.ts` mit `<bereich>Facts`.
- Jedes neue Ereignis: `eventMap.ts` (Klang oder begründete Stille), Chronik-/Statistik-/Hinweis-Tabelle wo sinnvoll, Vermittlungs-Eintrag
  für jede neue Mechanik (`src/content/vermittlung/<bereich>.ts`), Texte DE/EN.
- Balancewerte in eigenen Gruppen `src/content/balance/<gruppe>.ts` (Gruppennamen §28: `places`, `map`, `worldEvents`, `vaults`, `puzzles`,
  `farming`, `fishing`, `meals`, `spoilage`, `water`, `bosses`, `beacons`, `travel`, `guide`, `quests`, `instruments`, `difficulty`), je ein Import +
  Feld in `src/content/balance.ts`; jede Gruppendatei gehört dem Strang, der sie anlegt.
- Ein Strang der Welle 2 darf Dateien eines fertigen Welle-1-Strangs nur als Aggregation anfassen (kleine Einfügung) – Ausnahmen stehen beim
  Strang (I übernimmt `playerFigure.ts` und `assets-src/sprites/figuren/**` samt den Clip-Dateien von A und D; G fügt in `src/main.tsx` eine Zeile
  für `guide.configure` ein).
- **Content und Tests je Meilenstein** (Welle 0, ADR-Entwurf „Doku-Tests je Meilenstein“): Tests, die den Stand bis M6 genau prüfen
  (`spiel-doku`, `registry`, `stationen`, `ruestung-inhalt`, `perks-kampf`, die Kreaturen-Zählungen in `telegraph`, `bestiarium`, `ki`,
  `validator-kreatur-telegraph`), zählen den M6-Stand (`tests/unit/content/stand.ts`, `tests/fixtures/content/stand-m6.json`) – sie werden nicht
  angefasst. Jede neue Station und Kreatur muss eine kanonische Id aus docs/SPIEL.md §29 sein, jede neue Sammlung in §29 „Neue Sammlungen“
  stehen; eine Id, die dort fehlt, meldet der Strang dem Integrator (Bericht), statt einen Test zu ändern.
- **Vorhandene Haken aus Welle 0** (nicht neu bauen, nur benutzen): `observeStep` und `StepEvents` (`src/game/observe.ts`), `SYSTEM_ORDER`
  (`src/game/systemOrder.ts`), `ToolsSystem.addItemUse` (`src/game/tools/itemUses.ts`), `OwnedCreaturesApi` des `CreatureSystem`
  (`src/game/creatures/owned.ts`), die Item-Blöcke (`src/content/schema/itemBlocks.ts`), die Auslöser-Sprache (`src/content/schema/trigger.ts`), die
  registrierten Sammlungen der Orte und Beobachter mit ihren Sammeldateien, die Typdateien je Bereich (docs/SPIEL.md §16–§30, ADR-0175).

## Stränge (Vertrag Teil 4.4)

### A – Klang (Welle 1; M7-01 … M7-06, M7-31; Port 4271)
- **Exklusiv:** `src/audio/**` außer `src/audio/eventMap.ts` (Aggregation); `src/content/music/**`; `src/content/sfx/{umgebung,musik,instrumente,
  nachruestung}.ts`; `src/game/instruments/**`; `src/content/items/instrumente.ts`, `src/content/recipes/instrumente.ts`; `src/content/{chronik,
  stats,guide,wissen,vermittlung}/klang.ts`; `assets-src/sprites/icons/instrumente.ts`, `assets-src/sprites/figuren/_spieler_musik.ts`;
  `src/debug/klangScenarios.ts`; Tests `tests/unit/audio/{graph,sequencer,musik-zustand,musik-loop,umgebung,abdeckung}.test.ts`,
  `tests/unit/game/{musizieren,gluehwuermchenglas}.test.ts`, `tests/unit/save/roundtrip/instruments.test.ts`,
  `tests/integration/musik-render.test.ts`, `tests/e2e/musik.spec.ts`; `tools/validator/musik.ts`; `tools/save/fixtureM7/klang.ts`.
- **Aggregation:** `eventMap.ts` (Nachrüstung M3–M6, neue Ereignisse der Welle-1-Stränge bleiben deren Einträge), `src/content/sfx/index.ts`,
  `src/content/lights.ts` (Glühwürmchenglas), `src/content/index.ts` (Sammlungen `music`, `stingers`, `songs`, `wavetables`), `setup.ts`, `sim.ts`,
  `commands.ts`, `versions.ts`, `src/render/game/playerFigure.ts` (eine Einfügung: Clip `musizieren`), `assets-src/sprites/figuren/_spieler_sprite.ts`,
  `tools/validator/checks.ts`, `zielwerte.json` (`music`). **Nicht** `src/main.tsx`: die Musik hängt sich in `attachAudio` (`src/audio/runtime.ts`).
- **Belege:** `graph.test.ts`; Hörprobe-Protokoll (Bericht); Validator ≥ 100 SFX und Abdeckung M3–M6 = 100 % (`abdeckung.test.ts`);
  `sequencer.test.ts` (Pattern-Timing, Node-Rendering deterministisch, bitgleich zum Worker-Pfad – derselbe Code, Hash-Vergleich); ADR
  „OfflineAudioContext → eigener Synth im Worker“; E2E `musik.spec.ts` (Titelmusik am heutigen Titelbild ohne Long Task > 16 ms); `musik-zustand.test.ts`;
  Validator ≥ 5 Musikstücke, Loop-Naht (`musik-loop.test.ts` rendert nur die Takte um den Loop-Punkt; ganze Stücke in `musik-render.test.ts`);
  `umgebung.test.ts` (Donnerverzögerung, Schichtwahl); `musizieren.test.ts`, `gluehwuermchenglas.test.ts`.

### B – Orte & Welt (Welle 1; M7-07 … M7-09, M7-38 … M7-40, M7-49; Port 4272)
- **Exklusiv:** `src/game/{places,map,worldevents}/**`; `src/world/gen/places/**`; `src/content/places/**` (Typen und zod-Schemas in `schema.ts` legte
  Welle 0 an, B ergänzt) außer `index.ts` (Aggregation, Sammlungen `locationTypes`, `placeLayouts`, `placeLoot` registriert Welle 0) und den
  Dateien von C/F (`src/content/dungeons/ort.ts`, `src/content/bosses/arena.ts` liegen in deren Ordnern); `src/content/worldEvents/**`;
  `src/content/items/orte.ts`; `src/content/sfx/{orte,ereignisse}.ts`; `src/content/particles/{orte,ereignisse}.ts`; `src/content/{chronik,stats,
  guide,wissen,vermittlung}/orte.ts`; `src/render/world/worldEventsScene.ts`; `src/ui/screens/karte/**`; `src/ui/hud/ereignis/**`;
  `src/ui/hud/minimap/**` (für M7: nur Aufgedecktes, Ortsmarker); `assets-src/sprites/orte/**`, `assets-src/sprites/ui/karte*.ts`,
  `assets-src/sprites/icons/orte.ts`; `src/content/balance/{places,map,worldEvents}.ts`;
  `src/debug/orteScenarios.ts`, `src/debug/orteCommands.ts`; Tests `tests/unit/game/{orte,ereignisse,ereignisse-lumenregen,blitze,waldbrand,
  karte}*.test.ts`, `tests/unit/world/orte-*.test.ts`, `tests/unit/ui/karte*.test.ts`, `tests/unit/save/roundtrip/{places,map,world-events}.test.ts`,
  `tests/integration/orte-welt.test.ts`, `tests/e2e/karte.spec.ts`; `tools/validator/{orte,ereignisse}.ts`; `tools/save/fixtureM7/orte.ts`.
- **Aggregation:** `src/world/gen/{world,chunk}.ts` (Schritt `orte`, Stempeln, `WORLD_GEN_VERSION` 2), `src/world/calendar.ts`
  (`addDaylightModifier`), `src/content/places/index.ts`, `src/content/worldObjects.ts` (Art `ort`), `src/content/conditions.ts` (`gesegnet`),
  `src/game/gathering/system.ts` (`addDigFinds`), Schadensursache `blitz` (`src/game/survival/…`), `src/render/world/{gameScene,atmosphereScene}.ts`,
  `src/ui/focus/GameScreens.tsx`, `src/ui/hud/Hud.tsx`, die übrigen Zeilen der Tabelle §16.
- **Belege:** `orte.test.ts` (Rückkehr-Regel, Save-Roundtrip); Validator ≥ 5 bzw. ≥ 10 Ortstypen; Screenshots `ort-leuchtfeuer`, `ort-aussichtsturm`,
  `ort-gehoeft`, `ort-schrein`, `ort-uraltbaum`, `ort-buddelstelle`, `ort-eremitenhuette`, `ort-brueckenruine`, `ort-friedhof`,
  `ort-meteoritenkrater`; `ereignisse.test.ts` + Fixture-Test der Regel `ereignisse`; `ereignisse-lumenregen.test.ts`, Screenshots `lumenregen`,
  `sonnenfinsternis`; `blitze.test.ts`, `waldbrand.test.ts`, Screenshot `waldbrand`; E2E `karte.spec.ts`, Screenshot `ui-karte`; neue Hash-Snapshots
  der Weltgenerierung mit Begründung (der Integrator setzt sie, ADR-Entwurf „Generator-Version 2“).

### C – Gewölbe (Welle 2; M7-10 … M7-16, M7-18, M7-46; Port 4273)
- **Exklusiv:** `src/game/{vaults,puzzles,research}/**`; `src/world/gen/vaults/**`; `src/content/dungeons/**` (inkl. `ort.ts` = `PlaceDef`
  `gewoelbe`, Tafeln, Rätsel, Fallen, Raumvorlagen); `src/content/items/{gewoelbe,forschung}.ts`, `src/content/recipes/{gewoelbe,forschung}.ts`;
  `src/content/creatures/gewoelbe*.ts`; `src/content/sfx/{gewoelbe,raetsel,fallen}.ts`; `src/content/particles/gewoelbe.ts`;
  `src/content/{chronik,stats,guide,wissen,vermittlung}/gewoelbe.ts`; `src/render/game/vaults.ts`; `src/ui/screens/{tafel,forschung}/**`;
  `assets-src/sprites/gewoelbe/**`, `assets-src/sprites/kreaturen/{mimik_truhe,fallengeist,erbauer_konstrukt_1,wurzelhueter}.ts`,
  `assets-src/sprites/stationen/{forschungspult,kartentisch}.ts`, `assets-src/sprites/icons/gewoelbe.ts`; `src/debug/gewoelbeScenarios.ts`;
  Tests `tests/unit/world/gewoelbe-*.test.ts`, `tests/unit/game/{raetsel-*,fallen-gewoelbe,belohnungen,forschung,gewoelbe-*}.test.ts`,
  `tests/unit/save/roundtrip/vaults.test.ts`, `tests/integration/gewoelbe-welt.test.ts`; `tools/validator/gewoelbe.ts`; `tools/save/fixtureM7/gewoelbe.ts`.
- **Aggregation:** `src/world/gen/{world,chunk}.ts` (Schritt `gewoelbe`, Stempeln in Ebene −1, keine zweite Versionsänderung),
  `src/world/gen/underground/network.ts` (`reserved`), `src/content/terrain.ts` (`erbauerboden`, `erbauerstein`), `src/content/worldObjects.ts`,
  `src/content/places/index.ts`, `src/content/creatures/index.ts`, `src/content/skills.ts` (`raetsel_geloest`), Schadensursache `falle`,
  `assets-src/sprites/kreaturen/_katalog.ts`, Stationslisten, die übrigen Zeilen der Tabelle §16.
- **Belege:** `gewoelbe-grammatik.test.ts` (100 Seeds lösbar, Schlüssel vor Schloss, Vielfalt ≥ 4 Rätseltypen); Validator ≥ 20 Raumvorlagen;
  `gewoelbe-welt.test.ts` (≥ 3 Grünhain-Gewölbe je „Mittel“, 12 Glutsplitter-Plätze); Screenshots `gewoelbe-gruenhain`, `gewoelbe-fallen`;
  `raetsel-kisten.test.ts`, `raetsel-hebel.test.ts`, `raetsel-feuerschalen.test.ts`, `raetsel-waende.test.ts`, `raetsel-glocken.test.ts` (jede Variante
  per Löser); Validator ≥ 5 Rätseltypen; `fallen-gewoelbe.test.ts`; Validator-Kreaturprüfung grün, Kontaktbogen `kreaturen-m7-gewoelbe.png`;
  `belohnungen.test.ts`; `forschung.test.ts`, Validator ≥ 16 Stationen; Validator ≥ 10 Erbauer-Tafeln.

### D – Feld & Fang (Welle 1; M7-19 … M7-24; Port 4274)
- **Exklusiv:** `src/game/{farming,fishing}/**`; `src/content/{farming,fishing}/**`; `src/content/items/{feld,fang}.ts`,
  `src/content/recipes/{feld,fang}.ts`; `src/content/buildParts`-Datei `src/content/bauteileFeld.ts` (Beete, Vogelscheuche); `src/content/sfx/{feld,
  angeln}.ts`; `src/content/particles/feld.ts`; `src/content/{chronik,stats,guide,wissen,vermittlung}/feld.ts`; `src/render/game/{farming,fishing}.ts`;
  `src/ui/hud/angeln/**`; `assets-src/sprites/feld/**`, `assets-src/sprites/icons/{feld,fang}.ts`, `assets-src/sprites/stationen/kompostkiste.ts`,
  `assets-src/sprites/figuren/_spieler_angeln.ts`; `src/debug/feldScenarios.ts`; Tests `tests/unit/game/{wachstum,farm-qualitaet,obstbaeume,
  gewaechshaus,angeln,klimaprotokoll,feld-*}.test.ts`, `tests/unit/save/roundtrip/{farming,fishing}.test.ts`, `tests/integration/feld-aufholen.test.ts`;
  `tools/validator/feld.ts`; `tools/save/fixtureM7/feld.ts`.
- **Aggregation:** `src/world/climate/weather.ts` (`addPeriodListener`), `src/game/gathering/system.ts` (`onTilled`, Setzling-Wachstum im
  Objektzustand), `src/game/rooms/system.ts` (`enclosedAt`), `src/content/recipes/gruppen.ts` (`kompostgut`), `src/content/skills.ts`
  (`fisch_gefangen`), `src/content/buildPartsAlle.ts`, `src/render/game/playerFigure.ts` (eine Einfügung: Clip `angeln`),
  `assets-src/sprites/figuren/_spieler_sprite.ts`, die übrigen Zeilen der Tabelle §16.
- **Belege:** `wachstum.test.ts` (inkl. analytischem Aufholen: aktiv ≡ eingefroren + aufgeholt ≡ a → b → c, Zeitsprung über `skipTicks`);
  `farm-qualitaet.test.ts`; Validator ≥ 9 bzw. ≥ 18 Nutzpflanzen, Kontaktbögen `nutzpflanzen-1.png`, `nutzpflanzen-2.png` geprüft;
  `obstbaeume.test.ts`, `gewaechshaus.test.ts`; `angeln.test.ts`, Validator ≥ 8 Fischarten, Screenshot `angeln`.

### E – Küche & Vorrat (Welle 2; M7-25 … M7-30, M7-60; Port 4275)
- **Exklusiv:** `src/game/{meals,spoilage,water}/**`; `src/game/actions/hooks.ts`; `src/content/items/{kueche,gerichte,traenke,wasser}.ts`,
  `src/content/recipes/{kueche,gerichte,traenke,wasser}.ts`; `src/content/conditions_m7.ts`; `src/content/balance/{meals,spoilage,water}.ts`;
  `src/content/sfx/{kueche,wasser}.ts`; `src/content/particles/kueche.ts`; `src/content/{chronik,stats,guide,wissen,vermittlung}/kueche.ts`;
  `src/ui/hud/essen/**` und die Tooltip-Erweiterung als eigene Datei `src/ui/tooltip/essen.ts`; `assets-src/sprites/icons/{gerichte,traenke,kueche}.ts`,
  `assets-src/sprites/stationen/{kessel,backofen,raeucherkammer,muehle,gaerfass,kraeutertisch}.ts`, `assets-src/sprites/bau/regensammler.ts`;
  `src/debug/kuecheScenarios.ts`; Tests `tests/unit/game/{kochen,mahlzeiten,verderb,wasser,raumwirkungen,traenke}.test.ts`,
  `tests/unit/save/roundtrip/{meals,spoilage,water}.test.ts`, `tests/integration/{farm-woche,verderb-aufholen}.test.ts`; `tools/save/fixtureM7/kueche.ts`.
- **Aggregation:** `src/game/actions/{system,events}.ts` (`addEatHook`, Quellen `schlauch`/`regensammler`), `src/game/conditions/system.ts`
  (`addGroupLimit`), `src/content/conditions.ts` (Feld `gruppe`, `maxLebenPlus`/`maxAusdauerPlus`), `src/game/items/{formulas,stack}.ts`
  (`quantizeFreshness`), `src/game/inventory/ops.ts`/`system.ts` (Rundung bei `give`), die fünf Behälter-Systeme (`forEachPerishable`),
  `src/game/rooms/system.ts` (`craftTempoAt` mit Station), `src/game/crafting/system.ts` + `src/content/stations.ts` (Feld `feuer`),
  `src/game/storage/**` (Vorratsfass als Behälterart), `src/content/recipes/gruppen.ts` (Kochkategorien), die übrigen Zeilen der Tabelle §16.
- **Belege:** `kochen.test.ts`, Validator ≥ 19 Stationen; `mahlzeiten.test.ts` (inkl. Salz → Durst, höchstens 2 Effekte, Überdruss);
  Validator ≥ 22 Gerichte & Getränke, Erreichbarkeitsgraph grün (jede Zutat hat eine Quelle); Validator ≥ 8 Tränke & Medizin, ≥ 30
  Statuseffekte; `verderb.test.ts` (Faktoren, Stufen, Verdorbenes, aktiv ≡ eingefroren + aufgeholt bitgleich); `wasser.test.ts`,
  `raumwirkungen.test.ts` (Küche, Speisesaal, Lager, Eiskeller); `farm-woche.test.ts` (≤ 60 s).

### F – Boss & Leuchtfeuer (Welle 1; M7-32 … M7-37; Port 4276)
- **Exklusiv:** `src/game/{bosses,beacons,unlocks,shards,travel}/**`; `src/content/{bosses,beacons,unlocks}/**` (inkl. `bosses/arena.ts` =
  `PlaceDef` `bossarena` + Arena-Vorlage, Visionen); `src/content/items/{borkenvater,leuchtfeuer,lumen}.ts`, `src/content/recipes/{borkenvater,
  lumen}.ts`; `src/content/creatures/zweigling.ts`; `src/content/sfx/{boss,leuchtfeuer}.ts`; `src/content/particles/leuchtfeuer.ts`;
  `src/content/{chronik,stats,guide,wissen,vermittlung}/leuchtfeuer.ts`; `src/render/game/{bosses,beacons}.ts`, `src/render/world/beaconScene.ts`;
  `src/ui/screens/{vision,reisen}/**`, `src/ui/hud/boss/**`; `assets-src/sprites/bosse/**`, `assets-src/sprites/leuchtfeuer/**`,
  `assets-src/sprites/kreaturen/zweigling.ts`, `assets-src/sprites/icons/{borkenvater,lumen}.ts`, `assets-src/sprites/visionen/**`;
  `assets-src/sprites/stationen/lumen_werkbank.ts`; `src/debug/bossScenarios.ts`; Tests `tests/unit/game/{boss-framework,leuchtfeuer,
  heilungskurve,freischaltungen,schnellreise,splitter,lumen-laterne}.test.ts`, `tests/unit/tools/validator-boss.test.ts`,
  `tests/unit/save/roundtrip/{bosses,beacons,unlocks,shards,travel}.test.ts`, `tests/integration/boss-borkenvater.test.ts`; `tools/validator/boss.ts`;
  `tools/save/fixtureM7/leuchtfeuer.ts`.
- **Aggregation:** `src/game/death/{events,system}.ts` (`arena`, `addArenaSpots`), `src/game/light/**` (Verhalten `lumen`, Ladung als optionales
  Feld), `src/content/lights.ts`, `src/content/recipes/schema.ts` (`freischaltung`) + `src/game/crafting/**` (`useUnlocks`), `src/content/places/index.ts`,
  `src/content/creatures/index.ts`, `src/content/gating.ts`-Prüfung (`bronzespitzhacke` + Rezept in `recipes/borkenvater.ts`), `src/content/balance/hearth.ts`
  falls nötig, `src/render/world/{gameScene,atmosphereScene}.ts`, `src/ui/screens/tod/**` (Wiedereinstieg „Vor der Arena“, „Am Leuchtfeuer“),
  bestehende Tests `tests/unit/game/{tod,schattenbrut}.test.ts` (je ein neuer Fall), `assets-src/paletteRows.ts`, `assets-src/sprites/kreaturen/_katalog.ts`.
- **Belege:** `boss-framework.test.ts` (Zustände, Phasen, Reset, kein Treffer > 45 %, Telegraph ≥ 0,4 s), Screenshot `boss-titelkarte`,
  Fixture-Test der Regel `boss` (7 Clips ⇒ Fehler); Kontaktbogen `boss-borkenvater.png`, Screenshot `boss-borkenvater`;
  `boss-borkenvater.test.ts` (Skript-Kampf, alle Phasen, kein One-Shot), Gating-Test grün; Screenshots `leuchtfeuer-1-vorher`/`-nachher`,
  `leuchtfeuer.test.ts`, Heilungskurve monoton (`heilungskurve.test.ts`); `freischaltungen.test.ts` (LF1 spielbar), Screenshot
  `lumen-laterne-nacht`, `tod.test.ts` (Wiedereinstieg am Leuchtfeuer), `schattenbrut.test.ts` (Lichtfresser saugt Lumen); `schnellreise.test.ts`.

### G – Chronik & Führung (Welle 2; M7-41 … M7-45, M7-47, M7-48, M7-64; Port 4277)
- **Exklusiv:** `src/game/{triggers,stats,achievements,chronicle,quests,guide}/**`, `src/game/skills/perkEffects.ts`, `src/game/samples/chronik.ts`;
  `src/content/{quests,dialoge,achievements}/**`; `src/content/{chronik,stats,guide,wissen,vermittlung}/{kern,m3_m6}.ts` (Einträge der Mechaniken
  bis M6) und die Schemas `src/content/{chronik,stats,guide,vermittlung}/schema.ts` (Welle 0 angelegt, G ergänzt) – die `index.ts` daneben sind
  Aggregationsdateien (Welle 0 hat sie angelegt und registriert), die Strangdateien darin gehören ihren Strängen; `src/content/perksM7.ts`; `src/content/sfx/{chronik,funke}.ts`;
  `src/ui/screens/{chronik,perkwahl}/**`, `src/ui/hud/{aufgaben,funke}/**`; `assets-src/sprites/funke/**`, `assets-src/sprites/icons/erfolge.ts`,
  `assets-src/sprites/ui/{chronik,funke}.ts`; `src/debug/chronikScenarios.ts`; Tests `tests/unit/game/{quests,erfolge,funke,perks,ausloeser,
  statistiken,chronik-*}.test.ts`, `tests/unit/content/dialoge.test.ts`, `tests/unit/tools/validator-{vermittlung,funke}.test.ts`,
  `tests/unit/save/roundtrip/{stats,achievements,chronicle,quests,guide}.test.ts`, `tests/integration/{einstieg,progression-lf1}.test.ts`,
  `tests/e2e/chronik.spec.ts`; `tools/validator/{ausloeser,vermittlung,funke,aufgaben}.ts`; `tools/save/fixtureM7/chronik.ts`.
- **Aggregation:** `src/content/perks.ts` (`PERK_EFFECTS`, Spread), die Haken der
  Perk-Wirkungen in `gathering`, `crafting`, `stations`, `survival`, `player` (je eine Einfügung), `src/game/session.ts` (`sampleSkills`, Chronik-Sampler),
  `src/ui/hud/Hud.tsx` (Tracker über dem Rezept-Tracker, Funke), `GameScreens.tsx`, Einstellungs-Anbindung `guide.configure` (Aufruf aus der UI
  beim Start und bei Änderung von `game.hints`/`game.funkeComments`, H stellt den Einstellungs-Signalweg).
- **Belege:** E2E `chronik.spec.ts` (jeder Reiter), Screenshots `ui-chronik-aufgaben`, `-bestiarium`, `-herbarium`, `-wissen`, `-rezepte`,
  `-statistik`, `-erfolge`; `quests.test.ts`, Save-Roundtrip, `dialoge.test.ts` (fehlender EN-Text ⇒ Fehler); `einstieg.test.ts` (Zielkette im
  Tag-1-Szenario, `tests/integration/tag1-spieler.ts`); `funke.test.ts` (Frequenz, Zeilenlimit, Ankündigung registrierter Ereignisse),
  Screenshot `funke`; Fixture-Test `vermittlung`, Liste der Mechaniken bis M7 im Bericht; Validator ≥ 15 Erfolge, `erfolge.test.ts`;
  Validator ≥ 60 Perks, `perks.test.ts`, Screenshot `ui-perkwahl`; `progression-lf1.test.ts`, Pacing-Messwerte (Integrator trägt sie in
  `docs/BALANCE.md` ein).

### H – Menüs & Speichern (Welle 1; M7-50, M7-51, M7-55 … M7-59; Port 4278)
- **Exklusiv:** `src/main.tsx`, `src/ui/App.tsx`, `src/ui/TitleCard.tsx`, `src/ui/menu/**`, `src/ui/screens/{hauptmenue,weltauswahl,neue-welt,
  laden,einstellungen}/**`, `src/ui/screens/pause/**`; `src/engine/settings.ts` (+ Migration auf `SETTINGS_VERSION` 2); `src/save/**` außer
  `src/save/versions.ts` (Aggregation); `src/save/save.worker.ts`; `src/game/worldsettings/**`; `src/content/balance/difficulty.ts`;
  `src/content/tipps.ts`; `src/render/world/menuScene.ts`; `src/debug/saveLoad.ts`; `vite.config.ts` (PWA), `public/manifest*`, `assets-src/icons-app/**`;
  `src/debug/menueScenarios.ts`; Tests `tests/unit/game/schwierigkeit.test.ts`, `tests/unit/save/{autosave,slots,export}*.test.ts`,
  `tests/unit/settings/**`, `tests/unit/ui/{menue,einstellungen,neue-welt}*.test.ts`, `tests/unit/save/roundtrip/world-settings.test.ts`,
  `tests/e2e/{einstellungen-grafik,einstellungen,autosave,export-import,pwa}.spec.ts`; `tools/save/fixtureM7/welt.ts`.
- **Aggregation:** `src/game/sim.ts` (`resourceDensity`), `src/world/gen/{world,resources}.ts` (Dichte), `src/game/survival/**` und
  `src/game/creatures/**` (Faktoren über `WorldSettingsApi`, Spawnsperre Friedlich), `src/game/death/system.ts` (nur lesen/delegieren),
  `package.json` (Abhängigkeit `vite-plugin-pwa` – **nur der Integrator installiert**, ADR-0002/-0003), die übrigen Zeilen der Tabelle §16.
- **Belege:** Screenshots `ui-hauptmenue`, `ui-weltauswahl`, `ui-laden`; `schwierigkeit.test.ts`, Screenshot `ui-neue-welt`; E2E
  `einstellungen-grafik.spec.ts` (Werte bleiben, FPS-Limit wirkt), ADR „VSync → FPS-Limit an Bildwiederholrate“; E2E `einstellungen.spec.ts`,
  Screenshot `ui-einstellungen`; `autosave.test.ts` (Rotation, Korruptions-Fixture ⇒ Wiederherstellung), E2E Autosave ohne Long Task > 16 ms;
  E2E Export → Import ⇒ identischer Zustands-Hash; E2E `pwa.spec.ts` (Offline-Start).

### I – Figur & Kreaturen (Welle 2; M7-17, M7-52 … M7-54, Schmuck und Deko aus M7-62; Port 4279)
- **Exklusiv:** `src/game/appearance/**`; `src/content/appearance/**`; `src/content/creatures/elites*.ts`; `src/content/items/{schmuck_m7,deko_m7}.ts`,
  `src/content/recipes/{schmuck_m7,deko_m7}.ts`, `src/content/bauteileDeko.ts`; `src/ui/screens/charakter/**`; `src/render/game/playerFigure.ts`
  (Welle 2 exklusiv; A und D haben in Welle 1 je eine Zeile eingefügt); `assets-src/sprites/figuren/**`, `assets-src/sprites/frisuren/**`,
  `assets-src/sprites/kreaturen/{graufang,alter_hauer}.ts`, `assets-src/sprites/deko/m7*.ts`, `assets-src/sprites/icons/{schmuck_m7,deko_m7}.ts`;
  `src/debug/figurScenarios.ts`; Tests `tests/unit/assets/{koerperformen,frisuren}.test.ts`, `tests/unit/game/{aussehen,elites}*.test.ts`,
  `tests/unit/save/roundtrip/appearance.test.ts`, `tests/e2e/charakter.spec.ts`; `tools/save/fixtureM7/figur.ts`.
- **Aggregation:** `assets-src/paletteRows.ts` (`haut_*`, `haar_*`, `kleid_*`), `src/content/creatures/index.ts` (+ Elite-Spawnregel je Biom),
  `assets-src/sprites/kreaturen/_katalog.ts`, `src/content/buildPartsAlle.ts`, H's Neue-Welt-Ablauf (`src/ui/menu/ablauf.ts`: Schritt „Charakter“),
  `zielwerte.json` (`elites`, `jewelry`), die übrigen Zeilen der Tabelle §16.
- **Belege:** Validator ≥ 2 Elites, Screenshots `elite-graufang`, `elite-alter-hauer`; E2E `charakter.spec.ts`, Screenshot `ui-charakter`,
  Save-Roundtrip Aussehen; Kontaktbogen `koerperformen.png` gegen §4.5, Unit-Test Sockel-Mapping; Kontaktbogen `frisuren.png`, Validator
  12 Frisuren; Kontaktbogen `deko-m7.png`; Validator ≥ 5 Schmuck.

## Nicht zugeordnete Tasks (M7-65 … M7-71)

Die Folgeaufgaben aus dem M6-Gate (M7-65 Wasserlinie je Kreatur, M7-66 Palettenzeile `brut_finster`, M7-67 Beschwipst `schadensresistenz`,
M7-68 Aktionstempo für Sammeln/Handwerk/Essen/Zerlegen/Fallen, M7-69 Betäubung an der Spielfigur, M7-70 Taumeln ohne Zustand, M7-71
Frost-Palettenzeile) gehören keinem Strang: der Integrator teilt sie zu (Vorschlag: M7-65, M7-66, M7-69, M7-70, M7-71 zu I, weil sie
Kreatur- und Figurendarstellung samt Palettenzeilen berühren; M7-67, M7-68 in Welle 3) – bis dahin fasst kein Strang ihre Dateien dafür an.
