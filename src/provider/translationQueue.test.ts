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
});
