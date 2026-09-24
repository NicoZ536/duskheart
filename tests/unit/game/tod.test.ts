/**
 * M3-26: death and respawn (MASTERPROMPT §11.6, §29): "Dein Licht ist erloschen." – a grave with the
 * inventory at the place of death (map marker, stays until emptied), respawn at the bed or on the start
 * beach, then 3 min "Erschüttert" (−15 % max. health); the penalties of each difficulty (Entspannt keeps
 * the bags, Normal buries them and costs 25 % of the skill progress, Hart buries everything,
 * Unbarmherzig ends the world).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { graveAreas, penaltyOf, respawnVitals } from '../../../src/game/death/formulas';
import { createVitals } from '../../../src/game/survival/state';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { OFFSET, T, meadow } from './spieler-testwelt';

const TICK = BALANCE.time.tickHz;

function world(): LifeWorld {
  const w = lifeWorld(meadow(40, 40));
  w.spawn(20, 20);
  return w;
}

function rejected(ev: Map<string, unknown[]>): string[] {
  return ((ev.get('commandRejected') ?? []) as Array<{ reason: string }>).map((r) => r.reason);
}

/** Fills the bags: apples in the inventory, stones on the hotbar, a pear in the belt. */
function pack(w: LifeWorld): void {
  w.run(1, [{ type: 'inventory.give', item: 'apfel', count: 5 }]);
  w.run(1, [{ type: 'inventory.give', item: 'birne', count: 2 }]);
  w.run(1, [{ type: 'inventory.move', from: { bereich: 'inventar', index: 1 }, to: { bereich: 'guertel', index: 0 } }]);
  w.run(1, [{ type: 'inventory.give', item: 'stein', count: 7 }]);
  w.run(1, [{ type: 'inventory.move', from: { bereich: 'inventar', index: 1 }, to: { bereich: 'schnellleiste', index: 3 } }]);
}

describe('Tod (reine Funktionen)', () => {
  it('penalties of §29: Entspannt nothing, Normal the carried bags and −25 % skill progress, Hart everything, Unbarmherzig permadeath', () => {
    expect(penaltyOf('entspannt')).toEqual({ grave: 'nichts', skillLoss: 0, permadeath: false });
    expect(penaltyOf('normal')).toEqual({ grave: 'inventar', skillLoss: 0.25, permadeath: false });
    expect(penaltyOf('hart')).toEqual({ grave: 'alles', skillLoss: 0.25, permadeath: false });
    expect(penaltyOf('unbarmherzig').permadeath).toBe(true);
    expect(graveAreas('nichts')).toEqual([]);
    expect(graveAreas('inventar')).toEqual(['inventar', 'schnellleiste', 'rucksackfach']);
    expect(graveAreas('alles')).toEqual(['inventar', 'schnellleiste', 'rucksackfach', 'ausruestung', 'guertel', 'rucksack']);
  });

  it('after the respawn: full health and stamina within the maxima, satiety and thirst at least 50, warm and dry', () => {
    const v = createVitals();
    v.health = 0;
    v.satiety = 3;
    v.thirst = 80;
    v.coreC = 31;
    v.wetness = 100;
    v.pendingDamage.kaelte = 1.5;
    respawnVitals(v, 85, 100);
    expect(v).toMatchObject({ health: 85, maxHealth: 85, stamina: 100, satiety: 50, thirst: 80, coreC: 37, wetness: 0, drowning: false });
    expect(v.pendingDamage.kaelte).toBe(0);
  });

  it('the death screen says „Dein Licht ist erloschen.“ (DE) and has an English text', () => {
    const de = JSON.parse(readFileSync(join(process.cwd(), 'src/i18n/de.json'), 'utf8')) as Record<string, string>;
    const en = JSON.parse(readFileSync(join(process.cwd(), 'src/i18n/en.json'), 'utf8')) as Record<string, string>;
    expect(de['ui.death.title']).toBe('Dein Licht ist erloschen.');
    expect(en['ui.death.title']).toBe('Your light has gone out.');
  });
});

