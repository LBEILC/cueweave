import { describe, expect, it, vi } from 'vitest';
import { TranslationQueue } from './translationQueue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('TranslationQueue', () => {
  it('promotes queued stages by window group without a duplicate request', async () => {
    const queue = new TranslationQueue(1);
    const gate = deferred<string>(),
      order: string[] = [];
    const blocker = queue.enqueue('blocker', 'prefetch', () => gate.promise);
    const far = queue.enqueue(
      'far',
      'prefetch',
      async () => {
        order.push('far');
        return 'far';
      },
      'session:playback:8',
    );
    const hole = queue.enqueue(
      'hole',
      'prefetch',
      async () => {
        order.push('hole');
        return 'hole';
      },
      'session:playback:1',
    );
    expect(queue.promoteGroup('other:playback:1')).toBe(0);
    expect(queue.promoteGroup('session:playback:1')).toBe(1);
    gate.resolve('done');
    await Promise.all([blocker, far, hole]);
    expect(order).toEqual(['hole', 'far']);
  });
  it('runs current playback work before queued prefetch work', async () => {
    const queue = new TranslationQueue(1);
    const firstGate = deferred<string>();
    const order: string[] = [];

    const first = queue.enqueue('prefetch-1', 'prefetch', async () => {
      order.push('prefetch-1');
      return firstGate.promise;
    });
    const second = queue.enqueue('prefetch-2', 'prefetch', async () => {
      order.push('prefetch-2');
      return 'second';
    });
    const current = queue.enqueue('current', 'current', async () => {
      order.push('current');
      return 'current';
    });

    firstGate.resolve('first');
    await expect(Promise.all([first, current, second])).resolves.toEqual([
      'first',
      'current',
      'second',
    ]);
    expect(order).toEqual(['prefetch-1', 'current', 'prefetch-2']);
  });

  it('deduplicates identical active or pending windows', async () => {
    const queue = new TranslationQueue(1);
    const run = vi.fn(async () => 'translated');

    const first = queue.enqueue('same-window', 'prefetch', run);
    const second = queue.enqueue('same-window', 'current', run);

    await expect(Promise.all([first, second])).resolves.toEqual(['translated', 'translated']);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('promotes an already queued prefetch window when playback seeks into it', async () => {
    const queue = new TranslationQueue(1);
    const blockerGate = deferred<string>();
    const order: string[] = [];

    const blocker = queue.enqueue('blocker', 'prefetch', async () => {
      order.push('blocker');
      return blockerGate.promise;
    });
    const olderPrefetch = queue.enqueue('older-prefetch', 'prefetch', async () => {
      order.push('older-prefetch');
      return 'older';
    });
    const soughtWindow = queue.enqueue('sought-window', 'prefetch', async () => {
      order.push('sought-window');
      return 'sought';
    });
    const promotedWindow = queue.enqueue('sought-window', 'current', async () => 'duplicate');

    blockerGate.resolve('done');
    await expect(
      Promise.all([blocker, olderPrefetch, soughtWindow, promotedWindow]),
    ).resolves.toEqual(['done', 'older', 'sought', 'sought']);
    expect(order).toEqual(['blocker', 'sought-window', 'older-prefetch']);
  });
});
