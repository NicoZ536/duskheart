# SPIEL – Verträge für Spielsysteme (ab M3)

Ergänzt MASTERPROMPT §11–§31, docs/ARCHITEKTUR.md und docs/WORLD.md. Änderungen nur per ADR.

## 1. Modulaufteilung (parallel bearbeitbar)
- Jedes Spielsystem lebt in `src/game/<bereich>/` (z. B. `items/`, `inventory/`, `player/`, `survival/`, `gathering/`, `crafting/`, `light/`, `conditions/`, `skills/`, `sleep/`, `death/`; ab M4 `stations/`, `repair/`, `building/`, `rooms/`, `storage/`, `hearth/`, `fire/`, `blueprints/`; ab M6 `combat/`, `creatures/`) mit eigenem `commands.ts`, `events.ts`, `system.ts` und reinen Formeln in `formulas.ts`.
- `src/game/commands.ts` und `src/game/sim.ts` (`SimEventMap`) **aggregieren** nur: je Bereich ein Import und ein Eintrag (Schema-Liste bzw. Event-Typen). Änderungen dort sind kleine, gezielte Einfügungen – Datei unmittelbar vor dem Bearbeiten neu lesen.
- `src/game/setup.ts` registriert alle Systeme in fester Reihenfolge (Liste mit Kommentar je System).
- Balancewerte: `src/content/balance.ts` bleibt die zentrale Stelle; neue Gruppen als eigene Module `src/content/balance/<gruppe>.ts`, die `balance.ts` einbindet und re-exportiert (ein Import + ein Feld je Gruppe). Jeder Wert mit Einheit + Begründung.

## 2. Items (§13, §2.2)
- Content in `src/content/items/<gruppe>.ts` (z. B. `rohstoffe.ts`, `werkzeuge.ts`, `nahrung.ts`), jede Datei eine zod-validierte Collection, registriert in `src/content/index.ts` mit Kategorie für den Zählbericht (`items` zählt alle; zusätzlich `weapons`, `armor`, `jewelry`, `dishes`, `potions`, `buildParts` …).
- `ItemDef`: `id` (snake_case), `kategorie`, `stufe` (0–7), `raritaet`, `stapel` (§13.1: Rohstoffe 100, Barren 50, Nahrung 20, Munition 200, Werkzeug/Waffe/Rüstung 1), optional `haltbarkeit`, `werte`, `frische` (Haltbarkeit in Tagen), `brennwert` (s, §15.4), `tauschwert`, `quellen` (deklarierte Quellen: `welt:<objektId>`, `drop:<kreaturId>`, `rezept:<rezeptId>`, `haendlerin`, `bauplan:<id>` …), `name`/`beschreibung` (LocalizedText), `sounds` (SFX-IDs). **Verwendungen werden automatisch berechnet** (Rezepte, Baukosten, Brennstoff …).
- Icon-Konvention: Sprite `icon_<itemId>` (16×16); Welt-Drop nutzt dasselbe Icon. Der Validator verlangt für jedes Item ein existierendes Icon.
- Laufzeit: `ItemStack = { item: string; count; haltbarkeit?; qualitaet? (1–3); frische? (0–100); daten? }`; Operationen rein funktional getestet (`src/game/inventory/`).
- **Platz-Adressierung** (`SlotRef = { bereich, index }`, `src/game/items/slots.ts`): `inventar` (30), `schnellleiste` (10; `auswahl` = der Platz in der Hand), `rucksack` (1, der getragene Rucksack), `rucksackfach` (8/16/24 je Rucksack), `ausruestung` (8 in der Reihenfolge `EQUIPMENT_SLOTS`: kopf, brust, beine, fuesse, ruecken, nebenhand, schmuck1, schmuck2), `guertel` (3). Inventar und Ausrüstung teilen eine `PlayerBags`-Instanz; jeder Command adressiert Plätze so (ADR-0028).
- **Quellen und Verwendungen** werden aus dem Content abgeleitet (`buildItemIndex`: Welt-Drops, Rezepte, Zutatengruppen, Stationen, Bauteile, eigene Daten, Klassifikation `src/content/items/relations.ts`: ein Stationsdatensatz macht sein Item zur `station`, ein Gruppenmitglied ist `zutat`, ein Bauteil-Datensatz kostet sein Item beim Platzieren – `baukosten`). Ein Item, dessen erste Verwendung erst ein späterer Task liefert, steht mit Task und Zweck in `tools/validator/verwendungen-geplant.ts`; ein Item, das erst eine spätere Stufe erreichbar macht, in `tools/validator/reachability-geplant.ts`. Beide Listen erzwingt der Validator in beide Richtungen (ADR-0029).
- **Rezepte** (`src/content/recipes/`, Sammlung `recipes`): Zutaten konkret (`{item, anzahl}`) oder als **Zutatengruppe** (`{gruppe, anzahl}`, Sammlung `ingredientGroups`, `src/content/recipes/gruppen.ts`; heute `bauholz` = `holz` oder `treibholz`) – jedes Mitglied genügt, eine Herstellung darf mischen. Der Validator zählt eine Gruppe als erreichbar, sobald ein Mitglied erreichbar ist, und gibt ihr die niedrigste Stufe ihrer Mitglieder (ADR-0039). `station` ist ein Datensatz der Sammlung `stations` (`src/content/stations.ts`, Linie und Stufe), `aufwerten` ersetzt die Station, an der das Rezept entsteht, durch ihre nächste Stufe.
- Die eigene Kleidung des Schiffbrüchigen (Leinentunika, Leinenhose; Figuren-Layer `ausruestung_leinentunika`/`_leinenhose`) ist kein Item: immer getragen, Isolation 4 + 2 °C als Einflussquelle (`BALANCE.survival.temperature.ownClothing`, ADR-0028).

## 3. Spieler & Entitäten
- Genau ein Spieler-Entity (`sim.player`, `player.spawn`), Komponenten: Position (Motion), `player` (Körper: Ebene, Stufe, Blickrichtung `facing`, Bewegungsmodus, **eigene Geschwindigkeit** – die Motion-`velocity` bewegt ohne Kollision und bleibt Debug-Figuren vorbehalten), `vitals` (§11.1). Taschen und Ausrüstung (`inventory`/`equipment`), Zustände, Furcht, Schlaf, Aktionen, Fertigkeiten und Tod halten ihren Zustand in ihren Systemen (je ein Speicherteilnehmer), das getragene Licht im Zustand des Lichtsystems (kein `lightSource`-Bauteil), der Zielpunkt (`player.aim`) in der Interaktion.
- Welt-Objekte (Bäume, Felsen, Erze, Pflanzen) bleiben Chunk-Daten (`object` + `objectState`); nur bewegliche/aktive Dinge (Drops, Kreaturen, Projektile, Lichter) sind ECS-Entitäten.
- Befehle vom Spieler (je im Bereichsmodul definiert, `src/game/commands.ts` aggregiert):
  - Körper: `player.spawn {tx?,ty?,layer?}`, `player.move {dx,dy}`, `player.sprint {on}`, `player.sneak {on}`, `player.roll {dx,dy}`; Debug `player.teleport {x,y,layer}`.
  - Taschen: `inventory.move {from,to,count?}`, `inventory.split {from,to?}`, `inventory.collect {at}`, `inventory.sort`, `inventory.quickMove {from}`, `inventory.discard {from,count?}`, `player.selectHotbar {index}` (1–0), `player.scrollHotbar {delta}` (Mausrad); Debug `inventory.give {item,count,qualitaet?,frische?,haltbarkeit?}` (`haltbarkeit`: abgenutzte Stücke, 0 … volle Haltbarkeit der Güte, nur Items mit Haltbarkeit – sonst `noDurability`/`durabilityTooHigh`; Konsole `give <item> [n] haltbarkeit=<w>`, M5-38).
  - Interaktion: `player.interact {on,tx?,ty?}` (E halten/loslassen), `player.aim {x?,y?}` (Maus). E wirkt auf Drops (aufheben), Welt-Objekte und Tiles (ernten, fällen, abbauen, graben) und **Nutzungsziele** (`src/game/interaction/uses.ts`): Lagerfeuer (nachlegen, entzünden), aufgestellte Fackel (nehmen), Wasser voraus (trinken), Baumstumpf (sitzen, aufstehen), Grab (bergen), Schlafplatz (schlafen), Kiste (öffnen), Herdfeuer (öffnen, auch kalt mit Brennstoff – entzündet wird im Bildschirm mit `hearth.ignite`), Station (benutzen: `station.use`), Tür und Tor (öffnen/schließen: `build.door`, nicht aus dem Türrahmen), Stuhl und Bank (sitzen, aufstehen), Bett und Grasbett (schlafen ab 19 Uhr, setzt den Wiedereinstieg), Blaupause (fertigstellen mit dem Hammer in der Hand: `build.complete`; ADR-0043), gegrabene Kachel mit Erde in der Hand (zuschütten, vor dem Trinken; ADR-0042) – das zuständige System führt es über seinen Command aus; ein Druck nutzt genau ein Ziel (ADR-0028).
  - Benutzen: `player.useItem {slot?, tx?, ty?}` – ohne Platz die Hand (Primärtaste): Essen, Verband, Eimer ausgießen, Fackel/Lagerfeuer aufstellen, mit Erde einen Graben am Zielpunkt zuschütten (M4-40); leere Hand und Werkzeuge ohne eigene Nutzung tun nichts (die Primärtaste der Werkzeuge und Waffen ist der Schlag im Kampf, M6).
  - Aktionen: `action.eat {from}`, `action.useBelt {index?}` (Q), `action.drink {tx,ty}`, `action.sit {tx,ty}`, `action.stand`, `action.throw {from,x,y}`, `action.cancel` (Gegenstände für Debug und Tests: `inventory.give`).
  - Licht: `light.toggle` (F), `light.place {from,tx,ty}`, `light.fuel {light,from,count?}`, `light.ignite {tx,ty}`, `light.douse {light}`, `light.take {light}`.
  - Handwerk: `craft.start {recipe,count}` (bis 100 Stück je Auftrag, Warteschlange 10; an einer Station in Reichweite oder ohne Station), `craft.cancel {index}` (erstattet vollständig), `craft.useChests {on}` (Zutaten zuerst aus den Taschen, dann aus Kisten im Umkreis 8; M4-02), `craft.pin {recipe,on}` (höchstens 3 sichtbare Rezepte anheften, das älteste weicht; M4-08).
  - Stationen (M4-03 … M4-06, `src/game/stations/`): `station.place {from,tx,ty,mirror?}` (das Stations-Item eines Platzes aufstellen, mit `mirror` gespiegelt), `station.remove {station}` (in den ersten 30 s nach dem Aufstellen das ganze Item, danach 60 % der Materialien aller Stufen wie bei Bauteilen; abgelehnt, solange an ihr ein Auftrag läuft: `inUse`), `station.use {station}` (öffnen), `station.put {station,from,bereich,count?}` (`bereich` = `eingang` | `brennstoff`), `station.take {station,bereich,index,count?}` (auch `ausgang`), `station.takeAll {station}`. Ein brennendes Lagerfeuer des Lichtsystems zählt als Station `lagerfeuer`; Werkbank I → II wertet ein Rezept an Ort und Stelle auf (einzeln, nur an Werkbank I; Werkbank II entsteht nie als Item: `nurAufwerten`).
  - Reparatur (M4-09): `repair.item {slot}` an Werkbank, Amboss oder Schleifstein in Reichweite (anteilige Materialkosten, auch aus Kisten).
  - Bauen (M4-11 … M4-25, `src/game/building/`, Abschnitt 9): `build.place {part,tx,ty,rot?,mirror?}`, `build.blueprint {part,tx,ty,rot?,mirror?}`, `build.complete {tx,ty,ebene?}` (Blaupause mit dem Hammer fertigstellen), `build.remove {tx,ty,ebene?}`, `build.upgrade {tx,ty,part}` (an Ort und Stelle), `build.door {tx,ty,open?}`, `build.repair {tx0,ty0,tx1,ty1}` (Flächenreparatur).
  - Lagerung (M4-21, `src/game/storage/`): `storage.open {chest}`, `storage.close {chest}`, `storage.put {chest,from,count?}`, `storage.take {chest,index,count?}`, `storage.takeAll {chest}`, `storage.storeAll {chest}` („Alles einlagern“ ohne Schnellleiste), `storage.sort {chest}`, `storage.rename {chest,name}`, `storage.label {chest,item?}` (Icon-Etikett), `storage.quickStash` (Schnellablage in passende Kisten im Umkreis 10).
  - Herdfeuer (M4-20, `src/game/hearth/`): `hearth.use {hearth}` (öffnen), `hearth.fuel {hearth,from,count?}`, `hearth.take {hearth,index,count?}`, `hearth.ignite {hearth}`, `hearth.douse {hearth}`, `hearth.core {hearth,from}`, `hearth.uncore {hearth,index}` (Glutkern-Nischen).
  - Feuer (M4-28, `src/game/fire/`): im Spiel setzt `light.ignite` mit der Fackel Brennbares in Brand; Debug `fire.ignite {tx,ty,layer?}`.
  - Leben: `sleep.start {tx?,ty?}`, `sleep.wake`, `skills.choosePerk {skill,level,choice}`, `death.respawn {at?}`, `death.lootGrave {grave}`; Debug `conditions.apply {id,seconds?}`, `conditions.cure {id}`, `fear.set {value}`, `death.kill`.
  - Kreaturen (M6, `src/game/creatures/`): `carcass.carve {carcass}` (E mit Messer), `trap.place {from,tx,ty}`, `trap.take {trap}`; Debug `creature.spawn {creature,count,x?,y?,layer?,finster?}` (ohne Ort vor dem Spieler; Rudeltiere zusammen als Rudel; `finster`: Schattenbrut wie in einer Finstermondnacht, stärker und gekennzeichnet – für das Bild `schattenbrut-finstermond`), `creature.kill {radius}` (Kacheln um den Spieler; Konsole `spawn`, `kill <radius>`).
  - Cheats der Debug-Konsole (`src/game/cheats/`, M3-35): `debug.god {on}` (kein Schaden am Spieler), `debug.noclip {on}` (Bewegung durch Wände, Klippen, Bäume und tiefes Wasser, ohne zu schwimmen), `debug.unlock {skill?}` (Grundform: jede Fertigkeit oder eine auf die höchste Stufe, Talentwahlen offen); die Schalter speichert der Teilnehmer `cheats` (ADR-0034).
- **Wer tot ist oder schläft, handelt nicht** (`PlayerSystem.incapacity`: `dead` bei 0 Leben, `asleep` vom Schlafsystem; ADR-0035): Interaktion (kein Fokus, E abgelehnt), `player.useItem`, `light.*`, `craft.start` lehnen mit dem Grund ab, die Handwerks-Warteschlange ruht, der Drop-Magnet zieht nicht. Eine Bewegungstaste weckt. Wer schwimmt, darf das Wasser trinken, in dem er schwimmt; essen, sitzen und werfen nicht.
- Ereignisse (je Bereich `events.ts`, `SimEventMap` aggregiert) sind die Rückmeldung jeder Aktion (§2.7): Bild, Ton (`src/audio/eventMap.ts` ordnet jedes Ereignis einem Klang zu oder begründet Stille) und Meldungen lesen dieselben Ereignisse; abgelehnte Commands melden `commandRejected {type, reason}`.
- Kopplung der Systeme in `createSimulation` (Reihenfolge docs/ARCHITEKTUR.md „Simulation“): `PlayerInfluences` sammelt Einflussquellen (Kleidung, Ausrüstung, Zustände, Schlaf, Sitzen, Tod, Arbeit) und Wärmequellen (Lagerfeuer); `WorldCollision` meldet Tile-Änderungen an Zuhörer (Lichtkarte); Fertigkeiten erhalten die EP von Sammeln und Handwerk und liefern den Skill-Bonus; Baumstümpfe sind Sitzplätze; beim Sterben gibt der Handwerks-Auftrag seine reservierten Zutaten zurück, damit sie ins Grab gehen. Ab M4: brennende Lagerfeuer sind Stationen des Handwerks; Bauraster, Stationen und Lichter teilen keine Kachel (Belegungs-Anbieter); das Bauraster liefert eine Kollisionsebene, Dächer schützen Fackeln vor Regen, Leitern und Treppen tragen den Spieler; Räume bekommen Wärmequellen (Feuer, Herdfeuer, Brände) und Möbel (Stationen, stehende Lichter) und liefern Einflussquelle (Raumtemperatur), Furchtabbau, Schlafplätze und das Werkstatt-Tempo; Stühle sind Sitzplätze; Kisten sind Vorräte des Handwerks und der Blaupausen; Herdfeuer sind Basen (Suchbereich der Kisten, kein Nachwachsen gefällter Bäume in der Basis), Wärme-, Licht- und Wiedereinstiegspunkte; Brände sind Brennbares der Fackel, Licht, Wärme und Zustand „Brennen“; ein Bett, das den Wiedereinstiegspunkt setzte, nimmt ihn beim Abbauen mit.

## 4. Gameplay-Licht (§12)
- Lichtquellen sind Simulationsdaten (`src/game/light/`): Liste `SimLightSource` = die Felder des kanonischen Lichts der Engine (`id`, `x`, `y`, `height`, `radius`, `intensity`, `flicker`, `seed`, `coneDirection`, `coneAngle`, `src/engine/lightFalloff.ts`) plus `layer`, `kind` (Lichtart, `src/content/lights.ts`), `farbe` (Palettenreferenz), `mount` (`hand`, `guertel`, `stand`, `wand`, `boden`) und `brenndauer` [s]. Der Renderer liest **dieselbe** Liste (Präsentationsbrücke wandelt in `LightInstance`), die Gameplay-Lichtkarte (CPU pro Tile, Tile-Raycast-Verdeckung, gecacht) nutzt `src/engine/lightFalloff.ts` – identische Formel wie der Shader. Die Furcht liest die Lichtstufen der Lichtkarte (`src/world/lightmap/stages.ts`, `BALANCE.light.map.stages` – eine Definition).

- **Möbellichter und Regen (M4, ADR-0043):** Harzlampen (Stand und Wand), Laternen und der Steinkamin sind Lichtarten aus `MOEBEL_LICHTER`, angelegt beim Aufstellen über das Bauraster. Lampen brennen nur Harz (4 Klumpen à 6 Spielstunden), offene brennen im Regen doppelt so schnell, Laternen hinter Glas nicht; der Kamin ist ein Feuer mit Vorrat 720 s, Licht 6 und Wärme 15 °C fürs Raumklima. Regen ab 0,3 (nicht Nieselregen) löscht Lagerfeuer und Kamine ohne Dach im nächsten Welt-Tick (Brennstoff bleibt), Anzünden im Regen wird abgelehnt; Fackeln folgen §10 (Regen halbiert die Brenndauer, Starkregen löscht mit 5 % je Minute).

## 5. Präsentation
- HUD/Inventar/Menüs: Preact in `src/ui/screens/<name>/` und `src/ui/hud/`, liest nur Bridge-Signals und die lesenden Abtastungen der Sitzung (`sample…`, `mapChunk`, `startBeach` – nie `session.sim`, ESLint, ADR-0035), schreibt nur Commands. Alle Texte als i18n-Schlüssel (`ui.<bereich>.<…>`).
- Figuren-Animation: Spieler-Sprites `spieler_<teil>` mit Clips `<aktion>_<richtung>` (down/up/left/right), Ausrüstungs-Layer `ausruestung_<itemId>` an Hand-Sockeln.
- Zustands-Icons: `zustand_<zustandId>`; SFX-IDs `sfx_<bereich>_<name>`.

## 6. Kanonische IDs M3 (verbindlich für parallele Arbeit)
- **Rohstoffe T0 (M3-04)**: `holz`, `zweig`, `rinde`, `harz`, `laub`, `stein`, `feuerstein`, `kies`, `sand`, `lehm`, `erde`, `kupfererz`, `zinnerz`, `salpeter`, `fasern`, `himbeeren`, `blaubeeren`, `walderdbeeren`, `steinpilz`, `pfifferling`, `fliegenpilz`, `leuchtpilz`, `schafgarbe`, `wegerich`, `baerlauch`, `apfel`, `kirsche`, `birne`, `walnuss`, `salz`, `muschel`, `tang`, `treibholz`, `setzling_eiche`, `setzling_birke`, `setzling_buche`, `setzling_kiefer`, `setzling_weide`, `setzling_apfelbaum`, `setzling_kirschbaum`, `setzling_birnbaum`, `setzling_walnussbaum`, `blume_rot`, `blume_blau`, `blume_gelb`.
- **Werkzeuge T0 (M3-15)**: `steinaxt`, `steinspitzhacke`, `steinschaufel`, `steinhacke`, `steinsichel`, `steinhammer`, `steinmesser`, `holzeimer`, `holzeimer_wasser`.
- **Grundlagen ohne Station (M3-16)**: `faserseil`, `fackel`, `lagerfeuer`, `werkbank`, `verband`, `grasbett`, `steinspeer`; Rezepte `rezept_<itemId>` für Faserseil, alle Steinwerkzeuge, Holzeimer, Fackel, Lagerfeuer, Werkbank, Verband, Grasbett, Steinspeer.
- **Zustände (M3-19)**: `blutung`, `vergiftung`, `lebensmittelvergiftung`, `fieber`, `brennen`, `durchnaesst`, `frierend`, `unterkuehlt`, `erfrierend`, `erhitzt`, `ueberhitzt`, `hitzschlag`, `muede`, `erschoepft`, `verlangsamt`, `betaeubt`, `geblendet`, `knochenbruch`, `wohlgenaehrt`, `ausgeruht`, `behaglich`, `erleuchtet`, `morgenrot`, `nachtsicht`, `beschwipst`, `erschuettert`, `hungrig`, `verhungernd`, `durstig`, `verdurstend`, `ertrinkend`; seit M7 `gesegnet` (Segen des Schreins, M7-08, §18) – Icons `zustand_<id>`.
- **Welt-Drops** (Welt-Objekte → Items, in `src/content/worldObjects.ts` als `drops`): Laubbäume → `holz`, `zweig`, `rinde`, `laub`, Kiefer/Tanne → zusätzlich `harz`, Obstbäume saisonal → Früchte, Stumpf roden → `holz`/`harz` + 40 % Setzling; Felsen → `stein`, `feuerstein`, `kies`; Erzknoten → `<erz>erz`; Pflanzen/Büsche → Beeren, Pilze, Kräuter, Fasern, Blumen; Strand/Salzküste → `muschel`, `tang`, `treibholz`, `salz` (Salzkruste).

## 7. Speichern (M3-34, §28)
- Jedes System mit Zustand ist genau ein Speicherteilnehmer mit Datenversion und Migrationen (docs/ARCHITEKTUR.md „Speichern-Registry“) und einem Roundtrip-Test `tests/unit/save/roundtrip/<id>.test.ts`. Der Spieler steckt in `player` (Position, Körper), `vitals`, `conditions`, `inventory`, `equipment`, `skills`, `death` (Gräber, Wiedereinstiegspunkt, Schwierigkeit – bis M7-51 sie in die Welteinstellungen holt), dazu `fear`, `sleep`, `actions`, `light`, `crafting`, `drops`, `gathering`, `interaction`; die Basis ab M4 in `stations` (Stationen mit Plätzen, Chargen und Fortschritt), `building` (Bauraster: Bauteile, Blaupausen, Türen, Trefferpunkte – je Chunk, mit String-Ids der Teile), `storage` (Kisten mit Name, Etikett, Plätzen), `hearth` (Herdfeuer mit Vorrat und Glutkernen), `fire` (brennende Kacheln samt Klimaverlauf zum Aufholen). Räume haben keinen Teilnehmer: sie werden aus Bauten und Terrain neu berechnet.
- **Save-Version** (`src/save/versions.ts`): benennt die Teilnehmer, die ein Build schreibt, mit ihren Datenversionen; 1 = M3, **2 = M4** (die Teilnehmer von 1 unverändert, dazu `stations`, `building`, `storage`, `hearth`, `fire` je Version 1; `crafting` bleibt 1 und speichert die Nadeln als optionales Feld `angeheftet`, ADR-0038, ADR-0045). Ein später hinzugekommener Teilnehmer beginnt in einem älteren Spielstand genau so leer wie in einer neuen Welt (Migration von 0). Ändert ein Meilenstein gespeicherte Daten, kommt die nächste Version dazu (M6-36 …) – samt Migrationen und Referenzspielstand.
- **Referenzspielstände** `tests/fixtures/saves/v<n>.json` (`npm run fixture:save`, `tools/save/fixture.ts`): ein festes Szenario (Tod mit Grab, neue Taschen mit Ausrüstung und Gürtel, brennende Fackel, Handwerks-Auftrag, gegrabenes Tile, brennendes Lagerfeuer, geworfener Stein, Zustand, Furcht; ab v2 eine Basis: Holzhaus mit Tür und Strohdach, benannte Kiste, Werkbank mit Aufträgen, Trockengestell mit Charge, brennendes Herdfeuer, Blaupause, brennende Palisade) als Welt-Dump (`src/save/dump.ts`) plus die Fakten des Spielers und der Basis (`baseFacts`, Räume als abgeleitete `roomFacts`); ältere Versionen sind eingefroren. `tests/unit/save/migrationen.test.ts` lädt jeden in den aktuellen Build und verlangt dieselben Fakten (ADR-0030).

