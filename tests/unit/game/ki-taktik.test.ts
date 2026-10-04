/**
 * Gruppentaktik, Rest (M6-18; MASTERPROMPT §19.4 „Gruppentaktik: … Fernkämpfer halten Abstand, Beschwörer schützen sich“;
 * docs/SPIEL.md §11 „Gruppentaktik“). Das Rudel-Flankieren prüft tests/integration/rudel.test.ts.
 * - Fernkämpfer (`fernkampfAbstand`, der Speier: 5 Kacheln): näher als die Hälfte davon schießt er nicht, er weicht erst
 *   zurück; nach dem Schuss weicht er auf seinen Abstand; im Spiel steht er beim Spucken nie näher als die Hälfte.
 * - Beschwörer (`schuetztSich`; M6 hat keinen eigenen, geprüft mit dem Test-Beschwörer der Kreatur-Testwelt): er rückt nie
 *   vor, sondern hält eine Wache seiner Seite zwischen sich und dem Ziel – `BALANCE.ai.summoner.behindTiles` hinter ihr auf
 *   der Linie vom Ziel durch die Wache; ohne Wache hält er Abstand wie ein Fernkämpfer; was in seine Reichweite kommt,
 *   greift er an.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { AI_PROFILES, aiProfileSchema } from '../../../src/content/creatures/index';
import { createBrainInput, decide, type BrainInput } from '../../../src/game/creatures/ai/brain';
import type { AiState } from '../../../src/game/creatures/state';
import type { SimEventMap } from '../../../src/game/sim';
import type { Entity } from '../../../src/engine/ecs';
import { Rng } from '../../../src/engine/rng';
import { TILE_PX } from '../../../src/world/model/coords';
import { eventsOf } from './kampf-testwelt';
import { PROBE_PROFILE, kreaturWelt, meadow, type KreaturWelt } from './kreatur-testwelt';

const HZ = BALANCE.time.tickHz;
const S = BALANCE.ai.summoner;
const PROFILES = [...AI_PROFILES, ...PROBE_PROFILE];
const FORM_TICKS = Math.round(BALANCE.creatures.shadowBrood.formSeconds * HZ);

function profile(id: string): (typeof PROFILES)[number] {
  const p = PROFILES.find((x) => x.id === id);
  if (p === undefined) throw new Error(`no profile ${id}`);
  return p;
}

function choose(id: string, over: Partial<BrainInput>): AiState {
  return decide(Object.assign(createBrainInput(profile(id)), over), new Rng(7));
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_PX;
}

describe('Fernkämpfer halten Abstand (M6-18)', () => {
  const keep = profile('speier').fernkampfAbstand ?? 0;
  const seen = { hasTarget: true, seesTarget: true };

  it('der Speier hält 5 Kacheln: näher als die Hälfte weicht er zurück, statt zu schießen', () => {
    expect(keep).toBe(5);
    expect(choose('speier', { ...seen, targetTiles: keep / 2 - 0.5 })).toBe('rueckzug');
    expect(choose('speier', { ...seen, targetTiles: keep / 2 - 0.5, attackReady: true })).toBe('rueckzug');
    expect(choose('speier', { ...seen, targetTiles: keep / 2 + 0.5, attackReady: true })).toBe('angreifen');
    expect(choose('speier', { ...seen, targetTiles: keep + 2 })).toBe('jagen');
    // After its shot it backs off to its distance.
    expect(choose('speier', { ...seen, targetTiles: keep, justStruck: true })).toBe('rueckzug');
  });

  it('wer kein Fernkämpfer ist, schlägt auch aus der Nähe zu', () => {
    expect(choose('schleicher', { ...seen, targetTiles: 1, attackReady: true })).toBe('angreifen');
  });

  it('im Spiel: ein Speier neben dem Spieler weicht zurück und spuckt nie aus weniger als der Hälfte seines Abstands', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.cheats.god = true;
    w.cenv.phase = 'nacht';
    w.light.ambient = 0.05;
    w.light.lit = true;
    // One and a half tiles north of the player.
    const e = w.creature('speier', 20, 13);
    w.run(FORM_TICKS);
    const spits: number[] = [];
    let farthest = 0;
    for (let i = 0; i < 6 * HZ; i++) {
      const ev = w.run(1);
      farthest = Math.max(farthest, dist(w.where(e), w.pos()));
      for (const t of eventsOf<SimEventMap['creatureTelegraph']>(ev, 'creatureTelegraph')) if (t.entity === e) spits.push(dist(w.where(e), w.pos()));
    }
    expect(spits.length).toBeGreaterThan(0);
    for (const d of spits) expect(d).toBeGreaterThanOrEqual(keep / 2);
    expect(farthest).toBeGreaterThanOrEqual(keep - 1);
  });
});

describe('Beschwörer schützen sich (M6-18)', () => {
  const seen = { hasTarget: true, seesTarget: true };

  it('im Gehirn: der Beschwörer rückt nie vor – er weicht hinter seine Wache; in Reichweite greift er an', () => {
    expect(profile('probe_beschwoerer').schuetztSich).toBe(true);
    for (const targetTiles of [3, 8, 15]) expect(choose('probe_beschwoerer', { ...seen, targetTiles })).toBe('rueckzug');
    expect(choose('probe_beschwoerer', { ...seen, targetTiles: 4, attackReady: true })).toBe('angreifen');
    // A hunter without `schuetztSich` closes in.
    expect(choose('probe_brecher', { ...seen, targetTiles: 8 })).toBe('jagen');
  });

  /** Whether `guard` stands between `from` and `to`: its centre projects into the segment within `slack` px of it. */
  function between(from: { x: number; y: number }, guard: { x: number; y: number }, to: { x: number; y: number }, slack: number): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return false;
    const t = ((guard.x - from.x) * dx + (guard.y - from.y) * dy) / len2;
    if (t <= 0 || t >= 1) return false;
    const px = from.x + t * dx - guard.x;
    const py = from.y + t * dy - guard.y;
    return Math.hypot(px, py) <= slack;
  }

  function scene(): { w: KreaturWelt; summoner: Entity; guard: Entity } {
    const w = kreaturWelt(meadow(50, 30), { x: 15, y: 15 });
    w.cheats.god = true;
    w.light.lit = true;
    // The summoner stands exposed in front of its guard, north of the line to the player; both look at him.
    const summoner = w.creature('probe_beschwoerer', 24, 12);
    const guard = w.creature('probe_brecher', 28, 15);
    w.state(summoner).facing = Math.PI;
    w.state(guard).facing = Math.PI;
    return { w, summoner, guard };
  }

  it('im Spiel: er bringt seine Wache zwischen sich und den Spieler, bleibt hinter ihr und greift von dort an', () => {
    const { w, summoner, guard } = scene();
    const slack = 2 * 6 + 4;
    let covered = 0;
    let closer = 0;
    let telegraphs = 0;
    const window = 3 * HZ;
    for (let i = 0; i < 6 * HZ; i++) {
      const ev = w.run(1);
      telegraphs += eventsOf<SimEventMap['creatureTelegraph']>(ev, 'creatureTelegraph').filter((t) => t.entity === summoner).length;
      if (i < 6 * HZ - window) continue;
      const s = w.where(summoner);
      const g = w.where(guard);
      const p = w.pos();
      if (between(s, g, p, slack)) covered++;
      if (dist(s, p) < dist(g, p)) closer++;
    }
    // Over the last three seconds the guard stands between (it may step aside while it strikes the player).
    expect(covered / window).toBeGreaterThanOrEqual(0.8);
    expect(closer).toBe(0);
    expect(telegraphs).toBeGreaterThan(0);
    expect(w.state(summoner).state === 'rueckzug' || w.state(summoner).state === 'angreifen').toBe(true);
  });

  it('er folgt der Wache, wenn der Spieler um sie herumgeht', () => {
    const { w, summoner, guard } = scene();
    w.run(3 * HZ);
    // The player walks south-east round the fight; the summoner keeps the guard between.
    for (let i = 0; i < 2 * HZ; i++) w.run(1, i === 0 ? [{ type: 'player.move', dx: 0, dy: 1 }] : undefined);
    w.run(1, [{ type: 'player.move', dx: 0, dy: 0 }]);
    let covered = 0;
    const window = 2 * HZ;
    w.run(2 * HZ);
    for (let i = 0; i < window; i++) {
      w.run(1);
      if (between(w.where(summoner), w.where(guard), w.pos(), 2 * 6 + 4)) covered++;
    }
    expect(covered / window).toBeGreaterThanOrEqual(0.8);
    expect(dist(w.where(summoner), w.where(guard))).toBeLessThanOrEqual(S.behindTiles + 1.5);
  });

  it('ein Beschwörer nennt seinen Abstand ohne Wache (Schema)', () => {
    const { fernkampfAbstand: _keep, ...plain } = profile('probe_beschwoerer');
    const res = aiProfileSchema.safeParse(plain);
    expect(res.success).toBe(false);
    expect(res.error?.issues.map((i) => i.path.join('.'))).toEqual(['fernkampfAbstand']);
    expect(aiProfileSchema.safeParse(profile('probe_beschwoerer')).success).toBe(true);
  });

  it('ein Tier einer anderen Seite ist keine Wache: neben einem Reh hält er nur Abstand', () => {
    const w = kreaturWelt(meadow(50, 30), { x: 15, y: 15 });
    w.cheats.god = true;
    w.light.lit = true;
    const e = w.creature('probe_beschwoerer', 18, 15);
    // The deer (side `tier`) stands nearer to it than anything else.
    w.creature('reh', 20, 16);
    w.state(e).facing = Math.PI;
    const keep = profile('probe_beschwoerer').fernkampfAbstand ?? 0;
    let checked = 0;
    for (let i = 0; i < 2 * HZ; i++) {
      w.run(1);
      const s = w.state(e);
      if (s.state !== 'rueckzug' || Number.isNaN(s.goalX)) continue;
      checked++;
      expect(dist({ x: s.goalX, y: s.goalY }, { x: s.targetX, y: s.targetY })).toBeCloseTo(keep, 3);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('ohne Wache hält er Abstand wie ein Fernkämpfer', () => {
    const w = kreaturWelt(meadow(50, 30), { x: 15, y: 15 });
    w.cheats.god = true;
    w.light.lit = true;
    const e = w.creature('probe_beschwoerer', 17, 15);
    w.state(e).facing = Math.PI;
    const keep = profile('probe_beschwoerer').fernkampfAbstand ?? 0;
    let farthest = 0;
    for (let i = 0; i < 4 * HZ; i++) {
      w.run(1);
      farthest = Math.max(farthest, dist(w.where(e), w.pos()));
    }
    expect(farthest).toBeGreaterThanOrEqual(keep - 1);
  });
});
