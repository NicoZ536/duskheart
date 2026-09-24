/**
 * M3-33 "ungenutzte SFX-Presets ⇒ Validator-Warnung" (tools/validator/sfx.ts): a preset counts as used
 * when its id appears as a string literal under src/ outside the preset definitions, or when it is a
 * convention id (footsteps per ground material); everything else is a warning.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SFX_PRESETS, sfxConventionIds } from '../../../src/content/sfx/index';
import { CONTENT } from '../../../src/content/index';
import { checkSfxUsage, findUnusedSfx, registrySfxIds } from '../../../tools/validator/sfx';

describe('Validator: ungenutzte SFX-Presets', () => {
  it('findet Ids ohne Erwähnung; Konventions-Ids gelten als verwendet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dh-sfx-'));
    const a = join(dir, 'a.ts');
    const b = join(dir, 'b.ts');
    writeFileSync(a, "export const X = { hit: 'sfx_test_benutzt' };\n");
    writeFileSync(b, '// sfx_test_kommentar steht nur im Kommentar\n');
    const ids = ['sfx_test_benutzt', 'sfx_test_kommentar', 'sfx_test_ungenutzt', 'sfx_schritt_gras'];
    expect(findUnusedSfx(ids, [a, b], new Set(['sfx_schritt_gras']))).toEqual(['sfx_test_kommentar', 'sfx_test_ungenutzt']);
  });

  it('zählt Nennungen in den Preset-Dateien selbst nicht als Verwendung', () => {
    const root = mkdtempSync(join(tmpdir(), 'dh-sfx-root-'));
    mkdirSync(join(root, 'src/content/sfx'), { recursive: true });
    mkdirSync(join(root, 'src/game'), { recursive: true });
    writeFileSync(join(root, 'src/content/sfx/probe.ts'), "export const P = [{ id: 'sfx_test_eins' }, { id: 'sfx_test_zwei' }];\n");
    writeFileSync(join(root, 'src/game/events.ts'), "export const SFX = { eins: 'sfx_test_eins' };\n");
    const warnings = checkSfxUsage(root, ['sfx_test_eins', 'sfx_test_zwei']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^SFX-Preset sfx_test_zwei wird nirgends verwendet/);
  });

  it('im Spiel: jede Warnung nennt ein Preset, keine Schritt-Konvention wird gewarnt', () => {
    expect(registrySfxIds(CONTENT)).toEqual(SFX_PRESETS.map((p) => p.id));
    const warnings = checkSfxUsage(process.cwd(), registrySfxIds(CONTENT));
    const ids = new Set(SFX_PRESETS.map((p) => p.id));
    for (const w of warnings) expect(ids.has(w.split(' ')[1] ?? '')).toBe(true);
    for (const id of sfxConventionIds()) expect(warnings.some((w) => w.includes(`${id} `))).toBe(false);
    // Every sound the game already triggers is used; the rest waits for its task (see eventMap.test.ts).
    expect(warnings.length).toBeLessThan(SFX_PRESETS.length / 4);
  });
});
