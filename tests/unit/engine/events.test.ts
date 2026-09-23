import { describe, expect, it } from 'vitest';
import { EventBus, EventQueue } from '../../../src/engine/events';

interface TestEvents {
  hit: { target: number; amount: number };
  died: { id: number };
  tick: number;
}

describe('EventBus', () => {
  it('delivers typed payloads in subscription order', () => {
    const bus = new EventBus<TestEvents>();
    const log: string[] = [];
    bus.on('hit', (p) => log.push(`a${p.amount}`));
    bus.on('hit', (p) => log.push(`b${p.target}`));
    bus.on('tick', (n) => log.push(`t${n}`));
    bus.emit('hit', { target: 3, amount: 7 });
    bus.emit('tick', 9);
    bus.emit('died', { id: 1 });
    expect(log).toEqual(['a7', 'b3', 't9']);
    expect(bus.listenerCount('hit')).toBe(2);
    expect(bus.listenerCount('died')).toBe(0);
  });

  it('on() returns an idempotent unsubscribe', () => {
    const bus = new EventBus<TestEvents>();
    let n = 0;
    const off = bus.on('tick', () => n++);
    bus.emit('tick', 1);
    off();
    off();
    bus.emit('tick', 2);
    expect(n).toBe(1);
    expect(bus.listenerCount('tick')).toBe(0);
  });

  it('once() fires exactly once and can be cancelled', () => {
    const bus = new EventBus<TestEvents>();
    const seen: number[] = [];
    bus.once('tick', (v) => seen.push(v));
    bus.emit('tick', 1);
    bus.emit('tick', 2);
    const cancel = bus.once('tick', (v) => seen.push(v * 100));
    cancel();
    bus.emit('tick', 3);
    expect(seen).toEqual([1]);
  });

  it('is safe against (un)subscribing during emit', () => {
    const bus = new EventBus<TestEvents>();
    const log: string[] = [];
    const offB = bus.on('tick', () => log.push('b'));
    bus.on('tick', () => {
      log.push('a');
      offB();
      bus.on('tick', () => log.push('late'));
    });
    // The running emit keeps the handler list captured when it started.
    bus.emit('tick', 0);
    expect(log).toEqual(['b', 'a']);
    log.length = 0;
    bus.emit('tick', 0);
    expect(log).toEqual(['a', 'late']);
  });

  it('off() and clear()', () => {
    const bus = new EventBus<TestEvents>();
    const h = (): void => undefined;
    bus.on('died', h);
    expect(bus.off('died', h)).toBe(true);
    expect(bus.off('died', h)).toBe(false);
    bus.on('died', h);
    bus.on('tick', h);
    bus.clear('died');
    expect(bus.listenerCount('died')).toBe(0);
    expect(bus.listenerCount('tick')).toBe(1);
    bus.clear();
    expect(bus.listenerCount('tick')).toBe(0);
  });
});

describe('EventQueue', () => {
  it('buffers events and drains them in order with narrowed types', () => {
    const q = new EventQueue<TestEvents>();
    q.push('hit', { target: 1, amount: 5 });
    q.push('tick', 4);
    q.push('died', { id: 2 });
    expect(q.size).toBe(3);
    const log: string[] = [];
    const n = q.drain((type, payload) => {
      if (type === 'hit') log.push(`hit:${payload.target}:${payload.amount}`);
      else if (type === 'tick') log.push(`tick:${payload}`);
      else log.push(`died:${payload.id}`);
    });
    expect(n).toBe(3);
    expect(log).toEqual(['hit:1:5', 'tick:4', 'died:2']);
    expect(q.size).toBe(0);
    expect(q.drain(() => log.push('x'))).toBe(0);
  });

  it('events pushed during drain go to the next drain', () => {
    const q = new EventQueue<TestEvents>();
    q.push('tick', 1);
    const seen: number[] = [];
    q.drain((type, payload) => {
      if (type === 'tick') {
        seen.push(payload);
        if (payload < 3) q.push('tick', payload + 1);
      }
    });
    expect(seen).toEqual([1]);
    expect(q.size).toBe(1);
    q.drain((type, payload) => {
      if (type === 'tick') seen.push(payload);
    });
    expect(seen).toEqual([1, 2]);
  });

  it('reuses buffers across many ticks', () => {
    const q = new EventQueue<TestEvents>();
    let total = 0;
    for (let t = 0; t < 100; t++) {
      for (let i = 0; i < 10; i++) q.push('tick', i);
      total += q.drain(() => undefined);
    }
    expect(total).toBe(1000);
  });

  it('rejects draining from inside a drain instead of overwriting undelivered events', () => {
    const q = new EventQueue<TestEvents>();
    q.push('tick', 1);
    q.push('tick', 2);
    q.push('tick', 3);
    const got: number[] = [];
    q.drain((type, payload) => {
      if (type !== 'tick') return;
      got.push(payload);
      q.push('tick', payload * 10);
      if (payload === 1) expect(() => q.drain(() => undefined)).toThrow(/re-entrant/);
    });
    expect(got).toEqual([1, 2, 3]);
    const next: number[] = [];
    q.drain((type, payload) => {
      if (type === 'tick') next.push(payload);
    });
    expect(next).toEqual([10, 20, 30]);
  });

  it('forEachOfType peeks and clear() empties', () => {
    const q = new EventQueue<TestEvents>();
    q.push('died', { id: 1 });
    q.push('tick', 2);
    q.push('died', { id: 3 });
    const ids: number[] = [];
    q.forEachOfType('died', (p) => ids.push(p.id));
    expect(ids).toEqual([1, 3]);
    expect(q.size).toBe(3);
    q.clear();
    expect(q.size).toBe(0);
  });
});
