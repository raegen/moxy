import { describe, it, expect, beforeEach } from 'vitest';
import { withWriteLock, _resetWriteLocksForTesting } from './storage';

beforeEach(() => {
  _resetWriteLocksForTesting();
});

describe('withWriteLock', () => {
  it('serializes writes to the same key', async () => {
    const events: string[] = [];
    const slow = withWriteLock('k', async () => {
      events.push('A start');
      await new Promise((r) => setTimeout(r, 20));
      events.push('A end');
      return 'A';
    });
    const fast = withWriteLock('k', async () => {
      events.push('B start');
      events.push('B end');
      return 'B';
    });
    const [a, b] = await Promise.all([slow, fast]);
    expect(a).toBe('A');
    expect(b).toBe('B');
    // B must start AFTER A ends — same key serializes.
    expect(events).toEqual(['A start', 'A end', 'B start', 'B end']);
  });

  it('runs writes to different keys in parallel', async () => {
    const events: string[] = [];
    const slow = withWriteLock('k1', async () => {
      events.push('K1 start');
      await new Promise((r) => setTimeout(r, 20));
      events.push('K1 end');
    });
    const fast = withWriteLock('k2', async () => {
      events.push('K2 start');
      events.push('K2 end');
    });
    await Promise.all([slow, fast]);
    // K2 should finish before K1 ends — different keys don't block.
    expect(events.indexOf('K2 end')).toBeLessThan(events.indexOf('K1 end'));
  });

  it('does not cascade a prior failure into subsequent writes on the same key', async () => {
    const first = withWriteLock('k', async () => {
      throw new Error('boom');
    });
    await expect(first).rejects.toThrow('boom');

    const second = withWriteLock('k', async () => 'ok');
    await expect(second).resolves.toBe('ok');
  });

  it('returns the task result, including thrown errors', async () => {
    await expect(withWriteLock('k', async () => 42)).resolves.toBe(42);
    await expect(withWriteLock('k', async () => { throw new Error('x'); })).rejects.toThrow('x');
  });
});