describe('Tod und Wiedereinstieg', () => {
  it('health 0: the light goes out with its cause; the grave takes the carried bags (Normal), equipment and belt stay', () => {
    const w = world();
    pack(w);
    w.vit().satiety = 0;
    w.vit().health = 0.2;
    const p = w.pos();
    const ev = w.run(TICK);
    expect(ev.get('playerDied')).toEqual([expect.objectContaining({ cause: 'hunger', x: p.x, y: p.y, layer: 0, grave: 1, permadeath: false })]);
    expect(ev.get('graveCreated')).toEqual([expect.objectContaining({ grave: 1, items: 2 })]);
    expect(w.life.death.dead).toBe(true);
    const grave = w.life.death.state.graves[0];
    expect(grave?.items.map((s) => `${s.item}×${s.count}`)).toEqual(['apfel×5', 'stein×7']);
    expect(w.inventory.count('apfel')).toBe(0);
    expect(w.inventory.state.guertel[0]).toMatchObject({ item: 'birne', count: 2 });
  });

  it('the dead body lies still: no movement, no stamina for a roll', () => {
    const w = world();
    w.run(1, [{ type: 'death.kill' }]);
    const p = w.pos();
    const ev = w.run(TICK, [{ type: 'player.move', dx: 1, dy: 0 }]);
    expect(w.pos()).toEqual(p);
    expect(w.vit().stamina).toBe(0);
    expect(rejected(w.run(1, [{ type: 'player.roll', dx: 1, dy: 0 }]))).toEqual(['noStamina']);
    expect(ev.get('playerDied')).toBeUndefined();
    expect(rejected(w.run(1, [{ type: 'death.kill' }]))).toEqual(['dead']);
  });

  it('respawn on the start beach without a bed: full health within Erschüttert (3 min, −15 % max. health)', () => {
    const w = world();
    w.run(1, [{ type: 'conditions.apply', id: 'blutung' }]);
    w.run(1, [{ type: 'fear.set', value: 70 }]);
    const died = w.run(1, [{ type: 'death.kill' }]);
    expect(died.get('playerDied')).toEqual([expect.objectContaining({ cause: 'debug', grave: null })]);
    expect(died.get('conditionRemoved')).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'blutung', reason: 'tod' })]));
    expect(w.life.fear.state.value).toBe(0);
    expect(rejected(w.run(1, [{ type: 'death.respawn', at: 'bett' }]))).toEqual(['noRespawnPoint']);
    const back = w.run(1, [{ type: 'death.respawn' }]);
    expect(back.get('playerRespawned')).toEqual([expect.objectContaining({ at: 'strand', x: (OFFSET + 1.5) * T, y: (OFFSET + 1.5) * T, layer: 0 })]);
    expect(w.life.death.dead).toBe(false);
    expect(w.life.conditions.remainingSeconds('erschuettert', TICK)).toBeCloseTo(180 - 1 / TICK, 6);
    expect(w.vit().maxHealth).toBeCloseTo(85, 9);
    expect(w.vit().health).toBeCloseTo(85, 9);
    expect(rejected(w.run(1, [{ type: 'death.respawn' }]))).toEqual(['notDead']);
    w.run(180 * TICK);
    expect(w.life.conditions.has('erschuettert')).toBe(false);
    expect(w.vit().maxHealth).toBe(100);
  });

  it('respawn at the bed that set the respawn point', () => {
    const w = world();
    const bed = w.bed(21, 20, 'bett');
    w.jumpToHour(20);
    w.run(1, [{ type: 'sleep.start', ...w.tile(21, 20) }]);
    w.run(1, [{ type: 'sleep.wake' }]);
    w.run(1, [{ type: 'player.teleport', x: (OFFSET + 35) * T, y: (OFFSET + 35) * T, layer: 0 }]);
    w.run(1, [{ type: 'death.kill' }]);
    const back = w.run(1, [{ type: 'death.respawn' }]);
    expect(back.get('playerRespawned')).toEqual([expect.objectContaining({ at: 'bett' })]);
    expect(Math.hypot(w.pos().x - bed.x, w.pos().y - bed.y)).toBeLessThan(2 * T);
    // A lit beacon (M5) is a respawn point of its own.
    w.life.death.addBeacons(() => [{ x: (OFFSET + 30) * T + T / 2, y: (OFFSET + 30) * T + T / 2, layer: 0 }]);
    w.run(1, [{ type: 'death.kill' }]);
    expect(w.run(1, [{ type: 'death.respawn', at: 'leuchtfeuer' }]).get('playerRespawned')).toEqual([expect.objectContaining({ at: 'leuchtfeuer', x: (OFFSET + 30.5) * T })]);
  });

  it('the grave stays until emptied: what fits goes into the bags; out of reach and dead players cannot loot', () => {
    const w = world();
    pack(w);
    w.run(1, [{ type: 'death.kill' }]);
    const grave = w.life.death.state.graves[0];
    expect(grave).toBeDefined();
    expect(rejected(w.run(1, [{ type: 'death.lootGrave', grave: 1 }]))).toEqual(['dead']);
    w.run(1, [{ type: 'death.respawn' }]);
    expect(rejected(w.run(1, [{ type: 'death.lootGrave', grave: 1 }]))).toEqual(['outOfReach']);
    expect(rejected(w.run(1, [{ type: 'death.lootGrave', grave: 9 }]))).toEqual(['noGrave']);
    w.run(1, [{ type: 'player.teleport', x: grave?.x ?? 0, y: grave?.y ?? 0, layer: 0 }]);
    // Fill the bags with wood, all but one slot: only the apples fit, the stones stay in the grave.
    const free = w.inventory.state.inventar.filter((s) => s === null).length + w.inventory.state.schnellleiste.filter((s) => s === null).length;
    w.run(1, [{ type: 'inventory.give', item: 'holz', count: (free - 1) * 100 }]);
    const first = w.run(1, [{ type: 'death.lootGrave', grave: 1 }]);
    expect(first.get('graveLooted')).toEqual([expect.objectContaining({ grave: 1, taken: 5, remaining: 7 })]);
    expect(w.life.death.state.graves[0]?.items).toEqual([{ item: 'stein', count: 7 }]);
    w.run(1, [{ type: 'inventory.discard', from: { bereich: 'inventar', index: 5 } }]);
    const second = w.run(1, [{ type: 'death.lootGrave', grave: 1 }]);
    expect(second.get('graveEmptied')).toEqual([expect.objectContaining({ grave: 1 })]);
    expect(w.life.death.state.graves).toEqual([]);
  });

  it('Entspannt keeps the bags; Hart buries everything including equipment and belt', () => {
    const easy = world();
    easy.life.death.setDifficulty('entspannt');
    pack(easy);
    const e = easy.run(1, [{ type: 'death.kill' }]);
    expect(e.get('playerDied')).toEqual([expect.objectContaining({ grave: null })]);
    expect(easy.inventory.count('apfel')).toBe(5);
    const hard = world();
    hard.life.death.setDifficulty('hart');
    pack(hard);
    hard.run(1, [{ type: 'death.kill' }]);
    expect(hard.life.death.state.graves[0]?.items.map((s) => s.item)).toEqual(['apfel', 'stein', 'birne']);
    expect(hard.inventory.state.guertel.every((s) => s === null)).toBe(true);
  });

  it('Unbarmherzig: permadeath – no respawn, and the difficulty cannot be lowered any more', () => {
    const w = world();
    expect(w.life.death.setDifficulty('unbarmherzig')).toBe(true);
    expect(w.life.death.setDifficulty('normal')).toBe(false);
    const ev = w.run(1, [{ type: 'death.kill' }]);
    expect(ev.get('playerDied')).toEqual([expect.objectContaining({ permadeath: true })]);
    expect(rejected(w.run(1, [{ type: 'death.respawn' }]))).toEqual(['permadeath']);
  });

  it('death costs 25 % of each skill level’s progress on Normal, never a level', () => {
    const w = world();
    w.life.skills.award(w.sim, 'baum_gefaellt', 20);
    const before = w.life.skills.skill('holzfaellen');
    const level = before.level;
    const xp = before.xp;
    expect(level).toBeGreaterThan(1);
    const ev = w.run(1, [{ type: 'death.kill' }]);
    expect(ev.get('skillProgressLost')).toEqual([expect.objectContaining({ skill: 'holzfaellen', amount: xp * 0.25 })]);
    expect(w.life.skills.skill('holzfaellen')).toMatchObject({ level, xp: xp * 0.75 });
  });
});

