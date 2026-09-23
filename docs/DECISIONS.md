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