## 8. Kanonische IDs M4 (verbindlich für parallele Arbeit)
- **Stationen T0 (M4-05)**: `lagerfeuer` (als Station), `werkbank` (Werkbank I), `saegebock`, `steinmetzbank`, `trockengestell`, `koehlermeiler`, `lehmofen`. **T1 (M4-06)**: `werkbank_2` (Werkzeugwand/Hobelbank), `schmelzofen`, `amboss_bronze`, `schleifstein`, `spinnrad`. Stationsstufen über `stufe` am Stationsdatensatz; Aufwertung Werkbank I → II ist ein Rezept an der Station.
- **Stationen der Rüstkammer (M6-12, M6-31; T0, je eigene Linie, Stufe 1)**: `webstuhl` (Handwerk: `fasergewebe` aus Fasern), `schneidertisch` (Handwerk: Fasergewand, Lederrüstung, `lederrucksack`), `gerbrahmen` (Verarbeitung ohne Brennstoff, läuft unbeaufsichtigt: `leder` aus `fell` und `rinde`). Mit ihnen 15 Stationen; Rüstungssets in §14.
- **Verarbeitungsprodukte T0–T1**: `holzkohle`, `brett`, `balken`, `steinblock`, `ziegel_roh`, `ziegel`, `keramik_topf`, `glas`, `kupferbarren`, `zinnbarren`, `bronzebarren`, `garn`, `dachschindel`, `strohbuendel`, `nagel_bronze`, `lehmputz`.
- **Bauteile (M4-12)**: Wände `wand_palisade`, `wand_holz`, `wand_fachwerk`, `wand_stein`; Böden `boden_holz`, `boden_stein`, `boden_lehm`; Dächer `dach_stroh`, `dach_schindel`, `dach_glas`; Türen `tuer_holz`, `tuer_verstaerkt`, `tor_holz`, `falltuer_holz`; Fenster `fenster_offen`, `fenster_glas`, `fenster_buntglas`; Säulen `saeule_holz`, `saeule_stein`; Zäune `zaun_holz`, `zaun_stein`; `leiter_holz`, `treppe_holz`, `steg_holz`.
- **Lagerung (M4-21)**: `kiste_holz` (16), `truhe` (24), `lagerregal` (48, nur Rohstoffe).
- **Herdfeuer (M4-20)**: `herdfeuer`; Glutkern-Items `glutkern_1` … `glutkern_6` (Quelle je Leuchtfeuer, ab M7).
- **Möbel, Deko, Wandobjekte, Lichter T0–T1 (M4-19)**: `holzbett`, `strohbett`, `tisch_holz`, `stuhl_holz`, `hocker_holz`, `bank_holz`, `schrank_holz`, `regal_wand`, `kleiderhaken`, `kamin_stein`, `harzlampe`, `harzlampe_wand`, `laternenpfahl`, `blumentopf`, `vase_keramik`, `teppich_stroh`, `vorhang_leinen`, `bild_landschaft`, `wandschild`, `fass_holz`, `kiste_deko`, `topfpflanze`, `truhe_deko`, `trophaeenbrett`, `hirschgeweih_wand` (Quelle M6), `spiegel_wand`, `uhr_sonne` (Sonnenuhr), `vogelhaus`, `holzstapel`, `werkzeugwand_deko`, `tischdecke`, `kerzenstaender` (Kerzen ab M8), `weinregal`, `buecherregal`, `schreibpult`, `wiege`, `schaukelstuhl`, `truhenbank`, `pflanzkuebel`, `steinbrunnen_deko`, `gartenbank`, `wegweiser`, `laterne_stehend`, `kranz_tuer`, `fahne_wand`.
- **Weitere Möbel und Deko (M4-19, über die Liste hinaus, für Behaglichkeit und Raumtypen)**: `sitzkissen`, `nachttisch`, `kommode`, `wandteppich`, `blumenampel`, `schaukelpferd`, `waschzuber`.
- **Zu den Möbeln (ADR-0040)**: Aus der Liste oben kommen `hirschgeweih_wand` (Geweih von der Jagd, M6) und `kerzenstaender` (Kerzen aus Wachs, M8-43) erst mit ihren Quellen; `tischdecke` ist ein gedeckter Tisch (das Rezept verbraucht einen `tisch_holz`), `kiste_deko`, `truhe_deko` und `fass_holz` sind Deko ohne Inhalt (Kategorie `deko`, keine Lagerräume; ADR-0040).
- Sprites: Bauteile modular `bau_<id>` (Wände mit Autoverbindung 16-Masken-Set, Türen `offen`/`zu`, Dachkanten; das Tor in Nord-Süd-Wänden `bau_<id>_seite`, die offene Falltür `bau_<id>_klappe`), Möbel/Deko/Kisten/Herdfeuer (Bauteile der Art `moebel`/`wandmoebel`) und Stationen `obj_<id>`, Icons wie bisher `icon_<id>`. Die Namen bilden `buildPartSpriteId`/`buildPartSecondSpriteId` (`src/content/buildParts.ts`) und `stationSpriteId` (`src/content/stations.ts`); der Validator zählt sie als verwendet (ADR-0040).