describe('Todesbildschirm (Modell)', () => {
  it('shows the next death the session reports, names the cause, lists the consequences, and sends the respawn', async () => {
    const { createI18n } = await import('../../../src/i18n');
    const { causeText, createDeathScreenModel, penaltyLines } = await import('../../../src/ui/screens/tod/model');
    const w = world();
    const handlers = new Map<string, (payload: never) => void>();
    const sent: unknown[] = [];
    const session = {
      onEvent: (type: string, handler: (payload: never) => void) => {
        handlers.set(type, handler);
        return () => handlers.delete(type);
      },
      command: (cmd: unknown) => {
        sent.push(cmd);
        return cmd;
      },
    };
    const model = createDeathScreenModel(session as unknown as Parameters<typeof createDeathScreenModel>[0]);
    pack(w);
    const ev = w.run(1, [{ type: 'death.kill' }]);
    const died = (ev.get('playerDied') as never[])[0];
    handlers.get('playerDied')?.(died as never);
    const view = model.view.value;
    expect(view).toMatchObject({ cause: 'debug', grave: 1, graveItems: 2, spots: ['strand'] });
    const de = createI18n('de', { strict: true });
    const en = createI18n('en', { strict: true });
    expect(causeText(de, 'de', 'kaelte')).toBe('erfroren');
    expect(causeText(de, 'de', 'blutung')).toBe('an „Blutung“ gestorben');
    expect(causeText(en, 'en', 'vergiftung')).toBe('died of “Poisoned”');
    expect(causeText(de, 'de', 'meteorit')).toBe('unbekannt');
    if (view === null) throw new Error('no view');
    expect(penaltyLines(de, view)).toEqual([
      'Dein Grab liegt am Todesort: 2 Stapel warten dort, bis du sie holst. Die Karte zeigt dir den Weg.',
      'Deine Ausrüstung bleibt am Körper.',
      'Erschüttert: 3 min lang 15 % weniger maximales Leben.',
      'Jede Fertigkeit verliert 25 % ihres Fortschritts in der Stufe.',
    ]);
    expect(penaltyLines(de, { ...view, penalty: penaltyOf('entspannt'), grave: null })[0]).toBe('Du behältst deine Taschen.');
    expect(penaltyLines(de, { ...view, penalty: penaltyOf('unbarmherzig') })).toEqual(['Unbarmherzig: Diese Welt ist verloren.']);
    model.respawn('strand');
    expect(sent).toEqual([{ type: 'death.respawn', at: 'strand' }]);
    handlers.get('playerRespawned')?.({} as never);
    expect(model.view.value).toBeNull();
    model.dispose();
    expect(handlers.size).toBe(0);
  });
});
