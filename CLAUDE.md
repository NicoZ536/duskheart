# DUSKHEARTH – Arbeitsregeln
- Spezifikation: MASTERPROMPT.md (nie ändern, nie komplett lesen → `grep -n "^## §" MASTERPROMPT.md`).
- Loop: Jeder Durchlauf folgt MASTERPROMPT.md §1. Zustand: PROGRESS.md, FEEDBACK.md, docs/DECISIONS.md.
- Befehle: npm run dev | check | test:e2e | shot -- <szenario> | bench | assets | verify
- Regeln (§2): keine Platzhalter/TODOs · datengetrieben (src/content, balance.ts) · strict TS · kein Math.random/Date.now in der Simulation · engine/world/game/content/save importieren nie render/audio/ui · jede Mechanik speicherbar und DE/EN · jede Änderung verifiziert und committed · nach Grafikänderungen Screenshots ansehen.
- Commit: <typ>(<bereich>): <was> [<Task-ID>]
- Subagents: exklusive Dateien je Subagent; du integrierst, prüfst, committest.
- Nie: Tests abschwächen, Anforderungen streichen, pushen, auf Antworten warten.

## Umgebung (Ergänzung)
- Cloud-Container ist flüchtig: Pushes ausschließlich auf den vorgegebenen Arbeitsbranch, nie Force (ADR-0001 in docs/DECISIONS.md).
- `npm install` braucht `legacy-peer-deps` (steht in `.npmrc`, ADR-0002).
- WebGL2 headless: Chromium mit `--use-angle=swiftshader --enable-unsafe-swiftshader` (playwright.config.ts `GL_ARGS`).
- Architekturverträge: docs/ARCHITEKTUR.md.
