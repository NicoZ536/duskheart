# SPIEL – Verträge für Spielsysteme (ab M3)

Ergänzt MASTERPROMPT §11–§31, docs/ARCHITEKTUR.md und docs/WORLD.md. Änderungen nur per ADR.

## 1. Modulaufteilung (parallel bearbeitbar)
- Jedes Spielsystem lebt in `src/game/<bereich>/` (z. B. `items/`, `inventory/`, `player/`, `survival/`, `gathering/`, `crafting/`, `light/`, `conditions/`, `skills/`, `sleep/`, `death/`) mit eigenem `commands.ts`, `events.ts`, `system.ts` und reinen Formeln in `formulas.ts`.
- `src/game/commands.ts` und `src/game/sim.ts` (`SimEventMap`) **aggregieren** nur: je Bereich ein Import und ein Eintrag (Schema-Liste bzw. Event-Typen). Änderungen dort sind kleine, gezielte Einfügungen – Datei unmittelbar vor dem Bearbeiten neu lesen.
- `src/game/setup.ts` registriert alle Systeme in fester Reihenfolge (Liste mit Kommentar je System).
- Balancewerte: `src/content/balance.ts` bleibt die zentrale Stelle; neue Gruppen als eigene Module `src/content/balance/<gruppe>.ts`, die `balance.ts` einbindet und re-exportiert (ein Import + ein Feld je Gruppe). Jeder Wert mit Einheit + Begründung.

## 2. Items (§13, §2.2)
- Content in `src/content/items/<gruppe>.ts` (z. B. `rohstoffe.ts`, `werkzeuge.ts`, `nahrung.ts`), jede Datei eine zod-validierte Collection, registriert in `src/content/index.ts` mit Kategorie für den Zählbericht (`items` zählt alle; zusätzlich `weapons`, `armor`, `jewelry`, `dishes`, `potions`, `buildParts` …).
- `ItemDef`: `id` (snake_case), `kategorie`, `stufe` (0–7), `raritaet`, `stapel` (§13.1: Rohstoffe 100, Barren 50, Nahrung 20, Munition 200, Werkzeug/Waffe/Rüstung 1), optional `haltbarkeit`, `werte`, `frische` (Haltbarkeit in Tagen), `brennwert` (s, §15.4), `tauschwert`, `quellen` (deklarierte Quellen: `welt:<objektId>`, `drop:<kreaturId>`, `rezept:<rezeptId>`, `haendlerin`, `bauplan:<id>` …), `name`/`beschreibung` (LocalizedText), `sounds` (SFX-IDs). **Verwendungen werden automatisch berechnet** (Rezepte, Baukosten, Brennstoff …).
- Icon-Konvention: Sprite `icon_<itemId>` (16×16); Welt-Drop nutzt dasselbe Icon. Der Validator verlangt für jedes Item ein existierendes Icon.
- Laufzeit: `ItemStack = { item: string; count; haltbarkeit?; qualitaet? (1–3); frische? (0–100); daten? }`; Operationen rein funktional getestet (`src/game/inventory/`).

## 3. Spieler & Entitäten
- Genau ein Spieler-Entity (`sim.player`), Komponenten: Position/Velocity/Collider (Motion), `vitals` (§11.1), `inventory` (30 + Schnellleiste 10 + Rucksack), `equipment` (§13.1 Slots), `conditions` (§11.3), `skills` (§23.2), `lightSource` (Nebenhand), `facing`/`aim`.
- Welt-Objekte (Bäume, Felsen, Erze, Pflanzen) bleiben Chunk-Daten (`object` + `objectState`); nur bewegliche/aktive Dinge (Drops, Kreaturen, Projektile, Lichter) sind ECS-Entitäten.
- Befehle vom Spieler: `player.move {dx,dy}`, `player.aim {x,y}`, `player.interact {tx,ty}`, `player.useItem {slot}`, `player.selectHotbar {index}`, `player.sprint/sneak/block {on}`, `player.roll {dx,dy}`, `player.drop …`, `inventory.move …`, `craft.start …` usw. – jeweils im Bereichsmodul definiert.

## 4. Gameplay-Licht (§12)
- Lichtquellen sind Simulationsdaten (`src/game/light/`): Liste `LightSource { x, y, layer, radius, farbe, intensitaet, flacker, kegel?, brenndauer? }`. Der Renderer liest **dieselbe** Liste (Präsentationsbrücke wandelt in `LightInstance`), die Gameplay-Lichtkarte (CPU pro Tile, Tile-Raycast-Verdeckung, gecacht) nutzt `src/engine/lightFalloff.ts` – identische Formel wie der Shader.

## 5. Präsentation
- HUD/Inventar/Menüs: Preact in `src/ui/screens/<name>/` und `src/ui/hud/`, liest nur Bridge-Signals, schreibt nur Commands. Alle Texte als i18n-Schlüssel (`ui.<bereich>.<…>`).
- Figuren-Animation: Spieler-Sprites `spieler_<teil>` mit Clips `<aktion>_<richtung>` (down/up/left/right), Ausrüstungs-Layer `ausruestung_<itemId>` an Hand-Sockeln.
- Zustands-Icons: `zustand_<zustandId>`; SFX-IDs `sfx_<bereich>_<name>`.