## 9. Bauen und Basis (M4, §15, §16)
- **Raster und Ebenen** (`src/game/building/`, `src/world/structures/`): je Kachel fünf Bau-Ebenen `boden` (Böden, Steg, Falltür) · `struktur` (Wände, Türen, Tore, Fenster, Säulen, Zäune, Leiter, Treppe) · `objekt` (Möbel, Kisten, Herdfeuer; 1×1 bis 4×4, Anker = Nordwest-Kachel, gedreht und gespiegelt) · `wandobjekt` (Wandmöbel: auf der Kachel vor einer Wand, an der Wand nördlich davon) · `dach`. Welches Item wie platziert wird, sagt die Sammlung `buildParts` (`art`, `material`, `groesse`, Möbelkategorie, Schlafplatz); Bauteile sind Items, Platzieren kostet ein Stück. Baureichweite 8; nicht auf Fels, Wasser (außer dem Steg auf Pfählen, der tiefes Wasser begehbar macht) oder den Spieler. Stationen und Lichter platzieren ihre eigenen Systeme; Bauraster, Stationen und Lichter teilen keine Kachel. Die Bauten liegen nicht in den Chunk-Daten, sondern im `StructureStore` je Chunk-Adresse (gepackte Zellen, Trefferpunkte; Teilnehmer `building`).
- **Kollision:** Wände und geschlossene Türen blockieren Bewegung und Licht; Fenster, Säulen, Zäune und stehende Möbel blockieren nur Gehende; Böden und Teppiche nichts; eine offene Falltür ist ein Loch; Treppen verbinden zwei Höhenstufen.
- **Materialien** (§16.2, `BALANCE.building.materials`): Palisade/Stroh 150, Holz 300, Fachwerk 450 (brennt 70 % weniger), Stein 900 Wand-Trefferpunkte; andere Arten nach Faktor (`hpFactor`), die verstärkte Tür doppelt. Abbauen gibt in den ersten 30 s alles zurück, danach 60 % der Rezeptzutaten (je Zutat abgerundet; Stationen ebenso); Aufwerten tauscht das Teil an Ort und Stelle gegen ein besseres derselben Art (Material-Rang, Stufe, Ausbau; ADR-0047); die Flächenreparatur (Hammer, ≤ 17 × 17) kostet anteilig die Hälfte der Zutaten.
- **Statik** (§16.3): ein Dachtile braucht eine Stütze (Wand, Tür, Tor, Fenster, Säule) in Reichweite seines Materials (Stroh 3, Holz 5, Stein 6), gezählt nur über getragene Dachtiles. Fällt eine Stütze, stürzen die ungestützten Tiles ein (`roofCollapsed`, Staub, 50 % Material).
- **Räume** (§16.4, `src/game/rooms/`): Flood-Fill über Wände, Türen (offen oder zu), Tore und Fenster, höchstens 400 Kacheln; Innenraum ab 90 % überdacht; bei Bauänderungen werden nur die betroffenen Regionen neu berechnet. Räume haben keinen Speicherteilnehmer.
- **Raumklima:** kein Niederschlag unter Dach; T = T_außen + (18 − T_außen) × Dämmung (Wände 60 %, Dach 40 %; offene Tür dämmt nicht) plus Wärme der Quellen im Raum (Feuer, Kamin, Herdfeuer, Brände; Eis kühlt), in großen Räumen verdünnt. Die gefühlte Temperatur des Spielers nimmt den Raumwert.
- **Raumtypen** (Sammlung `roomTypes`, nach Rang): Eiskeller (< 4 °C), Gewächshaus (Beet, ≥ 50 % Glasdach), Stall (Trog, Tier), Küche (Kochstelle, Lager, Tisch), Schlafraum (Bett, Licht), Werkstatt (3 Stationen), Speisesaal (Tisch, 2 Sitze), Trophäenhalle (3 Trophäen), Lager (4 Kisten); als Licht zählt nur, was brennt (eine kalte oder leere Lampe weder für den Schlafraum noch für die Behaglichkeit). Wirkungen in M4: Schlafraum „Ausgeruht“ × 1,5, Werkstatt +15 % Handwerkstempo, Trophäenhalle +3 Behaglichkeit; die übrigen wirken mit ihren Systemen (M7, M8).
- **Behaglichkeit 0–20:** +1 je einzigartiger Möbelkategorie (≤ 8), Licht +2/+3, Wärme +3 (16–24 °C) bzw. +1 (12–28 °C), Größe +1/+2/+3 ab 6/12/24 Kacheln, Deko +1 je Stück (≤ 4). Ab 6 gibt der Raum „Behaglich“; Furcht sinkt bis −1,5/s bei 20; ein durchschlafenes Bett gibt „Ausgeruht“ für (480 + 60 × Behaglichkeit) s, im Schlafraum × 1,5.
- **Herdfeuer** (§16.5, `src/game/hearth/`, `BALANCE.hearth`): ein 3 × 3-Steinring, höchstens 3 Basen, ≥ 24 Kacheln Abstand; Radius 12, mit Glutkernen in sechs Nischen bis 40; Scheit 1 Spielstunde, Holzkohle 3; Vorratsfach 40. Brennend: Spawnverbot in der Zone, Wiedereinstiegspunkt „Am Herdfeuer erwachen“, Lagerübersicht, Schnellreiseziel (Reisen: M7-37), Wärme und Licht; erloschen: kein Schutz. Ein brennendes oder gefülltes Herdfeuer lässt sich nicht abbauen; eingefrorene holen den Verbrauch analytisch auf.
- **Lagerung** (§16.7, `src/game/storage/`, `BALANCE.storage`): Holzkiste 16, Truhe 24, Lagerregal 48 (nur Rohstoffe und Barren); Umbenennen, Icon-Etikett, Sortieren, „Alles einlagern“ (ohne Schnellleiste), Schnellablage in passende Kisten im Umkreis 10, Suche über alle Kisten der Basis. Eine Kiste mit Inhalt lässt sich nicht abbauen; eine zerstörte verstreut ihn.
- **Blaupausen** (§16.6, `src/game/blueprints/`): Pläne ohne Material, als Zellen im Bauraster; der Hammer in der Hand stellt sie fertig – das Bauteil-Item kommt zuerst aus den Taschen, dann aus Kisten im Umkreis 8 um das Teil (ebenso beim Aufwerten und für die Flächenreparatur); `blueprintNeeds` listet, was eine Fläche noch braucht. Blaupausen schließen keinen Raum; ein geplantes Dach darf auf geplanten Stützen ruhen, fertig gestellt prüft die Statik erneut. Im Baumodus schaltet G (Gamepad RB, Aktion `blueprint`, nur im Kontext `build`) oder der Schalter „Blaupause“ neben dem Titel der Bautafel das Planen ein: der Geist urteilt wie `build.blueprint` (kein Material, der Spieler blockiert nicht, geplante Stützen tragen geplante Dächer) und steht im Planblau auf blauem Feld, Klick und Ziehen senden `build.blueprint`, Strg+Z nimmt die Pläne binnen 10 s zurück (eine fertiggestellte Blaupause nicht mehr), Stationen sind nicht planbar. Fehlt ohne den Schalter ein Bauteil, nennt die Statuszeile ihn mit Tastenglyphe („Kein Material – [G] plant es als Blaupause.“) und über dem Geist steht „[G] Blaupause“.
- **Werkzeuge des Baumodus** (§16.6, Review M4 #1, `src/ui/screens/bau/`, Geist `src/render/game/ghost.ts`): Setzen, Abbauen, Aufwerten, Reparieren – Tasten 1–4 (Aktionen `toolPlace` … `toolRepair`, nur im Kontext `build`, umbelegbar), Gamepad LB schaltet reihum (`toolNext`), dazu die Werkzeugleiste über der Hinweiszeile mit „Beenden“. Abbauen markiert das oberste Teil unter dem Zeiger (sonst Station, sonst Fackel) mit dem, was zurückkommt („100 % zurück (noch 18 s)“, „60 % zurück“ mit den Items), eine gezogene Fläche alles darin; ab 9 Zielen fragt die Statuszeile nach (Primärtaste bestätigt, Sekundärtaste bricht ab); gesendet werden `build.remove` mit Ebene, `station.remove`, `light.take`. Aufwerten nimmt das in der Bautafel gewählte Teil als neues und zeigt es grün über den alten, mit Kosten (`isUpgrade` der Simulation); Klick oder Linie/Fläche sendet `build.upgrade`. Reparieren nimmt einen Hammer aus der Schnellleiste in die Hand, zieht ein Rechteck mit den beschädigten Teilen und ihren anteiligen Kosten („Nichts zu reparieren“, wenn alles heil ist) und sendet beim Loslassen `build.repair`. Ablehnungen der Simulation stehen in der Statuszeile; ein Teil aus der Bautafel führt beim Abbauen und Reparieren zum Setzen zurück. G (RB) schaltet die Blaupause und kehrt zum Setzen zurück; F spiegelt spiegelbare Stationen (`station.place` mit `mirror`, der Geist dreht sich mit). Die Rückgängig-Frist ist `BALANCE.building.undoSeconds`.
- **Feuer** (§16.2, §10, `src/game/fire/`, `BALANCE.fire`): Brände je Kachel im Welt-Tick; Schaden = Brennbarkeit × 10 HP/s über `BuildingSystem.damage` (ein zerstörtes Teil fällt, Wandmöbel fallen herab, getragene Dächer stürzen ein), ein stehender Baum brennt zum Stumpf; Ausbreitung auf die acht Nachbarn nach Brennbarkeit, mit dem Wind schneller; Regen unter freiem Himmel löscht, ein Dach schützt; Stein, Lehm und Glas brennen nicht, ohne Feuer verfällt nichts. Eingefrorene Brände holen Sekunde für Sekunde mit dem aufgezeichneten Regen und Wind auf.
- **Stationen im Spiel (ADR-0043):** Stationen bleiben ein eigenes System (`station.place`, im Baumodus unter „Stationen“) und blockieren wie Lagerfeuer über eigene Kollisionsebenen; nichts wird auf den Spieler oder auf Bauteile gestellt. Die Fertigkeit, der die Erfahrung einer Station gehört, bestimmt dort das Tempo (Schmieden an Amboss und Schmelzofen, sonst Handwerk); die Werkstatt +15 % gilt im Raum der Station (nicht dem des Spielers; aus der Hand im Raum des Spielers), auch für Verarbeitungsstationen ohne eigene Fertigkeit; eine Verarbeitungsstation behält den Bonus ihrer letzten Beschickung. Handwerk-EP für eine Station gibt es, sobald sie die 30-s-Frist des vollen Abbaus überstanden hat.
- **Gräben (M4-36, ADR-0042):** die Schaufel vertieft gegrabene Erde neben anderem gegrabenen Boden zum Trockengraben (`graben`); neben offenem Wasser entsteht ein Wassergraben, der verbundene Gräben in der aktiven Zone flutet; neben Flüssen liefert der Stich Kies.

## 10. Kampf (M6, §19) – `src/game/combat/`

- **Kampfteilnehmer:** Spieler und Kreaturen. Die Schnittstelle steht in `src/game/combat/targets.ts` (Typen, vom Orchestrator vorgegeben): ein `CombatTargetProvider` je Art (Spieler: Kampf-Strang; Kreaturen: Kreaturen-Strang) liefert die Entitäten, deren Körper einen Kreis berühren (`queryCircle`, in eine gehaltene Liste des Aufrufers), eine lesende Sicht (`view`: Ebene, Stufe, Position, Radius, Blickwinkel, Team, Leben, Rüstung, Resistenzen, Unverwundbarkeit, Blockbeginn und Blockkraft), ob der Körper den Angreifer bemerkt (`aware`, Rückenangriff) und nimmt aufgelöste Treffer an (`applyHit`). Der Pfad-Dienst hat seine Typen in `src/world/path/types.ts` (vorgegeben). Teams `spieler`, `tier`, `feind`, `schattenbrut`; Treffer zwischen Tieren/Feinden gibt es nur, wo eine Kreatur es ausdrücklich darf (Rudel jagen Hasen: nein in M6).
- **Zielen (M6-01):** `player.aim {x, y}` wird pixelgenau (Weltpixel, ganzzahlig) und bei jeder Änderung ≥ 1 px (Maus) bzw. jedes Frame mit Stick-Ausschlag gesendet; die Interaktion nimmt weiter die Kachel davon. Der Zielwinkel = `atan2` von der Figur zum Zielpunkt (in der Simulation, deterministisch); die Blickrichtung der Figur folgt dem Winkel in 4 Richtungen mit Hysterese (`BALANCE.combat.aim.facingHysteresisDeg`), solange sie kämpft, zielt oder blockt – sonst der Bewegung wie bisher.
- **Eingabe (M6-02):** `combat.attack {on}` (LMB/RT: kurz = leicht, ab `heavyHoldSeconds` gehalten = schwer beim Loslassen; Bogen: halten spannt, loslassen schießt), `combat.block {on}` (RMB/LT: mit Schild blocken – nicht mit Zweihänder, Bogen oder Armbrust in der Hand, die keine Hand für ihn lassen (`BALANCE.combat.block.noShieldClasses`, M6-48) –, ohne Schild mit Nahkampfwaffe parieren/abwehren, mit Fernwaffe zielen = ruhigere Hand, langsameres Gehen), Rolle weiter `player.roll` (0,25 s unverwundbar). `src/game/input.ts` sendet `combat.attack` statt `player.useItem`, wenn die Hand eine Waffe, ein Werkzeug oder nichts hält (Faust); Essen, Verband, Eimer, Fackel/Lagerfeuer und Fallen aufstellen bleiben `player.useItem`. Wer tot ist oder schläft, kämpft nicht (`incapacity`); wer betäubt ist, auch nicht (s. „Zustände auf dem Spieler“).
- **Angriffe als Daten:** Item-Block `waffe` (Schema `src/content/schema/item.ts`, additiv): `klasse` (`WEAPON_CLASSES`: faust, schwert, axt, keule, speer, dolch, zweihand, bogen, armbrust, schleuder, wurf), `schadensart` (hieb, stich, wucht, feuer, frost, gift, licht, schatten), `schaden`, `reichweite` [px], `bogen` [°], `tempo` [s je Schlag], `ausdauer`, `stagger`, `wucht` (Hitstop/Knockback), optional `kombo` (Schlagfolge), `schwer` (Art des schweren Angriffs: rundumhieb, ruestungsbruch, wurf, …), `zustand` ({id, chance, sekunden}); Munition-Block `munition` (`fuer`: bogen|armbrust|schleuder, `schaden`, `schadensart`, `zustand`, `licht?`); Schild-Block `schild` (`blockkraft` 0–1, `ausdauerJeSchaden`, `tempoFaktor`). Formeln in `src/game/combat/formulas.ts`, Werte in `src/content/balance/combat.ts` (§D: Grundschaden je Stufe × Klassenfaktor, Rüstung R/(R+50), Krit 5 % × 1,75).
- **Treffer-Ablauf (M6-04, M6-05):** `CombatSystem.resolve(sim, attacker, target, attack)` → Schaden je Art × (1 − Resistenz) × (1 − Rüstungsreduktion), Krit (geseedet, Strom `combat`), Zustände, Stagger, Knockback, **Hitstop in der Simulation**: Angreifer und Ziel stehen `hitstopTicks` = 2–6 Ticks nach Wucht still (Bewegung, Animationstakt, KI), Ereignis `hitLanded {attacker, target, amount, art, crit, wucht, hitstopTicks, knockback, material}`; Schaden am Spieler über `VitalsSystem.damage` mit neuer Ursache `kreatur` (bzw. `projektil`), God-Modus bleibt wirksam. Besiegt: `combatantDefeated {entity, by}`.
- **Parade (M6-03):** Block, der ≤ `BALANCE.combat.parry.windowSeconds` (0,15 s = 9 Ticks) vor dem Treffer begann, pariert: kein Schaden, Angreifer taumelt (`staggerTicks`), der nächste Treffer auf ihn ist kritisch; Ereignis `parried`. Die Eingabe wirkt im nächsten Tick (kein Puffer über Frames).
- **Nahkampfklassen (M6-06):** Schwert 3er-Kombo, schwer Rundumhieb · Axt schwer Rüstungsbruch (−Rüstung auf Zeit), fällt Bäume mit 50 % Abbaukraft · Keule Wucht, hoher Stagger · Speer Reichweite, schwer Wurf (wird Projektil, bleibt als Drop liegen) · Dolch schnell, Rückenangriff × 3 beim Schleichen (Ziel sieht den Spieler nicht) · Zweihand breit, langsam, Licht an den Gürtel (−40 %, `LightSystem.addTwoHandedRule`).
- **Projektile (M6-07, M6-08):** ECS-Komponente `projectile` (ColumnStore: x, y, vx, vy, z/Bogenhöhe, Lebensdauer, Besitzer, Munition) im Kampf-System; Swept-Kollision gegen Kacheln (`sweepCircle`, `PROJECTILE_RULES`) und Körper (`BodyGrid.sweep`, je Tick gebaut); Wind aus dem Wetter lenkt ab; Bogen spannen 0,8 s (Schaden × Spannung), Armbrust nachladen 1,5 s, Schleuder; Pfeile stecken (Drop mit Chance, Leuchtpfeil: Licht 3 Kacheln für 60 s über `LightSystem.addLightProviders`), gehen in tiefem Wasser unter (Welle über `scene.water` als Impuls in der Präsentation). Wurfwaffen: Wurfbogen, Flächenwirkung mit Radius, Zustände; Brandflasche entzündet (`FireSystem`), Wurfmesser.
- **Schilde (M6-09):** Nebenhand; Blockkraft (Holz 40 %, Bronze 60 %), Ausdauer je geblocktem Schaden, Turmschild-Tempo als Datenfeld; mit Schild hängt das Licht am Gürtel (−40 %) – ebenso mit Zweihänder, Bogen oder Armbrust in der Hand, die die Nebenhand brauchen (`offHandBusy` = `twoHandedClasses` ∪ `block.noShieldClasses`, M6-79).
- **Zustände auf dem Spieler (M6-78, wie ADR-0151 für Kreaturen):** `PlayerSystem.usePace(conditions)` (in `addPlayerLifeSystems`). `aktionstempo` 0 (Betäubt) – kein Angriff, kein Block (ein gehaltener kommt nach der Betäubung mit neuem Paradefenster), keine Rolle, kein `player.useItem` (Grund `stunned`), kein Schritt und kein Drehen; ein Ausholen, Spannen oder Nachladen bricht ab (beim Treffer sofort). Aktionstempo = Zustände × Erschöpft (0,75) × Frierend (0,9): Ausholen, Erholung, Spannen und Nachladen dauern `Ticks / Tempo` (`actionTicks`). Präzision = `praezision` × Frierend (0,9): Streuung eines Schusses ÷ Präzision (höchstens `BALANCE.conditions.player.maxSpreadDeg`), Krit-Chance des Schlags × Präzision. `sicht` ist Darstellung: `GameSession.sampleSight`, die Spielansicht schließt das Bild vom Rand um 1 − Sicht (Vignette). Nichts davon wird gespeichert (es folgt aus den Zuständen); Sammeln, Interaktion, Handwerk und Essen lesen das Tempo noch nicht.
- **Kampf-EP:** `nahkampf_treffer`/`_sieg`, `fernkampf_treffer`/`_sieg`, `treffer_geblockt`, `parade`, `ausweichrolle` (Rolle durch einen Angriff) über `SkillsSystem.award`.
- **Befehle** `combat.attack {on}`, `combat.block {on}`; Ereignisse `attackStarted {entity, klasse, schwer, kombo}`, `attackWindup`, `hitLanded`, `parried`, `blocked`, `projectileFired`, `projectileHit`, `projectileStuck`, `combatantDefeated`, `staggered`.

## 11. Kreaturen (M6, §19.4, §20, §12.4) – `src/game/creatures/`

- **Entität:** ECS-Entität mit `position` (Motion) und `creature` (SparseSet `CreatureState`: Datensatz-Id, Variante, Leben, KI-Zustand und -Gedächtnis, Ziel, Abklingzeiten, Heimat/Leine, Rudel, Telegraph, Stagger, Hitstop, Zustände). Bewegung mit `moveCircles` und Regeln je Fortbewegung (`LAND_CREATURE_RULES`, Schwimmer, Flieger); Kreaturen registrieren sich als `CombatTargetProvider`.
- **Daten** (`src/content/creatures/`): Sammlung `creatures` (Id, Biome, Familie `friedlich`/`gegner`/`schattenbrut`/`elite`, Größe 16/32/48+, Leben, Tempo, Resistenzen je Schadensart, Rüstung, Angriffe [Name, Art, Schaden, Reichweite, Ausholzeit-Basis, Abklingzeit, Gewicht, Fläche?], KI-Profil, Beutetabelle, Sounds, Sprite, Bestiarium DE/EN, Aktivität Tag/Nacht/Dämmerung, Fortbewegung), `aiProfiles`, `lootTables`, `spawnTables` (je Biom: Tag, Nacht, Jahreszeiten, Untergrund). Zählbericht: `creatures` (ohne Varianten), `elites`.
- **Validator-Regel `kreatur` (M6-19):** Sprite `kreatur_<id>` mit Clips `idle_<r>`, `move_<r>`, `attack_<angriff>_<r>` (Ausholphase als eigene Frames), `hit_<r>`, `death_<r>` (Richtungen down/up/left/right, Spiegelung links↔rechts erlaubt), Augen-Emissiv für Nachtjäger, Sounds (Laut, Treffer, Tod; Angriff je Angriff), KI-Profil, Beutetabelle (außer Glühwürmchen: begründet leer erlaubt per Feld), Bestiarium DE/EN.
- **KI (M6-13):** Utility-KI in `src/game/creatures/ai/`: Zustände Ruhen, Umherstreifen, Grasen, Fliehen, Untersuchen, Jagen, Angreifen (Musterwahl gewichtet mit Abklingzeiten), Umkreisen, Rückzug, Heimkehr (Leine), Schlafen (Tagesrhythmus: Tagaktive schlafen nachts, Nachtaktive tags – ein Treffer, ein Geräusch oder ein Rudelruf weckt sie für Gedächtnis- plus Suchzeit, ADR-0143); Bewertungen aus dem KI-Profil; Denken gestaffelt mit `BALANCE.ai.thinkHz` (Versatz nach Entität), Bewegung jeden Tick; deterministisch (Strom `creatures`).
- **Wahrnehmung (M6-14):** Sichtkegel 120°, Sichtweite × Lichtfaktor am Spieler (Lichtkarte; eigene Lichtquelle × 2), Wetter senkt sie (Nebel, Starkregen); Gehör über **Geräuschereignisse** (`src/game/creatures/noise.ts`: Quelle, Ebene, Ort, Radius) aus Schritten (Sprinten/Schleichen −70 % über das vorhandene `noise` des Körpers), Kampf, Holzhacken, Abbau, Türen; Regen dämpft. Wer den Spieler sieht oder hört, ruft Alarm: sein Rudel in `packAlertTiles` kennt das Ziel, und seine Art hört den Ruf als Geräusch (`BALANCE.ai.noise.call`, M6-53). Im Dunkeln zeigt die Präsentation nur die Augen.
- **Telegraphs (M6-15):** Ausholzeit 0,3–0,8 s × Schwierigkeitsfaktor, auf jeder Schwierigkeit in 0,3–0,8 s gehalten (`windupTicks`, M6-50; ein Zustand mit `aktionstempo` < 1 wie Frost dehnt die Pose darüber hinaus), Ereignis `creatureTelegraph {entity, angriff, ticks, flaeche?}` (Glint + Laut + Bodenmarkierung).
- **Steuerung (M6-17):** Separation, Türen (Profilflag `brichtTueren` → `BuildingSystem.damage`), Schwimmer, Flieger; Debug-Overlay `pfade`.
- **Gruppentaktik (M6-18):** Rudel mit gemeinsamem Ziel verteilen sich auf Winkelplätze um das Ziel (> 90° Streuung), Fernkämpfer halten Abstand, Beschwörer schützen sich.
- **Tarnung und Feuerscheu (M6-22):** Profilfeld `tarnung {erwachen, tarnenNach}`: die Kreatur (Dornling) wartet verborgen und still (`CreatureState.hidden`, Clip `tarnung`, nicht „gesichtet“), bis der Spieler in die Reichweite ihres Überfalls kommt (Angriff mit `ausTarnung`: das Ausholen ist die Enthüllung) oder ein Treffer sie weckt (`creatureRevealed`, `erwachen` s ohne Handlung, Clip `erwachen`); nach `tarnenNach` s ohne Ziel tarnt sie sich wieder. Profilfeld `scheutFeuer` [Kacheln]: flieht vor der nächsten offenen Flamme (Fackel, Lagerfeuer, Brand – `useFlames`, `src/game/creatures/flames.ts`) von ihr weg (Wespenschwarm).
- **Bestand und Spawn (M6-27):** Wildtiere entstehen je Chunk beim ersten Aktivieren aus der Spawntabelle (geseedet nach Chunk) und wachsen langsam nach (Obergrenze je Chunk); Kreaturen gehören ihrem Heimat-Chunk: verlässt er die aktive Zone, werden sie in den Chunk-Bestand geschrieben und ihre Entitäten entfernt, beim Aktivieren wiederhergestellt und aufgeholt (`catchUp`: heilen, Schattenbrut verblasst bei Tag). `ActiveZone` bekommt dafür Zuhörer `onActivate`/`onDeactivate` (kleine Einfügung). Schattenbrut: nur auf Kacheln mit Licht < 0,15, 16–40 Kacheln vom Spieler, außerhalb von `HearthSystem.spawnBlocked` und Leuchtfeuerzonen, nachts oder im Untergrund; Dichte nach Biomstufe, Mondphase (Finstermond +50 %, stärkere Varianten), Schwierigkeit.
- **Schattenbrut-Licht (M6-28):** meidet Licht > 0,5 (Pfad- und Steuerkosten), 5 Schaden/s in gleißendem Licht, verblasst bei Sonnenaufgang ohne Beute; Beute `lumen_scherbe` (Herdfeuer-Brennstoff 6 h).
- **Nachtmahr (M6-29):** `FearSystem.onNightmare` → `nachtmahr` jagt bis gleißendes Licht erreicht (`banishNightmare`) oder besiegt; Trugbild-Schaden ab Furcht 80 verdrahtet.
- **Nachtmahr besiegt (M6-29b):** senkt die Furcht um `BALANCE.creatures.nightmare.defeatFearRelief` (40, Grund `nachtmahr`): von 100 auf 60 – bis der nächste kommt, vergehen mindestens die 40 Punkte Furchtanstieg.
- **Kreaturengruppen (M6-23 … M6-26):** Kern und Biomgruppen liefern je eine `CreatureGroup` (Kreaturen, KI-Profile, Beute, eigene Spawntabellen, `spawnZusaetze` für fremde Biomtabellen über `defineSpawnAdditions`); `src/content/creatures/index.ts` fügt `CREATURE_GROUPS` zusammen (`joinSpawnTables`: doppelte Biomtabelle und Zusatz zu fehlender Tabelle sind Fehler). Die Schattenbrut trägt sich so nachts in `gruenhain` und `salzkueste` ein, dazu in die Höhlenbiome `wurzelhoehlen`, `tiefgrund`, `glutadern` (Tabellen der Gruppe `untergrund`, `src/content/creatures/untergrund.ts`: dort gilt `nacht` zu jeder Stunde, und die Brut schläft unter Tage nie; M6-Gate).
- **Kreatur-Geschosse (M6-15b):** Angriff mit `geschoss {geschwindigkeit, sprite: geschoss_<name>}` (Speier): die Kreaturen melden die Geschoss-Id beim Aufbau an (`CombatSystem.addShot(id, zustand)`), der Schlag feuert über `CombatSystem.fireShot` in den Projektilflug des Kampfsystems (Ausweichen, Blocken, Speichern über die Id wie bei Munition); Aufprall-Klang `sfx_kreatur_geschoss_aufprall`.
- **Festhalten (M6-26):** Nahkampfschlag mit `festhalten {sekunden, schadenProSekunde, bisse}` (Kriecher): trifft er ungeblockt, hält die Kreatur den Spieler (Bewegungssperre `holdsPlayer`, keine Rolle) und beißt `bisse`-mal verteilt über die Haltezeit (nicht blockbar); ein Treffer auf die Kreatur (Schaden oder Stagger), Abstand, Ebenenwechsel, Tod oder gleißendes Licht lösen den Griff. Der Griff steckt in den Angriffs-Ticks (kein neues Speicherfeld).
- **Lichtfresser (M6-26):** Flächenangriff mit `lichtfressen {radiusTiles, lumen}`: beim Schlag rufen die Kreaturen ihre `LightEater`-Haken (`CreatureSystem.addLightEater`); `setup.ts` verdrahtet `LightSystem.putOutNear` (getragene Fackel, gesetzte Fackeln und Laternen im Kreis erlöschen mit Grund `lichtfresser`, Feuerstellen nicht); `lumen` ist für die Lumen-Laterne (M7-36) bestimmt.
- **Schattenbrut-Varianten (M6-25b):** je Biom eine Variante als Daten (`src/content/creatures/schattenbrut.ts`: Palettenzeile `brut_<biom>` aus `assets-src/paletteRows.ts`, Leben/Schaden/Tempo nach der Biomstufe); der Validator verlangt eine bekannte Palettenzeile, die mindestens eine Farbe des Sprites umfärbt.
- **Beute, Jagen, Fallen (M6-30):** Beutetabellen gewichtet, geseedet, stufenabhängig → `DropSystem.spawn`; besiegte Tiere hinterlassen einen Kadaver (Entität), E mit Messer zerlegt ihn (Fleisch, Fell, Knochen, Federn, Fett, Sehnen, Spezialteile; Fertigkeit `jagen` falls vorhanden, sonst `sammeln`); Fallen `schlinge`, `kastenfalle` (`trap.place`, `trap.take`) fangen kleine Tiere; der Spieler stellt sie aus der Hand mit der Primärtaste auf wie eine Fackel – auf der gezielten Kachel in Reichweite, sonst vor der Figur (`player.useItem`, `src/game/interaction/hand.ts`); vorher zeigt die Spielansicht die Falle dort grün oder rot mit Grund (Fokusfelder `hand*` der Interaktion, `src/render/game/placement.ts`) und der HUD-Hinweis „Aufstellen: Schlinge“ mit dem Mausglyph; E nimmt sie zurück, der Fang bleibt als Kadaver (M6-Gate).
- **Bestiarium (M6-32):** je Kreatur „gesichtet“ (n s im Blick) und „besiegt“ (Anzahl) → freigeschaltete Felder (Werte, Resistenzen, Beute); Teilnehmer `bestiary`; UI im Chronik-Reiter (M7).

## 12. Pfadfindung (M6-16) – `src/world/path/`

- Rein und deterministisch: `PathGrid`-Ausschnitt (Begehbarkeit je Fortbewegungsklasse `land`/`schwimmer`/`flieger`, Türbits, Sperrkacheln für Schattenbrut aus der Lichtkarte), A* mit Jump Point Search auf dem Kachelraster, hierarchisch über Chunk-Portale (HPA*, Abstraktgraph je Ebene, bei Kachel-Änderungen chunkweise erneuert).
- **Dienst** `PathService` (`src/world/path/service.ts`, Typen vorgegeben in `src/world/path/types.ts`): `request(req, tick)` nimmt einen Schnappschuss der nötigen Region und gibt ein Ticket; das Ergebnis gilt ab `tick + BALANCE.ai.pathLatencyTicks`; `poll(ticket, tick)` liefert es frühestens dann – hat der Worker bis dahin nicht geantwortet, rechnet die Simulation dieselbe reine Funktion auf demselben Schnappschuss selbst. Damit ist das Ergebnis unabhängig vom Worker-Takt (Determinismus), der Worker spart nur Zeit. Budget je Tick (Anfragen, Knoten); Node-Tests nutzen den Ausführer im selben Thread.
- Worker `src/world/path/path.worker.ts` über `workerBridge` (`createRpcServer`/`JobQueue`); Bench `pfad-200` (200 Anfragen/s im Budget).

## 13. Präsentation M6

- **Render** (Kampf-Präsentation, eigener Strang): `src/render/game/creatures.ts` (Kreaturfiguren `kreatur_<id>`, Augen emissiv nachts, Rim-Licht), `src/render/game/combat.ts` (Waffen frei rotiert im Low-Res-Puffer, Smears, Projektile im Flug, geworfene Stücke, Telegraph-Glint und Bodenmarkierungen, 2-Frame-Trefferblitz über den Weißblitz-Effekt, Knockback, Screenshake als Kameraversatz in ganzen Pixeln (Einstellung `accessibility.screenshake`, ADR-0118), Einschlagpartikel je Material, Auflösen Besiegter, Schadenszahlen in `welt-ui` (Einstellung `game.damageNumbers` nach §29 „Spiel“, Standard an, ADR-0117)); Schattenbrut-Materialisierung (Tinten-Rauch per Rauschschwelle + violetter Rand) als Sprite-Effekt im G-Buffer-Shader.
- **Materialisierung (M6-25):** Sprite-Flag `materialize` (`SPRITE_FLAG` 32) deutet das Ausblenden als Rauch: je Pixel eine Schwelle aus aufsteigendem Cluster-Rauschen (2 × 2 px) und Zeilenhöhe (`src/render/batch/materialize.ts`, CPU-Spiegel des Shaders), darüber ein glühender Saum in `verderb.3` der Palettenzeile. Schattenbrut formt sich nach dem Erscheinen in `formSeconds` (0,9 s) vom Boden her, verblasst und stirbt von oben in Funken. Die Tönung ins Dunkel erreicht emissive Pixel und den Saum nicht: nachts bleiben nur Augen, Glut und Saum (§12.2).
- **Sprites:** `assets-src/sprites/kreaturen/<id>.ts`, Waffen/Munition/Schilde `assets-src/sprites/waffen/**` (Icons und Halte-Sprites per Materialstufen-Generator), Rüstungs-Layer `assets-src/sprites/ausruestung/**`, Spieler-Kampfclips `assets-src/sprites/figuren/_spieler_kampf.ts` (`attack_<klasse>_<r>` 4–6 Frames mit Smear, `heavy_<klasse>_<r>`, `block_<r>`, `bow_<r>`, `throw_<r>`).
- **Audio:** `src/content/sfx/kampf.ts`, `src/content/sfx/kreaturen.ts`; jedes neue Ereignis in `src/audio/eventMap.ts` (Klang oder begründete Stille).
- **Debug (M6-35):** Konsole `spawn <kreatur> [n]`, `kill [radius]` (ohne Radius wie bisher der Spieler), Overlays `spawnzonen`, `wahrnehmung`, `pfade`.

## 14. Kanonische IDs M6 (verbindlich für parallele Arbeit)

- **Kreaturen (22):** Grünhain friedlich `hase`, `reh`, `wachtel`, `eichhoernchen`, `gluehwuermchen`, `frosch` · Grünhain Gegner `keiler`, `dachs`, `wolf`, `dornling`, `wespenschwarm` · Salzküste `krabbe`, `moewe`, `robbe`, `scherenkrebs`, `qualle`, `strandraeuber` · Schattenbrut `schleicher`, `kriecher`, `speier`, `lichtfresser`, `nachtmahr`.
- **Waffen T0 (11):** `faust` ist kein Item. `feuersteinklinge` (Schwert), `steinkampfaxt` (Axt), `holzkeule`, `knochenkeule` (Keule), `steinspeer` (Speer, besteht), `knochendolch` (Dolch), `felsbrecher` (Zweihand), `kurzbogen` (Bogen), `schleuder`, `wurfmesser_feuerstein`, `brandflasche` (Wurf). **T1 (11):** `bronzeschwert`, `bronzekampfaxt`, `bronzestreitkolben`, `bronzespeer`, `bronzedolch`, `bronzezweihaender`, `bronzegrossaxt`, `bronzekriegshammer`, `kompositbogen`, `armbrust`, `wurfmesser_bronze`.
- **Munition:** `pfeil_feuerstein`, `pfeil_bronze`, `pfeil_stumpf`, `pfeil_feuer`, `pfeil_gift`, `pfeil_leucht`, `bolzen_bronze`, `schleuderstein`. **Schilde:** `holzschild`, `bronzeschild`.
- **Rüstung (3 Sets, `src/content/ruestungssets.ts`):** Set `faser` (`faserkappe`, `faserhemd`, `faserhose`, `faserschuhe`; T0, leicht, Webstuhl und Schneidertisch), Set `bronze` (`bronzehelm`, `bronzebrustpanzer`, `bronzebeinschienen`, `bronzestiefel`; T1, schwer, Bronzeamboss), Set `leder` (`lederkappe`, `lederwams`, `lederhose`, `lederstiefel`; T1, mittel, Schneidertisch); je Teil ein Ausrüstungsplatz (`kopf`, `brust`, `beine`, `fuesse`); `lederrucksack` (+8). Set-Boni ab 2 und 4 getragenen, nicht kaputten Teilen, sie addieren sich: `faser` 2: +5 max. Ausdauer · 4: +10 max. Ausdauer, +5 % Tempo; `leder` 2: +2 Isolation · 4: +2 Rüstung, +15 max. Ausdauer; `bronze` 2: +2 Rüstung · 4: +2 Rüstung, +15 max. Leben. Inventar und Tooltip zeigen Set, getragene Teile (n/4) und Boni, nicht erreichte grau (M6-43).
- **Figuren-Layer** (`FIGURE_LAYERS`, `src/content/items/index.ts`): `kopf`, `koerper`, `beine`, `fuesse`, `waffe`, `nebenhand` – `fuesse` (Schuhe, Stiefel) seit M6; der Platz `brust` trägt auf `koerper`, Schmuck, Rücken und Rucksack haben keinen Layer. Sprite `ausruestung_<id>`: der Helm sitzt mit seinem Anker auf dem Kopfsockel, die übrigen Teile sind Overlays der Körperzelle; die eigene Kleidung (§2) nur auf Layern ohne getragenes Teil – Spielansicht und Papierpuppe des Inventars gleich (M6-42).
- **Stationen:** `webstuhl`, `schneidertisch`, `gerbrahmen` (T0, was sie machen: §8).
- **Jagdgüter** (Kreaturen-Strang, `src/content/items/jagd.ts`): `wildfleisch_roh`, `gefluegel_roh`, `fell`, `knochen`, `federn`, `fett`, `sehnen`, Spezialteile je Kreatur (`wolfszahn`, `keilerhauer`, `hirschgeweih`, `krabbenpanzer`, `robbenfett` …; endgültige Liste im Strang, snake_case, ohne Präfix; `wolfszahn` und `keilerhauer` mit ihrem Schmuck in `src/content/items/trophaeen.ts`, s. u.), `lumen_scherbe`; Fallen `schlinge`, `kastenfalle`. `leder` ist ein Verarbeitungsprodukt des Gerbrahmens (Rüstkammer-Strang). Grünhain (M6-20 … M6-22, `src/content/items/jagd_gruenhain.ts`): nur `wespenstachel` (Pfeilgift, Rezept `rezept_pfeil_gift_wespe`); Keiler, Dachs, Wolf, Eichhörnchen und Frosch geben die gemeinsamen Güter, der Wolf dazu `wolfszahn`, der Keiler `keilerhauer` (M6-30d: an der Werkbank auf Sehne zum ersten Schmuck – `wolfszahnkette` aus drei Zähnen, +10 % Furchtresistenz; `haueramulett` aus zwei Hauern, +5 max. Leben), der Dornling die Reste seiner Beute (Knochen, Fell, Federn) – kein Gegner lässt fallen, was die Welt zum Sammeln bietet. Salzküste (M6-23, M6-24, `src/content/items/jagd_kueste.ts`): `krebsfleisch_roh` (Krabbe, Scherenkrebs) und – seit dem M6-Gate – `nesselfaden` der Qualle (Pfeilgift, Rezept `rezept_pfeil_gift_qualle`; damit hat jede Kreatur außer dem Glühwürmchen eine Beutetabelle); der Strandräuber lässt Faserseil, rohes Krebsfleisch, einen Verband und selten seine Feuersteinklinge. Fisch folgt mit dem Angeln (M7/M8).
- **Perks (18):** je 6 für `nahkampf`, `fernkampf`, `verteidigung` (Wahl bei 30/60/90, je 2 Optionen), Sammlung `perks` mit Wirkung als Daten (Modifikatoren des Kampfs), Zählbericht `perks`.

## 15. Speichern M6
- **Save-Version 3 (M6-36):** neue Teilnehmer `creatures` (aktive Kreaturen samt KI-Zustand, Chunk-Bestände, Kadaver, Nachwachs-Uhren), `combat` (Kampfzustand des Spielers, Projektile im Flug), `traps`, `bestiary`; Referenzspielstand `v3.json` zusätzlich mit Wolfsrudel mitten in der Jagd, Pfeil und Speier-Geschoss im Flug, Falle mit Hasen, Kadaver, Bestiarium-Fortschritt, getarntem Dornling und einem Reh im Bestand eines eingefrorenen Chunks (gespeichert in der Abenddämmerung; `npm run fixture:save` zweimal bytegleich). Felder, die spätere M6-Tasks den Teilnehmern hinzufügten (Tarnung `hidden`/`tarnTick`, Leine `leashed`, Finstermond `finster`, `dodged` am Geschoss; der Griff lebt in den Angriffsticks), schreibt der Build nur, wenn gesetzt; ein Stand ohne sie liest sie als nicht gesetzt.

## 16. M7: Module, Systemreihenfolge, gemeinsame Dateien (ADR-0207)

- **Neue Bereiche** in `src/game/<bereich>/` nach §1 (`commands.ts`, `events.ts`, `state.ts`, `system.ts`, reine Formeln in `formulas.ts`).
  Die bereichsübergreifenden Typen stehen vorgegeben in `types.ts` des Bereichs bzw. im Content-Schema (vorgegebene Typdateien aus Welle 0, ADR-0207);
  Formänderungen daran nur per ADR, Ergänzungen frei (wie ADR-0080).

  Stränge (Wellenplan und exklusive Dateien: docs/M7-STRAENGE.md, ADR-0207): **A** Klang · **B** Orte & Welt · **C** Gewölbe · **D** Feld & Fang · **E** Küche & Vorrat ·
  **F** Boss & Leuchtfeuer · **G** Chronik & Führung · **H** Menüs & Speichern · **I** Figur & Kreaturen; **Welle 0** = Integrator vor allen.

  | Ordner `src/game/…` | System-Id = Teilnehmer | Aufgabe | Strang |
  |---|---|---|---|
  | `places/` | `places` | Orte §21: Entdeckung, Truhen, Wächter, Rückkehr nach 7 Tagen, Ortswirkungen | B |
  | `map/` | `map` | Kartenaufdeckung (Bitmaske), eigene Marker | B |
  | `worldevents/` | `world-events` | Weltereignis-Register §10, Planung, Ankündigung, Blitze, Waldbrand | B |
  | `vaults/` | `vaults` | Gewölbe-Laufzeit: Türen, Schlüssel, Rätselzustände, Fallen, Truhen, Wächter | C |
  | `puzzles/` | – | reine Rätselregeln und Löser (benutzt von `vaults`) | C |
  | `research/` | – | Forschungspult, Kartentisch, Baupläne (Anbindung an Stationen, Freischaltungen, Orte) | C |
  | `farming/` | `farming` | Acker, Beete, Wachstum 06:00, Qualität, Dünger, Schädlinge, Setzlinge, Obstbäume, Klimaprotokoll | D |
  | `fishing/` | `fishing` | Angeln, Minispiel, Reusen, Eisangeln | D |
  | `meals/` | `meals` | Mahlzeit-Effekte, Überdruss, Salz, Wohlfühlessen, rohes Fleisch | E |
  | `spoilage/` | `spoilage` | Verderb aller Behälter (Verderb-Takt je Spielstunde, §21) | E |
  | `water/` | `water` | Regensammler, Trinkschlauch, Abkochen | E |
  | `bosses/` | `bosses` | Boss-Framework §20.2, Borkenvater | F |
  | `beacons/` | `beacons` | Leuchtfeuer: Entzündung, Zone „Erleuchtet“, Heilung der Welt | F |
  | `unlocks/` | `unlocks` | Freischaltungs-Registry §23.1 | F |
  | `shards/` | `shards` | Herzsplitter (+10 max. Leben), Glutsplitter (+5 max. Ausdauer) | F |
  | `travel/` | `travel` | Schnellreise, Wegsteine | F |
  | `triggers/` | – | Auswerter der Auslöser-Sprache (§17) | G |
  | `stats/` | `stats` | Statistiken und Meilenstein-Zeiten (Pacing) | G |
  | `achievements/` | `achievements` | Erfolge | G |
  | `chronicle/` | `chronicle` | Chronik-Tagebuch, Wissen | G |
  | `quests/` | `quests` | Aufgaben, Einstieg, Tracker | G |
  | `guide/` | `guide` | Funke, kontextuelle Hinweise, Einstieg-/Funke-Schalter der Welt | G |
  | `instruments/` | `instruments` | Musizieren (Flöte, Laute), Netz | A |
  | `worldsettings/` | `world-settings` | Welteinstellungen §29: Friedlich, Faktor-Überschreibungen, Schattenflut-Intervall, Logistik-Realismus; liest und setzt die Schwierigkeit, die im Teilnehmer `death` bleibt | H |
  | `appearance/` | `appearance` | Aussehen der Figur (Charaktererstellung) | I |
  | `skills/perkEffects.ts` (bestehender Ordner; Schnittstelle `PerkEffectsApi` aus Welle 0) | – | Perk-Wirkungen der Nicht-Kampf-Fertigkeiten (`PerkEffects.value`) | G |

  Kochen selbst hat kein eigenes System: Kochstationen sind Stationen (`stations`), Gerichte Rezepte (`crafting`, Zutatengruppen als
  Kategorien), Essen bleibt `action.eat` (`actions`) mit den Haken von `meals` (§21).
- **Systemreihenfolge** (verbindlich; `src/game/systemOrder.ts` `SYSTEM_ORDER`, Vertragstest `tests/unit/game/systemreihenfolge.test.ts`:
  die registrierten Systeme bilden eine Teilfolge der Liste, jedes registrierte System steht darin; `createSimulation` wirft bei einem System
  außerhalb der Liste oder an falscher Stelle – `systemOrderViolation`):
  1 `world-chunks` · 2 `world-settings` · 3 `motion` · 4 `world-collision` · 5 `player` · 6 `appearance` · 7 `vitals` · 8 `calendar` ·
  9 `weather-regions` · 10 `temperature` · 11 `inventory` · 12 `equipment` · 13 `drops` · 14 `gathering` · 15 `interaction` · 16 `crafting` ·
  17 `tools` · 18 `light` · 19 `stations` · 20 `repair` · 21 `building` · 22 `rooms` · 23 `storage` · 24 `hearth` · 25 `fire` · 26 `combat` ·
  27 `creatures` · 28 `traps` · 29 `bestiary` · **30 `bosses` · 31 `places` · 32 `vaults` · 33 `farming` · 34 `fishing` · 35 `spoilage` ·
  36 `water` · 37 `meals` · 38 `instruments` · 39 `beacons` · 40 `unlocks` · 41 `shards` · 42 `travel` · 43 `world-events` · 44 `map`** ·
  45–50 Leben (`conditions`, `fear`, `sleep`, `actions`, `skills`, `death`) · 51 `cheats` · **52 `stats` · 53 `achievements` · 54 `chronicle` ·
  55 `quests` · 56 `guide`**.
  Gründe: `world-settings` vor allen Lesern der Faktoren (Vitalwerte, Kreaturen, Tod); alles, was dem Spieler schadet (Boss, Fallen, Blitze),
  vor den Lebenssystemen (§3 „sie sehen jeden Treffer des Ticks“); die Beobachter (`stats` … `guide`) zuletzt: sie sehen alle Ereignisse des
  Schritts, ihre Teilnehmer werden zuletzt wiederhergestellt. Chunkgebunden mit `catchUp`: `farming`, `fishing` (Reusen), `spoilage`, `water`;
  alle übrigen neuen Systeme sind `timeScope: 'global'`.
  **Belegt nach Welle 1** (je ein Block mit Nummernkommentar in `setup.ts`): 2 `world-settings` (H) · 30 `bosses`, 39 `beacons`, 40 `unlocks`,
  41 `shards`, 42 `travel` (F) · 31 `places`, 43 `world-events`, 44 `map` (B) · 33 `farming`, 34 `fishing` (D) · 38 `instruments` (A). Frei für
  Welle 2: 6 `appearance` (I), 32 `vaults` (C), 35–37 `spoilage`, `water`, `meals` (E), 52–56 die Beobachter (G).
- **Einfügen in `setup.ts`:** jeder Strang legt sein System samt Verdrahtung als **einen** Block mit Nummernkommentar an seine Stelle der
  Reihenfolge (fehlt der Vorgänger noch, direkt hinter den nächsten vorhandenen Vorgänger); die Haken (§17) verbindet er im selben Block.
- **Gemeinsame Aggregationsdateien** (unmittelbar vor jeder Änderung neu lesen, nur kleine Einfügungen am eigenen Anker, nie fremde Zeilen
  umformatieren):

  | Datei | Einfügung je Strang |
  |---|---|
  | `src/game/setup.ts` | System + Haken (ein Block, siehe oben) |
  | `src/game/sim.ts` | `extends <Bereich>EventMap`, `...<BEREICH>_EVENT_TYPES`, Ablehnungsgründe in `CommandRejectReason`; H zusätzlich `resourceDensity` in `simConfigSchema` |
  | `src/game/commands.ts` | `...<BEREICH>_COMMAND_SCHEMAS` mit Kommentarzeile |
  | `src/game/session.ts` | Sampler-Feld + `sample<Name>()` (Implementierung in `src/game/samples/<bereich>.ts`) |
  | `src/save/versions.ts` | eigener Teilnehmer im Eintrag `version: 4` an seiner Stelle der Reihenfolge (§27) |
  | `src/content/index.ts` | `defineCollection` je neuer Sammlung (mit `category`, `refs`); die Orts- und Beobachter-Sammlungen (`locationTypes`, `placeLayouts`, `placeLoot`, `stats`, `statSources`, `milestones`, `chronicleRules`, `knowledge`, `guideHints`, `mechanics`) hat Welle 0 schon registriert – dort nur in die Sammeldateien eintragen |
  | `src/content/balance.ts` | ein Import + ein Feld je Gruppe `src/content/balance/<gruppe>.ts` |
  | `src/content/schema/item.ts` | **Welle 0** hat alle M7-Item-Blöcke (optional, Schemas in `src/content/schema/itemBlocks.ts`) und alle neuen Quellenarten eingetragen (samt Texten `ui.item.quelle.<art>` DE/EN und Rang im Tooltip); danach ändert jeder Strang nur seinen eigenen Block in `itemBlocks.ts` – Schema, Typ und seine Regeln in `checkItemBlocks` (additiv) |
  | `src/content/items/index.ts`, `src/content/recipes/index.ts`, `src/content/buildPartsAlle.ts`, `src/content/sfx/index.ts`, `src/content/particles/index.ts`, `src/content/creatures/index.ts` | Import + Eintrag der eigenen Gruppendatei |
  | `src/content/stations.ts`, `src/content/items/stationen.ts` | eigener zusammenhängender Block am Listenende; E zusätzlich das optionale Stationsfeld `feuer` (§21) |
  | `src/content/balance/stations.ts` | Stufen- und Brennstoffwerte der eigenen Stationen (`stages`, `fuel` verlangt das Stationsschema) |
  | `src/content/skills.ts` | eigene EP-Quellen (D: `fisch_gefangen` bei `sammeln`; C: `raetsel_geloest` bei `ueberleben`) |
  | `src/content/perks.ts` | G: neue Wirkungsarten in `PERK_EFFECTS` und Spread der Datei `src/content/perksM7.ts` |
  | `src/content/lights.ts` | eigene Lichtart(en) (A: Glühwürmchenglas, F: Lumen-Laterne) |
  | `src/content/uses.ts` | eigene Nutzungsverben/-subjekte |
  | `src/content/conditions.ts` | Import + Spread der eigenen Zustandsdatei; E zusätzlich das optionale Feld `gruppe` und die additiven Wirkungen `maxLebenPlus`/`maxAusdauerPlus` im `conditionEffectSchema` (B: `gesegnet`; E: Mahlzeit- und Trankzustände) |
  | `src/content/recipes/gruppen.ts` | eigene Zutatengruppen (E: Kochkategorien, D: `kompostgut`) |
  | `src/content/terrain.ts`, `src/content/worldObjects.ts` | C: Erbauer-Terrain; B: Objektart `ort` + Ortsobjekte; C: Gewölbeobjekte |
  | `src/audio/eventMap.ts`, `src/audio/music/stingers.ts` | Klang oder begründete Stille je neuem Ereignis; Stinger je Anlass (`stingers.ts` legt A an; bis dahin trägt ein Strang seinen Stinger-Wunsch im Bericht ein) |
  | `src/world/calendar.ts` | B: `addDaylightModifier` (Sonnenfinsternis) |
  | `src/world/climate/weather.ts` | D: `addPeriodListener` (Klimaprotokoll, §20) |
  | `src/world/gen/world.ts`, `src/world/gen/chunk.ts` | B: Schritt `orte` + Stempeln der Ortsvorlagen (`WORLD_GEN_VERSION` 2); C: Schritt `gewoelbe` + Stempeln der Gewölbe in Ebene −1 (keine zweite Versionsänderung im selben Meilenstein); H: `resourceDensity` im Schritt `ressourcen` |
  | `src/world/gen/underground/network.ts` | C: `reserved`-Kästen im `UndergroundInput` |
  | `src/game/rooms/system.ts` | D: `enclosedAt`; E: Station im `craftTempoAt` (Küche) |
  | `src/game/inventory/system.ts`, `src/game/storage/system.ts`, `src/game/stations/system.ts`, `src/game/drops/system.ts`, `src/game/death/system.ts` | E: `forEachPerishable` je Behälter (Verderb-Takt, `src/game/spoilage/types.ts`); F zusätzlich in `death`: `RESPAWN_SPOTS` += `arena`, `addArenaSpots` |
  | `src/ui/focus/GameScreens.tsx`, `src/ui/hud/Hud.tsx` | `ScreenSpec` + Fall; HUD-Element (eine Zeile) |
  | `src/render/world/gameScene.ts`, `src/render/scene.ts` | eine Zeile je Szenen-Teil; Unterobjekt der eigenen Szene |
  | `src/debug/scenarios.ts`, `src/debug/console.ts` | Import + Spread der eigenen Szenarien bzw. Befehle |
  | `src/i18n/de.json`, `src/i18n/en.json` | eigener zusammenhängender Schlüsselblock mit eigenem Präfix (§30) |
  | `tools/validator/checks.ts` | Aufruf der eigenen Regeldatei `tools/validator/<regel>.ts` |
  | `tools/validator/zielwerte.json` | nur die Kategorien mit **einem** Eigentümer-Strang (z. B. `crops`/`fish` D, `dishes`/`potions` E, `bosses` F); Mehrfach-Kategorien (`items`, `recipes`, `stations`, `buildParts`, `creatures`, `statusEffects`, `sfx`) hebt der Integrator |
  | `tools/validator/{verwendungen,reachability,spawn}-geplant.ts` | eigene Einträge mit Task-Id |
  | `assets-src/paletteRows.ts` | eigene Palettenzeilen (I: Haut/Haar/Kleidung; F: Boss) |
  | `docs/DECISIONS.md`, `docs/GLOSSAR.md`, `docs/SPIEL.md`, `PROGRESS.md`, `docs/BALANCE.md` | **nur der Integrator.** Stränge liefern ADR-Entwürfe ohne Nummer („ADR-00xx …“), Glossar-Begriffe, Belegzeilen und Vorschläge für Folgeaufgaben im Abschlussbericht (Verfahren wie M6) |

## 17. Kopplung M7: Beobachter, Auslöser, Ereignisse, Haken

- **Beobachter** (Welle 0, `src/game/observe.ts`): `SimSystem.observeStep?(sim, events: StepEvents)`. `Simulation.step` ruft den Haken nach
  `dailyTick` und `ecs.flushDestroyed()` für jedes System in Registrierreihenfolge, `skipTicks` nach seinen `dailyTick`-Aufrufen. `events` umfasst
  die Ereignisse, die seit Beginn dieses Schritts in `sim.events` stehen – einschließlich derer, die frühere Beobachter soeben geschoben haben
  (Erfolg → Chronik im selben Schritt); ein Aufruf von `forEach`/`forEachOfType` endet bei der Größe der Warteschlange zu seinem Beginn, ein
  Beobachter bekommt also seine eigenen Ereignisse desselben Aufrufs nicht, und spätere Beobachter sehen sie, frühere nicht. Beobachter lesen und
  zählen, schreiben nur ihren eigenen Zustand und schieben eigene Ereignisse; kein Beobachter setzt voraus, dass die Präsentation die Warteschlange
  leert. `observeStep` ist kein Zeithaken (keine Aufhol-Erklärung nötig); Beobachter sind `timeScope: 'global'`, wenn sie zusätzlich `worldTick`
  nutzen. Ob ein System beobachtet, entscheidet `addSystem` (der Haken muss beim Registrieren da sein). Technik: `Simulation.step` merkt sich
  `sim.events.size` zu Beginn des Schritts; `StepEvents` liest ab dieser Marke über `EventQueue.forEachFrom(start, cb)` bzw.
  `forEachOfTypeFrom(start, typ, cb)` (neu, ohne Allokation); nach dem Durchlauf rückt die Marke hinter alles – Ereignisse älterer, nicht geleerter
  Schritte (Headless-Tests leeren nie) sieht kein Beobachter doppelt. Ein `skipTicks` innerhalb eines Schritts (Debug-Zeitsprung als Befehl) lässt
  die Beobachter nach den Morgengrauen alles bis dahin sehen, das Schrittende nur den Rest; ein `skipTicks` außerhalb eines Schritts nur seine
  eigenen Ereignisse.
- **Auslöser-Sprache** (`src/content/schema/trigger.ts`, zod `triggerSchema`, Gang `forEachTrigger`; Auswerter `src/game/triggers/`, Strang G) – die eine Sprache für
  Aufgabenschritte, Erfolge, Funke- und Kontexthinweise, Chronik-Wissen und Vermittlung:
  `ereignis` (Sim-Ereignis + flacher Nutzlast-Filter `wo` + `anzahl`) · `statistik` (Stat-Id, `schluessel?`, `mindestens`) · `besitz` (Item,
  Anzahl in Taschen + Ausrüstung) · `zustand` (Zustands-Id aktiv) · `uhr` (`tag`, `vorStunde`, `abStunde`) · `lichtstufe` (am Spieler) · `raum`
  (Innenraum, Raumtyp) · `freischaltung` · `aufgabe` (Aufgabe/Schritt aktiv oder erledigt) · `ort` (Ortstyp entdeckt) · `alle`/`eines`/`nicht`.
  Ereignis-Auslöser zählen ab dem Scharfschalten (Schritt aktiv, Erfolg offen); zustandsartige werden im Welt-Tick (1 Hz) und bei jedem
  passenden Ereignis geprüft. Validator (G): `ereignis` ∈ `SIM_EVENT_TYPES`, alle Ids verweisen auf vorhandenen Content.
- **Datentabellen der Beobachter** liegen im Content, je Strang eine eigene Datei; die zod-Schemas (zu den vorgegebenen Typen) und die leeren Sammeldateien
  `src/content/{chronik,stats,guide,wissen,vermittlung}/index.ts` legt **Welle 0** an und registriert die Sammlungen (leer); jeder Strang ergänzt
  dort nur Import + Spread seiner Datei; G baut die Auswerter:
  `src/content/chronik/<bereich>.ts` (Chronik-Regeln), `src/content/stats/<bereich>.ts` (Statistik-Quellen), `src/content/guide/<bereich>.ts`
  (Funke- und Kontexthinweise), `src/content/wissen/<bereich>.ts` (Wissenseinträge), `src/content/vermittlung/<bereich>.ts` (Vermittlungs-Register
  §23). Wer ein Ereignis einführt, trägt es dort ein, wo es erzählt, gezählt oder erklärt werden soll – G kennt keine fremden Ereignisse im Code.
- **Ereignisse zwischen Strängen** (Name → Nutzlast, jede mit `tick`; Eigentümer schiebt, die Spalte „liest“ nennt die Abnehmer):

  | Ereignis | Nutzlast | von | liest |
  |---|---|---|---|
  | `placeDiscovered` | `place` (Slot-Id), `ortstyp`, `variante`, `biome`, `x`, `y`, `layer` | B | G (Chronik, Stats, Aufgaben), A (Stinger), B (Karte) |
  | `placeRevealed` | `place`, `ortstyp`, `quelle` (`kartentisch`\|`aufgabe`\|`haendlerin`) | B | G, Karte |
  | `placeChestOpened` / `placeLooted` / `placeCleansed` | `place`, `ortstyp` (+ `chest`, `stufe`, `tx`, `ty`) | B | G |
  | `placeGuardsReturned` / `placeNoteRead` / `placeDugUp` | `place`, `ortstyp` (+ `anzahl` bzw. `tx`, `ty`) | B | G (Chronik, Statistiken), UI (Notiz) |
  | `towerClimbed` | `place`, `ortstyp`, `radiusTiles`, `x`, `y`, `layer` | B | Karte, G |
  | `shrineBlessed` | `place`, `ortstyp`, `zustand`, `sekunden` | B | G |
  | `mapMarked` / `mapUnmarked` / `mapRenamed` | `id` (+ `symbol`, `layer`, `tx`, `ty`) | B | G, A (Klang) |
  | `worldEventAnnounced` / `worldEventStarted` / `worldEventEnded` | `event`, `startTick`, `endTick` (beim Ende `grund`) | B | G (Funke-Kanal, Chronik), A (Klang), Render (Himmel/Grading) |
  | `lightningStruck` | `layer`, `x`, `y`, `ziel` (`baum`\|`bauteil`\|`metall`\|`boden`), `entzuendet` | B | A (Donner mit Verzögerung), Render (Blitz) |
  | `meteorImpact` / `lumenShardFell` | `layer`, `x`, `y` | B | A, Render, G |
  | `vaultEntered` / `vaultCompleted` | `vault` (Slot-Id) | C | G, A (Musik) |
  | `puzzleSolved` | `vault`, `puzzle` (Instanz), `typ` | C | G, A |
  | `vaultTrapTriggered` | `vault`, `trap`, `typ`, `x`, `y` | C | A, Render (Name getrennt von den M6-Fallen `trapSprung`) |
  | `vaultDoorUnlocked` | `vault`, `door`, `schluessel` | C | A, G |
  | `tabletRead` | `tablet` | C | G (Wissen, Chronik, Erfolg) |
  | `cropPlanted` / `cropHarvested` / `cropDied` | `crop`, `layer`, `tx`, `ty` (+ `qualitaet`, `anzahl` bzw. `grund`) | D | G, E (Stats) |
  | `plotWatered` / `plotFertilized` / `pestAppeared` / `pestCured` / `canFilled` | `layer`, `tx`, `ty` (+ `item` bzw. `art`) | D | G, A |
  | `plotCreated` / `plotRemoved` / `cropRipe` / `cropCleared` / `saplingPlanted` / `saplingGrown` / `wormFound` | `layer`, `tx`, `ty` (+ `beet`, `reason`, `crop`, `item`, `object`) | D | A, G |
  | `fishCast` / `fishBite` / `fishHooked` / `fishLeap` / `fishCaught` / `fishLost` / `castEnded` | `layer`, `x`, `y` (+ `gewaesser` beim Wurf, `fish` ab dem Anhaken, `grund` bei Verlust und Ende) | D | G, A, UI (Angel-HUD) |
  | `fishTrapPlaced` / `fishTrapCaught` / `fishTrapEmptied` / `fishTrapTaken` / `iceHoleCut` | `layer`, `tx`, `ty` (+ `fish` bzw. `anzahl`) | D | G (Statistik `gefangen` beim Leeren), A |
  | `mealEaten` | `item`, `effekte[]`, `ueberdruss` (0–1), `kueche` | E | G |
  | `foodSpoiled` | `item`, `count`, `behaelter` | E | G |
  | `bossAwakened` / `bossPhaseChanged` / `bossDefeated` / `bossReset` | `boss` (+ `phase`, `dauerTicks`, `grund`; `x`, `y` beim Erwachen und Sieg) | F | A (Musik, Stinger), G, UI (Titelkarte, Balken) |
  | `bossTelegraph` / `bossAttack` | `boss`, `angriff`, `x`, `y`, `angle` (+ `ticks`, `flaeche` beim Telegraph) | F | Render, A |
  | `beaconIgnitionStarted` / `beaconLit` | `beacon` (1–6), `biome`, `x`, `y` | F | A (Stinger), Render, G, UI (Vision) |
  | `unlockGranted` | `unlock`, `quelle` | F | G, UI (Meldung) |
  | `shardUsed` | `art` (`herz`\|`glut`), `gesamt`, `item` | F | G |
  | `travelOpened` / `travelled` / `travelPointRenamed` | `von`, `kind` bzw. `von`, `nach`, `kind`, `kosten`, `x`, `y`, `layer` bzw. `wegstein`, `name` | F | UI (Reisebildschirm) bzw. G, A |
  | `questStarted` / `questStepCompleted` / `questCompleted` | `quest` (+ `schritt`) | G | UI, A |
  | `achievementUnlocked` | `achievement` | G | UI, A |
  | `chronicleEntryAdded` | `entry`, `art` | G | UI |
  | `guideHint` | `hint`, `kanal` (`funke`\|`hinweis`) | G | UI (Funke, Hinweiszeile), A |
  | `instrumentPlayed` / `instrumentStopped` | `instrument`, `lied` (+ `layer`, `x`, `y` bzw. `grund`) | A | A (Wiedergabe), G |
  | `netSwung` | `fang` (Item oder `null`), `layer`, `x`, `y` | A | G (Statistik `gefangen` mit Fang), A |
  | `worldSettingsChanged` | `schwierigkeit`, `feld` | H | G (Chronik), UI |
  | `appearanceChanged` | – | I | Render (Figur) |

  Bestehende Ereignisse, die M7 liest (nicht ändern): `itemEaten`, `waterDrunk`, `craftCompleted`, `recipeDiscovered`, `tileDug`, `harvested`,
  `treeFelled`, `combatantDefeated`, `creatureDied`, `carcassCarved`, `bestiaryUnlocked`, `skillLevelUp`, `perkChoiceOpened`, `perkChosen`,
  `playerDied`, `playerRespawned`, `partPlaced`, `stationOpened`, `stationProduced`, `itemsAdded`, `sleepEnded`, `playerRoomChanged`,
  `survivalStageChanged`, `fearStageChanged`, `dailyTick`.
- **Haken in bestehenden Systemen** (kleine Einfügungen; wer sie einbaut, steht in der Spalte „baut“; nur diese Wege, keine Abkürzungen):

  | Wirt | Haken | baut | nutzt |
  |---|---|---|---|
  | `Simulation` / `EventQueue` | `observeStep`, `EventQueue.forEachFrom` | Welle 0 | G, B (Karte) |
  | `ToolsSystem` | `addItemUse(handler)` (`src/game/tools/itemUses.ts`): `player.useItem` fragt nach den eingebauten Benutzungen (Essen, Verband, Eimer, Licht, Falle, Erde) die betroffenen Halter (`handles`) der Reihe nach, bevor er `notUsable` meldet bzw. die Primärtaste schlägt; Kontext (gehaltener Datensatz): Platz, Stapel, Datensatz, Ziel (genannte Kachel, sonst die gezielte `player.aim`, sonst keins), `named`, `primary`, Tick | Welle 0 | D (Saat, Setzling, Gießkanne, Dünger, Angel), E (Trinkschlauch), F (Splitter, Bauplan), C (Ortskarte), A (Instrument, Netz) |
  | `CreatureSystem` | `addSpawnBlocker`, `spawnOwned`, `onOwnedDeath`, `countOwned`, `despawnOwned` (`src/game/creatures/owned.ts`); optionale Felder `besitzer` und `leine` (eigene Leine aus `leashTiles`) im Kreaturzustand und im Chunk-Bestand; Spawn in einen eingefrorenen Chunk geht direkt in seinen Bestand (`NULL_ENTITY`); Besitz-Kreaturen zählen nicht zum Wildbestand, Fallen im Eingefrorenen fangen sie nicht; Sperren gelten für Erstbesiedlung, Nachwuchs (aktiv und eingefroren), Nachtspawner und Nachtmahr | Welle 0 | B (Ortswächter), C (Gewölbe, Mimik), F (Zweiglinge, Zonenschutz), H (Friedlich) |
  | `GatheringSystem` | `onTilled(listener: TilledListener)` (Acker angelegt/zugeschüttet; Typ aus Welle 0), Setzling-Wachstum im Objektzustand (`growth` 0…1) | D | D |
  | `GatheringSystem` | `addDigFinds` (Schaufel auf Ortsmarke „Buddelstelle“) | B | B |
  | `RoomsSystem` | `enclosedAt` (Einfriedung ohne Dachbedingung) | D | D (Hasen) |
  | `ActionsSystem` | `addEatHook` (Nährwert anpassen, nach dem Essen), `addDrinkHook` | E | E |
  | `ConditionsSystem` | `addGroupLimit('mahlzeit', 2)` | E | E |
  | `CraftingSystem` | `useUnlocks(api)` (Rezepte mit `freischaltung`) | F | F, C |
  | `CraftingSystem`, `StationSystem` | Werkstatt-Rückruf reicht die Station durch (`useWorkshops((s, layer, tx, ty, station) => …)`) | E | E (Küche) |
  | `LightSystem` | Verhalten `lumen` (Ladung, Aura, Absaugen durch Lichtfresser) | F | F |
  | `DeathSystem` | `RESPAWN_SPOTS` += `arena`, `addArenaSpots` | F | F |
  | `WorldSettingsSystem` (neu) | `factors()` (Hunger/Durst, Gegnerschaden, Ausholzeit), `peaceful()`, `logisticsRealism()`; `world.setDifficulty` delegiert an das vorhandene `DeathSystem.setDifficulty` | H | `vitals`, `creatures`, `bosses` (F), `travel` (F), Spawnsperre |
  | `Calendar` | `addDaylightModifier(fn: DaylightModifier)` (Sonnenfinsternis; Typ aus Welle 0) | B | B, Render |
  | `VitalsSystem` | Schadensursachen `falle` (C), `blitz` (B); Faktoren Hunger/Durst aus `world-settings` (H) | C, B, H | – |
  | `PerkEffects` (neu, `src/game/skills/perkEffects.ts`) | `value(effekt)` = Summe der Werte gewählter Perks dieser Wirkungsart (liest `SkillsSystem.skill(id).perks`) | G | G (Holzfällen, Bergbau, Sammeln, Handwerk, Schmieden, Überleben über Haken in `gathering`, `crafting`, `stations`, `vitals`, `player`), E (Kochen) |
  | `WeatherSystem` (`src/world/climate/weather.ts`) | `addPeriodListener(fn: WeatherPeriodListener)`: jede Wetterperiode (Region, Zustand, Beginn-/Endminute) beim Entstehen (Typ aus Welle 0) | D | D (Klimaprotokoll), E (Regensammler) |
  | `RoomsSystem` | `craftTempoAt(s, layer, tx, ty, station?)`: Küche +20 % an Koch-Stationen | E | `crafting`, `stations` |
  | `CraftingSystem` / `StationSystem` | Stationsfeld `feuer`: Handwerk an der Station nur mit brennendem Feuer (Lagerfeuer, Kamin, Herdfeuer) ≤ 1 Kachel daneben; sonst Ablehnung `noFire` | E | E (Kessel) |
  | `InventorySystem`, `StorageSystem`, `StationSystem`, `DropSystem`, `DeathSystem` | `forEachPerishable(sim, chunk, visit)` (`PerishableContainerSource`, `src/game/spoilage/types.ts`): je verderblichem Stapel Behälterart, Ort, Ersetzen | E | E (Verderb-Takt) |
  | `FearSystem` | vorhandenes `addSurroundings` | – | A (Musizieren), F (Leuchtfeuerzone) |
  | `InteractionSystem` | vorhandenes `addUses` | – | alle (E-Ziele) |
  | `BuildingSystem` | vorhandenes `addPartListener` | – | D (Beete), F (Wegsteine), E (Regensammler) |
  | Weltgenerator | Schritte `orte` und `gewoelbe`, Felder `GeneratedWorld.placeLayouts` (B), `vaults` (C), Reservierung im Untergrundplan (C), `resourceDensity` (H) | B, C, H | – |

## 18. Orte, Karte, Weltereignisse (M7-07 … M7-09, M7-38 … M7-40, M7-49) – `src/game/places/`, `map/`, `worldevents/`

- **Ortsinstanzen** sind die Slots von `GeneratedWorld.locations` (`LocationSlot.id` = Orts-Id im Spielstand). Gefüllt wird ein Slot, wenn die
  Sammlung `locationTypes` (`PlaceDef`, Id = `LocationType`, `src/content/places/`) für seinen Typ eine Vorlage seines Bioms hat; alle
  anderen Slots bleiben die freie Scheibe aus M2 (kein Marker, keine Entdeckung – kein halber Ort).
- **Aufbau im Weltgenerator** (`src/world/gen/places/`): Vorlagen als ASCII (`src/content/places/layouts/<ortstyp>_<biom>_<nn>.ts`, Legende →
  Boden-Terrain, Welt-Objekt, Marke). Die Vorlage je Slot wählt der Schritt `orte` rein aus (Seed, Slot-Id) → `GeneratedWorld.placeLayouts`
  (Vorlage, Drehung/Spiegelung, Marken mit Weltkoordinaten: `truhe`, `waechter`, `tafel`, `leuchtfeuer`, `altar`, `eingang`, `aussicht`,
  `buddel`). Der Chunk-Generator stempelt Boden und Objekte in die Oberflächen-Chunks (`TILE_FLAG_PLACE` bleibt). `WORLD_GEN_VERSION` ist 2
  (ADR-0215); die Hash-Snapshots der Weltgenerierung setzt der Integrator bewusst neu (M7-80); alte Spielstände laden mit `generatorChanged`
  (geänderte Kacheln behalten ihre gespeicherten Werte).
- **Stempelregel** (`stampRight`, dieselbe Regel für Auswahl und Stempeln): gestempelt wird nur trockenes Land auf Ortshöhe – keine Rampe, Furt,
  Lava, Brücke oder Höhle; auf einer Straße nur die Marke. Brückenruinen stehen am Brückenkopf (reserviert). Im Umkreis von
  `BALANCE.places.startClearTiles` = 40 Kacheln um den Startstrand bleibt jeder Slot ohne Gestalt (**Startlichtung**: der Bauplatz des Anfangs
  bleibt frei).
- **Ortsobjekte:** neue Welt-Objektart `ort` (`WORLD_OBJECT_KINDS`), Ids `ort_<name>`, Sprite gleich Id (`assets-src/sprites/orte/**`),
  blockierend nach Footprint. Truhen `ort_truhe_1…3` (Stufe) werden beim Öffnen zu `ort_truhe_offen` (Chunk-Diff) und im Teilnehmer
  vermerkt; Beute aus `placeLoot` (`src/content/places/beute.ts`, Id `ort_<ortstyp>_<stufe>`), gezogen mit `hash(Seed, Ort, Truhe)` –
  unabhängig davon, wann der Spieler öffnet.
- **Entdeckung:** Spieler auf Ebene 0 innerhalb `PlaceDef.entdeckungTiles` um den Slot-Mittelpunkt (Standard Slot-Radius + 4) →
  `placeDiscovered` (einmal je Slot): Stinger (A), Chronik (G), Kartenmarker (automatisch), Meldung „Entdeckt: …“. Karten (Kartentisch,
  später Händlerin) decken über `PlacesApi.reveal` auf → `placeRevealed` (Marker, kein „betreten“).
- **Wächter und Rückkehr:** `PlaceDef.waechter` spawnt `places` bei der Entdeckung an den Marken `waechter` über
  `CreatureSystem.spawnOwned` (Besitzer `ort:<slot>`, Leine `leineTiles` bzw. `BALANCE.places.guardLeashTiles`); sie leben im Chunk-Bestand wie
  jede Kreatur. Sind alle besiegt (`onOwnedDeath`), ist der Ort **gereinigt** (`placeCleansed`). Nach `BALANCE.places.returnDays` (7) kehren
  ⌈`returnShare` (0,5) × Anzahl⌉ zurück (`placeGuardsReturned`; absoluter Tick, kein Aufholen nötig: fällig ist fällig – beim ersten Welt-Tick ab
  dem Rückkehr-Tick, notfalls in den Bestand eines eingefrorenen Chunks), der Zustand wechselt zurück auf „nicht gereinigt“. Truhen kehren nie
  zurück; alle geöffnet = **geplündert** (`placeLooted`). Tabellen-Spawns bleiben aus dem Rechteck eines Ortes heraus (Spawnsperre): seine
  Kreaturen sind seine Wächter.
- **Wirkungen** (`PlaceDef.wirkung`): `aussicht` (Aussichtsturm: E an der Marke `aussicht` → Karte deckt Radius 80 auf, `towerClimbed`),
  `segen` (Schrein: E an der Marke `altar` → Zustand `gesegnet` für `sekunden` = 600 s, erneut nach `abklingTage` = 3; `shrineBlessed`),
  `buddeln` (Buddelstelle: die Schaufel auf der Marke `buddel` gibt einmal `placeLoot` `ort_<ortstyp>_<stufe>` statt Erde – Haken
  `gathering.addDigFinds`, `placeDugUp`), `tafel` (Gehöft, Eremitenhütte, Friedhof: E an der Marke `tafel` liest die Notiz des Ortes →
  `placeNoteRead`, die HUD-Notiz zeigt den Text; sobald C einen Leser über `PlacesSystem.addTabletReader` anmeldet, die Erbauer-Tafel, die die Marke
  nennt → `tabletRead`), `krater` (Meteoritenkrater: Knoten `erz_sternenerz` als Ortsobjekte), `leuchtfeuer` (Stätte; das Leuchtfeuer selbst
  gehört `beacons` und steht an der Marke `leuchtfeuer`), `keine`. `krater`, `leuchtfeuer`, `gewoelbe`, `arena` und `keine` tun in `places` zur
  Laufzeit nichts (Erzknoten sind Objekte; Leuchtfeuer, Gewölbe und Arenen gehören ihren Systemen).
- **Ortstypen M7** (10, zählen als `locationTypes`): `leuchtfeuer` (Leuchtfeuer-Stätte), `aussichtsturm`, `gehoeft`, `schrein`, `naturwunder`
  (Variante `uraltbaum`), `buddelstelle`, `eremitenhuette`, `brueckenruine`, `friedhof`, `meteoritenkrater` – je mit Vorlage für `gruenhain`;
  insgesamt 55 Ortsvorlagen (`src/content/places/layouts/`) über die Oberflächenbiome außer `nachtherz`, damit die Slots der anderen Biome
  ebenfalls eine Gestalt haben (`leuchtfeuer` und `naturwunder` nur `gruenhain`; Naturwunder Geysirfeld für `aschenschlund` und Kristallbogen für
  `scherbenhain` folgen mit M7-82). Nicht gezählt, aber als `PlaceDef` vorhanden: `gewoelbe` (C), `bossarena` (F, Vorlage in
  `src/content/bosses/arena.ts`).
- **Karte** (`map`): Aufdeckung je Ebene als Bitmaske in Kartenzellen zu `BALANCE.map.cellTiles` = 4 × 4 Kacheln (Mittel: 384² Zellen =
  18 432 B je Ebene; im Teilnehmer lauflängen- und Base64-kodiert). Radius 20 Kacheln + `heightBonusTiles` je Höhenstufe über 0; Aussichtsturm 80;
  Aktualisierung nur beim Zellwechsel des Spielers, ohne Allokation. Eigene Marker (höchstens 64): Symbol aus `MAP_MARKER_SYMBOLS`, Name
  ≤ 24 Zeichen, Kachel, Ebene; Befehle `map.mark`, `map.unmark`, `map.rename`; Debug `map.reveal {layer?}` (Konsole `reveal`). Automatische
  Marker werden abgeleitet, nie gespeichert: entdeckte/aufgedeckte Orte (`places`), Leuchtfeuer (`beacons`), Grab (`death`), Basen (`hearth`),
  Aufgabenziel (`quests`), Händlerin (M9). Die Minimap zeigt ab M7 ebenfalls nur Aufgedecktes (Chunkmaske aus den Zellbits, stufiger Rand).
  Die Terrainklasse je Zelle leitet `MapTerrain` (`src/game/map/terrain.ts`) ohne Chunks aus dem Weltplan ab, nur für aufgedeckte Zellen und
  höchstens 1 500 Zellen je Frame des Kartenbildschirms (ADR-0216). **Kartenbildschirm** (M): Pergament-Leinwand in Palettenfarben im
  480 × 270-Referenzrahmen, Zoom 1/2/4/8 Designpixel je Zelle (Start 4). Beschriftungen ohne Überdeckung: eigene Marker zuerst, ein Name steht
  unter dem Symbol, sonst darüber, sonst keiner (dann nur im Tooltip); am Bildrand wird er nach innen verschoben. Debug-Konsole:
  `reveal [tiefe]`, `event <id> [an|aus]`, `strike [dx] [dy]`.
- **Weltereignisse** (`world-events`, Register `worldEvents` mit allen 11 Einträgen §10): Planung je Spieltag deterministisch aus
  `hash(Seed, 'weltereignis', Id, Tag)` (kein fortlaufender Strom – Zeitsprünge und Laden ändern die Planung nicht); Ablauf
  `ruhe` → `angekuendigt` → `aktiv` → `ruhe` (Ereignisse `worldEventAnnounced`, `worldEventStarted`, `worldEventEnded`); höchstens ein großes Ereignis gleichzeitig (Finstermond läuft daneben). Ankündigung über alle Kanäle:
  Himmel/Grading (Render liest `sampleWorldEvents`), Klang (A), HUD-Meldung mit Restzeit, Funke (G über `ankuendigung.funke`), Chronik (Regel auf
  `worldEventStarted`). Validator-Regel `ereignisse` (B): umgesetztes Ereignis ohne Ankündigung oder Chronik-Text DE/EN ⇒ Fehler.
  Umgesetzt in M7: `finstermond` (Planung `mond`, Ankündigung am Abend), `lumenregen` (klare Nacht; glühende Scherben `lumen_scherbe` fallen als
  Drops in der aktiven Zone, `lumenShardFell`, selten ein Meteorit: Einschlag `meteorImpact` + `sternenerz`), `sonnenfinsternis` (selten,
  tagsüber, eine Spielstunde Nacht über `Calendar.addDaylightModifier` – Lichtkarte, Schattenbrut, Furcht und Himmel lesen denselben Wert;
  unter `BALANCE.worldEvents.eclipseNightBelow` = 0,3 gilt die Tagesphase als Nacht, ADR-0217), `waldbrand` (Sommer, Trockengewitter: Blitz in
  Baum → `FireSystem`; die Feuersimulation sieht an diesem Tag keinen Regen, das Bild zeigt Asche statt Regen, ADR-0218). Die übrigen sieben
  tragen `umgesetzt: { task }` (M8-37, M9, M10). Der Teilnehmer `world-events` migriert von Datenversion 0 zum Register in Ruhe (ältere
  Spielstände laden).
- **Blitze** (`worldevents/lightning.ts`): bei Wetter `gewitter` je Region und Spielminute eine Ziehung `hash(Seed, 'blitz', Region, Minute)`;
  eingeschlagen wird nur in der aktiven Zone; Zielwahl im Suchradius `strikeSearchTiles`: Metall (`metalObjects`) vor hohen Dingen (stehender Baum, Wand, Säule, Tor, Tür, Zaun oder Fenster des Bauraster, hohes Weltobjekt `tallObjects`) vor offenem Boden, je Art das nächste; Baum oder
  brennbares Bauteil entzündet mit Chance (`fire.ignite`), Spieler in der Nähe: Schaden Ursache `blitz`. Ferne Blitze (Donner ohne Einschlag) sind
  reine Darstellung. Den Blitzableiter (M8-46) trägt ein Schutz-Haken ein.

## 19. Gewölbe, Rätsel, Fallen, Belohnungen, Forschung, Tafeln (M7-10 … M7-14, M7-16, M7-18, M7-46) – `src/game/vaults/`, `puzzles/`, `research/`

- **Innenebene:** Ein Gewölbe liegt in Ebene −1 in einem reservierten Kasten (≤ 80 × 80 Kacheln, `BALANCE.vaults.boxTiles`) um die Kachel seines
  Eingangs. Der Untergrundplan hält Höhlen, Seen, Schächte, Höhlenorte und Höhleneingänge aus allen Kästen heraus
  (`createUndergroundPlan({ …, reserved })`); die Hülle ist unabbaubares Erbauer-Gestein (`erbauerstein`, `solid`, Härte über jeder Abbaukraft),
  die Böden `erbauerboden`. Eingang = dieselbe Kachel in Ebene 0 (Treppe, `TILE_FLAG_STAIRS`) und −1 (Rampe, `TILE_FLAG_RAMP`), Verbindungsart
  `gewoelbe` in `UndergroundPlan.links` (wie Höhleneingänge, WORLD.md §3). Im Kasten trägt das Biom-Feld das Biom des Eingangs (Tileset,
  Tönung); Kacheln im Kasten tragen `TILE_FLAG_PLACE`; zufällige Spawns verhindert eine Sperre, die C für die Kästen über
  `CreatureSystem.addSpawnBlocker` (Haken aus Welle 0) einträgt – das Flag allein sperrt nichts. Die Innenebene braucht keine neue
  Ebene −4 (ADR-0207).
- **Generator** (`src/world/gen/vaults/`, Schritt `gewoelbe` nach `orte`, vor `untergrund`, rein aus Seed + Slot-Id + Content):
  1. Graph-Grammatik: Start → Räume → Schlüssel und Schlösser → Rätsel → Endkammer (Mini-Boss, Endtruhe); 5–9 Räume, genau eine Endkammer
     hinter mindestens einem Schloss und einem Rätsel; jeder Schlüssel liegt in einem Knoten, der vom Start ohne sein eigenes Schloss erreichbar
     ist; verborgene Wände als Kanten der Art `verborgen` (optional, nie auf dem einzigen Weg).
  2. Einbettung: Raumvorlagen (`roomTemplates`, ASCII in `src/content/dungeons/<tileset>/`) im Raster aus Zellen zu 16 × 16 Kacheln (5 × 5
     Zellen), Türen an Vorlagen-Türen, Gänge aus Gang-Vorlagen.
  3. Belegung: Rätsel-Instanzen (Typ + Variante), Fallen, Truhen (Stufe nach Tiefe), Gegner (Mimik, Fallengeist, Konstrukt; Mini-Boss in der
     Endkammer), Erbauer-Tafeln, Glutsplitter-Slot.
  4. **Vielfalt** (§32 „1 Gewölbe mit ≥ 4 Rätseltypen“): das dem Startstrand nächste Grünhain-Gewölbe jeder Welt bekommt ≥ 4 verschiedene
     Rätseltypen (Grammatik-Parameter `mindestRaetseltypen`, sonst 1–3); alle übrigen Gewölbe mischen frei.
  Ergebnis `GeneratedWorld.vaults: VaultPlan[]` (nicht im Spielstand). Test `tests/unit/world/gewoelbe-grammatik.test.ts`: 100 Seeds lösbar
  (reine Graph-Ebene, ohne Weltgenerierung, < 1 s); `tests/integration/gewoelbe-welt.test.ts`: Einbettung und Stempel über die Seeds der
  bestehenden `weltgen-validierung.test.ts` (Weltcache, keine neuen Welten), ≥ 3 Grünhain-Gewölbe je Welt „Mittel“, Vielfalt-Regel erfüllt,
  Glutsplitter-Verteilung (12 reservierte Plätze, Grünhain-Anteil vorhanden).
- **Laufzeit** (`vaults`, global): Türen und Schlösser (Schlüssel `gewoelbeschluessel` mit `daten.gewoelbe = <Id>`; nur im eigenen Gewölbe
  gültig), Rätselzustände über die reinen Regeln von `puzzles/`, Fallen (bereit → ausgelöst → Abklingzeit; Rollsteine rollen und setzen nach
  `resetSekunden` zurück; einstürzender Boden bleibt offen: Chunk-Diff), Truhen, Wächter (`spawnOwned` mit Besitzer `gewoelbe:<id>`),
  `vaultEntered`/`vaultCompleted` (Mini-Boss besiegt + Endtruhe offen). Kisten, geschlossene Türen und unentdeckte verborgene Wände liegen als
  Kollisions-Overlay (`WorldCollision.addOverlay`) auf dem Raster. Dauerbewegte Teile (Pendelklingen) sind reine Funktionen des Ticks – im
  Eingefrorenen läuft nichts.
- **Rätseltypen M7** (je ≥ 3 Varianten, jede per Löser lösbar – Solver-Test je Variante): `kisten` (Kisten auf Druckplatten; E an der Kiste
  schiebt sie eine Kachel vom Spieler weg, `vault.push`; Platten erkennen Kisten und Spieler), `hebel` (Hebelfolge, Hinweis als Wandbild; falsche
  Folge setzt zurück), `feuerschalen` (Reihenfolge entzünden: Fackel/`light.ignite` an der Schale, `vault.use`), `verborgene_wand` (Luftzug-Partikel,
  E oder Schlag öffnet), `glocken` (Tonfolge nachspielen; Hinweis-Tonfolge an einer Inschrift abspielbar). Befehl `vault.use {tx, ty}` für Hebel,
  Schalen, Glocken, Wände.
- **Fallen M7** (`vaultTraps`, Gefahren-Bildsprache §4.6/ART §7, Telegraph ≥ 0,4 s, Schaden Ursache `falle`, Kreaturen lösen ebenfalls aus):
  `speerfalle`, `pfeilwerfer`, `rollstein`, `fallgrube`, `einsturzboden`, `pendelklinge`.
- **Belohnungen:** Truhen nach Stufe (`placeLoot`-Tabellen `gewoelbe_<biom>_<stufe>`), einzigartige Baupläne (`bauplan_<ziel>`: Benutzen →
  `unlocks.grant`), Relikte (`relikt_<name>`, am Forschungspult studiert → Bauplan), Erbauer-Tafeln, **Glutsplitter** (12 weltweit: die
  Verteilung reserviert 12 Slots über die Gewölbe aller Biome deterministisch nach Slot-Reihenfolge; Grünhain-Gewölbe enthalten ihren Anteil;
  Gesamtprüfung M12-07).
- **Forschungspult** (`forschungspult`, Station, Verarbeitung ohne Brennstoff): Eingang Relikt, Dauer, Ausgang `bauplan_<ziel>` (ein Item – so
  bleibt das Studieren im Handwerk, die Freischaltung entsteht beim Benutzen des Bauplans). **Kartentisch** (`kartentisch`, Handwerk): Rezepte
  `ortskarte_<ortstyp>`; Benutzen → nächster unentdeckter Ort des Typs wird aufgedeckt (`PlacesApi.reveal`, Quelle `kartentisch`).
- **Erbauer-Tafeln** (`tablets`, `tafel_01…10`): Titel, Text DE/EN, Fundort (Gewölbe-Rolle bzw. Ortstyp); Welt-Objekt `erbauer_tafel` an der Marke;
  E → `tablet.read {tablet}` → `tabletRead` → Chronik-Wissen (G). Die Tafel-Id je Marke steht im Plan (Gewölbe) bzw. in `placeLayouts` (Orte).

## 20. Landwirtschaft, Bäume, Angeln (M7-19 … M7-24) – `src/game/farming/`, `fishing/`

- **Acker:** Die Hacke legt wie bisher Acker an (`erde` + „gegraben“, `tileDug.result = 'feld'`); über `gathering.onTilled` legt `farming` das
  Beet-Datum an, Zuschütten oder Überbauen löscht es. Beet-Bauteile `beet_holz`, `beet_stein` (Möbelkategorie `beet`, Ebene `objekt`, 1 × 1)
  sind Acker ohne Hacke, auch auf gebauten Böden (Gewächshaus). Daten je Kachel im `FarmStore` je Chunk-Adresse (gepackte Spalten, §28):
  Feuchte 0–100, Fruchtbarkeit 0–100 (Start `BALANCE.farming.startFertility`), Pflanze, Stufe, Tage in Stufe, Qualitätspunkte, Schädling,
  zuletzt gegossen (Tag), Zahl der Ernten.
- **Handlungen** (alle über `ToolsSystem.addItemUse` bzw. E-Ziele): Säen mit Saat (Item-Block `saat`; Saaten sind Kategorie `saatgut` – mit
  `saat` statt `pflanzt` – und zählen als Verwendung „Einpflanzen“) → `farm.plant`; Gießen mit
  `giesskanne` (Ladungen, am Wasser füllen) → Feuchte 100, `plotWatered`; Düngen (Item-Block `duenger`: `kompost` +30, `knochenmehl` +20;
  Dung +15 und Guano +40 kommen mit M8-42/M8-13) → `plotFertilized`; Ernten per E → `farm.harvest` (Ertrag, Qualität, Saat nach `nachwuchs`,
  −10 Fruchtbarkeit); mehrfach tragende Pflanzen fallen auf `nachwuchs.stufe` zurück.
- **Wachstum um 06:00** (aktive Chunks im `dailyTick`, eingefrorene im `catchUp` – dieselbe Funktion je überschrittenem 06:00): Stufe +1 nach
  `tageJeStufe`, wenn Feuchte > 20, Jahreszeit ∈ `jahreszeiten` (oder Gewächshaus) und T_min > 2 °C; Frost (T_min < 0 °C) tötet
  Nicht-Winterpflanzen im Freien (`cropDied`, Grund `frost`). Feuchte: Regen des Vortags → 100, sonst −`dailyDrying` (Temperaturfaktor); Wasser
  innerhalb `waterNearTiles` hält `waterNearMoisture`. Zufall je Kachel und Tag aus `hash(Seed, Ebene, tx, ty, Tag)`.
- **Klimaprotokoll** (`farming/climateLog.ts`, Daten im Teilnehmer `farming`): Die Wettergeschichte ist eine reine Funktion von Seed, Biomen
  und Kalender (`src/world/climate/weather.ts`: Wechsel k der Region r aus `hash(Seed, 'weather', r, k)`). Das Protokoll hört deshalb nicht im
  Welt-Tick mit, sondern bekommt jede **Wetterperiode** beim Entstehen (`WeatherSystem.addPeriodListener`: Region, Zustand, Beginn- und
  Endminute) und fasst sie je Region und Spieltag (06:00 → 06:00) zusammen: `regen` (eine Periode mit Niederschlagsart `regen` ≥
  `BALANCE.farming.rainThreshold` überlappt den Tag), `regenMinuten` (Summe der Überlappung), `minOffsetC` (kleinster Temperaturversatz der
  überlappenden Perioden). T_min einer Kachel = `biomeTemperatureC(Biom, Jahreszeit, kälteste Stunde)` + Höhenterm + `minOffsetC` – exakt,
  weil Biom und Höhe konstant sind. `ClimateLog.ensureUntil(sim, minute)` ruft vor jedem Lesen `WeatherSystem.advanceTo(minute)` (idempotent,
  rein): so kennt auch das Aufholen nach einem Zeitsprung (`skipTicks`, bei dem kein Welt-Tick läuft und die Zone vor dem Wetter aktiviert)
  jeden übersprungenen Tag. Verworfen werden Tage, die kein eingefrorener Farm-, Reusen- oder Regensammler-Chunk mehr braucht, plus
  `climateSpareDays` (1) Reservetag; T_min gilt um `coldestHour` (05:00), T_max um `warmestHour` (15:00) (ADR-0220). Lesen: `ClimateLog`
  (`src/game/farming/types.ts`) – auch `water` (E). **Aufholer lesen nur den übergebenen Chunk** (Terrain, Wasser, Biom aus `chunk`, nie über
  `world.chunk()`): beim Aufholen ist der Chunk noch nicht resident (ADR-0221).
- **Qualität** 1–3 (Normal/Silber/Gold = Stack-`qualitaet`) aus Fruchtbarkeit, Landwirtschaft-Skill und Hash-Zufall. **Schädlinge** (Hash je
  Kachel/Tag): Krähen (ohne Vogelscheuche im Umkreis `scarecrowTiles`) fressen Saat/Frucht; Hasen (Beet nicht eingefriedet: `rooms.enclosedAt`
  über Zäune, Wände, Tore ohne Dachbedingung) fressen Blätter; Mehltau nach ≥ 3 Regentagen in Folge, `kraeuterbruehe` heilt. `pestAppeared`.
- **Kompostkiste** (`kompostkiste`, Verarbeitungsstation, Tage): Eingang Gruppe `kompostgut` (`laub`, `fasern`, Pflanzenreste; E trägt
  `verdorbenes` ein) → `kompost`; Aufholen über die Stationen (M4).
- **Bäume aus Setzlingen** (M7-23): Setzling pflanzen (`pflanzt`) → Welt-Objekt `baum_<art>` mit Objektzustand `growth` 0 … < 1 (Sprites
  `baum_<art>_setzling`, Jungbaum), täglich um 06:00 +1/`treeGrowDays`, danach wie gewachsen; Obstbäume tragen saisonal (Fruchtzeit je Art),
  Ernte per E wie Büsche (`STAGE_HARVESTED`). Setzlinge in Basen wachsen (nur Nachwachsen gefällter Bäume ist in Basen gesperrt).
- **Gewächshaus** (ADR-0219): Beete in einem Raum vom Typ `gewaechshaus` ignorieren Jahreszeit, Frost und die 2-°C-Schwelle; Feuchte und
  Fruchtbarkeit gelten weiter, Krähen meiden geschützte Beete (`rooms.roomAt`; ein Raum ohne Dach hat keinen Typ). Räume werden nur in der aktiven
  Zone berechnet: `farming` vermerkt im Welt-Tick je Beet aktiver Chunks das Bit `sheltered`, das Aufholen eingefrorener Chunks benutzt das
  gespeicherte Bit (Bauten ändern sich im Eingefrorenen nicht). Test „Raumtyp Gewächshaus“ in `tests/unit/game/gewaechshaus.test.ts` (echtes
  Gebäude, echte Räume).
- **Angeln** (`fishing`): Angel `angel_holz` (T0: `zweig` + `fasern` + `knochenhaken` aus `knochen`), Köder (Item-Block `koeder`: `regenwurm` aus
  `graben:erde`, `grille` aus dem Netz, A), Befehle `fishing.cast {x, y}`, `fishing.reel {on}` (gehalten), `fishing.cancel`. Minispiel in der
  Simulation: Biss nach `hash(Seed, Wurf-Tick)`, Fisch zieht (Kraft, Ausdauer, Sprünge je `FishDef.kampf`), Spannung 0–1 halten – reißt bei 1,
  entkommt bei 0; die gebogene Rute ist Darstellung aus `sampleFishing`. Fischwahl gewichtet nach Biom, Gewässer (`fluss`, `see`, `meer`, `eis`),
  Tageszeit, Wetter, Jahreszeit, Köder. **Reusen** (`reuse`, in Wasser gesetzt, `fishing.placeTrap`/`fishing.takeTrap`): Fang je 06:00 per Hash,
  Aufholen je überschrittenem 06:00. **Eisangeln:** im Winter auf gefrorenem See/Fluss (Wasser-Bit „gefroren“) mit Loch (Spitzhacke) erlaubt,
  Gewässer `eis`. EP: neue Quelle `fisch_gefangen` der Fertigkeit `sammeln` (Sammeln & Kräuter; §23.2 kennt keine eigene Angel-Fertigkeit).
- **Werte Feld** (`BALANCE.farming`, gebaut in M7-19 … M7-23): Start Fruchtbarkeit und Feuchte je 50; Wachstum je 06:00 um eine Stufe bei Feuchte
  > 20 und T_min > 2 °C, Frost (T_min < 0 °C) tötet nicht winterharte Pflanzen im Freien. Austrocknen −25 Feuchte je Tag mal Temperaturfaktor
  0,5–2× (Bezug 15 °C) mal Wasserbedarf ×0,75 / 1 / 1,25; Regen des Vortags (Intensität ≥ 0,3) setzt 100; offenes Süßwasser in 2 Kacheln hält
  mindestens 60. Gießkanne 10 Ladungen. Ernte −10 Fruchtbarkeit, Mehrfachernte über `nachwuchs`. Qualität = 0,7 × mittlere Fruchtbarkeit +
  0,3 × Landwirtschaft-Stufe ± 8 (Hash), Silber ab 52, Gold ab 78. Dünger Kompost +30, Knochenmehl +20, Kräuterbrühe heilt Mehltau.
  Schädlinge je Tag: Krähen 6 % (nicht im Umkreis von 6 Kacheln um eine Vogelscheuche, nicht im Gewächshaus), Hasen 5 % (nicht in einer
  Einfriedung bis 400 Kacheln), Mehltau 30 % nach 3 Regentagen in Folge, tödlich nach 3 Tagen. Welke Pflanzen bleiben 3 Tage stehen. Setzlinge
  brauchen 8 Tage bis zum Baum, ab der Hälfte Jungbaum. Wildsaat (`WILD_SEED_DROPS`, ADR-0224): 5 % je Saatart und Pflücken, nur Sommer und Herbst
  (Kräuter → Gemüse und Kamille, Fasergras → Getreide und Flachs, Blumen → Hülsenfrüchte, Tomate, Kürbis, Beerenbusch → Erdbeere). Regenwurm 25 % je
  gehackter Kachel. Getreide und Kamille haben bis zur Küche (E) die Verwendungen Strohbündel und Kräuterbrühe (ADR-0227).
- **Werte Angeln** (`BALANCE.fishing`, M7-24): Wurf bis 6 Kacheln, Biss nach 4–16 s (ein Köder beißt ×1,5 schneller, `koeder.biss`; die Fische des Köders wiegen in
  der Fischwahl ×3, `baitPreference`), Biss-Fenster 1,5 s.
  E halten holt ein, Loslassen gibt Schnur; der Fisch zieht (Wechsel alle 0,8 s), springt (Zug ×2) und ermüdet. Spannung: Start 0,45, Einholen
  +0,6/s, Zug 0,8, lockere Schnur −0,8; bei 1 reißt die Schnur, bei 0 entkommt der Fisch (per Strategie-Simulation abgestimmt, ADR-0225). Reusen
  fangen je 06:00 mit 50 % einen Reusenfisch, höchstens 4; die Reuse ist die vierte Platzierungsart neben Bauteil, Station und Falle (`TRAP_ITEM`,
  ADR-0223). Ein Eisloch bleibt 2 Tage offen. Das Angel-Minispiel zeigt eine Platte unten mittig über dem Interaktionshinweis mit zweizeiliger
  Steuerung (ADR-0226).

## 21. Kochen, Mahlzeiten, Alchemie, Verderb, Wasser (M7-25 … M7-30, M7-60) – `src/game/meals/`, `spoilage/`, `water/`

- **Zubereitung** als Stationen und Rezepte: roh (Kategorie `nahrung`; Mitglieder der Zutatengruppe `fleisch_roh` – `wildfleisch_roh`,
  `gefluegel_roh`, rohe Fische – geben 30 % Lebensmittelvergiftung, `BALANCE.meals.rawMeatPoison`), Spieß am Feuer (Rezepte an der Station
  `lagerfeuer`, wie heute), Kessel (`kessel`, `art: 'handwerk'`, neues optionales Stationsfeld `feuer: true`: arbeitet nur mit einem brennenden
  Lagerfeuer, Kamin oder Herdfeuer ≤ 1 Kachel neben sich – „Kessel über dem Feuer“ –, sonst Ablehnung `noFire`; Rezepte aus konkreten Zutaten
  oder **Kategorien** = Zutatengruppen `gemuese`, `fleisch`, `fisch`, `pilze`, `beeren`, `obst`, `kraeuter`, `getreide`; die Wahl trifft der
  Spieler in der Handwerks-Warteschlange), Backofen (`backofen`, `verarbeitung` mit Brennstoff wie der Lehmofen: Brot, Kuchen), Trockengestell
  (besteht: Trockenfleisch), Räucherkammer (`raeucherkammer`, `verarbeitung` mit Brennstoff), Mühle (`muehle`, `verarbeitung` ohne
  Brennstoff: Getreide → `mehl`), Gärfass (`gaerfass`, `verarbeitung` ohne Brennstoff über Tage: `bier`, `beerenwein`). Verarbeitungsstationen
  wählen ihr Rezept wie heute aus dem Eingang (Zutatengruppen erlaubt) und holen analytisch auf (M4). Kochkategorie-Rezepte sind ganz normale
  Rezepte mit Gruppen-Zutaten (ADR-0039); EP über die vorhandenen Quellen `gericht_gekocht`/`trank_gebraut` der Fertigkeit `kochen`.
- **Mahlzeit-Effekte:** Item-Block `mahlzeit` (Zustände mit Dauer, `wohlfuehl` Furcht −10…−25, `salz` Durst-Punkte). Die Effekte sind Zustände
  der Gruppe `mahlzeit` (`src/content/conditions_m7.ts`, E); höchstens 2 verschiedene gleichzeitig – der älteste weicht
  (`ConditionsSystem.addGroupLimit`). **Überdruss** (Teilnehmer `meals`): je Speise ein Zähler, +1 je gegessenem Stück, um 06:00 −1,5 (nach
  2 Tagen abgeklungen); ab dem 3. Stück an einem Tag (Zähler ≥ 2 vor dem Essen) −50 % Nährwert (`itemEaten` meldet den reduzierten Wert,
  `mealEaten.ueberdruss`). **Salz:** `mahlzeit.salz` senkt den Durst-Wert beim Essen. **Wohlfühlessen:** `max(dishComfort, wohlfuehl)`;
  im Speisesaal zusätzlich `BALANCE.meals.diningHallComfort`. Alles über `ActionsSystem.addEatHook` (`nutrition` vor dem Anwenden, `eaten`
  danach).
- **Raumwirkungen** (M7-30, über `rooms.roomAt` der Station bzw. des Spielers): Küche +20 % Kochtempo an Koch-Stationen
  (`RoomsSystem.craftTempoAt(s, layer, tx, ty, station)`; Koch-Stationen = `KOCH_STATIONEN` in `src/content/balance/meals.ts`: `lagerfeuer`,
  `kessel`, `backofen`, `raeucherkammer`, `trockengestell`, `kraeutertisch`) und +10 % Wirkung (Stapel aus der Küche tragen `daten.kueche = true`; Wert/Dauer ×1,1), Speisesaal (Essen senkt
  Furcht zusätzlich), Lager (Verderb ×0,9), Eiskeller (Verderb ×0,2).
- **Tränke & Medizin** (M7-28): Kräutertisch (`kraeutertisch`, Handwerk; Alchemie II = Aufwertung M8-44) und `heiltrank`, `gegengift`,
  `fiebertee`, `wundsalbe`, `waermetrank`, `kuehltrank` (+ bestehend `verband`, `schiene`); Item-Block `trank` (Zustände geben, Zustände heilen,
  Soforteffekte). Konsum über `action.eat` (Kategorien `trank`/`medizin` sind Verbrauchsgüter) bzw. `player.useItem` wie der Verband.
- **Verderb** (`spoilage`, Verderb-Takt je Spielstunde):
  - Jeder verderbliche Stapel (Item mit `frische` = Haltbarkeit in Tagen) trägt seine Frische 0–100 wie heute im Stapel (`ItemStack.frische`);
    alle Leser (Essen, Tooltip, Stapeln mit `weightedFreshness`) sehen den gültigen Wert – keine Rechnung in der Präsentation.
  - **Takt:** einmal je voller Spielstunde (Welt-Tick, in dem `floor(Spielminute / 60)` wechselt) zieht `spoilage` jedem verderblichen Stapel der
    Taschen und aller Behälter **aktiver** Chunks `n × verlust(Item, Faktor)` ab; `n` = Stunden seit dem Stempel des Behälters (normal 1, nach
    `skipTicks` mehr). Behälter melden ihre Stapel über `forEachPerishable` (Taschen, Kisten/Vorratsfass, Stationsplätze, Drops, Gräber; `src/game/spoilage/types.ts`).
  - **Exakt und zerlegbar:** `verlust = round(100 × faktor / (Tage × 24) × 2^16) / 2^16` ist eine Dyadenzahl; `n × verlust` und n-faches Abziehen
    sind in float64 bitgleich, wenn auch jede Frische auf dem Raster 2^-16 liegt: `quantizeFreshness` (neu, `src/game/items/formulas.ts`, E)
    rundet `weightedFreshness` (Stapeln) und `inventory.give {frische}` darauf (|Wert| ≤ 100 ⇒ ≤ 23 Bit Mantisse, jede Summe exakt). Damit ist
    „aktiv durchgelaufen“ ≡ „eingefroren + aufgeholt“ ≡ „a → b → c“ ohne Sonderfälle.
  - **Stempel:** aktive Behälter teilen den globalen Stempel (`spoilage.lastHour`); beim Einfrieren eines Chunks speichert `spoilage` je Chunk den
    Stempel und je Behälter den Faktor (Räume werden nur in der aktiven Zone berechnet), `catchUp(chunk, from, to)` zieht die Stunden bis
    `floor(to)` ab – geteilt an den Jahreszeitwechseln (Faktor „Winter im Freien“), sonst mit dem gespeicherten Faktor.
  - Frische 0 → der Stapel wird an Ort und Stelle zu `verdorbenes` (gleiche Anzahl, Kompostgut, `foodSpoiled`). Stufen wie bisher
    (`FRESHNESS_STAGES`: frisch ≥ 60, alt 20–60 −25 % Wert, faulig < 20 Vergiftungsrisiko).
  - Faktoren multiplikativ in fester Reihenfolge (`BALANCE.spoilage`): Behälter (Taschen 1, Kiste 1, Vorratsfass 0,75, Kühlkiste 0,3 ab M8-32) ×
    Raum (Lager 0,9, Eiskeller 0,2) × Umgebung (Winter im Freien 0,5, heißes Biom 1,5 – `glutsand`, `aschenschlund`).
  - Kosten: ein Durchlauf je Spielstunde (Standard: alle 60 s Echtzeit) über die verderblichen Stapel der aktiven Zone – kein Frame-Pfad.
  - **Vorratsfass** (`vorratsfass`, Behälter §16.7 in `storage`: nur Nahrung/Gerichte/Getränke, 20 Plätze, Behälterfaktor 0,75).
- **Wasser** (`water`, M7-30): ungefiltert trinken wie bisher (10 %, Nebelmoor 50 % Fieber); Abkochen: `holzeimer_wasser` → `wasser_abgekocht`
  im Kessel/am Lagerfeuer; **Regensammler** (`regensammler`, Bauteil `objekt`) füllt sich aus dem Regen (`ClimateLog.regenMinuten`, Aufholen je
  Tag, gefüllt = sauberes Wasser), E füllt Eimer/Schlauch; **Trinkschlauch** (`trinkschlauch`, Item-Block `ladungen` max. 5, am Wasser/Regensammler
  füllen, trinken über `player.useItem` → `waterDrunk` mit Quelle `schlauch`); **geschmolzener Schnee**: Mechanik (Rezept „Schnee schmelzen“) mit
  dem Item `schnee`, das M8-59 samt Quelle liefert (bis dahin Eintrag in `reachability-geplant.ts`); Tees sind Getränke (Kessel, Kräuter + Wasser).
- **Farm-Woche** (M7-60, `tests/integration/farm-woche.test.ts`): 7 Spieltage headless – säen, gießen, Regen, ernten, kochen, Verderb, Kompost –
  mit Zeitsprüngen (`advanceTime`) zwischen den Handlungen, damit aktiver Lauf und Aufholen beide vorkommen; Laufzeit ≤ 60 s.

## 22. Bosse, Leuchtfeuer, Freischaltungen, Splitter, Schnellreise (M7-32 … M7-37, M7-64) – `src/game/bosses/`, `beacons/`, `unlocks/`, `shards/`, `travel/`

- **Boss-Framework** (`bosses`, Sammlung `bosses`, `BossDef`): je Boss eine Instanz in seiner Arena (Slot `bossarena` mit `variant` = Biom, über
  `link` mit der Leuchtfeuer-Stätte verbunden; `PlaceDef` `bossarena` und Arena-Vorlage in `src/content/bosses/arena.ts`, Strang F, eingehängt über
  die Sammeldatei `src/content/places/index.ts`). Zustände
  `schlafend` → Zugang (`betreten` des inneren Rings oder `beschwoerung` am Altar mit Item) → `erwacht` (Titelkarte 3 s, Arena versiegelt als
  Kollisions-Overlay, Bossmusik) → Phase 1 … n (≥ 3; Schwellen nach Lebensanteil, beim Wechsel kurze Unverwundbarkeit + `bossPhaseChanged`)
  → `besiegt` (einzigartige Drops, Trophäe, Herzsplitter, Arena offen, `bossDefeated`). Tod des Spielers oder Verlassen der Arena → `bossReset`
  (voll geheilt, Diener entfernt, Arena offen).
- **Kampf:** `bosses` ist `CombatTargetProvider` (`boss`, Team `feind`), Trefferzonen je Phase (`verwundbar: 'koerper' | 'schwachstellen'`;
  Schwachstellen = Kreise relativ zum Boss – Phase 2 des Borkenvaters: nur glühende Knoten). Angriffe als Daten (`BossAttack`): Fläche
  (`linie`, `kreis`, `kegel`, `ring`) mit Telegraph (`bossTelegraph`, Bodenmarkierung wie `creatureTelegraph`), Beschwörung
  (`spawnOwned` von `zweigling`, Besitzer `boss:<id>`), Arena-Effekte (`blaettersturm` senkt die Sicht – Darstellung + Wahrnehmungsfaktor;
  `arena_brennt`: eigene Brandflecken des Boss-Systems auf den Siegelmarken der Arena-Vorlage bis `burnUntilTick`, mit Licht, Sprite `brand` und
  Zustand Brennen, gespeichert in `bosses` – kein Übergreifen auf den Wald, ADR-0229), Resistenz-Überschreibung je Phase (Phase 3: Feuer ×2).
  Auswahl der Angriffe gewichtet aus dem RNG-Strom `bosses`; das Siegel ist ein Wurzelring im Kollisionsgitter (ADR-0228).
- **Fairness:** kein One-Shot auf Normal – kein einzelner Treffer über `BALANCE.bosses.maxHitShare` (0,45) des maximalen Lebens bei
  stufengerechter Rüstung (§D „Boss-Spezial 30–45 %“), Unit-Test; jede Attacke telegraphiert (≥ 0,4 s).
- **Wiedereinstieg:** `RESPAWN_SPOTS` += `arena`; wer in einer Arena mit unbesiegtem Boss stirbt, dem bietet der Todesbildschirm „Vor der Arena“
  (Rand der Arena auf der Seite der Stätte, aus der Slot-Geometrie; `death.addArenaSpots`). `arenaOfSlot` öffnet die Arena zur Seite der
  verknüpften Stätte; die Eingangsmarke der Vorlage gilt nur ohne Stätte (ADR-0236; die Vorlage selbst dreht M7-89).
- **Kamera-Rahmung** (nur Darstellung, ADR-0230): im Kampf schiebt `BossView.framing` die Kamera um 0,5 des Wegs zur sichtbaren Boss-Mitte,
  höchstens 72 px je Achse; Einblenden über 1 s nach Simulations-Ticks (Smoothstep), während des Falls 2 s halten, danach in 0,8 s
  Präsentationszeit loslassen.
- **Trophäe** ist ein Wandmöbel-Bauteil **ohne Rezept** (einzige Quelle `boss:<id>`); für Bauteile der Kategorie `trophaee`, deren Item nur
  `boss:`-Quellen hat, ist „kein Rezept“ Pflicht, für jedes andere Bauteil gilt weiter ein Rezept (ADR-0238).
- **Validator-Regel `boss`** (`tools/validator/boss.ts`): Sprite `boss_<id>` mit ≥ 8 eigenen Clips, Arena-Vorlage vorhanden, ≥ 3 Phasen, ≥ 1
  einzigartiges Drop-Item (einzige Quelle `boss:<id>`), Trophäe (Item mit Wandmöbel-Bauteil), Herzsplitter, Titelkarte DE/EN, Musikstück.
  Fixture-Test: 7 Clips ⇒ Fehler.
- **Borkenvater** (M7-33/34): mehrteiliges Sprite 96–160 px (Rumpf, Krone, Wurzelarme als Teile, ≥ 8 Clips: `idle`, `erwachen`, `wurzelstoss`,
  `beschwoeren`, `panzer`, `blaettersturm`, `raserei`, `treffer`, `tod`), Phase 1 Wurzelstöße in Linien + Zweiglinge, Phase 2 Borkenpanzer
  (nur glühende Knoten verwundbar) + Blättersturm, Phase 3 Raserei (Feuer ×2, Arena brennt teilweise); Drops `kernholz` (Gating: nur
  `rezept_bronzespitzhacke` braucht es, §13.2), `borkenharz`, `trophaee_borkenvater`, `herzsplitter`; der Zweigling trägt genau ein `borkenharz`
  (sichere Ziehung, kein Weltmaterial, ADR-0105). Integrationstest: Skript-Kampf besiegt ihn, alle Phasen erreicht, kein Treffer über der Schwelle.
- **Leuchtfeuer** (`beacons`, Content `beacons` = `leuchtfeuer_1…6` in `BEACON_BIOMES`-Reihenfolge): Zustand `erloschen` → (Boss des Bioms
  besiegt) `bereit` → `beacon.ignite` (E an der Marke `leuchtfeuer` der Stätte; ohne Ortsvorlage am Slot-Mittelpunkt – so arbeitet F unabhängig
  von B) → Sequenz `BALANCE.beacons.ignitionSeconds` → `entzuendet`. Das Leuchtfeuer selbst ist kein Chunk-Objekt: es gehört `beacons`
  (Position aus Marke bzw. Slot, Kollisions-Overlay 3 × 3, Darstellung `src/render/game/beacons.ts`, Sprite `leuchtfeuer` mit Clips
  `erloschen`/`bereit`/`entzuenden`/`brennend`).
  Wirkungen: Lichtwelle (Radius wächst ab `litTick` mit `waveTilesPerSecond`), Verderbnis weicht in den Regionen des Bioms, die die Welle erreicht
  (`BeaconsApi.healing(region, tick)` 0…1 mit weicher Front, Render liest), globale Heilungsstufe je Anzahl entzündeter Leuchtfeuer 0–6
  (`BEACON_HEALING[n]`: Sättigung, Wärme, Verderbnis-Skala – monoton steigend, Test); um eine noch dunkle Stätte liegt Verderbnis
  (`siteCorruption`: Stärke 0,7, Radius 48 Kacheln, linear fallend, von der Welle aufgehoben; ADR-0231). Partikelsturm (Emitter
  `leuchtfeuer_glut` im Zustand `bereit`, `leuchtfeuer_sturm` während der Entzündung und 6 s danach abklingend, dann `leuchtfeuer_funken`;
  ADR-0234), Stinger, Vision (`visionen`, Pixel-Standbilder + Zeilen DE/EN,
  eigener Bildschirm, pausiert), Freischaltungen, Glutkern in die Taschen (sonst als Drop), Schutzzone „Erleuchtet“ (Radius `zoneTiles`: Zustand
  `erleuchtet`, Spawnsperre, Furchtabbau), Schnellreisepunkt, Wiedereinstieg (`death.addBeacons`).
- **Freischaltungen** (`unlocks`): Registry (Content `unlocks`) mit **allen** Einträgen der Tabelle §23.1 (LF1–6), je Art, Ziel und `umgesetzt`
  (`true` oder `{ task }`); Teilnehmer `unlocks` mit den freigeschalteten Ids (Tick, Quelle `leuchtfeuer:<n>` | `bauplan:<item>` |
  `forschung:<relikt>` | `haendlerin` | `debug`). Rezepte tragen optional `freischaltung` (Rezept-Schema, additiv); das Handwerk zeigt und erlaubt
  sie erst danach (`crafting.useUnlocks`). LF1 (M7-36): `lf1_lumen_werkbank` (Station `lumen_werkbank`), `lf1_lumen_laterne`, `lf1_wegsteine`,
  `lf1_glutkern` (Item `glutkern_1`). Test `freischaltungen.test.ts`: LF1-Einträge spielbar (herstellbar, platzierbar, wirksam). Rezepte LF1
  (ADR-0233): die einmal gebaute Lumen-Werkbank bindet mit `borkenharz` ×2, die wiederholt gebauten Laterne und Wegstein mit Baumharz (`harz`) –
  endliche Bossbeute begrenzt keine Wiederholrezepte.
- **Lumen-Laterne** (Lichtart `lumen_laterne`, Verhalten `lumen`): Nebenhand, Radius 8, wetterfest, Ladung aus `lumen_scherbe`
  (`BALANCE.light.lumen.hoursPerShard`), Aura: Schattenbrut im Umkreis 2 Kacheln nimmt 5 Schaden/s (Schadensart `licht`, über den Kampf-Anbieter
  `kreaturen`); der Lichtfresser saugt `lichtfressen.lumen` Ladung ab (M6-26-Haken, Test in `schattenbrut.test.ts`).
- **Splitter** (`shards`): `herzsplitter` +10 max. Leben, `glutsplitter` +5 max. Ausdauer; Benutzen verbraucht das Item dauerhaft
  (`ToolsSystem.addItemUse`), Wirkung als Einflussquelle (`PlayerInfluences.addModifierSource`), `shardUsed`.
- **Schnellreise** (`travel`, M7-37): Reisepunkte = entzündete Leuchtfeuer, brennende Herdfeuer, Wegsteine (`wegstein`, Bauteil `objekt`, nur mit
  `lf1_wegsteine` herstellbar, benennbar: `travel.rename {wegstein, name}`). E an einem Reisepunkt öffnet den Reisebildschirm (`travelOpened`);
  `travel.go {ziel}` kostet
  ⌈Distanz / `BALANCE.travel.tilesPerLumen`⌉ `lumen_scherbe` (mindestens `minCost` = 1); abgelehnt ohne Punkt, mit unbekanntem oder gleichem Ziel,
  ohne Lumen, im Kampf (`combatLockSeconds`), mit Boss erwacht. Option „Logistik-Realismus“ (`world-settings`, Standard aus): Erze (`<erz>erz`) und
  Barren (Kategorie `barren`) in den Taschen ⇒ `cargoNotTeleportable`. Reisepunkte liest `travel` beim Fragen aus den Systemen, eigener Zustand
  sind nur die Namen der Wegsteine; Ankunft auf einer freien Kachel; der Bildschirm nennt den Ausgangspunkt (ADR-0233).
- **Bildschirme auf Ereignis** (ADR-0235): Vision und Reisebildschirm öffnen nur über eine Einmal-Anfrage aus ihrem Ereignis (`beaconLit`,
  `travelOpened`); E schließt sie nur. Der Tab-Wechsel (`tabHidden`) öffnet nur das Pausemenü.
- **Progressionstest LF1** (M7-64, Strang G in Welle 2, `tests/integration/progression-lf1.test.ts`): T0 → T1 → Borkenvater → Entzündung → LF1-Freischaltungen über
  die Debug-Befehle (geben, teleportieren, Zeit); Pacing-Messung über die Meilenstein-Zeiten von `stats` in `docs/BALANCE.md`.

## 23. Chronik, Aufgaben, Einstieg, Funke, Vermittlung, Statistiken, Erfolge, Perks (M7-41 … M7-45, M7-47, M7-48) – `src/game/chronicle/`, `quests/`, `guide/`, `stats/`, `achievements/`, `triggers/`

- **Chronik (J, Bildschirm `chronik`)** mit sieben Reitern und ihren Quellen: Aufgaben (`quests`), Bestiarium (`bestiary`, M6), Herbarium &
  Fischbuch (`stats`: gesammelt je Pflanze/Kraut/Frucht, geerntet je Nutzpflanze, gefangen je Fisch – plus Content-Texte), Wissen (`chronicle`:
  Wissenseinträge, Tafeln, Visionen), Rezeptbuch (`sampleCrafting`, bekannte Rezepte), Statistiken (`stats`), Erfolge (`achievements`).
- **Tagebuch** (`chronicle`): Einträge aus Chronik-Regeln (Content je Strang: Ereignis + Filter → Art + Text mit Platzhaltern aus der Nutzlast,
  aufgelöst über Content-Namen); Eintrag = `{ nr, tick, tag, regel, art, werte }`, Text erst in der UI (Sprachwechsel ohne Neustart).
  Wissenseinträge (Content `knowledge`) schalten per Auslöser frei (erster Kontakt mit einer Mechanik, Tafel gelesen, Vision gesehen).
- **Aufgaben** (`quests`, Content `quests`, zod): Art `haupt` | `neben` | `einstieg`, Schritte mit Auslöser, Hinweis DE/EN, Kartenmarker
  (`ort` Ortstyp/Variante nächster Slot, `leuchtfeuer` Nummer, `punkt`), Belohnung (Items, Freischaltung). Tracker im HUD: bis 3 verfolgte
  Aufgaben (`quest.track`), aktiver Schritt mit Hinweis und Richtung. Hauptaufgabe „Die sechs Feuer“ Akt 1 (`hq_sechs_feuer_1`): Funke
  erwacht → Stätte von Grünhain finden → Borkenvater besiegen → Leuchtfeuer entzünden. Dialoge (Funke, Siedler, Händlerin) als Content in
  `src/content/dialoge/` mit zod-Schema (fehlender EN-Text ⇒ Fehler).
- **Einstieg „Die ersten Stunden“** (M7-43): Aufgabe `einstieg` mit Schritten Fasern und Steine → Steinaxt → Lagerfeuer vor der ersten Nacht
  (Auslöser `uhr` Tag 1 vor 19 Uhr) → Unterschlupf (Innenraum oder Bett) → Werkbank → Kupfer und Zinn → Bronze; kontextuelle Hinweise
  (Content `guideHints`, Kanal `hinweis`): erste Kälte, erste Dunkelheit, erster Hunger, erster Durst, erstes Elite, erste Nacht im Freien …
  Jederzeit abschaltbar: `quest.onboarding {on}` (Welt) und Einstellung `game.hints` (die UI sendet `guide.configure` beim Start und bei jeder
  Änderung – so bleibt die Simulation deterministisch).
- **Funke** (`guide`, Kanal `funke`): höchstens 2 Zeilen (gemessen mit der Pixelschrift in der Funke-Box, Validator-Regel `funke`), nie
  aufdringlich: Mindestabstand `BALANCE.guide.funkeMinSeconds` Spielzeit, einmalige Kommentare, Priorität 3 (Gefahr, Weltereignis-Ankündigung)
  vor allem anderen; abschaltbar (`guide.configure {funke}` aus `game.funkeComments`). Laternen-Sprite mit Flammengeist (`funke_*`). ≥ 40
  Kommentare DE/EN. Kündigt jedes umgesetzte Weltereignis an (Hinweis-Id in `WorldEventDef.ankuendigung.funke`).
- **Vermittlungs-Register** (M7-45, Content `mechanics`): je Mechanik §11–§25 `{ id, paragraph, hinweis (Einstiegsschritt | Funke | Kontext),
  wissen (Wissenseintrag), tooltip (i18n-Schlüssel oder Content-Datensatz), task }`; jede spätere Mechanik trägt sich bei ihrer Umsetzung ein.
  Validator-Regel `vermittlung`: fehlender Baustein ⇒ Fehler; Liste der Mechaniken bis M7 im Beleg.
- **Statistiken** (`stats`): Zähler aus Stat-Quellen (Content: Ereignis + Filter + optionaler Schlüssel aus der Nutzlast, z. B. `kills.<kreatur>`),
  Spielzeit (Ticks), überlebte Nächte, Distanz; **Meilensteine** `{ id → erster Tick }` (erstes Lagerfeuer, erste Bronze, Borkenvater, LF1 …) für die
  Pacing-Messung.
- **Erfolge** (`achievements`, lokal je Welt): Auslöser, Symbol `erfolg_<id>`, geheim optional; `achievementUnlocked`. 15 in M7.
- **Perks M7** (M7-48): je 6 für `holzfaellen`, `bergbau`, `sammeln`, `handwerk`, `schmieden`, `kochen`, `ueberleben` (Wahl bei 30/60/90, alle
  spürbar); neue Wirkungsarten in `PERK_EFFECTS` (G), Daten in `src/content/perksM7.ts`, gelesen über `PerkEffects.value(art)`
  (`src/game/skills/perkEffects.ts`, neben `CombatPerks`) von Sammeln/Abbau (`holz_*`, `abbau_*`,
  `sammel_*`), Handwerk (`handwerk_*`, `schmied_*`), Kochen (`koch_*`, liest E), Überleben (`ueberleben_*`: Hunger/Durst/Temperatur/Schwimmen/
  Schleichen). Perk-Wahl-Bildschirm `perkwahl` öffnet auf `perkChoiceOpened`.

## 24. Audio M7 (M7-01 … M7-06, M7-31) – `src/audio/`, `src/game/instruments/`

- **Graph** (`mixer.ts`, `reverb.ts`, `occlusion.ts`):
  ```text
  Stimmen ─► [Verdeckung: Tiefpass + Pegel je Stimme] ─► Bus effekte ─┬─────────────────────┐
  Klangbett, Wetter, Flüsse ─────────────────────────► Bus umgebung ─┼─► Hall-Send (Faltung) ─┤
  Musik-Schichten (Stems) ───────────────────────────► Bus musik ─────┘                       ├─► Kompressor ─► Limiter ─► Master ─► Ausgang
  Menüklänge ────────────────────────────────────────► Bus ui ───────────────────────────────┘
  ```
  Hall: prozedural erzeugte Impulsantworten (`generateImpulse(raum, sampleRate, seed)`: frühe Reflexionen + gefiltert abklingendes Rauschen,
  deterministisch, in Node testbar) für `hoehle` (Ebene < 0), `innenraum` (Spieler in einem Innenraum), `halle` (Raum ≥ 60 Kacheln oder
  Gewölbe); Send-Pegel je Raumart, Überblendung beim Wechsel. Verdeckung je positionierter Stimme: Kachel-Strahl Hörer → Quelle über das
  Kollisionsraster (was Licht sperrt, dämpft Schall) plus drinnen/draußen (`rooms.playerIndoors`) → `spatial.place(…, occlusion)`.
  Zwei Faltungsslots A/B mit Überblendung beim Raumwechsel; gemessen Höhle RT60 2,6 s (Tiefpass 7000 → 900 Hz), Innenraum 0,45 s, Halle 1,7 s
  (ADR-0213). Test `tests/unit/audio/graph.test.ts` (Busse, Routing, Hall-Generator deterministisch, RT60 ±15 %, Raumwahl, Verdeckung);
  Hörprobe-Protokoll im Log.
- **SFX-Engine** (`dsp/`, Presets in `src/content/sfx/`): neue Quelle `wavetable` (Tabellen im Content), sonst Ausbau der vorhandenen Bausteine;
  Varianten gegen Wiederholung wie bisher. **Abdeckung M3–M6 = 100 %** (`tests/unit/audio/abdeckung.test.ts`): jedes Sim-Ereignis bis M6 hat
  Klang oder begründete Stille, jede Aktion §11.4 hat Klang; der Validator zählt ≥ 100 SFX (nach Welle 1: 450 – Wert nur steigen lassen).
  Der Aufhebe-Klang eines Items kommt aus `ITEM_SFX` (`src/content/items/define.ts`), auch für die Items der Stränge (M7-79).
- **Tracker/Sequencer** (`src/audio/music/`, Content `src/content/music/`): Stück = Instrumente (`rechteck`, `dreieck`, `rauschen`, `fm`,
  `wavetable` mit Hüllkurve, Pegel, Pan, Echo-Send) + Patterns (Zeilen × Kanäle, Tracker-Notation je Zeile: Note, Instrument, Lautstärke,
  Effekt – Arpeggio, Portamento, Vibrato, Echo) + Arrangements (Pattern-Reihenfolge je `standard` | `tag` | `nacht`, Loop-Zeile) + Schichten
  (Kanalgruppen `basis`, `melodie`, `gefahr`) + SNES-artiges Echo (8-Tap-FIR, Rückkopplung, Tiefpass). Gerendert wird mit dem eigenen JS-Synth
  als reine Funktion zu Float32-Stems je Schicht (32 kHz wie die SFX); im Browser im Worker (`music.worker.ts`, Transferable), in Node derselbe
  Code: bitgleich (Test `tests/unit/audio/sequencer.test.ts` – kurze Patterns in Unit, ganze Stücke nur in `tests/integration/musik-render.test.ts`).
  OfflineAudioContext ist in Workern nicht verfügbar → eigener Synth, im Audit „ersetzt durch“ (ADR-0209). Transzendente Werte im ganzen
  Musik-Renderpfad und in `dsp/biquad.ts` nur über `src/content/music/portableMath.ts` (`psin`, `pcos`, `pexp2`); `Math.sin/cos/pow` sind
  nicht engine-unabhängig, ein Quelltext-Scan im Test verbietet sie dort (ADR-0210). **Worker-Protokoll** (Pull, ADR-0211): `render` → `info`,
  danach je Frame genau eine `slice` mit `UPLOAD_FRAMES_PER_FRAME` Frames über alle Schichten (sofort in den Ziel-Puffer kopiert), `drop` beim
  Verdrängen aus der Bank; höchstens ein AudioBuffer je Frame; Stinger werden erst geholt, wenn das erste Stück spielt.
  **Audio-Frame ohne Allokation** (ADR-0212): die Audio-Uhr ist ein gehaltener Datensatz `AudioClock` (`src/audio/clock.ts`); Signaturen
  `MusicDirector.update(probe, clock, out)`, `StingerQueue.take(clock, busy, ready)`, `AmbienceDirector.update(state, listener, clock, sink)`,
  `MusicRuntime.frame(sim, clock?)`.
- **Musik-System** (`MusicDirector`, liest die Simulation nur): Stimmungen `titel`, `erkundung` (Biom-Stück, Arrangement nach Tageszeit),
  `basis` (in einer Herdfeuerzone, keine Gefahr), `kampf` (Gegner jagt den Spieler), `boss` (erwachter Boss), `gewoelbe` (Halle-Hall, bis
  zu einem eigenen Stück das Nacht-Arrangement des Bioms ohne Melodie-Schicht), `stille`; weiche
  Überblendung 2–4 s mit Hysterese; Gefahren-Percussion (`gefahr`-Schicht) nach Nähe des nächsten jagenden Gegners (≤ 12 Kacheln); Stinger
  (`entdeckung` ← `placeDiscovered`, `leuchtfeuer` ← `beaconLit`, `boss_besiegt` ← `bossDefeated`, `stufenaufstieg` ← `skillLevelUp`,
  `ereignis` ← `worldEventAnnounced`; Tabelle `src/audio/music/stingers.ts`) ducken die Musik; bewusste Stille in ruhigen Nächten (nach einem
  Stück 60–180 s Pause, gezogen mit einem Präsentations-PRNG aus Weltseed + Nacht – die Simulation bleibt unberührt). Test
  `tests/unit/audio/musik-zustand.test.ts`.
- **Stücke 1–5** (M7-05, je 1,5–3 min, loopbar, Loop-Nahtstellen-Test): `titel`, `gruenhain` (Arrangements `tag`, `nacht`), `basis`, `kampf`,
  `borkenvater`. Stinger (zählen nicht): `entdeckung`, `leuchtfeuer`, `boss_besiegt`, `stufenaufstieg`, `ereignis`.
- **Umgebung** (M7-06, `src/audio/ambience/`): Klangbett je Biom × Tag/Nacht (Grünhain: Vögel/Grillen/Wind; Salzküste: Brandung/Möwen/Wind),
  positionale Flüsse (bis 3 nächste Flusskacheln aus den Chunk-Wasserbits als Schleifen), Wetterschichten (Regen, Starkregen, Gewitter),
  Donner: Verzögerung = Distanz / 343 m/s mit 1 Kachel = 1 m; ferne Blitze (nur Darstellung) 500–3 000 m. Test `tests/unit/audio/umgebung.test.ts`.
- **Musizieren** (M7-31, `instruments`): Flöte (`floete`) und Laute (`laute`) mit Item-Block `instrument`; `instrument.play {from}` /
  `instrument.stop`; solange gespielt wird: Furcht −2/s für Spieler im Umkreis (`BALANCE.instruments.radiusTiles` = 8, `FearSystem.addSurroundings`),
  die Figur steht fest, keine andere Handlung; die Melodien sind kurze Tracker-Lieder (`songs`, `lied_1` … `lied_4`). **Kescher** (Item `netz`,
  Werkzeug `netz`): fängt Insekten (`grille`, Köder) und Glühwürmchen (Kreatur `gluehwuermchen` → Item `gluehwuermchen`); der Fang kommt aus
  `hash(Seed, gespeicherter Zugzähler, Kachel)` statt aus einem RNG-Strom, höchstens 3 Glühwürmchen je Schwarm und Nacht, der Schwarm bleibt
  (ADR-0214). **Glühwürmchenglas** (`gluehwuermchenglas`): Lichtart mit Verhalten
  `lampe` (ein Stück Brennstoff `gluehwuermchen` = 48 Spielstunden, wetterfest, Radius 3, schwach) – keine neue Verhaltensart. Tests
  `tests/unit/game/musizieren.test.ts`, Lichtquellen-Test `tests/unit/game/gluehwuermchenglas.test.ts`.

## 25. Menüs, Welteinstellungen, Einstellungen, Speicherslots, Export, PWA (M7-50, M7-51, M7-55 … M7-59) – `src/ui/screens/…`, `src/game/worldsettings/`, `src/save/`

- **Boot-Ablauf** (`src/main.tsx`, `App.tsx`): Boot → Hauptmenü (lebendige Pixel-Szene: kleine feste Welt „Klein“, Kamera auf einem
  Küstenlager, Zeitraffer von Tag, Wetter und Licht, keine Figur; Titelmusik) → Weltauswahl (Welten aus `listWorlds`, Laden, Löschen mit
  Bestätigung, Export, Import, Seed kopieren) → Neue Welt → Charaktererstellung (I) → Ladebildschirm (Fortschritt der Weltgenerierung, Tipps und
  Lore aus `src/content/tipps.ts`) → Spiel. Das bisherige Debug-Laden (`?laden=`, `src/debug/saveLoad.ts`) geht im regulären Laden auf; Szenarien
  (`?scenario=`) und `?debug=1&seed=` starten weiter direkt.
- **Startauftrag** (ADR-0240): eine Seite = eine Sitzung. Menü und Spiel sind getrennte Seitenläufe: startet der Spieler eine Welt, schreibt das
  Menü den Startauftrag in den sessionStorage des Tabs (`duskhearth.start`: `{kind:'new', worldId, name, config, commands}` oder
  `{kind:'load', worldId}`) und lädt neu; `bootArt` (`src/ui/menu/start.ts`) entscheidet beim Start: ohne Debug Hauptmenü oder Auftrag, mit Debug
  direkt wie bisher, außer `menue=1`, Menü-Szenarien, `laden=<Welt>` und vorhandenen Aufträgen. Nach dem ersten Speichern einer neuen Welt wird der
  Auftrag zu `load` (Neuladen setzt fort); „Zum Titel“ löscht ihn. `?debug=1&laden=<Welt>` nimmt denselben Weg wie die Weltauswahl, startet aber
  mit eingefrorener Zeit (`src/debug/saveLoad.ts` liefert nur noch Lesen und Exportieren); E2E steuern das Menü über `?debug=1&menue=1`.
- **Menüwelt** (`MENU_WORLD`, `src/render/world/menuScene.ts`): Seed 7 202 407, Größe `small`, 12-Minuten-Tag, Zeitraffer ×4 (`MENU_TIME_SCALE`;
  1× bei reduzierter Bewegung), Start 17:30, Wetter alle 3 Spielstunden aus `MENU_WEATHER` erzwungen (keines löscht ein Feuer); friedlich (Tiere
  bleiben). Ein unsichtbarer Spieler im Gott-Modus abseits des Bildes baut das Küstenlager (Lagerfeuer, zwei Fackeln) per Befehl und schürt es
  (Lagerwächter); die Spielansicht zeigt ihn nie, der Klang hört das Lager aus seiner Mitte ohne die Ereignisse des Wächters. Die Titelmusik im
  Menü folgt mit M7-92 (heute spielt die Erkundungsmusik).
- **Neue Welt** (M7-51): Name, Seed (zufällig vorgeschlagen, editierbar), Größe (`small|medium|large`), Voreinstellung und Regler. Unveränderlich
  in `SimConfig`: `seed`, `worldSize`, `dayLengthMinutes`, **neu** `resourceDensity` (`gering|normal|reich`, wirkt im Weltgenerator-Schritt
  `ressourcen`, Teil des Welt-Cache-Schlüssels; im Schema optional mit Standard `normal`, damit gespeicherte Weltmetas ohne das Feld gültig
  bleiben, und `normal` erzeugt bitgleich die heutige Welt). **Schwierigkeit** (Voreinstellung): bleibt im Teilnehmer `death` (gespeichert seit
  v1, `DeathSystem.setDifficulty` mit der Sperre „nie weg von Unbarmherzig“) – `world.setDifficulty {schwierigkeit}` gehört `world-settings` und
  delegiert dorthin; so braucht M7 keine teilnehmerübergreifende Migration (ADR-0207). Änderbar im Teilnehmer `world-settings`: `friedlich` (keine
  Feinde/Schattenbrut – Spawnsperre –, Tiere bleiben), `faktoren` (Überschreibungen von Hunger/Durst und Gegnerschaden; ohne Überschreibung gilt
  die Voreinstellung, `BALANCE.difficulty`), `schattenflutIntervall` (Nächte oder aus; wirkt ab M9), `logistikRealismus`; Befehl
  `world.setSettings {…}`. Jahreszeitenlänge bleibt im Teilnehmer `calendar` (Historie). Leser der Faktoren (`vitals`, `creatures`, `bosses`)
  fragen `WorldSettingsApi.factors()` (auch `creatures`, über `useWorldSettings`). **Unbarmherzig** wählt man nur bei der Erschaffung: das
  Pausemenü („Welt“) bietet es nicht an, und in einer Unbarmherzig-Welt sind Schwierigkeit und jeder mildernde Regler (Friedlich, Hunger/Durst,
  Gegnerschaden, Schattenflut, Logistik) gesperrt – `world.setSettings` wird dann ganz abgelehnt (`difficultyLocked`), nur die
  Jahreszeitenlänge bleibt änderbar; die Neue-Welt-Maske schickt die Regler vor der Schwierigkeit (ADR-0242).

  | Voreinstellung | Hunger/Durst | Gegnerschaden | Schattenflut | Tod |
  |---|---|---|---|---|
  | `entspannt` | ×0,6 | ×0,6 | aus | Inventar bleibt |
  | `normal` | ×1 | ×1 | jede 7. Nacht | Inventar im Grab, −25 % Skill-Fortschritt |
  | `hart` | ×1,25 | ×1,3 | jede 5. Nacht | alles im Grab |
  | `unbarmherzig` | ×1,25 | ×1,5 | jede 5. Nacht | Permadeath |
- **Einstellungen** (M7-55/56, Bildschirm `einstellungen`, aus dem Hauptmenü und aus dem Pausemenü über „Alle Einstellungen“): Grafik, Audio,
  Steuerung, Spiel, Sprache, Barrierefreiheit – alle Schlüssel aus `src/engine/settings.ts` (§30). **VSync** ist im Browser nicht schaltbar →
  `graphics.vsync` entfällt, `graphics.fpsLimit` 0 heißt „An Bildwiederholrate“ (jedes Animationsbild läuft); jede andere Stufe begrenzt darunter
  über `limitedAnimationFrameClock` (`src/engine/frameLimit.ts`: phasentreu, übersprungene Bilder tun nichts, die Simulation holt mit festen
  Schritten auf); `SETTINGS_VERSION` 2, die Migration 1 → 2 entfernt nur den Schlüssel (ADR-0239). Umbelegung mit Konfliktanzeige,
  Halten/Umschalten, Sprache DE/EN ohne Neustart; Werte bleiben nach Neuladen (localStorage). Das Pausemenü hat zusätzlich den Eintrag „Welt“
  (Welteinstellungen der laufenden Welt).
- **Speicherslots** (M7-57, ADR-0241): je Welt der Hauptslot `main` und drei rotierende `auto-1…3` (fehlender zuerst, sonst der älteste);
  Autosave alle `game.autosaveMinutes` (3) inkrementell, beim Schlafen (`sleep.start`), beim Verlassen (`pagehide`) und bei `visibilitychange`;
  atomar, eine Transaktion je Speichern. Chunk-Diffs **je Slot** (rotierende Autosaves teilen keinen Chunk-Store, ADR-0020 – IndexedDB-Schema 2 mit
  Schlüssel `(Welt, Slot, Chunk)`; Datensätze von Schema 1 wandern beim Öffnen nach `main`). **Erfassen** im Hauptthread zwischen zwei Ticks
  (Snapshot aller Teilnehmer + Chunk-Änderungen seit dem letzten Erfassen), **Übergabe** per `postMessage`; der Schreiber im Speicher-Worker
  (`save.worker.ts`) hält je Slot einen Spiegel der Hashes seiner Chunk-Datensätze und schreibt genau die Chunks, deren Stand der Slot nicht hält;
  Integritäts-Hash, Packen und gzip (CompressionStream) im Worker. **Integrität** = Snapshot-Hash + jeder Chunk-Hash + Weltdatensatz + Build;
  Laden nimmt den jüngsten Slot, überspringt einen beschädigten und sagt es im Ladebildschirm (Wiederherstellung). Fällt der Worker aus, schreibt
  derselbe Code im Hauptthread weiter, das nächste Erfassen gibt alle geänderten Chunks neu (`takeLost`). E2E: Erfassen + Übergabe < 16 ms
  (`lastHandOffMs`).
- **Export/Import** (M7-58, ADR-0243): `.dhsave` = gzip (CompressionStream) des Welt-Dumps des jüngsten intakten Slots als `main` (Dump-Format 2,
  kanonisches JSON samt Save-Version, Weltdatensatz und Chunk-Datensätzen), Dateiname `<name>-<seed>.dhsave` (ASCII); Import prüft Format, Save-
  und Teilnehmer-Versionen und Integrität, legt eine neue Welt mit neuer Id an und schreibt nichts, wenn etwas nicht stimmt; E2E: Export →
  Löschen → Import → Laden ⇒ identischer Zustands-Hash. Seed teilen: Kopieren als Text „DH-<Seed>-<Größe>“; die Neue-Welt-Maske nimmt diesen Text
  oder eine Zahl.
- **PWA** (M7-59): `vite-plugin-pwa` (Installation nach ADR-0002/-0003, Version gepinnt), Manifest, Icons aus Pixel-Quellen, Service Worker
  cacht Build + Atlanten; offline startbar (E2E `pwa.spec.ts` gegen den Produktions-Build).

## 26. Figur und Kreaturen M7 (M7-15, M7-17, M7-52 … M7-54) – `src/game/appearance/`, Figuren-Rig, Kreaturen-Content

- **Aussehen** (`appearance`): Name (1–20 Zeichen), Körperform (`schmal`, `mittel`, `kraeftig`), Hautpalette (`haut_1…6`), Frisur (12),
  Haarpalette (`haar_1…8`), Kleidungsfarben Oberteil/Hose (`kleid_1…8`) – Palettenzeilen in `assets-src/paletteRows.ts`, Farbe über die
  Paletten-LUT. Befehl `appearance.set {…}` (erster Befehl einer neuen Welt, danach nur über spätere Spiegel-Funktion), `appearanceChanged`.
- **Charaktererstellung** (Bildschirm `charakter`, nach „Neue Welt“): Live-Vorschau der Figur (4 Richtungen, Idle/Gehen) über dieselben Sprites
  wie im Spiel (`src/ui/hud/minimap/spriteBild.ts`-Weg). E2E `charakter.spec.ts`; Save-Roundtrip Aussehen.
- **Körperformen** (M7-53): der Figuren-Rig (`assets-src/sprites/figuren/_spieler_rig.ts`) erzeugt je Form alle Spieler-Clips der §4.5-Liste
  (inkl. Kampf-, Werkzeug-, Schwimm- und neuer M7-Clips wie `musizieren`, `angeln`) je 4 Richtungen mit angepassten Hand- und Kopf-Sockeln; Form
  `mittel` = die heutigen Sprites (keine Umbenennung), `spieler_schmal_<teil>`, `spieler_kraeftig_<teil>`; Ausrüstungs-Layer sitzen über die
  Sockel. Unit-Test Sockel-Mapping je Körperform; Kontaktbogen `koerperformen.png`.
- **Frisuren** (M7-54): 12 als Kopf-Layer je Richtung und Kopfpose des Rigs, positioniert über den Kopf-Sockel je Frame (keine Voll-Animationen
  je Frisur – Atlas und Download bleiben klein), Haarfarbe per Palettenzeile, Kopfbedeckung verdeckt korrekt (Maskenframes `frisur_<id>_helm`).
  Kontaktbogen `frisuren.png` (12 Frisuren × alle Animationen, aus den Layern komponiert); Validator zählt 12 (Sammlung `hairstyles`, zählt nicht §C).
- **Kreaturen M7** (Content wie M6 §11, Validator-Regel `kreatur`): Elites `graufang` (Alphawolf, führt ein Rudel), `alter_hauer` (Keiler) –
  Umfärbung + eigene Muster, Essenz-Drops `essenz_graufang`, `essenz_alter_hauer` (Verwendung M8-45, geplant); seltene Spawnregel je Biom
  (höchstens einer je Region, nach Sieg `BALANCE.creatures.eliteRestDays` Ruhe) – Strang I. **Gewölbe-Gegner** (M7-15, Strang C, weil sie nur im
  Gewölbe leben): `mimik_truhe` (steht als Truhe, Tarnprofil M6-22), `fallengeist`, `erbauer_konstrukt_1`, Mini-Boss `wurzelhueter` (Familie
  `gegner`, Kreaturfeld `waechter: true` → Bossbalken ohne Phasenmarken, Essenz `essenz_wurzelhueter`); Platzierung über `spawnOwned`.
  `zweigling` gehört zum Borkenvater (F).
- **Schmuck 1–5 und Deko** (Teil von M7-62): `knochentalisman`, `federtalisman`, `muscheltalisman` (+ bestehend `wolfszahnkette`,
  `haueramulett`) – Strang I; Deko Grünhain/Küste als Bauteile (Möbelkategorien `deko`, `pflanze`, `bild`, `teppich`), **mind. 16 Stück**
  (M7-62 „≥ 95 Bauteile/Möbel/Deko“: heute 74 + Beete 2 + Vogelscheuche + Regensammler + Wegstein + Trophäe = 80, fehlen 15) – Strang I.

## 27. Speichern M7 – Save-Version 4

- **Save-Version 4** (`src/save/versions.ts`, Meilenstein `M7`) = Version 3 plus die neuen Teilnehmer; eröffnet vom ersten Strang, der einen
  Teilnehmer anlegt (wie ADR-0085), jeder weitere trägt sich an seiner Stelle der Systemreihenfolge ein. Neue Teilnehmer beginnen in älteren
  Spielständen leer (Migration von 0). Optionale neue Felder in bestehenden Teilnehmern ohne Versionssprung (ADR-0038-Muster, nur geschrieben, wenn
  gesetzt: `creatures.besitzer` und `creatures.leine` – lebende Kreaturen und Chunk-Bestand, seit Welle 0 –, `light` Lumen-Ladung). Welle 0 legte
  keinen Teilnehmer an; Welle 1 hat Version 4 eröffnet und 12 Teilnehmer eingetragen (`world-settings`, `bosses`, `places`, `farming`, `fishing`,
  `instruments`, `beacons`, `unlocks`, `shards`, `travel`, `world-events`, `map`); `world-events` migriert ausdrücklich von Datenversion 0 auf das
  Register in Ruhe.

  | Reihenfolge | Teilnehmer (Datenversion) | speichert | Strang |
  |---|---|---|---|
  | … | `clock` 1, `rng` 1, `ecs` 1, `world-chunks` 1 | wie v3 | – |
  | neu | `world-settings` 1 | Friedlich, Faktor-Überschreibungen, Schattenflut-Intervall, Logistik-Realismus (die Schwierigkeit bleibt in `death`) | H |
  | … | `motion` 2, `player` 1 | wie v3 | – |
  | neu | `appearance` 1 | Name, Körperform, Paletten, Frisur | I |
  | … | `vitals` … `bestiary` (wie v3; `light` 1 mit optionaler Lumen-Ladung; `creatures` 1 mit optionalem `besitzer`) | wie v3 | – |
  | neu | `bosses` 1 | je Boss Zustand, Phase, Leben, laufender Angriff, Arena versiegelt, Brandflecken der Arena (`burnUntilTick`), Sieg-Tick, Beute ausgegeben | F |
  | neu | `places` 1 | je berührtem Slot `PlaceState` (entdeckt, Truhen-Bits, gereinigt, Rückkehr-Tick, Segen, genutzt) | B |
  | neu | `vaults` 1 | je betretenem Gewölbe Türen, Schlüssel, Rätselzustände, Fallen, Truhen, Wächter, abgeschlossen | C |
  | neu | `farming` 1 | Beete je Chunk (Spalten), Klimaprotokoll | D |
  | neu | `fishing` 1 | laufender Wurf/Drill, Reusen je Chunk, Eislöcher | D |
  | neu | `spoilage` 1 | globaler Stunden-Stempel; je eingefrorenem Chunk Stempel und Faktor seiner Behälter | E |
  | neu | `water` 1 | Füllstand je Regensammler | E |
  | neu | `meals` 1 | Überdruss-Zähler | E |
  | neu | `instruments` 1 | spielt gerade (Instrument, Lied, Start-Tick, Platz), Zahl der gespielten Lieder, Kescher-Zugzähler, Fänge je Schwarm und Nacht | A |
  | neu | `beacons` 1 | je Leuchtfeuer Zustand, `litTick`, Vision gezeigt | F |
  | neu | `unlocks` 1 | freigeschaltete Ids mit Tick und Quelle | F |
  | neu | `shards` 1 | benutzte Herz- und Glutsplitter | F |
  | neu | `travel` 1 | Wegsteine (Nummer, Ort, Name) | F |
  | neu | `world-events` 1 | Zustand je Ereignis (angekündigt/aktiv, Start/Ende), letzter Blitz-Tick | B |
  | neu | `map` 1 | Aufdeckung je Ebene (RLE/Base64), eigene Marker | B |
  | … | `conditions` 1, `fear` 1, `sleep` 1, `actions` 1, `skills` 1 | wie v3 | – |
  | … | `death` 1 | wie v3 (Schwierigkeit, Gräber, Wiedereinstieg; `arena` ist ein neuer Wert des vorhandenen Felds) | – |
  | … | `cheats` 1 | wie v3 | – |
  | neu | `stats` 1, `achievements` 1, `chronicle` 1, `quests` 1, `guide` 1 | Zähler/Meilensteine; Erfolge; Einträge/Wissen; Aufgaben/Schritte/Zähler/verfolgt/Einstieg an; gegebene Hinweise, Abklingzeiten, Schalter | G |
- **Keine teilnehmerübergreifende Migration:** alle bestehenden Teilnehmer behalten ihre Datenversion (optionale Felder nach ADR-0038); die
  neuen beginnen in v1–v3 leer. `world-settings` leer = keine Überschreibung, nicht friedlich, Schattenflut nach Voreinstellung, Logistik aus.
- **Referenzspielstand `v4.json`** (Integrator, nach allen Strängen): jeder Strang liefert in `tools/save/fixtureM7/<bereich>.ts` eine Funktion,
  die seinen Anteil nur über Commands herstellt, und seine Fakten (`<bereich>Facts`) für den Migrationstest: bepflanzte Beete mit Frucht in
  Stufe 2 und Frost-Opfer, Reuse mit Fang, Kiste mit verderbendem Essen + Vorratsfass, Regensammler halb voll, aktive Mahlzeit-Effekte +
  Überdruss, entdeckter und geplünderter Ort mit Rückkehr-Uhr, Gewölbe mit gelöstem Rätsel und offener Tür, Borkenvater besiegt,
  Leuchtfeuer 1 entzündet, Freischaltungen LF1, ein Wegstein, ein Herzsplitter benutzt, Aufgaben mitten im Akt, Erfolge, Chronik-Einträge,
  aufgedeckte Karte mit eigenem Marker, Welt „Hart“, eigenes Aussehen. `tests/unit/save/migrationen.test.ts` lädt v1–v4.
  Beiträge der Welle 1 (`tools/save/fixtureM7/`): `playOrte`/`orteFacts` (B), `playFeld`/`feldFacts` (D, vor `setTime` „Abenddämmerung“),
  `playLeuchtfeuer`/`leuchtfeuerFacts` (F, nach der Basis, vor dem Kampf), `playKlang`/`klangFacts` (A, vor dem Kampf), `playWelt`/`weltFacts`
  (H, direkt vor dem Speichern); je `EMPTY_<BEREICH>_FACTS` bzw. `emptyLeuchtfeuerFacts()` für v1–v3. Der Fixture-Kampf muss gegen die
  Spawnsperren der Orte bestehen (M7-80).

## 28. Aufholen eingefrorener Chunks und Determinismus M7

- **Aufholen** (`catchUp(chunk, fromTick, toTick)`, zerlegbar a → c ≡ a → b → c, Vergleich „aktiv“ gegen „eingefroren + aufgeholt“ je System):
  - `farming`: je überschrittenem 06:00 dieselbe Tagesfunktion wie im `dailyTick` (Klimaprotokoll des Tages, Hash-Zufall je Kachel und Tag);
    Setzlinge (`growth` im Objektzustand) ebenso.
  - `fishing`: Reusen fangen je überschrittenem 06:00 (`hash(Seed, Reuse, Tag)`), bis voll.
  - **Jeder Aufholer liest Terrain, Wasser und Biom nur aus dem übergebenen Chunk**, nie über `world.chunk()` – beim Aufholen ist der Chunk noch
    nicht resident (ADR-0221; Testwelten halten dafür ein `frozen`-Set).
  - `instruments`: das Glühwürmchenglas ist eine Lampe des Lichtsystems und holt mit ihm auf (48 h je Glühwürmchen).
  - `spoilage`: volle Spielstunden zwischen dem Chunk-Stempel und `toTick`, geteilt an Jahreszeitwechseln, mit dem beim Einfrieren gespeicherten
    Behälterfaktor; Dyaden-Verlust je Stunde ⇒ bitgleich zum aktiven Lauf (§21).
  - `water`: Regensammler füllen je Tag aus `regenMinuten` (Klimaprotokoll), bis voll.
  - Verarbeitungsstationen (Backofen, Räucherkammer, Mühle, Gärfass, Kompostkiste, Forschungspult): bestehendes Stations-Aufholen (M4); der
    Kessel ist eine Handstation und läuft nur, solange der Spieler kocht.
  - Klimaprotokoll: vor jedem Aufholen `ClimateLog.ensureUntil(toMinute)` (Wetterperioden bis zum Ziel, §20) – das Wetter selbst ist schon rein.
  - Orte, Gewölbe, Bosse, Leuchtfeuer, Weltereignisse: keine Zeit im Eingefrorenen (absolute Ticks bzw. reine Funktionen des Ticks); Wächter und
    Tiere leben im Chunk-Bestand der Kreaturen (M6).
- **Determinismus-Regeln:**
  - Zufall, der davon abhängen könnte, wann ein Chunk aktiv wird oder wie oft gespeichert wurde, zieht aus Hashes über (Seed, Schlüssel, absoluter
    Tick/Tag) – nicht aus dem fortlaufenden Strom: Beute von Orts- und Gewölbetruhen, Wachstum/Qualität/Schädlinge, Reusen, Weltereignis-Planung,
    Blitze, Ortsvorlagen (`hash(seed, slot, 'ortsvorlage')`), der Kescherfang (`hash(Seed, gespeicherter Zugzähler, Kachel)`). Fortlaufende Ströme (`sim.rng.stream(<id>)`) nur für Entscheidungen im aktiven Spiel: `fishing` (Drill), `bosses` (Musterwahl),
    `vaults` (Fallen-Varianz), `meals` (roh), `world-events` (Scherbenwurf innerhalb eines aktiven Ereignisses).
  - Welt-Aufbau (Ortsvorlagen, Gewölbepläne, Tafel- und Glutsplitter-Verteilung) ist reine Funktion von Seed, Größe, `resourceDensity`,
    Generator-Version und Content – nie im Spielstand.
  - Einstellungen, die die Simulation betreffen, kommen als Befehle hinein (`guide.configure`, `world.setSettings`) – nie aus localStorage gelesen.
  - Präsentation (Musik-Stille, Donner ferner Blitze, Partikel) darf eigene geseedete Zufälle nutzen; sie schreibt nie in die Simulation.
  - Kein `Math.random`/`Date.now`/`new Date(`/`performance.now` in `game`/`world`/`content`; keine Magic Numbers (Balancegruppen:
    `places`, `map`, `worldEvents`, `vaults`, `puzzles`, `farming`, `fishing`, `meals`, `spoilage`, `water`, `bosses`, `beacons`, `travel`,
    `guide`, `quests`, `instruments`, `difficulty` – je Wert mit Einheit und Begründung).
  - Musik-Rendering: Node und Worker bitgleich – derselbe reine Code wie die SFX-Synthese (`src/audio/dsp/`), keine Zeit- oder Zufallsquelle
    außer dem Stück-Seed, transzendente Funktionen nur über die portable Mathematik (ADR-0210); der Test vergleicht den Node-Puffer mit dem
    Worker-Puffer (Hash), die E2E `musik.spec.ts` vergleicht die abgespielten Titel-Puffer im Browser bitweise mit Node.
  - Offen (M7-76): die Simulation nutzt `Math.sin`/`Math.cos` an 62 Stellen, dazu `Math.pow`/`**` (`src/game`, `src/world`); diese Funktionen weichen
    zwischen JS-Engines im letzten Bit ab. Bis zur Umstellung auf portable Funktionen ist der Determinismus nur je Engine belegt.

## 29. Kanonische IDs M7 (verbindlich für parallele Arbeit)

- **Neue Sammlungen** (`src/content/index.ts`; Zählkategorie in Klammern; Typen in den vorgegebenen Schema-Dateien; die Orts- und
  Beobachter-Sammlungen sind seit Welle 0 registriert): `locationTypes` (`locationTypes`, nur `zaehlt: true`),
  `placeLayouts`, `placeLoot`, `worldEvents`, `roomTemplates` (`roomTemplates`), `vaultTilesets`, `puzzleTypes` (`puzzleTypes`), `vaultTraps`,
  `tablets` (`tablets`), `crops` (`crops`), `fish` (`fish`), `bosses` (`bosses`), `beacons`, `unlocks`, `visions`, `quests`, `dialogs`,
  `guideHints`, `achievements` (`achievements`), `stats`, `statSources`, `milestones`, `chronicleRules`, `knowledge`, `mechanics`, `music`
  (`music`, nur `zaehlt: true`), `stingers`, `songs`, `wavetables`, `hairstyles`, `bodyShapes`, `tips`. Die Sammlung `traps` (M6-Fallen) bleibt
  unberührt.
  **Gewölbe-Zählung** (`vaults`, §C „Gewölbe pro Welt Mittel“, Ergänzung ADR-0006): Σ über die Biome mit Gewölbe-Tileset von
  `LOCATION_RULES.gewoelbe.count.medium` (M7: nur `gruenhain` ⇒ 3); die tatsächliche Zahl prüft der Weltgen-Test.
- **Neue Item-Blöcke** (`src/content/schema/item.ts`, optional, je Block ein Eigentümer): `saat` (D), `duenger` (D), `koeder` (D), `mahlzeit` (E),
  `trank` (E), `ladungen` (E: Trinkschlauch, D: Gießkanne liest ihn mit), `instrument` (A), `bauplan` (C), `ortskarte` (C), `splitter` (F).
  **Neue Quellenarten** (`ITEM_SOURCE_KINDS`): `ernte` → `crops` (D), `angeln` → `fish` (D), `gewoelbe` → `vaultTilesets` (C), `boss` → `bosses` (F),
  `leuchtfeuer` → `beacons` (F), `ereignis` → `worldEvents` (B). Bestehend und genutzt: `ort` → `locationTypes`. Tooltip-Reihenfolge der Herkunft:
  Welt, Graben, Ernte, Angeln, Herstellen, Kreaturbeute, Boss, Ort, Gewölbe, Weltereignis, Leuchtfeuer, Händlerin.
- **Orte (B):** Ortstypen `leuchtfeuer`, `aussichtsturm`, `gehoeft`, `schrein`, `naturwunder` (Variante `uraltbaum`), `buddelstelle`,
  `eremitenhuette`, `brueckenruine`, `friedhof`, `meteoritenkrater`; Objekte `ort_<name>`, Truhen `ort_truhe_1…3`, `ort_truhe_offen`, Erzknoten
  `erz_sternenerz`; Items `sternenerz` (Verwendung geplant), Zustand `gesegnet`; Beute `ort_<ortstyp>_<stufe>`; Kartensymbole `karte_ort_<ortstyp>`,
  `karte_leuchtfeuer`, `karte_grab`, `karte_basis`, `karte_aufgabe`, eigene `karte_eigen_1…8`; Weltereignisse `schattenflut`, `finstermond`,
  `lumenregen`, `nebelnacht`, `sonnenfinsternis`, `haendlerin`, `tierwanderung`, `lawine`, `waldbrand`, `flut`, `erdbeben`.
- **Gewölbe (C):** Tileset `gruenhain`; Terrain `erbauerboden`, `erbauerstein`; Raumvorlagen `gw_gruenhain_<rolle>_<nn>` (Rollen `start`, `gang`,
  `kammer`, `schluessel`, `schloss`, `raetsel`, `falle`, `schatz`, `endkammer`; ≥ 20); Rätseltypen `kisten`, `hebel`, `feuerschalen`,
  `verborgene_wand`, `glocken` (Varianten `<typ>_1…3`); Fallen `speerfalle`, `pfeilwerfer`, `rollstein`, `fallgrube`, `einsturzboden`,
  `pendelklinge`; Items `gewoelbeschluessel`, `bauplan_<ziel>`, `relikt_<name>` (mind. 3), `ortskarte_<ortstyp>`, `glutsplitter`; Stationen
  `forschungspult`, `kartentisch`; Tafeln `tafel_01…10`, Welt-Objekt `erbauer_tafel`; Beute `gewoelbe_<biom>_<stufe>`; Gewölbe-Kreaturen
  `mimik_truhe`, `fallengeist`, `erbauer_konstrukt_1`, `wurzelhueter` (Mini-Boss) mit Essenz `essenz_wurzelhueter`; Ereignis `vaultTrapTriggered`.
- **Feld & Fang (D):** Nutzpflanzen (Id = Ernte-Item) `karotte`, `kartoffel`, `ruebe`, `zwiebel`, `knoblauch`, `kohl`, `salat`, `erbse`, `bohne`,
  `weizen`, `gerste`, `roggen`, `mais`, `tomate`, `kuerbis`, `erdbeere`, `flachs`, `kamille`; Saat `saat_<pflanze>`; Sprites `feldfrucht_<pflanze>`
  (4–6 Stufen-Frames + `_welk`); Fische `forelle`, `barsch`, `karpfen`, `hecht`, `aal`, `quappe`, `hering`, `makrele` (Id = rohes Item);
  Werkzeuge `giesskanne`, `angel_holz`, Zwischenstück `knochenhaken`, `reuse`; Köder `regenwurm`; Dünger `kompost`, `knochenmehl`,
  `kraeuterbruehe`; Bauteile `beet_holz`, `beet_stein`, `vogelscheuche`; Station `kompostkiste`; Zutatengruppe `kompostgut`; Verwendungen von
  Getreide und Kamille `rezept_strohbuendel_weizen`, `rezept_strohbuendel_gerste`, `rezept_strohbuendel_roggen`, `rezept_kraeuterbruehe_kamille`
  (ADR-0227).
- **Küche & Vorrat (E):** Stationen `kessel` (Handwerk, `feuer`), `backofen` und `raeucherkammer` (Verarbeitung mit Brennstoff), `muehle` und
  `gaerfass` (Verarbeitung ohne Brennstoff), `kraeutertisch` (Handwerk); Behälter `vorratsfass`;
  Bauteil `regensammler`; Zwischenstücke `mehl`, `wasser_abgekocht`, `verdorbenes`, `trinkschlauch`; Zutatengruppen `fleisch_roh`, `gemuese`,
  `fleisch`, `fisch`, `pilze`, `beeren`, `obst`, `kraeuter`, `getreide`; Gerichte & Getränke (22): `gebratenes_fleisch`, `gebratener_fisch`,
  `pilzspiess`, `geroesteter_mais`, `bratkartoffeln`, `eintopf` (+20 max. Leben), `fischsuppe` (+15 max. Ausdauer), `gemuesesuppe`,
  `erbsensuppe`, `kuerbissuppe`, `tomatensuppe`, `pilzragout` (Nachtsicht), `gemischter_salat`, `brot`, `beerenkuchen` (−20 Furcht),
  `apfelkuchen`, `trockenfleisch`, `raeucherfisch`, `kamillentee`, `schafgarbentee`, `beerenwein`, `bier`; Tränke & Medizin `heiltrank`,
  `gegengift`, `fiebertee`, `wundsalbe`, `waermetrank`, `kuehltrank` (+ `verband`, `schiene`); Zustände `gestaerkt`, `ausdauernd`, `erquickt`,
  `gewaermt`, `gekuehlt`, `heilend`, `wundversorgt` (Gruppe `mahlzeit` bzw. `trank`).
- **Borkenvater & Leuchtfeuer (F):** Boss `borkenvater`, Diener-Kreatur `zweigling`, Ortstyp `bossarena` (nicht gezählt), Items `kernholz`, `borkenharz`,
  `trophaee_borkenvater` (Wandmöbel), `herzsplitter`, `bronzespitzhacke` (+ `rezept_bronzespitzhacke`), `glutkern_1` (Glutkern des Grünhains für den
  Herdfeuer-Radius; je Leuchtfeuer `glutkern_<n>`); Leuchtfeuer `leuchtfeuer_1…6`; Freischaltungen
  `lf<n>_<ziel>` (LF1: `lf1_lumen_werkbank`, `lf1_lumen_laterne`, `lf1_wegsteine`, `lf1_glutkern`; LF2–6 nach §23.1 mit `umgesetzt: { task }`);
  Station `lumen_werkbank`; Licht `lumen_laterne`; Bauteil `wegstein`; Vision `vision_1`; Musikstück `borkenvater`.
- **Chronik & Aufgaben (G):** Aufgaben `hq_sechs_feuer_1`, `einstieg`; Dialoge `funke_<anlass>`; Hinweise `funke_<anlass>` (≥ 40),
  `hinweis_<anlass>`; Erfolge (15) `erste_nacht`, `feuermacher`, `steinzeit`, `baumeister`, `gemuetlich`, `jaeger`, `bronzezeit`, `gaertner`, `koch`,
  `angler`, `entdecker`, `gewoelbe_bezwungen`, `borkenvater_besiegt`, `erstes_feuer`, `forscher`; Statistiken `spielzeit`, `tage`,
  `naechte_ueberlebt`, `tode`, `kills`, `hergestellt`, `gesammelt`, `geerntet`, `gefangen`, `gekocht`, `orte_entdeckt`, `gewoelbe_abgeschlossen`,
  `raetsel_geloest`, `bosse_besiegt`, `leuchtfeuer_entzuendet`, `distanz`; Meilensteine `m_<id>`; Wissen `wissen_<id>`; Mechaniken
  `mech_<bereich>_<name>`; Perks `<fertigkeit>_<stufe>_<wahl>`-Muster wie M6.
- **Klang (A):** Musikstücke `titel`, `gruenhain`, `basis`, `kampf`, `borkenvater` (zählen; die Sammlung `music` hält daneben die nicht zählenden
  Stücke `stinger_<anlass>` und `lied_<name>`); Stinger `entdeckung`, `leuchtfeuer`, `boss_besiegt`, `stufenaufstieg`, `ereignis`; Lieder `lied_1` …
  `lied_4` (Flöte und Laute); Wavetables `floete`, `chor`, `orgel`, `laute`, `horn`, `glas`, `zunge`; SFX-Bereiche `sfx_umgebung_*`, `sfx_musik_*` (Instrumente), Nachrüstung in den bestehenden
  Bereichen; Items `floete`, `laute`, `netz`, `grille`, `gluehwuermchen`, `gluehwuermchenglas`.
- **Figur & Kreaturen (I):** Körperformen `schmal`, `mittel`, `kraeftig`; Frisuren `frisur_<name>` (12); Palettenzeilen `haut_1…6`, `haar_1…8`,
  `kleid_1…8`; Elites `graufang`, `alter_hauer` mit Essenzen `essenz_graufang`, `essenz_alter_hauer`; Schmuck `knochentalisman`,
  `federtalisman`, `muscheltalisman`; ≥ 16 Deko-Bauteile Grünhain/Küste (Ids frei in snake_case ohne Präfix, Sprites `obj_<id>`, Liste im Bericht).
- **Menüs (H):** Voreinstellungen `entspannt`, `normal`, `hart`, `unbarmherzig` (bestehend `DIFFICULTIES`); Ressourcendichte `gering`, `normal`,
  `reich`; Slots `main`, `auto-1`, `auto-2`, `auto-3`; Tipps `tipp_<nn>`.

## 30. Präsentation M7 (Render, UI-Bildschirme und Modelle, Einstellungen)

- **Render-Szenen-Teile** (je Strang eine Datei, eine Zeile in `gameScene.ts`, nur lesend, ohne Allokation je Frame – §30, Frame-Pfad ≤ 2 048 B):
  B `src/render/world/worldEventsScene.ts` (Verfinsterung, Lumenregen-Scherben und Meteor, Blitz aus `lightningStruck`; Ortsobjekte zeichnet der
  bestehende Objekt-Renderer); C `src/render/game/vaults.ts` (Kisten, Hebel, Schalen, Glocken, Türen, Fallen, verborgene Wände, Luftzug-Emitter);
  D `src/render/game/farming.ts` (Pflanzenstufen y-sortiert, feuchter Acker, Schädlinge), `src/render/game/fishing.ts` (Schnur, Pose, Rutenbiegung,
  Spritzer über `scene.water`-Impuls); F `src/render/game/bosses.ts` (mehrteiliger Boss, Schwachstellen, Arena-Siegel, Telegraphs wie
  M6), `src/render/game/beacons.ts` + `src/render/world/beaconScene.ts` (Flamme, Lichtwelle, Heilung: Verderbnis-Skala je Region und Grading-Stufe
  0–6 als Einfügung in `atmosphereScene.ts`, Partikelsturm); I `src/render/game/playerFigure.ts` (Körperform- und Frisur-Layer); H
  `src/render/world/menuScene.ts` (Hauptmenü-Szene). Neue Emitter als Daten (`src/content/particles/<bereich>.ts`).
  Muster aus Welle 1 für Einmal-je-Frame-Brücken: Frames halten Objekt-Rechteck, Figur und Hand als Referenz auf die Szenen-Datensätze, je Frame
  werden nur ganze Zahlen und `time` geschrieben, Bruchzahl-Felder starten mit `DOUBLE_FIELD`, kein `?.`/`??` auf Zahlen (ADR-0222);
  Sichtprüfung ganzzahlig über Kachelgrenzen, Gleitkommazahlen nur für sichtbare Objekte (ADR-0237). `WorldEventView`: feste Pools,
  Blitz-Variante aus `hash & 0x7fffffff`, Preset-Stärke in 32 Stufen (keine Neuberechnung der LUT je Tick). Kamera-Rahmung im Bosskampf:
  `BossView.framing` (ADR-0230).
- **UI-Bildschirme** (`src/ui/screens/<id>/`, je `modell.ts` rein und unit-getestet + `quelle.ts` über `GameSession.sample…`; Präfix der
  i18n-Schlüssel in Klammern):

  | Bildschirm / HUD | Öffner | Modell liest | Strang (i18n) |
  |---|---|---|---|
  | `karte` | M / `map` | `sampleMap` (Zellen, Marker, Ebenen, Zoom) | B (`ui.karte.*`) |
  | Minimap/Kompass: Aufdeckung, Ortsmarker | – | `sampleMap` | B |
  | Ereignis-Ankündigung (Meldung mit Restzeit) | `worldEventAnnounced` | `sampleWorldEvents` | B (`ui.ereignis.*`) |
  | `tafel` (Tafel lesen) | `tabletRead` | Content | C (`ui.tafel.*`) |
  | Forschungspult, Kartentisch | E an der Station | `sampleStation` (bestehend) | C (`ui.forschung.*`) |
  | Notiz eines Ortes (HUD) | `placeNoteRead` | Content | B (`ui.ort.notiz.*`) |
  | Angel-Minispiel (HUD, Platte unten mittig über dem Interaktionshinweis, Steuerung zweizeilig, ADR-0226) | `fishCast` (neu, Teil der D-Ereignisse) | `sampleFishing` | D (`ui.angeln.*`) |
  | Tooltips: Frische, Mahlzeit-/Trankeffekte, Überdruss | – | `sampleMeals`, Content | E (`ui.essen.*`; `ui.tooltip.*` gehört M3/M4) |
  | Bossbalken mit Phasenmarken, Titelkarte (HUD) | `bossAwakened` | `sampleBoss` | F (`ui.boss.*`) |
  | `vision` (pausiert) | `beaconLit` (Einmal-Anfrage, E schließt nur; ADR-0235) | Content `visions` | F (`ui.vision.*`) |
  | `reisen` | `travelOpened` (E am Reisepunkt; Einmal-Anfrage, ADR-0235) | `sampleTravel` | F (`ui.reisen.*`) |
  | Todesbildschirm: „Vor der Arena“, „Am Leuchtfeuer“ | – | bestehendes Modell + Orte | F |
  | `chronik` (7 Reiter) | J / `chronicle` | `sampleChronicle`, `sampleQuests`, `sampleStats`, `sampleAchievements`, `sampleCrafting`, Bestiarium | G (`ui.chronik.*`) |
  | Aufgaben-Tracker (HUD, über dem Rezept-Tracker) | – | `sampleQuests` | G (`ui.aufgaben.*`) |
  | Funke (HUD, Laterne + ≤ 2 Zeilen), Hinweiszeile | `guideHint` | `sampleGuide` | G (`ui.funke.*`, `ui.hinweis.*`) |
  | `perkwahl` | `perkChoiceOpened` | `sampleSkills` | G (`ui.perkwahl.*`) |
  | `hauptmenue`, `weltauswahl`, `neue-welt`, `laden`, `einstellungen` | Boot / Menü (Startauftrag, ADR-0240) | Speicher-Liste, Einstellungen, Weltgen-Fortschritt | H (`ui.menu.*`, `ui.worlds.*`, `ui.newWorld.*`, `ui.laden.*`, `settings.*`) |
  | Pausemenü: „Welt“ (Welteinstellungen der laufenden Welt), „Alle Einstellungen“ | Pausemenü | `world-settings` über die Sitzung, Einstellungen | H (`ui.pause.*`) |
  | `charakter` | nach „Neue Welt“ | Content `bodyShapes`/`hairstyles`, Paletten | I (`ui.charakter.*`) |
- **Einstellungsschlüssel M7** (`src/engine/settings.ts`, H): `graphics.{quality, autoDetected, lightBanding, lightBands, dither, scaleMode, fpsLimit (0 = an
  Bildwiederholrate), crt, shadows, gi, water, weatherParticles, maxLights, particleLights, bloom, fog, adaptiveLightBuffer}` (`vsync` entfällt,
  `SETTINGS_VERSION` 2) · `audio.{master, music, sfx, ambience, ui, subtitles, visualSoundCues}` · `controls.{bindings, mouseSensitivity,
  stickSensitivity, stickDeadzone, sprintMode, sneakMode, blockMode, vibration, aimAssist}` · `game.{hudMode, compassBar, damageNumbers, hints,
  funkeComments, autosaveMinutes, developerMode}` · `language` · `accessibility.{colorblind, textScale, screenshake, flashReduction,
  reducedMotion, gameSpeed, uiScale}`. Sim-wirksam werden nur `hints`/`funkeComments` – als Befehl `guide.configure`.
- **Debug:** Konsole `reveal`, `event <id>`, `strike`, `vault <n>`, `solve`, `boss <id>`, `phase <n>`, `beacon <n>`, `unlock <id>`, `quest <id> [schritt]`,
  `grow [tage]`, `spoil [stunden]` – alle als Befehle (Replay); Szenarien je Strang in `src/debug/<bereich>Scenarios.ts`. Gebaut in Welle 1:
  `reveal [tiefe]`, `event <id> [an|aus]`, `strike [dx] [dy]` (B, `src/debug/orteCommands.ts`; Hilfetexte als i18n-Schlüssel); F und D prüfen
  über die Debug-Befehle der Simulation (`boss.summon`, `boss.debug`, `beacon.debug`, `farm.grow`) und ihre Szenarien. Das vorhandene
  `unlock [fertigkeit]` (Fertigkeiten, M3) bleibt; das Freischalten einer Registry-Zeile ist der Befehl `unlock.grant`.
- **Klang:** jedes neue Ereignis in `eventMap.ts` (Klang oder begründete Stille, „ein Klang je Moment“); Stinger in `stingers.ts`; neue Presets in
  eigenen Gruppendateien `src/content/sfx/<bereich>.ts`.
