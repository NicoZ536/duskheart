# RENDER – Verträge für Asset-Pipeline und Renderer

Ergänzt MASTERPROMPT §4–§6 und docs/ARCHITEKTUR.md. Änderungen nur per ADR.

## 1. Sprite-Quellformat (`assets-src/sprites/**/*.ts`)
```ts
import { sprite } from '../../lib/sprite';
export default sprite({
  id: 'fackel_wand',            // snake_case, global eindeutig
  group: 'licht',               // Kontaktbogen-Gruppe
  size: [16, 16],               // Zellgröße je Frame
  anchor: [8, 15],              // Fußpunkt (y-Sortierung, Platzierung)
  hoehe: 'zylinder',            // flach | zylinder | kugel | block | custom (Normal-/Höhengenerator)
  legende: { '.': null, o: 'holz.2', O: 'holz.4', f: 'feuer.3*', F: 'feuer.5*' }, // * = emissiv
  frames: [`...`, `...`],       // Index-Raster, Zeilen per Template-String, Einrückung wird entfernt
  clips: { idle: { frames: [0, 1, 2, 3], fps: 10, loop: true } },
  hitbox: [4, 10, 8, 6],        // x, y, w, h relativ zur Zelle (optional)
  sockets: { hand: [[10, 12], …] },   // je Frame (optional)
  occluder: { kind: 'ellipse', x: 8, y: 14, rx: 3, ry: 2 },  // none | rect | ellipse | sprite (optional)
  schatten: 'silhouette',       // Sonnenschatten aus Silhouette (Standard) | none
  material: { metall: 'M', nass: 'W' }, // optional: Zeichen mit Materialflags
});
```
- Ein Zeichen = ein Palettenindex (`rampe.stufe`), `*` markiert emissive Pixel. ≤ 12 Farben je Sprite (Ausnahmen per `ausnahmeFarben: 'Begründung'`).
- Dateien exportieren ein Sprite, ein Array oder das Ergebnis eines Generators (`generate(seed, …)` → Sprites). Generatoren sind deterministisch (eigener `Rng` aus `src/engine/rng.ts`).
- Palettenzeilen-Varianten (Jahreszeiten, Biom-Tönung, Elite, Verderbnis, Materialstufen, Charakteranpassung) in `assets-src/paletteRows.ts`: jede Zeile bildet jeden der 64 Indizes auf einen Palettenindex ab.

## 2. Generierte Artefakte (`npm run assets`, gitignored)
- `public/generated/atlas-albedo.png` – RGBA8: **R** = Palettenindex (1…64, 0 = transparent), **G** = Emissiv (0/255), **B** = Materialflags (Bit 0 Metall, Bit 1 nass/glänzend, Bit 2 Eis, Bit 3 Wind-Biegung, Bit 4 Blätterdach/Dach), **A** = Deckung (0/255).
- `public/generated/atlas-normal.png` – RGBA8: **RG** = Normale XY (0.5 + 0.5·n), **B** = Höhe (0…255 ≙ 0…32 px über Boden), **A** = Deckung.
- `src/generated/atlas.ts` – Manifest: Atlasgröße, je Sprite: Frames (x, y, w, h), Anker, Hitbox, Sockel je Frame, Clips, Occluder, Höhen-Hinweis, emissiv, Gruppe; Palettenzeilen-Tabelle; Quell-Hash.
- `src/generated/palette.ts` – Master-Palette (64 + 8 UI).
- `tools/out/sheets/<gruppe>.png` – Kontaktbögen (Albedo auf hellem und dunklem Grund, Normalen, Emissiv, Animationsraster, 4× vergrößert).

## 3. Renderer (`src/render`)
- `gl/` Kontext, Programme (`#include`), Ressourcen (Textur, Framebuffer inkl. MRT, Buffer, VAO), Float-RT-Erkennung mit RGBA8-Fallback, Kontextverlust → alles neu aufbauen.
- `assets/atlas.ts` lädt Atlanten + Manifest; `palette/lut.ts` baut die Paletten-LUT (64 × Zeilen, RGBA8).
- `camera.ts`: Welt in Pixeln; Kamera ganzzahlig, Nachkommaanteil als Subpixel-Offset im Präsentationspass; Szene mit 1 px Rand.
- `batch/spriteBatcher.ts`: instanzierte Quads. Instanzattribute: Position (Welt-px, Anker), Atlas-Rect, Palettenzeile, Tiefe (y-Sortierung), Höhe-Basis, Flags (Spiegeln, Outline, Weißblitz, Emissiv-Verstärkung, Dither-Ausblendung), Wind-Parameter, Tönung RGBA8, Rotation. Keine Allokation pro Frame (vorab reservierte Typed Arrays).
- `tilemap/chunkMesh.ts`: statische Boden-Meshes je Chunk, Neuaufbau nur bei Änderung.
- Pässe (`passes/`): G-Buffer (MRT: G0 Albedo · G1 Normale XY + Höhe + Materialflags · G2 Emissiv + Glanz/Nässe) → Occluder/SDF → Sonnenschatten → Licht (RGBA16F) → Komposition → Wasser → Atmosphäre → Post (Bloom, Grading-LUT, Zustände, Vignette, Korn) → Präsentation (scharfes Hochskalieren + Subpixel).
- `RenderScene` (pro Frame von der Präsentationsschicht befüllt): Kamera, Tiles/Chunks, Sprite-Instanzen, Lichter (`LightInstance`: Position, Höhe, Radius, Farbe, Intensität, Flackern, Kegel), Umgebungslicht, Zeit, Wetter-/Grading-Parameter. Die Lichtliste stammt aus derselben Quelle wie die Gameplay-Lichtkarte (§12.1).
- Render-Debugger: jeder Puffer einzeln (`__dh.call('renderDebug', 'albedo' | 'normal' | 'height' | 'emissive' | 'sdf' | 'sun' | 'light' | 'gi' | 'wet' | 'fog' | 'lightmap' | 'off')`).
- Statistiken je Frame: Draw-Calls, Sprites, Lichter, Partikel, Render-Vorbereitung (ms) → F3-Overlay und `npm run bench`.
